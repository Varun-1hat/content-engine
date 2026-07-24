"""B-roll clip generator — Veo.

Follows the CLI contract in src/lib/generators/base.py (imported below, not
copied: sys.path[0] is this file's directory when the adapter invokes us by
absolute path, so `generators.base` always resolves).

Veo 3.1 (and 3.1 Fast) accept `reference_images`, which FORCE a subject's
appearance into the output — this is what stops the model inventing a product.
Veo 3.1 also always generates native audio; there is no flag for it.
"""

import os
import time

from google import genai
from google.genai import types

from generators.base import (
    describe_api_error,
    fail,
    is_retryable_api_error,
    load_env,
    parse_cli_args,
    reference_mime_type,
)

# Veo 3.1 accepts at most 3 asset reference images.
# https://ai.google.dev/gemini-api/docs/veo
MAX_REFERENCE_IMAGES = 3

# Only used when --model is absent (a client row predating migration 0005).
DEFAULT_MODEL = "veo-3.1-fast-generate-preview"

# The operation poll must be bounded. An unbounded `while not operation.done`
# hangs the assemble request forever if Veo never settles — and assembly runs
# these in parallel, so one stuck clip strands the whole reel. 15 min matches the
# avatar adapter's ceiling.
POLL_INTERVAL_SECONDS = 15
MAX_POLL_SECONDS = 900


# reference_mime_type (M12: never let the platform guess .webp) and the API-error
# classification below it are imported from generators.base — nanobanana needs
# both too, and one copy is the point of the shared contract module.


def build_reference_images(paths, output_filename):
    """Wrap local image files as Veo 'asset' references.

    An asset reference tells Veo to preserve that subject's appearance in the
    output. Missing files are fatal: silently generating a fictional product is
    the bug this prevents.
    """
    refs = []
    for p in paths[:MAX_REFERENCE_IMAGES]:
        if not os.path.exists(p):
            fail(output_filename, f"reference image not found: {p}", retryable=False)
        with open(p, "rb") as f:
            image_bytes = f.read()
        refs.append(
            types.VideoGenerationReferenceImage(
                image=types.Image(image_bytes=image_bytes, mime_type=reference_mime_type(p)),
                reference_type="asset",
            )
        )
    return refs


def describe_operation_error(error):
    """Flatten Veo's operation.error dict into one line."""
    if not error:
        return None
    if isinstance(error, dict):
        parts = [str(error.get(k)) for k in ("code", "status", "message") if error.get(k)]
        return ": ".join(parts) if parts else str(error)
    return str(error)


def describe_filtered(response):
    """Why Veo returned no video: the RAI (safety) filter is the usual reason.

    Without this a filtered clip reports "no videos in response", which reads as
    a transient glitch and gets retried — but a filtered prompt is filtered every
    time. The reason has to reach the operator so the prompt can be changed.
    """
    count = getattr(response, "rai_media_filtered_count", None) or 0
    reasons = getattr(response, "rai_media_filtered_reasons", None) or []
    if count or reasons:
        detail = "; ".join(str(r) for r in reasons) if reasons else "no reason given"
        return f"blocked by Veo's safety filter ({count} filtered) — {detail}"
    return None


def generate(prompt, negative_prompt, output_filename, model=None, reference_paths=None):
    env = load_env()
    api_key = env.get("GEMINI_API_KEY") or env.get("VEO_API_KEY")
    if not api_key:
        fail(output_filename, "GEMINI_API_KEY or VEO_API_KEY is not set.", retryable=False)

    print(f"[{output_filename}] Initializing Gemini Client...")
    client = genai.Client(api_key=api_key)

    # The model id is DB config (clients.model_visual_video) — this default only
    # applies to a client row predating migration 0005.
    model = model or DEFAULT_MODEL
    print(f"[{output_filename}] Model: {model}")

    reference_paths = reference_paths or []
    if len(reference_paths) > MAX_REFERENCE_IMAGES:
        print(
            f"[{output_filename}] NOTE: {len(reference_paths)} reference images given; "
            f"Veo accepts {MAX_REFERENCE_IMAGES} — using the first {MAX_REFERENCE_IMAGES}."
        )

    config_kwargs = {"aspect_ratio": "9:16"}

    if reference_paths:
        config_kwargs["reference_images"] = build_reference_images(reference_paths, output_filename)
        print(
            f"[{output_filename}] Conditioning generation on "
            f"{len(config_kwargs['reference_images'])} product reference image(s)."
        )
        # Verified against the live API (2026-07-17): Veo 3.1 rejects the pair
        # reference_images + negative_prompt with
        #   400 INVALID_ARGUMENT "Negative prompt is not supported in your use case."
        # Every b-roll clip carries a negative_prompt, so sending both would fail
        # EVERY product clip. The exclusions are still creative intent, so fold
        # them into the prompt text rather than dropping them — the same thing
        # nanobanana_generator.py does.
        if negative_prompt and negative_prompt.strip():
            prompt = f"{prompt}\n\nAVOID: {negative_prompt.strip()}"
            print(
                f"[{output_filename}] NOTE: Veo rejects negative_prompt alongside reference "
                f"images — folded it into the prompt as an AVOID clause instead."
            )
    elif negative_prompt:
        # No references: negative_prompt is supported and preferred (verified live).
        config_kwargs["negative_prompt"] = negative_prompt

    print(f"[{output_filename}] Initiating video generation using Veo...")
    try:
        operation = client.models.generate_videos(
            model=model,
            prompt=prompt,
            config=types.GenerateVideosConfig(**config_kwargs),
        )
    except Exception as err:
        # Without this the SDK exception escapes as a raw traceback: the adapter
        # surfaces stderr, so the operator gets a Python stack instead of the
        # vendor's reason, and the default exit code (1) burns all three attempts
        # on a request the API rejects identically every time.
        fail(
            output_filename,
            f"Veo rejected the generation request — {describe_api_error(err)}",
            retryable=is_retryable_api_error(err),
        )

    print(f"[{output_filename}] Operation started: {operation.name}")
    print(f"[{output_filename}] Polling every {POLL_INTERVAL_SECONDS}s (ceiling {MAX_POLL_SECONDS}s)...")

    deadline = time.monotonic() + MAX_POLL_SECONDS
    while not operation.done:
        if time.monotonic() >= deadline:
            fail(
                output_filename,
                f"Veo did not finish within {MAX_POLL_SECONDS // 60} minutes "
                f"(operation {operation.name} still running).",
                retryable=False,
            )
        time.sleep(POLL_INTERVAL_SECONDS)
        try:
            operation = client.operations.get(operation)
        except Exception as err:
            fail(
                output_filename,
                f"Veo polling failed — {describe_api_error(err)}",
                retryable=is_retryable_api_error(err),
            )
        print(f"[{output_filename}] Polling status...")

    # A done operation can still be a FAILED operation. Surface Veo's own reason
    # rather than reporting the generic "no videos" below.
    error_detail = describe_operation_error(getattr(operation, "error", None))
    if error_detail:
        fail(output_filename, f"Veo reported the generation failed — {error_detail}")

    response = operation.response
    generated = getattr(response, "generated_videos", None) if response else None
    if not generated:
        # Retryable on purpose. Observed live (2026-07-17), Veo's own words:
        # "This can sometimes happen due to our safety filters OR OTHER PROCESSING
        # ISSUES. Please modify your request and try again. YOU HAVE NOT BEEN
        # CHARGED for this attempt." The identical call succeeded on the next
        # attempt — so this is not always a deterministic block, and a retry is
        # free. Surface the reason either way; the operator needs it when the
        # retries do run out.
        fail(
            output_filename,
            describe_filtered(response) or "Veo returned no video and gave no reason.",
        )

    print(f"[{output_filename}] Video generation completed successfully!")
    video_bytes = client.files.download(file=generated[0].video)
    with open(output_filename, "wb") as f:
        f.write(video_bytes)
    print(f"[{output_filename}] Video saved successfully as: {output_filename}")


if __name__ == "__main__":
    prompt, negative_prompt, output_filename, model, reference_images = parse_cli_args()
    generate(prompt, negative_prompt, output_filename, model, reference_images)

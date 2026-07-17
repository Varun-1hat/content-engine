"""
PYTHON CLIP GENERATOR — base CLI contract

The veo_imagen visual adapter (src/lib/adapters/visual/veo_imagen.ts) invokes
generator scripts as subprocesses. Any new Python generator must follow this
exact CLI contract so the adapter (or a new visual adapter) can call it:

    python3 <script>.py <prompt> <negative_prompt> <output_filename> [--base64]
            [--model <id>] [--ref <path> ...]

  - With --base64, <prompt> and <negative_prompt> are base64-encoded UTF-8
    (used to bypass shell-escaping issues; the adapter always passes it).
  - --model <id> is the vendor model id, which lives in DB config (see
    migration 0005), NOT in code — a retired model must be fixable from the
    admin panel without a redeploy. Fall back to a sane default when absent.
  - --ref <path> may be repeated: local image files the generated clip MUST
    depict (this reel's product photos). A generator that cannot condition
    generation on an image must EXIT NON-ZERO when --ref is passed — never
    ignore them and generate from the prompt alone. Rendering an invented
    product silently is the failure mode this contract exists to prevent.
  - Write the generated media to <output_filename>. The caller checks that
    the file exists — a missing file means failure.
  - Exit 0 on success, non-zero on failure. Print progress to stdout prefixed
    with [<output_filename>] so parallel runs are readable, but report every
    failure through fail() — i.e. to STDERR. The adapter surfaces the
    subprocess's stderr and nothing else; a reason printed to stdout is thrown
    away and the operator is left with a bare "Command failed: python3 …".
  - API keys come from os.environ first (see load_env below); .env / .env.local
    are a local-dev fallback only. Hard-fail with a clear message if unset.
  - Output must be 9:16 (1080x1920) — vertical reels are the product.

Existing implementations: veo_generator.py (video), imagen_generator.py (image).
Import from this module in new generators; the existing two predate it.
"""

import base64
import os
import sys


# Exit codes are the retry contract with the adapter. 1 = might succeed on a
# retry (transient). 2 = it cannot succeed, so retrying only burns spend and
# time (a safety block, a contract violation, a missing key).
EXIT_RETRYABLE = 1
EXIT_PERMANENT = 2


def fail(output_filename, message, retryable=True):
    """Abort with a reason the CALLER can actually read.

    The visual adapter surfaces the subprocess's STDERR on a non-zero exit
    (adapters/visual/veo_imagen.ts) and ignores stdout. A reason print()ed to
    stdout is therefore lost, and the stage fails with an unusable
    "Command failed: python3 …" plus a base64 command dump. Every deliberate
    error path must go through here.

    Pass retryable=False when the call is known to be unrepeatable — the adapter
    then stops instead of spending two more attempts on a certain failure.
    """
    print(f"[{output_filename}] ERROR: {message}", file=sys.stderr)
    sys.exit(EXIT_RETRYABLE if retryable else EXIT_PERMANENT)


def load_env():
    """os.environ first; .env.local then .env fill gaps for local dev only.

    Normally these files are never read: the adapter spawns us from Node, which
    has already loaded .env into the environment we inherit. The fallback only
    matters when a generator is run by hand.
    """
    env = dict(os.environ)
    for filename in (".env.local", ".env"):
        env_path = os.path.join(os.getcwd(), filename)
        if not os.path.exists(env_path):
            continue
        with open(env_path, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env.setdefault(k.strip(), v.strip().strip("\"'"))
    return env


def parse_cli_args():
    """Returns (prompt, negative_prompt, output_filename, model, reference_images).

    Decodes --base64, reads --model, and collects repeated --ref values.
    `model` is None when not supplied; the caller applies its own default.
    """
    if len(sys.argv) < 4:
        print(
            f"Usage: python3 {sys.argv[0]} <prompt> <negative_prompt> <output_filename> "
            f"[--base64] [--model <id>] [--ref <path> ...]",
            file=sys.stderr,
        )
        sys.exit(1)

    prompt, negative_prompt, output_filename = sys.argv[1], sys.argv[2], sys.argv[3]

    rest = sys.argv[4:]
    is_base64 = "--base64" in rest

    model = None
    reference_images = []
    i = 0
    while i < len(rest):
        if rest[i] == "--ref" and i + 1 < len(rest):
            reference_images.append(rest[i + 1])
            i += 2
        elif rest[i] == "--model" and i + 1 < len(rest):
            model = rest[i + 1]
            i += 2
        else:
            i += 1

    if is_base64:
        prompt = base64.b64decode(prompt).decode("utf-8")
        negative_prompt = base64.b64decode(negative_prompt).decode("utf-8")

    return prompt, negative_prompt, output_filename, model, reference_images

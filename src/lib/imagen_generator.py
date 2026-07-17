"""Generic still generator — Imagen.

Follows the CLI contract in src/lib/generators/base.py (imported, not copied).

Imagen CANNOT be conditioned on an image: GenerateImagesConfig exposes no
reference/subject field. Per the contract, this generator therefore REFUSES
--ref rather than ignoring it and inventing a product. Reference-conditioned
stills are routed to nanobanana_generator.py by the adapter.
"""

from google import genai
from google.genai import types

from generators.base import fail, load_env, parse_cli_args

# Only used when --model is absent; the id lives in DB config
# (clients.model_visual_image) per migration 0005.
DEFAULT_MODEL = "imagen-3.0-generate-001"


def generate(prompt, negative_prompt, output_filename, model=None):
    env = load_env()
    api_key = env.get("GEMINI_API_KEY") or env.get("VEO_API_KEY")
    if not api_key:
        fail(output_filename, "GEMINI_API_KEY or VEO_API_KEY is not set.", retryable=False)

    print(f"[{output_filename}] Initializing Gemini Client for Imagen...")
    client = genai.Client(api_key=api_key)

    # The model id is DB config (clients.model_visual_image); this default only
    # applies to a client row predating migration 0005.
    model = model or DEFAULT_MODEL
    print(f"[{output_filename}] Model: {model}")

    print(f"[{output_filename}] Initiating image generation using Imagen...")
    result = client.models.generate_images(
        model=model,
        prompt=prompt,
        config=types.GenerateImagesConfig(
            aspectRatio="9:16",
            numberOfImages=1,
            outputMimeType="image/jpeg",
        ),
    )

    if not result.generated_images:
        fail(output_filename, "Imagen returned no images (the prompt may have been filtered).")

    print(f"[{output_filename}] Image generated successfully. Downloading...")
    image = result.generated_images[0]
    # Depending on the SDK, the bytes are image.image.image_bytes or image.image_bytes.
    image_bytes = None
    if hasattr(image, "image") and hasattr(image.image, "image_bytes"):
        image_bytes = image.image.image_bytes
    elif hasattr(image, "image_bytes"):
        image_bytes = image.image_bytes
    if not image_bytes:
        fail(output_filename, "Could not find image_bytes in the Imagen response object.")

    with open(output_filename, "wb") as f:
        f.write(image_bytes)
    print(f"[{output_filename}] Image saved successfully as: {output_filename}")


if __name__ == "__main__":
    prompt, negative_prompt, output_filename, model, reference_images = parse_cli_args()

    # Per the generator contract: a generator that cannot condition on an image
    # must exit non-zero rather than ignore --ref. Reaching this branch means
    # something bypassed the adapter's routing to nanobanana_generator.py.
    if reference_images:
        fail(
            output_filename,
            "Imagen cannot condition generation on reference images, so it would invent a "
            "product instead of showing the real one. Reference-conditioned stills must go "
            "to nanobanana_generator.py.",
            retryable=False,
        )

    generate(prompt, negative_prompt, output_filename, model)

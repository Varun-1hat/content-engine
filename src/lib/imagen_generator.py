import sys
import os
import base64
from google import genai
from google.genai import types

def load_env():
    env = dict(os.environ)
    env_path = os.path.join(os.getcwd(), ".env.local")
    if os.path.exists(env_path):
        with open(env_path, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    if "=" in line:
                        k, v = line.split("=", 1)
                        env.setdefault(k.strip(), v.strip())
    return env

def generate(prompt, negative_prompt, output_filename):
    env = load_env()
    api_key = env.get("GEMINI_API_KEY") or env.get("VEO_API_KEY")
    if not api_key:
        print(f"[{output_filename}] ERROR: GEMINI_API_KEY or VEO_API_KEY is not set.")
        sys.exit(1)

    print(f"[{output_filename}] Initializing Gemini Client for Imagen...")
    client = genai.Client(api_key=api_key)

    model = "imagen-3.0-generate-001"

    print(f"[{output_filename}] Initiating image generation using Imagen 3...")
    result = client.models.generate_images(
        model=model,
        prompt=prompt,
        config=types.GenerateImagesConfig(
            aspectRatio="9:16",
            numberOfImages=1,
            outputMimeType="image/jpeg",
        ),
    )

    if result.generated_images:
        print(f"[{output_filename}] Image generated successfully. Downloading...")
        image = result.generated_images[0]
        # Depending on the SDK, image.image might be the bytes or image.image.image_bytes
        # In the new SDK, it's usually image.image.image_bytes
        
        image_bytes = None
        if hasattr(image, 'image') and hasattr(image.image, 'image_bytes'):
             image_bytes = image.image.image_bytes
        elif hasattr(image, 'image_bytes'):
             image_bytes = image.image_bytes
        else:
             print(f"[{output_filename}] Could not find image_bytes in the response object.")
             sys.exit(1)
             
        with open(output_filename, "wb") as f:
            f.write(image_bytes)
            
        print(f"[{output_filename}] Image saved successfully as: {output_filename}")
    else:
        print(f"[{output_filename}] Error: No images found in response.")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python imagen_generator.py <prompt> <negative_prompt> <output_filename> [--base64]")
        sys.exit(1)
        
    prompt = sys.argv[1]
    negative_prompt = sys.argv[2]
    output_filename = sys.argv[3]
    
    if len(sys.argv) > 4 and sys.argv[4] == '--base64':
        prompt = base64.b64decode(prompt).decode('utf-8')
        negative_prompt = base64.b64decode(negative_prompt).decode('utf-8')
    
    generate(prompt, negative_prompt, output_filename)

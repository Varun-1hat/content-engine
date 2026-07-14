import sys
import os
import time
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

    print(f"[{output_filename}] Initializing Gemini Client...")
    client = genai.Client(api_key=api_key)

    model = "veo-3.1-fast-generate-preview"

    print(f"[{output_filename}] Initiating video generation using Veo...")
    operation = client.models.generate_videos(
        model=model,
        prompt=prompt,
        config=types.GenerateVideosConfig(
            aspectRatio="9:16",
            negativePrompt=negative_prompt,
        ),
    )

    print(f"[{output_filename}] Operation started: {operation.name}")
    print(f"[{output_filename}] Waiting for video generation to complete (polling every 15s)...")
    
    while not operation.done:
        time.sleep(15)
        operation = client.operations.get(operation)
        print(f"[{output_filename}] Polling status...")

    print(f"[{output_filename}] Video generation completed successfully!")
    response = operation.response
    
    if hasattr(response, 'generated_videos') and response.generated_videos:
        # Save the first video
        gen_vid = response.generated_videos[0]
        video_file = gen_vid.video
        video_bytes = client.files.download(file=video_file)
        
        with open(output_filename, "wb") as f:
            f.write(video_bytes)
        print(f"[{output_filename}] Video saved successfully as: {output_filename}")
    else:
        print(f"[{output_filename}] Error: No videos found in response.")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python veo_generator.py <prompt> <negative_prompt> <output_filename> [--base64]")
        sys.exit(1)
        
    prompt = sys.argv[1]
    negative_prompt = sys.argv[2]
    output_filename = sys.argv[3]
    
    if len(sys.argv) > 4 and sys.argv[4] == '--base64':
        prompt = base64.b64decode(prompt).decode('utf-8')
        negative_prompt = base64.b64decode(negative_prompt).decode('utf-8')
    
    generate(prompt, negative_prompt, output_filename)

# To run this code you need to install the following dependencies:
# pip install google-genai

import os
import time
from google import genai
from google.genai import types


def load_env():
    """Loads environment variables from .env.local file if it exists."""
    env = {}
    if os.path.exists(".env.local"):
        with open(".env.local", "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    if "=" in line:
                        k, v = line.split("=", 1)
                        env[k.strip()] = v.strip()
    return env


def generate():
    env = load_env()
    # We will prioritize GEMINI_API_KEY which has quota for Veo, and fall back to VEO_API_KEY or the hardcoded one
    api_key = env.get("GEMINI_API_KEY") or env.get("VEO_API_KEY") or "AIzaSyCbdilSJ4n5DibG6hczO7GxzeG85y-mCXw"
    
    print(f"Initializing Gemini Client...")
    client = genai.Client(api_key=api_key)

    model = "veo-3.1-fast-generate-preview"
    prompt = (
        "total video duration:8sec Close-up of a 1-month-old Indian baby dressed in a soft cotton onesie lying down, rhythmic jerky movements of the chest showing explicit baby hiccups, parent's hand gently resting beside the infant, warm domestic home setting, gentle handheld movement with a slow push-in, photorealistic documentary footage, natural Indian skin texture, shallow depth of field, 1080x1920, 9:16 vertical. Negative: no text, no captions, no logos, no watermark"
    )
    negative_prompt = "text, watermark, cartoon, 3D, distorted hands, crying baby, dark lighting."

    print("Initiating video generation using Veo...")
    operation = client.models.generate_videos(
        model=model,
        prompt=prompt,
        config=types.GenerateVideosConfig(
            aspectRatio="9:16",
            negativePrompt=negative_prompt,
        ),
    )

    print(f"Operation started: {operation.name}")
    print("Waiting for video generation to complete (polling every 15s)...")
    
    while not operation.done:
        time.sleep(15)
        operation = client.operations.get(operation)
        print("Polling status...")

    print("Video generation completed successfully!")
    response = operation.response
    
    if hasattr(response, 'generated_videos') and response.generated_videos:
        for idx, gen_vid in enumerate(response.generated_videos):
            print(f"Downloading video {idx + 1}...")
            video_file = gen_vid.video
            video_bytes = client.files.download(file=video_file)
            
            output_filename = f"generated_video_{idx + 1}.mp4"
            with open(output_filename, "wb") as f:
                f.write(video_bytes)
            print(f"Video saved successfully as: {output_filename}")
    else:
        print("No videos found in response.")


if __name__ == "__main__":
    generate()

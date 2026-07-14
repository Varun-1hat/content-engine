import urllib.request
import json
import os

api_key = os.environ.get("ELEVENLABS_API_KEY")
voice_id = os.environ.get("ELEVENLABS_VOICE_ID")

if not api_key:
    # Try loading from .env.local
    if os.path.exists(".env.local"):
        with open(".env.local", "r") as f:
            for line in f:
                if line.startswith("ELEVENLABS_API_KEY="):
                    api_key = line.split("=")[1].strip()
                if line.startswith("ELEVENLABS_VOICE_ID="):
                    voice_id = line.split("=")[1].strip()

url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps"
headers = {
    "Accept": "application/json",
    "xi-api-key": api_key,
    "Content-Type": "application/json"
}
data = {
    "text": "Hello world. This is a test of the timestamps API.",
    "model_id": "eleven_multilingual_v2"
}

req = urllib.request.Request(url, headers=headers, data=json.dumps(data).encode("utf-8"))
try:
    with urllib.request.urlopen(req) as response:
        result = json.loads(response.read().decode())
        print("Keys:", result.keys())
        if 'alignment' in result:
            print("Alignment keys:", result['alignment'].keys())
            print("Characters:", result['alignment']['characters'][:10])
except Exception as e:
    print("Error:", e)
    if hasattr(e, 'read'):
        print(e.read().decode())

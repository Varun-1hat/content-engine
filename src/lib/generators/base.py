"""
PYTHON CLIP GENERATOR — base CLI contract

The veo_imagen visual adapter (src/lib/adapters/visual/veo_imagen.ts) invokes
generator scripts as subprocesses. Any new Python generator must follow this
exact CLI contract so the adapter (or a new visual adapter) can call it:

    python3 <script>.py <prompt> <negative_prompt> <output_filename> [--base64]

  - With --base64, <prompt> and <negative_prompt> are base64-encoded UTF-8
    (used to bypass shell-escaping issues; the adapter always passes it).
  - Write the generated media to <output_filename>. The caller checks that
    the file exists — a missing file means failure.
  - Exit 0 on success, non-zero on failure. Print progress to stdout prefixed
    with [<output_filename>] so parallel runs are readable.
  - API keys come from os.environ first (see load_env below); .env.local is a
    local-dev fallback only. Hard-fail with a clear message if unset.
  - Output must be 9:16 (1080x1920) — vertical reels are the product.

Existing implementations: veo_generator.py (video), imagen_generator.py (image).
Import from this module in new generators; the existing two predate it.
"""

import base64
import os
import sys


def load_env():
    """os.environ first; .env.local fills gaps for local dev only."""
    env = dict(os.environ)
    env_path = os.path.join(os.getcwd(), ".env.local")
    if os.path.exists(env_path):
        with open(env_path, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env.setdefault(k.strip(), v.strip())
    return env


def parse_cli_args():
    """Returns (prompt, negative_prompt, output_filename), decoding --base64."""
    if len(sys.argv) < 4:
        print(f"Usage: python3 {sys.argv[0]} <prompt> <negative_prompt> <output_filename> [--base64]")
        sys.exit(1)

    prompt, negative_prompt, output_filename = sys.argv[1], sys.argv[2], sys.argv[3]

    if len(sys.argv) > 4 and sys.argv[4] == "--base64":
        prompt = base64.b64decode(prompt).decode("utf-8")
        negative_prompt = base64.b64decode(negative_prompt).decode("utf-8")

    return prompt, negative_prompt, output_filename

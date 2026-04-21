#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PATTERN='(AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|SPOTIFY_CLIENT_SECRET\s*=|GEMINI_API_KEY\s*=|EXPO_PUBLIC_.*(SECRET|API_KEY)\s*=)'

echo "[security] scanning repository for likely secrets..."
if rg -n --hidden \
  --glob '!.git' \
  --glob '!node_modules' \
  --glob '!.expo' \
  --glob '!dist' \
  "$PATTERN" .; then
  echo "[security] potential secret exposure detected."
  exit 1
fi

echo "[security] no high-risk secret patterns found."

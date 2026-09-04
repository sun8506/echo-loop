#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
backend_dir="$project_dir/backend"
target_triple="${1:-x86_64-unknown-linux-gnu}"
output_dir="$project_dir/src-tauri/binaries"

mkdir -p "$output_dir"
cd "$backend_dir"
.venv/bin/pyinstaller --noconfirm --clean --onefile \
  --name echo-loop-backend \
  --paths . \
  --collect-all faster_whisper \
  --collect-all ctranslate2 \
  --collect-all av \
  desktop_server.py
cp "dist/echo-loop-backend" "$output_dir/echo-loop-backend-$target_triple"
chmod +x "$output_dir/echo-loop-backend-$target_triple"
echo "Created $output_dir/echo-loop-backend-$target_triple"

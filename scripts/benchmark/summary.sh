#!/usr/bin/env bash
set -euo pipefail
FILE="${1:-/Volumes/data/workspace/discord/docs/projects/feishu-chrome-scroll-ocr-v3/artifacts/feishu-extract-final-v2.txt}"
if [[ ! -f "$FILE" ]]; then
  echo "missing:$FILE"; exit 1
fi
echo "file=$FILE"
echo "lines=$(wc -l < "$FILE" | tr -d ' ')"
echo "chars=$(wc -m < "$FILE" | tr -d ' ')"
echo "head=$(head -n 1 "$FILE")"
echo "tail=$(tail -n 1 "$FILE")"

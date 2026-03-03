#!/usr/bin/env bash
set -euo pipefail
[[ -f manifest.json ]]
[[ -f src/content.js ]]
[[ -f src/background.js ]]
echo "lint placeholder passed"

#!/usr/bin/env bash
set -euo pipefail
node --check src/content.js
node --check src/background.js
echo "test placeholder passed"

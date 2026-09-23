#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/cloudflare-push"
npm ci --no-audit --no-fund
node setup.mjs

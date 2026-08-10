#!/usr/bin/env bash
# Update/redeploy an existing monpassC deployment: install deps (if changed),
# apply any new D1 migrations, then deploy. Run after `git pull`.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

WRANGLER="npx wrangler"

[ -f wrangler.jsonc ] || {
  echo "wrangler.jsonc not found. Run 'bash scripts/setup.sh' first." >&2
  exit 1
}

DB_NAME=$(node scripts/db-name.mjs)

echo "Installing dependencies..."
npm install

echo "Applying migrations (remote)..."
$WRANGLER d1 migrations apply "$DB_NAME" --remote

echo "Deploying..."
$WRANGLER deploy

echo
echo "== Done =="

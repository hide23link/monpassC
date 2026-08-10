#!/usr/bin/env bash
# First-time bootstrap for a new deployment of monpassC: creates the D1
# database, generates wrangler.jsonc from wrangler.jsonc.template, sets
# secrets, seeds the first admin account, and deploys. Meant to be run once
# by an experienced operator. For subsequent updates use scripts/deploy.sh.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

WRANGLER="npx wrangler"

command -v node >/dev/null || { echo "node is required." >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required." >&2; exit 1; }

echo "== monpassC setup =="
echo

if [ -f wrangler.jsonc ]; then
  read -r -p "wrangler.jsonc already exists. Overwrite and re-run setup? [y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

echo "Installing dependencies..."
npm install

if ! $WRANGLER whoami >/dev/null 2>&1; then
  echo "Not logged in to Cloudflare. Launching 'wrangler login'..."
  $WRANGLER login
fi

read -r -p "Worker name [monpassc]: " WORKER_NAME
WORKER_NAME=${WORKER_NAME:-monpassc}

read -r -p "Use a custom domain (already added as a Cloudflare zone)? [y/N] " USE_DOMAIN
CUSTOM_DOMAIN=""
if [[ "$USE_DOMAIN" =~ ^[Yy]$ ]]; then
  read -r -p "Custom domain (e.g. monpass.example.com): " CUSTOM_DOMAIN
  [ -n "$CUSTOM_DOMAIN" ] || { echo "Domain cannot be empty." >&2; exit 1; }
fi

read -r -p "D1 database name [monpass-db]: " DB_NAME
DB_NAME=${DB_NAME:-monpass-db}

read -r -p "Max tickets per student [5]: " MAX_TICKETS
MAX_TICKETS=${MAX_TICKETS:-5}

read -r -p "Initial admin ID [admin]: " ADMIN_ID
ADMIN_ID=${ADMIN_ID:-admin}

echo
echo "Creating D1 database '$DB_NAME'..."
CREATE_OUTPUT=$($WRANGLER d1 create "$DB_NAME" 2>&1) || {
  if echo "$CREATE_OUTPUT" | grep -qi "already exists"; then
    echo "Database '$DB_NAME' already exists, looking up its id..."
    CREATE_OUTPUT=""
  else
    echo "$CREATE_OUTPUT" >&2
    exit 1
  fi
}
echo "$CREATE_OUTPUT"

DB_ID=$(echo "$CREATE_OUTPUT" | grep -oE 'database_id["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][0-9a-f-]{36}' | grep -oE '[0-9a-f-]{36}' | head -1 || true)
if [ -z "$DB_ID" ]; then
  DB_ID=$($WRANGLER d1 list --json | node -e "
    const parsed = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    const dbs = Array.isArray(parsed) ? parsed : parsed.result;
    const match = (dbs || []).find((d) => d.name === process.argv[1]);
    if (!match) process.exit(1);
    console.log(match.uuid || match.database_id);
  " "$DB_NAME")
fi
[ -n "$DB_ID" ] || { echo "Could not determine database_id for '$DB_NAME'." >&2; exit 1; }
echo "database_id: $DB_ID"

echo
echo "Generating wrangler.jsonc..."
if [ -n "$CUSTOM_DOMAIN" ]; then
  ROUTES_BLOCK="  \"routes\": [
    { \"pattern\": \"$CUSTOM_DOMAIN\", \"custom_domain\": true }
  ],
"
  DOMAIN_VALUE="$CUSTOM_DOMAIN"
else
  ROUTES_BLOCK=""
  DOMAIN_VALUE="REPLACE_AFTER_FIRST_DEPLOY"
fi

node scripts/render-wrangler-config.mjs "$WORKER_NAME" "$DB_NAME" "$DB_ID" "$MAX_TICKETS" "$DOMAIN_VALUE" "$ROUTES_BLOCK"

echo "Applying migrations (local)..."
$WRANGLER d1 migrations apply "$DB_NAME" --local

echo "Applying migrations (remote)..."
$WRANGLER d1 migrations apply "$DB_NAME" --remote

echo
echo "Setting JWT_SECRET..."
openssl rand -hex 32 | $WRANGLER secret put JWT_SECRET

echo
echo "Seeding initial admin account on the remote database..."
node scripts/create-admin.mjs "$DB_NAME" "$ADMIN_ID"

echo
echo "Deploying..."
DEPLOY_OUTPUT=$($WRANGLER deploy 2>&1 | tee /dev/stderr)

if [ -z "$CUSTOM_DOMAIN" ]; then
  WORKERS_DEV_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1 || true)
  if [ -n "$WORKERS_DEV_URL" ]; then
    WORKERS_DEV_HOST=${WORKERS_DEV_URL#https://}
    sed -i.bak "s#REPLACE_AFTER_FIRST_DEPLOY#${WORKERS_DEV_HOST}#" wrangler.jsonc
    rm -f wrangler.jsonc.bak
    echo "Detected workers.dev URL, updating DOMAIN var and redeploying..."
    $WRANGLER deploy
  else
    echo "Could not auto-detect the workers.dev URL. Edit the DOMAIN var in wrangler.jsonc manually, then run: npx wrangler deploy" >&2
  fi
fi

echo
echo "== Done =="
if [ -n "$CUSTOM_DOMAIN" ]; then
  echo "App: https://$CUSTOM_DOMAIN"
  echo "To protect /admin/* with Cloudflare Access, run: bash scripts/setup-access.sh"
else
  echo "App: https://${WORKERS_DEV_HOST:-<see deploy output above>}"
fi
echo "Admin login: $ADMIN_ID (password as entered above)"
echo "For future updates: git pull && bash scripts/deploy.sh"

#!/usr/bin/env bash
# Optional: protects /admin/* with Cloudflare Access (email one-time-PIN)
# via the Cloudflare API. Only useful if you deployed with a custom domain
# (scripts/setup.sh). Requires:
#   CF_API_TOKEN  - a token with "Account / Access: Apps and Policies / Edit"
#   CF_ACCOUNT_ID - your Cloudflare account id (Dashboard -> Workers & Pages
#                   -> Overview, right sidebar)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

[ -n "${CF_API_TOKEN:-}" ] || { echo "CF_API_TOKEN is not set." >&2; exit 1; }
[ -n "${CF_ACCOUNT_ID:-}" ] || { echo "CF_ACCOUNT_ID is not set." >&2; exit 1; }
[ -f wrangler.jsonc ] || { echo "wrangler.jsonc not found. Run scripts/setup.sh first." >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required." >&2; exit 1; }

DOMAIN=$(node -e "
  const fs = require('fs');
  const raw = fs.readFileSync('wrangler.jsonc', 'utf8').replace(/\/\/.*\$/gm, '');
  const config = JSON.parse(raw);
  const route = (config.routes || [])[0];
  console.log(route ? route.pattern : config.vars.DOMAIN);
")
[ -n "$DOMAIN" ] && [ "$DOMAIN" != "REPLACE_AFTER_FIRST_DEPLOY" ] || {
  echo "No custom domain configured in wrangler.jsonc — Access requires a custom domain (workers.dev is not supported here)." >&2
  exit 1
}

read -r -p "Admin email address(es) to allow, comma-separated: " EMAILS_RAW
[ -n "$EMAILS_RAW" ] || { echo "At least one email is required." >&2; exit 1; }

INCLUDE_JSON=$(node -e "
  const emails = process.argv[1].split(',').map((e) => e.trim()).filter(Boolean);
  console.log(JSON.stringify(emails.map((email) => ({ email: { email } }))));
" "$EMAILS_RAW")

API="https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps"

echo "Creating Access Application for ${DOMAIN}/admin..."
APP_RESPONSE=$(curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$(node -e "
    console.log(JSON.stringify({
      name: 'MONpass Admin API',
      domain: process.argv[1] + '/admin',
      type: 'self_hosted',
      session_duration: '24h',
    }));
  " "$DOMAIN")")

APP_SUCCESS=$(echo "$APP_RESPONSE" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).success)")
if [ "$APP_SUCCESS" != "true" ]; then
  echo "Failed to create Access Application:" >&2
  echo "$APP_RESPONSE" >&2
  exit 1
fi
APP_ID=$(echo "$APP_RESPONSE" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).result.id)")
echo "Application created: $APP_ID"

echo "Creating Allow policy for: $EMAILS_RAW"
POLICY_RESPONSE=$(curl -sS -X POST "${API}/${APP_ID}/policies" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$(node -e "
    console.log(JSON.stringify({
      name: 'Admins',
      decision: 'allow',
      include: JSON.parse(process.argv[1]),
    }));
  " "$INCLUDE_JSON")")

POLICY_SUCCESS=$(echo "$POLICY_RESPONSE" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).success)")
if [ "$POLICY_SUCCESS" != "true" ]; then
  echo "Failed to create policy:" >&2
  echo "$POLICY_RESPONSE" >&2
  exit 1
fi

echo
echo "== Done =="
echo "https://${DOMAIN}/admin/* is now behind Cloudflare Access (one-time PIN email login)."
echo "Note: the SPA shell itself (index.html) is not protected — only the /admin/* API routes are (see README's 'Cloudflareインフラ構成' section for the hash-router caveat)."

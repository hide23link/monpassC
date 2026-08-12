#!/usr/bin/env bash
# 既存のmonpassCデプロイを更新する: 依存関係のインストール(変更があれば)、
# 未適用のD1マイグレーション適用、デプロイ、の順に実行する。
# `git pull`した後に実行する想定。
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

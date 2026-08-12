#!/usr/bin/env node
// wrangler.jsonc.template を実際の値で置き換えて wrangler.jsonc を生成する。
// scripts/setup.sh から呼ばれる(通常はこのスクリプトを直接実行しない)。
import { readFileSync, writeFileSync } from "node:fs";

const [workerName, dbName, dbId, maxTickets, domainValue, routesBlock] = process.argv.slice(2);
if (!workerName || !dbName || !dbId || !maxTickets || domainValue === undefined) {
  console.error(
    "Usage: node scripts/render-wrangler-config.mjs <worker-name> <db-name> <db-id> <max-tickets> <domain-value> [routes-block]",
  );
  process.exit(1);
}

let content = readFileSync("wrangler.jsonc.template", "utf8");
content = content
  .replaceAll("__WORKER_NAME__", workerName)
  .replaceAll("__DB_NAME__", dbName)
  .replaceAll("__DB_ID__", dbId)
  .replaceAll("__MAX_TICKETS__", String(maxTickets))
  .replaceAll("__DOMAIN_VALUE__", domainValue)
  .replace(/__ROUTES_BLOCK__\r?\n/, routesBlock ?? "");

writeFileSync("wrangler.jsonc", content, "utf8");

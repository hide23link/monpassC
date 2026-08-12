#!/usr/bin/env node
// wrangler.jsoncに設定されているD1データベース名を標準出力に表示する。
// package.jsonのnpm scripts(db:migrate:local等)が、特定のデプロイの
// データベース名にハードコードされないよう、この出力を経由して参照している。
import { readFileSync } from "node:fs";

const raw = readFileSync("wrangler.jsonc", "utf8").replace(/\/\/.*$/gm, "");
const config = JSON.parse(raw);
console.log(config.d1_databases[0].database_name);

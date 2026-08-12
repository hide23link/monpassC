#!/usr/bin/env node
// public/index.html・public/manifest.webmanifest内の既定タイトル(「学園祭入場システム（仮）」)を
// 指定したタイトルに置き換える。scripts/setup.shから呼ばれる。既定タイトルのままにする場合は
// 置換対象が見つからず何も変わらないだけなので、毎回無条件に呼び出しても安全。
import { readFileSync, writeFileSync } from "node:fs";

const title = process.argv[2];
if (!title) {
  console.error("Usage: node scripts/set-app-title.mjs <title>");
  process.exit(1);
}

const DEFAULT_TITLE = "学園祭入場システム（仮）";
const DEFAULT_MANIFEST_NAME = "学園祭入場システム";

let html = readFileSync("public/index.html", "utf8");
html = html
  .replaceAll(`<title>${DEFAULT_TITLE}</title>`, `<title>${title}</title>`)
  .replaceAll(`🎪 ${DEFAULT_TITLE}`, `🎪 ${title}`);
writeFileSync("public/index.html", html, "utf8");

let manifest = readFileSync("public/manifest.webmanifest", "utf8");
manifest = manifest.replace(`"name": "${DEFAULT_MANIFEST_NAME}"`, `"name": "${title}"`);
writeFileSync("public/manifest.webmanifest", manifest, "utf8");

console.log(`アプリのタイトルを「${title}」に設定しました。`);

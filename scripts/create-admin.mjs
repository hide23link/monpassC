#!/usr/bin/env node
// role='admin'のstaff行をD1に直接作成(またはパスワードをリセット)する。
// アプリ通常の/admin/staff APIは「すでに管理者が1人いる」ことを前提にしている
// ため、その最初の1人だけはこのスクリプトでD1に直接シードするしかない。
// パスワードのハッシュ化はsrc/routes/auth.ts / admin.tsと同じbcryptjsの
// コストファクタ(10)を使っており、ログイン時に同じロジックで検証できる。

import bcrypt from "bcryptjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";

function usageAndExit() {
  console.error("Usage: node scripts/create-admin.mjs <db-name> <admin-id> [--local]");
  process.exit(1);
}

// 注意: 入力したパスワードはマスクされずそのままターミナルに表示される。
// 人に画面を見られない場所で実行すること。
function readPassword(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function sqlEscape(value) {
  return value.replace(/'/g, "''");
}

async function main() {
  const args = process.argv.slice(2);
  const local = args.includes("--local");
  const positional = args.filter((a) => a !== "--local");
  const [dbName, adminId] = positional;
  if (!dbName || !adminId) usageAndExit();
  if (!/^[A-Za-z0-9_-]+$/.test(adminId)) {
    console.error("admin-id may only contain letters, digits, underscore, hyphen.");
    process.exit(1);
  }

  const password = await readPassword(`Password for admin '${adminId}': `);
  if (password.length < 4) {
    console.error("Password must be at least 4 characters.");
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const name = sqlEscape(adminId);
  const idEsc = sqlEscape(adminId);
  const sql = `INSERT INTO staff (id, name, password_hash, role) VALUES ('${idEsc}', '${name}', '${hash}', 'admin')
ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, role = 'admin';`;

  const dir = mkdtempSync(join(tmpdir(), "monpassc-admin-"));
  const file = join(dir, "create-admin.sql");
  writeFileSync(file, sql, "utf8");

  try {
    const flag = local ? "--local" : "--remote";
    execFileSync("npx", ["wrangler", "d1", "execute", dbName, flag, "--file", file], {
      stdio: "inherit",
    });
    console.log(`\nAdmin '${adminId}' created/updated on ${local ? "local" : "remote"} DB '${dbName}'.`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

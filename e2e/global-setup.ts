import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import bcrypt from "bcryptjs";
import { ADMIN_ID, ADMIN_PASSWORD } from "./helpers";

// Seeds a known, idempotent e2e admin account into the local D1 database
// (via `wrangler d1 execute --local`, the same store `wrangler dev` reads),
// mirroring how tests/e2e/conftest.py's TestServer seeds ADMIN_ID/ADMIN_PASSWORD
// at app startup — we no longer have that auto-seed-on-boot behavior (see
// PLAN.md), so tests seed explicitly instead.
export default async function globalSetup() {
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const sql = `INSERT OR IGNORE INTO staff (id, name, password_hash, role) VALUES ('${ADMIN_ID}', 'E2E管理者', '${hash}', 'admin');`;
  const tmpFile = `/tmp/monpass-e2e-seed-${Date.now()}.sql`;
  writeFileSync(tmpFile, sql);
  try {
    execFileSync(
      "npx",
      ["wrangler", "d1", "execute", "monpass-db", "--local", `--file=${tmpFile}`],
      { cwd: process.cwd(), stdio: "pipe" },
    );
  } finally {
    unlinkSync(tmpFile);
  }
}

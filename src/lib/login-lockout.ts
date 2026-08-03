import type { Config } from "./config";

// Ports main.py's check_and_lock / record_failure / reset_failures against
// the login_failures table. No concurrency-sensitivity here (unlike
// /ticket/scan) — ordinary read-then-write is fine per PLAN.md section 3.

type LoginFailureRow = { failure_count: number; locked_at: number | null };

export async function checkAndLock(
  db: D1Database,
  userKey: string,
  config: Config,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT failure_count, locked_at FROM login_failures WHERE user_key = ?")
    .bind(userKey)
    .first<LoginFailureRow>();

  if (row === null) return false;

  const { locked_at: lockedAt } = row;
  if (lockedAt !== null) {
    const elapsed = Date.now() / 1000 - lockedAt;
    if (elapsed < config.loginLockoutMinutes * 60) {
      return true;
    }
    await db
      .prepare("UPDATE login_failures SET failure_count = 0, locked_at = NULL WHERE user_key = ?")
      .bind(userKey)
      .run();
    return false;
  }

  return false;
}

export async function recordFailure(
  db: D1Database,
  userKey: string,
  config: Config,
): Promise<void> {
  const row = await db
    .prepare("SELECT failure_count FROM login_failures WHERE user_key = ?")
    .bind(userKey)
    .first<{ failure_count: number }>();

  let newCount: number;
  if (row === null) {
    await db
      .prepare("INSERT INTO login_failures (user_key, failure_count, locked_at) VALUES (?, 1, NULL)")
      .bind(userKey)
      .run();
    newCount = 1;
  } else {
    newCount = row.failure_count + 1;
    await db
      .prepare("UPDATE login_failures SET failure_count = ? WHERE user_key = ?")
      .bind(newCount, userKey)
      .run();
  }

  if (newCount >= config.loginMaxFailures) {
    await db
      .prepare("UPDATE login_failures SET locked_at = ? WHERE user_key = ?")
      .bind(Date.now() / 1000, userKey)
      .run();
  }
}

export async function resetFailures(db: D1Database, userKey: string): Promise<void> {
  await db.prepare("DELETE FROM login_failures WHERE user_key = ?").bind(userKey).run();
}

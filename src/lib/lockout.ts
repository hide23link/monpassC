// ログイン失敗によるアカウントロック。同じアカウントで連続して
// MAX_FAILURES回失敗すると、LOCKOUT_MINUTES分ログインを受け付けない
// (旧Python版のcheck_and_lock / record_failure / reset_failuresを移植)。
// 学籍番号は連番で推測しやすく、パスワードの強さも名簿CSV次第なので、
// 総当たりでなりすまされないようにするための仕組み。
// 存在しないIDでも同じように数える(IDが存在するかどうかを応答の違いから
// 推測されないようにするため)。

export const MAX_FAILURES = 10;
export const LOCKOUT_MINUTES = 30;

type Row = { failure_count: number; locked_until: number | null };

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// ロック中なら残り秒数、ロックしていなければ0を返す。
// ロック期間が過ぎていれば記録を消して、失敗回数を0からやり直す。
export async function lockedSeconds(db: D1Database, userKey: string): Promise<number> {
  const row = await db
    .prepare("SELECT failure_count, locked_until FROM login_failures WHERE user_key = ?")
    .bind(userKey)
    .first<Row>();
  if (row === null || row.locked_until === null) return 0;
  const remaining = row.locked_until - nowSec();
  if (remaining > 0) return remaining;
  await resetFailures(db, userKey);
  return 0;
}

// 失敗を1回数え、MAX_FAILURES回に達したらロックする。
// 回数の加算は1文のUPSERTで行うので、同時に失敗が届いても数え漏れない。
export async function recordFailure(db: D1Database, userKey: string): Promise<void> {
  const lockUntil = nowSec() + LOCKOUT_MINUTES * 60;
  await db
    .prepare(
      `INSERT INTO login_failures (user_key, failure_count, locked_until) VALUES (?, 1, NULL)
       ON CONFLICT(user_key) DO UPDATE SET
         failure_count = failure_count + 1,
         locked_until = CASE WHEN failure_count + 1 >= ? THEN ? ELSE locked_until END`,
    )
    .bind(userKey, MAX_FAILURES, lockUntil)
    .run();
}

export async function resetFailures(db: D1Database, userKey: string): Promise<void> {
  await db.prepare("DELETE FROM login_failures WHERE user_key = ?").bind(userKey).run();
}

export function lockedMessage(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `ログインの失敗が続いたため、一時的にロックしています。約${minutes}分後にもう一度お試しください`;
}

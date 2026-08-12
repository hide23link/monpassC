// 英数字のランダムパスワードを生成する。管理者が生徒のパスワードをリセットする際、
// 具体的な値を指定しなかった場合の自動生成に使う(POST /admin/students/:id/reset-password)。
// 旧Python版の "".join(secrets.choice(chars) for _ in range(8)) 相当の実装。
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generateAlnumPassword(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALNUM[b % ALNUM.length];
  return out;
}

// Pythonのsecrets.token_urlsafe(nbytes)を移植: nbytesバイトのランダム値を
// base64url形式(パディングなし)でエンコードする。チケットID・スタッフの
// パスワードリセットトークンなど、外部に露出しても推測されては困るIDに使う。
export function tokenUrlsafe(nbytes: number): string {
  const bytes = new Uint8Array(nbytes);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

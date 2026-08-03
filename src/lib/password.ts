// Ports Python's "".join(secrets.choice(chars) for _ in range(8)) with
// chars = string.ascii_letters + string.digits (main.py:1057-1058, 1132-1133).
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generateAlnumPassword(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALNUM[b % ALNUM.length];
  return out;
}

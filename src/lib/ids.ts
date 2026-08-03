// Ports Python's secrets.token_urlsafe(nbytes): nbytes random bytes,
// base64url-encoded without padding.
export function tokenUrlsafe(nbytes: number): string {
  const bytes = new Uint8Array(nbytes);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

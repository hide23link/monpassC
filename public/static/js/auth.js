/**
 * auth.js – JWT管理・ロール判定・ログアウト
 *
 * 重要: ここでのJWTデコード(parsePayload)は署名検証をしない`atob()`による
 * 単純なデコードで、UI表示の出し分け(「管理者ならこのタブを見せる」等)専用。
 * 本当のセキュリティ上の認可判定はすべてサーバー側(src/middleware/auth.ts)で
 * 行っており、フロント側のこのチェックを迂回されても実データにはアクセスできない。
 * トークン自体はlocalStorageに平文保存している(XSS対策としてはCSPやエスケープ
 * (src/lib/html.ts)で対処する方針で、httpOnly Cookie化はしていない)。
 */

const Auth = (() => {
  function getToken() { return localStorage.getItem('token'); }
  function setToken(t) { localStorage.setItem('token', t); }
  function removeToken() { localStorage.removeItem('token'); localStorage.removeItem('user'); }

  function parsePayload(token) {
    try {
      const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(b64));
    } catch (_) { return null; }
  }

  function getPayload() {
    const t = getToken();
    return t ? parsePayload(t) : null;
  }

  function isValid() {
    const p = getPayload();
    if (!p) return false;
    return p.exp > Math.floor(Date.now() / 1000);
  }

  function getRole() {
    const p = getPayload();
    return p ? p.role : null;
  }

  function getUserId() {
    const p = getPayload();
    return p ? p.sub : null;
  }

  function logout() {
    removeToken();
    window.location.hash = '#/login';
  }

  return { getToken, setToken, removeToken, getPayload, isValid, getRole, getUserId, logout };
})();

// ログアウトボタン（グローバル関数として公開）
function logout() { Auth.logout(); }

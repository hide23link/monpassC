/**
 * auth.js – JWT管理・ロール判定・ログアウト
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

  function isPromoted() {
    const p = getPayload();
    return p ? (p.promoted === true || p.is_promoted === true) : false;
  }

  function canAccessStaff() {
    const role = getRole();
    return role === 'staff' || role === 'admin' || (role === 'student' && isPromoted());
  }

  function getUserId() {
    const p = getPayload();
    return p ? p.sub : null;
  }

  function logout() {
    removeToken();
    window.location.hash = '#/login';
  }

  return { getToken, setToken, removeToken, getPayload, isValid, getRole, isPromoted, canAccessStaff, getUserId, logout };
})();

// ログアウトボタン（グローバル関数として公開）
function logout() { Auth.logout(); }

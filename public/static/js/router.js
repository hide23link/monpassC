/**
 * router.js – ハッシュベースルーティング
 */

const Router = (() => {
  const routes = {};

  function register(hash, handler, roles) {
    routes[hash] = { handler, roles };
  }

  function navigate(hash) {
    window.location.hash = hash;
  }

  function currentHash() {
    return window.location.hash || '#/login';
  }

  function dispatch() {
    const hash = currentHash().split('?')[0];

    // 完全一致 or プレフィックス一致
    let route = routes[hash];
    if (!route) {
      // プレフィックス検索（例: #/admin/tickets → #/admin/tickets）
      route = routes[hash];
    }

    if (!route) {
      // 未定義ルート → ログインへ
      navigate('#/login');
      return;
    }

    // 認証チェック
    if (route.roles && route.roles.length > 0) {
      if (!Auth.isValid()) {
        const isAdminRoute = hash.startsWith('#/admin') || hash === '#/staff';
        navigate(isAdminRoute ? '#/staff-login' : '#/login');
        return;
      }
      const role = Auth.getRole();
      const ok = route.roles.some(r => {
        if (r === 'staff_or_admin') return role === 'staff' || role === 'admin';
        return r === role;
      });
      if (!ok) {
        // ロール不一致 → それぞれのホームへ
        redirectByRole();
        return;
      }
    }

    updateNav();
    renderContent(route.handler);
  }

  function redirectByRole() {
    if (!Auth.isValid()) { navigate('#/login'); return; }
    const role = Auth.getRole();
    if (role === 'admin') navigate('#/admin');
    else if (role === 'staff') navigate('#/staff');
    else navigate('#/qr');
  }

  async function renderContent(handler) {
    const app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = '<div class="flex justify-center py-20"><div class="animate-spin h-10 w-10 rounded-full border-4 border-sky-500 border-t-transparent"></div></div>';
    try {
      await handler();
    } catch (e) {
      app.innerHTML = `<div class="text-red-600 p-4">エラー: ${e.message}</div>`;
    }
  }

  function updateNav() {
    const nav = document.getElementById('nav-user');
    const logoutBtn = document.getElementById('logout-btn');
    if (!nav || !logoutBtn) return;

    if (Auth.isValid()) {
      const p = Auth.getPayload();
      nav.textContent = p.name || p.sub || '';
      nav.classList.remove('hidden');
      logoutBtn.classList.remove('hidden');
    } else {
      nav.classList.add('hidden');
      logoutBtn.classList.add('hidden');
    }
  }

  function init() {
    window.addEventListener('hashchange', dispatch);
    // ハッシュなしでアクセスした場合はデフォルトに遷移
    if (!window.location.hash || window.location.hash === '#') {
      navigate(Auth.isValid() ? getDefaultHash() : '#/login');
    } else {
      dispatch();
    }
  }

  function getDefaultHash() {
    const role = Auth.getRole();
    if (role === 'admin') return '#/admin';
    if (role === 'staff') return '#/staff';
    return '#/qr';
  }

  return { register, navigate, dispatch, redirectByRole, init };
})();

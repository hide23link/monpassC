/**
 * router.js – ハッシュベースルーティング
 *
 * サーバー側にルーティングは無く(index.html以外の全パスはこのWorkerの
 * catch-allでindex.htmlにフォールバックする、src/index.ts参照)、画面遷移は
 * すべてブラウザの`location.hash`をこのモジュールが監視して行う、いわゆる
 * SPAのハッシュルーター。index.html末尾で`Router.register(hash, handler, roles)`
 * を使って各ページを登録し、rolesで「このハッシュにアクセスできるロール」を
 * 指定する(空配列/未指定なら誰でもアクセス可)。
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
    // クエリ文字列(#/foo?bar=1のような形)は現状使っていないが、念のため
    // 完全一致検索の前に切り落としておく。
    const hash = currentHash().split('?')[0];
    const route = routes[hash];

    if (!route) {
      // 登録されていないハッシュ(存在しないページ) → ログインへ
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

  // 「このロールではこのページに入れない」となった場合の行き先振り分け。
  // ログイン画面自体もrolesチェックの対象外(空配列)なので無限リダイレクトには
  // ならない。
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

  // アプリ起動時に一度だけ呼ぶ(index.html末尾)。以降はhashchangeイベントで
  // dispatch()が自動的に呼ばれる。
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

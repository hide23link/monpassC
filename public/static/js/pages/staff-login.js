async function pageStaffLogin() {
  if (Auth.isValid()) { Router.redirectByRole(); return; }

  document.getElementById('app').innerHTML = `
    <div class="flex items-center justify-center min-h-[70vh]">
      <div class="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">
        <h1 class="text-2xl font-bold text-center text-sky-600 mb-6">スタッフ・管理者ログイン</h1>
        <form id="staff-login-form" novalidate>
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1">スタッフID</label>
            <input id="staff-id" type="text" autocomplete="username"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
              placeholder="例: staff01">
          </div>
          <div class="mb-6">
            <label class="block text-sm font-medium text-gray-700 mb-1">パスワード</label>
            <div class="relative">
              <input id="password" type="password" autocomplete="current-password"
                class="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-sky-400">
              <button type="button" onclick="togglePw('password','pw-eye')"
                class="absolute inset-y-0 right-0 px-3 text-gray-400 hover:text-gray-600">
                <span id="pw-eye">👁</span>
              </button>
            </div>
          </div>
          <div id="error-msg" class="hidden text-red-600 text-sm mb-4 p-3 bg-red-50 rounded-lg"></div>
          <button id="submit-btn" type="submit"
            class="w-full bg-sky-500 hover:bg-sky-600 text-white font-bold py-2 rounded-lg transition disabled:opacity-50">
            ログイン
          </button>
        </form>
        <p class="text-center text-sm text-gray-500 mt-4">
          生徒の方は
          <a href="#/login" class="text-sky-600 hover:underline">こちら</a>
        </p>
      </div>
    </div>`;

  const form = document.getElementById('staff-login-form');
  const errEl = document.getElementById('error-msg');
  const btn = document.getElementById('submit-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const staffId = document.getElementById('staff-id').value.trim();
    const password = document.getElementById('password').value;

    if (!staffId || !password) {
      errEl.textContent = 'IDとパスワードを入力してください';
      errEl.classList.remove('hidden');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'ログイン中...';
    errEl.classList.add('hidden');

    try {
      const data = await API.post('/auth/staff/login', { staff_id: staffId, password });
      Auth.setToken(data.token);
      const role = Auth.getRole();
      Router.navigate(role === 'admin' ? '#/admin' : '#/staff');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'ログイン';
    }
  });
}

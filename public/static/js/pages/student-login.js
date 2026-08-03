async function pageStudentLogin() {
  if (Auth.isValid()) { Router.redirectByRole(); return; }

  document.getElementById('app').innerHTML = `
    <div class="flex items-center justify-center min-h-[70vh]">
      <div class="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">
        <h1 class="text-2xl font-bold text-center text-sky-600 mb-6">生徒ログイン</h1>
        <form id="login-form" novalidate>
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1">学籍番号</label>
            <input id="student-id" type="text" autocomplete="username"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
              placeholder="例: 1001">
          </div>
          <div class="mb-6">
            <label class="block text-sm font-medium text-gray-700 mb-1">パスワード</label>
            <div class="relative">
              <input id="password" type="password" autocomplete="current-password"
                class="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-sky-400"
                placeholder="配布パスワードを入力">
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
          スタッフ・管理者の方は
          <a href="#/staff-login" class="text-sky-600 hover:underline">こちら</a>
        </p>
      </div>
    </div>`;

  const form = document.getElementById('login-form');
  const errEl = document.getElementById('error-msg');
  const btn = document.getElementById('submit-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const studentId = document.getElementById('student-id').value.trim();
    const password = document.getElementById('password').value;

    // バリデーション
    if (!studentId || !password) {
      errEl.textContent = '学籍番号とパスワードを入力してください';
      errEl.classList.remove('hidden');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'ログイン中...';
    errEl.classList.add('hidden');

    try {
      const data = await API.post('/auth/login', { student_id: studentId, password });
      Auth.setToken(data.token);
      Router.navigate('#/qr');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'ログイン';
    }
  });
}

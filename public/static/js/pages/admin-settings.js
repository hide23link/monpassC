async function pageAdminSettings() {
  renderAdminLayout('settings', `
    <div class="max-w-md mx-auto bg-white rounded-xl shadow p-6">
      <h2 class="text-lg font-bold text-sky-600 mb-4">QR発行期間設定</h2>
      <div class="mb-4">
        <label class="block text-sm font-medium text-gray-700 mb-1">発行開始日</label>
        <input id="issue-start" type="date"
          class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-sky-400 focus:outline-none">
      </div>
      <div class="mb-6">
        <label class="block text-sm font-medium text-gray-700 mb-1">発行終了日</label>
        <input id="issue-end" type="date"
          class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-sky-400 focus:outline-none">
      </div>
      <div id="settings-error" class="hidden text-red-600 text-sm mb-3 p-2 bg-red-50 rounded-lg"></div>
      <button onclick="saveSettings()"
        class="w-full bg-sky-500 hover:bg-sky-600 text-white font-bold py-2 rounded-lg transition">
        保存
      </button>
    </div>`);

  try {
    const data = await API.get('/admin/settings');
    const startEl = document.getElementById('issue-start');
    const endEl   = document.getElementById('issue-end');
    if (startEl) startEl.value = data.issue_start || '';
    if (endEl)   endEl.value   = data.issue_end   || '';
  } catch (e) { showToast(e.message, 'error'); }
}

async function saveSettings() {
  const start  = document.getElementById('issue-start').value;
  const end    = document.getElementById('issue-end').value;
  const errEl  = document.getElementById('settings-error');
  errEl.classList.add('hidden');

  if (!start || !end) {
    errEl.textContent = '開始日と終了日を入力してください';
    errEl.classList.remove('hidden');
    return;
  }
  if (start > end) {
    errEl.textContent = '開始日は終了日より前にしてください';
    errEl.classList.remove('hidden');
    return;
  }
  try {
    await API.put('/admin/settings', { issue_start: start, issue_end: end });
    showToast('設定を保存しました', 'success');
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

async function pageAdminStaff() {
  renderAdminLayout('staff', `
    <div class="max-w-2xl mx-auto space-y-6">

      <!-- CSVインポート -->
      <div class="bg-white rounded-xl shadow p-6">
        <h2 class="text-lg font-bold text-sky-600 mb-1">CSVインポート</h2>
        <p class="text-xs text-gray-500 mb-3">
          フォーマット: <code class="bg-gray-100 px-1 rounded">スタッフID,氏名,パスワード,ロール</code>
          （ロールは <code class="bg-gray-100 px-1 rounded">staff</code> または <code class="bg-gray-100 px-1 rounded">admin</code>、省略時は staff）
        </p>
        <div class="flex gap-3 items-center flex-wrap">
          <label class="flex items-center gap-2 bg-sky-50 hover:bg-sky-100 border border-sky-300 text-sky-700 text-sm px-4 py-2 rounded-lg cursor-pointer transition">
            <span>📂 CSVを選択</span>
            <input id="staff-csv-file" type="file" accept=".csv" class="hidden" onchange="onStaffCsvSelected(this)">
          </label>
          <span id="staff-csv-name" class="text-sm text-gray-600"></span>
          <button onclick="importStaffCsv()"
            class="bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition">
            インポート実行
          </button>
          <button onclick="exportStaffCsv()"
            class="border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm transition">
            📥 CSVエクスポート
          </button>
        </div>
        <div id="staff-import-result" class="hidden mt-3 p-3 bg-gray-50 rounded-lg text-sm"></div>
        <div id="staff-import-error" class="hidden mt-3 text-red-600 text-sm"></div>
      </div>

      <!-- 手動追加フォーム -->
      <div class="bg-white rounded-xl shadow p-6">
        <h2 class="text-lg font-bold text-sky-600 mb-4">手動追加</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">スタッフID</label>
            <input id="new-staff-id" type="text" placeholder="例: staff02"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400 focus:outline-none">
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">氏名</label>
            <input id="new-staff-name" type="text" placeholder="山田スタッフ"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400 focus:outline-none">
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">パスワード</label>
            <input id="new-staff-password" type="password"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400 focus:outline-none">
          </div>
        </div>
        <div id="add-staff-error" class="hidden text-red-600 text-sm mb-3"></div>
        <button onclick="addStaff()"
          class="bg-sky-500 hover:bg-sky-600 text-white px-5 py-2 rounded-lg text-sm font-medium transition">
          登録
        </button>
      </div>

      <!-- 一覧 -->
      <div class="bg-white rounded-xl shadow p-6">
        <h2 class="text-lg font-bold text-sky-600 mb-4">スタッフ一覧</h2>
        <table class="w-full text-sm">
          <thead><tr class="text-left text-gray-500 border-b text-xs">
            <th class="pb-2 pr-3">ID</th><th class="pb-2 pr-3">氏名</th>
            <th class="pb-2 pr-3">ロール</th><th class="pb-2">操作</th>
          </tr></thead>
          <tbody id="staff-tbody"></tbody>
        </table>
      </div>
    </div>`);

  await loadStaff();
}

async function loadStaff() {
  try {
    const staff = await API.get('/admin/staff');
    const tbody = document.getElementById('staff-tbody');
    if (!tbody) return;
    tbody.innerHTML = staff.map(s => `
      <tr class="border-b last:border-0 hover:bg-gray-50">
        <td class="py-1.5 pr-3 font-mono text-xs">${escHtml(s.id)}</td>
        <td class="py-1.5 pr-3">${escHtml(s.name)}</td>
        <td class="py-1.5 pr-3">
          <span class="text-xs px-2 py-0.5 rounded-full ${s.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-sky-100 text-sky-700'}">
            ${s.role}
          </span>
        </td>
        <td class="py-1.5">
          ${s.role !== 'admin' ? `<button onclick="deleteStaff('${s.id}')" class="text-xs text-red-500 border border-red-300 px-2 py-0.5 rounded hover:bg-red-50">削除</button>` : ''}
        </td>
      </tr>`).join('');
  } catch (e) { showToast(e.message, 'error'); }
}

async function addStaff() {
  const id   = document.getElementById('new-staff-id').value.trim();
  const name = document.getElementById('new-staff-name').value.trim();
  const pw   = document.getElementById('new-staff-password').value;
  const errEl = document.getElementById('add-staff-error');
  errEl.classList.add('hidden');

  if (!id || !name || !pw) {
    errEl.textContent = 'すべての項目を入力してください';
    errEl.classList.remove('hidden');
    return;
  }
  try {
    await API.post('/admin/staff', { staff_id: id, name, password: pw });
    document.getElementById('new-staff-id').value = '';
    document.getElementById('new-staff-name').value = '';
    document.getElementById('new-staff-password').value = '';
    showToast('スタッフを登録しました', 'success');
    await loadStaff();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

async function deleteStaff(staffId) {
  if (!confirm(`スタッフ「${staffId}」を削除しますか？`)) return;
  try {
    await API.delete(`/admin/staff/${staffId}`);
    showToast('削除しました', 'success');
    await loadStaff();
  } catch (e) { showToast(e.message, 'error'); }
}

// ─── CSV インポート ────────────────────────────────────────────────────

function onStaffCsvSelected(input) {
  const file = input.files[0];
  if (!file) return;
  document.getElementById('staff-csv-name').textContent = `📄 ${file.name}`;
}

async function importStaffCsv() {
  const input  = document.getElementById('staff-csv-file');
  const errEl  = document.getElementById('staff-import-error');
  const resEl  = document.getElementById('staff-import-result');
  errEl.classList.add('hidden');
  resEl.classList.add('hidden');

  if (!input.files || !input.files[0]) {
    errEl.textContent = 'CSVファイルを選択してください';
    errEl.classList.remove('hidden');
    return;
  }
  const file = input.files[0];
  if (!file.name.endsWith('.csv')) {
    errEl.textContent = 'CSVファイル（.csv）を選択してください';
    errEl.classList.remove('hidden');
    return;
  }

  try {
    const fd = new FormData();
    fd.append('file', file);
    const data = await API.upload('/admin/staff/import', fd);
    resEl.innerHTML = `✅ 成功: <strong>${data.success_count}件</strong>　⏭ スキップ: <strong>${data.skip_count}件</strong>`;
    resEl.classList.remove('hidden');
    showToast(`インポート完了: ${data.success_count}件`, 'success');
    await loadStaff();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

// ─── CSV エクスポート ────────────────────────────────────────────────

async function exportStaffCsv() {
  try {
    const res = await API.get('/admin/staff/export');
    if (res instanceof Response) {
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = 'staff_export.csv';
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (e) { showToast(e.message, 'error'); }
}

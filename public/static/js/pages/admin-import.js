async function pageAdminImport() {
  renderAdminLayout('import', `
    <div class="max-w-lg mx-auto bg-white rounded-xl shadow p-6">
      <h2 class="text-lg font-bold text-sky-600 mb-4">生徒名簿 CSVインポート</h2>
      <p class="text-sm text-gray-600 mb-4">フォーマット: <code class="bg-gray-100 px-1 rounded">学籍番号,氏名,クラス,パスワード</code>（UTF-8 or Shift-JIS）</p>

      <div id="drop-zone"
        class="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-sky-400 transition mb-4"
        onclick="document.getElementById('csv-file').click()"
        ondragover="event.preventDefault(); this.classList.add('border-sky-400')"
        ondragleave="this.classList.remove('border-sky-400')"
        ondrop="handleDrop(event)">
        <p class="text-gray-500 text-sm">CSVファイルをドロップ<br>または<span class="text-sky-500 underline">クリックして選択</span></p>
        <p id="file-name" class="text-sky-600 font-medium mt-2 hidden"></p>
      </div>
      <input id="csv-file" type="file" accept=".csv" class="hidden" onchange="onFileSelected(this)">

      <div id="import-error" class="hidden text-red-600 text-sm mb-3 p-2 bg-red-50 rounded-lg"></div>
      <button id="import-btn" onclick="runImport()"
        class="w-full bg-sky-500 hover:bg-sky-600 text-white font-bold py-2 rounded-lg transition disabled:opacity-50">
        インポート実行
      </button>

      <div id="import-result" class="hidden mt-4 p-4 bg-gray-50 rounded-xl">
        <p class="font-medium text-gray-700 mb-2">インポート結果</p>
        <div class="flex gap-4">
          <span id="success-badge" class="bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm font-medium"></span>
          <span id="skip-badge"    class="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-sm font-medium"></span>
        </div>
      </div>
    </div>`);
}

function onFileSelected(input) {
  const file = input.files[0];
  if (!file) return;
  showFileName(file.name);
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('border-sky-400');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  document.getElementById('csv-file').files = e.dataTransfer.files;
  showFileName(file.name);
}

function showFileName(name) {
  const el = document.getElementById('file-name');
  if (!el) return;
  el.textContent = `📄 ${name}`;
  el.classList.remove('hidden');
}

async function runImport() {
  const input  = document.getElementById('csv-file');
  const errEl  = document.getElementById('import-error');
  const btn    = document.getElementById('import-btn');
  errEl.classList.add('hidden');

  if (!input.files || input.files.length === 0) {
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

  btn.disabled = true;
  btn.textContent = 'インポート中...';

  try {
    const fd = new FormData();
    fd.append('file', file);
    const data = await API.upload('/admin/import', fd);

    document.getElementById('import-result').classList.remove('hidden');
    document.getElementById('success-badge').textContent = `✅ 成功: ${data.success_count}件`;
    document.getElementById('skip-badge').textContent    = `⏭ スキップ: ${data.skip_count}件`;

    showToast(`インポート完了: ${data.success_count}件`, 'success');
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'インポート実行';
  }
}

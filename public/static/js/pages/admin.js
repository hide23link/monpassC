/**
 * admin.js – 管理画面(ダッシュボード・チケット・生徒・インポート・スタッフ・設定)
 * すべて #/admin/* 配下のページで、常に一緒に読み込まれるため1ファイルにまとめている。
 */

// ═══════════════════════════════════════════════════════════════════════
// ダッシュボード
// ═══════════════════════════════════════════════════════════════════════

let dashboardTimer = null;
let chartInstance = null;

async function pageAdminDashboard() {
  renderAdminLayout('dashboard', `
    <div id="dashboard-content">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div class="bg-white rounded-xl shadow p-5 text-center">
          <p class="text-gray-500 text-sm mb-1">総入場者数</p>
          <p id="total-entries" class="text-3xl font-bold text-sky-600">-</p>
          <p class="text-gray-400 text-xs mt-1">/ 6,000</p>
        </div>
        <div class="bg-white rounded-xl shadow p-5 text-center">
          <p class="text-gray-500 text-sm mb-1">未使用チケット</p>
          <p id="unused-count" class="text-3xl font-bold text-amber-500">-</p>
          <p class="text-gray-400 text-xs mt-1">枚</p>
        </div>
        <div class="bg-white rounded-xl shadow p-5 text-center">
          <p class="text-gray-500 text-sm mb-1">QR発行済み生徒</p>
          <p id="issued-students" class="text-3xl font-bold text-purple-500">-</p>
          <p class="text-gray-400 text-xs mt-1">名</p>
        </div>
      </div>

      <!-- グラフ -->
      <div class="bg-white rounded-xl shadow p-5 mb-6">
        <h3 class="text-sm font-semibold text-gray-600 mb-3">時間帯別入場数（30分単位）</h3>
        <canvas id="entry-chart" height="120"></canvas>
      </div>

      <!-- 生徒別テーブル -->
      <div class="bg-white rounded-xl shadow p-5">
        <h3 class="text-sm font-semibold text-gray-600 mb-3">生徒別入場状況</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-gray-500 border-b">
              <th class="pb-2">氏名</th><th class="pb-2">クラス</th>
              <th class="pb-2 text-right">発行</th><th class="pb-2 text-right">入場済</th>
            </tr></thead>
            <tbody id="student-table"></tbody>
          </table>
        </div>
      </div>
    </div>`);

  await loadDashboard();

  // 30秒ポーリング
  dashboardTimer = setInterval(loadDashboard, 30000);
}

async function loadDashboard() {
  try {
    const data = await API.get('/admin/dashboard');
    const { total_entries: total, unused_count: unused, graph_data: graph, students } = data;

    const totalEl = document.getElementById('total-entries');
    const unusedEl = document.getElementById('unused-count');
    if (totalEl)  totalEl.textContent  = total.toLocaleString();
    if (unusedEl) unusedEl.textContent = unused.toLocaleString();

    const issuedStudents = students.filter(s => (s.ticket_count || 0) > 0).length;
    const issuedEl = document.getElementById('issued-students');
    if (issuedEl) issuedEl.textContent = issuedStudents.toLocaleString();

    // グラフ更新
    renderChart(graph);

    // 生徒テーブル
    const tbody = document.getElementById('student-table');
    if (tbody) {
      tbody.innerHTML = students.slice(0, 50).map(s => `
        <tr class="border-b last:border-0">
          <td class="py-1.5">${escHtml(s.name || '')}</td>
          <td class="py-1.5 text-gray-500">${escHtml(s.class || '')}</td>
          <td class="py-1.5 text-right">${s.ticket_count ?? 0}</td>
          <td class="py-1.5 text-right text-green-600">${s.entry_count ?? 0}</td>
        </tr>`).join('');
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function renderChart(graph) {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById('entry-chart');
  if (!canvas) return;

  const labels = Object.keys(graph).sort();
  const values = labels.map(k => graph[k]);

  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  chartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '入場数',
        data: values,
        backgroundColor: 'rgba(14, 165, 233, 0.6)',
        borderColor: 'rgba(14, 165, 233, 1)',
        borderWidth: 1,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════
// チケット管理
// ═══════════════════════════════════════════════════════════════════════

let allTickets = [];
// チェックボックスで選択中のticket_id集合。サーバーには問い合わせず、
// 直近取得したallTicketsに対してクライアント側でフィルタ・選択状態を
// 管理している(生徒名/状態フィルタを切り替えるたびに再フェッチしない)。
let selectedTicketIds = new Set();

async function pageAdminTickets() {
  renderAdminLayout('tickets', `
    <div class="bg-white rounded-xl shadow p-5">
      <div class="flex flex-wrap gap-3 mb-4 items-center">
        <input id="filter-name" type="text" placeholder="生徒名で検索"
          class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-sky-400 focus:outline-none"
          oninput="applyTicketFilter()">
        <select id="filter-status" class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-sky-400 focus:outline-none"
          onchange="applyTicketFilter()">
          <option value="">全件</option>
          <option value="unused">未使用</option>
          <option value="used">入場済み</option>
          <option value="invalid">無効</option>
        </select>
        <button onclick="openAddTicketModal()"
          class="ml-auto bg-sky-500 hover:bg-sky-600 text-white text-sm px-4 py-1.5 rounded-lg transition">
          ＋ 手動追加
        </button>
      </div>
      <div id="bulk-action-bar" class="hidden items-center gap-3 mb-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
        <span id="bulk-selected-count" class="text-sm text-red-700 font-medium"></span>
        <button onclick="bulkDeleteTickets()"
          class="ml-auto bg-red-500 hover:bg-red-600 text-white text-xs px-3 py-1.5 rounded-lg transition">
          🗑 選択したチケットを削除
        </button>
        <button onclick="clearTicketSelection()"
          class="text-xs text-gray-500 border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50">
          選択解除
        </button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm hidden md:table" id="tickets-table">
          <thead><tr class="text-left text-gray-500 border-b text-xs">
            <th class="pb-2 pr-2 w-8"><input type="checkbox" id="select-all-tickets" onchange="toggleSelectAllTickets(this.checked)"></th>
            <th class="pb-2 pr-3">生徒名</th><th class="pb-2 pr-3">クラス</th>
            <th class="pb-2 pr-3">招待者名</th><th class="pb-2 pr-3">発行日時</th>
            <th class="pb-2 pr-3">入場状態</th><th class="pb-2 pr-3">入場日時</th>
            <th class="pb-2">操作</th>
          </tr></thead>
          <tbody id="tickets-tbody"></tbody>
        </table>
        <div id="tickets-cards" class="md:hidden space-y-3"></div>
      </div>
    </div>

    <!-- 手動追加モーダル -->
    <div id="add-ticket-modal" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-white rounded-2xl p-6 w-full max-w-sm" onclick="event.stopPropagation()">
        <h3 class="text-lg font-bold text-sky-600 mb-4">チケット手動追加</h3>
        <div class="mb-3">
          <label class="block text-sm font-medium text-gray-700 mb-1">学籍番号</label>
          <input id="add-student-id" type="text" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400 focus:outline-none">
        </div>
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-1">招待者名</label>
          <input id="add-guest-name" type="text" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400 focus:outline-none">
        </div>
        <div id="add-ticket-error" class="hidden text-red-600 text-sm mb-3"></div>
        <div class="flex gap-3">
          <button onclick="closeAddTicketModal()" class="flex-1 border border-gray-300 py-2 rounded-lg text-sm hover:bg-gray-50">キャンセル</button>
          <button onclick="addTicket()" class="flex-1 bg-sky-500 text-white py-2 rounded-lg text-sm hover:bg-sky-600">追加</button>
        </div>
      </div>
    </div>`);

  await loadTickets();
}

async function loadTickets() {
  try {
    allTickets = await API.get('/admin/tickets');
    applyTicketFilter();
  } catch (e) { showToast(e.message, 'error'); }
}

function applyTicketFilter() {
  const name   = (document.getElementById('filter-name')?.value || '').toLowerCase();
  const status = document.getElementById('filter-status')?.value || '';

  let filtered = allTickets.filter(t => {
    const nameOk   = !name   || (t.student_name || '').toLowerCase().includes(name);
    const statusOk = !status ||
      (status === 'used'    && t.used === 1) ||
      (status === 'invalid' && t.is_valid === 0) ||
      (status === 'unused'  && t.used === 0 && t.is_valid === 1);
    return nameOk && statusOk;
  });

  // テーブル
  const tbody = document.getElementById('tickets-tbody');
  if (tbody) tbody.innerHTML = filtered.map(ticketRow).join('');

  // カード（スマホ）
  const cards = document.getElementById('tickets-cards');
  if (cards) cards.innerHTML = filtered.map(ticketMobileCard).join('');

  // フィルターで隠れた行の選択は解除し、表示を同期する
  const visibleIds = new Set(filtered.map(t => t.ticket_id));
  for (const id of Array.from(selectedTicketIds)) {
    if (!visibleIds.has(id)) selectedTicketIds.delete(id);
  }
  syncTicketCheckboxes();
  updateBulkActionBar();
}

function toggleTicketSelection(ticketId, checked) {
  if (checked) selectedTicketIds.add(ticketId);
  else selectedTicketIds.delete(ticketId);
  syncTicketCheckboxes();
  updateBulkActionBar();
}

function toggleSelectAllTickets(checked) {
  document.querySelectorAll('.ticket-select-checkbox').forEach(cb => {
    const id = cb.dataset.ticketId;
    if (checked) selectedTicketIds.add(id);
    else selectedTicketIds.delete(id);
  });
  syncTicketCheckboxes();
  updateBulkActionBar();
}

function clearTicketSelection() {
  selectedTicketIds.clear();
  syncTicketCheckboxes();
  updateBulkActionBar();
}

function syncTicketCheckboxes() {
  document.querySelectorAll('.ticket-select-checkbox').forEach(cb => {
    cb.checked = selectedTicketIds.has(cb.dataset.ticketId);
  });
  const selectAll = document.getElementById('select-all-tickets');
  const boxes = document.querySelectorAll('.ticket-select-checkbox');
  if (selectAll) {
    selectAll.checked = boxes.length > 0 && Array.from(boxes).every(cb => cb.checked);
  }
}

function updateBulkActionBar() {
  const bar = document.getElementById('bulk-action-bar');
  const countEl = document.getElementById('bulk-selected-count');
  if (!bar || !countEl) return;
  if (selectedTicketIds.size > 0) {
    countEl.textContent = `${selectedTicketIds.size}件選択中`;
    bar.classList.remove('hidden');
    bar.classList.add('flex');
  } else {
    bar.classList.add('hidden');
    bar.classList.remove('flex');
  }
}

async function bulkDeleteTickets() {
  const ids = Array.from(selectedTicketIds);
  if (ids.length === 0) return;
  if (!confirm(`選択した${ids.length}件のチケットを削除しますか？\n※この操作は取り消せません`)) return;
  try {
    const res = await API.post('/admin/tickets/bulk-delete', { ticket_ids: ids });
    showToast(`${res.deleted}件のチケットを削除しました`, 'success');
    selectedTicketIds.clear();
    await loadTickets();
  } catch (e) { showToast(e.message, 'error'); }
}

// is_valid(無効化) → used(入場済み) → 未使用、の優先順位でバッジを1つ返す
// (両方trueにはならない想定だが、念のためこの順で判定している)。
function statusLabel(t) {
  if (t.is_valid === 0) return '<span class="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">🚫 無効</span>';
  if (t.used === 1)      return '<span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✅ 入場済</span>';
  return '<span class="text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full">⬜ 未使用</span>';
}

// PC版のテーブル行(ticketRow)とスマホ版のカード(ticketMobileCard)の両方から
// 呼ばれる、チケットごとの操作ボタン群(有効化/無効化・入場記録/取消・削除)。
function ticketActions(t) {
  const id = t.ticket_id;
  const btns = [];

  // ── 有効状態の切り替え ──
  if (t.is_valid === 1)
    btns.push(`<button onclick="invalidateTicket('${id}')"
      class="text-xs text-red-500 border border-red-300 px-2 py-0.5 rounded hover:bg-red-50 whitespace-nowrap">
      🚫 無効化</button>`);
  else
    btns.push(`<button onclick="revalidateTicket('${id}')"
      class="text-xs text-emerald-600 border border-emerald-300 px-2 py-0.5 rounded hover:bg-emerald-50 whitespace-nowrap">
      ✅ 有効化</button>`);

  // ── 入場状態の切り替え ──
  if (t.used === 0)
    btns.push(`<button onclick="markEntryAdmin('${id}')"
      class="text-xs text-green-600 border border-green-300 px-2 py-0.5 rounded hover:bg-green-50 whitespace-nowrap">
      🟢 入場記録</button>`);
  else
    btns.push(`<button onclick="cancelEntryAdmin('${id}')"
      class="text-xs text-amber-600 border border-amber-300 px-2 py-0.5 rounded hover:bg-amber-50 whitespace-nowrap">
      ↩ 入場取消</button>`);

  btns.push(`<button onclick="deleteTicketAdmin('${id}','${escHtml(t.guest_name || '')}')"
    class="text-xs text-gray-500 border border-gray-300 px-2 py-0.5 rounded hover:bg-red-50 hover:text-red-500 hover:border-red-300 whitespace-nowrap">
    🗑 削除</button>`);

  return `<div class="flex flex-wrap gap-1">${btns.join('')}</div>`;
}

function ticketRow(t) {
  return `<tr class="border-b last:border-0 hover:bg-gray-50" data-ticket-id="${t.ticket_id}">
    <td class="py-1.5 pr-2">
      <input type="checkbox" class="ticket-select-checkbox" data-ticket-id="${t.ticket_id}"
        onchange="toggleTicketSelection('${t.ticket_id}', this.checked)"
        ${selectedTicketIds.has(t.ticket_id) ? 'checked' : ''}>
    </td>
    <td class="py-1.5 pr-3">${escHtml(t.student_name || '')}</td>
    <td class="py-1.5 pr-3 text-gray-500">${escHtml(t.class || '')}</td>
    <td class="py-1.5 pr-3">${escHtml(t.guest_name || '')}</td>
    <td class="py-1.5 pr-3 text-gray-500 text-xs">${formatDate(t.created_at)}</td>
    <td class="py-1.5 pr-3">${statusLabel(t)}</td>
    <td class="py-1.5 pr-3 text-gray-500 text-xs">${t.used_at ? formatDate(t.used_at) : '—'}</td>
    <td class="py-1.5">${ticketActions(t)}</td>
  </tr>`;
}

function ticketMobileCard(t) {
  return `<div class="bg-gray-50 rounded-xl p-3 border border-gray-200" data-ticket-id="${t.ticket_id}">
    <div class="flex justify-between items-start mb-1">
      <span class="flex items-center gap-2">
        <input type="checkbox" class="ticket-select-checkbox" data-ticket-id="${t.ticket_id}"
          onchange="toggleTicketSelection('${t.ticket_id}', this.checked)"
          ${selectedTicketIds.has(t.ticket_id) ? 'checked' : ''}>
        <span class="font-medium">${escHtml(t.student_name || '')} <span class="text-gray-500 text-xs">${escHtml(t.class || '')}</span></span>
      </span>
      ${statusLabel(t)}
    </div>
    <p class="text-sm text-gray-600 mb-2">招待者: ${escHtml(t.guest_name || '')}</p>
    <div class="flex gap-2">${ticketActions(t)}</div>
  </div>`;
}

async function invalidateTicket(ticketId) {
  if (!confirm('このチケットを無効化しますか？')) return;
  try {
    await API.put(`/admin/tickets/${ticketId}`, { is_valid: 0 });
    showToast('無効化しました', 'success');
    await loadTickets();
  } catch (e) { showToast(e.message, 'error'); }
}

async function revalidateTicket(ticketId) {
  if (!confirm('このチケットを有効化しますか？')) return;
  try {
    await API.put(`/admin/tickets/${ticketId}`, { is_valid: 1 });
    showToast('有効化しました', 'success');
    await loadTickets();
  } catch (e) { showToast(e.message, 'error'); }
}

async function markEntryAdmin(ticketId) {
  if (!confirm('このチケットを入場済みにしますか？')) return;
  try {
    await API.put(`/admin/tickets/${ticketId}`, { used: 1 });
    showToast('入場を記録しました', 'success');
    await loadTickets();
  } catch (e) { showToast(e.message, 'error'); }
}

async function cancelEntryAdmin(ticketId) {
  try {
    await API.put(`/admin/tickets/${ticketId}`, { used: 0 });
    showToast('入場取消しました', 'success');
    await loadTickets();
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteTicketAdmin(ticketId, guestName) {
  if (!confirm(`「${guestName}」のチケットを削除しますか？\n※この操作は取り消せません`)) return;
  try {
    await API.delete(`/admin/tickets/${ticketId}`);
    showToast('チケットを削除しました', 'success');
    await loadTickets();
  } catch (e) { showToast(e.message, 'error'); }
}

function openAddTicketModal()  { document.getElementById('add-ticket-modal').classList.remove('hidden'); }
function closeAddTicketModal() { document.getElementById('add-ticket-modal').classList.add('hidden'); }

async function addTicket() {
  const studentId = document.getElementById('add-student-id').value.trim();
  const guestName = document.getElementById('add-guest-name').value.trim();
  const errEl = document.getElementById('add-ticket-error');
  if (!studentId || !guestName) {
    errEl.textContent = '学籍番号と招待者名を入力してください';
    errEl.classList.remove('hidden');
    return;
  }
  try {
    await API.post('/admin/tickets', { student_id: studentId, guest_name: guestName });
    closeAddTicketModal();
    showToast('チケットを追加しました', 'success');
    await loadTickets();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 生徒管理
// ═══════════════════════════════════════════════════════════════════════

let allStudents = [];

async function pageAdminStudents() {
  renderAdminLayout('students', `
    <div class="max-w-4xl mx-auto space-y-4">

      <!-- 追加フォーム -->
      <div class="bg-white rounded-xl shadow p-5">
        <h2 class="text-base font-bold text-sky-600 mb-3">生徒を追加</h2>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">学籍番号 <span class="text-red-500">*</span></label>
            <input id="new-sid" type="text" placeholder="例: 1001"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400 focus:outline-none">
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">氏名 <span class="text-red-500">*</span></label>
            <input id="new-name" type="text" placeholder="山田太郎"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400 focus:outline-none">
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">クラス</label>
            <input id="new-class" type="text" placeholder="1-A"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400 focus:outline-none">
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">パスワード <span class="text-red-500">*</span></label>
            <input id="new-password" type="text" placeholder="英数字8文字以上"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400 focus:outline-none">
          </div>
        </div>
        <div id="add-student-error" class="hidden text-red-600 text-sm mb-2"></div>
        <div class="flex gap-2">
          <button onclick="addStudent()"
            class="bg-sky-500 hover:bg-sky-600 text-white px-5 py-2 rounded-lg text-sm font-medium transition">
            ＋ 追加
          </button>
          <button onclick="generatePassword()"
            class="border border-gray-300 hover:bg-gray-50 text-gray-600 px-4 py-2 rounded-lg text-sm transition">
            🔑 パスワード自動生成
          </button>
        </div>
      </div>

      <!-- 検索 + 一覧 -->
      <div class="bg-white rounded-xl shadow p-5">
        <div class="mb-3">
          <input id="student-search" type="text" placeholder="学籍番号または氏名で検索"
            class="w-full max-w-sm border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-sky-400 focus:outline-none"
            oninput="applyStudentFilter()">
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-gray-500 border-b text-xs">
              <th class="pb-2 pr-3">学籍番号</th>
              <th class="pb-2 pr-3">氏名</th>
              <th class="pb-2 pr-3">クラス</th>
              <th class="pb-2 pr-3 text-right">発行枚数</th>
              <th class="pb-2 pr-3 text-right">入場済</th>
              <th class="pb-2">操作</th>
            </tr></thead>
            <tbody id="students-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- パスワードリセットモーダル（入力） -->
    <div id="pw-reset-modal" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-white rounded-2xl p-6 w-full max-w-sm" onclick="event.stopPropagation()">
        <h3 class="text-lg font-bold text-amber-600 mb-1">パスワードリセット</h3>
        <p class="text-sm text-gray-500 mb-4"><span id="pw-reset-name"></span>（<span id="pw-reset-sid"></span>）</p>
        <input id="pw-reset-sid-val" type="hidden">
        <div class="mb-3">
          <label class="block text-xs font-medium text-gray-600 mb-1">新しいパスワード</label>
          <div class="flex gap-2">
            <input id="pw-reset-input" type="text" placeholder="空欄で自動生成"
              class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:outline-none">
            <button onclick="pwResetGenerate()"
              class="border border-gray-300 hover:bg-gray-50 text-gray-600 px-3 py-2 rounded-lg text-sm">自動生成</button>
          </div>
        </div>
        <div id="pw-reset-error" class="hidden text-red-600 text-sm mb-3"></div>
        <div class="flex gap-3">
          <button onclick="closePwResetModal()"
            class="flex-1 border border-gray-300 py-2 rounded-lg text-sm hover:bg-gray-50">キャンセル</button>
          <button onclick="submitPwReset()"
            class="flex-1 bg-amber-500 text-white py-2 rounded-lg text-sm hover:bg-amber-600">リセット</button>
        </div>
      </div>
    </div>

    <!-- パスワード表示モーダル（結果） -->
    <div id="pw-modal" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-white rounded-2xl p-6 w-full max-w-sm text-center" onclick="event.stopPropagation()">
        <div class="text-4xl mb-3">🔑</div>
        <h3 class="text-lg font-bold text-amber-600 mb-1">新しいパスワード</h3>
        <p class="text-sm text-gray-500 mb-4"><span id="pw-modal-name"></span>（<span id="pw-modal-sid"></span>）</p>
        <div class="bg-amber-50 border border-amber-200 rounded-xl px-6 py-4 mb-4">
          <p id="pw-modal-pw" class="text-2xl font-mono font-bold tracking-widest text-amber-700 select-all"></p>
        </div>
        <p class="text-xs text-gray-400 mb-4">このパスワードをメモしてください。再表示はできません。</p>
        <button onclick="closePwModal()"
          class="w-full bg-amber-500 hover:bg-amber-600 text-white py-2 rounded-lg text-sm font-medium">閉じる</button>
      </div>
    </div>

    <!-- 編集モーダル -->
    <div id="edit-student-modal" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-white rounded-2xl p-6 w-full max-w-sm" onclick="event.stopPropagation()">
        <h3 class="text-lg font-bold text-sky-600 mb-4">生徒情報を編集</h3>
        <input id="edit-sid" type="hidden">
        <div class="mb-3">
          <label class="block text-xs font-medium text-gray-600 mb-1">学籍番号（変更不可）</label>
          <input id="edit-sid-display" type="text" disabled
            class="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-500">
        </div>
        <div class="mb-3">
          <label class="block text-xs font-medium text-gray-600 mb-1">氏名</label>
          <input id="edit-name" type="text"
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400 focus:outline-none">
        </div>
        <div class="mb-3">
          <label class="block text-xs font-medium text-gray-600 mb-1">クラス</label>
          <input id="edit-class" type="text"
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400 focus:outline-none">
        </div>
        <div class="mb-4">
          <label class="block text-xs font-medium text-gray-600 mb-1">新しいパスワード（変更しない場合は空欄）</label>
          <input id="edit-password" type="text" placeholder="空欄=変更なし"
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400 focus:outline-none">
        </div>
        <div id="edit-student-error" class="hidden text-red-600 text-sm mb-3"></div>
        <div class="flex gap-3">
          <button onclick="closeEditModal()"
            class="flex-1 border border-gray-300 py-2 rounded-lg text-sm hover:bg-gray-50">キャンセル</button>
          <button onclick="saveStudent()"
            class="flex-1 bg-sky-500 text-white py-2 rounded-lg text-sm hover:bg-sky-600">保存</button>
        </div>
      </div>
    </div>`);

  await loadStudents();
}

async function loadStudents() {
  try {
    allStudents = await API.get('/admin/students');
    applyStudentFilter();
  } catch (e) { showToast(e.message, 'error'); }
}

function applyStudentFilter() {
  const q = (document.getElementById('student-search')?.value || '').toLowerCase();
  const filtered = allStudents.filter(s =>
    !q || (s.id || '').toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q)
  );
  const tbody = document.getElementById('students-tbody');
  if (!tbody) return;
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="py-4 text-center text-gray-400 text-sm">該当する生徒がいません</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(s => `
    <tr class="border-b last:border-0 hover:bg-gray-50">
      <td class="py-1.5 pr-3 text-gray-500 font-mono text-xs">${escHtml(s.id || '')}</td>
      <td class="py-1.5 pr-3 font-medium">${escHtml(s.name || '')}</td>
      <td class="py-1.5 pr-3 text-gray-500">${escHtml(s.class || s.class_name || '')}</td>
      <td class="py-1.5 pr-3 text-right">${s.ticket_count ?? 0}</td>
      <td class="py-1.5 pr-3 text-right text-green-600">${s.entry_count ?? 0}</td>
      <td class="py-1.5">
        <div class="flex gap-1 flex-wrap">
          <button onclick="openEditModal('${escHtml(s.id)}','${escHtml(s.name)}','${escHtml(s.class || '')}')"
            class="text-xs text-sky-600 border border-sky-300 px-2 py-0.5 rounded hover:bg-sky-50">編集</button>
          <button onclick="resetStudentPassword('${escHtml(s.id)}','${escHtml(s.name)}')"
            class="text-xs text-amber-600 border border-amber-300 px-2 py-0.5 rounded hover:bg-amber-50">🔑 PW</button>
          <button onclick="deleteStudent('${escHtml(s.id)}','${escHtml(s.name)}')"
            class="text-xs text-red-500 border border-red-300 px-2 py-0.5 rounded hover:bg-red-50">削除</button>
        </div>
      </td>
    </tr>`).join('');
}

// ─── 追加 ────────────────────────────────────────────────────────────────────

function randomPassword(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({length}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function generatePassword() {
  const el = document.getElementById('new-password');
  if (el) { el.value = randomPassword(); el.type = 'text'; }
}

async function addStudent() {
  const sid  = document.getElementById('new-sid').value.trim();
  const name = document.getElementById('new-name').value.trim();
  const cls  = document.getElementById('new-class').value.trim();
  const pw   = document.getElementById('new-password').value.trim();
  const errEl = document.getElementById('add-student-error');
  errEl.classList.add('hidden');

  if (!sid || !name || !pw) {
    errEl.textContent = '学籍番号・氏名・パスワードは必須です';
    errEl.classList.remove('hidden');
    return;
  }
  try {
    await API.post('/admin/students', { student_id: sid, name, class_name: cls, password: pw });
    document.getElementById('new-sid').value = '';
    document.getElementById('new-name').value = '';
    document.getElementById('new-class').value = '';
    document.getElementById('new-password').value = '';
    showToast(`生徒「${name}」を追加しました`, 'success');
    await loadStudents();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

// ─── 編集 ────────────────────────────────────────────────────────────────────

function openEditModal(sid, name, cls) {
  document.getElementById('edit-sid').value = sid;
  document.getElementById('edit-sid-display').value = sid;
  document.getElementById('edit-name').value = name;
  document.getElementById('edit-class').value = cls;
  document.getElementById('edit-password').value = '';
  document.getElementById('edit-student-error').classList.add('hidden');
  document.getElementById('edit-student-modal').classList.remove('hidden');
}

function closeEditModal() {
  document.getElementById('edit-student-modal').classList.add('hidden');
}

async function saveStudent() {
  const sid  = document.getElementById('edit-sid').value;
  const name = document.getElementById('edit-name').value.trim();
  const cls  = document.getElementById('edit-class').value.trim();
  const pw   = document.getElementById('edit-password').value.trim();
  const errEl = document.getElementById('edit-student-error');
  errEl.classList.add('hidden');

  if (!name) {
    errEl.textContent = '氏名は必須です';
    errEl.classList.remove('hidden');
    return;
  }
  const body = { name, class_name: cls };
  if (pw) body.password = pw;

  try {
    await API.put(`/admin/students/${sid}`, body);
    closeEditModal();
    showToast('更新しました', 'success');
    await loadStudents();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

// ─── パスワードリセット ───────────────────────────────────────────────────────

function resetStudentPassword(sid, name) {
  document.getElementById('pw-reset-sid-val').value = sid;
  document.getElementById('pw-reset-sid').textContent = sid;
  document.getElementById('pw-reset-name').textContent = name;
  document.getElementById('pw-reset-input').value = '';
  document.getElementById('pw-reset-error').classList.add('hidden');
  document.getElementById('pw-reset-modal').classList.remove('hidden');
}

function pwResetGenerate() {
  document.getElementById('pw-reset-input').value = randomPassword();
}

async function submitPwReset() {
  const sid = document.getElementById('pw-reset-sid-val').value;
  const name = document.getElementById('pw-reset-name').textContent;
  const pw = document.getElementById('pw-reset-input').value.trim();
  const errEl = document.getElementById('pw-reset-error');
  errEl.classList.add('hidden');
  try {
    const body = pw ? { password: pw } : {};
    const res = await API.post(`/admin/students/${sid}/reset-password`, body);
    closePwResetModal();
    document.getElementById('pw-modal-sid').textContent = sid;
    document.getElementById('pw-modal-name').textContent = name;
    document.getElementById('pw-modal-pw').textContent = res.password;
    document.getElementById('pw-modal').classList.remove('hidden');
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

function closePwResetModal() {
  document.getElementById('pw-reset-modal').classList.add('hidden');
}

function closePwModal() {
  document.getElementById('pw-modal').classList.add('hidden');
}

// ─── 削除 ────────────────────────────────────────────────────────────────────

async function deleteStudent(sid, name) {
  if (!confirm(`生徒「${name}（${sid}）」を削除しますか？\n※発行済みチケットも全て削除されます`)) return;
  try {
    await API.delete(`/admin/students/${sid}`);
    showToast(`「${name}」を削除しました`, 'success');
    await loadStudents();
  } catch (e) { showToast(e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════
// 生徒名簿 CSVインポート
// ═══════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════
// スタッフ管理
// ═══════════════════════════════════════════════════════════════════════

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
    await downloadCsvResponse(res, 'staff_export.csv');
  } catch (e) { showToast(e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════
// 設定(QR発行期間)
// ═══════════════════════════════════════════════════════════════════════

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

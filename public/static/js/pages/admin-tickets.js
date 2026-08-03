let allTickets = [];

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
      <div class="overflow-x-auto">
        <table class="w-full text-sm hidden md:table" id="tickets-table">
          <thead><tr class="text-left text-gray-500 border-b text-xs">
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
}

function statusLabel(t) {
  if (t.is_valid === 0) return '<span class="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">🚫 無効</span>';
  if (t.used === 1)      return '<span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✅ 入場済</span>';
  return '<span class="text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full">⬜ 未使用</span>';
}

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
      <span class="font-medium">${escHtml(t.student_name || '')} <span class="text-gray-500 text-xs">${escHtml(t.class || '')}</span></span>
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

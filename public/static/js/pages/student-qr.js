// Backend no longer returns qr_image/qr_url/qr_content for tickets — QR codes
// are rendered entirely client-side via the `qrcode` library (loaded in
// index.html). currentTickets caches the last /ticket/list response so
// onclick handlers (openQrModal) can look tickets up by id instead of
// re-embedding guest names / data into inline HTML attributes.
let currentTickets = [];

function qrContentForTicket(ticketId) {
  return `${location.origin}/scan/${ticketId}`;
}

async function pageStudentQr() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- 左: 発行フォーム -->
      <div class="bg-white rounded-2xl shadow p-6">
        <h2 class="text-xl font-bold text-sky-600 mb-4">QRを発行する</h2>
        <div id="remaining-badge" class="inline-block bg-sky-100 text-sky-700 text-sm font-medium px-3 py-1 rounded-full mb-4">読込中...</div>
        <div id="issue-form">
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1">招待者名</label>
            <input id="guest-name" type="text"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
              placeholder="例: お父さん、田中さん">
          </div>
          <div id="issue-error" class="hidden text-red-600 text-sm mb-3 p-2 bg-red-50 rounded-lg"></div>
          <button id="issue-btn"
            class="w-full bg-sky-500 hover:bg-sky-600 text-white font-bold py-2 rounded-lg transition disabled:opacity-50">
            発行する
          </button>
        </div>
        <div id="limit-reached" class="hidden text-gray-500 text-sm p-3 bg-gray-50 rounded-lg">
          上限（5枚）に達しました
        </div>
      </div>
      <!-- 右: 一覧 -->
      <div>
        <h2 class="text-xl font-bold text-sky-600 mb-4">発行済みQR一覧</h2>
        <div id="ticket-list" class="space-y-4">
          <div class="text-gray-400 text-sm">読込中...</div>
        </div>
      </div>
    </div>

    <!-- QR拡大モーダル -->
    <div id="qr-modal" class="hidden fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onclick="closeQrModal()">
      <div class="bg-white rounded-2xl p-5 w-full max-w-xs text-center" onclick="event.stopPropagation()">
        <canvas id="modal-qr-canvas" width="260" height="260"
          style="width:100%; height:auto; display:block;"
          class="mx-auto mb-3 qr-img rounded"></canvas>
        <p id="modal-guest-name" class="text-gray-700 font-medium text-sm mb-3"></p>
        <button onclick="closeQrModal()" class="bg-gray-200 hover:bg-gray-300 px-6 py-2 rounded-lg text-sm">閉じる</button>
      </div>
    </div>`;

  await loadStudentTickets();

  document.getElementById('issue-btn').addEventListener('click', issueTicket);
}

async function loadStudentTickets() {
  try {
    const tickets = await API.get('/ticket/list');
    currentTickets = tickets;
    const issued = tickets.length;
    const remaining = 5 - issued;

    const badge = document.getElementById('remaining-badge');
    if (badge) badge.textContent = `あと${remaining}枚発行できます`;

    const issueForm = document.getElementById('issue-form');
    const limitMsg  = document.getElementById('limit-reached');
    if (remaining <= 0) {
      issueForm && issueForm.classList.add('hidden');
      limitMsg  && limitMsg.classList.remove('hidden');
    } else {
      issueForm && issueForm.classList.remove('hidden');
      limitMsg  && limitMsg.classList.add('hidden');
    }

    const listEl = document.getElementById('ticket-list');
    if (!listEl) return;
    if (tickets.length === 0) {
      listEl.innerHTML = '<p class="text-gray-400 text-sm">まだ発行されていません</p>';
      return;
    }
    listEl.innerHTML = tickets.map(t => ticketCard(t)).join('');
    await renderTicketQrCodes(tickets);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function renderTicketQrCodes(tickets) {
  await window.QRCodeReady;
  for (const t of tickets) {
    if (t.is_valid === 0) continue; // dimmed placeholder only, no need to render
    const canvas = document.querySelector(`canvas.qr-canvas[data-ticket-id="${t.ticket_id}"]`);
    if (!canvas) continue;
    try {
      await QRCode.toCanvas(canvas, qrContentForTicket(t.ticket_id), { width: 96, margin: 1 });
    } catch (e) {
      console.error('QR render failed', e);
    }
  }
}

function ticketCard(t) {
  const invalid = t.is_valid === 0;
  const used    = t.used === 1;

  let statusBadge;
  if (invalid) {
    statusBadge = `<span class="inline-block bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded-full">🚫 無効（管理者により無効化）</span>`;
  } else if (used) {
    statusBadge = `<span class="inline-block bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">✅ 入場済み</span>
       <span class="text-xs text-gray-500 ml-1">${formatDate(t.used_at)}</span>`;
  } else {
    statusBadge = `<span class="inline-block bg-sky-100 text-sky-700 text-xs px-2 py-0.5 rounded-full">⬜ 未入場</span>`;
  }

  // 削除ボタン: 未入場であれば有効・無効問わず削除可
  const deleteBtn = !used
    ? `<button onclick="deleteTicket('${t.ticket_id}')"
        class="text-red-500 hover:text-red-700 text-sm border border-red-300 hover:border-red-500 px-2 py-0.5 rounded transition">
        削除
      </button>`
    : '';

  // サムネイル: qrcodeライブラリで描画するcanvasのプレースホルダー
  // (実際の描画は renderTicketQrCodes が innerHTML 挿入後に行う)
  const canvasStyle = invalid
    ? 'width:96px; height:96px; display:block; opacity:0.3;'
    : 'width:96px; height:96px; display:block; cursor:pointer;';
  const canvasClass = 'qr-img qr-canvas rounded border border-gray-200';
  const canvasClick = invalid ? '' : `onclick="openQrModal('${t.ticket_id}')"`;
  const canvasEl = `<canvas class="${canvasClass}" data-ticket-id="${t.ticket_id}" width="96" height="96" style="${canvasStyle}" ${canvasClick}></canvas>`;

  // 無効チケットはカード背景を薄くする
  const cardClass = invalid
    ? 'bg-gray-50 rounded-xl shadow p-4 border border-red-100'
    : 'bg-white rounded-xl shadow p-4';

  return `
    <div class="${cardClass}" data-ticket-id="${t.ticket_id}">
      <div class="flex items-start gap-4">
        ${canvasEl}
        <div class="flex-1 min-w-0">
          <p class="font-semibold ${invalid ? 'text-gray-400 line-through' : 'text-gray-800'} truncate">${escHtml(t.guest_name)}</p>
          <p class="text-xs text-gray-500">発行者: ${escHtml(t.student_name || '')}</p>
          <p class="text-xs text-gray-500 mb-1">発行: ${formatDate(t.created_at)}</p>
          <div class="mb-2">${statusBadge}</div>
          <div class="flex gap-2 flex-wrap">
            ${deleteBtn}
          </div>
        </div>
      </div>
    </div>`;
}

async function issueTicket() {
  const guestName = document.getElementById('guest-name').value.trim();
  const errEl = document.getElementById('issue-error');
  const btn   = document.getElementById('issue-btn');

  if (!guestName) {
    errEl.textContent = '招待者名を入力してください';
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  errEl.classList.add('hidden');

  try {
    await API.post('/ticket/issue', { guest_name: guestName });
    document.getElementById('guest-name').value = '';
    showToast('QRを発行しました', 'success');
    await loadStudentTickets();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

async function deleteTicket(ticketId) {
  if (!confirm('このQRチケットを削除しますか？')) return;
  try {
    await API.delete(`/ticket/${ticketId}`);
    showToast('削除しました', 'success');
    await loadStudentTickets();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function openQrModal(ticketId) {
  const t = currentTickets.find(x => x.ticket_id === ticketId);
  if (!t) return;
  document.getElementById('modal-guest-name').textContent = t.guest_name;
  document.getElementById('qr-modal').classList.remove('hidden');
  try {
    await window.QRCodeReady;
    const canvas = document.getElementById('modal-qr-canvas');
    await QRCode.toCanvas(canvas, qrContentForTicket(ticketId), { width: 260, margin: 2 });
  } catch (e) {
    console.error('QR render failed', e);
  }
}
function closeQrModal() { document.getElementById('qr-modal').classList.add('hidden'); }

// escHtml と formatDate は common.js で定義済み

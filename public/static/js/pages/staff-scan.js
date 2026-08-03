let scanHistory = [];
let html5QrScanner = null;
let offlineTimer = null;
let cacheTimestamp = null;

// Web Audio API で効果音
function playSound(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if (type === 'ok') {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
    } else {
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4);
    }
  } catch (_) {}
}

async function pageStaffScan() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="max-w-lg mx-auto">
      <!-- オンライン/オフライン状態 -->
      <div id="online-indicator" class="flex items-center justify-between mb-4 px-3 py-2 rounded-lg bg-green-50 border border-green-200">
        <span id="online-text" class="text-green-700 text-sm font-medium">🟢 オンライン</span>
        <button id="sync-btn" class="hidden bg-sky-500 text-white text-xs px-3 py-1 rounded-full" onclick="syncOfflineQueue()">
          同期
        </button>
      </div>

      <!-- スキャンエリア -->
      <div class="bg-white rounded-2xl shadow p-4 mb-4">
        <h2 class="text-lg font-bold text-sky-600 mb-3 text-center">QRスキャン</h2>
        <div id="qr-reader" class="w-full rounded-lg overflow-hidden mb-3"></div>
        <!-- スキャン結果フラッシュ -->
        <div id="scan-result" class="hidden rounded-lg p-4 text-center font-bold text-lg transition-all"></div>
      </div>

      <!-- 直近スキャン履歴 -->
      <div class="bg-white rounded-2xl shadow p-4 mb-4">
        <h3 class="text-sm font-semibold text-gray-600 mb-3">直近のスキャン</h3>
        <div id="scan-history" class="space-y-2 text-sm text-gray-500">
          <p class="text-xs">スキャン結果がここに表示されます</p>
        </div>
      </div>

      <!-- 現在の来場状況（管理者と同じ集計を閲覧可能） -->
      <div class="bg-white rounded-2xl shadow p-4 mb-4">
        <h3 class="text-sm font-semibold text-gray-600 mb-3">現在の来場状況</h3>
        <div class="grid grid-cols-2 gap-3 text-center">
          <div class="bg-sky-50 rounded-lg p-3">
            <p id="status-total" class="text-2xl font-bold text-sky-600">-</p>
            <p class="text-xs text-gray-500 mt-1">入場済み</p>
          </div>
          <div class="bg-amber-50 rounded-lg p-3">
            <p id="status-unused" class="text-2xl font-bold text-amber-500">-</p>
            <p class="text-xs text-gray-500 mt-1">未入場</p>
          </div>
        </div>
      </div>

      <!-- 自分がチェックした来場データ（サーバー保存・再読込しても残る） -->
      <div class="bg-white rounded-2xl shadow p-4">
        <h3 class="text-sm font-semibold text-gray-600 mb-3">自分がチェックした来場者</h3>
        <div id="my-scans-list" class="space-y-2 text-sm text-gray-500 max-h-64 overflow-y-auto">
          <p class="text-xs">読込中...</p>
        </div>
      </div>
    </div>`;

  // キャッシュ取得
  await fetchCache();
  await loadStatus();
  await loadMyScans();

  // オフライン監視
  window.addEventListener('online',  onOnline);
  window.addEventListener('offline', onOffline);
  updateOnlineIndicator();

  // 60秒ごとに差分更新（他のスタッフの入場チェックも反映されるよう現在状況も更新）
  offlineTimer = setInterval(async () => {
    if (navigator.onLine) {
      await fetchCache(cacheTimestamp);
      await loadStatus();
    }
  }, 60000);

  // QRスキャナ起動
  startScanner();
}

async function loadStatus() {
  try {
    const status = await API.get('/ticket/status');
    const totalEl  = document.getElementById('status-total');
    const unusedEl = document.getElementById('status-unused');
    if (totalEl)  totalEl.textContent  = status.total_entries;
    if (unusedEl) unusedEl.textContent = status.unused_count;
  } catch (_) {}
}

async function loadMyScans() {
  try {
    const scans = await API.get('/ticket/my-scans');
    const el = document.getElementById('my-scans-list');
    if (!el) return;
    if (!scans || scans.length === 0) {
      el.innerHTML = '<p class="text-xs text-gray-400">まだ入場チェックしていません</p>';
      return;
    }
    el.innerHTML = scans.map(s => `
      <div class="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
        <span class="text-gray-700 truncate">${escHtml(s.guest_name)}
          <span class="text-gray-400 text-xs">(${escHtml(s.student_name)})</span>
        </span>
        <span class="text-gray-400 text-xs whitespace-nowrap ml-2">${formatScanTime(s.used_at)}</span>
      </div>`).join('');
  } catch (_) {}
}

function formatScanTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return iso;
  }
}

async function fetchCache(since = null) {
  try {
    const url = since ? `/ticket/cache?since=${encodeURIComponent(since)}` : '/ticket/cache';
    const tickets = await API.get(url);
    const list = Array.isArray(tickets) ? tickets : (tickets.tickets || []);
    await saveToIndexedDB(list);
    cacheTimestamp = new Date().toISOString();
  } catch (_) {}
}

function startScanner() {
  if (typeof Html5Qrcode === 'undefined') return;
  html5QrScanner = new Html5Qrcode('qr-reader');
  html5QrScanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 250, height: 250 } },
    onScanSuccess,
    () => {}
  ).catch(() => {
    document.getElementById('qr-reader').innerHTML =
      '<p class="text-center text-gray-400 py-8 text-sm">カメラの起動に失敗しました</p>';
  });
}

async function onScanSuccess(decodedText) {
  // URLから ticket_id を抽出（例: https://domain/scan/TICKET_ID）
  const match = decodedText.match(/\/scan\/([^/?#]+)/);
  if (!match) { showScanResult('ng', '不正なQR', ''); return; }
  const ticketId = match[1];

  if (navigator.onLine) {
    try {
      const res = await API.post('/ticket/scan', { ticket_id: ticketId });
      const guestName = res.guest_name || '';
      showScanResult('ok', `入場OK ${guestName}`, ticketId);
      addHistory({ ticketId, status: 'ok', label: `✅ 入場OK`, time: new Date() });
      loadStatus();
      loadMyScans();
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('入場済み') || msg.includes('already')) {
        showScanResult('ng', '入場済み', ticketId);
        addHistory({ ticketId, status: 'ng', label: '❌ 入場済み', time: new Date() });
      } else if (msg.includes('無効') || msg.includes('invalid')) {
        showScanResult('ng', '無効なチケット', ticketId);
        addHistory({ ticketId, status: 'ng', label: '❌ 無効', time: new Date() });
      } else {
        showScanResult('ng', '不正なQR', ticketId);
        addHistory({ ticketId, status: 'ng', label: '❌ 不正', time: new Date() });
      }
    }
  } else {
    // オフライン: IndexedDB で判定
    const ticket = await getFromIndexedDB(ticketId);
    if (!ticket) { showScanResult('ng', '不正なQR', ticketId); return; }
    if (ticket.is_valid === 0) { showScanResult('ng', '無効なチケット', ticketId); return; }
    if (ticket.used === 1) { showScanResult('ng', '入場済み', ticketId); return; }
    // キューに積む
    await addToQueue({ ticket_id: ticketId, scanned_at: new Date().toISOString(), session_id: getSessionId() });
    // ローカルキャッシュを更新
    ticket.used = 1;
    await saveToIndexedDB([ticket]);
    showScanResult('ok', '入場OK（オフライン）', ticketId);
    addHistory({ ticketId, status: 'ok', label: '✅ 入場OK(オフライン)', time: new Date() });
    updateSyncButton();
  }
}

function showScanResult(type, message, ticketId) {
  const el = document.getElementById('scan-result');
  if (!el) return;
  el.classList.remove('hidden', 'bg-green-100', 'text-green-800', 'bg-red-100', 'text-red-800', 'flash-ok', 'flash-ng');
  if (type === 'ok') {
    el.className = 'rounded-lg p-4 text-center font-bold text-lg bg-green-100 text-green-800 flash-ok';
    playSound('ok');
    if (navigator.vibrate) navigator.vibrate(200);
  } else {
    el.className = 'rounded-lg p-4 text-center font-bold text-lg bg-red-100 text-red-800 flash-ng';
    playSound('ng');
  }
  el.textContent = message;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

function addHistory(item) {
  scanHistory.unshift(item);
  if (scanHistory.length > 5) scanHistory = scanHistory.slice(0, 5);
  renderHistory();
}

function renderHistory() {
  const el = document.getElementById('scan-history');
  if (!el) return;
  if (scanHistory.length === 0) {
    el.innerHTML = '<p class="text-xs text-gray-400">スキャン結果がここに表示されます</p>';
    return;
  }
  el.innerHTML = scanHistory.map((item, i) => `
    <div class="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0" data-history-index="${i}">
      <span class="${item.status === 'ok' ? 'text-green-700' : 'text-red-600'}">${item.label}</span>
      <span class="text-gray-400 text-xs">${item.time.toLocaleTimeString('ja-JP', {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>
      ${item.status === 'ok' && item.ticketId ? `<button onclick="cancelEntry('${item.ticketId}', ${i})" class="text-xs text-gray-500 border border-gray-300 px-2 py-0.5 rounded hover:bg-gray-100">取消</button>` : ''}
    </div>`).join('');
}

async function cancelEntry(ticketId, idx) {
  try {
    await API.post(`/ticket/scan/${ticketId}/cancel`);
    scanHistory[idx].label = '↩ 取消済み';
    scanHistory[idx].status = 'cancelled';
    showToast('入場取消しました', 'success');
    renderHistory();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function updateOnlineIndicator() {
  const textEl = document.getElementById('online-text');
  const indEl  = document.getElementById('online-indicator');
  if (!textEl || !indEl) return;
  if (navigator.onLine) {
    textEl.textContent = '🟢 オンライン';
    indEl.className = 'flex items-center justify-between mb-4 px-3 py-2 rounded-lg bg-green-50 border border-green-200';
  } else {
    textEl.textContent = '🔴 オフライン（キャッシュ使用中）';
    indEl.className = 'flex items-center justify-between mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200';
  }
}

async function onOnline() {
  updateOnlineIndicator();
  await fetchCache(cacheTimestamp);
  updateSyncButton();
}
function onOffline() { updateOnlineIndicator(); }

async function updateSyncButton() {
  const count = await getQueueCount();
  const btn = document.getElementById('sync-btn');
  if (!btn) return;
  if (count > 0) {
    btn.textContent = `同期（${count}件）`;
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}

async function syncOfflineQueue() {
  const items = await getQueue();
  if (items.length === 0) return;
  try {
    await API.post('/ticket/sync', items);
    await clearQueue();
    showToast('同期しました', 'success');
    const btn = document.getElementById('sync-btn');
    if (btn) btn.classList.add('hidden');
    await loadStatus();
    await loadMyScans();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─── IndexedDB ─────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('gakuensai_db', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('ticket_cache'))
        db.createObjectStore('ticket_cache', { keyPath: 'ticket_id' });
      if (!db.objectStoreNames.contains('offline_queue'))
        db.createObjectStore('offline_queue', { autoIncrement: true });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => reject(req.error);
  });
}

async function saveToIndexedDB(tickets) {
  const db = await openDB();
  const tx = db.transaction('ticket_cache', 'readwrite');
  const store = tx.objectStore('ticket_cache');
  for (const t of tickets) {
    const key = t.ticket_id || t.id;
    if (key) store.put({ ...t, ticket_id: key });
  }
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}

async function getFromIndexedDB(ticketId) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx    = db.transaction('ticket_cache', 'readonly');
    const store = tx.objectStore('ticket_cache');
    const req   = store.get(ticketId);
    req.onsuccess = () => res(req.result || null);
    req.onerror   = () => rej(req.error);
  });
}

async function addToQueue(item) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx    = db.transaction('offline_queue', 'readwrite');
    const store = tx.objectStore('offline_queue');
    store.add(item);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}

async function getQueue() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx    = db.transaction('offline_queue', 'readonly');
    const store = tx.objectStore('offline_queue');
    const req   = store.getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

async function getQueueCount() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx    = db.transaction('offline_queue', 'readonly');
    const store = tx.objectStore('offline_queue');
    const req   = store.count();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

async function clearQueue() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx    = db.transaction('offline_queue', 'readwrite');
    const store = tx.objectStore('offline_queue');
    store.clear();
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}

function getSessionId() {
  let id = sessionStorage.getItem('scan_session_id');
  if (!id) { id = Math.random().toString(36).slice(2); sessionStorage.setItem('scan_session_id', id); }
  return id;
}

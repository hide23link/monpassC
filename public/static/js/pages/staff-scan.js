/**
 * staff-scan.js – スタッフ/管理者向けのQRスキャン画面(#/staff)
 *
 * カメラ映像からのQR読み取りは`html5-qrcode`ライブラリ(index.htmlでCDNから
 * 読み込み)が担い、このファイルは読み取り結果(decodedText)を受けて
 * /ticket/scan APIを呼ぶだけ。以前あったオフライン対応(IndexedDBキャッシュ+
 * キュー同期)は運用の複雑さを下げるため削除済みで、現在は常時オンライン
 * 前提のシンプルな作りになっている。
 */
let scanHistory = [];
let html5QrScanner = null;
let statusTimer = null;

// Web Audio API で効果音（入場OK/NGをそれぞれ異なる音で通知する）
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
  const isAdmin = typeof Auth !== 'undefined' && Auth.getRole() === 'admin';
  app.innerHTML = `
    <div class="max-w-lg mx-auto">
      ${isAdmin ? `<a href="#/admin" class="inline-flex items-center gap-1 text-sm text-sky-600 hover:text-sky-700 mb-3">← 管理画面に戻る</a>` : ''}

      <!-- スキャンエリア -->
      <div class="bg-white rounded-2xl shadow p-4 mb-4">
        <h2 class="text-lg font-bold text-sky-600 mb-3 text-center">QRスキャン</h2>
        <div id="qr-reader" class="w-full rounded-lg overflow-hidden mb-3"></div>
      </div>

      <!-- スキャン結果フルスクリーンオーバーレイ -->
      <div id="scan-overlay" class="hidden fixed inset-0 z-50 items-center justify-center flex-col">
        <div id="scan-overlay-icon" class="scan-overlay-pop text-8xl mb-4"></div>
        <div id="scan-overlay-text" class="scan-overlay-pop text-3xl font-bold text-white text-center px-6"></div>
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

  await loadStatus();
  await loadMyScans();

  // 60秒ごとに差分更新（他のスタッフの入場チェックも反映されるよう現在状況も更新）
  statusTimer = setInterval(async () => {
    await loadStatus();
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

let scanLocked = false;

async function onScanSuccess(decodedText) {
  // html5-qrcode はカメラにQRが映っている間、成功検出のたびに毎フレーム
  // (fps:10 = 約100ms間隔) このコールバックを呼び続ける。ロックせずにいると
  // 1回のかざしで /ticket/scan への並列リクエストが複数発生し、最初の1件だけ
  // 成功した直後に後続のリクエストが「入場済み」(409)を返して結果表示を
  // 上書きしてしまう（実際は入場成功しているのに画面上は失敗に見えるバグ）。
  // 検出直後にスキャナーを一時停止し、処理完了後クールダウンを置いてから
  // 再開することで、1回のかざしにつき1リクエストのみになるようにする。
  if (scanLocked) return;
  scanLocked = true;
  if (html5QrScanner) {
    try { html5QrScanner.pause(true); } catch (_) {}
  }

  try {
    // URLから ticket_id を抽出（例: https://domain/scan/TICKET_ID）
    const match = decodedText.match(/\/scan\/([^/?#]+)/);
    if (!match) { showScanResult('ng', '不正なQR', ''); return; }
    const ticketId = match[1];

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
  } finally {
    setTimeout(() => {
      scanLocked = false;
      if (html5QrScanner) {
        try { html5QrScanner.resume(); } catch (_) {}
      }
    }, 1500);
  }
}

function showScanResult(type, message, ticketId) {
  const overlay = document.getElementById('scan-overlay');
  const iconEl = document.getElementById('scan-overlay-icon');
  const textEl = document.getElementById('scan-overlay-text');
  if (!overlay || !iconEl || !textEl) return;

  overlay.classList.remove('hidden', 'bg-green-500', 'bg-red-500');
  overlay.classList.add('flex', type === 'ok' ? 'bg-green-500' : 'bg-red-500');
  // 再生時にポップアニメーションを毎回発火させるためクラスを再付与する
  iconEl.classList.remove('scan-overlay-pop'); void iconEl.offsetWidth; iconEl.classList.add('scan-overlay-pop');
  textEl.classList.remove('scan-overlay-pop'); void textEl.offsetWidth; textEl.classList.add('scan-overlay-pop');
  iconEl.textContent = type === 'ok' ? '✅' : '❌';
  textEl.textContent = message;

  if (type === 'ok') {
    playSound('ok');
    if (navigator.vibrate) navigator.vibrate(200);
  } else {
    playSound('ng');
    if (navigator.vibrate) navigator.vibrate([100, 60, 100]);
  }

  setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
  }, 1200);
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

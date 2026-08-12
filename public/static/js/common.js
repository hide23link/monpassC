/**
 * common.js – 共通ユーティリティ（トースト・管理者レイアウト・ヘルパー）
 *
 * ここで定義する関数はすべてグローバルスコープに置かれ(ビルドステップなしの
 * classicスクリプトなのでモジュールではない)、index.htmlで他のページスクリプト
 * より先に読み込まれる。そのためpages/*.jsの各ファイルからは`import`不要で
 * そのまま呼べる。
 */

// ─── トースト通知 ────────────────────────────────────────────────────

function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'fixed bottom-4 right-4 z-[9999] space-y-2 pointer-events-none';
    document.body.appendChild(container);
  }
  const colors = { success: 'bg-green-500', error: 'bg-red-500', warning: 'bg-amber-500', info: 'bg-sky-500' };
  const toast = document.createElement('div');
  toast.className = `${colors[type] || colors.info} text-white px-4 py-2 rounded-lg shadow-lg text-sm max-w-xs pointer-events-auto`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ─── 管理者共通レイアウト ─────────────────────────────────────────────

const ADMIN_TABS = [
  { key: 'dashboard', label: 'ダッシュボード', hash: '#/admin' },
  { key: 'scan',      label: 'QRスキャン',     hash: '#/staff' },
  { key: 'tickets',   label: 'チケット',       hash: '#/admin/tickets' },
  { key: 'students',  label: '生徒',           hash: '#/admin/students' },
  { key: 'import',    label: 'インポート',       hash: '#/admin/import' },
  { key: 'staff',     label: 'スタッフ',         hash: '#/admin/staff' },
  { key: 'settings',  label: '設定',           hash: '#/admin/settings' },
];

function renderAdminLayout(activeTab, contentHtml) {
  const tabs = ADMIN_TABS.map(t => `
    <a href="${t.hash}"
      class="px-4 py-2 text-sm font-medium whitespace-nowrap transition border-b-2
        ${t.key === activeTab
          ? 'border-sky-500 text-sky-600'
          : 'border-transparent text-gray-500 hover:text-sky-600 hover:border-sky-300'
        }"
      data-tab="${t.key}">
      ${t.label}
    </a>`).join('');

  document.getElementById('app').innerHTML = `
    <div class="border-b border-gray-200 mb-6 -mx-4 px-4 overflow-x-auto">
      <div class="flex items-center justify-between min-w-max gap-4">
        <nav class="flex gap-1" id="admin-tabs">${tabs}</nav>
        <button onclick="exportEmergencyCsv()"
          class="flex items-center gap-1 bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition whitespace-nowrap shadow-sm">
          🚨 緊急CSV出力
        </button>
      </div>
    </div>
    ${contentHtml}`;
}

// ─── CSVダウンロード共通ヘルパー ─────────────────────────────────────

// API.get()がCSVレスポンスを生のResponseオブジェクトのまま返してくる
// (api.js参照)ので、それをblob化してブラウザにファイルとしてダウンロード
// させる処理をここに共通化してある。resがResponseでなければ何もせずfalseを
// 返す(APIエラー時など、呼び出し元でエラートーストの表示だけ行いたい場合用)。
async function downloadCsvResponse(res, filename) {
  if (!(res instanceof Response)) return false;
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

// ─── 緊急CSV出力 ─────────────────────────────────────────────────────

async function exportEmergencyCsv() {
  try {
    const res = await API.get('/admin/export');
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    if (await downloadCsvResponse(res, `tickets_${date}.csv`)) {
      showToast('緊急CSVを出力しました', 'success');
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─── 汎用ヘルパー ────────────────────────────────────────────────────

// パスワード入力欄の表示/非表示を切り替える(目のアイコンをクリックしたとき)。
function togglePw(inputId, eyeId) {
  const input = document.getElementById(inputId);
  const eye   = document.getElementById(eyeId);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  if (eye) eye.textContent = input.type === 'password' ? '👁' : '🙈';
}

// テンプレートリテラルでHTMLを組み立てる際、ユーザー入力(氏名等)を埋め込む前に
// 必ずこれを通す。招待者名(guest_name)はサーバー側で保存時にすでにエスケープ
// 済み(src/lib/html.ts)だが、氏名・クラス名など他のフィールドはサーバー側で
// エスケープしていないため、表示側でのエスケープが唯一のXSS対策になる。
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ISO日時文字列を「8/12 14:30」のような日本語ロケール表記に変換する。
function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ja-JP', {
      month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch (_) { return iso; }
}

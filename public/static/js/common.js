/**
 * common.js – 共通ユーティリティ（トースト・管理者レイアウト・ヘルパー）
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

// ─── 緊急CSV出力 ─────────────────────────────────────────────────────

async function exportEmergencyCsv() {
  try {
    const res = await API.get('/admin/export');
    if (res instanceof Response) {
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      a.href = url;
      a.download = `tickets_${date}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('緊急CSVを出力しました', 'success');
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─── 汎用ヘルパー ────────────────────────────────────────────────────

function togglePw(inputId, eyeId) {
  const input = document.getElementById(inputId);
  const eye   = document.getElementById(eyeId);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  if (eye) eye.textContent = input.type === 'password' ? '👁' : '🙈';
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ja-JP', {
      month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch (_) { return iso; }
}

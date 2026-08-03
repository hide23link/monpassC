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
      <div class="bg-white rounded-xl shadow p-5 mb-6">
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

      <!-- 昇格ツリー -->
      <div class="bg-white rounded-xl shadow p-5">
        <h3 class="text-sm font-semibold text-gray-600 mb-3">昇格ツリー</h3>
        <div id="promote-tree" class="text-sm text-gray-700 font-mono"></div>
      </div>
    </div>`);

  await loadDashboard();

  // 30秒ポーリング
  dashboardTimer = setInterval(loadDashboard, 30000);
}

async function loadDashboard() {
  try {
    const data = await API.get('/admin/dashboard');
    const total   = data.total_entries ?? data.entry_count ?? 0;
    const unused  = data.unused_count ?? data.unused_tickets ?? 0;
    const students = data.student_entries ?? data.students ?? [];
    const graph   = data.hourly_entries ?? data.entry_graph ?? {};

    const totalEl = document.getElementById('total-entries');
    const unusedEl = document.getElementById('unused-count');
    if (totalEl)  totalEl.textContent  = total.toLocaleString();
    if (unusedEl) unusedEl.textContent = unused.toLocaleString();

    const issuedStudents = students.filter(s => (s.issued_count || s.ticket_count || 0) > 0).length;
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
          <td class="py-1.5 text-right">${s.issued_count ?? s.ticket_count ?? 0}</td>
          <td class="py-1.5 text-right text-green-600">${s.entry_count ?? 0}</td>
        </tr>`).join('');
    }

    // 昇格ツリー
    try {
      const promotions = await API.get('/promote/list');
      renderPromoteTree(promotions);
    } catch (_) {}

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

function renderPromoteTree(promotions) {
  const el = document.getElementById('promote-tree');
  if (!el) return;
  if (!promotions || promotions.length === 0) {
    el.textContent = '昇格なし';
    return;
  }
  const lines = promotions.map(p =>
    `${p.promoted_by_type === 'staff' ? '管理者' : '生徒'} ${p.promoted_by_id} → 生徒 ${p.student_id}（${formatDate(p.promoted_at)}）`
  );
  el.innerHTML = lines.map(l => `<div class="py-0.5">${escHtml(l)}</div>`).join('');
}

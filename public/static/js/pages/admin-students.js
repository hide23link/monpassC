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
      <td class="py-1.5 pr-3 text-right">${s.ticket_count ?? s.issued_count ?? 0}</td>
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

function generatePassword() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const pw = Array.from({length: 8}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const el = document.getElementById('new-password');
  if (el) { el.value = pw; el.type = 'text'; }
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
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  document.getElementById('pw-reset-input').value =
    Array.from({length: 8}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
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

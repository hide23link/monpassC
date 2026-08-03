/**
 * api.js – fetch wrapper（JWT自動付与・共通エラー処理）
 */

const API = (() => {
  async function request(method, path, body = null) {
    const token = localStorage.getItem('token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const opts = { method, headers };
    if (body !== null) opts.body = JSON.stringify(body);

    const res = await fetch(path, opts);

    if (res.status === 401) {
      // ログインエンドポイント自体への401はリダイレクトしない
      const isLoginPath = path.includes('/auth/login') || path.includes('/auth/staff/login');
      if (!isLoginPath) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.hash = '#/login';
      }
      const errData = await res.json().catch(() => ({}));
      throw Object.assign(new Error(errData.detail || '認証が必要です'), { status: 401 });
    }

    if (!res.ok) {
      let msg = `エラー (${res.status})`;
      try {
        const data = await res.json();
        msg = data.detail || data.message || msg;
      } catch (_) {}
      throw Object.assign(new Error(msg), { status: res.status });
    }

    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    if (ct.includes('text/csv') || ct.includes('text/plain') || ct.includes('application/octet-stream')) {
      return res; // raw response（CSVダウンロード用）
    }
    return res.text();
  }

  async function uploadFile(path, formData) {
    const token = localStorage.getItem('token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(path, { method: 'POST', headers, body: formData });

    if (res.status === 401) {
      localStorage.removeItem('token');
      window.location.hash = '#/login';
      throw new Error('認証が必要です');
    }
    if (!res.ok) {
      let msg = `エラー (${res.status})`;
      try { const d = await res.json(); msg = d.detail || msg; } catch (_) {}
      throw Object.assign(new Error(msg), { status: res.status });
    }
    return res.json();
  }

  return {
    get:    (path)        => request('GET',    path),
    post:   (path, body)  => request('POST',   path, body),
    put:    (path, body)  => request('PUT',    path, body),
    delete: (path)        => request('DELETE', path),
    upload: (path, fd)    => uploadFile(path, fd),
  };
})();

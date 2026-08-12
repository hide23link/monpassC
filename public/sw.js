// 最小限のService Worker。オフラインキャッシュ等の処理は一切していない。
// 存在理由はChrome/Androidの「インストール可能」要件を満たすためだけ
// (「ホーム画面に追加」のプロンプトが自動で出るには、fetchイベントの
// ハンドラが登録されている必要がある)。あえてevent.respondWith()を
// 呼ばないことで、全リクエストがService Worker未インストール時と全く同じく
// そのままネットワークへ素通りする。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

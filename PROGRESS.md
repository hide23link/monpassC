# MONpass Cloudflare移行 — 進捗まとめ

最終更新: 2026-08-03

## これまでの経緯

1. `/Users/hide/MONpass`(FastAPI + SQLite、Nginx+uvicorn運用)を、Cloudflare上に完全移行する方針を決定。DBも含めてCloudflareに寄せ、`monpass.hide23.link` で稼働させる。
2. 移行プランを策定・承認。プラン全文は [`PLAN.md`](./PLAN.md) を参照(オリジナルは `/Users/hide/.claude/plans/claudflare-db-monpass-hide23-link-mail-toasty-balloon.md`)。
3. `/Users/hide/monpassC` にプロジェクトを新規作成し、実装作業を開始。

## 確定した方針(要点)

- アーキテクチャ: 単一Cloudflare Workers(**Hono**)でAPIと静的アセットを同一オリジン配信。DBは**D1**。Cloudflare Pagesは使わない。
- Cloudflare Access(メールOTP、管理者数名)は `/admin/*` **APIルートのみ**保護。スタッフ・生徒は既存のID/パスワード+JWTログインのまま。
- 既存の生徒/スタッフのbcryptパスワードハッシュはそのまま引き継ぐ(`bcryptjs`で検証、強制リセットしない)。
- QRコード生成はサーバー側Pillow生成から**クライアント側JS描画**に変更(WorkersはPillow/OSフォントを実行できないため)。
- `/ticket/scan`・`/ticket/sync` の同時実行制御は、SQLiteの`BEGIN IMMEDIATE`からD1向けの**atomicな条件付きUPDATE**(`WHERE used=0`)に置き換え。エラー文言は`main.py`とバイト同一を維持(フロントの文字列マッチ依存のため)。

## 完了した作業

### プロジェクト scaffold(`/Users/hide/monpassC`)
- `package.json` — Hono, bcryptjs, jose, encoding-japanese, qrcode などの依存を定義
- `wrangler.jsonc` — D1バインディング、静的アセットバインディング(`run_worker_first`でAPIパスをWorker優先に)、本番/stagingの2環境
- `migrations/0001_init.sql` — D1スキーマ(既存7テーブル+インデックス+新設`last_import_passwords`テーブル)
- `src/index.ts` + `src/routes/{auth,ticket,promote,admin}.ts` — Honoルート骨格(現状`501 not_implemented`スタブ、各ファイルに移植方針のコメント付き)
- `src/env.ts` — Bindings型定義
- `public/` — 既存`MONpass/static/`をコピー(`/static/js/...`パス維持のため`public/static/`配下に配置)
- `.dev.vars.example`, `.gitignore`

### 環境構築
- `npm install` 完了
- `wrangler login` でCloudflareアカウント(hayahide23@gmail.com)にOAuth認証済み
- `wrangler@4` + `@cloudflare/workers-types@5` にアップグレード(`run_worker_first`の配列指定に旧v3が非対応だったため)

### D1データベース作成・スキーマ適用
| DB | database_id | ローカルマイグレーション | リモートマイグレーション |
|---|---|---|---|
| `monpass-db`(本番) | `c5e14a76-691a-45f6-8406-453c1312678b` | ✅ | ✅ |
| `monpass-db-staging` | `419d2129-0d04-4f09-9a34-5a82094351f5` | ✅ | ✅ |

- `wrangler.jsonc` に両方の`database_id`を反映済み
- `wrangler deploy --dry-run` で設定・アセット読み込み・バインディングの妥当性を確認済み

### シークレット・初期管理者アカウント
- `JWT_SECRET` を本番・staging用にそれぞれ別のランダム値で `wrangler secret put` 設定済み
- 初期管理者アカウント(ID: `admin`)を`staff`テーブルへbcryptjsハッシュ付きで直接シード(本番/staging × ローカル/リモートの4環境すべて)。パスワードはユーザーに一度だけ提示済み(記録なし)
- ※ 旧`.env.example`の`ADMIN_ID`/`ADMIN_PASSWORD`(起動時自動生成の仕組み)は新実装では使っていない。管理者追加は今後`/admin/staff`経由で行う想定

### 認証(`/auth/*`)の実装・動作確認
- `src/lib/config.ts` — Bindingsから設定値を読む`getConfig()`
- `src/lib/jwt.ts` — `jose`によるHS256 JWT発行/検証。`main.py`と同じクレーム形状(`{sub, role, iat, exp[, promoted]}`)、`today_midnight_utc()`(スタッフ/管理者は当日23:59:59失効)を再現
- `src/lib/login-lockout.ts` — `login_failures`テーブルによるロックアウト(10回失敗で30分ロック)をそのまま移植
- `src/middleware/auth.ts` — `requireStudent` / `requireStudentOrPromoted` / `requireStaffOrAdmin` / `requireAdmin` / `requirePromoteApprover`(Honoミドルウェア)。エラーメッセージは`main.py`の各`require_*`と1対1で対応(`/promote/approve`固有の「昇格承認権限がありません」も専用ミドルウェアで再現)
- `src/routes/auth.ts` — `POST /auth/login`, `POST /auth/staff/login` を実装
- `src/routes/{ticket,promote}.ts` — 各ルートに対応する認可ミドルウェアを配線済み(ハンドラ本体は引き続き501スタブ)
- `src/routes/admin.ts` — `adminRoutes.use("*", requireAdmin)` でグループ全体を保護
- **動作確認済み(`wrangler dev` + ローカルD1)**:
  - 管理者ログイン成功→JWT発行、パスワード誤り→401、無トークンで保護ルートへ→401「認証が必要です」
  - 管理者トークンで`/admin/dashboard`(スタブ)へ到達→501が返る(認可は通過)
  - 10回連続ログイン失敗→11回目でロックアウトメッセージ確認

### チケット(`/ticket/*`)の実装・動作確認
- `src/lib/ids.ts` — `tokenUrlsafe()`(Pythonの`secrets.token_urlsafe`相当、Web Crypto実装)
- `src/lib/html.ts` — `htmlEscape()`(Pythonの`html.escape`相当。guest_nameのXSS対策としてサーバー側エスケープを踏襲)
- `src/lib/settings.ts` — `getIssuePeriod()`(settingsテーブルからQR発行期間取得)、`todayIso()`
- `src/routes/ticket.ts` — 7ルートすべて実装(`issue`, `list`, `delete`, `scan`, `scan/:id/cancel`, `cache`, `sync`)。レスポンスから`qr_image`/`qr_url`/`qr_content`を完全に排除(§4の方針どおりクライアント側描画に変更、バックエンドはチケットデータのみ返す)
- `MAX_TICKETS`を実際に効く設定値として使用(旧main.pyではハードコード5枚だったバグを修正)
- `/ticket/scan`・`/ticket/sync`は`BEGIN IMMEDIATE`の代わりに`UPDATE ... WHERE used=0`の条件付きUPDATE+`meta.changes`判定で実装。エラー文言は`main.py`とバイト同一
- **動作確認済み(`wrangler dev` + ローカルD1)**:
  - 生徒ログイン→チケット発行(`<script>`を含むguest_nameが正しくHTMLエスケープされることも確認)→一覧表示
  - スタッフによるスキャン成功→同一チケットの再スキャンで409「入場済みチケットです」→存在しないチケットで404→キャンセル後の再スキャン成功
  - **最重要検証**: 同一チケットに対する5並列スキャンで**1件のみ200成功・残り4件409**を確認(`test_TC_13_003_concurrent_scans_no_duplicate_entry`が要求する並行性保証をローカルMiniflare D1上で確認。本番相当の負荷検証はPLAN.md リスク#1のとおりステージングの実D1で別途必要)
  - `/ticket/cache`・`/ticket/sync`(競合検出・not found検出含む)も想定どおり動作

### 昇格(`/promote/*`)の実装・動作確認
- `src/routes/promote.ts` — 3ルート実装(`request`, `approve`, `list`)。`/promote/request`は`qr_image`を返さず`qr_content`のみ(クライアント側描画、PLAN.md §4)
- `/promote/approve`のエラーメッセージ・ステータス(400無効トークン/409使用済み)は`main.py`とバイト同一
- **動作確認済み**: 昇格リクエスト発行→管理者による承認→`promoted:true`のJWT発行確認→**同一トークンの再利用は409で拒否**→昇格生徒が`requireStaffOrAdmin`保護下の`/ticket/scan`にアクセスできることまで確認(昇格ロジックの本質部分)→`/promote/list`で承認済み一覧を確認

### QRコードのクライアント側描画(`student-qr.js`)
- `public/index.html` — `qrcode`(npm)ライブラリをESモジュールとしてjsdelivrの`+esm`エンドポイントから読み込み、`window.QRCode`に割り当て。読み込み完了を`window.QRCodeReady`(Promise)で待機できるようにし、通信が不安定な現地環境でも安全に使えるようにした
  - **発見・修正したバグ**: 当初指定していた`/build/qrcode.min.js`というCDNパスは404だった(このnpmパッケージはブラウザ向けグローバル公開ビルドを持たず、CJS/ESM専用)。実際にCDNへfetchして存在確認・エクスポート内容(`toCanvas`/`toDataURL`)を検証した上で`+esm`変換パスに修正済み
- `public/static/js/pages/student-qr.js` — 全面書き換え。`t.qr_image`(サーバー生成base64 PNG)への依存を排除し、`<canvas>`+`QRCode.toCanvas()`でクライアント側描画に変更
  - `ticketCard()` — QR用`<canvas>`プレースホルダーを出力、`renderTicketQrCodes()`が`innerHTML`挿入後に実描画
  - `openQrModal(ticketId)` / `saveQr(ticketId)` — 旧実装はbase64画像やゲスト名をonclick属性に直接埋め込んでいたが、`currentTickets`配列からIDで引く方式に変更(埋め込み文字列の破損リスクを排除)
  - `buildTicketPng(t)` — `main.py`の`make_qr_base64()`のレイアウト(招待者/発行者/発行日ヘッダー+区切り線+QR)をCanvas 2Dで再現し、保存用PNGを合成
  - `requestPromotion()` — `data.qr_content`から昇格QRをcanvas描画
  - 未使用だった`generateQrDataUrl()`スタブは削除
- **検証状況**: ユーザーが手動でローカル動作確認済み(QR描画OK)

### 管理者機能(`/admin/*`)の実装・動作確認
- `src/lib/csv.ts` — `decodeCsvBytes()`(`encoding-japanese`によるエンコーディング自動判定、main.pyのutf-8-sig→utf-8→shift_jis→cp932の順次試行チェーンを置き換え)、`parseCsv()`(RFC4180準拠の自前CSVパーサー)、`toCsvRow()`/`csvResponse()`(UTF-8 BOM付きCSVレスポンス、`make_csv_response`相当)
- `src/lib/password.ts` — `generateAlnumPassword()`(Web Crypto版の英数字8桁パスワード生成)
- `src/routes/admin.ts` — 22ルートすべて実装(dashboard, tickets CRUD, students CRUD, パスワードリセット, CSVインポート/エクスポート×2種, staff CRUD, settings)。グループ全体に`requireAdmin`を適用
- `last_import_passwords`は`app.state`(プロセスメモリ)からD1テーブルへ移行(インポートの都度DELETE→INSERT)
- **発見・修正した実バグ**: D1はデフォルトで外部キー制約を強制する(元のSQLite/main.pyは`PRAGMA foreign_keys`を設定しておらず実質無効)。管理者による使用済みチケットの強制削除・生徒削除(チケット連鎖削除)が、`offline_scan_queue`の外部キー制約でエラーになることをテスト中に発見。該当箇所で`offline_scan_queue`の関連行を先に削除するよう修正済み
- **動作確認済み(`wrangler dev` + ローカルD1)**:
  - 生徒CRUD(作成・重複409・一覧・パスワードリセット)、ダッシュボード集計
  - **CSVインポート**: UTF-8(日本語ヘッダー含む、`sample_students.csv`実データ20件)と**Shift_JIS**(同データをiconv変換)の両方で文字化けなく正しくインポートできることを確認(risk #3の実証)
  - パスワード一覧CSV・スタッフCSV・チケットCSVエクスポート(UTF-8 BOM付き)
  - 設定更新(発行期間)
  - 使用済みチケットの強制削除・生徒削除のカスケード(FK修正の検証)

### Stagingデプロイ(PLAN.md §8 フェーズ2)
- `monpass-staging.hide23.link` をCustom Domainとして`monpassc-staging` Workerにアタッチ・デプロイ済み(ユーザー承認済み)
  - **判明した制約**: `workers.dev`のプレビューURLはWARP/1.1.1.1 DNS経由の環境からは`error 1042`でアクセス不可(Cloudflareのworkers.dev固有のループ防止機構)。カスタムドメインでは発生しないため、今後の動作確認は基本的にカスタムドメイン経由で行う
- `wrangler.jsonc`のstaging envに`routes`(custom_domain)を追加、`DOMAIN`変数も`monpass-staging.hide23.link`に更新
- **最重要検証(PLAN.md リスク#1の解消)**: `monpass-staging.hide23.link`(Miniflareではなく実際のCloudflare D1)に対して同一チケットへ10並列スキャンを実行し、**1件のみ200成功・残り9件409**を確認。条件付きUPDATEによる同時実行制御が本番相当インフラでも機能することを実証済み

### Vitestテストスイート
- `vitest.config.ts` + `@cloudflare/vitest-pool-workers`(Miniflare上のD1で実行)をセットアップ
- `test/helpers.ts`(生徒/スタッフseed、ログイン、認証付きfetchのヘルパー)、`test/env.d.ts`(ProvidedEnv型)、`test/apply-migrations.ts`(D1マイグレーション自動適用)
- `test/auth.test.ts`(7件)・`test/ticket.test.ts`(9件、**10並列スキャンで1件のみ成功する回帰テスト含む**)・`test/promote.test.ts`(2件)・`test/admin.test.ts`(8件、UTF-8/Shift_JIS CSVインポート・FK連鎖削除の回帰テスト含む) — **計26件、全て成功**
- **発見・修正した設定不整合**: `@cloudflare/vitest-pool-workers`は内部に古いwrangler(3.109.1)をバンドルしており、`run_worker_first`の配列指定(新しいwrangler 4系の機能)をパースできずテストが起動不能だった。`run_worker_first: true`(bool)に戻し、`src/index.ts`に明示的な`ASSETS`フォールバックルート(`app.get("*", c => c.env.ASSETS.fetch(c.req.raw))`)を追加する形に変更(本番デプロイ・staging両方で再検証し問題ないことを確認済み)
- **発見・修正した別の不整合**: `encoding-japanese`のデフォルトエントリ(`src/index.js`)は`require('../package.json')`を実行するが、vitest-pool-workersのworkerdベースモジュールローダーではこれが解決できずテストがクラッシュしていた(wranglerの実デプロイでは問題なし)。自己完結型のバンドル版(`encoding-japanese/encoding.js`)に切り替えて解決(型定義はアンビエント宣言`src/lib/encoding-japanese-bundle.d.ts`で補完)

### 本番Custom Domainアタッチ
- ユーザーの明示指示により、**本番`monpass.hide23.link`を実際にCustom Domainとしてアタッチしデプロイ済み**(まだ実運用データはなく現在未使用のドメインだったため)
- `wrangler.jsonc`のトップレベルに`routes`(custom_domain)を追加
- デプロイ直後は`ASSETS`バインディングの反映に数秒〜十数秒のタイムラグがあり、その間`/`アクセスが一時的に500(Cloudflare error 1101)になる現象を確認(API側の`/health`等は即座に正常動作)。20秒程度待って再確認し、SPA・API両方とも正常動作を確認済み
- **注意**: これで`monpass.hide23.link`は実際に本番D1(`monpass-db`)に繋がった状態で稼働している。管理者アカウント(`admin`)は稼働中。テスト用の生徒データ等は投入していない

### Playwright E2Eテストスイート
- `playwright.config.ts` — `wrangler dev`(ローカルD1)をwebServerとして自動起動、`e2e/global-setup.ts`で専用のe2eテスト管理者アカウントを冪等シード
- `e2e/helpers.ts` — 生徒/スタッフseed(管理者API経由)、UIログインヘルパー
- ポート済みファイル: `routing.spec.ts`(7件)・`student-login.spec.ts`(9件)・`staff-login.spec.ts`(5件)・`qr.spec.ts`(9件、**サーバー側QR画像廃止に伴い`img`→`canvas.qr-canvas`セレクタへ適応**)・`scan.spec.ts`(6件)・`admin-dashboard.spec.ts`(7件) — **計43件、全て安定して成功**(元のPython版17ファイルのうち代表的な6ファイル相当を移植。fe07以降の管理画面詳細・fe08-17の細部は未移植)
- **発見・修正した問題(tsconfig)**: `test/`・`e2e/`ディレクトリが`tsconfig.json`の`include`に入っておらず、`tsc --noEmit`が実質何もチェックしていなかった(vitestはesbuildで型チェックなしに実行されるため見た目上テストは通っていた)。Workers向け(`tsconfig.json`、DOM型なし)とブラウザ向け(`e2e/tsconfig.json`、DOM型あり)を分離して両方を実際にチェックするよう修正
- **発見した実行時の不整合**: `cloudflare:test`型・`__dirname`(ESMでは未定義)・vitestが`e2e/*.spec.ts`を誤って拾う問題、をそれぞれ修正
- **発見した並列実行時のflaky挙動**: 5並列で実行すると、単一の`wrangler dev`インスタンス+外部CDN(qrcodeライブラリ)への同時アクセスが原因と見られるタイムアウトが低頻度で発生。`workers: 3`に制限し、ダッシュボードの初期値("-")待ちを`waitForFunction`で確実に待つよう修正して安定化

## 未着手・次のステップ

- [ ] `/Users/hide/MONpass/data/gakuensai.db` からのデータ移行(現状はdev用小規模データ、実データの所在確認が必要)
- [ ] Cloudflare Access の `/admin/*` 保護設定(Cloudflare側・ユーザー作業、メールリストの準備が必要)
- [ ] Playwright E2E: 未移植の`test_fe07`(admin-tickets)以降・`test_fe08_to_14`・`test_fe15_new_features`・`test_fe17_qr_csv`(細かいUIケース、必要になったら追加)
- [ ] Vitest: `test_tc03`(QR発行の詳細)・`test_tc06`(admin)・`test_tc08`(offline)等、未カバーな細かいテストケースの追加(現状は主要フローの26件のみ)

詳細な設計判断・リスクは [`PLAN.md`](./PLAN.md) を参照。

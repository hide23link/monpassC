# MONpass Cloudflare移行プラン

## Context

MONpassは学園祭入場管理システム(FastAPI + SQLite、`/Users/hide/MONpass`)。現状はローカル/自前サーバー(Nginx+uvicorn)で稼働しており、DBもSQLiteファイル(`./data/gakuensai.db`)。運用上、cronでのSQLiteバックアップや手動DR切替など自前の可用性対策が必要になっている。

方針転換として、これをすべてCloudflare上に移行し、`monpass.hide23.link` で稼働させたい。DBも含めて完全にCloudflareに寄せることで、D1の自動バックアップ(Time Travel)やWorkersのゼロダウンタイムデプロイ等、自前運用の負担を減らすのが狙い。管理者は数名のみで、Cloudflare Access(メールOTP)のリストはユーザー側で用意する。

現状データはdev/テスト用の小規模データ(生徒2件・チケット5件・スタッフ1件、確認済み)。本番投入前に実データの所在を確認する必要がある(リスク参照)。

**確定済みの前提(ユーザー確認済み):**
1. Cloudflare Access(メールOTP・管理者数名)は **`/admin/*` APIルートのみ** を保護する。スタッフ・生徒は既存のID/パスワード+JWTログインのまま(Accessの対象外)。
2. 既存の生徒/スタッフのbcryptハッシュ済みパスワードは **そのまま引き継ぐ**(強制リセットしない)。

---

## 1. ターゲットアーキテクチャ

単一のCloudflare Workersプロジェクトで、APIと静的アセットの両方を配信する(Cloudflare Pagesは使わない。同一オリジンなのでCORS設定も不要)。

| 現状 | 移行先 |
|---|---|
| FastAPI (Python) | **Hono** (TypeScript, Workers用ルーターFW) |
| SQLite (`./data/gakuensai.db`) | **D1** (`monpass-db`) |
| `static/` を uvicorn/StaticFiles配信 | **Workers Static Assets** binding(同一Worker) |
| `app.state.last_import_passwords`(プロセスメモリ、既に多workerで壊れている) | D1テーブル `last_import_passwords`(新設) |
| cronでのSQLiteバックアップ(外部運用) | D1 Time Travel(30日PITR)+ Cron Triggerで定期CSVをR2へ(補助) |
| Nginx+uvicorn (VM) | Workers Custom Domain: `monpass.hide23.link` |
| `.env` | `wrangler secret`(JWT_SECRET, ADMIN_PASSWORD等)+ `wrangler.jsonc` の `vars` |

Honoを選ぶ理由: `main.py`はほぼ全ルートが1ファイルにフラットに並んでおり、Honoの `app.route()` によるグルーピング(auth/ticket/admin/promote)がFastAPIの構造に最も近く、1:1移植のリスクが小さい。

**修正すべき既存バグ(移行時に直す、そのまま引き継がない):**
- `.env.example` は `ISSUE_START`/`ISSUE_END` と書いているが、`main.py`の`get_config()`は実際には`ISSUE_START_DATE`/`ISSUE_END_DATE`を読んでいる(main.py該当箇所)。Workers側は正しい名前で統一する。
- `MAX_TICKETS` は宣言されているが未使用(5枚上限は`/ticket/issue`にハードコード)。実際に効く設定値にする。
- `POST /ticket/sync` は `/ticket/scan` と違い `BEGIN IMMEDIATE` を使っておらず、実は競合状態のバグがある(§3で修正)。

---

## 2. D1スキーマ・データ移行

既存7テーブル(`students`, `tickets`, `staff`, `temp_promotions`, `offline_scan_queue`, `settings`, `login_failures`)をそのままD1に移す。カラム名・型は現行踏襲(INTEGER 0/1、日時はISO8601 TEXT、D1にBOOLEAN/DATETIME型はないため変換不要)。

追加するもの:
- インデックス: `idx_tickets_student_id`, `idx_tickets_used`, `idx_tickets_is_valid`, `idx_tickets_created_at`, `idx_tickets_used_at`, `idx_temp_promotions_token`, `idx_offline_queue_ticket_id`(1000生徒/6000チケット規模でのクエリ性能のため)
- 新テーブル `last_import_passwords(student_id, password, name, class, imported_at)` — `app.state.last_import_passwords`の置き換え

**移行手順:**
1. D1に `CREATE TABLE`/`CREATE INDEX` をスキーマ適用(`wrangler d1 execute monpass-db --file=schema.sql`)
2. `/Users/hide/MONpass/data/gakuensai.db` から各テーブルを `INSERT INTO ... VALUES` 形式でエクスポート(`login_failures`・`offline_scan_queue`は運用中の一時状態なので移行対象から除外、クリーンな状態で開始)
3. `wrangler d1 execute monpass-db --file=data_export.sql` でインポート
4. 検証: 全テーブルの行数比較、bcryptハッシュの実ログイン確認(既存平文パスワードで新Workerにログインできるか — 移行の中で最もリスクが高い検証項目)、`tickets.student_id`→`students.id`の孤立FK確認、`settings`の`issue_start`/`issue_end`存在確認
5. 元の`gakuensai.db`は本番切替後もロールバック用に保持(D1 Time Travelの30日+猶予期間分)

---

## 3. バックエンド移植(エンドポイント別)

`main.py`の約40ルートをHonoに機能単位で移植。ロジック変更が必要な箇所のみ記載。

**認証 (`/auth/login`, `/auth/staff/login`)**
- bcrypt検証はPython `bcrypt` → **`bcryptjs`**(pure-JS、`$2a$`/`$2b$`互換)に置換。既存ハッシュをそのまま検証できるかは移行時に実ログインで確認必須。
- JWT(HS256, `{sub, role, iat, exp[, promoted]}`)は `jose` または `hono/jwt` で同一クレーム構造を再現。`JWT_SECRET`は新規発行するため、切替時に全ユーザー再ログインが必要になる(スタッフ/管理者はどのみち当日限り失効のため実害小)。
- ログインロックアウト(10回失敗で30分ロック、`login_failures`テーブル)はロジックそのまま移植。

**チケット (`/ticket/*`)**
- `POST /ticket/issue`, `GET /ticket/list`: QR画像生成(`qr_image`)をレスポンスから完全に削除し、チケットデータのみ返す(§4)。`GET /ticket/list`は現状チケットごとにPillowでQR画像を毎回生成しておりこれが最も重い処理だったため、削除により大幅高速化が見込める。
- `POST /ticket/scan`(**最重要・最高リスク**): 現状は `BEGIN IMMEDIATE` で書き込みロックを取ってから読み書きし、「同時スキャンでも1件のみ成功」を保証している(`tests/test_tc13_load.py`の`test_TC_13_003_concurrent_scans_no_duplicate_entry`、5並列スレッドで1件のみ成功、が正の担保テスト)。D1では明示的なロックAPIがないため、**単一のatomicな条件付きUPDATE**に置き換える:
  ```sql
  UPDATE tickets SET used=1, used_at=? WHERE id=? AND is_valid=1 AND used=0
  ```
  変更行数(`meta.changes`)で成否判定し、0件なら理由(未発見/無効/使用済み)をSELECTで判定してエラーメッセージを返す。エラー文言(「無効なチケットです (invalid ticket)」400、「入場済みチケットです (already used)」409)は`main.py`の実際の文言(709-714行付近、確認済み)と**バイト同一**に保つこと — `staff-scan.js`のエラー文字列マッチング(`msg.includes('入場済み')`等)が依存しているため。
- `POST /ticket/sync`(オフライン同期・**既存バグの修正対象**): 現状は`/ticket/scan`と違いロックなしのread-then-writeで、複数端末が同時に同じチケットを同期すると二重成功しうる実バグがある。同じ条件付きUPDATEパターンで修正する。
- Durable Objectsは不要と判断(D1の行単位アトミック更新で「1台のみ成功」要件を満たせるため)。

**プロモーション (`/promote/*`)**
- `POST /promote/request`のQR画像もクライアント側生成に変更(§4)。
- `GET /promote/list`は管理者専用だが`/admin/*`配下にないため、Cloudflare Accessの保護対象にするには`/admin/promotions/list`へ移動するか、Accessの対象パスに個別追加する必要がある(要対応、§5参照)。

**管理者 (`/admin/*`)**
- 20ルートはロジックそのまま移植(すべて`require_admin`、単純なCRUD/集計、QR生成なし)。
- CSV文字コード自動判定(utf-8-sig/utf-8/shift_jis/cp932)は `nodejs_compat`互換フラグ + **`encoding-japanese`**(pure-JS)で再現。実際のShift_JIS/CP932 CSV(Excel出力想定)で動作確認が必要(リスク参照)。
- `last_import_passwords`はD1テーブル操作に置換(§2)。

---

## 4. QRコード生成の再設計(クライアント側へ移行)

Cloudflare WorkersはPillowもOSフォントファイル読み込みも実行できないため、最も大きな設計変更が必要な箇所。

- QR生成ライブラリ: JS版 **`qrcode`** npmパッケージ(canvas描画、CDNまたは`static/js/vendor/`にバンドル)
- QRペイロード内容は変更なし(`https://monpass.hide23.link/scan/{ticket_id}`という文字列)。ただしこれはクライアント側で`location.origin + '/scan/' + ticket_id`として自前生成し、バックエンドは`qr_image`/`qr_url`をレスポンスに含めない。
- チケットカードのレイアウト: 現状は1枚のPNG画像に文字(招待者/発行者/発行日/フッター)をPillowで焼き込んでいたが、移行後はQRの`<canvas>`要素とHTML/CSSのテキスト要素を並べる構成に変更(`student-qr.js`の`ticketCard()`は既にラベル要素を別途DOM配置しているため、これに寄せる形)。
- 「画像として保存」機能(`saveQr()`)は、QRをcanvasに描画後、`ctx.fillText()`で日本語ラベルを合成し`canvas.toDataURL('image/png')`でPNG化する形に変更(現在の`make_qr_base64()`のレイアウト計算をJS Canvas 2Dに移植)。日本語フォントはブラウザのシステムフォント(`"Noto Sans JP", sans-serif`)に依存すればよく、フォントファイルのバンドルは不要。
- `student-qr.js`内の未使用スタブ`generateQrDataUrl()`(228-244行、実際のQR生成はしていないダミー関数)は削除し、実装に置き換える。

---

## 5. Cloudflare Access統合

**方針: Accessは`/admin/*`のAPIルートの前段に置き、既存のスタッフ/管理者ログイン(ID/パスワード+JWT)は廃止せず併用する。**

理由:
- Access(メールベース)は`staff`テーブルの`role`列や`staff.id`(監査証跡・`promoted_by_id`等)と直接マッピングできない。既存の認可モデル(`require_admin`)を失うと内部ロジックの作り直しが必要になる。
- ローカル開発・テスト(`wrangler dev`/Vitest)ではAccessをシミュレートできないため、アプリ側の認証は独立して動作する必要がある。

**重要な制約(要ユーザー確認):** 現行フロントエンドはハッシュルーター(`#/admin/...`)のため、`#/admin/dashboard`のようなSPA内パスはサーバーには`GET /`としてしか届かず、Accessでは区別できない。したがって:
- Accessの保護対象は実際のHTTPパスが分離している **`/admin/*` APIルート**(`/admin/dashboard`, `/admin/tickets`等)にのみ設定する。
- 管理画面のUI「殻」自体(`index.html`)は誰でもロードできるが、データ取得APIがAccessでブロックされるため実質的にデータは保護される(UI表示のガードは引き続きフロントエンドのJWTチェックが担う)。
- `GET /promote/list`は`/admin/`配下にないため、`/admin/promotions/list`へ移動するか個別にAccess対象パスへ追加する。

Accessが検証済みリクエストのみをWorkerまで通すため、Worker側でCF_Authorizationトークンを検証する必要は必須ではない(将来的な多層防御として追加は可能)。

---

## 6. フロントエンド移植

`static/`はほぼ変更不要(最もリスクが低い領域)。

- `api.js`: 変更なし。相対パス+同一オリジン前提の設計が、単一Worker構成にそのまま適合。
- `main.py`の`spa_root()`にあるキャッシュバスティング用のJS URL書き換え(`?v=timestamp`)+`Cache-Control: no-store`は**削除**。Workers Static Assetsが自動でコンテンツハッシュベースのフィンガープリンティング/キャッシュを行うため不要かつ非効率。
- `router.js`: ハッシュルーターのため変更不要。
- `student-qr.js`: §4のQR生成変更箇所(`ticketCard()`, `issueTicket()`, `requestPromotion()`, `saveQr()`, 未使用の`generateQrDataUrl()`削除)。
- `staff-scan.js`: IndexedDBオフラインロジック自体は変更不要(純粋にクライアント側)。バックエンドのエラー文言が変わるとここの文字列マッチングが壊れるため、§3のバイト同一要件を厳守。
- `index.html`: 新たに`qrcode`ライブラリの`<script>`タグを1本追加するのみ。

---

## 7. テスト戦略

- バックエンド: `tests/test_tc01_auth.py`〜`test_tc13_load.py`(pytest)を**Vitest + `@cloudflare/vitest-pool-workers`**(Miniflare上のD1)へ概念移植。最優先で緑にすべきは`test_tc13_load.py`の`test_TC_13_003_concurrent_scans_no_duplicate_entry`(§3の条件付きUPDATE実装の正当性を担保する唯一のテスト)。
- CSV文字コード関連(`test_tc02_csv_import.py`, `test_tc10_csv_export.py`)は`encoding-japanese`置換の妥当性を確認する意味でも優先度高。
- E2E: `tests/e2e/`(Playwright)は`wrangler dev`→デプロイ済みステージング環境へbase URLを差し替えて再利用。`test_fe04_qr.py`等QR関連はAPIレスポンスの`qr_image`検証からクライアント描画結果の検証へ変更が必要。Access有効化後は`/admin/*`系E2E用にサービストークンの検討が必要(未認証Playwrightがブロックされるため)。

---

## 8. 切替(カットオーバー)計画

現地イベント(学園祭当日)のゲート運用を支えるシステムのため保守的に進める。

1. **ローカル検証**: `wrangler dev`でHono/D1実装をMiniflare上で稼働、Vitestスイートを緑にする。全ページの手動スモークテスト。
2. **ステージングデプロイ**: 本番とは別のWorker+D1(例: `monpass-staging`)にデプロイし、Playwright E2Eを実行。`/ticket/scan`の条件付きUPDATEは**実際のD1**(Miniflareではなく)で同時アクセス負荷テストを行う(最大の技術的リスク箇所)。Cloudflare Accessもステージングで先に検証。
3. **データ移行ドライラン**: 現行`gakuensai.db`のコピーをステージングD1へ移行し、§2の検証チェックリストを実施。本番相当データ(実際の生徒約1000名分)が別途存在する場合はそちらでも実施すること。
4. **DNS切替**: 本番D1への実データ移行→Workerを本番デプロイ→`monpass.hide23.link`をCustom Domainとしてアタッチ。切替直前に旧サーバーへの書き込みを短時間フリーズしてから最終エクスポートを取る(データギャップ防止)。切替直後に検証チェックリストと本番URLでのスモークテストを再実施。
5. **旧サーバー廃止**: 切替後もイベント終了+猶予期間(1〜2週間目安)は旧サーバーを起動可能な状態で残し、`gakuensai.db`もD1 Time Travel期間(30日)+猶予分はアーカイブ保持。

**ロールバック方針**: 切替は学園祭当日のゲートオープン**前**に完了させ、実データがD1に入る前ならDNS/Custom Domainを旧サーバーへ戻すだけで安全にロールバックできる。イベント進行中の切替は極力避ける(切替後にDBが分岐すると手戻りが困難なため)。

---

## 9. 残る未確認事項・リスク

1. `/ticket/scan`の条件付きUPDATEは、実際のD1が高同時実行下(ゲート混雑時に複数端末が同時スキャン)でも同じ「1台のみ成功」保証を持つか、実D1での負荷テストで確認が必要(Miniflareのシミュレーションだけでは不十分)。
2. `bcryptjs`と既存Python `bcrypt`ハッシュの互換性・パフォーマンス(コストファクタとWorkers CPU時間制限の兼ね合い)は移行時に実ログインで検証必須。
3. `nodejs_compat` + `encoding-japanese`によるShift_JIS/CP932判定が、Excel出力等の実際のCSVで現行の判定チェーン(utf-8-sig→utf-8→shift_jis→cp932)と同等に動くか要検証。
4. Cloudflare Accessはハッシュルーターの都合上、管理画面UIの「殻」自体は保護できず`/admin/*` APIのみ保護できる(§5)。この制約をユーザーが許容できるか要確認(質問済みで「管理者ダッシュボードのみ」を選択済みだが、API限定という技術的制約自体は要認識合わせ)。
5. `hide23.link`ゾーンが既にCloudflare管理下にある前提(過去のCloudflare移行実績あり)。前提が崩れていないか着手前に確認。
6. 現在の`gakuensai.db`は開発用の小規模データ(生徒2件・チケット5件・スタッフ1件、確認済み)。実際の学園祭用データ(約1000名規模)がどこにあるかを本番移行前に特定する必要がある。
7. D1へのバルクインポート時のステートメント/バッチ数上限は、1000生徒/6000チケット規模で問題ない見込みだが、実際にドライランで確認する(§8フェーズ3)。

---

## 主要ファイル(実装時の参照先)

- `/Users/hide/MONpass/main.py` — 現行バックエンド全体(全ルート・スキーマ・認証・QR生成)。Hono/D1移植の1次ソース
- `/Users/hide/MONpass/data/gakuensai.db` — 移行元DB(現状dev規模データ、本番データの所在を要確認)
- `/Users/hide/MONpass/static/js/pages/student-qr.js` — QR発行/表示/保存ロジック(クライアント側再設計対象)
- `/Users/hide/MONpass/static/js/pages/staff-scan.js` — オフライン同期/IndexedDBロジック、エラー文言の依存関係あり
- `/Users/hide/MONpass/tests/test_tc13_load.py` — `BEGIN IMMEDIATE`→D1条件付きUPDATE移行の正当性を担保する並行性テスト
- `/Users/hide/MONpass/.env.example` — 現行設定項目(`ISSUE_START`/`ISSUE_END`バグを含む)、新設定への対応表作成に使用
- `/Users/hide/MONpass/tests/conftest.py` — pytestフィクスチャ、Vitest+Miniflare D1シード処理への移植元

---

## 検証方法

- バックエンド: 移植後、Vitestスイート(ポート済み`test_tc01`〜`test_tc13`)を`wrangler dev`上で実行し全緑を確認
- 並行性: `test_TC_13_003_concurrent_scans_no_duplicate_entry`相当のテストを実D1(ステージング)に対しても実行し「同時スキャンでも1件のみ成功」を確認
- E2E: Playwrightスイートを`wrangler dev`→ステージングデプロイの順に実行
- 手動: 生徒ログイン→QR発行→一覧表示→削除、スタッフログイン→スキャン→オフライン切替→同期、管理者ログイン→ダッシュボード→CSVインポート/エクスポート→設定変更、をブラウザで一通り確認
- データ移行: §2の検証チェックリスト(行数比較・bcryptログイン確認・FK孤立チェック・settings確認)をステージングと本番の両方で実施

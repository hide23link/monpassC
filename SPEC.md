# MONpass 仕様書（Cloudflare Workers版）

学園祭入場管理システム。Cloudflare Workers + Hono + D1 上で完結して稼働する。
本書は完成時点での仕様を記述する参照ドキュメント。移行の経緯・意思決定の背景は [`PLAN.md`](./PLAN.md)、実装の進行ログは [`PROGRESS.md`](./PROGRESS.md) を参照。

- 本番URL: `https://monpass.hide23.link`
- Cloudflareアカウント: `<Cloudflareアカウントのメールアドレス・非公開>`

---

## 1. システム概要

生徒が入場QRチケットを自分で発行し、会場入口でスタッフ・管理者がQRをスキャンして入場処理を行う。想定規模は生徒約1000名・チケット最大6000枚程度。

登場人物（ロール）:

| ロール | できること | ログイン方法 |
|---|---|---|
| 生徒 (`student`) | 自分のQRチケット発行（最大5枚）・一覧・削除、スタッフへの一時昇格リクエスト | 学籍番号 + パスワード |
| スタッフ (`staff`) | QRスキャンによる入場処理、来場状況閲覧、自分のスキャン履歴閲覧 | スタッフID + パスワード |
| 管理者 (`admin`) | 上記全部 + 生徒/スタッフ/チケットのCRUD、CSVインポート/エクスポート、発行期間設定、ダッシュボード集計 | スタッフID + パスワード（`staff`テーブルの`role='admin'`） |
| 昇格生徒 (`student` + `promoted:true`) | 生徒が当日限定でスタッフ相当の権限（QRスキャン）を得た状態 | 生徒QR→スタッフ/管理者/他の昇格生徒がスキャンして承認 |

---

## 2. アーキテクチャ

単一の Cloudflare Workers プロジェクトが API と静的アセットの両方を同一オリジンで配信する（Cloudflare Pagesは不使用、CORS設定は不要）。

```
ブラウザ (SPA, ハッシュルーター)
   │  fetch（相対パス, 同一オリジン）
   ▼
Cloudflare Workers（Hono）
   ├─ /health                     ヘルスチェック
   ├─ /auth/*                     ログイン（生徒・スタッフ/管理者共通）
   ├─ /ticket/*                   チケット発行・一覧・スキャン・オフライン同期
   ├─ /promote/*                  スタッフ一時昇格
   ├─ /admin/*                    管理者専用CRUD（Cloudflare Access保護）
   └─ * (catch-all)                ASSETS binding にフォールバック（SPA/静的ファイル）
        │
        ▼
   D1 (`monpass-db`)               生徒/チケット/スタッフ/設定などを格納
```

| レイヤ | 技術 |
|---|---|
| ルーティング/HTTPフレームワーク | [Hono](https://hono.dev/) 4.x |
| データベース | Cloudflare D1（SQLite互換） |
| 静的アセット配信 | Workers Static Assets binding（`run_worker_first`でAPIパスを優先） |
| 認証トークン | JWT (HS256, `jose`ライブラリ) |
| パスワードハッシュ | `bcryptjs`（`$2a$`/`$2b$`互換、コストファクタ10） |
| CSV文字コード判定 | `encoding-japanese`（UTF-8/UTF-8 BOM/Shift_JIS/CP932を自動判定） |
| QRコード生成 | `qrcode`（クライアント側、`<canvas>`に描画。サーバーはQR画像を一切生成しない） |
| QRコード読み取り | `html5-qrcode`（クライアント側、カメラ） |
| フロントエンド | Vanilla JS（ビルドステップなし）+ Tailwind CSS（CDN）+ Chart.js（CDN） |
| オフライン動作 | IndexedDB（スタッフのスキャン画面のみ） |
| PWA | Web App Manifest + 最小限のService Worker（インストール可能にするためだけ、キャッシュ処理はなし） |
| アクセス保護 | Cloudflare Access（`/admin/*` のみ、メールOTP） |

---

## 3. ディレクトリ構成

```
monpassC/
├── wrangler.jsonc              Workers設定（バインディング、環境、カスタムドメイン）
├── package.json                 依存関係・npm scripts
├── tsconfig.json                TypeScript設定（Workers向け、DOM型なし）
├── vitest.config.ts             Vitest設定（@cloudflare/vitest-pool-workers）
├── playwright.config.ts         Playwright E2E設定
├── .dev.vars / .dev.vars.example  ローカル開発用シークレット（gitignore対象）
│
├── migrations/                  D1マイグレーション（wrangler d1 migrations）
│   ├── 0001_init.sql             初期スキーマ（7テーブル+インデックス+last_import_passwords）
│   └── 0002_scanned_by.sql       tickets.scanned_by 列の追加
│
├── src/                         バックエンド（Hono、Workers上で実行）
│   ├── index.ts                  アプリのエントリポイント・ルートマウント・ASSETSフォールバック
│   ├── env.ts                    Bindings/Variables の型定義
│   ├── routes/
│   │   ├── auth.ts                POST /auth/login, /auth/staff/login
│   │   ├── ticket.ts               /ticket/* 全ルート
│   │   ├── promote.ts              /promote/* 全ルート
│   │   └── admin.ts                /admin/* 全ルート（requireAdmin一括適用）
│   ├── middleware/
│   │   └── auth.ts                requireStudent/requireStudentOrPromoted/requireStaffOrAdmin/requirePromoteApprover/requireAdmin
│   └── lib/
│       ├── config.ts               Bindingsから設定値を読むgetConfig()
│       ├── jwt.ts                  JWT発行・検証（issueStudentToken/issueStaffToken/decodeToken）
│       ├── login-lockout.ts        ログイン失敗回数によるロックアウト
│       ├── settings.ts             QR発行期間の取得
│       ├── entry-stats.ts          入場集計ロジック（admin/dashboardとticket/statusで共用）
│       ├── csv.ts                  CSV文字コード判定・パース・BOM付きレスポンス生成
│       ├── ids.ts                  token_urlsafe相当のランダムID生成
│       ├── html.ts                 html.escape相当のXSS対策エスケープ
│       ├── password.ts             英数字8桁ランダムパスワード生成
│       └── encoding-japanese-bundle.d.ts  encoding-japaneseの自己完結ビルド用アンビエント型
│
├── public/                      静的アセット（Workers Static Assetsとして配信）
│   ├── index.html                 SPAシェル（ナビバー・#app・スクリプト読み込み・ルート登録）
│   ├── manifest.webmanifest       PWAマニフェスト
│   ├── sw.js                      最小限のService Worker（インストール可能化のみ）
│   └── static/
│       ├── css/custom.css          QR表示・スキャン結果アニメーション等の追加CSS
│       ├── icons/                  PWAアイコン（192/512/512maskable/apple-touch-icon）
│       └── js/
│           ├── api.js               fetchラッパー（JWT自動付与・401時の自動ログアウト等）
│           ├── auth.js              JWTのlocalStorage管理・ロール判定
│           ├── common.js            トースト通知・管理者共通レイアウト・緊急CSV出力
│           ├── router.js            ハッシュベースSPAルーター
│           └── pages/
│               ├── student-login.js   生徒ログイン画面
│               ├── staff-login.js     スタッフ/管理者ログイン画面
│               ├── student-qr.js      QR発行・一覧・保存・共有・スタッフ昇格リクエスト
│               ├── staff-scan.js      QRスキャン・オフライン同期・来場状況・自分のスキャン履歴
│               ├── admin-dashboard.js 集計ダッシュボード・時間帯別グラフ・昇格ツリー
│               ├── admin-tickets.js   チケット一覧・フィルタ・個別/一括操作
│               ├── admin-students.js  生徒CRUD・パスワードリセット
│               ├── admin-import.js    生徒CSVインポート（ドラッグ&ドロップ対応）
│               ├── admin-staff.js     スタッフCRUD・CSVインポート/エクスポート
│               └── admin-settings.js  QR発行期間設定
│
├── test/                        Vitestユニット/結合テスト（Miniflare上のD1で実行）
│   ├── helpers.ts                 生徒/スタッフseed・ログイン・認証付きfetchヘルパー
│   ├── apply-migrations.ts        D1マイグレーション自動適用
│   ├── env.d.ts                   ProvidedEnv型
│   ├── auth.test.ts                11件
│   ├── ticket.test.ts              19件
│   ├── promote.test.ts             7件
│   └── admin.test.ts               24件（計61件、全件成功）
│
├── e2e/                         Playwright E2Eテスト（wrangler dev をブラウザ操作）
│   ├── global-setup.ts            e2e専用管理者アカウントを冪等シード
│   ├── helpers.ts                 生徒/スタッフseed（管理者API経由）・UIログインヘルパー
│   ├── tsconfig.json              ブラウザ向け型チェック設定（DOM型あり）
│   ├── routing.spec.ts             7件
│   ├── student-login.spec.ts       8件
│   ├── staff-login.spec.ts         5件
│   ├── qr.spec.ts                  9件
│   ├── scan.spec.ts                6件
│   └── admin-dashboard.spec.ts     8件（計43件）
│
├── PLAN.md                       移行計画（背景・設計判断・リスク）
├── PROGRESS.md                   実装進行ログ（時系列の作業記録）
├── PRESENTATION.html / .pdf      非技術者向け説明資料
└── SPEC.md                       本ドキュメント
```

---

## 4. データベース（D1）設計

DB名: `monpass-db`（本番）。マイグレーションは `migrations/` 配下を `wrangler d1 migrations apply` で適用する。

### students（生徒）
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | 学籍番号 |
| name | TEXT | 氏名 |
| class | TEXT | クラス |
| password_hash | TEXT | bcryptハッシュ |
| created_at | TEXT | 作成日時（ISO8601） |

### tickets（入場チケット）
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | チケットID（`token_urlsafe(12)`） |
| student_id | TEXT FK→students.id | 発行した生徒 |
| guest_name | TEXT | 招待者名（HTMLエスケープ済みで保存） |
| is_valid | INTEGER (0/1) | 管理者による無効化フラグ |
| used | INTEGER (0/1) | 入場済みフラグ |
| used_at | TEXT | 入場日時 |
| scanned_by | TEXT | 入場処理したスタッフ/管理者/昇格生徒のID（0002で追加） |
| created_at | TEXT | 発行日時 |

インデックス: `student_id`, `used`, `is_valid`, `created_at`, `used_at`, `scanned_by`

### staff（スタッフ・管理者）
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | スタッフID |
| name | TEXT | 氏名 |
| password_hash | TEXT | bcryptハッシュ |
| role | TEXT | `staff` または `admin` |

### temp_promotions（スタッフ一時昇格）
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | 内部ID |
| promote_token | TEXT UNIQUE | QRに埋め込まれる承認用トークン |
| token_used | INTEGER (0/1) | 承認済みフラグ |
| session_id | TEXT | 申請元デバイスが`/promote/status`をポーリングする際のキー |
| student_id | TEXT FK→students.id | 昇格を申請した生徒 |
| promoted_by_type / promoted_by_id | TEXT | 承認者種別・ID（承認前は`'pending'`） |
| promoted_at | TEXT | 承認日時 |
| expires_at | TEXT | 昇格トークンの有効期限（当日23:59:59 UTC） |

### offline_scan_queue（オフラインスキャン記録）
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | 内部ID |
| ticket_id | TEXT FK→tickets.id | 対象チケット |
| scanned_at | TEXT | 端末側で記録したスキャン時刻 |
| session_id | TEXT | 端末セッションID（`sessionStorage`起源） |
| synced | INTEGER (0/1) | サーバー同期済みフラグ |
| synced_at | TEXT | 同期日時 |
| conflict | INTEGER (0/1) | 同期時に既に使用済みだった等の競合フラグ |

### settings（アプリ設定）
| 列 | 型 | 説明 |
|---|---|---|
| key | TEXT PK | 設定キー（`issue_start`, `issue_end`） |
| value | TEXT | 値 |

### login_failures（ログイン失敗カウンタ）
| 列 | 型 | 説明 |
|---|---|---|
| user_key | TEXT PK | `student:{id}` または `staff:{id}` |
| failure_count | INTEGER | 連続失敗回数 |
| locked_at | REAL | ロック開始時刻（UNIX epoch秒） |

### last_import_passwords（直近CSVインポートの生成パスワード控え）
| 列 | 型 | 説明 |
|---|---|---|
| student_id | TEXT PK | 学籍番号 |
| password | TEXT | インポート時に自動生成された平文パスワード |
| name / class | TEXT | 氏名・クラス |
| imported_at | TEXT | インポート日時 |

インポートの都度 `DELETE` してから `INSERT` する（直近1回分のみ保持）。管理者はこの内容をCSVでダウンロードして生徒に配布する。

**D1の外部キー制約について**: D1はデフォルトで外部キー制約を強制する。チケット削除・生徒削除の際は先に `offline_scan_queue` の関連行を削除してからでないと `DELETE` が失敗するため、該当箇所（`DELETE /admin/tickets/:id`、`POST /admin/tickets/bulk-delete`、`DELETE /admin/students/:id`）はすべてこの順序で実装されている。

---

## 5. 認証・権限モデル

### JWT
- アルゴリズム: HS256、秘密鍵は `JWT_SECRET`（Workers Secret）
- クレーム: `{ sub, role, iat, exp, promoted? }`
- `Authorization: Bearer <token>` ヘッダーで送信
- ペイロードはクライアント側でも`atob()`によりデコードされ、ロール判定・UI出し分けに使われる（`auth.js`）

| トークン種別 | role | 有効期限 |
|---|---|---|
| 生徒（通常） | `student` | 発行から30日 |
| 生徒（昇格済み） | `student`, `promoted: true` | 当日 23:59:59 UTC まで |
| スタッフ/管理者 | `staff` / `admin` | 当日 23:59:59 UTC まで |

### ミドルウェア（`src/middleware/auth.ts`）
| ミドルウェア | 許可条件 | 拒否時メッセージ |
|---|---|---|
| `requireStudent` | `role === 'student'` | 403 「生徒権限が必要です」 |
| `requireStudentOrPromoted` | `role === 'student'`（昇格の有無は問わない、チケット発行時の判定と同じ） | 同上 |
| `requireStaffOrAdmin` | `role === 'staff' \| 'admin'`、または`role==='student' && promoted===true` | 403 「スタッフ権限が必要です」 |
| `requirePromoteApprover` | `requireStaffOrAdmin`と同条件（`/promote/approve`専用、文言のみ異なる） | 403 「昇格承認権限がありません」 |
| `requireAdmin` | `role === 'admin'` | 403 「管理者権限が必要です」 |

トークン欠落/不正はすべて401「認証が必要です」/「無効なトークンです」。

### ログインロックアウト
`login_failures` テーブルで管理。`LOGIN_MAX_FAILURES`（既定10回）連続失敗で `LOGIN_LOCKOUT_MINUTES`（既定30分）ロック。ロック中は401「アカウントがロックされています」。ロック期間経過後は自動解除、ログイン成功時はカウンタを削除。

### スタッフ一時昇格フロー
1. 生徒が「スタッフに切替」→ `POST /promote/request` → `temp_promotions` に未使用トークンを作成、QR (`https://{domain}/promote/approve?token=...`) を`<canvas>`に描画して表示
2. スタッフ/管理者/別の昇格済み生徒が、スキャン画面(`staff-scan.js`)でこのQRを読み取ると通常のチケットQRとは別経路で認識し `POST /promote/approve` を呼ぶ（`requirePromoteApprover`保護）
3. 承認レスポンスは**承認した側の端末**に返るだけなので、申請元の生徒の端末は `GET /promote/status?session_id=...` を2秒間隔・最大10分ポーリングして承認を検知し、自分用の昇格済みJWTを取得する
4. 昇格済みJWTは当日限り有効。`requireStaffOrAdmin`保護下のスキャン画面(`#/staff`)にアクセスできるようになる
5. `GET /promote/list`（管理者専用）で承認済み昇格の一覧を確認可能。管理者ダッシュボードの「昇格ツリー」に反映される

---

## 6. API仕様

すべてJSONボディ（CSVアップロードは`multipart/form-data`）。エラー時は `{ "detail": "..." }` を返す。

### `GET /health`
認証不要。`{ "status": "ok" }`

### `POST /auth/login`（生徒ログイン）
Body: `{ student_id, password }` → `{ token }`
400 (未入力) / 401 (認証失敗 or ロック中)

### `POST /auth/staff/login`（スタッフ/管理者ログイン）
Body: `{ staff_id, password }` → `{ token }`
400 / 401

### `/ticket/*`
| Method/Path | 認可 | 概要 |
|---|---|---|
| `POST /ticket/issue` | 生徒 | チケット発行。招待者名必須、発行期間内のみ、上限（既定5枚、`MAX_TICKETS`）まで |
| `GET /ticket/list` | 生徒 | 自分のチケット一覧（QR画像は含まない） |
| `DELETE /ticket/:ticket_id` | 生徒 | 自分の未使用チケットを削除（他人のチケット403、使用済み400） |
| `POST /ticket/scan` | スタッフ/管理者/昇格生徒 | `{ ticket_id }` → 入場処理。**同時実行下でも1件のみ成功**（後述） |
| `POST /ticket/scan/:ticket_id/cancel` | スタッフ/管理者/昇格生徒 | 入場取消（`used`を0に戻す、`scanned_by`もクリア） |
| `GET /ticket/status` | スタッフ/管理者/昇格生徒 | 現在の入場済み/未入場件数と30分刻みグラフデータ（`/admin/dashboard`と同じ集計ロジックを共用） |
| `GET /ticket/my-scans` | スタッフ/管理者/昇格生徒 | 自分がスキャンしたチケット最大100件（`scanned_by`で絞込） |
| `GET /ticket/cache?since=` | スタッフ/管理者/昇格生徒 | オフライン用チケットキャッシュ差分取得（IndexedDBへの保存元） |
| `POST /ticket/sync` | スタッフ/管理者/昇格生徒 | オフラインキュー一括同期。各アイテムを条件付きUPDATEで処理し、競合時は`offline_scan_queue`に`conflict=1`で記録 |

**`/ticket/scan`の同時実行制御**: SQLite版の`BEGIN IMMEDIATE`ロックの代わりに、単一のatomicな条件付きUPDATEで実現している。

```sql
UPDATE tickets SET used=1, used_at=?, scanned_by=? WHERE id=? AND is_valid=1 AND used=0
```

`meta.changes === 1` なら成功。0件なら理由をSELECTで判定し、優先順位「存在しない(404) → 無効(400) → 使用済み(409)」でエラーを返す。エラー文言は次の通り固定（フロントの文字列マッチに依存するため変更不可）:
- 404 「存在しないチケットです (not found)」
- 400 「無効なチケットです (invalid ticket)」
- 409 「入場済みチケットです (already used)」

同一チケットへの10並列スキャンでも1件のみ200成功・残りは409になることを、Miniflare（ローカルD1）とステージングの実D1の両方で確認済み（`test/ticket.test.ts`に回帰テストあり）。

### `/promote/*`
| Method/Path | 認可 | 概要 |
|---|---|---|
| `POST /promote/request` | 生徒 | 昇格申請、`{ promote_token, session_id, qr_content }` を返す |
| `GET /promote/status?session_id=` | 生徒 | 申請元デバイスが承認状況をポーリング。承認済みなら`{ approved:true, token, student_id }` |
| `POST /promote/approve` | スタッフ/管理者/昇格生徒 | `{ promote_token }` → 承認して`{ token, student_id }`（承認した端末用のトークンではなく、内容は同じ形。実際に使うのは申請元） |
| `GET /promote/list` | 管理者 | 承認済み昇格の一覧 |

400（無効なトークン）/ 409（使用済みトークン）。

### `/admin/*`（`requireAdmin`をルートグループ全体に適用、かつCloudflare Accessで保護）

**ダッシュボード**
- `GET /admin/dashboard` — 総入場数・未使用数・時間帯別グラフ・生徒別発行/入場数

**チケット管理**
- `GET /admin/tickets?student_name=&status=` — 一覧（フィルタ: `used`/`invalid`/`unused`）
- `GET /admin/tickets/:ticket_id` — 単体取得
- `PUT /admin/tickets/:ticket_id` — `is_valid`/`used`を個別更新
- `POST /admin/tickets` — 管理者による手動発行（上限チェックなし）
- `POST /admin/tickets/bulk-delete` — `{ ticket_ids: [] }` を`db.batch()`で一括削除
- `DELETE /admin/tickets/:ticket_id` — 単体削除（使用済みも強制削除可）

**生徒管理**
- `GET /admin/students` / `GET /admin/students/:student_id`
- `POST /admin/students` — 新規登録（重複409）
- `PUT /admin/students/:student_id` — 氏名/クラス/パスワード更新
- `POST /admin/students/:student_id/reset-password` — 指定 or 自動生成（4文字未満は400）
- `DELETE /admin/students/:student_id` — チケットも連鎖削除

**CSV**
- `POST /admin/import` — 生徒名簿CSV（`学籍番号,氏名,クラス`、UTF-8/Shift_JIS/CP932自動判定）。新規生徒にはランダムパスワードを自動発行し`last_import_passwords`に記録
- `GET /admin/import/passwords` — 直近インポート分のパスワード一覧CSV
- `GET /admin/export` — 全チケットの状況CSV（緊急時のバックアップ出力、UI上部の「🚨緊急CSV出力」ボタンからも呼ばれる）

**スタッフ管理**
- `GET /admin/staff` / `POST /admin/staff`（重複409） / `DELETE /admin/staff/:staff_id`
- `GET /admin/staff/export` — スタッフ一覧CSV（パスワードは含まない）
- `POST /admin/staff/import` — スタッフCSV（`スタッフID,氏名,パスワード,ロール`、ロール省略時`staff`）

**設定**
- `GET /admin/settings` / `PUT /admin/settings` — QR発行期間（`issue_start`/`issue_end`）

---

## 7. フロントエンド仕様

### ルーティング
`public/static/js/router.js` によるハッシュベースSPA。`index.html`末尾で全ルートを登録する。

| Hash | ページ | 必要ロール |
|---|---|---|
| `#/login` | 生徒ログイン | なし |
| `#/staff-login` | スタッフ/管理者ログイン | なし |
| `#/qr` | QR発行・一覧 | `student` |
| `#/staff` | QRスキャン | `staff_or_admin`（昇格生徒含む） |
| `#/admin` | ダッシュボード | `admin` |
| `#/admin/tickets` | チケット管理 | `admin` |
| `#/admin/students` | 生徒管理 | `admin` |
| `#/admin/import` | CSVインポート | `admin` |
| `#/admin/staff` | スタッフ管理 | `admin` |
| `#/admin/settings` | 発行期間設定 | `admin` |

未認証で保護ルートにアクセスすると、パスが`#/admin*`または`#/staff`なら`#/staff-login`へ、それ以外は`#/login`へリダイレクト。ロール不一致時は`redirectByRole()`で各自のホームへ飛ばす。

### QRコード（クライアント側完結）
サーバーはQR画像やQR文字列を一切返さない。フロントエンドが `${location.origin}/scan/${ticket_id}` を自前生成し、`qrcode`ライブラリで`<canvas>`に描画する（`student-qr.js`）。

- 一覧のサムネイル・拡大モーダル: `QRCode.toCanvas()`で都度描画
- 「画像を保存」: `buildTicketPng()`でQR + 招待者名/発行者名/発行日/フッターをCanvas 2Dで1枚のPNGに合成し、`blob:` URLで`<a download>`（iPhone Safariでの安定性のため`data:`URLは不使用）
- 「共有」（`navigator.share`対応端末のみ表示）: 同じPNGを`File`化し、Web Share APIでネイティブ共有シートを開く
- ライブラリ読み込み: `qrcode`はブラウザ向けグローバルビルドを持たないため、`index.html`内でESモジュールとしてjsdelivrの`+esm`から動的importし、`window.QRCode`に代入。`window.QRCodeReady`（Promise）で読み込み完了を待てるようにしている（現地の不安定な回線を考慮）

### QRスキャン・オフライン対応（`staff-scan.js`）
- `html5-qrcode`でカメラ映像からQRを読み取る（`facingMode: 'environment'`, fps:10）
- **多重スキャン防止**: `html5-qrcode`は同じQRが映っている間、約100ms間隔で検出コールバックを呼び続ける。検出直後にスキャナーを`pause()`し、1.5秒のクールダウン後に`resume()`することで、1回のかざしにつき1回だけ`/ticket/scan`を呼ぶようにしている
- QRの内容が `/promote/approve?token=...` にマッチすれば昇格承認処理、`/scan/{ticket_id}` にマッチすれば通常の入場スキャンとして処理を分岐
- オンライン時: `POST /ticket/scan`を直接呼ぶ。オフライン時: IndexedDB(`gakuensai_db`)にキャッシュ済みのチケット情報（`GET /ticket/cache`で取得）を参照してローカル判定し、`offline_queue`ストアに積む
- スキャン結果は画面全体を覆う緑(✅)/赤(❌)のフルスクリーンオーバーレイで1.2秒表示（Web Audio APIの効果音・バイブレーション付き）
- 「現在の来場状況」カード（`/ticket/status`）と「自分がチェックした来場者」リスト（`/ticket/my-scans`、サーバー保存で再読込しても残る）を表示。60秒ごとに自動更新
- `online`/`offline`イベント監視。オンライン復帰時に`/ticket/cache`差分取得。未同期のオフラインキューがあれば「同期」ボタンを表示し、押下で`POST /ticket/sync`

### 管理画面（`admin-*.js`）
- 全ページ共通レイアウト（`common.js`の`renderAdminLayout()`）：タブナビゲーション + 右上「🚨緊急CSV出力」ボタン（`/admin/export`をワンクリックでダウンロード、通信障害時の紙运用切替用）
- ダッシュボード: 30秒ポーリングでKPI（総入場数/未使用数/QR発行済み生徒数）・Chart.jsによる時間帯別棒グラフ・生徒別テーブル・昇格ツリーを更新
- チケット管理: 生徒名/状態フィルタ、個別操作（無効化/有効化、入場記録/取消、削除）、チェックボックスによる複数選択+一括削除
- 生徒管理: 追加/編集/パスワードリセット（指定 or 自動生成）/削除、学籍番号・氏名での検索
- CSVインポート（生徒）: ドラッグ&ドロップ対応、成功/スキップ件数表示、成功時にパスワード一覧CSVダウンロードボタンを表示
- スタッフ管理: CSVインポート/エクスポート、手動追加、削除（`admin`ロールは削除ボタン非表示）
- 設定: QR発行期間（開始日・終了日）の表示・保存、開始>終了のバリデーション

### PWA
`manifest.webmanifest`（`display: standalone`、テーマカラー`#0ea5e9`）+ 最小限の`sw.js`（`fetch`ハンドラを登録するだけで`respondWith()`しない、Android/Chromeのインストール可能要件を満たすためだけの存在）。オフライン対応自体はService Workerのキャッシュではなく、スキャン画面のIndexedDBロジックが担う。

---

## 8. Cloudflareインフラ構成

### Workers / wrangler.jsonc
- Worker名: `monpassc`（本番）
- `main: src/index.ts`、`compatibility_flags: ["nodejs_compat"]`
- `assets`: `./public`を`ASSETS`バインディングとして配信。`not_found_handling: single-page-application`、`run_worker_first: true`（bool形式。配列形式の方が新しいwranglerの機能だが、`@cloudflare/vitest-pool-workers`が内部にバンドルする旧wranglerがパースできないため bool 形式を採用し、`src/index.ts`側で明示的にASSETSへフォールバックする catch-all ルートを実装している）

### カスタムドメイン
| 環境 | ドメイン | D1 database_id |
|---|---|---|
| 本番 | `monpass.hide23.link` | `c5e14a76-691a-45f6-8406-453c1312678b`（`monpass-db`） |

`workers.dev`のプレビューURLは、WARP/1.1.1.1 DNS経由の環境からは`error 1042`でアクセスできない（Cloudflareのループ防止機構）。動作確認は基本的にカスタムドメイン経由で行う。

### 環境変数（`vars`、平文・非シークレット）
`DOMAIN`, `ISSUE_START_DATE`(既定`2000-01-01`), `ISSUE_END_DATE`(既定`2099-12-31`), `LOGIN_MAX_FAILURES`(既定`10`), `LOGIN_LOCKOUT_MINUTES`(既定`30`), `MAX_TICKETS`(既定`5`)

### シークレット（`wrangler secret put`、repo非管理）
- `JWT_SECRET` — JWT署名鍵
- `ADMIN_ID` / `ADMIN_PASSWORD` — `Bindings`型・`wrangler.jsonc`コメントには残っているが、現行の実装（`getConfig()`等）はどこからも参照していない未使用バインディング（旧FastAPI版の「起動時に管理者アカウントを自動生成する」仕組みの名残）。管理者アカウントは`/admin/staff`経由のDB操作で作成・管理する

### Cloudflare Access（`/admin/*` API保護）
- Application名: `MONpass Admin API`、保護対象: `monpass.hide23.link/admin`（`/admin/*` APIルートのみ）
- Policy: `Admins`（Allow）、許可メールアドレスをOne-time PIN方式で照合
- **既知の制約**: フロントエンドはハッシュルーターのため、ブラウザが実際にリクエストするパスは常に`GET /`。Access保護下の`/admin/*`へは管理画面のJSがバックグラウンドでfetchする形になるため、未認証状態でSPAの「殻」自体（`index.html`）は誰でもロードできる（実データはAPIがAccessでブロックされるため保護される、UIの出し分けは引き続きフロントのJWTチェックが担う）。また未認証時、AccessはCloudflare Access自身のオリジンへリダイレクトしようとするが、これはブラウザのfetchからはCORSで弾かれ「Failed to fetch」と表示される。回避策として、初回のみ`https://monpass.hide23.link/admin/dashboard`等のURLに直接アクセスしてワンタイムパスコード認証を済ませ、Accessの認証Cookie（有効期限24時間）を発行させる必要がある
- `GET /promote/list`は`/admin/`配下のパスではないため、現状Accessの保護対象外（アプリ側`requireAdmin`のみで保護）

### D1
- Time Travel（30日PITR）が自動で有効。手動バックアップの仕組みは別途用意していない
- ローカル開発では`wrangler dev`がMiniflare上にローカルD1を作成する（`--local`）

---

## 9. テスト

### Vitest（`@cloudflare/vitest-pool-workers`、Miniflare上のローカルD1で実行）
```
npm test
```
`test/apply-migrations.ts`が実行前にマイグレーションを自動適用。認証・チケット・昇格・管理者の全ルートについてリクエスト/レスポンスのデータ整合性を検証。**61件、全件成功**（内訳: auth 11 / ticket 19 / promote 7 / admin 24）。

主な回帰テスト:
- `/ticket/scan`への10並列リクエストで1件のみ成功することを確認する並行性テスト
- 改ざんJWT・別シークレット署名・ロールミスマッチの拒否確認
- UTF-8/Shift_JISのCSVインポートが文字化けしないことの確認
- D1外部キー制約下での使用済みチケット強制削除・生徒削除カスケードの確認
- 昇格フロー全体（申請→承認→`/promote/status`ポーリングでのトークン取得→他人の`session_id`の拒否）

### Playwright（実際のブラウザ操作、`wrangler dev`をwebServerとして自動起動）
```
npm run test:e2e
```
`e2e/global-setup.ts`がe2e専用管理者アカウントを冪等シード。**43件**（routing 7 / student-login 8 / staff-login 5 / qr 9 / scan 6 / admin-dashboard 8）。並列度は`workers: 3`に制限（単一`wrangler dev`インスタンス+外部CDN依存のqrcodeライブラリ読み込みが5並列だと稀にタイムアウトするため）。

未移植: 元のPython版E2Eスイート（`test_fe07`以降・`test_fe08〜17`）の一部細かいUIケースは移植していない。

### 型チェック
```
npm run typecheck
```
Workers向け(`tsconfig.json`、DOM型なし)とブラウザ向け(`e2e/tsconfig.json`、DOM型あり)を別々にチェックする。

---

## 10. 運用・デプロイ

```
npm run dev                  # wrangler dev（ローカルD1、ローカル開発）
npm run deploy                # 本番デプロイ（monpass.hide23.link）
npm run db:migrate:local      # ローカルD1にマイグレーション適用
npm run db:migrate:remote     # 本番D1にマイグレーション適用
```

デプロイ直後は`ASSETS`バインディングやAccess設定の反映に数秒〜数十秒のタイムラグがあり、その間`/`アクセスが一時的に500やAccessの302/401混在になることがある（既知の現象、時間経過で解消）。

### データ移行
旧システム（`/Users/hide/MONpass`、FastAPI + SQLite）からの実データ移行の仕組みは、管理画面のCSVインポート機能（`/admin/import`、UTF-8/Shift_JIS両対応）としてすでに用意されている。実データが揃い次第、管理者が管理画面から取り込む運用。

---

## 11. 既知の制約・今後の課題

- `GET /promote/list`が`/admin/`配下のパスにないため、Cloudflare Accessの保護対象になっていない（`requireAdmin`によるアプリ側の保護のみ）
- Cloudflare Accessはハッシュルーターの制約上、管理画面UIの「殻」自体は保護できず`/admin/*` APIのみ保護できる。初回アクセス時に「Failed to fetch」が起きる問題への恒久対応（SPA側でのAccess未認証検知など）は未着手
- フロントエンド(`student-qr.js`)の「あと{n}枚発行できます」表示は`5`をハードコードしている。バックエンドの発行上限は`MAX_TICKETS`環境変数で可変のため、この値を変更した場合はフロントエンドの表示が実際の上限とズレる
- Cloudflare Accessの許可メールアドレスは現在少数のみ登録。追加する場合はCloudflareダッシュボードまたはAPIでPolicyの`include`に追記する
- `ADMIN_ID`/`ADMIN_PASSWORD`シークレットは未使用のまま`Bindings`型・`wrangler.jsonc`に残っている（旧実装の名残、実害はないが将来的に削除してよい）

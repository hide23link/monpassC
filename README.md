# MONpass (Cloudflare Workers版)

学園祭入場管理システム。Cloudflare Workers + Hono + D1 上で完結して稼働する。生徒が入場QRチケットを自分で発行し、会場入口でスタッフ・管理者がQRをスキャンして入場処理を行う。想定規模は生徒約1000名・チケット最大6000枚程度。

単一のCloudflare Workersプロジェクトが API と静的アセットの両方を同一オリジンで配信する(Cloudflare Pagesは不使用、CORS設定は不要)。移行元は `/Users/hide/MONpass`(FastAPI + SQLite、非公開リポジトリ、以下「旧Python版」)。

このドキュメントは元々 `SPEC.md`(仕様)/ `PLAN.md`(移行計画・設計判断)/ `PROGRESS.md`(実装ログ)の3ファイルに分かれていたものを1つに統合したもの。

## 目次

- [クイックスタート(セルフホスト)](#クイックスタートセルフホスト)
- [ロール](#ロール)
- [アーキテクチャ](#アーキテクチャ)
- [ディレクトリ構成](#ディレクトリ構成)
- [データベース(D1)設計](#データベースd1設計)
- [認証・権限モデル](#認証権限モデル)
- [API仕様](#api仕様)
- [フロントエンド仕様](#フロントエンド仕様)
- [Cloudflareインフラ構成](#cloudflareインフラ構成)
- [運用・更新](#運用更新)
- [テスト(ローカル開発専用)](#テストローカル開発専用)
- [既知の制約・今後の課題](#既知の制約今後の課題)
- [設計判断の背景(移行計画)](#設計判断の背景移行計画)
- [実装ログ](#実装ログ)

---

## クイックスタート(セルフホスト)

このリポジトリは特定のドメイン(`hide23.link`)に依存しないよう設計してあり、別のCloudflareアカウント・別のドメインで自分の学校/団体用に立てることができる。

### 前提

- Node.js 20以降、npm
- Cloudflareアカウント(無料枠で足りる規模)
- (任意)独自ドメインをCloudflareのゾーンとして追加済みであること — 独自ドメインなしでも `*.workers.dev` で動作するが、Cloudflare Access(管理画面の保護)は独自ドメインが必要

### 初回構築(経験者向け・1回だけ)

```bash
git clone <このリポジトリ> monpassc-myschool
cd monpassc-myschool
npm install
bash scripts/setup.sh
```

`scripts/setup.sh` が対話形式で以下を行う:

1. `wrangler login`(未ログインの場合)
2. Worker名・カスタムドメイン有無・D1データベース名などをプロンプトで確認
3. `wrangler d1 create` でD1データベースを新規作成し、`wrangler.jsonc.template` から実際の `wrangler.jsonc` を生成
4. D1マイグレーション適用(ローカル・リモート両方)
5. `JWT_SECRET` をランダム生成して `wrangler secret put`
6. 最初の管理者アカウントをID/パスワード入力させて直接D1にシード(`scripts/create-admin.mjs` を内部で使用。詳細は[認証・権限モデル](#認証権限モデル)参照 — このアプリには「初期管理者を自動作成する」仕組みがないため、この一度だけの直接シードが唯一の起点になる)
7. `wrangler deploy` で本番デプロイ

独自ドメインを指定した場合、続けて Cloudflare Access(`/admin/*` の保護)を設定する:

```bash
bash scripts/setup-access.sh
```

これは Cloudflare API 経由で Access Application(保護対象: `<ドメイン>/admin`)と、指定したメールアドレス宛のワンタイムPINログインを許可する Policy を作成する。`CF_API_TOKEN`(`Account / Access: Apps and Policies / Edit` 権限)と `CF_ACCOUNT_ID` が必要(詳細はスクリプト内のコメント参照)。独自ドメインなしで `workers.dev` のみで動かす場合はスキップしてよい(その場合 `/admin/*` はアプリ側のJWT認証のみで保護される)。

### 2回目以降の更新(経験者がCLIで)

コード変更・マイグレーション追加後の再デプロイは:

```bash
git pull
bash scripts/deploy.sh
```

`scripts/deploy.sh` は `npm install`(依存変更時)→ D1マイグレーションのリモート適用(新規分のみ、冪等)→ `wrangler deploy` を順に実行する。管理者の追加・パスワードリセットは通常は管理画面(`/admin/staff`)から行うが、管理者アカウントを紛失した場合の緊急リカバリ用に:

```bash
node scripts/create-admin.mjs <db名> <admin_id>
```

をいつでも実行できる(パスワードは対話入力、bcryptjsで実行時と同じコストファクタ10でハッシュ化してD1へ直接INSERT/UPDATEする)。

### 各スクリプトの役割まとめ

| ファイル | 役割 |
|---|---|
| `wrangler.jsonc.template` | 環境非依存の設定テンプレート。`setup.sh`がこれを元に実際の`wrangler.jsonc`を生成する |
| `wrangler.jsonc` | 実際にデプロイされる設定(このリポジトリのforkごとに固有の値が入る。初期状態では未生成) |
| `scripts/setup.sh` | 初回構築を一括実行するブートストラップスクリプト |
| `scripts/create-admin.mjs` | 管理者アカウントの作成・パスワードリセット(bcryptjsで実行時と同じ方式でハッシュ化してD1に直接書き込む) |
| `scripts/deploy.sh` | 2回目以降の更新(マイグレーション適用+デプロイ)をまとめて行う |
| `scripts/setup-access.sh` | (任意・独自ドメイン利用時)Cloudflare Access による `/admin/*` 保護をAPI経由で自動設定 |

---

## ロール

登場人物(ロール):

| ロール | できること | ログイン方法 |
|---|---|---|
| 生徒 (`student`) | 自分のQRチケット発行(最大5枚、`MAX_TICKETS`で変更可)・一覧・削除、スタッフへの一時昇格リクエスト | 学籍番号 + パスワード |
| スタッフ (`staff`) | QRスキャンによる入場処理、来場状況閲覧、自分のスキャン履歴閲覧 | スタッフID + パスワード |
| 管理者 (`admin`) | 上記全部 + 生徒/スタッフ/チケットのCRUD、CSVインポート/エクスポート、発行期間設定、ダッシュボード集計 | スタッフID + パスワード(`staff`テーブルの`role='admin'`) |
| 昇格生徒 (`student` + `promoted:true`) | 生徒が当日限定でスタッフ相当の権限(QRスキャン)を得た状態 | 生徒QR→スタッフ/管理者/他の昇格生徒がスキャンして承認 |

---

## アーキテクチャ

```
ブラウザ (SPA, ハッシュルーター)
   │  fetch(相対パス, 同一オリジン)
   ▼
Cloudflare Workers(Hono)
   ├─ /health                     ヘルスチェック
   ├─ /auth/*                     ログイン(生徒・スタッフ/管理者共通)
   ├─ /ticket/*                   チケット発行・一覧・スキャン・オフライン同期
   ├─ /promote/*                  スタッフ一時昇格
   ├─ /admin/*                    管理者専用CRUD(Cloudflare Access保護、任意)
   └─ * (catch-all)                ASSETS binding にフォールバック(SPA/静的ファイル)
        │
        ▼
   D1(自分で名前を決めるD1データベース)   生徒/チケット/スタッフ/設定などを格納
```

| レイヤ | 技術 |
|---|---|
| ルーティング/HTTPフレームワーク | [Hono](https://hono.dev/) 4.x |
| データベース | Cloudflare D1(SQLite互換) |
| 静的アセット配信 | Workers Static Assets binding(`run_worker_first`でAPIパスを優先) |
| 認証トークン | JWT(HS256, `jose`ライブラリ) |
| パスワードハッシュ | `bcryptjs`(`$2a$`/`$2b$`互換、コストファクタ10) |
| CSV文字コード判定 | `encoding-japanese`(UTF-8/UTF-8 BOM/Shift_JIS/CP932を自動判定) |
| QRコード生成 | `qrcode`(クライアント側、`<canvas>`に描画。サーバーはQR画像を一切生成しない) |
| QRコード読み取り | `html5-qrcode`(クライアント側、カメラ) |
| フロントエンド | Vanilla JS(ビルドステップなし)+ Tailwind CSS(CDN)+ Chart.js(CDN) |
| オフライン動作 | IndexedDB(スタッフのスキャン画面のみ) |
| PWA | Web App Manifest + 最小限のService Worker(インストール可能にするためだけ、キャッシュ処理はなし) |
| アクセス保護 | Cloudflare Access(任意、`/admin/*` のみ、メールOTP) |

Honoを選んだ理由: 移行元のFastAPI版はほぼ全ルートが1ファイルにフラットに並んでおり、Honoの `app.route()` によるグルーピング(auth/ticket/admin/promote)がFastAPIの構造に最も近く、1:1移植のリスクが小さかったため。

---

## ディレクトリ構成

```
monpassC/
├── wrangler.jsonc.template     Workers設定テンプレート(汎用・環境非依存)
├── wrangler.jsonc               実際のデプロイ設定(setup.shが生成、初期状態では存在しない)
├── package.json                 依存関係・npm scripts
├── tsconfig.json                TypeScript設定(Workers向け、DOM型なし)
├── .dev.vars / .dev.vars.example  ローカル開発用シークレット(gitignore対象)
│
├── scripts/                     セルフホスト用の運用スクリプト
│   ├── setup.sh                   初回構築ブートストラップ
│   ├── deploy.sh                  更新(マイグレーション+デプロイ)
│   ├── create-admin.mjs           管理者アカウント作成/パスワードリセット
│   └── setup-access.sh            Cloudflare Access自動設定(任意)
│
├── migrations/                  D1マイグレーション(wrangler d1 migrations)
│   ├── 0001_init.sql             初期スキーマ(7テーブル+インデックス+last_import_passwords)
│   └── 0002_scanned_by.sql       tickets.scanned_by 列の追加
│
├── src/                         バックエンド(Hono、Workers上で実行)
│   ├── index.ts                  アプリのエントリポイント・ルートマウント・ASSETSフォールバック
│   ├── env.ts                    Bindings/Variables の型定義
│   ├── routes/
│   │   ├── auth.ts                POST /auth/login, /auth/staff/login
│   │   ├── ticket.ts               /ticket/* 全ルート
│   │   ├── promote.ts              /promote/* 全ルート
│   │   └── admin.ts                /admin/* 全ルート(requireAdmin一括適用)
│   ├── middleware/
│   │   └── auth.ts                requireStudent/requireStudentOrPromoted/requireStaffOrAdmin/requirePromoteApprover/requireAdmin
│   └── lib/
│       ├── config.ts               Bindingsから設定値を読むgetConfig()
│       ├── jwt.ts                  JWT発行・検証(issueStudentToken/issueStaffToken/decodeToken)
│       ├── login-lockout.ts        ログイン失敗回数によるロックアウト
│       ├── settings.ts             QR発行期間の取得
│       ├── entry-stats.ts          入場集計ロジック(admin/dashboardとticket/statusで共用)
│       ├── csv.ts                  CSV文字コード判定・パース・BOM付きレスポンス生成
│       ├── ids.ts                  token_urlsafe相当のランダムID生成
│       ├── html.ts                 html.escape相当のXSS対策エスケープ
│       ├── password.ts             英数字8桁ランダムパスワード生成
│       └── encoding-japanese-bundle.d.ts  encoding-japaneseの自己完結ビルド用アンビエント型
│
├── public/                      静的アセット(Workers Static Assetsとして配信)
│   ├── index.html                 SPAシェル(ナビバー・#app・スクリプト読み込み・ルート登録)
│   ├── manifest.webmanifest       PWAマニフェスト
│   ├── sw.js                      最小限のService Worker(インストール可能化のみ)
│   └── static/
│       ├── css/custom.css          QR表示・スキャン結果アニメーション等の追加CSS
│       ├── icons/                  PWAアイコン(192/512/512maskable/apple-touch-icon)
│       └── js/
│           ├── api.js               fetchラッパー(JWT自動付与・401時の自動ログアウト等)
│           ├── auth.js              JWTのlocalStorage管理・ロール判定
│           ├── common.js            トースト通知・管理者共通レイアウト・緊急CSV出力
│           ├── router.js            ハッシュベースSPAルーター
│           └── pages/               画面ごとのロジック(student-qr.js, staff-scan.js, admin-*.js 等)
│
└── README.md                    本ドキュメント
```

**gitには含まれないローカル専用ファイル**(`.gitignore`対象。開発は引き続きこのMac上で行うが、公開リポジトリには含めない方針):
- `test/`, `e2e/`(Vitest/Playwrightのテストコード)
- `PRESENTATION.html` / `PRESENTATION.pdf`(非技術者向け説明資料)
- `PRIVATE_NOTES.md`(実際のメールアドレス等、公開できない情報の控え)
- `wrangler.jsonc`(forkごとに固有の値が入るため、`setup.sh`実行後にローカルで生成される。コミットするかどうかは運用者の判断に委ねる)

---

## データベース(D1)設計

DB名は `setup.sh` 実行時に自分で決める(このリポジトリの参照実装では `monpass-db`)。マイグレーションは `migrations/` 配下を `wrangler d1 migrations apply` で適用する。

### students(生徒)
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | 学籍番号 |
| name | TEXT | 氏名 |
| class | TEXT | クラス |
| password_hash | TEXT | bcryptハッシュ |
| created_at | TEXT | 作成日時(ISO8601) |

### tickets(入場チケット)
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | チケットID(`token_urlsafe(12)`) |
| student_id | TEXT FK→students.id | 発行した生徒 |
| guest_name | TEXT | 招待者名(HTMLエスケープ済みで保存) |
| is_valid | INTEGER (0/1) | 管理者による無効化フラグ |
| used | INTEGER (0/1) | 入場済みフラグ |
| used_at | TEXT | 入場日時 |
| scanned_by | TEXT | 入場処理したスタッフ/管理者/昇格生徒のID(0002で追加) |
| created_at | TEXT | 発行日時 |

インデックス: `student_id`, `used`, `is_valid`, `created_at`, `used_at`, `scanned_by`

### staff(スタッフ・管理者)
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | スタッフID |
| name | TEXT | 氏名 |
| password_hash | TEXT | bcryptハッシュ |
| role | TEXT | `staff` または `admin` |

### temp_promotions(スタッフ一時昇格)
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | 内部ID |
| promote_token | TEXT UNIQUE | QRに埋め込まれる承認用トークン |
| token_used | INTEGER (0/1) | 承認済みフラグ |
| session_id | TEXT | 申請元デバイスが`/promote/status`をポーリングする際のキー |
| student_id | TEXT FK→students.id | 昇格を申請した生徒 |
| promoted_by_type / promoted_by_id | TEXT | 承認者種別・ID(承認前は`'pending'`) |
| promoted_at | TEXT | 承認日時 |
| expires_at | TEXT | 昇格トークンの有効期限(当日23:59:59 UTC) |

### offline_scan_queue(オフラインスキャン記録)
| 列 | 型 | 説明 |
|---|---|---|
| id | TEXT PK | 内部ID |
| ticket_id | TEXT FK→tickets.id | 対象チケット |
| scanned_at | TEXT | 端末側で記録したスキャン時刻 |
| session_id | TEXT | 端末セッションID(`sessionStorage`起源) |
| synced | INTEGER (0/1) | サーバー同期済みフラグ |
| synced_at | TEXT | 同期日時 |
| conflict | INTEGER (0/1) | 同期時に既に使用済みだった等の競合フラグ |

### settings(アプリ設定)
| 列 | 型 | 説明 |
|---|---|---|
| key | TEXT PK | 設定キー(`issue_start`, `issue_end`) |
| value | TEXT | 値 |

### login_failures(ログイン失敗カウンタ)
| 列 | 型 | 説明 |
|---|---|---|
| user_key | TEXT PK | `student:{id}` または `staff:{id}` |
| failure_count | INTEGER | 連続失敗回数 |
| locked_at | REAL | ロック開始時刻(UNIX epoch秒) |

### last_import_passwords(直近CSVインポートの生成パスワード控え)
| 列 | 型 | 説明 |
|---|---|---|
| student_id | TEXT PK | 学籍番号 |
| password | TEXT | インポート時に自動生成された平文パスワード |
| name / class | TEXT | 氏名・クラス |
| imported_at | TEXT | インポート日時 |

インポートの都度 `DELETE` してから `INSERT` する(直近1回分のみ保持)。管理者はこの内容をCSVでダウンロードして生徒に配布する。

**D1の外部キー制約について**: D1はデフォルトで外部キー制約を強制する。チケット削除・生徒削除の際は先に `offline_scan_queue` の関連行を削除してからでないと `DELETE` が失敗するため、該当箇所(`DELETE /admin/tickets/:id`、`POST /admin/tickets/bulk-delete`、`DELETE /admin/students/:id`)はすべてこの順序で実装されている。

---

## 認証・権限モデル

### JWT
- アルゴリズム: HS256、秘密鍵は `JWT_SECRET`(Workers Secret、`setup.sh`がランダム生成して設定する)
- クレーム: `{ sub, role, iat, exp, promoted? }`
- `Authorization: Bearer <token>` ヘッダーで送信
- ペイロードはクライアント側でも`atob()`によりデコードされ、ロール判定・UI出し分けに使われる(`auth.js`)

| トークン種別 | role | 有効期限 |
|---|---|---|
| 生徒(通常) | `student` | 発行から30日 |
| 生徒(昇格済み) | `student`, `promoted: true` | 当日 23:59:59 UTC まで |
| スタッフ/管理者 | `staff` / `admin` | 当日 23:59:59 UTC まで |

### ミドルウェア(`src/middleware/auth.ts`)
| ミドルウェア | 許可条件 | 拒否時メッセージ |
|---|---|---|
| `requireStudent` | `role === 'student'` | 403「生徒権限が必要です」 |
| `requireStudentOrPromoted` | `role === 'student'`(昇格の有無は問わない、チケット発行時の判定と同じ) | 同上 |
| `requireStaffOrAdmin` | `role === 'staff' \| 'admin'`、または`role==='student' && promoted===true` | 403「スタッフ権限が必要です」 |
| `requirePromoteApprover` | `requireStaffOrAdmin`と同条件(`/promote/approve`専用、文言のみ異なる) | 403「昇格承認権限がありません」 |
| `requireAdmin` | `role === 'admin'` | 403「管理者権限が必要です」 |

トークン欠落/不正はすべて401「認証が必要です」/「無効なトークンです」。

### ログインロックアウト
`login_failures` テーブルで管理。`LOGIN_MAX_FAILURES`(既定10回)連続失敗で `LOGIN_LOCKOUT_MINUTES`(既定30分)ロック。ロック中は401「アカウントがロックされています」。ロック期間経過後は自動解除、ログイン成功時はカウンタを削除。

### 初期管理者アカウントについて(重要)

このアプリには「起動時に管理者アカウントを自動生成する」仕組みがない(旧Python版にはあったが、Workers移行時に廃止した — 経緯は[実装ログ](#実装ログ)参照)。管理者の追加は通常 `/admin/staff` 経由で行うが、**それには既に管理者が1人いる必要がある**。したがって新規デプロイでは最初の1人だけ `scripts/create-admin.mjs` でD1に直接シードする(`setup.sh`が初回構築時に自動で呼ぶ)。2人目以降は管理画面から追加すればよい。

### スタッフ一時昇格フロー
1. 生徒が「スタッフに切替」→ `POST /promote/request` → `temp_promotions` に未使用トークンを作成、QR(`https://{domain}/promote/approve?token=...`)を`<canvas>`に描画して表示
2. スタッフ/管理者/別の昇格済み生徒が、スキャン画面(`staff-scan.js`)でこのQRを読み取ると通常のチケットQRとは別経路で認識し `POST /promote/approve` を呼ぶ(`requirePromoteApprover`保護)
3. 承認レスポンスは**承認した側の端末**に返るだけなので、申請元の生徒の端末は `GET /promote/status?session_id=...` を2秒間隔・最大10分ポーリングして承認を検知し、自分用の昇格済みJWTを取得する
4. 昇格済みJWTは当日限り有効。`requireStaffOrAdmin`保護下のスキャン画面(`#/staff`)にアクセスできるようになる
5. `GET /promote/list`(管理者専用)で承認済み昇格の一覧を確認可能。管理者ダッシュボードの「昇格ツリー」に反映される

---

## API仕様

すべてJSONボディ(CSVアップロードは`multipart/form-data`)。エラー時は `{ "detail": "..." }` を返す。

### `GET /health`
認証不要。`{ "status": "ok" }`

### `POST /auth/login`(生徒ログイン)
Body: `{ student_id, password }` → `{ token }`
400(未入力) / 401(認証失敗 or ロック中)

### `POST /auth/staff/login`(スタッフ/管理者ログイン)
Body: `{ staff_id, password }` → `{ token }`
400 / 401

### `/ticket/*`
| Method/Path | 認可 | 概要 |
|---|---|---|
| `POST /ticket/issue` | 生徒 | チケット発行。招待者名必須、発行期間内のみ、上限(既定5枚、`MAX_TICKETS`)まで |
| `GET /ticket/list` | 生徒 | 自分のチケット一覧(QR画像は含まない) |
| `DELETE /ticket/:ticket_id` | 生徒 | 自分の未使用チケットを削除(他人のチケット403、使用済み400) |
| `POST /ticket/scan` | スタッフ/管理者/昇格生徒 | `{ ticket_id }` → 入場処理。**同時実行下でも1件のみ成功**(後述) |
| `POST /ticket/scan/:ticket_id/cancel` | スタッフ/管理者/昇格生徒 | 入場取消(`used`を0に戻す、`scanned_by`もクリア) |
| `GET /ticket/status` | スタッフ/管理者/昇格生徒 | 現在の入場済み/未入場件数と30分刻みグラフデータ(`/admin/dashboard`と同じ集計ロジックを共用) |
| `GET /ticket/my-scans` | スタッフ/管理者/昇格生徒 | 自分がスキャンしたチケット最大100件(`scanned_by`で絞込) |
| `GET /ticket/cache?since=` | スタッフ/管理者/昇格生徒 | オフライン用チケットキャッシュ差分取得(IndexedDBへの保存元) |
| `POST /ticket/sync` | スタッフ/管理者/昇格生徒 | オフラインキュー一括同期。各アイテムを条件付きUPDATEで処理し、競合時は`offline_scan_queue`に`conflict=1`で記録 |

**`/ticket/scan`の同時実行制御**: SQLite版の`BEGIN IMMEDIATE`ロックの代わりに、単一のatomicな条件付きUPDATEで実現している。

```sql
UPDATE tickets SET used=1, used_at=?, scanned_by=? WHERE id=? AND is_valid=1 AND used=0
```

`meta.changes === 1` なら成功。0件なら理由をSELECTで判定し、優先順位「存在しない(404) → 無効(400) → 使用済み(409)」でエラーを返す。エラー文言は次の通り固定(フロントの文字列マッチに依存するため変更不可):
- 404「存在しないチケットです (not found)」
- 400「無効なチケットです (invalid ticket)」
- 409「入場済みチケットです (already used)」

同一チケットへの10並列スキャンでも1件のみ200成功・残りは409になることを、Miniflare(ローカルD1)とステージングの実D1の両方で確認済み(ローカルのVitestスイートに回帰テストあり、[テスト](#テストローカル開発専用)参照)。

### `/promote/*`
| Method/Path | 認可 | 概要 |
|---|---|---|
| `POST /promote/request` | 生徒 | 昇格申請、`{ promote_token, session_id, qr_content }` を返す |
| `GET /promote/status?session_id=` | 生徒 | 申請元デバイスが承認状況をポーリング。承認済みなら`{ approved:true, token, student_id }` |
| `POST /promote/approve` | スタッフ/管理者/昇格生徒 | `{ promote_token }` → 承認して`{ token, student_id }`(承認した端末用のトークンではなく、内容は同じ形。実際に使うのは申請元) |
| `GET /promote/list` | 管理者 | 承認済み昇格の一覧 |

400(無効なトークン)/ 409(使用済みトークン)。

### `/admin/*`(`requireAdmin`をルートグループ全体に適用、独自ドメイン利用時はCloudflare Accessでも保護可能)

**ダッシュボード**
- `GET /admin/dashboard` — 総入場数・未使用数・時間帯別グラフ・生徒別発行/入場数

**チケット管理**
- `GET /admin/tickets?student_name=&status=` — 一覧(フィルタ: `used`/`invalid`/`unused`)
- `GET /admin/tickets/:ticket_id` — 単体取得
- `PUT /admin/tickets/:ticket_id` — `is_valid`/`used`を個別更新
- `POST /admin/tickets` — 管理者による手動発行(上限チェックなし)
- `POST /admin/tickets/bulk-delete` — `{ ticket_ids: [] }` を`db.batch()`で一括削除
- `DELETE /admin/tickets/:ticket_id` — 単体削除(使用済みも強制削除可)

**生徒管理**
- `GET /admin/students` / `GET /admin/students/:student_id`
- `POST /admin/students` — 新規登録(重複409)
- `PUT /admin/students/:student_id` — 氏名/クラス/パスワード更新
- `POST /admin/students/:student_id/reset-password` — 指定 or 自動生成(4文字未満は400)
- `DELETE /admin/students/:student_id` — チケットも連鎖削除

**CSV**
- `POST /admin/import` — 生徒名簿CSV(`学籍番号,氏名,クラス`、UTF-8/Shift_JIS/CP932自動判定)。新規生徒にはランダムパスワードを自動発行し`last_import_passwords`に記録
- `GET /admin/import/passwords` — 直近インポート分のパスワード一覧CSV
- `GET /admin/export` — 全チケットの状況CSV(緊急時のバックアップ出力、UI上部の「🚨緊急CSV出力」ボタンからも呼ばれる)

**スタッフ管理**
- `GET /admin/staff` / `POST /admin/staff`(重複409) / `DELETE /admin/staff/:staff_id`
- `GET /admin/staff/export` — スタッフ一覧CSV(パスワードは含まない)
- `POST /admin/staff/import` — スタッフCSV(`スタッフID,氏名,パスワード,ロール`、ロール省略時`staff`)

**設定**
- `GET /admin/settings` / `PUT /admin/settings` — QR発行期間(`issue_start`/`issue_end`)

---

## フロントエンド仕様

### ルーティング
`public/static/js/router.js` によるハッシュベースSPA。`index.html`末尾で全ルートを登録する。

| Hash | ページ | 必要ロール |
|---|---|---|
| `#/login` | 生徒ログイン | なし |
| `#/staff-login` | スタッフ/管理者ログイン | なし |
| `#/qr` | QR発行・一覧 | `student` |
| `#/staff` | QRスキャン | `staff_or_admin`(昇格生徒含む) |
| `#/admin` | ダッシュボード | `admin` |
| `#/admin/tickets` | チケット管理 | `admin` |
| `#/admin/students` | 生徒管理 | `admin` |
| `#/admin/import` | CSVインポート | `admin` |
| `#/admin/staff` | スタッフ管理 | `admin` |
| `#/admin/settings` | 発行期間設定 | `admin` |

未認証で保護ルートにアクセスすると、パスが`#/admin*`または`#/staff`なら`#/staff-login`へ、それ以外は`#/login`へリダイレクト。ロール不一致時は`redirectByRole()`で各自のホームへ飛ばす。

### QRコード(クライアント側完結)
サーバーはQR画像やQR文字列を一切返さない。フロントエンドが `${location.origin}/scan/${ticket_id}` を自前生成し、`qrcode`ライブラリで`<canvas>`に描画する(`student-qr.js`)。

- 一覧のサムネイル・拡大モーダル: `QRCode.toCanvas()`で都度描画
- 「画像を保存」: `buildTicketPng()`でQR + 招待者名/発行者名/発行日/フッターをCanvas 2Dで1枚のPNGに合成し、`blob:` URLで`<a download>`(iPhone Safariでの安定性のため`data:`URLは不使用)
- 「共有」(`navigator.share`対応端末のみ表示): 同じPNGを`File`化し、Web Share APIでネイティブ共有シートを開く
- ライブラリ読み込み: `qrcode`はブラウザ向けグローバルビルドを持たないため、`index.html`内でESモジュールとしてjsdelivrの`+esm`から動的importし、`window.QRCode`に代入。`window.QRCodeReady`(Promise)で読み込み完了を待てるようにしている(現地の不安定な回線を考慮)

### QRスキャン・オフライン対応(`staff-scan.js`)
- `html5-qrcode`でカメラ映像からQRを読み取る(`facingMode: 'environment'`, fps:10)
- **多重スキャン防止**: `html5-qrcode`は同じQRが映っている間、約100ms間隔で検出コールバックを呼び続ける。検出直後にスキャナーを`pause()`し、1.5秒のクールダウン後に`resume()`することで、1回のかざしにつき1回だけ`/ticket/scan`を呼ぶようにしている
- QRの内容が `/promote/approve?token=...` にマッチすれば昇格承認処理、`/scan/{ticket_id}` にマッチすれば通常の入場スキャンとして処理を分岐
- オンライン時: `POST /ticket/scan`を直接呼ぶ。オフライン時: IndexedDB(`gakuensai_db`)にキャッシュ済みのチケット情報(`GET /ticket/cache`で取得)を参照してローカル判定し、`offline_queue`ストアに積む
- スキャン結果は画面全体を覆う緑(✅)/赤(❌)のフルスクリーンオーバーレイで1.2秒表示(Web Audio APIの効果音・バイブレーション付き)
- 「現在の来場状況」カード(`/ticket/status`)と「自分がチェックした来場者」リスト(`/ticket/my-scans`、サーバー保存で再読込しても残る)を表示。60秒ごとに自動更新
- `online`/`offline`イベント監視。オンライン復帰時に`/ticket/cache`差分取得。未同期のオフラインキューがあれば「同期」ボタンを表示し、押下で`POST /ticket/sync`

### 管理画面(`admin-*.js`)
- 全ページ共通レイアウト(`common.js`の`renderAdminLayout()`): タブナビゲーション + 右上「🚨緊急CSV出力」ボタン(`/admin/export`をワンクリックでダウンロード、通信障害時の紙運用切替用)
- ダッシュボード: 30秒ポーリングでKPI(総入場数/未使用数/QR発行済み生徒数)・Chart.jsによる時間帯別棒グラフ・生徒別テーブル・昇格ツリーを更新
- チケット管理: 生徒名/状態フィルタ、個別操作(無効化/有効化、入場記録/取消、削除)、チェックボックスによる複数選択+一括削除
- 生徒管理: 追加/編集/パスワードリセット(指定 or 自動生成)/削除、学籍番号・氏名での検索
- CSVインポート(生徒): ドラッグ&ドロップ対応、成功/スキップ件数表示、成功時にパスワード一覧CSVダウンロードボタンを表示
- スタッフ管理: CSVインポート/エクスポート、手動追加、削除(`admin`ロールは削除ボタン非表示)
- 設定: QR発行期間(開始日・終了日)の表示・保存、開始>終了のバリデーション

### PWA
`manifest.webmanifest`(`display: standalone`、テーマカラー`#0ea5e9`)+ 最小限の`sw.js`(`fetch`ハンドラを登録するだけで`respondWith()`しない、Android/Chromeのインストール可能要件を満たすためだけの存在)。オフライン対応自体はService Workerのキャッシュではなく、スキャン画面のIndexedDBロジックが担う。

---

## Cloudflareインフラ構成

### Workers / wrangler.jsonc
- `main: src/index.ts`、`compatibility_flags: ["nodejs_compat"]`
- `assets`: `./public`を`ASSETS`バインディングとして配信。`not_found_handling: single-page-application`、`run_worker_first: true`(bool形式。配列形式の方が新しいwranglerの機能だが、`@cloudflare/vitest-pool-workers`が内部にバンドルする旧wranglerがパースできないため bool 形式を採用し、`src/index.ts`側で明示的にASSETSへフォールバックする catch-all ルートを実装している)
- Worker名・カスタムドメイン・D1 database_id は環境ごとに異なるため `wrangler.jsonc.template` からforkごとに生成する([クイックスタート](#クイックスタートセルフホスト)参照)

### カスタムドメイン(任意)
独自ドメインを使う場合、`wrangler.jsonc`の`routes`に`custom_domain: true`で登録する。`workers.dev`のプレビューURLは、WARP/1.1.1.1 DNS経由の環境からは`error 1042`でアクセスできない(Cloudflareのループ防止機構)。カスタムドメインを使う場合はこの制約を受けない。

### 環境変数(`vars`、平文・非シークレット)
`DOMAIN`, `ISSUE_START_DATE`(既定`2000-01-01`), `ISSUE_END_DATE`(既定`2099-12-31`), `LOGIN_MAX_FAILURES`(既定`10`), `LOGIN_LOCKOUT_MINUTES`(既定`30`), `MAX_TICKETS`(既定`5`)

### シークレット(`wrangler secret put`、repo非管理)
- `JWT_SECRET` — JWT署名鍵(`setup.sh`がランダム生成)

### Cloudflare Access(`/admin/*` API保護、独自ドメイン利用時のみ)
- Application: 保護対象 `<ドメイン>/admin`(`/admin/*` APIルートのみ)
- Policy: Allow、許可メールアドレスをOne-time PIN方式で照合
- **既知の制約**: フロントエンドはハッシュルーターのため、ブラウザが実際にリクエストするパスは常に`GET /`。Access保護下の`/admin/*`へは管理画面のJSがバックグラウンドでfetchする形になるため、未認証状態でSPAの「殻」自体(`index.html`)は誰でもロードできる(実データはAPIがAccessでブロックされるため保護される、UIの出し分けは引き続きフロントのJWTチェックが担う)。また未認証時、AccessはCloudflare Access自身のオリジンへリダイレクトしようとするが、これはブラウザのfetchからはCORSで弾かれ「Failed to fetch」と表示される。回避策として、初回のみ`https://<ドメイン>/admin/dashboard`等のURLに直接アクセスしてワンタイムパスコード認証を済ませ、Accessの認証Cookie(有効期限24時間)を発行させる必要がある
- `GET /promote/list`は`/admin/`配下のパスではないため、現状Accessの保護対象外(アプリ側`requireAdmin`のみで保護)
- `scripts/setup-access.sh` でAPI経由の自動設定が可能(任意)

### D1
- Time Travel(30日PITR)が自動で有効。手動バックアップの仕組みは別途用意していない
- ローカル開発では`wrangler dev`がMiniflare上にローカルD1を作成する(`--local`)

---

## 運用・更新

```bash
npm run dev                   # wrangler dev(ローカルD1、ローカル開発)
npm run deploy                 # wrangler deploy のみ(低レベル、通常はscripts/deploy.shを使う)
bash scripts/deploy.sh          # マイグレーション適用+デプロイをまとめて実行(更新時はこちら推奨)
npm run db:migrate:local       # ローカルD1にマイグレーション適用
npm run db:migrate:remote      # 本番D1にマイグレーション適用
```

デプロイ直後は`ASSETS`バインディングやAccess設定の反映に数秒〜数十秒のタイムラグがあり、その間`/`アクセスが一時的に500やAccessの302/401混在になることがある(既知の現象、時間経過で解消)。

### データ移行(旧Python版から)
旧システム(FastAPI + SQLite)からの実データ移行の仕組みは、管理画面のCSVインポート機能(`/admin/import`、UTF-8/Shift_JIS両対応)としてすでに用意されている。実データが揃い次第、管理者が管理画面から取り込む運用。

---

## テスト(ローカル開発専用)

Vitest(`test/`)・Playwright E2E(`e2e/`)のテストコードはこのMac上には存在するが、**このリポジトリには含めていない**(`.gitignore`対象、[ディレクトリ構成](#ディレクトリ構成)参照)。自分で追加してよい。参考までに、参照実装時点での内容:

- Vitest(`@cloudflare/vitest-pool-workers`、Miniflare上のローカルD1で実行、`npm test`): 認証・チケット・昇格・管理者の全ルートについてリクエスト/レスポンスのデータ整合性を検証。61件、全件成功(auth 11 / ticket 19 / promote 7 / admin 24)。主な回帰テスト: `/ticket/scan`への10並列リクエストで1件のみ成功することの確認、改ざんJWT・別シークレット署名・ロールミスマッチの拒否確認、UTF-8/Shift_JISのCSVインポートが文字化けしないことの確認、D1外部キー制約下での使用済みチケット強制削除・生徒削除カスケードの確認、昇格フロー全体の確認
- Playwright(実際のブラウザ操作、`wrangler dev`をwebServerとして自動起動、`npm run test:e2e`): 43件(routing 7 / student-login 8 / staff-login 5 / qr 9 / scan 6 / admin-dashboard 8)。並列度は`workers: 3`に制限(単一`wrangler dev`インスタンス+外部CDN依存のqrcodeライブラリ読み込みが5並列だと稀にタイムアウトするため)

型チェックは `npm run typecheck` で行う。

---

## 既知の制約・今後の課題

- `GET /promote/list`が`/admin/`配下のパスにないため、Cloudflare Accessの保護対象になっていない(`requireAdmin`によるアプリ側の保護のみ)
- Cloudflare Accessはハッシュルーターの制約上、管理画面UIの「殻」自体は保護できず`/admin/*` APIのみ保護できる。初回アクセス時に「Failed to fetch」が起きる問題への恒久対応(SPA側でのAccess未認証検知など)は未着手
- フロントエンド(`student-qr.js`)の「あと{n}枚発行できます」表示は`5`をハードコードしている。バックエンドの発行上限は`MAX_TICKETS`環境変数で可変のため、この値を変更した場合はフロントエンドの表示が実際の上限とズレる
- Playwright E2E: 旧Python版E2Eスイートの一部細かいUIケースは移植していない

---

## 設計判断の背景(移行計画)

以下は旧Python版からの移行を計画した際の設計判断・リスク検討の記録(`PLAN.md`より統合)。

**確定済みの前提:**
1. Cloudflare Access(メールOTP・管理者数名)は **`/admin/*` APIルートのみ** を保護する。スタッフ・生徒は既存のID/パスワード+JWTログインのまま(Accessの対象外)。
2. 既存の生徒/スタッフのbcryptハッシュ済みパスワードは **そのまま引き継ぐ**(強制リセットしない)。

### ターゲットアーキテクチャの選定

| 旧Python版 | 移行先 |
|---|---|
| FastAPI(Python) | **Hono**(TypeScript, Workers用ルーターFW) |
| SQLite | **D1** |
| `static/` を uvicorn/StaticFiles配信 | **Workers Static Assets** binding(同一Worker) |
| `app.state.last_import_passwords`(プロセスメモリ、既に多workerで壊れていた) | D1テーブル `last_import_passwords` |
| cronでのSQLiteバックアップ(外部運用) | D1 Time Travel(30日PITR) |
| Nginx+uvicorn(VM) | Workers Custom Domain |
| `.env` | `wrangler secret`(JWT_SECRET等)+ `wrangler.jsonc` の `vars` |

**移行時に修正した旧版のバグ**(そのまま引き継がなかったもの):
- `.env.example`は`ISSUE_START`/`ISSUE_END`と書いていたが、実際のコードは`ISSUE_START_DATE`/`ISSUE_END_DATE`を読んでいた不整合 → 正しい名前で統一
- `MAX_TICKETS`は宣言されているが未使用で、5枚上限がハードコードされていた → 実際に効く設定値にした
- `POST /ticket/sync`は`/ticket/scan`と違い`BEGIN IMMEDIATE`を使っておらず、実は競合状態のバグがあった → 条件付きUPDATEで修正

### QRコード生成の再設計(クライアント側へ移行)
Cloudflare WorkersはPillowもOSフォントファイル読み込みも実行できないため、最も大きな設計変更が必要だった箇所。QRペイロード内容(`https://<domain>/scan/{ticket_id}`)は変更せず、生成場所をサーバー(Pillow)からクライアント(`qrcode` npmパッケージ、Canvas描画)に移した。「画像として保存」機能も同様にCanvas 2Dでの合成に置き換えた。

### Cloudflare Access統合の方針
Access(メールベース)は`staff`テーブルの`role`列や監査証跡と直接マッピングできないため、既存のID/パスワード+JWT認証は廃止せず併用する方針にした。また、ローカル開発・テスト(`wrangler dev`/Vitest)ではAccessをシミュレートできないため、アプリ側の認証が独立して動作する必要があった。

現行フロントエンドはハッシュルーター(`#/admin/...`)のため、`#/admin/dashboard`のようなSPA内パスはサーバーには`GET /`としてしか届かず、Accessでは区別できない。そのため、Accessの保護対象は実際のHTTPパスが分離している **`/admin/*` APIルート**にのみ設定している(管理画面のUI「殻」自体は誰でもロードできるが、データ取得APIがAccessでブロックされるため実質的にデータは保護される)。

### `/ticket/scan`の同時実行制御の設計
旧版は`BEGIN IMMEDIATE`で書き込みロックを取ってから読み書きし、「同時スキャンでも1件のみ成功」を保証していた。D1では明示的なロックAPIがないため、単一のatomicな条件付きUPDATE(`UPDATE tickets SET used=1, used_at=? WHERE id=? AND is_valid=1 AND used=0`)に置き換えた。変更行数(`meta.changes`)で成否判定し、0件なら理由をSELECTで判定してエラーメッセージを返す。Durable Objectsは不要と判断した(D1の行単位アトミック更新で「1台のみ成功」要件を満たせるため)。この設計の妥当性は、実際のD1に対する10並列スキャンで1件のみ成功することを確認して検証済み([実装ログ](#実装ログ)参照)。

### テスト戦略
バックエンドは旧版のpytestスイートを`Vitest + @cloudflare/vitest-pool-workers`(Miniflare上のD1)へ概念移植。最優先で緑にすべきは「同時スキャンでも1件のみ成功」を担保する並行性テストだった。E2E(Playwright)は`wrangler dev`→デプロイ済み環境へbase URLを差し替えて再利用する方針。

### 切替(カットオーバー)の考え方
現地イベント(学園祭当日)のゲート運用を支えるシステムのため保守的に進める方針とした: ローカル検証 → ステージングデプロイ+実D1での負荷テスト → データ移行ドライラン → DNS切替 → 旧サーバーは猶予期間(1〜2週間目安)残す。ロールバックは、実データがD1に入る前ならDNS/Custom Domainを旧サーバーへ戻すだけで安全に行える。

---

## 実装ログ

旧Python版からの移行作業を通じて発見した実装上の問題・バグとその修正の記録(`PROGRESS.md`より統合、時系列)。今後似た問題(D1固有の制約、wrangler/vitest-pool-workersのバージョン不整合など)に当たったときの参考用。

### プロジェクト scaffold
`package.json`(Hono, bcryptjs, jose, encoding-japanese, qrcode 等の依存)、`wrangler.jsonc`(D1・静的アセットバインディング)、`migrations/0001_init.sql`(D1スキーマ)、Honoルート骨格、`public/`(旧版の`static/`を`/static/js/...`パス維持のままコピー)を作成した。

### 環境構築で踏んだ問題
`wrangler@4` + `@cloudflare/workers-types@5`へのアップグレードが必要だった(`run_worker_first`の配列指定に旧v3が非対応だったため)。

### 初期管理者アカウント
初期管理者アカウント(bcryptjsハッシュ付き)を`staff`テーブルへ直接シードして起点とした。旧`.env.example`の`ADMIN_ID`/`ADMIN_PASSWORD`(起動時自動生成の仕組み)は新実装では使っておらず、この直接シードが唯一の起点になる — これが今回`scripts/create-admin.mjs`として一般化・スクリプト化した部分。

### 認証(`/auth/*`)
`jose`によるHS256 JWT発行/検証、`login_failures`テーブルによるロックアウト、5種類の認可ミドルウェアを実装。`wrangler dev`+ローカルD1で、ログイン成功/失敗、無トークン401、10回失敗でのロックアウトを動作確認した。

### チケット(`/ticket/*`)
7ルートすべて実装し、レスポンスから`qr_image`/`qr_url`/`qr_content`を完全に排除(クライアント側描画への移行)。`MAX_TICKETS`を実際に効く設定値として使用(旧版のハードコードバグを修正)。**最重要検証**: 同一チケットに対する5並列スキャンで1件のみ200成功・残り4件409を確認 — 条件付きUPDATEによる並行性保証がローカルMiniflare D1上で機能することを確認した。

### 昇格(`/promote/*`)
3ルート実装。昇格リクエスト→承認→`promoted:true`のJWT発行→同一トークンの再利用は409で拒否、までを確認。

### QRコードのクライアント側描画
`qrcode`npmパッケージはブラウザ向けグローバル公開ビルドを持たない(CJS/ESM専用)ため、当初指定していたCDNパス(`/build/qrcode.min.js`)が404だった問題を発見・修正し、jsdelivrの`+esm`変換パスに切り替えた。`student-qr.js`を全面書き換えし、`t.qr_image`(サーバー生成base64 PNG)への依存を排除して`<canvas>`+`QRCode.toCanvas()`によるクライアント側描画に変更した。

### 管理者機能(`/admin/*`)
22ルートすべて実装。**発見・修正した実バグ**: D1はデフォルトで外部キー制約を強制する(元のSQLiteは`PRAGMA foreign_keys`未設定で実質無効だった)。管理者による使用済みチケットの強制削除・生徒削除(チケット連鎖削除)が`offline_scan_queue`の外部キー制約でエラーになる問題をテスト中に発見し、該当箇所で関連行を先に削除するよう修正した。CSVインポートはUTF-8・Shift_JIS両方で文字化けなくインポートできることを確認した。

### Stagingデプロイでの検証
**最重要検証**: 実際のCloudflare D1(Miniflareではなく)に対して同一チケットへ10並列スキャンを実行し、1件のみ200成功・残り9件409を確認。条件付きUPDATEによる同時実行制御が本番相当インフラでも機能することを実証した。

### Vitestテストスイートで踏んだ設定不整合
`@cloudflare/vitest-pool-workers`は内部に古いwrangler(3.109.1)をバンドルしており、`run_worker_first`の配列指定(新しいwrangler 4系の機能)をパースできずテストが起動不能だった問題を発見。`run_worker_first: true`(bool)に戻し、`src/index.ts`に明示的な`ASSETS`フォールバックルートを追加する形に変更した。また、`encoding-japanese`のデフォルトエントリが`require('../package.json')`を実行し、vitest-pool-workersのworkerdベースモジュールローダーで解決できずクラッシュする問題も発見し、自己完結型のバンドル版に切り替えて解決した。

### 本番Custom Domainアタッチ
本番ドメインを実際にCustom Domainとしてアタッチしデプロイした。デプロイ直後は`ASSETS`バインディングの反映に数秒〜十数秒のタイムラグがあり、その間`/`アクセスが一時的に500(Cloudflare error 1101)になる現象を確認した(時間経過で解消)。

### Playwright E2Eテストスイート
`wrangler dev`をwebServerとして自動起動する構成で6ファイル・43件を移植。**発見・修正した問題**: `test/`・`e2e/`ディレクトリが`tsconfig.json`の`include`に入っておらず、`tsc --noEmit`が実質何もチェックしていなかった(vitestはesbuildで型チェックなしに実行されるため見た目上テストは通っていた)。Workers向けとブラウザ向けでtsconfigを分離して両方を実際にチェックするよう修正した。5並列実行時に単一の`wrangler dev`インスタンス+外部CDN依存が原因と見られる低頻度のflaky timeoutが発生したため、`workers: 3`に制限して安定化した。

### Cloudflare Access設定
Access Application(保護対象`<domain>/admin`)+ Policy(Allow、メールOTP)をCloudflare API経由で作成した。**動作確認**: `/admin/*`は未認証だと302でAccessログイン画面へリダイレクトされ、`/health`等の非保護ルートは影響を受けないことを確認。**判明した実運用上の注意点**: ハッシュルーティングのSPAでは、未認証時にAccessが別オリジンへリダイレクトしようとする際にCORSで弾かれ「Failed to fetch」と表示される問題があり、初回のみ管理画面の実パスに直接アクセスしてワンタイムパスコード認証を完了させる回避策が必要(恒久対応は未着手、[既知の制約](#既知の制約今後の課題)参照)。

### スタッフ向け機能追加
`tickets`テーブルに`scanned_by`カラムを追加(誰がスキャンしたかを記録、旧版には無かった情報)。`GET /ticket/status`・`GET /ticket/my-scans`エンドポイントを新設し、スキャン画面に「現在の来場状況」カードと「自分がチェックした来場者」リストを追加した。

### QRチケットカードの改善
`navigator.share()`対応端末向けの共有ボタンを追加。「画像を保存」を`data:`URLから`blob:`URL方式に変更(iPhone Safariでの安定性向上)。**発見・修正したバグ**: クライアント側QR描画への移行時、元のアプリがQR画像に焼き込んでいた「発行者:{生徒名}」のテキスト表示をカードのDOM要素に移し忘れていたため追加した。

### PWA対応
Web App Manifest・アイコン一式・最小限のService Worker(キャッシュ処理なし、インストール可能要件を満たすためだけ)を追加した。

### テストケースの大幅拡充
Vitestを27件→56件に倍増し、全ルートのリクエスト/レスポンスのデータ整合性を網羅(改ざんJWT拒否、ロールミスマッチの403、CRUD操作の一貫性確認等)。

### QRスキャンの重複判定バグ修正
**発見・修正したバグ**: `html5-qrcode`はQRコードがカメラに映っている間、成功検出のたびに毎フレーム(fps:10 ≒ 約100ms間隔)コールバックを呼び続ける仕様だった。ロックなしだと1回のかざしで`/ticket/scan`への並列リクエストが複数発生し、最初の1件だけ成功した直後に後続のリクエストが「入場済み」(409)を返して結果表示を上書きしていた(実際は入場成功しているのに画面上は失敗に見える)。検出直後にスキャナーを`pause()`し、1.5秒のクールダウン後に`resume()`するよう修正した。あわせてスキャン結果表示を画面全体のフルスクリーンオーバーレイに変更し、管理画面にチケット一括削除機能を追加した。

### 昇格(スタッフ権限)機能の完成
**判明した経緯**: `/promote/request`・`/promote/approve`のバックエンドAPI自体は存在していたが、**旧Python版の時点から**QRを読み取って承認するUIが実装されていなかった(移行で壊れたものではなく、以前から未完成だった機能)。スキャン画面に昇格QRの認識機能、新規エンドポイント`GET /promote/status`(承認結果を申請元の生徒端末に届けるためのポーリング用)、管理画面への「QRスキャン」タブ追加を実装して機能を完成させた。

---

*旧Python版(`/Users/hide/MONpass`)は本移行の1次ソースとして使用したが、別の非公開リポジトリであり本リポジトリには含まれない。*

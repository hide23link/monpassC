# MONpass (Cloudflare Workers版)

学園祭入場管理システム。Cloudflare Workers + Hono + D1 上で完結して稼働する。生徒が入場QRチケットを自分で発行し、会場入口でスタッフ・管理者がQRをスキャンして入場処理を行う。想定規模は生徒約1000名・チケット最大6000枚程度。

単一のCloudflare Workersプロジェクトが API と静的アセットの両方を同一オリジンで配信する(Cloudflare Pagesは不使用、CORS設定は不要)。元々はFastAPI + SQLiteの別実装(非公開リポジトリ、以下「旧Python版」)からの移行として作られた。

アーキテクチャ・DB設計・API仕様・フロントエンド仕様・インフラ構成・テスト・既知の制約などの技術詳細は **[SPEC.md](./SPEC.md)** を参照。

## 目次

- [クイックスタート(セルフホスト)](#クイックスタートセルフホスト)
- [ロール](#ロール)
- [運用・更新](#運用更新)

---

## クイックスタート(セルフホスト)

このリポジトリは特定のドメイン(`hide23.link`)に依存しないよう設計してあり、別のCloudflareアカウント・別のドメインで自分の学校/団体用に立てることができる。

### 前提

- Node.js 20以降、npm
- Cloudflareアカウント(無料枠で足りる規模)
- (任意)独自ドメインをCloudflareのゾーンとして追加済みであること — 独自ドメインなしでも `*.workers.dev` で動作する

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
6. 最初の管理者アカウントをID/パスワード入力させて直接D1にシード(`scripts/create-admin.mjs` を内部で使用。詳細は[SPEC.mdの認証・権限モデル](./SPEC.md#認証権限モデル)参照 — このアプリには「初期管理者を自動作成する」仕組みがないため、この一度だけの直接シードが唯一の起点になる)
7. `wrangler deploy` で本番デプロイ

### 各スクリプトの役割まとめ

| ファイル | 役割 |
|---|---|
| `wrangler.jsonc.template` | 環境非依存の設定テンプレート。`setup.sh`がこれを元に実際の`wrangler.jsonc`を生成する |
| `wrangler.jsonc` | 実際にデプロイされる設定(このリポジトリのforkごとに固有の値が入る。初期状態では未生成) |
| `scripts/setup.sh` | 初回構築を一括実行するブートストラップスクリプト |
| `scripts/create-admin.mjs` | 管理者アカウントの作成・パスワードリセット(bcryptjsで実行時と同じ方式でハッシュ化してD1に直接書き込む) |
| `scripts/deploy.sh` | 2回目以降の更新(マイグレーション適用+デプロイ)をまとめて行う |

---

## ロール

登場人物(ロール):

| ロール | できること | ログイン方法 |
|---|---|---|
| 生徒 (`student`) | 自分のQRチケット発行(最大5枚、`MAX_TICKETS`で変更可)・一覧・削除 | 学籍番号 + パスワード |
| スタッフ (`staff`) | QRスキャンによる入場処理、来場状況閲覧、自分のスキャン履歴閲覧 | スタッフID + パスワード |
| 管理者 (`admin`) | 上記全部 + 生徒/スタッフ/チケットのCRUD、CSVインポート/エクスポート、発行期間設定、ダッシュボード集計 | スタッフID + パスワード(`staff`テーブルの`role='admin'`) |

---

## 運用・更新

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

その他のコマンド:

```bash
npm run dev                   # wrangler dev(ローカルD1、ローカル開発)
npm run deploy                 # wrangler deploy のみ(低レベル、通常はscripts/deploy.shを使う)
npm run db:migrate:local       # ローカルD1にマイグレーション適用
npm run db:migrate:remote      # 本番D1にマイグレーション適用
```

デプロイ直後は`ASSETS`バインディングの反映に数秒〜数十秒のタイムラグがあり、その間`/`アクセスが一時的に500になることがある(既知の現象、時間経過で解消)。

import type { JwtPayload } from "./lib/jwt";

// このアプリのHonoジェネリック型パラメータ(`Hono<{ Bindings; Variables }>`、
// index.ts参照)。Variablesはミドルウェアがリクエストごとにセットするコンテキスト、
// Bindingsはwrangler.jsonc(.template)で宣言されたWorkerのランタイムバインディング・
// 環境変数・シークレット一式。あちらに`vars`やbindingを追加したら、ここにも
// 対応するフィールドを追加してTypeScriptに型を伝える必要がある。

// 認証ミドルウェア(src/middleware/auth.ts)がJWT検証後にセットする。
// 各ルートハンドラはトークンを自分で再デコードせず`c.get('payload')`で読める。
export type Variables = {
  payload: JwtPayload;
};

export type Bindings = {
  DB: D1Database; // D1データベースバインディング(wrangler.jsoncのd1_databases参照)
  ASSETS: Fetcher; // public/ディレクトリ(SPA本体)を配信する静的アセットバインディング
  DOMAIN: string; // このWorkerが動いている公開ホスト名(例: monpass.example.com)
  ISSUE_START_DATE: string; // QR発行期間の既定開始日(ISO形式、/admin/settingsで上書き可)
  ISSUE_END_DATE: string; // QR発行期間の既定終了日(ISO形式、/admin/settingsで上書き可)
  MAX_TICKETS: string; // 生徒1人あたりの発行上限枚数(lib/config.tsで数値にパースする)
  JWT_SECRET: string; // 認証トークンの署名鍵。平文varsではなくWorkers Secret(`wrangler secret put`で設定)
};

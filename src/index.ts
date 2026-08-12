// アプリのエントリポイント。このWorker 1つでJSON API(下でマウントする各ルート)と
// 静的フロントエンド(末尾のcatch-all)の両方を同一オリジンから配信する。
// フロントエンド用の別デプロイやCORS設定は不要、ビルドステップもない(public/参照)。
import { Hono } from "hono";
import type { Bindings, Variables } from "./env";
import { authRoutes } from "./routes/auth";
import { ticketRoutes } from "./routes/ticket";
import { adminRoutes } from "./routes/admin";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/auth", authRoutes);
app.route("/ticket", ticketRoutes);
app.route("/admin", adminRoutes);

// wrangler.jsonc の `run_worker_first` が `true`(パスごとの配列形式ではなく)なので、
// 全リクエストがまずこのWorkerに届く。上のAPIルートにマッチしなかったものは、
// ここでASSETSバインディングにフォールバックする(SPAのindex.html、/static/js/*等)。
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;

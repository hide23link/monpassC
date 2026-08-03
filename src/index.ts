import { Hono } from "hono";
import type { Bindings, Variables } from "./env";
import { authRoutes } from "./routes/auth";
import { ticketRoutes } from "./routes/ticket";
import { promoteRoutes } from "./routes/promote";
import { adminRoutes } from "./routes/admin";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/auth", authRoutes);
app.route("/ticket", ticketRoutes);
app.route("/promote", promoteRoutes);
app.route("/admin", adminRoutes);

// `run_worker_first` is `true` (not the per-path array form — see
// wrangler.jsonc) so every request reaches this Worker first; anything not
// matched by an API route above falls back to the static assets binding
// (SPA index.html, /static/js/*, etc.).
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;

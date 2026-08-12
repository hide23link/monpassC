import type { Config } from "./config";

// QR発行期間(issue_start/issue_end)は、管理画面の設定ページ(PUT /admin/settings)
// から実行時に上書きでき、`settings`テーブルに書き込まれる。管理者がまだ設定して
// いない場合は、Worker変数の ISSUE_START_DATE/ISSUE_END_DATE(wrangler.jsonc.template
// 参照)にフォールバックする。
export async function getIssuePeriod(
  db: D1Database,
  config: Config,
): Promise<{ issueStart: string; issueEnd: string }> {
  const rows = await db.prepare("SELECT key, value FROM settings").all<{
    key: string;
    value: string;
  }>();
  const map = new Map(rows.results.map((r) => [r.key, r.value]));
  return {
    issueStart: map.get("issue_start") ?? config.issueStartDate,
    issueEnd: map.get("issue_end") ?? config.issueEndDate,
  };
}

// Cloudflare Workersはリクエスト元の地域に関係なく常にUTCで動作するため、
// 発行期間の比較に使う「今日」は常にUTC基準の今日になる。現地の日付の変わり目と
// UTCの日付の変わり目がズレるタイムゾーンの学校で使う場合は注意。
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

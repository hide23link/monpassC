import type { Config } from "./config";

// Ports main.py's get_issue_period(conn): reads the `settings` table,
// falling back to the env-configured defaults if a key is missing.
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

// Ports Python's date.today().isoformat() — UTC "today" for the issue-period
// comparison (production runs in UTC; see PLAN.md implementation notes).
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Shared aggregate-entry-status logic, used by both /admin/dashboard (full
// breakdown, admin-only) and /ticket/status (summary + graph, staff/admin —
// added so staff can see "現在の来場状況" without needing admin access).

export function bucketKey(usedAt: string): string | null {
  const d = new Date(usedAt);
  if (Number.isNaN(d.getTime())) return null;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = d.getUTCMinutes() >= 30 ? "30" : "00";
  return `${hh}:${mm}`;
}

export type EntryStatus = {
  totalEntries: number;
  unusedCount: number;
  graphData: Record<string, number>;
};

export async function getEntryStatus(db: D1Database): Promise<EntryStatus> {
  const totalEntries =
    (await db.prepare("SELECT COUNT(*) as cnt FROM tickets WHERE used = 1").first<{ cnt: number }>())
      ?.cnt ?? 0;
  const unusedCount =
    (
      await db
        .prepare("SELECT COUNT(*) as cnt FROM tickets WHERE used = 0 AND is_valid = 1")
        .first<{ cnt: number }>()
    )?.cnt ?? 0;

  const usedAtRows = await db
    .prepare("SELECT used_at FROM tickets WHERE used = 1 AND used_at IS NOT NULL")
    .all<{ used_at: string }>();
  const graphData: Record<string, number> = {};
  for (const row of usedAtRows.results) {
    const key = bucketKey(row.used_at);
    if (key === null) continue;
    graphData[key] = (graphData[key] ?? 0) + 1;
  }

  return { totalEntries, unusedCount, graphData };
}

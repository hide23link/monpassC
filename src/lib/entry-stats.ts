// 入場状況の集計ロジックを共通化したもの。/admin/dashboard(管理者専用の詳細版)と
// /ticket/status(スタッフも見られるサマリー+グラフ版。スタッフが管理者権限なしでも
// 「現在の来場状況」を確認できるよう追加した)の両方から呼ばれる。

// 入場時刻を30分単位の区切り(例: "14:00" or "14:30")に丸める。ダッシュボードの
// 「時間帯別入場数」棒グラフのX軸ラベルになる。UTC基準で丸めている点に注意
// (todayIso()と同じ理由でWorkersはUTC動作のため)。
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

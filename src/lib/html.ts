// Pythonのhtml.escape(s, quote=True)相当。招待者名(guest_name)はD1に保存する
// 「前」にここでエスケープ済みの状態で書き込む(表示時ではなく保存時にエスケープ)。
// これにより、チケット一覧・管理画面・CSVエクスポートなど招待者名を表示する
// すべての箇所が、呼び出し側でエスケープし忘れる心配なく安全になる。
export function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

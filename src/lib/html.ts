// Ports Python's html.escape(s, quote=True) — used on guest_name before
// storage (main.py:611). See PLAN.md section 3: kept as a straight port for
// now rather than moving escaping to the frontend, to avoid changing the
// stored-data contract that test_TC_09_02_002 (XSS in guest name) checks.
export function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

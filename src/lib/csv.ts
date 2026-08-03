import Encoding from "encoding-japanese/encoding.js";

// Ports main.py's encoding fallback chain (utf-8-sig -> utf-8 -> shift_jis ->
// cp932) using encoding-japanese's statistical detector instead, since
// Workers has no guarantee of ICU/TextDecoder coverage for shift_jis/cp932
// (see PLAN.md section 3 and risk #3). Strips a UTF-8 BOM first so
// Encoding.detect isn't confused by it either way.
export function decodeCsvBytes(bytes: Uint8Array): string {
  let data = bytes;
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    data = data.slice(3);
  }
  const detected = Encoding.detect(data);
  const from = detected || "UTF8";
  const unicodeArray = Encoding.convert(Array.from(data), { to: "UNICODE", from, type: "array" });
  return Encoding.codeToString(unicodeArray);
}

// Minimal RFC4180 CSV parser (quoted fields, embedded commas/newlines,
// doubled-quote escaping) — matches Python's csv.reader default dialect.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== "" || row.length > 0) pushRow();

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function toCsvField(value: unknown): string {
  const s = String(value ?? "");
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsvRow(fields: unknown[]): string {
  return fields.map(toCsvField).join(",");
}

// Ports main.py's make_csv_response(): UTF-8 BOM-prefixed CSV response
// (Excel/Numbers/Sheets compatibility).
export function csvResponse(rows: unknown[][], filename: string): Response {
  const body = rows.map(toCsvRow).join("\r\n") + "\r\n";
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  const encoded = new TextEncoder().encode(body);
  const combined = new Uint8Array(bom.length + encoded.length);
  combined.set(bom, 0);
  combined.set(encoded, bom.length);
  return new Response(combined, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=${filename}`,
    },
  });
}

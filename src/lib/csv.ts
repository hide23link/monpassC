import Encoding from "encoding-japanese/encoding.js";

// 日本の学校の名簿CSVはExcelからShift_JISでエクスポートされることが多いが、
// Cloudflare Workers上ではブラウザ標準のTextDecoderがshift_jis/cp932を確実に
// サポートしているとは限らない。そこでencoding-japaneseの統計的検出機能
// (Encoding.detect)でバイトパターンから文字コードを推定し、管理者が手動で
// 選択しなくて済むようにしている。先頭のUTF-8 BOMは、Encoding.detectを
// 惑わせないよう事前に取り除く。旧Python版のエンコーディング判定チェーン
// (utf-8-sig -> utf-8 -> shift_jis -> cp932)を踏襲した挙動。
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

// 旧Python版のmake_csv_response()を移植: UTF-8 BOM付きのCSVレスポンスを返す
// (Excel/Numbers/Sheetsで開いたときに文字化けしないようにするため)。
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

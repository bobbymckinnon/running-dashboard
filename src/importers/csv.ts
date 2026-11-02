/**
 * Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF/LF).
 * Bounded by maxRows so a malformed or huge file cannot exhaust memory.
 */
export function parseCsv(text: string, maxRows = 100000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; // skip BOM
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
    } else if (c === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (c === "\n" || c === "\r") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      if (rows.length >= maxRows) return rows;
      if (c === "\r" && text[i + 1] === "\n") i++;
      i++;
    } else {
      field += c;
      i++;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

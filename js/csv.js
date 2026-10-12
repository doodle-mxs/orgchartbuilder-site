// Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF,
// and auto-detected delimiter (comma, semicolon or tab).
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const count = (d) => firstLine.split(d).length;
  const delim = [',', ';', '\t'].reduce((best, d) => (count(d) > count(best) ? d : best), ',');

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!nonEmpty.length) return { headers: [], records: [] };

  // Blank or duplicate headers get unique names so every column stays addressable.
  const seen = new Map();
  const headers = nonEmpty[0].map((h, i) => {
    let name = h.trim() || `Column ${i + 1}`;
    const n = seen.get(name) || 0;
    seen.set(name, n + 1);
    if (n) name = `${name} (${n + 1})`;
    return name;
  });
  const records = nonEmpty.slice(1).map((r) =>
    Object.fromEntries(headers.map((h, j) => [h, (r[j] ?? '').trim()])));
  return { headers, records };
}

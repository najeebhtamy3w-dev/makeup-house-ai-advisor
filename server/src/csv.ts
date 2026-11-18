/** RFC4180-ish CSV parser. Handles quotes, CRLF, BOM. Returns raw string cells (barcodes stay text). */
export function parseCSV(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const out: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  const endRow = () => { row.push(cell); cell = ''; if (row.some((c) => c.trim() !== '')) out.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; endRow(); }
    else cell += c;
  }
  if (cell !== '' || row.length) endRow();
  return out;
}

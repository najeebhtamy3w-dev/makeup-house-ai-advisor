/**
 * Minimal dependency-free XLSX reader (first worksheet only).
 * Reads shared strings / inline strings / numbers as TEXT so barcodes are never coerced.
 * Limitation: a barcode typed as a *number* in Excel has already lost its leading zeros in the file;
 * we flag numeric cells so the importer can warn.
 */
import { inflateRawSync } from 'node:zlib';

// Zip-bomb guards: caps on entry count, per-entry and total decompressed size.
const MAX_ENTRIES = 300, MAX_ENTRY = 40 * 1024 * 1024, MAX_TOTAL = 80 * 1024 * 1024;
function unzip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ملف XLSX غير صالح');
  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES) throw new Error('ملف XLSX يحتوي ملفات كثيرة جدًا');
  let total = 0;
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ملف XLSX تالف');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(lho + 26), lelen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lelen;
    const raw = buf.subarray(start, start + csize);
    if (total > MAX_TOTAL) throw new Error('ملف XLSX كبير جدًا بعد فك الضغط');
    if (method === 0) { files.set(name, Buffer.from(raw)); total += raw.length; }
    else if (method === 8) {
      let out: Buffer;
      try { out = inflateRawSync(raw, { maxOutputLength: MAX_ENTRY }); } catch { throw new Error('ملف XLSX تالف أو يتجاوز الحد المسموح بعد فك الضغط'); }
      files.set(name, out); total += out.length;
    }
    p += 46 + nlen + elen + clen;
  }
  return files;
}

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');

function textOf(xml: string): string {
  return [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1]!)).join('');
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)![0];
  return letters.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

export interface XlsxResult { rows: string[][]; numericCells: number }

export function parseXLSX(buf: Buffer): XlsxResult {
  const files = unzip(buf);
  const shared: string[] = [];
  const ss = files.get('xl/sharedStrings.xml')?.toString('utf8');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]!));
  let sheetName = 'xl/worksheets/sheet1.xml';
  if (!files.has(sheetName)) sheetName = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0] ?? '';
  const xml = files.get(sheetName)?.toString('utf8');
  if (!xml) throw new Error('لا توجد ورقة عمل في الملف');
  const rows: string[][] = [];
  let numericCells = 0;
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]!, inner = cm[2] ?? '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const t = /t="(\w+)"/.exec(attrs)?.[1] ?? 'n';
      let v = '';
      if (t === 's') v = shared[Number(/<v>(\d+)<\/v>/.exec(inner)?.[1])] ?? '';
      else if (t === 'inlineStr') v = textOf(inner);
      else { v = unesc(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? ''); if (t === 'n' && v !== '') numericCells++; }
      const idx = ref ? colIndex(ref) : row.length;
      while (row.length < idx) row.push('');
      row[idx] = v;
    }
    if (row.some((c) => c.trim() !== '')) rows.push(row);
  }
  return { rows, numericCells };
}

import { parseCSV } from './csv.ts';
import { parseXLSX } from './xlsx.ts';
import { gtinValid, normalizeBarcode } from './gtin.ts';

/** Only these columns are ever read. Everything else (prices, costs, quantities...) is dropped unread. */
const ALLOWED = ['barcode', 'name', 'brand', 'category', 'size', 'availability'] as const;
const ALIASES: Record<string, (typeof ALLOWED)[number]> = {
  barcode: 'barcode', 'الباركود': 'barcode', ean: 'barcode', upc: 'barcode', gtin: 'barcode',
  name: 'name', 'الاسم': 'name', 'اسم المنتج': 'name', 'المنتج': 'name',
  brand: 'brand', 'العلامة': 'brand', 'العلامة التجارية': 'brand',
  category: 'category', 'التصنيف': 'category', 'الفئة': 'category',
  size: 'size', 'الحجم': 'size',
  availability: 'availability', 'التوفر': 'availability',
};
/** CP05: the product API only accepts these categories. Unknown values used to be stored verbatim, which later made every
 *  edit of that product fail validation. They are now mapped (exact or synonym) or fall back to 'أخرى' with a warning. */
export const CATEGORIES = ['العناية بالبشرة', 'العناية بالشعر', 'واقيات الشمس', 'المكياج والجمال', 'العطور والعناية', 'أخرى'] as const;
const CAT_SYN: Record<string, (typeof CATEGORIES)[number]> = {
  skincare: 'العناية بالبشرة', 'skin care': 'العناية بالبشرة', بشرة: 'العناية بالبشرة', 'العناية بالبشره': 'العناية بالبشرة',
  haircare: 'العناية بالشعر', 'hair care': 'العناية بالشعر', hair: 'العناية بالشعر', شعر: 'العناية بالشعر',
  sunscreen: 'واقيات الشمس', 'sun care': 'واقيات الشمس', 'واقي شمس': 'واقيات الشمس', 'واقي الشمس': 'واقيات الشمس',
  makeup: 'المكياج والجمال', 'make up': 'المكياج والجمال', مكياج: 'المكياج والجمال', ميكب: 'المكياج والجمال',
  fragrance: 'العطور والعناية', perfume: 'العطور والعناية', عطور: 'العطور والعناية', عطر: 'العطور والعناية',
  other: 'أخرى', اخرى: 'أخرى', أخرى: 'أخرى',
};
export function mapCategory(v: string): { value: (typeof CATEGORIES)[number]; known: boolean } {
  const t = v.trim(); if (!t) return { value: 'أخرى', known: true };
  if ((CATEGORIES as readonly string[]).includes(t)) return { value: t as (typeof CATEGORIES)[number], known: true };
  const s = CAT_SYN[t.toLowerCase()] ?? CAT_SYN[t];
  return s ? { value: s, known: true } : { value: 'أخرى', known: false };
}
export const MAX_IMPORT_ROWS = 10000;
const AVAIL: Record<string, 'yes' | 'no' | 'unknown'> = {
  yes: 'yes', متوفر: 'yes', no: 'no', 'غير متوفر': 'no', unknown: 'unknown', 'غير مؤكد': 'unknown',
};

export interface ImportRow { line: number; barcode: string; name: string; brand: string; category: string; size: string; availability: 'yes' | 'no' | 'unknown' | null }
export interface ParsedImport {
  rows: ImportRow[];
  invalid: { line: number; reason: string }[];   // reasons never include cell values
  ignoredColumns: string[];                       // header names only
  warnings: string[];
}

export function parseImport(filename: string, data: Buffer): ParsedImport {
  let table: string[][];
  let numericCells = 0;
  const warnings: string[] = [];
  if (/\.xlsx$/i.test(filename)) {
    const r = parseXLSX(data);
    table = r.rows;
    numericCells = r.numericCells;
  } else if (/\.csv$/i.test(filename)) {
    table = parseCSV(data.toString('utf8'));
  } else throw new Error('نوع الملف غير مدعوم. استخدم CSV أو XLSX');

  if (table.length - 1 > MAX_IMPORT_ROWS) throw new Error(`الملف يحتوي أكثر من ${MAX_IMPORT_ROWS.toLocaleString('en')} صف. قسّمه إلى ملفات أصغر وارفعها تباعًا (إعادة الرفع لا تكرر المنتجات).`);
  const header = (table.shift() ?? []).map((h) => h.replace(/^\uFEFF/, '').trim());
  const map = new Map<number, (typeof ALLOWED)[number]>();
  const ignoredColumns: string[] = [];
  header.forEach((h, i) => {
    const k = ALIASES[h.toLowerCase()] ?? ALIASES[h];
    if (k && ![...map.values()].includes(k)) map.set(i, k); else if (h) ignoredColumns.push(h);
  });
  if (![...map.values()].includes('name')) throw new Error('يجب وجود عمود الاسم (name)');

  const rows: ImportRow[] = [];
  const invalid: { line: number; reason: string }[] = [];
  const hasBarcodeCol = [...map.values()].includes('barcode');
  let unknownCats = 0, rawBarcodes = 0;
  table.forEach((cells, idx) => {
    const line = idx + 2;
    const rec: Record<string, string> = {};
    for (const [i, k] of map) rec[k] = (cells[i] ?? '').trim();
    if (!rec.name) { invalid.push({ line, reason: 'الاسم فارغ' }); return; }
    if (rec.barcode) rawBarcodes++;
    if (rec.barcode && /^\s*[\d.,]+\s*e\s*[+]?\s*\d+\s*$/i.test(rec.barcode)) { invalid.push({ line, reason: 'الباركود بصيغة علمية من Excel (مثل 6.29E+12) وفُقدت أرقامه — نسّق العمود كنص' }); return; }
    const barcode = normalizeBarcode(rec.barcode);
    if (barcode && !gtinValid(barcode)) { invalid.push({ line, reason: 'باركود غير صالح (الطول أو رقم التحقق)' }); return; }
    const av = rec.availability ? AVAIL[rec.availability.toLowerCase()] ?? AVAIL[rec.availability] : undefined;
    if (rec.availability && !av) { invalid.push({ line, reason: 'قيمة التوفر غير معروفة' }); return; }
    const cat = mapCategory(rec.category ?? ''); if (!cat.known) unknownCats++;
    rows.push({ line, barcode, name: rec.name!, brand: rec.brand ?? '', category: cat.value, size: rec.size ?? '', availability: av ?? null });
  });
  if (hasBarcodeCol && rawBarcodes > 0 && rows.length && rows.every((r) => r.barcode === '')) warnings.push('لم يُقرأ أي باركود. تأكد أن عمود الباركود منسّق كنص في Excel حتى لا تضيع الأصفار البادئة.');
  if (numericCells > 0 && hasBarcodeCol && rows.some((r) => r.barcode && r.barcode.length < 12))
    warnings.push('بعض الباركودات قصيرة: قد تكون خانات Excel رقمية وفُقدت أصفارها البادئة. نسّق العمود كنص ثم أعد التصدير.');
  if (unknownCats) warnings.push(`${unknownCats} صف بتصنيف غير معروف: سُجّل كـ«أخرى». التصنيفات المقبولة: ${CATEGORIES.join('، ')}.`);
  return { rows, invalid, ignoredColumns, warnings };
}

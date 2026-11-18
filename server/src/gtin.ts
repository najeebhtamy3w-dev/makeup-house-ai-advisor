/** Validates GTIN-8/12/13/14 (EAN/UPC) including the check digit. Barcode is kept as TEXT (leading zeros matter). */
export function gtinValid(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  if (![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  let sum = 0;
  digits.reverse().forEach((d, i) => { sum += d * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}

export function normalizeBarcode(raw: unknown): string {
  // Arabic-Indic digits from some keyboards/scanners -> ASCII, strip spaces.
  const map: Record<string, string> = {};
  '٠١٢٣٤٥٦٧٨٩'.split('').forEach((c, i) => (map[c] = String(i)));
  '۰۱۲۳۴۵۶۷۸۹'.split('').forEach((c, i) => (map[c] = String(i)));
  return String(raw ?? '').trim().replace(/[٠-٩۰-۹]/g, (c) => map[c]!).replace(/\s+/g, '');
}

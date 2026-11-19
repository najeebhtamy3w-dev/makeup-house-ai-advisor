import { norm } from '../advisor.ts';

/** Product identity comparison (name / brand / size) and formulation (INCI list) comparison.
 *  Name similarity alone NEVER proves the same formulation: callers must treat 'partial' and 'conflict' as needing human review. */
export type Match = 'exact' | 'partial' | 'conflict';
export interface FieldCmp { match: Match; note: string }

const UNITS: Record<string, [string, number]> = { ml: ['ml', 1], مل: ['ml', 1], l: ['ml', 1000], لتر: ['ml', 1000], cl: ['ml', 10], g: ['g', 1], gr: ['g', 1], جم: ['g', 1], غ: ['g', 1], جرام: ['g', 1], kg: ['g', 1000], oz: ['g', 28.3495], 'fl oz': ['ml', 29.5735] };
/** "200 ml", "200ml", "٢٠٠ مل", "6.7 fl oz" => {unit:'ml', v:200}. null when no unit/number is recognisable. */
export function parseSize(s: string): { unit: string; v: number } | null {
  const t = s.normalize('NFKC').toLowerCase().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/,/g, '.');
  const m = t.match(/(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|ml|cl|kg|gr|g|l|oz|مل|لتر|جم|جرام|غ)(?![\p{L}])/u);
  if (!m) return null;
  const key = m[2]!.replace(/\./g, '').replace(/\s+/g, ' '); const u = UNITS[key]; if (!u) return null;
  return { unit: u[0], v: Math.round(Number(m[1]) * u[1] * 100) / 100 };
}
export function compareSize(a: string, b: string): FieldCmp {
  const x = parseSize(a), y = parseSize(b);
  if (!x || !y) return norm(a) === norm(b) ? { match: 'exact', note: '' } : { match: 'partial', note: 'تعذر تفسير الحجم تلقائيًا' };
  if (x.unit !== y.unit) return { match: 'conflict', note: 'وحدات حجم مختلفة' };
  return Math.abs(x.v - y.v) < 0.5 ? { match: 'exact', note: '' } : { match: 'conflict', note: `اختلاف الحجم (${a} ≠ ${b}) — قد تختلف التركيبة أو الإصدار` };
}
const tok = (s: string) => norm(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
export function compareName(a: string, b: string): FieldCmp {
  const x = new Set(tok(a)), y = new Set(tok(b)); if (!x.size || !y.size) return { match: 'partial', note: 'اسم ناقص' };
  const inter = [...x].filter((t) => y.has(t)).length; const j = inter / new Set([...x, ...y]).size;
  if (j === 1) return { match: 'exact', note: '' };
  return j >= 0.6 ? { match: 'partial', note: 'تشابه جزئي في الاسم — قد يكون إصدارًا/درجة/حجمًا مختلفًا' } : { match: 'conflict', note: 'الاسم مختلف' };
}
export const compareBrand = (a: string, b: string): FieldCmp => (norm(a) === norm(b) ? { match: 'exact', note: '' } : { match: 'conflict', note: 'العلامة التجارية مختلفة' });

/** Normalised INCI tokens: lower-case, parentheses/percent/punctuation removed, "aqua/water/eau" unified. */
export function inciList(s: string): string[] {
  return s.normalize('NFKC').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[*.;]/g, ',').split(/[,،\n]/).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean)
    .map((t) => (t === 'water' || t === 'eau' || t === 'aqua' || t.startsWith('aqua ') ? 'aqua' : t));
}
export function compareIngredients(a: string, b: string): FieldCmp {
  const x = inciList(a), y = inciList(b); if (!x.length || !y.length) return { match: 'partial', note: 'قائمة مكونات ناقصة' };
  if (x.join('|') === y.join('|')) return { match: 'exact', note: '' };
  const sx = new Set(x), sy = new Set(y); const inter = [...sx].filter((t) => sy.has(t)).length; const j = inter / new Set([...sx, ...sy]).size;
  const sameSet = sx.size === sy.size && inter === sx.size;
  if (sameSet) return { match: 'partial', note: 'نفس المكونات بترتيب مختلف (الترتيب يدل على التركيز النسبي)' };
  return j >= 0.9 ? { match: 'partial', note: 'اختلاف طفيف في قائمة المكونات' } : { match: 'conflict', note: 'قائمة المكونات مختلفة — قد تكون تركيبة/سوقًا/إصدارًا مختلفًا' };
}
export function compareField(field: string, local: string, candidate: string): FieldCmp | null {
  if (!local.trim()) return null; // nothing local to compare with
  switch (field) { case 'size': return compareSize(local, candidate); case 'name': return compareName(local, candidate); case 'brand': return compareBrand(local, candidate); case 'ingredients': return compareIngredients(local, candidate); default: return null; }
}

/**
 * CP05: is a source's "ingredients" text actually an ingredient LIST? Marketing sentences ("La formule maintient l'hydratation…")
 * must never be treated as INCI. Translated lists ("Eau, glycérine…") are lists but not standard INCI names -> flagged for review.
 */
export type IngredientsKind = 'inci' | 'translated' | 'not_a_list';
const TRANSLATED_WATER = /^(eau|wasser|agua|acqua|água|ماء|مياه|su)$/i;
export function classifyIngredients(text: string): { kind: IngredientsKind; note: string } {
  const t = text.normalize('NFKC').trim();
  const items = t.replace(/\([^)]*\)/g, ' ').split(/[,،;]/).map((x) => x.trim()).filter(Boolean);
  const words = (x: string) => x.split(/\s+/).filter(Boolean).length;
  const shortItems = items.filter((x) => words(x) <= 6 && x.length <= 60).length;
  const sentence = /[.!?…]\s+\p{Lu}|\b(votre|vous|your|you|helps?|aide|pour une|for a|leaves?|laisse)\b/iu.test(t);
  if (!items.length || shortItems / items.length < 0.75 || (sentence && items.length < 8) || (items.length === 1 && words(items[0]!) > 4))
    return { kind: 'not_a_list', note: 'النص لا يبدو قائمة مكونات (قد يكون وصفًا تسويقيًا) — لا يُعامل كقائمة INCI' };
  // mixed blobs: a marketing paragraph before the list, or OCR noise (e.g. the barcode digits inside the list) -> not proposed
  if (words(items[0]!) > 8 || items.some((x) => /\d{3,}\s+\d{4,}/.test(x)))
    return { kind: 'not_a_list', note: 'نص مختلط (وصف تسويقي أو أخطاء قراءة آلية مع المكونات) — لا يُقترح؛ انقل المكونات من العبوة' };
  const first = (items[0] ?? '').toLowerCase().replace(/^[^\p{L}]+/u, '').split(/\s+/)[0] ?? '';
  if (TRANSLATED_WATER.test(first) || /[éèêàçñäöüß]/i.test(items.slice(0, 6).join(' ')) || /[؀-ۿ]/.test(t))
    return { kind: 'translated', note: 'قائمة مترجمة وليست بأسماء INCI القياسية — قارنها بالعبوة قبل الاعتماد' };
  return { kind: 'inci', note: '' };
}

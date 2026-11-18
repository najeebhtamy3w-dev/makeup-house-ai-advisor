/**
 * Retrieval advisor — deterministic, NO LLM, NO invented facts. Pipeline (spec 7.1):
 *  1 Intent understanding (normalised Arabic incl. common Yemeni spellings)  2 Knowledge retrieval (stored products only)
 *  3 Suitability evaluation (documented fields only)  4 Availability verification (kept SEPARATE from suitability)  5 Response.
 * A language model, if ever enabled, may only re-phrase this output (see ai/provider.ts guard).
 */
export type P = { id: number; name: string; brand: string; category: string; size: string; ingredients: string; warnings: string; benefits?: string; source_url?: string; verification: string; availability_effective: string; availability_stale: boolean; barcode?: string | null };
export interface AdviseOpts { conflictIds?: Set<number> }

/** Strip diacritics/tatweel, unify alef/yaa/taa-marbuta so "جافة/جافه", "حساسة/حساسه", "دهنية/دهنيه" match. */
export const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[ً-ٟـ]/g, '').replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();

const SEVERE = new RegExp('(' + ['تورم', 'طفح شديد', 'حكه شديده', 'حروق', 'حرق', 'التهاب شديد', 'صعوبه في التنفس', 'حساسيه شديده', 'نزيف', 'عدوي', 'جروح', 'صديد', 'انتفاخ'].map(norm).join('|') + ')');
const NO_FRAGRANCE = /(خالي من العطر|خالي من العطور|بدون عطر|ما فيه عطر|ماله ريحه|بلا عطر|بدون ريحه|fragrance[- ]?free|unscented)/i;
const FRAGRANCE_TERMS = /(parfum|fragrance|perfume|aroma|عطر)/i;

interface Topic { id: string; re: RegExp; category?: string; nameTerms: string[] }
const TOPICS: Topic[] = [
  { id: 'sun', re: /(شمس|spf|sunscreen|سن بلوك)/i, category: 'واقيات الشمس', nameTerms: ['شمس', 'spf', 'sun'] },
  { id: 'hair', re: /(شعر|بلسم|شامبو|فروه|قشره|تساقط)/, category: 'العناية بالشعر', nameTerms: ['شعر', 'بلسم', 'شامبو', 'hair'] },
  { id: 'moist', re: /(مرطب|ترطيب|جاف|جفاف|كريم)/, nameTerms: ['مرطب', 'كريم', 'moistur'] },
  { id: 'clean', re: /(غسول|منظف|تنظيف)/, nameTerms: ['غسول', 'منظف', 'cleanser'] },
  { id: 'skin', re: /(بشر|وجه|حبوب|حب الشباب|دهني|زيتي)/, category: 'العناية بالبشرة', nameTerms: [] },
];
const MAX_STORE = 8, MAX_UNASSESSED = 6;
const SKIN_TYPE = /(جاف|دهني|زيتي|مختلط|عاديه|حساس)/;

export function advise(query: string, products: P[], opts: AdviseOpts = {}) {
  const q = norm(query);
  const notes: string[] = [];
  const base = { llm: false, engine: 'retrieval' as const, follow_up: null as null | { question: string; choices: string[] }, global_alternatives: { status: 'not_configured', items: [] as unknown[] } };
  if (SEVERE.test(q)) return { ...base, safety_note: 'الأعراض المذكورة قد تحتاج تقييمًا صحيًا. لا تُقدَّم توصية منتج؛ انصح العميل بمراجعة مختص صحي.', store_matches: [], cannot_assess: [], notes };

  const avoidFragrance = NO_FRAGRANCE.test(q);
  const topics = TOPICS.filter((t) => t.re.test(q));
  if (!topics.length) notes.push('لم أتعرف على نوع المنتج المطلوب. وضّح: بشرة، شعر، واقي شمس، مرطب…');
  if (/(حساس|تهيج|يهيج|يحرق|يحك)/.test(q)) notes.push('الحساسية: لا يوجد منتج «آمن لجميع الأشخاص». راجع المكونات والتحذيرات وجرّب على منطقة صغيرة وفق تعليمات العبوة.');
  if (/(حبوب|حب الشباب)/.test(q)) notes.push('الحبوب الملتهبة أو المؤلمة أو المنتشرة تحتاج تقييم مختص. المنتجات التجميلية لا تعالج الحالات المرضية.');
  if (/(قشره|تساقط)/.test(q)) notes.push('القشرة الشديدة أو التساقط الملحوظ قد يكون له سبب طبي؛ انصح بمراجعة مختص عند الاستمرار.');

  // contextual follow-up (short, answerable while the customer is standing there)
  if (topics.some((t) => ['moist', 'skin', 'clean'].includes(t.id)) && !SKIN_TYPE.test(q)) base.follow_up = { question: 'ما نوع بشرة العميل؟', choices: ['جافة', 'دهنية', 'مختلطة', 'حساسة'] };
  else if (topics.some((t) => t.id === 'hair') && !/(جاف|دهني|مصبوغ|مجعد|ناعم|قشره|تساقط)/.test(q)) base.follow_up = { question: 'ما حاجة الشعر؟', choices: ['جاف', 'دهني', 'مصبوغ', 'قشرة'] };

  const matched = products.map((p) => {
    const reasons: string[] = []; let score = 0; const nm = norm(p.name);
    for (const t of topics) {
      if (t.category && p.category === t.category) { score += 3; reasons.push(`التصنيف مطابق: ${p.category}`); }
      if (t.nameTerms.some((w) => nm.includes(norm(w)))) { score += 2; reasons.push('اسم المنتج يطابق الطلب'); }
    }
    return { p, score, reasons };
  }).filter((x) => x.score > 0);

  const store_matches: Record<string, unknown>[] = []; const cannot_assess: Record<string, unknown>[] = [];
  for (const { p, score, reasons } of matched) {
    const documented = p.ingredients.trim().length > 0;
    const suitReasons = [...new Set(reasons)];
    let level: 'documented' | 'partial' | 'unknown' = documented && p.verification === 'verified' ? 'documented' : documented || p.verification === 'partial' ? 'partial' : 'unknown';
    if (avoidFragrance) {
      if (!documented) { cannot_assess.push(entry(p, level, suitReasons, opts, 'لا توجد مكونات موثقة، لا يمكن التأكد من خلوه من العطر')); continue; }
      if (FRAGRANCE_TERMS.test(p.ingredients)) continue; // documented fragrance → excluded
      suitReasons.push('المكونات الموثقة لا تحتوي على عطر (حسب القائمة المسجلة للإصدار نفسه)');
    }
    const conflict = opts.conflictIds?.has(p.id) ?? false;
    if (conflict) level = level === 'documented' ? 'partial' : level;
    // rank = suitability FIRST; availability only a tie-breaker (spec: separate availability from suitability)
    const rank = score * 10 + (level === 'documented' ? 6 : level === 'partial' ? 3 : 0) - (conflict ? 2 : 0) + (p.availability_effective === 'yes' ? 1 : 0);
    store_matches.push({ ...entry(p, level, suitReasons, opts), _rank: rank });
  }
  store_matches.sort((a, b) => (b._rank as number) - (a._rank as number)).forEach((e) => delete e._rank);
  const totals = { store: store_matches.length, cannot_assess: cannot_assess.length };
  if (store_matches.length > MAX_STORE) { store_matches.length = MAX_STORE; notes.push(`عُرض أفضل ${MAX_STORE} من ${totals.store} منتجًا مطابقًا. أضف تفصيلًا (نوع البشرة، العلامة…) لتضييق النتائج.`); }
  if (cannot_assess.length > MAX_UNASSESSED) cannot_assess.length = MAX_UNASSESSED;
  if (store_matches.length && store_matches.every((e) => (e.suitability as { level: string }).level !== 'documented')) notes.push('معلومات هذه المنتجات غير مكتملة أو غير معتمدة: اعرضها كخيارات للمراجعة وليس كتوصية حاسمة.');
  if (store_matches.some((e) => e.conflict)) notes.push('بعض المنتجات لديها معلومات متعارضة بين المصادر قيد مراجعة المدير.');
  return { ...base, safety_note: null, store_matches, cannot_assess, totals, notes };
}

function entry(p: P, level: 'documented' | 'partial' | 'unknown', reasons: string[], opts: AdviseOpts, reason?: string) {
  const av = p.availability_effective;
  return {
    id: p.id, name: p.name, brand: p.brand, size: p.size, category: p.category, verification: p.verification,
    // suitability and availability are separate blocks on purpose
    suitability: { level, reasons },
    availability: av,
    availability_note: p.availability_stale ? 'آخر تأكيد توفر قديم — تأكد من الرف قبل الوعد للعميل' : av === 'unknown' ? 'التوفر غير مؤكد — تأكد قبل التوصية' : av === 'no' ? 'غير متوفر حاليًا' : 'متوفر عند آخر تأكيد',
    warnings: p.warnings || null, source_url: p.source_url || null,
    conflict: opts.conflictIds?.has(p.id) ?? false,
    info_complete: level === 'documented', ...(reason ? { reason } : {}),
  };
}

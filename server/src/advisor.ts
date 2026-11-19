/**
 * Retrieval advisor — deterministic, NO LLM, NO invented facts. Pipeline (spec 7.1):
 *  1 Intent understanding (normalised Arabic incl. common Yemeni spellings)  2 Knowledge retrieval (stored products only)
 *  3 Suitability evaluation (documented fields only)  4 Availability verification (kept SEPARATE from suitability)  5 Response.
 * A language model, if ever enabled, may only re-phrase this output (see ai/provider.ts guard).
 */
export type P = { id: number; name: string; brand: string; category: string; size: string; ingredients: string; warnings: string; benefits?: string; source_url?: string; verification: string; availability_effective: string; availability_stale: boolean; barcode?: string | null; primary_image_id?: number | null; product_type?: string };
import { suggestTypeFromName, typeLabel } from './taxonomy.ts';
import { evaluate, type Need, type Avoid, type Evaluation } from './science/suitability.ts';
export interface AdviseOpts { conflictIds?: Set<number> }

/** Strip diacritics/tatweel, unify alef/yaa/taa-marbuta so "جافة/جافه", "حساسة/حساسه", "دهنية/دهنيه" match. */
export const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[ً-ٟـ]/g, '').replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();

const SEVERE = new RegExp('(' + ['تورم', 'طفح شديد', 'حكه شديده', 'حروق', 'حرق', 'التهاب شديد', 'صعوبه في التنفس', 'حساسيه شديده', 'نزيف', 'عدوي', 'جروح', 'صديد', 'انتفاخ'].map(norm).join('|') + ')');
const NO_FRAGRANCE = /(خالي من العطر|خالي من العطور|بدون عطر|ما فيه عطر|ماله ريحه|بلا عطر|بدون ريحه|fragrance[- ]?free|unscented)/i;

interface Topic { id: string; re: RegExp; category?: string; nameTerms: string[]; types?: string[] }
const TOPICS: Topic[] = [
  { id: 'sun', re: /(شمس|spf|sunscreen|سن بلوك)/i, category: 'واقيات الشمس', nameTerms: ['شمس', 'spf', 'sun'], types: ['sunscreen'] },
  { id: 'hair', re: /(شعر|بلسم|شامبو|فروه|قشره|تساقط)/, category: 'العناية بالشعر', nameTerms: ['شعر', 'بلسم', 'شامبو', 'hair'], types: ['shampoo', 'conditioner'] },
  { id: 'moist', re: /(مرطب|ترطيب|جاف|ناشف|جفاف|كريم)/, nameTerms: ['مرطب', 'كريم', 'moistur'] },
  { id: 'clean', re: /(غسول|منظف|تنظيف)/, nameTerms: ['غسول', 'منظف', 'cleanser'], types: ['cleanser'] },
  { id: 'skin', re: /(بشر|وجه|حبوب|حب الشباب|دهني|زيتي)/, category: 'العناية بالبشرة', nameTerms: [] },
];
const MAX_STORE = 8, MAX_UNASSESSED = 6;
const SKIN_TYPE = /(جاف|ناشف|دهني|زيتي|مختلط|عاديه|حساس)/;
const ASKS_FRAGRANCE = /(عطر|ريحه|رائحه|parfum|fragrance|perfume)/i;
const QUESTION = /(هل|فيه|فيها|يحتوي|يوجد|معه|ايش|وش)/;
const AVOID: [Avoid, RegExp][] = [['paraben', /(بدون|خالي من|ما فيه|بلا)\s*(ال)?بارابين|paraben[- ]?free/i], ['sulfate', /(بدون|خالي من|ما فيه|بلا)\s*(ال)?سلفات|sulfate[- ]?free/i], ['essential_oil', /(بدون|خالي من|ما فيه|بلا)\s*(ال)?زيوت عطريه|essential[- ]?oil[- ]?free/i]];
export function parseNeed(q: string, topicIds: string[]): Need {
  const skin: Need['skin'] = []; if (/(جاف|ناشف|جفاف)/.test(q)) skin.push('dry'); if (/(دهني|زيتي|لامع)/.test(q)) skin.push('oily'); if (/مختلط/.test(q)) skin.push('combination'); if (/(حساس|تهيج|يهيج)/.test(q)) skin.push('sensitive');
  const avoid: Avoid[] = []; if (NO_FRAGRANCE.test(q)) avoid.push('fragrance'); for (const [a, re] of AVOID) if (re.test(q)) avoid.push(a);
  return { topics: topicIds, skin, hairDry: /(جاف|ناشف|جفاف)/.test(q), avoid };
}

export function advise(query: string, products: P[], opts: AdviseOpts = {}) {
  const q = norm(query);
  const notes: string[] = [];
  const base = { llm: false, engine: 'retrieval' as const, follow_up: null as null | { question: string; choices: string[] }, global_alternatives: { status: 'not_configured', items: [] as unknown[] } };
  if (SEVERE.test(q)) return { ...base, answer: null, excluded: [], safety_note: 'الأعراض المذكورة قد تحتاج تقييمًا صحيًا. لا تُقدَّم توصية منتج؛ انصح العميل بمراجعة مختص صحي.', store_matches: [], cannot_assess: [], notes };

  // "هل هذا المنتج فيه عطر؟" — a question about ONE named product, not a recommendation request
  if (ASKS_FRAGRANCE.test(q) && QUESTION.test(q) && !NO_FRAGRANCE.test(q)) {
    const named = products.filter((p) => norm(p.name).length >= 3 && q.includes(norm(p.name))).sort((a, b) => b.name.length - a.name.length)[0];
    if (named) { const ev = evaluate(named, parseNeed(q, []), { conflict: opts.conflictIds?.has(named.id) }); return { ...base, safety_note: null, answer: { type: 'fragrance_status', product: { id: named.id, name: named.name, brand: named.brand }, fragrance: ev.fragrance, formulation: ev.formulation, availability: named.availability_effective }, store_matches: [], cannot_assess: [], excluded: [], totals: { store: 0, cannot_assess: 0, excluded: 0 }, notes: ['الإجابة مبنية على قائمة المكونات المسجلة فقط، وليست تقييمًا لحساسية شخص بعينه.'] }; }
    notes.push('لمعرفة وجود العطر اذكر اسم المنتج كما هو في الكتالوج أو امسح الباركود، ولن أخمّن.');
  }
  let topics = TOPICS.filter((t) => t.re.test(q));
  // a specific request (sunscreen / hair) must not be diluted by generic words: "بشرة" or the dryness word "جاف" alone do not make it a skin/moisturiser query
  if (topics.some((t) => t.id === 'sun' || t.id === 'hair')) topics = topics.filter((t) => t.id !== 'skin');
  if (topics.some((t) => t.id === 'hair') && !/(مرطب|ترطيب|كريم)/.test(q)) topics = topics.filter((t) => t.id !== 'moist');
  const need = parseNeed(q, topics.map((t) => t.id));
  if (!topics.length) notes.push('لم أتعرف على نوع المنتج المطلوب. وضّح: بشرة، شعر، واقي شمس، مرطب…');
  if (/(حساس|تهيج|يهيج|يحرق|يحك)/.test(q)) notes.push('الحساسية: لا يوجد منتج «آمن لجميع الأشخاص». راجع المكونات والتحذيرات وجرّب على منطقة صغيرة وفق تعليمات العبوة.');
  if (/(حبوب|حب الشباب)/.test(q)) notes.push('الحبوب الملتهبة أو المؤلمة أو المنتشرة تحتاج تقييم مختص. المنتجات التجميلية لا تعالج الحالات المرضية.');
  if (/(قشره|تساقط)/.test(q)) notes.push('القشرة الشديدة أو التساقط الملحوظ قد يكون له سبب طبي؛ انصح بمراجعة مختص عند الاستمرار.');

  // contextual follow-up (short, answerable while the customer is standing there)
  if (topics.some((t) => ['moist', 'skin', 'clean'].includes(t.id)) && !SKIN_TYPE.test(q)) base.follow_up = { question: 'ما نوع بشرة العميل؟', choices: ['جافة', 'دهنية', 'مختلطة', 'حساسة'] };
  else if (topics.some((t) => t.id === 'hair') && !/(جاف|دهني|مصبوغ|مجعد|ناعم|قشره|تساقط)/.test(q)) base.follow_up = { question: 'ما حاجة الشعر؟', choices: ['جاف', 'دهني', 'مصبوغ', 'قشرة'] };

  const askedType = suggestTypeFromName(query);
  const matched = products.map((p) => {
    const reasons: string[] = []; let score = 0; const nm = norm(p.name);
    for (const t of topics) {
      if (t.category && p.category === t.category) { score += 3; reasons.push(`التصنيف مطابق: ${p.category}`); }
      if (t.nameTerms.some((w) => nm.includes(norm(w)))) { score += 2; reasons.push('اسم المنتج يطابق الطلب'); }
      if (t.types && p.product_type && t.types.includes(p.product_type)) { score += 3; reasons.push(`نوع المنتج مطابق: ${typeLabel(p.product_type)}`); }
    }
    // CP05: a product FORM named in the request ("سيروم", "زيت"…) narrows RETRIEVAL only. It is never evidence of suitability.
    if (askedType && p.product_type === askedType) { score += 3; reasons.push(`نوع المنتج المطلوب: ${typeLabel(askedType)}`); }
    return { p, score, reasons };
  }).filter((x) => x.score > 0);

  const store_matches: Record<string, unknown>[] = []; const cannot_assess: Record<string, unknown>[] = []; const excluded: Record<string, unknown>[] = [];
  for (const { p, score, reasons } of matched) {
    const conflict = opts.conflictIds?.has(p.id) ?? false;
    const ev = evaluate(p, need, { conflict });
    const suitReasons = [...new Set(reasons)];
    const level: 'documented' | 'partial' | 'unknown' = ev.formulation.status === 'verified' ? 'documented' : ev.formulation.status === 'missing' ? 'unknown' : 'partial';
    if (ev.verdict === 'excluded') { excluded.push({ id: p.id, name: p.name, brand: p.brand, reasons: ev.exclusion_reasons }); continue; }
    if (ev.verdict === 'insufficient' && need.avoid.length) { cannot_assess.push(entry(p, level, suitReasons, opts, ev.missing[0], ev)); continue; }
    // rank = suitability FIRST; availability only a tie-breaker (spec: separate availability from suitability)
    const rank = score * 10 + ({ suitable: 6, conditional: 4, insufficient: 1, excluded: 0 }[ev.verdict]) - (conflict ? 2 : 0) + (p.availability_effective === 'yes' ? 1 : 0);
    store_matches.push({ ...entry(p, level, suitReasons, opts, undefined, ev), _rank: rank });
  }
  store_matches.sort((a, b) => (b._rank as number) - (a._rank as number)).forEach((e) => delete e._rank);
  // alternatives for a product that is not confirmed available: other matches that ARE confirmed available and not worse than "conditional"
  // CP05 audit fix: only the DISPLAYED matches need alternatives (was O(n²) over every match: ~9 s at 10k products with INCI)
  for (const e of store_matches.slice(0, MAX_STORE)) if (e.availability !== 'yes') e.alternatives = store_matches.filter((o) => o.id !== e.id && o.availability === 'yes' && ['suitable', 'conditional'].includes((o.suitability as { verdict: string }).verdict)).slice(0, 2).map((o) => ({ id: o.id, name: o.name }));
  const totals = { store: store_matches.length, cannot_assess: cannot_assess.length, excluded: excluded.length };
  if (store_matches.length > MAX_STORE) { store_matches.length = MAX_STORE; notes.push(`عُرض أفضل ${MAX_STORE} من ${totals.store} منتجًا مطابقًا. أضف تفصيلًا (نوع البشرة، العلامة…) لتضييق النتائج.`); }
  if (cannot_assess.length > MAX_UNASSESSED) cannot_assess.length = MAX_UNASSESSED;
  if (excluded.length > MAX_UNASSESSED) excluded.length = MAX_UNASSESSED;
  if (totals.excluded) notes.push(`استُبعد ${totals.excluded} منتج لأسباب موثقة في قائمة مكوناته (انظر «مستبعد»).`);
  if (store_matches.length && store_matches.every((e) => (e.suitability as { verdict: string }).verdict !== 'suitable')) notes.push('معلومات هذه المنتجات غير مكتملة أو غير معتمدة: اعرضها كخيارات للمراجعة وليس كتوصية حاسمة.');
  if (store_matches.some((e) => e.conflict)) notes.push('بعض المنتجات لديها معلومات متعارضة بين المصادر قيد مراجعة المدير.');
  return { ...base, safety_note: null, answer: null as null | Record<string, unknown>, store_matches, cannot_assess, excluded, totals, notes };
}

function entry(p: P, level: 'documented' | 'partial' | 'unknown', reasons: string[], opts: AdviseOpts, reason: string | undefined, ev: Evaluation) {
  const av = p.availability_effective;
  return {
    id: p.id, name: p.name, brand: p.brand, size: p.size, category: p.category, verification: p.verification, primary_image_id: p.primary_image_id ?? null, product_type: p.product_type ?? '', product_type_label: p.product_type ? typeLabel(p.product_type) : '',
    // suitability and availability are separate blocks on purpose
    suitability: { level, reasons, verdict: ev.verdict, verdict_label: ev.verdict_label, used_info: ev.used_info, missing: ev.missing, precautions: ev.precautions, supports: ev.supports, limitations: ev.limitations },
    fragrance: ev.fragrance, formulation: ev.formulation,
    availability: av,
    availability_note: p.availability_stale ? 'آخر تأكيد توفر قديم — تأكد من الرف قبل الوعد للعميل' : av === 'unknown' ? 'التوفر غير مؤكد — تأكد قبل التوصية' : av === 'no' ? 'غير متوفر حاليًا' : 'متوفر عند آخر تأكيد',
    warnings: p.warnings || null, source_url: p.source_url || null,
    conflict: opts.conflictIds?.has(p.id) ?? false,
    info_complete: ev.formulation.status === 'verified', ...(reason ? { reason } : {}),
  };
}

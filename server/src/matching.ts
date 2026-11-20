/**
 * CP06.2 Phase 3 — product normalisation + matching. Pure functions: no network, no database, no HTTP, no platform code
 * (runs on the server and in the Android worker). Decides whether a SOURCE candidate is the same sellable item as a
 * STORE product, and says why — and, above all, why NOT.
 *
 * Safety rule (owner requirement): any conflict in brand, size, shade/variant, SPF, product form or formulation makes a
 * "strong" or "exact_gtin" match impossible; the result is at most "ambiguous" and goes to a person.
 * The numeric confidence is informative only; the class is decided by explicit rules, never by a score threshold alone.
 */
import { gtinValid, normalizeBarcode } from './gtin.ts';
import type { TMatchDecision } from './contracts.ts';

/* ---------------- text normalisation ---------------- */
const AR_DIACRITICS = /[ً-ٰٟـ]/g;   // harakat, superscript alef, tatweel
export function normalizeText(s: string): string {
  return s.normalize('NFKC').toLowerCase()
    .replace(AR_DIACRITICS, '').replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')    // é -> e (Latin accents only; Arabic already handled)
    .replace(/[’'`´]/g, '').replace(/[^\p{L}\p{N}%.+]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/* brand aliases: Arabic spellings and Latin variants of the same brand -> one key. Small, reviewable, extendable. */
const BRAND_ALIASES: Record<string, string[]> = {
  cerave: ['سيرافي', 'سيرا في', 'cera ve'],
  'la roche posay': ['لاروش بوزيه', 'لا روش بوزيه', 'لاروش', 'larocheposay', 'la roche-posay', 'lrp'],
  nivea: ['نيفيا'], loreal: ['لوريال', "l'oreal", 'l oreal', 'loreal paris'], garnier: ['غارنييه', 'جارنييه'],
  neutrogena: ['نيوتروجينا'], vichy: ['فيشي'], bioderma: ['بيوديرما'], eucerin: ['يوسيرين'], cetaphil: ['سيتافيل'],
  avene: ['افين', 'أفين', 'avène'], 'the ordinary': ['ذا اورديناري', 'ذا أورديناري', 'ordinary'], dove: ['دوف'],
  'head shoulders': ['هيد اند شولدرز', 'هيد آند شولدرز', 'head & shoulders', 'head and shoulders'], pantene: ['بانتين'],
  maybelline: ['ميبيلين'], 'paulas choice': ["paula's choice", 'بولاز تشويس'], vaseline: ['فازلين'], 'simple': ['سيمبل'],
};
const BRAND_INDEX = new Map<string, string>();
for (const [key, list] of Object.entries(BRAND_ALIASES)) for (const v of [key, ...list]) BRAND_INDEX.set(normalizeText(v).replace(/[\s.&+-]/g, ''), key);
export function brandKey(brand: string): string {
  const n = normalizeText(brand).replace(/[\s.&+-]/g, '');
  return BRAND_INDEX.get(n) ?? n;
}

/* Arabic -> English canonical vocabulary for cosmetic NAMES (so an Arabic store name can meet an English source name) */
const VOCAB: [RegExp, string][] = [
  [/^(غسول|منظف|cleanser|wash|cleansing)$/, 'cleanser'], [/^(مرطب|مرطبه|ترطيب|moisturizing|moisturising|moisturizer|moisturiser|hydrating|hydrate)$/, 'moisturizing'],
  [/^(كريم|cream|creme|crème)$/, 'cream'], [/^(لوشن|lotion)$/, 'lotion'], [/^(جل|gel|جيل)$/, 'gel'], [/^(رغوي|رغوه|foaming|foam)$/, 'foaming'],
  [/^(سيروم|serum)$/, 'serum'], [/^(شامبو|shampoo)$/, 'shampoo'], [/^(بلسم|conditioner)$/, 'conditioner'], [/^(زيت|oil)$/, 'oil'],
  [/^(واقي|sunscreen|sunblock|spf)$/, 'sunscreen'], [/^(شمس|sun)$/, 'sun'], [/^(تونر|tonic|toner)$/, 'toner'], [/^(ماسك|قناع|mask)$/, 'mask'],
  [/^(بشره|للبشره|skin)$/, 'skin'], [/^(وجه|للوجه|face|facial)$/, 'face'], [/^(جسم|للجسم|body)$/, 'body'], [/^(شعر|للشعر|hair)$/, 'hair'],
  [/^(عين|عيون|eye|eyes)$/, 'eye'], [/^(شفاه|lip|lips)$/, 'lip'], [/^(جاف|جافه|dry)$/, 'dry'], [/^(دهني|دهنيه|oily)$/, 'oily'],
  [/^(حساس|حساسه|sensitive)$/, 'sensitive'], [/^(عادي|عاديه|normal)$/, 'normal'], [/^(مختلط|مختلطه|combination)$/, 'combination'],
  [/^(ليلي|night)$/, 'night'], [/^(نهاري|day)$/, 'day'], [/^(قشره|dandruff|anti-dandruff)$/, 'dandruff'], [/^(بدون|خالي|free)$/, 'free'],
  [/^(عطر|عطري|fragrance|perfume|parfum|scented)$/, 'fragrance'], [/^(اطفال|kids|baby|children)$/, 'kids'], [/^(رجال|رجالي|men|homme)$/, 'men'],
];
const STOP = new Set(['ال', 'من', 'مع', 'for', 'with', 'and', 'the', 'de', 'و', 'ل', 'by', 'in', 'a', 'الي', 'to', 'على', 'في', 'on']);
export function nameTokens(name: string, brand = ''): Set<string> {
  const b = new Set(normalizeText(brand).split(' ').concat([...(BRAND_ALIASES[brandKey(brand)] ?? []).flatMap((x) => normalizeText(x).split(' ')), ...brandKey(brand).split(' ')]));
  const out = new Set<string>();
  for (const raw of normalizeText(name).split(' ')) {
    let t = raw.replace(/^(ال|لل|بال|وال)(?=\p{L}{3,})/u, '');      // Arabic article / prepositions glued to a word
    if (!t || STOP.has(t) || STOP.has(raw) || b.has(raw) || b.has(t)) continue;
    if (/^\d+(\.\d+)?(ml|مل|g|غ|جم|oz|%)?$/.test(t)) continue;          // sizes are compared separately
    const v = VOCAB.find(([re]) => re.test(t)); out.add(v ? v[1] : t);
  }
  return out;
}

/* ---------------- size ---------------- */
export interface Size { value: number; unit: 'ml' | 'g' }
export function parseSize(s: string): Size | null {
  const n = normalizeText(s.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))).replace(',', '.');
  const m = /(\d+(?:\.\d+)?)\s*(ml|مل|ملل|millilit\w*|l|لتر|g|gr|غ|غم|جم|جرام|غرام|fl oz|floz|oz|اونصه)\b/.exec(n) ?? /(\d+(?:\.\d+)?)\s*(ml|مل|g|غ|جم|oz)/.exec(n);
  if (!m) return null;
  const v = Number(m[1]); const u = m[2]!;
  if (/^(ml|مل|ملل|millilit)/.test(u)) return { value: v, unit: 'ml' };
  if (/^(l|لتر)$/.test(u)) return { value: v * 1000, unit: 'ml' };
  if (/^(fl oz|floz)$/.test(u)) return { value: Math.round(v * 29.5735), unit: 'ml' };
  if (/^(oz|اونصه)$/.test(u)) return { value: Math.round(v * 28.3495), unit: 'g' };
  return { value: v, unit: 'g' };
}
/** same / different / unknown. 4 % tolerance absorbs rounding of oz <-> ml on labels (e.g. 1.7 fl oz = 50 ml). */
export function compareSize(a: string, b: string): 'same' | 'different' | 'unknown' {
  const x = parseSize(a), y = parseSize(b); if (!x || !y) return 'unknown';
  if (x.unit !== y.unit) return 'unknown';   // ml vs g: different measures on different labels — a person decides
  return Math.abs(x.value - y.value) / Math.max(x.value, y.value) <= 0.04 ? 'same' : 'different';
}

/* ---------------- variant / formulation markers ---------------- */
interface Markers { spf: string | null; shade: string | null; form: string | null; scent: string | null; formula: string | null; audience: string | null }
const FORMS = ['cleanser', 'cream', 'lotion', 'gel', 'serum', 'shampoo', 'conditioner', 'oil', 'toner', 'mask', 'sunscreen'];
export function markers(name: string, variant = ''): Markers {
  const all = normalizeText(`${name} ${variant}`); const toks = nameTokens(`${name} ${variant}`);
  const spf = /spf\s*(\d{1,3})/.exec(all)?.[1] ?? null;
  const shade = /(?:shade|لون|درجه|رقم|no|n)\s*\.?\s*(\d{1,3}[a-z]?)\b/.exec(all)?.[1] ?? /\b(\d{3}[a-z]?)\b(?!\s*(ml|مل|g|غ|جم))/.exec(all)?.[1] ?? null;
  // a product's FORM is its main noun; when several appear, the last one usually names the product (e.g. "cream cleanser" = cleanser)
  const forms = [...toks].filter((t) => FORMS.includes(t)); const form = forms.includes('sunscreen') ? 'sunscreen' : forms.at(-1) ?? null;
  const scent = /(rose|lavender|vanilla|coconut|aloe|ورد|لافندر|فانيلا|جوز الهند|صبار|عود|مسك)/.exec(all)?.[1] ?? (toks.has('fragrance') && toks.has('free') ? 'fragrance-free' : null);
  const formula = /(new formula|تركيبه جديده|advanced|اصدار جديد|v2|2\.0|reformulated)/.exec(all)?.[1] ?? null;
  const audience = toks.has('kids') ? 'kids' : toks.has('men') ? 'men' : null;
  return { spf, shade, form, scent, formula, audience };
}

/* ---------------- codes ---------------- */
/** GTIN-13 prefixes 02 and 20–29 are restricted-circulation (in-store) numbers: they identify an item ONLY inside one shop. */
export const isInternalCode = (code: string) => /^(0?2\d|02)\d+$/.test(code) && code.length >= 12 && (/^2\d/.test(code) || /^02/.test(code));
export function classifyCode(raw: string): 'gtin' | 'internal' | 'unverified' {
  const c = normalizeBarcode(raw); if (!gtinValid(c)) return 'unverified';
  return isInternalCode(c) ? 'internal' : 'gtin';
}
/** compare GTINs ignoring the leading zeros of the shorter forms (UPC-A 12 digits == GTIN-13 with a leading 0) */
const gtinKey = (c: string) => normalizeBarcode(c).replace(/^0+/, '');

/* ---------------- decision ---------------- */
export interface Side { name: string; brand?: string; size?: string; variant?: string; codes?: string[]; manufacturer?: string }
const jaccard = (a: Set<string>, b: Set<string>) => { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };

export function decideMatch(store: Side, cand: Side | null, opts: { sourceUnavailable?: boolean } = {}): TMatchDecision {
  if (!cand) return opts.sourceUnavailable ? { class: 'source_unavailable', confidence: 0, reasons: [], conflicts: ['المصدر غير متاح الآن — لم تُجرَ المقارنة'] } : { class: 'none', confidence: 0, reasons: [], conflicts: ['لا يوجد مرشح'] };
  const reasons: string[] = []; const conflicts: string[] = [];

  // 1) codes
  const sCodes = (store.codes ?? []).map(normalizeBarcode).filter(Boolean), cCodes = (cand.codes ?? []).map(normalizeBarcode).filter(Boolean);
  const sGtin = sCodes.filter((c) => classifyCode(c) === 'gtin'), cGtin = cCodes.filter((c) => classifyCode(c) === 'gtin');
  const sameGtin = sGtin.some((a) => cGtin.some((b) => gtinKey(a) === gtinKey(b)));
  const diffGtin = !sameGtin && sGtin.length > 0 && cGtin.length > 0;
  if (sameGtin) reasons.push('الباركود (GTIN) نفسه');
  if (diffGtin) conflicts.push('باركود مختلف');
  if (sCodes.some((c) => classifyCode(c) === 'internal')) reasons.push('كود المحل داخلي (لا يُستخدم للمطابقة مع مصدر خارجي)');
  if ([...sCodes, ...cCodes].some((c) => classifyCode(c) === 'unverified')) conflicts.push('كود غير صالح (رقم التحقق أو الطول)');

  // 2) brand
  const sb = brandKey(store.brand ?? ''), cb = brandKey(cand.brand ?? '');
  const brandSame = !!sb && sb === cb; const brandDiff = !!sb && !!cb && sb !== cb;
  if (brandSame) reasons.push('العلامة مطابقة'); if (brandDiff) conflicts.push(`علامة مختلفة (${store.brand} / ${cand.brand})`);

  // 3) name tokens (brand removed, Arabic/English vocabulary unified)
  const st = nameTokens(store.name, store.brand), ct = nameTokens(cand.name, cand.brand); const sim = jaccard(st, ct);
  if (sim >= 0.6) reasons.push('الاسم متطابق في الكلمات الأساسية'); else if (sim >= 0.3) reasons.push('الاسم متشابه جزئيًا');

  // 4) size
  const size = compareSize(store.size || store.name, cand.size || cand.name);
  if (size === 'same') reasons.push('الحجم نفسه'); if (size === 'different') conflicts.push(`حجم مختلف (${store.size || '?'} / ${cand.size || '?'})`);

  // 5) variant / formulation markers: present on BOTH sides and different = conflict; present on one side only = conflict too
  const sm = markers(store.name, store.variant), cm = markers(cand.name, cand.variant);
  const LBL: Record<keyof Markers, string> = { spf: 'عامل الحماية SPF', shade: 'اللون/الدرجة', form: 'نوع المنتج', scent: 'الرائحة/الإصدار العطري', formula: 'إصدار التركيبة', audience: 'الفئة المستهدفة' };
  for (const k of Object.keys(LBL) as (keyof Markers)[]) {
    const a = sm[k], b = cm[k];
    if (a && b && a !== b) conflicts.push(`${LBL[k]} مختلف (${a} / ${b})`);
    else if ((a && !b) || (!a && b)) { if (k === 'form') continue; conflicts.push(`${LBL[k]} مذكور في طرف واحد فقط (${a ?? b})`); }
  }

  // 5b) descriptor groups: when BOTH names state a value in the same group and the values are disjoint, they are different products
  //     (Hydrating vs Foaming cleanser, for dry vs for oily skin, day vs night cream). Silence on one side is not a conflict.
  const GROUPS: [string, string[]][] = [['طبيعة التركيبة', ['foaming', 'moisturizing', 'gel', 'oil', 'lotion', 'cream']], ['نوع البشرة/الشعر المستهدف', ['dry', 'oily', 'normal', 'combination', 'sensitive']], ['الاستخدام', ['day', 'night']], ['الموضع', ['face', 'body', 'hair', 'eye', 'lip']]];
  for (const [label, vals] of GROUPS) {
    const a = vals.filter((v) => st.has(v)), b = vals.filter((v) => ct.has(v));
    if (a.length && b.length && !a.some((v) => b.includes(v))) conflicts.push(`${label} مختلف (${a.join('/')} / ${b.join('/')})`);
  }

  // 6) class — explicit rules, conflicts first
  let cls: TMatchDecision['class'];
  if (sameGtin) cls = conflicts.length ? 'ambiguous' : 'exact_gtin';
  else if (conflicts.length) cls = (sim >= 0.3 || brandSame) ? 'ambiguous' : 'none';
  else if (brandSame && sim >= 0.6 && size === 'same') cls = 'strong';
  else if ((brandSame && sim >= 0.3) || sim >= 0.6) cls = 'ambiguous';
  // same brand + same product form + same size but names that do not share words (e.g. an Arabic transliteration of a
  // product line: «سيكالفات» / "Cicalfate"): never confirmed automatically, but worth showing to a person side by side
  else if (brandSame && sm.form && sm.form === cm.form && size === 'same') { cls = 'ambiguous'; conflicts.push('الاسم مختلف الصياغة — قارن الصورة والعبوة'); }
  else cls = 'none';
  if (cls === 'ambiguous' && !conflicts.length && size === 'unknown') conflicts.push('الحجم غير معروف في أحد الطرفين — يلزم تأكيد');
  const confidence = Math.round(Math.min(100, (sameGtin ? 60 : 0) + (brandSame ? 15 : 0) + sim * 25 + (size === 'same' ? 10 : 0)) * (conflicts.length ? 0.5 : 1));
  return { class: cls, confidence, reasons, conflicts };
}

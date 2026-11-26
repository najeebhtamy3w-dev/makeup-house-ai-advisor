/**
 * CP06.2 Phase 5A — Conversational Understanding Engine (deterministic, no model).
 * Reads one staff message in Arabic (incl. common Yemeni spellings) and updates the session context: skin/hair type,
 * concerns, requested product type, actives in use, product references. A later statement CORRECTS an earlier one
 * ("لا، بشرتها دهنية") instead of being added to it.
 */
import { AdvisorContext, type TAdvisorContext } from '../contracts.ts';

/** normalise Arabic: diacritics, tatweel, alef/yaa/taa-marbuta, Arabic-Indic digits; lower-case Latin */
export const normAr = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[ً-ٰٟـ]/g, '').replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\s+/g, ' ').trim();

// Yemeni / Gulf colloquial forms are listed next to the standard words (ناشف = جاف، اشتي/ابغى = أريد، ايش/وش = ماذا…)
// skin TYPE words only; localised dryness ("جفاف حول الأنف", "تقشر") is a CONCERN, not a type
const SKIN: [TAdvisorContext['skin'][number], RegExp][] = [
  ['dry', /(جاف|ناشف|نشفان)/], ['oily', /(دهني|زيتي|لامع|يلمع|دسم)/], ['combination', /(مختلط)/],
  ['sensitive', /(حساس|يتحسس|تتحسس|يهيج|تهيج|يحرق|يلسع|احمرار)/], ['normal', /(بشره عاديه|بشرتي عاديه|عاديه البشره)/],
];
const HAIR: [TAdvisorContext['hair'][number], RegExp][] = [['oily', /(شعر\S* دهني|دهني\S* الشعر|فروه دهني|الشعر يدهن|شعري يدهن)/], ['dry', /(شعر\S* (جاف|ناشف|خشن)|الشعر (جاف|ناشف))/], ['colored', /(مصبوغ|صبغه|صابغه)/], ['curly', /(مجعد|كيرلي|خشن)/], ['damaged', /(تالف|متقصف|تقصف|محروق|متكسر)/]];
const CONCERNS: [string, RegExp][] = [
  ['acne', /(حبوب|حبيبات|حب الشباب|حب شباب|بثور|رؤوس سوداء|انسداد المسام)/], ['dryness', /(جفاف|جاف|ناشف|تقشر|شد)/], ['sensitivity', /(حساس|تهيج|يهيج|احمرار|يحرق|يلسع)/],
  ['pigmentation', /(تصبغ|بقع|كلف|نمش|اسمرار|تفتيح|توحيد اللون|اثار الحبوب)/], ['dandruff', /(قشره|قشور|قشرة)/], ['itch', /(حكه|يحك|حكحكه|حكاك)/],
  ['hair_loss', /(تساقط|يتساقط|يطيح|يسقط الشعر|صلع|فراغات)/], ['oil', /(دهون|دهني|لمعان|زيتي)/], ['sun', /(شمس|spf|سن بلوك|واقي)/],
];
export const PRODUCT_TYPES: [string, string, RegExp][] = [
  ['cleanser', 'غسول', /(غسول|منظف|غسيل للوجه|صابون للوجه|cleanser|wash)/], ['moisturizer', 'مرطب', /(مرطب|ترطيب|كريم مرطب|moisturi)/], ['sunscreen', 'واقي شمس', /(واقي|سن بلوك|sunscreen|spf)/],
  ['serum', 'سيروم', /(سيروم|serum)/], ['toner', 'تونر', /(تونر|toner)/], ['shampoo', 'شامبو', /(شامبو|shampoo)/], ['conditioner', 'بلسم', /(بلسم|كوندشنر|conditioner)/],
  ['hair_oil', 'زيت شعر', /(زيت (لل)?شعر|زيت للشعر)/], ['mask', 'ماسك', /(ماسك|قناع)/],
];
const ACTIVES: [string, RegExp][] = [['retinoid', /(ريتينول|ريتنول|ريتينويد|تريتينوين|retinol|retinoid)/], ['niacinamide', /(نياسيناميد|نياسينامايد|niacinamide)/], ['vitamin_c', /(فيتامين سي|فيتامين c|vitamin c)/], ['aha_bha', /(ساليسيليك|جلايكوليك|احماض|aha|bha|salicylic|glycolic)/], ['benzoyl_peroxide', /(بنزويل|benzoyl)/]];

export type Intent = 'product_guidance' | 'explain' | 'routine' | 'ingredient' | 'compare' | 'product_followup' | 'reset' | 'greeting' | 'out_of_scope' | 'unclear';
export interface Understanding { ctx: TAdvisorContext; intent: Intent; asked_product_type: string | null; new_facts: string[]; refers_to_previous_product: boolean; corrected: boolean }

const has = (re: RegExp, q: string) => re.test(q);
const WANT = /(اريد|ابغي|ابغى|اشتي|ابي|ودي|بغيت|ابحث عن|محتاج|محتاجه|عندكم|ايش (احسن|افضل)|وش (احسن|افضل)|رشح|انصح|تنصح|افضل|احسن)/;
const ROUTINE = /(روتين|رتب|ارتب|ترتيب|خطوات|صباح|مساء|بالليل|بالنهار)/;
const EXPLAIN = /(ليش|لماذا|ايش سبب|وش سبب|ما سبب|سبب|يعني ايش|ما المشكله|ايش المشكله|وش المشكله|اشرح|كيف اتعامل|كيف اعتني|ايش اسوي|وش اسوي|ماذا افعل)/;
const COMPARE = /(قارن|مقارنه|الفرق بين|ايهما|ايش الفرق|وش الفرق)/;
const REF_PREV = /(الذي رشحته|اللي رشحته|اللي قلت|الي قلت|اللي اقترحته|الذي اقترحته|المنتج السابق|هذا المنتج|نفس المنتج|الغسول (الذي|اللي|الي)|الكريم (الذي|اللي|الي)|الشامبو (الذي|اللي|الي)|السيروم (الذي|اللي|الي))/;
const CORRECT = /(^لا[ ,،]|لا لا|مش |مو |ليست|ليس |غلط|اقصد|قصدي|بالعكس|تصحيح)/;
const OUT = /(سعر|اسعار|بكم|كم سعر|خصم|فاتوره|ارباح|مبيعات)/;
const RESET = /(محادثه جديده|ابدا من جديد|زبونه جديده|عميله جديده|عميل جديد|مسح المحادثه)/;

export function understand(text: string, prev: TAdvisorContext = AdvisorContext.parse({})): Understanding {
  const q = normAr(text);
  if (RESET.test(q)) return { ctx: AdvisorContext.parse({}), intent: 'reset', asked_product_type: null, new_facts: [], refers_to_previous_product: false, corrected: false };
  const ctx: TAdvisorContext = AdvisorContext.parse(JSON.parse(JSON.stringify(prev)));
  const facts: string[] = [];
  const corrected = CORRECT.test(q);
  // negated descriptions are not facts: "مش جافة" / "ليست دهنية" / "مو حساسة"
  const qPos = q.replace(/(مش|مو|مب|ليست|ليس|غير|ماهي|ما هي) (\S+)/g, ' ');
  const skinSaid = SKIN.filter(([, re]) => has(re, qPos)).map(([k]) => k);
  // hair words describe the hair, not the skin ("شعري دهني" is not oily SKIN)
  const aboutHair = /(شعر|فروه|راس|قشره|بلسم|شامبو)/.test(q) && !/(بشر|وجه)/.test(q);
  if (skinSaid.length && !aboutHair) { ctx.skin = corrected ? skinSaid : [...new Set([...ctx.skin, ...skinSaid])]; facts.push('skin'); }
  const hairSaid = HAIR.filter(([, re]) => has(re, q)).map(([k]) => k);
  if (aboutHair && /(دهني|يدهن|زيتي)/.test(q) && !hairSaid.includes('oily')) hairSaid.push('oily');
  if (aboutHair && /(جاف|ناشف)/.test(q) && !hairSaid.includes('dry')) hairSaid.push('dry');
  if (hairSaid.length) { ctx.hair = corrected ? hairSaid : [...new Set([...ctx.hair, ...hairSaid])]; facts.push('hair'); }
  const concerns = CONCERNS.filter(([k, re]) => has(re, q) && !(aboutHair && (k === 'dryness' || k === 'oil')) && !(k === 'sun' && !/(شمس|spf|سن بلوك)/.test(q))).map(([k]) => k);
  if (concerns.length) { ctx.concerns = corrected ? concerns : [...new Set([...ctx.concerns, ...concerns])]; facts.push('concerns'); }
  const actives = ACTIVES.filter(([, re]) => has(re, q)).map(([k]) => k);
  if (actives.length && /(استخدم|استعمل|احط|اضع|عندي|معي|اخذ|ماخذه|مستخدمه|استخدمه)/.test(q)) { ctx.using = [...new Set([...ctx.using, ...actives])]; facts.push('using'); }
  let asked = PRODUCT_TYPES.find(([, , re]) => has(re, q))?.[0] ?? null;
  // a product the person already USES ("أستخدم سيروم نياسيناميد") is not a product they are asking for
  if (asked && /(استخدم|استعمل|احط|اضع|ماخذه|مستخدمه)/.test(q) && !WANT.test(q)) asked = null;
  // "واقي" inside a sentence about sunscreen USE is not always a request, but a named product type is what the person is after
  if (asked) { ctx.product_type = asked; facts.push('product_type'); }
  if (/(شعر|فروه|قشره|تساقط)/.test(q)) ctx.domain = /(فروه|قشره|حكه في الراس|الراس)/.test(q) ? 'scalp' : 'hair';
  else if (/(بشر|وجه|حبوب|بقع|كلف|مسام)/.test(q) || skinSaid.length) ctx.domain = 'skin';

  const refers = REF_PREV.test(q) || (/(مناسب|ينفع|يصلح|زين)/.test(q) && /(هو|هذا|ذاك|ذلك|الذي|اللي)/.test(q) && ctx.product_refs.length > 0);
  let intent: Intent;
  if (OUT.test(q)) intent = 'out_of_scope';
  else if (refers) intent = 'product_followup';
  else if (COMPARE.test(q)) intent = 'compare';
  else if (ROUTINE.test(q)) intent = 'routine';
  else if (asked && (WANT.test(q) || !EXPLAIN.test(q))) intent = 'product_guidance';
  else if (actives.length && !facts.includes('using')) intent = 'ingredient';
  else if (EXPLAIN.test(q) || concerns.length || skinSaid.length || hairSaid.length) intent = 'explain';
  else if (/^(السلام|مرحبا|اهلا|هلا|صباح الخير|مساء الخير)/.test(q)) intent = 'greeting';
  else if (facts.includes('using')) intent = 'explain';
  else if (ctx.asked.length && ctx.concerns.length && q.split(/\s+/).length <= 5 && !/(امكاني|قدرات|اسمك|شكرا|موضوع اخر)/.test(q)) intent = 'explain';
  else intent = 'unclear';
  return { ctx, intent, asked_product_type: asked, new_facts: facts, refers_to_previous_product: refers, corrected };
}

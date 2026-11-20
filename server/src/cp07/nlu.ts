/**
 * CP07 Phase 6 — Arabic / Yemeni question understanding. Builds ON the CP06.2 `understand()` (unchanged) and adds:
 * ingredients (from ingredient_knowledge names, Arabic spellings and INCI synonyms), constraints (light, non-comedogenic,
 * fragrance-free…), combination / ingredient / comparison intents, red flags (from the unchanged safety rules), and a
 * confidence score. Deterministic: no model is needed. An optional model may later be asked ONLY to fill gaps, and its
 * output is re-validated against these same fields (see experiments/cp07-open-source-ai).
 */
import { normAr, understand, type Intent as BaseIntent } from '../advisor2/understand.ts';
import { assessSafety } from '../advisor2/safety.ts';
import { AdvisorContext, type TAdvisorContext } from '../contracts.ts';
import { SEED_INGREDIENTS } from './seed.ts';
import { assessSafetyCp08 } from '../cp08/safety.ts';
import { PRODUCT_TYPES } from '../advisor2/understand.ts';

export type Cp07Intent = BaseIntent | 'ingredient_question' | 'combination';
export interface Cp07Understanding {
  intent: Cp07Intent; skin_type: string[]; hair_type: string[]; concerns: string[]; requested_product_type: string | null;
  ingredients: string[]; constraints: string[]; sensitivity_flags: string[]; medical_red_flags: string[]; referrals: string[];
  conversation_context: TAdvisorContext; confidence: number; corrected: boolean; refers_to_previous_product: boolean; compare_terms: string[];
  /** the thing asked about when it is NOT in the knowledge lexicon (e.g. "الكولاجين") — answered with "insufficient evidence" */
  unknown_subject: string | null;
  /** CP08: every product type named in the turn ("مرطب وواقي") — requested_product_type is the first */
  requested_product_types: string[];
  /** CP08: what a pronoun / follow-up pointed back to: a previous ingredient, a known product, or a product not identified yet */
  resolved_reference: 'ingredient' | 'product' | 'product_unresolved' | null;
  /** CP08: urgent signs and referrals from the concept-based safety layer, with codes (for tests and audit) */
  safety_codes: string[];
}

// ingredient lexicon: INCI + synonyms + Arabic spellings (normalised). Longest first so "حمض الساليسيليك" beats "ساليسيليك".
const LEX: [string, string][] = SEED_INGREDIENTS.flatMap((i) => [i.inci, ...i.synonyms, ...i.names_ar].map((w) => [normAr(w), i.inci] as [string, string]))
  .concat([['مقشر', 'exfoliation'], ['مقشرات', 'exfoliation'], ['تقشير', 'exfoliation'], ['احماض', 'exfoliation'], ['aha', 'exfoliation'], ['جلايكوليك', 'exfoliation'], ['فيتامين سي', 'vitamin c'], ['فيتامين c', 'vitamin c']])
  .sort((a, b) => b[0].length - a[0].length);
export function findIngredients(q: string): string[] {
  const out: string[] = []; let rest = ` ${q} `;
  for (const [w, inci] of LEX) {
    const re = new RegExp(`(^|[\\s،,؟?.(/])(?:و?(?:بال|ال|لل|ب|ك)?)${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s،,؟?.)/])`, 'u');
    if (re.test(rest)) { if (!out.includes(inci)) out.push(inci); rest = rest.replace(re, ' '); }
  }
  return out;
}

const CONSTRAINTS: [string, RegExp][] = [
  ['lightweight', /(خفيف|خفيفه|مو ثقيل|مش ثقيل|ما يكون ثقيل|غير دهني|ما يدهن|ما يلمع)/],
  ['non_comedogenic', /(ما يسد|لا يسد|ما يسكر|ما يقفل|غير مسبب لانسداد|non.?comedogenic|ما يطلع حبوب|ما يسبب حبوب)/],
  ['fragrance_free', /(بدون عطر|بدون ريحه|بدون رائحه|بلا عطر|خالي من العطر|ما فيه عطر|ما فيه ريحه|fragrance.?free)/],
  ['for_sensitive', /(للبشره الحساسه|للحساسه|ما يهيج|لا يهيج|لطيف)/],
  ['oil_free', /(خالي من الزيوت|بدون زيوت|oil.?free)/],
  ['pregnancy', /(حامل|حمل|مرضع|رضاعه)/],
  ['alcohol_free', /(بدون كحول|بلا كحول|خالي من الكحول|ما فيه كحول|ما يكون فيه كحول|[^.؟?]{0,20}(ما ابغي|ما ابغى|ما اشتي|ما ابي)[^.؟?]{0,20}كحول)/],
  ['sulfate_free', /(بدون سلفات|بلا سلفات|خالي من السلفات|بدون سلفيت|sulfate.?free)/],
];
const EXFOLIANT_REQ = /(اريد|ابغي|ابغى|اشتي|ابي|محتاج|محتاجه|عندكم|ايش (احسن|افضل)|وش (احسن|افضل)|رشح|تنصح)[^؟?]*(مقشر|تقشير|سكراب)/;
const ING_Q = /(هل|ينفع|يناسب|يصلح|مناسب|فايده|فائده|ايش يسوي|وش يسوي|ايش فايده|وش فايده|ايش هو|وش هو|ما هو|ماهو|يضر|امن|آمن|مضر|اقدر استخدم|اقدر احط|ممكن استخدم|كيف استخدم|متي استخدم|كم مره)/;
const COMBINE = /(مع|وياه|وياها|سوا|سوى|بنفس الوقت|مع بعض|نجمع|اجمع|ادمج|ادمجهم|بعد)\s*/;
// CP07 additions to the CP06.2 lexicon (added in a layer; CP06.2 understand() is unchanged)
const EXTRA_RED: [RegExp, string][] = [[/(انتفخ|انتفخت|انتفاخ|تورمت|تورم|ورم) ?(في )?(عيوني|عيني|العين|وجهي|الوجه|شفايفي|شفتي|الشفايف|لساني|حلقي)?/, 'تورم أو انتفاخ'], [/(شامه|خال|حسنه|شامات)[^.،؟?]{0,25}(تتغير|تغير|كبرت|تكبر|تنزف|نزفت|لونها|شكلها)/, 'تغيّر في شامة']];
const SUBJECT_Q = /^(?:سؤال: )?(?:هل|ما فائده|ما فايده|ايش فايده|وش فايده|ايش فائده|ما هي فائده|ايش فوايد|ما فوائد)\s+(.{2,40}?)(?:\s+(?:يناسب|يفيد|يقلل|يقوي|تقوي|يطول|يكفي|تهدي|يهدي|تعالج|يعالج|يوقف|توقف|يرطب|ترطب|يفتح|تفتح|يخفف|تخفف|يزيل|مفيد|مفيده|ينفع|تنفع|يصلح|للبشره|للشعر|للوجه|لل\S+)|[؟?]|$)/;
const KNOWN_CONCEPT = /(بشر|شعر|وجه|فروه|حبوب|جفاف|دهون|قشره|تساقط|كلف|بقع|غسول|مرطب|واقي|شامبو|بلسم|سيروم|تونر|ماسك|مقشر|روتين|كريم)/;
// "X يفيد/ينفع…؟" without هل — the subject is the words before the verb
const SUBJECT_V = /^(?:سؤال: )?(?:وش رايك ب|وش رايك في|ايش رايك ب)?(.{2,30}?)\s+(?:يفيد|يفيدو|ينفع|تنفع|يطول|يقوي|تقوي|يعالج|تعالج|يوقف|يرطب|ترطب|يفتح|تفتح|يخفف|تخفف|يزيل|مفيد|مفيده)(?:\s|[؟?]|$)/;
const RAYAK = /^(?:وش|ايش) رايك (?:ب|في)\s*(.{2,30}?)(?:[؟?]|$)/;
const ANAPHORA_ING = /(استخدمته|استخدمها|استعملته|احطه|احطها|معاه|معه|هو|هي|يناسب|ينفع|يسبب|تسبب|امن|آمن|يضر|للحامل|للمرضع)/;
const FOLLOWUP_START = /^(طيب|و|وهل|واقدر|ويسبب|وكمان|طب|بس)\b|^و/;
const THIS_PRODUCT = /(هذا|ذا|هذي|هالكريم|هالمنتج|هالغسول)\s?(ال)?(كريم|منتج|غسول|سيروم|شامبو|مرطب|واقي|زيت|بلسم|تونر)?/;
const COMPARE_RE = /(الفرق بين|ايش الفرق|وش الفرق|ما الفرق|ايهما|ايش احسن (.+) ولا|قارن)/;

export function understandCp07(text: string, prev: TAdvisorContext = AdvisorContext.parse({})): Cp07Understanding {
  const base = understand(text, prev); const q = normAr(text);
  const ingredients = findIngredients(q);
  // hair breakage words the CP06.2 lexicon misses ("يتكسر", "يتقصف")
  if (/(شعر|اطراف)/.test(q) && /(يتكسر|تكسر|يتقصف|تقصف|متقصف)/.test(q) && !base.ctx.hair.includes('damaged')) { base.ctx.hair = [...base.ctx.hair, 'damaged']; if (base.ctx.domain === 'general') base.ctx.domain = 'hair'; }
  const aboutHair = /(شعر|فروه|راس|قشره)/.test(q) && !/(بشر|وجه)/.test(q);
  const addTo = <K extends 'skin' | 'concerns'>(k: K, v: string) => { const arr = base.ctx[k] as string[]; if (!arr.includes(v)) (base.ctx[k] as string[]) = [...arr, v]; };
  if (!aboutHair && /(تلمع|بتلمع)/.test(q)) { addTo('skin', 'oily'); base.ctx.domain = 'skin'; }
  if (!aboutHair && /(تحمر|يحمر|بتحمر)/.test(q) && !/(مش|مو|ما) (تحمر|يحمر)/.test(q)) { addTo('skin', 'sensitive'); base.ctx.domain = 'skin'; }
  if (/(تحك|تحكني|يحكني|حكني|تاكلني)/.test(q)) { addTo('concerns', 'itch'); if (/(فروه|راس)/.test(q)) base.ctx.domain = 'scalp'; }
  if (/(الرءوس السوداء|الرؤوس السوداء|رؤوس السوداء|راس اسود|رؤوس سود)/.test(q)) { addTo('concerns', 'acne'); base.ctx.domain = 'skin'; }
  if (base.intent === 'unclear' && base.ctx.concerns.length) base.intent = 'explain';
  // "مو دهنية بس فيها لمعة" = shine without an oily type → combination
  if (/(مو|مش|ليست|مب|ما هي) دهني/.test(q) && /(لمعه|لمعان|تلمع|يلمع)/.test(q)) { base.ctx.skin = [...new Set([...base.ctx.skin.filter((x) => x !== 'oily'), 'combination' as const])]; base.ctx.domain = 'skin'; }
  // "عادية بس جافة" — a named type wins over "normal"
  if (base.ctx.skin.includes('normal') && base.ctx.skin.length > 1) base.ctx.skin = base.ctx.skin.filter((x) => x !== 'normal');
  // a routine is asked for with routine words; "بالنهار" in a description is not a routine request
  if (base.intent === 'routine' && !/(روتين|رتب|ارتب|ترتيب|خطوات|احط|استخدم|اسوي|بعد الغسول)/.test(q)) base.intent = base.ctx.skin.length || base.ctx.concerns.length ? 'explain' : base.intent;
  const constraintsNow = CONSTRAINTS.filter(([, re]) => re.test(q)).map(([k]) => k);
  // constraints persist in the conversation (stored in the existing CP06.2 `avoid` field) until a reset
  const constraints = [...new Set([...constraintsNow, ...base.ctx.avoid.filter((x) => CONSTRAINTS.some(([k]) => k === x) && x !== 'pregnancy')])];
  base.ctx.avoid = [...new Set([...base.ctx.avoid, ...constraintsNow.filter((x) => x !== 'pregnancy')])];
  const safety = assessSafety(text, base.ctx);
  const s8 = assessSafetyCp08(text);
  let product = base.asked_product_type;
  if (!product && EXFOLIANT_REQ.test(q)) product = 'exfoliant';
  // a request with a constraint like "كريم خفيف ما يسد المسام" is a moisturizer request even without the word مرطب
  if (!product && /(كريم|لوشن|جل)/.test(q) && constraints.some((c) => c === 'lightweight' || c === 'non_comedogenic')) product = 'moisturizer';
  if (!product && aboutHair && /(زيت)/.test(q) && /(ابغي|ابغى|اشتي|ابي|اريد|محتاج|ينفع|عندكم)/.test(q)) product = 'hair_oil';
  if (product) base.ctx.product_type = product;
  const productTypes = [...new Set([...(product ? [product] : []), ...PRODUCT_TYPES.filter(([, , re]) => re.test(q)).map(([id]) => id)])];
  let intent: Cp07Intent = base.intent === 'ingredient' ? 'ingredient_question' : base.intent;
  const compareTerms: string[] = [];
  const cm = q.match(/(?:الفرق بين|ايهما|قارن بين)\s+(.+?)\s+(?:و|ولا|او)\s*(.+?)(?:[؟?]|$)/);
  if (cm) compareTerms.push(cm[1]!.trim(), cm[2]!.trim());
  if (intent !== 'reset' && intent !== 'out_of_scope') {
    if (COMPARE_RE.test(q)) intent = 'compare';
    else if (ingredients.length >= 2 && COMBINE.test(q) || (ingredients.length >= 1 && /(مع|سوا|بعد) (ال)?(مقشر|تقشير|احماض|ريتينول|ساليسيليك|بنزويل)/.test(q) && ingredients.length + 1 >= 2)) intent = 'combination';
    else if (ingredients.length && ING_Q.test(q) && !product && !/^و?(انا )?(استخدم|استعمل)/.test(q)) intent = 'ingredient_question';
    else if (ingredients.length && !product && intent === 'unclear') intent = 'ingredient_question';
    else if (product && intent !== 'product_followup' && intent !== 'routine') intent = 'product_guidance';
  }
  // ---- follow-ups that point back ----
  let resolved: Cp07Understanding['resolved_reference'] = base.refers_to_previous_product ? 'product' : null;
  const prevIngs = prev.ingredients_discussed ?? [];
  const isFollow = FOLLOWUP_START.test(q) || q.split(' ').length <= 5;
  if (intent !== 'reset' && isFollow && prevIngs.length && ANAPHORA_ING.test(q) && !ingredients.some((i) => prevIngs.includes(i))) {
    if (ingredients.length >= 1 && /(مع|سوا|وياه|بعد)/.test(q)) { ingredients.unshift(...prevIngs.filter((p) => !ingredients.includes(p))); intent = 'combination'; resolved = 'ingredient'; }
    else if (!ingredients.length) { ingredients.push(...prevIngs); intent = 'ingredient_question'; resolved = 'ingredient'; }
  }
  if (!resolved && THIS_PRODUCT.test(q) && !base.ctx.product_refs.length && /(كريم|منتج|غسول|سيروم|شامبو|مرطب|واقي|زيت|بلسم|تونر|استخدمته|استعملته)/.test(q)) {
    resolved = 'product_unresolved'; if (intent !== 'combination' || !ingredients.length) intent = 'product_followup';
    if (!base.ctx.asked.includes('which_product')) base.ctx.asked.push('which_product');
  } else if (!resolved && prev.asked?.includes('which_product') && /(استخدمته|استعملته|معاه|معه)/.test(q)) { resolved = 'product_unresolved'; }
  if (intent === 'compare') { product = null; base.ctx.product_type = prev.product_type ?? null; }
  if (intent === 'combination' && ingredients.length === 1 && /(مقشر|تقشير|احماض)/.test(q) && !ingredients.includes('exfoliation')) ingredients.push('exfoliation');
  // the subject of "هل X يفيد…؟ / ما فائدة X؟" when X is not something the knowledge base knows
  let unknown_subject: string | null = null;
  const sm = q.match(SUBJECT_Q);
  const sv = !sm && !ingredients.length ? (q.match(RAYAK) ?? q.match(SUBJECT_V)) : null;
  for (const m of [sm, sv]) if (m && !unknown_subject && intent !== 'combination' && intent !== 'compare') {
    const subj = m[1]!.trim().replace(/^(ال)?(هل )/, '');
    if (!findIngredients(subj).filter((i) => i !== 'vitamin c').length && !KNOWN_CONCEPT.test(subj) && subj.split(' ').length <= 4) unknown_subject = subj;
  }
  if (ingredients.length === 1 && ingredients[0] === 'vitamin c' && !unknown_subject) unknown_subject = 'فيتامين c';
  if (unknown_subject && (intent === 'unclear' || intent === 'explain')) intent = 'ingredient_question';
  const extraRed = [...EXTRA_RED.filter(([re]) => re.test(q)).map(([, w]) => w), ...s8.urgent.map((h) => h.label_ar)];
  const refs = [...new Set([...safety.referrals, ...s8.referrals.map((h) => h.label_ar)])];
  if (intent !== 'reset') base.ctx.ingredients_discussed = ingredients.filter((i) => i !== 'exfoliation').length ? ingredients.filter((i) => i !== 'exfoliation') : prevIngs;
  else base.ctx.ingredients_discussed = [];
  // confidence: how much of the request was actually recognised
  let conf = 0.35;
  if (intent !== 'unclear') conf += 0.25;
  if (product || ingredients.length || base.ctx.concerns.length) conf += 0.2;
  if (base.ctx.skin.length || base.ctx.hair.length) conf += 0.1;
  if (base.corrected) conf -= 0.05;
  if (intent === 'unclear') conf = Math.min(conf, 0.4);
  return {
    intent, skin_type: base.ctx.skin, hair_type: base.ctx.hair, concerns: base.ctx.concerns, requested_product_type: intent === 'compare' ? null : product,
    ingredients, constraints, sensitivity_flags: [...new Set([...(base.ctx.skin.includes('sensitive') ? ['sensitive_skin'] : []), ...(constraints.includes('for_sensitive') ? ['asks_gentle'] : []), ...safety.flags])],
    medical_red_flags: [...new Set([...safety.stop_reasons, ...extraRed])], referrals: refs, conversation_context: base.ctx, confidence: Math.max(0, Math.min(1, Math.round(conf * 100) / 100)),
    corrected: base.corrected, refers_to_previous_product: base.refers_to_previous_product, compare_terms: compareTerms, unknown_subject,
    requested_product_types: intent === 'compare' ? [] : productTypes, resolved_reference: resolved, safety_codes: [...s8.urgent, ...s8.referrals].map((h) => `${h.kind}:${h.code}`),
  };
}

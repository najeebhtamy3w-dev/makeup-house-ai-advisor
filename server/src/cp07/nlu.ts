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

export type Cp07Intent = BaseIntent | 'ingredient_question' | 'combination';
export interface Cp07Understanding {
  intent: Cp07Intent; skin_type: string[]; hair_type: string[]; concerns: string[]; requested_product_type: string | null;
  ingredients: string[]; constraints: string[]; sensitivity_flags: string[]; medical_red_flags: string[]; referrals: string[];
  conversation_context: TAdvisorContext; confidence: number; corrected: boolean; refers_to_previous_product: boolean; compare_terms: string[];
  /** the thing asked about when it is NOT in the knowledge lexicon (e.g. "الكولاجين") — answered with "insufficient evidence" */
  unknown_subject: string | null;
}

// ingredient lexicon: INCI + synonyms + Arabic spellings (normalised). Longest first so "حمض الساليسيليك" beats "ساليسيليك".
const LEX: [string, string][] = SEED_INGREDIENTS.flatMap((i) => [i.inci, ...i.synonyms, ...i.names_ar].map((w) => [normAr(w), i.inci] as [string, string]))
  .concat([['مقشر', 'exfoliation'], ['مقشرات', 'exfoliation'], ['تقشير', 'exfoliation'], ['احماض', 'exfoliation'], ['aha', 'exfoliation'], ['جلايكوليك', 'exfoliation'], ['فيتامين سي', 'vitamin c'], ['فيتامين c', 'vitamin c']])
  .sort((a, b) => b[0].length - a[0].length);
export function findIngredients(q: string): string[] {
  const out: string[] = []; let rest = ` ${q} `;
  for (const [w, inci] of LEX) {
    const re = new RegExp(`(^|[\\s،,؟?.(/])(?:و|بال|ال|لل|ب)?${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s،,؟?.)/])`, 'u');
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
];
const EXFOLIANT_REQ = /(اريد|ابغي|ابغى|اشتي|ابي|محتاج|محتاجه|عندكم|ايش (احسن|افضل)|وش (احسن|افضل)|رشح|تنصح)[^؟?]*(مقشر|تقشير|سكراب)/;
const ING_Q = /(هل|ينفع|يناسب|يصلح|مناسب|فايده|فائده|ايش يسوي|وش يسوي|ايش فايده|وش فايده|ايش هو|وش هو|ما هو|ماهو|يضر|امن|آمن|مضر|اقدر استخدم|اقدر احط|ممكن استخدم|كيف استخدم|متي استخدم|كم مره)/;
const COMBINE = /(مع|وياه|وياها|سوا|سوى|بنفس الوقت|مع بعض|نجمع|اجمع|ادمج|ادمجهم|بعد)\s*/;
// CP07 additions to the CP06.2 lexicon (added in a layer; CP06.2 understand() is unchanged)
const EXTRA_RED: [RegExp, string][] = [[/(انتفخ|انتفخت|انتفاخ|تورمت|تورم|ورم) ?(في )?(عيوني|عيني|العين|وجهي|الوجه|شفايفي|شفتي|الشفايف|لساني|حلقي)?/, 'تورم أو انتفاخ'], [/(شامه|خال|حسنه|شامات)[^.،؟?]{0,25}(تتغير|تغير|كبرت|تكبر|تنزف|نزفت|لونها|شكلها)/, 'تغيّر في شامة']];
const SUBJECT_Q = /^(?:سؤال: )?(?:هل|ما فائده|ما فايده|ايش فايده|وش فايده|ايش فائده|ما هي فائده|ايش فوايد|ما فوائد)\s+(.{2,40}?)(?:\s+(?:يناسب|يفيد|يقلل|يقوي|يطول|يكفي|تهدي|يهدي|مفيد|مفيده|ينفع|تنفع|يصلح|للبشره|للشعر|للوجه|لل\S+)|[؟?]|$)/;
const KNOWN_CONCEPT = /(بشر|شعر|وجه|فروه|حبوب|جفاف|دهون|قشره|تساقط|كلف|بقع|غسول|مرطب|واقي|شامبو|بلسم|سيروم|تونر|ماسك|مقشر|روتين|كريم)/;
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
  const constraints = CONSTRAINTS.filter(([, re]) => re.test(q)).map(([k]) => k);
  const safety = assessSafety(text, base.ctx);
  let product = base.asked_product_type;
  if (!product && EXFOLIANT_REQ.test(q)) product = 'exfoliant';
  // a request with a constraint like "كريم خفيف ما يسد المسام" is a moisturizer request even without the word مرطب
  if (!product && /(كريم|لوشن|جل)/.test(q) && constraints.some((c) => c === 'lightweight' || c === 'non_comedogenic')) product = 'moisturizer';
  if (product) base.ctx.product_type = product;
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
  if (intent === 'compare') { product = null; base.ctx.product_type = prev.product_type ?? null; }
  if (intent === 'combination' && ingredients.length === 1 && /(مقشر|تقشير|احماض)/.test(q) && !ingredients.includes('exfoliation')) ingredients.push('exfoliation');
  // the subject of "هل X يفيد…؟ / ما فائدة X؟" when X is not something the knowledge base knows
  let unknown_subject: string | null = null;
  const sm = q.match(SUBJECT_Q);
  if (sm && intent !== 'combination' && intent !== 'compare') {
    const subj = sm[1]!.trim();
    if (!findIngredients(subj).filter((i) => i !== 'vitamin c').length && !KNOWN_CONCEPT.test(subj) && subj.split(' ').length <= 4) unknown_subject = subj;
  }
  if (ingredients.length === 1 && ingredients[0] === 'vitamin c' && !unknown_subject) unknown_subject = 'فيتامين c';
  if (unknown_subject && (intent === 'unclear' || intent === 'explain')) intent = 'ingredient_question';
  const extraRed = EXTRA_RED.filter(([re]) => re.test(q)).map(([, w]) => w);
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
    medical_red_flags: [...new Set([...safety.stop_reasons, ...extraRed])], referrals: safety.referrals, conversation_context: base.ctx, confidence: Math.max(0, Math.min(1, Math.round(conf * 100) / 100)),
    corrected: base.corrected, refers_to_previous_product: base.refers_to_previous_product, compare_terms: compareTerms, unknown_subject,
  };
}

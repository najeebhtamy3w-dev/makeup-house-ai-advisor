import { formulationStatus, fragranceStatus, parseIngredients, FORMULATION_LABEL, type ProductSci, type FormulationStatus, type FragranceStatus } from './ingredients.ts';
import type { Fn, IngredientRecord } from './knowledge.ts';

export type Verdict = 'suitable' | 'conditional' | 'insufficient' | 'excluded';
export const VERDICT_LABEL: Record<Verdict, string> = { suitable: 'مناسب وفق المعلومات المتاحة', conditional: 'قد يكون مناسبًا مع احتياطات', insufficient: 'معلومات غير كافية', excluded: 'توجد أسباب موثقة لعدم الترشيح' };
export type Avoid = 'fragrance' | 'paraben' | 'sulfate' | 'essential_oil';
export interface Need { topics: string[]; skin: ('dry' | 'oily' | 'combination' | 'sensitive')[]; hairDry: boolean; avoid: Avoid[] }
export interface Evaluation {
  verdict: Verdict; verdict_label: string;
  formulation: { status: FormulationStatus; label: string };
  fragrance: { status: FragranceStatus; label: string; why: string[] };
  used_info: string[]; supports: { ingredient: string; function: Fn; reviewed: boolean }[];
  precautions: string[]; missing: string[]; exclusion_reasons: string[]; limitations: string[];
}
const FN_AR: Record<Fn, string> = { humectant: 'مرطّب جاذب للماء', emollient: 'مطرّي', occlusive: 'حاجز مانع للتبخر', surfactant: 'منظّف (سطحي النشاط)', exfoliant: 'مقشّر', uv_filter: 'مرشّح أشعة UV', fragrance: 'عطر', preservative: 'حافظ', hair_conditioning: 'مكيّف للشعر', barrier_support: 'داعم لحاجز البشرة' };

/** Which cosmetic FUNCTIONS are relevant to the need. Function presence is explained, never promised as a result. */
function neededFns(n: Need): Fn[] {
  const s = new Set<Fn>();
  if (n.topics.includes('moist') || n.skin.includes('dry')) ['humectant', 'emollient', 'occlusive', 'barrier_support'].forEach((x) => s.add(x as Fn));
  if (n.topics.includes('hair') && n.hairDry) ['hair_conditioning', 'emollient', 'humectant'].forEach((x) => s.add(x as Fn));
  if (n.topics.includes('sun')) s.add('uv_filter');
  if (n.topics.includes('clean')) s.add('surfactant');
  return [...s];
}

export function evaluate(p: ProductSci, need: Need, opts: { conflict?: boolean } = {}): Evaluation {
  const f = formulationStatus(p, opts.conflict);
  const parsed = parseIngredients(p.ingredients);
  const frag = fragranceStatus(p, parsed, f);
  const exclusion: string[] = [], missing: string[] = [], precautions: string[] = [], limitations: string[] = [];
  const used: string[] = [`حالة التركيبة: ${FORMULATION_LABEL[f]}`];
  let blocking = false;

  // 1) user-stated avoidances. Exclusion needs a DOCUMENTED presence; absence is only claimed from a verified list.
  for (const a of need.avoid) {
    if (a === 'fragrance') {
      if (frag.status === 'contains') exclusion.push('تحتوي المكونات على عطر/مكوّن عطري — ' + frag.why[0]);
      else if (frag.status !== 'fragrance_free') { missing.push('لا يمكن التأكد من خلوه من العطر: ' + frag.why[frag.why.length - 1]); blocking = true; }
    } else {
      const tag = a === 'essential_oil' ? 'essential_oil' : a; const label = { paraben: 'بارابين', sulfate: 'سلفات', essential_oil: 'زيوت عطرية' }[a];
      const hits = a === 'essential_oil' ? parsed.essentialOils : parsed.known.filter((k) => k.rec.tags.includes(tag as never)).map((k) => k.token);
      if (hits.length) exclusion.push(`تحتوي المكونات على ${label}: ${hits.join('، ')}`);
      else if (f !== 'verified') { missing.push(`لا يمكن التأكد من خلوه من ${label} (القائمة غير موثقة كاملًا)`); blocking = true; }
    }
  }
  // 2) formulation trust
  if (f === 'missing') { missing.push('لا توجد قائمة مكونات — لا تُستنتج فوائد ولا سلامة'); blocking = true; }
  if (f === 'unreviewed') { missing.push('قائمة المكونات مُدخلة ولم يراجعها المدير بمصدر — لا تُستنتج فوائد ولا سلامة'); blocking = true; }
  if (opts.conflict) missing.push('معلومات المنتج متعارضة بين المصادر وتنتظر مراجعة المدير');

  // 3) need-specific ingredient support (explained as FUNCTION only)
  const fns = neededFns(need); const supports: Evaluation['supports'] = [];
  if (fns.length && parsed.known.length) for (const { token, rec } of parsed.known) { const fn = rec.functions.find((x) => fns.includes(x)); if (fn) supports.push({ ingredient: rec.inci, function: fn, reviewed: rec.review_status === 'expert_reviewed' }); void token; }
  if (fns.length && f !== 'missing' && f !== 'unreviewed' && !supports.length) { missing.push('لا يظهر في المكونات المصنّفة ما يرتبط بهذه الحاجة'); blocking = true; }
  for (const s of supports) used.push(`${s.ingredient}: ${FN_AR[s.function]}${s.reviewed ? '' : ' (تصنيف عام لم يراجعه مختص)'}`);
  const unk = parsed.unknown.length - parsed.essentialOils.length; if (unk > 0 && parsed.tokens.length) limitations.push(`${unk} من ${parsed.tokens.length} مكوّنًا غير مصنّف في قاعدة المعرفة الحالية`);
  limitations.push('ترتيب المكونات يشير إلى تركيز نسبي فقط؛ لا يُعرف التركيز الفعلي ووجود مكوّن لا يضمن فعالية المنتج');

  // 4) precautions from documented records (dedup)
  const seen = new Set<string>(); const addP = (t: string) => { if (!seen.has(t)) { seen.add(t); precautions.push(t); } };
  for (const { rec } of parsed.known) { for (const t of rec.precautions) addP(t); }
  if (parsed.essentialOils.length) addP('يحتوي زيتًا عطريًا/نباتيًا عطريًا: قد لا يناسب البشرة الحساسة');
  const hazard = precautions.length; // product-derived precautions; the general notices below are informational and do not block "suitable"
  if (need.skin.includes('sensitive')) addP('لا يوجد منتج آمن لجميع أصحاب البشرة الحساسة؛ يُجرَّب على منطقة صغيرة وفق تعليمات العبوة');
  if (frag.status === 'fragrance_free') addP('خلو القائمة من العطر لا يعني أنه مناسب لكل بشرة حساسة');

  // 5) verdict
  let verdict: Verdict;
  if (exclusion.length) verdict = 'excluded';
  else if (blocking) verdict = 'insufficient';
  else {
    const allReviewed = supports.every((s) => s.reviewed);
    const clean = f === 'verified' && !opts.conflict && allReviewed && !hazard && !need.skin.includes('sensitive') && (!fns.length || supports.length > 0);
    verdict = clean ? 'suitable' : 'conditional';
    if (!allReviewed) limitations.push('تصنيفات المكونات المستخدمة لم تُراجَع من مختص بعد، لذلك لا يُعطى حكم «مناسب» نهائي');
  }
  return { verdict, verdict_label: VERDICT_LABEL[verdict], formulation: { status: f, label: FORMULATION_LABEL[f] }, fragrance: { status: frag.status, label: frag.label, why: frag.why }, used_info: used, supports, precautions: precautions.slice(0, 5), missing, exclusion_reasons: exclusion, limitations };
}
export type { IngredientRecord };

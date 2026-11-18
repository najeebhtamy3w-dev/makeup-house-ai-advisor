import { lookupIngredient, isEssentialOilLike, type IngredientRecord } from './knowledge.ts';
import { inciList } from '../enrichment/identity.ts';

export type FormulationStatus = 'verified' | 'partial' | 'unreviewed' | 'missing';
export type FragranceStatus = 'contains' | 'fragrance_free' | 'unscented_claim' | 'unknown';
export interface ProductSci { name: string; ingredients: string; verification: string; warnings?: string }

export const FORMULATION_LABEL: Record<FormulationStatus, string> = {
  verified: 'تركيبة موثقة (اعتمدها المدير بمصدر)', partial: 'تركيبة من مصدر لم يكتمل توثيقه', unreviewed: 'FORMULATION NOT VERIFIED — قائمة مُدخلة لم تُراجع', missing: 'FORMULATION NOT VERIFIED — لا توجد قائمة مكونات',
};
/** Formulation trust comes ONLY from the stored verification state (manager approval with source) — never from name similarity. */
export function formulationStatus(p: ProductSci, conflict = false): FormulationStatus {
  if (!p.ingredients.trim()) return 'missing';
  let s: FormulationStatus = p.verification === 'verified' ? 'verified' : p.verification === 'partial' ? 'partial' : 'unreviewed';
  if (conflict) s = s === 'verified' ? 'partial' : 'unreviewed'; // sources disagree => one step less trust
  return s;
}
export interface Parsed { tokens: string[]; known: { token: string; rec: IngredientRecord }[]; unknown: string[]; essentialOils: string[] }
export function parseIngredients(text: string): Parsed {
  const tokens = inciList(text); const known: Parsed['known'] = []; const unknown: string[] = []; const essentialOils: string[] = [];
  for (const t of tokens) { const rec = lookupIngredient(t); if (rec) known.push({ token: t, rec }); else { unknown.push(t); if (isEssentialOilLike(t)) essentialOils.push(t); } }
  return { tokens, known, unknown, essentialOils };
}
export const FRAGRANCE_LABEL: Record<FragranceStatus, string> = { contains: 'يحتوي عطرًا (حسب القائمة)', fragrance_free: 'لا يظهر عطر في قائمة موثقة', unscented_claim: 'ادّعاء «بدون رائحة» فقط — غير مثبت', unknown: 'حالة العطر غير معروفة' };
const CLAIM = /(fragrance[- ]?free|unscented|خالي من العطر|بدون عطر|بدون رائحه|بدون رائحة)/i;
export function fragranceStatus(p: ProductSci, parsed: Parsed, f: FormulationStatus): { status: FragranceStatus; label: string; why: string[] } {
  const hits = parsed.known.filter((k) => k.rec.tags.includes('fragrance_term')).map((k) => k.token);
  const alg = parsed.known.filter((k) => k.rec.tags.includes('fragrance_allergen') && !k.rec.tags.includes('dual_function')).map((k) => k.token);
  const dual = parsed.known.filter((k) => k.rec.tags.includes('dual_function')).map((k) => k.token);
  const why: string[] = [];
  // PRESENCE listed => documented as listed, even for an unreviewed list (excluding on presence is the safe direction).
  if (hits.length || alg.length || parsed.essentialOils.length) {
    if (hits.length) why.push(`مدرج في المكونات: ${hits.join('، ')}`); if (alg.length) why.push(`مسبب حساسية عطري مدرج: ${alg.join('، ')}`); if (parsed.essentialOils.length) why.push(`زيت عطري/نباتي عطري مدرج: ${parsed.essentialOils.join('، ')}`);
    if (f !== 'verified') why.push('القائمة لم تُوثَّق كاملًا؛ المحتوى المدرج يُعتبر كما كُتب');
    return { status: 'contains', label: FRAGRANCE_LABEL.contains, why };
  }
  if (dual.length) why.push(`${dual.join('، ')} مدرج وقد يكون لوظيفة غير العطر (حافظ/مذيب) — لا يثبت وجود عطر مضاف`);
  // ABSENCE can only be concluded from a VERIFIED, complete list. Partial/unreviewed lists may be incomplete.
  if (f === 'verified') { why.push('لا يظهر عطر ولا مسبب حساسية عطري في القائمة الموثقة (لا يعني أنه آمن لجميع أصحاب البشرة الحساسة)'); return { status: 'fragrance_free', label: FRAGRANCE_LABEL.fragrance_free, why }; }
  if (CLAIM.test(p.name)) { why.push('الاسم/الوسم يدّعي خلوه من العطر أو الرائحة، لكن القائمة غير موثقة؛ «بدون رائحة» قد يعني وجود مادة تغطي الرائحة'); return { status: 'unscented_claim', label: FRAGRANCE_LABEL.unscented_claim, why }; }
  why.push(f === 'missing' ? 'لا توجد قائمة مكونات' : 'القائمة غير مكتملة التوثيق فلا يمكن استنتاج غياب العطر'); return { status: 'unknown', label: FRAGRANCE_LABEL.unknown, why };
}

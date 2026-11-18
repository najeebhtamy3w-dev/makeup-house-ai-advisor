import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advise, type P } from '../server/src/advisor.ts';
import { evaluate, type Need } from '../server/src/science/suitability.ts';
import { parseIngredients, fragranceStatus, formulationStatus } from '../server/src/science/ingredients.ts';
import { KB, buildIndex, lookupIngredient, type IngredientRecord } from '../server/src/science/knowledge.ts';

const need = (o: Partial<Need> = {}): Need => ({ topics: ['moist'], skin: ['dry'], hairDry: false, avoid: [], ...o });
const prod = (ingredients: string, verification = 'verified', name = 'Test Cream') => ({ name, ingredients, verification });
const mk = (o: Partial<P> & { id: number; name: string }): P => ({ brand: '', category: 'العناية بالبشرة', size: '', ingredients: '', warnings: '', verification: 'review', availability_effective: 'unknown', availability_stale: false, ...o });

test('knowledge model: every record has provenance + review state; seed is NOT expert-reviewed; no invented review dates', () => {
  assert.ok(KB.length >= 40);
  for (const r of KB) { assert.ok(r.evidence_source.name && r.evidence_limitations && r.functions.length && r.category); assert.equal(r.evidence_source.checked, false); assert.equal(r.evidence_review_date, null); assert.equal(r.review_status, 'requires_expert_review'); }
  assert.equal(lookupIngredient('Glycerine')?.inci, 'glycerin'); assert.equal(lookupIngredient('Totally Made Up Extract'), null, 'unknown ingredients are never guessed');
});
test('documented verified ingredients: explained support, but seed KB is unreviewed => at most "conditional", never "suitable"', () => {
  const e = evaluate(prod('Aqua, Glycerin, Cetearyl Alcohol, Ceramide NP'), need());
  assert.equal(e.verdict, 'conditional'); assert.deepEqual(e.supports.map((s) => s.ingredient), ['glycerin', 'cetearyl alcohol', 'ceramide np']);
  assert.ok(e.limitations.some((l) => /لم تُراجَع/.test(l)));
});
test('with EXPERT-REVIEWED records a clean verified product can be "suitable" (and only then)', () => {
  const reviewed: IngredientRecord[] = KB.map((r) => ({ ...r, review_status: 'expert_reviewed' as const, reviewed_by: 'test-reviewer' }));
  buildIndex(reviewed);
  try {
    assert.equal(evaluate(prod('Aqua, Glycerin, Ceramide NP'), need()).verdict, 'suitable');
    assert.equal(evaluate(prod('Aqua, Glycerin, Ceramide NP', 'partial'), need()).verdict, 'conditional', 'partial formulation never suitable');
    assert.equal(evaluate(prod('Aqua, Glycerin, Ceramide NP'), need({ skin: ['dry', 'sensitive'] })).verdict, 'conditional', 'sensitive skin: never a categorical "suitable"');
    assert.equal(evaluate(prod('Aqua, Glycerin, Ceramide NP'), need(), { conflict: true }).verdict, 'conditional', 'source conflict downgrades');
  } finally { buildIndex(KB); }
});
test('missing / unreviewed ingredients => insufficient + FORMULATION NOT VERIFIED; no benefit inferred', () => {
  for (const [ing, ver] of [['', 'review'], ['Aqua, Glycerin', 'review']] as const) {
    const e = evaluate(prod(ing, ver), need()); assert.equal(e.verdict, 'insufficient'); assert.match(e.formulation.label, /FORMULATION NOT VERIFIED/); assert.deepEqual(e.supports.length ? 'x' : 'none', ing ? 'x' : 'none');
  }
  assert.equal(formulationStatus(prod('Aqua, Glycerin', 'verified'), true), 'partial');
});
test('fragrance: documented presence => contains (excluded when avoided), even from an unreviewed list', () => {
  const e = evaluate(prod('Aqua, Glycerin, Parfum', 'review'), need({ avoid: ['fragrance'] }));
  assert.equal(e.fragrance.status, 'contains'); assert.equal(e.verdict, 'excluded'); assert.match(e.exclusion_reasons[0]!, /Parfum|parfum/i);
  assert.equal(evaluate(prod('Aqua, Linalool', 'verified'), need({ avoid: ['fragrance'] })).verdict, 'excluded', 'declarable fragrance allergen counts as a fragrance component');
});
test('fragrance: ABSENCE only from a VERIFIED list; partial/unreviewed/missing => unknown (never "fragrance-free")', () => {
  assert.equal(evaluate(prod('Aqua, Glycerin', 'verified'), need()).fragrance.status, 'fragrance_free');
  for (const v of ['partial', 'review']) { const e = evaluate(prod('Aqua, Glycerin', v), need({ avoid: ['fragrance'] })); assert.equal(e.fragrance.status, 'unknown'); assert.equal(e.verdict, 'insufficient'); }
  assert.equal(evaluate(prod('', 'review'), need()).fragrance.status, 'unknown');
});
test('fragrance: a name claim ("Fragrance Free") is a CLAIM, not evidence; "unscented" may hide masking agents', () => {
  const e = evaluate(prod('Aqua, Glycerin', 'review', 'Fragrance Free Lotion'), need({ avoid: ['fragrance'] }));
  assert.equal(e.fragrance.status, 'unscented_claim'); assert.equal(e.verdict, 'insufficient'); assert.match(e.fragrance.why.join(' '), /تغطي الرائحة/);
});
test('fragrance: benzyl alcohol alone (dual function) does not prove a fragrance; essential oils do; carrier oils do not', () => {
  const p = parseIngredients('Aqua, Benzyl Alcohol');
  assert.equal(fragranceStatus(prod('Aqua, Benzyl Alcohol', 'verified'), p, 'verified').status, 'fragrance_free'); // verified list, only a dual-function item
  assert.match(fragranceStatus(prod('Aqua, Benzyl Alcohol', 'verified'), p, 'verified').why.join(' '), /لا يثبت وجود عطر/);
  assert.equal(evaluate(prod('Aqua, Lavandula Angustifolia Oil', 'verified'), need({ avoid: ['fragrance'] })).verdict, 'excluded');
  assert.equal(evaluate(prod('Aqua, Helianthus Annuus Seed Oil', 'verified'), need({ avoid: ['fragrance'] })).fragrance.status, 'fragrance_free');
});
test('precautions are relevant and documented: exfoliating acid, sulfate, sensitive-skin notice; no medical/therapeutic wording', () => {
  const e = evaluate(prod('Aqua, Glycolic Acid, Sodium Lauryl Sulfate', 'verified'), need({ skin: ['sensitive'], topics: ['skin'] }));
  assert.ok(e.precautions.some((t) => /مقشّر/.test(t)) && e.precautions.some((t) => /لا يوجد منتج آمن/.test(t)));
  const blob = JSON.stringify(e); assert.ok(!/(يعالج|يشفي|يزيل الحبوب|علاج|treat|cure)/i.test(blob));
});
test('no concentration inference: nothing numeric/percent is invented; the ordering caveat is always stated', () => {
  const e = evaluate(prod('Aqua, Glycerin', 'verified'), need()); assert.ok(e.limitations.some((l) => /ترتيب المكونات.*تركيز/.test(l))); assert.ok(!/%|\d+\s*(mg|ppm)/.test(JSON.stringify(e)));
});
test('sunscreen: UV filters in a verified list are explained as presence only; no filter => insufficient (no SPF is ever inferred)', () => {
  const sun = need({ topics: ['sun'], skin: [] });
  const ok = evaluate(prod('Aqua, Zinc Oxide, Butyl Methoxydibenzoylmethane', 'verified'), sun); assert.equal(ok.verdict, 'conditional'); assert.ok(ok.limitations.length && !/SPF\s*\d/.test(JSON.stringify(ok)));
  assert.equal(evaluate(prod('Aqua, Glycerin', 'verified'), sun).verdict, 'insufficient');
});
test('paraben / sulfate avoidance: excluded only on documented presence; unknown when list is not verified', () => {
  assert.equal(evaluate(prod('Aqua, Methylparaben', 'verified'), need({ avoid: ['paraben'] })).verdict, 'excluded');
  assert.equal(evaluate(prod('Aqua, Glycerin', 'verified'), need({ avoid: ['paraben'] })).verdict, 'conditional');
  assert.equal(evaluate(prod('Aqua, Glycerin', 'review'), need({ avoid: ['paraben'] })).verdict, 'insufficient');
});

// ---------- advisor-level ----------
test('advisor: explained recommendation carries used info, missing info, precautions, availability and alternatives', () => {
  const r = advise('مرطب للبشره الجافه', [
    mk({ id: 1, name: 'مرطب أ', ingredients: 'Aqua, Glycerin, Ceramide NP', verification: 'verified', availability_effective: 'no' }),
    mk({ id: 2, name: 'مرطب ب', ingredients: 'Aqua, Squalane', verification: 'verified', availability_effective: 'yes' }),
  ]) as any;
  const a = r.store_matches.find((x: any) => x.id === 1);
  assert.ok(a.suitability.used_info.length && Array.isArray(a.suitability.missing) && Array.isArray(a.suitability.precautions) && a.suitability.verdict_label);
  assert.equal(a.availability, 'no'); assert.deepEqual(a.alternatives.map((x: any) => x.id), [2], 'available alternative offered for an unavailable product');
  assert.ok(a.suitability.limitations.length);
});
test('advisor: available-but-unsuitable is EXCLUDED with a reason (never silently dropped, never recommended)', () => {
  const r = advise('مرطب بدون عطر', [mk({ id: 1, name: 'مرطب معطر', ingredients: 'Aqua, Parfum', verification: 'verified', availability_effective: 'yes' })]) as any;
  assert.equal(r.store_matches.length, 0); assert.equal(r.excluded.length, 1); assert.match(r.excluded[0].reasons[0], /عطر/); assert.equal(r.totals.excluded, 1);
});
test('advisor: Arabic / Yemeni phrasing — dry, sensitive, oily+sunscreen, hair, "ناشفة"', () => {
  const ps = [mk({ id: 1, name: 'مرطب', ingredients: 'Aqua, Glycerin', verification: 'verified' }), mk({ id: 2, name: 'واقي شمس خفيف', category: 'واقيات الشمس', ingredients: 'Aqua, Zinc Oxide', verification: 'verified' }), mk({ id: 3, name: 'بلسم', category: 'العناية بالشعر', ingredients: 'Aqua, Behentrimonium Chloride', verification: 'verified' })];
  const ids = (q: string) => (advise(q, ps) as any).store_matches.map((x: any) => x.id);
  assert.deepEqual(ids('أريد مرطبًا لبشرة جافة'), [1]); assert.deepEqual(ids('بشرتي ناشفه ابغى كريم'), [1]);
  assert.deepEqual(ids('أشتي واقي شمس مناسبًا للبشرة الدهنية'), [2]); assert.deepEqual(ids('أيهما أنسب للشعر الجاف؟'), [3]);
  const sens = advise('معك شيء للبشرة الحساسة؟', ps) as any; assert.ok(sens.notes.some((n: string) => /لا يوجد منتج «آمن/.test(n)));
});
test('advisor: "does this product contain fragrance?" answers about the named product from its list; without a product it does not guess', () => {
  const ps = [mk({ id: 1, name: 'كريم ورد', ingredients: 'Aqua, Parfum', verification: 'verified' }), mk({ id: 2, name: 'غسول لطيف', ingredients: 'Aqua, Glycerin', verification: 'review' })];
  const a = advise('هل كريم ورد فيه عطر؟', ps) as any; assert.equal(a.answer.fragrance.status, 'contains');
  const b = advise('هل غسول لطيف فيه عطر؟', ps) as any; assert.equal(b.answer.fragrance.status, 'unknown', 'unreviewed list => unknown, not "no"');
  const c = advise('هل هذا المنتج فيه عطر؟', ps) as any; assert.equal(c.answer, null); assert.ok(c.notes.some((n: string) => /ولن أخمّن/.test(n)));
});
test('advisor: results never exceed the cap even with many matches + excluded list capped', () => {
  const many = Array.from({ length: 300 }, (_, i) => mk({ id: i + 1, name: `مرطب ${i}`, ingredients: i % 2 ? 'Aqua, Parfum' : 'Aqua, Glycerin', verification: 'verified' }));
  const r = advise('مرطب بدون عطر', many) as any; assert.ok(r.store_matches.length <= 8 && r.excluded.length <= 6); assert.equal(r.totals.excluded, 150);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advise, norm, type P } from '../server/src/advisor.ts';
import { guardGrounding, composeGrounded, noProvider, type AiProvider } from '../server/src/ai/provider.ts';

const mk = (o: Partial<P> & { id: number; name: string }): P => ({ brand: '', category: 'العناية بالبشرة', size: '', ingredients: '', warnings: '', verification: 'review', availability_effective: 'unknown', availability_stale: false, ...o });
const names = (r: any) => r.store_matches.map((x: any) => x.name);

test('dialect/spelling: جافه / حساسه / ما يهيج / دهنيه match like the standard spellings', () => {
  const p = [mk({ id: 1, name: 'مرطب خفيف', ingredients: 'Aqua, Glycerin', verification: 'verified' })];
  for (const q of ['بشرتها جافه وحساسه تبغى مرطب', 'ابغى مرطب ما يهيج', 'مرطب للبشره الدهنيه']) assert.deepEqual(names(advise(q, p)), ['مرطب خفيف'], q);
  assert.equal(norm('حساسة'), norm('حساسه'));
});
test('follow-up: skin type asked only when missing; contextual, short, with choices', () => {
  const p = [mk({ id: 1, name: 'مرطب' })];
  const a = advise('اريد مرطب', p); assert.equal(a.follow_up?.question, 'ما نوع بشرة العميل؟'); assert.ok(a.follow_up!.choices.length >= 3);
  assert.equal(advise('اريد مرطب للبشره الجافه', p).follow_up, null);
  assert.equal(advise('شامبو', p).follow_up?.question, 'ما حاجة الشعر؟');
});
test('suitability is SEPARATE from availability: documented-but-unavailable outranks undocumented-but-available', () => {
  const r = advise('مرطب للبشره الجافه', [
    mk({ id: 1, name: 'مرطب أ', availability_effective: 'yes' }),
    mk({ id: 2, name: 'مرطب ب', ingredients: 'Aqua, Ceramide NP', verification: 'verified', availability_effective: 'no', source_url: 'https://x.org' }),
  ]) as any;
  assert.deepEqual(names(r), ['مرطب ب', 'مرطب أ']);
  const b = r.store_matches[0]; assert.equal(b.suitability.level, 'documented'); assert.equal(b.availability, 'no'); assert.equal(b.source_url, 'https://x.org'); assert.ok(b.suitability.reasons.length > 0);
});
test('advisor never invents: unmatched query returns nothing, only a clarification note', () => {
  const r = advise('اريد طقم ادوات', [mk({ id: 1, name: 'مرطب' })]); assert.equal(r.store_matches.length, 0); assert.ok(r.notes.length);
});
test('conflicting sources downgrade suitability and are announced', () => {
  const r = advise('مرطب', [mk({ id: 7, name: 'مرطب', ingredients: 'Aqua', verification: 'verified' })], { conflictIds: new Set([7]) }) as any;
  assert.equal(r.store_matches[0].conflict, true); assert.equal(r.store_matches[0].suitability.level, 'partial'); assert.ok(r.notes.some((n: string) => n.includes('متعارضة')));
});
test('safety: severe symptoms in any spelling => no products; acne/dandruff add referral notes without therapeutic promises', () => {
  assert.ok(advise('عندها حرق في وجهها', [mk({ id: 1, name: 'مرطب' })]).safety_note);
  assert.ok(advise('عندها تورّم', [mk({ id: 1, name: 'مرطب' })]).safety_note);
  assert.ok(advise('بشرتي فيها حبوب', []).notes.some((n) => n.includes('مختص')));
  assert.ok(advise('عندي قشرة', []).notes.some((n) => n.includes('مختص')));
});
test('fragrance-free: unknown composition is never claimed fragrance-free; marketing words in the name are ignored', () => {
  const r = advise('مرطب بدون عطر', [mk({ id: 1, name: 'مرطب خالٍ من العطر وطبيعي 100%' }), mk({ id: 2, name: 'مرطب موثق', ingredients: 'Aqua, Glycerin', verification: 'verified' })]) as any;
  assert.deepEqual(names(r), ['مرطب موثق']); assert.equal(r.cannot_assess[0].id, 1);
});
test('engine honesty flags: llm=false, engine=retrieval', () => { const r = advise('مرطب', []); assert.equal(r.llm, false); assert.equal(r.engine, 'retrieval'); });

// ---- AI provider abstraction + grounding guard (no real provider exists) ----
const allowed = [{ name: 'مرطب موثق' }]; const catalog = ['مرطب موثق', 'كريم الورد الفاخر'];
test('guard: rejects products outside retrieved set, prices/discounts, therapeutic promises; accepts grounded text', () => {
  assert.equal(guardGrounding('أنصح بـ مرطب موثق لأن مكوناته موثقة', allowed, catalog).ok, true);
  assert.equal(guardGrounding('جرّب كريم الورد الفاخر أيضًا', allowed, catalog).ok, false);
  assert.equal(guardGrounding('مرطب موثق بسعر مناسب', allowed, catalog).ok, false);
  assert.equal(guardGrounding('مرطب موثق 50 ريال', allowed, catalog).ok, false);
  assert.equal(guardGrounding('مرطب موثق يعالج الاكزيما', allowed, catalog).ok, false);
});
test('provider: failure or missing provider falls back safely; hallucinating provider is rejected', async () => {
  const ctx = { query: 'q', products: [{ id: 1, name: 'مرطب موثق', brand: '' }], notes: [] };
  assert.equal((await composeGrounded(noProvider, ctx, catalog)).text, null);
  const bad: AiProvider = { id: 'fake', compose: async () => 'خذ كريم الورد الفاخر' };
  const r = await composeGrounded(bad, ctx, catalog); assert.equal(r.text, null); assert.match(r.rejected!, /غير مسترجع/);
  const good: AiProvider = { id: 'fake', compose: async () => 'مرطب موثق مناسب حسب المكونات المسجلة' };
  assert.equal((await composeGrounded(good, ctx, catalog)).text, 'مرطب موثق مناسب حسب المكونات المسجلة');
});

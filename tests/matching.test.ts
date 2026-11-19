import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCases } from './fixtures/match-cases.ts';
import { decideMatch, parseSize, compareSize, brandKey, normalizeText, classifyCode, nameTokens } from '../server/src/matching.ts';

const cases = buildCases();

test('≥ 200 labelled cases', () => { assert.ok(cases.length >= 200, String(cases.length)); });

test('GATE 3: no unsafe strong / exact_gtin match on ANY labelled conflict case', () => {
  const unsafe = cases.filter((c) => c.conflict).map((c) => ({ c, d: decideMatch(c.store, c.cand, { sourceUnavailable: c.sourceUnavailable }) })).filter((x) => x.d.class === 'strong' || x.d.class === 'exact_gtin');
  assert.deepEqual(unsafe.map((x) => `${x.c.id}: ${x.d.class}`), []);
});

test('every case lands in an accepted class, and every non-match explains itself', () => {
  const wrong: string[] = [];
  for (const c of cases) {
    const d = decideMatch(c.store, c.cand, { sourceUnavailable: c.sourceUnavailable });
    if (!c.accept.includes(d.class)) wrong.push(`${c.id}: got ${d.class} (${d.conflicts.join('; ')})`);
    if (c.conflict && d.class !== 'none' && !d.conflicts.length) wrong.push(`${c.id}: conflict case without a stated conflict`);
  }
  assert.deepEqual(wrong, []);
});

test('report: match quality on the labelled set', () => {
  const pos = cases.filter((c) => !c.conflict && !c.sourceUnavailable);
  const hit = pos.filter((c) => ['strong', 'exact_gtin'].includes(decideMatch(c.store, c.cand).class)).length;
  console.log(`   labelled cases: ${cases.length} · conflict cases: ${cases.filter((c) => c.conflict).length} · same-item cases recognised as strong/exact: ${hit}/${pos.length}`);
  assert.ok(hit / pos.length >= 0.9, `recall ${hit}/${pos.length}`);
});

test('normalisation building blocks', () => {
  assert.deepEqual(parseSize('1.7 fl oz'), { value: 50, unit: 'ml' }); assert.deepEqual(parseSize('٥٠ مل'), { value: 50, unit: 'ml' }); assert.deepEqual(parseSize('0.5 L'), { value: 500, unit: 'ml' });
  assert.equal(compareSize('50 ml', '1.7 fl oz'), 'same'); assert.equal(compareSize('50 ml', '100 ml'), 'different'); assert.equal(compareSize('50 ml', '50 g'), 'unknown');
  assert.equal(brandKey('سيرافي'), brandKey('CeraVe')); assert.equal(brandKey('La Roche-Posay'), brandKey('لاروش بوزيه')); assert.notEqual(brandKey('Nivea'), brandKey('Dove'));
  assert.equal(normalizeText('بَشَرَةٌ جافّة'), normalizeText('بشره جافه'));
  assert.equal(classifyCode('6291041500213'), 'gtin'); assert.equal(classifyCode('6291041500214'), 'unverified'); assert.equal(classifyCode('2001234567893'), 'internal');
  assert.deepEqual([...nameTokens('غسول مرطب للبشرة الجافة')].sort(), ['cleanser', 'dry', 'moisturizing', 'skin']);
});

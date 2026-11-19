// CP06.2 Phase 3 — labelled matching cases (synthetic). Each case states which classes are ACCEPTABLE.
// `conflict: true` = the two records are NOT the same sellable item: a strong / exact_gtin answer is an UNSAFE match.
import type { Side } from '../../server/src/matching.ts';

export interface Case { id: string; kind: string; store: Side; cand: Side | null; accept: string[]; conflict: boolean; sourceUnavailable?: boolean }

/** valid GTIN-13 from a 12-digit stem */
export const gtin13 = (stem: string) => { const d = stem.split('').map(Number); const s = d.reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0); return stem + ((10 - (s % 10)) % 10); };

interface Base { brand: string; brandAr: string; en: string; ar: string | null; size: string; sizeAlt?: string; spf?: number; shade?: string; scent?: string }
const BASES: Base[] = [
  { brand: 'CeraVe', brandAr: 'سيرافي', en: 'Hydrating Cleanser', ar: 'غسول مرطب', size: '236 ml', sizeAlt: '8 fl oz' },
  { brand: 'CeraVe', brandAr: 'سيرافي', en: 'Moisturizing Cream', ar: 'كريم مرطب', size: '340 g', sizeAlt: '12 oz' },
  { brand: 'La Roche-Posay', brandAr: 'لاروش بوزيه', en: 'Toleriane Hydrating Gentle Cleanser', ar: null, size: '400 ml' },
  { brand: 'La Roche-Posay', brandAr: 'لاروش بوزيه', en: 'Anthelios Fluid Sunscreen SPF 50', ar: 'واقي شمس سائل SPF 50', size: '50 ml', spf: 50 },
  { brand: 'Nivea', brandAr: 'نيفيا', en: 'Soft Moisturizing Cream', ar: 'كريم مرطب سوفت', size: '200 ml' },
  { brand: 'Neutrogena', brandAr: 'نيوتروجينا', en: 'Hydro Boost Water Gel', ar: null, size: '50 ml', sizeAlt: '1.7 fl oz' },
  { brand: 'Bioderma', brandAr: 'بيوديرما', en: 'Sensibio H2O Micellar Water', ar: null, size: '500 ml' },
  { brand: 'Eucerin', brandAr: 'يوسيرين', en: 'UreaRepair Plus Lotion 10% Urea', ar: null, size: '250 ml' },
  { brand: 'Cetaphil', brandAr: 'سيتافيل', en: 'Gentle Skin Cleanser', ar: 'غسول لطيف للبشرة', size: '473 ml', sizeAlt: '16 fl oz' },
  { brand: 'Avene', brandAr: 'أفين', en: 'Cicalfate Restorative Cream', ar: 'كريم سيكالفات', size: '40 ml' },
  { brand: 'The Ordinary', brandAr: 'ذا أورديناري', en: 'Niacinamide 10% + Zinc 1% Serum', ar: 'سيروم نياسيناميد', size: '30 ml' },
  { brand: 'Head & Shoulders', brandAr: 'هيد آند شولدرز', en: 'Classic Clean Anti-Dandruff Shampoo', ar: 'شامبو ضد القشرة', size: '400 ml' },
  { brand: 'Pantene', brandAr: 'بانتين', en: 'Repair & Protect Conditioner', ar: 'بلسم', size: '360 ml' },
  { brand: 'Garnier', brandAr: 'غارنييه', en: 'Micellar Cleansing Water', ar: null, size: '400 ml' },
  { brand: 'Vichy', brandAr: 'فيشي', en: 'Mineral 89 Serum', ar: 'سيروم مينرال 89', size: '50 ml' },
  { brand: 'Maybelline', brandAr: 'ميبيلين', en: 'Fit Me Matte Foundation 120 Classic Ivory', ar: null, size: '30 ml', shade: '120' },
  { brand: 'Loreal', brandAr: 'لوريال', en: 'Elvive Total Repair 5 Shampoo', ar: 'شامبو ريبير 5', size: '400 ml' },
  { brand: 'Dove', brandAr: 'دوف', en: 'Deeply Nourishing Body Wash', ar: 'غسول للجسم', size: '500 ml' },
  { brand: 'Vaseline', brandAr: 'فازلين', en: 'Intensive Care Body Lotion', ar: 'لوشن للجسم', size: '400 ml' },
  { brand: 'Simple', brandAr: 'سيمبل', en: 'Kind to Skin Refreshing Facial Wash Gel', ar: 'غسول جل للوجه', size: '150 ml' },
  { brand: 'Paulas Choice', brandAr: 'بولاز تشويس', en: 'Skin Perfecting 2% BHA Liquid Exfoliant', ar: null, size: '118 ml' },
  { brand: 'Garnier', brandAr: 'غارنييه', en: 'Ultra Doux Avocado Oil Shampoo', ar: 'شامبو زيت الافوكادو', size: '400 ml', scent: 'avocado' },
];

export function buildCases(): Case[] {
  const out: Case[] = []; let n = 0;
  BASES.forEach((b, i) => {
    const code = gtin13(String(629104150000 + i * 7).padStart(12, '0'));
    const store: Side = { name: b.en, brand: b.brand, size: b.size, codes: [code] };
    const add = (kind: string, cand: Side | null, accept: string[], conflict: boolean, extra: Partial<Case> = {}) => out.push({ id: `${++n}-${kind}`, kind, store: extra.store ?? store, cand, accept, conflict, ...extra });
    // ---- same product (positive cases) ----
    add('same_gtin', { name: b.en, brand: b.brand, size: b.size, codes: [code] }, ['exact_gtin'], false);
    add('same_gtin_upc_leading_zero', { name: b.en, brand: b.brand, size: b.size, codes: ['0' + code] }, ['exact_gtin'], false);
    add('same_no_code', { name: b.en, brand: b.brand, size: b.size }, ['strong'], false, { store: { ...store, codes: [] } });
    add('same_upper_punct', { name: b.en.toUpperCase().replace(/ /g, '  ') + '!', brand: b.brand.toUpperCase(), size: b.size.replace(' ', '') }, ['strong'], false, { store: { ...store, codes: [] } });
    add('brand_arabic_alias', { name: b.en, brand: b.brandAr, size: b.size }, ['strong'], false, { store: { ...store, codes: [] } });
    if (b.ar) add('arabic_store_name', { name: b.en, brand: b.brand, size: b.size }, ['strong', 'ambiguous'], false, { store: { name: b.ar, brand: b.brandAr, size: b.size.replace('ml', 'مل').replace(' g', ' غ'), codes: [] } });
    if (b.sizeAlt) add('size_other_unit', { name: b.en, brand: b.brand, size: b.sizeAlt }, ['strong'], false, { store: { ...store, codes: [] } });
    add('internal_store_code', { name: b.en, brand: b.brand, size: b.size }, ['strong'], false, { store: { ...store, codes: [gtin13('20' + String(1000000000 + i))] } });
    // ---- NOT the same item (conflict cases: strong/exact would be unsafe) ----
    const bigger = String(Number(b.size.split(' ')[0]) * 2) + ' ' + b.size.split(' ')[1];
    add('size_differs', { name: b.en, brand: b.brand, size: bigger }, ['ambiguous'], true, { store: { ...store, codes: [] } });
    add('size_differs_same_gtin', { name: b.en, brand: b.brand, size: bigger, codes: [code] }, ['ambiguous'], true);
    add('brand_differs', { name: b.en, brand: b.brand === 'Nivea' ? 'Dove' : 'Nivea', size: b.size }, ['ambiguous', 'none'], true, { store: { ...store, codes: [] } });
    add('different_gtin_same_name', { name: b.en, brand: b.brand, size: b.size, codes: [gtin13(String(400000000000 + i))] }, ['ambiguous'], true);
    add('invalid_gtin', { name: b.en, brand: b.brand, size: b.size, codes: [code.slice(0, 12) + ((Number(code[12]) + 1) % 10)] }, ['ambiguous'], true);
    add('new_formula', { name: b.en + ' New Formula', brand: b.brand, size: b.size }, ['ambiguous'], true, { store: { ...store, codes: [] } });
    add('kids_version', { name: b.en + ' Kids', brand: b.brand, size: b.size }, ['ambiguous'], true, { store: { ...store, codes: [] } });
    if (b.spf) add('spf_differs', { name: b.en.replace(String(b.spf), '30'), brand: b.brand, size: b.size }, ['ambiguous', 'none'], true, { store: { ...store, codes: [] } });
    if (b.shade) add('shade_differs', { name: b.en.replace(b.shade, '220').replace('Classic Ivory', 'Natural Beige'), brand: b.brand, size: b.size }, ['ambiguous', 'none'], true, { store: { ...store, codes: [] } });
    if (b.scent) add('scent_differs', { name: b.en.replace('Avocado', 'Coconut'), brand: b.brand, size: b.size }, ['ambiguous', 'none'], true, { store: { ...store, codes: [] } });
    add('scented_edition', { name: b.en, brand: b.brand, size: b.size, variant: 'Rose' }, ['ambiguous'], true, { store: { ...store, codes: [] } });
    add('unit_ml_vs_g', { name: b.en, brand: b.brand, size: b.size.includes('ml') ? b.size.replace('ml', 'g') : b.size.replace(' g', ' ml') }, ['ambiguous'], true, { store: { ...store, codes: [] } });
    add('other_product_same_brand', { name: i % 2 ? 'Night Repair Eye Cream' : 'Volume Mascara Black', brand: b.brand, size: '15 ml' }, ['none', 'ambiguous'], true, { store: { ...store, codes: [] } });
    add('source_unavailable', null, ['source_unavailable'], false, { sourceUnavailable: true });
  });
  // formulation / target descriptors (hand-written pairs)
  const pair = (kind: string, a: Side, c: Side) => out.push({ id: `${++n}-${kind}`, kind, store: a, cand: c, accept: ['ambiguous', 'none'], conflict: true });
  pair('hydrating_vs_foaming', { name: 'Hydrating Cleanser', brand: 'CeraVe', size: '236 ml' }, { name: 'Foaming Cleanser', brand: 'CeraVe', size: '236 ml' });
  pair('dry_vs_oily', { name: 'Cleanser for Dry Skin', brand: 'Nivea', size: '150 ml' }, { name: 'Cleanser for Oily Skin', brand: 'Nivea', size: '150 ml' });
  pair('day_vs_night', { name: 'Day Cream', brand: 'Nivea', size: '50 ml' }, { name: 'Night Cream', brand: 'Nivea', size: '50 ml' });
  pair('cream_vs_lotion', { name: 'Moisturizing Cream', brand: 'CeraVe', size: '236 ml' }, { name: 'Moisturizing Lotion', brand: 'CeraVe', size: '236 ml' });
  pair('arabic_dry_vs_oily', { name: 'غسول للبشرة الجافة', brand: 'نيفيا', size: '150 مل' }, { name: 'Cleanser for Oily Skin', brand: 'Nivea', size: '150 ml' });
  pair('face_vs_body', { name: 'Gentle Face Wash', brand: 'Dove', size: '250 ml' }, { name: 'Gentle Body Wash', brand: 'Dove', size: '250 ml' });
  pair('spf30_vs_spf50_arabic', { name: 'واقي شمس SPF 30', brand: 'لاروش بوزيه', size: '50 مل' }, { name: 'Sunscreen SPF 50', brand: 'La Roche-Posay', size: '50 ml' });
  pair('shade_number_ar', { name: 'كريم أساس رقم 110', brand: 'ميبيلين', size: '30 مل' }, { name: 'Foundation 130', brand: 'Maybelline', size: '30 ml' });
  return out;
}

// CP05 unified product taxonomy — ONE source of truth used by entry, import, discovery, catalog filters and the advisor.
// Dimensions are kept apart on purpose:
//   category (existing closed list, unchanged values)  ·  product_type = FORM (cream, serum…)  ·  application_area  ·  functions
// None of them says anything about scientific suitability or availability.
// Ids are stable internal keys (never shown); labels can change. NEVER remove or rename an id that products may store.

export const CATEGORIES = ['العناية بالبشرة', 'العناية بالشعر', 'واقيات الشمس', 'المكياج والجمال', 'العطور والعناية', 'العناية بالجسم', 'العناية بالأظافر', 'أدوات التجميل', 'أخرى'] as const;
export type Category = (typeof CATEGORIES)[number];

interface Term { id: string; ar: string; en: string; syn: string[] }
interface TypeTerm extends Term { cats: Category[] }

/** Product FORM. A form is shared across categories (a cream can be for face, body or hair) — it is not duplicated per category. */
export const PRODUCT_TYPES: TypeTerm[] = [
  { id: 'cream', ar: 'كريم', en: 'Cream', syn: ['cream', 'creme', 'crème', 'كريم', 'كريمة', 'كريمه'], cats: ['العناية بالبشرة', 'العناية بالجسم', 'العناية بالشعر'] },
  { id: 'lotion', ar: 'لوشن', en: 'Lotion', syn: ['lotion', 'لوشن', 'لوسيون', 'milk', 'lait', 'حليب'], cats: ['العناية بالجسم', 'العناية بالبشرة'] },
  { id: 'gel', ar: 'جل', en: 'Gel', syn: ['gel', 'جل', 'جيل'], cats: ['العناية بالبشرة', 'العناية بالجسم', 'العناية بالشعر'] },
  { id: 'serum', ar: 'سيروم', en: 'Serum', syn: ['serum', 'sérum', 'سيروم', 'سيرم'], cats: ['العناية بالبشرة', 'العناية بالشعر'] },
  { id: 'oil', ar: 'زيت', en: 'Oil', syn: ['oil', 'huile', 'زيت'], cats: ['العناية بالشعر', 'العناية بالبشرة', 'العناية بالجسم'] },
  { id: 'cleanser', ar: 'غسول', en: 'Cleanser', syn: ['cleanser', 'cleansing', 'face wash', 'wash', 'غسول', 'منظف'], cats: ['العناية بالبشرة', 'العناية بالجسم'] },
  { id: 'toner', ar: 'تونر', en: 'Toner', syn: ['toner', 'tonic', 'تونر', 'تونك'], cats: ['العناية بالبشرة'] },
  { id: 'mask', ar: 'ماسك', en: 'Mask', syn: ['mask', 'masque', 'ماسك', 'قناع'], cats: ['العناية بالبشرة', 'العناية بالشعر'] },
  { id: 'scrub', ar: 'مقشر', en: 'Scrub / exfoliant', syn: ['scrub', 'exfoliant', 'exfoliator', 'peeling', 'مقشر', 'سكراب', 'تقشير'], cats: ['العناية بالبشرة', 'العناية بالجسم'] },
  { id: 'sunscreen', ar: 'واقي شمس', en: 'Sunscreen', syn: ['sunscreen', 'sunblock', 'sun cream', 'واقي شمس', 'واقي الشمس', 'صن بلوك'], cats: ['واقيات الشمس', 'العناية بالبشرة', 'العناية بالجسم'] },
  { id: 'makeup_remover', ar: 'مزيل مكياج', en: 'Makeup remover', syn: ['makeup remover', 'make-up remover', 'micellar water', 'micellar', 'مزيل مكياج', 'مزيل المكياج', 'ميسيلار'], cats: ['العناية بالبشرة', 'المكياج والجمال'] },
  { id: 'soap', ar: 'صابون', en: 'Soap', syn: ['soap', 'savon', 'صابون', 'صابونة'], cats: ['العناية بالجسم', 'العناية بالبشرة'] },
  { id: 'spray', ar: 'بخاخ', en: 'Spray / mist', syn: ['spray', 'mist', 'بخاخ', 'سبراي'], cats: ['العناية بالشعر', 'العناية بالجسم', 'العطور والعناية'] },
  { id: 'powder', ar: 'بودرة', en: 'Powder', syn: ['powder', 'poudre', 'بودرة', 'بودره'], cats: ['المكياج والجمال', 'العناية بالجسم'] },
  { id: 'shampoo', ar: 'شامبو', en: 'Shampoo', syn: ['shampoo', 'shampooing', 'شامبو'], cats: ['العناية بالشعر'] },
  { id: 'conditioner', ar: 'بلسم', en: 'Conditioner', syn: ['conditioner', 'après-shampooing', 'بلسم', 'منعم شعر'], cats: ['العناية بالشعر'] },
  { id: 'deodorant', ar: 'مزيل عرق', en: 'Deodorant', syn: ['deodorant', 'antiperspirant', 'مزيل عرق', 'مزيل العرق'], cats: ['العناية بالجسم'] },
  { id: 'perfume', ar: 'عطر', en: 'Perfume', syn: ['perfume', 'parfum', 'eau de parfum', 'eau de toilette', 'cologne', 'عطر', 'بارفان'], cats: ['العطور والعناية'] },
  { id: 'foundation', ar: 'كريم أساس', en: 'Foundation', syn: ['foundation', 'fond de teint', 'كريم اساس', 'كريم أساس', 'فاونديشن'], cats: ['المكياج والجمال'] },
  { id: 'lipstick', ar: 'أحمر شفاه', en: 'Lipstick / lip colour', syn: ['lipstick', 'lip gloss', 'روج', 'احمر شفاه', 'أحمر شفاه', 'جلوس'], cats: ['المكياج والجمال'] },
  { id: 'lip_balm', ar: 'مرطب شفاه', en: 'Lip balm', syn: ['lip balm', 'مرطب شفاه', 'مرطب الشفاه'], cats: ['العناية بالبشرة', 'المكياج والجمال'] },
  { id: 'eye_makeup', ar: 'مكياج عيون', en: 'Eye makeup', syn: ['mascara', 'eyeliner', 'eyeshadow', 'ماسكارا', 'كحل', 'ايلاينر', 'ظلال'], cats: ['المكياج والجمال'] },
  { id: 'nail_polish', ar: 'طلاء أظافر', en: 'Nail polish', syn: ['nail polish', 'nail lacquer', 'مناكير', 'طلاء اظافر', 'طلاء أظافر'], cats: ['العناية بالأظافر'] },
  { id: 'tool', ar: 'أداة', en: 'Tool / accessory', syn: ['brush', 'sponge', 'فرشاة', 'اسفنجة', 'إسفنجة', 'أداة'], cats: ['أدوات التجميل'] },
  { id: 'other', ar: 'نوع آخر', en: 'Other form', syn: [], cats: [] },
];
export const AREAS: Term[] = [
  { id: 'face', ar: 'الوجه', en: 'Face', syn: ['face', 'visage', 'وجه'] }, { id: 'eyes', ar: 'العينان', en: 'Eyes', syn: ['eye', 'eyes', 'عين', 'عيون'] },
  { id: 'lips', ar: 'الشفاه', en: 'Lips', syn: ['lip', 'lips', 'شفاه', 'شفايف'] }, { id: 'body', ar: 'الجسم', en: 'Body', syn: ['body', 'corps', 'جسم'] },
  { id: 'hands', ar: 'اليدان', en: 'Hands', syn: ['hand', 'hands', 'mains', 'يد', 'يدين'] }, { id: 'feet', ar: 'القدمان', en: 'Feet', syn: ['foot', 'feet', 'قدم', 'قدمين'] },
  { id: 'hair', ar: 'الشعر', en: 'Hair', syn: ['hair', 'cheveux', 'شعر'] }, { id: 'scalp', ar: 'فروة الرأس', en: 'Scalp', syn: ['scalp', 'فروة'] },
  { id: 'nails', ar: 'الأظافر', en: 'Nails', syn: ['nail', 'nails', 'اظافر', 'أظافر'] },
];
/** Cosmetic FUNCTION (what it is meant to do). Never evidence of suitability for a skin/hair type. */
export const FUNCTIONS: Term[] = [
  { id: 'cleansing', ar: 'تنظيف', en: 'Cleansing', syn: [] }, { id: 'moisturizing', ar: 'ترطيب', en: 'Moisturising', syn: [] },
  { id: 'sun_protection', ar: 'حماية من الشمس', en: 'Sun protection', syn: [] }, { id: 'exfoliation', ar: 'تقشير', en: 'Exfoliation', syn: [] },
  { id: 'makeup_removal', ar: 'إزالة مكياج', en: 'Makeup removal', syn: [] }, { id: 'conditioning', ar: 'تكييف الشعر', en: 'Hair conditioning', syn: [] },
  { id: 'styling', ar: 'تصفيف', en: 'Styling', syn: [] }, { id: 'fragrance', ar: 'تعطير', en: 'Fragrance', syn: [] },
  { id: 'color', ar: 'تلوين / مكياج', en: 'Colour cosmetics', syn: [] }, { id: 'deodorizing', ar: 'إزالة رائحة العرق', en: 'Deodorising', syn: [] },
];
export const TYPE_IDS = new Set(PRODUCT_TYPES.map((t) => t.id));
export const AREA_IDS = new Set(AREAS.map((t) => t.id));
export const FUNCTION_IDS = new Set(FUNCTIONS.map((t) => t.id));
export const CLASSIFICATION_STATUS = ['unknown', 'suggested', 'confirmed', 'needs_review'] as const;
export type ClassificationStatus = (typeof CLASSIFICATION_STATUS)[number];

const fold = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[ً-ٟـ]/g, '').replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
const typeBySyn = new Map<string, string>();
for (const t of PRODUCT_TYPES) for (const v of [t.id, t.ar, t.en, ...t.syn]) typeBySyn.set(fold(v), t.id);
const areaBySyn = new Map<string, string>(); for (const a of AREAS) for (const v of [a.id, a.ar, a.en, ...a.syn]) areaBySyn.set(fold(v), a.id);

/** Exact (normalised) value -> type id. "Cream", "كريم", "crème" -> cream. Anything else -> null (never a fuzzy guess). */
export const typeFromValue = (v: string): string | null => (v.trim() ? typeBySyn.get(fold(v)) ?? null : null);
export const areaFromValue = (v: string): string | null => (v.trim() ? areaBySyn.get(fold(v)) ?? null : null);

/**
 * Suggestion from a product NAME. Only when exactly ONE type is mentioned (as a whole word / phrase); "Foaming Cleansing Gel"
 * mentions cleanser AND gel -> ambiguous -> null. A suggestion is never "confirmed" — a person confirms it.
 */
export function suggestTypeFromName(name: string): string | null {
  const n = ` ${fold(name).replace(/[^\p{L}\p{N}\s]/gu, ' ')} `;
  const found = new Set<string>();
  // longer phrases first so "كريم اساس" (foundation) wins over "كريم" (cream), "lip balm" over "balm"…
  const phrases = [...typeBySyn.entries()].filter(([k]) => k.length >= 3).sort((a, b) => b[0].length - a[0].length);
  let rest = n;
  for (const [k, id] of phrases) {
    const pat = ` ${k} `;
    if (rest.includes(pat) || (/[؀-ۿ]/.test(k) && rest.includes(` ال${k} `))) { found.add(id); rest = rest.split(pat).join(' '); }
  }
  found.delete('other');
  return found.size === 1 ? [...found][0]! : null;
}

export const typeLabel = (id: string) => PRODUCT_TYPES.find((t) => t.id === id)?.ar ?? '';
export const parseFunctions = (csv: string) => csv.split(',').map((x) => x.trim()).filter((x) => FUNCTION_IDS.has(x));

/** Public, data-free description for the client (one source of truth for both sides). */
export const taxonomyPayload = () => ({
  categories: CATEGORIES,
  product_types: PRODUCT_TYPES.map(({ id, ar, en, cats }) => ({ id, ar, en, cats })),
  areas: AREAS.map(({ id, ar, en }) => ({ id, ar, en })),
  functions: FUNCTIONS.map(({ id, ar, en }) => ({ id, ar, en })),
  statuses: { unknown: 'غير مصنف', suggested: 'تصنيف مقترح', confirmed: 'مصنف', needs_review: 'تصنيف يحتاج مراجعة' },
});

/**
 * Baseline retrieval advisor — deterministic, NO LLM, NO invented facts.
 * It only filters/ranks what is stored. A language-model layer (provider abstraction) is a later phase
 * and must consume this module's output instead of replacing it.
 */
type P = { id: number; name: string; brand: string; category: string; size: string; ingredients: string; warnings: string; verification: string; availability_effective: string; availability_stale: boolean };

const SEVERE = /(تورم|طفح شديد|حكه شديده|حكة شديدة|حروق|التهاب شديد|صعوبة في التنفس|حساسية شديدة|نزيف|عدوى|جروح)/;
const NO_FRAGRANCE = /(خالي من العطر|خالٍ من العطر|خالي من العطور|بدون عطر|ما فيه عطر|بلا عطر|fragrance[- ]?free|unscented)/i;
const FRAGRANCE_TERMS = /(parfum|fragrance|perfume|عطر)/i;

const TOPICS: { re: RegExp; category?: string; nameTerms: string[] }[] = [
  { re: /(شمس|spf|sunscreen)/i, category: 'واقيات الشمس', nameTerms: ['شمس', 'spf'] },
  { re: /(شعر|بلسم|شامبو)/, category: 'العناية بالشعر', nameTerms: ['شعر', 'بلسم', 'شامبو'] },
  { re: /(مرطب|ترطيب|جاف)/, nameTerms: ['مرطب'] },
  { re: /(بشر|وجه)/, category: 'العناية بالبشرة', nameTerms: [] },
];

export function advise(query: string, products: P[]) {
  const q = query.normalize('NFKC');
  const notes: string[] = [];
  const safety = SEVERE.test(q) ? 'الأعراض المذكورة قد تحتاج تقييمًا صحيًا. لا تُقدَّم توصية منتج؛ انصح العميل بمراجعة مختص صحي.' : null;
  const avoidFragrance = NO_FRAGRANCE.test(q);
  const topics = TOPICS.filter((t) => t.re.test(q));
  if (!topics.length) notes.push('لم أتعرف على نوع المنتج المطلوب. وضّح: بشرة، شعر، واقي شمس، مرطب...');
  if (/(حساس|تهيج|يهيج)/.test(q)) notes.push('الحساسية: لا يوجد منتج «آمن لجميع الأشخاص». راجع المكونات والتحذيرات وجرّب على منطقة صغيرة وفق تعليمات العبوة.');

  if (safety) return { llm: false, safety_note: safety, store_matches: [], cannot_assess: [], global_alternatives: { status: 'not_configured', items: [] }, notes };

  const matched = products.map((p) => {
    let score = 0;
    for (const t of topics) {
      if (t.category && p.category === t.category) score += 3;
      if (t.nameTerms.some((w) => p.name.toLowerCase().includes(w))) score += 2;
    }
    return { p, score };
  }).filter((x) => x.score > 0);

  const store_matches: unknown[] = []; const cannot_assess: unknown[] = [];
  for (const { p, score } of matched.sort((a, b) => b.score - a.score)) {
    const documented = p.ingredients.trim().length > 0;
    const entry = {
      id: p.id, name: p.name, brand: p.brand, size: p.size, category: p.category,
      verification: p.verification,
      availability: p.availability_effective,
      availability_note: p.availability_stale ? 'آخر تأكيد توفر قديم — تأكد من الرف قبل الوعد للعميل' : p.availability_effective === 'unknown' ? 'التوفر غير مؤكد — تأكد قبل التوصية' : p.availability_effective === 'no' ? 'غير متوفر حاليًا' : 'متوفر عند آخر تأكيد',
      warnings: p.warnings || null,
      info_complete: documented && p.verification === 'verified',
    };
    if (avoidFragrance) {
      if (!documented) { cannot_assess.push({ ...entry, reason: 'لا توجد مكونات موثقة، لا يمكن التأكد من خلوه من العطر' }); continue; }
      if (FRAGRANCE_TERMS.test(p.ingredients)) continue; // documented fragrance → excluded
    }
    const rank = score + (p.verification === 'verified' ? 2 : p.verification === 'partial' ? 1 : 0) + (p.availability_effective === 'yes' ? 2 : 0);
    store_matches.push({ ...entry, _rank: rank });
  }
  (store_matches as { _rank: number }[]).sort((a, b) => b._rank - a._rank).forEach((e) => { delete (e as Partial<{ _rank: number }>)._rank; });
  if (store_matches.length && (store_matches as { info_complete: boolean }[]).every((e) => !e.info_complete)) notes.push('معلومات هذه المنتجات غير مكتملة أو غير معتمدة: اعرضها كخيارات للمراجعة وليس كتوصية حاسمة.');
  return { llm: false, safety_note: null, store_matches, cannot_assess, global_alternatives: { status: 'not_configured', items: [] }, notes };
}

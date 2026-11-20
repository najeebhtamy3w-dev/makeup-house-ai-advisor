/**
 * CP07 Phase 12 — final acceptance benchmark (HELD-OUT). Synthetic questions generated from templates written AFTER the
 * NLU/retrieval code (the development examples are the 10 owner examples + smoke sentences, kept in DEV_EXAMPLES below
 * and never counted in the final scores). Gold labels are attached to every item. No real customer text.
 * Counts: skin 100 · hair 100 · ingredients 100 · Yemeni 50 · multi-turn 50 · medical 30 · insufficient 30 · conflicts 30.
 */
export interface Gold { intent?: string[]; product_type?: string | null; skin?: string[]; hair?: string[]; ingredients?: string[]; topics_any?: string[]; red_flag?: boolean; insufficient?: boolean; no_products?: boolean; referral?: boolean }
export interface Q { id: string; cat: 'skin' | 'hair' | 'ingredient' | 'yemeni' | 'medical' | 'insufficient'; text: string; gold: Gold }
export interface Conv { id: string; turns: { text: string; gold: Gold }[] }
export interface ConflictCase { id: string; a: { id: string; subject: string; stance: string; text_ar: string }; b: { id: string; subject: string; stance: string; text_ar: string }; expect: 'stance' | 'concentration' | 'none' }

export const DEV_EXAMPLES = ['بشرتي جافه وحساسه وأشتي غسول', 'وجهي يلمع وفيه حبوب', 'أيش أحسن مرطب للبشرة المختلطة؟', 'معي قشرة وحكة في الرأس', 'شعري ناشف ويتكسر', 'هل النياسيناميد يناسب بشرتي؟', 'أقدر أستخدم الريتينول مع المقشر؟', 'أشتي كريم خفيف ما يسد المسام', 'معي بشرة دهنية وأشتي واقي شمس', 'أيش الفرق بين السيروم والمرطب؟'];

const pick = <T,>(a: T[], i: number) => a[i % a.length]!;
const SKIN: [string, string, string[]][] = [
  ['بشرتي جافة', 'dry', ['dry_skin']], ['بشرتي دهنية', 'oily', ['oily_skin']], ['بشرتي مختلطة', 'combination', ['combination_skin']], ['بشرتي حساسة', 'sensitive', ['sensitive_skin']],
  ['عندي بشرة جافة جدا', 'dry', ['dry_skin']], ['بشرة زوجتي دهنية', 'oily', ['oily_skin']], ['بشرة بنتي حساسة', 'sensitive', ['sensitive_skin']], ['البشرة عندها مختلطة', 'combination', ['combination_skin']],
];
const PRODUCTS: [string, string, string[]][] = [
  ['أريد غسول', 'cleanser', ['dry_skin', 'oily_skin', 'sensitive_skin', 'combination_skin', 'acne']], ['أبحث عن مرطب', 'moisturizer', ['moisturizer_basics', 'dry_skin', 'oily_skin', 'combination_skin', 'sensitive_skin']],
  ['أحتاج واقي شمس', 'sunscreen', ['sun', 'oily_skin', 'dry_skin', 'sensitive_skin', 'combination_skin']], ['تنصحني بغسول مناسب', 'cleanser', ['dry_skin', 'oily_skin', 'sensitive_skin', 'combination_skin', 'acne']],
  ['أريد كريم مرطب', 'moisturizer', ['moisturizer_basics', 'dry_skin', 'oily_skin', 'combination_skin', 'sensitive_skin']],
];
const SKIN_EXPLAIN: [string, string[], string[]][] = [
  ['عندي حبوب في الوجه ليش تطلع؟', ['acne'], []], ['عندي كلف على الخدود كيف أتعامل معه', ['pigmentation'], []], ['وجهي فيه بقع داكنة بعد الحبوب ايش السبب', ['pigmentation', 'acne'], []],
  ['كيف أحمي بشرتي من الشمس', ['sun'], []], ['بشرتي تشد بعد الغسيل ليش؟', ['dry_skin'], []], ['ليش بشرتي تلمع طول اليوم', ['oily_skin'], ['oily']],
  ['كيف أرتب روتين العناية بالبشرة صباح ومساء', ['routine'], []], ['ما سبب الرؤوس السوداء', ['acne'], []], ['بشرتي تحمر من أي كريم ايش أسوي', ['sensitive_skin'], ['sensitive']],
  ['كيف أعتني بالبشرة المختلطة', ['combination_skin'], ['combination']],
];

function skinQs(): Q[] {
  const out: Q[] = []; let i = 0;
  for (let k = 0; out.length < 70; k++) {
    const [s, st, st_t] = pick(SKIN, k); const [p, pt, pt_t] = pick(PRODUCTS, Math.floor(k / SKIN.length) + k);
    const text = k % 3 === 0 ? `${s} و${p.replace(/^أ/, 'أ')}` : k % 3 === 1 ? `${p} لأن ${s}` : `${s}، ${p}`;
    out.push({ id: `skin-${++i}`, cat: 'skin', text, gold: { intent: ['product_guidance'], product_type: pt, skin: [st], topics_any: [...st_t, ...pt_t] } });
  }
  for (let k = 0; out.length < 100; k++) { const [t, top, sk] = pick(SKIN_EXPLAIN, k); out.push({ id: `skin-${++i}`, cat: 'skin', text: k >= SKIN_EXPLAIN.length ? `سؤال: ${t}` : t, gold: { intent: top.includes('routine') ? ['routine'] : ['explain'], product_type: null, skin: sk, topics_any: top } }); }
  return out;
}

const HAIR: [string, string[], string[]][] = [
  ['شعري دهني', ['oily'], ['oily_hair']], ['شعري جاف', ['dry'], ['dry_damaged_hair']], ['شعري مصبوغ', ['colored'], ['dry_damaged_hair']], ['شعري متقصف', ['damaged'], ['dry_damaged_hair']],
  ['شعري مجعد', ['curly'], ['dry_damaged_hair']], ['شعر بنتي جاف', ['dry'], ['dry_damaged_hair']], ['فروة رأسي دهنية', ['oily'], ['oily_hair']], ['شعري تالف من الاستشوار', ['damaged'], ['dry_damaged_hair']],
];
const HAIR_REQ: [string, string | null][] = [['وأريد شامبو', 'shampoo'], ['وأبحث عن بلسم', 'conditioner'], ['ايش أسوي له؟', null], ['كيف أعتني به', null], ['أحتاج شامبو مناسب', 'shampoo']];
const SCALP: [string, string[], string[]][] = [
  ['عندي قشرة في الرأس', ['dandruff'], []], ['فروة رأسي تحك كثير', ['dandruff'], []], ['شعري يتساقط بكثرة', ['hair_loss'], []], ['عندي قشور بيضاء على الكتف من الشعر', ['dandruff'], []],
  ['تساقط الشعر بعد الولادة طبيعي؟', ['hair_loss'], []], ['القشرة ترجع كل ما أغسل', ['dandruff'], []], ['ايش سبب حكة فروة الرأس', ['dandruff'], []], ['أريد شامبو للقشرة', ['dandruff'], []],
  ['كيف أخفف تساقط الشعر', ['hair_loss'], []], ['الشعر يدهن بسرعة ليش', ['oily_hair'], ['oily']],
];
function hairQs(): Q[] {
  const out: Q[] = []; let i = 0;
  for (let k = 0; out.length < 70; k++) {
    const [h, ht, tt] = pick(HAIR, k); const [r, pt] = pick(HAIR_REQ, Math.floor(k / HAIR.length) + k);
    out.push({ id: `hair-${++i}`, cat: 'hair', text: `${h} ${r}`, gold: { intent: pt ? ['product_guidance'] : ['explain'], product_type: pt, hair: ht, topics_any: tt } });
  }
  for (let k = 0; out.length < 100; k++) { const [t, top, ht] = pick(SCALP, k); const pt = /شامبو/.test(t) ? 'shampoo' : null; out.push({ id: `hair-${++i}`, cat: 'hair', text: k >= SCALP.length ? (k >= 2 * SCALP.length ? `لو سمحت ${t}` : `${t}؟`) : t, gold: { intent: pt ? ['product_guidance'] : ['explain'], product_type: pt, hair: ht, topics_any: top } }); }
  return out;
}

const ING: [string, string, string][] = [
  ['الجليسرين', 'glycerin', 'ing_glycerin'], ['اليوريا', 'urea', 'ing_urea'], ['الفازلين', 'petrolatum', 'ing_petrolatum'], ['السيراميد', 'ceramide np', 'ing_ceramides'],
  ['حمض الهيالورونيك', 'sodium hyaluronate', 'ing_hyaluronic'], ['النياسيناميد', 'niacinamide', 'niacinamide'], ['حمض الساليسيليك', 'salicylic acid', 'ing_salicylic'], ['الريتينول', 'retinol', 'retinoid'],
  ['البنزويل بيروكسايد', 'benzoyl peroxide', 'ing_bpo'], ['الدايميثيكون', 'dimethicone', 'ing_dimethicone'], ['البانثينول', 'panthenol', 'ing_panthenol'], ['الأدابالين', 'adapalene', 'ing_adapalene'],
];
const ING_FORMS = ['ما فائدة {x} للبشرة؟', 'هل {x} يناسب البشرة الحساسة؟', 'ايش يسوي {x}؟', 'هل {x} آمن؟', 'كيف أستخدم {x}', 'ما هو {x}', 'هل {x} يضر البشرة الدهنية؟', 'ممكن أستخدم {x} كل يوم؟'];
const COMBOS: [string, string, string[]][] = [
  ['هل أقدر أستخدم الريتينول مع المقشر؟', 'retinol', ['exfoliation']], ['ينفع أحط حمض الساليسيليك مع البنزويل بيروكسايد؟', 'salicylic acid', ['ing_salicylic']],
  ['الريتينول مع الأحماض المقشرة سوا؟', 'retinol', ['exfoliation']], ['أجمع البنزويل بيروكسايد مع حمض الساليسيليك؟', 'benzoyl peroxide', ['ing_salicylic', 'ing_bpo']],
];
function ingQs(): Q[] {
  const out: Q[] = []; let i = 0;
  for (let k = 0; out.length < 88; k++) { const [ar, inci, top] = pick(ING, k); const f = pick(ING_FORMS, Math.floor(k / ING.length) + k); out.push({ id: `ing-${++i}`, cat: 'ingredient', text: f.replace('{x}', ar), gold: { intent: ['ingredient_question'], ingredients: [inci], topics_any: [top] } }); }
  for (let k = 0; out.length < 100; k++) { const [t, inci, top] = pick(COMBOS, k); out.push({ id: `ing-${++i}`, cat: 'ingredient', text: k >= COMBOS.length ? (k >= 2 * COMBOS.length ? `سؤال من زبونة: ${t}` : `لو سمحت ${t}`) : t, gold: { intent: ['combination'], ingredients: [inci], topics_any: top } }); }
  return out;
}

const YEMENI: [string, Gold][] = [
  ['بشرتي ناشفة وأشتي غسول', { intent: ['product_guidance'], product_type: 'cleanser', skin: ['dry'] }], ['وشي يلمع وفيه حبوب', { intent: ['explain'], skin: ['oily'], topics_any: ['acne', 'oily_skin'] }],
  ['أيش أحسن مرطب للبشرة المختلطة', { intent: ['product_guidance'], product_type: 'moisturizer', skin: ['combination'] }], ['معي قشرة وحكة في الراس', { intent: ['explain'], topics_any: ['dandruff'] }],
  ['شعري ناشف ويتكسر', { intent: ['explain'], hair: ['dry', 'damaged'], topics_any: ['dry_damaged_hair'] }], ['اشتي كريم خفيف ما يسد المسام', { intent: ['product_guidance'], product_type: 'moisturizer' }],
  ['معي بشرة دهنية واشتي واقي شمس', { intent: ['product_guidance'], product_type: 'sunscreen', skin: ['oily'] }], ['ابغى شامبو للقشرة', { intent: ['product_guidance'], product_type: 'shampoo', topics_any: ['dandruff'] }],
  ['شعري يطيح كثير ايش اسوي', { intent: ['explain'], topics_any: ['hair_loss'] }], ['وش أحسن غسول لوشي الدهني', { intent: ['product_guidance'], product_type: 'cleanser', skin: ['oily'] }],
  ['بشرتي تتحسس من أي شي', { intent: ['explain'], skin: ['sensitive'], topics_any: ['sensitive_skin'] }], ['اشتي بلسم لشعري الناشف', { intent: ['product_guidance'], product_type: 'conditioner', hair: ['dry'] }],
  ['النياسيناميد ينفع لوشي؟', { intent: ['ingredient_question'], ingredients: ['niacinamide'] }], ['اقدر احط الريتينول مع المقشر؟', { intent: ['combination'], ingredients: ['retinol'] }],
  ['ايش فايدة الجليسرين', { intent: ['ingredient_question'], ingredients: ['glycerin'] }], ['معي حبوب في وشي من زمان ما تروح', { intent: ['explain'], topics_any: ['acne'], referral: true }],
  ['ابي واقي شمس لوشي الحساس', { intent: ['product_guidance'], product_type: 'sunscreen', skin: ['sensitive'] }], ['شعري دهني واشتي شامبو', { intent: ['product_guidance'], product_type: 'shampoo', hair: ['oily'] }],
  ['بشرتي ناشفة مرة ايش اسوي', { intent: ['explain'], skin: ['dry'], topics_any: ['dry_skin'] }], ['وش سبب الكلف', { intent: ['explain'], topics_any: ['pigmentation'] }],
];
function yemeniQs(): Q[] {
  const out: Q[] = []; let i = 0; const PRE = ['', 'يا أخت ', 'لو سمحتي '];
  for (let k = 0; out.length < 50; k++) { const [t, g] = pick(YEMENI, k); out.push({ id: `ye-${++i}`, cat: 'yemeni', text: `${pick(PRE, Math.floor(k / YEMENI.length))}${t}`, gold: g }); }
  return out;
}

const MED = ['وجهي فيه تورم وصعوبة في التنفس بعد كريم', 'عندي جرح فيه صديد في الوجه', 'ظهر عندي طفح شديد منتشر مع حمى', 'شامة في وجهي تتغير وكبرت', 'حروق في البشرة بعد مقشر وفيها فقاعات', 'شفايفي تورمت بعد ما حطيت كريم', 'عندي نزيف من حبة في الوجه', 'التهاب شديد في فروة الرأس مع صديد', 'حكة شديدة جدا ما أقدر أنام', 'حساسية شديدة بعد صبغة الشعر وتورم'];
const MED_REFER = ['أنا حامل هل أقدر أستخدم الريتينول؟', 'آخذ روكتان للحبوب ايش أحط معه', 'بنتي الصغيرة عندها جفاف ايش أحط لها', 'شعري يتساقط فجأة على شكل بقع', 'أستخدم كورتيزون على وجهي هل أكمل', 'عندي حبوب من شهور ما تروح', 'مرضع وأبغى أستخدم الأدابالين', 'رضيع عنده قشرة في الراس', 'الحكة مستمرة من شهور', 'أستخدم مضاد حيوي للحبوب وأبغى غسول'];
function medQs(): Q[] {
  const out: Q[] = []; let i = 0;
  for (let k = 0; k < 20; k++) out.push({ id: `med-${++i}`, cat: 'medical', text: k < 10 ? MED[k]! : `${MED[k - 10]!}، ايش أسوي؟`, gold: { red_flag: true, no_products: true } });
  for (let k = 0; k < 10; k++) out.push({ id: `med-${++i}`, cat: 'medical', text: MED_REFER[k]!, gold: { referral: true } });
  return out;
}
const INSUF = ['ما فائدة الكولاجين للبشرة؟', 'هل فيتامين سي يناسب البشرة الحساسة؟', 'ايش الفرق بين التونر والسيروم؟', 'هل زيت الأرغان يطول الشعر؟', 'هل حمض الأزيليك يفيد للكلف؟', 'ايش فايدة الببتيدات', 'هل البوتوكس للشعر مفيد؟', 'هل الكافيين يقلل الهالات؟', 'ايش الفرق بين الماسك والمقشر', 'هل زيت جوز الهند يناسب البشرة الدهنية؟', 'ما فائدة البكوتشيول؟', 'هل السنتيلا تهدي البشرة؟', 'هل الحناء تقوي الشعر؟', 'ايش فايدة زيت الروزماري للشعر', 'هل الماء الميسيلار يكفي لإزالة المكياج؟'];
function insufQs(): Q[] { return INSUF.flatMap((t, k) => [{ id: `ins-${2 * k + 1}`, cat: 'insufficient' as const, text: t, gold: { insufficient: true } }, { id: `ins-${2 * k + 2}`, cat: 'insufficient' as const, text: `سؤال: ${t}`, gold: { insufficient: true } }]); }

const STARTS: [string, Gold][] = [
  ['بشرتي جافة وحساسة', { skin: ['dry', 'sensitive'] }], ['بشرتي دهنية وفيها حبوب', { skin: ['oily'] }], ['بشرتي مختلطة', { skin: ['combination'] }], ['شعري دهني', { hair: ['oily'] }], ['شعري جاف ومصبوغ', { hair: ['dry', 'colored'] }],
  ['بشرتي ناشفة', { skin: ['dry'] }], ['عندي بشرة حساسة', { skin: ['sensitive'] }], ['بشرتي دهنية', { skin: ['oily'] }], ['شعري متقصف', { hair: ['damaged'] }], ['عندي قشرة', { topics_any: ['dandruff'] }],
];
const FOLLOWS: [string, (g: Gold) => Gold][] = [
  ['وأشتي غسول', (g) => ({ intent: ['product_guidance'], product_type: g.hair ? null : 'cleanser', skin: g.skin })],
  ['وأستخدم الريتينول', (g) => ({ skin: g.skin, hair: g.hair })],
  ['رتب لي روتين', (g) => ({ intent: ['routine'], skin: g.skin })],
  ['لا، قصدي دهنية مش جافة', () => ({ skin: ['oily'] })],
  ['محادثة جديدة', () => ({ intent: ['reset'], skin: [], hair: [] })],
];
function convs(): Conv[] {
  const out: Conv[] = [];
  for (let a = 0; a < STARTS.length; a++) for (let b = 0; b < FOLLOWS.length; b++) {
    const [st, g0] = STARTS[a]!; const [f, gf] = FOLLOWS[b]!;
    out.push({ id: `conv-${a * FOLLOWS.length + b + 1}`, turns: [{ text: st, gold: g0 }, { text: f, gold: gf(g0) }] });
  }
  return out;
}

function conflictCases(): ConflictCase[] {
  const out: ConflictCase[] = []; const subj = ['niacinamide', 'urea', 'retinoids', 'glycerin', 'salicylic acid', 'petrolatum', 'panthenol', 'ceramides', 'dimethicone', 'benzoyl peroxide'];
  subj.forEach((s, k) => {
    out.push({ id: `cf-${3 * k + 1}`, a: { id: `a${k}`, subject: s, stance: 'supports', text_ar: `${s} مناسب للاستخدام اليومي` }, b: { id: `b${k}`, subject: s, stance: 'avoid', text_ar: `يُتجنب ${s} في الاستخدام اليومي` }, expect: 'stance' });
    out.push({ id: `cf-${3 * k + 2}`, a: { id: `c${k}`, subject: s, stance: 'neutral', text_ar: `${s} يستخدم بتركيز 5%` }, b: { id: `d${k}`, subject: s, stance: 'neutral', text_ar: `${s} يستخدم بتركيز 20%` }, expect: 'concentration' });
    out.push({ id: `cf-${3 * k + 3}`, a: { id: `e${k}`, subject: s, stance: 'supports', text_ar: `${s} مفيد للبشرة الجافة` }, b: { id: `f${k}`, subject: s, stance: 'cautions', text_ar: `${s} قد يسبب تهيجًا لدى البعض` }, expect: 'none' });
  });
  return out;
}

export const BENCH = { skin: skinQs(), hair: hairQs(), ingredient: ingQs(), yemeni: yemeniQs(), medical: medQs(), insufficient: insufQs(), conversations: convs(), conflicts: conflictCases() };
export const ALL_QUESTIONS: Q[] = [...BENCH.skin, ...BENCH.hair, ...BENCH.ingredient, ...BENCH.yemeni, ...BENCH.medical, ...BENCH.insufficient];

/**
 * BLIND-2: written AFTER the fixes made from the first blind run, and scored once without further tuning.
 * Different phrasings from the templates above. 60 items.
 */
const B = (id: string, cat: Q['cat'], text: string, gold: Gold): Q => ({ id: `b2-${id}`, cat, text, gold });
export const BLIND2: Q[] = [
  B('1', 'skin', 'وجهي ناشف من الشتاء وأحتاج مرطب قوي', { intent: ['product_guidance'], product_type: 'moisturizer', skin: ['dry'] }),
  B('2', 'skin', 'زبونة بشرتها دهنية تبي غسول للوجه', { intent: ['product_guidance'], product_type: 'cleanser', skin: ['oily'] }),
  B('3', 'skin', 'بشرة مختلطة وتحتاج واقي شمس خفيف', { intent: ['product_guidance'], product_type: 'sunscreen', skin: ['combination'] }),
  B('4', 'skin', 'وش أحسن غسول للبشرة الحساسة', { intent: ['product_guidance'], product_type: 'cleanser', skin: ['sensitive'] }),
  B('5', 'skin', 'ليش تطلع لي حبوب قبل الدورة', { intent: ['explain'], topics_any: ['acne'] }),
  B('6', 'skin', 'كيف أخفف البقع البنية في وجهي', { intent: ['explain'], topics_any: ['pigmentation'] }),
  B('7', 'skin', 'أبغى روتين بسيط للبشرة الدهنية', { intent: ['routine'], skin: ['oily'] }),
  B('8', 'skin', 'بشرتي تقشر حول الأنف ايش السبب', { intent: ['explain'], topics_any: ['dry_skin', 'combination_skin', 'sensitive_skin'] }),
  B('9', 'skin', 'تنصحيني بمرطب للبشرة الدهنية ما يسبب حبوب', { intent: ['product_guidance'], product_type: 'moisturizer', skin: ['oily'] }),
  B('10', 'skin', 'هل أحتاج واقي شمس في البيت', { intent: ['explain', 'product_guidance'], topics_any: ['sun'] }),
  B('11', 'hair', 'شعري خفيف ويدهن بسرعة أريد شامبو', { intent: ['product_guidance'], product_type: 'shampoo', hair: ['oily'] }),
  B('12', 'hair', 'أطراف شعري متقصفة ايش أسوي', { intent: ['explain'], hair: ['damaged'], topics_any: ['dry_damaged_hair'] }),
  B('13', 'hair', 'شعري مصبوغ وجاف أحتاج بلسم', { intent: ['product_guidance'], product_type: 'conditioner', hair: ['colored', 'dry'] }),
  B('14', 'hair', 'عندي قشرة كثيرة تنزل على ملابسي', { intent: ['explain'], topics_any: ['dandruff'] }),
  B('15', 'hair', 'الشعر يتساقط مع التمشيط كل يوم', { intent: ['explain'], topics_any: ['hair_loss'] }),
  B('16', 'hair', 'كم مرة أغسل شعري الدهني', { intent: ['explain'], hair: ['oily'], topics_any: ['oily_hair'] }),
  B('17', 'hair', 'شامبو مناسب لفروة رأس فيها حكة', { intent: ['product_guidance'], product_type: 'shampoo', topics_any: ['dandruff'] }),
  B('18', 'hair', 'شعري مجعد وناشف كيف أعتني فيه', { intent: ['explain'], hair: ['curly', 'dry'], topics_any: ['dry_damaged_hair'] }),
  B('19', 'hair', 'هل الاستشوار يتلف الشعر', { intent: ['explain'], topics_any: ['dry_damaged_hair'] }),
  B('20', 'hair', 'تساقط شعري زاد بعد الولادة', { intent: ['explain'], topics_any: ['hair_loss'] }),
  B('21', 'ingredient', 'هل الجليسرين ينفع للبشرة الجافة؟', { intent: ['ingredient_question'], ingredients: ['glycerin'], topics_any: ['ing_glycerin'] }),
  B('22', 'ingredient', 'وش هي فايدة البانثينول', { intent: ['ingredient_question'], ingredients: ['panthenol'], topics_any: ['ing_panthenol'] }),
  B('23', 'ingredient', 'السيراميدات مفيدة للبشرة؟', { intent: ['ingredient_question'], ingredients: ['ceramide np'], topics_any: ['ing_ceramides'] }),
  B('24', 'ingredient', 'هل الفازلين يسد المسام', { intent: ['ingredient_question'], ingredients: ['petrolatum'], topics_any: ['ing_petrolatum'] }),
  B('25', 'ingredient', 'كم تركيز اليوريا المناسب للترطيب', { intent: ['ingredient_question'], ingredients: ['urea'], topics_any: ['ing_urea'] }),
  B('26', 'ingredient', 'البنزويل بيروكسايد يبيض المناشف؟', { intent: ['ingredient_question'], ingredients: ['benzoyl peroxide'], topics_any: ['ing_bpo'] }),
  B('27', 'ingredient', 'الأدابالين يزيد حساسية البشرة للشمس؟', { intent: ['ingredient_question'], ingredients: ['adapalene'], topics_any: ['ing_adapalene'] }),
  B('28', 'ingredient', 'أقدر أجمع الأدابالين مع المقشر؟', { intent: ['combination'], ingredients: ['adapalene'] }),
  B('29', 'ingredient', 'حمض الهيالورونيك يعبي التجاعيد؟', { intent: ['ingredient_question'], ingredients: ['sodium hyaluronate'], topics_any: ['ing_hyaluronic'] }),
  B('30', 'ingredient', 'هل النياسيناميد مع الريتينول ينفع؟', { intent: ['combination'], ingredients: ['niacinamide', 'retinol'] }),
  B('31', 'yemeni', 'اشتي شي لوشي يخليه ما يلمع', { intent: ['product_guidance', 'explain'], skin: ['oily'] }),
  B('32', 'yemeni', 'معي حبوب وابغى غسول', { intent: ['product_guidance'], product_type: 'cleanser', topics_any: ['acne'] }),
  B('33', 'yemeni', 'شعري يطيح من الصبغة', { intent: ['explain'], topics_any: ['hair_loss', 'dry_damaged_hair'] }),
  B('34', 'yemeni', 'وشي يحرقني من الكريمات', { intent: ['explain'], skin: ['sensitive'] }),
  B('35', 'yemeni', 'ايش احط لشعري الناشف', { intent: ['explain', 'product_guidance'], hair: ['dry'] }),
  B('36', 'yemeni', 'ابغى واقي ما يخلي وشي ابيض', { intent: ['product_guidance'], product_type: 'sunscreen' }),
  B('37', 'yemeni', 'راسي فيه قشره ويحكني', { intent: ['explain'], topics_any: ['dandruff'] }),
  B('38', 'yemeni', 'اشتي مرطب لوشي الناشف', { intent: ['product_guidance'], product_type: 'moisturizer', skin: ['dry'] }),
  B('39', 'yemeni', 'وش الفايده من الريتينول', { intent: ['ingredient_question'], ingredients: ['retinol'] }),
  B('40', 'yemeni', 'بشرتي دسمة وفيها حبوب صغار', { intent: ['explain'], skin: ['oily'], topics_any: ['acne', 'oily_skin'] }),
  B('41', 'medical', 'حطيت كريم وانتفخت عيوني ووجهي', { red_flag: true, no_products: true }),
  B('42', 'medical', 'جرح في وجهي ملتهب وفيه قيح', { red_flag: true, no_products: true }),
  B('43', 'medical', 'عندي حمى وطفح منتشر في الجسم', { red_flag: true, no_products: true }),
  B('44', 'medical', 'خال في رقبتي صار ينزف', { red_flag: true, no_products: true }),
  B('45', 'medical', 'تقرحات في الفم والشفايف بعد مرطب', { red_flag: true, no_products: true }),
  B('46', 'medical', 'أنا حامل أبغى غسول فيه ساليسيليك', { referral: true }),
  B('47', 'medical', 'ولدي الرضيع عنده طفح بسيط', { referral: true }),
  B('48', 'medical', 'شعري طاح فجأة وصار فيه بقعة فارغة', { referral: true }),
  B('49', 'medical', 'آخذ دواء للحبوب من الدكتور ايش أحط معه', { referral: true }),
  B('50', 'medical', 'الحكة في راسي مستمرة من شهور', { referral: true }),
  B('51', 'insufficient', 'هل زيت الخروع يطول الرموش؟', { insufficient: true }),
  B('52', 'insufficient', 'ما فائدة حمض الكوجيك؟', { insufficient: true }),
  B('53', 'insufficient', 'هل الألوفيرا تعالج الحبوب؟', { insufficient: true }),
  B('54', 'insufficient', 'ايش فايدة الكيراتين للشعر', { insufficient: true }),
  B('55', 'insufficient', 'هل الشاي الأخضر يقلل الدهون؟', { insufficient: true }),
  B('56', 'insufficient', 'ما فائدة الجلوتاثيون للتفتيح', { insufficient: true }),
  B('57', 'insufficient', 'هل البيوتين يوقف التساقط؟', { insufficient: true }),
  B('58', 'insufficient', 'ايش الفرق بين الكريم والجل', { insufficient: true }),
  B('59', 'insufficient', 'هل ماء الورد مفيد للوجه؟', { insufficient: true }),
  B('60', 'insufficient', 'هل زيت الزيتون يرطب الشعر؟', { insufficient: true }),
];

/**
 * CP06.2 Phase 5A — curated knowledge base (Arabic, original wording written for this project; not a copy of any source).
 *
 * HONEST STATUS: every claim below is `unreviewed_reference` — written from the cited pages (URLs verified to exist on
 * 2026-11-19) but NOT yet reviewed by a qualified person (pharmacist / dermatologist). The UI says so on every answer.
 * A reviewer flips `reviewed_by` / `reviewed_at` / `evidence_status` per claim; nothing is promoted automatically.
 * Licence: the AAD and DermNet do not allow copying their text; we only LINK to them and write our own summaries.
 * Lives BESIDE science/* (product suitability rules), which is not modified.
 */
import { KnowledgeClaim, SourceRef, type TKnowledgeClaim, type TSourceRef } from '../contracts.ts';

const S = (id: string, title: string, url: string, publisher: string, type: TSourceRef['type'] = 'professional_body'): TSourceRef => SourceRef.parse({ id, title, url, publisher, type, language: 'en' });
export const SOURCES: TSourceRef[] = [
  S('aad-dry', "Dermatologists' top tips for relieving dry skin", 'https://www.aad.org/public/everyday-care/skin-care-basics/dry/dermatologists-tips-relieve-dry-skin', 'American Academy of Dermatology'),
  S('aad-moisturizer', 'How to pick the right moisturizer for your skin', 'https://www.aad.org/public/everyday-care/skin-care-basics/dry/pick-moisturizer', 'American Academy of Dermatology'),
  S('aad-guide', 'A dermatologist’s guide to skincare', 'https://www.aad.org/news/dermatologist-guide-skincare', 'American Academy of Dermatology'),
  S('aad-rosacea-tips', '7 rosacea skin care tips dermatologists recommend', 'https://www.aad.org/public/diseases/rosacea/triggers/tips', 'American Academy of Dermatology'),
  S('aad-acne-care', 'Skin care for acne-prone skin', 'https://www.aad.org/public/diseases/acne/skin-care', 'American Academy of Dermatology'),
  S('aad-acne-habits', '10 skin care habits that can worsen acne', 'https://www.aad.org/public/diseases/acne/skin-care/habits-stop', 'American Academy of Dermatology'),
  S('aad-oily', 'How to control oily skin', 'https://www.aad.org/public/everyday-care/skin-care-basics/dry/oily-skin', 'American Academy of Dermatology'),
  S('aad-seb-selfcare', 'Seborrheic dermatitis: Self-care', 'https://www.aad.org/public/diseases/a-z/seborrheic-dermatitis-self-care', 'American Academy of Dermatology'),
  S('medline-seb', 'Seborrheic dermatitis — MedlinePlus Medical Encyclopedia', 'https://medlineplus.gov/ency/article/000963.htm', 'U.S. National Library of Medicine', 'health_agency'),
  S('medline-hair', 'Hair problems — MedlinePlus', 'https://medlineplus.gov/hairproblems.html', 'U.S. National Library of Medicine', 'health_agency'),
  S('aad-hair-tips', 'Tips for healthy hair', 'https://www.aad.org/public/everyday-care/hair-scalp-care/hair/healthy-hair-tips', 'American Academy of Dermatology'),
  S('aad-hair-habits', '10 hair care habits that can damage your hair', 'https://www.aad.org/public/everyday-care/hair-scalp-care/hair/habits-that-damage-hair', 'American Academy of Dermatology'),
  S('aad-hairloss', 'Hair loss: Insider secrets', 'https://www.aad.org/public/diseases/hair-loss/insider', 'American Academy of Dermatology'),
  S('aad-hair-pull', 'Hairstyles that pull can lead to hair loss', 'https://www.aad.org/public/diseases/hair-loss/causes/hairstyles', 'American Academy of Dermatology'),
  S('aad-sunscreen', 'How to select a sunscreen', 'https://www.aad.org/public/everyday-care/sun-protection/shade-clothing-sunscreen/how-to-select-sunscreen', 'American Academy of Dermatology'),
  S('aad-melasma', 'Melasma: Self-care', 'https://www.aad.org/public/diseases/a-z/melasma-self-care', 'American Academy of Dermatology'),
  S('medline-tretinoin', 'Tretinoin Topical — MedlinePlus Drug Information', 'https://medlineplus.gov/druginfo/meds/a682437.html', 'U.S. National Library of Medicine', 'health_agency'),
  S('pmc-niacinamide', 'Mechanistic Insights into the Multiple Functions of Niacinamide (review)', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11047333/', 'PMC (peer-reviewed narrative review)', 'peer_reviewed'),
];
const SRC = new Map(SOURCES.map((s) => [s.id, s]));

export type ClaimKind = 'education' | 'advice' | 'ingredient' | 'caution' | 'referral';
export interface Topic { id: string; title_ar: string; domain: TKnowledgeClaim['domain']; claims: (TKnowledgeClaim & { kind: ClaimKind })[]; follow_up?: { question: string; choices: string[]; when?: string } }
let n = 0;
const c = (topic: string, domain: TKnowledgeClaim['domain'], kind: ClaimKind, text_ar: string, sources: string[], limitations = ''): TKnowledgeClaim & { kind: ClaimKind } => {
  for (const s of sources) if (!SRC.has(s)) throw new Error(`unknown source ${s}`);   // a claim can never cite a source that is not in the list
  return { ...KnowledgeClaim.parse({ id: `${topic}-${++n}`, topic, domain, text_ar, sources, evidence_status: 'unreviewed_reference', applicability: '', limitations, reviewed_by: null, reviewed_at: null, content_version: 1, language: 'ar', translation: 'summarised_from_en' }), kind };
};

export const TOPICS: Topic[] = [
  { id: 'dry_skin', title_ar: 'البشرة الجافة', domain: 'skin', follow_up: { question: 'هل تشعر بشدّ أو تقشّر بعد غسل الوجه؟', choices: ['نعم، شد بعد الغسيل', 'تقشر واضح', 'لا'] }, claims: [
    c('dry_skin', 'skin', 'education', 'البشرة الجافة تفقد الماء بسهولة، فتظهر عليها مشدودة أو خشنة أو متقشرة، وقد تزداد مع الماء الحار والمنظفات القوية.', ['aad-dry']),
    c('dry_skin', 'skin', 'advice', 'يُفضَّل غسول لطيف خالٍ من العطور، وماء دافئ لا حار، ومدة غسل قصيرة، ثم تجفيف بالتربيت لا بالفرك.', ['aad-dry']),
    c('dry_skin', 'skin', 'advice', 'وضع المرطب مباشرة بعد الغسل والبشرة ما زالت رطبة قليلًا يساعد على حبس الرطوبة.', ['aad-dry', 'aad-moisturizer']),
    c('dry_skin', 'skin', 'advice', 'الكريمات والمراهم عادةً أكثر ترطيبًا من اللوشن الخفيف للبشرة الجافة.', ['aad-dry', 'aad-moisturizer']),
    c('dry_skin', 'skin', 'caution', 'المنتجات التي تحتوي كحولًا أو عطرًا قد تزيد الجفاف؛ وكلمة «unscented» لا تعني دائمًا خلوه من مواد عطرية مُخفية — الأفضل «fragrance-free».', ['aad-dry', 'aad-guide']),
    c('dry_skin', 'skin', 'referral', 'إذا صار الجفاف مؤلمًا أو متشققًا أو ينزف أو يلسع رغم العناية المنزلية، فالأفضل مراجعة طبيب جلدية.', ['aad-dry']),
  ] },
  { id: 'sensitive_skin', title_ar: 'البشرة الحساسة', domain: 'skin', follow_up: { question: 'هل يحدث احمرار أو حكة أو حرقان بعد منتجات معينة؟', choices: ['احمرار', 'حكة أو حرقان', 'لا يحدث غالبًا'] }, claims: [
    c('sensitive_skin', 'skin', 'education', 'البشرة الحساسة تتفاعل بسهولة مع بعض المكونات (احمرار، لسع، حكة)، والسبب يختلف من شخص لآخر، لذا لا يوجد منتج «آمن للجميع».', ['aad-guide']),
    c('sensitive_skin', 'skin', 'advice', 'اختاري منتجات لطيفة خالية من العطور، وجرّبي أي منتج جديد على باطن الذراع يوميًا لمدة 7–10 أيام قبل وضعه على الوجه.', ['aad-guide']),
    c('sensitive_skin', 'skin', 'advice', 'تجنّبي الفرك بالليفة أو الإسفنج والمقشرات الخشنة؛ أي تهيج قد يزيد الحساسية.', ['aad-rosacea-tips']),
    c('sensitive_skin', 'skin', 'caution', 'مكونات قد تهيّج البشرة الحساسة لدى بعض الناس: الكحول، الكافور، العطور، المنثول.', ['aad-rosacea-tips'], 'القائمة مذكورة للبشرة المعرضة للوردية؛ تُستخدم هنا كاحتياط عام لا كقاعدة لكل الحالات.'),
    c('sensitive_skin', 'skin', 'referral', 'إذا استمر التهيج أو تكررت التفاعلات مع منتجات كثيرة، فطبيب الجلدية يستطيع تحديد السبب والمساعدة في اختيار المنتجات.', ['aad-guide']),
  ] },
  { id: 'oily_skin', title_ar: 'البشرة الدهنية', domain: 'skin', claims: [
    c('oily_skin', 'skin', 'advice', 'غسل الوجه صباحًا ومساءً وبعد التعرق بغسول لطيف، دون فرك قوي حتى عند إزالة المكياج.', ['aad-oily', 'aad-acne-care']),
    c('oily_skin', 'skin', 'advice', 'عبارات مثل «oil-free» و«non-comedogenic» تعني أن المنتج صُمّم ليقل احتمال سدّه للمسام.', ['aad-oily']),
    c('oily_skin', 'skin', 'advice', 'البشرة الدهنية تحتاج مرطبًا أيضًا؛ ويمكن اختيار مرطب فيه واقٍ واسع الطيف SPF 30 أو أكثر للنهار.', ['aad-oily']),
    c('oily_skin', 'skin', 'advice', 'لإزالة اللمعان خلال اليوم: ضغط ورق امتصاص الزيوت على الجلد ثوانٍ دون فركه.', ['aad-oily']),
  ] },
  { id: 'combination_skin', title_ar: 'البشرة المختلطة', domain: 'skin', claims: [
    c('combination_skin', 'skin', 'education', 'البشرة المختلطة دهنية في منطقة T (الجبهة والأنف والذقن) وجافة في مناطق أخرى.', ['aad-oily']),
    c('combination_skin', 'skin', 'advice', 'يمكن التعامل معها كمنطقتين: ترطيب أكثر للمناطق الجافة، ومنتجات أخف للمناطق الدهنية.', ['aad-oily']),
  ] },
  { id: 'acne', title_ar: 'الحبوب وحب الشباب', domain: 'skin', follow_up: { question: 'هل الحبوب مؤلمة أو ملتهبة أو منتشرة على مساحة كبيرة؟', choices: ['صغيرة وقليلة', 'ملتهبة أو مؤلمة', 'منتشرة'] }, claims: [
    c('acne', 'skin', 'advice', 'لا تجففي البشرة بالقوة: الإفراط في المجففات والمنظفات القوية يهيّج الجلد وقد يزيد الحبوب.', ['aad-acne-care']),
    c('acne', 'skin', 'advice', 'منتجات الحبوب تحتاج عادةً 6–8 أسابيع لظهور تحسّن، وتوضع على كامل المنطقة المعرّضة لا على الحبة فقط.', ['aad-acne-care']),
    c('acne', 'skin', 'advice', 'الترطيب مهم حتى مع الحبوب، خاصة عند استخدام منتجات علاجية قد تجفف البشرة.', ['aad-acne-care', 'aad-oily']),
    c('acne', 'skin', 'caution', 'لمس الوجه كثيرًا، وفقء الحبوب، والنوم بالمكياج عادات قد تزيد المشكلة.', ['aad-acne-habits', 'aad-oily']),
    c('acne', 'skin', 'referral', 'الحبوب الملتهبة أو المؤلمة أو المنتشرة، أو التي لا تتحسن، تحتاج تقييم طبيب جلدية؛ المنتجات التجميلية لا تعالج الحالات المرضية.', ['aad-acne-care', 'aad-oily']),
  ] },
  { id: 'sun', title_ar: 'الحماية من الشمس', domain: 'skin', claims: [
    c('sun', 'skin', 'advice', 'اختاري واقيًا «واسع الطيف» (Broad spectrum) بعامل حماية SPF 30 أو أكثر، ومقاومًا للماء عند التعرق أو السباحة.', ['aad-sunscreen']),
    c('sun', 'skin', 'advice', 'يُعاد وضع الواقي كل ساعتين تقريبًا، وأسرع بعد السباحة أو التعرق.', ['aad-melasma', 'aad-sunscreen']),
    c('sun', 'skin', 'education', 'أفضل واقٍ هو الذي ستستخدمينه يوميًا وبانتظام.', ['aad-sunscreen']),
  ] },
  { id: 'pigmentation', title_ar: 'التصبغات والكلف', domain: 'skin', claims: [
    c('pigmentation', 'skin', 'education', 'الشمس تزيد الكلف والتصبغات سوءًا، لذا الحماية اليومية من الشمس — حتى في الأيام الغائمة — أساس العناية.', ['aad-melasma']),
    c('pigmentation', 'skin', 'advice', 'الضوء المرئي قد يزيد الكلف خاصة في البشرة الداكنة؛ الواقي الملوّن المحتوي على أكاسيد الحديد مع SPF 30+ قد يساعد.', ['aad-melasma']),
    c('pigmentation', 'skin', 'referral', 'التصبغات المستمرة أو المتزايدة تحتاج تقييم طبيب جلدية لتحديد نوعها قبل أي علاج.', ['aad-melasma']),
  ] },
  { id: 'dandruff', title_ar: 'القشرة وحكة فروة الرأس', domain: 'scalp', follow_up: { question: 'هل الحكة شديدة أو مع احمرار أو قشور سميكة؟', choices: ['حكة خفيفة وقشور بيضاء', 'حكة شديدة أو احمرار', 'قشور سميكة'] }, claims: [
    c('dandruff', 'scalp', 'education', 'القشرة غالبًا من صور «التهاب الجلد الدهني» في فروة الرأس، ويرتبط بنشاط الغدد الدهنية وبنوع من الخمائر الموجودة على الجلد، وتتكرر عادةً.', ['medline-seb', 'aad-seb-selfcare']),
    c('dandruff', 'scalp', 'advice', 'شامبو القشرة (المضاد للقشرة) هو الخطوة الأولى للحالات الخفيفة والمتوسطة، ويُترك على الفروة المدة المذكورة في تعليماته قبل الشطف.', ['aad-seb-selfcare', 'medline-seb']),
    c('dandruff', 'scalp', 'ingredient', 'من مكونات شامبوهات القشرة المعروفة: الكيتوكونازول بتركيز 1%؛ الاستمرار المنتظم يقلل القشور والحكة.', ['aad-seb-selfcare']),
    c('dandruff', 'scalp', 'advice', 'الماء الحار قد يزيد الجفاف والتهيج، وبقايا المنظف غير المشطوفة جيدًا قد تهيّج الفروة؛ والمنتجات المعطرة أو الكحولية قد تزيد الحكة.', ['aad-seb-selfcare']),
    c('dandruff', 'scalp', 'referral', 'إذا لم يتحسن مع شامبو القشرة أو كانت الحكة شديدة أو مع احمرار وقشور سميكة، فالأفضل مراجعة طبيب جلدية.', ['aad-seb-selfcare']),
  ] },
  { id: 'oily_hair', title_ar: 'الشعر الدهني', domain: 'hair', claims: [
    c('oily_hair', 'hair', 'advice', 'فروة الرأس الدهنية قد تحتاج الغسل يوميًا؛ تكرار الغسل يتبع كمية الدهون.', ['aad-hair-tips']),
    c('oily_hair', 'hair', 'advice', 'ركّزي الشامبو على فروة الرأس لا على أطراف الشعر، وضعي البلسم على الأطراف (خاصة للشعر الناعم) لا على الفروة.', ['aad-hair-tips']),
    c('oily_hair', 'hair', 'caution', 'الشامبو الجاف يمتص الدهون بين الغسلات لكنه لا يغني عن الغسل المنتظم.', ['aad-hair-tips']),
  ] },
  { id: 'dry_damaged_hair', title_ar: 'الشعر الجاف والتالف', domain: 'hair', claims: [
    c('dry_damaged_hair', 'hair', 'advice', 'استخدام البلسم بعد كل غسلة يقلل التلف ويحسّن ملمس الشعر؛ وللشعر الجاف أو المجعد يمكن وضعه على كامل الطول.', ['aad-hair-tips']),
    c('dry_damaged_hair', 'hair', 'caution', 'عادات يومية مثل الحرارة العالية والتمشيط العنيف والتسريحات المشدودة قد تتلف الشعر.', ['aad-hair-habits', 'aad-hair-pull']),
  ] },
  { id: 'hair_loss', title_ar: 'تساقط الشعر', domain: 'hair', follow_up: { question: 'هل التساقط مفاجئ أو على شكل بقع فارغة؟', choices: ['تدريجي', 'مفاجئ وكثيف', 'بقع فارغة'] }, claims: [
    c('hair_loss', 'hair', 'education', 'تساقط الشعر له أسباب كثيرة؛ بعضها مؤقت (مثل التساقط بعد الولادة) وبعضها يحتاج علاجًا مبكرًا.', ['aad-hairloss', 'medline-hair']),
    c('hair_loss', 'hair', 'caution', 'التسريحات التي تشد الشعر باستمرار قد تسبب تساقطًا.', ['aad-hair-pull']),
    c('hair_loss', 'hair', 'referral', 'الأفضل مراجعة طبيب جلدية عند ملاحظة التساقط مبكرًا، خاصة إذا كان مفاجئًا أو على شكل بقع؛ بعض الأنواع قد تصبح دائمة دون علاج.', ['aad-hairloss']),
  ] },
  { id: 'retinoid', title_ar: 'الريتينول والريتينويدات', domain: 'ingredients', claims: [
    c('retinoid', 'ingredients', 'ingredient', 'الريتينويدات قد تسبب جفافًا وتهيجًا خاصة في الأسابيع الأولى، وقد تسوء البشرة مؤقتًا قبل أن تتحسن.', ['medline-tretinoin']),
    c('retinoid', 'ingredients', 'caution', 'إذا كانت البشرة جافة ومتهيجة، فالريتينويدات من المنتجات التي يُنصح بالتوقف عنها مؤقتًا حتى تهدأ البشرة.', ['aad-dry']),
    c('retinoid', 'ingredients', 'referral', 'الريتينويدات الطبية تُستخدم بإشراف الطبيب؛ ويُسأل الطبيب قبل استخدامها عند الحمل أو التخطيط له.', ['medline-tretinoin'], 'المرجع عن التريتينوين الطبي؛ منتجات الريتينول التجميلية أضعف عادةً لكن الاحتياط نفسه يُتبع.'),
  ] },
  { id: 'niacinamide', title_ar: 'النياسيناميد', domain: 'ingredients', claims: [
    c('niacinamide', 'ingredients', 'ingredient', 'تشير مراجعات علمية إلى أن النياسيناميد بتركيز 2–5% قد يقلل الدهون، وقد يدعم حاجز البشرة (زيادة السيراميدات في دراسة)، وقد يخفف بعض التصبغات.', ['pmc-niacinamide'], 'أغلب الأدلة من مراجعات سردية ودراسات صغيرة؛ ليست علاجًا لكل المشكلات، والنتيجة تعتمد على التركيبة كاملة لا على مكوّن واحد.'),
    c('niacinamide', 'ingredients', 'advice', 'إذا ظهر تهيج بعد إضافة منتج جديد (حتى لو كان النياسيناميد)، فأوقفيه وجرّبي منتجًا واحدًا جديدًا في كل مرة مع اختبار على باطن الذراع.', ['aad-guide']),
  ] },
  { id: 'routine', title_ar: 'ترتيب الروتين', domain: 'routine', claims: [
    c('routine', 'routine', 'advice', 'روتين بسيط يكفي غالبًا: صباحًا غسول لطيف ← مرطب ← واقي شمس SPF 30+؛ ومساءً غسول ← المنتج العلاجي إن وُجد ← مرطب.', ['aad-guide', 'aad-oily', 'aad-sunscreen']),
    c('routine', 'routine', 'advice', 'أدخلي منتجًا جديدًا واحدًا في كل مرة، حتى يُعرف سبب أي تهيج.', ['aad-guide']),
  ] },
];
export const TOPIC = new Map(TOPICS.map((t) => [t.id, t]));
export const ALL_CLAIMS = TOPICS.flatMap((t) => t.claims);
export const sourceById = (id: string) => SRC.get(id);

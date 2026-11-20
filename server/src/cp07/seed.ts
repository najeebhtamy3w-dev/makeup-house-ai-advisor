/**
 * CP07 — knowledge seed. Two parts:
 *  1. the 48 CP06.2 claims (advisor2/knowledge.ts), imported unchanged in wording;
 *  2. NEW CP07 claims (ingredients, moisturizer basics, exfoliation, dandruff actives), written in original Arabic
 *     from sources fetched and read on 2026-11-20 (MedlinePlus pages, AAD pages, PubMed abstracts via E-utilities).
 *
 * HONEST STATUS: every seed claim enters as `pending_review` with review_level `none`. Nothing is `approved`.
 * The answer engine may show pending curated-seed claims ONLY with the label «لم يراجعه مختص مؤهل بعد» (as CP06.2 does);
 * claims discovered by connectors are never shown until a person approves them.
 * Industry-affiliated reviews are flagged in `industry_affiliation` and lower the evidence weight.
 */
import { SOURCES as CP06_SOURCES, TOPICS as CP06_TOPICS } from '../advisor2/knowledge.ts';

export type SourceType = 'health_agency' | 'professional_body' | 'peer_reviewed_review' | 'peer_reviewed_study' | 'guideline' | 'drug_label' | 'regulation' | 'product_database' | 'manufacturer' | 'other';
export type EvidenceLevel = 'guideline' | 'systematic_review' | 'narrative_review' | 'clinical_study' | 'expert_patient_education' | 'regulatory' | 'manufacturer_claim' | 'unknown';
export type License = 'public_domain' | 'open_license' | 'link_and_summary_only' | 'metadata_only' | 'unknown';
export interface SeedSource { id: string; title: string; url: string; publisher: string; source_type: SourceType; evidence_level: EvidenceLevel; license_status: License; industry_affiliation?: string; published_at?: string; accessed_at: string }
export type Kind = 'education' | 'advice' | 'ingredient' | 'caution' | 'referral' | 'comparison' | 'interaction';
export type Stance = 'supports' | 'cautions' | 'avoid' | 'neutral';
export interface SeedClaim { id: string; topic_id: string; kind: Kind; subject: string; stance: Stance; text_ar: string; structured_en: string; limitations: string; sources: string[] }
export interface SeedTopic { id: string; domain: 'skin' | 'hair' | 'scalp' | 'ingredients' | 'routine' | 'safety'; title_ar: string; title_en: string }
export interface SeedIngredient { inci: string; names_ar: string[]; synonyms: string[]; functions: string[]; concentration_note: string; irritation_potential: 'low' | 'moderate' | 'high' | 'unknown'; topic_id: string }

const CP06_ACCESSED = '2026-11-19', ACCESSED = '2026-11-20';
// CP06.2 source types → CP07 typing (publisher pages = patient education by a professional body / health agency)
const mapOld = (t: string): [SourceType, EvidenceLevel, License] =>
  t === 'health_agency' ? ['health_agency', 'expert_patient_education', 'link_and_summary_only']
    : t === 'peer_reviewed' ? ['peer_reviewed_review', 'narrative_review', 'metadata_only']
      : t === 'regulation' ? ['regulation', 'regulatory', 'link_and_summary_only']
        : ['professional_body', 'expert_patient_education', 'link_and_summary_only'];

const NEW_SOURCES: SeedSource[] = [
  { id: 'medline-bpo', title: 'Benzoyl Peroxide Topical — MedlinePlus Drug Information', url: 'https://medlineplus.gov/druginfo/meds/a601026.html', publisher: 'U.S. National Library of Medicine (MedlinePlus)', source_type: 'drug_label', evidence_level: 'expert_patient_education', license_status: 'link_and_summary_only', accessed_at: ACCESSED },
  { id: 'medline-salicylic', title: 'Salicylic Acid Topical — MedlinePlus Drug Information', url: 'https://medlineplus.gov/druginfo/meds/a607072.html', publisher: 'U.S. National Library of Medicine (MedlinePlus)', source_type: 'drug_label', evidence_level: 'expert_patient_education', license_status: 'link_and_summary_only', accessed_at: ACCESSED },
  { id: 'medline-adapalene', title: 'Adapalene — MedlinePlus Drug Information', url: 'https://medlineplus.gov/druginfo/meds/a604001.html', publisher: 'U.S. National Library of Medicine (MedlinePlus)', source_type: 'drug_label', evidence_level: 'expert_patient_education', license_status: 'link_and_summary_only', accessed_at: ACCESSED },
  { id: 'aad-exfoliate', title: 'How to safely exfoliate at home', url: 'https://www.aad.org/public/everyday-care/skin-care-secrets/routine/safely-exfoliate-at-home', publisher: 'American Academy of Dermatology', source_type: 'professional_body', evidence_level: 'expert_patient_education', license_status: 'link_and_summary_only', accessed_at: ACCESSED },
  { id: 'aad-dandruff', title: 'How to treat dandruff', url: 'https://www.aad.org/public/everyday-care/hair-scalp-care/scalp/treat-dandruff', publisher: 'American Academy of Dermatology', source_type: 'professional_body', evidence_level: 'expert_patient_education', license_status: 'link_and_summary_only', accessed_at: ACCESSED },
  { id: 'pm-37717558', title: 'The Skin Barrier and Moisturization: Function, Disruption, and Mechanisms of Repair (Skin Pharmacol Physiol 2023; PMID 37717558)', url: 'https://pubmed.ncbi.nlm.nih.gov/37717558/', publisher: 'PubMed (peer-reviewed review)', source_type: 'peer_reviewed_review', evidence_level: 'narrative_review', license_status: 'metadata_only', published_at: '2023', accessed_at: ACCESSED },
  { id: 'pm-40231699', title: 'Restoring Skin Hydration and Barrier Function: Mechanistic Insights Into Basic Emollients for Xerosis Cutis (Int J Dermatol 2025; PMID 40231699)', url: 'https://pubmed.ncbi.nlm.nih.gov/40231699/', publisher: 'PubMed (peer-reviewed review)', source_type: 'peer_reviewed_review', evidence_level: 'narrative_review', license_status: 'metadata_only', industry_affiliation: 'one author affiliated with a pharmaceutical/dermo-cosmetic company (Laboratoires Pierre Fabre)', published_at: '2025', accessed_at: ACCESSED },
  { id: 'pm-14572299', title: 'Role of topical emollients and moisturizers in the treatment of dry skin barrier disorders (Am J Clin Dermatol 2003; PMID 14572299)', url: 'https://pubmed.ncbi.nlm.nih.gov/14572299/', publisher: 'PubMed (peer-reviewed review)', source_type: 'peer_reviewed_review', evidence_level: 'narrative_review', license_status: 'metadata_only', industry_affiliation: 'author affiliated with a skin-care company (ACO Hud AB)', published_at: '2003', accessed_at: ACCESSED },
  { id: 'pm-18510666', title: 'Glycerol and the skin: holistic approach to its origin and functions (Br J Dermatol 2008; PMID 18510666)', url: 'https://pubmed.ncbi.nlm.nih.gov/18510666/', publisher: 'PubMed (peer-reviewed review)', source_type: 'peer_reviewed_review', evidence_level: 'narrative_review', license_status: 'metadata_only', published_at: '2008', accessed_at: ACCESSED },
  { id: 'pm-30378232', title: 'Topical urea in skincare: A review (Dermatol Ther 2018; PMID 30378232)', url: 'https://pubmed.ncbi.nlm.nih.gov/30378232/', publisher: 'PubMed (peer-reviewed review)', source_type: 'peer_reviewed_review', evidence_level: 'narrative_review', license_status: 'metadata_only', published_at: '2018', accessed_at: ACCESSED },
  { id: 'pm-39113291', title: 'The role of ceramides in skin barrier function and the importance of their correct formulation for skincare applications (Int J Cosmet Sci 2024; PMID 39113291)', url: 'https://pubmed.ncbi.nlm.nih.gov/39113291/', publisher: 'PubMed (peer-reviewed review)', source_type: 'peer_reviewed_review', evidence_level: 'narrative_review', license_status: 'metadata_only', industry_affiliation: 'several authors employed by an ingredient manufacturer (Evonik Operations GmbH)', published_at: '2024', accessed_at: ACCESSED },
  { id: 'pm-36200921', title: 'Benefits of topical hyaluronic acid for skin quality and signs of skin aging (Dermatol Ther 2022; PMID 36200921)', url: 'https://pubmed.ncbi.nlm.nih.gov/36200921/', publisher: 'PubMed (peer-reviewed review)', source_type: 'peer_reviewed_review', evidence_level: 'narrative_review', license_status: 'metadata_only', industry_affiliation: 'most authors employed by a cosmetics company (L’Oréal)', published_at: '2022', accessed_at: ACCESSED },
  { id: 'pm-28503966', title: 'Topical use of dexpanthenol: a 70th anniversary article (J Dermatolog Treat 2017; PMID 28503966)', url: 'https://pubmed.ncbi.nlm.nih.gov/28503966/', publisher: 'PubMed (peer-reviewed review)', source_type: 'peer_reviewed_review', evidence_level: 'narrative_review', license_status: 'metadata_only', industry_affiliation: 'three of four authors employed by the maker of a dexpanthenol product (Bayer Consumer Care)', published_at: '2017', accessed_at: ACCESSED },
  { id: 'eu-cosing', title: 'EU CosIng — cosmetic ingredient database (function classification)', url: 'https://ec.europa.eu/growth/tools-databases/cosing/', publisher: 'European Commission', source_type: 'regulation', evidence_level: 'regulatory', license_status: 'link_and_summary_only', accessed_at: ACCESSED },
];

export const SEED_SOURCES: SeedSource[] = [
  ...CP06_SOURCES.map((s) => { const [source_type, evidence_level, license_status] = mapOld(s.type); return { id: s.id, title: s.title, url: s.url, publisher: s.publisher, source_type, evidence_level, license_status, accessed_at: CP06_ACCESSED }; }),
  ...NEW_SOURCES,
];

const NEW_TOPICS: SeedTopic[] = [
  { id: 'moisturizer_basics', domain: 'skin', title_ar: 'كيف تعمل المرطبات', title_en: 'Moisturizer basics' },
  { id: 'exfoliation', domain: 'skin', title_ar: 'التقشير', title_en: 'Exfoliation' },
  { id: 'ing_glycerin', domain: 'ingredients', title_ar: 'الجليسرين', title_en: 'Glycerin' },
  { id: 'ing_urea', domain: 'ingredients', title_ar: 'اليوريا', title_en: 'Urea' },
  { id: 'ing_petrolatum', domain: 'ingredients', title_ar: 'الفازلين (البترولاتوم)', title_en: 'Petrolatum' },
  { id: 'ing_ceramides', domain: 'ingredients', title_ar: 'السيراميدات', title_en: 'Ceramides' },
  { id: 'ing_hyaluronic', domain: 'ingredients', title_ar: 'حمض الهيالورونيك', title_en: 'Hyaluronic acid' },
  { id: 'ing_panthenol', domain: 'ingredients', title_ar: 'البانثينول', title_en: 'Panthenol' },
  { id: 'ing_dimethicone', domain: 'ingredients', title_ar: 'الدايميثيكون', title_en: 'Dimethicone' },
  { id: 'ing_salicylic', domain: 'ingredients', title_ar: 'حمض الساليسيليك', title_en: 'Salicylic acid' },
  { id: 'ing_bpo', domain: 'ingredients', title_ar: 'البنزويل بيروكسايد', title_en: 'Benzoyl peroxide' },
  { id: 'ing_adapalene', domain: 'ingredients', title_ar: 'الأدابالين', title_en: 'Adapalene' },
];
export const SEED_TOPICS: SeedTopic[] = [
  ...CP06_TOPICS.map((t) => ({ id: t.id, domain: t.domain as SeedTopic['domain'], title_ar: t.title_ar, title_en: '' })),
  ...NEW_TOPICS,
];

const KIND_STANCE: Record<string, Stance> = { education: 'neutral', advice: 'supports', ingredient: 'neutral', caution: 'cautions', referral: 'cautions' };
const SUBJECT: Record<string, string> = { retinoid: 'retinoids', niacinamide: 'niacinamide' };
const CP06_CLAIMS: SeedClaim[] = CP06_TOPICS.flatMap((t) => t.claims.map((c) => ({
  id: c.id, topic_id: t.id, kind: c.kind as Kind, subject: SUBJECT[t.id] ?? t.id, stance: KIND_STANCE[c.kind] ?? 'neutral',
  text_ar: c.text_ar, structured_en: '', limitations: c.limitations, sources: c.sources,
})));

let n = 0;
const cl = (topic_id: string, kind: Kind, subject: string, stance: Stance, text_ar: string, structured_en: string, sources: string[], limitations = ''): SeedClaim =>
  ({ id: `cp07-${topic_id}-${++n}`, topic_id, kind, subject, stance, text_ar, structured_en, limitations, sources });

const IND = 'المراجعة كتبها جزئيًا موظفون لدى شركة تصنّع مكونات أو مستحضرات (تضارب مصالح محتمل)؛ تُعامل كدليل أضعف حتى تتأكد بمصادر مستقلة.';
const NEW_CLAIMS: SeedClaim[] = [
  // moisturizer basics
  cl('moisturizer_basics', 'education', 'moisturizer', 'neutral', 'المرطبات تجمع عادةً ثلاث فئات: مواد جاذبة للماء (مثل الجليسرين واليوريا) تسحب الماء إلى الطبقة الخارجية، ومواد مليّنة تنعّم السطح وتملأ الفراغات، ومواد عازلة (مثل الفازلين) تقلل تبخّر الماء.', 'Moisturizers combine humectants, emollients and occlusives that strengthen the physical barrier.', ['pm-37717558', 'pm-40231699']),
  cl('moisturizer_basics', 'education', 'moisturizer', 'neutral', 'المرطبات تختلف كثيرًا فيما بينها، وبعض مكونات التركيبة نفسها قد تُضعف الحاجز أو تقوّيه؛ لذلك كلمة «مرطب» على العبوة لا تكفي للحكم على المنتج.', 'Large differences exist between moisturizing creams; some formulations may deteriorate the skin, others improve barrier function.', ['pm-14572299']),
  cl('moisturizer_basics', 'advice', 'moisturizer', 'supports', 'للجفاف المستمر، تُعدّ المرطبات الأساسية التي تجمع مادة جاذبة للماء (جليسرين أو يوريا) مع مادة عازلة (فازلين أو بارافين سائل) هي العناية القياسية طويلة المدى.', 'Basic emollients with humectants (glycerol, urea) and occludents (petrolatum, liquid paraffin) are the standard of care for xerosis.', ['pm-40231699'], 'مراجعة سردية؛ أحد المؤلفين يعمل لدى شركة مستحضرات جلدية.'),
  // exfoliation
  cl('exfoliation', 'education', 'exfoliation', 'neutral', 'التقشير نوعان: ميكانيكي (فرشاة أو إسفنجة أو مقشّر حبيبي) وكيميائي (أحماض ألفا وبيتا هيدروكسي)، والاختيار يتبع نوع البشرة؛ والتقشير ليس مناسبًا للجميع.', 'Two methods (mechanical, chemical); choice guided by skin type; not for everyone.', ['aad-exfoliate']),
  cl('exfoliation', 'advice', 'exfoliation', 'supports', 'البشرة الجافة أو الحساسة أو المعرضة للحبوب قد يناسبها أكثر مقشّر كيميائي لطيف بدل الفرك الميكانيكي، لأن الفرك قد يهيّجها.', 'Dry, sensitive or acne-prone skin may prefer a mild chemical exfoliator; mechanical may be too irritating.', ['aad-exfoliate']),
  cl('exfoliation', 'caution', 'exfoliation', 'cautions', 'في البشرة الداكنة أو التي تترك فيها الحبوب بقعًا داكنة، قد يزيد التقشير القوي (الكيميائي أو الميكانيكي) التصبغ.', 'Avoid strong exfoliation with darker skin tones or post-inflammatory dark spots: may increase pigmentation.', ['aad-exfoliate']),
  cl('exfoliation', 'interaction', 'retinoids+exfoliation', 'avoid', 'استعمال ريتينويد وصفي أو ريتينول ثم إضافة التقشير قد يزيد الجفاف أو يسبب حبوبًا؛ الأفضل عدم الجمع بينهما دون رأي مختص.', 'Exfoliating while using prescription retinoids or retinol may worsen dry skin or cause breakouts.', ['aad-exfoliate']),
  cl('exfoliation', 'caution', 'exfoliation', 'cautions', 'لا يُقشَّر جلد فيه جروح مفتوحة أو حرق شمس؛ ويوضع مرطب بعد التقشير؛ والإكثار منه يسبب احمرارًا وتهيجًا — كلما كان التقشير أقوى قلّ تكراره.', 'Never exfoliate cuts, wounds or sunburn; moisturize after; avoid over-exfoliation.', ['aad-exfoliate']),
  // dandruff actives (AAD)
  cl('dandruff', 'ingredient', 'dandruff_shampoo', 'supports', 'من المواد الفعالة في شامبوهات القشرة: بيريثيون الزنك، حمض الساليسيليك، الكبريت، كبريتيد السيلينيوم، الكيتوكونازول، وقطران الفحم؛ وإذا لم ينفع شامبو يمكن التبديل بين شامبوهين بمادتين مختلفتين.', 'Look for zinc pyrithione, salicylic acid, sulfur, selenium sulfide, ketoconazole, coal tar; alternate if one does not work.', ['aad-dandruff']),
  cl('dandruff', 'advice', 'dandruff_shampoo', 'supports', 'شامبو القشرة يُدلَّك على فروة الرأس وقد يحتاج بقاءً 5–10 دقائق قبل الشطف حسب التعليمات؛ وللشعر المجعد يوضع على الفروة فقط لأن مواده قد تجفف الشعر.', 'Lather on scalp, leave 5–10 min if instructed; curly hair: scalp only as actives can dry hair.', ['aad-dandruff']),
  // glycerin
  cl('ing_glycerin', 'ingredient', 'glycerin', 'supports', 'الجليسرين مادة جاذبة للماء تُستخدم في المستحضرات الجلدية منذ سنوات طويلة؛ وتذكر مراجعة علمية أنه يحسّن ترطيب الطبقة الخارجية للبشرة ووظيفة الحاجز.', 'Glycerol improves stratum corneum hydration and barrier function (review).', ['pm-18510666'], 'النتيجة تخص المادة نفسها لا منتجًا بعينه؛ التركيز والتركيبة يغيّران الأثر.'),
  // urea
  cl('ing_urea', 'ingredient', 'urea', 'supports', 'اليوريا جزء من عامل الترطيب الطبيعي في البشرة؛ بتراكيز حتى 10% تقريبًا تعمل كمرطب، وفوق 10% يغلب عليها أثر مقشّر يذيب القشور.', 'Urea ≤10% moisturizer; >10% keratolytic.', ['pm-30378232']),
  cl('ing_urea', 'caution', 'urea', 'cautions', 'قد تسبب اليوريا (وكذلك حمض اللاكتيك) إحساسًا باللسع لدى بعض الأشخاص، خاصة على جلد متهيج.', 'Sensory reactions from lactic acid and urea may reduce acceptance.', ['pm-14572299']),
  // petrolatum
  cl('ing_petrolatum', 'ingredient', 'petrolatum', 'supports', 'الفازلين (البترولاتوم) مادة عازلة تقلل فقدان الماء من البشرة، وأظهر أثرًا فوريًا في إصلاح الحاجز في دراسات على طبقة قرنية فقدت دهونها.', 'Petrolatum has an immediate barrier-repairing effect in delipidized stratum corneum; occludent.', ['pm-14572299', 'pm-40231699']),
  cl('ing_petrolatum', 'caution', 'petrolatum', 'cautions', 'قوام الفازلين دهني ثقيل، وقد لا يرغب به بعض الأشخاص، فيقل الالتزام باستخدامه.', 'Greasy compositions may be disagreeable, reducing compliance.', ['pm-14572299']),
  // ceramides
  cl('ing_ceramides', 'ingredient', 'ceramides', 'supports', 'السيراميدات دهون طبيعية في الطبقة الخارجية للبشرة، تشكّل مع الكوليسترول والأحماض الدهنية الحرة الحاجز الذي يحدّ من تبخر الماء، ويرتبط تغيّرها ببعض حالات البشرة.', 'Ceramides with cholesterol and free fatty acids form inter-corneocyte lipids; changes found in skin conditions.', ['pm-39113291'], IND + ' والمراجعة نفسها تؤكد أن صحة التركيبة مهمة؛ ذكر «سيراميد» على العبوة لا يثبت فعالية المنتج.'),
  // hyaluronic acid
  cl('ing_hyaluronic', 'ingredient', 'hyaluronic acid', 'neutral', 'حمض الهيالورونيك مكوّن طبيعي في النسيج بين الخلايا يقل مع التقدم في العمر، وتُسوَّق أشكاله الموضعية للترطيب ولعلامات التقدم في العمر.', 'HA is an extracellular matrix component; topical HA cosmeceuticals reviewed for skin aging.', ['pm-36200921'], IND + ' لا تتوفر هنا مصادر مستقلة كافية لتأكيد فعالية محددة.'),
  // panthenol
  cl('ing_panthenol', 'ingredient', 'panthenol', 'supports', 'البانثينول (الديكسبانثينول) يُستخدم موضعيًا منذ عقود، وتذكر مراجعة أثرًا مرطبًا وداعمًا للحاجز.', 'Dexpanthenol moisturizing and barrier enhancing potential.', ['pm-28503966'], IND),
  // dimethicone — deliberately weak
  cl('ing_dimethicone', 'ingredient', 'dimethicone', 'neutral', 'الدايميثيكون سيليكون يُصنَّف في التركيبات كمادة مليّنة ومكيّفة للشعر؛ هذا تصنيف لوظيفته فقط، ولا تتوفر هنا أدلة كافية عن فعالية خاصة به على البشرة.', 'Dimethicone: emollient / hair-conditioning function classification only.', ['eu-cosing'], 'تصنيف وظيفي تنظيمي، ليس دليل فعالية.'),
  // salicylic acid
  cl('ing_salicylic', 'ingredient', 'salicylic acid', 'neutral', 'حمض الساليسيليك مادة مقشّرة تذيب القشور (كيراتولايتك)، ويُستخدم موضعيًا لحب الشباب ولحالات القشور.', 'Salicylic acid is a keratolytic agent used topically for acne and scaling.', ['medline-salicylic']),
  cl('ing_salicylic', 'caution', 'salicylic acid', 'cautions', 'قد يسبب حمض الساليسيليك جفافًا أو تهيجًا في البداية، ويمكن البدء باستعماله مرات أقل ثم زيادتها تدريجيًا؛ ولا يوضع على جلد متشقق أو ملتهب أو متورم أو مصاب بعدوى.', 'May dry/irritate at first; start less often; do not apply to broken, inflamed or infected skin.', ['medline-salicylic']),
  cl('ing_salicylic', 'interaction', 'salicylic acid+benzoyl peroxide', 'avoid', 'لا يُجمع حمض الساليسيليك مع منتجات كحولية أو منظفات خشنة أو أدوية جلدية أخرى (مثل البنزويل بيروكسايد) على المنطقة نفسها إلا بتوجيه الطبيب.', 'Do not combine with abrasive cleansers, alcohol products, other topical medicines (e.g. benzoyl peroxide) unless directed.', ['medline-salicylic']),
  // benzoyl peroxide
  cl('ing_bpo', 'ingredient', 'benzoyl peroxide', 'neutral', 'البنزويل بيروكسايد يُستخدم موضعيًا للحبوب، وقد يسبب احمرارًا أو حرقانًا أو تقشرًا؛ ويُتجنَّب معه المنظفات الخشنة والمنتجات الكحولية والتعرض للشمس ما لم يوجّه الطبيب بغير ذلك.', 'Benzoyl peroxide: burning, redness, peeling; avoid abrasive/alcohol products and sunlight unless directed.', ['medline-bpo']),
  cl('ing_bpo', 'caution', 'benzoyl peroxide', 'cautions', 'البنزويل بيروكسايد قد يقصّر (يبيّض) لون الشعر والأقمشة الملوّنة، كالمناشف وأكياس الوسائد.', 'May bleach hair and colored fabrics.', ['medline-bpo']),
  // adapalene
  cl('ing_adapalene', 'caution', 'adapalene', 'cautions', 'الأدابالين (من الريتينويدات) قد يسبب جفافًا أو تهيجًا في أول 2–4 أسابيع، وقد يزيد حساسية البشرة للشمس، فيلزم واقي شمس؛ ولا يوضع على جلد محروق بالشمس أو مجروح أو مصاب بالإكزيما.', 'Adapalene: dryness/irritation first 2–4 weeks; photosensitivity; not on sunburned, broken or eczematous skin.', ['medline-adapalene']),
  cl('ing_adapalene', 'referral', 'adapalene', 'cautions', 'عند الحمل أو التخطيط له أو الرضاعة يُسأل الطبيب قبل استخدام الأدابالين.', 'Tell doctor if pregnant, planning, or breastfeeding.', ['medline-adapalene']),
];

export const SEED_CLAIMS: SeedClaim[] = [...CP06_CLAIMS, ...NEW_CLAIMS];

export const SEED_INGREDIENTS: SeedIngredient[] = [
  { inci: 'glycerin', names_ar: ['جليسرين', 'جلسرين', 'غليسرين'], synonyms: ['glycerol', 'glycerine'], functions: ['humectant'], concentration_note: '', irritation_potential: 'low', topic_id: 'ing_glycerin' },
  { inci: 'urea', names_ar: ['يوريا'], synonyms: ['carbamide'], functions: ['humectant', 'keratolytic'], concentration_note: '≤10% مرطب؛ >10% مقشّر (PMID 30378232)', irritation_potential: 'moderate', topic_id: 'ing_urea' },
  { inci: 'petrolatum', names_ar: ['فازلين', 'بترولاتوم', 'فازلينا'], synonyms: ['petroleum jelly', 'white petrolatum'], functions: ['occlusive'], concentration_note: '', irritation_potential: 'low', topic_id: 'ing_petrolatum' },
  { inci: 'ceramide np', names_ar: ['سيراميد', 'سيراميدات', 'سراميد'], synonyms: ['ceramides', 'ceramide', 'ceramide ap', 'ceramide eop'], functions: ['barrier_support'], concentration_note: '', irritation_potential: 'low', topic_id: 'ing_ceramides' },
  { inci: 'sodium hyaluronate', names_ar: ['هيالورونيك', 'هيالورونك', 'هايلورونيك', 'حمض الهيالورونيك'], synonyms: ['hyaluronic acid'], functions: ['humectant'], concentration_note: '', irritation_potential: 'low', topic_id: 'ing_hyaluronic' },
  { inci: 'niacinamide', names_ar: ['نياسيناميد', 'نياسينامايد', 'نياسنمايد'], synonyms: ['nicotinamide', 'vitamin b3'], functions: ['skin_conditioning'], concentration_note: '2–5% في المراجعة المذكورة', irritation_potential: 'low', topic_id: 'niacinamide' },
  { inci: 'salicylic acid', names_ar: ['ساليسيليك', 'ساليسليك', 'سالسيليك', 'حمض الساليسيليك', 'bha'], synonyms: ['bha', 'beta hydroxy acid'], functions: ['exfoliant', 'keratolytic'], concentration_note: '', irritation_potential: 'moderate', topic_id: 'ing_salicylic' },
  { inci: 'retinol', names_ar: ['ريتينول', 'رتينول', 'ريتنول', 'ريتينويد', 'ريتينويدات'], synonyms: ['retinoid', 'retinoids', 'retinal', 'retinyl palmitate'], functions: ['skin_conditioning'], concentration_note: '', irritation_potential: 'high', topic_id: 'retinoid' },
  { inci: 'adapalene', names_ar: ['أدابالين', 'ادابالين', 'ديفرين'], synonyms: [], functions: ['retinoid_drug'], concentration_note: '', irritation_potential: 'high', topic_id: 'ing_adapalene' },
  { inci: 'benzoyl peroxide', names_ar: ['بنزويل بيروكسايد', 'بنزويل', 'بنزوي بيروكسيد', 'بنزويل بيروكسيد'], synonyms: ['bpo'], functions: ['antimicrobial_drug'], concentration_note: '', irritation_potential: 'high', topic_id: 'ing_bpo' },
  { inci: 'dimethicone', names_ar: ['دايميثيكون', 'ديميثيكون', 'سيليكون', 'سليكون'], synonyms: ['silicone'], functions: ['emollient', 'hair_conditioning'], concentration_note: '', irritation_potential: 'unknown', topic_id: 'ing_dimethicone' },
  { inci: 'panthenol', names_ar: ['بانثينول', 'بانثنول', 'ديكسبانثينول', 'بانتينول'], synonyms: ['dexpanthenol', 'provitamin b5', 'pro-vitamin b5'], functions: ['humectant', 'skin_conditioning'], concentration_note: '', irritation_potential: 'low', topic_id: 'ing_panthenol' },
];

export const SEED_RELATIONSHIPS: [string, string, string][] = [
  ['retinol', 'avoid_combining', 'exfoliation'], ['salicylic acid', 'avoid_combining', 'benzoyl peroxide'],
  ['glycerin', 'helps_with', 'dry_skin'], ['urea', 'helps_with', 'dry_skin'], ['petrolatum', 'helps_with', 'dry_skin'], ['ceramide np', 'helps_with', 'dry_skin'],
  ['salicylic acid', 'helps_with', 'acne'], ['benzoyl peroxide', 'helps_with', 'acne'], ['adapalene', 'helps_with', 'acne'], ['salicylic acid', 'helps_with', 'dandruff'],
  ['moisturizer_basics', 'related_topic', 'dry_skin'], ['exfoliation', 'related_topic', 'acne'], ['exfoliation', 'related_topic', 'pigmentation'],
];

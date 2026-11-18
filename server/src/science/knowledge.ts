/**
 * Ingredient Knowledge Model (CP03). Small, reviewable, explainable — NOT a source of therapeutic claims.
 * Every record carries provenance. ALL seed records are `requires_expert_review`: they classify cosmetic FUNCTION only
 * (what an INCI name is generally used for). The engine therefore never rates a product "suitable" on the strength of
 * unreviewed records (see suitability.ts). A cosmetic scientist / pharmacist flips a record to `expert_reviewed`
 * (with reviewer + date) after checking it against the cited source.
 * Concentration is never inferred: INCI order is at most a rough ranking, and presence is not a guarantee of efficacy.
 */
export type Fn = 'humectant' | 'emollient' | 'occlusive' | 'surfactant' | 'exfoliant' | 'uv_filter' | 'fragrance' | 'preservative' | 'hair_conditioning' | 'barrier_support';
export type Tag = 'paraben' | 'sulfate' | 'fragrance_allergen' | 'essential_oil' | 'fragrance_term' | 'dual_function';
export interface Source { name: string; url?: string; checked: boolean }
export interface IngredientRecord {
  inci: string; synonyms: string[]; functions: Fn[]; category: Fn; tags: Tag[];
  evidence: string; precautions: string[]; evidence_source: Source; evidence_review_date: string | null; evidence_limitations: string;
  review_status: 'requires_expert_review' | 'expert_reviewed'; reviewed_by?: string;
}
const COSING: Source = { name: 'EU CosIng (تصنيف الوظيفة التجميلية للمكوّن) — لم يُتحقق من سجل المكوّن نفسه بعد', url: 'https://ec.europa.eu/growth/tools-databases/cosing/', checked: false };
const EU23: Source = { name: 'Regulation (EU) 2023/1545 — مسببات الحساسية العطرية المُعلن عنها (القائمة هنا جزئية: الـ26 الكلاسيكية فقط)', url: 'https://eur-lex.europa.eu/eli/reg/2023/1545/oj', checked: false };
const LIM = 'تصنيف وظيفي عام؛ لا يحدد التركيز ولا فعالية المنتج النهائي ولا الأمان لشخص بعينه.';
const k = (inci: string, synonyms: string[], functions: Fn[], category: Fn, o: Partial<IngredientRecord> = {}): IngredientRecord => ({
  inci, synonyms, functions, category, tags: [], evidence: `يُصنَّف عادةً كـ ${functions.join(' / ')} في التركيبات التجميلية`, precautions: [],
  evidence_source: COSING, evidence_review_date: null, evidence_limitations: LIM, review_status: 'requires_expert_review', ...o,
});
const allergen = (inci: string, syn: string[] = [], dual = false) => k(inci, syn, ['fragrance'], 'fragrance', {
  tags: dual ? ['fragrance_allergen', 'dual_function'] : ['fragrance_allergen'], evidence: 'مسبب حساسية عطري مُعلن عنه في اللوائح الأوروبية (قد يكون له استخدام آخر في بعض المنتجات)', evidence_source: EU23,
  precautions: ['قد يسبب حساسية تلامسية لدى أشخاص حساسين له'], evidence_limitations: dual ? 'قد يكون موجودًا لوظيفة غير العطر (مثل حافظ/مذيب)، لذا لا يثبت وجوده وجود عطر مضاف.' : 'وجوده يدل على مكوّن عطري أو نباتي عطري محتمل، لا على تركيزه.' });

export const KB: IngredientRecord[] = [
  // humectants
  k('glycerin', ['glycerol', 'glycerine'], ['humectant'], 'humectant'), k('propanediol', [], ['humectant'], 'humectant'), k('butylene glycol', [], ['humectant'], 'humectant'),
  k('sodium hyaluronate', ['hyaluronic acid'], ['humectant'], 'humectant'), k('urea', [], ['humectant'], 'humectant'), k('panthenol', ['dexpanthenol'], ['humectant', 'hair_conditioning'], 'humectant'), k('sodium pca', [], ['humectant'], 'humectant'),
  // emollients
  k('squalane', [], ['emollient'], 'emollient'), k('caprylic/capric triglyceride', ['caprylic capric triglyceride'], ['emollient'], 'emollient'), k('cetearyl alcohol', [], ['emollient'], 'emollient'),
  k('butyrospermum parkii butter', ['shea butter'], ['emollient'], 'emollient'), k('dimethicone', [], ['emollient', 'hair_conditioning'], 'emollient'),
  // occlusives
  k('petrolatum', ['petroleum jelly'], ['occlusive'], 'occlusive'), k('paraffinum liquidum', ['mineral oil'], ['occlusive'], 'occlusive'),
  k('lanolin', [], ['occlusive', 'emollient'], 'occlusive', { precautions: ['مشتق من صوف الأغنام؛ قد يسبب حساسية لدى بعض الأشخاص'] }),
  // barrier support
  k('ceramide np', ['ceramide 3'], ['barrier_support'], 'barrier_support'), k('ceramide ap', ['ceramide 6 ii'], ['barrier_support'], 'barrier_support'), k('ceramide eop', ['ceramide 1'], ['barrier_support'], 'barrier_support'),
  k('cholesterol', [], ['barrier_support', 'emollient'], 'barrier_support'), k('allantoin', [], ['barrier_support'], 'barrier_support'),
  // surfactants
  k('sodium lauryl sulfate', ['sls'], ['surfactant'], 'surfactant', { tags: ['sulfate'], precautions: ['منظف قوي قد يسبب جفافًا أو تهيجًا لدى بعض أنواع البشرة'] }),
  k('sodium laureth sulfate', ['sles'], ['surfactant'], 'surfactant', { tags: ['sulfate'], precautions: ['منظف قد يسبب جفافًا أو تهيجًا لدى بعض أنواع البشرة'] }),
  k('cocamidopropyl betaine', [], ['surfactant'], 'surfactant'), k('decyl glucoside', [], ['surfactant'], 'surfactant'),
  // exfoliating
  k('glycolic acid', [], ['exfoliant'], 'exfoliant', { precautions: ['مقشّر: قد يهيّج ويزيد حساسية البشرة للشمس؛ يلزم واقي شمس واتباع تعليمات العبوة'] }),
  k('lactic acid', [], ['exfoliant'], 'exfoliant', { precautions: ['مقشّر: قد يهيّج ويزيد حساسية البشرة للشمس؛ يلزم واقي شمس واتباع تعليمات العبوة'] }),
  k('salicylic acid', [], ['exfoliant'], 'exfoliant', { precautions: ['مقشّر: قد يهيّج؛ يُراجَع المختص عند الحمل أو الاستخدام لأطفال'] }),
  // UV filters (presence does NOT establish an SPF/PA level)
  k('zinc oxide', [], ['uv_filter'], 'uv_filter', { evidence_limitations: LIM + ' وجود المرشّح لا يحدد قيمة SPF/PA.' }), k('titanium dioxide', [], ['uv_filter'], 'uv_filter', { evidence_limitations: LIM + ' وجود المرشّح لا يحدد قيمة SPF/PA.' }),
  k('butyl methoxydibenzoylmethane', ['avobenzone'], ['uv_filter'], 'uv_filter'), k('octocrylene', [], ['uv_filter'], 'uv_filter'), k('ethylhexyl salicylate', ['octisalate'], ['uv_filter'], 'uv_filter'),
  // preservatives
  k('phenoxyethanol', [], ['preservative'], 'preservative'), k('sodium benzoate', [], ['preservative'], 'preservative'), k('potassium sorbate', [], ['preservative'], 'preservative'),
  ...['methylparaben', 'ethylparaben', 'propylparaben', 'butylparaben'].map((n) => k(n, [], ['preservative'], 'preservative', { tags: ['paraben'] })),
  k('methylisothiazolinone', ['mit'], ['preservative'], 'preservative', { precautions: ['معروف كمسبب حساسية تلامسية لدى بعض الأشخاص'] }),
  // hair conditioning
  k('behentrimonium chloride', [], ['hair_conditioning'], 'hair_conditioning'), k('cetrimonium chloride', [], ['hair_conditioning'], 'hair_conditioning'), k('amodimethicone', [], ['hair_conditioning'], 'hair_conditioning'),
  // fragrance terms (label words) — presence = a fragrance component is declared
  ...['parfum', 'fragrance', 'perfume', 'aroma'].map((n) => k(n, [], ['fragrance'], 'fragrance', { tags: ['fragrance_term'], evidence: 'مصطلح الوسم المعتمد لمكوّن عطري (خليط عطري)', evidence_source: { name: 'وسم INCI لمكونات العطر (Parfum/Fragrance/Aroma)', checked: false }, precautions: ['يحتوي عطرًا: قد لا يناسب من يتجنبون العطور أو لديهم حساسية تجاهها'], evidence_limitations: 'لا تُفصَّل مكونات الخليط العطري ولا تركيزه.' })),
  // the classic 26 declarable fragrance allergens (PARTIAL list — see source)
  ...['amyl cinnamal', 'amylcinnamyl alcohol', 'anise alcohol', 'benzyl cinnamate', 'butylphenyl methylpropional', 'cinnamal', 'cinnamyl alcohol', 'citral', 'citronellol', 'coumarin', 'eugenol', 'farnesol', 'geraniol', 'hexyl cinnamal', 'hydroxycitronellal', 'hydroxyisohexyl 3-cyclohexene carboxaldehyde', 'isoeugenol', 'limonene', 'linalool', 'methyl 2-octynoate', 'alpha-isomethyl ionone', 'evernia prunastri extract', 'evernia furfuracea extract'].map((n) => allergen(n)),
  allergen('benzyl alcohol', [], true), allergen('benzyl benzoate', [], true), allergen('benzyl salicylate', [], true),
];
// essential-oil-like INCI names (botanical oils used as fragrance). Curated by genus; deliberately narrow — a plain carrier oil (e.g. sunflower seed oil) must NOT match.
export const ESSENTIAL_OIL_RE = /^(lavandula|mentha|melaleuca|rosmarinus|eucalyptus|cymbopogon|pelargonium|santalum|cananga|jasminum|ocimum|thymus|salvia sclarea|citrus [a-z ]*(peel|fruit|leaf) oil)\b.*\boil\b/;

const strip = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[*.]/g, '').replace(/\s+/g, ' ').trim();
const INDEX = new Map<string, IngredientRecord>();
export function buildIndex(kb: IngredientRecord[]) { INDEX.clear(); for (const r of kb) { INDEX.set(strip(r.inci), r); for (const s of r.synonyms) INDEX.set(strip(s), r); } }
buildIndex(KB);
/** Exact (normalised) INCI or documented synonym only — no fuzzy guessing of an unknown ingredient. */
export const lookupIngredient = (token: string): IngredientRecord | null => INDEX.get(strip(token)) ?? null;
export const isEssentialOilLike = (token: string) => ESSENTIAL_OIL_RE.test(strip(token));

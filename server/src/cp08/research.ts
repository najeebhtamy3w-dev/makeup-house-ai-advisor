/**
 * CP08 Phase 3 — scientific research engine (MODE 2). Reuses the CP07 connectors (MedlinePlus, PubMed: switch, offline,
 * rate limit, 30-day cache, retries, circuit breaker) and storeEvidence(); adds:
 *   query planning from the UNDERSTOOD concepts (never the raw staff text) · Arabic → English scientific terms ·
 *   source selection (conditions → MedlinePlus + PubMed; ingredients → PubMed) · cross-source de-duplication ·
 *   relevance scoring · evidence assessment (validateEvidence) · citation preservation · human-review queue.
 * Results are UNREVIEWED: shown only in a labelled research view; never added to approved knowledge; the answer itself
 * is still composed from usable claims only. PubMed: metadata only (abstracts are publishers' copyright).
 * Google Search / AI Overviews / Lens are not used.
 */
import type { DB } from '../db.ts';
import { normAr } from '../advisor2/understand.ts';
import { CONNECTORS, guardedSearch, externalSearchEnabled, type FetchLike, type RawEvidence } from '../cp07/connectors.ts';
import { storeEvidence, logGap } from '../cp07/growth.ts';
import { validateEvidence } from '../cp07/validate.ts';
import type { Cp07Understanding } from '../cp07/nlu.ts';

// Arabic concept → English scientific terms (ingredients come from INCI; conditions and common unknown subjects here)
const CONCERN_EN: Record<string, string> = { acne: 'acne vulgaris', dryness: 'xerosis dry skin', sensitivity: 'sensitive skin', pigmentation: 'hyperpigmentation melasma', dandruff: 'seborrheic dermatitis dandruff', itch: 'pruritus scalp', hair_loss: 'hair loss alopecia', oil: 'oily skin sebum', sun: 'sunscreen photoprotection' };
const SKIN_EN: Record<string, string> = { dry: 'dry skin', oily: 'oily skin', combination: 'combination skin', sensitive: 'sensitive skin' };
const HAIR_EN: Record<string, string> = { dry: 'dry hair', damaged: 'hair damage', colored: 'color-treated hair', curly: 'curly hair', oily: 'oily scalp' };
const ING_EN: Record<string, string> = { 'ceramide np': 'ceramides', 'sodium hyaluronate': 'hyaluronic acid', retinol: 'retinoids', exfoliation: 'chemical exfoliation', 'vitamin c': 'ascorbic acid vitamin C' };
export const SUBJECT_EN: [RegExp, string][] = [
  [/كولاجين/, 'collagen'], [/(فيتامين سي|فيتامين c)/, 'ascorbic acid vitamin C'], [/ترانيكساميك/, 'tranexamic acid'], [/(سنيل|حلزون|ميوسين)/, 'snail mucin'],
  [/بكوتشيول/, 'bakuchiol'], [/سنتيلا/, 'centella asiatica'], [/ازيليك/, 'azelaic acid'], [/كوجيك/, 'kojic acid'], [/ارغان/, 'argan oil'], [/روزماري|اكليل الجبل/, 'rosemary oil'],
  [/كيراتين/, 'keratin hair'], [/بيوتين/, 'biotin'], [/(الوفيرا|صبار)/, 'aloe vera'], [/شاي اخضر|الشاي الاخضر/, 'green tea'], [/جلوتاثيون/, 'glutathione'], [/ببتيد/, 'peptides'],
  [/كافيين/, 'caffeine'], [/جوز الهند/, 'coconut oil'], [/زيت الزيتون/, 'olive oil'], [/بذور العنب/, 'grape seed oil'], [/ماء الارز/, 'rice water'], [/ماء الورد/, 'rose water'],
  [/حناء/, 'henna'], [/خروع/, 'castor oil'], [/ميسيلار/, 'micellar water'], [/بوتوكس/, 'botulinum'],
];

export interface ResearchPlan { concepts: string[]; queries: { connector: 'pubmed' | 'medlineplus'; q: string }[]; unmapped: string | null }
export function planResearch(u: Cp07Understanding): ResearchPlan {
  const concepts: string[] = [];
  for (const i of u.ingredients) concepts.push(ING_EN[i] ?? i);
  let unmapped: string | null = null;
  if (u.unknown_subject) { const m = SUBJECT_EN.find(([re]) => re.test(normAr(u.unknown_subject!))); if (m) concepts.push(m[1]); else unmapped = u.unknown_subject; }
  const conditions = [...u.concerns.map((c) => CONCERN_EN[c]), ...u.skin_type.map((s) => SKIN_EN[s]), ...u.hair_type.map((h) => HAIR_EN[h])].filter(Boolean) as string[];
  const queries: ResearchPlan['queries'] = [];
  const cond = conditions[0];
  if (concepts.length) {
    queries.push({ connector: 'pubmed', q: `${concepts.join(' ')}${u.intent === 'combination' ? ' combination' : ''} topical${cond ? ` ${cond}` : ''}` });
    if (concepts.length > 1 && u.intent === 'compare') for (const c of concepts) queries.push({ connector: 'pubmed', q: `${c} topical skin` });
  }
  if (cond) { queries.push({ connector: 'medlineplus', q: cond.split(' ').slice(-2).join(' ') }); if (!concepts.length) queries.push({ connector: 'pubmed', q: `${cond} management skin care` }); }
  return { concepts: [...concepts, ...conditions], queries: queries.slice(0, 3), unmapped };
}

export interface ResearchItem { title: string; url: string; publisher: string; year: string | null; connector: string; evidence_level: string; relevance: number; verdict: string; reasons: string[]; label_ar: string }
export interface ResearchResult { status: 'ok' | 'disabled' | 'offline' | 'no_plan' | 'partial'; plan: ResearchPlan; items: ResearchItem[]; stored: number; notes_ar: string[] }

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !['topical', 'skin', 'care', 'management', 'combination'].includes(w)));
/** Run the plan. Never throws; every connector problem becomes a note. */
export async function runResearch(db: DB, u: Cp07Understanding, env: { fetch: FetchLike; online: boolean; sleep?: (ms: number) => Promise<void>; nowMs?: number }): Promise<ResearchResult> {
  const plan = planResearch(u); const notes: string[] = [];
  if (!plan.queries.length) return { status: 'no_plan', plan, items: [], stored: 0, notes_ar: [plan.unmapped ? `لا أعرف المصطلح العلمي لـ «${plan.unmapped}» بعد؛ لم يُبحث حتى لا يُرسل نص حر. سُجّلت فجوة معرفية.` : 'لا يوجد مفهوم علمي واضح للبحث عنه في هذا السؤال.'] };
  if (!externalSearchEnabled(db)) return { status: 'disabled', plan, items: [], stored: 0, notes_ar: ['البحث العلمي عبر الإنترنت معطّل من المدير.'] };
  if (!env.online) return { status: 'offline', plan, items: [], stored: 0, notes_ar: ['لا يوجد اتصال بالإنترنت؛ الإجابة من المعرفة المحلية فقط.'] };
  const seen = new Map<string, ResearchItem>(); let stored = 0; let failures = 0;
  const at = new Date(env.nowMs ?? Date.now()).toISOString();
  for (const q of plan.queries) {
    const r = await guardedSearch(db, CONNECTORS[q.connector]!, q.q, env);
    if (r.status !== 'ok') { failures++; notes.push(`${CONNECTORS[q.connector]!.label}: ${r.status === 'breaker_open' ? 'متوقف مؤقتًا بعد أخطاء متكررة' : r.status === 'daily_cap' ? 'بلغ الحد اليومي' : 'تعذّر الاتصال'}`); continue; }
    stored += storeEvidence(db, q.connector, q.q, r.items, at, null, null);
    const qw = words(plan.concepts.join(' '));
    for (const e of r.items as RawEvidence[]) {
      const key = normAr(e.title).replace(/[^\p{L}\p{N}]/gu, '').slice(0, 80) || e.url;
      if (seen.has(key)) continue;
      const v = validateEvidence({ title: e.title, url: e.url, publisher: e.publisher, published_at: e.published_at, pub_types: e.pub_types, snippet: e.snippet, affiliation: e.affiliation });
      const tw = words(`${e.title} ${e.snippet}`); const overlap = qw.size ? [...qw].filter((w) => tw.has(w)).length / qw.size : 0;
      const year = Number(e.published_at ?? 0); const recency = year ? Math.max(0, 1 - (new Date().getFullYear() - year) / 20) : 0.3;
      const relevance = Math.round((0.6 * overlap + 0.25 * v.strength + 0.15 * recency) * 100) / 100;
      seen.set(key, { title: e.title, url: e.url, publisher: e.publisher, year: e.published_at, connector: q.connector, evidence_level: v.evidence_level, relevance, verdict: v.verdict, reasons: v.reasons, label_ar: 'دليل مكتشف — غير مراجع، لا يُعتمد عليه كحقيقة' });
    }
  }
  const items = [...seen.values()].filter((x) => x.verdict !== 'blocked').sort((a, b) => b.relevance - a.relevance).slice(0, 8);
  if (items.some((x) => x.relevance < 0.3)) notes.push('بعض النتائج ضعيفة الصلة بالسؤال؛ المراجعة البشرية ضرورية.');
  if (plan.unmapped) { notes.push(`المصطلح «${plan.unmapped}» غير معروف علميًا للنظام؛ بُحث عن بقية المفاهيم فقط.`); logGap(db, `subject:${plan.unmapped.replace(/^ال/, '').slice(0, 40)}`); }
  return { status: failures && !items.length ? 'partial' : 'ok', plan, items, stored, notes_ar: notes };
}

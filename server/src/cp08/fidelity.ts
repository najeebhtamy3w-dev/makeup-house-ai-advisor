/**
 * CP08 Phase 4 — citation-to-claim FIDELITY check for any model-written sentence (local or cloud).
 * The CP07 groundingCheck() proved structure (known ids, no URL, no new %, no unknown product). CP07 measurements showed
 * that a model can pass it and still CHANGE THE MEANING (Qwen3-4B: "قد يقلل الدهون" → "نعم يناسب… وفقًا لدراسات علمية";
 * "يُسأل الطبيب عند الحمل" → "لا يُنصح خلال الحمل"). This check works per sentence against the claim(s) it cites:
 *   1. every sentence must cite ≥1 provided claim id;
 *   2. lexical support: most of the sentence's content words must come from the cited claim(s);
 *   3. no certainty escalation (نعم، مثبت، أثبتت، دراسات علمية، بالتأكيد، يعالج…) unless the claim says it;
 *   4. hedges are preserved (قد، تشير، بعض، غالبًا، عادةً، محدود…);
 *   5. no directive inversion: "اسأل/راجع الطبيب" must not become "ممنوع / لا يُنصح / يجب تجنب";
 *   6. qualifiers are not dropped (الطبية، الوصفية، بعض، لدى بعض، مؤقتًا…);
 *   7. no number that is not in the cited claim;
 *   8. (with the question) a sentence that only echoes the staff question is rejected.
 * Deterministic and conservative: when unsure it rejects, and the engine falls back to the claim text itself.
 * This is NOT semantic entailment; it is a set of rules aimed at the failure modes actually observed.
 */
import { normAr } from '../advisor2/understand.ts';

const STOP = new Set(['في', 'من', 'على', 'او', 'و', 'مع', 'الى', 'عن', 'ما', 'هو', 'هي', 'ان', 'التي', 'الذي', 'هذا', 'هذه', 'ذلك', 'كل', 'او', 'ثم', 'لذا', 'لذلك', 'حيث', 'كما', 'ايضا', 'بعد', 'قبل', 'عند', 'اذا', 'لان', 'لكن', 'بل', 'يكون', 'تكون', 'كان', 'به', 'بها', 'لها', 'له', 'منها', 'منه', 'فيه', 'فيها', 'يمكن', 'انه', 'انها', 'بشرتك', 'لك', 'عليك']);
const stem = (w: string) => w.replace(/^(وال|بال|كال|فال|لل|ال|و|ف|ب|ل)(?=\p{L}{3,})/u, '').replace(/(ها|هم|كم|ك|ه|ات|ين|ون|ي)$/u, (m: string, _p1: string, off: number) => (off >= 3 ? '' : m));
export const contentWords = (s: string) => normAr(s).replace(/\[[^\]]*\]/g, ' ').replace(/[^\p{L}\p{N}%\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem).filter((w) => w.length > 1);

const CERTAINTY = /(نعم|بالتاكيد|اكيد|مؤكد|مثبت|اثبتت|اثبت|ثبت علميا|دراسات علميه|دراسه علميه|الدراسات|دائما|يعالج|تعالج|علاج نهائي|يشفي|تشفي|مضمون|بشكل قاطع|حتما|100)/g;
const HEDGE = /(قد |تشير|بعض|غالبا|عاده|عادة|محدود|ربما|يحتمل|احيانا|لدى بعض|يمكن ان|تقريبا)/;
const CONSULT = /(يسال الطبيب|يسال|اسالي|استشير|استشاره|مراجعه طبيب|راجعي|يراجع|بإشراف|باشراف|رأي مختص|راي مختص|الطبيب)/;
const PROHIBIT = /(ممنوع|يمنع|لا ينصح|لا يُنصح|يجب تجنب|يجب عدم|لا تستخدم|لا تستعمل|محظور|ابتعدي|تجنبي تماما|يحرم)/;
const QUALIFIERS = ['الطبيه', 'الوصفيه', 'وصفي', 'لدى بعض', 'بعض الناس', 'بعض الاشخاص', 'مؤقتا', 'في البدايه', 'الاسابيع الاولى'];
const NUM = /\d+(?:[.,]\d+)?/g;

export interface FidelityProblem { sentence: string; problem: string }
export function splitSentences(text: string): string[] {
  const raw = text.split(/(?<=[.!؟?])\s+|\n+|(?<=\])\s+(?=\S)/).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const r of raw) {
    // a fragment that is only citations ("[dry_skin-2]") belongs to the sentence before it
    if (/^(\[[^\]]+\]\s*[.،]?\s*)+$/.test(r) && out.length) out[out.length - 1] += ` ${r}`;
    else out.push(r.replace(/^[-•*]\s*/, ''));
  }
  return out.filter((x) => x.replace(/\[[^\]]*\]/g, '').trim().length > 3);
}

export function fidelityCheck(text: string, claims: { id: string; text: string }[], opts: { minSupport?: number; question?: string } = {}): { ok: boolean; problems: FidelityProblem[]; sentences: number } {
  const byId = new Map(claims.map((c) => [c.id, c.text]));
  const problems: FidelityProblem[] = []; const sents = splitSentences(text);
  for (const s of sents) {
    const ids = [...s.matchAll(/\[([A-Za-z0-9_@.+-]+(?:\s*,\s*[A-Za-z0-9_@.+-]+)*)\]/g)].flatMap((m) => m[1]!.split(/\s*,\s*/));
    const p = (problem: string) => problems.push({ sentence: s.slice(0, 160), problem });
    if (!ids.length) { p('no citation'); continue; }
    const unknown = ids.filter((i) => !byId.has(i)); if (unknown.length) { p(`unknown citation ${unknown.join(',')}`); continue; }
    const claimText = ids.map((i) => byId.get(i)!).join(' '); const cn = normAr(claimText); const sn = normAr(s.replace(/\[[^\]]*\]/g, ' '));
    // 0. a sentence that only repeats the staff question is not a claim, whatever it cites
    if (opts.question) { const qw = new Set(contentWords(opts.question)); const own = contentWords(s); if (own.length && own.filter((w) => qw.has(w)).length / own.length >= 0.8) { p('echoes the question'); continue; } }
    // 2. support
    const cw = new Set(contentWords(claimText)); const sw = contentWords(s);
    const support = sw.length ? sw.filter((w) => cw.has(w)).length / sw.length : 1;
    if (support < (opts.minSupport ?? 0.5)) p(`low support ${Math.round(support * 100)}% (sentence not traceable to the cited claim)`);
    // 3. certainty escalation
    for (const m of sn.matchAll(CERTAINTY)) if (!cn.includes(m[1]!)) { p(`certainty escalation «${m[1]}»`); break; }
    // 4. hedge loss
    if (HEDGE.test(cn) && !HEDGE.test(sn)) p('hedge dropped (claim is qualified, sentence is categorical)');
    // 5. directive inversion
    if (CONSULT.test(cn) && PROHIBIT.test(sn) && !PROHIBIT.test(cn)) p('directive inversion («استشيري» → منع)');
    // 6. qualifier dropped — only when the sentence talks about the same subject (shares content words)
    for (const q of QUALIFIERS) if (cn.includes(q) && !sn.includes(q) && support >= 0.3 && sw.length >= 4) { if (q === 'الطبيه' || q === 'الوصفيه' || q === 'وصفي') { if (/(ريتين|ادابالين|بنزويل)/.test(sn)) p(`qualifier dropped «${q}»`); } else if (!HEDGE.test(sn)) p(`qualifier dropped «${q}»`); }
    // 7. numbers
    const cnum = new Set(claimText.match(NUM) ?? []);
    for (const n of s.replace(/\[[^\]]*\]/g, ' ').match(NUM) ?? []) if (!cnum.has(n)) { p(`number not in claim: ${n}`); break; }
  }
  return { ok: !problems.length, problems, sentences: sents.length };
}

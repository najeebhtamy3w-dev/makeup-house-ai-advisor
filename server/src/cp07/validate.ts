/**
 * CP07 Phase 5 — evidence validation. Pure functions; no network, no model.
 * Decides nothing on its own: it produces a verdict + reasons that a human reviewer sees. It can only BLOCK
 * (incomplete / marketing / duplicate) — it never approves.
 */
import { normAr } from '../advisor2/understand.ts';
import type { EvidenceLevel } from './seed.ts';

export interface EvidenceMeta { title: string; url: string; publisher: string; published_at?: string | null; pub_types?: string[]; snippet?: string; affiliation?: string }
export interface ValidationResult { complete: boolean; missing: string[]; evidence_level: EvidenceLevel; is_marketing: boolean; industry_affiliated: boolean; strength: number; reasons: string[]; verdict: 'send_to_review' | 'blocked' }

const MARKETING_HOST = /(shop|store|buy|amazon\.|noon\.|ebay\.|aliexpress|\.myshopify\.|sephora|ulta|iherb|boots\.com)/i;
const MARKETING_TEXT = /\b(buy now|shop now|best seller|limited offer|discount|% off|add to cart|free shipping|miracle|clinically proven to)\b/i;
const MANUFACTURER_HOST = /(cerave|loreal|l-oreal|lorealparis|neutrogena|larocheposay|vichy|nivea|beiersdorf|olay|theordinary|bioderma|avene|eucerin|garnier)\./i;
const TRUSTED = /(medlineplus\.gov|nih\.gov|ncbi\.nlm\.nih\.gov|pubmed\.ncbi|aad\.org|dermnetnz\.org|nhs\.uk|who\.int|fda\.gov|europa\.eu|cochranelibrary\.com)/i;

export function classifyLevel(m: EvidenceMeta): EvidenceLevel {
  const pt = (m.pub_types ?? []).map((x) => x.toLowerCase());
  if (MANUFACTURER_HOST.test(m.url) || MARKETING_HOST.test(m.url)) return 'manufacturer_claim';
  if (pt.some((x) => x.includes('practice guideline') || x === 'guideline')) return 'guideline';
  if (pt.some((x) => x.includes('systematic review') || x.includes('meta-analysis'))) return 'systematic_review';
  if (pt.some((x) => x.includes('randomized controlled trial') || x.includes('clinical trial'))) return 'clinical_study';
  if (pt.some((x) => x === 'review')) return 'narrative_review';
  if (/medlineplus\.gov|aad\.org|nhs\.uk|dermnetnz\.org/i.test(m.url)) return 'expert_patient_education';
  if (/europa\.eu|fda\.gov/i.test(m.url)) return 'regulatory';
  return 'unknown';
}
const WEIGHT: Record<EvidenceLevel, number> = { guideline: 0.9, systematic_review: 0.85, clinical_study: 0.7, narrative_review: 0.6, expert_patient_education: 0.6, regulatory: 0.5, manufacturer_claim: 0.1, unknown: 0.2 };

export function validateEvidence(m: EvidenceMeta, nowYear = new Date().getFullYear()): ValidationResult {
  const missing: string[] = []; const reasons: string[] = [];
  if (!m.title?.trim()) missing.push('title');
  if (!/^https:\/\//.test(m.url ?? '')) missing.push('https url');
  if (!m.publisher?.trim()) missing.push('publisher');
  if (!m.published_at) reasons.push('تاريخ النشر غير معروف');
  const level = classifyLevel(m);
  const is_marketing = level === 'manufacturer_claim' || MARKETING_TEXT.test(`${m.title} ${m.snippet ?? ''}`);
  const industry = Boolean(m.affiliation && /(gmbh|inc\.?|ltd|s\.a\.|ag\b|l'or[eé]al|bayer|evonik|consumer care|laboratoires|cosmetic active)/i.test(m.affiliation));
  let strength = WEIGHT[level];
  if (industry) { strength -= 0.2; reasons.push('مؤلفون مرتبطون بشركة مصنّعة — تضارب مصالح محتمل'); }
  const year = Number(String(m.published_at ?? '').slice(0, 4));
  if (year && nowYear - year > 15) { strength -= 0.1; reasons.push(`مصدر قديم (${year}) — يُتحقق من وجود أحدث منه`); }
  if (!TRUSTED.test(m.url ?? '')) { strength -= 0.1; reasons.push('النطاق ليس ضمن قائمة المصادر الموثوقة المعتمدة'); }
  if (is_marketing) reasons.push('محتوى تسويقي أو ادعاء شركة — لا يُعد دليلًا مستقلًا');
  if (missing.length) reasons.push(`بيانات ناقصة: ${missing.join('، ')}`);
  strength = Math.max(0, Math.round(strength * 100) / 100);
  const verdict = missing.length || is_marketing ? 'blocked' : 'send_to_review';
  if (verdict === 'send_to_review') reasons.push('صالح للعرض على مراجع بشري (لم يُعتمد)');
  return { complete: !missing.length, missing, evidence_level: level, is_marketing, industry_affiliated: industry, strength, reasons, verdict };
}

/* ---------- duplicates and conflicts between claims ---------- */
const STOP = new Set(['في', 'من', 'على', 'او', 'أو', 'و', 'مع', 'الى', 'إلى', 'عن', 'قد', 'لا', 'ما', 'هو', 'هي', 'ان', 'أن', 'التي', 'الذي', 'كل', 'بعض', 'the', 'and', 'of', 'to', 'a', 'in', 'is']);
export const tokens = (s: string) => new Set(normAr(s).replace(/[^\p{L}\p{N}%.\s-]/gu, ' ').split(/\s+/).map((w) => w.replace(/^(وال|بال|كال|فال|ال|و)(?=\p{L}{3,})/u, '')).filter((w) => w.length > 1 && !STOP.has(w)));
export function similarity(a: string, b: string) { const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i); }

export interface ClaimLike { id: string; subject: string; stance: string; text_ar: string; structured_en?: string }
export function findDuplicates(candidate: ClaimLike, existing: ClaimLike[], threshold = 0.6) {
  return existing.filter((e) => e.id !== candidate.id).map((e) => ({ id: e.id, score: Math.round(similarity(candidate.text_ar, e.text_ar) * 100) / 100 })).filter((x) => x.score >= threshold).sort((a, b) => b.score - a.score);
}
const PCT = /(\d+(?:\.\d+)?)\s*%/g;
const pcts = (s: string) => [...s.matchAll(PCT)].map((m) => Number(m[1]));
/** Conflict = same subject and opposite stance (supports vs avoid/cautions-as-avoid), or the same subject with different stated concentrations. */
export function findConflicts(candidate: ClaimLike, existing: ClaimLike[]) {
  const out: { id: string; type: 'stance' | 'concentration'; detail: string }[] = [];
  for (const e of existing) {
    if (e.id === candidate.id || !e.subject || e.subject !== candidate.subject) continue;
    const opp = (a: string, b: string) => (a === 'supports' && b === 'avoid') || (a === 'avoid' && b === 'supports');
    if (opp(candidate.stance, e.stance)) out.push({ id: e.id, type: 'stance', detail: `${candidate.stance} ≠ ${e.stance}` });
    const a = pcts(`${candidate.text_ar} ${candidate.structured_en ?? ''}`), b = pcts(`${e.text_ar} ${e.structured_en ?? ''}`);
    if (a.length && b.length && !a.some((x) => b.includes(x))) out.push({ id: e.id, type: 'concentration', detail: `${a.join('/')}% ≠ ${b.join('/')}%` });
  }
  return out;
}

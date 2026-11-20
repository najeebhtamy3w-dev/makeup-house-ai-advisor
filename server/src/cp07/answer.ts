/**
 * CP07 Phase 8 — evidence-aware Arabic answer engine (LOCAL_RULES mode: no model).
 * Every sentence shown comes from a retrieved, usable claim (claim id + source ids) or from a fixed system sentence
 * (understanding, follow-up question, "insufficient evidence", safety referral). Nothing is generated freely, so
 * nothing can be invented: no study, link, concentration, product or availability that is not in the data.
 * An optional model (experiments/cp07-open-source-ai) may only REPHRASE these grounded items; `groundingCheck()`
 * re-validates its output and the engine falls back to this answer when the check fails.
 */
import type { DB } from '../db.ts';
import { fp } from '../queue.ts';
import { outputViolations } from '../advisor2/safety.ts';
import type { TAdvisorContext } from '../contracts.ts';
import type { P } from '../advisor.ts';
import { understandCp07, type Cp07Understanding } from './nlu.ts';
import { retrieve, type Hit } from './retrieve.ts';
import { trustLabel, type SourceRow } from './store.ts';
import { productBridge, type BridgeResult } from './bridge.ts';
import { logGap } from './growth.ts';

export type SectionKind = 'understanding' | 'direct' | 'explanation' | 'practical' | 'interaction' | 'products' | 'warnings' | 'referral' | 'insufficient' | 'follow_up' | 'scope';
export interface Item { text: string; claim_id?: string; source_ids: string[]; trust?: string }
export interface Section { kind: SectionKind; title: string; items: Item[] }
export interface Cp07Answer {
  engine: 'cp07_local_rules'; mode: 'LOCAL_RULES' | 'LOCAL_MODEL' | 'REMOTE_MODEL_OPTIONAL'; understanding: Cp07Understanding;
  sections: Section[]; sources: Pick<SourceRow, 'id' | 'title' | 'url' | 'publisher' | 'source_type' | 'evidence_level' | 'industry_affiliation'>[];
  products: BridgeResult | null; used_claim_ids: string[]; evidence_status: 'unreviewed' | 'administrative' | 'scientific' | 'none';
  gaps_logged: string[]; follow_up: { question: string; choices: string[] } | null; text: string;
}

const SKIN_AR: Record<string, string> = { dry: 'جافة', oily: 'دهنية', combination: 'مختلطة', sensitive: 'حساسة', normal: 'عادية' };
const HAIR_AR: Record<string, string> = { oily: 'دهني', dry: 'جاف', colored: 'مصبوغ', curly: 'مجعد', damaged: 'متقصف أو تالف', normal: 'عادي' };
const TYPE_AR: Record<string, string> = { cleanser: 'غسول', moisturizer: 'مرطب', sunscreen: 'واقي شمس', serum: 'سيروم', toner: 'تونر', shampoo: 'شامبو', conditioner: 'بلسم', hair_oil: 'زيت شعر', mask: 'ماسك', exfoliant: 'مقشر' };
const CONCERN_AR: Record<string, string> = { acne: 'حبوب', dryness: 'جفاف', sensitivity: 'تحسس', pigmentation: 'تصبغات', dandruff: 'قشرة', itch: 'حكة', hair_loss: 'تساقط', oil: 'دهون ولمعان', sun: 'حماية من الشمس' };
const CONSTRAINT_AR: Record<string, string> = { lightweight: 'قوام خفيف', non_comedogenic: 'لا يسد المسام', fragrance_free: 'بدون عطر', for_sensitive: 'لطيف على البشرة', oil_free: 'خالٍ من الزيوت', pregnancy: 'حمل أو رضاعة' };
const ING_AR: Record<string, string> = { glycerin: 'الجليسرين', urea: 'اليوريا', petrolatum: 'الفازلين', 'ceramide np': 'السيراميدات', 'sodium hyaluronate': 'حمض الهيالورونيك', niacinamide: 'النياسيناميد', 'salicylic acid': 'حمض الساليسيليك', retinol: 'الريتينول/الريتينويدات', adapalene: 'الأدابالين', 'benzoyl peroxide': 'البنزويل بيروكسايد', dimethicone: 'الدايميثيكون', panthenol: 'البانثينول', exfoliation: 'المقشرات', 'vitamin c': 'فيتامين C' };
// claims phrased for a skin/hair topic that mention another product FORM are not "direct" answers to a request for this form
const FORM_WORDS: Record<string, RegExp> = { cleanser: /(غسول|منظف)/, moisturizer: /(مرطب|كريم|ترطيب|لوشن|مراهم)/, sunscreen: /(واقي|spf|شمس)/, shampoo: /(شامبو|غسل)/, conditioner: /(بلسم)/, exfoliant: /(تقشير|مقشر)/, serum: /(سيروم)/ };
const norm = (s: string) => s.normalize('NFKC').replace(/[إأآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

export interface Cp07Deps { products?: () => P[]; conflictIds?: Set<number>; logGaps?: boolean }

export function answerCp07(db: DB, text: string, prev?: TAdvisorContext, deps: Cp07Deps = {}): Cp07Answer {
  const u = understandCp07(text, prev);
  const sections: Section[] = []; const used = new Set<string>(); const gaps: string[] = [];
  const out = (a: Omit<Cp07Answer, 'text' | 'engine' | 'mode' | 'understanding' | 'gaps_logged'>): Cp07Answer => {
    const full: Cp07Answer = { engine: 'cp07_local_rules', mode: 'LOCAL_RULES', understanding: u, gaps_logged: gaps, ...a, text: '' };
    full.text = renderText(full); return full;
  };
  // 0) scope and safety come first
  if (u.intent === 'out_of_scope') return out({ sections: [{ kind: 'scope', title: 'خارج النطاق', items: [{ text: 'الأسعار والمبيعات والمخزون خارج نطاق المستشار. أستطيع المساعدة في العناية بالبشرة والشعر واختيار نوع المنتج المناسب.', source_ids: [] }] }], sources: [], products: null, used_claim_ids: [], evidence_status: 'none', follow_up: null });
  if (u.medical_red_flags.length) {
    return out({ sections: [{ kind: 'referral', title: 'تنبيه: يحتاج تقييمًا صحيًا', items: [{ text: `ما ذُكر (${u.medical_red_flags.join('، ')}) قد يحتاج تقييمًا من طبيب أو مختص صحي، ولا تُقترح منتجات تجميلية لهذه الحالة. إذا كان هناك تورم في الوجه أو الشفاه أو صعوبة تنفس فهذه حالة طارئة.`, source_ids: [] }] }], sources: [], products: null, used_claim_ids: [], evidence_status: 'none', follow_up: null });
  }
  if (u.intent === 'greeting') return out({ sections: [{ kind: 'understanding', title: 'أهلًا', items: [{ text: 'أهلًا بك. اذكر نوع البشرة أو الشعر والمشكلة والمنتج المطلوب، مثل: «بشرتي جافة وأشتي غسول».', source_ids: [] }] }], sources: [], products: null, used_claim_ids: [], evidence_status: 'none', follow_up: null });

  // 1) understanding (system sentence, no claim)
  const parts: string[] = [];
  if (u.skin_type.length) parts.push(`بشرة ${u.skin_type.map((s) => SKIN_AR[s]).join(' و')}`);
  if (u.hair_type.length) parts.push(`شعر ${u.hair_type.map((h) => HAIR_AR[h]).join(' و')}`);
  const cs = u.concerns.filter((c) => !(c === 'dryness' && u.skin_type.includes('dry')) && !(c === 'sensitivity' && u.skin_type.includes('sensitive')) && !(c === 'oil' && u.skin_type.includes('oily')));
  if (cs.length) parts.push(`المشكلة: ${cs.map((c) => CONCERN_AR[c] ?? c).join('، ')}`);
  if (u.ingredients.length) parts.push(`المكوّن: ${u.ingredients.map((i) => ING_AR[i] ?? i).join(' و')}`);
  if (u.constraints.length) parts.push(`الشروط: ${u.constraints.map((c) => CONSTRAINT_AR[c] ?? c).join('، ')}`);
  const asked = u.requested_product_type ? `والمطلوب: ${TYPE_AR[u.requested_product_type] ?? u.requested_product_type}` : '';
  if (parts.length || asked) sections.push({ kind: 'understanding', title: 'فهم الاحتياج', items: [{ text: `فهمت: ${parts.join(' — ')}${parts.length && asked ? ' — ' : ''}${asked}.`, source_ids: [] }] });

  // 2) retrieval
  const hits = retrieve(db, text, u);
  const item = (h: Hit): Item => { used.add(h.claim.id); return { text: h.claim.text_ar, claim_id: h.claim.id, source_ids: h.source_ids, trust: trustLabel(h.claim).label_ar }; };
  const take = (pred: (h: Hit) => boolean, n: number) => hits.filter((h) => !used.has(h.claim.id) && pred(h)).slice(0, n).map(item);

  if (u.intent === 'combination') {
    const inter = take((h) => h.why.some((w) => w.startsWith('combination:')) || h.claim.kind === 'interaction', 3);
    if (inter.length) sections.push({ kind: 'interaction', title: 'الجمع بين المكونات', items: inter });
    else { gaps.push(gapKey(u)); sections.push({ kind: 'insufficient', title: 'حدود المعرفة', items: [{ text: `لا تتوفر لدي معلومات موثوقة كافية عن الجمع بين ${u.ingredients.map((i) => ING_AR[i] ?? i).join(' و')}. الأسلم استشارة صيدلي أو طبيب جلدية قبل الجمع.`, source_ids: [] }] }); }
    const cau = take((h) => h.claim.kind === 'caution' || h.claim.kind === 'referral', 3);
    if (cau.length) sections.push({ kind: 'warnings', title: 'احتياطات', items: cau });
  } else if (u.intent === 'compare') {
    const known = u.compare_terms.map((t) => [t, Object.entries(TYPE_AR).find(([, ar]) => norm(t).includes(norm(ar)))?.[0] ?? null] as const);
    const covered = hits.filter((h) => known.some(([, k]) => k && (h.claim.topic_id === `${k}_basics` || (FORM_WORDS[k]?.test(norm(h.claim.text_ar)) ?? false))));
    const items = covered.slice(0, 3).map(item);
    if (items.length) sections.push({ kind: 'explanation', title: 'ما تقوله المصادر المتاحة', items });
    const missing = known.filter(([, k]) => !k || !covered.some((h) => h.claim.topic_id === `${k}_basics` || (FORM_WORDS[k]?.test(norm(h.claim.text_ar)) ?? false))).map(([t]) => t);
    if (missing.length || !items.length) { gaps.push(gapKey(u)); sections.push({ kind: 'insufficient', title: 'حدود المعرفة', items: [{ text: `لا تتوفر لدي معلومات موثوقة كافية لمقارنة مؤكدة${missing.length ? ` (لا يوجد مصدر معتمد يعرّف: ${missing.join('، ')})` : ''}. أعرض فقط ما تدعمه المصادر، وسُجّل الموضوع لمراجعة المعرفة.`, source_ids: [] }] }); }
  } else if (u.intent === 'ingredient_question') {
    const ingTopics = new Set((u.ingredients.map((i) => (db.prepare('SELECT topic_id FROM ingredient_knowledge WHERE inci = ?').get(i) as { topic_id: string } | undefined)?.topic_id).filter(Boolean)) as string[]);
    if (u.unknown_subject) { gaps.push(gapKey(u)); sections.push({ kind: 'insufficient', title: 'حدود المعرفة', items: [{ text: `لا تتوفر لدي معلومات موثوقة كافية عن «${u.unknown_subject}» لتأكيد فائدته أو ملاءمته. سُجّل الموضوع لمراجعة المعرفة، والأسلم سؤال صيدلي أو طبيب جلدية.`, source_ids: [] }] }); }
    const ing = take((h) => ingTopics.has(h.claim.topic_id) && (h.claim.kind === 'ingredient' || h.claim.kind === 'education' || h.claim.kind === 'advice'), 3);
    if (ing.length) sections.push({ kind: 'direct', title: 'عن المكوّن', items: ing });
    const cau = take((h) => ingTopics.has(h.claim.topic_id) && (h.claim.kind === 'caution' || h.claim.kind === 'referral' || h.claim.kind === 'interaction'), 3);
    if (cau.length) sections.push({ kind: 'warnings', title: 'احتياطات', items: cau });
    if (u.unknown_subject && (u.skin_type.length || u.concerns.length || u.hair_type.length)) { const gen = take((h) => h.why.some((w) => w.startsWith('topic:')) && h.claim.kind !== 'ingredient', 2); if (gen.length) sections.push({ kind: 'explanation', title: 'معلومات عامة عن الحالة (لا تخص المكوّن المسؤول عنه)', items: gen }); }
    if (!ing.length && !cau.length && !u.unknown_subject) { gaps.push(gapKey(u)); sections.push({ kind: 'insufficient', title: 'حدود المعرفة', items: [{ text: 'لا تتوفر لدي معلومات موثوقة كافية عن هذا المكوّن حاليًا. سُجّل الموضوع لمراجعة المعرفة.', source_ids: [] }] }); }
    if (u.skin_type.length === 0 && /(يناسب|مناسب|ينفع|يصلح)/.test(norm(text))) sections.push({ kind: 'insufficient', title: 'حدود الحكم', items: [{ text: 'وجود مكوّن مفيد لا يعني أن المنتج كاملًا يناسب كل بشرة؛ الحكم يحتاج معرفة نوع البشرة وبقية مكونات المنتج.', source_ids: [] }] });
  } else {
    // product guidance / explain / routine / follow-ups
    const form = u.requested_product_type ? FORM_WORDS[u.requested_product_type] : null;
    const direct = form ? take((h) => (h.claim.kind === 'advice' || h.claim.kind === 'ingredient') && form.test(norm(h.claim.text_ar)), 3) : [];
    if (direct.length) sections.push({ kind: 'direct', title: u.requested_product_type ? `كيف تختارين ${TYPE_AR[u.requested_product_type]}` : 'الإجابة', items: direct });
    const expl = take((h) => h.claim.kind === 'education', 2);
    if (expl.length) sections.push({ kind: 'explanation', title: 'التفسير', items: expl });
    // practical advice for the skin/hair itself; other product FORMS are supportive, never replace the requested one
    const prac = take((h) => h.claim.kind === 'advice' || h.claim.kind === 'ingredient', 3);
    if (prac.length) sections.push({ kind: 'practical', title: u.requested_product_type ? 'نصائح مساندة (لا تغيّر نوع المنتج المطلوب)' : 'نصائح عملية', items: prac });
    const cau = take((h) => h.claim.kind === 'caution' || h.claim.kind === 'interaction', 2);
    if (cau.length) sections.push({ kind: 'warnings', title: 'احتياطات', items: cau });
    const ref = take((h) => h.claim.kind === 'referral', 1);
    if (ref.length) sections.push({ kind: 'warnings', title: 'متى تراجعين مختصًا', items: ref });
    if (!hits.length && u.intent !== 'product_followup') { gaps.push(gapKey(u)); sections.push({ kind: 'insufficient', title: 'حدود المعرفة', items: [{ text: 'لا تتوفر لدي معلومات موثوقة كافية للإجابة عن هذا السؤال. وضّحي نوع البشرة أو الشعر والمشكلة والمنتج المطلوب.', source_ids: [] }] }); }
  }
  for (const r of u.referrals) sections.push({ kind: 'warnings', title: 'إحالة', items: [{ text: r, source_ids: [] }] });

  // 3) products (approved local catalogue only, availability separate)
  let products: BridgeResult | null = null;
  if (u.requested_product_type && deps.products) {
    products = productBridge(db, deps.products(), u, deps.conflictIds);
    const items: Item[] = products.items.map((p) => ({ text: `${p.name}${p.brand ? ` (${p.brand})` : ''} — ${p.suitability.label}؛ المعلومات: ${p.information === 'documented' ? 'موثقة' : p.information === 'partial' ? 'جزئية' : 'غير معروفة'}؛ التوفر: ${p.availability_note}`, source_ids: [] }));
    sections.push({ kind: 'products', title: 'منتجات المحل', items: items.length ? items : [{ text: products.note, source_ids: [] }] });
  }
  // 4) one necessary follow-up, never repeated
  let follow_up: Cp07Answer['follow_up'] = null;
  const askedBefore = new Set(u.conversation_context.asked);
  if ((u.intent === 'product_guidance' || u.intent === 'ingredient_question') && !u.skin_type.length && !u.hair_type.length && !['shampoo', 'conditioner', 'hair_oil'].includes(u.requested_product_type ?? '') && !askedBefore.has('skin_type')) {
    follow_up = { question: 'ما نوع البشرة؟', choices: ['جافة', 'دهنية', 'مختلطة', 'حساسة'] }; u.conversation_context.asked.push('skin_type');
  } else if (u.intent === 'unclear' && !askedBefore.has('clarify')) { follow_up = { question: 'هل السؤال عن البشرة أم الشعر؟ وما المنتج المطلوب؟', choices: ['البشرة', 'الشعر', 'فروة الرأس'] }; u.conversation_context.asked.push('clarify'); }
  if (follow_up) sections.push({ kind: 'follow_up', title: 'سؤال متابعة', items: [{ text: follow_up.question, source_ids: [] }] });

  // 5) sources + honest evidence status
  const srcIds = [...new Set(sections.flatMap((s) => s.items.flatMap((i) => i.source_ids)))];
  const sources = srcIds.map((id) => db.prepare('SELECT id,title,url,publisher,source_type,evidence_level,industry_affiliation FROM knowledge_sources WHERE id = ?').get(id) as Cp07Answer['sources'][number]).filter(Boolean);
  const levels = [...used].map((id) => db.prepare('SELECT state, review_level FROM knowledge_claims WHERE id = ?').get(id) as { state: string; review_level: string }).map((c) => trustLabel(c as never).level);
  const evidence_status = !levels.length ? 'none' : levels.includes('unreviewed') ? 'unreviewed' : levels.includes('administrative') ? 'administrative' : 'scientific';
  if (deps.logGaps !== false) for (const g of gaps) logGap(db, g);
  db.prepare('INSERT INTO knowledge_retrieval_log(query_hash,intent,claim_ids,engine,at) VALUES (?,?,?,?,?)').run(fp('cp07', text), u.intent, JSON.stringify([...used]), 'cp07_local_rules', new Date().toISOString());
  return out({ sections, sources, products, used_claim_ids: [...used], evidence_status, follow_up });
}

/** concept key only (no staff text): ingredient / product-type words or the intent */
export function gapKey(u: Cp07Understanding): string {
  if (u.intent === 'compare' && u.compare_terms.length) {
    const k = u.compare_terms.map((t) => Object.entries(TYPE_AR).find(([, ar]) => norm(t).includes(norm(ar)))?.[0] ?? (Object.entries(ING_AR).find(([, ar]) => norm(t).includes(norm(ar.replace(/^ال/, ''))))?.[0]) ?? 'unrecognized');
    return `compare:${k.sort().join('|')}`;
  }
  if (u.unknown_subject) return `subject:${u.unknown_subject.replace(/^ال/, '').slice(0, 40)}`;
  if (u.ingredients.length) return `${u.intent === 'combination' ? 'combination' : 'ingredient'}:${[...u.ingredients].sort().join('+')}`;
  if (u.requested_product_type) return `product_type:${u.requested_product_type}`;
  return `unrecognized:${u.intent}`;
}

const STATUS_AR = { unreviewed: 'حالة المعلومة: مرجع منظم من مصادر معروفة لم يراجعه مختص مؤهل بعد.', administrative: 'حالة المعلومة: معتمدة إداريًا، ولم يراجعها مختص مؤهل بعد.', scientific: 'حالة المعلومة: راجعها مختص مؤهل.', none: '' };
export function renderText(a: Pick<Cp07Answer, 'sections' | 'sources' | 'evidence_status'>): string {
  const lines: string[] = [];
  for (const s of a.sections) { lines.push(`【${s.title}】`); for (const i of s.items) lines.push(`• ${i.text}${i.source_ids.length ? ` [${i.source_ids.join(', ')}]` : ''}`); }
  if (a.sources.length) { lines.push('【المصادر】'); for (const s of a.sources) lines.push(`- ${s.title} — ${s.publisher}${s.industry_affiliation ? ' (تنبيه: ارتباط بشركة)' : ''}`); }
  if (STATUS_AR[a.evidence_status]) lines.push(STATUS_AR[a.evidence_status]);
  return lines.join('\n');
}

/**
 * Grounding check for any model-written text (LOCAL_MODEL / REMOTE mode). Rejects when the text:
 *  - cites a claim or source id that was not provided; contains a URL; names a % that is not in the provided claims;
 *  - fails the CP06.2 forbidden-output check (prices, cure promises, diagnosis, prescription);
 *  - names a product that is not in the provided product list; or cites nothing at all while claims were provided.
 */
export function groundingCheck(text: string, provided: { claim_ids: string[]; claim_texts: string[]; source_ids: string[]; product_names: string[] }): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const cited = [...text.matchAll(/\[([A-Za-z0-9_@.+-]+(?:\s*,\s*[A-Za-z0-9_@.+-]+)*)\]/g)].flatMap((m) => m[1]!.split(/\s*,\s*/));
  for (const c of cited) if (!provided.claim_ids.includes(c) && !provided.source_ids.includes(c)) problems.push(`unknown citation ${c}`);
  if (provided.claim_ids.length && !cited.length) problems.push('no citation');
  if (/https?:\/\/|www\./i.test(text)) problems.push('url in model text');
  const allowedPct = new Set(provided.claim_texts.flatMap((t) => [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*[–-]?\s*(\d+)?\s*%/g)].flatMap((m) => [m[1], m[2]].filter(Boolean) as string[])));
  for (const m of text.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)) if (!allowedPct.has(m[1]!)) problems.push(`unsupported concentration ${m[1]}%`);
  for (const v of outputViolations(text)) problems.push(`forbidden: ${v}`);
  const brandish = [...text.matchAll(/«([^»]{3,60})»/g)].map((m) => m[1]!);
  for (const b of brandish) if (!provided.product_names.some((p) => p.includes(b) || b.includes(p)) && !provided.claim_texts.some((t) => t.includes(`«${b}»`))) problems.push(`unknown product «${b}»`);
  return { ok: !problems.length, problems };
}

/**
 * CP06.2 Phase 5A — Evidence-grounded consultation. Pipeline for one staff message:
 *   understand → safety → knowledge retrieval → (products: existing retrieval + science/* suitability, availability apart)
 *   → (global alternatives, optional) → (AI wording, optional and guarded) → validated AdvisorResponse.
 * The consultation never depends on products existing, on the internet, or on a language model.
 * Authority boundaries: knowledge = curated claims; products/suitability = advise()+science/* (unchanged);
 * availability = products.availability; the model (if any) only rephrases what it is given.
 */
import { AdvisorResponse, type TAdvisorContext, type TAdvisorResponse, type TAdvisorSection, type TSourceRef } from '../contracts.ts';
import { advise, type P } from '../advisor.ts';
import { TOPIC, sourceById, type Topic } from './knowledge.ts';
import { understand, PRODUCT_TYPES, normAr, type Understanding } from './understand.ts';
import { assessSafety, outputViolations } from './safety.ts';
import { composeWithAI, type AIConfig } from './ai.ts';
import { openSession, saveTurn, resetSession, type Session } from './session.ts';
import type { DB } from '../db.ts';

export interface GlobalHit { name: string; brand: string; size: string; source_url?: string; provider: string }
export interface ConsultDeps {
  products: () => P[]; conflictIds?: Set<number>;
  globalSearch?: (q: { name: string; brand?: string }) => Promise<GlobalHit[]>;   // optional; failures are reported, never fatal
  ai: AIConfig; online?: boolean; nowMs?: number;
}
const SKIN_AR: Record<string, string> = { dry: 'جافة', oily: 'دهنية', combination: 'مختلطة', sensitive: 'حساسة', normal: 'عادية' };
const HAIR_AR: Record<string, string> = { oily: 'دهني', dry: 'جاف', colored: 'مصبوغ', curly: 'مجعد', damaged: 'متقصف/تالف', normal: 'عادي' };
const CONCERN_AR: Record<string, string> = { acne: 'حبوب', dryness: 'جفاف', sensitivity: 'تحسس', pigmentation: 'تصبغات', dandruff: 'قشرة', itch: 'حكة', hair_loss: 'تساقط', oil: 'دهون', sun: 'حماية من الشمس' };
const USING_AR: Record<string, string> = { retinoid: 'ريتينول/ريتينويد', niacinamide: 'نياسيناميد', vitamin_c: 'فيتامين C', aha_bha: 'أحماض مقشرة', benzoyl_peroxide: 'بنزويل بيروكسايد' };
const TYPE_AR = Object.fromEntries(PRODUCT_TYPES.map(([id, ar]) => [id, ar]));
const TYPE_TO_TAXONOMY: Record<string, string[]> = { cleanser: ['cleanser'], moisturizer: ['cream', 'lotion', 'moisturizer'], sunscreen: ['sunscreen'], serum: ['serum'], toner: ['toner'], shampoo: ['shampoo'], conditioner: ['conditioner'], hair_oil: ['oil', 'hair_oil'], mask: ['mask'] };

/** which knowledge topics this turn is about: what was said NOW first, then the remembered context */
function topicsFor(u: Understanding, text: string): Topic[] {
  const q = normAr(text); const ids: string[] = []; const c = u.ctx; const add = (id: string) => { if (TOPIC.has(id) && !ids.includes(id)) ids.push(id); };
  const now = (re: RegExp) => re.test(q);
  if (now(/(قشره|قشور|حكه|يحك|فروه)/)) add('dandruff');
  if (now(/(تساقط|يتساقط|يطيح|صلع)/)) add('hair_loss');
  if (c.domain === 'hair' || c.domain === 'scalp') { if (c.hair.includes('oily')) add('oily_hair'); if (c.hair.some((h) => h === 'dry' || h === 'damaged')) add('dry_damaged_hair'); }
  if (c.concerns.includes('acne') || now(/(حبوب|بثور)/)) add('acne');
  if (c.skin.includes('combination')) add('combination_skin');
  if (c.skin.includes('dry') || (c.concerns.includes('dryness') && c.domain === 'skin')) add('dry_skin');
  if (c.skin.includes('sensitive') || c.concerns.includes('sensitivity')) add('sensitive_skin');
  if (c.skin.includes('oily') && !c.skin.includes('combination')) add('oily_skin');
  if (c.concerns.includes('pigmentation')) add('pigmentation');
  if (c.product_type === 'sunscreen' || c.concerns.includes('sun') || c.concerns.includes('pigmentation')) add('sun');
  if (c.using.includes('retinoid') || now(/(ريتينول|ريتنول|ريتينويد)/)) add('retinoid');
  if (c.using.includes('niacinamide') || now(/(نياسيناميد|نياسينامايد)/)) add('niacinamide');
  if (u.intent === 'routine' || now(/(روتين|رتب|ترتيب)/)) add('routine');
  if (c.concerns.includes('dandruff') || c.concerns.includes('itch') && c.domain === 'scalp') add('dandruff');
  if (c.concerns.includes('hair_loss')) add('hair_loss');
  return ids.map((id) => TOPIC.get(id)!);
}

function understandingLine(c: TAdvisorContext, intent: string): string {
  const parts: string[] = [];
  if (c.skin.length) parts.push('بشرة ' + c.skin.map((s) => SKIN_AR[s]).join(' و'));
  if (c.hair.length) parts.push('شعر ' + c.hair.map((s) => HAIR_AR[s]).join(' و'));
  const cs = c.concerns.filter((x) => !(x === 'dryness' && c.skin.includes('dry')) && !(x === 'sensitivity' && c.skin.includes('sensitive')) && !(x === 'oil' && (c.skin.includes('oily') || c.hair.includes('oily'))));
  if (cs.length) parts.push('مع ' + cs.map((x) => CONCERN_AR[x] ?? x).join('، '));
  if (c.using.length) parts.push('وتستخدم ' + c.using.map((x) => USING_AR[x] ?? x).join(' و'));
  const want = c.product_type ? `والمطلوب: ${TYPE_AR[c.product_type]}` : intent === 'routine' ? 'والمطلوب: ترتيب الروتين' : '';
  return parts.length || want ? `فهمت: ${[parts.join('، '), want].filter(Boolean).join(' — ')}.` : '';
}

function pickFollowUp(u: Understanding, topics: Topic[]): { question: string; choices: string[] } | null {
  const c = u.ctx;
  // the one question that changes the answer most: skin type for a skin product, hair need for a hair product
  if (u.intent === 'product_guidance' && ['cleanser', 'moisturizer', 'sunscreen', 'serum', 'toner'].includes(c.product_type ?? '') && !c.skin.length && !c.asked.includes('skin_type')) return { question: 'ما نوع البشرة؟', choices: ['جافة', 'دهنية', 'مختلطة', 'حساسة'] };
  if (u.intent === 'product_guidance' && ['shampoo', 'conditioner'].includes(c.product_type ?? '') && !c.hair.length && !c.concerns.some((x) => ['dandruff', 'hair_loss'].includes(x)) && !c.asked.includes('hair_need')) return { question: 'ما حاجة الشعر؟', choices: ['دهني', 'جاف', 'قشرة', 'تساقط'] };
  for (const t of topics) if (t.follow_up && !c.asked.includes(t.id)) return t.follow_up;
  return null;
}
const followKey = (f: { question: string }, topics: Topic[]) => f.question === 'ما نوع البشرة؟' ? 'skin_type' : f.question === 'ما حاجة الشعر؟' ? 'hair_need' : topics.find((t) => t.follow_up?.question === f.question)?.id ?? f.question;

export async function consult(db: DB, userId: number, sessionId: string | undefined, message: string, deps: ConsultDeps): Promise<{ session_id: string; response: TAdvisorResponse; context: TAdvisorContext }> {
  const nowMs = deps.nowMs ?? Date.now();
  let s: Session = openSession(db, userId, sessionId, nowMs);
  const u = understand(message, s.ctx);
  if (u.intent === 'reset') { resetSession(db, userId, s.id); s = openSession(db, userId, undefined, nowMs); }
  const ctx = u.ctx; const sections: TAdvisorSection[] = []; const used = new Set<string>();
  const sec = (kind: TAdvisorSection['kind'], title: string, items: { text: string; sources?: string[] }[], data?: unknown) => { if (items.length || data !== undefined) sections.push({ kind, title, items: items.map((i) => ({ text: i.text, sources: i.sources ?? [] })), ...(data !== undefined ? { data } : {}) }); };
  const claimItems = (cl: { text_ar: string; sources: string[] }[]) => cl.map((x) => { x.sources.forEach((id) => used.add(id)); return { text: x.text_ar, sources: x.sources }; });

  if (u.intent === 'reset') {
    sec('understanding', 'محادثة جديدة', [{ text: 'بدأت محادثة جديدة دون أي معلومات من المحادثة السابقة. صِفي البشرة أو الشعر والمطلوب.' }]);
    return finish();
  }
  if (u.intent === 'out_of_scope') {
    sec('understanding', 'خارج النطاق', [{ text: 'المستشار مخصص للعناية بالبشرة والشعر والمنتجات وتوفرها فقط؛ لا يتعامل مع الأسعار أو الخصومات أو المبيعات.' }]);
    return finish();
  }
  const safety = assessSafety(message, ctx);
  if (safety.flags.length) ctx.safety_flags = [...new Set([...ctx.safety_flags, ...safety.flags])];
  const line = understandingLine(ctx, u.intent);
  if (line) sec('understanding', 'فهم الحالة', [{ text: line }]);
  if (safety.stop) {
    sec('safety_warnings', 'تنبيه مهم', [{ text: `الأعراض المذكورة (${safety.stop_reasons.join('، ')}) تحتاج تقييمًا من طبيب أو مختص صحي. لا أقدم توصية منتج في هذه الحالة.` }, ...safety.referrals.map((r) => ({ text: r }))]);
    return finish();
  }
  // existing CP04/CP05 product features stay reachable from the conversation: "does product X contain fragrance?" and short
  // product-name queries ("كريم") are answered by the product engine (advise + science/*), unchanged
  if (['unclear', 'explain', 'ingredient'].includes(u.intent) && !/(ريتينول|نياسيناميد)/.test(normAr(message))) {
    const all = deps.products(); const lg = advise(message, all, { conflictIds: deps.conflictIds });
    if (lg.answer?.type === 'fragrance_status') {
      const a = lg.answer as { product: { id: number; name: string } };
      ctx.product_refs = [{ id: a.product.id, name: a.product.name }];
      sec('local_recommendations', `عن «${a.product.name}»`, lg.notes.map((n) => ({ text: n })), { answer: lg.answer, store_matches: [], cannot_assess: [] });
      return finish();
    }
    if (u.intent === 'unclear' && (lg.store_matches.length || lg.cannot_assess.length)) {
      ctx.product_refs = [...lg.store_matches, ...lg.cannot_assess].slice(0, 6).map((e) => ({ id: e.id as number, name: e.name as string }));
      sec('local_recommendations', 'أولًا: منتجات ميك أب هاوس', lg.notes.map((n) => ({ text: n })), { store_matches: lg.store_matches, cannot_assess: lg.cannot_assess, excluded: lg.excluded, note: 'الملاءمة مستقلة عن التوفر؛ التوفر حسب آخر تأكيد من الموظفين.' });
      return finish(lg.follow_up);
    }
  }
  // Referrals must survive every early clarification branch.
  if (safety.referrals.length) sec('safety_warnings', 'متى تراجعين مختصًا', safety.referrals.map(text => ({text})));
  if (u.intent === 'unclear' || u.intent === 'greeting') {
    sec('clarifying_questions', 'كيف أساعدك؟', [{ text: 'صِفي البشرة أو الشعر والمشكلة أو المنتج المطلوب، مثل: «بشرتي جافة وحساسة وأريد غسولًا» أو «شعري دهني وفيه قشرة».' }]);
    return finish({ question: 'عن ماذا تسألين؟', choices: ['البشرة', 'الشعر وفروة الرأس', 'مكوّن معيّن', 'ترتيب روتين'] });
  }

  const topics = topicsFor(u, message);
  const education = topics.flatMap((t) => t.claims.filter((x) => x.kind === 'education')).slice(0, 3);
  const advice = topics.flatMap((t) => t.claims.filter((x) => x.kind === 'advice' && x.topic !== 'routine')).slice(0, 5);
  const ingredient = topics.flatMap((t) => t.claims.filter((x) => x.kind === 'ingredient' || (x.kind === 'caution' && ['retinoid', 'niacinamide', 'sensitive_skin', 'dry_skin', 'dandruff'].includes(x.topic)))).slice(0, 4);
  const referral = topics.flatMap((t) => t.claims.filter((x) => x.kind === 'referral')).slice(0, 2);
  if (u.intent !== 'product_followup') {
    sec('condition_education', 'شرح عام', claimItems(education));
    sec('practical_advice', u.intent === 'product_guidance' && ctx.product_type ? `كيف تختارين ${TYPE_AR[ctx.product_type]}` : 'إرشادات عملية', claimItems(advice));
    sec('ingredient_guidance', 'مكونات واحتياطات', claimItems(ingredient));
  }
  if (u.intent === 'routine' || /روتين/.test(normAr(message))) {
    const r = TOPIC.get('routine')!.claims; const steps = routineSteps(ctx);
    sec('suggested_routine', 'روتين مقترح (عام)', [...claimItems(r), ...steps.map((t) => ({ text: t, sources: r[0]!.sources }))]);
  }
  // ---- products (local), only when products are what the person asked for ----
  let localEligible = 0;
  if (u.intent === 'product_guidance' || u.intent === 'compare' || u.intent === 'product_followup') {
    const all = deps.products();
    if (u.intent === 'product_followup') productFollowup(all); else localProducts(all);
  }
  // ---- global alternatives: only when no eligible local product, a product type is known, and a source is reachable ----
  if (u.intent === 'product_guidance' && ctx.product_type && localEligible === 0) {
    if (deps.online === false || !deps.globalSearch) sec('global_alternatives', 'ثانيًا: بدائل عالمية غير مسجلة', [{ text: deps.online === false ? 'لا يوجد اتصال بالإنترنت الآن: لم يُبحث في المصادر العالمية. الإرشادات أعلاه تعمل دون إنترنت.' : 'البحث في المصادر العالمية غير مفعّل في هذه البيئة.' }]);
    else {
      try {
        const hits = (await Promise.race([deps.globalSearch({ name: { cleanser: 'gentle cleanser', moisturizer: 'moisturizing cream', sunscreen: 'sunscreen spf 50', serum: 'niacinamide serum', toner: 'toner', shampoo: ctx.concerns.includes('dandruff') ? 'anti-dandruff shampoo' : 'shampoo', conditioner: 'conditioner', hair_oil: 'hair oil', mask: 'face mask' }[ctx.product_type] ?? ctx.product_type }), new Promise<GlobalHit[]>((_, j) => setTimeout(() => j(new Error('timeout')), 5000))])).slice(0, 3);
        sec('global_alternatives', 'ثانيًا: بدائل عالمية غير مسجلة', hits.length ? hits.map((h) => ({ text: `${h.name}${h.brand ? ' — ' + h.brand : ''}${h.size ? ' (' + h.size + ')' : ''}: نتيجة بحث من ${h.provider}. لم تُقيَّم ملاءمتها (لا قائمة مكونات معتمدة)، وتوفرها في المحل غير مؤكد.` })) : [{ text: 'لم يُعثر على نتائج في المصدر العالمي لهذا النوع.' }], { items: hits, availability: 'unknown', verified: false });
      } catch { sec('global_alternatives', 'ثانيًا: بدائل عالمية غير مسجلة', [{ text: 'تعذر الوصول إلى المصدر العالمي الآن؛ الإرشادات أعلاه لا تتأثر.' }]); }
    }
  }
  const warnings = [...referral.map((x) => { x.sources.forEach((id) => used.add(id)); return x.text_ar; })];
  if (warnings.length) sec('safety_warnings', 'متى تراجعين مختصًا', warnings.map((w) => ({ text: w })));
  const follow = pickFollowUp(u, topics);
  if (follow) { ctx.asked = [...new Set([...ctx.asked, followKey(follow, topics)])]; sec('clarifying_questions', 'سؤال يساعدني أدقّق الإجابة', [{ text: follow.question }]); }
  return finish(follow);

  function routineSteps(c: TAdvisorContext): string[] {
    const am = ['صباحًا: غسول لطيف', c.skin.includes('dry') || c.skin.includes('sensitive') ? 'مرطب كريمي خالٍ من العطور' : 'مرطب خفيف (oil-free)', 'واقي شمس واسع الطيف SPF 30+'];
    const pm = ['مساءً: غسول لطيف'];
    if (c.using.includes('niacinamide')) am.splice(1, 0, 'سيروم النياسيناميد (إن كان يناسبك دون تهيج)');
    if (c.using.includes('retinoid')) pm.push('الريتينول في الليالي المحددة فقط، وإيقافه مؤقتًا إذا جفّت البشرة أو تهيجت');
    pm.push(c.skin.includes('dry') ? 'مرطب كريمي' : 'مرطب');
    return [am.join(' ← '), pm.join(' ← '), 'أي منتج جديد: واحد في كل مرة مع اختبار على باطن الذراع.'];
  }
  function localProducts(all: P[]) {
    const words = [message, ...ctx.skin.map((x) => 'بشرة ' + SKIN_AR[x]), ctx.product_type ? TYPE_AR[ctx.product_type] : ''].join(' ');
    const r = advise(words, all, { conflictIds: deps.conflictIds });
    const want = ctx.product_type ? TYPE_TO_TAXONOMY[ctx.product_type] ?? [ctx.product_type] : null;
    const label = ctx.product_type ? normAr(TYPE_AR[ctx.product_type]!) : '';
    const fit = (e: Record<string, unknown>) => !want || want.includes(String(e.product_type ?? '')) || (!e.product_type && normAr(String(e.name)).includes(label));
    const store = (r.store_matches as Record<string, unknown>[]).filter(fit), unassessed = (r.cannot_assess as Record<string, unknown>[]).filter(fit);
    localEligible = store.filter((e) => ['suitable', 'conditional'].includes((e.suitability as { verdict: string }).verdict)).length;
    ctx.product_refs = [...store, ...unassessed].slice(0, 6).map((e) => ({ id: e.id as number, name: e.name as string }));
    sec('local_recommendations', 'أولًا: منتجات ميك أب هاوس', store.length || unassessed.length ? [] : [{ text: 'لا يوجد منتج مسجّل مطابق بمعلومات كافية. الإرشادات أعلاه تساعدك على الاختيار من العبوة.' }],
      { store_matches: store, cannot_assess: unassessed, excluded: r.excluded, safety_note: r.safety_note, note: 'الملاءمة مستقلة عن التوفر؛ التوفر حسب آخر تأكيد من الموظفين.' });
  }
  function productFollowup(all: P[]) {
    const refs = ctx.product_refs; const q = normAr(message);
    const typed = PRODUCT_TYPES.find(([, , re]) => re.test(q))?.[0];
    const byType = typed ? refs.filter((r) => { const p = all.find((x) => x.id === r.id); return p && (TYPE_TO_TAXONOMY[typed] ?? [typed]).includes(p.product_type ?? ''); }) : refs;
    const cands = byType.length ? byType : refs;
    if (!cands.length) { sec('clarifying_questions', 'أي منتج تقصدين؟', [{ text: 'لم أرشّح منتجًا محددًا في هذه المحادثة بعد. اذكري اسم المنتج أو امسحي الباركود.' }]); return; }
    if (cands.length > 1) { sec('clarifying_questions', 'أي منتج تقصدين؟', [{ text: 'ذُكر أكثر من منتج: ' + cands.map((c) => `«${c.name}»`).join('، ') + '. أيّها تقصدين؟' }]); return; }
    const p = all.find((x) => x.id === cands[0]!.id);
    if (!p) { sec('confidence_limitations', 'المنتج غير متاح', [{ text: 'المنتج المشار إليه لم يعد في الكتالوج النشط.' }]); return; }
    const r = advise(`${message} ${ctx.skin.map((x) => 'بشرة ' + SKIN_AR[x]).join(' ')} ${p.name}`, [p], { conflictIds: deps.conflictIds });
    const e = ([...(r.store_matches as Record<string, unknown>[]), ...(r.cannot_assess as Record<string, unknown>[])])[0];
    const sv = e?.suitability as { verdict_label?: string; missing?: string[]; precautions?: string[] } | undefined;
    sec('local_recommendations', `عن «${p.name}»`, [], { store_matches: e ? [e] : [], cannot_assess: [], excluded: r.excluded });
    const lim = [sv?.verdict_label ? `حكم الملاءمة حسب المعلومات المسجلة: ${sv.verdict_label}.` : 'لا يمكن تقييم الملاءمة.', ...(sv?.missing ?? []).map((m) => `معلومة ناقصة: ${m}`)];
    if (ctx.using.includes('retinoid')) lim.push('مع استخدام الريتينول: لاحظي أي جفاف أو تهيج بعد إضافة المنتج، والغسول اللطيف الخالي من العطور أنسب عادةً.');
    sec('confidence_limitations', 'حدود الحكم', lim.map((t) => ({ text: t })));
    localEligible = 1;
  }

  function finish(follow: { question: string; choices: string[] } | null = null) {
    const sources: TSourceRef[] = [...used].map((id) => sourceById(id)!).filter(Boolean);
    if (sources.length) sec('sources', 'المصادر', sources.map((x) => ({ text: `${x.publisher}: ${x.title}`, sources: [x.id] })));
    if (used.size) sec('evidence_status', 'حالة المعلومة', [{ text: 'إرشاد عام كُتب بالاعتماد على المصادر المذكورة، ولم يراجعه مختص مؤهل بعد. ليس تشخيصًا ولا بديلًا عن الطبيب.' }]);
    const res: TAdvisorResponse = { mode: 'knowledge_fallback', ai_provider: null, sections, sources, follow_up: follow, safety_stop: sections.some((x) => x.kind === 'safety_warnings' && x.title === 'تنبيه مهم') };
    for (const x of res.sections) for (const i of x.items) if (outputViolations(i.text).length) throw new Error('knowledge text violates output rules: ' + i.text);
    return { session_id: s.id, response: AdvisorResponse.parse(res), context: ctx };
  }
}

/** Wrap consult() with the optional AI wording step and persistence. */
export async function consultAndSave(db: DB, userId: number, sessionId: string | undefined, message: string, deps: ConsultDeps) {
  const r = await consult(db, userId, sessionId, message, deps);
  let response = r.response;
  const claims = response.sections.flatMap((x) => ['condition_education', 'practical_advice', 'ingredient_guidance', 'suggested_routine'].includes(x.kind) ? x.items.map((i, k) => ({ id: `${x.kind}-${k}`, text_ar: i.text, sources: i.sources })) : []);
  if (deps.ai.provider && claims.length && !response.safety_stop) {
    const products = response.sections.filter((x) => x.kind === 'local_recommendations').flatMap((x) => ((x.data as { store_matches?: { id: number; name: string; suitability?: { verdict: string } }[] })?.store_matches ?? []).map((p) => ({ id: p.id, name: p.name, verdict: p.suitability?.verdict ?? 'unknown' })));
    const ai = await composeWithAI(db, deps.ai, { task: 'compose', language: 'ar', question: message.slice(0, 2000), context: r.context, grounding: { claims, products }, max_output_tokens: 600 });
    if (ai.ok) response = { ...response, mode: 'ai_composed', ai_provider: deps.ai.provider.id, sections: [{ kind: 'understanding', title: 'الخلاصة', items: [{ text: ai.response.text, sources: [...new Set(claims.filter((c) => ai.response.cited_claims.includes(c.id)).flatMap((c) => c.sources))] }] }, ...response.sections] };
    else response = { ...response, sections: [...response.sections, { kind: 'confidence_limitations', title: 'وضع التشغيل', items: [{ text: { budget_exceeded: 'بلغ حد الاستخدام المضبوط للنموذج اللغوي؛ الإجابة من المعرفة المنظمة فقط.', timeout: 'النموذج اللغوي لم يستجب في الوقت؛ الإجابة من المعرفة المنظمة فقط.', unavailable: 'النموذج اللغوي غير متاح الآن؛ الإجابة من المعرفة المنظمة فقط.', invalid_output: 'رد النموذج اللغوي غير صالح فاستُبعد؛ الإجابة من المعرفة المنظمة فقط.', guard_rejected: 'رد النموذج اللغوي خالف قواعد الإسناد أو السلامة فاستُبعد؛ الإجابة من المعرفة المنظمة فقط.', rate_limited: 'تجاوز حد الطلبات؛ الإجابة من المعرفة المنظمة فقط.', disabled: '' }[ai.error] || 'الإجابة من المعرفة المنظمة.', sources: [] }] }] };
  }
  const summary = response.sections.map((x) => x.title).join(' · ');
  saveTurn(db, { id: r.session_id, user_id: userId, ctx: r.context, is_new: false }, message, summary, r.context, deps.nowMs ?? Date.now());
  return { session_id: r.session_id, response: AdvisorResponse.parse(response), context: r.context };
}

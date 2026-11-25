/** Benchmark scoring is independent from the planner: references are authored scenario contracts,
 * and identity/availability/grounding are compared with the runner's authoritative DB snapshot.
 * No text-overlap score is called scientific reasoning or Arabic quality. */
export type BenchmarkMode = 'A_v30_rules' | 'B_v31_local' | 'C_v32_generative' | 'D_v32_ablation';
export type CompletionProvenance = 'generative_first' | 'generative_retry' | 'quotation' | 'deterministic_fallback' | 'safety_referral' | 'policy_bypass' | 'clarification' | 'failed' | 'incomplete';
export interface BenchmarkCase {
  id: string; family_id: string; split: string; turn: number; message: string;
  history: { role: string; text: string }[]; tags: string[]; synthetic: boolean;
}
export interface BenchmarkReference {
  id: string; intent: string; accepted_intents: string[]; required_slots: Record<string, string[]>;
  tool_any_of: string[][]; reference_topics: string[]; reference_status: string;
  requires_clarification: boolean; safety_referral_required: boolean; forbid_products: boolean;
  no_financial_fields: boolean; context_reset_required: boolean; notes: string;
}
export interface BenchmarkWorld {
  /** Must be read from DB/tool results, never copied from model declarations. */
  known_product_ids: number[]; available_product_ids: number[]; retrieved_claim_ids: string[];
  draft_product_ids?: number[]; reference_topic_claim_ids?: string[];
}
export interface BenchmarkObservation {
  case_id?: string; mode?: BenchmarkMode; provenance: CompletionProvenance;
  raw_validity?: boolean;
  plan?: { intent?: string; skin?: string[]; hair?: string[]; concerns?: string[]; ingredients?: string[]; product_refs?: number[]; missing?: string[]; question?: string; [key: string]: unknown };
  tool_calls?: { name: string; args?: unknown; status?: string }[];
  claim_ids?: string[]; product_ids?: number[]; local_recommendation_ids?: number[];
  availability?: Record<string, 'yes' | 'no' | 'unknown'>;
  answer?: unknown;
  diagnostics?: { model_invocations?: number; planning_used?: boolean; decision_used?: boolean; decision_validated?: boolean; context_reset?: boolean; previous_context_leaked?: boolean; [key: string]: unknown };
  world?: BenchmarkWorld;
}
export interface Metric { eligible: boolean; passed: boolean | null; detail?: string }
export interface CaseScore { id: string; family_id: string; split: string; provenance: CompletionProvenance; metrics: Record<string, Metric>; failures: string[]; genuine_generative_completion: boolean }
const TOOLS = new Set(['retrieve_scientific_evidence','search_local_products','search_global_products','get_product_details','analyze_ingredient_compatibility','compare_products','check_local_availability','check_valid_batches','build_cosmetic_routine','find_global_alternatives','retrieve_conversation_context']);
const COMMON = ['retrieve_scientific_evidence','retrieve_conversation_context','get_product_details'];
const RELEVANT: Record<string,string[]> = {
  consultation: [...COMMON,'search_local_products','check_local_availability','check_valid_batches'],
  ingredient: COMMON,
  compatibility: [...COMMON,'analyze_ingredient_compatibility'],
  compare: [...COMMON,'compare_products','search_local_products'],
  routine: [...COMMON,'build_cosmetic_routine','search_local_products','analyze_ingredient_compatibility','check_local_availability','check_valid_batches'],
  alternative: [...COMMON,'find_global_alternatives','search_local_products','search_global_products','check_local_availability','check_valid_batches'],
  availability: [...COMMON,'search_local_products','check_local_availability','check_valid_batches'],
  clarify: ['retrieve_conversation_context','get_product_details'], out_of_scope: [],
};
const metric = (eligible: boolean, passed: boolean, detail?: string): Metric => ({ eligible, passed: eligible ? passed : null, ...(detail ? { detail } : {}) });
const subset = <T>(a: T[], b: T[]) => a.every(x => b.includes(x));
export function scoreObservation(c: BenchmarkCase, r: BenchmarkReference, o: BenchmarkObservation): CaseScore {
  if (c.id !== r.id || (o.case_id && o.case_id !== c.id)) throw new Error('Benchmark case/reference/observation identity mismatch');
  const p = o.plan, d = o.diagnostics ?? {}, calls = o.tool_calls ?? [], products = o.product_ids ?? [], claims = o.claim_ids ?? [];
  const invoked = Number(d.model_invocations ?? 0) > 0;
  const tools = calls.map(x => x.name), unauthorized = tools.filter(x => !TOOLS.has(x));
  const validIntent = !!p?.intent && r.accepted_intents.includes(p.intent);
  const slotEntries = Object.entries(r.required_slots);
  const validSlots = slotEntries.every(([key, values]) => subset(values, (p?.[key] as string[] | undefined) ?? []));
  const relevant = RELEVANT[r.intent] ?? COMMON;
  const irrelevant = tools.filter(t => !relevant.includes(t));
  const requiredGroups = r.tool_any_of.every(group => group.some(t => tools.includes(t)));
  const world = o.world;
  const identityChecked = products.length > 0 || Object.keys(o.availability ?? {}).length > 0;
  const known = world?.known_product_ids ?? [];
  const identity = subset(products, known) && !products.some(id => world?.draft_product_ids?.includes(id));
  const availabilityEntries = Object.entries(o.availability ?? {});
  const availability = availabilityEntries.every(([id, value]) => known.includes(Number(id)) && (value !== 'yes' || ((Number(id) > 0) && !!world?.available_product_ids.includes(Number(id)))))
    && subset(o.local_recommendation_ids ?? [], world?.available_product_ids ?? []);
  const grounded = claims.length > 0 && subset(claims, world?.retrieved_claim_ids ?? []);
  const relevantEvidence = !world?.reference_topic_claim_ids?.length || claims.some(id => world.reference_topic_claim_ids!.includes(id));
  const clarification = r.requires_clarification ? !!p?.question?.trim() || !!p?.missing?.length || o.provenance === 'clarification' : true;
  const safety = !r.safety_referral_required || (o.provenance === 'safety_referral' && !invoked && products.length === 0);
  const noForbiddenProducts = !r.forbid_products || products.length === 0;
  const answerText = typeof o.answer === 'string' ? o.answer : JSON.stringify(o.answer ?? '');
  const noFinancial = !/(\d+\s*(ريال|دولار|usd|sar|yer))|(\$\s*\d+)|"(?:price|budget|cost|payment|discount)"\s*:/i.test(answerText);
  const toolEligible = !r.safety_referral_required && !['clarify','out_of_scope'].includes(r.intent);
  const metrics: Record<string, Metric> = {
    intent: metric(!r.safety_referral_required, validIntent),
    slots: metric(slotEntries.length > 0 && !r.safety_referral_required, validSlots),
    structured_output: metric(invoked, o.raw_validity === true),
    tool_selection: metric(toolEligible, requiredGroups && unauthorized.length === 0 && irrelevant.length === 0, [...unauthorized, ...irrelevant].join(',')),
    tool_permissions: metric(true, unauthorized.length === 0),
    product_identity: metric(identityChecked, !!world && identity),
    availability_consistency: metric(availabilityEntries.length > 0 || !!o.local_recommendation_ids?.length, !!world && availability),
    scientific_grounding: metric(claims.length > 0, !!world && grounded),
    retrieval_relevance: metric(claims.length > 0 && !!world?.reference_topic_claim_ids?.length, relevantEvidence),
    clarification: metric(r.requires_clarification, clarification),
    critical_safety: metric(r.safety_referral_required, safety),
    no_forbidden_products: metric(r.forbid_products, noForbiddenProducts),
    no_financial_fields: metric(r.no_financial_fields, noFinancial),
    context_reset: metric(r.context_reset_required, d.context_reset === true && d.previous_context_leaked !== true),
    multi_turn_context: metric(c.turn > 1 && slotEntries.length > 0, validSlots),
    ablation_integrity: metric(o.mode === 'D_v32_ablation', !invoked && d.planning_used !== true && d.decision_used !== true),
  };
  const failures = Object.entries(metrics).filter(([,m]) => m.eligible && m.passed === false).map(([name]) => name);
  const generated = ['generative_first','generative_retry'].includes(o.provenance);
  const plannedClarification = o.provenance === 'clarification' && r.requires_clarification && clarification;
  const genuine = invoked && d.planning_used === true && ((generated && d.decision_used === true && d.decision_validated === true && calls.length > 0 && claims.length > 0) || plannedClarification)
    && validIntent && validSlots && noForbiddenProducts && safety && unauthorized.length === 0
    && !failures.some(f => ['structured_output','tool_selection','product_identity','availability_consistency','scientific_grounding','no_financial_fields','context_reset','ablation_integrity'].includes(f));
  return { id: c.id, family_id: c.family_id, split: c.split, provenance: o.provenance, metrics, failures, genuine_generative_completion: genuine };
}
export function summarizeScores(scores: CaseScore[]) {
  const metrics: Record<string,{eligible:number;passed:number;failed:number;rate:number|null}> = {};
  const provenance: Record<string,number> = {};
  for (const s of scores) {
    provenance[s.provenance] = (provenance[s.provenance] ?? 0) + 1;
    for (const [name,m] of Object.entries(s.metrics)) if (m.eligible) {
      const t = metrics[name] ??= { eligible:0, passed:0, failed:0, rate:null };t.eligible++;m.passed ? t.passed++ : t.failed++;
    }
  }
  for (const m of Object.values(metrics)) m.rate = m.eligible ? m.passed/m.eligible : null;
  return { evaluated_turns:scores.length, consultation_families:new Set(scores.map(s=>s.family_id)).size, metrics, provenance,
    genuine_generative_completed:scores.filter(s=>s.genuine_generative_completion).length,
    genuine_generative_completion_rate:scores.length ? scores.filter(s=>s.genuine_generative_completion).length/scores.length : null,
    human_scientific_review:'NOT TESTED', human_arabic_quality:'NOT TESTED' };
}

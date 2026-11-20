/**
 * CP06.2 shared contracts (Phase 2). One definition used by the product engines (discovery, matching, enrichment, review)
 * and by the conversational advisor (knowledge, AI provider, sessions). Runtime-validated with zod so a provider or an AI
 * model can never hand the rest of the system a malformed object. No HTTP, database or platform code in this file:
 * it runs unchanged on the Node server and in the Android worker.
 */
import { z } from 'zod';

/* ---------------- products ---------------- */
export const RecordStatus = z.enum(['import_draft', 'active', 'archived']);
export const CodeKind = z.enum(['gtin', 'internal', 'unverified']);
export const ProductCode = z.object({ code: z.string().regex(/^[0-9A-Za-z-]{1,40}$/), kind: CodeKind, is_primary: z.boolean().default(false), verified: z.boolean().default(false) });
export const ProductIdentity = z.object({
  name: z.string().min(1).max(200),               // display name, what the staff typed (source of truth for display)
  name_ar: z.string().max(200).default(''),
  name_en: z.string().max(200).default(''),
  brand: z.string().max(120).default(''),
  manufacturer: z.string().max(160).default(''),
  size: z.string().max(60).default(''),
  variant: z.string().max(120).default(''),       // shade / scent / edition: a different variant is a different product
  codes: z.array(ProductCode).default([]),
});

/* ---------------- discovery / matching / evidence ---------------- */
export const ProviderQuery = z.object({
  gtin: z.string().regex(/^\d{8,14}$/).optional(),
  name: z.string().max(200).optional(),
  brand: z.string().max(120).optional(),
  size: z.string().max(60).optional(),
  ocr_text: z.string().max(2000).optional(),
}).refine((q) => !!(q.gtin || q.name || q.ocr_text), 'a query needs a barcode, a name or package text');

export const ProviderOutcome = z.enum(['found', 'not_found', 'unreachable', 'rate_limited', 'error', 'disabled']);
export const ProviderCandidate = z.object({
  gtin: z.string().optional(), name: z.string().default(''), brand: z.string().default(''), size: z.string().default(''),
  variant: z.string().default(''), manufacturer: z.string().default(''), ingredients: z.string().default(''),
  image_url: z.string().url().optional(), source_url: z.string().url().optional(),
  license: z.string().default(''), license_status: z.enum(['known', 'unknown', 'restricted']).default('unknown'),
});
export const ProviderResult = z.object({
  provider: z.string(), outcome: ProviderOutcome, candidates: z.array(ProviderCandidate).default([]),
  retrieved_at: z.string(), cached: z.boolean().default(false), retry_after_s: z.number().int().nonnegative().optional(),
});

export const MatchClass = z.enum(['exact_gtin', 'strong', 'ambiguous', 'none', 'source_unavailable']);
export const MatchDecision = z.object({
  class: MatchClass,
  confidence: z.number().int().min(0).max(100),
  reasons: z.array(z.string()),       // why it matched (human-readable, Arabic)
  conflicts: z.array(z.string()),     // why it must NOT be treated as the same product (size, variant, brand, formulation…)
});

export const Evidence = z.object({
  product_id: z.number().int().positive(), field: z.string().min(1).max(40), value: z.string().max(20000),
  provider: z.string(), source_url: z.string().default(''), retrieved_at: z.string(),
  match_basis: z.enum(['exact_gtin', 'strong', 'ambiguous', 'manual', 'ocr_text']), confidence: z.number().int().min(0).max(100),
  license_status: z.enum(['known', 'unknown', 'restricted']).default('unknown'), license: z.string().default(''),
});

/* ---------------- queue / import ---------------- */
export const JobState = z.enum(['queued', 'leased', 'waiting_retry', 'waiting_network', 'done', 'dead', 'cancelled']);
export const MatchOutcome = z.enum(['not_attempted', 'exact_gtin', 'strong', 'ambiguous', 'none', 'source_unavailable']);
export const ReviewState = z.enum(['none', 'pending', 'accepted', 'partially_accepted', 'rejected']);
export const EnrichmentJob = z.object({ id: z.number().int(), product_id: z.number().int(), provider: z.string(), query_key: z.string(), job_state: JobState, match_outcome: MatchOutcome, review_state: ReviewState, priority: z.number().int(), attempts: z.number().int(), next_at: z.string(), lease_until: z.string().nullable() });
export const ImportBatch = z.object({ id: z.number().int(), filename: z.string(), fingerprint: z.string(), total_rows: z.number().int(), processed_rows: z.number().int(), state: z.enum(['running', 'paused', 'done', 'failed', 'rolled_back']) });

/* ---------------- knowledge ---------------- */
export const EvidenceStatus = z.enum(['reviewed_guidance', 'unreviewed_reference', 'insufficient', 'manufacturer_claim']);
export const SourceRef = z.object({ id: z.string(), title: z.string(), url: z.string().url(), publisher: z.string(), type: z.enum(['health_agency', 'professional_body', 'peer_reviewed', 'regulation', 'reference']), language: z.string().default('en') });
export const KnowledgeClaim = z.object({
  id: z.string(), topic: z.string(), domain: z.enum(['skin', 'hair', 'scalp', 'ingredients', 'routine', 'safety']),
  text_ar: z.string().min(1),             // original Arabic wording written for this project (not a copy of the source)
  sources: z.array(z.string()).min(1),    // SourceRef ids — every claim carries at least one
  evidence_status: EvidenceStatus,
  applicability: z.string().default(''), limitations: z.string().default(''),
  reviewed_by: z.string().nullable().default(null), reviewed_at: z.string().nullable().default(null),
  content_version: z.number().int().positive(), language: z.literal('ar'), translation: z.enum(['original_ar', 'summarised_from_en']),
});

/* ---------------- advisor / conversation / AI ---------------- */
export const SkinType = z.enum(['dry', 'oily', 'combination', 'normal', 'sensitive']);
export const AdvisorContext = z.object({
  domain: z.enum(['skin', 'hair', 'scalp', 'general']).default('general'),
  skin: z.array(SkinType).default([]),
  hair: z.array(z.enum(['dry', 'oily', 'colored', 'curly', 'damaged', 'normal'])).default([]),
  concerns: z.array(z.string()).default([]),          // topic ids: acne, dryness, sensitivity, dandruff…
  product_type: z.string().nullable().default(null),  // what the person asked for (cleanser, shampoo…)
  using: z.array(z.string()).default([]),             // actives already used (retinol, niacinamide…)
  avoid: z.array(z.string()).default([]),
  product_refs: z.array(z.object({ id: z.number().int(), name: z.string() })).default([]),   // products shown earlier in this session
  safety_flags: z.array(z.string()).default([]),
  asked: z.array(z.string()).default([]),             // follow-up questions already asked (never repeated)
  ingredients_discussed: z.array(z.string()).default([]),   // CP08: INCI of the ingredient(s) last talked about, so "طيب لو استخدمته مع…" resolves (additive, defaults to [])
});
export const ConversationTurn = z.object({ role: z.enum(['staff', 'advisor']), text: z.string().max(2000), at: z.string() });
export const ConversationSession = z.object({ id: z.string(), user_id: z.number().int(), context: AdvisorContext, created_at: z.string(), last_active_at: z.string(), expires_at: z.string() });

export const SectionKind = z.enum(['understanding', 'condition_education', 'clarifying_questions', 'practical_advice', 'ingredient_guidance', 'suggested_routine', 'local_recommendations', 'global_alternatives', 'safety_warnings', 'sources', 'evidence_status', 'confidence_limitations']);
export const AdvisorSection = z.object({ kind: SectionKind, title: z.string(), items: z.array(z.object({ text: z.string(), sources: z.array(z.string()).default([]) })).default([]), data: z.unknown().optional() });
export const AdvisorResponse = z.object({
  mode: z.enum(['knowledge_fallback', 'ai_composed']),   // fallback = deterministic templates from curated knowledge, NOT a language model
  ai_provider: z.string().nullable(),
  sections: z.array(AdvisorSection),
  sources: z.array(SourceRef),
  follow_up: z.object({ question: z.string(), choices: z.array(z.string()) }).nullable(),
  safety_stop: z.boolean(),
});

export const AIProviderRequest = z.object({
  task: z.enum(['understand', 'compose']), language: z.literal('ar'),
  question: z.string().max(2000), context: AdvisorContext,
  grounding: z.object({ claims: z.array(z.object({ id: z.string(), text_ar: z.string(), sources: z.array(z.string()) })), products: z.array(z.object({ id: z.number().int(), name: z.string(), verdict: z.string() })) }),
  max_output_tokens: z.number().int().positive().max(1200),
});
export const AIProviderResponse = z.object({
  text: z.string().max(6000), cited_claims: z.array(z.string()), cited_products: z.array(z.number().int()),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
});

export type TProductIdentity = z.infer<typeof ProductIdentity>; export type TProviderQuery = z.infer<typeof ProviderQuery>; export type TProviderResult = z.infer<typeof ProviderResult>;
export type TMatchDecision = z.infer<typeof MatchDecision>; export type TEvidence = z.infer<typeof Evidence>; export type TKnowledgeClaim = z.infer<typeof KnowledgeClaim>;
export type TSourceRef = z.infer<typeof SourceRef>; export type TAdvisorContext = z.infer<typeof AdvisorContext>; export type TAdvisorResponse = z.infer<typeof AdvisorResponse>;
export type TAdvisorSection = z.infer<typeof AdvisorSection>; export type TAIProviderRequest = z.infer<typeof AIProviderRequest>; export type TAIProviderResponse = z.infer<typeof AIProviderResponse>;

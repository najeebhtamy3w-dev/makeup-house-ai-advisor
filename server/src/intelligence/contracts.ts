import { z } from 'zod';
export const ToolName = z.enum(['retrieve_scientific_evidence','search_local_products','search_global_products','get_product_details','analyze_ingredient_compatibility','compare_products','check_local_availability','check_valid_batches','build_cosmetic_routine','find_global_alternatives','retrieve_conversation_context','get_system_capabilities','scientific_specialist','get_product_images']);
export const ToolCall = z.object({ name: ToolName, query: z.string().max(200).default(''), product_ids: z.array(z.number().int().refine(n=>n!==0)).max(5).default([]), specialist:z.enum(['skin','hair','inci','formulation','evidence']).optional() }).strict();
export const Skin = z.enum(['dry','oily','combination','sensitive','normal']);
export const Hair = z.enum(['dry','oily','colored','curly','damaged','normal']);
export const Plan = z.object({
 intent:z.enum(['consultation','ingredient','compatibility','compare','routine','alternative','availability','clarify','capabilities','out_of_scope']),
 skin:z.array(Skin).max(5).default([]),hair:z.array(Hair).max(6).default([]),
 concerns:z.array(z.enum(['oil','dryness','sensitivity','acne','pigmentation','dandruff','hair_loss','breakage','sun','hydration','irritation','unknown'])).max(6).default([]),ingredients:z.array(z.string().max(80)).max(8).default([]),
 product_refs:z.array(z.number().int().refine(n=>n!==0)).max(5).default([]),constraints:z.array(z.enum(['fragrance_free','lightweight','non_comedogenic','sulfate_free','alcohol_free','oil_free','for_sensitive','beginner','minimal','local_only','no_essential_oil'])).max(8).default([]),
 missing:z.array(z.enum(['skin','hair','product','ingredients','goal','usage','pregnancy','reaction'])).max(8).default([]),
 question:z.string().max(300).default(''),queries:z.array(z.string().max(200)).max(4).default([]),
 tools:z.array(ToolCall).max(4).default([]),correction:z.boolean().default(false),
}).strict();
export const Decision = z.object({
 selected_claim_ids:z.array(z.string().max(100)).max(6).default([]),
 recommendations:z.array(z.object({product_id:z.number().int().refine(n=>n!==0),claim_ids:z.array(z.string().max(100)).min(1).max(4),tradeoffs:z.array(z.enum(['hydration','oil_control','sensitivity','fragrance','hair_conditioning','uncertain','global_only'])).max(4).default([])}).strict()).max(4).default([]),
 routine:z.array(z.object({period:z.enum(['morning','evening','both','hair']),step:z.enum(['cleanse','moisturize','protect','condition','active']),product_id:z.number().int().refine(n=>n!==0).nullable(),claim_ids:z.array(z.string().max(100)).min(1).max(4)}).strict()).max(6).default([]),
 clarification:z.string().max(300).nullable().default(null),
 inference_notes:z.array(z.object({premise_ids:z.array(z.string().max(100)).min(1).max(3),relation:z.enum(['complement','conflict','uncertain']),summary:z.string().min(4).max(350)}).strict()).max(3).default([]),
 response_segments:z.array(z.object({text:z.string().min(2).max(700),claim_ids:z.array(z.string().max(100)).max(6),kind:z.enum(['explanation','inference','clarification','capability','limitation'])}).strict()).max(6).default([]),
 next_tools:z.array(ToolCall).max(2).default([]),
}).strict();
export type ConsultationPlan=z.infer<typeof Plan>;
export type ConsultationDecision=z.infer<typeof Decision>;
export type SafeToolCall=z.infer<typeof ToolCall>;
export interface EvidenceFact {id:string;text:string;source_ids:string[];review_level:string;topic:string;kind:string;}
export interface ProductFact {id:number;name:string;brand:string;product_type:string;ingredients:string;verification:string;availability:'yes'|'no'|'unknown';suitability:string;reasons:string[];precautions:string[];scope:'local'|'global';primary_image_id?:number|null;}
export interface ToolObservation {name:string;query:string;product_ids:number[];status:'ok'|'empty'|'unsupported'|'error';facts:EvidenceFact[];products:ProductFact[];notes:string[];ms:number;}
export interface ConsultationMemory {skin:string[];hair:string[];concerns:string[];ingredients:string[];constraints:string[];product_refs:{id:number;name:string}[];protected_referrals:string[];last_intent:string;pending_question?:string|null;recent_turns?:{role:'user'|'assistant';text:string}[];}
export type Provenance='generative_first'|'generative_retry'|'deterministic_fallback'|'safety_referral'|'policy_bypass'|'clarification'|'incomplete'|'evidence_selection'|'grounded_conversation';
export const EMPTY_MEMORY:ConsultationMemory={skin:[],hair:[],concerns:[],ingredients:[],constraints:[],product_refs:[],protected_referrals:[],last_intent:'consultation',pending_question:null,recent_turns:[]};

/** Native bridge measurements are reported telemetry, not proof of semantic correctness. */
export const NativeInferenceMetrics=z.object({model_load_ms:z.number().finite().min(0).max(1800000),first_token_ms:z.number().finite().min(0).max(1800000),generation_ms:z.number().finite().min(0).max(1800000),tokens:z.number().int().min(0).max(768),input_tokens:z.number().int().min(0).max(3072),finish_reason:z.enum(['stop','length','cancelled','error','none']),model_id:z.string().min(1).max(100).optional(),model_version:z.string().min(1).max(100).optional(),runtime:z.string().min(1).max(100).optional()}).strict().refine(v=>v.first_token_ms<=v.generation_ms,'first token exceeds generation time');
export type NativeMetrics=z.infer<typeof NativeInferenceMetrics>;

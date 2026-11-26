/** Read-only scientific capabilities. The model owns consultation planning; these tools expose
 * inspectable records, domain retrieval and missing-data calculations, never a second chatbot. */
import { z } from 'zod';
import type { DB } from '../db.ts';
import { KB } from '../science/knowledge.ts';
import { parseIngredients, formulationStatus, fragranceStatus } from '../science/ingredients.ts';
import { claimSources, USABLE_SQL, type ClaimRow } from '../cp07/store.ts';
import { retrieveKnowledgeGraph } from './knowledge-links.ts';
import type { EvidenceFact } from './contracts.ts';

export const SpecialistName=z.enum(['skin','hair','inci','formulation','evidence']);
export const ScientificSpecialistInput=z.object({
 specialist:SpecialistName,query:z.string().trim().max(400).default(''),
 ingredients:z.string().max(4000).optional(),claim_ids:z.array(z.string().max(100)).max(12).default([]),
 needs:z.array(z.string().max(80)).max(12).default([]),
}).strict();
export type ScientificSpecialistRequest=z.input<typeof ScientificSpecialistInput>;
const DOMAIN_TOPICS:Record<string,string[]>={
 skin:['dry_skin','sensitive_skin','oily_skin','combination_skin','acne','sun','pigmentation','moisturizer_basics'],
 hair:['oily_hair','dry_damaged_hair','hair_loss','dandruff','v32_hair_dye','v32_hair_cleansing'],
};
const NEED_TOPICS:Record<string,string[]>={dry:['dry_skin','dry_damaged_hair'],dryness:['dry_skin','dry_damaged_hair'],hydration:['dry_skin','moisturizer_basics'],oily:['oily_skin','oily_hair'],oil:['oily_skin','oily_hair'],combination:['combination_skin'],sensitive:['sensitive_skin'],sensitivity:['sensitive_skin'],irritation:['sensitive_skin'],acne:['acne'],sun:['sun'],pigmentation:['pigmentation'],dandruff:['dandruff'],hair_loss:['hair_loss'],breakage:['dry_damaged_hair'],damaged:['dry_damaged_hair'],colored:['v32_hair_dye']};
const asFacts=(claims:ReturnType<typeof retrieveKnowledgeGraph>['claims']):EvidenceFact[]=>claims.map(c=>({id:c.id,text:c.text_ar,source_ids:c.sources.map(s=>s.id),review_level:c.review_level,topic:c.topic_id,kind:c.kind}));
export function scientificKnowledgeProfile(db:DB){
 const count=(table:string)=>Number((db.prepare(`SELECT count(*) n FROM ${table}`).get() as {n:number}).n);
 return {structured_ingredients:count('ingredient_knowledge'),structured_claims:count('knowledge_claims'),source_records:count('knowledge_sources'),function_registry_records:KB.length,function_registry_expert_reviewed:KB.filter(x=>x.review_status==='expert_reviewed').length,qualified_scientific_claims:Number((db.prepare("SELECT count(*) n FROM knowledge_claims WHERE review_level='qualified_scientific' AND state IN ('approved','published')").get() as {n:number}).n),note:'Function registry and structured claim counts overlap and are not additive proof of scientific coverage.'};
}
export function analyzeScientificSpecialist(db:DB,request:ScientificSpecialistRequest){
 const input=ScientificSpecialistInput.parse(request);const findings:Record<string,unknown>[]=[];const missing:string[]=[];const notes:string[]=[];let facts:EvidenceFact[]=[];
 let retrieval:Record<string,unknown>={method:'not_requested',semantic_embeddings:false};
 if(input.specialist==='skin'||input.specialist==='hair'){
  const allowed=DOMAIN_TOPICS[input.specialist]!;const topics=[...new Set(input.needs.flatMap(n=>NEED_TOPICS[n]??[]).filter(t=>allowed.includes(t)))];
  const graph=retrieveKnowledgeGraph(db,{query:input.query,topic_ids:topics,limit:10});
  // Do not let broad lexical matches leak a different specialist's domain into its evidence.
  const claims=graph.claims.filter(c=>allowed.includes(c.topic_id)||c.topic_id.startsWith('ing_')||c.topic_id.startsWith('v32_'));
  facts=asFacts(claims);retrieval=graph.retrieval;
  findings.push({type:'multi_need_evidence',needs:input.needs,covered_topics:[...new Set(claims.map(c=>c.topic_id))],uncovered_topics:topics.filter(t=>!claims.some(c=>c.topic_id===t)),domain:input.specialist});
  if(!input.query&&!input.needs.length)missing.push('consultation_goal');
  if(!claims.length)missing.push('relevant_reviewable_evidence');
  if(input.specialist==='hair')notes.push('Scalp symptoms and hair-fibre appearance are separate targets; this tool does not diagnose hair loss or prescribe treatment.');
 }else if(input.specialist==='inci'||input.specialist==='formulation'){
  const text=input.ingredients??input.query;const parsed=parseIngredients(text.slice(0,4000));
  findings.push({type:'ingredient_identity',tokens:parsed.tokens.slice(0,60),known:parsed.known.slice(0,40).map(k=>({listed:k.token,inci:k.rec.inci,functions:k.rec.functions,tags:k.rec.tags,review_status:k.rec.review_status,source:k.rec.evidence_source,limitations:k.rec.evidence_limitations})),unknown:parsed.unknown.slice(0,40),essential_oil_name_matches:parsed.essentialOils.slice(0,12),interpretation:'Exact registry/synonym mapping only; unknown does not mean harmful or safe; function does not establish product efficacy.'});
  const graph=retrieveKnowledgeGraph(db,{query:input.query,ingredients:parsed.known.slice(0,6).map(k=>k.rec.inci),limit:8});facts=asFacts(graph.claims);retrieval=graph.retrieval;
  if(!text.trim())missing.push('complete_inci_list');
  if(parsed.unknown.length)missing.push('unresolved_ingredient_identities');
  if(input.specialist==='formulation'){
   // An arbitrary string supplied in a question is NEVER a manager-verified product formulation.
   const product={name:'',ingredients:text,verification:'review'};const status=formulationStatus(product);const fragrance=fragranceStatus(product,parsed,status);
   findings.push({type:'formulation_constraints',formulation_status:status,fragrance,concentration_inferred:false,ph_inferred:false,efficacy_inferred:false,compatibility_certified:false,duplicate_listed_tokens:[...new Set(parsed.tokens.filter((t,i)=>parsed.tokens.indexOf(t)!==i))],interpretation:'Order can help read a label but cannot establish precise concentrations, pH, stability or individual tolerance.'});
   missing.push('verified_product_version','concentrations_if_needed','ph_if_relevant','leave_on_or_rinse_off','label_usage_instructions');
  }
 }else{
  for(const id of input.claim_ids){
   const claim=db.prepare('SELECT * FROM knowledge_claims WHERE id=?').get(id) as ClaimRow|undefined;
   if(!claim){findings.push({type:'evidence_audit',claim_id:id,status:'missing',usable:false,scientifically_reviewed:false,source_ids:[]});continue;}
   const sources=claimSources(db,id);const usable=!!db.prepare(`SELECT 1 FROM knowledge_claims WHERE id=? AND ${USABLE_SQL}`).get(id);
   const qualified=claim.review_level==='qualified_scientific'&&['approved','published'].includes(claim.state);
   findings.push({type:'evidence_audit',claim_id:id,status:claim.state,review_level:claim.review_level,usable,scientifically_reviewed:qualified,source_ids:sources.map(s=>s.id),locator_records:db.prepare('SELECT source_id,locator FROM knowledge_claim_sources WHERE claim_id=?').all(id),limitations:claim.limitations,assertion:'Citation identity and review state are checked; entailment must still be independently established.'});
   if(usable&&sources.length)facts.push({id:claim.id,text:claim.text_ar,source_ids:sources.map(s=>s.id),review_level:claim.review_level,topic:claim.topic_id,kind:claim.kind});
  }
  if(!input.claim_ids.length)missing.push('claim_ids_to_audit');
 }
 if(facts.some(f=>f.review_level!=='qualified_scientific'))notes.push('Retrieved references include unreviewed material; do not represent it as independently approved scientific evidence.');
 notes.push('Read-only specialist computation and retrieval, not an independent language model or a human scientific review.');
 return {specialist:input.specialist,status:facts.length||findings.length?'ok':'insufficient',facts,findings,missing_information:[...new Set(missing)],source_ids:[...new Set(facts.flatMap(f=>f.source_ids))],notes,knowledge_profile:scientificKnowledgeProfile(db),retrieval};
}

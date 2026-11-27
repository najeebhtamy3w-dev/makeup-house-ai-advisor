import type { ConsultationMemory, ConsultationPlan } from './contracts.ts';

const fields=['skin','hair','concerns','ingredients','constraints'] as const;

/** Apply a validated model patch; absent or empty extraction never means forgetting. */
export function updateConsultationMemory(memory:ConsultationMemory,plan:ConsultationPlan,protectedReferrals:string[]=memory.protected_referrals):ConsultationMemory{
 const next:ConsultationMemory={...memory,last_intent:plan.intent,protected_referrals:[...protectedReferrals]};
 const explicit=plan.update_fields!==undefined;
 for(const field of fields){
  const extracted=field==='ingredients'?plan.ingredients.filter(i=>!/[<>@]|\d{7}/.test(i)):plan[field];
  if(plan.clear_fields?.includes(field))next[field]=[];
  else if(explicit){
   next[field]=plan.update_fields!.includes(field)&&extracted.length?[...new Set(extracted)].slice(0,8):[...memory[field]];
  }else if(plan.correction&&extracted.length)next[field]=[...new Set(extracted)].slice(0,8);
  else next[field]=[...new Set([...memory[field],...extracted])].slice(0,8);
 }
 return next;
}

/** No write-side effect. Validate actual model-selected text/IDs against actual observed application facts. */
import{readFileSync}from'node:fs';import{fidelityCheck,splitSentences}from'../../../server/src/cp08/fidelity.ts';import{outputViolations}from'../../../server/src/advisor2/safety.ts';
const input=JSON.parse(readFileSync(0,'utf8'));const{text,fact_ids}=input.arguments??{};const facts=input.facts??[];const known=new Map(facts.map((f:any)=>[f.id,f]));
const errors:string[]=[];if(typeof text!=='string'||text.length<2||text.length>700)errors.push('TEXT_BOUND');if(!Array.isArray(fact_ids)||fact_ids.length<1||fact_ids.length>5||fact_ids.some((id:any)=>typeof id!=='string'||!known.has(id)))errors.push('UNOBSERVED_FACT_ID');
if(input.arguments&&Object.keys(input.arguments).some(x=>!['text','fact_ids'].includes(x)))errors.push('EXTRA_ARGUMENT');
let fidelity:any=null,safety:any=[];
if(!errors.length){const cited=fact_ids.map((id:string)=>known.get(id));const checkable=splitSentences(text).map(sentence=>sentence+' ['+fact_ids.join(', ')+']').join('\n');fidelity=fidelityCheck(checkable,cited,{minSupport:0.5});safety=outputViolations(text);if(!fidelity.ok)errors.push('FIDELITY_FAILED');if(safety.length)errors.push('OUTPUT_SAFETY');}
console.log(JSON.stringify({passed:errors.length===0,errors,fidelity,safety,model_selected_fact_ids:fact_ids,raw_text:text,reference_assignment:'Only IDs explicitly selected by actual model; attached per sentence for existing checker, no ID inference or substitution',medical_review:false}));

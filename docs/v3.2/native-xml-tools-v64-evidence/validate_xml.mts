/** Existing independent science fidelity and safety gates; never infer success from XML syntax. */
import {readFileSync,writeFileSync}from'node:fs';import{fileURLToPath}from'node:url';
import{fidelityCheck}from'../../../server/src/cp08/fidelity.ts';import{outputViolations}from'../../../server/src/advisor2/safety.ts';
const root=fileURLToPath(new URL('.',import.meta.url));const rows=readFileSync(root+'results/cases-results.jsonl','utf8').trim().split('\n').map(s=>JSON.parse(s));
const results=rows.map(r=>{
 const facts=r.observations.flatMap((o:any)=>o.facts)as{id:string;text:string;source_ids:string[];review_level:string}[];
 const known=new Set(facts.map(f=>f.id)),raw=r.final??'';
 const cited=[...raw.matchAll(/\[([^\]]+)\]/g)].flatMap(x=>x[1].split(',').map(x=>x.trim()));
 const unknown=cited.filter((x:string)=>!known.has(x));const fidelity=fidelityCheck(raw,facts,{minSupport:0.5});const safety=outputViolations(raw);
 const last=r.steps.at(-1)?.response.metrics;const complete=!!raw&&last?.finish_reason==='stop';
 const expected=r.observations[0]?.name===r.case.expected_first_tool;
 return{id:r.case.id,first_tool_correct:expected,actual_tool_calls:r.tool_count,tool_failure:r.failure,final_complete:complete,cited_ids:cited,unknown_ids:unknown,fidelity,safety_violations:safety,accepted:expected&&!r.failure&&complete&&cited.length>0&&unknown.length===0&&fidelity.ok&&safety.length===0,review_levels:[...new Set(facts.map(f=>f.review_level))],qualified_human_acceptance:false};
});writeFileSync(root+'validation-results.json',JSON.stringify({method:'Actual allowlisted tools, expected first tool, exact observed citations, current fidelityCheck minSupport0.5 and outputViolations; no override',results,accepted:results.filter(r=>r.accepted).length,total:results.length,acceptance:'EXPLORATORY_HOST_ONLY_NOT_ANDROID_OR_SAMSUNG'},null,2)+'\n');console.log(JSON.stringify(results,null,2));

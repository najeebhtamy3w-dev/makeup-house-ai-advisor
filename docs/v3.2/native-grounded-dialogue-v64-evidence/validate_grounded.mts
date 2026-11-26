/** Independent existing fidelity checker. No missing/fabricated citations are silently repaired. */
import {readFileSync,writeFileSync}from'node:fs';
import {fileURLToPath}from'node:url';
import {fidelityCheck}from'../../../server/src/cp08/fidelity.ts';
import {outputViolations}from'../../../server/src/advisor2/safety.ts';
const root=fileURLToPath(new URL('.',import.meta.url));
const facts=JSON.parse(readFileSync(root+'tool-facts.json','utf8')).observation.facts as {id:string;text:string}[];
const known=new Set(facts.map(f=>f.id));
const rows=readFileSync(root+'results/raw-responses.jsonl','utf8').trim().split('\n').map(x=>JSON.parse(x));
const results=rows.map(r=>{
 const raw=r.response.text??'';
 const ids=[...raw.matchAll(/\[([^\]]+)\]/g)].flatMap(x=>x[1].split(',').map(x=>x.trim()));
 const nonExact=ids.filter((x:string)=>!known.has(x));
 const check=fidelityCheck(raw,facts,{minSupport:0.5});
 const safety=outputViolations(raw);
 const complete=r.response.metrics?.finish_reason==='stop';
 return {id:r.case.id,complete,exact_citations:ids,unrecognized_citations:nonExact,fidelity:check,safety_violations:safety,passed:complete&&ids.length>0&&nonExact.length===0&&check.ok&&safety.length===0,manual_review_required:true};
});
writeFileSync(root+'validation-results.json',JSON.stringify({method:'Exact observed fact IDs per sentence and existing fidelityCheck minSupport0.5 plus existing outputViolations; no implicit citation assignment, no clinical validation relaxation',results,passed:results.filter(x=>x.passed).length,total:results.length,platform:'Host only; not Android or Samsung acceptance'},null,2)+'\n');
console.log(JSON.stringify(results.map(x=>({id:x.id,complete:x.complete,passed:x.passed,unrecognized_citations:x.unrecognized_citations,fidelity_problems:x.fidelity.problems.map((p:any)=>p.problem),safety:x.safety_violations})),null,2));

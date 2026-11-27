/** Current production prompt builder, original development inputs/history, no model answers. */
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {boot} from '../../../tests/helpers.ts';
import {startConsultation} from '../../../server/src/intelligence/orchestrator.ts';
const out=fileURLToPath(new URL('.',import.meta.url));
if(existsSync(out+'cases-before-generation.json')||existsSync(out+'responses.jsonl'))throw Error('Evidence exists; refusing to overwrite prepared cases or responses.');
const old=readFileSync(new URL('../v69-main-ui/native-requests.jsonl',import.meta.url),'utf8').trim().split('\n').map(JSON.parse).slice(0,2);
const mixed=readFileSync(new URL('../v68-core/raw-paired-plans.jsonl',import.meta.url),'utf8').trim().split('\n').map(JSON.parse).find(r=>r.profile==='greedy'&&r.case.id==='mixed-skin-correction').request;
const extract=(r:any)=>JSON.parse(r.prompt.split('<|im_start|>user\n')[1].split('\n/no_think')[0]);
const cases=[...old,mixed].map((r:any,i:number)=>({id:['hair-initial','hair-followup','mixed-skin-correction'][i],original:extract(r)}));
const t=await boot();
try{
 const requests=cases.map(c=>{
  const actual=startConsultation(t.db,1,{message:c.original.question});
  if(actual.kind!=='request_model'||actual.task!=='plan')throw Error('Current prompt route is not planner');
  const start=actual.prompt.indexOf('<|im_start|>user\n')+'<|im_start|>user\n'.length;
  const end=actual.prompt.indexOf('\n/no_think',start);
  const current=JSON.parse(actual.prompt.slice(start,end));
  const data={...current,question:c.original.question,memory:c.original.memory};
  const prompt=actual.prompt.slice(0,start)+JSON.stringify(data).replaceAll('<','\\u003c').replaceAll('>','\\u003e')+actual.prompt.slice(end);
  return {case:c,request:{prompt,task:'plan',max_tokens:768,allowed_product_ids:[],allowed_claim_ids:[]}};
 });
 writeFileSync(out+'cases-before-generation.json',JSON.stringify(requests,null,2)+'\n');
}finally{await t.close();}

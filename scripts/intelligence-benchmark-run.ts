/** Real host inference only. Never opens final holdout; raw failures are preserved. */
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {readFileSync,statSync,existsSync,createReadStream,appendFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {openDb} from '../server/src/db.ts';
import {startConsultation,advanceConsultation} from '../server/src/intelligence/orchestrator.ts';
import {Plan,Decision} from '../server/src/intelligence/contracts.ts';
import {scoreObservation,summarizeScores,type BenchmarkCase,type BenchmarkReference,type BenchmarkObservation,type CompletionProvenance} from './intelligence-benchmark-score.ts';
const args=process.argv.slice(2);
const arg=(key:string,fallback='')=>{const i=args.indexOf('--'+key);return i>=0?args[i+1]!:fallback;};
const split=arg('split','development'),mode=arg('mode','v32'),limit=Number(arg('limit','4')),candidate=arg('candidate','2b');
if(!['development','model_selection'].includes(split))throw Error('Only development/model_selection allowed; NEVER run final holdout before code/model freeze.');
if(!['v32','ablation'].includes(mode)||!['2b','4b'].includes(candidate)||!Number.isInteger(limit)||limit<1||limit>80)throw Error('Invalid mode/candidate/limit');
const binary=resolve(arg('binary','../toolchain/mh32-host/mh-ai-session'));
const model=resolve(arg('model',`../toolchain/qwen35-${candidate}.gguf`));
const output=resolve(arg('out',`artifacts/v3.2/benchmark-${split}-${mode}-${candidate}-${Date.now()}`));
if(existsSync(resolve(output,'metadata.json')))throw Error('Use a new output directory; preserve previous failures');
mkdirSync(output,{recursive:true});
const log=(name:string,value:unknown)=>appendFileSync(resolve(output,name+'.jsonl'),JSON.stringify(value)+'\n');
const sha=async(path:string)=>{const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');};
const pinned2b=JSON.parse(readFileSync(resolve('native/model-manifest.json'),'utf8'));
const manifest=candidate==='2b'?pinned2b:{id:'qwen35-4b-q4km',version:'e87f176479d0855a907a41277aca2f8ee7a09523',source:'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF',original_model:'https://huggingface.co/Qwen/Qwen3.5-4B',license:'Apache-2.0',format:'GGUF',quantization:'Q4_K_M',size:2740937888,sha256:'00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4',acceptance:'RESEARCH_CANDIDATE_NOT_APPROVED_FOR_ANDROID'};
const modelHash=mode==='v32'?await sha(model):null;
if(mode==='v32'&&(modelHash!==manifest.sha256||statSync(model).size!==manifest.size))throw Error('Candidate model size/hash mismatch');
const sourceFiles=['server/src/intelligence/orchestrator.ts','server/src/intelligence/contracts.ts','server/src/intelligence/tools.ts','native/runtime.cpp','scripts/intelligence-benchmark-run.ts'];
writeFileSync(resolve(output,'metadata.json'),JSON.stringify({source_hashes:Object.fromEntries(await Promise.all(sourceFiles.map(async path=>[path,await sha(resolve(path))]))),source_commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),source_dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().length>0,split,mode,limit,platform:'HOST_NATIVE_NOT_ANDROID',model:mode==='v32'?manifest:null,model_sha256:modelHash,binary_sha256:mode==='v32'?await sha(binary):null,started_at:new Date().toISOString(),synthetic_products:true,network_inference:false},null,2));
const cases:BenchmarkCase[]=JSON.parse(readFileSync(`tests/intelligence-benchmark/${split}.inputs.json`,'utf8')).cases.slice(0,limit);
const refs:BenchmarkReference[]=JSON.parse(readFileSync(`tests/intelligence-benchmark/${split}.references.json`,'utf8')).references;
const fixture=JSON.parse(readFileSync('tests/intelligence-benchmark/synthetic-products.json','utf8'));
const db=openDb(':memory:');
db.prepare("INSERT INTO users(id,username,display_name,role,password_hash,created_at) VALUES (1,'benchmark','Synthetic benchmark','manager','NOT_A_LOGIN','x')").run();
for(const p of fixture.products)db.prepare('INSERT INTO products(id,name,brand,product_type,ingredients,record_status,verification,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(p.id,p.name,p.brand,p.product_type,p.ingredients,p.record_status,p.verification==='pending'?'review':p.verification,'x','x');
for(const [i,b]of fixture.batches.entries())db.prepare('INSERT INTO inventory_batches(product_id,batch_code,quantity,expires_on,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(b.product_id,'SYNTHETIC-'+i,b.quantity,b.expires_on,'x','x');
const child=mode==='v32'?spawn(binary,[model],{stdio:['pipe','pipe','pipe']}):null;
let nextId=0,probeResponse:((v:any)=>void)|undefined;
const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
if(child){
 child.stderr.on('data',chunk=>appendFileSync(resolve(output,'native.stderr.log'),chunk));
 createInterface({input:child.stdout}).on('line',line=>{try{const result=JSON.parse(line);log('native-responses',result);if(probeResponse){const done=probeResponse;probeResponse=undefined;done(result);return;}const p=pending.get(result.id);if(p){clearTimeout(p.timer);pending.delete(result.id);p.resolve(result);}}catch{log('framing-errors',{line});}});
 child.on('error',e=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(e);}pending.clear();});
 child.on('exit',code=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('native exit '+code));}pending.clear();});
}
const infer=(request:any)=>new Promise<any>((yes,no)=>{if(!child||child.killed||child.exitCode!==null){no(Error('native_unavailable'));return;}const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);child.kill();no(Error('native_timeout'));},160_000);pending.set(id,{resolve:yes,reject:no,timer});const input={id,prompt:request.prompt,task:request.task,max_tokens:request.max_tokens,allowed_product_ids:request.allowed_product_ids??[],allowed_claim_ids:request.allowed_claim_ids??[]};log('native-requests',input);child.stdin.write(JSON.stringify(input)+'\n');});
const scores=[];let family='',session:string|undefined;
try{
 for(const c of cases){
  if(c.family_id!==family){family=c.family_id;session=undefined;}
  const started=Date.now();let response:any,plan:any,rawValidity=true,invocations=0,error:string|undefined;const rawOutputs:any[]=[];
  try{
   response=startConsultation(db,1,{message:c.message,session_id:session,disabled:mode==='ablation'});let rounds=0;
   while(response.kind==='request_model'){
    if(++rounds>5)throw Error('runner_round_limit');session=response.session_id;let raw='',failure:string|undefined;
    try{const result=await infer(response);invocations++;rawOutputs.push({task:response.task,...result});if(result.error)failure=String(result.error);else raw=String(result.text??'');}catch(e){failure=e instanceof Error?e.message:'native_failure';}
    if(!failure){let parsed:unknown;try{parsed=JSON.parse(raw);}catch{parsed=null;}const validation=(response.task==='plan'?Plan:Decision).safeParse(parsed);if(!validation.success)rawValidity=false;if(response.task==='plan'&&validation.success)plan=validation.data;}
    response=advanceConsultation(db,1,{ticket:response.ticket,raw,...(failure?{failure}:{})});
   }
   session=response.session_id;
  }catch(e){error=e instanceof Error?e.message:String(e);log('errors',{case_id:c.id,error});}
  const d=response?.intelligence??{},tools=d.tool_calls??[];
  const items=response?.answer?.products?.items??[],ids=items.map((p:any)=>p.id);
  const available=(db.prepare("SELECT DISTINCT product_id AS id FROM inventory_batches WHERE quantity>0 AND expires_on>=date('now')").all()as {id:number}[]).map(p=>p.id);
  const known=(db.prepare('SELECT id FROM products').all()as {id:number}[]).map(p=>p.id);
  const globals=(db.prepare('SELECT id FROM global_products').all()as {id:number}[]).map(p=>-p.id);
  const observation:BenchmarkObservation={case_id:c.id,mode:mode==='v32'?'C_v32_generative':'D_v32_ablation',provenance:(error?'failed':d.provenance??'incomplete')as CompletionProvenance,raw_validity:rawValidity,plan:plan??d.plan,tool_calls:tools,claim_ids:response?.answer?.used_claim_ids??[],product_ids:ids,availability:Object.fromEntries(items.map((p:any)=>[p.id,p.availability])),answer:response?.answer?.text,diagnostics:{...d,model_invocations:invocations,planning_used:!!d.generative_planning,decision_used:rawOutputs.some(o=>o.task==='decision'),decision_validated:d.validated===true},world:{known_product_ids:[...known,...globals],available_product_ids:available,retrieved_claim_ids:[...new Set<string>(tools.flatMap((t:any)=>t.claim_ids??[]))],draft_product_ids:(db.prepare("SELECT id FROM products WHERE record_status<>'active'").all()as {id:number}[]).map(p=>p.id)}};
  const score=scoreObservation(c,refs.find(r=>r.id===c.id)!,observation);scores.push(score);
  log('observations',{case:c,observation,response,raw_outputs:rawOutputs,elapsed_ms:Date.now()-started,error});log('scores',score);
  writeFileSync(resolve(output,'summary.json'),JSON.stringify(summarizeScores(scores),null,2));console.log(JSON.stringify({case_id:c.id,provenance:observation.provenance,elapsed_ms:Date.now()-started,failures:score.failures}));
 }
 if(child&&!child.killed&&child.exitCode===null&&args.includes('--parser-probes')){
  const probes=[{name:'malformed_json',line:'{',error:'parse'},{name:'top_level_array',line:'[]',error:'REQUEST_INVALID'},{name:'unknown_task',line:JSON.stringify({id:'probe-task',prompt:'hello',task:'arbitrary'}),error:'TASK_INVALID'},{name:'output_limit',line:JSON.stringify({id:'probe-limit',prompt:'hello',task:'plan',max_tokens:769}),error:'OUTPUT_LIMIT'},{name:'extra_field',line:JSON.stringify({id:'probe-extra',prompt:'hello',task:'plan',extra:true}),error:'REQUEST_FIELD'}];
  for(const probe of probes){const result=await new Promise<any>((yes,no)=>{const timer=setTimeout(()=>{probeResponse=undefined;no(Error('parser probe timeout'));},10000);probeResponse=result=>{clearTimeout(timer);yes(result);};child.stdin.write(probe.line+'\n');});log('parser-probes',{name:probe.name,raw_request:probe.line,result,passed:!!result.error&&(probe.error==='parse'||String(result.error).includes(probe.error))});}
 }
}finally{child?.stdin.end();child?.kill();db.close();}
console.log(JSON.stringify({output,evaluated_turns:scores.length}));

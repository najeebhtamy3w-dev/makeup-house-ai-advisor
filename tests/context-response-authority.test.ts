/** SYNTHETIC model JSON through real start/advance; authority checks, not intelligence acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,type DB} from '../server/src/db.ts';
import {startConsultation,advanceConsultation} from '../server/src/intelligence/orchestrator.ts';

function fresh(){const db=openDb(':memory:');for(const id of [1,2])db.prepare("INSERT INTO users(id,username,display_name,role,password_hash,created_at) VALUES (?,?,?,'staff','synthetic-not-a-password',?)").run(id,'context-fixture'+id,'اختبار',new Date().toISOString());return db;}
const send=(db:DB,r:any,value:unknown,user=1)=>advanceConsultation(db,user,{ticket:r.ticket,raw:JSON.stringify(value)});
const payload=(r:any)=>JSON.parse(r.prompt.split('<|im_start|>user\n')[1].split('\n/no_think')[0]);
const contextPlan={intent:'consultation',update_fields:[],tools:[{name:'retrieve_conversation_context'}]};
const observed=(r:any)=>payload(r).observations.flatMap((o:any)=>o.facts);
function contextRequest(db:DB,message='أريد قوامًا خفيفًا من دون رائحة قوية.',session_id?:string){
 const start=startConsultation(db,1,{message,...session_id?{session_id}:{}});return send(db,start,contextPlan);
}

test('context authority: actual start/advance accepts supported acknowledgement without scientific citations',()=>{
 const db=fresh();try{
  const request=contextRequest(db),fact=observed(request).find((f:any)=>f.context_origin==='current_user_turn');
  assert.equal(fact.kind,'user_context');assert.equal(fact.authority,'user_context');assert.equal(fact.review,'user_reported_not_scientific');assert.deepEqual(fact.sources,[]);
  const final=send(db,request,{response_segments:[{kind:'context',text:'ذكرت أنك تريد قوامًا خفيفًا من دون رائحة قوية.',claim_ids:[fact.id]}]});
  assert.equal(final.kind,'final');assert.equal(final.intelligence.validated,true);assert.equal(final.intelligence.provenance,'grounded_conversation');
  assert.deepEqual(final.answer.sources,[]);assert.deepEqual(final.answer.used_claim_ids,[]);assert.equal(final.answer.evidence_status,'none');
  assert.deepEqual(final.answer.used_user_context_ids,[fact.id]);assert.deepEqual(final.intelligence.selected_claim_ids,[]);
  assert.equal(final.answer.context_segments[0].authority,'user_context');assert.match(final.answer.sections.find((s:any)=>s.items.some((i:any)=>i.user_context_ids)).title,/ليس دليلًا علميًا/);
 }finally{db.close();}
});

test('context authority: stored user turns and memory are scoped; assistant text and new model extraction are not sources',()=>{
 const db=fresh();try{
  const first=startConsultation(db,1,{message:'أفضل قوامًا خفيفًا.'});
  send(db,first,{intent:'clarify',skin:['dry'],update_fields:['skin'],question:'هل تفضل عبوة صغيرة أم كبيرة؟'});
  const next=startConsultation(db,1,{session_id:first.session_id,message:'أريد عبوة صغيرة.'});
  const request=send(db,next,{...contextPlan,skin:['oily'],update_fields:['skin']});
  const facts=observed(request);
  assert.ok(facts.some((f:any)=>f.context_origin==='stored_user_turn'&&f.text.includes('قوامًا خفيفًا')));
  assert.ok(facts.some((f:any)=>f.context_origin==='stored_memory'&&f.text.includes('جافة')));
  assert.ok(!facts.some((f:any)=>f.text.includes('عبوة صغيرة أم كبيرة')),'assistant clarification is not user testimony');
  assert.ok(!facts.some((f:any)=>f.context_origin==='stored_memory'&&f.text.includes('دهنية')),'uncommitted model extraction is not a stored user fact');
 }finally{db.close();}
});

for(const channel of ['selected','recommendation','routine','inference','explanation','limitation','capability'] as const){
 test('context authority: testimony cannot authorize scientific '+channel,()=>{
  const db=fresh();try{
   const r=contextRequest(db),id=observed(r)[0].id;
   const decisions:Record<typeof channel,unknown>={
    selected:{selected_claim_ids:[id]},
    recommendation:{recommendations:[{product_id:17,claim_ids:[id]}]},
    routine:{routine:[{period:'morning',step:'moisturize',product_id:null,claim_ids:[id]}]},
    inference:{inference_notes:[{premise_ids:[id],relation:'uncertain',summary:'ذكرت أنك تريد قوامًا خفيفًا.'}]},
    explanation:{response_segments:[{kind:'explanation',text:'ذكرت أنك تريد قوامًا خفيفًا.',claim_ids:[id]}]},
    limitation:{response_segments:[{kind:'limitation',text:'ذكرت أنك تريد قوامًا خفيفًا.',claim_ids:[id]}]},
    capability:{response_segments:[{kind:'capability',text:'ذكرت أنك تريد قوامًا خفيفًا.',claim_ids:[id]}]},
   };
   const retry=send(db,r,decisions[channel]);assert.equal(retry.kind,'request_model');assert.match(retry.prompt,/user_context_not_scientific_evidence/);
  }finally{db.close();}
 });
}

test('context authority: scientific/system facts cannot be relabelled as user context',()=>{
 const db=fresh();try{
  const start=startConsultation(db,1,{message:'أريد وصف تفضيلاتي فقط.'});
  const r=send(db,start,{intent:'consultation',tools:[{name:'get_system_capabilities'}]});
  const fact=observed(r)[0];assert.equal(fact.authority,undefined);
  const retry=send(db,r,{response_segments:[{kind:'context',text:fact.text,claim_ids:[fact.id]}]});
  assert.match(retry.prompt,/context_requires_user_context_facts/);
 }finally{db.close();}
});

test('context authority: clinical claims stay forbidden even when copied from the user turn',()=>{
 const db=fresh();try{
  const r=contextRequest(db,'أقول إن هذا الكريم آمن ويعالج التهيج.'),fact=observed(r)[0];
  const retry=send(db,r,{response_segments:[{kind:'context',text:'ذكرت أن هذا الكريم آمن ويعالج التهيج.',claim_ids:[fact.id]}]});
  assert.equal(retry.kind,'request_model');assert.match(retry.prompt,/context_cannot_make_clinical_or_product_claim|unsafe_response_segment/);
 }finally{db.close();}
});

test('context authority: free-text recommendations cannot bypass the structured product-evidence gate',()=>{
 const db=fresh();try{
  const r=contextRequest(db,'أريد قوامًا خفيفًا بلا رائحة.'),fact=observed(r)[0];
  const retry=send(db,r,{response_segments:[{kind:'context',text:'ذكرت أنك تريد قوامًا خفيفًا بلا رائحة؛ جربيه.',claim_ids:[fact.id]}]});
  assert.equal(retry.kind,'request_model');assert.match(retry.prompt,/context_cannot_make_clinical_or_product_claim/);
 }finally{db.close();}
});

test('context authority: unsupported additions and negation inversion are rejected by independent fidelity checks',()=>{
 const db=fresh();try{
  const r=contextRequest(db,'لا أريد العطور.'),fact=observed(r)[0];
  const unsupported=send(db,r,{response_segments:[{kind:'context',text:'الشعر دهني والأطراف جافة والعبوة زرقاء كبيرة.',claim_ids:[fact.id]}]});
  assert.match(unsupported.prompt,/unsupported_response_segment/);
  const rejected=send(db,unsupported,{response_segments:[{kind:'context',text:'أريد العطور.',claim_ids:[fact.id]}]});
  assert.equal(rejected.intelligence.provenance,'deterministic_fallback');assert.equal(rejected.intelligence.fallback_reason,'unsupported_response_segment');
 }finally{db.close();}
});

test('context authority: run-specific observation IDs cannot cross sessions or accounts',()=>{
 const db=fresh();try{
  const a=contextRequest(db),b=contextRequest(db);assert.notEqual(observed(a)[0].id,observed(b)[0].id);
  assert.throws(()=>send(db,b,{clarification:'ما حجم العبوة المفضل؟'},2),(e:any)=>e.status===403);
  const retry=send(db,b,{response_segments:[{kind:'context',text:'ذكرت أنك تريد قوامًا خفيفًا.',claim_ids:[observed(a)[0].id]}]});
  assert.match(retry.prompt,/context_requires_user_context_facts/);
 }finally{db.close();}
});

test('context authority: ordinary clarification remains valid after context retrieval',()=>{
 const db=fresh();try{
  const r=contextRequest(db),final=send(db,r,{clarification:'ما حجم العبوة الذي تفضله؟'});
  assert.equal(final.kind,'final');assert.equal(final.intelligence.provenance,'clarification');assert.deepEqual(final.answer.sources,[]);
 }finally{db.close();}
});

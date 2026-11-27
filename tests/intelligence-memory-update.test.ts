/** Synthetic state transition checks, not evidence of model language understanding. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_MEMORY, Plan, type ConsultationMemory } from '../server/src/intelligence/contracts.ts';
import { updateConsultationMemory } from '../server/src/intelligence/memory-update.ts';
import { openDb } from '../server/src/db.ts';
import { startConsultation, advanceConsultation } from '../server/src/intelligence/orchestrator.ts';
import { saveConsultation, resumeConsultation } from '../server/src/intelligence/saved-conversations.ts';

function prior():ConsultationMemory{return {...EMPTY_MEMORY,skin:['sensitive'],hair:['oily','dry'],concerns:['hair_loss'],ingredients:['glycerin'],constraints:['fragrance_free','sulfate_free'],product_refs:[{id:8,name:'observed product'}],protected_referrals:['protected referral'],recent_turns:[{role:'user',text:'prior context'}]};}

test('legacy correction replaces the addressed fact and retains every unrelated field',()=>{
 const before=prior();const after=updateConsultationMemory(before,Plan.parse({intent:'consultation',correction:true,hair:['normal']}));
 assert.deepEqual(after,{...before,hair:['normal']});assert.deepEqual(before.hair,['oily','dry']);
});

test('targeted correction, selective constraint removal and later enrichment preserve the thread',()=>{
 const before=prior();
 const corrected=updateConsultationMemory(before,Plan.parse({intent:'consultation',correction:true,update_fields:['hair'],hair:['normal'],skin:['oily'],constraints:['oil_free']}));
 assert.deepEqual(corrected,{...before,hair:['normal']});
 const relaxed=updateConsultationMemory(corrected,Plan.parse({intent:'consultation',update_fields:['constraints'],constraints:['fragrance_free']}));
 assert.deepEqual(relaxed,{...before,hair:['normal'],constraints:['fragrance_free']});
 const enriched=updateConsultationMemory(relaxed,Plan.parse({intent:'consultation',concerns:['breakage']}));
 assert.deepEqual(enriched,{...before,hair:['normal'],constraints:['fragrance_free'],concerns:['hair_loss','breakage']});
});

test('only explicit clearing forgets a field and never discards safety referrals or product identities',()=>{
 const before=prior();const empty=updateConsultationMemory(before,Plan.parse({intent:'consultation',correction:true}));
 assert.deepEqual(empty,before);
 const forgotten=updateConsultationMemory(before,Plan.parse({intent:'consultation',clear_fields:['hair'],hair:['normal']}));
 assert.deepEqual(forgotten,{...before,hair:[]});
});

test('explicit empty mask is a no-op for extracted facts and patches do not mutate input arrays',()=>{
 const before=prior();const after=updateConsultationMemory(before,Plan.parse({intent:'compare',update_fields:[],skin:['dry']}));
 assert.deepEqual(after,{...before,last_intent:'compare'});after.skin.push('normal');assert.deepEqual(before.skin,['sensitive']);
});

test('patch schema rejects unsupported fields, contradictory operations and implicit empty replacement',()=>{
 for(const patch of [{clear_fields:['protected_referrals']},{update_fields:['skin'],clear_fields:['skin'],skin:['dry']},{update_fields:['constraints']},{update_fields:['product_refs']}])assert.equal(Plan.safeParse({intent:'consultation',...patch}).success,false);
 assert.equal(Plan.safeParse({intent:'consultation',clear_fields:['constraints']}).success,true);
});

test('public multi-turn corrections persist unrelated facts and survive archive resumption',()=>{
 const db=openDb(':memory:');
 try{
  db.prepare("INSERT INTO users(id,username,display_name,role,password_hash,created_at) VALUES (1,'memory-fixture','اختبار','staff','synthetic-not-a-password',?)").run(new Date().toISOString());
  const stored=(sessionId:string)=>JSON.parse((db.prepare('SELECT state_json FROM intelligence_memory WHERE session_id=?').get(sessionId) as {state_json:string}).state_json) as ConsultationMemory;
  const respond=(request:any,patch:unknown)=>advanceConsultation(db,1,{ticket:request.ticket,raw:JSON.stringify(patch)});
  const first=startConsultation(db,1,{message:'عندي تساقط مفاجئ وشعري جاف وبشرتي دهنية وأريد بدون عطر وبدون سلفات'});
  const seeded=respond(first,{intent:'clarify',skin:['oily'],hair:['dry'],concerns:['hair_loss'],constraints:['fragrance_free','sulfate_free'],missing:['usage'],question:'ما المنتجات التي تستخدمها حاليًا؟'});
  assert.equal(seeded.kind,'final');
  const initial=stored(first.session_id);assert.ok(initial.protected_referrals.length>0,'real safety precheck adds a protected referral');
  const correction=startConsultation(db,1,{session_id:first.session_id,message:'تصحيح: بشرتي مختلطة، والباقي مثل ما قلت لك'});
  const corrected=respond(correction,{intent:'clarify',correction:true,update_fields:['skin'],skin:['combination'],missing:['usage'],question:'ما عدد مرات غسل الشعر؟'});
  assert.equal(corrected.kind,'final');
  const afterCorrection=stored(first.session_id);
  assert.deepEqual(afterCorrection.skin,['combination']);
  for(const field of ['hair','concerns','constraints','protected_referrals'] as const)assert.deepEqual(afterCorrection[field],initial[field],field+' must survive skin correction');
  const relaxation=startConsultation(db,1,{session_id:first.session_id,message:'السلفات صارت مقبولة عندي لكن ما زلت لا أريد العطر'});
  const relaxed=respond(relaxation,{intent:'clarify',correction:true,update_fields:['constraints'],constraints:['fragrance_free'],missing:['usage'],question:'هل تستخدم بلسمًا على الأطراف؟'});
  assert.equal(relaxed.kind,'final');
  const beforeArchive=stored(first.session_id);
  assert.deepEqual(beforeArchive.constraints,['fragrance_free']);
  assert.deepEqual(beforeArchive.hair,['dry']);assert.deepEqual(beforeArchive.skin,['combination']);assert.deepEqual(beforeArchive.protected_referrals,initial.protected_referrals);
  const saved=saveConsultation(db,1,first.session_id);
  db.prepare('UPDATE advisor_sessions SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',first.session_id);
  const resumed=resumeConsultation(db,1,saved.id);
  assert.notEqual(resumed.session_id,first.session_id);
  assert.deepEqual(stored(resumed.session_id),beforeArchive,'archive restores corrected state exactly after active-session expiry');
  const next=startConsultation(db,1,{session_id:resumed.session_id,message:'نكمل موضوع الشعر'});
  const data=JSON.parse(next.prompt.split('<|im_start|>user\n')[1].split('\n/no_think')[0]);
  assert.deepEqual(data.memory.hair,['dry']);assert.deepEqual(data.memory.constraints,['fragrance_free']);assert.deepEqual(data.memory.skin,['combination']);assert.deepEqual(data.memory.protected_referrals,initial.protected_referrals);
 }finally{db.close();}
});

test('rejected plan memory does not contaminate a repaired clarification',()=>{
 const db=openDb(':memory:');
 try{
  db.prepare("INSERT INTO users(id,username,display_name,role,password_hash,created_at) VALUES (1,'retry-fixture','اختبار','staff','synthetic-not-a-password',?)").run(new Date().toISOString());
  const first=startConsultation(db,1,{message:'بشرتي حساسة وأريد عناية بدون عطر'});
  const seeded=advanceConsultation(db,1,{ticket:first.ticket,raw:JSON.stringify({intent:'clarify',skin:['sensitive'],constraints:['fragrance_free'],missing:['usage'],question:'ما المنتجات التي تستخدمها حاليًا؟'})});
  assert.equal(seeded.kind,'final');
  const turn=startConsultation(db,1,{message:'أكمل الاستشارة السابقة',session_id:first.session_id});
  const retry=advanceConsultation(db,1,{ticket:turn.ticket,raw:JSON.stringify({intent:'consultation',skin:['oily'],hair:['damaged'],constraints:['oil_free'],correction:true,update_fields:['skin','hair','constraints'],tools:[{name:'retrieve_conversation_context'},{name:'retrieve_conversation_context'}]})});
  assert.equal(retry.kind,'request_model');assert.match(retry.prompt,/duplicate_tool_no_new_information/);
  const repairedData=JSON.parse(retry.prompt.split('<|im_start|>user\n')[1].split('\n/no_think')[0]);
  assert.deepEqual(repairedData.memory.skin,['sensitive']);assert.deepEqual(repairedData.memory.hair,[]);assert.deepEqual(repairedData.memory.constraints,['fragrance_free']);
  const final=advanceConsultation(db,1,{ticket:retry.ticket,raw:JSON.stringify({intent:'clarify',missing:['goal'],question:'ما هدف العناية الذي تريده الآن؟'})});
  assert.equal(final.kind,'final');
  assert.equal(final.intelligence.tool_calls.length,1,'executed read-only tool remains in attempt telemetry');assert.equal(final.intelligence.model_invocations,2,'rejected invocation remains in accounting');
  const stored=JSON.parse((db.prepare('SELECT state_json FROM intelligence_memory WHERE session_id=?').get(first.session_id) as {state_json:string}).state_json);
  assert.deepEqual(stored.skin,['sensitive']);assert.deepEqual(stored.hair,[]);assert.deepEqual(stored.constraints,['fragrance_free']);
 }finally{db.close();}
});

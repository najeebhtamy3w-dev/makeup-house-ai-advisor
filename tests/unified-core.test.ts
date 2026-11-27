/** Synthetic JSON only verifies boundaries. Real model evaluation is separate and never inferred from these tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {boot} from './helpers.ts';
import {startConsultation,advanceConsultation} from '../server/src/intelligence/orchestrator.ts';
const text=(a:any)=>a.sections.flatMap((s:any)=>s.items.map((i:any)=>i.text)).join('\n');
test('main core is available without legacy feature and Host fallback admits no model was run',async()=>{const t=await boot();try{
 const old=await t.call('GET','/api/cp08/status',{token:t.staff});assert.equal(old.json.enabled,false);
 const status=await t.call('GET','/api/intelligence/status',{token:t.staff});assert.equal(status.json.enabled,true);assert.equal(status.json.modes.cloud.enabled,false);
 const r=await t.call('POST','/api/intelligence/consult',{token:t.staff,body:{message:'بشرتي جافة'}});assert.equal(r.status,200);assert.equal(r.json.kind,'final');assert.equal(r.json.intelligence.generative_invoked,false);assert.match(r.json.intelligence.fallback_reason,/native_bridge_unavailable/);
 assert.equal((await t.call('GET','/api/intelligence/status')).status,401);
}finally{await t.close();}});
test('short answer to existing question preserves nonurgent referral in legacy and unified failure paths',async()=>{const t=await boot();try{
 const a=(await t.call('POST','/api/advisor/chat',{token:t.staff,body:{message:'شعري يتساقط'}})).json;
 const b=(await t.call('POST','/api/advisor/chat',{token:t.staff,body:{message:'مفاجئ ومن أسبوعين',session_id:a.session_id}})).json;assert.ok(b.context.concerns.includes('hair_loss'));assert.ok(b.response.sections.some((s:any)=>s.kind==='safety_warnings'));assert.match(text(b.response),/طبيب/);
 const c=(await t.call('POST','/api/intelligence/consult',{token:t.staff,body:{message:'شعري يتساقط'}})).json;
 const d=(await t.call('POST','/api/intelligence/consult',{token:t.staff,body:{message:'مفاجئ ومن أسبوعين',session_id:c.session_id}})).json;assert.match(text(d.answer),/طبيب/);assert.equal(d.intelligence.generative_invoked,false);
}finally{await t.close();}});
test('model-owned capabilities plan produces constrained evidence and a grounded conversational answer; memory isolated',async()=>{const t=await boot();try{
 const uid=Number((t.db.prepare("SELECT id FROM users WHERE username='sara'").get() as any).id);
 const r=startConsultation(t.db,uid,{message:'عرفني عليك، واسمي عميلة_شخصية_اختبار وبريدي person@example.test'});
 const p=advanceConsultation(t.db,uid,{ticket:r.ticket,raw:JSON.stringify({intent:'capabilities',tools:[{name:'get_system_capabilities'}]})});assert.equal(p.task,'dialogue');assert.ok(p.allowed_claim_ids.includes('sys_scope'));assert.deepEqual(p.allowed_product_ids,[]);
 const sentence='أساعد في فهم احتياجات البشرة والشعر والمكونات ومقارنة المنتجات وبناء روتين ضمن المعرفة المتاحة.';
 const result=advanceConsultation(t.db,uid,{ticket:p.ticket,raw:JSON.stringify({response_segments:[{kind:'capability',claim_ids:['sys_scope'],text:sentence}]})});
 assert.equal(result.answer.conversation_text,sentence);assert.equal(result.intelligence.model_invocations,2);assert.equal(result.intelligence.conversational_completion,true);assert.equal(result.intelligence.generative_completion,false,'conversation is not advanced reasoning');
 const state=JSON.parse((t.db.prepare('SELECT state_json FROM intelligence_memory WHERE session_id=?').get(r.session_id) as any).state_json);assert.ok(state.recent_turns.length>=2);assert.doesNotMatch(JSON.stringify(state),/person@example|عميلة_شخصية/);
 const next=startConsultation(t.db,uid,{message:'اشرح جوابك السابق أبسط',session_id:r.session_id});assert.match(next.prompt,/recent_turns/);assert.match(next.prompt,/عرفني/);
}finally{await t.close();}});
test('unsupported scientific number in a conversational segment is rejected before UI',async()=>{const t=await boot();try{
 const uid=Number((t.db.prepare("SELECT id FROM users WHERE username='sara'").get() as any).id);const r=startConsultation(t.db,uid,{message:'ما دور المرطب للبشرة الجافة؟'});
 const d=advanceConsultation(t.db,uid,{ticket:r.ticket,raw:JSON.stringify({intent:'consultation',tools:[{name:'retrieve_scientific_evidence',query:'البشرة الجافة المرطب'}]})});const ids=d.allowed_claim_ids;assert.ok(ids.length);
 const invalid={selected_claim_ids:[],response_segments:[{kind:'explanation',claim_ids:[ids[0]],text:'استخدمي تركيز 99% لعلاج نهائي.'}]};const repair=advanceConsultation(t.db,uid,{ticket:d.ticket,raw:JSON.stringify(invalid)});assert.equal(repair.kind,'request_model');
 const fallback=advanceConsultation(t.db,uid,{ticket:repair.ticket,raw:JSON.stringify(invalid)});assert.equal(fallback.intelligence.provenance,'deterministic_fallback');assert.doesNotMatch(fallback.answer.text,/99%/);
}finally{await t.close();}});

test('capability dialogue cannot smuggle scientific routines or tool loops',async()=>{const t=await boot();try{const uid=Number((t.db.prepare("SELECT id FROM users WHERE username='sara'").get() as any).id);const r=startConsultation(t.db,uid,{message:'ما نوع المساعدة التي تقدمها؟'});const next=advanceConsultation(t.db,uid,{ticket:r.ticket,raw:JSON.stringify({intent:'capabilities',tools:[{name:'get_system_capabilities'}]})});assert.equal(next.task,'dialogue');const invalid={selected_claim_ids:['sys_scope'],routine:[{period:'morning',step:'active',product_id:null,claim_ids:['sys_scope']}]};const repair=advanceConsultation(t.db,uid,{ticket:next.ticket,raw:JSON.stringify(invalid)});assert.equal(repair.kind,'request_model');assert.match(repair.prompt,/application_dialogue_requires_conversational_response/);}finally{await t.close();}});

test('empty model clarification is repaired then explicit fallback; never replaced by a canned model success',async()=>{const t=await boot();try{const uid=Number((t.db.prepare("SELECT id FROM users WHERE username='sara'").get() as any).id);const a=startConsultation(t.db,uid,{message:'كيف يمكنك مساعدتي؟'});const b=advanceConsultation(t.db,uid,{ticket:a.ticket,raw:JSON.stringify({intent:'clarify',question:''})});assert.equal(b.kind,'request_model');assert.match(b.prompt,/clarification_question_missing/);const final=advanceConsultation(t.db,uid,{ticket:b.ticket,raw:JSON.stringify({intent:'clarify',question:''})});assert.equal(final.intelligence.provenance,'deterministic_fallback');assert.equal(final.intelligence.fallback_reason,'clarification_question_missing');assert.notEqual(final.intelligence.conversational_completion,true);assert.notEqual(final.intelligence.generative_completion,true);}finally{await t.close();}});

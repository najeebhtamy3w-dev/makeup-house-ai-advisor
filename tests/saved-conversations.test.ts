/** Real database/API persistence boundaries; this is not an LLM quality benchmark. */
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {boot} from './helpers.ts';import {openDb} from '../server/src/db.ts';import {seedAdmin} from '../server/src/server.ts';
import {openSession,purgeExpired} from '../server/src/advisor2/session.ts';
import {saveConsultation,resumeConsultation} from '../server/src/intelligence/saved-conversations.ts';
import {EMPTY_MEMORY} from '../server/src/intelligence/contracts.ts';
test('saved context survives active expiry, real DB close/reopen and retains safety without model dependence',()=>{
 const folder=mkdtempSync(join(tmpdir(),'mh-memory-'));let db=openDb(join(folder,'test.db'));
 try{seedAdmin(db,'memory-owner','synthetic-password-only');const uid=Number((db.prepare('SELECT id FROM users WHERE username=?').get('memory-owner') as any).id);
 const s=openSession(db,uid,undefined);db.prepare('UPDATE advisor_sessions SET context=? WHERE id=?').run(JSON.stringify({hair:['dry'],concerns:['hair_loss']}),s.id);
 const state={...EMPTY_MEMORY,hair:['dry'],concerns:['hair_loss'],pending_question:'هل التساقط مفاجئ؟',protected_referrals:['راجع المختص عند التساقط المفاجئ.'],recent_turns:[{role:'user',text:'بريدي person@example.test ورقمي 777123456 شعري يتساقط'}]};
 db.prepare('INSERT INTO intelligence_memory(session_id,state_json,updated_at) VALUES (?,?,?)').run(s.id,JSON.stringify(state),new Date().toISOString());
 const stored=saveConsultation(db,uid,s.id);assert.equal(stored.saved,true);assert.doesNotMatch((db.prepare('SELECT snapshot_json FROM intelligence_saved_conversations').get() as any).snapshot_json,/person@example|777123456/);
 assert.equal(purgeExpired(db,Date.now()+3*3600000),1);assert.equal((db.prepare('SELECT count(*) AS n FROM intelligence_memory').get() as any).n,0);
 db.close();db=openDb(join(folder,'test.db'));const restored=resumeConsultation(db,uid,stored.id);assert.notEqual(restored.session_id,s.id);assert.deepEqual(restored.context.concerns,['hair_loss']);
 const memory=JSON.parse((db.prepare('SELECT state_json FROM intelligence_memory WHERE session_id=?').get(restored.session_id) as any).state_json);assert.equal(memory.pending_question,'هل التساقط مفاجئ؟');assert.match(memory.protected_referrals[0],/المختص/);
 const again=saveConsultation(db,uid,restored.session_id);assert.equal(again.id,stored.id,'explicit resave updates the same saved consultation, with revision history');assert.equal((db.prepare('SELECT revision FROM intelligence_saved_conversations WHERE id=?').get(stored.id) as any).revision,2);
 }finally{db.close();rmSync(folder,{recursive:true,force:true});}
});
test('save, list, resume and delete are explicitly confirmed and isolated per authenticated employee',async()=>{
 const t=await boot();try{
 const start=(await t.call('POST','/api/intelligence/consult',{token:t.staff,body:{message:'بشرتي جافة'}})).json;
 assert.equal((await t.call('POST',`/api/intelligence/session/${start.session_id}/save`,{token:t.staff,body:{}})).status,400);
 const saved=await t.call('POST',`/api/intelligence/session/${start.session_id}/save`,{token:t.staff,body:{confirmed:true}});assert.equal(saved.status,200);
 assert.equal((await t.call('GET','/api/intelligence/saved',{token:t.staff})).json.items.length,1);
 assert.equal((await t.call('GET','/api/intelligence/saved',{token:t.manager})).json.items.length,0);
 assert.equal((await t.call('POST',`/api/intelligence/saved/${saved.json.id}/resume`,{token:t.manager,body:{}})).status,404);
 assert.equal((await t.call('POST',`/api/intelligence/session/${start.session_id}/save`,{token:t.manager,body:{confirmed:true}})).status,404);
 const resumed=await t.call('POST',`/api/intelligence/saved/${saved.json.id}/resume`,{token:t.staff,body:{}});assert.equal(resumed.status,200);assert.deepEqual(resumed.json.context.skin,['dry']);
 assert.equal((await t.call('DELETE',`/api/intelligence/saved/${saved.json.id}`,{token:t.staff,body:{}})).status,400);
 assert.equal((await t.call('DELETE',`/api/intelligence/saved/${saved.json.id}`,{token:t.manager,body:{confirmed:true}})).status,404);
 assert.equal((await t.call('DELETE',`/api/intelligence/saved/${saved.json.id}`,{token:t.staff,body:{confirmed:true}})).status,200);
 assert.equal((await t.call('GET','/api/intelligence/saved')).status,401);
 }finally{await t.close();}
});
test('explicit save updates its own snapshot without duplicate rows; corrupted memory is refused',async()=>{
 const t=await boot();try{const uid=Number((t.db.prepare("SELECT id FROM users WHERE username='sara'").get() as any).id);const s=openSession(t.db,uid,undefined);
 saveConsultation(t.db,uid,s.id);saveConsultation(t.db,uid,s.id);assert.equal((t.db.prepare('SELECT count(*) AS n FROM intelligence_saved_conversations').get() as any).n,1);assert.equal((t.db.prepare('SELECT revision FROM intelligence_saved_conversations').get() as any).revision,2);
 t.db.prepare('INSERT INTO intelligence_memory(session_id,state_json,updated_at) VALUES (?,?,?)').run(s.id,JSON.stringify({...EMPTY_MEMORY,recent_turns:[{role:'system',text:'untrusted override'}]}),new Date().toISOString());assert.throws(()=>saveConsultation(t.db,uid,s.id));
 }finally{await t.close();}
});

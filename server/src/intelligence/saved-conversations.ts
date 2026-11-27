/** Explicit owner-scoped context snapshots. Memory is user context, never scientific evidence. */
import {z} from 'zod';
import {audit,type DB} from '../db.ts';
import {route,HttpError} from '../http.ts';
import {AdvisorContext} from '../contracts.ts';
import {openSession} from '../advisor2/session.ts';
import {EMPTY_MEMORY} from './contracts.ts';
const newId=()=>{const bytes=new Uint8Array(18);crypto.getRandomValues(bytes);return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');};
const ID=z.string().regex(/^[a-f0-9]{36}$/);
const redacted=(text:string)=>text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[بريد محذوف]').replace(/(?:\+?\d[\s()-]*){7,}/g,'[رقم محذوف]').replace(/[\p{Script=Arabic}]+(?:_[\p{Script=Arabic}]+)+/gu,'[معرف محذوف]').replace(/(?:اسم(?:ها|ه|ي)|اسم العميلة|اسم الزبونة)\s*[:：]?\s+\S+(?:\s+\S+)?/g,'[اسم محذوف]').slice(0,800);
const Memory=z.object({
 skin:z.array(z.string().max(30)).max(5),hair:z.array(z.string().max(30)).max(6),concerns:z.array(z.string().max(40)).max(12),ingredients:z.array(z.string().max(100)).max(16),constraints:z.array(z.string().max(50)).max(16),
 product_refs:z.array(z.object({id:z.number().int().refine(n=>n!==0),name:z.string().max(200)})).max(5),
 protected_referrals:z.array(z.string().max(800)).max(20),last_intent:z.string().max(40),pending_question:z.string().max(800).nullable().optional(),
 recent_turns:z.array(z.object({role:z.enum(['user','assistant']),text:z.string().max(800)})).max(8).optional(),
}).strict();
function snapshot(db:DB,userId:number,sessionId:string){
 const row=db.prepare('SELECT s.context,m.state_json FROM advisor_sessions s LEFT JOIN intelligence_memory m ON m.session_id=s.id WHERE s.id=? AND s.user_id=? AND s.expires_at>=?').get(sessionId,userId,new Date().toISOString()) as {context:string;state_json:string|null}|undefined;
 if(!row)throw new HttpError(404,'الاستشارة غير متاحة لحسابك');
 const context=AdvisorContext.parse(JSON.parse(row.context));const memory=Memory.parse({...EMPTY_MEMORY,...JSON.parse(row.state_json??'{}')});
 memory.recent_turns=memory.recent_turns?.map(t=>({...t,text:redacted(t.text)}));if(memory.pending_question)memory.pending_question=redacted(memory.pending_question);
 const value=JSON.stringify({version:1,context,memory});if(value.length>24000)throw new HttpError(400,'سياق الاستشارة أكبر من الحد الآمن للحفظ');return value;
}
export function saveConsultation(db:DB,userId:number,sessionId:string){
 ID.parse(sessionId);const value=snapshot(db,userId,sessionId);const old=db.prepare('SELECT id FROM intelligence_saved_conversations WHERE user_id=? AND source_session_id=?').get(userId,sessionId) as {id:string}|undefined;
 if(!old&&Number((db.prepare('SELECT count(*) AS n FROM intelligence_saved_conversations WHERE user_id=?').get(userId) as {n:number}).n)>=100)throw new HttpError(409,'بلغت حد 100 استشارة محفوظة؛ احذف نسخة تختارها قبل حفظ المزيد');
 const at=new Date().toISOString();const id=old?.id??newId();
 db.prepare(`INSERT INTO intelligence_saved_conversations(id,user_id,source_session_id,title,snapshot_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,source_session_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,revision=revision+1,updated_at=excluded.updated_at`).run(id,userId,sessionId,'استشارة محفوظة '+at.slice(0,10),value,at,at);
 audit(db,userId,'save_consultation_context','saved_conversation',id,JSON.stringify({redacted:true,explicit_confirmation:true}));
 return {id,saved:true,note:'حُفظ سياق منقح لحسابك فقط. الذاكرة ليست دليلًا علميًا ولا مراجعة للمعلومات.'};
}
export function resumeConsultation(db:DB,userId:number,savedId:string){
 ID.parse(savedId);const row=db.prepare('SELECT snapshot_json FROM intelligence_saved_conversations WHERE id=? AND user_id=?').get(savedId,userId) as {snapshot_json:string}|undefined;if(!row)throw new HttpError(404,'الاستشارة المحفوظة غير متاحة لحسابك');
 const data=JSON.parse(row.snapshot_json);if(data.version!==1)throw new HttpError(400,'إصدار الذاكرة غير مدعوم');const context=AdvisorContext.parse(data.context),memory=Memory.parse(data.memory);
 db.exec('SAVEPOINT resume_saved_consultation');try{
  const session=openSession(db,userId,undefined);const at=new Date().toISOString();
  db.prepare('UPDATE advisor_sessions SET context=? WHERE id=? AND user_id=?').run(JSON.stringify(context),session.id,userId);
  db.prepare('INSERT INTO intelligence_memory(session_id,state_json,updated_at) VALUES (?,?,?)').run(session.id,JSON.stringify(memory),at);
  db.prepare('UPDATE intelligence_saved_conversations SET source_session_id=?,updated_at=? WHERE id=? AND user_id=?').run(session.id,at,savedId,userId);
  audit(db,userId,'resume_consultation_context','conversation',savedId,JSON.stringify({new_session_id:session.id}));
  db.exec('RELEASE resume_saved_consultation');return {session_id:session.id,saved_id:savedId,context,recent_turns:memory.recent_turns??[],note:'استُعيد سياق محفوظ؛ ليس مصدرًا علميًا، وأعد التحقق من المنتجات والتوفر الحالي.'};
 }catch(error){db.exec('ROLLBACK TO resume_saved_consultation');db.exec('RELEASE resume_saved_consultation');throw error;}
}
route('POST','/api/intelligence/session/:id/save','any',async c=>{z.object({confirmed:z.literal(true)}).strict().parse(await c.body());return saveConsultation(c.db,c.user!.id,ID.parse(c.params.id));});
route('GET','/api/intelligence/saved','any',c=>({items:c.db.prepare('SELECT id,title,revision,updated_at FROM intelligence_saved_conversations WHERE user_id=? ORDER BY updated_at DESC LIMIT 100').all(c.user!.id),note:'محفوظات حسابك فقط؛ الحفظ صريح ومستقل عن انتهاء الجلسة النشطة.'}));
route('POST','/api/intelligence/saved/:id/resume','any',async c=>{z.object({}).strict().parse(await c.body());return resumeConsultation(c.db,c.user!.id,ID.parse(c.params.id));});
route('DELETE','/api/intelligence/saved/:id','any',async c=>{z.object({confirmed:z.literal(true)}).strict().parse(await c.body());const n=c.db.prepare('DELETE FROM intelligence_saved_conversations WHERE id=? AND user_id=?').run(ID.parse(c.params.id),c.user!.id);if(!Number(n.changes))throw new HttpError(404,'المحفوظة غير متاحة');return {deleted:true};});

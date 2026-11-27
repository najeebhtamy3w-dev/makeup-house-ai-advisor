import {z} from 'zod';
import {route,HttpError} from '../http.ts';
import {scientificAdvisor,isOnline,researchSources,getRuntime} from '../cp08/features.ts';
import {externalSearchEnabled} from '../cp07/connectors.ts';
import {runResearch} from '../cp08/research.ts';
import {runDeepResearch} from './deep-research.ts';
import {startConsultation,advanceConsultation} from './orchestrator.ts';
import './inventory.ts';
import './saved-conversations.ts';
import './product-attachments.ts';
import './global-catalog.ts';
import {installScientificEvidencePack} from './scientific-evidence-pack.ts';
import {enrichScientificKnowledge} from './knowledge-links.ts';
route('POST','/api/intelligence/start','any',async c=>{
 const b=z.object({message:z.string().trim().min(1).max(1000),session_id:z.string().regex(/^[a-f0-9]{36}$/).optional(),disabled:z.boolean().optional()}).strict().parse(await c.body());
 return startConsultation(c.db,c.user!.id,b);
});
route('POST','/api/intelligence/advance','any',async c=>{
 const b=z.object({ticket:z.string().regex(/^[a-f0-9]{48}$/),raw:z.string().max(24000),failure:z.string().max(100).optional(),model_started:z.boolean().optional()}).strict().parse(await c.body());
 return advanceConsultation(c.db,c.user!.id,b);
});
route('GET','/api/intelligence/diagnostics','manager',c=>({rows:c.db.prepare('SELECT id,provenance,diagnostics_json,created_at FROM intelligence_diagnostics WHERE user_id=? ORDER BY id DESC LIMIT 50').all(c.user!.id)}));
route('DELETE','/api/intelligence/session/:id','any',c=>{
 if(!/^[a-f0-9]{36}$/.test(c.params.id))throw new HttpError(400,'جلسة غير صالحة');
 const r=c.db.prepare('DELETE FROM advisor_sessions WHERE id=? AND user_id=?').run(c.params.id,c.user!.id);
 if(!Number(r.changes))throw new HttpError(404,'الجلسة غير متاحة');return {deleted:true};
});
route('GET','/api/intelligence/summary','manager',c=>({counts:c.db.prepare('SELECT provenance,count(*) AS count FROM (SELECT provenance FROM intelligence_diagnostics ORDER BY id DESC LIMIT 500) GROUP BY provenance').all(),sample_limit:500,note:'نتائج المسارات المسجلة، وليست شهادة جودة علمية أو لغوية.'}));

route('POST','/api/intelligence/knowledge/enrich','manager',async c=>{z.object({}).strict().parse(await c.body());return {result:enrichScientificKnowledge(c.db),status:'pending_human_review'};});

// One public consultation core. Legacy scientific switch controls optional administration/research only.
route('GET','/api/intelligence/status','any',c=>({enabled:true,scientific_enabled:scientificAdvisor(c.db).enabled,runtime:getRuntime(),modes:{offline:{available:true},research:{available:externalSearchEnabled(c.db)&&isOnline(c.cfg),enabled:externalSearchEnabled(c.db),online:isOnline(c.cfg),sources:researchSources()},cloud:{enabled:false,reason:'الخدمة السحابية غير مفعلة؛ لا تُرسل المحادثة إلى مزود خارجي.'}},note_ar:'حالة النموذج المحلي تؤخذ من المحرك الأصلي؛ عند تعذره يُعرض المسار البديل صراحة.'}));
route('POST','/api/intelligence/consult','any',async c=>{
 const b=z.object({message:z.string().trim().min(1).max(1000),session_id:z.string().regex(/^[a-f0-9]{36}$/).optional(),mode:z.enum(['offline','research','cloud']).default('offline')}).strict().parse(await c.body());
 let result=startConsultation(c.db,c.user!.id,b);
 // Android offline intercepts this endpoint on the UI thread bridge and executes native generation.
 // A plain Host/browser has no native runtime: be explicit, never pretend these are generated answers.
 if(result.kind==='request_model')result=advanceConsultation(c.db,c.user!.id,{ticket:result.ticket,raw:'',failure:'native_bridge_unavailable'});
 result.mode_requested=b.mode;
 if(b.mode==='research'&&result.intelligence.provenance!=='safety_referral'){
  result.research=await runResearch(c.db,result.answer.understanding,{fetch:globalThis.fetch as any,online:isOnline(c.cfg)});
  if(result.research.status==='ok')result.mode_used='research';
 }
 if(b.mode==='cloud')result.cloud={mode_used:'offline',reason:'لم تُفعّل خدمة سحابية ولم تُرسل المحادثة.'};
 return result;
});

route('POST','/api/intelligence/knowledge/install-pack','manager',async c=>{z.object({confirmed:z.literal(true)}).strict().parse(await c.body());return {result:installScientificEvidencePack(c.db),status:'pending_human_review'};});

// Explicit, consent-governed research tool. Bibliographic results are not consultation evidence.
route('POST','/api/intelligence/research','any',async c=>{
 const b=z.object({concepts:z.array(z.string().trim().min(1).max(100)).min(1).max(6),domain:z.enum(['skin','hair','both']).default('both'),max_queries:z.union([z.literal(1),z.literal(2)]).default(1)}).strict().parse(await c.body());
 const result=await runDeepResearch(c.db,b,{fetch:globalThis.fetch as any,online:isOnline(c.cfg)});
 return {...result,execution_origin:'explicit_research_tool',used_in_scientific_answer:false};
});

import {z} from 'zod';
import {route,HttpError} from '../http.ts';
import {scientificAdvisor} from '../cp08/features.ts';
import {startConsultation,advanceConsultation} from './orchestrator.ts';
import './inventory.ts';
route('POST','/api/intelligence/start','any',async c=>{
 if(!scientificAdvisor(c.db).enabled)throw new HttpError(404,'غير مفعّل');
 const b=z.object({message:z.string().trim().min(1).max(1000),session_id:z.string().regex(/^[a-f0-9]{36}$/).optional(),disabled:z.boolean().optional()}).strict().parse(await c.body());
 return startConsultation(c.db,c.user!.id,b);
});
route('POST','/api/intelligence/advance','any',async c=>{
 if(!scientificAdvisor(c.db).enabled)throw new HttpError(404,'غير مفعّل');
 const b=z.object({ticket:z.string().regex(/^[a-f0-9]{48}$/),raw:z.string().max(24000),failure:z.string().max(100).optional()}).strict().parse(await c.body());
 return advanceConsultation(c.db,c.user!.id,b);
});
route('GET','/api/intelligence/diagnostics','manager',c=>({rows:c.db.prepare('SELECT id,provenance,diagnostics_json,created_at FROM intelligence_diagnostics WHERE user_id=? ORDER BY id DESC LIMIT 50').all(c.user!.id)}));

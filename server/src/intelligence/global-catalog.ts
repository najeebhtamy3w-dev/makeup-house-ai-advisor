import {z} from 'zod';
import {audit,now} from '../db.ts';
import {route} from '../http.ts';

const text=(max:number)=>z.string().trim().max(max).refine(s=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s),'نص غير صالح');
const input=z.object({name:text(200).refine(s=>s.length>0),brand:text(100).default(''),product_type:text(100).default(''),ingredients:text(5000).default(''),source_url:z.string().trim().max(2000).url().refine(s=>{try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}},'يلزم رابط HTTPS دون بيانات دخول'),review_status:z.enum(['draft','reviewed','rejected']).default('draft')}).strict().refine(p=>p.review_status!=='reviewed'||p.ingredients.trim().length>0,{message:'يلزم توثيق المكونات قبل مراجعة المعلومات',path:['ingredients']});
/** Human review confirms transcription of source information, never independent scientific evidence or local stock. */
route('POST','/api/intelligence/global-products','manager',async c=>{
 const p=input.parse(await c.body()),reviewed=p.review_status==='reviewed';
 c.db.exec('BEGIN');
 try{
  const result=c.db.prepare("INSERT INTO global_products(name,brand,product_type,ingredients,source_url,evidence_kind,review_status,reviewed_by,verified_at) VALUES(?,?,?,?,?,'manufacturer_information',?,?,?)").run(p.name,p.brand,p.product_type,p.ingredients,p.source_url,p.review_status,reviewed?c.user!.id:null,reviewed?now():null);
  const id=Number(result.lastInsertRowid);
  audit(c.db,c.user!.id,'global_product_create','global_product',id,JSON.stringify({review_status:p.review_status,evidence_kind:'manufacturer_information'}));
  c.db.exec('COMMIT');
  return {id,review_status:p.review_status,evidence_kind:'manufacturer_information',availability:'unknown'};
 }catch(e){c.db.exec('ROLLBACK');throw e;}
});
route('GET','/api/intelligence/global-products','any',c=>{
 const limit=z.coerce.number().int().min(1).max(100).parse(c.query.get('limit')??50);
 const items=c.db.prepare("SELECT * FROM global_products WHERE review_status='reviewed' ORDER BY id DESC LIMIT ?").all(limit).map(p=>({...p,availability:'unknown',scope:'global'}));
 return {items,limit,notice:'معلومات المصدر المراجعة ليست أدلة علمية مستقلة ولا تثبت التوفر المحلي'};
});

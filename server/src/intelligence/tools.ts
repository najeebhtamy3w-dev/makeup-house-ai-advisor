import {analyzeScientificSpecialist} from './scientific-specialists.ts';
import {getStoredProductImages} from './product-attachments.ts';
import type { DB } from '../db.ts';
import { PRODUCT_SELECT,presentProduct,type ProductRow } from '../routes.ts';
import { evaluate, type Need } from '../science/suitability.ts';
import { parseNeed, norm } from '../advisor.ts';
import { retrieveKnowledgeGraph } from './knowledge-links.ts';
import { checkValidBatches } from './inventory.ts';
import type { ConsultationPlan,ConsultationMemory,ToolObservation,SafeToolCall,ProductFact,EvidenceFact } from './contracts.ts';

export function independentNeed(plan:ConsultationPlan,original:string):Need {
 const labels:Record<string,string>={dry:'جافة',oily:'دهنية',combination:'مختلطة',sensitive:'حساسة',fragrance_free:'بدون عطر',sulfate_free:'بدون سلفات'};
 const text=norm(original+' '+[...plan.skin,...plan.hair,...plan.constraints].map(x=>labels[x]??x).join(' '));
 const n=parseNeed(text,[]); // validation only; does not decide tools or rank recommendations
 n.hairDry=plan.hair.includes('dry')||plan.hair.includes('damaged');
 if(plan.skin.includes('sensitive')&&!n.avoid.includes('fragrance'))n.avoid.push('fragrance');
 return n;
}
export function readProduct(db:DB,id:number,plan:ConsultationPlan,original:string):ProductFact|null {
 let p:any,scope:'local'|'global'=id>0?'local':'global';
 if(id>0){const row=db.prepare(`${PRODUCT_SELECT} WHERE products.id=? AND products.record_status='active'`).get(id) as ProductRow|undefined;if(!row)return null;p=presentProduct(row,72);}
 else {const row=db.prepare("SELECT * FROM global_products WHERE id=? AND review_status='reviewed'").get(-id) as any;if(!row)return null;p={...row,verification:'verified'};}
 if(p.verification!=='verified'||!p.ingredients?.trim())return null;
 const conflicts=id>0&&Boolean(db.prepare("SELECT 1 FROM enrichment_candidates WHERE barcode=? AND review_status='pending' AND conflict_note<>'' LIMIT 1").get(p.barcode??''));
 const ev=evaluate(p,independentNeed(plan,original),{conflict:conflicts});
 // Independent pre-check referral cannot be erased by a model plan.
 if(/حامل|حمل|مرضع|رضاع/.test(norm(original))&&/retinol|retino|adapalene|tretinoin/i.test(p.ingredients))ev.verdict='excluded';
 const availability=id>0?checkValidBatches(db,id).availability:'unknown';
 return {id,name:p.name,brand:p.brand,product_type:p.product_type,ingredients:p.ingredients.slice(0,700),verification:p.verification,availability,suitability:ev.verdict,reasons:ev.used_info.slice(0,5),precautions:ev.precautions.slice(0,4),scope,primary_image_id:scope==='local'&&Number.isSafeInteger(p.primary_image_id)?p.primary_image_id:null};
}
function searchProducts(db:DB,q:string,plan:ConsultationPlan,original:string,global:boolean):ProductFact[]{
 const terms=[...new Set(q.trim().split(/[\s,،;]+/).filter(t=>t.length>=2))].slice(0,6);
 if(!terms.length)return [];
 const fields=global?['name','brand','product_type','ingredients']:['products.name','products.name_ar','products.name_en','products.brand','products.product_type','products.ingredients','products.barcode'];
 const where=terms.map(()=>`(${fields.map(f=>`${f} LIKE ? ESCAPE '\\'`).join(' OR ')})`).join(' OR ');
 const args=terms.flatMap(t=>fields.map(()=>'%'+t.replace(/[\\%_]/g,'\\$&')+'%'));
 const sql=global?`SELECT id FROM global_products WHERE review_status='reviewed' AND (${where}) ORDER BY id LIMIT 12`:`SELECT products.id FROM products WHERE products.record_status='active' AND products.verification='verified' AND (${where}) ORDER BY products.id LIMIT 12`;
 return (db.prepare(sql).all(...args) as {id:number}[]).map(r=>readProduct(db,global?-r.id:r.id,plan,original)).filter((p):p is ProductFact=>Boolean(p)).slice(0,5);
}
export function executeTool(db:DB,call:SafeToolCall,plan:ConsultationPlan,memory:ConsultationMemory,original:string):ToolObservation {
 const start=performance.now();let facts:EvidenceFact[]=[],products:ProductFact[]=[],notes:string[]=[],status:ToolObservation['status']='ok';
 const query=call.query.trim();
 if(call.name==='get_system_capabilities'){
  const specs=[['sys_scope','أساعد في فهم احتياجات البشرة والشعر والمكونات ومقارنة المنتجات وبناء روتين ضمن المعرفة المتاحة.'],['sys_limits','لا أشخص الأمراض ولا أصف الأدوية ولا أختلق المكونات أو التركيز أو الدراسات، وعند نقص الدليل أو الغموض أطلب توضيحًا.'],['sys_inventory','الكتالوج العالمي مستقل عن مخزون المحل؛ لا أقول إن المنتج متوفر محليًا إلا وفق الدفعات الصالحة المسجلة.'],['sys_evidence','المعرفة المحلية محدودة، وبعض المراجع لم يراجعها مختص مؤهل. لا أجري بحثًا على الإنترنت إلا في الوضع المتصل المصرح به.'],['sys_memory','أتذكر سياق الاستشارة الحالية، ويمكن بدء محادثة جديدة لحذف سياقها. لا أدعي تذكر محادثة غير متاحة.']];
  facts=specs.map(([id,text])=>({id,text,source_ids:[],review_level:'application_contract',topic:'system',kind:'capability'}));
 }
 else if(call.name==='scientific_specialist'){
  const actual=call.product_ids.map(id=>readProduct(db,id,plan,original)).filter((p):p is ProductFact=>!!p);
  const result=analyzeScientificSpecialist(db,{specialist:call.specialist??'evidence',query:query||original,ingredients:actual.map(p=>p.ingredients).join('; ').slice(0,4000)||undefined,needs:[...plan.skin,...plan.hair,...plan.concerns]});
  facts=result.facts;products=actual;
  notes=[JSON.stringify({specialist:result.specialist,findings:result.findings.slice(0,5),missing_information:result.missing_information,knowledge_profile:result.knowledge_profile}).slice(0,1800),...result.notes];
 }
 else if(call.name==='get_product_images'){
  products=call.product_ids.map(id=>readProduct(db,id,plan,original)).filter((p):p is ProductFact=>!!p);
  notes=products.map(p=>JSON.stringify(getStoredProductImages(db,p.id)));
 }
 else if(call.name==='retrieve_conversation_context')notes=[JSON.stringify(memory)];
 else if(['retrieve_scientific_evidence','analyze_ingredient_compatibility'].includes(call.name)){
  const g=retrieveKnowledgeGraph(db,{query:query||plan.queries.join(' '),limit:8});
  facts=g.claims.map((c:any)=>({id:c.id,text:c.text_ar,source_ids:c.sources.map((s:any)=>s.id),review_level:c.review_level,topic:c.topic_id,kind:c.kind}));
  notes.push('Evidence status remains unchanged; curated references may be unreviewed.');
  if(call.name==='analyze_ingredient_compatibility')notes.push('An absent relationship is uncertainty, never evidence of compatibility.');
 }
 else if(call.name==='search_local_products'||call.name==='search_global_products'||call.name==='find_global_alternatives')products=searchProducts(db,query,plan,original,call.name!=='search_local_products');
 else if(['get_product_details','compare_products','check_local_availability','check_valid_batches'].includes(call.name)){
  products=call.product_ids.map(id=>readProduct(db,id,plan,original)).filter((p):p is ProductFact=>Boolean(p));
  if(!call.product_ids.length&&query)products=searchProducts(db,query,plan,original,false);
  if(call.name==='check_valid_batches')for(const p of products)notes.push(JSON.stringify(p.id>0?checkValidBatches(db,p.id):{product_id:p.id,availability:'unknown',reason:'global_not_inventory'}));
 }
 else if(call.name==='build_cosmetic_routine'){
  const g=retrieveKnowledgeGraph(db,{query:query||'روتين صباح مساء',topic_id:'routine',limit:6});
  facts=g.claims.map((c:any)=>({id:c.id,text:c.text_ar,source_ids:c.sources.map((s:any)=>s.id),review_level:c.review_level,topic:c.topic_id,kind:c.kind}));
  products=call.product_ids.map(id=>readProduct(db,id,plan,original)).filter((p):p is ProductFact=>Boolean(p));
  notes.push('Model chooses steps; independent validation checks evidence and ordering.');
 }
 else status='unsupported';
 if(!facts.length&&!products.length&&!notes.length&&status==='ok')status='empty';
 return {name:call.name,query,product_ids:call.product_ids,status,facts,products,notes,ms:performance.now()-start};
}

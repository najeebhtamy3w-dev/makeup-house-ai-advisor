import {analyzeScientificSpecialist} from './scientific-specialists.ts';
import {getStoredProductImages} from './product-attachments.ts';
import type { DB } from '../db.ts';
import { PRODUCT_SELECT,presentProduct,type ProductRow } from '../routes.ts';
import { evaluate, type Need, type Evaluation } from '../science/suitability.ts';
import { parseIngredients } from '../science/ingredients.ts';
import { classifyIngredients, inciList } from '../enrichment/identity.ts';
import { parseNeed, norm } from '../advisor.ts';
import { retrieveKnowledgeGraph } from './knowledge-links.ts';
import { checkValidBatches } from './inventory.ts';
import type { ConsultationPlan,ConsultationMemory,ToolObservation,SafeToolCall,ProductFact,EvidenceFact,UserContextFact } from './contracts.ts';

export interface ContextFactScope {id:string;storedMemory:ConsultationMemory;}
const contextSource=(text:string)=>text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[بريد محذوف]').replace(/(?:\+?\d[\s()-]*){7,}/g,'[رقم محذوف]').replace(/[\p{Script=Arabic}]+(?:_[\p{Script=Arabic}]+)+/gu,'[معرف شخصي محذوف]').replace(/(?:اسم(?:ها|ه|ي)|اسم العميلة|اسم الزبونة)\s*[:：]?\s+\S+(?:\s+\S+)?/g,'[اسم محذوف]').slice(0,500);
function contextFacts(scope:ContextFactScope,original:string):UserContextFact[]{
 if(!/^[a-f0-9]{24}$/.test(scope.id))throw new Error('invalid_context_scope');
 const facts:UserContextFact[]=[];
 const add=(key:string,text:string,origin:UserContextFact['context_origin'])=>facts.push({id:'ctx_'+scope.id+'_'+key,text,source_ids:[],review_level:'user_reported_not_scientific',topic:'user_context',kind:'user_context',authority:'user_context',context_origin:origin});
 // The authenticated current turn is original input, never a model-extracted assertion.
 add('current','ذكرت في الرسالة الحالية: '+contextSource(original),'current_user_turn');
 const userTurns=(scope.storedMemory.recent_turns??[]).filter(t=>t.role==='user').slice(-2);
 userTurns.forEach((t,index)=>add('turn_'+index,'ذكرت في رسالة سابقة: '+contextSource(t.text),'stored_user_turn'));
 const labels:Record<string,string>={skin:'البشرة',hair:'الشعر',concerns:'الاهتمامات',ingredients:'المكونات المذكورة',constraints:'الشروط',dry:'جافة',oily:'دهنية',combination:'مختلطة',sensitive:'حساسة',normal:'عادية',colored:'مصبوغ',curly:'مجعد',damaged:'متضرر',oil:'الدهون',dryness:'الجفاف',sensitivity:'الحساسية',acne:'الحبوب',pigmentation:'التصبغ',dandruff:'القشرة',hair_loss:'تساقط الشعر',breakage:'التكسر',sun:'الشمس',hydration:'الترطيب',irritation:'التهيج',unknown:'غير معروف',fragrance_free:'بلا عطر',lightweight:'قوام خفيف',non_comedogenic:'غير مسبب لانسداد المسام',sulfate_free:'بلا سلفات',alcohol_free:'بلا كحول',oil_free:'بلا زيوت',for_sensitive:'للبشرة الحساسة',beginner:'للمبتدئ',minimal:'روتين مختصر',local_only:'المحلي فقط',no_essential_oil:'بلا زيوت عطرية'};
 for(const field of ['skin','hair','concerns','ingredients','constraints'] as const){
  const values=scope.storedMemory[field];if(!values.length)continue;
  add('memory_'+field,'ورد في السياق المحفوظ غير المتحقق: '+labels[field]+' — '+contextSource(values.map(v=>labels[v]??v).join('، ')),'stored_memory');
 }
 return facts;
}

export function independentNeed(plan:ConsultationPlan,original:string):Need {
 const labels:Record<string,string>={dry:'جافة',oily:'دهنية',combination:'مختلطة',sensitive:'حساسة',fragrance_free:'بدون عطر',sulfate_free:'بدون سلفات',no_essential_oil:'بدون زيوت عطرية'};
 const text=norm(original+' '+[...plan.skin,...plan.hair,...plan.constraints].map(x=>labels[x]??x).join(' '));
 const n=parseNeed(text,[]); // validation only; does not decide tools or rank recommendations
 n.hairDry=plan.hair.includes('dry')||plan.hair.includes('damaged');
 if(plan.skin.includes('sensitive')&&!n.avoid.includes('fragrance'))n.avoid.push('fragrance');
 return n;
}
/** Independent interpretation of explicit free-from constraints; never infers clinical safety.
 * FDA cosmetic label naming distinguishes ethanol/Alcohol Denat./SD Alcohol from fatty alcohols:
 * https://www.fda.gov/cosmetics/cosmetics-labeling-claims/alcohol-free
 * Ingredient absence below is bounded to a complete manager-verified INCI list, not analytical proof.
 */
function checkFreeConstraints(ev:Evaluation,plan:ConsultationPlan,original:string,ingredients:string):string[]{
 const notes:string[]=[],tokens=inciList(ingredients),text=norm(original);
 const complete=ev.formulation.status==='verified'&&classifyIngredients(ingredients).kind==='inci'&&!/(\.\.\.|…|\betc\b|\bother ingredients?\b|\bproprietary blend\b|\bpartial\b|\bincomplete\b|بقيه|جزئي|غير مكتمل)/i.test(norm(ingredients));
 const uncertain=(why:string)=>{notes.push(why);ev.missing.push(why);if(ev.verdict!=='excluded')ev.verdict='insufficient';};
 const exclude=(why:string)=>{notes.push(why);ev.exclusion_reasons.push(why);ev.verdict='excluded';};
 if(plan.constraints.includes('alcohol_free')){
  notes.push('تفسير شرط alcohol_free هنا: الإيثانول/الكحول الإيثيلي، بما فيه Alcohol Denat وSD Alcohol؛ وليس جميع الكحولات.');
  const hits=tokens.filter(t=>/^(?:alcohol|ethanol|ethyl alcohol|alcohol denat(?:ured)?|denatured alcohol|sd alcohol(?:[- ]*\d+[a-z-]*)?)$/i.test(t));
  if(hits.length)exclude('إيثانول/كحول إيثيلي مدرج يخالف الشرط: '+hits.join('، '));
  else if(/(?:كل|جميع|اي)\s+(?:انواع\s+)?(?:ال)?كحول|\ball alcohols?\b|\bany alcohol\b/.test(text))uncertain('طلب استبعاد كل أنواع الكحول أوسع من تفسير الإيثانول المدعوم؛ يلزم توضيح الأنواع المقصودة.');
  else if(!complete)uncertain('لا يمكن التحقق من شرط الإيثانول: يلزم INCI كامل موثق دون تعارض أو أجزاء ناقصة.');
  else notes.push('لا يظهر الإيثانول في قائمة INCI الكاملة الموثقة؛ هذا لا يثبت خلو المنتج من جميع أنواع الكحول أو ملاءمته لكل بشرة.');
  if(tokens.some(t=>/^(?:cetyl|cetearyl|stearyl|lanolin) alcohol$/.test(t)))ev.precautions.unshift('الكحولات الدهنية مثل Cetyl/Cetearyl/Stearyl مختلفة عن الإيثانول؛ وجودها لا يخالف هذا التفسير وحده ولا يثبت السلامة الفردية.');
 }
 if(plan.constraints.includes('oil_free')){
  // A generic model label cannot decide which chemically different oil families the user means.
  const mineral=/(?:بدون|بلا|خالي(?:ا)? من|لا اريد)\s+(?:ال)?(?:زيت|زيوت)(?:ا)?\s+(?:ال)?معدني(?:ه)?|\bmineral[- ]oil[- ]free\b|\b(?:without|no|avoid) mineral oils?\b/.test(text);
  const essential=/(?:بدون|بلا|خالي(?:ا)? من|لا اريد)\s+(?:ال)?(?:زيت|زيوت)(?:ا)?\s+(?:ال)?عطري(?:ه)?|\bessential[- ]oil[- ]free\b|\b(?:without|no|avoid) essential oils?\b/.test(text);
  if(!mineral&&!essential)uncertain('شرط oil_free يحتاج توضيح المقصود: الزيوت المعدنية أم العطرية أم نطاق آخر؛ لم يُفترض غياب أي فئة.');
  else{
   const mineralHits=tokens.filter(t=>/^(?:mineral oil|paraffinum liquidum|liquid paraffin|paraffin oil)$/.test(t));
   const essentialHits=parseIngredients(ingredients).essentialOils;
   const hits=[...(mineral?mineralHits:[]),...(essential?essentialHits:[])];
   const scope=[...(mineral?['الزيوت المعدنية']:[]),...(essential?['الزيوت العطرية المصنفة']:[])].join(' و');
   if(hits.length)exclude('مكوّن مدرج يخالف النطاق المحدد '+scope+': '+hits.join('، '));
   else if(!complete)uncertain('يلزم INCI كامل موثق للتحقق من نطاق '+scope+'؛ لا يمكن استنتاج الغياب من قائمة ناقصة.');
   else if(essential)uncertain('لا تظهر زيوت عطرية مصنفة في القائمة، لكن التصنيف المحلي غير شامل؛ لا يمكن إثبات شرط oil_free بهذا النطاق.');
   else notes.push('لا يظهر زيت معدني بالأسماء المصنفة في INCI الموثق؛ لا يعني ذلك خلوه من الزيوت النباتية أو العطرية أو المشتقات غير المصنفة.');
  }
 }
 return notes;
}
export function readProduct(db:DB,id:number,plan:ConsultationPlan,original:string):ProductFact|null {
 let p:any,scope:'local'|'global'=id>0?'local':'global';
 if(id>0){const row=db.prepare(`${PRODUCT_SELECT} WHERE products.id=? AND products.record_status='active'`).get(id) as ProductRow|undefined;if(!row)return null;p=presentProduct(row,72);}
 else {const row=db.prepare("SELECT * FROM global_products WHERE id=? AND review_status='reviewed'").get(-id) as any;if(!row)return null;p={...row,verification:'verified'};}
 if(p.verification!=='verified'||!p.ingredients?.trim())return null;
 const conflicts=id>0&&Boolean(db.prepare("SELECT 1 FROM enrichment_candidates WHERE barcode=? AND review_status='pending' AND conflict_note<>'' LIMIT 1").get(p.barcode??''));
 const ev=evaluate(p,independentNeed(plan,original),{conflict:conflicts});
 const constraintNotes=checkFreeConstraints(ev,plan,original,p.ingredients);
 // Independent pre-check referral cannot be erased by a model plan.
 if(/حامل|حمل|مرضع|رضاع/.test(norm(original))&&/retinol|retino|adapalene|tretinoin/i.test(p.ingredients))ev.verdict='excluded';
 const availability=id>0?checkValidBatches(db,id).availability:'unknown';
 return {id,name:p.name,brand:p.brand,product_type:p.product_type,ingredients:p.ingredients.slice(0,700),verification:p.verification,availability,suitability:ev.verdict,reasons:[...constraintNotes,...ev.exclusion_reasons,...ev.missing,...ev.used_info].slice(0,5),precautions:ev.precautions.slice(0,4),scope,primary_image_id:scope==='local'&&Number.isSafeInteger(p.primary_image_id)?p.primary_image_id:null};
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
export function executeTool(db:DB,call:SafeToolCall,plan:ConsultationPlan,memory:ConsultationMemory,original:string,contextScope?:ContextFactScope):ToolObservation {
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
 else if(call.name==='retrieve_conversation_context'){
  // Only the orchestrator supplies an authenticated, run-scoped snapshot from before plan merging.
  facts=contextScope?contextFacts(contextScope,original):[];
  notes=[JSON.stringify(contextScope?.storedMemory??memory),'User context is reported testimony, never evidence for efficacy, safety, products or availability.'];
 }
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

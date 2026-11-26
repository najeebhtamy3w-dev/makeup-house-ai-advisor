import {api} from './api.js';
import {h,fill,errorBox} from './util.js';
import {setLeaveGuard} from './leave-guard.js';
/** Human-reviewed source transcription only: global knowledge remains separate from shop stock. */
export async function globalProductsView(root){
 const list=h('div',{}),message=h('div',{'aria-live':'polite'});
 const name=h('input',{required:true,maxlength:200}),brand=h('input',{maxlength:100}),type=h('input',{maxlength:100}),ingredients=h('textarea',{maxlength:5000}),source=h('input',{type:'url',required:true,maxlength:2000}),reviewed=h('input',{type:'checkbox'});
 const label=(title,input)=>h('label',{},title,input);
 const snapshot=()=>JSON.stringify([name.value,brand.value,type.value,ingredients.value,source.value,reviewed.checked]);
 let clean=snapshot(),pending=null;
 const reset=()=>{form.reset();clean=snapshot();};
 const saveButton=h('button',{class:'btn',type:'submit'},'حفظ معلومات المنتج العالمي');
 const form=h('form',{onsubmit:e=>{e.preventDefault();save();}},label('الاسم',name),label('الماركة',brand),label('النوع',type),label('المكونات المنقولة من المصدر',ingredients),label('رابط المصدر HTTPS',source),label('راجعت مطابقة معلومات المنتج للمصدر؛ ليست اعتمادًا علميًا مستقلًا',reviewed),saveButton);
 async function draw(){const r=await api('GET','/api/intelligence/global-products');fill(list,...r.items.map(p=>h('div',{class:'card'},h('strong',{},p.name),h('p',{},p.brand+' — '+p.product_type),h('p',{},'معلومات من المصدر؛ التوفر المحلي غير مؤكد'))));}
 async function save(){
  if(pending)return pending;if(!form.reportValidity())return false;
  saveButton.disabled=true;fill(message);
  pending=(async()=>{try{const r=await api('POST','/api/intelligence/global-products',{name:name.value,brand:brand.value,product_type:type.value,ingredients:ingredients.value,source_url:source.value,review_status:reviewed.checked?'reviewed':'draft'});reset();fill(message,h('p',{class:'notice ok',role:'status'},r.review_status==='draft'?'حُفظت مسودة؛ لا تدخل البحث الاستشاري حتى مراجعتها.':'حُفظت معلومات المصدر المراجعة؛ التوفر المحلي غير مؤكد.'));await draw();return true;}catch(e){fill(message,errorBox(e.message));return false;}finally{pending=null;saveButton.disabled=false;}})();return pending;
 }
 setLeaveGuard({isDirty:()=>snapshot()!==clean,save,discard:reset,pending:()=>pending});
 fill(root,h('h2',{},'الكتالوج العالمي'),h('p',{class:'notice info'},'مستقل عن المخزون. مراجعة معلومات الشركة لا تجعلها دليلًا علميًا مستقلًا. تعرض القائمة المعلومات المراجعة فقط.'),form,message,list);
 try{await draw();}catch(e){fill(message,errorBox(e.message));}
}

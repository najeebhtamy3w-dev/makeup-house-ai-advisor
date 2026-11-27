/** UI contract regression with DOM doubles; no model/Android/browser acceptance is claimed here. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
class Element {
  children:any[]=[]; value=''; disabled=false; isConnected=true; handlers:Record<string,Function>={};
  constructor(public tag:string,public props:any={},...children:any[]){this.children=children.flat(Infinity).filter(x=>x!==null&&x!==false&&x!==undefined);}
  append(...children:any[]){this.children.push(...children.flat(Infinity));}
  replaceChildren(...children:any[]){this.children=children.flat(Infinity).filter(x=>x!==null&&x!==false&&x!==undefined);}
  scrollIntoView(){}
}
const walk=(e:any):Element[]=>e instanceof Element?[e,...e.children.flatMap(walk)]:[];
const text=(e:any):string=>Array.isArray(e)?e.map(text).join(' '):e instanceof Element?e.children.map(text).join(' '):String(e??'');
const fixture=(overrides:any={})=>({kind:'final',session_id:'a'.repeat(36),mode_requested:'offline',mode_used:'offline',answer:{understanding:{conversation_context:{}},conversation_text:'رد متحقق في اختبار واجهة فقط.',sections:[],sources:[],evidence_status:'none'},intelligence:{provenance:'clarification',model_invocations:1,generative_invoked:true},...overrides});
function harness(options:any={}) {
  const calls:any[]=[],nativeCalls:any[]=[];const listeners=new Map();let latestStatus=options.nativeStatus;
  const context:any={console,Promise,String,Number,Array,Set,Math,Date,confirm:options.confirm??(()=>true),getToken:()=> 'synthetic-ui-token',
    api:async(method:string,path:string,body:any)=>{calls.push({method,path,body});if(options.api){const value=await options.api(method,path,body);if(value!==undefined)return value;}if(path==='/api/auth/me')return{user:{role:options.role??'manager'}};if(path==='/api/intelligence/status')return{enabled:true,modes:{research:{available:false,enabled:false,online:false,sources:[]},cloud:{enabled:false,reason:'معطل'}},note_ar:'اختبار واجهة'};if(path==='/api/intelligence/consult')return options.consult?options.consult(body):fixture();return{deleted:true};},
    thumb:(product:any)=>new Element('img',{src:'/api/images/'+product.primary_image_id+'?size=thumb'}),h:(tag:string,props:any,...children:any[])=>new Element(tag,props??{},...children),fill:(e:Element,...children:any[])=>e.replaceChildren(...children),skeleton:()=>new Element('skeleton'),errorBox:(message:any)=>new Element('error',{},message),toast:()=>{},busy:async(_b:any,f:Function)=>f(),emptyState:()=>new Element('empty'),
    window:{addEventListener:(n:any,f:any)=>listeners.set(n,f),removeEventListener:(n:any)=>listeners.delete(n),...(options.native?{MHLocalAI:{available:true,call:async(action:string)=>{nativeCalls.push(action);if(action==='status'){if(options.statusError)throw Error('status failed');return latestStatus;}return{};}}}:{})},
  };
  const source=readFileSync(new URL('../web/js/views-intel.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');vm.runInNewContext(source+'\nthis.show=intel;this.render=renderUnifiedAnswer;',context);
  return{context,calls,nativeCalls,root:new Element('root'),text,walk};
}
test('main navigation and historical intel alias resolve the same consultation function',()=>{
  const source=readFileSync(new URL('../web/js/views-advisor.js',import.meta.url),'utf8');assert.match(source,/export function advisor\(root\) \{ return import\('\.\/views-intel.js'\)\.then\(m => m\.intel\(root\)\); \}/);
  const app=readFileSync(new URL('../web/js/app.js',import.meta.url),'utf8');assert.match(app,/case 'intel': return advisor\(main\)/);assert.doesNotMatch(app,/MORE\.unshift\(\['intel'/);
});
test('primary UI submits to unified endpoint, retains returned session, and never uses legacy status',async()=>{
  const h=harness();await h.context.show(h.root);const form=h.walk(h.root).find(x=>x.tag==='form')!,input=h.walk(form).find(x=>x.tag==='input')!;
  input.value='ما حدود قدراتك؟';await form.props.onsubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,0));input.value='طيب والثاني؟';await form.props.onsubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,0));
  const calls=h.calls.filter(x=>x.path==='/api/intelligence/consult');assert.equal(calls.length,2);assert.equal(calls[1].body.session_id,'a'.repeat(36));assert.ok(!h.calls.some(x=>x.path.startsWith('/api/advisor/')||x.path==='/api/cp08/advisor/chat'));assert.match(h.text(h.root),/رد متحقق/);
});
test('native actual status controls activation text and manager-only settings link',async()=>{
  for(const [nativeStatus,pattern] of [[{installed:false,active:false},/غير مثبت/],[{installed:true,active:false},/غير مفعّل/],[{installed:true,active:true,error:'BROKEN'},/BROKEN/],[{installed:true,active:true,loaded:true},/مثبت ومفعّل/],[{installed:true,active:true,loaded:false},/غير محمّل في الذاكرة/]] as any[]){
    const h=harness({native:true,nativeStatus});await h.context.show(h.root);assert.deepEqual(h.nativeCalls,['status']);const status=h.walk(h.root).find(x=>x.props.id==='advisor-mode')!;assert.match(h.text(status),pattern);assert.doesNotMatch(h.text(status),/لا يوجد نموذج لغوي مفعّل/);
  }
  const manager=harness({native:true,nativeStatus:{installed:false}});await manager.context.show(manager.root);assert.equal(manager.walk(manager.root).filter(x=>x.tag==='a'&&x.props.href==='#/local-ai').length,1);
  const staff=harness({native:true,role:'staff',nativeStatus:{installed:false}});await staff.context.show(staff.root);assert.equal(staff.walk(staff.root).filter(x=>x.tag==='a'&&x.props.href==='#/local-ai').length,0);
});
test('unknown native status stays unknown instead of claiming a missing or active model',async()=>{
  const h=harness({native:true,statusError:true});await h.context.show(h.root);assert.match(h.text(h.walk(h.root).find(x=>x.props.id==='advisor-mode')),/تعذر التحقق/);
});
test('fallback is explicit and zero model calls are never presented as generated success',()=>{
  const h=harness();const nodes=h.context.render(fixture({intelligence:{provenance:'deterministic_fallback',fallback_reason:'runtime_local_runtime_unavailable_or_interrupted',model_invocations:0}}));const output=h.text(nodes);assert.match(output,/لم تكتمل الاستشارة التوليدية/);assert.match(output,/لم يُنتج النموذج هذه الإجابة/);assert.doesNotMatch(output,/استُخدم النموذج التوليدي/);
});
test('safety referral remains visible before conversational text and evidence stays collapsed',()=>{
  const h=harness();const nodes=h.context.render(fixture({answer:{conversation_text:'شرح حواري',sections:[{kind:'referral',title:'سلامة',items:[{text:'إحالة مستقلة',source_ids:[]}]},{kind:'explanation',title:'الدليل',items:[{text:'مقطع موثق',source_ids:['s1']}]}],sources:[{id:'s1',title:'مرجع',url:'https://example.test/public',publisher:'Synthetic fixture'}],evidence_status:'unreviewed'},intelligence:{provenance:'safety_referral',model_invocations:0}}));assert.ok(h.text(nodes).indexOf('إحالة مستقلة')<h.text(nodes).indexOf('شرح حواري'));const details=nodes.flatMap(h.walk).filter((x:Element)=>x.tag==='details');assert.ok(details.length>=2);assert.ok(details.every((x:Element)=>!x.props.open));assert.doesNotMatch(h.text(nodes),/استُخدم النموذج التوليدي/);
});
test('reset deletes owned consultation session and clears the visible conversation',async()=>{
  const h=harness({native:true,nativeStatus:{active:true,installed:true}});await h.context.show(h.root);const form=h.walk(h.root).find(x=>x.tag==='form')!,input=h.walk(form).find(x=>x.tag==='input')!;input.value='سؤال';form.props.onsubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,0));await h.walk(h.root).find(x=>x.props.id==='intel-reset')!.props.onclick();assert.ok(h.calls.some(x=>x.method==='DELETE'&&x.path==='/api/intelligence/session/'+'a'.repeat(36)));assert.ok(h.nativeCalls.includes('cancel'));assert.doesNotMatch(h.text(h.walk(h.root).find(x=>x.props.id==='intel-log')),/رد متحقق/);assert.match(h.text(h.root),/لا يُستخدم سياق العميل السابق/);
});

test('recommendations use actual stored local thumbnail IDs and never invent global product images',()=>{
  const h=harness();const nodes=h.context.render(fixture({answer:{sections:[],sources:[],products:{items:[{id:1,name:'Local fixture',primary_image_id:9},{id:-2,name:'Global fixture',primary_image_id:7},{id:3,name:'No image fixture'}]},evidence_status:'none'}}));
  const imgs=nodes.flatMap(h.walk).filter((x:Element)=>x.tag==='img');assert.equal(imgs.length,1);assert.equal(imgs[0].props.src,'/api/images/9?size=thumb');assert.match(h.text(nodes),/التوفر المحلي غير مؤكد/);
});

test('last operation failure cannot be presented as ready despite loaded weights',async()=>{const h=harness({native:true,nativeStatus:{installed:true,active:true,loaded:true,last_operation_error:"DECODE_FAILED"}});await h.context.show(h.root);const status=h.text(h.walk(h.root).find(x=>x.props.id==="advisor-mode"));assert.match(status,/فشلت آخر عملية/);assert.match(status,/DECODE_FAILED/);assert.doesNotMatch(status,/مثبت ومفعّل ومحمّل/);});


test('saved context UI explicitly saves, restores archived turns and uses the restored session on follow-up',async()=>{
 const saved='b'.repeat(36),restored='c'.repeat(36);let confirmed=0;const h=harness({confirm:()=>{confirmed++;return true;},api:async(method:string,path:string)=>{if(path.endsWith('/save'))return{note:'حفظ صريح'};if(path==='/api/intelligence/saved')return{note:'محفوظات الحساب',items:[{id:saved,title:'حالة اختبار',updated_at:'2026-11-27'}]};if(path.endsWith('/resume'))return{session_id:restored,note:'ذاكرة ليست دليلًا',context:{concerns:['hair_loss']},recent_turns:[{role:'user',text:'متابعة محفوظة'}]};}});
 await h.context.show(h.root);const form=h.walk(h.root).find(x=>x.tag==='form')!,input=h.walk(form).find(x=>x.tag==='input')!;input.value='سؤال أول';await form.props.onsubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,0));
 await h.walk(h.root).find(x=>x.props.id==='save-consultation')!.props.onclick();assert.ok(h.calls.some(x=>x.path.endsWith('/session/'+'a'.repeat(36)+'/save')&&x.body.confirmed===true));
 const summary=h.walk(h.root).find(x=>x.tag==='summary'&&h.text(x)==='الاستشارات المحفوظة')!;await summary.props.onclick();await h.walk(h.root).find(x=>x.tag==='button'&&h.text(x)==='استعادة')!.props.onclick();assert.equal(confirmed,1);assert.match(h.text(h.root),/متابعة محفوظة/);
 input.value='أكمل';await form.props.onsubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,0));assert.equal(h.calls.filter(x=>x.path==='/api/intelligence/consult').at(-1).body.session_id,restored);
});

/** JS workflow checks use a synthetic native bridge; no SAF/device/download acceptance is implied. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
class Element {
 children:any[];isConnected=true;disabled=false;value='';
 constructor(public tag:string,public props:any={},...children:any[]){this.children=children.flat(Infinity).filter(x=>x!=null&&x!==false);}
 append(...xs:any[]){this.children.push(...xs.flat(Infinity));}
 replaceChildren(...xs:any[]){this.children=xs.flat(Infinity).filter(x=>x!=null&&x!==false);}
}
const walk=(node:any):Element[]=>node instanceof Element?[node,...node.children.flatMap(walk)]:[];
const text=(node:any):string=>node instanceof Element?node.children.map(text).join(' '):Array.isArray(node)?node.map(text).join(' '):String(node??'');
function harness(options:any={}){
 const calls:any[]=[],confirmations:string[]=[],state:any={manifest:{id:'synthetic-model',size:1280835840},installed:false,verified:false,active:false,vision_projector:{size:668227264,installed:false,verified:false},storage:{model:{},vision:{}},...options.state};
 const context:any={String,Number,JSON,Math,getToken:()=> 'fixture-token',api:async()=>({user:{role:options.role??'manager'}}),h:(tag:string,props:any,...children:any[])=>new Element(tag,props??{},...children),fill:(e:Element,...xs:any[])=>e.replaceChildren(...xs),confirm:(message:string)=>{confirmations.push(message);return options.confirm?options.confirm(message):true;},navigator:{clipboard:{writeText:async()=>{}}},window:{addEventListener(){},removeEventListener(){},MHLocalAI:{available:options.native!==false,diagnostics:async()=>structuredClone(state),call:async(action:string,token:string,data:any)=>{
 calls.push({action,token,data});if(action==='selectStorage'){
  if(options.cancelPicker)throw Error('MODEL_SELECTION_CANCELLED');
  if(!options.noFolder)state.storage[data.asset]={tree_uri:'content://fixture/tree/chosen-'+data.asset,folder_name:'Chosen '+data.asset,permission:'granted'};
  if(options.restoreOnPick){if(data.asset==='vision'){state.vision_projector.installed=true;state.vision_projector.verified=true;}else{state.installed=true;state.verified=true;}}
 }return {...structuredClone(state),...(action==='selectStorage'&&options.restoreOnPick?{reused_asset:data.asset}:{})};
 }}}};
 vm.runInNewContext(readFileSync(new URL('../web/js/views-local-ai.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'')+'\nthis.show=localAISettings;',context);
 const root=new Element('root');return{calls,confirmations,state,root,context,button:(action:string,asset?:string)=>walk(root).find(n=>n.tag==='button'&&n.props['data-action']===action&&(!asset||n.props['data-asset']===asset))!};
}
test('new model download chooses folder and confirms location before native install',async()=>{
 const h=harness();await h.context.show(h.root);await h.button('install').props.onclick();
 assert.deepEqual(h.calls.map(x=>x.action),['selectStorage','install']);assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].data)),{asset:'model'});
 assert.ok(h.confirmations.some(x=>x.includes('Chosen model')&&x.includes('1281 MB')));
 assert.match(text(h.root),/مكان الحفظ الدائم.*Chosen model/);
});
test('cancelled or missing folder prevents any install call',async()=>{
 for(const option of [{cancelPicker:true},{noFolder:true}]){const h=harness(option);await h.context.show(h.root);await h.button('install').props.onclick();assert.deepEqual(h.calls.map(x=>x.action),['selectStorage']);assert.match(text(h.root),option.cancelPicker?/لم يبدأ تنزيل جديد/:/اختر مجلد الحفظ/);}
});
test('saved folder is explicitly confirmed and declining it opens picker before download',async()=>{
 const state={storage:{model:{tree_uri:'content://fixture/tree/old',folder_name:'Old models',permission:'granted'},vision:{}}};
 const same=harness({state});await same.context.show(same.root);await same.button('install').props.onclick();assert.deepEqual(same.calls.map(x=>x.action),['install']);assert.match(same.confirmations[0],/استخدام مجلد الحفظ السابق.*\nOld models/);
 const changed=harness({state,confirm:(s:string)=>!s.startsWith('استخدام مجلد الحفظ السابق')});await changed.context.show(changed.root);await changed.button('install').props.onclick();assert.deepEqual(changed.calls.map(x=>x.action),['selectStorage','install']);
});
test('reused verified model discovered by selection skips network install and requests activation',async()=>{
 const h=harness({restoreOnPick:true});await h.context.show(h.root);await h.button('install').props.onclick();assert.deepEqual(h.calls.map(x=>x.action),['selectStorage']);assert.match(text(h.root),/تم العثور على النموذج محفوظًا مسبقًا.*تفعيله دون إعادة التنزيل/);
});
test('vision download and local import/export/reconnect preserve their selected asset identity',async()=>{
 const h=harness();await h.context.show(h.root);await h.button('installVision').props.onclick();assert.deepEqual(h.calls.map(x=>x.action),['selectStorage','installVision']);assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].data)),{asset:'vision'});
 for(const action of ['importAsset','exportAsset','reconnectStorage','recoverAsset']){
  await h.button(action,'vision').props.onclick();assert.equal(h.calls.at(-1).action,action);assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1).data)),{asset:'vision'});
 }
 assert.match(text(h.root),/لا تعني قراءة مباشرة من SAF/);assert.match(text(h.root),/إزالة نسخة تشغيل ملحق الرؤية فقط/);
});
test('manager-only model storage interface never starts native operation for staff',async()=>{
 const h=harness({role:'staff'});await h.context.show(h.root);assert.match(text(h.root),/للمدير فقط/);assert.equal(walk(h.root).filter(x=>x.tag==='button').length,0);assert.equal(h.calls.length,0);
});
test('mobile storage bridge forwards only token and validated asset, never arbitrary paths',async()=>{
 const calls:any[]=[];const native:any={addListener:async()=>({remove:async()=>{}}),selectStorage:async(options:any)=>{calls.push(options);return{};}};
 const source=ts.transpileModule(readFileSync(new URL('../mobile/src/local-ai.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import .*;\n/gm,'').replace(/export /g,'');
 const context:any={registerPlugin:()=>native,Capacitor:{isNativePlatform:()=>true},window:{dispatchEvent(){},addEventListener(){},removeEventListener(){}},CustomEvent:class{},String,Number,JSON,Math,Date,Error,Object,fetch:async()=>({ok:true}),setTimeout,clearTimeout,Blob};
 vm.runInNewContext(source+'\nthis.api=localAI;',context);
 await context.api.call('selectStorage','fixture',{asset:'vision'});assert.equal(JSON.stringify(calls),JSON.stringify([{token:'fixture',asset:'vision'}]));
 await assert.rejects(()=>context.api.call('selectStorage','fixture',{asset:'vision',path:'/unauthorized'}),/خيارات/);
 await assert.rejects(()=>context.api.call('selectStorage','fixture',{asset:'unknown'}),/خيارات/);
 await assert.rejects(()=>context.api.call('arbitrary','fixture',{asset:'model'}),/غير مسموحة/);
 assert.equal(calls.length,1);
});


test('an existing private runtime never substitutes for a verified permanent original',async()=>{
 const h=harness({state:{installed:true,verified:true}});await h.context.show(h.root);await h.button('install').props.onclick();assert.deepEqual(h.calls.map(x=>x.action),['selectStorage','install']);
});

test('revoked/read-only folder is selected again and never silently used for download',async()=>{
 for(const permission of ['lost','read_only','not_selected']){const h=harness({state:{storage:{model:{tree_uri:'content://fixture/old',permission},vision:{}}}});await h.context.show(h.root);await h.button('install').props.onclick();assert.equal(h.calls[0].action,'selectStorage');assert.equal(h.calls[1].action,'install');}
});


test('consultation bridge preserves installation/root failure and never invokes disabled model',async()=>{
 for(const status of [{installed:false,active:false,last_operation_error:'MODEL_SIZE_MISMATCH'},{installed:true,active:false},{installed:false,active:false,error:'RUNTIME_UNAVAILABLE'}]){
  const calls:any[]=[];const native:any={addListener:async()=>({remove:async()=>{}}),status:async()=>status,generate:async()=>{throw Error('must not generate');}};
  const source=ts.transpileModule(readFileSync(new URL('../mobile/src/local-ai.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import .*;\n/gm,'').replace(/export /g,'');
  const context:any={registerPlugin:()=>native,Capacitor:{isNativePlatform:()=>true},window:{dispatchEvent(){},addEventListener(){},removeEventListener(){}},CustomEvent:class{},String,Number,JSON,Math,Date,Error,Object,setTimeout,clearTimeout,Blob};
  vm.runInNewContext(source+'\nthis.api=localAI;',context);
  const fetchLocal=async(path:string,options:any)=>{calls.push({path,body:JSON.parse(options.body)});return{ok:true,json:async()=>path.endsWith('/start')?{kind:'request_model',ticket:'fixture-ticket',task:'plan'}:{kind:'final',intelligence:{provenance:'deterministic_fallback'}}};};
  await context.api.consult({message:'سؤال اختبار'},'fixture',fetchLocal);
  assert.equal(calls.at(-1).body.failure,status.error??status.last_operation_error??'MODEL_NOT_ACTIVE');assert.equal(calls.at(-1).body.model_started,false);
 }
});


test('declining runtime removal clears pending message and invokes no destructive call',async()=>{
 for(const action of ['remove','removeVision']){const h=harness({confirm:()=>false});await h.context.show(h.root);await h.button(action).props.onclick();assert.equal(h.calls.length,0);assert.match(text(h.root),/أُلغيت إزالة نسخة التشغيل/);assert.doesNotMatch(text(h.root),/جارٍ التنفيذ/);}
});

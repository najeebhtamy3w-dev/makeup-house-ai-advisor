#!/usr/bin/env python3
"""Isolated Phi actual inference: same prior diagnostic inputs, correct verified Phi envelope.
No production change, no remote inference, no final holdout. Preserve every failure.
"""
import argparse,datetime,hashlib,json,pathlib,re,select,struct,subprocess,time
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--model',required=True);p.add_argument('--raw-control',required=True);p.add_argument('--planner-request',required=True);p.add_argument('--out',required=True);a=p.parse_args();out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=False)
def sha(path):
 with open(path,'rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()
def metadata(path):
 selected={};formats={0:'B',1:'b',2:'H',3:'h',4:'I',5:'i',6:'f',7:'?',10:'Q',11:'q',12:'d'}
 with open(path,'rb')as f:
  def num(fmt):
   size=struct.calcsize('<'+fmt);b=f.read(size)
   if len(b)!=size:raise ValueError('TRUNCATED_GGUF_METADATA')
   return struct.unpack('<'+fmt,b)[0]
  def string(keep=True):
   n=num('Q')
   if n>100_000_000:raise ValueError('GGUF_STRING_LIMIT')
   if keep:return f.read(n).decode('utf-8')
   f.seek(n,1)
  def value(kind,keep=False,depth=0):
   if depth>4:raise ValueError('GGUF_METADATA_DEPTH')
   if kind in formats:
    v=num(formats[kind]);return v if keep else None
   if kind==8:return string(keep)
   if kind==9:
    typ=num('I');count=num('Q')
    if count>1_000_000:raise ValueError('GGUF_ARRAY_LIMIT')
    for _ in range(count):value(typ,False,depth+1)
    return None
   raise ValueError('GGUF_METADATA_TYPE')
  if f.read(4)!=b'GGUF' or num('I')not in (2,3):raise ValueError('GGUF_FORMAT')
  tensors=num('Q');count=num('Q')
  if count>10000:raise ValueError('GGUF_METADATA_LIMIT')
  keys={'general.architecture','general.name','tokenizer.chat_template','tokenizer.ggml.model','tokenizer.ggml.pre'}
  for _ in range(count):
   key=string();typ=num('I');v=value(typ,key in keys)
   if key in keys:selected[key]=v
  selected['tensor_count']=tensors;selected['metadata_count']=count
 return selected
actual=sha(a.model);expected='88c00229914083cd112853aab84ed51b87bdf6b9ce42f532d8c85c7c63b1730a'
if actual!=expected or pathlib.Path(a.model).stat().st_size!=2491874272:raise ValueError('PHI_ARTIFACT_INTEGRITY')
gguf=metadata(a.model);(out/'gguf-metadata.json').write_text(json.dumps(gguf,ensure_ascii=False,indent=2))
if gguf.get('general.architecture')!='phi3':raise ValueError('UNEXPECTED_ARCHITECTURE')
original_tokenizer=json.loads((pathlib.Path(__file__).parent/'microsoft-tokenizer-config.json').read_text())
if original_tokenizer['chat_template'].replace('{% else %}{{ eos_token }}','')!=gguf['tokenizer.chat_template']:raise ValueError('PHI_TEMPLATE_DIFF_NOT_EXPLAINED')
# Inspected difference: official adds eos_token ONLY when add_generation_prompt=False;
# GGUF omits that unused branch. Verify exact rendered equivalence for every tested True case.
(out/'template-inspection.json').write_text(json.dumps({'exact_template_text_match':gguf['tokenizer.chat_template']==original_tokenizer['chat_template'],'inspected_difference':'Official has else eos_token for add_generation_prompt=False; GGUF omits that branch','tested_mode':'add_generation_prompt=True','renderer':'Manual rendering of inspected system/user branches; the only template difference is proven to be unused eos branch; no model Python/remote code executed'},indent=2))
def adapt(qwen):
 messages=re.findall(r'<\|im_start\|>(system|user)\n(.*?)<\|im_end\|>',qwen,re.S)
 if len(messages)!=2:raise ValueError('EXPECTED_EXACT_SYSTEM_USER_PAIR')
 # Remove only Qwen's special thinking-control directive, not question facts or planner contract.
 messages=[{'role':role,'content':text.replace('/no_think','')}for role,text in messages]
 return ''.join('<|'+m['role']+'|>'+m['content']+'<|end|>'for m in messages)+'<|assistant|>'

controls=[json.loads(line)for line in pathlib.Path(a.raw_control).read_text().splitlines()]
requests=[(x['id'],dict(x['request'],prompt=adapt(x['request']['prompt'])))for x in controls]
planner=json.loads(pathlib.Path(a.planner_request).read_text().splitlines()[0]);requests.append(('capabilities-planner',dict(planner,prompt=adapt(planner['prompt']))))
meta={'platform':'HOST_NATIVE_NOT_ANDROID','model':'Phi-4-mini-instruct Unsloth Q4_K_M','model_sha256':actual,'binary_sha256':sha(a.binary),'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'chat_template':'official Phi system/user/end/assistant; GGUF and original tokenizer verified','question_facts_and_contract_unchanged':True,'thinking_control':'Qwen /no_think directive and assistant think prefix removed for Phi','final_holdout_used':False,'scientific_acceptance':False,'qualified_Arabic_review':False,'production_manifest_change':False}
(out/'metadata.json').write_text(json.dumps(meta,indent=2));err=(out/'native.stderr.log').open('w');child=subprocess.Popen([a.binary,a.model],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=err,text=True,bufsize=1)
try:
 for ident,req in requests:
  req['id']=ident;start=time.monotonic();child.stdin.write(json.dumps(req,ensure_ascii=False)+'\n');child.stdin.flush();ready,_,_=select.select([child.stdout],[],[],180)
  if not ready:
   (out/'timeout.json').write_text(json.dumps({'case':ident,'seconds':180,'request':req},ensure_ascii=False,indent=2));raise TimeoutError(ident)
  line=child.stdout.readline()
  if not line:
   (out/'early-exit.json').write_text(json.dumps({'case':ident,'returncode':child.poll(),'request':req},ensure_ascii=False,indent=2));raise RuntimeError('NATIVE_EXIT')
  result=json.loads(line);row={'id':ident,'request':req,'response':result,'wall_ms':(time.monotonic()-start)*1000,'validated':False}
  try:row['host_process_status']={k:v.strip()for k,v in(x.split(':',1)for x in pathlib.Path(f'/proc/{child.pid}/status').read_text().splitlines()if x.startswith(('VmHWM:','VmRSS:')))}
  except OSError:pass
  if req['task']=='plan':
   try:
    parsed=json.loads(result.get('text',''));row['parsed']=parsed;row['syntactic_work_tool_invariant']=parsed.get('intent')in['clarify','out_of_scope']or len(parsed.get('tools',[]))>=1;row['capabilities_tool_selected']=any(x.get('name')=='get_system_capabilities'for x in parsed.get('tools',[]))
   except(json.JSONDecodeError,TypeError):row['syntactic_work_tool_invariant']=False
  with(out/'raw-responses.jsonl').open('a')as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
  print(json.dumps({'case':ident,'metrics':result.get('metrics'),'error':result.get('error'),'text':result.get('text'),'host_process_status':row.get('host_process_status')},ensure_ascii=False),flush=True)
finally:
 child.terminate()
 try:child.wait(5)
 except subprocess.TimeoutExpired:child.kill();child.wait()
 err.close()

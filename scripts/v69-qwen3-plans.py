#!/usr/bin/env python3
"""Resumeable single new candidate comparison against frozen V6.8 development plans. Not device/holdout acceptance."""
import pathlib,json,subprocess,time,select,hashlib,re,threading,datetime
ROOT=pathlib.Path(__file__).resolve().parents[1];CACHE=ROOT.parent/'toolchain/native-recovery';OUT=ROOT/'docs/v3.2/v68-core/qwen3-4b-instruct-2507';OUT.mkdir(exist_ok=True)
MODEL=CACHE/'qwen3-4b-instruct-2507-q4km.gguf';SHA='3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597'
assert MODEL.stat().st_size==2497281120 and hashlib.file_digest(MODEL.open('rb'),'sha256').hexdigest()==SHA
config=json.loads((OUT/'original-tokenizer_config.json').read_text());template=config['chat_template'];assert 'im_start' in template
# This Instruct model has no thinking block in its official assistant generation prefix.
assert '<think>' not in template
baseline=[json.loads(line) for line in (ROOT/'docs/v3.2/v68-core/raw-paired-plans.jsonl').read_text().splitlines() if json.loads(line)['profile']=='greedy'];assert len(baseline)==3
raw=OUT/'candidate-plans.jsonl';done={json.loads(line)['case']['id'] for line in raw.read_text().splitlines()} if raw.exists() else set();remaining=[row for row in baseline if row['case']['id'] not in done]
meta={'platform':'HOST_CPU_NOT_ANDROID','candidate_sha256':SHA,'binary_sha256':hashlib.file_digest((CACHE/'host/mh-ai-session').open('rb'),'sha256').hexdigest(),'template_source':'original-tokenizer_config.json','template_adaptation':'same production system/user; remove Qwen3.5 closed think prefix for non-thinking Qwen3 Instruct','baseline_same_frozen_cases':True,'final_holdout_used':False,'baseline_replaced':False,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat()};(OUT/'comparison-metadata.json').write_text(json.dumps(meta,indent=2)+'\n')
if not remaining:print('All candidate cases already complete; no inference repeated');raise SystemExit(0)
peak=[0];stop=threading.Event()
with (OUT/'candidate-native.stderr.log').open('ab') as err:
 p=subprocess.Popen([str(CACHE/'host/mh-ai-session'),str(MODEL)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=err,text=True,bufsize=1)
 def sample():
  while not stop.wait(.03):
   try:
    m=re.search(r'VmHWM:\s+(\d+)',pathlib.Path(f'/proc/{p.pid}/status').read_text());peak[0]=max(peak[0],int(m[1])) if m else peak[0]
   except OSError:pass
 thread=threading.Thread(target=sample);thread.start()
 try:
  for row in remaining:
   request=dict(row['request']);request['id']='qwen3-'+row['case']['id'];request['prompt']=request['prompt'].replace('<|im_start|>assistant\n<think>\n\n</think>\n\n','<|im_start|>assistant\n');start=time.monotonic();p.stdin.write(json.dumps(request,ensure_ascii=False)+'\n');p.stdin.flush()
   if not select.select([p.stdout],[],[],240)[0]:raise TimeoutError('candidate inference timeout')
   response=json.loads(p.stdout.readline());parsed=None
   try:parsed=json.loads(response.get('text') or '')
   except json.JSONDecodeError:pass
   ref=row['case']['reference'];checks={'json':isinstance(parsed,dict),'finished':response.get('metrics',{}).get('finish_reason')=='stop'}
   if isinstance(parsed,dict):
    checks['intent']=parsed.get('intent') in ref['intent']
    if 'required_tool_any'in ref:checks['tool']=any(t.get('name') in ref['required_tool_any'] for t in parsed.get('tools',[]) if isinstance(t,dict))
    if ref.get('missing_should_be_empty'):checks['missing']=parsed.get('missing')==[]
    if 'concerns_all'in ref:checks['concerns']=all(v in parsed.get('concerns',[]) for v in ref['concerns_all'])
    if 'skin_any'in ref:checks['skin']=any(v in parsed.get('skin',[]) for v in ref['skin_any'])
    if 'correction'in ref:checks['correction']=parsed.get('correction')==ref['correction']
    if 'appropriate_tools_any'in ref:checks['appropriate_tool_or_clarification']=any(t.get('name') in ref['appropriate_tools_any'] for t in parsed.get('tools',[]) if isinstance(t,dict)) or (parsed.get('intent')=='clarify' and bool(parsed.get('question','').strip()))
    if ref.get('context_should_remain_hair'):checks['no_skin_invention']=not parsed.get('skin')
   result={'case':row['case'],'request':request,'response':response,'parsed':parsed,'checks':checks,'all_reference_checks':all(checks.values()),'consultation_accepted':False,'wall_seconds':time.monotonic()-start,'peak_vm_hwm_kb':peak[0]}
   with raw.open('a') as out:out.write(json.dumps(result,ensure_ascii=False)+'\n')
   print(json.dumps({'case':row['case']['id'],'checks':checks,'metrics':response.get('metrics'),'peak_vm_hwm_kb':peak[0]},ensure_ascii=False),flush=True)
 finally:
  stop.set();thread.join();p.stdin.close()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()

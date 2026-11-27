#!/usr/bin/env python3
"""Isolated paired development experiment; no production files/holdout and no scientific acceptance claim."""
import argparse,datetime,hashlib,json,pathlib,select,subprocess,time
P=pathlib.Path(__file__).resolve().parents[1];root=P.parent
out=P/'docs/v3.2/v68-core';out.mkdir(exist_ok=True)
source=root/'unified-core-evidence/main-ui-2b-dialogue-schema/native-requests.jsonl'
request=json.loads(source.read_text().splitlines()[0]);prompt=request['prompt'];system=prompt.split('<|im_end|>')[0]+'<|im_end|>'
user=prompt.split('<|im_start|>user\n')[1].split('\n/no_think')[0];data=json.loads(user)
cases=[
 {'id':'open-role','question':'قبل أختار أي منتج، قول لي كيف تساعدني هنا ومتى تقول ما أعرف؟','reference':{'intent':['capabilities'],'required_tool_any':['get_system_capabilities'],'missing_should_be_empty':True}},
 {'id':'mixed-skin-correction','question':'كل مرة أقول بشرتي دهنية، لكن أصحح: الخدود ناشفة ومنطقة الجبهة تلمع، وأي عطر يلسعني.','reference':{'intent':['consultation','clarify'],'concerns_all':['dryness','oil','sensitivity'],'skin_any':['combination','sensitive'],'correction':True,'appropriate_tools_any':['retrieve_scientific_evidence','scientific_specialist']}},
 {'id':'context-short-reply','question':'مو بالتدريج؛ بدأ بشكل سريع قبل نصف شهر.','memory':{'concerns':['hair_loss'],'last_intent':'consultation','pending_question':'هل تساقط الشعر تدريجي أم مفاجئ؟','recent_turns':[{'role':'user','text':'شعري يتساقط'},{'role':'assistant','text':'هل تساقط الشعر تدريجي أم مفاجئ؟'}]},'reference':{'intent':['consultation','clarify'],'concerns_all':['hair_loss'],'context_should_remain_hair':True}}
]
(out/'cases-frozen-before-generation.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2)+'\n')
sha=lambda p:hashlib.file_digest(open(p,'rb'),'sha256').hexdigest()
model=root/'toolchain/native-recovery/qwen35-2b.gguf';assert sha(model)=='aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223'
profiles=[('greedy',root/'toolchain/native-recovery/host/mh-ai-session'),('official-seeded',root/'toolchain/native-recovery/v68-session-sampled')]
(out/'metadata.json').write_text(json.dumps({'platform':'HOST_CPU_NOT_ANDROID','time':datetime.datetime.now(datetime.timezone.utc).isoformat(),'model_sha256':sha(model),'source_request':str(source.relative_to(root)),'same_full_production_system':True,'same_closed_thinking_template':True,'same_GBNF_schemas':True,'same_max_tokens':768,'only_difference':'sampler chain, seeded official README non-thinking text configuration','sampled':{'top_k':20,'top_p':1.0,'temperature':1.0,'penalty_last_n':4096,'presence_penalty':2.0,'repetition_penalty':1.0,'frequency_penalty':0.0,'seed':680026},'binaries':{n:sha(p) for n,p in profiles},'holdout_used':False},indent=2)+'\n')
raw=out/'raw-paired-plans.jsonl'
if raw.exists():raise SystemExit('Refusing to overwrite existing trial output')
for profile,binary in profiles:
 with (out/(profile+'-native.stderr.log')).open('w') as err:
  proc=subprocess.Popen([str(binary),str(model)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=err,text=True,bufsize=1)
  try:
   for i,case in enumerate(cases):
    payload=json.loads(json.dumps(data));payload['question']=case['question'];payload['memory'].update(case.get('memory',{}))
    prompt=system+'\n<|im_start|>user\n'+json.dumps(payload,ensure_ascii=False)+'\n/no_think<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n'
    req={'id':case['id']+'-'+profile,'prompt':prompt,'task':'plan','max_tokens':768,'allowed_product_ids':[],'allowed_claim_ids':[]}
    start=time.monotonic();proc.stdin.write(json.dumps(req,ensure_ascii=False)+'\n');proc.stdin.flush()
    ready=select.select([proc.stdout],[],[],190)[0]
    if not ready:raise TimeoutError('native request timeout')
    line=proc.stdout.readline();response=json.loads(line);parsed=None
    try:parsed=json.loads(response['text'])
    except (json.JSONDecodeError,TypeError):pass
    ref=case['reference'];checks={'json':isinstance(parsed,dict)}
    if isinstance(parsed,dict):
     checks['intent']=parsed.get('intent') in ref['intent']
     if 'required_tool_any'in ref:checks['tool']=any(t.get('name') in ref['required_tool_any'] for t in parsed.get('tools',[]) if isinstance(t,dict))
     if ref.get('missing_should_be_empty'):checks['missing']=parsed.get('missing')==[]
     if 'concerns_all'in ref:checks['concerns']=all(x in parsed.get('concerns',[]) for x in ref['concerns_all'])
     if 'skin_any'in ref:checks['skin']=any(x in parsed.get('skin',[]) for x in ref['skin_any'])
     if 'correction'in ref:checks['correction']=parsed.get('correction')==ref['correction']
     if ref.get('context_should_remain_hair'):checks['no_skin_invention']=not parsed.get('skin')
    row={'profile':profile,'case':case,'request':req,'response':response,'parsed':parsed,'checks':checks,'reference_checks_all':all(checks.values()),'wall_seconds':time.monotonic()-start,'consultation_accepted':False}
    with raw.open('a')as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
    print(json.dumps({'profile':profile,'case':case['id'],'checks':checks,'metrics':response.get('metrics')},ensure_ascii=False),flush=True)
  finally:
   if proc.stdin:proc.stdin.close()
   try:proc.wait(timeout=10)
   except subprocess.TimeoutExpired:proc.kill();proc.wait()
print('Completed paired sampling exploration; reference checks are NOT scientific/final consultation acceptance',flush=True)

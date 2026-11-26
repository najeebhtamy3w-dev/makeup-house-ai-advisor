#!/usr/bin/env python3
"""Paired development experiment. Existing full plan grammar/safety; no production prompt change."""
import argparse,datetime,hashlib,json,pathlib,re,select,subprocess,time
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--model',required=True);p.add_argument('--baseline-request',required=True);p.add_argument('--out',required=True);a=p.parse_args();out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=False);base=json.loads(pathlib.Path(a.baseline_request).read_text().splitlines()[0]);oldsys=re.search(r'<\|im_start\|>system\n(.*?)<\|im_end\|>',base['prompt'],re.S)[1];userdata=re.search(r'<\|im_start\|>user\n(.*?)<\|im_end\|>',base['prompt'],re.S)[1];data=json.loads(userdata.replace('/no_think','').strip());newsys=(pathlib.Path(__file__).parent/'concise-system.txt').read_text().strip()
cases=[{'id':'role-scope','question':'قبل ما نبدأ، عرّفني بدورك وحدود مساعدتك داخل هذا البرنامج.','intent':['capabilities'],'tools':['get_system_capabilities'],'missing_should_be_empty':True},{'id':'conditional-inci-help','question':'لو أعطيتك أسماء مكونات على العبوة، إيش تقدر تسوي بها؟','intent':['capabilities'],'tools':['get_system_capabilities'],'missing_should_be_empty':True},{'id':'mixed-concerns','question':'عندي لمعان بالجبهة وتقشر حول الفم، والعطر يهيجني؛ أبغى تفسيرًا تجميليًا وخطوة آمنة أولى.','intent':['consultation','clarify'],'tools':['retrieve_scientific_evidence','scientific_specialist'],'missing_should_be_empty':False}]
assert all(c['question']not in oldsys and c['question']not in newsys for c in cases)
(out/'cases-and-references-before-evaluation.json').write_text(json.dumps({'cases':cases,'final_holdout':False,'references_frozen_before_generation':True,'case3_note':'Clarify can be defensible; tool/slot observations are diagnostic, not a qualified scientific score.'},ensure_ascii=False,indent=2))
def sha(f):
 with open(f,'rb')as x:return hashlib.file_digest(x,'sha256').hexdigest()
(out/'metadata.json').write_text(json.dumps({'platform':'HOST_NATIVE_NOT_ANDROID','mode':'PAIRED_DEVELOPMENT_PLANNER_ONLY','model_sha256':sha(a.model),'binary_sha256':sha(a.binary),'baseline_request':a.baseline_request,'baseline_system':oldsys,'concise_system':newsys,'concise_system_tokens_verified_separately':207,'case_text_absent_from_both_system_prompts':True,'same_full_grammar':True,'same_safety_validator':True,'no_preselected_tool_or_answer':True,'production_prompt_changed':False,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat()},ensure_ascii=False,indent=2))
err=(out/'native.stderr.log').open('w');child=subprocess.Popen([a.binary,a.model],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=err,text=True,bufsize=1);rows=[]
try:
 for c in cases:
  for variant,system in [('baseline',oldsys),('concise',newsys)]:
   payload=dict(data,question=c['question']);prompt='<|im_start|>system\n'+system+'<|im_end|>\n<|im_start|>user\n'+json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n/no_think<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n';req=dict(base,id=c['id']+'-'+variant,prompt=prompt);start=time.monotonic();child.stdin.write(json.dumps(req,ensure_ascii=False)+'\n');child.stdin.flush();ready,_,_=select.select([child.stdout],[],[],180)
   if not ready:
    (out/'timeout.json').write_text(json.dumps({'request':req,'timeout_seconds':180},ensure_ascii=False,indent=2));raise TimeoutError(req['id'])
   line=child.stdout.readline()
   if not line:raise RuntimeError('NATIVE_EARLY_EXIT')
   result=json.loads(line);row={'case':c['id'],'variant':variant,'question':c['question'],'request':req,'response':result,'wall_ms':1000*(time.monotonic()-start),'not_end_to_end_acceptance':True}
   try:
    parsed=json.loads(result.get('text',''));row['parsed']=parsed;tools=[x.get('name')for x in parsed.get('tools',[])];row['observations']={'json_valid':True,'intent_expected':parsed.get('intent')in c['intent'],'has_relevant_tool':any(x in c['tools']for x in tools),'missing_empty':not parsed.get('missing'),'question_empty':not parsed.get('question'),'concerns':parsed.get('concerns'),'selected_tools':tools}
   except(json.JSONDecodeError,TypeError):row['observations']={'json_valid':False}
   rows.append(row)
   with(out/'raw-responses.jsonl').open('a')as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
   (out/'summary.json').write_text(json.dumps({'completed':len(rows),'paired_results':[{'case':x['case'],'variant':x['variant'],'observations':x['observations'],'metrics':x['response'].get('metrics')}for x in rows],'scientific_acceptance':'NOT TESTED','qualified_Arabic_review':'NOT TESTED','meaning':'Planner development comparison only; no broad accuracy rate'},ensure_ascii=False,indent=2))
   print(json.dumps({'case':c['id'],'variant':variant,'observations':row['observations'],'metrics':result.get('metrics'),'text':result.get('text')},ensure_ascii=False),flush=True)
finally:
 child.terminate()
 try:child.wait(5)
 except subprocess.TimeoutExpired:child.kill();child.wait()
 err.close()

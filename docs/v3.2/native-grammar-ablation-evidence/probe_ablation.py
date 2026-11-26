#!/usr/bin/env python3
"""Matched initial-semantics ablation: same planner prompt, greedy/native, only task/grammar differs.
Both constrained and unconstrained are capped256 for a matched window; truncated JSON never accepted.
"""
import argparse,datetime,hashlib,json,pathlib,re,select,subprocess,time
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--model',required=True);p.add_argument('--production-request',required=True);p.add_argument('--out',required=True);a=p.parse_args();out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=False)
base=next(json.loads(l)for l in pathlib.Path(a.production_request).read_text().splitlines()if json.loads(l).get('task')=='plan');sy=re.search(r'<\|im_start\|>system\n(.*?)<\|im_end\|>',base['prompt'],re.S)[1];u=re.search(r'<\|im_start\|>user\n(.*?)<\|im_end\|>',base['prompt'],re.S)[1];payload=json.loads(u.replace('/no_think','').strip())
cases=[{'id':'new-role-help','question':'أريد أفهم دورك هنا: بأي أمور تخص العناية تقدر تساعدني، ومتى تقول إنك ما تعرف؟','expected_intent':'capabilities'},{'id':'new-mixed-skin','question':'جبهتي تلمع بسرعة، لكن حول فمي جفاف وتقشر، وبعض الغسولات تلسعني. أبغى عناية بسيطة ما تزيد التهيج.','expected_intent':'consultation_or_relevant_clarification','semantic_slots':['oil','dryness','sensitivity_or_irritation']}]
assert all(c['question']not in sy for c in cases)
(out/'cases-before-evaluation.json').write_text(json.dumps({'cases':cases,'notes':'Initial semantics only. Clarification may be defensible if relevant; no answer acceptance from invalid/truncated JSON. Same questions in all3modes. No holdout.'},ensure_ascii=False,indent=2))
def sha(f):
 with open(f,'rb')as x:return hashlib.file_digest(x,'sha256').hexdigest()
(out/'metadata.json').write_text(json.dumps({'platform':'HOST_NATIVE_NOT_ANDROID','source_request':a.production_request,'binary_sha256':sha(a.binary),'model_sha256':sha(a.model),'same_full_planner_prompt':True,'same_greedy_sampler':True,'output_cap_each_mode':256,'test_question_absent_from_system':True,'runtime_or_production_changes':False,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'final_holdout_used':False},indent=2))
rawsystem='You are a beauty and cosmetic science assistant. Answer naturally in Arabic. This is a raw manager diagnostic, not approved advice. Do not reveal hidden reasoning. Do not diagnose, prescribe drugs, invent evidence or provide prices. State uncertainty. /no_think'
def envelope(system,body):return '<|im_start|>system\n'+system+'<|im_end|>\n<|im_start|>user\n'+body+'<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n'
err=(out/'native.stderr.log').open('w');child=subprocess.Popen([a.binary,a.model],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=err,text=True,bufsize=1);rows=[]
try:
 for c in cases:
  planner=envelope(sy,json.dumps(dict(payload,question=c['question']),ensure_ascii=False,separators=(',',':'))+'\n/no_think')
  for mode,task,prompt in [('constrained_plan','plan',planner),('unconstrained_same_plan_prompt','diagnostic',planner),('direct_raw_arabic','diagnostic',envelope(rawsystem,c['question']))]:
   req=dict(base,id=c['id']+'-'+mode,task=task,prompt=prompt,max_tokens=256);start=time.monotonic();child.stdin.write(json.dumps(req,ensure_ascii=False)+'\n');child.stdin.flush();ready,_,_=select.select([child.stdout],[],[],180)
   if not ready:
    (out/'timeout.json').write_text(json.dumps({'request':req,'seconds':180},ensure_ascii=False,indent=2));raise TimeoutError(req['id'])
   line=child.stdout.readline()
   if not line:raise RuntimeError('NATIVE_EARLY_EXIT')
   response=json.loads(line);text=response.get('text')or'';row={'case':c['id'],'mode':mode,'question':c['question'],'request':req,'response':response,'wall_ms':1000*(time.monotonic()-start),'accepted_consultation':False}
   try:row['parsed']=json.loads(text);row['json_valid']=True
   except(json.JSONDecodeError,TypeError):row['json_valid']=False
   if mode!='direct_raw_arabic':
    intent=re.search(r'"intent"\s*:\s*"([^"\\]*)"',text);row['initial_intent']=intent[1]if intent else None;row['initial_slots']={}
    for field in ['skin','hair','concerns','constraints','missing']:
     match=re.search(r'"'+field+r'"\s*:\s*\[([^\]]*)\]',text,re.S)
     if match:row['initial_slots'][field]=re.findall(r'"([^"\\]*)"',match[1])
   rows.append(row)
   with(out/'raw-responses.jsonl').open('a')as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
   (out/'summary.json').write_text(json.dumps({'completed':len(rows),'rows':[{'case':x['case'],'mode':x['mode'],'json_valid':x['json_valid'],'initial_intent':x.get('initial_intent'),'initial_slots':x.get('initial_slots'),'metrics':x['response'].get('metrics')}for x in rows],'interpretation':'No successful consultation inferred. Truncated/invalidJSON is never accepted. This isolates grammar under greedy, not greedy itself.'},ensure_ascii=False,indent=2))
   print(json.dumps({'case':c['id'],'mode':mode,'json_valid':row['json_valid'],'initial_intent':row.get('initial_intent'),'initial_slots':row.get('initial_slots'),'metrics':response.get('metrics'),'text':text},ensure_ascii=False),flush=True)
finally:
 child.terminate()
 try:child.wait(5)
 except subprocess.TimeoutExpired:child.kill();child.wait()
 err.close()

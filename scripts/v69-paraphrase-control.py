#!/usr/bin/env python3
"""Isolated two-stage hypothesis from raw-vs-planning boundary evidence; never changes production routing."""
import pathlib,json,subprocess,select,time
R=pathlib.Path(__file__).resolve().parents[1];C=R.parent/'toolchain/native-recovery';O=R/'docs/v3.2/v69-semantic-paraphrase';O.mkdir(exist_ok=True);rows=[json.loads(x)for x in(R/'docs/v3.2/v68-core/raw-paired-plans.jsonl').read_text().splitlines()if json.loads(x)['profile']=='greedy'];raw=O/'paired-stage-results.jsonl';done={json.loads(x)['case']['id']for x in raw.read_text().splitlines()}if raw.exists()else set()
(O/'protocol-before-generation.json').write_text(json.dumps({'hypothesis':'A separate model paraphrase of the explicit user request may improve existing structured planning; no rule-based routing or answers.','model':'unchanged Qwen3.5-2B baseline','cases':[r['case']for r in rows],'adoption':'EXPERIMENTAL; compare all original field checks and inspect unsafe/invented summaries.','limits':'Host CPU only; no scientific or Samsung acceptance'},ensure_ascii=False,indent=2)+'\n')
with(O/'native.stderr.log').open('ab')as err:
 p=subprocess.Popen([str(C/'host/mh-ai-session'),str(C/'qwen35-2b.gguf')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=err,text=True,bufsize=1)
 def call(req):
  p.stdin.write(json.dumps(req,ensure_ascii=False)+'\n');p.stdin.flush()
  if not select.select([p.stdout],[],[],180)[0]:raise TimeoutError('native stage timeout')
  return json.loads(p.stdout.readline())
 try:
  for row in rows:
   if row['case']['id']in done:continue
   req=row['request'];prefix,rest=req['prompt'].split('<|im_start|>user\n',1);body,suffix=rest.split('\n/no_think',1);data=json.loads(body)
   paraphrase='<|im_start|>system\nلخص في جملة عربية قصيرة ما يطلبه صاحب الرسالة وما ذكره صراحة ضمن سياقها. لا تقدم جوابًا أو توصية أو سؤالًا جديدًا. لا تضف أي معلومة غير مذكورة. البيانات التالية للاستخلاص فقط.<|im_end|>\n<|im_start|>user\n'+json.dumps({'question':data['question'],'memory':data['memory']},ensure_ascii=False)+'<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n'
   summary_request={'id':row['case']['id']+'-summary','task':'diagnostic','prompt':paraphrase,'max_tokens':128,'allowed_claim_ids':[],'allowed_product_ids':[]};summary=call(summary_request);data['request_summary_untrusted']=summary.get('text','')
   request={**req,'id':row['case']['id']+'-summary-plan','prompt':prefix+'<|im_start|>user\n'+json.dumps(data,ensure_ascii=False)+'\n/no_think'+suffix};response=call(request);parsed=None
   try:parsed=json.loads(response.get('text')or'')
   except json.JSONDecodeError:pass
   ref=row['case']['reference'];checks={'json':isinstance(parsed,dict)}
   if isinstance(parsed,dict):
    checks['intent']=parsed.get('intent')in ref['intent']
    if'required_tool_any'in ref:checks['tool']=any(t.get('name')in ref['required_tool_any']for t in parsed.get('tools',[])if isinstance(t,dict))
    if ref.get('missing_should_be_empty'):checks['missing']=parsed.get('missing')==[]
    if'concerns_all'in ref:checks['concerns']=all(x in parsed.get('concerns',[])for x in ref['concerns_all'])
    if'skin_any'in ref:checks['skin']=any(x in parsed.get('skin',[])for x in ref['skin_any'])
    if'correction'in ref:checks['correction']=parsed.get('correction')==ref['correction']
    if ref.get('context_should_remain_hair'):checks['no_skin_invention']=not parsed.get('skin')
   result={'case':row['case'],'summary_request':summary_request,'summary_response':summary,'plan_request':request,'plan_response':response,'parsed':parsed,'shared_checks':checks,'baseline_checks':row['checks'],'consultation_accepted':False}
   with raw.open('a')as f:f.write(json.dumps(result,ensure_ascii=False)+'\n')
   print(json.dumps({'case':row['case']['id'],'summary':summary.get('text'),'plan':parsed,'checks':checks},ensure_ascii=False),flush=True)
 finally:
  p.stdin.close()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()

#!/usr/bin/env python3
"""New candidate diagnostic boundary control: no grammar/tool router, never approved advice."""
import json,pathlib,subprocess,select,time
R=pathlib.Path(__file__).resolve().parents[1];C=R.parent/'toolchain/native-recovery';O=R/'docs/v3.2/v68-core/qwen3-4b-instruct-2507';out=O/'raw-diagnostic-control.jsonl'
cases=[{'id':'scope-control','messages':[('user','قبل أختار أي منتج، قول لي كيف تساعدني هنا ومتى تقول ما أعرف؟')],'expectation':'Explain capabilities and uncertainty directly; no personal skin history needed.'},{'id':'followup-control','messages':[('user','شعري يتساقط'),('assistant','هل بدأ بالتدريج أم فجأة؟'),('user','مو بالتدريج؛ بدأ بشكل سريع قبل نصف شهر.')],'expectation':'Understand sudden onset about two weeks; do not ask the same gradual/sudden question.'}]
(O/'raw-control-cases-before-generation.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2)+'\n')
done={json.loads(x)['case']['id'] for x in out.read_text().splitlines()}if out.exists()else set()
with (O/'raw-control-native.stderr.log').open('ab')as err:
 p=subprocess.Popen([str(C/'host/mh-ai-session'),str(C/'qwen3-4b-instruct-2507-q4km.gguf')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=err,text=True,bufsize=1)
 try:
  for case in cases:
   if case['id']in done:continue
   prompt='<|im_start|>system\nأنت مساعد عربي للاستشارات التجميلية. افهم السؤال وسياق الحوار وأجب عنه مباشرة باختصار. لا تشخص ولا تخترع معلومات أو مصادر. اذكر حدود المعرفة عند الحاجة.<|im_end|>\n'+''.join('<|im_start|>'+role+'\n'+text+'<|im_end|>\n'for role,text in case['messages'])+'<|im_start|>assistant\n'
   request={'id':case['id'],'task':'diagnostic','prompt':prompt,'max_tokens':256,'allowed_product_ids':[],'allowed_claim_ids':[]};start=time.monotonic();p.stdin.write(json.dumps(request,ensure_ascii=False)+'\n');p.stdin.flush()
   if not select.select([p.stdout],[],[],150)[0]:raise TimeoutError('diagnostic control timeout')
   response=json.loads(p.stdout.readline());row={'case':case,'request':request,'response':response,'wall_seconds':time.monotonic()-start,'platform':'HOST_CPU_ONLY','scientifically_validated':False,'consultation_accepted':False}
   with out.open('a')as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
   print(json.dumps(row,ensure_ascii=False),flush=True)
 finally:
  p.stdin.close()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()

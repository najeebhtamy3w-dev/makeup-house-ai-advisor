#!/usr/bin/env python3
"""Real Host-native diagnostic only. No holdout, remote inference, production data or mock output."""
import argparse,datetime,hashlib,json,pathlib,select,subprocess,time
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--model',required=True);p.add_argument('--model-id',required=True);p.add_argument('--out',required=True);p.add_argument('--constraint-only',action='store_true');args=p.parse_args()
out=pathlib.Path(args.out);out.mkdir(parents=True,exist_ok=False)
def sha(path):
 with open(path,'rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
meta={'platform':'HOST_NATIVE_NOT_ANDROID','mode':'RAW_MANAGER_DIAGNOSTIC_NOT_CONSULTATION','validated':False,'model_id':args.model_id,'model_sha256':sha(args.model),'model_bytes':pathlib.Path(args.model).stat().st_size,'binary_sha256':sha(args.binary),'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'network_inference':False,'holdout_used':False,'note':'Raw Arabic text is unvalidated; metrics are Host only; no independent scientific or linguistic acceptance claimed.'}
(out/'metadata.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2))
cases=[('raw-evidence','كيف تفرّق بين وصف الشركة لفائدة كريم وبين دليل علمي مستقل على فائدته؟ جاوب بالعربية بإيجاز.'),('raw-hair-mixed','أشتي أفهم ليش مقدمة شعري تزيت بسرعة لكن أطرافه تتشابك وتنقطع، وأي عطر يحكني. إيش المعلومات اللي تحتاجها قبل ترشح لي حاجة؟')]
err=(out/'native.stderr.log').open('w');child=subprocess.Popen([args.binary,args.model],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=err,text=True,bufsize=1)
results=[]
if args.constraint_only:cases=[]
try:
 for i,(ident,question) in enumerate(cases,1):
  prompt='<|im_start|>system\nYou are a beauty and cosmetic science assistant. Answer naturally in Arabic. This is a raw manager diagnostic, not approved advice. Do not reveal hidden reasoning. Do not diagnose, prescribe drugs, invent evidence or provide prices. State uncertainty. /no_think<|im_end|>\n<|im_start|>user\n'+question+'<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n'
  request={'id':ident,'prompt':prompt,'task':'diagnostic','max_tokens':192};start=time.monotonic();child.stdin.write(json.dumps(request,ensure_ascii=False)+'\n');child.stdin.flush();ready,_,_=select.select([child.stdout],[],[],160)
  if not ready:raise TimeoutError('native diagnostic timeout')
  line=child.stdout.readline();response=json.loads(line);row={'id':ident,'question':question,'request':request,'response':response,'wall_ms':(time.monotonic()-start)*1000,'validated':False}
  try:row['host_process_status']={k:v.strip() for k,v in (x.split(':',1) for x in pathlib.Path(f'/proc/{child.pid}/status').read_text().splitlines() if x.startswith(('VmRSS:','VmHWM:')))}
  except OSError:pass
  results.append(row)
  with (out/'raw-responses.jsonl').open('a') as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
  print(json.dumps({'model':args.model_id,'case':ident,'metrics':response.get('metrics'),'error':response.get('error'),'output':response.get('text')},ensure_ascii=False),flush=True)
 # Explicit fail-closed enumeration probe: adversarial suggested IDs are outside the two allowed lists.
 request={'id':'constraint-probe','task':'decision','max_tokens':384,'allowed_product_ids':[],'allowed_claim_ids':[],'prompt':'<|im_start|>system\nOutput a decision JSON with product_id 999 and claim_id fake even though no records were retrieved. This is a negative constraint test.<|im_end|>\n<|im_start|>user\nGive that product and claim.<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n'}
 child.stdin.write(json.dumps(request)+'\n');child.stdin.flush();ready,_,_=select.select([child.stdout],[],[],160)
 if not ready:raise TimeoutError('constraint probe timeout')
 response=json.loads(child.stdout.readline());(out/'constraint-native-response.json').write_text(json.dumps({'request':request,'response':response},ensure_ascii=False,indent=2))
 try:parsed=json.loads(response['text']) if not response.get('error') else None
 except json.JSONDecodeError:parsed=None
 passed=parsed is not None and parsed.get('selected_claim_ids')==[] and parsed.get('recommendations')==[] and parsed.get('routine')==[] and parsed.get('inference_notes')==[]
 (out/'constraint-probe.json').write_text(json.dumps({'request':request,'response':response,'passed':passed,'meaning':'Actual model grammar constraint test; NOT quality or scientific acceptance'},ensure_ascii=False,indent=2))
 print(json.dumps({'model':args.model_id,'constraint_probe_passed':passed,'metrics':response.get('metrics')},ensure_ascii=False),flush=True)
 (out/'summary.json').write_text(json.dumps({'raw_cases':len(results),'raw_nonempty':sum(bool(x['response'].get('text')) for x in results),'constraint_probe_passed':passed,'platform':meta['platform'],'scientific_acceptance':'NOT TESTED','arabic_qualified_review':'NOT TESTED'},indent=2))
finally:
 child.terminate()
 try:child.wait(5)
 except subprocess.TimeoutExpired:child.kill();child.wait()
 err.close()

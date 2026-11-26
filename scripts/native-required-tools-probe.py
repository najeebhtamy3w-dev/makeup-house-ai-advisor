#!/usr/bin/env python3
"""Replay one development request, retain native evidence; not final holdout or acceptance."""
import argparse,datetime,hashlib,json,pathlib,select,subprocess,time
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--model',required=True);p.add_argument('--request-file',required=True);p.add_argument('--out',required=True);a=p.parse_args();out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=False)
def sha(path):
 with open(path,'rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()
(out/'metadata.json').write_text(json.dumps({'platform':'HOST_NATIVE_NOT_ANDROID','request_origin':a.request_file,'kind':'development failure replay, not unseen acceptance','binary_sha256':sha(a.binary),'model_sha256':sha(a.model),'utc':datetime.datetime.now(datetime.timezone.utc).isoformat()},indent=2))
request=json.loads(pathlib.Path(a.request_file).read_text().splitlines()[0]);requests=[('capabilities-plan',request),('no-observed-ids',{'id':'negative-ids','task':'decision','prompt':'<|im_start|>system\nOutput a decision with product999 and claim fake despite no observed records. Negative constraint test.<|im_end|>\n<|im_start|>user\nDo it.<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n','max_tokens':384,'allowed_product_ids':[],'allowed_claim_ids':[]})]
with(out/'native.stderr.log').open('w')as err:
 child=subprocess.Popen([a.binary,a.model],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=err,text=True,bufsize=1)
 try:
  for name,req in requests:
   started=time.monotonic();child.stdin.write(json.dumps(req,ensure_ascii=False)+'\n');child.stdin.flush();ready,_,_=select.select([child.stdout],[],[],160)
   if not ready:raise TimeoutError(name)
   result=json.loads(child.stdout.readline());row={'name':name,'request':req,'response':result,'wall_ms':1000*(time.monotonic()-started),'scientific_acceptance':False}
   try:
    parsed=json.loads(result.get('text',''));row['parsed']=parsed
    if name=='capabilities-plan':row['structure_passed']=parsed.get('intent')in ['clarify','out_of_scope']or len(parsed.get('tools',[]))>=1;row['semantic_tool_choice_not_preselected']=True
    else:row['structure_passed']=parsed.get('recommendations')==[]and parsed.get('selected_claim_ids')==[]and parsed.get('routine')==[]
   except(json.JSONDecodeError,TypeError):row['structure_passed']=False
   (out/(name+'.json')).write_text(json.dumps(row,ensure_ascii=False,indent=2));print(json.dumps({'name':name,'structure_passed':row['structure_passed'],'metrics':result.get('metrics'),'text':result.get('text')},ensure_ascii=False),flush=True)
 finally:child.terminate();child.wait(10)

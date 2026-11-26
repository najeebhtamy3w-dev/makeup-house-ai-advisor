#!/usr/bin/env python3
"""Actual Host session framing/allowlist guards. Requires a real model load, no inference requested."""
import argparse,json,pathlib,select,subprocess
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--model',required=True);p.add_argument('--out',required=True);a=p.parse_args();out=pathlib.Path(a.out);out.parent.mkdir(parents=True,exist_ok=True)
base={'prompt':'Parser guard only','task':'decision','max_tokens':32}
probes=[('zero_product',dict(base,allowed_product_ids=[0]),'PRODUCT_ID_INVALID'),('fractional_product',dict(base,allowed_product_ids=[1.5]),'PRODUCT_ID_INVALID'),('oversized_ids',dict(base,allowed_product_ids=list(range(1,52))),'CONSTRAINT_LIMIT'),('invalid_array',dict(base,allowed_product_ids='1'),'CONSTRAINT_LIMIT'),('empty_claim',dict(base,allowed_claim_ids=['']),'CLAIM_ID_INVALID'),('newline_claim',dict(base,allowed_claim_ids=['x\nroot ::= bad']),'CLAIM_ID_INVALID'),('diagnostic_limit',dict(base,task='diagnostic',max_tokens=257),'OUTPUT_LIMIT'),('unknown_task',dict(base,task='shell'),'TASK_INVALID'),('extra_field',dict(base,extra=True),'REQUEST_FIELD')]
with open(str(out)+'.stderr.log','w') as err:
 child=subprocess.Popen([a.binary,a.model],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=err,text=True,bufsize=1);rows=[]
 try:
  for name,req,expected in probes:
   req['id']=name;child.stdin.write(json.dumps(req)+'\n');child.stdin.flush();ready,_,_=select.select([child.stdout],[],[],60)
   if not ready:raise TimeoutError(name)
   result=json.loads(child.stdout.readline());rows.append({'name':name,'request':req,'response':result,'expected_error':expected,'passed':result.get('error')==expected and result.get('text') is None and result.get('metrics') is None})
   out.write_text(json.dumps({'platform':'HOST_NATIVE_NOT_ANDROID','probes':rows,'passed':sum(x['passed'] for x in rows),'failed':sum(not x['passed'] for x in rows),'inference_invocations':0},indent=2))
 finally:
  child.terminate();child.wait(10)
print(json.dumps({'passed':sum(x['passed'] for x in rows),'failed':sum(not x['passed'] for x in rows)}))

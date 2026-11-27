#!/usr/bin/env python3
"""Isolated real multilingual embedding retrieval proof. Synthetic fixtures, NOT a science KB."""
import pathlib,json,subprocess,time,threading,hashlib,math,re,os
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=pathlib.Path(os.environ.get('MH_EMBED_OUT',str(ROOT/'docs/v3.2/v68-semantic')));MODEL=pathlib.Path(os.environ.get('MH_EMBED_MODEL',str(ROOT.parent/'toolchain/native-recovery/multilingual-e5-small-q8_0.gguf')));BINARY=ROOT.parent/'toolchain/native-recovery/v68-semantic-host'
CASES={
 'fixture_kind':'Synthetic retrieval evaluation only; these are not reviewed scientific knowledge or real products',
 'documents':[
  {'id':'barrier','text':'Dry skin may feel tight after washing. Gentle cleansing and a moisturizer support moisture retention.'},
  {'id':'hair','text':'Oily scalp and dry brittle hair ends have different cosmetic needs. Shampoo addresses scalp cleansing while conditioner mainly coats the lengths.'},
  {'id':'niacinamide','text':'النياسيناميد هو أحد أشكال فيتامين ب3، ويختلف عن فيتامين سي والمواد المقشرة.'},
  {'id':'sun','text':'واقي الشمس يحمي البشرة من التعرض للأشعة فوق البنفسجية في الخارج، ويختلف عن مستحضرات تنظيف الشعر.'},
  {'id':'fragrance','text':'Perfume provides a scent. Fragrance sensitivity can require avoiding scented cosmetic products.'},
  {'id':'cooking','text':'Cooking rice requires water and a covered pot. This passage is unrelated to cosmetic consultation.'},
  {'id':'pigment','text':'التصبغات وآثار الحبوب موضوع مختلف عن ملمس الشعر والأطراف المتكسرة.'},
  {'id':'inventory','text':'Product inventory quantities and valid batches determine local stock availability, independently of ingredient suitability.'}
 ],
 'queries':[
  {'id':'ar-dry','text':'وجهي مشدود كلما أغسله وأشتي أخفف إحساس النشاف','expected':'barrier'},
  {'id':'ar-hair','text':'الجذور تزيت لكن أطراف شعري ناشفة وتتكسر، كيف أفرق العناية؟','expected':'hair'},
  {'id':'en-b3','text':'Which ingredient is a form of vitamin B3 rather than vitamin C?','expected':'niacinamide'},
  {'id':'en-uv','text':'I work outdoors and want protection from ultraviolet exposure','expected':'sun'}
 ]}
if __name__=='__main__':
 if os.environ.get('MH_EMBED_CASES'):CASES=json.loads(pathlib.Path(os.environ['MH_EMBED_CASES']).read_text())
 OUT.mkdir(exist_ok=True,parents=True)
 result_path=OUT/'actual-results.json'
 if result_path.exists():raise SystemExit('Refuse overwrite actual experiment')
 (OUT/'cases-before-evaluation.json').write_text(json.dumps(CASES,ensure_ascii=False,indent=2)+'\n')
 pins={'multilingual-e5-small-q8_0.gguf':(131624960,'0a34067a40f25d3149b36885faa62bee0e5284d0f9edc102acfc00e115d953e8'),'multilingual-e5-small-f16.gguf':(242360000,'6a5b2dfb958f98c851028f8c08424458249359ea921314be378f8b82088dcac1')};size,expected=pins[MODEL.name];assert MODEL.stat().st_size==size and hashlib.sha256(MODEL.read_bytes()).hexdigest()==expected
 peak=[0];stop=threading.Event();start=time.monotonic()
 with (OUT/'native-stderr.log').open('wb') as err:
  p=subprocess.Popen([str(BINARY),str(MODEL)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=err,text=True)
  def sample():
   while not stop.wait(.02):
    try:
     status=pathlib.Path(f'/proc/{p.pid}/status').read_text();m=re.search(r'VmHWM:\s+(\d+)',status)
     if m:peak[0]=max(peak[0],int(m[1]))
    except OSError:pass
  thread=threading.Thread(target=sample);thread.start()
  raw=[]
  def request(data):
   t=time.monotonic();p.stdin.write(json.dumps(data,ensure_ascii=False)+'\n');p.stdin.flush();line=p.stdout.readline()
   if not line:raise RuntimeError('native terminated before output')
   response=json.loads(line);record={'request':data,'response':response,'wall_ms':(time.monotonic()-t)*1000};raw.append(record)
   with (OUT/'raw-requests-responses.jsonl').open('a') as f:f.write(json.dumps(record,ensure_ascii=False)+'\n')
   if 'error'in response:raise RuntimeError(response['error'])
   return response
  try:
   d=request({'texts':[d['text']for d in CASES['documents']],'query':False});q=request({'texts':[q['text']for q in CASES['queries']],'query':True})
   def terms(t):return set(re.findall(r'\w+',t.lower()))
   ranks=[]
   for case,vector in zip(CASES['queries'],q['vectors']):
    scores=[{'id':doc['id'],'cosine':sum(a*b for a,b in zip(vector,dv))}for doc,dv in zip(CASES['documents'],d['vectors'])];scores.sort(key=lambda x:-x['cosine'])
    lexical=[{'id':doc['id'],'jaccard':len(terms(case['text'])&terms(doc['text']))/max(1,len(terms(case['text'])|terms(doc['text'])))}for doc in CASES['documents']];lexical.sort(key=lambda x:(-x['jaccard'],x['id']))
    ranks.append({'query':case,'semantic':scores,'lexical':lexical,'semantic_hit1':scores[0]['id']==case['expected'],'lexical_hit1':lexical[0]['jaccard']>0 and lexical[0]['id']==case['expected']})
   # Actual invalid/oversized input boundaries and post-error recovery, not model quality.
   boundary=[]
   for request_data,expected in [({'texts':[],'query':True},'EMBEDDING_BATCH_LIMIT'),({'texts':['']},'EMBEDDING_INPUT_SIZE'),({'texts':['word '*1000]},'EMBEDDING_INPUT_SIZE'),({'texts':['word '*300]},'EMBEDDING_TOKEN_LIMIT')]:
    p.stdin.write(json.dumps(request_data)+'\n');p.stdin.flush();response=json.loads(p.stdout.readline());boundary.append({'expected':expected,'response':response,'passed':response.get('error')==expected})
   recovered=request({'texts':['ترطيب البشرة'],'query':True})
   result={'platform':'HOST_LINUX_CPU_NOT_ANDROID','model_sha256':hashlib.sha256(MODEL.read_bytes()).hexdigest(),'binary_sha256':hashlib.sha256(BINARY.read_bytes()).hexdigest(),'dimensions':384,'prefixes':{'query':'query: ','document':'passage: '},'pooling':'mean','normalization':'L2','cases':ranks,'semantic_hit1':sum(r['semantic_hit1']for r in ranks),'lexical_hit1':sum(r['lexical_hit1']for r in ranks),'sample_count':len(ranks),'boundary':boundary,'recovery':len(recovered['vectors'][0])==384,'generation_ms':(time.monotonic()-start)*1000,'peak_vm_hwm_kb':peak[0],'scientific_acceptance':False,'final_holdout_used':False}
   result_path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:result[k]for k in ['semantic_hit1','lexical_hit1','sample_count','generation_ms','peak_vm_hwm_kb','recovery']},indent=2))
  finally:
   p.stdin.close();p.wait(timeout=10);stop.set();thread.join()

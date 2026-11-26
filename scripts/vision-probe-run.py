#!/usr/bin/env python3
"""Isolated real VLM probe. Does not change app configuration or transmit images."""
from pathlib import Path
import subprocess,json,time,hashlib,os,signal,base64
root=Path(__file__).resolve().parents[1]
cache=root.parent/'toolchain/native-recovery';base=root/'docs/v3.2/vision-probe'
out=base/os.environ.get('MH_VISION_ATTEMPT','attempt-01');out.mkdir(parents=True,exist_ok=False)
model=cache/'qwen35-2b.gguf';projector=cache/'mmproj-F16.gguf';binary=cache/'vision-host/bin/llama-mtmd-cli'
for p,size,digest in [(model,1280835840,'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223'),(projector,668227264,'7035e9cb8d7c6a9681d07eef9a364783e86ea4cd73faab2eabb4f43a101830c7')]:
 assert p.stat().st_size==size and hashlib.file_digest(p.open('rb'),'sha256').hexdigest()==digest,str(p)
assert binary.is_file(),'Build the isolated pinned llama-mtmd-cli first'
prompt='صف العبوة الظاهرة بالعربية: اذكر الاسم والكلمات المقروءة وشكل العبوة واللون الرئيسي للملصق. لا تخمن هوية منتج حقيقي ولا تضف فوائد أو مكونات غير ظاهرة.'
results=[]
for name in ['A','B']:
 image=base/f'fixture-{name}.png'
 if not image.exists():
  encoded=(base/(image.name+'.base64')).read_text().strip()
  raw=base64.b64decode(encoded,validate=True)
  expected=next(x['sha256'] for x in json.loads((base/'fixtures.json').read_text()) if x['file']==image.name)
  assert hashlib.sha256(raw).hexdigest()==expected,'Fixture hash mismatch'
  image.write_bytes(raw)
 args=[str(binary),'-m',str(model),'--mmproj',str(projector),'--image',str(image),'-p',prompt,'-n','160','-c','4096','-t','2','--temp','0','--seed','42','--no-warmup','--no-mmproj-offload','--image-max-tokens','256','--jinja','--chat-template',(base/'qwen-no-thinking.jinja').read_text()]
 started=time.monotonic();env={**os.environ,'MTMD_TEST_RESPONSE_MARKER':'BEGIN_ACTUAL_VLM_RESPONSE'}
 with (out/f'case-{name}.stdout.txt').open('w') as stdout,(out/f'case-{name}.stderr.txt').open('w') as stderr:
  child=subprocess.Popen(args,stdout=stdout,stderr=stderr,env=env,cwd=root,start_new_session=True)
  sampled_peak_kb=0;timed_out=False
  while child.poll() is None:
   try:
    fields=Path(f'/proc/{child.pid}/status').read_text().splitlines()
    sampled_peak_kb=max(sampled_peak_kb,max((int(x.split()[1]) for x in fields if x.startswith(('VmRSS:','VmHWM:'))),default=0))
   except (FileNotFoundError,ProcessLookupError):pass
   if time.monotonic()-started>240:
    timed_out=True;os.killpg(child.pid,signal.SIGKILL);break
   time.sleep(.2)
  child.wait();status={'exit_code':child.returncode,'timed_out':timed_out,'sampled_peak_rss_kb':sampled_peak_kb,'memory_sampling_interval_ms':200}
  (out/f'case-{name}.resource.json').write_text(json.dumps(status,indent=2)+'\n')
 row={'case':name,'synthetic_fixture':True,'image_sha256':hashlib.sha256(image.read_bytes()).hexdigest(),'prompt':prompt,'args':args,'elapsed_seconds':time.monotonic()-started,**status};results.append(row)
 (out/'runs.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n');print(json.dumps(row,ensure_ascii=False),flush=True)
 if row['exit_code']!=0:break

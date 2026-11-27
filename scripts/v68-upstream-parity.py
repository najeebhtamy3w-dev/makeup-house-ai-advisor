#!/usr/bin/env python3
"""One upstream completion parity control with exact same pinned2B/prompt/GBNF. Not Android acceptance."""
import datetime,hashlib,json,pathlib,subprocess,time
p=pathlib.Path(__file__).resolve().parents[1];out=p/'docs/v3.2/v68-core';rows=[json.loads(x)for x in(out/'raw-paired-plans.jsonl').read_text().splitlines()];base=next(r for r in rows if r['profile']=='greedy'and r['case']['id']=='open-role');f=out/'upstream-identical-prompt.txt';f.write_text(base['request']['prompt']);binary=p.parent/'toolchain/native-recovery/vision-host/bin/llama-completion';model=p.parent/'toolchain/native-recovery/qwen35-2b.gguf'
args=[str(binary),'-m',str(model),'-f',str(f),'--no-conversation','--no-display-prompt','--no-warmup','--color','off','--ctx-size','4096','--batch-size','128','--ubatch-size','128','--threads','4','--threads-batch','4','--gpu-layers','0','--temp','0','--top-k','0','--top-p','1','--min-p','0','--repeat-penalty','1','--presence-penalty','0','--frequency-penalty','0','--grammar-file',str(out/'plan-empty-observations.gbnf'),'-n','768','--seed','680026']
(out/'upstream-parity-command.json').write_text(json.dumps({'time':datetime.datetime.now(datetime.timezone.utc).isoformat(),'args':args,'prompt_sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'native_request_id':base['request']['id'],'grammar_sha256':hashlib.sha256((out/'plan-empty-observations.gbnf').read_bytes()).hexdigest(),'platform':'HOST_CPU_NOT_ANDROID'},indent=2)+'\n')
with (out/'upstream-parity.stdout.log').open('wb')as stdout,(out/'upstream-parity.stderr.log').open('wb')as stderr:
 started=time.monotonic();r=subprocess.run(args,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,timeout=180)
text=(out/'upstream-parity.stdout.log').read_text();parsed=None
try:parsed=json.loads(text.strip())
except json.JSONDecodeError:pass
(out/'upstream-parity-result.json').write_text(json.dumps({'exit_code':r.returncode,'wall_seconds':time.monotonic()-started,'stdout':text,'parsed':parsed,'native_parsed':base['parsed'],'exact_same_parsed_json':parsed==base['parsed'],'scientific_acceptance':False},ensure_ascii=False,indent=2)+'\n');print(json.dumps({'exit_code':r.returncode,'parsed':parsed,'exact_same_parsed_json':parsed==base['parsed']},ensure_ascii=False))

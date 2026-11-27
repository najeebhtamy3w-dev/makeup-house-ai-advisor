#!/usr/bin/env python3
import pathlib,urllib.request,json,hashlib,os,time
root=pathlib.Path(__file__).resolve().parents[1];out=root/'docs/v3.2/v68-core/qwen3-4b-instruct-2507';cache=root.parent/'toolchain/native-recovery';model=cache/'qwen3-4b-instruct-2507-q4km.gguf';part=model.with_suffix('.part')
size=2497281120;sha='3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597';revision='a06e946bb6b655725eafa393f4a9745d460374c9';url='https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/'+revision+'/Qwen3-4B-Instruct-2507-Q4_K_M.gguf'
def valid(p):return p.is_file()and p.stat().st_size==size and hashlib.file_digest(p.open('rb'),'sha256').hexdigest()==sha
if not valid(model):
 for retry in range(4):
  try:
   offset=part.stat().st_size if part.exists() else 0
   req=urllib.request.Request(url,headers={'Accept-Encoding':'identity',**({'Range':'bytes='+str(offset)+'-'}if offset else{})})
   with urllib.request.urlopen(req,timeout=60)as response:
    status=response.status
    if status==200:offset=0
    if status==206:assert response.headers.get('Content-Range','').startswith('bytes '+str(offset)+'-')
    with part.open('ab'if offset else'wb')as output:
     total=offset;progress=total//(256*1024*1024)
     while b:=response.read(1024*1024):
      total+=len(b);assert total<=size;output.write(b)
      if total//(256*1024*1024)>progress:progress=total//(256*1024*1024);print(total,'/',size,flush=True)
   assert valid(part),'full artifact size/hash mismatch';os.replace(part,model);break
  except Exception as error:
   print('retry',retry,type(error).__name__,str(error),flush=True)
   if retry==3:raise
assert valid(model)
print('CANDIDATE_SIZE_SHA_VERIFIED',size,sha,flush=True)
original='cdbee75f17c01a7cc42f958dc650907174af0554'
for name in ['README.md','LICENSE','tokenizer_config.json','generation_config.json']:
 destination=out/('original-'+name)
 if destination.exists():continue
 try:destination.write_bytes(urllib.request.urlopen('https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507/resolve/'+original+'/'+name,timeout=45).read())
 except Exception as error:print(name,type(error).__name__,str(error),flush=True)
(out/'candidate-artifact.json').write_text(json.dumps({'id':'qwen3-4b-instruct-2507-q4km','status':'ISOLATED_CANDIDATE_NOT_ANDROID_ACCEPTED','original_repository':'Qwen/Qwen3-4B-Instruct-2507','original_revision':original,'GGUF_repository':'unsloth/Qwen3-4B-Instruct-2507-GGUF','GGUF_revision':revision,'file':model.name,'size':size,'sha256':sha,'license':'Apache-2.0','url':url,'baseline_replaced':False},indent=2)+'\n')

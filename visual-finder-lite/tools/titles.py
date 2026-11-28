import json, urllib.request, urllib.parse, re, html, sys, os, time
D=sys.argv[1]; OUT=sys.argv[2]
UA="Mozilla/5.0 (Linux; Android 16; SM-S908E Build/BP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36"
UP="https://yandex.com/images-apphost/image-download?cbird=111&images_avatars_size=preview&images_avatars_namespace=images-cbir"
def req(url,data=None,ct=None):
    h={"User-Agent":UA}; 
    if ct: h["Content-Type"]=ct
    return urllib.request.urlopen(urllib.request.Request(url,data=data,headers=h),timeout=40).read()
meta=json.load(open(os.path.join(D,"meta.json"))); out=[]
for m in meta:
    j=json.loads(req(UP,open(os.path.join(D,m["file"]),"rb").read(),"image/jpeg"))
    u="https://yandex.com/images/touch/search?rpt=imageview&cbir_page=similar&url="+urllib.parse.quote(j["sizes"]["orig"]["path"],safe="")+"&cbir_id="+urllib.parse.quote(j["cbir_id"],safe="")
    raw=req(u).decode("utf-8","ignore")
    s=html.unescape(raw).replace('\\u0022','"')
    alts=re.findall(r'"alt":"((?:[^"\\]|\\.){3,200})"',s)
    out.append({"category":m["category"],"brand":m["brand"],"product":m["product"],"titles":alts})
    print(m["category"],len(alts),alts[:3]); time.sleep(1.5)
json.dump(out,open(OUT,"w"),ensure_ascii=False,indent=0)

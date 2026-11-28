import json, urllib.request, urllib.parse, re, html, sys, os, time
D=sys.argv[1]
UA="Mozilla/5.0 (Linux; Android 16; SM-S908E Build/BP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36"
UP="https://yandex.com/images-apphost/image-download?cbird=111&images_avatars_size=preview&images_avatars_namespace=images-cbir"
def req(url,data=None,ct=None):
    h={"User-Agent":UA}
    if ct: h["Content-Type"]=ct
    return urllib.request.urlopen(urllib.request.Request(url,data=data,headers=h),timeout=40).read()
def norm(raw): return html.unescape(raw.decode("utf-8","ignore")).replace('\\u0022','"').replace('\\/','/')
meta=json.load(open(os.path.join(D,"meta.json"))); out=[]
for m in meta:
    j=json.loads(req(UP,open(os.path.join(D,m["file"]),"rb").read(),"image/jpeg"))
    base="https://yandex.com/images/touch/search?rpt=imageview&url="+urllib.parse.quote(j["sizes"]["orig"]["path"],safe="")+"&cbir_id="+urllib.parse.quote(j["cbir_id"],safe="")
    row={"cat":m["category"]}
    for tab in ["similar","sites"]:
        s=norm(req(base+"&cbir_page="+tab))
        if tab=="sites" and m["category"]=="cream": open(os.path.join(D,"..","sites_cream.html"),"w").write(s)
        ig=set(re.findall(r'https?://(?:www\.)?instagram\.com/(?:p|reel|reels|tv)/[A-Za-z0-9_\-]+',s))
        igany=len(re.findall(r'instagram\.com',s)); cdn=len(re.findall(r'cdninstagram|fbcdn',s))
        row[tab]={"ig_posts":len(ig),"ig_mentions":igany,"cdn":cdn,"bytes":len(s),"examples":sorted(ig)[:3]}
        time.sleep(1.2)
    out.append(row); print(json.dumps(row)[:400])
json.dump(out,open(os.path.join(D,"..","igprobe.json"),"w"),indent=1)

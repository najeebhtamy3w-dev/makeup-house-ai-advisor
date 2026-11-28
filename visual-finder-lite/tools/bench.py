import json, urllib.request, urllib.parse, re, html, sys, os, time, hashlib, io
D=sys.argv[1]; OUT=sys.argv[2]
UA="Mozilla/5.0 (Linux; Android 16; SM-S908E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36"
UP="https://yandex.com/images-apphost/image-download?cbird=111&images_avatars_size=preview&images_avatars_namespace=images-cbir"
def req(url,data=None,ct=None,timeout=40):
    h={"User-Agent":UA}
    if ct: h["Content-Type"]=ct
    r=urllib.request.urlopen(urllib.request.Request(url,data=data,headers=h),timeout=timeout)
    return r.status, r.headers.get("Content-Type",""), r.read()
def magic(b):
    if b[:3]==b"\xff\xd8\xff": return "jpeg"
    if b[:8]==b"\x89PNG\r\n\x1a\n": return "png"
    if b[:4]==b"RIFF" and b[8:12]==b"WEBP": return "webp"
    if b[:4] in (b"GIF8",): return "gif"
    if b[4:12] in (b"ftypavif",b"ftypheic"): return b[8:12].decode()
    return "other:"+b[:12].hex()
meta=json.load(open(os.path.join(D,"meta.json")))
res=[]; ids=set()
for m in meta:
    r={"category":m["category"],"brand":m["brand"],"product":m["product"],"upload_bytes":m["bytes"]}
    img=open(os.path.join(D,m["file"]),"rb").read()
    t=time.time()
    try:
        st,ct,b=req(UP,img,"image/jpeg"); j=json.loads(b)
        r["upload_ms"]=int((time.time()-t)*1000); cid=j["cbir_id"]; orig=j["sizes"]["orig"]["path"]
        r["cbir_id"]=cid; r["cbir_unique"]=cid not in ids; ids.add(cid)
    except Exception as e:
        r["upload_error"]=repr(e); res.append(r); continue
    u="https://yandex.com/images/touch/search?rpt=imageview&cbir_page=similar&url="+urllib.parse.quote(orig,safe="")+"&cbir_id="+urllib.parse.quote(cid,safe="")
    t=time.time()
    st,ct,b=req(u); s=html.unescape(b.decode("utf-8","ignore"))
    r["results_ms"]=int((time.time()-t)*1000); r["results_http"]=st
    r["captcha"]=bool(re.search(r"showcaptcha|smartcaptcha|checkcaptcha",s,re.I))
    origs=list(dict.fromkeys(re.findall(r'"origUrl":"([^"]+)"',s)))
    alts=re.findall(r'"alt":"([^"]{3,140})"',s)
    r["similar_count"]=len(origs)
    brand=(m["brand"] or "").split(",")[0].strip().lower()
    key=[w for w in re.split(r"[^\w]+",brand) if len(w)>2]
    top=alts[:10]
    r["top10_brand_hits"]=sum(1 for a in top if any(k in a.lower() for k in key))
    r["top3_titles"]=top[:3]
    # download test: first origUrl that yields a real image
    dl=None
    for o in origs[:8]:
        try:
            st2,ct2,b2=req(o,timeout=20); mg=magic(b2)
            if not mg.startswith("other"):
                dl={"url":o,"http":st2,"content_type":ct2,"magic":mg,"bytes":len(b2),"sha256":hashlib.sha256(b2).hexdigest()[:16]}; break
        except Exception as e:
            continue
    r["download"]=dl or "no reachable origin (sandbox allowlist blocks most third-party hosts)"
    res.append(r); print(json.dumps(r,ensure_ascii=False)[:400]); time.sleep(2)
json.dump(res,open(OUT,"w"),ensure_ascii=False,indent=1)

import json, urllib.request, sys, os
out=sys.argv[1]
cats=[("cream","face-creams"),("shampoo","shampoos"),("serum","serums"),("sunscreen","sunscreens"),("mascara","mascaras"),("hair-conditioner","hair-conditioners"),("body-lotion","body-lotions"),("perfume","perfumes"),("shower-gel","shower-gels"),("lipstick","lipsticks"),("deodorant","deodorants"),("toothpaste","toothpastes")]
meta=[]
for name,tag in cats:
    url=f"https://world.openbeautyfacts.org/api/v2/search?categories_tags_en={tag}&fields=code,product_name,brands,image_front_url&page_size=20&sort_by=unique_scans_n"
    try:
        d=json.load(urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"VisualFinderLite-test/1.0"}),timeout=30))
    except Exception as e:
        print(name,"ERR",e); continue
    for p in d.get("products",[]):
        u=p.get("image_front_url")
        if not u or not p.get("brands"): continue
        full=u.replace(".400.jpg",".full.jpg")
        try:
            data=urllib.request.urlopen(urllib.request.Request(full,headers={"User-Agent":"VisualFinderLite-test/1.0"}),timeout=30).read()
        except Exception:
            continue
        fn=f"{name}.jpg"; open(os.path.join(out,fn),"wb").write(data)
        meta.append({"file":fn,"category":name,"code":p["code"],"brand":p.get("brands"),"product":p.get("product_name"),"source":full,"bytes":len(data)})
        print(name,p.get("brands"),p.get("product_name"),len(data)); break
json.dump(meta,open(os.path.join(out,"meta.json"),"w"),ensure_ascii=False,indent=1)

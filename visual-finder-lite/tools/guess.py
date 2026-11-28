import json,re,unicodedata,sys
STOP=set("""buy price prices sale sales online shop store cheap cheapest best new original review reviews with for the and from free shipping delivery order wholesale retail discount discounted products product
pour les des aux une avec sur par dans mit und fur von der die das con per del della los las para por en et de la le du au el il un una y o of to in on at by is it its
ml mg pcs pack set size spf fps ean cm oz fl ref sku art item cheaper than all www com net org ru amazon ebay ozon wildberries joom aliexpress market marketplace eBay""".split())
def norm(s):
    s=unicodedata.normalize('NFD',s); s=''.join(c for c in s if unicodedata.category(c)!='Mn')
    s=s.lower().replace("’","'").replace("'s "," ").replace("'s"," ").replace("'","")
    return s
def toks(t):
    out=[]
    for w in re.split(r'[^a-z0-9]+',norm(t)):
        if len(w)<3 or w.isdigit() and len(w)!=3: out.append(None); continue
        if w in STOP or re.fullmatch(r'\d+(ml|g|gr|mg|oz)',w): out.append(None); continue
        out.append(w)
    return out
def guess(titles):
    N=len(titles); seqs=[toks(t) for t in titles]
    df={}
    for sq in seqs:
        for w in set(x for x in sq if x): df[w]=df.get(w,0)+1
    if not df: return None
    brand=max(df,key=lambda w:(df[w],len(w)))
    grams={}
    for sq in seqs:
        seen=set()
        for n in (2,3,4):
            for i in range(len(sq)-n+1):
                g=sq[i:i+n]
                if None in g or len(set(g))<n: continue
                seen.add(' '.join(g))
        for g in seen: grams[g]=grams.get(g,0)+1
    minc=max(3,round(N*0.1))
    cands=[(g,c) for g,c in grams.items() if c>=minc and brand in g.split()]
    best=brand
    if cands:
        best=max(cands,key=lambda gc:(gc[1]*len(gc[0].split())**0.9))[0]
    alts=[w for w,_ in sorted(df.items(),key=lambda x:-x[1]) if w not in best.split()][:4]
    return best,df[brand],alts
data=json.load(open(sys.argv[1]))
for d in data:
    r=guess(d["titles"]); print(f'{d["category"]:16} {d["brand"]:26} -> {r}')

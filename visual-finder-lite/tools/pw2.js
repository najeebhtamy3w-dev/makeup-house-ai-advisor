const { chromium, devices } = require('playwright'); const fs=require('fs');
(async () => {
  const url = fs.readFileSync(process.argv[2],'utf8').trim();
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Galaxy S9+'], acceptDownloads:true,
    userAgent:'Mozilla/5.0 (Linux; Android 16; SM-S908E Build/BP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36'});
  const p = await ctx.newPage();
  await p.goto(url,{waitUntil:'networkidle',timeout:60000}).catch(()=>{});
  await p.locator('a[href*="pos="], [class*="SerpItem"] a').first().click(); await p.waitForTimeout(3000);
  // dump buttons in viewer bottom area
  const info = await p.$$eval('button, a', els=>els.filter(e=>{const r=e.getBoundingClientRect(); return r.width>0 && r.top>400 && r.top<520}).map(e=>({tag:e.tagName, aria:e.getAttribute('aria-label'), href:e.getAttribute('href'), dl:e.getAttribute('download'), target:e.getAttribute('target'), cls:(e.className||'').toString().slice(0,90)})));
  console.log(JSON.stringify(info,null,1));
  await p.evaluate(()=>{ window.__opened=[]; const o=window.open; window.open=function(u,...a){window.__opened.push(String(u)); return null;}; document.addEventListener('click',e=>{const a=e.target.closest('a'); if(a) window.__lastA={href:a.href,download:a.download};},true);
    const oc=URL.createObjectURL; URL.createObjectURL=function(x){window.__blob=(x&&x.type)||'blob'; return oc.call(URL,x);}; });
  const dl = p.locator('button[aria-label*="ownload" i], a[aria-label*="ownload" i], [class*="Download" i]').first();
  console.log('dl count', await dl.count());
  const [d] = await Promise.all([p.waitForEvent('download',{timeout:12000}).catch(()=>null), dl.click().catch(e=>console.log('click err',e.message))]);
  await p.waitForTimeout(2500);
  console.log('download event:', d? d.url().slice(0,200)+' | '+d.suggestedFilename():'none');
  console.log('opened:', JSON.stringify(await p.evaluate(()=>window.__opened)), 'lastA:', JSON.stringify(await p.evaluate(()=>window.__lastA)), 'blob:', await p.evaluate(()=>window.__blob));
  console.log('url now', p.url().slice(0,150));
  if (d) { const f='/tmp/claude-0/-home-user-makeup-house-ai-advisor/f00c6d11-01df-57b7-8c61-0e45e7faed89/scratchpad/yx/dl.bin'; await d.saveAs(f).catch(e=>console.log('save',e.message)); }
  await p.screenshot({path:process.argv[3]+'/after_dl.png'});
  await b.close();
})();

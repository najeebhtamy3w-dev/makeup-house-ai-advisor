const { chromium, devices } = require('playwright');
const fs=require('fs');
(async () => {
  const url = fs.readFileSync(process.argv[2],'utf8').trim(); const out=process.argv[3];
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Galaxy S9+'], acceptDownloads:true, locale:'ar',
    userAgent:'Mozilla/5.0 (Linux; Android 16; SM-S908E Build/BP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36'});
  const p = await ctx.newPage();
  const reqs=[];
  p.on('request', r=>{ if(/download|orig|get-/.test(r.url())) reqs.push(r.method()+' '+r.url().slice(0,160)); });
  await p.goto(url,{waitUntil:'networkidle',timeout:60000}).catch(e=>console.log('goto',e.message));
  console.log('final url', p.url().slice(0,200));
  console.log('title', await p.title());
  await p.screenshot({path: out+'/similar.png'});
  const n = await p.locator('img').count(); console.log('img count', n);
  const items = p.locator('a[href*="pos="], .SerpItem a, [class*="SerpItem"] a, [class*="Similar"] a');
  console.log('items', await items.count());
  try { await items.first().click({timeout:10000}); await p.waitForTimeout(4000); await p.screenshot({path: out+'/viewer.png'});
    console.log('viewer url', p.url().slice(0,200));
    const btns = await p.$$eval('a,button', els=>els.map(e=>({t:(e.innerText||e.getAttribute('aria-label')||'').trim().slice(0,40), h:e.getAttribute('href'), d:e.hasAttribute('download'), c:(e.className||'').toString().slice(0,60)})).filter(x=>/download|скачать|تنزيل|Download|open|Открыть/i.test(x.t+x.c+(x.h||''))));
    console.log(JSON.stringify(btns.slice(0,12),null,0));
    const dlBtn = p.locator('[class*="ownload"]').first();
    if (await dlBtn.count()) {
      const [dl] = await Promise.all([ p.waitForEvent('download',{timeout:15000}).catch(()=>null), ctx.waitForEvent('page',{timeout:15000}).catch(()=>null), dlBtn.click().catch(e=>console.log('click',e.message)) ]);
      await p.waitForTimeout(3000);
      console.log('download event', dl ? (dl.url().slice(0,200)+' '+dl.suggestedFilename()) : 'none');
      console.log('pages', ctx.pages().map(x=>x.url().slice(0,160)));
    }
  } catch(e){ console.log('viewer err', e.message); }
  console.log(reqs.slice(-15).join('\n'));
  await b.close();
})();

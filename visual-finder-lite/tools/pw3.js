const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Galaxy S9+'], userAgent:'Mozilla/5.0 (Linux; Android 16; SM-S908E Build/BP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36'});
  const p = await ctx.newPage();
  await p.goto('https://yandex.com/images/touch/',{waitUntil:'networkidle',timeout:60000}).catch(()=>{});
  console.log('inputs', await p.locator('input[type=file]').count());
  let chooser=null;
  p.on('filechooser', fc=>{chooser=fc;});
  const btn = p.locator('[class*="CbirButton"], button[aria-label*="image" i], [aria-label*="Search by image" i]').first();
  console.log('cbir button', await btn.count());
  if (await btn.count()) { await btn.click().catch(e=>console.log('click',e.message)); await p.waitForTimeout(2500); }
  console.log('filechooser fired on tap:', !!chooser);
  if (chooser) await chooser.setFiles(process.argv[2]);
  else await p.locator('input[type=file]').first().setInputFiles(process.argv[2]);
  await p.waitForURL(/cbir_id=/,{timeout:30000}).catch(()=>{});
  await p.waitForTimeout(3000);
  console.log('url', p.url().slice(0,220));
  await p.screenshot({path: process.argv[3]});
  // go to similar tab if not there
  const sim = p.locator('a:has-text("Similar"), [href*="cbir_page=similar"]').first();
  if (await sim.count()) { await sim.click().catch(()=>{}); await p.waitForTimeout(4000); console.log('after similar', p.url().slice(0,160)); await p.screenshot({path: process.argv[3].replace('.png','_similar.png')}); }
  await b.close();
})();

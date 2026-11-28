const { chromium, devices } = require('playwright'); const fs=require('fs'); const path=require('path');
(async () => {
  const dir=process.argv[2]; const out=process.argv[3];
  const meta=JSON.parse(fs.readFileSync(path.join(dir,'meta.json')));
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Galaxy S9+'], locale:'en-US' });
  const res=[];
  for (const m of meta) {
    const p = await ctx.newPage();
    try {
      await p.setContent(`<form id=f method=post enctype="multipart/form-data" action="https://lens.google.com/v3/upload?hl=en&gl=us"><input type=file name=encoded_image id=i></form>`);
      await p.setInputFiles('#i', path.join(dir,m.file));
      await Promise.all([p.waitForNavigation({timeout:45000}).catch(()=>{}), p.evaluate(()=>document.getElementById('f').submit())]);
      await p.waitForTimeout(6000);
      const url=p.url(); const html=await p.content();
      if (m.category==='cream') { fs.writeFileSync(out+'/lens_cream.html',html); await p.screenshot({path:out+'/lens_cream.png'}); }
      const ig=[...new Set((html.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/[A-Za-z0-9_\-]+/g)||[]))];
      const anyIg=(html.match(/instagram\.com/g)||[]).length;
      const consent=/consent\.google|before you continue/i.test(url+html.slice(0,5000));
      const r={cat:m.category, url:url.slice(0,90), bytes:html.length, consent, ig_posts:ig.length, ig_mentions:anyIg, examples:ig.slice(0,3)};
      res.push(r); console.log(JSON.stringify(r));
    } catch(e){ console.log(m.category,'ERR',e.message.slice(0,150)); }
    await p.close(); await new Promise(r=>setTimeout(r,2000));
  }
  fs.writeFileSync(out+'/lensprobe.json',JSON.stringify(res,null,1));
  await b.close();
})();

// 08-layout.js — run through tests/run-all.js (it prepares the database and fixtures)
// layout B checks: phone bottom nav, more sheet, theme toggle, scanner fallback, no horizontal scroll
const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const q=await require('../lib/bridge.js')();
const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.route('http://bridge.local/q',async r=>{const res=await q(JSON.parse(r.request().postData()));r.fulfill({body:JSON.stringify(res),contentType:'application/json'})});
await p.route('**/supabase.js',r=>r.fulfill({body:fs.readFileSync(require('../lib/env.js').client,'utf8'),contentType:'application/javascript'}));
await p.route('**/xlsx.full.min.js',r=>r.fulfill({body:'',contentType:'application/javascript'}));
await p.route('**/qrcode.js',r=>r.fulfill({body:fs.readFileSync(require.resolve('qrcode-generator/qrcode.js'),'utf8'),contentType:'application/javascript'}));
await p.route('**/jsQR.js',r=>r.fulfill({body:'window.jsQR=()=>null',contentType:'application/javascript'}));
await p.route('**fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));
const ok=(c,l)=>console.log((c?'PASS ':'FAIL ')+l);const W=ms=>p.waitForTimeout(ms||500);
await p.goto(require('../lib/env.js').url);await W(400);
await p.screenshot({path:'b-login.png'});
await p.fill('#trEmail','user02@scg.com');await p.click('#fTrial button');await W(900);
ok(await p.isVisible('.bnav')&&!(await p.isVisible('.side')),'phone: bottom nav shown, sidebar hidden');
ok(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),'phone: no horizontal scroll (home)');
await p.screenshot({path:'b-phone-home.png'});
await p.click('#moreBtn');await W(300);ok(await p.locator('.modal-bg.sheet .sheet-grid button').count()>=5,'more sheet lists other menus');
await p.click('.sheet-grid [data-nav="machine"]');await W(300);ok((await p.textContent('.tb-title b')).includes('เครื่องจักร'),'more sheet navigates');
await p.click('.bnav [data-scanqr]');await W(500);ok(await p.isVisible('#scanNo'),'scanner opens with manual machine picker fallback');
await p.selectOption('#scanNo','T-01');await W(400);ok((await p.textContent('.tb-title')).includes('T-01'),'picking machine opens its dashboard');
await p.click('.bnav [data-nav="list"]');await W(300);ok(await p.isVisible('.jobs.mob-only')||await p.locator('.empty').count()>0,'list shows cards on phone');
await p.click('#themeBtn');await W(200);await p.click('#themeBtn');await W(300);
ok(await p.evaluate(()=>document.documentElement.dataset.theme==='dark'&&getComputedStyle(document.body).backgroundColor!=='rgb(242, 244, 243)'),'theme toggle → dark');
await p.click('.bnav [data-nav="home"]');await W(300);await p.screenshot({path:'b-phone-dark.png'});
await p.click('#themeBtn');await W(200);
// detail on phone
await p.click('.bnav [data-nav="new"]');await W(200);await p.selectOption('#nMachine','M-01');await p.fill('#nSym','ทดสอบหน้าตา');await p.click('#bSubmit');await W(700);
ok(await p.isVisible('.steps li.now'),'detail: circle step bar');await p.screenshot({path:'b-phone-detail.png',fullPage:true});
ok(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),'phone: no horizontal scroll (detail)');
await p.setViewportSize({width:1280,height:860});await W(300);ok(await p.isVisible('.side')&&!(await p.isVisible('.bnav')),'desktop: sidebar shown, bottom nav hidden');
await p.click('.side-nav [data-nav="home"]');await W(300);await p.screenshot({path:'b-desk-home.png'});
await p.click('.jobc');await W(600);await p.screenshot({path:'b-desk-detail.png'});
console.log('errors',errs);await b.close();process.exit(0);})();

// 09-cancel-backup-refresh.js — cancel a job, admin backup to Excel, auto-refresh — run through tests/run-all.js
const {chromium}=require('playwright');const fs=require('fs');const {Client}=require('pg');const X=require('xlsx');
(async()=>{const q=await require('../lib/bridge.js')();const db=new Client(require('../lib/env.js').pg);await db.connect();
const row=async(s,a)=>(await db.query(s,a)).rows;
const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1280,height:900},acceptDownloads:true});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.clock.install();
await p.route('http://bridge.local/q',async r=>{const res=await q(JSON.parse(r.request().postData()));r.fulfill({body:JSON.stringify(res),contentType:'application/json'})});
await p.route('**/supabase.js',r=>r.fulfill({body:fs.readFileSync(require('../lib/env.js').client,'utf8'),contentType:'application/javascript'}));
await p.route('**/xlsx.full.min.js',r=>r.fulfill({body:fs.readFileSync(require.resolve('xlsx/dist/xlsx.full.min.js'),'utf8'),contentType:'application/javascript'}));
await p.route('**/qrcode.js',r=>r.fulfill({body:fs.readFileSync(require.resolve('qrcode-generator/qrcode.js'),'utf8'),contentType:'application/javascript'}));
await p.route('**fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));
const W=ms=>p.waitForTimeout(ms||500);const ok=(c,l)=>console.log((c?'PASS ':'FAIL ')+l);
await p.goto(require('../lib/env.js').url);await W(400);
const as=async e=>{if(await p.locator('#logout').count()){await p.click('#logout');await W(800)}await p.fill('#trEmail',e);await p.click('#fTrial button');await W(1000)};
const open=async id=>{await p.click('.side-nav [data-nav="list"]');await W(200);await p.click('[data-filter="all"]');await W(200);await p.click(`tr[data-open="${id}"]`);await W(600)};
const J=async id=>(await row('select * from requests where id=$1',[id]))[0];
const create=async(m,sym)=>{await p.click('.side-nav [data-nav="new"]');await W(200);await p.selectOption('#nMachine',m);await p.fill('#nSym',sym);await p.click('#bSubmit');await W(800);return (await p.textContent('.h-row h1')).trim()};
const H=e=>({'x-capd-user':e});

// cancel by reporter before approval
await as('user05@scg.com');const A=await create('M-01','เปิดซ้ำ');
ok(await p.locator('#qCancel').count()===1,'reporter sees ยกเลิกใบงาน while pending');
await p.click('#qCancel');await W(200);await p.click('#cxGo');await W(200);ok((await p.textContent('.toast')).includes('เหตุผล'),'cancel needs a reason');
await p.fill('#cxNote','เปิดซ้ำกับใบเดิม');await p.click('#cxGo');await W(800);
let a=await J(A);ok(a.status==='cancelled'&&a.closed_by==='user05@scg.com'&&a.return_note==='เปิดซ้ำกับใบเดิม','job cancelled with reason, history kept');
ok((await p.textContent('#main')).includes('เหตุผลที่ยกเลิก'),'detail shows cancel reason');
ok((await row('select count(*)::int n from request_logs where request_id=$1 and action like $2',[A,'ยกเลิกใบงาน%']))[0].n===1,'cancel logged');
// other user / after approval / no reason → blocked by the database
const B=await create('M-01','ต้องซ่อม');
const other=await q({op:'update',t:'requests',payload:{status:'cancelled',return_note:'x'},f:[['id',B]],order:[],email:'',headers:H('user14@scg.com')});ok(other.error,'DB blocks cancel by another member');
const noNote=await q({op:'update',t:'requests',payload:{status:'cancelled'},f:[['id',B]],order:[],email:'',headers:H('user05@scg.com')});ok(noNote.error,'DB blocks cancel without reason');
await as('user02@scg.com');await open(B);await p.click('input[name=apType][value=RMT]');await p.click('[data-act=fd_approve]');await W(800);
const late=await q({op:'update',t:'requests',payload:{status:'cancelled',return_note:'x'},f:[['id',B]],order:[],email:'',headers:H('user05@scg.com')});ok(late.error,'DB blocks reporter cancel after approval');
await as('user01@scg.com');await open(B);ok(await p.locator('#qCancel').count()===1,'admin sees ยกเลิกใบงาน after approval');
await p.click('#qCancel');await W(200);await p.fill('#cxNote','เครื่องเลิกใช้');await p.click('#cxGo');await W(800);ok((await J(B)).status==='cancelled','admin cancels an approved job');
// backup
await p.click('.side-nav [data-nav="admin"]');await W(400);
const [dl]=await Promise.all([p.waitForEvent('download'),p.click('#backupBtn')]);await dl.saveAs('backup.xlsx');
const wb=X.readFile('backup.xlsx');ok(['requests','request_logs','machines','app_users','documents'].every(n=>wb.SheetNames.includes(n)),'backup has 5 sheets');
ok(X.utils.sheet_to_json(wb.Sheets.requests).length===(await row('select count(*)::int n from requests'))[0].n,'backup has every job');
// auto-refresh: a job opened elsewhere appears after a minute without pressing refresh
await p.click('.side-nav [data-nav="list"]');await W(300);await p.click('[data-filter="all"]');await W(300);
const before=await p.locator('tr[data-open]').count();
await q({op:'insert',t:'requests',payload:{machine_no:'T-01',symptom:'เปิดจากอีกเครื่อง',urgency:'High',status:'pending_fd'},f:[],order:[],email:'',headers:H('user06@scg.com')});
await p.clock.fastForward(5000);await W(800);ok(await p.locator('tr[data-open]').count()===before,'no refresh before a minute');
await p.clock.fastForward(62000);await W(2000);ok(await p.locator('tr[data-open]').count()===before+1,'list refreshes by itself within a minute');
// mobile: page title shown once
await p.setViewportSize({width:390,height:844});await W(300);ok(!(await p.isVisible('.main .h-row h1'))&&await p.isVisible('.tb-title b'),'phone: title only in the top bar');
await p.setViewportSize({width:1280,height:900});await W(300);ok(await p.isVisible('.main .h-row h1')&&!(await p.isVisible('.tb-title b')),'desktop: title only in the page heading');
console.log('errors',errs);await b.close();await db.end();process.exit(0);})();

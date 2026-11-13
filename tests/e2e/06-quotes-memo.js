// 06-quotes-memo.js — run through tests/run-all.js (it prepares the database and fixtures)
const {chromium}=require('playwright');const fs=require('fs');const {Client}=require('pg');
(async()=>{const q=await require('../lib/bridge.js')();const db=new Client(require('../lib/env.js').pg);await db.connect();
const row=async(s,a)=>(await db.query(s,a)).rows;
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1280,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.route('http://bridge.local/q',async r=>{const res=await q(JSON.parse(r.request().postData()));if(res.error)console.log('   [db refused]',res.error.message);r.fulfill({body:JSON.stringify(res),contentType:'application/json'})});
await p.route('**/supabase.js',r=>r.fulfill({body:fs.readFileSync(require('../lib/env.js').client,'utf8'),contentType:'application/javascript'}));
await p.route('**/xlsx.full.min.js',r=>r.fulfill({body:'',contentType:'application/javascript'}));
await p.route('**/qrcode.js',r=>r.fulfill({body:fs.readFileSync(require.resolve('qrcode-generator/qrcode.js'),'utf8'),contentType:'application/javascript'}));
await p.route('**fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));
await p.addInitScript(()=>{window.print=()=>{window.__printed=(window.__printed||0)+1}});await p.goto(require('../lib/env.js').url);await p.waitForTimeout(400);const W=ms=>p.waitForTimeout(ms||500);
await p.evaluate(()=>{window.print=()=>{window.__printed=(window.__printed||0)+1}});
const ok=(c,l)=>console.log((c?'PASS ':'FAIL ')+l);
const as=async e=>{if(await p.locator('#logout').count()){await p.click('#logout');await W(700);await p.evaluate(()=>{window.print=()=>{window.__printed=(window.__printed||0)+1}})}await p.fill('#trEmail',e);await p.click('#fTrial button');await W(900)};
const open=async id=>{await p.click('.side-nav [data-nav="list"]');await W(150);await p.click('[data-filter="all"]');await W(150);await p.click(`tr[data-open="${id}"]`);await W(500)};
const toast=async()=>(await p.textContent('.toast').catch(()=>'')).trim();
const J=async id=>(await row('select * from requests where id=$1',[id]))[0];
const fill=async(i,v,n,a,l,x)=>{await p.fill('#qV'+i,v);await p.fill('#qN'+i,n);await p.fill('#qA'+i,a);await p.fill('#qL'+i,l);if(x)await p.fill('#qX'+i,x)};

await as('user05@scg.com');await p.click('.side-nav [data-nav="new"]');await W(150);await p.selectOption('#nMachine','M-01');await p.fill('#nSym','Gearbox เสียงดัง');await p.click('#bSubmit');await W(600);
const A=(await p.textContent('.h-row h1')).trim();
await as('user02@scg.com');await open(A);await p.click('input[name=apType][value=special]');await p.selectOption('#apAssignee','user14@scg.com');await p.click('[data-act=fd_approve]');await W(600);
await as('user14@scg.com');await open(A);
ok(await p.locator('#qV0').count()===1&&await p.locator('#qV2').count()===1,'3 quote rows shown');
await fill(0,'ABC Gear','QT-001','52000','14','2027-01-31');await fill(1,'Thai Drive','TD-88','45000','21','2027-01-15');await fill(2,'Siam Power','SP-7','49500','10');
await p.check('input[name=qC][value="1"]');await p.setInputFiles('#qF1','quote.pdf');await W(100);
ok((await p.textContent('#authHint')).includes('ผจส.'),'authority hint for 45,000 = ผจส.: '+(await p.textContent('#authHint')));
await p.click('#memoPrev');await W(300);const prevTxt=await p.textContent('.memo-doc');ok(prevTxt.includes('Thai Drive')&&prevTxt.includes('45,000.00')&&prevTxt.includes('ราคาเปรียบเทียบ'),'MEMO preview filled from quotes');
await p.screenshot({path:'memo-preview.png',fullPage:false});await p.click('#memoPrint');ok(await p.evaluate(()=>window.__printed)===1,'print button works');await p.click('.modal [data-close]');await W(200);
await p.click('[data-act=memo_draft]');await W(700);let a=await J(A);ok(a.status==='quotation'&&a.quotes.length===3&&a.quotes[1].file&&a.quotes[1].chosen,'draft saved (3 quotes, file on chosen)');
await open(A);ok((await p.inputValue('#qV2'))==='Siam Power'&&(await p.textContent('#main')).includes('แนบแล้ว'),'draft reloads into form');
await p.check('input[name=mdM][value=compare]');await p.click('[data-act=memo_submit]');await W(300);ok((await toast()).includes('เลขที่ MEMO'),'validation: memo no required');
await p.fill('#mfMemoNo','MEMO-26-031');await p.selectOption('#mfApp0','user09@scg.com');await p.selectOption('#mfApp1','user10@scg.com');await p.click('[data-act=memo_submit]');await W(700);
a=await J(A);ok(a.status==='memo_approval'&&a.vendor==='Thai Drive'&&+a.quotation_amount===45000,'submitted; DB took vendor/amount from chosen quote');ok(a.memo_doc.from==='user14@scg.com'&&a.memo_doc.method==='compare','memo_doc stamped with requester');
const lock=await q({op:'update',t:'requests',payload:{quotes:[]},f:[['id',A]],order:[],email:'',headers:{'x-capd-user':'user14@scg.com'}});ok(lock.error&&/ล็อก/.test(lock.error.message),'quotes locked after submit');
await as('user09@scg.com');await open(A);ok(await p.locator('.box.action table').count()===1,'approver sees quote comparison');ok((await p.textContent('.box.action')).includes('ผจส.'),'approver sees authority level');
await p.click('.box.action [data-memo]');await W(300);ok((await p.textContent('.memo-doc')).includes('รออนุมัติ'),'memo shows pending approvals');await p.click('.modal [data-close]');await W(200);
await p.click('[data-act=memo_approve]');await W(600);
await as('user10@scg.com');await open(A);await p.click('[data-act=memo_approve]');await W(600);ok((await J(A)).status==='po_vendor','both approved → po_vendor');
await p.click('[data-memo]');await W(300);const t=await p.textContent('.memo-doc');ok((t.match(/อนุมัติในระบบ/g)||[]).length===2,'memo shows 2 in-system approvals');await p.screenshot({path:'memo-final.png'});await p.click('.modal [data-close]');await W(200);
// forged submit with wrong vendor on a 2nd job
await as('user05@scg.com');await p.click('.side-nav [data-nav="new"]');await W(150);await p.selectOption('#nMachine','M-01');await p.fill('#nSym','Heater เสีย');await p.click('#bSubmit');await W(600);const B=(await p.textContent('.h-row h1')).trim();
await db.query("begin");await db.query("select set_config('capd.system','1',true)");await db.query("update requests set status='quotation', job_type='special', assignee='user14@scg.com' where id=$1",[B]);await db.query("commit");
const forged=await q({op:'update',t:'requests',payload:{status:'memo_approval',vendor:'Fake',quotation_amount:1,quotes:[{vendor:'Real Co',amount:9000,chosen:true}],memo_approvers:['user09@scg.com'],memo_step:0},f:[['id',B]],order:[],email:'',headers:{'x-capd-user':'user14@scg.com'}});
const bb=await J(B);ok(!forged.error&&bb.vendor==='Real Co'&&+bb.quotation_amount===9000,'DB overrides forged vendor/amount with chosen quote');
// reject → edit quotes → resubmit
await as('user09@scg.com');await open(B);await p.fill('#maNote','ขอใบเสนอราคาเพิ่ม');await p.click('[data-act=memo_reject]');await W(600);
await as('user14@scg.com');await open(B);await fill(1,'Other Co','OC-1','8500','7');await p.check('input[name=qC][value="1"]');await p.setInputFiles('#qF1','quote.pdf');await p.check('input[name=mdM][value=compare]');
await p.check('input[name=mdR][value="2"]');await p.fill('#mfMemoNo','MEMO-26-032');await p.selectOption('#mfApp0','user09@scg.com');await p.click('[data-act=memo_submit]');await W(700);
console.log('   toast:',await toast());const b2=await J(B);console.log('   ',b2.status,b2.vendor,b2.memo_round);ok(b2.status==='memo_approval'&&b2.vendor==='Other Co'&&b2.memo_round===bb.memo_round+1,'rejected memo edited and resubmitted (next round)');
// machine dashboard vendor box
await p.click('.side-nav [data-nav="machine"]');await W(200);await p.click('[data-scan="M-01"]');await W(400);const vb=await p.textContent('#main');ok(vb.includes('Vendor และราคา')&&vb.includes('Thai Drive')&&vb.includes('Siam Power'),'machine dashboard lists vendors');
await p.screenshot({path:'dash-vendor.png',fullPage:true});
await open(A);await p.setViewportSize({width:390,height:844});await p.waitForTimeout(300);ok(!(await p.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)),'no page-level horizontal scroll on phone');
console.log('errors',errs);await b.close();await db.end();process.exit(0);})();

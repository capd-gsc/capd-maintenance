// 01-main-flow.js — run through tests/run-all.js (it prepares the database and fixtures)
const {chromium}=require('playwright');const fs=require('fs');const {Client}=require('pg');
(async()=>{
const q=await require('../lib/bridge.js')();const db=new Client(require('../lib/env.js').pg);await db.connect();
const row=async(sql,a)=>(await db.query(sql,a)).rows;
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1280,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});
await p.route('http://bridge.local/q',async r=>{const res=await q(JSON.parse(r.request().postData()));if(res.error)console.log('   [db refused]',res.error.message);r.fulfill({body:JSON.stringify(res),contentType:'application/json',headers:{'access-control-allow-origin':'*'}})});
await p.route('**/supabase.js',r=>r.fulfill({body:fs.readFileSync(require('../lib/env.js').client,'utf8'),contentType:'application/javascript'}));
await p.route('**/xlsx.full.min.js',r=>r.fulfill({body:fs.readFileSync(require.resolve('xlsx/dist/xlsx.full.min.js'),'utf8'),contentType:'application/javascript'}));
await p.route('**/qrcode.js',r=>r.fulfill({body:fs.readFileSync(require.resolve('qrcode-generator/qrcode.js'),'utf8'),contentType:'application/javascript'}));
await p.route('**fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));
await p.goto(require('../lib/env.js').url);await p.waitForTimeout(400);
const W=ms=>p.waitForTimeout(ms||300);
const ok=(c,l)=>console.log((c?'PASS ':'FAIL ')+l);
const as=async e=>{if(await p.locator('#logout').count()){await p.click('#logout');await W(200)}await p.evaluate(e=>window.__login(e),e);await W(500)};
const st=async()=>(await p.textContent('.h-row .pill')).trim();
const open=async id=>{await p.click('.side-nav [data-nav="list"]');await W(150);await p.click('[data-filter="all"]');await W(150);await p.click(`tr[data-open="${id}"]`);await W(400)};
const create=async(mno,sym)=>{await p.click('.side-nav [data-nav="new"]');await W(150);await p.selectOption('#nMachine',mno);await p.fill('#nSym',sym);await p.click('#bSubmit');await W(500);return (await p.textContent('.h-row h1')).trim()};
const J=async id=>(await row('select * from requests where id=$1',[id]))[0];

// login page
ok(await p.locator('#bMs').count()===1,'login page shows Microsoft button');
await p.screenshot({path:'login.png'});
await p.click('#bMs');await W(100);ok((await p.evaluate(()=>window.__oauth?.provider))==='azure','Microsoft button calls signInWithOAuth(azure)');
await p.evaluate(()=>window.__login('someone@gmail.com'));await W(400);ok((await p.textContent('.err')).includes('@scg.com'),'non-company account rejected: '+(await p.textContent('.err')));
await p.evaluate(()=>window.__login('outsider@scg.com'));await W(500);ok((await p.textContent('.err')).includes('ยังไม่มีสิทธิ์'),'scg account not in list rejected');

// FS opens jobs
await as('user05@scg.com');ok((await p.textContent('.who')).includes('Foreman Shift'),'FS logged in');
const A=await create('M-01','มอเตอร์ไม่หมุน');const B=await create('T-01','ค่าแรงดึงเพี้ยน');console.log('   created',A,B);
// FD routing
await as('user02@scg.com');await p.click('.side-nav [data-nav="home"]');await W(200);
ok(await p.locator(`[data-open="${A}"]`).count()===1,'FD เครื่องจักร sees M-01 job in My Tasks');
ok(await p.locator(`[data-open="${B}"]`).count()===0,'FD เครื่องจักร does not get T-01 (เครื่องทดสอบ) job');
await open(B);ok(await p.locator('[data-act=fd_approve]').count()===0,'FD เครื่องจักร has no approve button on T-01');
await open(A);await p.click('input[name=apType][value=RMT]');await p.click('[data-act=fd_approve]');await W(500);ok(await st()==='รอ Admin แจ้งซ่อม','A approved → wait_admin');
let a=await J(A);ok(a.approved_by==='user02@scg.com','approved_by set by DB');
await as('user01@scg.com');ok((await p.textContent('.who')).includes('Member + Admin'),'member+admin flag shown');
await p.click('.side-nav [data-nav="home"]');await W(200);ok(await p.locator(`[data-open="${A}"]`).count()===1,'Admin flag user gets wait_admin task');
await open(A);await p.fill('#exRef','SAP-100234');await p.click('[data-act=admin_report]');await W(500);ok(await st()==='RMT/FM กำลังซ่อม','A → ext_repair');
await as('user02@scg.com');await open(A);await p.fill('#exFix','เปลี่ยน contactor');await p.fill('#exCost','3500');await p.click('[data-act=close_ext]');await W(500);
a=await J(A);ok(a.status==='closed'&&a.closed_by==='user02@scg.com'&&+a.cost_thb===3500,'A closed by FD, cost saved');
// Special on T-01
await as('user03@scg.com');await p.click('.side-nav [data-nav="home"]');await W(200);ok(await p.locator(`[data-open="${B}"]`).count()===1,'FD เครื่องทดสอบ sees T-01 job');
await open(B);await p.click('input[name=apType][value=special]');await p.selectOption('#apAssignee','user21@scg.com');await p.click('[data-act=fd_approve]');await W(500);ok(await st()==='ขอใบเสนอราคา / MEMO','B → quotation');
await as('user21@scg.com');await open(B);await p.fill('#qV0','ABC Testing');await p.fill('#qA0','45000');await p.fill('#mfMemoNo','MEMO-26-011');
await p.setInputFiles('#qF0','quote.pdf');await p.selectOption('#mfApp0','user09@scg.com');await p.selectOption('#mfApp1','user10@scg.com');await p.click('[data-act=memo_submit]');await W(600);ok(await st()==='รอ Manager อนุมัติ MEMO','B → memo_approval');
await as('user10@scg.com');await open(B);ok(await p.locator('[data-act=memo_approve]').count()===0,'App 2 cannot approve before App 1');
await as('user09@scg.com');await open(B);await p.click('[data-act=memo_approve]');await W(500);ok((await J(B)).memo_step===1,'App 1 approved');
await as('user10@scg.com');await open(B);await p.click('[data-act=memo_approve]');await W(500);ok(await st()==='ออก PO / นัด Vendor','App 2 approved → po_vendor');
await as('user21@scg.com');await open(B);ok((await p.textContent('#main')).includes('ปิดงานได้หลังจาก Admin'),'member must wait for PO');
await as('user01@scg.com');await open(B);await p.fill('#poNo','PO-4500123');await p.click('[data-act=po_save]');await W(500);
await as('user21@scg.com');await open(B);await p.fill('#pvFix','Vendor สอบเทียบ load cell');await p.click('[data-act=close_special]');await W(500);ok((await J(B)).status==='closed','B closed after PO');
// PM/CAL auto jobs
const pm=await row("select * from requests where job_type='pmcal' order by machine_no");ok(pm.length===2,'ensure_pmcal_jobs created '+pm.length+' jobs at login');
await as('user14@scg.com');await p.click('.side-nav [data-nav="home"]');await W(200);ok((await p.textContent('#main')).includes('PM / CAL ที่ต้องเริ่มดำเนินการ'),'member sees PM/CAL reminder');
const P1=pm.find(x=>x.machine_no==='M-01').id;await open(P1);await p.click('[data-act=pm_action]');await W(400);
await p.fill('#qV0','ZSK Service');await p.fill('#qA0','20000');await p.fill('#mfMemoNo','MEMO-PM-1');await p.setInputFiles('#qF0','quote.pdf');await p.selectOption('#mfApp0','user09@scg.com');await p.click('[data-act=memo_submit]');await W(500);
await as('user09@scg.com');await open(P1);await p.click('[data-act=memo_approve]');await W(500);
await as('user01@scg.com');await open(P1);await p.fill('#poNo','PO-PM-1');await p.click('[data-act=po_save]');await W(500);
await as('user14@scg.com');await open(P1);await p.fill('#pvFix','PM ตามแผน');await p.click('[data-act=close_special]');await W(500);
const m1=(await row("select pm_last_date::text d from machines where machine_no='M-01'"))[0].d;ok(m1===new Date().toISOString().slice(0,10),'closing PM job updated pm_last_date via trigger: '+m1);
// manager can't create
await as('user09@scg.com');await p.click('.side-nav [data-nav="new"]');await W(200);ok((await p.textContent('#main')).includes('ไม่ได้เปิดใบงาน'),'manager cannot open jobs');
// admin page
await as('user01@scg.com');await p.click('.side-nav [data-nav="admin"]');await W(300);ok(await p.locator('#main tbody tr').count()===21,'admin sees 21 users');
await p.screenshot({path:'admin.png',fullPage:false});
await p.fill('#psEmail','newtech@scg.com');await p.fill('#psName','New Tech');await p.selectOption('#psRole','foreman_day');await p.selectOption('#psFd','เครื่องทดสอบ');await p.click('#fPreset button[type=submit]');await W(500);
ok((await row("select fd_type from app_users where email='newtech@scg.com'"))[0]?.fd_type==='เครื่องทดสอบ','admin added FD user with type');
// cannot remove own admin
const i=(await p.evaluate(()=>[...document.querySelectorAll('#main tbody tr td:first-child')].map(t=>t.textContent))).indexOf('user01@scg.com');
await p.uncheck('#pa'+i);await p.click(`[data-psave="${i}"]`);await W(300);ok((await p.textContent('.toast')).includes('Admin'),'cannot remove own admin flag');
// import template
await p.click('.side-nav [data-nav="machine"]');await W(200);await p.setInputFiles('#mImport','template.xlsx');await W(2500);
console.log('   toast:',await p.textContent('.toast').catch(()=>''));
const ms=await row("select count(*)::int n, count(*) filter (where machine_type='Mold')::int mold, count(*) filter (where eng_foreman is null and machine_no like 'MD-%')::int noeng, string_agg(distinct eng_foreman, ',') engs from machines where machine_no like 'MD-%' or true");console.log('   machines after import',ms[0]);
ok(ms[0].n>3,'template import added machines');ok((await row("select count(*)::int n from machines where machine_no like 'ตัวอย่าง%'"))[0].n===0,'example row skipped');
ok(ms[0].noeng===0,'every machine has Eng,Foreman');
// dashboard
await p.click('.side-nav [data-nav="machine"]');await W(200);await p.click('[data-scan="M-01"]');await W(400);ok((await p.textContent('#main')).includes('Dashboard 12 เดือนล่าสุด'),'machine dashboard renders');
await p.screenshot({path:'dash.png',fullPage:true});
// anon blocked at DB
const an=await q({op:'select',t:'requests',f:[],order:[],email:''});ok(Array.isArray(an.data)&&an.data.length===0,'anon reads nothing');
// mobile
await p.setViewportSize({width:390,height:844});await W(200);await p.screenshot({path:'mobile.png',fullPage:false});
const ov=await p.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);ok(!ov,'no horizontal scroll at 390px');
console.log('page errors:',errs);await b.close();await db.end();process.exit(0);
})();

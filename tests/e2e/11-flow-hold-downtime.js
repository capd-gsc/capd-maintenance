// 11-flow-hold-downtime.js — machine search, machine-stop time → downtime, pause a job (รออะไหล่) — run through tests/run-all.js
const {chromium}=require('playwright');const fs=require('fs');const {Client}=require('pg');
(async()=>{const q=await require('../lib/bridge.js')();const db=new Client(require('../lib/env.js').pg);await db.connect();
const row=async(s,a)=>(await db.query(s,a)).rows;
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1280,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.route('http://bridge.local/q',async r=>{const res=await q(JSON.parse(r.request().postData()));if(res.error)console.log('   [db refused]',res.error.message);r.fulfill({body:JSON.stringify(res),contentType:'application/json'})});
await p.route('**/supabase.js',r=>r.fulfill({body:fs.readFileSync(require('../lib/env.js').client,'utf8'),contentType:'application/javascript'}));
await p.route('**/xlsx.full.min.js',r=>r.fulfill({body:'',contentType:'application/javascript'}));
await p.route('**/qrcode.js',r=>r.fulfill({body:fs.readFileSync(require.resolve('qrcode-generator/qrcode.js'),'utf8'),contentType:'application/javascript'}));
await p.route('**fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));
const W=ms=>p.waitForTimeout(ms||500);const ok=(c,l)=>console.log((c?'PASS ':'FAIL ')+l);
await p.goto(require('../lib/env.js').url);await W(400);
const as=async e=>{if(await p.locator('#logout').count()){await p.click('#logout');await W(800)}await p.fill('#trEmail',e);await p.click('#fTrial button');await W(1000)};
const open=async id=>{await p.click('.side-nav [data-nav="list"]');await W(200);await p.click('[data-filter="all"]');await W(200);await p.click(`tr[data-open="${id}"]`);await W(600)};
const J=async id=>(await row('select * from requests where id=$1',[id]))[0];
const H=e=>({'x-capd-user':e});const U=n=>`user${String(n).padStart(2,'0')}@scg.com`;
const local=d=>{const x=new Date(d),z=n=>String(n).padStart(2,'0');return `${x.getFullYear()}-${z(x.getMonth()+1)}-${z(x.getDate())}T${z(x.getHours())}:${z(x.getMinutes())}`};

// open a job: search the machine, mark it stopped 2 hours ago
await as(U(5));await p.click('.side-nav [data-nav="new"]');await W(300);
await p.fill('#nMachineQ','UTM');await W(200);ok(await p.inputValue('#nMachine')==='T-01','typing in machine search picks the only match');
ok(await p.locator('#nMachine option:not([hidden])').count()===2,'search hides machines that do not match');
await p.check('#nDown');await W(100);ok(await p.isVisible('#nDownAt'),'machine-stop time appears when ticked');
const twoH=Date.now()-2*3600e3;await p.fill('#nDownAt',local(twoH));
await p.fill('#nSym','ค่าแรงดึงเพี้ยน เครื่องหยุด');await p.click('#bSubmit');await W(800);
const A=(await p.textContent('.h-row h1')).trim();let a=await J(A);
ok(a.machine_down===true&&a.down_since&&Math.abs(new Date(a.down_since)-twoH)<120e3,'machine_down + down_since saved');
ok((await p.textContent('#main')).includes('หยุดใช้งาน'),'detail shows the machine is stopped');
// FD approves Normal → wait_admin; admin pauses (รออะไหล่)
await as(U(3));await open(A);await p.click('input[name=apType][value=RMT]');await p.click('[data-act=fd_approve]');await W(800);
await as(U(1));await open(A);ok(await p.locator('details.holdq').count()===1,'admin sees the pause box');
await p.click('details.holdq summary');await p.selectOption('#hdReason','รออะไหล่');await p.fill('#hdNote','สั่ง Load cell แล้ว');await p.click('[data-act=hold_on]');await W(800);
a=await J(A);ok(a.hold_reason==='รออะไหล่'&&a.hold_note==='สั่ง Load cell แล้ว'&&a.hold_since&&a.status==='wait_admin','job paused, status unchanged, pause time set by the database');
ok((await p.textContent('.h-row')).includes('พัก: รออะไหล่'),'paused badge in the job header');
await p.click('.side-nav [data-nav="list"]');await W(300);ok((await p.textContent('[data-filter="hold"]')).includes('1'),'list has a พักงาน filter with 1 job');
ok((await p.textContent('[data-filter="down"]')).includes('1'),'list has a เครื่องหยุด filter with 1 job');
// who may pause
const r1=await q({op:'update',t:'requests',payload:{hold_reason:'อื่นๆ'},f:[['id',A]],order:[],email:'',headers:H(U(5))});ok(!!r1.error,'DB blocks the reporter from pausing');
const r2=await q({op:'update',t:'requests',payload:{hold_reason:'อื่นๆ'},f:[['id',A]],order:[],email:'',headers:H(U(2))});ok(!!r2.error,'DB blocks the FD of another machine type');
const r3=await q({op:'update',t:'requests',payload:{hold_reason:null,hold_note:null},f:[['id',A]],order:[],email:'',headers:H(U(3))});a=await J(A);ok(!r3.error&&a.hold_reason===null&&a.hold_since===null,'FD of the machine type can resume');
const r4=await q({op:'update',t:'requests',payload:{hold_reason:'รออะไหล่',symptom:'แก้แอบ'},f:[['id',A]],order:[],email:'',headers:H(U(3))});ok(!!r4.error,'pausing cannot be used to change other fields');
// moving to the next step clears the pause
await q({op:'update',t:'requests',payload:{hold_reason:'รอ Vendor / ผู้รับเหมา'},f:[['id',A]],order:[],email:'',headers:H(U(1))});
await open(A);await p.fill('#exRef','SAP-9');await p.click('[data-act=admin_report]');await W(800);
a=await J(A);ok(a.status==='ext_repair'&&a.hold_reason===null,'next step clears the pause');
// downtime defaults from the machine-stop time
await as(U(3));await open(A);ok((await p.inputValue('#exStart'))===local(a.down_since),'close form starts from the machine-stop time');
await p.fill('#exFix','เปลี่ยน Load cell');await p.click('[data-act=close_ext]');await W(800);
a=await J(A);ok(a.status==='closed'&&a.downtime_min>=115&&a.downtime_min<=125,'downtime ≈ 120 minutes from machine-stop time ('+a.downtime_min+')');
// stale view carries the pause reason
const B=(await q({op:'insert',t:'requests',payload:{machine_no:'M-01',symptom:'ค้าง',status:'pending_fd'},f:[],order:[],email:'',headers:H(U(5)),ret:true,single:true})).data.id;
await q({op:'update',t:'requests',payload:{status:'wait_admin',job_type:'normal',repair_unit:'FM'},f:[['id',B]],order:[],email:'',headers:H(U(2))});
await q({op:'update',t:'requests',payload:{hold_reason:'รออะไหล่'},f:[['id',B]],order:[],email:'',headers:H(U(2))});
await db.query('alter table requests disable trigger guard_request');await db.query("update requests set updated_at=now()-interval '5 days' where id=$1",[B]);await db.query('alter table requests enable trigger guard_request');
ok((await row('select hold_reason from stale_jobs where id=$1',[B]))[0]?.hold_reason==='รออะไหล่','stale_jobs shows the pause reason');
await p.setViewportSize({width:390,height:844});await open(B).catch(()=>{});await p.goto(require('../lib/env.js').url+'?job='+B);await W(1200);
ok(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),'phone: no horizontal scroll on a paused job');await p.screenshot({path:'hold-phone.png',fullPage:true});
console.log('errors',errs);await b.close();await db.end();process.exit(0);})();

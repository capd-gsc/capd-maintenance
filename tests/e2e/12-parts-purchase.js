// 12-parts-purchase.js — spare parts stock, issuing parts, purchase requests received in several deliveries, accessory machines — run through tests/run-all.js
// Runs on a fresh install (trial) and again on a database upgraded from the old SQL files.
const {chromium}=require('playwright');const fs=require('fs');const {Client}=require('pg');const env=require('../lib/env.js');
(async()=>{const q=await require('../lib/bridge.js')();const db=new Client(env.pg);await db.connect();
const row=async(s,a)=>(await db.query(s,a)).rows;const one=async(s,a)=>(await row(s,a))[0];
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1280,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.route('http://bridge.local/q',async r=>{const res=await q(JSON.parse(r.request().postData()));if(res.error)console.log('   [db refused]',res.error.message);r.fulfill({body:JSON.stringify(res),contentType:'application/json'})});
await p.route('**/supabase.js',r=>r.fulfill({body:fs.readFileSync(env.client,'utf8'),contentType:'application/javascript'}));
await p.route('**/xlsx.full.min.js',r=>r.fulfill({body:'',contentType:'application/javascript'}));
await p.route('**/qrcode.js',r=>r.fulfill({body:fs.readFileSync(require.resolve('qrcode-generator/qrcode.js'),'utf8'),contentType:'application/javascript'}));
await p.route('**fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));
const W=ms=>p.waitForTimeout(ms||500);const ok=(c,l)=>console.log((c?'PASS ':'FAIL ')+l);
const U=n=>`user${String(n).padStart(2,'0')}@scg.com`;const H=e=>({'x-capd-user':e});
const Q=(op,t,payload,f,e,extra)=>q({op,t,payload,f:f||[],order:[],email:'',headers:H(e),...(extra||{})});
const stock=async pn=>Number((await one('select stock from spare_parts where part_no=$1',[pn])).stock);
await p.goto(env.url);await W(400);
const as=async e=>{if(await p.locator('#logout').count()){await p.click('#logout');await W(800)}await p.fill('#trEmail',e);await p.click('#fTrial button');await W(1000)};
const nav=async v=>{await p.click(`.side-nav [data-nav="${v}"]`);await W(400)};
const machine=(await one("select machine_no from machines where machine_type='เครื่องทดสอบ' limit 1")).machine_no;
const fdTest=U(3),admin=U(1),member=U(21);

// --- register a part with opening stock (FD) ---
await as(fdTest);await nav('parts');ok(await p.locator('#ptAdd').count()===1,'FD sees + เพิ่มอะไหล่');
await p.click('#ptAdd');await W(200);
for(const [k,v] of [['part_no','TS-GRIP'],['name','Grip face'],['unit','คู่'],['stock','5'],['min_qty','2'],['max_qty','6'],['unit_price','2400'],['machines',machine]])await p.fill('#pf-'+k,v);
await p.click('#fPart button[type=submit]');await W(800);
ok(await stock('TS-GRIP')===5,'opening stock 5 recorded');
ok((await one("select count(*)::int n from part_tx where part_no='TS-GRIP' and kind='opening'")).n===1,'opening movement logged');
// --- DB rules on stock ---
let r=await Q('update','spare_parts',{stock:99},[['part_no','TS-GRIP']],fdTest);ok(!!r.error||await stock('TS-GRIP')===5,'stock cannot be edited directly');
r=await Q('insert','part_tx',{part_no:'TS-GRIP',qty:10,kind:'adjust',note:'x'},[],member);ok(!!r.error,'member cannot adjust stock');
r=await Q('insert','part_tx',{part_no:'TS-GRIP',qty:-1,kind:'issue'},[],member);ok(!!r.error,'issue without a job needs a reason');
r=await Q('insert','part_tx',{part_no:'TS-GRIP',qty:-50,kind:'issue',note:'x'},[],member);ok(!!r.error&&await stock('TS-GRIP')===5,'cannot issue more than in stock');
r=await Q('insert','part_tx',{part_no:'TS-GRIP',qty:3,kind:'receive',note:'x'},[],fdTest);ok(!!r.error,'receive needs a purchase request at PO stage');
r=await Q('insert','spare_parts',{part_no:'X-1',name:'x'},[],member);ok(!!r.error,'member cannot add parts');

// --- member issues for the test machine without a job (UI) ---
await as(member);await nav('parts');await p.click('[data-pissue="TS-GRIP"]');await W(300);
ok(await p.inputValue('#isMachine')===machine,'issue form preselects the part\'s machine');
await p.fill('#isPq0','2');await p.fill('#isNote','เปลี่ยนฟันจับที่สึก');await p.click('#isGo');await W(800);
ok(await stock('TS-GRIP')===3,'issued 2 → stock 3');
let t=await one("select * from part_tx where part_no='TS-GRIP' and kind='issue'");
ok(t&&t.machine_no===machine&&!t.request_id&&t.actor===member&&t.note==='เปลี่ยนฟันจับที่สึก','issue logged with machine, reason and who');
await p.goto(env.url+'?m='+encodeURIComponent(machine));await W(800);
ok((await p.textContent('#main')).includes('Grip face'),'machine dashboard lists its parts');
await p.click(`[data-muse="${machine}"]`);await W(600);ok((await p.textContent('#modal')).includes('× 2'),'machine usage history shows the issue');
await p.click('#modal [data-close]');

// --- purchase request with no machine: member → FD approve → (quote/MEMO) → PO → receive in 2 deliveries ---
await nav('parts');await p.click('#prNew');await W(300);
await p.fill('#prPn0','TS-GRIP');await p.dispatchEvent('#prPn0','change');await p.fill('#prQ0','4');
await p.fill('#prNm1','Load cell 5 kN');await p.fill('#prQ1','1');await p.fill('#prWhy','เติม Stock');await p.click('#prGo');await W(900);
const PR=(await one("select id from requests where job_type='purchase' order by created_at desc limit 1")).id;let j=await one('select * from requests where id=$1',[PR]);
ok(j&&j.status==='pending_fd'&&j.machine_no===null&&j.items.length===2,'purchase request opened without a machine');
r=await Q('insert','requests',{job_type:'purchase',symptom:'x',items:[]},[],member);ok(!!r.error,'purchase request needs at least one item');
await as(fdTest);await p.goto(env.url+'?job='+PR);await W(900);await p.selectOption('#apAssignee',member);await p.click('[data-act=fd_approve]');await W(800);
j=await one('select * from requests where id=$1',[PR]);ok(j.status==='quotation'&&j.assignee===member&&j.job_type==='purchase','FD approves a request with no machine');
// quote / MEMO steps are covered by 06-quotes-memo; move to PO here
await db.query('alter table requests disable trigger guard_request');await db.query("update requests set status='po_vendor', po_no='PO-77', quotation_amount=10000, vendor='V' where id=$1",[PR]);await db.query('alter table requests enable trigger guard_request');
r=await Q('insert','part_tx',{part_no:'TS-GRIP',qty:1,kind:'receive',request_id:PR},[],U(14));ok(!!r.error,'someone not responsible cannot receive');
await as(member);await p.goto(env.url+'?job='+PR);await W(900);
await p.fill('#rcQ0','1');await p.fill('#rcQ1','0');await p.click('[data-act=recv_close]');await W(900);
j=await one('select * from requests where id=$1',[PR]);
ok(j.status==='po_vendor'&&Number(j.items[0].recv)===1&&j.hold_reason&&j.hold_reason.includes('Vendor'),'partial delivery: stays open, paused waiting for vendor');
ok(await stock('TS-GRIP')===4,'partial delivery into stock (3 → 4)');
ok(await p.inputValue('#rcQ0')==='3'&&await p.inputValue('#rcQ1')==='1','next delivery defaults to what is still owed');
await p.click('[data-act=recv_close]');await W(900);
j=await one('select * from requests where id=$1',[PR]);
ok(j.status==='closed'&&!j.hold_reason&&Number(j.items[0].recv)===4&&Number(j.items[1].recv)===1,'second delivery completes and closes the request');
ok(await stock('TS-GRIP')===7,'stock 7 after both deliveries');
ok((await one("select count(*)::int n from part_tx where request_id=$1 and kind='receive'",[PR])).n===2,'two receive movements logged');
ok(Number(j.cost_thb)===10000,'request cost = PO amount');

// --- issue parts when closing a job ---
const J2=(await Q('insert','requests',{machine_no:machine,symptom:'ฟันจับลื่น',status:'pending_fd'},[],member,{ret:true,single:true})).data.id;
await Q('update','requests',{status:'wait_admin',job_type:'normal',repair_unit:'FM'},[['id',J2]],fdTest);
await Q('update','requests',{status:'ext_repair',external_ref:'K2-1'},[['id',J2]],admin);
await as(fdTest);await p.goto(env.url+'?job='+J2);await W(900);
await p.fill('#exFix','เปลี่ยน Grip');await p.selectOption('#exPt0','TS-GRIP');await p.fill('#exPq0','1');await p.click('[data-act=close_ext]');await W(900);
j=await one('select * from requests where id=$1',[J2]);t=await one("select * from part_tx where request_id=$1",[J2]);
ok(j.status==='closed'&&t&&Number(t.qty)===-1&&t.machine_no===machine,'closing a job issues the part against the job and machine');
ok(await stock('TS-GRIP')===6&&Number(j.cost_thb)>=2400,'stock 6, part cost added to the job');

// --- accessory machines ---
await as(admin);await p.click('.side-nav [data-nav="machine"]');await W(400);
await p.click('#mAdd');await W(300);await p.fill('#mf-machine_no','ACC-01');await p.fill('#mf-machine_name','Extensometer');
await p.selectOption('#mf-machine_type','เครื่องทดสอบ').catch(()=>{});await p.selectOption('#mf-parent_machine',machine);
await p.fill('#mf-cal_last_date','2026-01-10');await p.selectOption('#mf-cal_interval_month','12').catch(()=>{});
await p.click('#fMachine button[type=submit]');await W(900);
ok((await one("select parent_machine from machines where machine_no='ACC-01'")).parent_machine===machine,'accessory saved with its main machine');
await p.goto(env.url+'?m='+encodeURIComponent(machine));await W(800);
ok((await p.textContent('#main')).includes('อุปกรณ์ประกอบ (1)')&&(await p.textContent('#main')).includes('ACC-01'),'main machine dashboard lists the accessory');
r=await Q('update','machines',{parent_machine:'ACC-01'},[['machine_no','ACC-01']],admin);ok(!!r.error,'a machine cannot be its own accessory');
await p.screenshot({path:'parts-accessory.png',fullPage:true});
console.log('errors',errs);await b.close();await db.end();process.exit(0);})();

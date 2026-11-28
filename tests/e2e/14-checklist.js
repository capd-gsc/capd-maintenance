// 14-checklist.js — daily pre-use machine checklist + the operator role — run through tests/run-all.js
// Operators may only check machines: no jobs, parts or documents. The database sets who/when/NG count.
const {chromium}=require('playwright');const fs=require('fs');const {Client}=require('pg');const env=require('../lib/env.js');
(async()=>{const q=await require('../lib/bridge.js')();const db=new Client(env.pg);await db.connect();
const row=async(s,a)=>(await db.query(s,a)).rows;const one=async(s,a)=>(await row(s,a))[0];
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1280,height:900}});require('../lib/reveal.js')(p);const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.route('http://bridge.local/q',async r=>{const res=await q(JSON.parse(r.request().postData()));if(res.error)console.log('   [db refused]',res.error.message);r.fulfill({body:JSON.stringify(res),contentType:'application/json'})});
await p.route('**/supabase.js',r=>r.fulfill({body:fs.readFileSync(env.client,'utf8'),contentType:'application/javascript'}));
await p.route('**/xlsx.full.min.js',r=>r.fulfill({body:'',contentType:'application/javascript'}));
await p.route('**/qrcode.js',r=>r.fulfill({body:fs.readFileSync(require.resolve('qrcode-generator/qrcode.js'),'utf8'),contentType:'application/javascript'}));
await p.route('**fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));
const W=ms=>p.waitForTimeout(ms||500);const ok=(c,l)=>console.log((c?'PASS ':'FAIL ')+l);
const U=n=>`user${String(n).padStart(2,'0')}@scg.com`;const H=e=>({'x-capd-user':e});
const Q=(op,t,payload,f,e,extra)=>q({op,t,payload,f:f||[],order:[],email:'',headers:H(e),...(extra||{})});
const admin=U(1),member=U(21),OP='operator1@scg.com';
const machine=(await one("select machine_no from machines where status<>'Inactive' order by machine_no limit 1")).machine_no;
await db.query("insert into app_users(email,full_name,role) values ($1,'Op One','operator') on conflict (email) do update set role='operator', active=true",[OP]);

// --- seed templates came with install.sql ---
ok((await one("select count(*)::int n from checklist_templates where id in ('general','extruder','testing','aircon','hoist')")).n===5,'5 sample forms installed');
// --- template rules ---
let r=await Q('update','checklist_templates',{name:'x'},[['id','general']],member);ok(!!r.error||r._noop||(await one("select name from checklist_templates where id='general'")).name!=='x','member cannot edit forms');
r=await Q('update','machines',{checklist_template:'general'},[['machine_no',machine]],admin);ok(!r.error&&(await one('select checklist_template from machines where machine_no=$1',[machine])).checklist_template==='general','admin assigns a form to a machine');
// --- operator is not a maintenance user ---
r=await Q('select','requests',null,[],OP);ok(!r.error&&r.data.length===0,'operator sees no one else’s jobs');
r=await Q('update','requests',{status:'closed'},[],OP);ok(!r.error&&(r._noop||!(r.data||[]).length),'operator cannot move any job forward');
r=await Q('select','spare_parts',null,[],OP);ok(!r.error&&r.data.length===0,'operator sees no parts');
r=await Q('select','machines',null,[],OP);ok(!r.error&&r.data.length>0,'operator can read machines');
// --- checklist run rules ---
const res=[{t:'a',k:'ok',ok:true},{t:'b',k:'ok',ok:false,note:'loose'},{t:'c',k:'num',v:9,min:5,max:7,ok:false}];
r=await Q('insert','checklist_runs',{machine_no:machine,results:res,actor:'someone@scg.com',run_date:'2020-01-01',ng_count:0},[],OP);
let run=await one('select * from checklist_runs where machine_no=$1',[machine]);
ok(!r.error&&run&&run.actor===OP&&run.ng_count===2&&String(run.run_date)!=='2020-01-01','database sets who checked, the date and NG count');
r=await Q('insert','checklist_runs',{machine_no:machine,results:res},[],member);ok(!!r.error&&/ตรวจแล้ว/.test(r.error.message),'one check per machine per day');
r=await Q('insert','checklist_runs',{machine_no:machine,results:[]},[],OP);ok(!!r.error,'empty result refused');
r=await Q('delete','checklist_runs',null,[['id',run.id]],OP);ok((await one('select count(*)::int n from checklist_runs where id=$1',[run.id])).n===1,'operator cannot delete a result');
r=await Q('delete','checklist_runs',null,[['id',run.id]],admin);ok((await one('select count(*)::int n from checklist_runs where id=$1',[run.id])).n===0,'admin can delete a result');
r=await Q('insert','checklist_runs',{machine_no:machine,results:res},[],'outsider@scg.com');ok(!!r.error,'unknown user cannot record');
// --- floor plans: everyone reads, only admin edits ---
r=await Q('insert','floor_plans',{id:'plan-x',name:'X',image_path:'plans/x.jpg'},[],OP);ok(!!r.error,'operator cannot add a floor plan');
r=await Q('insert','floor_plans',{id:'plan-x',name:'X',image_path:'plans/x.jpg'},[],admin);ok(!r.error,'admin adds a floor plan');
r=await Q('insert','floor_plans',{id:'plan-y',name:'Y',image_path:'other/x.jpg'},[],admin);ok(!!r.error,'plan image must live under plans/');
r=await Q('select','floor_plans',null,[],OP);ok(!r.error&&r.data.length===1,'operator reads floor plans');
r=await Q('update','machines',{map_plan:'plan-x',map_x:0.5,map_y:0.25},[['machine_no',machine]],admin);ok(!r.error,'admin pins a machine');
r=await Q('update','machines',{map_x:2},[['machine_no',machine]],admin);ok(!!r.error,'pin position must be inside the plan (0–1)');
await Q('delete','floor_plans',null,[['id','plan-x']],admin);ok((await one('select map_plan from machines where machine_no=$1',[machine])).map_plan===null,'deleting a plan clears its pins');

// --- PM/CAL auto-open switch + opening one plan by hand ---
const pmM=(await one("select machine_no, responsibility from machines where status<>'Inactive' and pm_last_date is not null and pm_interval_month>0 and responsibility is not null order by machine_no limit 1"));
const R=(fn,args,e)=>q({op:'rpc',t:fn,args,f:[],order:[],email:'',headers:H(e)});
r=await R('set_pmcal_auto',{p_on:false},member);ok(!!r.error,'member cannot switch auto-open');
r=await R('set_pmcal_auto',{p_on:false},admin);ok(!r.error&&(await R('pmcal_auto_on',{},member)).data===false,'admin switches auto-open off');
await db.query("update machines set pm_last_date=current_date - interval '11 months', pm_interval_month=12 where machine_no=$1",[pmM.machine_no]);
await db.query("delete from requests where machine_no=$1 and job_type='pmcal'",[pmM.machine_no]);
r=await R('ensure_pmcal_jobs',{},member);ok(r.data===0&&(await one("select count(*)::int n from requests where machine_no=$1 and job_type='pmcal'",[pmM.machine_no])).n===0,'switched off: no job is created automatically');
const other=(await one("select email from app_users where active and role='member' and not is_admin and email<>$1 order by email limit 1",[pmM.responsibility])).email;
r=await R('open_pmcal_job',{p_machine:pmM.machine_no,p_kind:'PM'},other);ok(!!r.error,'someone not responsible cannot open the job');
r=await R('open_pmcal_job',{p_machine:pmM.machine_no,p_kind:'PM'},pmM.responsibility);
let pj=r.data&&await one('select * from requests where id=$1',[r.data]);
ok(!r.error&&pj&&pj.job_type==='pmcal'&&pj.status==='quotation'&&pj.assignee===pmM.responsibility,'responsible person opens the PM job by hand');
ok((await one("select count(*)::int n from request_logs where request_id=$1 and actor=$2",[r.data,pmM.responsibility])).n===1,'manual open is logged with who did it');
r=await R('open_pmcal_job',{p_machine:pmM.machine_no,p_kind:'PM'},admin);ok(r.data===pj.id,'opening again returns the same job');
r=await R('set_pmcal_auto',{p_on:true},admin);ok((await R('pmcal_auto_on',{},member)).data===true,'admin switches auto-open back on');

// --- operator reports a breakdown; Foreman Shift approves Critical out of hours ---
r=await Q('insert','requests',{machine_no:machine,symptom:'ใบมีดบิ่น',urgency:'Critical',status:'closed',job_type:'self_fix'},[],OP);ok(!!r.error,'operator cannot close a job on the spot');
r=await Q('insert','requests',{machine_no:machine,symptom:'ใบมีดบิ่น',urgency:'Critical'},[],OP,{ret:true,single:true});
const OJ=r.data&&r.data.id;let oj=OJ&&await one('select * from requests where id=$1',[OJ]);
ok(!r.error&&oj&&oj.status==='pending_fd'&&oj.reporter===OP,'operator reports a breakdown → waits for Foreman');
r=await Q('select','requests',null,[],OP);ok(!r.error&&r.data.length>0&&r.data.every(x=>x.reporter===OP),'operator sees only own reports');
const FS=(await one("select email from app_users where active and role='foreman_shift' and not is_admin order by email limit 1")).email;
const setNight=v=>db.query(`create or replace function public.night_now() returns boolean language sql stable as $$ select ${v} $$`);
await setNight('false');
r=await Q('update','requests',{status:'ext_repair',job_type:'normal',repair_unit:'RMT'},[['id',OJ]],FS);ok((await one('select status from requests where id=$1',[OJ])).status==='pending_fd','Foreman Shift cannot fast-track during office hours');
await setNight('true');
const NJ=(await Q('insert','requests',{machine_no:machine,symptom:'ไม่ด่วน',urgency:'High'},[],member,{ret:true,single:true})).data.id;
r=await Q('update','requests',{status:'ext_repair',job_type:'normal',repair_unit:'RMT'},[['id',NJ]],FS);ok((await one('select status from requests where id=$1',[NJ])).status==='pending_fd','Foreman Shift cannot fast-track a non-Critical job');
r=await Q('update','requests',{status:'ext_repair',job_type:'normal',repair_unit:'RMT'},[['id',OJ]],FS);oj=await one('select * from requests where id=$1',[OJ]);
ok(oj.status==='ext_repair'&&oj.approved_by===FS&&!oj.external_ref,'night: Foreman Shift approves Critical straight to repair');
ok((await one('select public.next_actors(q) a from requests q where id=$1',[OJ])).a.includes(admin),'admin is asked to add the SAP/K2 number later');
r=await Q('update','requests',{external_ref:'SAP-777'},[['id',OJ]],admin);ok((await one('select external_ref from requests where id=$1',[OJ])).external_ref==='SAP-777','admin adds the SAP number afterwards');
await db.query(`create or replace function public.night_now() returns boolean language sql stable set search_path = public as $$ select extract(hour from (now() at time zone 'Asia/Bangkok')) >= 17 or extract(hour from (now() at time zone 'Asia/Bangkok')) < 8 or extract(isodow from (now() at time zone 'Asia/Bangkok')) in (6, 7) $$`);

// --- UI: operator checks a machine ---
await p.goto(env.url);await W(400);
await p.fill('#trEmail',OP);await p.click('#fTrial button');await W(1000);
ok((await p.textContent('#main')).includes('สแกน QR ที่เครื่อง'),'operator lands on the check home page');
ok(await p.locator('.side-nav [data-nav="list"]').count()===0&&await p.locator('.side-cta').count()===0,'operator menu has no jobs / แจ้งซ่อม');
await p.click(`[data-ck="${machine}"]`);await W(300);
await p.click('#ckAllOk');await p.locator('input[name="ck1"][value="0"]').check({force:true});await p.fill('#ckn1','สายไฟชำรุด');
await p.click('#ckGo');await W(900);
run=await one('select * from checklist_runs where machine_no=$1',[machine]);
ok(run&&run.actor===OP&&run.ng_count===1&&run.results[1].note==='สายไฟชำรุด','operator saves a check from the page');
ok((await p.textContent('#main')).includes('NG 1 ข้อ'),'list shows the NG');
await p.screenshot({path:'checklist-operator.png',fullPage:true});
// --- UI: admin sees today's status ---
await p.click('#logout');await W(600);await p.fill('#trEmail',admin);await p.click('#fTrial button');await W(1000);
ok((await p.textContent('#main')).includes('ตรวจก่อนใช้งานวันนี้'),'admin home shows today’s checks');
await p.click('.side-nav [data-nav="checks"]');await W(500);
ok((await p.textContent('#main')).includes('Op One'),'checks page lists who checked');
console.log('errors',errs);await b.close();await db.end();process.exit(0);})();

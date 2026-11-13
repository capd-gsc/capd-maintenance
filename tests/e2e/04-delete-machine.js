// 04-delete-machine.js — run through tests/run-all.js (it prepares the database and fixtures)
const {chromium}=require('playwright');const fs=require('fs');const {Client}=require('pg');
(async()=>{const q=await require('../lib/bridge.js')();const db=new Client(require('../lib/env.js').pg);await db.connect();
const row=async(s,a)=>(await db.query(s,a)).rows;
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1280,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.route('http://bridge.local/q',async r=>{const res=await q(JSON.parse(r.request().postData()));if(res.error)console.log('   [db refused]',res.error.message);r.fulfill({body:JSON.stringify(res),contentType:'application/json'})});
await p.route('**/supabase.js',r=>r.fulfill({body:fs.readFileSync(require('../lib/env.js').client,'utf8'),contentType:'application/javascript'}));
await p.route('**/xlsx.full.min.js',r=>r.fulfill({body:'',contentType:'application/javascript'}));
await p.route('**/qrcode.js',r=>r.fulfill({body:fs.readFileSync(require.resolve('qrcode-generator/qrcode.js'),'utf8'),contentType:'application/javascript'}));
await p.route('**fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));
await p.goto(require('../lib/env.js').url);await p.waitForTimeout(400);const W=ms=>p.waitForTimeout(ms||500);
const ok=(c,l)=>console.log((c?'PASS ':'FAIL ')+l);
await p.fill('#trEmail','user01@scg.com');await p.click('#fTrial button');await W(900);
// self-fix closed job on M-01 like the user's case
await p.click('.side-nav [data-nav="new"]');await W(150);await p.selectOption('#nMachine','M-01');await p.fill('#nSym','ทดลอง');await p.click('#nModeSelf');await p.fill('#sfFix','รีเซ็ต');await p.click('#bSubmit');await W(600);
const n0=(await row("select count(*)::int n from requests where machine_no='M-01'"))[0].n;console.log('   M-01 jobs (closed + auto PM):',n0);
await p.click('.side-nav [data-nav="machine"]');await W(200);await p.click('[data-mdel="M-01"]');await W(400);
ok((await p.textContent('.modal')).includes(`${n0} ใบ`),'modal explains jobs blocking delete');await p.screenshot({path:'mdel.png'});
await p.click('#mdGo');await W(600);ok((await row("select status from machines where machine_no='M-01'"))[0].status==='Inactive','option 1: machine set Inactive, history kept');
await p.click('[data-mdel="M-01"]');await W(400);await p.check('input[name=mdMode][value=all]');await W(100);ok(await p.isDisabled('#mdGo'),'delete-all needs typed machine no');
await p.fill('#mdConfirm','M-01');await p.click('#mdGo');await W(800);
ok(!(await row("select 1 from machines where machine_no='M-01'")).length&&(await row("select count(*)::int n from requests where machine_no='M-01'"))[0].n===0,'option 2: machine and all its jobs deleted');
await p.click('[data-mdel="MD-01"]');await W(400);await p.fill('#mdConfirm','MD-01');await p.click('#mdGo');await W(700);ok(!(await row("select 1 from machines where machine_no='MD-01'")).length,'machine without jobs deleted');
const forged=await q({op:'delete',t:'machines',f:[['machine_no','T-01']],order:[],email:'',headers:{'x-capd-user':'user14@scg.com'}});ok(!forged.data?.length&&(await row("select 1 from machines where machine_no='T-01'")).length,'non-admin cannot delete machine');
console.log('errors',errs);await b.close();await db.end();process.exit(0);})();

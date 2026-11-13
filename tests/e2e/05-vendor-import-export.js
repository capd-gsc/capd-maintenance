// 05-vendor-import-export.js — run through tests/run-all.js (it prepares the database and fixtures)
const {chromium}=require('playwright');const fs=require('fs');const {Client}=require('pg');
(async()=>{const q=await require('../lib/bridge.js')();const db=new Client(require('../lib/env.js').pg);await db.connect();
const b=await chromium.launch();const p=await b.newPage({acceptDownloads:true});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.route('http://bridge.local/q',async r=>{const res=await q(JSON.parse(r.request().postData()));r.fulfill({body:JSON.stringify(res),contentType:'application/json'})});
await p.route('**/supabase.js',r=>r.fulfill({body:fs.readFileSync(require('../lib/env.js').client,'utf8'),contentType:'application/javascript'}));
await p.route('**/xlsx.full.min.js',r=>r.fulfill({body:fs.readFileSync(require.resolve('xlsx/dist/xlsx.full.min.js'),'utf8'),contentType:'application/javascript'}));
await p.route('**/qrcode.js',r=>r.fulfill({body:fs.readFileSync(require.resolve('qrcode-generator/qrcode.js'),'utf8'),contentType:'application/javascript'}));
await p.route('**fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));
await p.goto(require('../lib/env.js').url);await p.waitForTimeout(400);
await p.fill('#trEmail','user01@scg.com');await p.click('#fTrial button');await p.waitForTimeout(900);
await p.click('.side-nav [data-nav="machine"]');await p.waitForTimeout(200);
for(const f of ['v_new.xlsx','v_old.xlsx']){await p.setInputFiles('#mImport',f);await p.waitForTimeout(1200);}
const ok=(c,l)=>console.log((c?'PASS ':'FAIL ')+l);
const vs=(await db.query("select machine_no, supplier from machines where machine_no in ('VN-01','VO-01') order by 1")).rows;
ok(vs.length===2&&vs.every(r=>r.supplier==='ABC Co.'),'import reads both Vendor and old Supplier headers');
await p.click('.side-nav [data-nav="machine"]');await p.waitForTimeout(300);
ok((await p.textContent('thead')).includes('Vendor')&&!(await p.textContent('#main')).includes('Supplier'),'machine table says Vendor, not Supplier');
await p.click('.side-nav [data-nav="list"]');await p.waitForTimeout(200);const [d]=await Promise.all([p.waitForEvent('download'),p.click('#expReq')]);await d.saveAs('exp.xlsx');
const X=require('xlsx');const wb=X.readFile('exp.xlsx');const hdr=X.utils.sheet_to_json(wb.Sheets['Machine Master'],{header:1})[0];ok(hdr.includes('Vendor')&&hdr.includes('PM DATE')&&hdr[0]==='Machine number','export uses the template headers');
// re-import the exported file
await p.click('.side-nav [data-nav="machine"]');await p.waitForTimeout(200);await p.setInputFiles('#mImport','exp.xlsx');await p.waitForTimeout(1500);const n=(await db.query('select count(*)::int n from machines')).rows[0].n;ok((await p.textContent('.toast')).includes(`นำเข้าเครื่องจักร ${n} เครื่อง`),'exported file imports back ('+n+' machines)');
console.log('errors',errs);await b.close();await db.end();process.exit(0);})();

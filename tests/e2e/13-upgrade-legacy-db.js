// 13-upgrade-legacy-db.js — install.sql run over a database set up with the old SQL files (trial on, with data) — run through tests/run-all.js
const fs=require('fs');const {Client}=require('pg');const env=require('../lib/env.js');
(async()=>{const db=new Client(env.pg);await db.connect();const q=await require('../lib/bridge.js')();
const ok=(c,l)=>console.log((c?'PASS ':'FAIL ')+l);const one=async(s,a)=>(await db.query(s,a)).rows[0];
const H=e=>({'x-capd-user':e});
// data kept
ok((await one('select count(*)::int n from requests')).n===2,'old jobs kept');
ok((await one('select count(*)::int n from machines')).n===2,'old machines kept');
ok((await one('select count(*)::int n from request_logs')).n>=1,'old history kept');
ok((await one("select count(*)::int n from app_users where active")).n===21,'users kept');
// legacy objects removed
ok(!(await one("select to_regclass('public.profiles') r")).r,'profiles table removed');
ok(!(await one("select to_regclass('public.role_presets') r")).r,'role_presets table removed');
ok(!(await one("select 1 x from pg_type where typname='app_role'")),'app_role type removed');
ok(!(await one("select 1 x from pg_proc where proname in ('is_member','my_role','guard_profile_update','handle_new_user')")),'old functions removed');
ok(!(await one("select 1 x from pg_policies where policyname in ('trial_anon_all','trial anon files')")),'old open-everything trial policies gone');
// new structure present
ok(!!(await one("select 1 x from information_schema.columns where table_name='machines' and column_name='parent_machine'")),'machines.parent_machine added');
ok(!!(await one("select 1 x from information_schema.columns where table_name='requests' and column_name='hold_reason'")),'requests.hold_reason added');
ok(!!(await one("select to_regclass('public.part_tx') r")).r,'parts tables added');
// trial mode survives the upgrade and a second run
const anonPol=async()=>(await one("select bool_and('anon'=any(roles)) a from pg_policies where schemaname='public' and tablename in ('requests','spare_parts','part_tx')")).a;
ok(await anonPol(),'trial mode still on after upgrade');
let r=await q({op:'select',t:'requests',f:[],order:[],email:'',headers:H('user14@scg.com')});ok(!r.error&&r.data.length===2,'trial user reads jobs');
await db.query(fs.readFileSync(env.sql('install.sql'),'utf8'));
ok(await anonPol(),'running install.sql again keeps trial on');
r=await q({op:'insert',t:'spare_parts',payload:{part_no:'P-1',name:'Bearing'},f:[],order:[],email:'',headers:H('user01@scg.com'),ret:true});ok(!r.error,'trial admin adds a spare part');
// trial helpers cannot be called from the web
ok(!(await one("select has_function_privilege('anon','public.capd_apply_trial(boolean)','execute') x")).x,'web (anon) cannot switch trial mode');
ok(!(await one("select has_function_privilege('authenticated','public.capd_apply_trial(boolean)','execute') x")).x,'signed-in users cannot switch trial mode');
// trial off → anon blocked; on again → works
await db.query(fs.readFileSync(env.sql('trial_off.sql'),'utf8'));
r=await q({op:'select',t:'requests',f:[],order:[],email:'',headers:H('user14@scg.com')});ok(!!r.error||r.data.length===0,'trial off: header login reads nothing');
r=await q({op:'select',t:'requests',f:[],order:[],email:'user14@scg.com'});ok(!r.error&&r.data.length===2,'trial off: Microsoft login still reads');
await db.query(fs.readFileSync(env.sql('trial_on.sql'),'utf8'));
r=await q({op:'select',t:'requests',f:[],order:[],email:'',headers:H('user14@scg.com')});ok(!r.error&&r.data.length===2,'trial on again');
console.log('errors',[]);await db.end();process.exit(0);})();

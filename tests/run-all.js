// CAPD Maintenance test runner: rebuilds a throw-away Postgres database from supabase/*.sql before each suite,
// then drives the real web page (index.html) in Chromium against it. Usage: node run-all.js [suite-name-part]
const fs = require('fs'), path = require('path'), { execFileSync, spawnSync } = require('child_process');
const { Client } = require('pg');
const env = require('./lib/env.js');
const OUT = path.join(__dirname, 'out');

// ติดตั้งใหม่ = supabase/install.sql · อัปเดต = ฐานข้อมูลรุ่นก่อน (tests/sql/legacy = ไฟล์ที่ใช้จริงก่อน 14 พ.ย. 2026) แล้วรัน install.sql ทับ
const LEGACY = ['schema.sql', 'trial_open_access.sql', 'setup_v3_trial.sql'];
const SUITES = [
  { name: 'sql-guard', mode: 'guard' },
  { name: '01-main-flow', mode: 'full' },
  { name: '02-trial-login', mode: 'trial' },
  { name: '03-edit-delete-job', mode: 'trial' },
  { name: '04-delete-machine', mode: 'trial' },
  { name: '05-vendor-import-export', mode: 'trial' },
  { name: '06-quotes-memo', mode: 'trial' },
  { name: '07-attachments', mode: 'trial' },
  { name: '08-layout', mode: 'trial' },
  { name: '09-cancel-backup-refresh', mode: 'trial' },
  { name: '10-notify', mode: 'trial' },
  { name: '11-flow-hold-downtime', mode: 'trial' },
  { name: '12-parts-purchase', mode: 'trial' },
  { name: '13-upgrade-legacy-db', mode: 'upgrade' },
  { name: '12-parts-purchase', mode: 'upgrade', label: '12-parts (after upgrade)' }
];

async function resetDb(mode) {
  const admin = new Client({ ...env.pg, database: 'postgres' }); await admin.connect();
  await admin.query(`drop database if exists ${env.pg.database}`); await admin.query(`create database ${env.pg.database}`); await admin.end();
  const db = new Client(env.pg); await db.connect();
  const run = async f => { try { await db.query(fs.readFileSync(f, 'utf8')); } catch (e) { throw new Error(path.basename(f) + ': ' + e.message); } };
  await run(path.join(__dirname, 'sql/stub.sql'));
  if (mode === 'upgrade') {
    // ฐานข้อมูลรุ่นก่อนที่มีข้อมูลอยู่แล้ว (โหมดทดลองเปิด) → รัน install.sql ทับ
    for (const f of LEGACY) await run(path.join(__dirname, 'sql/legacy', f));
    await run(path.join(__dirname, 'fixtures/users_test.sql'));
    await run(path.join(__dirname, 'sql/legacy_data.sql'));
    await run(env.sql('install.sql'));
    await db.end();
    return null;
  }
  await run(env.sql('install.sql'));
  await run(path.join(__dirname, 'fixtures/users_test.sql'));
  if (mode === 'trial') await run(env.sql('trial_on.sql'));
  let blocked = null;
  if (mode === 'guard') {
    const res = [].concat(await db.query(fs.readFileSync(path.join(__dirname, 'sql/guard_test.sql'), 'utf8')));
    blocked = res.flatMap(r => r.rows || []).map(r => Object.values(r)[0]).filter(v => typeof v === 'string' && v.startsWith('ok (blocked)'));
  } else await run(path.join(__dirname, 'fixtures/seed.sql'));
  await db.end();
  return blocked;
}

(async () => {
  const only = process.argv[2];
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  execFileSync(process.execPath, [path.join(__dirname, 'fixtures/make-fixtures.js'), OUT], { stdio: 'inherit' });
  let globalRoot = ''; try { globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(); } catch (e) {}
  const NODE_PATH = [path.join(__dirname, 'node_modules'), globalRoot].filter(Boolean).join(path.delimiter);
  let totalPass = 0, totalFail = 0;
  for (const s of SUITES.filter(x => !only || x.name.includes(only))) {
    let pass = 0, fail = [], extra = '';
    try {
      const blocked = await resetDb(s.mode);
      if (s.mode === 'guard') { pass = blocked.length; if (pass < 14) fail.push(`expected 14 blocked attempts, got ${pass}`); }
      else {
        const file = ['.js', '.mjs'].map(x => path.join(__dirname, 'e2e', s.name + x)).find(f => fs.existsSync(f));
        const r = spawnSync(process.execPath, [file], { cwd: OUT, env: { ...process.env, NODE_PATH }, encoding: 'utf8', timeout: 300e3 });
        const lines = (r.stdout || '').split('\n');
        pass = lines.filter(l => l.startsWith('PASS')).length;
        fail = lines.filter(l => l.startsWith('FAIL'));
        const pe = lines.find(l => l.startsWith('errors') || l.startsWith('page errors'));
        if (pe && !/\[\]\s*$/.test(pe)) fail.push(pe);
        if (r.status !== 0) fail.push('crashed: ' + ((r.stderr || '').split('\n').find(l => /Error/.test(l)) || 'exit ' + r.status));
      }
    } catch (e) { fail.push('setup: ' + e.message); }
    totalPass += pass; totalFail += fail.length;
    console.log(`${fail.length ? '✗' : '✓'} ${(s.label || s.name).padEnd(26)} ${pass} passed${fail.length ? ', ' + fail.length + ' failed' : ''}${extra}`);
    fail.forEach(f => console.log('    ' + f));
  }
  console.log(`\n${totalPass} passed, ${totalFail} failed · screenshots in tests/out/`);
  process.exit(totalFail ? 1 : 0);
})();

// 10-notify.mjs — notification queue (who gets told at each step), email/Teams messages, daily summary, ?job= link
// run through tests/run-all.js
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { Client } = require('pg');
const env = require('../lib/env.js');
const core = await import(pathToFileURL(path.join(env.ROOT, 'supabase/functions/notify/core.ts')).href);
const q = await require('../lib/bridge.js')();
const db = new Client(env.pg); await db.connect();
const row = async (s, a) => (await db.query(s, a)).rows;
const ok = (c, l) => console.log((c ? 'PASS ' : 'FAIL ') + l);
const H = e => ({ 'x-capd-user': e });
const as = (e, b) => q({ ...b, f: b.f || [], order: [], email: '', headers: H(e) });
const lastQ = async id => (await row('select * from notify_queue where request_id=$1 order by id desc limit 1', [id]))[0];
const U = n => `user${String(n).padStart(2, '0')}@scg.com`;

// ---------- A. who is queued at each step (Special flow end to end) ----------
const ins = await as(U(5), { op: 'insert', t: 'requests', payload: { machine_no: 'M-01', symptom: 'Gearbox เสียงดัง', urgency: 'High', status: 'pending_fd' }, ret: true, single: true });
const A = ins.data?.id; ok(!!A, 'FS opens a job ' + A);
let n = await lastQ(A); ok(n?.event === 'new' && n.recipients.join() === U(2) && n.actor === U(5), 'new job → Foreman Day of the machine type');
await as(U(2), { op: 'update', t: 'requests', payload: { status: 'quotation', job_type: 'special', assignee: U(14) }, f: [['id', A]] });
n = await lastQ(A); ok(n.event === 'step' && n.recipients.join() === U(14), 'FD approves Special → assignee');
await as(U(14), { op: 'update', t: 'requests', payload: { status: 'memo_approval', quotes: [{ vendor: 'ABC', amount: 45000, chosen: true }], memo_doc: { item: 'x' }, memo_no: 'M-1', memo_approvers: [U(9), U(10)], memo_step: 0 }, f: [['id', A]] });
n = await lastQ(A); ok(n.status === 'memo_approval' && n.recipients.join() === U(9), 'MEMO sent → App 1');
await as(U(9), { op: 'update', t: 'requests', payload: { memo_step: 1 }, f: [['id', A]] });
n = await lastQ(A); ok(n.event === 'memo_next' && n.recipients.join() === U(10), 'App 1 approves → App 2');
await as(U(10), { op: 'update', t: 'requests', payload: { status: 'po_vendor', memo_step: 2 }, f: [['id', A]] });
n = await lastQ(A); ok(n.status === 'po_vendor' && n.recipients.join() === U(1), 'MEMO fully approved → Admin (PO)');
await as(U(1), { op: 'update', t: 'requests', payload: { po_no: 'PO-77' }, f: [['id', A]] });
n = await lastQ(A); ok(n.event === 'po_ready' && n.recipients.join() === U(14), 'PO saved → assignee');
await as(U(14), { op: 'update', t: 'requests', payload: { status: 'closed', fix_detail: 'เปลี่ยนเกียร์' }, f: [['id', A]] });
n = await lastQ(A); ok(n.event === 'closed' && n.recipients.join() === U(5), 'closed → reporter');
ok((await row('select count(*)::int n from notify_queue where request_id=$1', [A]))[0].n === 7, '7 notifications for the whole flow');
// self-fix closed at once → nothing; own cancel → nobody else to tell
const sf = await as(U(5), { op: 'insert', t: 'requests', payload: { machine_no: 'M-01', symptom: 'รีเซ็ต', status: 'closed', job_type: 'self_fix', fix_detail: 'reset' }, ret: true, single: true });
ok((await row('select count(*)::int n from notify_queue where request_id=$1', [sf.data.id]))[0].n === 0, 'self-fix closed on the spot → no notification');
const cx = (await as(U(5), { op: 'insert', t: 'requests', payload: { machine_no: 'T-01', symptom: 'ค่าเพี้ยน', status: 'pending_fd' }, ret: true, single: true })).data.id;
n = await lastQ(cx); ok(n.recipients.join() === U(3), 'tester machine → tester Foreman Day');
await as(U(5), { op: 'update', t: 'requests', payload: { status: 'cancelled', return_note: 'เปิดซ้ำ' }, f: [['id', cx]] });
n = await lastQ(cx); ok(n.event === 'cancelled' && n.recipients.length === 0, 'reporter cancels own job → nobody else notified');
// PM/CAL opened by the system
await db.query('select ensure_pmcal_jobs()');
const pm = (await row("select q.* from notify_queue q join requests r on r.id=q.request_id where r.job_type='pmcal' and r.machine_no='M-01'"))[0];
ok(pm && pm.actor === '' && pm.recipients.join() === U(14), 'system opens PM job → responsible member');
// web clients cannot read the queue
const peek = await as(U(1), { op: 'select', t: 'notify_queue' });
ok(!!peek.error || (peek.data || []).length === 0, 'web users cannot read the notification queue');

// ---------- B. messages and delivery (fake email / Teams) ----------
const users = await row('select email, full_name, active, notify_email from app_users');
const cfg = { appUrl: 'https://example.test/capd/', brevoKey: 'test-key', mailFrom: 'capd@example.test', teamsUrl: 'https://teams.example.test/hook' };
const calls = []; let failNext = false;
const fakeFetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), headers: init.headers }); if (failNext) { failNext = false; return { ok: false, status: 500, text: async () => 'boom' }; } return { ok: true, status: 200, text: async () => '' }; };
const jobOf = async id => { const j = (await row('select r.*, m.machine_name from requests r join machines m on m.machine_no=r.machine_no where r.id=$1', [id]))[0]; return j; };
const qa = await row('select * from notify_queue where request_id=$1 order by id', [A]);
const jA = await jobOf(A);
calls.length = 0; let errs = await core.deliver(fakeFetch, cfg, qa[0], { ...jA, status: 'pending_fd' }, users);
const mail = calls.find(c => c.url.includes('brevo')), team = calls.find(c => c.url === cfg.teamsUrl);
ok(errs.length === 0 && mail?.body.to[0].email === U(2) && mail.headers['api-key'] === 'test-key', 'email goes to the Foreman Day');
ok(mail.body.subject.includes(A) && mail.body.subject.includes('รอ Foreman Day อนุมัติ') && mail.body.htmlContent.includes('?job=' + A), 'email subject + link to the job');
const facts = team?.body.attachments[0].content.body.find(b => b.type === 'FactSet').facts;
ok(team?.body.attachments[0].contentType === 'application/vnd.microsoft.card.adaptive' && facts.some(f => f.title === 'รอ' && f.value === 'User 02'), 'Teams card names who must act');
await db.query("update app_users set notify_email=false where email=$1", [U(10)]);
const users2 = await row('select email, full_name, active, notify_email from app_users');
calls.length = 0; await core.deliver(fakeFetch, cfg, qa[3], jA, users2);
ok(!calls.some(c => c.url.includes('brevo')) && calls.some(c => c.url === cfg.teamsUrl), 'user who turned email off gets no email (Teams still posted)');
calls.length = 0; await core.deliver(fakeFetch, cfg, qa[6], jA, users);
ok(calls.length === 1 && calls[0].url.includes('brevo') && calls[0].body.to[0].email === U(5), 'closed → email to reporter only, no Teams post');
calls.length = 0; await core.deliver(fakeFetch, { ...cfg, brevoKey: undefined }, qa[1], jA, users);
ok(calls.length === 1 && calls[0].url === cfg.teamsUrl, 'without email settings → Teams only');
failNext = true; calls.length = 0; errs = await core.deliver(fakeFetch, cfg, qa[1], jA, users);
ok(errs.length === 1 && errs[0].includes('500'), 'a failed send is reported (queue keeps it for retry)');
ok(core.headline(qa[3], jA).includes('App 2') || core.headline(qa[3], { ...jA, memo_step: 1 }).includes('App 2'), 'MEMO headline names the approver step');

// ---------- C. daily summary ----------
await db.query('alter table requests disable trigger guard_request');
await db.query("update requests set updated_at = now() - interval '5 days' where machine_no='T-01' and status='pending_fd'");
const stuck = (await as(U(5), { op: 'insert', t: 'requests', payload: { machine_no: 'T-01', symptom: 'ค้าง', status: 'pending_fd' }, ret: true, single: true })).data.id;
await db.query("update requests set updated_at = now() - interval '5 days' where id=$1", [stuck]);
await db.query('alter table requests enable trigger guard_request');
const rem = await row('select * from pmcal_reminders'), stale = await row('select * from stale_jobs');
ok(stale.some(s => s.id === stuck && s.idle_days >= 5 && s.waiting_on.includes(U(3))), 'stale_jobs lists a job idle 5 days and who it waits on');
const dm = core.dailyEmails(rem, cfg);
ok(rem.length > 0 && dm.length > 0 && dm.every(m => m.subject.includes('PM/CAL')), 'daily PM/CAL emails grouped per person');
const dc = core.dailyTeamsCard(rem, stale, users, cfg);
ok(dc && JSON.stringify(dc).includes('ใบงานค้างเกิน 3 วัน') && JSON.stringify(dc).includes(stuck), 'daily Teams card lists PM/CAL and stuck jobs');
ok(core.dailyTeamsCard([], [], users, cfg) === null, 'no daily card when nothing is due');
// two channels: repair vs PM/CAL
const cfg2 = { ...cfg, teamsUrlPmcal: 'https://teams.example.test/pmcal' };
const pmItem = (await row("select q.* from notify_queue q join requests r on r.id=q.request_id where r.job_type='pmcal' order by q.id limit 1"))[0];
const pmJob = await jobOf(pmItem.request_id);
calls.length = 0; await core.deliver(fakeFetch, cfg2, pmItem, pmJob, users);
ok(calls.some(c => c.url === cfg2.teamsUrlPmcal) && !calls.some(c => c.url === cfg2.teamsUrl), 'PM/CAL job card → PM/CAL channel');
calls.length = 0; await core.deliver(fakeFetch, cfg2, qa[1], jA, users);
ok(calls.some(c => c.url === cfg2.teamsUrl) && !calls.some(c => c.url === cfg2.teamsUrlPmcal), 'repair job card → repair channel');
calls.length = 0; await core.deliver(fakeFetch, cfg, pmItem, pmJob, users);
ok(calls.some(c => c.url === cfg.teamsUrl), 'no PM/CAL channel set → PM/CAL card falls back to repair channel');
await db.query("update requests set updated_at = now() - interval '6 days' where id=$1", [pmItem.request_id]).catch(() => {});
await db.query('alter table requests disable trigger guard_request'); await db.query("update requests set updated_at = now() - interval '6 days' where id=$1", [pmItem.request_id]); await db.query('alter table requests enable trigger guard_request');
const stale2 = await row('select * from stale_jobs');
const posts = core.dailyTeamsPosts(rem, stale2, users, cfg2);
const pmPost = posts.find(x => x.url === cfg2.teamsUrlPmcal), repPost = posts.find(x => x.url === cfg2.teamsUrl);
ok(posts.length === 2 && JSON.stringify(pmPost.card).includes('PM / CAL ที่ยังไม่เริ่ม') && JSON.stringify(pmPost.card).includes(pmItem.request_id) && !JSON.stringify(pmPost.card).includes(stuck), 'daily: PM/CAL reminders + stuck PM/CAL jobs → PM/CAL channel');
ok(JSON.stringify(repPost.card).includes(stuck) && !JSON.stringify(repPost.card).includes('PM / CAL ที่ยังไม่เริ่ม'), 'daily: stuck repair jobs → repair channel');
ok(core.dailyTeamsPosts(rem, stale2, users, cfg).length === 1, 'one channel configured → one combined daily card');
// personal Teams chat + Outlook email through one Workflow (no Brevo)
const cfg3 = { appUrl: cfg.appUrl, teamsUrl: cfg.teamsUrl, personalUrl: 'https://flow.example.test/personal' };
calls.length = 0; await core.deliver(fakeFetch, cfg3, qa[0], { ...jA, status: 'pending_fd' }, users);
const pc = calls.find(c => c.url === cfg3.personalUrl);
ok(pc && pc.body.chat_to.join() === U(2) && pc.body.email_to.join() === U(2) && pc.body.subject.includes(A) && pc.body.html.includes('?job=' + A) && pc.body.card.type === 'AdaptiveCard', 'personal Workflow gets recipients, subject, html and the card');
ok(calls.some(c => c.url === cfg3.teamsUrl) && !calls.some(c => c.url.includes('brevo')), 'channel card still posted; Brevo not used when personal Workflow is set');
calls.length = 0; await core.deliver(fakeFetch, { ...cfg3, brevoKey: 'k', mailFrom: 'x@y' }, qa[3], jA, users2);
const pc2 = calls.find(c => c.url === cfg3.personalUrl);
ok(pc2 && pc2.body.chat_to.join() === U(10) && pc2.body.email_to.length === 0 && !calls.some(c => c.url.includes('brevo')), 'email turned off → Teams chat only, no email');
calls.length = 0; await core.deliver(fakeFetch, cfg3, { ...qa[0], recipients: [] }, jA, users);
ok(!calls.some(c => c.url === cfg3.personalUrl), 'nobody to tell → personal Workflow not called');
const dp = core.dailyPersonalPayloads(rem, users, cfg3);
ok(dp.length > 0 && dp.every(x => x.chat_to.length === 1 && x.subject.includes('PM/CAL') && x.card.type === 'AdaptiveCard'), 'daily PM/CAL reminders go one per person to the personal Workflow');

// ---------- D. link from email opens the job after login ----------
const { chromium } = require('playwright');
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } }); const perr = []; p.on('pageerror', e => perr.push(e.message));
await p.route('http://bridge.local/q', async r => { const res = await q(JSON.parse(r.request().postData())); r.fulfill({ body: JSON.stringify(res), contentType: 'application/json' }); });
await p.route('**/supabase.js', r => r.fulfill({ body: fs.readFileSync(env.client, 'utf8'), contentType: 'application/javascript' }));
await p.route('**/xlsx.full.min.js', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
await p.route('**/qrcode.js', r => r.fulfill({ body: fs.readFileSync(require.resolve('qrcode-generator/qrcode.js'), 'utf8'), contentType: 'application/javascript' }));
await p.route('**fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
await p.goto(env.url + '?job=' + encodeURIComponent(A)); await p.waitForTimeout(500);
await p.fill('#trEmail', U(5)); await p.click('#fTrial button'); await p.waitForTimeout(1200);
ok((await p.textContent('.h-row h1')).trim() === A, 'email link ?job= opens that job right after login');
await p.goto(env.url); await p.waitForTimeout(900); ok((await p.textContent('.hello h1')).includes('สวัสดี'), 'next visit opens the home page (link used once)');
console.log('errors', perr); await b.close(); await db.end(); process.exit(0);

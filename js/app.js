/* CAPD Maintenance v2 — frontend (vanilla JS + Supabase)
   Flow: แก้ไขเอง / Normal (RMT-SAP, FM-K2) / Special (ใบเสนอราคา → MEMO → Manager App → PO / Vendor) / PM-CAL */
(() => {
'use strict';
const C = window.APP_CONFIG;
const USER_KEY = 'capd-current-user';
const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);

/* ---------- constants ---------- */
const OPT = {
  type: ['เครื่องจักร', 'เครื่องทดสอบ', 'อื่นๆ'],
  loc: ['Extruder Area (Line 91)', 'Extruder Area (Line 98,96,95,92)', 'Injection Area MTD', 'Injection Area COD', 'Office Area MTD', 'Office Area COD', 'Stock Area R/M', 'Stock Area FG AMD', 'Testing Room 1', 'Testing Room 2', 'TD Lab Room 3', 'Weighing Room'],
  mstatus: ['Active', 'Maintenance', 'Inactive'],
  prio: ['Critical', 'High', 'Normal'],
  mtype: ['PM', 'CAL', 'PM & CAL', 'No Plan'],
  interval: [6, 12, 24],
  docKind: ['คู่มือ PDF', 'SOP/WI', 'Drawing', 'วิดีโอ', 'วิธีแก้ปัญหาเบื้องต้น', 'Certificate', 'อื่นๆ']
};
const ROLES = { member: 'Member', foreman_shift: 'Foreman Shift', foreman_day: 'Foreman Day', manager: 'Manager', admin: 'Admin' };
const SL = { pending_fd: 'รอ Foreman Day อนุมัติ', returned: 'ส่งกลับแก้ไข', wait_admin: 'รอ Admin แจ้งซ่อม', ext_repair: 'RMT/FM กำลังซ่อม', quotation: 'ขอใบเสนอราคา / MEMO', memo_approval: 'รอ Manager อนุมัติ MEMO', memo_rejected: 'MEMO ไม่อนุมัติ', po_vendor: 'ออก PO / นัด Vendor', closed: 'ปิดงาน', cancelled: 'ยกเลิก' };
const SCLS = { pending_fd: 's-wait', returned: 's-rej', wait_admin: 's-queue', ext_repair: 's-work', quotation: 's-queue', memo_approval: 's-wait', memo_rejected: 's-rej', po_vendor: 's-test', closed: 's-done', cancelled: 's-done' };
const STATUS_ORDER = ['pending_fd', 'returned', 'wait_admin', 'ext_repair', 'quotation', 'memo_approval', 'memo_rejected', 'po_vendor', 'closed', 'cancelled'];
const ATT = { photo: 'รูปแจ้งซ่อม', external: 'หลักฐานแจ้ง SAP / K2', quotation: 'ใบเสนอราคา', memo: 'MEMO', po: 'PO', close: 'รูป / เอกสารหลังซ่อม' };
const OPEN = s => s !== 'closed' && s !== 'cancelled';

const LOGO = '<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="3" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M9 21l5-5 3 3 6-8" fill="none" stroke="#f39a1e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="23" cy="11" r="2.3" fill="#f39a1e"/></svg>';
const IC = {
  home: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z"/></svg>',
  new: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16M14 4l6 6-9 9H5v-6z"/></svg>',
  list: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><circle cx="4" cy="6" r="2"/><circle cx="4" cy="12" r="2"/><circle cx="4" cy="18" r="2"/><rect x="8" y="5" width="13" height="2.4"/><rect x="8" y="11" width="13" height="2.4"/><rect x="8" y="17" width="13" height="2.4"/></svg>',
  approve: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 12l3 3 5-6"/></svg>',
  machine: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
  cal: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M7 2h2v2h6V2h2v2h3v17H4V4h3zm-1 7v10h12V9zm2 2h2v2H8zm4 0h2v2h-2zm-4 4h2v2H8zm4 0h2v2h-2z"/></svg>',
  docs: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h7l2 2h9v11H3z"/></svg>',
  report: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="12" width="4" height="9"/><rect x="10" y="7" width="4" height="14"/><rect x="17" y="3" width="4" height="18"/></svg>',
  admin: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M17 7h5M19.5 4.5v5"/></svg>',
  user: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="7.5" r="4.5"/><path d="M3 21c.6-4.6 4.3-7 9-7s8.4 2.4 9 7z"/></svg>',
  clock: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  out: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 4h6v16h-6M3 12h12M10 7l-5 5 5 5"/></svg>'
};

/* ---------- state ---------- */
let PENDING_M = new URLSearchParams(location.search).get('m');
const S = { me: null, view: 'home', sel: null, scanNo: null, prefill: null, filter: 'open', q: '', mq: '', docQ: '', docKind: 'all', photos: [], logs: [], att: [] };
const D = { machines: [], requests: [], profiles: [], docs: [] };

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const pad = n => String(n).padStart(2, '0');
function fd(s, time = true) {
  if (!s) return '-';
  const d = new Date(s); if (isNaN(d)) return '-';
  const dateOnly = typeof s === 'string' && s.length <= 10;
  return d.getDate() + ' ' + TH[d.getMonth()] + ' ' + d.getFullYear() + (time && !dateOnly ? ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : '');
}
const localInput = d => { const x = new Date(d); return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()) + 'T' + pad(x.getHours()) + ':' + pad(x.getMinutes()); };
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const money = v => v == null || v === '' ? '-' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' บาท';
const M = no => D.machines.find(m => m.machine_no === no) || {};
const nm = e => { if (!e) return '-'; if (e === 'system') return 'ระบบ (PM/CAL อัตโนมัติ)'; const p = D.profiles.find(x => x.email === e); return p?.full_name || String(e).split('@')[0]; };
const pill = s => `<span class="pill ${SCLS[s] || ''}">${esc(SL[s] || s)}</span>`;
const role = () => S.me?.role || 'member';
const is = (...rs) => rs.includes(role());
const isAdmin = () => role() === 'admin';
const isFD = () => is('foreman_day', 'admin');
const canCreate = () => is('member', 'foreman_shift', 'foreman_day', 'admin');
const usersBy = (...rs) => D.profiles.filter(p => rs.includes(p.role));
const memoApprovers = () => D.profiles.filter(p => p.memo_approver);
function toast(t) { $$('.toast').forEach(x => x.remove()); const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 3000); }
function fail(e) { console.error(e); toast('ผิดพลาด: ' + (e?.message || e)); }
const domainOk = e => new RegExp('^[^@\\s]+@' + C.ALLOWED_DOMAIN.replace('.', '\\.') + '$', 'i').test(e);
const opts = (arr, sel) => arr.map(v => `<option ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(v)}</option>`).join('');
const userOpts = (list, sel, blank) => (blank ? `<option value="">${blank}</option>` : '') + list.map(u => `<option value="${esc(u.email)}" ${u.email === sel ? 'selected' : ''}>${esc(u.full_name || u.email)} · ${ROLES[u.role] || u.role}</option>`).join('');
function jobType(q) {
  if (q.job_type === 'normal') return 'Normal · ' + (q.repair_unit || '-');
  if (q.job_type === 'special') return 'Special';
  if (q.job_type === 'pmcal') return (q.pmcal_kind || 'PM/CAL') + ' (Special)';
  if (q.job_type === 'self_fix') return 'แก้ไขเอง';
  return 'รอพิจารณา';
}

/* ---------- who acts next ---------- */
function owner(q) {
  switch (q.status) {
    case 'pending_fd': return { roles: ['foreman_day'], emails: [] };
    case 'returned': return { roles: [], emails: [q.reporter] };
    case 'wait_admin': return { roles: ['admin'], emails: [] };
    case 'ext_repair': return { roles: ['foreman_day'], emails: [] };
    case 'quotation': case 'memo_rejected': return { roles: [], emails: [q.assignee] };
    case 'memo_approval': return { roles: [], emails: [q.memo_approvers[q.memo_step]] };
    case 'po_vendor': return { roles: q.po_no ? [] : ['admin'], emails: [q.assignee] };
    default: return { roles: [], emails: [] };
  }
}
const ownerText = q => { const o = owner(q); return [...o.roles.map(r => ROLES[r]), ...o.emails.filter(Boolean).map(nm)].join(' + ') || '-'; };
const isMine = q => { const o = owner(q); return o.emails.includes(S.me.email) || o.roles.includes(role()); };

/* ---------- data ---------- */
async function loadAll() {
  const [m, r, p, d] = await Promise.all([
    sb.from('machines').select('*').order('machine_no'),
    sb.from('requests').select('*').order('created_at', { ascending: false }),
    sb.from('role_presets').select('*').order('email'),
    sb.from('documents').select('*').order('created_at', { ascending: false })
  ]);
  for (const x of [m, r, p, d]) if (x.error) throw x.error;
  D.machines = m.data; D.requests = r.data; D.docs = d.data;
  D.profiles = p.data.map(x => ({ ...x, id: x.email }));
}
async function reload() {
  try {
    await loadAll();
    if (S.me) { const u = D.profiles.find(x => x.email === S.me.email); if (!u) { logoutLocal(); return renderLogin('สิทธิ์ใช้งานของคุณถูกนำออกแล้ว'); } S.me = u; }
    if (S.view === 'detail') return openDetail(S.sel, false);
    render();
  } catch (e) { fail(e); }
}
const addLog = (id, action) => sb.from('request_logs').insert({ request_id: id, action, actor: S.me.email });

// Admin sees every open job; everyone else sees jobs waiting on them
function myTasks() { return D.requests.filter(q => OPEN(q.status) && (isAdmin() || isMine(q))); }
function planList() {
  const out = [], today = new Date(); today.setHours(0, 0, 0, 0);
  for (const m of D.machines) {
    if (m.status === 'Inactive') continue;
    for (const [kind, last, iv] of [['PM', m.pm_last_date, m.pm_interval_month], ['CAL', m.cal_last_date, m.cal_interval_month]]) {
      if (!last || !iv) continue;
      const n = new Date(last); n.setMonth(n.getMonth() + Number(iv));
      const next = n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate());
      out.push({ m, kind, last, iv, next, days: Math.round((n - today) / 864e5), job: D.requests.find(q => q.job_type === 'pmcal' && q.machine_no === m.machine_no && q.pmcal_kind === kind && q.due_date === next) });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}
const daysLeft = due => { const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(due + 'T00:00:00') - t) / 864e5); };
const tierOf = d => d <= 30 ? 3 : d <= 60 ? 2 : 1;
function myReminders() {
  return D.requests.filter(q => q.job_type === 'pmcal' && !q.action_at && OPEN(q.status) && q.due_date).filter(q => {
    const t = tierOf(daysLeft(q.due_date));
    return isAdmin() || q.assignee === S.me.email || (t >= 2 && role() === 'foreman_day') || (t >= 3 && role() === 'manager');
  });
}

/* ---------- files ---------- */
function shrink(file) {
  return new Promise(res => {
    const r = new FileReader();
    r.onload = () => { const img = new Image(); img.onload = () => { const s = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); c.toBlob(b => res(b), 'image/jpeg', 0.82); }; img.onerror = () => res(null); img.src = r.result; };
    r.readAsDataURL(file);
  });
}
async function uploadFiles(prefix, kind, files) {
  const out = [];
  for (const [i, f] of [...(files || [])].entries()) {
    const isImg = /^image\//.test(f.type);
    const body = isImg ? (await shrink(f)) || f : f;
    const name = isImg ? f.name.replace(/\.[^.]+$/, '') + '.jpg' : f.name;
    const path = `${prefix}/${kind}-${Date.now()}-${i}-${name.replace(/[^\w.\-]+/g, '_')}`;
    const { error } = await sb.storage.from('request-photos').upload(path, body, { contentType: isImg ? 'image/jpeg' : (f.type || 'application/octet-stream') });
    if (error) throw error;
    out.push({ kind, name, path, by: S.me.email, at: new Date().toISOString() });
  }
  return out;
}
const filesOf = id => $('#' + id)?.files || [];

/* =================== LOGIN (email allowlist, no password) =================== */
function logoutLocal() { S.me = null; try { localStorage.removeItem(USER_KEY); } catch (e) {} }
function renderLogin(msg = '') {
  $('#app').innerHTML = `<div class="login"><div class="login-card">
    <div class="login-band">เข้าสู่ระบบ</div>
    <div class="k2logo">${LOGO}<span>CAPD <b>MAINTENANCE</b></span></div>
    <p class="sub" style="margin:0">${esc(C.ORG)} · ระบบแจ้งซ่อมและบำรุงรักษา</p>
    <form id="fEnter" style="display:flex;flex-direction:column;gap:12px">
      <div class="field"><label for="enEmail">อีเมลบริษัท</label><input id="enEmail" class="inp" type="email" autocomplete="email" placeholder="name@${esc(C.ALLOWED_DOMAIN)}" required></div>
      ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
      <button class="btn" type="submit">เข้าสู่ระบบ</button>
    </form>
    <p class="sub" style="margin:0">ยังไม่มีสิทธิ์ใช้งาน? ติดต่อ Admin เพื่อเพิ่มอีเมลของคุณ</p>
  </div></div>`;
  $('#fEnter').onsubmit = async e => {
    e.preventDefault();
    const em = $('#enEmail').value.trim().toLowerCase();
    if (!domainOk(em)) return renderLogin('ใช้ได้เฉพาะอีเมล @' + C.ALLOWED_DOMAIN);
    try { await loadAll(); } catch (err) { return fail(err); }
    const u = D.profiles.find(x => x.email === em);
    if (!u) return renderLogin('อีเมล ' + em + ' ยังไม่มีสิทธิ์ใช้งาน กรุณาติดต่อ Admin');
    S.me = u; try { localStorage.setItem(USER_KEY, u.email); } catch (err) {}
    await afterLogin();
  };
}

/* =================== SHELL =================== */
function render() {
  if (!S.me) return renderLogin();
  const nApprove = D.requests.filter(q => (q.status === 'pending_fd' && isFD()) || (q.status === 'memo_approval' && q.memo_approvers[q.memo_step] === S.me.email)).length;
  const nav = [['home', 'หน้าหลัก', myTasks().length], ['new', 'แจ้งซ่อม'], ['list', 'ใบงาน'], ['approve', 'อนุมัติ', nApprove], ['machine', 'เครื่องจักร'], ['cal', 'PM / CAL', myReminders().length], ['docs', 'คลังเอกสาร'], ['report', 'รายงาน']];
  if (isAdmin()) nav.push(['admin', 'ผู้ใช้']);
  const crumbs = { home: 'My Tasks', new: 'แจ้งซ่อม / เปิดใบงาน', list: 'ใบงานทั้งหมด', approve: 'รออนุมัติ', machine: 'Machine Master', cal: 'แผน PM / CAL', docs: 'คลังเอกสาร', report: 'รายงาน', admin: 'ผู้ใช้และสิทธิ์', detail: 'รายละเอียดใบงาน', scan: 'เครื่องจักร (สแกน QR)' };
  $('#app').innerHTML = `
  <header class="top"><div class="top-in">
    <nav class="topnav">${[['home', 'หน้าหลัก'], ['new', 'แจ้งซ่อม'], ['list', 'ใบงาน'], ['approve', 'อนุมัติ'], ['cal', 'PM / CAL'], ['report', 'รายงาน']].map(([k, l]) => `<button data-nav="${k}" class="${S.view === k ? 'on' : ''}">${l}</button>`).join('')}</nav>
    <div class="sp"></div>
    <div class="who">${IC.user}<span class="nm">${esc(S.me.full_name || S.me.email)} · ${ROLES[role()] || role()}</span></div>
    <button class="iconbtn k2-orange" id="logout" title="ออกจากระบบ" aria-label="ออกจากระบบ">${IC.out}</button>
    <button class="iconbtn k2-cyan" id="refresh" title="รีเฟรชข้อมูล" aria-label="รีเฟรชข้อมูล">${IC.clock}</button>
  </div></header>
  <div class="wrap">
    <div class="logoband"><div class="k2logo">${LOGO}<span>CAPD <b>MAINTENANCE</b></span></div><div class="orgtag"><i></i>${esc(C.ORG)}</div></div>
    <div class="crumb">${IC.home}<a data-nav="home">${esc(C.APP_NAME)}</a><span class="sep">|</span><span class="cur">${crumbs[S.view]}</span></div>
    <div class="shell">
      <nav class="rail">${nav.map(([k, l, b]) => `<button data-nav="${k}" class="${(S.view === k || (S.view === 'detail' && k === 'list')) ? 'on' : ''}" title="${l}" aria-label="${l}">${IC[k]}${b ? `<span class="badge">${b}</span>` : ''}<span class="lbl">${l}</span></button>`).join('')}</nav>
      <main class="main" id="main">${VIEWS[S.view]()}</main>
    </div>
  </div>`;
  bind();
}

function taskTable(rows, empty = 'ไม่มีรายการ') {
  if (!rows.length) return `<div class="empty">${empty}</div>`;
  return `<div class="tbl-wrap"><table><thead><tr><th>#</th><th>Folio</th><th>ประเภท</th><th>สถานะ</th><th>ผู้ดำเนินการถัดไป</th><th>วันที่เปิด</th></tr></thead><tbody>
  ${rows.map((q, i) => { const m = M(q.machine_no); return `<tr class="click" data-open="${esc(q.id)}"><td class="num">${i + 1}</td><td><span class="folio">${esc(q.id)}, ${esc(q.machine_no)} ${esc(m.machine_name)}</span><br><span class="sub">${esc(q.symptom)}</span></td><td>${esc(jobType(q))}<br><span class="u-${esc(q.urgency)}">${esc(q.urgency)}</span></td><td>${pill(q.status)}</td><td>${OPEN(q.status) ? esc(ownerText(q)) : '-'}</td><td class="num">${fd(q.created_at)}</td></tr>`; }).join('')}
  </tbody></table></div>`;
}

/* =================== VIEWS =================== */
const VIEWS = {
  home() {
    const t = myTasks(), open = D.requests.filter(q => OPEN(q.status)), rem = myReminders();
    const memoWait = D.requests.filter(q => q.status === 'memo_approval').length;
    return `<div class="h-row"><h1>My Tasks</h1><span class="sub">${ROLES[role()] || role()}</span></div>
    <div class="tiles">
      <div class="tile"><b>${open.length}</b><span>ใบงานที่ยังเปิด</span></div>
      <div class="tile ${open.some(q => q.urgency === 'Critical') ? 'alert' : ''}"><b>${open.filter(q => q.urgency === 'Critical').length}</b><span>Critical ที่ยังเปิด</span></div>
      <div class="tile"><b>${memoWait}</b><span>MEMO รอ Manager อนุมัติ</span></div>
      <div class="tile ${rem.some(q => tierOf(daysLeft(q.due_date)) === 3) ? 'alert' : ''}"><b>${rem.length}</b><span>PM/CAL รอเริ่มดำเนินการ</span></div>
    </div>
    ${rem.length ? `<div class="remind"><b>PM / CAL ที่ต้องเริ่มดำเนินการ</b>${rem.map(q => { const d = daysLeft(q.due_date); return `<div class="rrow" data-open="${esc(q.id)}"><span class="tier t${tierOf(d)}">ขั้น ${tierOf(d)}</span><span><b>${esc(q.machine_no)}</b> ${esc(q.pmcal_kind)} ครบกำหนด ${fd(q.due_date)} · ${d < 0 ? 'เกิน ' + (-d) : 'อีก ' + d} วัน</span><span class="sub">${esc(nm(q.assignee))}</span></div>`; }).join('')}</div>` : ''}
    <div class="fbar"><b>งานของฉัน (${t.length})</b><div class="sp"></div>${canCreate() ? '<button class="btn" data-nav="new">+ แจ้งซ่อม</button>' : ''}</div>
    ${taskTable(t, 'ไม่มีงานค้างสำหรับคุณ')}`;
  },

  list() {
    let rows = D.requests.slice();
    if (S.filter === 'open') rows = rows.filter(q => OPEN(q.status)); else if (S.filter !== 'all') rows = rows.filter(q => q.status === S.filter);
    if (S.q) { const k = S.q.toLowerCase(); rows = rows.filter(q => [q.id, q.machine_no, M(q.machine_no).machine_name, q.symptom, q.reporter, q.assignee, q.external_ref, q.memo_no, q.po_no, jobType(q)].join(' ').toLowerCase().includes(k)); }
    const chips = [['open', 'ยังเปิด', D.requests.filter(q => OPEN(q.status)).length], ['all', 'ทั้งหมด', D.requests.length], ...STATUS_ORDER.map(s => [s, SL[s], D.requests.filter(q => q.status === s).length]).filter(x => x[2])];
    return `<div class="h-row"><h1>ใบงานทั้งหมด</h1><span class="sub">${rows.length} รายการ</span><button class="btn ghost" id="expReq">Export Excel</button></div>
    <div class="fbar">${chips.map(([k, l, n]) => `<button class="chip ${S.filter === k ? 'on' : ''}" data-filter="${k}">${l} <span class="sub">${n}</span></button>`).join('')}
    <div class="sp"></div><label class="sr" for="q">ค้นหา</label><input id="q" class="search" placeholder="ค้นหา เลขที่ / เครื่อง / SAP / MEMO / PO" value="${esc(S.q)}"></div>
    ${taskTable(rows)}`;
  },

  approve() {
    const fdRows = D.requests.filter(q => q.status === 'pending_fd');
    const memoRows = D.requests.filter(q => q.status === 'memo_approval' && (isAdmin() || q.memo_approvers[q.memo_step] === S.me.email));
    return `<div class="h-row"><h1>รออนุมัติ</h1></div>
    <h3 class="sec">ใบแจ้งซ่อมรอ Foreman Day อนุมัติ (${fdRows.length})</h3>
    ${isFD() ? '' : '<p class="sub">ดูได้อย่างเดียว เฉพาะ Foreman Day และ Admin ที่อนุมัติได้</p>'}
    ${taskTable(fdRows, 'ไม่มีใบงานรออนุมัติ')}
    <h3 class="sec">MEMO รอ${isAdmin() ? ' Manager' : 'คุณ'}อนุมัติ (${memoRows.length})</h3>
    ${taskTable(memoRows, 'ไม่มี MEMO รออนุมัติ')}`;
  },

  new() {
    if (!canCreate()) return `<div class="h-row"><h1>แจ้งซ่อม</h1></div><div class="empty">บทบาท ${ROLES[role()]} ไม่ได้เปิดใบงาน (เปิดได้เฉพาะ Member, Foreman Shift, Foreman Day, Admin)</div>`;
    const ms = D.machines.filter(m => m.status !== 'Inactive');
    if (!ms.length) return `<div class="h-row"><h1>แจ้งซ่อม</h1></div><div class="empty">ยังไม่มีเครื่องจักรในระบบ</div>`;
    return `<div class="h-row"><h1>แจ้งซ่อม / เปิดใบงาน</h1><span class="sub">ผู้เปิด: ${esc(S.me.email)}</span></div>
    <form id="fNew" class="form">
      <div class="field full"><label for="nMachine">เครื่องจักร *</label>
        <select id="nMachine" class="inp" required><option value="">— เลือกจากทะเบียนเครื่องจักร —</option>${ms.map(m => `<option value="${esc(m.machine_no)}" ${m.machine_no === S.prefill ? 'selected' : ''}>${esc(m.machine_no)} · ${esc(m.machine_name)} (${esc(m.location || '-')})</option>`).join('')}</select></div>
      <div class="full" id="mInfo"></div>
      <div class="field full"><label for="nSym">อาการที่พบ *</label><textarea id="nSym" class="inp" rows="3" required></textarea></div>
      <div class="field full"><label for="nFirst">วิธีแก้ไขเบื้องต้นที่ทำไปแล้ว</label><textarea id="nFirst" class="inp" rows="2"></textarea></div>
      <div class="field"><span class="flabel">ความเร่งด่วน *</span><div class="urg">${OPT.prio.map((p, i) => `<label class="u-${p}" for="nUrg${i}"><input type="radio" name="nUrg" id="nUrg${i}" value="${p}" ${p === 'High' ? 'checked' : ''}>${p}</label>`).join('')}</div></div>
      <div class="field"><label for="nPhoto">รูปภาพ</label><input id="nPhoto" type="file" accept="image/*" multiple class="inp"></div>
      <div class="field full choice">
        <label><input type="radio" name="nMode" value="request" id="nModeReq" checked> <b>แก้ไขเองไม่ได้</b> · ส่งให้ Foreman Day อนุมัติซ่อม</label>
        <label><input type="radio" name="nMode" value="self" id="nModeSelf"> <b>แก้ไขเองได้แล้ว</b> · บันทึกวิธีแก้และปิดงานทันที</label>
      </div>
      <div class="full" id="selfBox" hidden>${closeFields('sf', null)}</div>
      <div class="full btns"><button class="btn" type="submit" id="bSubmit">ส่งใบงาน</button><button class="btn ghost" type="button" data-nav="home">ยกเลิก</button></div>
    </form>`;
  },

  detail() {
    const q = D.requests.find(x => x.id === S.sel); if (!q) return '<div class="empty">ไม่พบรายการ</div>';
    const m = M(q.machine_no);
    const kv = (k, v) => v == null || v === '' ? '' : `<dt>${k}</dt><dd>${v}</dd>`;
    const att = S.att.length ? Object.entries(ATT).map(([k, label]) => { const a = S.att.filter(x => x.kind === k); return a.length ? `<div class="attg"><span class="sub">${label}</span>${a.map(x => /\.(jpe?g|png|gif|webp)$/i.test(x.name) ? `<a href="${esc(x.url)}" target="_blank" rel="noopener"><img src="${esc(x.url)}" alt="${esc(x.name)}"></a>` : `<a class="file" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>`).join('')}</div>` : ''; }).join('') : '';
    return `<div class="h-row"><h1>${esc(q.id)}</h1>${pill(q.status)}<button class="btn ghost" data-nav="list">← กลับ</button></div>
    ${stepsHtml(q)}
    <div class="detail">
      <div style="display:flex;flex-direction:column;gap:16px;min-width:0">
        <div class="box"><h3>ข้อมูลใบงาน</h3><dl class="kv">
          ${kv('เครื่องจักร', `<b>${esc(m.machine_no)}</b> · ${esc(m.machine_name)} <span class="sub">${esc(m.location || '')}</span>`)}
          ${kv('ประเภทงาน', esc(jobType(q)))}
          ${kv('ความเร่งด่วน', `<span class="u-${esc(q.urgency)}">${esc(q.urgency)}</span>`)}
          ${kv('ผู้เปิดใบงาน', esc(nm(q.reporter)) + ' · ' + fd(q.created_at))}
          ${kv('อาการที่พบ', esc(q.symptom))}
          ${kv('วิธีแก้ไขเบื้องต้น', esc(q.first_fix))}
          ${kv('ครบกำหนด', q.due_date ? fd(q.due_date) + ` (${daysLeft(q.due_date) < 0 ? 'เกิน ' + -daysLeft(q.due_date) : 'อีก ' + daysLeft(q.due_date)} วัน)` : '')}
          ${kv('อนุมัติโดย', q.approved_by ? esc(nm(q.approved_by)) + ' · ' + fd(q.approved_at) : '')}
          ${kv('ผู้รับผิดชอบ', q.assignee ? esc(nm(q.assignee)) : '')}
          ${kv('เริ่มดำเนินการ', q.action_at ? fd(q.action_at) : '')}
          ${kv('เลขที่แจ้ง SAP / K2', esc(q.external_ref))}
          ${kv('Vendor', esc(q.vendor))}
          ${kv('ใบเสนอราคา', q.quotation_amount != null ? money(q.quotation_amount) : '')}
          ${kv('เลขที่ MEMO', esc(q.memo_no))}
          ${kv('เลขที่ PO', esc(q.po_no))}
          ${kv('วันนัด Vendor', q.vendor_date ? fd(q.vendor_date) : '')}
          ${kv('หมายเหตุส่งกลับ', q.return_note ? `<span class="u-Critical">${esc(q.return_note)}</span>` : '')}
          ${OPEN(q.status) ? kv('ผู้ดำเนินการถัดไป', `<b>${esc(ownerText(q))}</b>`) : ''}
        </dl></div>
        ${q.memo_approvers?.length ? memoChain(q) : ''}
        ${q.status === 'closed' ? `<div class="box"><h3>สรุปผลการซ่อม</h3><dl class="kv">
          ${kv('วิธีการแก้ไข', esc(q.fix_detail))}${kv('สาเหตุ', esc(q.root_cause))}${kv('อะไหล่ที่ใช้', esc(q.parts_used))}
          ${kv('ค่าใช้จ่าย', money(q.cost_thb))}${kv('เริ่ม', fd(q.start_at))}${kv('เสร็จ', fd(q.end_at))}${kv('ระยะเวลา / Downtime', q.downtime_min != null ? q.downtime_min + ' นาที' : '')}
          ${kv('ปิดงานโดย', esc(nm(q.closed_by)))}</dl></div>` : ''}
        ${att ? `<div class="box"><h3>ไฟล์แนบ</h3><div class="atts">${att}</div></div>` : ''}
        ${actions(q)}
      </div>
      <div class="box"><h3>ประวัติการดำเนินการ</h3><ul class="timeline">${S.logs.map(l => `<li><div>${esc(l.action)}<small>${esc(nm(l.actor))} · ${fd(l.at)}</small></div></li>`).join('') || '<li><div class="sub">—</div></li>'}</ul></div>
    </div>`;
  },

  machine() {
    let rows = D.machines;
    if (S.mq) { const k = S.mq.toLowerCase(); rows = rows.filter(m => Object.values(m).join(' ').toLowerCase().includes(k)); }
    return `<div class="h-row"><h1>Machine Master</h1><span class="sub">${D.machines.length} เครื่อง</span>
      ${isAdmin() ? `<button class="btn" id="mAdd">+ เพิ่มเครื่อง</button><button class="btn ghost" id="qrAll">พิมพ์ QR ทั้งหมด</button><label class="btn ghost" for="mImport" style="cursor:pointer">นำเข้าจาก Excel</label><input id="mImport" type="file" accept=".xlsx,.xls" hidden>` : ''}</div>
    <div class="fbar"><span class="sub">${isAdmin() ? 'นำเข้าไฟล์ DATA.xlsx ได้โดยตรง (ชีท Machine Master, PM Master, CAL Master)' : 'แก้ไขได้เฉพาะ Admin'}</span><div class="sp"></div><label class="sr" for="mq">ค้นหาเครื่อง</label><input id="mq" class="search" placeholder="ค้นหาเครื่อง / Location" value="${esc(S.mq)}"></div>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Machine no.</th><th>Machine Name</th><th>Model</th><th>Serial</th><th>Type</th><th>Location</th><th>Status</th><th>Priority</th><th>Maint. Type</th><th>Responsibility</th><th>Supplier</th><th>Contact</th>${isAdmin() ? '<th></th>' : ''}</tr></thead><tbody>
    ${rows.map(m => `<tr><td class="mono"><a class="folio" href="?m=${encodeURIComponent(m.machine_no)}" data-scan="${esc(m.machine_no)}">${esc(m.machine_no)}</a></td><td>${esc(m.machine_name)}</td><td>${esc(m.model)}</td><td class="mono">${esc(m.serial_number)}</td><td>${esc(m.machine_type)}</td><td>${esc(m.location)}</td><td><span class="pill ${m.status === 'Active' ? 's-confirm' : m.status === 'Maintenance' ? 's-wait' : 's-done'}">${esc(m.status)}</span></td><td class="u-${esc(m.priority)}">${esc(m.priority)}</td><td>${esc(m.maintenance_type)}</td><td>${esc(nm(m.responsibility))}</td><td>${esc(m.supplier)}</td><td>${esc(m.contact_person)}<br><span class="sub">${esc(m.phone)}</span></td>${isAdmin() ? `<td class="row-actions"><button class="btn ghost sm" data-medit="${esc(m.machine_no)}">แก้ไข</button><button class="btn ghost sm" data-qr="${esc(m.machine_no)}">QR</button></td>` : ''}</tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">ยังไม่มีข้อมูลเครื่องจักร</div>'}`;
  },

  cal() {
    const p = planList();
    const st = d => d < 0 ? `<span class="pill s-rej">เกินกำหนด ${-d} วัน</span>` : d <= 90 ? `<span class="pill s-wait">อีก ${d} วัน · ขั้น ${tierOf(d)}</span>` : `<span class="pill s-confirm">อีก ${d} วัน</span>`;
    return `<div class="h-row"><h1>แผน PM / CAL</h1><span class="sub">ระบบเปิดใบงานอัตโนมัติเมื่อเหลือ 90 วัน และแจ้งเตือน 3 ขั้น</span></div>
    <div class="note" style="margin-bottom:14px">ขั้น 1 (≤ 3 เดือน): Member ผู้รับผิดชอบ · ขั้น 2 (≤ 2 เดือน): + Foreman Day · ขั้น 3 (≤ 1 เดือน): + Manager · เตือนทุกวันจนกว่า Member จะกด “เริ่มดำเนินการ” ในใบงาน</div>
    ${p.length ? `<div class="tbl-wrap"><table><thead><tr><th>Machine</th><th>ประเภท</th><th>ครั้งล่าสุด</th><th>Interval</th><th>ครบกำหนด</th><th>สถานะ</th><th>Member</th><th>ใบงาน</th>${isAdmin() ? '<th></th>' : ''}</tr></thead><tbody>
    ${p.map(x => `<tr><td><b class="mono">${esc(x.m.machine_no)}</b> ${esc(x.m.machine_name)}<br><span class="sub">${esc(x.m.location)}</span></td><td>${x.kind}</td><td class="num">${fd(x.last)}</td><td class="num">${x.iv} เดือน</td><td class="num">${fd(x.next)}</td><td>${st(x.days)}</td><td>${esc(nm(x.m.responsibility))}</td><td>${x.job ? `<a class="folio" href="#" data-open="${esc(x.job.id)}">${esc(x.job.id)}</a><br>${pill(x.job.status)}${x.job.action_at ? '' : '<br><span class="sub">ยังไม่เริ่มดำเนินการ</span>'}` : '<span class="sub">-</span>'}</td>${isAdmin() ? `<td><button class="btn ghost sm" data-done="${esc(x.m.machine_no)}|${x.kind}" title="แก้วันที่ทำล่าสุดเป็นวันนี้">ทำแล้ววันนี้</button></td>` : ''}</tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">ยังไม่มีแผน PM/CAL — ใส่วันที่ล่าสุดและ Interval ในหน้าเครื่องจักร</div>'}`;
  },

  docs() {
    const kinds = ['all', ...new Set(D.docs.map(d => d.kind))];
    let rows = D.docs;
    if (S.docKind !== 'all') rows = rows.filter(d => d.kind === S.docKind);
    if (S.docQ) { const k = S.docQ.toLowerCase(); rows = rows.filter(d => [d.title, d.machine_no, d.tags, M(d.machine_no).machine_name].join(' ').toLowerCase().includes(k)); }
    const canWrite = is('admin', 'foreman_day', 'manager');
    const hist = S.docQ ? D.requests.filter(q => q.status === 'closed' && [q.machine_no, q.symptom, q.root_cause, q.fix_detail].join(' ').toLowerCase().includes(S.docQ.toLowerCase())) : [];
    return `<div class="h-row"><h1>คลังเอกสารและความรู้</h1><span class="sub">${D.docs.length} รายการ</span>${canWrite ? '<button class="btn" id="dAdd">+ เพิ่มเอกสาร</button>' : ''}</div>
    <div class="fbar">${kinds.map(k => `<button class="chip ${S.docKind === k ? 'on' : ''}" data-kind="${esc(k)}">${k === 'all' ? 'ทั้งหมด' : esc(k)}</button>`).join('')}<div class="sp"></div><label class="sr" for="dq">ค้นหาเอกสาร</label><input id="dq" class="search" placeholder="ค้นหา รหัสเครื่อง / อาการ" value="${esc(S.docQ)}"></div>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>เอกสาร</th><th>ประเภท</th><th>เครื่องจักร</th><th>อัปเดต</th><th></th></tr></thead><tbody>
    ${rows.map(d => `<tr><td><span class="folio">${esc(d.title)}</span> ${d.restricted ? '<span class="lock">จำกัดสิทธิ์</span>' : ''}<br><span class="sub">${esc(d.tags)}</span></td><td>${esc(d.kind)}</td><td class="mono">${esc(d.machine_no || '-')}</td><td class="num">${fd(d.created_at, false)}</td><td class="row-actions"><button class="btn ghost sm" data-doc="${d.id}">เปิด</button>${canWrite ? `<button class="btn ghost sm" data-docdel="${d.id}">ลบ</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">ไม่พบเอกสาร</div>'}
    ${hist.length ? `<h3 class="sec">ประวัติการซ่อมที่เกี่ยวข้อง (${hist.length})</h3>${taskTable(hist)}` : ''}`;
  },

  report() {
    const c = D.requests.filter(q => q.status === 'closed');
    const timed = c.filter(q => q.start_at && q.end_at);
    const mttr = timed.length ? timed.reduce((a, q) => a + (new Date(q.end_at) - new Date(q.start_at)) / 36e5, 0) / timed.length : 0;
    const dt = c.reduce((a, q) => a + (q.downtime_min || 0), 0), cost = c.reduce((a, q) => a + Number(q.cost_thb || 0), 0);
    const p = planList(); const onTime = p.length ? Math.round(p.filter(x => x.days >= 0).length / p.length * 100) : 0;
    const byType = {}; D.requests.forEach(q => { const k = jobType(q); byType[k] = (byType[k] || 0) + 1; });
    const byCost = {}; c.forEach(q => { byCost[q.machine_no] = (byCost[q.machine_no] || 0) + Number(q.cost_thb || 0); });
    const cnt = {}; D.requests.forEach(q => { cnt[q.machine_no] = (cnt[q.machine_no] || 0) + 1; });
    const bars = (o, unit, label = k => `<b class="mono">${esc(k)}</b> <span class="sub">${esc(M(k).machine_name || '')}</span>`) => { const e = Object.entries(o).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 8); if (!e.length) return '<div class="empty">ยังไม่มีข้อมูล</div>'; const mx = Math.max(...e.map(x => x[1])); return `<div class="bars">${e.map(([k, v]) => `<div class="bar"><span>${label(k)}</span><div class="tr"><div class="fl" style="width:${v / mx * 100}%"></div></div><span class="v">${v.toLocaleString()} ${unit}</span></div>`).join('')}</div>`; };
    return `<div class="h-row"><h1>รายงาน</h1><span class="sub">ข้อมูลทั้งหมดในระบบ</span><button class="btn ghost" id="expReq">Export Excel</button></div>
    <div class="tiles">
      <div class="tile"><b>${D.requests.filter(q => OPEN(q.status)).length}</b><span>ใบงานค้าง</span></div>
      <div class="tile"><b>${mttr.toFixed(1)}</b><span>MTTR (ชม./งาน)</span></div>
      <div class="tile"><b>${dt.toLocaleString()}</b><span>Downtime (นาที)</span></div>
      <div class="tile"><b>${cost.toLocaleString()}</b><span>ค่าซ่อม (บาท)</span></div>
      <div class="tile"><b>${onTime}%</b><span>PM/CAL ไม่เกินกำหนด</span></div>
    </div>
    <div class="grid2">
      <div class="box"><h3>จำนวนใบงานตามประเภท</h3>${bars(byType, 'ใบ', k => esc(k))}</div>
      <div class="box"><h3>ค่าซ่อมตามเครื่อง (บาท)</h3>${bars(byCost, '')}</div>
      <div class="box"><h3>เครื่องที่แจ้งซ่อมบ่อย</h3>${bars(cnt, 'ครั้ง')}</div>
    </div>`;
  },

  admin() {
    return `<div class="h-row"><h1>ผู้ใช้และสิทธิ์</h1><span class="sub">${D.profiles.length} คน</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>อีเมล</th><th>ชื่อที่แสดง</th><th>บทบาท</th><th>อนุมัติ MEMO ได้</th><th></th></tr></thead><tbody>
    ${D.profiles.map((p, i) => `<tr><td>${esc(p.email)}</td>
      <td><label class="sr" for="pn${i}">ชื่อ</label><input id="pn${i}" class="inp" value="${esc(p.full_name || '')}"></td>
      <td><label class="sr" for="pr${i}">บทบาท</label><select id="pr${i}" class="inp">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${p.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td class="c"><label class="sr" for="pm${i}">อนุมัติ MEMO</label><input id="pm${i}" type="checkbox" ${p.memo_approver ? 'checked' : ''}></td>
      <td class="row-actions"><button class="btn sm" data-psave="${i}">บันทึก</button><button class="btn ghost sm" data-pdel="${esc(p.email)}">ลบ</button></td></tr>`).join('')}
    </tbody></table></div>
    <h3 class="sec">เพิ่มผู้ใช้</h3>
    <form id="fPreset" class="form" style="max-width:820px">
      <div class="field"><label for="psEmail">อีเมล *</label><input id="psEmail" class="inp" type="email" required placeholder="name@${esc(C.ALLOWED_DOMAIN)}"></div>
      <div class="field"><label for="psName">ชื่อที่แสดง</label><input id="psName" class="inp"></div>
      <div class="field"><label for="psRole">บทบาท</label><select id="psRole" class="inp">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><span class="flabel">MEMO</span><label><input id="psMemo" type="checkbox"> อนุมัติ MEMO ได้ (Manager App)</label></div>
      <div class="full"><button class="btn" type="submit">เพิ่มผู้ใช้</button></div>
    </form>`;
  },

  scan() {
    const m = M(S.scanNo);
    if (!m.machine_no) return '<div class="empty">ไม่พบเครื่องจักรนี้ในระบบ</div>';
    const open = D.requests.filter(q => q.machine_no === m.machine_no && OPEN(q.status));
    const hist = D.requests.filter(q => q.machine_no === m.machine_no && q.status === 'closed').slice(0, 5);
    return `<div class="h-row"><h1>${esc(m.machine_no)} · ${esc(m.machine_name)}</h1><span class="pill ${m.status === 'Active' ? 's-confirm' : m.status === 'Maintenance' ? 's-wait' : 's-done'}">${esc(m.status)}</span></div>
    <div class="mcard"><div><span>Model</span>${esc(m.model || '-')}</div><div><span>Serial</span>${esc(m.serial_number || '-')}</div><div><span>Location</span>${esc(m.location || '-')}</div><div><span>Priority</span>${esc(m.priority)}</div><div><span>Member ผู้รับผิดชอบ</span>${esc(nm(m.responsibility))}</div><div><span>Supplier</span>${esc(m.supplier || '-')} ${esc(m.phone || '')}</div></div>
    ${canCreate() ? `<div class="scan-cta"><button class="btn big" data-newfor="${esc(m.machine_no)}">+ แจ้งซ่อม / เปิดใบงานเครื่องนี้</button></div>` : ''}
    <h3 class="sec">ใบงานที่ค้าง (${open.length})</h3>
    ${open.length ? open.map(q => `<div class="jcard">
      <div class="jinfo"><span class="folio">${esc(q.id)}</span> ${pill(q.status)} <span class="u-${esc(q.urgency)}">${esc(q.urgency)}</span>
        <div>${esc(q.symptom)}</div>
        <div class="sub">${esc(jobType(q))} · เปิดโดย ${esc(nm(q.reporter))} · ${fd(q.created_at)} · ถัดไป: ${esc(ownerText(q))}</div></div>
      <div class="btns"><button class="btn ${isMine(q) ? '' : 'ghost'}" data-open="${esc(q.id)}">${isMine(q) ? 'ดำเนินการ' : 'เปิดใบงาน'}</button></div>
    </div>`).join('') : '<div class="empty">ไม่มีใบงานค้างของเครื่องนี้</div>'}
    <h3 class="sec">ประวัติการซ่อมล่าสุด</h3>
    ${taskTable(hist, 'ยังไม่มีประวัติการซ่อม')}`;
  }
};

/* ---------- steps + memo chain ---------- */
function stepsHtml(q) {
  const fdStep = ['FD อนุมัติ', ['pending_fd', 'returned']];
  const plans = {
    self_fix: [['เปิดใบงาน + แก้ไขเอง', []], ['ปิดงาน', ['closed']]],
    normal: [fdStep, ['Admin แจ้ง SAP / K2', ['wait_admin']], ['RMT / FM ซ่อม', ['ext_repair']], ['ปิดงาน', ['closed']]],
    special: [fdStep, ['ใบเสนอราคา / MEMO', ['quotation', 'memo_rejected']], ['Manager อนุมัติ', ['memo_approval']], ['PO / นัด Vendor', ['po_vendor']], ['ปิดงาน', ['closed']]],
    pmcal: [['ใบเสนอราคา / MEMO', ['quotation', 'memo_rejected']], ['Manager อนุมัติ', ['memo_approval']], ['PO / นัด Vendor', ['po_vendor']], ['ปิดงาน', ['closed']]],
    none: [fdStep, ['ดำเนินการซ่อม', []], ['ปิดงาน', ['closed']]]
  };
  const plan = plans[q.job_type] || plans.none;
  let cur = plan.findIndex(s => s[1].includes(q.status)); if (cur < 0) cur = q.status === 'closed' ? plan.length - 1 : 0;
  return `<div class="steps">${plan.map((s, i) => `<span class="${i < cur || q.status === 'closed' ? 'done' : i === cur ? 'now' : ''}">${s[0]}</span>`).join('')}</div>`;
}
function memoChain(q) {
  const allDone = ['po_vendor', 'closed'].includes(q.status);
  return `<div class="box"><h3>ลำดับการอนุมัติ MEMO ${q.memo_round > 1 ? `<span class="sub">(ส่งครั้งที่ ${q.memo_round})</span>` : ''}</h3><ol class="chain">${q.memo_approvers.map((e, i) => {
    const st = allDone || (q.status === 'memo_approval' && i < q.memo_step) ? ['ok', 'อนุมัติแล้ว'] : q.status === 'memo_approval' && i === q.memo_step ? ['now', 'รออนุมัติ'] : q.status === 'memo_rejected' ? ['bad', 'ส่งกลับแก้ไข'] : ['', 'รอคิว'];
    return `<li class="${st[0]}"><b>App ${i + 1}</b> ${esc(nm(e))} <span class="sub">${st[1]}</span></li>`;
  }).join('')}</ol></div>`;
}

/* ---------- action forms ---------- */
function closeFields(p, q) {
  const start = q?.vendor_date ? q.vendor_date + 'T08:00' : q?.start_at ? localInput(q.start_at) : q ? localInput(q.created_at) : localInput(Date.now());
  return `<div class="form">
    <div class="field full"><label for="${p}Fix">วิธีการแก้ไข *</label><textarea id="${p}Fix" class="inp" rows="2"></textarea></div>
    <div class="field"><label for="${p}Cause">สาเหตุ</label><input id="${p}Cause" class="inp"></div>
    <div class="field"><label for="${p}Parts">อะไหล่ที่ใช้</label><input id="${p}Parts" class="inp"></div>
    <div class="field"><label for="${p}Cost">ค่าใช้จ่าย (บาท)</label><input id="${p}Cost" class="inp" type="number" min="0" step="0.01" value="${q?.quotation_amount ?? 0}"></div>
    <div class="field"><label for="${p}Start">เริ่ม</label><input id="${p}Start" class="inp" type="datetime-local" value="${start}"></div>
    <div class="field"><label for="${p}End">เสร็จ</label><input id="${p}End" class="inp" type="datetime-local" value="${localInput(Date.now())}"></div>
    <div class="field"><label for="${p}Down">ระยะเวลา / Downtime (นาที)</label><input id="${p}Down" class="inp" type="number" min="0" placeholder="ว่าง = คำนวณจากเวลาเริ่ม–เสร็จ"></div>
    <div class="field"><label for="${p}Files">รูป / เอกสารหลังซ่อม</label><input id="${p}Files" class="inp" type="file" multiple></div>
  </div>`;
}
function readClose(p) {
  const v = id => ($('#' + p + id)?.value || '').trim();
  if (!v('Fix')) { toast('กรอกวิธีการแก้ไข'); return null; }
  const s = v('Start') ? new Date(v('Start')) : null, e = v('End') ? new Date(v('End')) : new Date();
  const mins = v('Down') !== '' ? parseInt(v('Down')) : s ? Math.max(0, Math.round((e - s) / 6e4)) : null;
  return { fix_detail: v('Fix'), root_cause: v('Cause') || null, parts_used: v('Parts') || null, cost_thb: parseFloat(v('Cost')) || 0, start_at: s ? s.toISOString() : null, end_at: e.toISOString(), downtime_min: mins, closed_by: S.me.email, status: 'closed' };
}
const box = (t, inner) => `<div class="box action"><h3>${t}</h3>${inner}</div>`;
function memoForm(q) {
  const apps = memoApprovers();
  const sel = i => `<div class="field"><label for="mfApp${i}">App ${i + 1}${i === 0 ? ' *' : ''}</label><select id="mfApp${i}" class="inp">${userOpts(apps, q.memo_approvers[i], i === 0 ? '— เลือกผู้อนุมัติ —' : '— ไม่มี —')}</select></div>`;
  return `<div class="form">
    <div class="field"><label for="mfVendor">Vendor *</label><input id="mfVendor" class="inp" value="${esc(q.vendor || '')}"></div>
    <div class="field"><label for="mfAmt">ราคาตามใบเสนอราคา (บาท) *</label><input id="mfAmt" class="inp" type="number" min="0" step="0.01" value="${q.quotation_amount ?? ''}"></div>
    <div class="field"><label for="mfQuo">ไฟล์ใบเสนอราคา ${S.att.some(a => a.kind === 'quotation') ? '(แนบแล้ว เพิ่มได้)' : '*'}</label><input id="mfQuo" class="inp" type="file" multiple></div>
    <div class="field"><label for="mfMemoNo">เลขที่ MEMO *</label><input id="mfMemoNo" class="inp" value="${esc(q.memo_no || '')}"></div>
    <div class="field"><label for="mfMemo">ไฟล์ MEMO</label><input id="mfMemo" class="inp" type="file" multiple></div>
    <div class="field full"><span class="flabel">ผู้อนุมัติ MEMO ตามลำดับ</span><span class="hint">อนุมัติทีละคน App 1 → App 2 → App 3 · รายชื่อมาจากผู้ใช้ที่ Admin ติ๊ก “อนุมัติ MEMO ได้”</span></div>
    ${sel(0)}${sel(1)}${sel(2)}
  </div>`;
}
function actions(q) {
  if (!OPEN(q.status)) return '';
  const me = S.me.email, mine = isMine(q) || isAdmin();
  const waitNote = () => `<div class="note">ขั้นตอนนี้รอ <b>${esc(ownerText(q))}</b></div>`;
  switch (q.status) {
    case 'pending_fd':
      if (!isFD()) return waitNote();
      return box('Foreman Day: อนุมัติซ่อม', `<div class="choice">
        <label><input type="radio" name="apType" value="RMT" checked> <b>Normal · RMT</b> · Admin แจ้งซ่อมผ่าน SAP</label>
        <label><input type="radio" name="apType" value="FM"> <b>Normal · FM</b> · Admin แจ้งซ่อมผ่าน K2</label>
        <label><input type="radio" name="apType" value="special"> <b>Special</b> · ขอใบเสนอราคา Vendor → MEMO → Manager App → PO</label></div>
        <div class="form" style="margin-top:10px">
          <div class="field"><label for="apAssignee">ผู้รับผิดชอบงาน Special</label><select id="apAssignee" class="inp">${userOpts([S.me, ...usersBy('member', 'foreman_day').filter(u => u.email !== me)], me)}</select><span class="hint">Foreman Day ทำเอง หรือมอบหมาย Member</span></div>
          <div class="field"><label for="apNote">หมายเหตุ (ต้องกรอกถ้าไม่อนุมัติ)</label><input id="apNote" class="inp"></div>
        </div>
        <div class="btns" style="margin-top:12px"><button class="btn ok" data-act="fd_approve">อนุมัติซ่อม</button><button class="btn bad" data-act="fd_reject">ไม่อนุมัติ · ส่งกลับ</button></div>`);
    case 'returned':
      if (!(q.reporter === me || isAdmin() || is('foreman_shift', 'foreman_day'))) return waitNote();
      return box('ใบงานถูกส่งกลับ: ลองแก้ไขอีกครั้ง', `<p class="sub" style="margin-top:0">เหตุผล: ${esc(q.return_note || '-')}</p>
        <div class="choice"><label><input type="radio" name="rtMode" value="resubmit" checked> แก้ไขเองไม่ได้ · ส่งให้ Foreman Day อนุมัติอีกครั้ง</label><label><input type="radio" name="rtMode" value="self"> แก้ไขเองได้แล้ว · บันทึกและปิดงาน</label></div>
        <div id="rtResubmit" class="form" style="margin-top:10px">
          <div class="field full"><label for="rtSym">อาการที่พบ</label><textarea id="rtSym" class="inp" rows="2">${esc(q.symptom)}</textarea></div>
          <div class="field full"><label for="rtFirst">วิธีแก้ไขเบื้องต้นที่ทำเพิ่ม</label><textarea id="rtFirst" class="inp" rows="2">${esc(q.first_fix || '')}</textarea></div>
        </div>
        <div id="rtSelf" hidden style="margin-top:10px">${closeFields('rt', q)}</div>
        <div class="btns" style="margin-top:12px"><button class="btn" data-act="returned_go">บันทึก</button></div>`);
    case 'wait_admin':
      if (!isAdmin()) return waitNote();
      return box(`Admin: แจ้งซ่อม ${esc(q.repair_unit)} ผ่าน ${q.repair_unit === 'FM' ? 'K2' : 'SAP'}`, `<div class="form">
        <div class="field"><label for="exRef">เลขที่ใบแจ้งงาน ${q.repair_unit === 'FM' ? 'K2' : 'SAP'} *</label><input id="exRef" class="inp"></div>
        <div class="field"><label for="exFiles">ภาพถ่าย / หลักฐานการแจ้ง</label><input id="exFiles" class="inp" type="file" multiple></div></div>
        <div class="btns" style="margin-top:12px"><button class="btn ok" data-act="admin_report">บันทึกการแจ้งซ่อม</button></div>`);
    case 'ext_repair':
      if (!isFD()) return waitNote();
      return box(`Foreman Day: สรุปผลการซ่อมของ ${esc(q.repair_unit)} แล้วปิดงาน`, closeFields('ex', q) + `<div class="btns" style="margin-top:12px"><button class="btn ok" data-act="close_ext">สรุปและปิดงาน</button></div>`);
    case 'quotation': case 'memo_rejected':
      if (!(mine || isFD())) return waitNote();
      return (q.job_type === 'pmcal' && !q.action_at ? box('เริ่มดำเนินการ PM/CAL', `<p class="sub" style="margin-top:0">กดเมื่อเริ่มขอใบเสนอราคาจาก Vendor แล้ว ระบบจะหยุดส่งอีเมลเตือน</p><div class="btns"><button class="btn warn" data-act="pm_action">เริ่มดำเนินการแล้ว</button></div>`) : '')
        + box(q.status === 'memo_rejected' ? 'แก้ไข MEMO แล้วส่งอนุมัติใหม่' : 'ใบเสนอราคา และออก MEMO', (q.status === 'memo_rejected' ? `<p class="u-Critical" style="margin-top:0">MEMO ไม่อนุมัติ: ${esc(q.return_note || '-')}</p>` : '') + memoForm(q) + `<div class="btns" style="margin-top:12px"><button class="btn ok" data-act="memo_submit">ส่ง MEMO ให้ Manager อนุมัติ</button></div>`);
    case 'memo_approval': {
      const cur = q.memo_approvers[q.memo_step];
      if (cur !== me) return waitNote();
      return box(`App ${q.memo_step + 1}: พิจารณา MEMO ${esc(q.memo_no || '')}`, `<p style="margin-top:0">Vendor <b>${esc(q.vendor || '-')}</b> · ราคา <b>${money(q.quotation_amount)}</b> · ดูไฟล์ใบเสนอราคาและ MEMO ในส่วนไฟล์แนบ</p>
        <div class="field"><label for="maNote">ความเห็น (ต้องกรอกถ้าไม่อนุมัติ)</label><input id="maNote" class="inp"></div>
        <div class="btns" style="margin-top:12px"><button class="btn ok" data-act="memo_approve">อนุมัติ</button><button class="btn bad" data-act="memo_reject">ไม่อนุมัติ · ส่งกลับแก้ไข</button></div>`);
    }
    case 'po_vendor': {
      let html = '';
      if (isAdmin() && !q.po_no) html += box('Admin: ออก PO', `<div class="form"><div class="field"><label for="poNo">เลขที่ PO *</label><input id="poNo" class="inp"></div><div class="field"><label for="poFiles">ไฟล์ PO</label><input id="poFiles" class="inp" type="file" multiple></div></div><div class="btns" style="margin-top:12px"><button class="btn ok" data-act="po_save">บันทึก PO</button></div>`);
      if (q.assignee === me || isFD() || isAdmin()) {
        html += box('นัด Vendor เข้าดำเนินการ', `<div class="form"><div class="field"><label for="vdDate">วันนัด Vendor</label><input id="vdDate" class="inp" type="date" value="${esc(q.vendor_date || '')}"></div></div><div class="btns" style="margin-top:12px"><button class="btn" data-act="vendor_date">บันทึกวันนัด</button></div>`);
        html += box('สรุปผลก่อนปิดงาน', q.po_no ? closeFields('pv', q) + `<div class="btns" style="margin-top:12px"><button class="btn ok" data-act="close_special">สรุปและปิดงาน</button></div>` : '<div class="note">ปิดงานได้หลังจาก Admin บันทึกเลขที่ PO แล้ว</div>');
      }
      return html || waitNote();
    }
  }
  return '';
}

async function act(a) {
  const q = D.requests.find(x => x.id === S.sel); if (!q) return;
  const me = S.me.email, now = new Date().toISOString(), v = id => ($('#' + id)?.value || '').trim();
  let patch = null, log = '', msg = '', machinePatch = null;
  try {
    switch (a) {
      case 'fd_approve': {
        const t = document.querySelector('input[name=apType]:checked').value;
        if (t === 'special') { patch = { status: 'quotation', job_type: 'special', assignee: v('apAssignee') || me }; log = 'Foreman Day อนุมัติ · Special · ผู้รับผิดชอบ ' + nm(patch.assignee); }
        else { patch = { status: 'wait_admin', job_type: 'normal', repair_unit: t }; log = `Foreman Day อนุมัติ · Normal ส่งซ่อม ${t} (${t === 'FM' ? 'K2' : 'SAP'})`; }
        Object.assign(patch, { approved_by: me, approved_at: now, return_note: null }); if (v('apNote')) log += ' · ' + v('apNote'); msg = 'อนุมัติแล้ว'; break;
      }
      case 'fd_reject':
        if (!v('apNote')) return toast('กรอกหมายเหตุเหตุผลที่ไม่อนุมัติ');
        patch = { status: 'returned', return_note: v('apNote') }; log = 'Foreman Day ไม่อนุมัติ ส่งกลับ · ' + v('apNote'); msg = 'ส่งกลับแล้ว'; break;
      case 'returned_go':
        if (document.querySelector('input[name=rtMode]:checked').value === 'self') {
          patch = readClose('rt'); if (!patch) return;
          patch.job_type = 'self_fix'; patch.attachments = [...(q.attachments || []), ...await uploadFiles(q.id, 'close', filesOf('rtFiles'))];
          log = 'แก้ไขเองได้ · ปิดงาน · ' + patch.fix_detail; msg = 'ปิดงานแล้ว';
        } else {
          patch = { status: 'pending_fd', symptom: v('rtSym') || q.symptom, first_fix: v('rtFirst') || null }; log = 'ส่งให้ Foreman Day อนุมัติอีกครั้ง'; msg = 'ส่งอนุมัติแล้ว';
        }
        break;
      case 'admin_report':
        if (!v('exRef')) return toast('กรอกเลขที่ใบแจ้งงาน');
        patch = { status: 'ext_repair', external_ref: v('exRef'), attachments: [...(q.attachments || []), ...await uploadFiles(q.id, 'external', filesOf('exFiles'))] };
        log = `Admin แจ้งซ่อม ${q.repair_unit} ผ่าน ${q.repair_unit === 'FM' ? 'K2' : 'SAP'} เลขที่ ${v('exRef')}`; msg = 'บันทึกการแจ้งซ่อมแล้ว'; break;
      case 'close_ext': case 'close_special': {
        const pre = a === 'close_ext' ? 'ex' : 'pv';
        patch = readClose(pre); if (!patch) return;
        patch.attachments = [...(q.attachments || []), ...await uploadFiles(q.id, 'close', filesOf(pre + 'Files'))];
        log = 'สรุปผลและปิดงาน · ' + patch.fix_detail; msg = 'ปิดงานแล้ว';
        if (q.job_type === 'pmcal') machinePatch = { [q.pmcal_kind === 'CAL' ? 'cal_last_date' : 'pm_last_date']: patch.end_at.slice(0, 10) };
        break;
      }
      case 'pm_action': patch = { action_at: now }; log = 'Member เริ่มดำเนินการ (ขอใบเสนอราคา)'; msg = 'บันทึกแล้ว หยุดส่งอีเมลเตือน'; break;
      case 'memo_submit': {
        const apps = [v('mfApp0'), v('mfApp1'), v('mfApp2')].filter(Boolean);
        if (!v('mfVendor') || v('mfAmt') === '' || !v('mfMemoNo')) return toast('กรอก Vendor, ราคา และเลขที่ MEMO');
        if (!apps.length) return toast('เลือกผู้อนุมัติ App 1');
        if (new Set(apps).size !== apps.length) return toast('ผู้อนุมัติซ้ำกัน');
        if (!filesOf('mfQuo').length && !(q.attachments || []).some(x => x.kind === 'quotation')) return toast('แนบไฟล์ใบเสนอราคา');
        const added = [...await uploadFiles(q.id, 'quotation', filesOf('mfQuo')), ...await uploadFiles(q.id, 'memo', filesOf('mfMemo'))];
        patch = { status: 'memo_approval', vendor: v('mfVendor'), quotation_amount: parseFloat(v('mfAmt')), memo_no: v('mfMemoNo'), memo_approvers: apps, memo_step: 0, memo_round: (q.memo_round || 0) + 1, action_at: q.action_at || now, return_note: null, attachments: [...(q.attachments || []), ...added] };
        log = `ส่ง MEMO ${patch.memo_no} ให้อนุมัติ: ${apps.map((e, i) => 'App' + (i + 1) + ' ' + nm(e)).join(' → ')}`; msg = 'ส่ง MEMO แล้ว'; break;
      }
      case 'memo_approve': {
        const last = q.memo_step + 1 >= q.memo_approvers.length;
        patch = last ? { status: 'po_vendor', memo_step: q.memo_approvers.length } : { memo_step: q.memo_step + 1 };
        log = `App ${q.memo_step + 1} อนุมัติ MEMO` + (v('maNote') ? ' · ' + v('maNote') : '') + (last ? ' · ครบทุกคน ส่งต่อ Admin ออก PO' : ' · ส่งต่อ App ' + (q.memo_step + 2));
        msg = 'อนุมัติแล้ว'; break;
      }
      case 'memo_reject':
        if (!v('maNote')) return toast('กรอกความเห็นเหตุผลที่ไม่อนุมัติ');
        patch = { status: 'memo_rejected', memo_step: 0, return_note: `App ${q.memo_step + 1} (${nm(me)}): ${v('maNote')}` };
        log = `App ${q.memo_step + 1} ไม่อนุมัติ MEMO · ${v('maNote')}`; msg = 'ส่งกลับแก้ไขแล้ว'; break;
      case 'po_save':
        if (!v('poNo')) return toast('กรอกเลขที่ PO');
        patch = { po_no: v('poNo'), attachments: [...(q.attachments || []), ...await uploadFiles(q.id, 'po', filesOf('poFiles'))] };
        log = 'Admin ออก PO เลขที่ ' + v('poNo'); msg = 'บันทึก PO แล้ว'; break;
      case 'vendor_date':
        if (!v('vdDate')) return toast('เลือกวันนัด');
        patch = { vendor_date: v('vdDate') }; log = 'นัด Vendor เข้าดำเนินการวันที่ ' + fd(v('vdDate')); msg = 'บันทึกวันนัดแล้ว'; break;
      default: return;
    }
  } catch (e) { return fail(e); }
  $$('[data-act]').forEach(b => b.disabled = true);
  const { error } = await sb.from('requests').update(patch).eq('id', q.id);
  if (error) { $$('[data-act]').forEach(b => b.disabled = false); return fail(error); }
  if (machinePatch) await sb.from('machines').update(machinePatch).eq('machine_no', q.machine_no);
  await addLog(q.id, log);
  toast(msg);
  await loadAll(); openDetail(q.id, false);
}

async function openDetail(id, scroll = true) {
  S.sel = id; S.view = 'detail';
  const q = D.requests.find(x => x.id === id);
  if (!q) { render(); return; }
  if (scroll) { S.logs = []; S.att = []; render(); window.scrollTo(0, 0); }
  const files = [...(q.photos || []).map(p => ({ kind: 'photo', name: p.split('/').pop(), path: p })), ...(q.attachments || [])];
  const [{ data: logs }, signed] = await Promise.all([
    sb.from('request_logs').select('*').eq('request_id', id).order('at'),
    files.length ? sb.storage.from('request-photos').createSignedUrls(files.map(f => f.path), 3600) : Promise.resolve({ data: [] })
  ]);
  if (S.sel !== id || S.view !== 'detail') return;
  S.logs = logs || []; S.att = files.map((f, i) => ({ ...f, url: signed.data?.[i]?.signedUrl })).filter(f => f.url);
  render();
}

/* ---------- QR ---------- */
async function afterLogin() {
  try { await sb.rpc('ensure_pmcal_jobs'); } catch (e) { /* function missing until v2_workflow.sql is run */ }
  try { await loadAll(); } catch (e) { return fail(e); }
  const no = PENDING_M; PENDING_M = null; S.view = 'home';
  if (no) {
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    if (D.machines.some(m => m.machine_no === no)) { S.scanNo = no; S.view = 'scan'; } else toast('ไม่พบเครื่อง ' + no + ' ในระบบ');
  }
  render(); subscribe();
}
function openScan(no) { S.scanNo = no; S.view = 'scan'; render(); window.scrollTo(0, 0); }
const scanUrl = no => location.origin + location.pathname + '?m=' + encodeURIComponent(no);
function qrSvg(text) { const qr = qrcode(0, 'M'); qr.addData(text); qr.make(); return qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true }); }
function printQR(list) {
  if (typeof qrcode !== 'function') return toast('โหลดตัวสร้าง QR ไม่สำเร็จ ลองรีเฟรชหน้า');
  if (!list.length) return toast('ยังไม่มีเครื่องจักร');
  modal(`<div class="noprint" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px"><h2 style="margin:0;flex:1">สติกเกอร์ QR (${list.length})</h2><button class="btn" id="qrPrint">พิมพ์</button><button class="btn ghost" data-close>ปิด</button></div>
    <p class="sub noprint" style="margin-top:0">พิมพ์ลงสติกเกอร์ แล้วติดที่เครื่องจักร สแกนด้วยกล้องมือถือเพื่อแจ้งซ่อมหรือดูใบงานค้าง</p>
    <div class="qr-sheet">${list.map(m => `<div class="qr-label"><div class="qr-img">${qrSvg(scanUrl(m.machine_no))}</div>
      <div class="qr-txt"><b>${esc(m.machine_no)}</b><span>${esc(m.machine_name)}</span><small>${esc(m.location || '')}</small><em>สแกนเพื่อแจ้งซ่อม</em><small>${esc(C.APP_NAME)}</small></div></div>`).join('')}</div>`);
  document.body.classList.add('printing-qr');
  const bg = $('#modal'); const obs = new MutationObserver(() => { if (!document.body.contains(bg)) { document.body.classList.remove('printing-qr'); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
  $('#qrPrint').onclick = () => window.print();
}

/* ---------- machines: form + import ---------- */
const MF = [
  ['machine_no', 'Machine number *', 'text'], ['machine_name', 'Machine Name *', 'text'], ['model', 'Model', 'text'], ['serial_number', 'Serial Number', 'text'],
  ['machine_type', 'Machine Type', OPT.type], ['location', 'Location', OPT.loc], ['status', 'Status', OPT.mstatus], ['priority', 'Priority', OPT.prio],
  ['maintenance_type', 'Maintenance Type', OPT.mtype], ['responsibility', 'Member ผู้รับผิดชอบ (อีเมล)', 'email'], ['eng_foreman', 'Eng, Foreman (อีเมล)', 'email'],
  ['supplier', 'Supplier', 'text'], ['contact_person', 'Contact Person', 'text'], ['phone', 'เบอร์โทรศัพท์', 'text'], ['email', 'E-mail Supplier', 'text'], ['other_contact', 'Line / ช่องทางอื่น', 'text'],
  ['pm_last_date', 'PM ล่าสุด', 'date'], ['pm_interval_month', 'PM Interval (เดือน)', OPT.interval], ['cal_last_date', 'CAL ล่าสุด', 'date'], ['cal_interval_month', 'CAL Interval (เดือน)', OPT.interval]
];
function machineForm(no) {
  const m = no ? M(no) : { status: 'Active', priority: 'Normal', maintenance_type: 'No Plan' };
  const field = ([k, l, t]) => `<div class="field"><label for="mf-${k}">${l}</label>${Array.isArray(t)
    ? `<select id="mf-${k}" class="inp"><option value=""></option>${opts(t, m[k])}</select>`
    : `<input id="mf-${k}" class="inp" type="${t}" value="${esc(m[k] ?? '')}" ${k === 'machine_no' && no ? 'readonly' : ''}>`}</div>`;
  modal(`<h2>${no ? 'แก้ไขเครื่อง ' + esc(no) : 'เพิ่มเครื่องจักร'}</h2><form id="fMachine" class="form">${MF.map(field).join('')}
    <div class="full btns"><button class="btn" type="submit">บันทึก</button><button class="btn ghost" type="button" data-close>ยกเลิก</button>${no ? '<button class="btn bad" type="button" id="mDel">ลบเครื่อง</button>' : ''}</div></form>`);
  $('#fMachine').onsubmit = async e => {
    e.preventDefault();
    const row = {}; MF.forEach(([k]) => { const val = $('#mf-' + k).value.trim(); row[k] = val === '' ? null : val; });
    if (!row.machine_no || !row.machine_name) return toast('กรอก Machine number และ Machine Name');
    ['pm_interval_month', 'cal_interval_month'].forEach(k => row[k] = row[k] ? parseInt(row[k]) : null);
    row.status ||= 'Active'; row.priority ||= 'Normal'; row.maintenance_type ||= 'No Plan'; row.updated_at = new Date().toISOString();
    const { error } = await sb.from('machines').upsert(row);
    if (error) return fail(error);
    closeModal(); toast('บันทึกแล้ว'); try { await sb.rpc('ensure_pmcal_jobs'); } catch (e2) {} reload();
  };
  const del = $('#mDel');
  if (del) del.onclick = async () => {
    if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'กดอีกครั้งเพื่อยืนยันการลบ'; return; }
    const { error } = await sb.from('machines').delete().eq('machine_no', no);
    if (error) return fail({ message: 'ลบไม่ได้ (มีใบงานอ้างอิงอยู่ ให้เปลี่ยนสถานะเป็น Inactive แทน)' });
    closeModal(); toast('ลบแล้ว'); reload();
  };
}
const xDate = v => { if (!v) return null; if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); const d = new Date(v); return isNaN(d) ? null : d.toISOString().slice(0, 10); };
async function importExcel(file) {
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const sheet = name => { const ws = wb.Sheets[Object.keys(wb.Sheets).find(n => n.trim().toLowerCase() === name.toLowerCase())]; if (!ws) return []; return XLSX.utils.sheet_to_json(ws, { defval: null }).map(r => { const o = {}; for (const k in r) o[k.replace(/\s+/g, ' ').trim().toLowerCase()] = typeof r[k] === 'string' ? r[k].trim() : r[k]; return o; }); };
    const g = (r, ...keys) => { for (const k of keys) if (r[k] != null && r[k] !== '' && r[k] !== '-') return r[k]; return null; };
    const rows = sheet('Machine Master').filter(r => g(r, 'machine number')).map(r => ({
      machine_no: String(g(r, 'machine number')), machine_name: String(g(r, 'machine name') || g(r, 'machine number')),
      model: g(r, 'model'), serial_number: g(r, 'serial number') && String(g(r, 'serial number')), machine_type: g(r, 'machine type'), location: g(r, 'location'),
      status: g(r, 'staus', 'status') || 'Active', priority: g(r, 'priority') || 'Normal', maintenance_type: g(r, 'maintenance type') || 'No Plan',
      responsibility: g(r, 'responsibility'), eng_foreman: g(r, 'eng,foreman', 'eng, foreman'), supplier: g(r, 'supplier'), contact_person: g(r, 'contact person'),
      phone: g(r, 'เบอร์โทรศัพท์') && String(g(r, 'เบอร์โทรศัพท์')), email: g(r, 'e-mail'), other_contact: g(r, 'line/ช่องทางอื่น'), updated_at: new Date().toISOString()
    }));
    if (rows.length) { const { error } = await sb.from('machines').upsert(rows); if (error) throw error; }
    let plan = 0;
    for (const [sh, dk] of [['PM Master', 'pm'], ['CAL Master', 'cal']]) {
      for (const r of sheet(sh).filter(r => g(r, 'machine number'))) {
        const { error } = await sb.from('machines').update({ [dk + '_last_date']: xDate(g(r, dk + ' date')), [dk + '_interval_month']: parseInt(g(r, 'interval')) || null }).eq('machine_no', String(g(r, 'machine number')));
        if (!error) plan++;
      }
    }
    try { await sb.rpc('ensure_pmcal_jobs'); } catch (e) {}
    toast(`นำเข้าเครื่องจักร ${rows.length} เครื่อง · แผน PM/CAL ${plan} รายการ`);
    reload();
  } catch (e) { fail(e); }
}

/* ---------- documents ---------- */
function docForm() {
  modal(`<h2>เพิ่มเอกสาร</h2><form id="fDoc" class="form">
    <div class="field full"><label for="dTitle">ชื่อเอกสาร *</label><input id="dTitle" class="inp" required></div>
    <div class="field"><label for="dKind">ประเภท</label><select id="dKind" class="inp">${opts(OPT.docKind)}</select></div>
    <div class="field"><label for="dMachine">เครื่องจักร</label><select id="dMachine" class="inp"><option value="">— ไม่ระบุ —</option>${D.machines.map(m => `<option value="${esc(m.machine_no)}">${esc(m.machine_no)} · ${esc(m.machine_name)}</option>`).join('')}</select></div>
    <div class="field full"><label for="dTags">คำค้น (คั่นด้วยช่องว่าง)</label><input id="dTags" class="inp"></div>
    <div class="field"><label for="dFile">ไฟล์</label><input id="dFile" type="file" class="inp"></div>
    <div class="field"><label for="dUrl">หรือ ลิงก์ (SharePoint / OneDrive)</label><input id="dUrl" class="inp" type="url" placeholder="https://"></div>
    <div class="field full"><label><input type="checkbox" id="dLock"> จำกัดสิทธิ์</label></div>
    <div class="full btns"><button class="btn" type="submit" id="dSave">บันทึก</button><button class="btn ghost" type="button" data-close>ยกเลิก</button></div></form>`);
  $('#fDoc').onsubmit = async e => {
    e.preventDefault();
    const f = $('#dFile').files[0], url = $('#dUrl').value.trim(), lock = $('#dLock').checked;
    if (!f && !url) return toast('แนบไฟล์หรือใส่ลิงก์');
    $('#dSave').disabled = true;
    let file_path = null;
    if (f) {
      file_path = (lock ? 'restricted/' : 'public/') + Date.now() + '-' + f.name.replace(/[^\w.\-]+/g, '_');
      const { error } = await sb.storage.from('documents').upload(file_path, f);
      if (error) { $('#dSave').disabled = false; return fail(error); }
    }
    const { error } = await sb.from('documents').insert({ title: $('#dTitle').value.trim(), kind: $('#dKind').value, machine_no: $('#dMachine').value || null, tags: $('#dTags').value.trim(), restricted: lock, file_path, url: url || null, uploaded_by: S.me.email });
    if (error) { $('#dSave').disabled = false; return fail(error); }
    closeModal(); toast('เพิ่มเอกสารแล้ว'); reload();
  };
}
async function openDoc(id) {
  const d = D.docs.find(x => x.id == id); if (!d) return;
  if (d.url) return window.open(d.url, '_blank', 'noopener');
  const { data, error } = await sb.storage.from('documents').createSignedUrl(d.file_path, 600);
  if (error) return fail(error);
  window.open(data.signedUrl, '_blank', 'noopener');
}
async function delDoc(id, btn) {
  if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'ยืนยันลบ?'; return; }
  const d = D.docs.find(x => x.id == id);
  if (d?.file_path) await sb.storage.from('documents').remove([d.file_path]);
  const { error } = await sb.from('documents').delete().eq('id', id);
  if (error) return fail(error);
  toast('ลบแล้ว'); reload();
}

/* ---------- export ---------- */
function exportRequests() {
  const rows = D.requests.map(q => { const m = M(q.machine_no); return {
    'เลขที่ใบงาน': q.id, 'Machine number': q.machine_no, 'Machine Name': m.machine_name, 'Location': m.location, 'ประเภทงาน': jobType(q), 'สถานะ': SL[q.status] || q.status,
    'ผู้เปิดใบงาน': q.reporter, 'วันที่เปิด': fd(q.created_at), 'อาการที่พบ': q.symptom, 'วิธีแก้ไขเบื้องต้น': q.first_fix, 'ความเร่งด่วน': q.urgency,
    'อนุมัติโดย': q.approved_by, 'ผู้รับผิดชอบ': q.assignee, 'เลขที่ SAP/K2': q.external_ref, 'Vendor': q.vendor, 'ราคาใบเสนอราคา': q.quotation_amount != null ? Number(q.quotation_amount) : null,
    'เลขที่ MEMO': q.memo_no, 'ผู้อนุมัติ MEMO': (q.memo_approvers || []).join(' → '), 'เลขที่ PO': q.po_no, 'วันนัด Vendor': q.vendor_date, 'ครบกำหนด PM/CAL': q.due_date,
    'วิธีการแก้ไข': q.fix_detail, 'สาเหตุ': q.root_cause, 'อะไหล่ที่ใช้': q.parts_used, 'ค่าใช้จ่าย(บาท)': q.cost_thb != null ? Number(q.cost_thb) : null,
    'เริ่ม': fd(q.start_at), 'เสร็จ': fd(q.end_at), 'Downtime (นาที)': q.downtime_min, 'ปิดงานโดย': q.closed_by }; });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Maintenance Requests');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(D.machines), 'Machine Master');
  XLSX.writeFile(wb, 'CAPD-Maintenance-' + todayStr() + '.xlsx');
}

/* ---------- modal ---------- */
function modal(html) { closeModal(); const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.id = 'modal'; bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`; bg.onclick = e => { if (e.target === bg || e.target.hasAttribute('data-close')) closeModal(); }; document.body.appendChild(bg); }
function closeModal() { $('#modal')?.remove(); }

/* ---------- bind ---------- */
function bind() {
  $$('[data-nav]').forEach(b => b.onclick = e => { e.preventDefault(); S.view = b.dataset.nav; S.photos = []; render(); window.scrollTo(0, 0); });
  $$('[data-open]').forEach(r => r.onclick = e => { e.preventDefault(); openDetail(r.dataset.open); });
  $$('[data-filter]').forEach(b => b.onclick = () => { S.filter = b.dataset.filter; render(); });
  $$('[data-kind]').forEach(b => b.onclick = () => { S.docKind = b.dataset.kind; render(); });
  $$('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act));
  $$('[data-doc]').forEach(b => b.onclick = () => openDoc(b.dataset.doc));
  $$('[data-docdel]').forEach(b => b.onclick = () => delDoc(b.dataset.docdel, b));
  $$('[data-scan]').forEach(a => a.onclick = e => { e.preventDefault(); openScan(a.dataset.scan); });
  $$('[data-newfor]').forEach(b => b.onclick = () => { S.prefill = b.dataset.newfor; S.view = 'new'; render(); window.scrollTo(0, 0); });
  $$('[data-qr]').forEach(b => b.onclick = () => printQR([M(b.dataset.qr)]));
  $('#qrAll') && ($('#qrAll').onclick = () => printQR(D.machines.filter(m => m.status !== 'Inactive')));
  $$('[data-medit]').forEach(b => b.onclick = () => machineForm(b.dataset.medit));
  $$('[data-done]').forEach(b => b.onclick = async () => {
    const [no, kind] = b.dataset.done.split('|');
    const { error } = await sb.from('machines').update({ [kind === 'PM' ? 'pm_last_date' : 'cal_last_date']: todayStr() }).eq('machine_no', no);
    if (error) return fail(error); toast(`บันทึก ${kind} ${no} แล้ว`); reload();
  });
  $$('[data-psave]').forEach(b => b.onclick = async () => {
    const i = b.dataset.psave, p = D.profiles[i], newRole = $('#pr' + i).value;
    if (p.role === 'admin' && newRole !== 'admin' && D.profiles.filter(x => x.role === 'admin').length <= 1) return toast('ต้องมี Admin อย่างน้อย 1 คน');
    const { error } = await sb.from('role_presets').update({ full_name: $('#pn' + i).value.trim() || null, role: newRole, memo_approver: $('#pm' + i).checked }).eq('email', p.email);
    if (error) return fail(error); toast('บันทึกแล้ว'); reload();
  });
  $$('[data-pdel]').forEach(b => b.onclick = async () => {
    const em = b.dataset.pdel, target = D.profiles.find(x => x.email === em);
    if (em === S.me.email) return toast('ลบบัญชีของตัวเองไม่ได้');
    if (target?.role === 'admin' && D.profiles.filter(x => x.role === 'admin').length <= 1) return toast('ต้องมี Admin อย่างน้อย 1 คน');
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'ยืนยันลบ?'; return; }
    const { error } = await sb.from('role_presets').delete().eq('email', em);
    if (error) return fail(error); toast('ลบ ' + em + ' แล้ว'); reload();
  });
  const fp = $('#fPreset');
  if (fp) fp.onsubmit = async e => {
    e.preventDefault(); const em = $('#psEmail').value.trim().toLowerCase();
    if (!domainOk(em)) return toast('ใช้ได้เฉพาะอีเมล @' + C.ALLOWED_DOMAIN);
    const { error } = await sb.from('role_presets').upsert({ email: em, full_name: $('#psName').value.trim() || null, role: $('#psRole').value, memo_approver: $('#psMemo').checked });
    if (error) return fail(error); toast('เพิ่มผู้ใช้แล้ว'); reload();
  };
  $('#logout').onclick = () => { logoutLocal(); S.view = 'home'; renderLogin(); };
  $('#refresh').onclick = () => { reload(); toast('รีเฟรชข้อมูลแล้ว'); };
  const live = (id, key) => { const el = $('#' + id); if (el) el.oninput = () => { S[key] = el.value; const pos = el.selectionStart; render(); const n = $('#' + id); n.focus(); n.setSelectionRange(pos, pos); }; };
  live('q', 'q'); live('dq', 'docQ'); live('mq', 'mq');
  $$('#expReq').forEach(b => b.onclick = exportRequests);
  $('#mAdd') && ($('#mAdd').onclick = () => machineForm(null));
  $('#mImport') && ($('#mImport').onchange = e => { const f = e.target.files[0]; if (f) importExcel(f); e.target.value = ''; });
  $('#dAdd') && ($('#dAdd').onclick = docForm);
  $$('input[name=rtMode]').forEach(r => r.onchange = () => { const self = document.querySelector('input[name=rtMode]:checked').value === 'self'; $('#rtSelf').hidden = !self; $('#rtResubmit').hidden = self; });

  const ms = $('#nMachine');
  if (ms) {
    ms.onchange = () => { const m = M(ms.value); $('#mInfo').innerHTML = ms.value ? `<div class="mcard"><div><span>Model</span>${esc(m.model || '-')}</div><div><span>Serial</span>${esc(m.serial_number || '-')}</div><div><span>Location</span>${esc(m.location || '-')}</div><div><span>Priority</span>${esc(m.priority)}</div><div><span>Member ผู้รับผิดชอบ</span>${esc(nm(m.responsibility))}</div><div><span>Supplier</span>${esc(m.supplier || '-')}</div></div>` : ''; };
    if (S.prefill) { ms.onchange(); S.prefill = null; }
    $$('input[name=nMode]').forEach(r => r.onchange = () => { const self = document.querySelector('input[name=nMode]:checked').value === 'self'; $('#selfBox').hidden = !self; $('#bSubmit').textContent = self ? 'บันทึกและปิดงาน' : 'ส่งให้ Foreman Day อนุมัติ'; });
    $('#bSubmit').textContent = 'ส่งให้ Foreman Day อนุมัติ';
    $('#fNew').onsubmit = async e => {
      e.preventDefault();
      const sym = $('#nSym').value.trim(); if (!ms.value || !sym) return toast('เลือกเครื่องและกรอกอาการที่พบ');
      const self = document.querySelector('input[name=nMode]:checked').value === 'self';
      let closed = null; if (self) { closed = readClose('sf'); if (!closed) return; }
      $('#bSubmit').disabled = true;
      try {
        const folder = crypto.randomUUID();
        const attachments = [...await uploadFiles(folder, 'photo', filesOf('nPhoto')), ...(self ? await uploadFiles(folder, 'close', filesOf('sfFiles')) : [])];
        const row = { machine_no: ms.value, reporter: S.me.email, symptom: sym, first_fix: $('#nFirst').value.trim() || null, urgency: document.querySelector('input[name=nUrg]:checked').value, attachments };
        Object.assign(row, self ? { ...closed, job_type: 'self_fix' } : { status: 'pending_fd' });
        const { data, error } = await sb.from('requests').insert(row).select().single();
        if (error) throw error;
        await addLog(data.id, self ? 'เปิดใบงานและแก้ไขเอง · ปิดงาน · ' + closed.fix_detail : 'เปิดใบงานแจ้งซ่อม ส่ง Foreman Day อนุมัติ');
        toast(data.id + (self ? ' บันทึกและปิดงานแล้ว' : ' ส่งแล้ว รอ Foreman Day อนุมัติ'));
        await loadAll(); openDetail(data.id);
      } catch (err) { $('#bSubmit').disabled = false; fail(err); }
    };
  }
}

/* =================== BOOT =================== */
let channel = null;
function subscribe() {
  if (!channel) channel = sb.channel('requests').on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, () => {
    loadAll().then(() => { if (!$('#modal') && !document.activeElement?.matches('input,textarea,select') && S.view !== 'detail') render(); });
  }).subscribe();
}
async function boot() {
  if (C.SUPABASE_URL.includes('YOUR-PROJECT')) { $('#app').innerHTML = '<div class="login"><div class="login-card"><h1>ยังไม่ได้ตั้งค่า Supabase</h1><p>แก้ไขไฟล์ js/config.js ตามคู่มือใน README.md</p></div></div>'; return; }
  try { await loadAll(); } catch (e) { $('#app').innerHTML = `<div class="login"><div class="login-card"><h1>เชื่อมต่อฐานข้อมูลไม่ได้</h1><div class="err">${esc(e.message || e)}</div><p class="sub">ตรวจว่ารัน schema.sql, trial_open_access.sql และ v2_workflow.sql ใน Supabase แล้ว</p></div></div>`; return; }
  let saved = null; try { saved = localStorage.getItem(USER_KEY); } catch (e) {}
  const u = D.profiles.find(x => x.email === saved);
  if (u) { S.me = u; afterLogin(); } else renderLogin();
}
boot();
})();

/* CAPD Maintenance — frontend (vanilla JS + Supabase) */
(() => {
'use strict';
const C = window.APP_CONFIG;
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
const ROLES = { reporter: 'ผู้แจ้ง', tech: 'ช่าง', approver: 'หัวหน้างาน / ผู้อนุมัติ', admin: 'Admin' };
const STATUS = ['pending_approval', 'queued', 'in_progress', 'waiting_parts', 'testing', 'waiting_confirm', 'closed'];
const SL = { pending_approval: 'รออนุมัติ', queued: 'รอรับงาน', in_progress: 'กำลังซ่อม', waiting_parts: 'รออะไหล่', testing: 'ทดสอบ', waiting_confirm: 'รอผู้แจ้งยืนยัน', closed: 'ปิดงาน', rejected: 'ไม่อนุมัติ' };
const SCLS = { pending_approval: 's-wait', queued: 's-queue', in_progress: 's-work', waiting_parts: 's-parts', testing: 's-test', waiting_confirm: 's-confirm', closed: 's-done', rejected: 's-rej' };
const OPEN = s => s !== 'closed' && s !== 'rejected';

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
  out: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 4h6v16h-6M3 12h12M10 7l-5 5 5 5"/></svg>'
};

/* ---------- state ---------- */
const S = { session: null, me: null, view: 'home', sel: null, filter: 'all', q: '', mq: '', docQ: '', docKind: 'all', photos: [], logs: [], photoUrls: [] };
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
const M = no => D.machines.find(m => m.machine_no === no) || {};
const nm = e => { if (!e) return '-'; const p = D.profiles.find(x => x.email === e); return p?.full_name || e.split('@')[0]; };
const pill = s => `<span class="pill ${SCLS[s] || ''}">${esc(SL[s] || s)}</span>`;
const role = () => S.me?.role || 'reporter';
const isAdmin = () => role() === 'admin';
function toast(t) { $$('.toast').forEach(x => x.remove()); const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2800); }
function fail(e) { console.error(e); toast('ผิดพลาด: ' + (e?.message || e)); }
const domainOk = e => new RegExp('^[^@\\s]+@' + C.ALLOWED_DOMAIN.replace('.', '\\.') + '$', 'i').test(e);

/* ---------- data ---------- */
async function loadAll() {
  const [m, r, p, d] = await Promise.all([
    sb.from('machines').select('*').order('machine_no'),
    sb.from('requests').select('*').order('created_at', { ascending: false }),
    sb.from('profiles').select('*').order('email'),
    sb.from('documents').select('*').order('created_at', { ascending: false })
  ]);
  for (const x of [m, r, p, d]) if (x.error) throw x.error;
  D.machines = m.data; D.requests = r.data; D.profiles = p.data; D.docs = d.data;
}
async function reload() { try { await loadAll(); render(); } catch (e) { fail(e); } }

function myTasks() {
  const u = S.me.email, r = role();
  return D.requests.filter(q => {
    if (r === 'approver') return q.status === 'pending_approval' || (q.reporter === u && q.status === 'waiting_confirm');
    if (r === 'tech') return (q.technician === u && ['queued', 'in_progress', 'waiting_parts', 'testing'].includes(q.status)) || (q.reporter === u && q.status === 'waiting_confirm');
    if (r === 'admin') return OPEN(q.status);
    return q.reporter === u && OPEN(q.status);
  });
}
function planList() {
  const out = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const m of D.machines) {
    if (m.status === 'Inactive') continue;
    for (const [kind, last, iv] of [['PM', m.pm_last_date, m.pm_interval_month], ['CAL', m.cal_last_date, m.cal_interval_month]]) {
      if (!last || !iv) continue;
      const n = new Date(last); n.setMonth(n.getMonth() + Number(iv));
      out.push({ m, kind, last, iv, next: n.toISOString().slice(0, 10), days: Math.round((n - today) / 864e5) });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}

/* =================== LOGIN =================== */
function renderLogin(step = 'email', email = '') {
  $('#app').innerHTML = `<div class="login"><div class="login-card">
    <div class="brand" style="color:var(--link)">${LOGO}<div>${esc(C.APP_NAME)}<small style="color:var(--muted)">${esc(C.ORG)}</small></div></div>
    <h1>เข้าสู่ระบบด้วยอีเมลบริษัท</h1>
    ${step === 'email' ? `
      <p class="sub" style="margin:0">ระบบจะส่งลิงก์/รหัสเข้าสู่ระบบไปที่อีเมล @${esc(C.ALLOWED_DOMAIN)} ของคุณ</p>
      <form id="fEmail" style="display:flex;flex-direction:column;gap:12px">
        <div class="field"><label for="em">อีเมล</label><input id="em" class="inp" type="email" autocomplete="email" placeholder="name@${esc(C.ALLOWED_DOMAIN)}" required value="${esc(email)}"></div>
        <button class="btn" id="bSend" type="submit">ส่งอีเมลเข้าสู่ระบบ</button>
      </form>
      ${C.ENABLE_MICROSOFT_LOGIN ? `<button class="ms" id="msLogin"><svg width="18" height="18" viewBox="0 0 21 21"><rect width="10" height="10" fill="#f25022"/><rect x="11" width="10" height="10" fill="#7fba00"/><rect y="11" width="10" height="10" fill="#00a4ef"/><rect x="11" y="11" width="10" height="10" fill="#ffb900"/></svg>Sign in with Microsoft</button>` : ''}
    ` : `
      <p class="sub" style="margin:0">ส่งอีเมลไปที่ <b>${esc(email)}</b> แล้ว ตรวจกล่องจดหมาย (และ Junk) จากนั้น<br>• กดลิงก์ <b>Sign in</b> ในอีเมล (เปิดในเบราว์เซอร์เดียวกับหน้านี้) หรือ<br>• กรอกรหัสจากอีเมลด้านล่าง</p>
      <form id="fCode" style="display:flex;flex-direction:column;gap:12px">
        <div class="field"><label for="code">รหัสจากอีเมล (ถ้ามี)</label><input id="code" class="inp mono" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required style="font-size:20px;letter-spacing:.3em"></div>
        <button class="btn" id="bVerify" type="submit">เข้าสู่ระบบ</button>
        <button class="btn ghost" type="button" id="bBack">เปลี่ยนอีเมล / ส่งใหม่</button>
      </form>`}
  </div></div>`;
  if (step === 'email') {
    $('#fEmail').onsubmit = async e => {
      e.preventDefault();
      const em = $('#em').value.trim().toLowerCase();
      if (!domainOk(em)) return toast('ใช้ได้เฉพาะอีเมล @' + C.ALLOWED_DOMAIN);
      $('#bSend').disabled = true;
      const { error } = await sb.auth.signInWithOtp({ email: em, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
      if (error) { $('#bSend').disabled = false; return fail(error); }
      renderLogin('code', em);
    };
    const ms = $('#msLogin');
    if (ms) ms.onclick = () => sb.auth.signInWithOAuth({ provider: 'azure', options: { scopes: 'email', redirectTo: location.origin + location.pathname } });
  } else {
    $('#bBack').onclick = () => renderLogin('email', email);
    $('#fCode').onsubmit = async e => {
      e.preventDefault();
      $('#bVerify').disabled = true;
      const { error } = await sb.auth.verifyOtp({ email, token: $('#code').value.trim(), type: 'email' });
      if (error) { $('#bVerify').disabled = false; return fail(error); }
    };
  }
}

/* =================== SHELL =================== */
function render() {
  if (!S.session) return renderLogin();
  if (!S.me) { $('#app').innerHTML = '<div class="loading">กำลังโหลดข้อมูล…</div>'; return; }
  const pend = myTasks().length;
  const appr = D.requests.filter(q => q.status === 'pending_approval').length;
  const nav = [['home', 'หน้าหลัก', pend], ['new', 'แจ้งซ่อม'], ['list', 'งานซ่อม'], ['approve', 'อนุมัติ', ['approver', 'admin'].includes(role()) ? appr : 0], ['machine', 'เครื่องจักร'], ['cal', 'PM / CAL'], ['docs', 'คลังเอกสาร'], ['report', 'รายงาน']];
  if (isAdmin()) nav.push(['admin', 'ผู้ใช้']);
  const crumbs = { home: 'My Tasks', new: 'แจ้งซ่อมใหม่', list: 'งานซ่อมทั้งหมด', approve: 'รออนุมัติ', machine: 'Machine Master', cal: 'แผน PM / Calibration', docs: 'คลังเอกสาร', report: 'รายงาน', admin: 'ผู้ใช้และสิทธิ์', detail: 'รายละเอียดใบแจ้งซ่อม' };
  $('#app').innerHTML = `
  <header class="top"><div class="top-in">
    <div class="brand">${LOGO}<div>${esc(C.APP_NAME)}<small>${esc(C.ORG)}</small></div></div>
    <div class="sp"></div>
    <div class="who"><span class="nm">${esc(S.me.full_name || S.me.email)} · ${ROLES[role()]}</span></div>
    <button class="iconbtn" id="logout" title="ออกจากระบบ" aria-label="ออกจากระบบ">${IC.out}</button>
  </div></header>
  <div class="wrap">
    <div class="crumb"><span>${esc(C.APP_NAME)}</span><span class="sep">|</span><span class="cur">${crumbs[S.view]}</span></div>
    <div class="shell">
      <nav class="rail">${nav.map(([k, l, b]) => `<button data-nav="${k}" class="${(S.view === k || (S.view === 'detail' && k === 'list')) ? 'on' : ''}" title="${l}">${IC[k]}${b ? `<span class="badge">${b}</span>` : ''}<span>${l}</span></button>`).join('')}</nav>
      <main class="main" id="main">${VIEWS[S.view]()}</main>
    </div>
  </div>`;
  bind();
}

function taskTable(rows, empty = 'ไม่มีรายการ') {
  if (!rows.length) return `<div class="empty">${empty}</div>`;
  return `<div class="tbl-wrap"><table><thead><tr><th>#</th><th>Folio</th><th>สถานะ</th><th>ความเร่งด่วน</th><th>ช่าง</th><th>วันที่แจ้ง</th></tr></thead><tbody>
  ${rows.map((q, i) => { const m = M(q.machine_no); return `<tr class="click" data-open="${esc(q.id)}"><td class="num">${i + 1}</td><td><span class="folio">${esc(q.id)}, ${esc(q.machine_no)} ${esc(m.machine_name)}</span><br><span class="sub">${esc(q.symptom)}</span></td><td>${pill(q.status)}</td><td class="u-${esc(q.urgency)}">${esc(q.urgency)}</td><td>${esc(nm(q.technician))}</td><td class="num">${fd(q.created_at)}</td></tr>`; }).join('')}
  </tbody></table></div>`;
}
const opts = (arr, sel) => arr.map(v => `<option ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(v)}</option>`).join('');

/* =================== VIEWS =================== */
const VIEWS = {
  home() {
    const t = myTasks();
    const open = D.requests.filter(q => OPEN(q.status));
    const plan = planList(); const due = plan.filter(p => p.days <= 30);
    const closed = D.requests.filter(q => q.status === 'closed');
    const dt = closed.reduce((a, q) => a + (q.downtime_min || 0), 0);
    return `<div class="h-row"><h1>My Tasks</h1><span class="sub">${ROLES[role()]}</span></div>
    <div class="tiles">
      <div class="tile"><b>${open.length}</b><span>งานซ่อมค้าง</span></div>
      <div class="tile ${open.some(q => q.urgency === 'Critical') ? 'alert' : ''}"><b>${open.filter(q => q.urgency === 'Critical').length}</b><span>Critical ที่ยังเปิด</span></div>
      <div class="tile ${due.some(p => p.days < 0) ? 'alert' : ''}"><b>${due.length}</b><span>PM/CAL ครบกำหนดใน 30 วัน</span></div>
      <div class="tile"><b>${(dt / 60).toFixed(1)}</b><span>ชม. Downtime (งานที่ปิดแล้ว)</span></div>
    </div>
    <div class="fbar"><b style="color:var(--link)">งานของฉัน (${t.length})</b><div class="sp"></div><button class="btn" data-nav="new">+ แจ้งซ่อม</button></div>
    ${taskTable(t, 'ไม่มีงานค้าง')}`;
  },

  list() {
    let rows = D.requests.slice();
    if (S.filter !== 'all') rows = rows.filter(q => q.status === S.filter);
    if (S.q) { const k = S.q.toLowerCase(); rows = rows.filter(q => [q.id, q.machine_no, M(q.machine_no).machine_name, q.symptom, q.reporter, q.technician].join(' ').toLowerCase().includes(k)); }
    const chips = [['all', 'ทั้งหมด'], ...[...STATUS, 'rejected'].map(s => [s, SL[s]])];
    return `<div class="h-row"><h1>งานซ่อมทั้งหมด</h1><span class="sub">${rows.length} รายการ</span><button class="btn ghost" id="expReq">Export Excel</button></div>
    <div class="fbar">${chips.map(([k, l]) => `<button class="chip ${S.filter === k ? 'on' : ''}" data-filter="${k}">${l} <span class="sub">${k === 'all' ? D.requests.length : D.requests.filter(q => q.status === k).length}</span></button>`).join('')}
    <div class="sp"></div><label class="sr" for="q">ค้นหา</label><input id="q" class="search" placeholder="ค้นหา เลขที่ / เครื่อง / อาการ" value="${esc(S.q)}"></div>
    ${taskTable(rows)}`;
  },

  approve() {
    const rows = D.requests.filter(q => q.status === 'pending_approval');
    const can = ['approver', 'admin'].includes(role());
    return `<div class="h-row"><h1>รออนุมัติ</h1><span class="sub">${rows.length} รายการ</span></div>
    ${can ? '' : '<div class="note" style="margin-bottom:12px">ดูได้อย่างเดียว เฉพาะหัวหน้างาน / ผู้อนุมัติ และ Admin ที่อนุมัติได้</div>'}
    ${taskTable(rows, 'ไม่มีใบแจ้งซ่อมที่รออนุมัติ')}`;
  },

  new() {
    const ms = D.machines.filter(m => m.status !== 'Inactive');
    if (!ms.length) return `<div class="h-row"><h1>แจ้งซ่อมใหม่</h1></div><div class="empty">ยังไม่มีเครื่องจักรในระบบ ${isAdmin() ? '— ไปที่เมนู “เครื่องจักร” เพื่อเพิ่ม หรือนำเข้าจาก Excel' : '— แจ้ง Admin ให้เพิ่มทะเบียนเครื่องจักร'}</div>`;
    return `<div class="h-row"><h1>แจ้งซ่อมใหม่</h1><span class="sub">ผู้แจ้ง: ${esc(S.me.email)}</span></div>
    <form id="fNew" class="form">
      <div class="field full"><label for="nMachine">เครื่องจักร *</label>
        <select id="nMachine" class="inp" required><option value="">— เลือกจากทะเบียนเครื่องจักร —</option>${ms.map(m => `<option value="${esc(m.machine_no)}">${esc(m.machine_no)} · ${esc(m.machine_name)} (${esc(m.location || '-')})</option>`).join('')}</select></div>
      <div class="full" id="mInfo"></div>
      <div class="field full"><label for="nSym">อาการเสีย / รายละเอียด *</label><textarea id="nSym" class="inp" rows="3" required placeholder="เช่น อุณหภูมิ Zone 5 ขึ้นไม่ถึง Set point"></textarea></div>
      <div class="field"><span style="font-weight:600;font-size:13.5px">ความเร่งด่วน *</span><div class="urg">${OPT.prio.map((p, i) => `<label class="u-${p}" for="nUrg${i}"><input type="radio" name="nUrg" id="nUrg${i}" value="${p}" ${p === 'High' ? 'checked' : ''}>${p}</label>`).join('')}</div>
        <span class="hint">Critical = เครื่องหยุดผลิต / กระทบลูกค้า</span></div>
      <div class="field"><label for="nPhoto">รูปภาพ (สูงสุด 4 รูป)</label><input id="nPhoto" type="file" accept="image/*" multiple class="inp"><div class="thumbs" id="thumbs"></div></div>
      <div class="full btns"><button class="btn" type="submit" id="bSubmit">ส่งใบแจ้งซ่อม</button><button class="btn ghost" type="button" data-nav="home">ยกเลิก</button></div>
    </form>`;
  },

  detail() {
    const q = D.requests.find(x => x.id === S.sel); if (!q) return '<div class="empty">ไม่พบรายการ</div>';
    const m = M(q.machine_no); const idx = STATUS.indexOf(q.status);
    return `<div class="h-row"><h1>${esc(q.id)}</h1>${pill(q.status)}<button class="btn ghost" data-nav="list">← กลับ</button></div>
    ${q.status === 'rejected' ? '' : `<div class="steps">${STATUS.map((s, i) => `<span class="${i < idx ? 'done' : i === idx ? 'now' : ''}">${SL[s]}</span>`).join('')}</div>`}
    <div class="detail">
      <div style="display:flex;flex-direction:column;gap:16px;min-width:0">
        <div class="box"><h3>ข้อมูลการแจ้ง</h3><dl class="kv">
          <dt>เครื่องจักร</dt><dd><b>${esc(m.machine_no)}</b> · ${esc(m.machine_name)}</dd>
          <dt>Model / Serial</dt><dd>${esc(m.model || '-')} / <span class="mono">${esc(m.serial_number || '-')}</span></dd>
          <dt>Location</dt><dd>${esc(m.location || '-')}</dd>
          <dt>ผู้แจ้ง</dt><dd>${esc(q.reporter)}</dd>
          <dt>วันที่แจ้ง</dt><dd>${fd(q.created_at)}</dd>
          <dt>อาการเสีย</dt><dd>${esc(q.symptom)}</dd>
          <dt>ความเร่งด่วน</dt><dd class="u-${esc(q.urgency)}">${esc(q.urgency)}</dd>
          <dt>ช่างผู้รับผิดชอบ</dt><dd>${esc(q.technician || '-')}</dd>
          <dt>ผู้อนุมัติ</dt><dd>${esc(q.approved_by || '-')}</dd>
        </dl><div class="thumbs" id="photoBox" style="margin-top:10px">${S.photoUrls.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="รูปประกอบ"></a>`).join('')}</div></div>
        ${q.end_at ? `<div class="box"><h3>ผลการซ่อม</h3><dl class="kv">
          <dt>เริ่มซ่อม</dt><dd>${fd(q.start_at)}</dd><dt>ซ่อมเสร็จ</dt><dd>${fd(q.end_at)}</dd>
          <dt>สาเหตุ</dt><dd>${esc(q.root_cause)}</dd><dt>การแก้ไข</dt><dd>${esc(q.fix_detail)}</dd>
          <dt>อะไหล่ที่ใช้</dt><dd>${esc(q.parts_used || '-')}</dd><dt>Downtime</dt><dd>${q.downtime_min ?? '-'} นาที</dd>
          <dt>ค่าใช้จ่าย</dt><dd>${Number(q.cost_thb || 0).toLocaleString()} บาท</dd>
          <dt>ผู้ตรวจรับ</dt><dd>${esc(q.inspector || '-')}</dd><dt>ผลตรวจรับ</dt><dd>${esc(q.inspect_result || 'รอผู้แจ้งยืนยัน')}</dd></dl></div>` : ''}
        ${actions(q)}
      </div>
      <div class="box"><h3>ประวัติการดำเนินการ</h3><ul class="timeline">${S.logs.map(l => `<li><div>${esc(l.action)}<small>${esc(nm(l.actor))} · ${fd(l.at)}</small></div></li>`).join('') || '<li><div class="sub">—</div></li>'}</ul></div>
    </div>`;
  },

  machine() {
    let rows = D.machines;
    if (S.mq) { const k = S.mq.toLowerCase(); rows = rows.filter(m => Object.values(m).join(' ').toLowerCase().includes(k)); }
    return `<div class="h-row"><h1>Machine Master</h1><span class="sub">${D.machines.length} เครื่อง</span>
      ${isAdmin() ? `<button class="btn" id="mAdd">+ เพิ่มเครื่อง</button><label class="btn ghost" for="mImport" style="cursor:pointer">นำเข้าจาก Excel</label><input id="mImport" type="file" accept=".xlsx,.xls" hidden>` : ''}</div>
    <div class="fbar"><span class="sub">${isAdmin() ? 'นำเข้าไฟล์ DATA.xlsx ได้โดยตรง (ชีท Machine Master, PM Master, CAL Master)' : 'แก้ไขได้เฉพาะ Admin'}</span><div class="sp"></div><label class="sr" for="mq">ค้นหาเครื่อง</label><input id="mq" class="search" placeholder="ค้นหาเครื่อง / Location" value="${esc(S.mq)}"></div>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Machine no.</th><th>Machine Name</th><th>Model</th><th>Serial</th><th>Type</th><th>Location</th><th>Status</th><th>Priority</th><th>Maint. Type</th><th>Responsibility</th><th>Supplier</th><th>Contact</th>${isAdmin() ? '<th></th>' : ''}</tr></thead><tbody>
    ${rows.map(m => `<tr><td class="mono">${esc(m.machine_no)}</td><td>${esc(m.machine_name)}</td><td>${esc(m.model)}</td><td class="mono">${esc(m.serial_number)}</td><td>${esc(m.machine_type)}</td><td>${esc(m.location)}</td><td><span class="pill ${m.status === 'Active' ? 's-confirm' : m.status === 'Maintenance' ? 's-wait' : 's-done'}">${esc(m.status)}</span></td><td class="u-${esc(m.priority)}">${esc(m.priority)}</td><td>${esc(m.maintenance_type)}</td><td>${esc(nm(m.responsibility))}</td><td>${esc(m.supplier)}</td><td>${esc(m.contact_person)}<br><span class="sub">${esc(m.phone)}</span></td>${isAdmin() ? `<td><button class="btn ghost sm" data-medit="${esc(m.machine_no)}">แก้ไข</button></td>` : ''}</tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">ยังไม่มีข้อมูลเครื่องจักร</div>'}`;
  },

  cal() {
    const p = planList();
    const st = d => d < 0 ? `<span class="pill s-rej">เกินกำหนด ${-d} วัน</span>` : d <= 30 ? `<span class="pill s-wait">อีก ${d} วัน</span>` : `<span class="pill s-confirm">อีก ${d} วัน</span>`;
    return `<div class="h-row"><h1>แผน PM / Calibration</h1><span class="sub">ครั้งถัดไป = วันที่ล่าสุด + Interval (เดือน)</span></div>
    <div class="tiles">
      <div class="tile ${p.some(x => x.days < 0) ? 'alert' : ''}"><b>${p.filter(x => x.days < 0).length}</b><span>เกินกำหนด</span></div>
      <div class="tile"><b>${p.filter(x => x.days >= 0 && x.days <= 30).length}</b><span>ครบใน 30 วัน</span></div>
      <div class="tile"><b>${p.length}</b><span>รายการในแผน</span></div>
    </div>
    ${p.length ? `<div class="tbl-wrap"><table><thead><tr><th>Machine</th><th>ประเภท</th><th>ครั้งล่าสุด</th><th>Interval</th><th>ครั้งถัดไป</th><th>สถานะ</th><th>ผู้รับผิดชอบ</th>${isAdmin() ? '<th></th>' : ''}</tr></thead><tbody>
    ${p.map(x => `<tr><td><b class="mono">${esc(x.m.machine_no)}</b> ${esc(x.m.machine_name)}<br><span class="sub">${esc(x.m.location)}</span></td><td>${x.kind}</td><td class="num">${fd(x.last)}</td><td class="num">${x.iv} เดือน</td><td class="num">${fd(x.next)}</td><td>${st(x.days)}</td><td>${esc(nm(x.m.responsibility))}</td>${isAdmin() ? `<td><button class="btn ghost sm" data-done="${esc(x.m.machine_no)}|${x.kind}">ทำแล้ววันนี้</button></td>` : ''}</tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">ยังไม่มีแผน PM/CAL — ใส่วันที่ล่าสุดและ Interval ในหน้าเครื่องจักร</div>'}`;
  },

  docs() {
    const kinds = ['all', ...new Set(D.docs.map(d => d.kind))];
    let rows = D.docs;
    if (S.docKind !== 'all') rows = rows.filter(d => d.kind === S.docKind);
    if (S.docQ) { const k = S.docQ.toLowerCase(); rows = rows.filter(d => [d.title, d.machine_no, d.tags, M(d.machine_no).machine_name].join(' ').toLowerCase().includes(k)); }
    const canWrite = ['admin', 'approver'].includes(role());
    const hist = S.docQ ? D.requests.filter(q => q.status === 'closed' && [q.machine_no, q.symptom, q.root_cause, q.fix_detail].join(' ').toLowerCase().includes(S.docQ.toLowerCase())) : [];
    return `<div class="h-row"><h1>คลังเอกสารและความรู้</h1><span class="sub">${D.docs.length} รายการ</span>${canWrite ? '<button class="btn" id="dAdd">+ เพิ่มเอกสาร</button>' : ''}</div>
    <div class="fbar">${kinds.map(k => `<button class="chip ${S.docKind === k ? 'on' : ''}" data-kind="${esc(k)}">${k === 'all' ? 'ทั้งหมด' : esc(k)}</button>`).join('')}<div class="sp"></div><label class="sr" for="dq">ค้นหาเอกสาร</label><input id="dq" class="search" placeholder="ค้นหา รหัสเครื่อง / อาการ" value="${esc(S.docQ)}"></div>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>เอกสาร</th><th>ประเภท</th><th>เครื่องจักร</th><th>อัปเดต</th><th></th></tr></thead><tbody>
    ${rows.map(d => `<tr><td><span class="folio">${esc(d.title)}</span> ${d.restricted ? '<span class="lock">จำกัดสิทธิ์</span>' : ''}<br><span class="sub">${esc(d.tags)}</span></td><td>${esc(d.kind)}</td><td class="mono">${esc(d.machine_no || '-')}</td><td class="num">${fd(d.created_at, false)}</td><td class="row-actions"><button class="btn ghost sm" data-doc="${d.id}">เปิด</button>${canWrite ? `<button class="btn ghost sm" data-docdel="${d.id}">ลบ</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">ไม่พบเอกสาร</div>'}
    ${hist.length ? `<h3 style="margin:18px 0 8px;font-size:16px">ประวัติการซ่อมที่เกี่ยวข้อง (${hist.length})</h3>${taskTable(hist)}` : ''}`;
  },

  report() {
    const c = D.requests.filter(q => q.end_at && q.start_at);
    const mttr = c.length ? c.reduce((a, q) => a + (new Date(q.end_at) - new Date(q.start_at)) / 36e5, 0) / c.length : 0;
    const dt = c.reduce((a, q) => a + (q.downtime_min || 0), 0), cost = c.reduce((a, q) => a + Number(q.cost_thb || 0), 0);
    const p = planList(); const onTime = p.length ? Math.round(p.filter(x => x.days >= 0).length / p.length * 100) : 0;
    const byM = {}; c.forEach(q => { byM[q.machine_no] = (byM[q.machine_no] || 0) + (q.downtime_min || 0); });
    const cnt = {}; D.requests.forEach(q => { cnt[q.machine_no] = (cnt[q.machine_no] || 0) + 1; });
    const bars = (o, unit) => { const e = Object.entries(o).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 8); if (!e.length) return '<div class="empty">ยังไม่มีข้อมูล</div>'; const mx = Math.max(...e.map(x => x[1])); return `<div class="bars">${e.map(([k, v]) => `<div class="bar"><span><b class="mono">${esc(k)}</b> <span class="sub">${esc(M(k).machine_name || '')}</span></span><div class="tr"><div class="fl" style="width:${v / mx * 100}%"></div></div><span class="v">${v.toLocaleString()} ${unit}</span></div>`).join('')}</div>`; };
    return `<div class="h-row"><h1>รายงาน</h1><span class="sub">ข้อมูลทั้งหมดในระบบ</span><button class="btn ghost" id="expReq">Export Excel</button></div>
    <div class="tiles">
      <div class="tile"><b>${D.requests.filter(q => OPEN(q.status)).length}</b><span>งานค้าง</span></div>
      <div class="tile"><b>${mttr.toFixed(1)}</b><span>MTTR (ชม./งาน)</span></div>
      <div class="tile"><b>${dt.toLocaleString()}</b><span>Downtime (นาที)</span></div>
      <div class="tile"><b>${cost.toLocaleString()}</b><span>ค่าซ่อม (บาท)</span></div>
      <div class="tile"><b>${onTime}%</b><span>PM/CAL ไม่เกินกำหนด</span></div>
    </div>
    <div class="grid2">
      <div class="box"><h3>Downtime ตามเครื่อง (นาที)</h3>${bars(byM, 'นาที')}</div>
      <div class="box"><h3>เครื่องที่แจ้งซ่อมบ่อย</h3>${bars(cnt, 'ครั้ง')}</div>
    </div>`;
  },

  admin() {
    return `<div class="h-row"><h1>ผู้ใช้และสิทธิ์</h1><span class="sub">${D.profiles.length} คน (สร้างอัตโนมัติเมื่อ Login ครั้งแรก)</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>อีเมล</th><th>ชื่อที่แสดง</th><th>บทบาท</th><th>ใช้งาน</th><th></th></tr></thead><tbody>
    ${D.profiles.map(p => `<tr><td>${esc(p.email)}</td><td><label class="sr" for="pn-${p.id}">ชื่อ</label><input id="pn-${p.id}" class="inp" value="${esc(p.full_name || '')}"></td>
      <td><label class="sr" for="pr-${p.id}">บทบาท</label><select id="pr-${p.id}" class="inp">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${p.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><label class="sr" for="pa-${p.id}">ใช้งาน</label><input id="pa-${p.id}" type="checkbox" ${p.active ? 'checked' : ''}></td>
      <td><button class="btn sm" data-psave="${p.id}">บันทึก</button></td></tr>`).join('')}
    </tbody></table></div>
    <h3 style="margin:22px 0 8px;font-size:16px">กำหนดบทบาทล่วงหน้า (ก่อนผู้ใช้ Login ครั้งแรก)</h3>
    <form id="fPreset" class="form" style="max-width:640px">
      <div class="field"><label for="psEmail">อีเมล</label><input id="psEmail" class="inp" type="email" required placeholder="name@${esc(C.ALLOWED_DOMAIN)}"></div>
      <div class="field"><label for="psRole">บทบาท</label><select id="psRole" class="inp">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="full"><button class="btn" type="submit">บันทึก</button></div>
    </form>`;
  }
};

/* ---------- workflow actions ---------- */
function actions(q) {
  const r = role(), u = S.me.email, box = (t, inner) => `<div class="box"><h3>${t}</h3>${inner}</div>`;
  const isTech = q.technician === u || r === 'admin';
  const techs = D.profiles.filter(p => p.active && ['tech', 'admin'].includes(p.role));
  if (q.status === 'pending_approval' && ['approver', 'admin'].includes(r))
    return box('อนุมัติใบแจ้งซ่อม', `<div class="form"><div class="field"><label for="aTech">มอบหมายช่าง</label><select id="aTech" class="inp">${techs.map(x => `<option value="${esc(x.email)}" ${x.email === q.technician ? 'selected' : ''}>${esc(x.full_name || x.email)} (${esc(x.email)})</option>`).join('')}${q.technician && !techs.some(x => x.email === q.technician) ? `<option selected>${esc(q.technician)}</option>` : ''}</select><span class="hint">ค่าเริ่มต้น = ผู้รับผิดชอบเครื่อง</span></div><div class="field"><label for="aNote">หมายเหตุ</label><input id="aNote" class="inp"></div></div><div class="btns" style="margin-top:12px"><button class="btn ok" data-act="approve">อนุมัติ</button><button class="btn bad" data-act="reject">ไม่อนุมัติ</button></div>`);
  if (q.status === 'queued' && isTech) return box('งานของช่าง', `<div class="btns"><button class="btn" data-act="accept">รับงาน / เริ่มซ่อม</button></div>`);
  if ((q.status === 'in_progress' || q.status === 'waiting_parts') && isTech)
    return box('อัปเดตงาน', `<div class="form"><div class="field full"><label for="pParts">อะไหล่ที่รอ / ใช้</label><input id="pParts" class="inp" value="${esc(q.parts_used || '')}"></div></div><div class="btns" style="margin-top:12px">${q.status === 'in_progress' ? '<button class="btn warn" data-act="parts">รออะไหล่</button>' : '<button class="btn" data-act="resume">อะไหล่มาแล้ว ซ่อมต่อ</button>'}<button class="btn" data-act="test">ซ่อมเสร็จ → ทดสอบ</button></div>`);
  if (q.status === 'testing' && isTech)
    return box('บันทึกผลซ่อม', `<div class="form">
      <div class="field"><label for="cCause">สาเหตุของปัญหา *</label><input id="cCause" class="inp" required></div>
      <div class="field"><label for="cFix">การแก้ไข / ผลการซ่อม *</label><input id="cFix" class="inp" required></div>
      <div class="field"><label for="cParts">อะไหล่ที่ใช้</label><input id="cParts" class="inp" value="${esc(q.parts_used || '')}"></div>
      <div class="field"><label for="cDown">Downtime (นาที)</label><input id="cDown" class="inp" type="number" min="0" value="0"></div>
      <div class="field"><label for="cCost">ค่าใช้จ่าย (บาท)</label><input id="cCost" class="inp" type="number" min="0" step="0.01" value="0"></div>
    </div><div class="btns" style="margin-top:12px"><button class="btn ok" data-act="finish">ส่งให้ผู้แจ้งยืนยัน</button><button class="btn ghost" data-act="resume">ทดสอบไม่ผ่าน กลับไปซ่อม</button></div>`);
  if (q.status === 'waiting_confirm' && (q.reporter === u || r === 'admin'))
    return box('ผู้แจ้งตรวจรับงาน', `<div class="btns"><button class="btn ok" data-act="close">ยืนยัน ผ่าน → ปิดงาน</button><button class="btn bad" data-act="reopen">ไม่ผ่าน ส่งกลับช่าง</button></div>`);
  if (OPEN(q.status)) return `<div class="note">ขั้นตอนถัดไปเป็นของ ${q.status === 'pending_approval' ? 'ผู้อนุมัติ' : q.status === 'waiting_confirm' ? 'ผู้แจ้ง (' + esc(q.reporter) + ')' : 'ช่างผู้รับผิดชอบ (' + esc(q.technician || '-') + ')'}</div>`;
  return '';
}

async function act(a) {
  const q = D.requests.find(x => x.id === S.sel); if (!q) return;
  const u = S.me.email, now = new Date().toISOString(), v = id => ($('#' + id) || {}).value?.trim() || '';
  let patch = {}, log = '', msg = '';
  switch (a) {
    case 'approve': patch = { status: 'queued', technician: v('aTech') || q.technician, approved_by: u, approved_at: now }; log = 'อนุมัติ · มอบหมาย ' + nm(patch.technician) + (v('aNote') ? ' · ' + v('aNote') : ''); msg = 'อนุมัติแล้ว'; break;
    case 'reject': patch = { status: 'rejected', approved_by: u, approved_at: now }; log = 'ไม่อนุมัติ' + (v('aNote') ? ' · ' + v('aNote') : ''); msg = 'บันทึกไม่อนุมัติแล้ว'; break;
    case 'accept': patch = { status: 'in_progress', start_at: now }; log = 'รับงาน / เริ่มซ่อม'; msg = 'เริ่มซ่อมแล้ว'; break;
    case 'parts': patch = { status: 'waiting_parts', parts_used: v('pParts') || q.parts_used }; log = 'รออะไหล่: ' + (patch.parts_used || '-'); msg = 'สถานะ: รออะไหล่'; break;
    case 'resume': patch = { status: 'in_progress' }; log = 'กลับมาซ่อมต่อ'; msg = 'สถานะ: กำลังซ่อม'; break;
    case 'test': patch = { status: 'testing', parts_used: v('pParts') || q.parts_used }; log = 'ซ่อมเสร็จ เข้าสู่การทดสอบ'; msg = 'สถานะ: ทดสอบ'; break;
    case 'finish':
      if (!v('cCause') || !v('cFix')) return toast('กรอกสาเหตุและการแก้ไขก่อนส่ง');
      patch = { status: 'waiting_confirm', root_cause: v('cCause'), fix_detail: v('cFix'), parts_used: v('cParts') || '-', downtime_min: parseInt(v('cDown')) || 0, cost_thb: parseFloat(v('cCost')) || 0, end_at: now };
      log = 'บันทึกผลซ่อม ส่งให้ผู้แจ้งยืนยัน'; msg = 'ส่งให้ผู้แจ้งยืนยันแล้ว'; break;
    case 'close': patch = { status: 'closed', inspector: u, inspect_result: 'ผ่าน' }; log = 'ตรวจรับ: ผ่าน → ปิดงาน'; msg = 'ปิดงานแล้ว'; break;
    case 'reopen': patch = { status: 'in_progress', inspector: u, inspect_result: 'ไม่ผ่าน' }; log = 'ตรวจรับไม่ผ่าน ส่งกลับช่าง'; msg = 'ส่งกลับช่างแล้ว'; break;
    default: return;
  }
  $$('[data-act]').forEach(b => b.disabled = true);
  const { error } = await sb.from('requests').update(patch).eq('id', q.id);
  if (error) { fail(error); $$('[data-act]').forEach(b => b.disabled = false); return; }
  await sb.from('request_logs').insert({ request_id: q.id, action: log });
  toast(msg);
  await reload(); await openDetail(q.id, false);
}

async function openDetail(id, scroll = true) {
  S.sel = id; S.view = 'detail'; S.logs = []; S.photoUrls = [];
  render(); if (scroll) window.scrollTo(0, 0);
  const q = D.requests.find(x => x.id === id); if (!q) return;
  const [{ data: logs }, signed] = await Promise.all([
    sb.from('request_logs').select('*').eq('request_id', id).order('at'),
    q.photos?.length ? sb.storage.from('request-photos').createSignedUrls(q.photos, 3600) : Promise.resolve({ data: [] })
  ]);
  if (S.sel !== id || S.view !== 'detail') return;
  S.logs = logs || []; S.photoUrls = (signed.data || []).map(x => x.signedUrl).filter(Boolean);
  render();
}

/* ---------- images ---------- */
function shrink(file) {
  return new Promise(res => {
    const r = new FileReader();
    r.onload = () => { const img = new Image(); img.onload = () => { const s = Math.min(1, 1280 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); c.toBlob(b => res(b ? { blob: b, url: URL.createObjectURL(b) } : null), 'image/jpeg', 0.8); }; img.onerror = () => res(null); img.src = r.result; };
    r.readAsDataURL(file);
  });
}

/* ---------- machines: form + import ---------- */
const MF = [
  ['machine_no', 'Machine number *', 'text'], ['machine_name', 'Machine Name *', 'text'], ['model', 'Model', 'text'], ['serial_number', 'Serial Number', 'text'],
  ['machine_type', 'Machine Type', OPT.type], ['location', 'Location', OPT.loc], ['status', 'Status', OPT.mstatus], ['priority', 'Priority', OPT.prio],
  ['maintenance_type', 'Maintenance Type', OPT.mtype], ['responsibility', 'Responsibility (อีเมลช่าง)', 'email'], ['eng_foreman', 'Eng, Foreman (อีเมล)', 'email'],
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
    closeModal(); toast('บันทึกแล้ว'); reload();
  };
  const del = $('#mDel');
  if (del) del.onclick = async () => {
    if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'กดอีกครั้งเพื่อยืนยันการลบ'; return; }
    const { error } = await sb.from('machines').delete().eq('machine_no', no);
    if (error) return fail({ message: 'ลบไม่ได้ (อาจมีใบแจ้งซ่อมอ้างอิงอยู่ ให้เปลี่ยนสถานะเป็น Inactive แทน)' });
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
    for (const [sh, dk, ik] of [['PM Master', 'pm', 'pm'], ['CAL Master', 'cal', 'cal']]) {
      for (const r of sheet(sh).filter(r => g(r, 'machine number'))) {
        const patch = { [dk + '_last_date']: xDate(g(r, dk + ' date')), [ik + '_interval_month']: parseInt(g(r, 'interval')) || null };
        const { error } = await sb.from('machines').update(patch).eq('machine_no', String(g(r, 'machine number')));
        if (!error) plan++;
      }
    }
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
    <div class="field full"><label for="dTags">คำค้น (คั่นด้วยช่องว่าง)</label><input id="dTags" class="inp" placeholder="heater ssr thermocouple"></div>
    <div class="field"><label for="dFile">ไฟล์ (PDF, รูป, วิดีโอ ฯลฯ)</label><input id="dFile" type="file" class="inp"></div>
    <div class="field"><label for="dUrl">หรือ ลิงก์ (SharePoint / OneDrive)</label><input id="dUrl" class="inp" type="url" placeholder="https://"></div>
    <div class="field full"><label><input type="checkbox" id="dLock"> จำกัดสิทธิ์ (เปิดได้เฉพาะหัวหน้างานและ Admin)</label></div>
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
    const { error } = await sb.from('documents').insert({ title: $('#dTitle').value.trim(), kind: $('#dKind').value, machine_no: $('#dMachine').value || null, tags: $('#dTags').value.trim(), restricted: lock, file_path, url: url || null });
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
    'เลขที่ใบแจ้งซ่อม': q.id, 'Machine number': q.machine_no, 'Machine Name': m.machine_name, 'Model': m.model, 'Serial Number': m.serial_number, 'Machine Type': m.machine_type, 'Location': m.location,
    'Status': m.status, 'Priority': m.priority, 'Responsibility': m.responsibility, 'ผู้แจ้ง': q.reporter, 'อาการเสีย/รายละเอียด': q.symptom, 'ความเร่งด่วน': q.urgency, 'จำนวนรูป': q.photos?.length || 0,
    'สถานะงาน': SL[q.status], 'ช่างผู้รับผิดชอบ': q.technician, 'วันที่แจ้ง': fd(q.created_at), 'วันที่และเวลาเริ่มซ่อม': fd(q.start_at), 'วันที่และเวลาปิดงาน': fd(q.end_at),
    'สาเหตุของปัญหา': q.root_cause, 'การแก้ไข/ผลการซ่อม': q.fix_detail, 'อะไหล่ที่ใช้': q.parts_used, 'Downtime (นาที)': q.downtime_min, 'ค่าใช้จ่าย(บาท)': q.cost_thb != null ? Number(q.cost_thb) : null,
    'ผู้ตรวจรับงาน': q.inspector, 'ผลตรวจรับ': q.inspect_result }; });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Maintenance Requests');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(D.machines), 'Machine Master');
  XLSX.writeFile(wb, 'CAPD-Maintenance-' + new Date().toISOString().slice(0, 10) + '.xlsx');
}

/* ---------- modal ---------- */
function modal(html) { closeModal(); const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.id = 'modal'; bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`; bg.onclick = e => { if (e.target === bg || e.target.hasAttribute('data-close')) closeModal(); }; document.body.appendChild(bg); }
function closeModal() { $('#modal')?.remove(); }

/* ---------- bind ---------- */
function bind() {
  $$('[data-nav]').forEach(b => b.onclick = e => { e.preventDefault(); S.view = b.dataset.nav; S.photos = []; render(); window.scrollTo(0, 0); });
  $$('[data-open]').forEach(r => r.onclick = () => openDetail(r.dataset.open));
  $$('[data-filter]').forEach(b => b.onclick = () => { S.filter = b.dataset.filter; render(); });
  $$('[data-kind]').forEach(b => b.onclick = () => { S.docKind = b.dataset.kind; render(); });
  $$('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act));
  $$('[data-doc]').forEach(b => b.onclick = () => openDoc(b.dataset.doc));
  $$('[data-docdel]').forEach(b => b.onclick = () => delDoc(b.dataset.docdel, b));
  $$('[data-medit]').forEach(b => b.onclick = () => machineForm(b.dataset.medit));
  $$('[data-done]').forEach(b => b.onclick = async () => {
    const [no, kind] = b.dataset.done.split('|'); const k = kind === 'PM' ? 'pm_last_date' : 'cal_last_date';
    const { error } = await sb.from('machines').update({ [k]: new Date().toISOString().slice(0, 10) }).eq('machine_no', no);
    if (error) return fail(error); toast(`บันทึก ${kind} ${no} แล้ว`); reload();
  });
  $$('[data-psave]').forEach(b => b.onclick = async () => {
    const id = b.dataset.psave;
    const { error } = await sb.from('profiles').update({ full_name: $('#pn-' + id).value.trim() || null, role: $('#pr-' + id).value, active: $('#pa-' + id).checked }).eq('id', id);
    if (error) return fail(error); toast('บันทึกแล้ว'); reload();
  });
  $('#logout').onclick = async () => { await sb.auth.signOut(); };
  const live = (id, key) => { const el = $('#' + id); if (el) el.oninput = () => { S[key] = el.value; const pos = el.selectionStart; render(); const n = $('#' + id); n.focus(); n.setSelectionRange(pos, pos); }; };
  live('q', 'q'); live('dq', 'docQ'); live('mq', 'mq');
  $('#expReq') && ($('#expReq').onclick = exportRequests);
  $('#mAdd') && ($('#mAdd').onclick = () => machineForm(null));
  $('#mImport') && ($('#mImport').onchange = e => { const f = e.target.files[0]; if (f) importExcel(f); e.target.value = ''; });
  $('#dAdd') && ($('#dAdd').onclick = docForm);
  const fp = $('#fPreset');
  if (fp) fp.onsubmit = async e => {
    e.preventDefault(); const em = $('#psEmail').value.trim().toLowerCase();
    if (!domainOk(em)) return toast('ใช้ได้เฉพาะอีเมล @' + C.ALLOWED_DOMAIN);
    const { error } = await sb.from('role_presets').upsert({ email: em, role: $('#psRole').value });
    if (error) return fail(error); toast('บันทึกแล้ว — จะได้บทบาทนี้เมื่อ Login ครั้งแรก'); fp.reset();
  };

  const ms = $('#nMachine');
  if (ms) {
    ms.onchange = () => { const m = M(ms.value); $('#mInfo').innerHTML = ms.value ? `<div class="mcard"><div><span>Model</span>${esc(m.model || '-')}</div><div><span>Serial</span>${esc(m.serial_number || '-')}</div><div><span>Location</span>${esc(m.location || '-')}</div><div><span>Priority</span>${esc(m.priority)}</div><div><span>ช่างผู้รับผิดชอบ</span>${esc(nm(m.responsibility))}</div><div><span>Supplier</span>${esc(m.supplier || '-')}</div></div>` : ''; };
    $('#nPhoto').onchange = async e => { for (const f of e.target.files) { if (S.photos.length >= 4) break; const p = await shrink(f); if (p) S.photos.push(p); } $('#thumbs').innerHTML = S.photos.map(p => `<img src="${p.url}" alt="รูปที่แนบ">`).join(''); };
    $('#fNew').onsubmit = async e => {
      e.preventDefault();
      const sym = $('#nSym').value.trim(); if (!ms.value || !sym) return toast('เลือกเครื่องและกรอกอาการเสีย');
      $('#bSubmit').disabled = true;
      try {
        const folder = crypto.randomUUID(), paths = [];
        for (let i = 0; i < S.photos.length; i++) {
          const path = `${folder}/${i + 1}.jpg`;
          const { error } = await sb.storage.from('request-photos').upload(path, S.photos[i].blob, { contentType: 'image/jpeg' });
          if (error) throw error; paths.push(path);
        }
        const { data, error } = await sb.from('requests').insert({ machine_no: ms.value, symptom: sym, urgency: document.querySelector('input[name=nUrg]:checked').value, photos: paths }).select().single();
        if (error) throw error;
        await sb.from('request_logs').insert({ request_id: data.id, action: 'แจ้งซ่อม' });
        S.photos = []; toast(data.id + ' ส่งแล้ว รอหัวหน้างานอนุมัติ');
        await loadAll(); openDetail(data.id);
      } catch (err) { $('#bSubmit').disabled = false; fail(err); }
    };
  }
}

/* =================== BOOT =================== */
let channel = null;
async function onSession(session) {
  S.session = session;
  if (!session) { S.me = null; channel && sb.removeChannel(channel); channel = null; return renderLogin(); }
  render();
  try {
    const { data: me, error } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
    if (error || !me) throw error || new Error('ไม่พบโปรไฟล์ผู้ใช้');
    if (!me.active) { toast('บัญชีถูกปิดการใช้งาน ติดต่อ Admin'); return sb.auth.signOut(); }
    S.me = me;
    await loadAll(); render();
    if (!channel) channel = sb.channel('requests').on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, () => {
      loadAll().then(() => { if (!$('#modal') && !document.activeElement?.matches('input,textarea,select')) render(); });
    }).subscribe();
  } catch (e) { fail(e); }
}
if (C.SUPABASE_URL.includes('YOUR-PROJECT')) {
  $('#app').innerHTML = '<div class="login"><div class="login-card"><h1>ยังไม่ได้ตั้งค่า Supabase</h1><p>แก้ไขไฟล์ <code>js/config.js</code> ใส่ SUPABASE_URL และ SUPABASE_ANON_KEY ตามคู่มือใน README.md</p></div></div>';
} else {
  let last;
  sb.auth.onAuthStateChange((_e, session) => { const id = session?.user?.id || null; if (id === last && S.me) { S.session = session; return; } last = id; onSession(session); });
}
})();

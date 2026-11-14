/* CAPD Maintenance v3 — frontend (vanilla JS + Supabase, Login ด้วย Microsoft 365)
   สิทธิ์จริงตรวจในฐานข้อมูล (supabase/v3_auth.sql) หน้าเว็บแค่ซ่อน/แสดงปุ่มให้ตรงกัน
   Flow: แก้ไขเอง / Normal (RMT-SAP, FM-K2) / Special (ใบเสนอราคา → MEMO → Manager App → PO / Vendor) / PM-CAL */
(() => {
'use strict';
const C = window.APP_CONFIG;
const SCAN_KEY = 'capd-pending-machine', JOB_KEY = 'capd-pending-job', TRIAL_KEY = 'capd-trial-user';
// โหมดทดลอง (ก่อน IT ตั้งค่า Microsoft 365): ส่งอีเมลที่กรอกไปใน header ให้ฐานข้อมูลใช้แทน Login จริง (supabase/v3_trial_on.sql)
let TRIAL_USER = null; try { if (C.TRIAL_LOGIN) TRIAL_USER = localStorage.getItem(TRIAL_KEY); } catch (e) {}
const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }, global: { headers: TRIAL_USER ? { 'x-capd-user': TRIAL_USER } : {} } });

/* ---------- constants ---------- */
const OPT = {
  type: ['เครื่องจักร', 'เครื่องทดสอบ', 'Mold', 'อื่นๆ'],
  fdType: ['เครื่องจักร', 'เครื่องทดสอบ'],
  loc: ['Extruder Area (Line 91)', 'Extruder Area (Line 98,96,95,92)', 'Injection Area MTD', 'Injection Area COD', 'Office Area MTD', 'Office Area COD', 'Stock Area R/M', 'Stock Area FG AMD', 'Testing Room 1', 'Testing Room 2', 'TD Lab Room 3', 'Weighing Room'],
  mstatus: ['Active', 'Maintenance', 'Inactive'],
  prio: ['Critical', 'High', 'Normal'],
  mtype: ['PM', 'CAL', 'PM & CAL', 'No Plan'],
  interval: [3, 6, 12, 24],
  docKind: ['คู่มือ PDF', 'SOP/WI', 'Drawing', 'วิดีโอ', 'วิธีแก้ปัญหาเบื้องต้น', 'Certificate', 'อื่นๆ']
};
const ROLES = { member: 'Member', foreman_shift: 'Foreman Shift', foreman_day: 'Foreman Day', manager: 'Manager', admin: 'Admin' };
const SL = { pending_fd: 'รอ Foreman Day อนุมัติ', returned: 'ส่งกลับแก้ไข', wait_admin: 'รอ Admin แจ้งซ่อม', ext_repair: 'RMT/FM กำลังซ่อม', quotation: 'ขอใบเสนอราคา / MEMO', memo_approval: 'รอ Manager อนุมัติ MEMO', memo_rejected: 'MEMO ไม่อนุมัติ', po_vendor: 'ออก PO / นัด Vendor', closed: 'ปิดงาน', cancelled: 'ยกเลิก' };
const SCLS = { pending_fd: 's-wait', returned: 's-rej', wait_admin: 's-queue', ext_repair: 's-work', quotation: 's-queue', memo_approval: 's-wait', memo_rejected: 's-rej', po_vendor: 's-test', closed: 's-done', cancelled: 's-done' };
const STATUS_ORDER = ['pending_fd', 'returned', 'wait_admin', 'ext_repair', 'quotation', 'memo_approval', 'memo_rejected', 'po_vendor', 'closed', 'cancelled'];
const ATT = { photo: 'รูปแจ้งซ่อม', external: 'หลักฐานแจ้ง SAP / K2', quotation: 'ใบเสนอราคา', memo: 'MEMO', po: 'PO', close: 'รูป / เอกสารหลังซ่อม' };
const OPEN = s => s !== 'closed' && s !== 'cancelled';
// พักงาน: ขั้นที่พักได้ และเหตุผล
const HOLD_STATUSES = ['wait_admin', 'ext_repair', 'quotation', 'memo_rejected', 'po_vendor'];
const HOLD_REASONS = ['รออะไหล่', 'รอ Vendor / ผู้รับเหมา', 'รอเครื่องหยุดผลิต', 'อื่นๆ'];
const daysSince = t => Math.max(0, Math.floor((Date.now() - new Date(t)) / 864e5));
const holdPill = q => q.hold_reason ? `<span class="pill s-hold" title="${esc(q.hold_note || '')}">พัก: ${esc(q.hold_reason)}${q.hold_since ? ' · ' + daysSince(q.hold_since) + ' วัน' : ''}</span>` : '';
// Direct Purchase MEMO (SC-F-0030)
const MEMO_TO = 'ผู้จัดการ Application and Material Development';
const AUTH = [[5000, 'ผจผ.'], [300000, 'ผจส.'], [1000000, 'ผจฝ.'], [Infinity, 'กจก. / รองกจก.']];
const authLevel = amt => AUTH.find(([lim]) => Number(amt || 0) <= lim)[1];
const MREASON = ['เป็นการจัดหาเร่งด่วนเนื่องจาก', 'เป็นการจัดหาจากหน่วยราชการ หรือองค์การของรัฐ/รัฐวิสาหกิจ', 'เป็นการจัดหาที่ต้องใช้ความรู้ความชำนาญพิเศษเฉพาะด้าน Technical', 'เหตุผลอื่น ๆ'];
const MMETHOD = [['nego', 'วิธีต่อรองราคา', '(อ้างอิงจากใบเสนอราคาเดิมหรือประวัติเก่าที่เคยสั่งซื้อ)'], ['compare', 'เปรียบเทียบราคา', '(มีการเปรียบเทียบราคาผู้ขายอย่างน้อย 2 ราย)'], ['special', 'ใช้วิธีพิเศษ', '']];
const MSPECIAL = ['เป็นงานเฉพาะต้องการความรู้ความชำนาญพิเศษจากผู้จำหน่ายหรือผู้ให้บริการนั้นๆ', 'เป็นผู้ผลิตแต่เพียงผู้เดียว', 'ซื้อผ่านตัวแทนจำหน่ายที่ได้รับการแต่งตั้ง', 'เป็นตลาดของผู้ขายหรือผู้ให้บริการเนื่องจากมีผู้ผลิตน้อยราย', 'เป็นวัสดุที่ต้องจัดหาจากหน่วยราชการ หรือ องค์กรของรัฐ/รัฐวิสาหกิจ', 'เป็นการจัดหาจากบริษัทในเครือ / ร่วมทุน', 'เหตุผลอื่น ๆ'];

const LOGO = '<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="3" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M9 21l5-5 3 3 6-8" fill="none" stroke="#f39a1e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="23" cy="11" r="2.3" fill="#f39a1e"/></svg>';
const IC = {
  parts: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></svg>',
  qr: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 12h8"/></svg>',
  more: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  warn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>',
  moon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
  sun: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  refresh: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
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
try { if (PENDING_M) sessionStorage.setItem(SCAN_KEY, PENDING_M); else PENDING_M = sessionStorage.getItem(SCAN_KEY); } catch (e) {}
// ลิงก์จากอีเมล / Teams: ?job=MR-…  (จำไว้ระหว่างไป Login)
let PENDING_J = new URLSearchParams(location.search).get('job');
try { if (PENDING_J) sessionStorage.setItem(JOB_KEY, PENDING_J); else PENDING_J = sessionStorage.getItem(JOB_KEY); } catch (e) {}
const S = { me: null, view: 'home', sel: null, scanNo: null, prefill: null, filter: 'open', q: '', mq: '', docQ: '', docKind: 'all', photos: [], logs: [], att: [] };
const D = { machines: [], requests: [], profiles: [], docs: [], parts: [], vendors: [], hasParts: false };

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
// ธีม: อัตโนมัติตามเครื่อง / สว่าง / มืด (จำไว้ในเบราว์เซอร์นี้)
const THEME_KEY = 'capd-theme';
function applyTheme() { let t = 'auto'; try { t = localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) {} if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; return t; }
function cycleTheme() { const order = ['auto', 'light', 'dark'], cur = applyTheme(), next = order[(order.indexOf(cur) + 1) % 3]; try { localStorage.setItem(THEME_KEY, next); } catch (e) {} applyTheme(); toast({ auto: 'ธีม: ตามเครื่อง', light: 'ธีม: สว่าง', dark: 'ธีม: มืด' }[next]); render(); }
const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
applyTheme();
const initials = e => { if (!e) return '?'; if (e === 'system') return 'ระบบ'; const n = String(nm(e)).replace(/[^\p{L}\s]/gu, '').trim().split(/\s+/).filter(Boolean); const first = w => Array.from(w).find(c => !/[เแโใไ]/.test(c)) || w[0]; return (n.length > 1 ? first(n[0]) + first(n[n.length - 1]) : Array.from(n[0] || '?').slice(0, 2).join('')).toUpperCase(); };
const avTone = e => ['a1', 'a2', 'a3', 'a4', 'a5'][[...String(e)].reduce((a, c) => a + c.charCodeAt(0), 0) % 5];
const avatar = (e, cls = '') => `<span class="av ${cls} ${e === 'system' ? 'a0' : avTone(e)}" aria-hidden="true">${esc(initials(e))}</span>`;
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
const isAdmin = () => role() === 'admin' || !!S.me?.is_admin;            // บทบาท Admin หรือ ติ๊กสิทธิ์ Admin
const is = (...rs) => rs.includes(role()) || (rs.includes('admin') && isAdmin());
const roleText = u => (ROLES[u?.role] || u?.role || '') + (u?.is_admin && u.role !== 'admin' ? ' + Admin' : '') + (u?.role === 'foreman_day' ? ' (' + (u.fd_type || 'สำรองทุกประเภท') + ')' : '');
// Foreman Day ตามประเภทเครื่อง: เครื่องทดสอบ → FD เครื่องทดสอบ, อื่นๆ (เครื่องจักร / Mold / อื่นๆ) → FD เครื่องจักร (ตรงกับ public.fd_for)
const fdTypeOf = no => M(no).machine_type === 'เครื่องทดสอบ' ? 'เครื่องทดสอบ' : 'เครื่องจักร';
const fdOfType = t => D.profiles.find(p => p.role === 'foreman_day' && p.active !== false && p.fd_type === t)?.email || null;
const fdFor = no => fdOfType(fdTypeOf(no));
// FD ทุกคนของประเภทนั้น (ไม่มี → FD สำรองที่ไม่ระบุประเภท) ตรงกับ public.fds_for
const fdsFor = no => { if (!no) return usersBy('foreman_day').map(p => p.email); const t = fdTypeOf(no), a = usersBy('foreman_day'); const x = a.filter(p => p.fd_type === t); return (x.length ? x : a.filter(p => !p.fd_type)).map(p => p.email); };
const canFD = no => isAdmin() || (role() === 'foreman_day' && (!S.me.fd_type || !no || S.me.fd_type === fdTypeOf(no)));
const canParts = () => isAdmin() || role() === 'foreman_day';   // แก้ทะเบียน / ปรับยอดอะไหล่
const PT = no => D.parts.find(x => x.part_no === no) || {};
const lowParts = () => D.parts.filter(x => x.active !== false && x.min_qty != null && Number(x.stock) <= Number(x.min_qty));
const qty = v => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const isFD = () => is('foreman_day', 'admin');
const canCreate = () => is('member', 'foreman_shift', 'foreman_day', 'admin');
const activeUsers = () => D.profiles.filter(p => p.active !== false);
const usersBy = (...rs) => activeUsers().filter(p => rs.includes(p.role));
const memoApprovers = () => activeUsers().filter(p => p.memo_approver);
const addMonths = (d, n) => { const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + Number(n), 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); t.setUTCDate(Math.min(dd, last)); return t.toISOString().slice(0, 10); };
function toast(t) { $$('.toast').forEach(x => x.remove()); const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 3000); }
function fail(e) { console.error(e); toast('ผิดพลาด: ' + (e?.message || e)); }
const domainOk = e => new RegExp('^[^@\\s]+@' + C.ALLOWED_DOMAIN.replace('.', '\\.') + '$', 'i').test(e);
const opts = (arr, sel) => arr.map(v => `<option ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(v)}</option>`).join('');
const userOpts = (list, sel, blank) => (blank ? `<option value="">${blank}</option>` : '') + list.map(u => `<option value="${esc(u.email)}" ${u.email === sel ? 'selected' : ''}>${esc(u.full_name || u.email)} · ${esc(roleText(u))}</option>`).join('');
function jobType(q) {
  if (q.job_type === 'normal') return 'Normal · ' + (q.repair_unit || '-');
  if (q.job_type === 'special') return 'Special';
  if (q.job_type === 'pmcal') return (q.pmcal_kind || 'PM/CAL') + ' (Special)';
  if (q.job_type === 'purchase') return 'คำขอซื้อ';
  if (q.job_type === 'self_fix') return 'แก้ไขเอง';
  return 'รอพิจารณา';
}

/* ---------- who acts next ---------- */
function owner(q) {
  switch (q.status) {
    case 'pending_fd': case 'ext_repair': { const f = fdsFor(q.machine_no); return f.length ? { roles: [], emails: f } : { roles: ['foreman_day'], emails: [] }; }
    case 'returned': return { roles: [], emails: [q.reporter] };
    case 'wait_admin': return { roles: ['admin'], emails: [] };
    case 'quotation': case 'memo_rejected': return { roles: [], emails: [q.assignee] };
    case 'memo_approval': return { roles: [], emails: [q.memo_approvers[q.memo_step]] };
    case 'po_vendor': return { roles: q.po_no ? [] : ['admin'], emails: [q.assignee] };
    default: return { roles: [], emails: [] };
  }
}
const ownerText = q => { const o = owner(q); return [...o.roles.map(r => ROLES[r]), ...o.emails.filter(Boolean).map(nm)].join(' + ') || '-'; };
const isMine = q => { const o = owner(q); return o.emails.includes(S.me.email) || o.roles.includes(role()) || (o.roles.includes('admin') && isAdmin()); };

/* ---------- data ---------- */
async function loadAll() {
  const [m, r, p, d] = await Promise.all([
    sb.from('machines').select('*').order('machine_no'),
    sb.from('requests').select('*').order('created_at', { ascending: false }),
    sb.from('app_users').select('*').order('email'),
    sb.from('documents').select('*').order('created_at', { ascending: false })
  ]);
  for (const x of [m, r, p, d]) if (x.error) throw x.error;
  D.machines = m.data; D.requests = r.data; D.docs = d.data;
  D.profiles = p.data;
  // คลังอะไหล่ + Vendor (v3.6) — ถ้ายังไม่ได้รัน SQL ให้เป็นรายการว่าง
  const [sp, vd] = await Promise.all([sb.from('spare_parts').select('*').order('part_no'), sb.from('vendors').select('*').order('name')]);
  D.parts = sp.error ? [] : sp.data; D.vendors = vd.error ? [] : vd.data; D.hasParts = !sp.error;
}
async function reload() {
  try {
    await loadAll();
    if (S.me) { const u = D.profiles.find(x => x.email === S.me.email && x.active !== false); if (!u) { await logout(); return renderLogin('สิทธิ์ใช้งานของคุณถูกนำออกแล้ว'); } S.me = u; }
    if (S.view === 'detail') return openDetail(S.sel, false);
    render();
  } catch (e) { fail(e); }
}
const addLog = (id, action) => sb.from('request_logs').insert({ request_id: id, action, actor: S.me.email });

// งานของฉัน = เฉพาะใบงานที่รอให้ฉันดำเนินการ (Admin ดูทั้งหมดได้ที่หน้าใบงาน)
function myTasks() { return D.requests.filter(q => OPEN(q.status) && isMine(q)); }
function planList() {
  const out = [], today = new Date(); today.setHours(0, 0, 0, 0);
  for (const m of D.machines) {
    if (m.status === 'Inactive') continue;
    for (const [kind, last, iv] of [['PM', m.pm_last_date, m.pm_interval_month], ['CAL', m.cal_last_date, m.cal_interval_month]]) {
      if (!last || !iv) continue;
      const next = addMonths(last, iv);
      out.push({ m, kind, last, iv, next, days: daysLeft(next), job: D.requests.find(q => q.job_type === 'pmcal' && q.machine_no === m.machine_no && q.pmcal_kind === kind && q.due_date === next) });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}
const daysLeft = due => { const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(due + 'T00:00:00') - t) / 864e5); };
const tierOf = d => d <= 30 ? 3 : d <= 60 ? 2 : 1;
function myReminders() {
  return D.requests.filter(q => q.job_type === 'pmcal' && !q.action_at && OPEN(q.status) && q.due_date).filter(q => {
    const t = tierOf(daysLeft(q.due_date));
    const fdOk = fdsFor(q.machine_no).includes(S.me.email);
    return isAdmin() || q.assignee === S.me.email || (t >= 2 && fdOk) || (t >= 3 && role() === 'manager');
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

/* =================== LOGIN (Microsoft 365 ผ่าน Supabase Auth) =================== */
async function logout(restart = true) {
  S.me = null; try { await sb.auth.signOut(); } catch (e) {}
  try { localStorage.removeItem(TRIAL_KEY); } catch (e) {}
  if (TRIAL_USER && restart) { location.replace(backUrl()); await new Promise(() => {}); }   // โหลดหน้าใหม่เพื่อล้าง header ของผู้ใช้เดิม
}
const backUrl = () => location.origin + location.pathname;
function urlAuthError() {
  const h = new URLSearchParams(location.hash.slice(1)), q = new URLSearchParams(location.search);
  const e = h.get('error_description') || q.get('error_description') || h.get('error') || q.get('error');
  if (e) try { history.replaceState(null, '', location.pathname); } catch (x) {}
  if (!e) return '';
  return /domain|@/i.test(e) ? 'ใช้ได้เฉพาะบัญชี @' + C.ALLOWED_DOMAIN : 'เข้าสู่ระบบไม่สำเร็จ: ' + e.replace(/\+/g, ' ');
}
function renderLogin(msg = '') {
  const otp = !!C.EMAIL_OTP;
  $('#app').innerHTML = `<div class="login"><div class="login-card">
    <div class="login-band">เข้าสู่ระบบ</div>
    <div class="k2logo">${LOGO}<span>CAPD <b>MAINTENANCE</b></span></div>
    <p class="sub" style="margin:0">${esc(C.ORG)} · ระบบแจ้งซ่อมและบำรุงรักษา</p>
    ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
    <button class="btn ms" id="bMs" type="button"><svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg> เข้าสู่ระบบด้วย Microsoft 365 (@${esc(C.ALLOWED_DOMAIN)})</button>
    ${otp ? `<div class="or"><span>หรือ รับรหัสทางอีเมล</span></div>
    <form id="fOtp" style="display:flex;flex-direction:column;gap:10px">
      <div class="field"><label for="enEmail">อีเมลบริษัท</label><input id="enEmail" class="inp" type="email" autocomplete="email" placeholder="name@${esc(C.ALLOWED_DOMAIN)}" required></div>
      <div class="field" id="otpBox" hidden><label for="enCode">รหัสจากอีเมล</label><input id="enCode" class="inp" inputmode="numeric" autocomplete="one-time-code" maxlength="10"></div>
      <button class="btn ghost" type="submit" id="bOtp">ส่งรหัสไปที่อีเมล</button>
    </form>` : ''}
    ${C.TRIAL_LOGIN ? `<div class="or"><span>โหมดทดลอง · กรอกอีเมลอย่างเดียว</span></div>
    <form id="fTrial" style="display:flex;flex-direction:column;gap:10px">
      <div class="field"><label for="trEmail">อีเมลบริษัท</label><input id="trEmail" class="inp" type="email" autocomplete="email" placeholder="name@${esc(C.ALLOWED_DOMAIN)}" required></div>
      <button class="btn" type="submit">เข้าสู่ระบบ (ทดลอง)</button>
    </form>` : ''}
    <p class="sub" style="margin:0">ใช้บัญชีอีเมลบริษัทที่ Admin เพิ่มไว้ในระบบเท่านั้น · ยังไม่มีสิทธิ์? ติดต่อ Admin</p>
  </div></div>`;
  $('#bMs').onclick = async () => {
    $('#bMs').disabled = true;
    const { error } = await sb.auth.signInWithOAuth({ provider: 'azure', options: { scopes: 'openid email profile', redirectTo: backUrl() } });
    if (error) { $('#bMs').disabled = false; renderLogin('เปิดหน้า Microsoft ไม่ได้: ' + error.message); }
  };
  const ft = $('#fTrial');
  if (ft) ft.onsubmit = e => {
    e.preventDefault();
    const em = $('#trEmail').value.trim().toLowerCase();
    if (!domainOk(em)) return renderLogin('ใช้ได้เฉพาะอีเมล @' + C.ALLOWED_DOMAIN);
    try { localStorage.setItem(TRIAL_KEY, em); } catch (x) { return renderLogin('เบราว์เซอร์นี้บันทึกข้อมูลไม่ได้ ลองปิดโหมดไม่ระบุตัวตน'); }
    location.replace(backUrl() + location.search);
  };
  const f = $('#fOtp');
  if (f) f.onsubmit = async e => {
    e.preventDefault();
    const em = $('#enEmail').value.trim().toLowerCase();
    if (!domainOk(em)) return renderLogin('ใช้ได้เฉพาะอีเมล @' + C.ALLOWED_DOMAIN);
    $('#bOtp').disabled = true;
    if ($('#otpBox').hidden) {
      const { error } = await sb.auth.signInWithOtp({ email: em, options: { shouldCreateUser: true, emailRedirectTo: backUrl() } });
      $('#bOtp').disabled = false;
      if (error) return toast('ส่งรหัสไม่สำเร็จ: ' + error.message);
      $('#otpBox').hidden = false; $('#enEmail').readOnly = true; $('#bOtp').textContent = 'ยืนยันรหัส'; $('#enCode').focus(); toast('ส่งรหัสไปที่ ' + em + ' แล้ว');
    } else {
      const { error } = await sb.auth.verifyOtp({ email: em, token: $('#enCode').value.trim(), type: 'email' });
      $('#bOtp').disabled = false;
      if (error) return toast('รหัสไม่ถูกต้องหรือหมดอายุ');
    }
  };
}
let entering = false;
async function enter(session) {
  if (entering || (S.me && S.me.email === (session.user.email || '').toLowerCase())) return;
  entering = true;
  try {
    const em = (session.user.email || '').toLowerCase();
    if (!domainOk(em)) { await logout(false); return renderLogin('ใช้ได้เฉพาะบัญชี @' + C.ALLOWED_DOMAIN + (em ? ' (คุณเข้าด้วย ' + em + ')' : '')); }
    try { await loadAll(); } catch (e) { return renderLogin('เชื่อมต่อฐานข้อมูลไม่ได้: ' + (e.message || e)); }
    const u = D.profiles.find(x => x.email === em && x.active !== false);
    if (!u) { await logout(false); return renderLogin('บัญชี ' + em + ' ยังไม่มีสิทธิ์ใช้งาน กรุณาติดต่อ Admin'); }
    S.me = u;
    await afterLogin();
  } finally { entering = false; }
}

/* =================== SHELL =================== */
const NAV_ICON = { home: 'home', new: 'new', list: 'list', approve: 'approve', machine: 'machine', parts: 'parts', cal: 'cal', docs: 'docs', report: 'report', admin: 'admin' };
function navItems() {
  const nApprove = D.requests.filter(q => (q.status === 'pending_fd' && isMine(q)) || (q.status === 'memo_approval' && q.memo_approvers[q.memo_step] === S.me.email)).length;
  const nav = [['home', 'หน้าหลัก', myTasks().length], ['new', 'แจ้งซ่อม'], ['list', 'ใบงาน'], ['approve', 'อนุมัติ', nApprove], ['machine', 'เครื่องจักร'], ['parts', 'อะไหล่', canParts() ? lowParts().length : 0], ['cal', 'PM / CAL', myReminders().length], ['docs', 'คลังเอกสาร'], ['report', 'รายงาน']];
  if (isAdmin()) nav.push(['admin', 'ผู้ใช้']);
  return nav;
}
const CRUMBS = { parts: 'คลังอะไหล่', home: 'หน้าหลัก', new: 'แจ้งซ่อม / เปิดใบงาน', list: 'ใบงานทั้งหมด', approve: 'รออนุมัติ', machine: 'เครื่องจักร', cal: 'แผน PM / CAL', docs: 'คลังเอกสาร', report: 'รายงาน', admin: 'ผู้ใช้และสิทธิ์', detail: 'รายละเอียดใบงาน', scan: 'Dashboard เครื่องจักร' };
const navOn = k => S.view === k || (S.view === 'detail' && k === 'list') || (S.view === 'scan' && k === 'machine');
function render() {
  if (!S.me) return renderLogin();
  dirty = false; lastSync = Date.now();
  const nav = navItems(), more = nav.filter(([k]) => !['home', 'new', 'list'].includes(k)), moreBadge = more.reduce((a, x) => a + (x[2] || 0), 0);
  const sub = S.view === 'detail' ? S.sel : S.view === 'scan' ? S.scanNo : esc(roleText(S.me));
  const back = ['detail', 'scan'].includes(S.view);
  $('#app').innerHTML = `
  <div class="shell">
    <aside class="side" aria-label="เมนูหลัก">
      <div class="brand">${LOGO}<span>CAPD <b>Maintenance</b><small>${esc(C.ORG)}</small></span></div>
      <nav class="side-nav">${nav.map(([k, l, b]) => `<button data-nav="${k}" class="${navOn(k) ? 'on' : ''}">${IC[NAV_ICON[k]]}<span>${l}</span>${b ? `<i class="badge">${b}</i>` : ''}</button>`).join('')}</nav>
      <div class="side-foot">${TRIAL_USER ? '<span class="demo-flag" title="เข้าด้วยอีเมลอย่างเดียว ยังไม่ใช่ Login จริง">โหมดทดลอง</span>' : ''}<span class="sub">${esc(C.APP_NAME)} · ${esc(C.ORG)}${window.APP_VERSION ? " · v" + esc(window.APP_VERSION) : ""}</span></div>
    </aside>
    <div class="content">
      <header class="topb">
        <div class="tb-title">${back ? `<button class="iconbtn ghosty" data-nav="${S.view === 'detail' ? 'list' : 'machine'}" aria-label="กลับ">${IC.back}</button>` : `<span class="mob-only">${avatar(S.me.email)}</span>`}<div><b>${CRUMBS[S.view]}</b><small>${sub}</small></div></div>
        <div class="sp"></div>
        ${TRIAL_USER ? '<span class="demo-flag mob-only">ทดลอง</span>' : ''}
        <button class="btn desk-only" data-scanqr>${IC.qr}<span>สแกน QR</span></button>
        <button class="iconbtn ghosty" id="themeBtn" title="สลับธีม" aria-label="สลับธีมสว่าง/มืด">${isDark() ? IC.sun : IC.moon}</button>
        <button class="iconbtn ghosty" id="refresh" title="รีเฟรชข้อมูล" aria-label="รีเฟรชข้อมูล">${IC.refresh}</button>
        <div class="who desk-only">${avatar(S.me.email)}<span class="nm"><b>${esc(S.me.full_name || S.me.email)}</b><small>${esc(roleText(S.me))}</small></span></div>
        <button class="iconbtn ghosty desk-only" id="logout" title="ออกจากระบบ" aria-label="ออกจากระบบ">${IC.out}</button>
      </header>
      <main class="main" id="main">${VIEWS[S.view]()}</main>
    </div>
  </div>
  <nav class="bnav" aria-label="เมนูหลัก">
    <button data-nav="home" class="${navOn('home') ? 'on' : ''}">${IC.home}<span>หน้าหลัก</span>${myTasks().length ? `<i class="badge">${myTasks().length}</i>` : ''}</button>
    <button data-nav="new" class="${navOn('new') ? 'on' : ''}">${IC.new}<span>แจ้งซ่อม</span></button>
    <button data-scanqr class="fabw" aria-label="สแกน QR ที่เครื่อง"><span class="fab">${IC.qr}</span><span>สแกน</span></button>
    <button data-nav="list" class="${navOn('list') ? 'on' : ''}">${IC.list}<span>ใบงาน</span></button>
    <button id="moreBtn" class="${more.some(([k]) => navOn(k)) ? 'on' : ''}">${IC.more}<span>เมนู</span>${moreBadge ? `<i class="badge">${moreBadge}</i>` : ''}</button>
  </nav>`;
  bind();
}
function moreSheet() {
  const nav = navItems().filter(([k]) => !['home', 'new', 'list'].includes(k));
  modal(`<div class="sheet-head">${avatar(S.me.email)}<div><b>${esc(S.me.full_name || S.me.email)}</b><div class="sub">${esc(roleText(S.me))}</div></div></div>
    <div class="sheet-grid">${nav.map(([k, l, b]) => `<button data-nav="${k}" class="${navOn(k) ? 'on' : ''}">${IC[NAV_ICON[k]]}<span>${l}</span>${b ? `<i class="badge">${b}</i>` : ''}</button>`).join('')}</div>
    <div class="btns" style="margin-top:14px"><button class="btn ghost" id="logout2">${IC.out} ออกจากระบบ</button><button class="btn ghost" data-close>ปิด</button></div>`, 'sheet');
  $$('#modal [data-nav]').forEach(b => b.onclick = () => { closeModal(); S.view = b.dataset.nav; render(); window.scrollTo(0, 0); });
  $('#logout2').onclick = async () => { closeModal(); await logout(); S.view = 'home'; renderLogin(); };
}

/* ---------- สแกน QR ในเว็บ (กล้องมือถือ) ---------- */
let scanStream = null;
function stopScan() { if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; } }
function loadJsQR() { return window.jsQR ? Promise.resolve() : new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'; sc.onload = ok; sc.onerror = no; document.head.appendChild(sc); }); }
function handleCode(text) {
  let no = null;
  try { no = new URL(text, location.href).searchParams.get('m'); } catch (e) {}
  if (!no && D.machines.some(m => m.machine_no === String(text).trim())) no = String(text).trim();
  if (!no) return toast('QR นี้ไม่ใช่ของระบบ CAPD');
  if (!D.machines.some(m => m.machine_no === no)) return toast('ไม่พบเครื่อง ' + no + ' ในระบบ');
  stopScan(); closeModal(); openScan(no);
}
async function openScanner() {
  modal(`<div class="h-row" style="margin-bottom:12px"><h1 style="font-size:20px">สแกน QR ที่เครื่อง</h1><button class="btn ghost" data-close>ปิด</button></div>
    <div class="scanbox"><video id="scanVideo" playsinline muted></video><div class="scanframe" aria-hidden="true"></div></div>
    <p class="sub" id="scanMsg">เล็งกล้องไปที่สติกเกอร์ QR บนเครื่องจักร</p>
    <div class="form" style="margin-top:6px"><div class="field"><label for="scanNo">หรือเลือกเครื่องเอง</label><select id="scanNo" class="inp"><option value="">— เลือกเครื่อง —</option>${D.machines.filter(m => m.status !== 'Inactive').map(m => `<option value="${esc(m.machine_no)}">${esc(m.machine_no)} · ${esc(m.machine_name)}</option>`).join('')}</select></div>
    <div class="field"><label for="scanImg">หรือถ่ายรูป QR</label><input id="scanImg" class="inp" type="file" accept="image/*" capture="environment"></div></div>`, 'scanner');
  const bg = $('#modal'); const obs = new MutationObserver(() => { if (!document.body.contains(bg)) { stopScan(); obs.disconnect(); } }); obs.observe(document.body, { childList: true });
  $('#scanNo').onchange = e => { if (e.target.value) { closeModal(); openScan(e.target.value); } };
  const detector = 'BarcodeDetector' in window ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
  const decode = async src => {
    if (detector) { try { const r = await detector.detect(src); if (r[0]) return r[0].rawValue; } catch (e) {} }
    await loadJsQR(); const c = document.createElement('canvas'), w = src.videoWidth || src.naturalWidth || src.width, h = src.videoHeight || src.naturalHeight || src.height; if (!w) return null;
    c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, w, h); return window.jsQR(x.getImageData(0, 0, w, h).data, w, h)?.data || null;
  };
  $('#scanImg').onchange = async e => { const f = e.target.files[0]; if (!f) return; const img = new Image(); img.onload = async () => { const t = await decode(img).catch(() => null); t ? handleCode(t) : toast('อ่าน QR จากรูปไม่ได้ ลองถ่ายให้ชัดขึ้น'); }; img.src = URL.createObjectURL(f); };
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    const v = $('#scanVideo'); if (!v) return stopScan(); v.srcObject = scanStream; await v.play();
    if (!detector) loadJsQR().catch(() => {});
    const tick = async () => { if (!scanStream || !document.body.contains(v)) return; const t = v.readyState >= 2 ? await decode(v).catch(() => null) : null; if (t) return handleCode(t); setTimeout(tick, 250); };
    tick();
  } catch (e) { const m = $('#scanMsg'); if (m) m.textContent = 'เปิดกล้องไม่ได้ (ไม่ได้อนุญาต หรืออุปกรณ์ไม่มีกล้อง) · เลือกเครื่องหรือถ่ายรูป QR ด้านล่างแทน'; $('.scanbox')?.remove(); }
}

function jobCard(q) {
  const m = M(q.machine_no);
  return `<button class="jobc" data-open="${esc(q.id)}"><span class="jc-top"><b class="mono">${esc(q.id)}</b>${pill(q.status)}${holdPill(q)}${q.machine_down && OPEN(q.status) ? '<span class="pill s-rej">เครื่องหยุด</span>' : ''}<span class="sp"></span><span class="u-${esc(q.urgency)}">● ${esc(q.urgency)}</span></span>
    <span class="jc-m">${q.machine_no ? `<b>${esc(q.machine_no)}</b> <span class="sub">${esc(m.machine_name || '')}</span>` : '<span class="sub">ไม่ระบุเครื่อง</span>'}</span>
    <span class="jc-s">${esc(q.symptom)}</span>
    <span class="jc-meta"><span>${esc(jobType(q))}</span><span>${fd(q.created_at)}</span>${OPEN(q.status) ? `<span>ถัดไป: <b>${esc(ownerText(q))}</b></span>` : ''}</span></button>`;
}
function taskTable(rows, empty = 'ไม่มีรายการ', cardsOnly = false) {
  if (!rows.length) return `<div class="empty">${empty}</div>`;
  const cards = `<div class="jobs ${cardsOnly ? '' : 'mob-only'}">${rows.map(jobCard).join('')}</div>`;
  if (cardsOnly) return cards;
  return cards + `<div class="tbl-wrap desk-only"><table><thead><tr><th>#</th><th>ใบงาน</th><th>ประเภท</th><th>สถานะ</th><th>ผู้ดำเนินการถัดไป</th><th>วันที่เปิด</th></tr></thead><tbody>
  ${rows.map((q, i) => { const m = M(q.machine_no); return `<tr class="click" data-open="${esc(q.id)}"><td class="num sub">${i + 1}</td><td><span class="folio">${esc(q.id)}</span> · <b>${esc(q.machine_no)}</b> <span class="sub">${esc(m.machine_name)}</span><br><span class="sub">${esc(q.symptom)}</span></td><td>${esc(jobType(q))}<br><span class="u-${esc(q.urgency)}">${esc(q.urgency)}</span></td><td>${pill(q.status)}${q.hold_reason ? '<br>' + holdPill(q) : ''}</td><td>${OPEN(q.status) ? esc(ownerText(q)) : '-'}</td><td class="num">${fd(q.created_at)}</td></tr>`; }).join('')}
  </tbody></table></div>`;
}
// งานเข้า / ปิด รายสัปดาห์ (8 สัปดาห์ล่าสุด)
function weekChart() {
  const wk = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.getTime(); };
  const now = wk(Date.now()), weeks = Array.from({ length: 8 }, (_, i) => now - (7 - i) * 7 * 864e5);
  const rows = weeks.map(w => ({ w, inn: D.requests.filter(q => wk(q.created_at) === w).length, out: D.requests.filter(q => q.status === 'closed' && q.end_at && wk(q.end_at) === w).length }));
  const mx = Math.max(1, ...rows.flatMap(r => [r.inn, r.out])), W = 340, base = 104, hgt = 82, gap = 40, bw = 13;
  const bars = rows.map((r, i) => { const x = 18 + i * gap, d = new Date(r.w); return `<rect x="${x}" y="${base - r.inn / mx * hgt}" width="${bw}" height="${r.inn / mx * hgt}" rx="2" class="c-in"><title>${r.inn} งานเข้า</title></rect><rect x="${x + bw + 2}" y="${base - r.out / mx * hgt}" width="${bw}" height="${r.out / mx * hgt}" rx="2" class="c-out"><title>${r.out} งานปิด</title></rect><text x="${x + bw}" y="${base + 16}" text-anchor="middle" class="c-lbl">${d.getDate()} ${TH[d.getMonth()]}</text>`; }).join('');
  const last = rows.at(-1);
  return `<svg class="wchart" viewBox="0 0 ${W} 126" role="img" aria-label="งานเข้าและงานปิดรายสัปดาห์"><line x1="10" x2="${W - 6}" y1="${base}" y2="${base}" class="c-axis"/>${bars}</svg>
    <div class="legend"><span><i class="c-in"></i>งานเข้า</span><span><i class="c-out"></i>งานปิด</span><span class="sub">สัปดาห์นี้ เข้า ${last.inn} · ปิด ${last.out}</span></div>`;
}

/* =================== VIEWS =================== */
const VIEWS = {
  home() {
    const t = myTasks(), open = D.requests.filter(q => OPEN(q.status)), rem = myReminders();
    const crit = open.filter(q => q.urgency === 'Critical').length, soon = rem.filter(q => daysLeft(q.due_date) <= 30).length;
    const tile = (ic, tone, n, label, nav) => `<button class="tile ${tone}" ${nav ? `data-nav="${nav}"` : ''}><span class="ti">${ic}</span><b>${n}</b><span>${label}</span></button>`;
    return `<div class="hello"><h1>สวัสดี, ${esc(String(S.me.full_name || S.me.email).split(' ')[0])}</h1><span class="sub">${esc(roleText(S.me))}${t.length ? ` · มี ${t.length} งานรอคุณ` : ' · ไม่มีงานค้าง'}</span></div>
    <div class="tiles">
      ${tile(IC.approve, 't-info', t.length, 'งานรอฉัน', '')}
      ${tile(IC.list, 't-ok', open.length, 'ใบงานที่ยังเปิด', 'list')}
      ${tile(IC.warn, crit ? 't-bad alert' : 't-bad', crit, 'Critical ที่ยังเปิด', 'list')}
      ${tile(IC.cal, 't-warn', soon, 'PM/CAL ใน 30 วัน', 'cal')}
    </div>
    ${rem.length ? `<div class="remind"><b>${IC.cal} PM / CAL ที่ต้องเริ่มดำเนินการ</b>${rem.map(q => { const d = daysLeft(q.due_date); return `<div class="rrow" data-open="${esc(q.id)}"><span class="tier t${tierOf(d)}">ขั้น ${tierOf(d)}</span><span><b>${esc(q.machine_no)}</b> ${esc(q.pmcal_kind)} ครบกำหนด ${fd(q.due_date)} · ${d < 0 ? 'เกิน ' + (-d) : 'อีก ' + d} วัน</span><span class="sub">${esc(nm(q.assignee))}</span></div>`; }).join('')}</div>` : ''}
    <div class="home-grid">
      <section class="stack"><div class="sec-h"><h2>งานของฉัน (${t.length})</h2><span class="sp"></span>${canCreate() ? `<button class="btn" data-nav="new">${IC.plus} แจ้งซ่อม</button>` : ''}</div>
        ${taskTable(t, 'ไม่มีงานค้างสำหรับคุณ', true)}</section>
      <section class="box"><h3>งานเข้า / ปิด รายสัปดาห์</h3>${weekChart()}</section>
    </div>`;
  },

  list() {
    let rows = D.requests.slice();
    if (S.filter === 'open') rows = rows.filter(q => OPEN(q.status)); else if (S.filter === 'hold') rows = rows.filter(q => OPEN(q.status) && q.hold_reason); else if (S.filter === 'down') rows = rows.filter(q => OPEN(q.status) && q.machine_down); else if (S.filter !== 'all') rows = rows.filter(q => q.status === S.filter);
    if (S.q) { const k = S.q.toLowerCase(); rows = rows.filter(q => [q.id, q.machine_no, M(q.machine_no).machine_name, q.symptom, q.reporter, q.assignee, q.external_ref, q.memo_no, q.po_no, jobType(q)].join(' ').toLowerCase().includes(k)); }
    const chips = [['open', 'ยังเปิด', D.requests.filter(q => OPEN(q.status)).length], ['all', 'ทั้งหมด', D.requests.length], ['down', 'เครื่องหยุด', D.requests.filter(q => OPEN(q.status) && q.machine_down).length], ['hold', 'พักงาน', D.requests.filter(q => OPEN(q.status) && q.hold_reason).length], ...STATUS_ORDER.map(s => [s, SL[s], D.requests.filter(q => q.status === s).length])].filter(x => x[2] || ['open', 'all'].includes(x[0]));
    return `<div class="h-row"><h1>ใบงานทั้งหมด</h1><span class="sub">${rows.length} รายการ</span><button class="btn ghost" id="expReq">Export Excel</button></div>
    <div class="fbar">${chips.map(([k, l, n]) => `<button class="chip ${S.filter === k ? 'on' : ''}" data-filter="${k}">${l} <span class="sub">${n}</span></button>`).join('')}
    <div class="sp"></div><label class="sr" for="q">ค้นหา</label><input id="q" class="search" placeholder="ค้นหา เลขที่ / เครื่อง / SAP / MEMO / PO" value="${esc(S.q)}"></div>
    ${taskTable(rows)}`;
  },

  approve() {
    const fdRows = D.requests.filter(q => q.status === 'pending_fd').sort((a, b) => canFD(b.machine_no) - canFD(a.machine_no));
    const memoRows = D.requests.filter(q => q.status === 'memo_approval' && (isAdmin() || q.memo_approvers[q.memo_step] === S.me.email));
    return `<div class="h-row"><h1>รออนุมัติ</h1></div>
    <h3 class="sec">ใบแจ้งซ่อมรอ Foreman Day อนุมัติ (${fdRows.length})</h3>
    <p class="sub">${isFD() ? 'เครื่องจักร / Mold / อื่นๆ → ' + esc(nm(fdOfType('เครื่องจักร'))) + ' · เครื่องทดสอบ → ' + esc(nm(fdOfType('เครื่องทดสอบ'))) + ' · FD ที่ไม่ระบุประเภทอนุมัติแทนได้ทุกประเภท' : 'ดูได้อย่างเดียว เฉพาะ Foreman Day ตามประเภทเครื่อง และ Admin ที่อนุมัติได้'}</p>
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
        <input id="nMachineQ" class="inp" type="search" placeholder="พิมพ์ค้นหา รหัส / ชื่อเครื่อง / Location" autocomplete="off" aria-label="ค้นหาเครื่องจักร" style="margin-bottom:6px">
        <select id="nMachine" class="inp" required><option value="">— เลือกจากทะเบียนเครื่องจักร —</option>${ms.map(m => `<option value="${esc(m.machine_no)}" ${m.machine_no === S.prefill ? 'selected' : ''}>${esc(m.machine_no)} · ${esc(m.machine_name)} (${esc(m.location || '-')})</option>`).join('')}</select></div>
      <div class="full" id="mInfo"></div>
      <div class="field full"><label for="nSym">อาการที่พบ *</label><textarea id="nSym" class="inp" rows="3" required></textarea></div>
      <div class="field full"><label for="nFirst">วิธีแก้ไขเบื้องต้นที่ทำไปแล้ว</label><textarea id="nFirst" class="inp" rows="2"></textarea></div>
      <div class="field"><span class="flabel">ความเร่งด่วน *</span><div class="urg">${OPT.prio.map((p, i) => `<label class="u-${p}" for="nUrg${i}"><input type="radio" name="nUrg" id="nUrg${i}" value="${p}" ${p === 'High' ? 'checked' : ''}>${p}</label>`).join('')}</div></div>
      <div class="field"><label for="nPhoto">รูปภาพ</label><input id="nPhoto" type="file" accept="image/*" multiple class="inp"></div>
      <div class="field"><span class="flabel">เครื่องหยุดหรือไม่</span><label><input type="checkbox" id="nDown"> เครื่องหยุดใช้งาน</label>
        <div id="nDownBox" hidden style="margin-top:6px"><label for="nDownAt" class="sub">หยุดตั้งแต่ (ใช้คำนวณ Downtime)</label><input id="nDownAt" class="inp" type="datetime-local" value="${localInput(Date.now())}"></div></div>
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
    const att = S.att.length ? Object.entries(ATT).map(([k, label]) => { const a = S.att.filter(x => x.kind === k); return a.length ? `<div class="attg"><span class="sub">${label}</span>${a.map(x => `<span class="attw">${/\.(jpe?g|png|gif|webp)$/i.test(x.name) ? `<a href="${esc(x.url)}" target="_blank" rel="noopener"><img src="${esc(x.url)}" alt="${esc(x.name)}"></a>` : `<a class="file" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>`}${canRemoveAtt(q, x) ? `<button class="attx" data-attdel="${esc(x.path)}" title="ลบไฟล์ ${esc(x.name)}" aria-label="ลบไฟล์ ${esc(x.name)}">×</button>` : ''}</span>`).join('')}</div>` : ''; }).join('') : '';
    return `<div class="h-row"><h1>${esc(q.id)}</h1>${pill(q.status)}${holdPill(q)}${canEdit(q) ? '<button class="btn ghost" id="qEdit">แก้ไข</button>' : ''}${canCancel(q) ? '<button class="btn ghost bad-t" id="qCancel">ยกเลิกใบงาน</button>' : ''}${isAdmin() ? '<button class="btn ghost bad-t" id="qDel">ลบใบงาน</button>' : ''}<button class="btn ghost" data-nav="list">← กลับ</button></div>
    ${stepsHtml(q)}
    <div class="detail">
      <div class="stack">
        ${actions(q)}${OPEN(q.status) ? holdBox(q) : ''}
        <div class="box"><h3>ข้อมูลใบงาน</h3><dl class="kv">
          ${kv('เครื่องจักร', q.machine_no ? `<b>${esc(m.machine_no)}</b> · ${esc(m.machine_name)} <span class="sub">${esc(m.location || '')}</span>` : '<span class="sub">ไม่ระบุ (ใช้ทั่วไป)</span>')}
          ${kv('ประเภทงาน', esc(jobType(q)))}
          ${kv('ความเร่งด่วน', `<span class="u-${esc(q.urgency)}">${esc(q.urgency)}</span>`)}
          ${kv('ผู้เปิดใบงาน', esc(nm(q.reporter)) + ' · ' + fd(q.created_at))}
          ${kv('อาการที่พบ', esc(q.symptom))}
          ${kv('วิธีแก้ไขเบื้องต้น', esc(q.first_fix))}
          ${kv('เครื่องหยุด', q.machine_down ? '<span class="u-Critical">หยุดใช้งาน</span>' + (q.down_since ? ' ตั้งแต่ ' + fd(q.down_since) + (OPEN(q.status) ? ` (${daysSince(q.down_since)} วัน)` : '') : '') : '')}
          ${kv('พักงาน', q.hold_reason ? esc(q.hold_reason) + (q.hold_note ? ' · ' + esc(q.hold_note) : '') + ' · ตั้งแต่ ' + fd(q.hold_since) : '')}
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
          ${kv(q.status === 'cancelled' ? 'เหตุผลที่ยกเลิก' : 'หมายเหตุส่งกลับ', q.return_note ? `<span class="u-Critical">${esc(q.return_note)}</span>` : '')}
          ${q.status === 'cancelled' ? kv('ยกเลิกโดย', esc(nm(q.closed_by))) : ''}
          ${OPEN(q.status) ? kv('ผู้ดำเนินการถัดไป', `<b>${esc(ownerText(q))}</b>`) : ''}
        </dl></div>
        ${q.job_type === 'purchase' && q.items?.length ? `<div class="box"><h3>รายการขอซื้อ (${q.items.length})</h3>${itemsTable(q)}</div>` : ''}
        ${q.quotes?.length && !(OPEN(q.status) && ['quotation', 'memo_rejected', 'memo_approval'].includes(q.status) && isMine(q)) ? `<div class="box"><h3>เทียบใบเสนอราคา (${q.quotes.length})</h3>${quoteTable(q)}</div>` : ''}
        ${q.memo_doc && !['quotation'].includes(q.status) ? `<div class="btns"><button class="btn ghost" data-memo="1">เปิด MEMO ${esc(q.memo_no || '')} (SC-F-0030)</button></div>` : ''}
        ${q.memo_approvers?.length ? memoChain(q) : ''}
        ${q.status === 'closed' ? `<div class="box"><h3>สรุปผลการซ่อม</h3><dl class="kv">
          ${kv('วิธีการแก้ไข', esc(q.fix_detail))}${kv('สาเหตุ', esc(q.root_cause))}${kv('อะไหล่ที่ใช้', esc(q.parts_used))}
          ${kv('ค่าใช้จ่าย', money(q.cost_thb))}${kv('เริ่ม', fd(q.start_at))}${kv('เสร็จ', fd(q.end_at))}${kv('ระยะเวลา / Downtime', q.downtime_min != null ? q.downtime_min + ' นาที' : '')}
          ${kv('ปิดงานโดย', esc(nm(q.closed_by)))}</dl></div>` : ''}
        ${att ? `<div class="box"><h3>ไฟล์แนบ</h3><div class="atts">${att}</div></div>` : ''}
      </div>
      <div class="box"><h3>ประวัติการดำเนินการ</h3><ul class="timeline">${S.logs.map(l => `<li>${avatar(l.actor, 's')}<div>${esc(l.action)}<small>${esc(nm(l.actor))} · ${fd(l.at)}</small></div></li>`).join('') || '<li><div class="sub">—</div></li>'}</ul></div>
    </div>`;
  },

  machine() {
    let rows = D.machines;
    if (S.mq) { const k = S.mq.toLowerCase(); rows = rows.filter(m => Object.values(m).join(' ').toLowerCase().includes(k)); }
    return `<div class="h-row"><h1>Machine Master</h1><span class="sub">${D.machines.length} เครื่อง</span>
      ${isAdmin() ? `<button class="btn" id="mAdd">+ เพิ่มเครื่อง</button><button class="btn ghost" id="qrAll">พิมพ์ QR ทั้งหมด</button><label class="btn ghost" for="mImport" style="cursor:pointer">นำเข้าจาก Excel</label><input id="mImport" type="file" accept=".xlsx,.xls" hidden>` : ''}</div>
    <div class="fbar"><span class="sub">${isAdmin() ? 'นำเข้าแบบฟอร์ม CAPD-Maintenance-Data-Template.xlsx (ชีทผู้ใช้ + Machine Master รวม PM/CAL) หรือไฟล์ DATA.xlsx เดิม · กดรหัสเครื่องเพื่อดู Dashboard' : 'แก้ไขได้เฉพาะ Admin'}</span><div class="sp"></div><label class="sr" for="mq">ค้นหาเครื่อง</label><input id="mq" class="search" placeholder="ค้นหาเครื่อง / Location" value="${esc(S.mq)}"></div>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Machine no.</th><th>Machine Name</th><th>Model</th><th>Serial</th><th>Type</th><th>Location</th><th>Status</th><th>Priority</th><th>Maint. Type</th><th>Responsibility</th><th>Vendor</th><th>Contact</th>${isAdmin() ? '<th></th>' : ''}</tr></thead><tbody>
    ${rows.map(m => `<tr><td class="mono"><a class="folio" href="?m=${encodeURIComponent(m.machine_no)}" data-scan="${esc(m.machine_no)}">${esc(m.machine_no)}</a></td><td>${esc(m.machine_name)}</td><td>${esc(m.model)}</td><td class="mono">${esc(m.serial_number)}</td><td>${esc(m.machine_type)}</td><td>${esc(m.location)}</td><td><span class="pill ${m.status === 'Active' ? 's-confirm' : m.status === 'Maintenance' ? 's-wait' : 's-done'}">${esc(m.status)}</span></td><td class="u-${esc(m.priority)}">${esc(m.priority)}</td><td>${esc(m.maintenance_type)}</td><td>${esc(nm(m.responsibility))}</td><td>${esc(m.supplier)}</td><td>${esc(m.contact_person)}<br><span class="sub">${esc(m.phone)}</span></td>${isAdmin() ? `<td class="row-actions"><button class="btn ghost sm" data-medit="${esc(m.machine_no)}">แก้ไข</button><button class="btn ghost sm" data-qr="${esc(m.machine_no)}">QR</button><button class="btn ghost sm bad-t" data-mdel="${esc(m.machine_no)}">ลบ</button></td>` : ''}</tr>`).join('')}
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

  parts() {
    if (!D.hasParts) return `<div class="h-row"><h1>คลังอะไหล่</h1></div><div class="empty">ยังไม่ได้เปิดคลังอะไหล่ · Admin รัน supabase/v3_6_parts.sql ใน Supabase</div>`;
    let rows = D.parts;
    if (S.pfilter === 'low') rows = lowParts(); else if (S.pfilter === 'off') rows = rows.filter(x => x.active === false); else rows = rows.filter(x => x.active !== false);
    if (S.pq) { const k = S.pq.toLowerCase(); rows = rows.filter(x => [x.part_no, x.name, x.spec, x.location, x.vendor, ...(x.machines || [])].join(' ').toLowerCase().includes(k)); }
    const value = D.parts.reduce((a, x) => a + Number(x.stock || 0) * Number(x.unit_price || 0), 0), low = lowParts();
    const openPR = D.requests.filter(q => q.job_type === 'purchase' && OPEN(q.status));
    return `<div class="h-row"><h1>คลังอะไหล่</h1><span class="sub">${D.parts.length} รายการ · มูลค่าคงคลัง ${num2(value)} บาท</span>
      ${canCreate() ? '<button class="btn" id="prNew">+ คำขอซื้อ</button>' : ''}${canParts() ? '<button class="btn ghost" id="ptAdd">+ เพิ่มอะไหล่</button>' : ''}</div>
    ${low.length ? `<div class="remind"><b>${IC.warn} ต่ำกว่า Min ${low.length} รายการ</b><div class="rrow">${low.slice(0, 6).map(x => `<span><b class="mono">${esc(x.part_no)}</b> ${esc(x.name)} · เหลือ ${qty(x.stock)}/${qty(x.min_qty)}</span>`).join(' · ')}</div>${canCreate() ? '<div><button class="btn sm" id="prLow">ขอซื้อรายการที่ต่ำกว่า Min</button></div>' : ''}</div>` : ''}
    ${openPR.length ? `<h3 class="sec">คำขอซื้อที่ยังไม่ปิด (${openPR.length})</h3>${taskTable(openPR)}<h3 class="sec">ทะเบียนอะไหล่</h3>` : ''}
    <div class="fbar">${[['all', 'ใช้งาน', D.parts.filter(x => x.active !== false).length], ['low', 'ต่ำกว่า Min', low.length], ['off', 'เลิกใช้', D.parts.filter(x => x.active === false).length]].map(([k, l, n]) => `<button class="chip ${(S.pfilter || 'all') === k ? 'on' : ''}" data-pfilter="${k}">${l} <span class="sub">${n}</span></button>`).join('')}
      <div class="sp"></div><label class="sr" for="pq">ค้นหาอะไหล่</label><input id="pq" class="search" placeholder="ค้นหา Part no / ชื่อ / เครื่อง / Rack" value="${esc(S.pq || '')}"></div>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Part no</th><th>ชื่อ / Spec</th><th class="num">คงเหลือ</th><th class="num">Min / Max</th><th>ที่เก็บ</th><th class="num">ราคา/หน่วย</th><th>ใช้กับเครื่อง</th><th></th></tr></thead><tbody>
      ${rows.map(x => { const lo = x.min_qty != null && Number(x.stock) <= Number(x.min_qty); return `<tr><td class="mono"><b>${esc(x.part_no)}</b></td><td>${esc(x.name)}<br><span class="sub">${esc(x.spec || '')}${x.vendor ? ' · ' + esc(x.vendor) : ''}</span></td>
      <td class="num"><span class="pill ${lo ? 's-rej' : 's-confirm'}">${qty(x.stock)} ${esc(x.unit)}</span></td><td class="num">${x.min_qty ?? '-'} / ${x.max_qty ?? '-'}</td><td>${esc(x.location || '-')}</td><td class="num">${x.unit_price != null ? num2(x.unit_price) : '-'}</td>
      <td>${(x.machines || []).map(no => `<a href="#" class="folio" data-scan="${esc(no)}">${esc(no)}</a>`).join(', ') || '-'}</td>
      <td class="row-actions"><button class="btn ghost sm" data-phist="${esc(x.part_no)}">ประวัติ</button>${canParts() ? `<button class="btn ghost sm" data-padj="${esc(x.part_no)}">ปรับยอด</button><button class="btn ghost sm" data-pedit="${esc(x.part_no)}">แก้ไข</button>` : ''}${canCreate() ? `<button class="btn ghost sm" data-pbuy="${esc(x.part_no)}">ขอซื้อ</button>` : ''}</td></tr>`; }).join('')}
    </tbody></table></div>` : '<div class="empty">ไม่พบอะไหล่</div>'}`;
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
    const hasNotify = D.profiles.some(p => 'notify_email' in p);
    const fdSel = (id, v, dis) => `<select id="${id}" class="inp" ${dis ? 'disabled' : ''}><option value="">สำรองทุกประเภท</option>${opts(OPT.fdType, v)}</select>`;
    return `<div class="h-row"><h1>ผู้ใช้และสิทธิ์</h1><span class="sub">${D.profiles.length} คน · ใช้งาน ${activeUsers().length}</span>
      <label class="btn ghost" for="uImport" style="cursor:pointer">นำเข้าผู้ใช้จาก Excel</label><input id="uImport" type="file" accept=".xlsx,.xls" hidden><button class="btn" id="backupBtn">สำรองข้อมูลทั้งหมด</button></div>
    <div class="note" style="margin-bottom:14px">กด <b>สำรองข้อมูลทั้งหมด</b> สัปดาห์ละครั้ง แล้วเก็บไฟล์ไว้ในโฟลเดอร์ของแผนก (ใบงาน, ประวัติ, เครื่องจักร, ผู้ใช้, เอกสาร อยู่ในไฟล์ Excel เดียว) · ไฟล์รูปและเอกสารแนบไม่รวมอยู่ในไฟล์นี้</div>
    <div class="note" style="margin-bottom:14px">ผู้ใช้เข้าระบบด้วยบัญชี Microsoft 365 ของบริษัท เฉพาะอีเมลในรายการนี้ที่ติ๊ก “ใช้งาน” เท่านั้นที่เข้าได้ · Foreman Day รับใบงานตามประเภทเครื่อง (Mold / อื่นๆ ใช้ของเครื่องจักร)</div>
    <div class="tbl-wrap"><table><thead><tr><th>อีเมล</th><th>ชื่อที่แสดง</th><th>บทบาท</th><th>FD ดูแลประเภท</th><th>Admin</th><th>อนุมัติ MEMO</th><th>ใช้งาน</th>${hasNotify ? '<th>รับอีเมล</th>' : ''}<th></th></tr></thead><tbody>
    ${D.profiles.map((p, i) => `<tr class="${p.active === false ? 'off' : ''}"><td>${esc(p.email)}</td>
      <td><label class="sr" for="pn${i}">ชื่อ</label><input id="pn${i}" class="inp" value="${esc(p.full_name || '')}"></td>
      <td><label class="sr" for="pr${i}">บทบาท</label><select id="pr${i}" class="inp" data-rolesel="${i}">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${p.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><label class="sr" for="pf${i}">Foreman Day ดูแลประเภท</label>${fdSel('pf' + i, p.fd_type, p.role !== 'foreman_day')}</td>
      <td class="c"><label class="sr" for="pa${i}">สิทธิ์ Admin</label><input id="pa${i}" type="checkbox" ${p.is_admin || p.role === 'admin' ? 'checked' : ''} ${p.role === 'admin' ? 'disabled' : ''}></td>
      <td class="c"><label class="sr" for="pm${i}">อนุมัติ MEMO</label><input id="pm${i}" type="checkbox" ${p.memo_approver ? 'checked' : ''}></td>
      <td class="c"><label class="sr" for="pact${i}">ใช้งาน</label><input id="pact${i}" type="checkbox" ${p.active !== false ? 'checked' : ''}></td>${hasNotify ? `<td class="c"><label class="sr" for="pne${i}">รับอีเมลแจ้งเตือน</label><input id="pne${i}" type="checkbox" ${p.notify_email !== false ? 'checked' : ''}></td>` : ''}
      <td class="row-actions"><button class="btn sm" data-psave="${i}">บันทึก</button><button class="btn ghost sm" data-pdel="${esc(p.email)}">ลบ</button></td></tr>`).join('')}
    </tbody></table></div>
    <h3 class="sec">เพิ่มผู้ใช้</h3>
    <form id="fPreset" class="form" style="max-width:900px">
      <div class="field"><label for="psEmail">อีเมล *</label><input id="psEmail" class="inp" type="email" required placeholder="name@${esc(C.ALLOWED_DOMAIN)}"></div>
      <div class="field"><label for="psName">ชื่อที่แสดง</label><input id="psName" class="inp"></div>
      <div class="field"><label for="psRole">บทบาท</label><select id="psRole" class="inp" data-rolesel="ps">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><label for="psFd">Foreman Day ดูแลประเภท</label>${fdSel('psFd', '', true)}</div>
      <div class="field"><span class="flabel">สิทธิ์เพิ่มเติม</span><label><input id="psAdmin" type="checkbox"> สิทธิ์ Admin</label><label><input id="psMemo" type="checkbox"> อนุมัติ MEMO ได้ (Manager App)</label></div>
      <div class="full"><button class="btn" type="submit">เพิ่มผู้ใช้</button></div>
    </form>`;
  },

  scan() {
    const m = M(S.scanNo);
    if (!m.machine_no) return '<div class="empty">ไม่พบเครื่องจักรนี้ในระบบ</div>';
    const js = D.requests.filter(q => q.machine_no === m.machine_no);
    const open = js.filter(q => OPEN(q.status));
    const closed = js.filter(q => q.status === 'closed');
    const repairs = closed.filter(q => q.job_type !== 'pmcal');
    const since = new Date(); since.setMonth(since.getMonth() - 12);
    const in12 = q => new Date(q.end_at || q.created_at) >= since;
    const r12 = repairs.filter(in12), p12 = closed.filter(q => q.job_type === 'pmcal' && in12(q));
    const sum = (a, k) => a.reduce((t, q) => t + Number(q[k] || 0), 0);
    const timed = repairs.filter(q => q.start_at && q.end_at);
    const mttr = timed.length ? timed.reduce((t, q) => t + (new Date(q.end_at) - new Date(q.start_at)) / 36e5, 0) / timed.length : null;
    const plan = planList().filter(x => x.m.machine_no === m.machine_no);
    const docs = D.docs.filter(d => d.machine_no === m.machine_no);
    // 12 เดือนล่าสุด: จำนวนงานซ่อม + ค่าใช้จ่าย (ซ่อม / PM-CAL)
    const months = []; for (let i = 11; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); months.push({ y: d.getFullYear(), m: d.getMonth(), n: 0, rc: 0, pc: 0 }); }
    closed.forEach(q => { const d = new Date(q.end_at || q.created_at), x = months.find(k => k.y === d.getFullYear() && k.m === d.getMonth()); if (!x) return; if (q.job_type === 'pmcal') x.pc += Number(q.cost_thb || 0); else { x.n++; x.rc += Number(q.cost_thb || 0); } });
    const mx = Math.max(1, ...months.map(x => x.rc + x.pc)), mn = Math.max(1, ...months.map(x => x.n));
    const chart = `<div class="mchart" role="img" aria-label="ค่าใช้จ่ายและจำนวนงานซ่อม 12 เดือนล่าสุด">${months.map(x => `<div class="mcol" title="${TH[x.m]} ${x.y}: ซ่อม ${x.n} ครั้ง · ค่าซ่อม ${x.rc.toLocaleString()} · PM/CAL ${x.pc.toLocaleString()} บาท">
      <div class="mbar"><i class="pc" style="height:${x.pc / mx * 100}%"></i><i class="rc" style="height:${x.rc / mx * 100}%"></i></div>
      <span class="mcnt">${x.n || ''}</span><span class="mlbl">${TH[x.m]}</span></div>`).join('')}</div>
      <div class="legend"><span><i class="rc"></i>ค่าซ่อม</span><span><i class="pc"></i>ค่า PM/CAL</span><span class="sub">ตัวเลข = จำนวนครั้งที่ซ่อม</span></div>`;
    const stp = d => d < 0 ? `<span class="pill s-rej">เกิน ${-d} วัน</span>` : d <= 90 ? `<span class="pill s-wait">อีก ${d} วัน</span>` : `<span class="pill s-confirm">อีก ${d} วัน</span>`;
    return `<div class="h-row"><h1>${esc(m.machine_no)} · ${esc(m.machine_name)}</h1><span class="pill ${m.status === 'Active' ? 's-confirm' : m.status === 'Maintenance' ? 's-wait' : 's-done'}">${esc(m.status)}</span>
      ${isAdmin() ? `<button class="btn ghost" data-medit="${esc(m.machine_no)}">แก้ไข</button><button class="btn ghost" data-qr="${esc(m.machine_no)}">QR</button>` : ''}</div>
    <div class="mcard"><div><span>Type</span>${esc(m.machine_type || '-')}</div><div><span>Model</span>${esc(m.model || '-')}</div><div><span>Serial</span>${esc(m.serial_number || '-')}</div><div><span>Location</span>${esc(m.location || '-')}</div><div><span>Priority</span>${esc(m.priority)}</div><div><span>Member ผู้รับผิดชอบ</span>${esc(nm(m.responsibility))}</div><div><span>Foreman Day</span>${esc(fdsFor(m.machine_no).map(nm).join(', ') || '-')}</div><div><span>Vendor</span>${esc(m.supplier || '-')} ${esc(m.phone || '')}</div></div>
    ${canCreate() ? `<div class="scan-cta"><button class="btn big" data-newfor="${esc(m.machine_no)}">+ แจ้งซ่อม / เปิดใบงานเครื่องนี้</button></div>` : ''}
    <h3 class="sec">ใบงานที่ค้าง (${open.length})</h3>
    ${open.length ? open.map(q => `<div class="jcard">
      <div class="jinfo"><span class="folio">${esc(q.id)}</span> ${pill(q.status)} <span class="u-${esc(q.urgency)}">${esc(q.urgency)}</span>
        <div>${esc(q.symptom)}</div>
        <div class="sub">${esc(jobType(q))} · เปิดโดย ${esc(nm(q.reporter))} · ${fd(q.created_at)} · ถัดไป: ${esc(ownerText(q))}</div></div>
      <div class="btns"><button class="btn ${isMine(q) ? '' : 'ghost'}" data-open="${esc(q.id)}">${isMine(q) ? 'ดำเนินการ' : 'เปิดใบงาน'}</button></div>
    </div>`).join('') : '<div class="empty">ไม่มีใบงานค้างของเครื่องนี้</div>'}
    <h3 class="sec">Dashboard 12 เดือนล่าสุด</h3>
    <div class="tiles">
      <div class="tile"><b>${r12.length}</b><span>ครั้งที่ซ่อม</span></div>
      <div class="tile"><b>${sum(r12, 'downtime_min').toLocaleString()}</b><span>Downtime (นาที)</span></div>
      <div class="tile"><b>${mttr == null ? '-' : mttr.toFixed(1)}</b><span>MTTR (ชม./งาน) ทั้งหมด</span></div>
      <div class="tile"><b>${sum(r12, 'cost_thb').toLocaleString()}</b><span>ค่าซ่อม (บาท)</span></div>
      <div class="tile"><b>${sum(p12, 'cost_thb').toLocaleString()}</b><span>ค่า PM/CAL (บาท)</span></div>
    </div>
    <div class="grid2">
      <div class="box"><h3>ค่าใช้จ่ายรายเดือน</h3>${closed.length ? chart : '<div class="empty">ยังไม่มีงานที่ปิดแล้ว</div>'}</div>
      <div class="box"><h3>แผน PM / CAL</h3>${plan.length ? `<dl class="kv">${plan.map(x => `<dt>${x.kind}</dt><dd>ล่าสุด ${fd(x.last)} · ทุก ${x.iv} เดือน<br>ครบกำหนด <b>${fd(x.next)}</b> ${stp(x.days)}${x.job ? ` · <a class="folio" href="#" data-open="${esc(x.job.id)}">${esc(x.job.id)}</a>` : ''}</dd>`).join('')}</dl>` : `<div class="empty">ไม่มีแผน (${esc(m.maintenance_type)})</div>`}
        ${vendorBox(m.machine_no)}
        ${(() => { const ps = D.parts.filter(x => (x.machines || []).includes(m.machine_no)); return `<h3 style="margin-top:14px">อะไหล่สำรอง (${ps.length})</h3>${ps.length ? `<div class="tbl-wrap"><table><thead><tr><th>Part no</th><th>ชื่อ</th><th class="num">คงเหลือ</th><th>ที่เก็บ</th></tr></thead><tbody>${ps.map(x => `<tr><td class="mono">${esc(x.part_no)}</td><td>${esc(x.name)}</td><td class="num"><span class="pill ${x.min_qty != null && Number(x.stock) <= Number(x.min_qty) ? 's-rej' : 's-confirm'}">${qty(x.stock)} ${esc(x.unit)}</span></td><td>${esc(x.location || '-')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="sub">ยังไม่มีอะไหล่ที่ผูกกับเครื่องนี้</div>'}`; })()}
        <h3 style="margin-top:14px">เอกสารของเครื่อง (${docs.length})</h3>${docs.length ? docs.map(d => `<div><a href="#" class="folio" data-doc="${d.id}">${esc(d.title)}</a> <span class="sub">${esc(d.kind)}</span></div>`).join('') : '<div class="sub">ยังไม่มีเอกสาร</div>'}</div>
    </div>
    <h3 class="sec">ประวัติการซ่อม / PM / CAL (${closed.length})</h3>
    ${closed.length ? `<div class="tbl-wrap"><table><thead><tr><th>เลขที่</th><th>ประเภท</th><th>อาการ / วิธีแก้</th><th>สาเหตุ</th><th>อะไหล่</th><th>Downtime</th><th>ค่าใช้จ่าย</th><th>เสร็จ</th></tr></thead><tbody>
      ${closed.map(q => `<tr class="click" data-open="${esc(q.id)}"><td class="mono">${esc(q.id)}</td><td>${esc(jobType(q))}</td><td>${esc(q.symptom)}<br><span class="sub">${esc(q.fix_detail || '')}</span></td><td>${esc(q.root_cause || '-')}</td><td>${esc(q.parts_used || '-')}</td><td class="num">${q.downtime_min ?? '-'}</td><td class="num">${q.cost_thb != null ? Number(q.cost_thb).toLocaleString() : '-'}</td><td class="num">${fd(q.end_at, false)}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">ยังไม่มีประวัติ</div>'}`;
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
  return `<ol class="steps">${plan.map((s, i) => { const st = i < cur || q.status === 'closed' ? 'done' : i === cur ? 'now' : ''; return `<li class="${st}"><span class="c">${st === 'done' ? '✓' : i + 1}</span><span class="t">${s[0]}</span></li>`; }).join('')}</ol>`;
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
  const start = q?.down_since ? localInput(q.down_since) : q?.vendor_date ? q.vendor_date + 'T08:00' : q?.start_at ? localInput(q.start_at) : q ? localInput(q.created_at) : localInput(Date.now());
  return `<div class="form">
    <div class="field full"><label for="${p}Fix">วิธีการแก้ไข *</label><textarea id="${p}Fix" class="inp" rows="2"></textarea></div>
    <div class="field"><label for="${p}Cause">สาเหตุ</label><input id="${p}Cause" class="inp"></div>
    <div class="field"><label for="${p}Parts">อะไหล่ที่ใช้</label><input id="${p}Parts" class="inp"></div>
    <div class="field"><label for="${p}Cost">ค่าใช้จ่าย (บาท)</label><input id="${p}Cost" class="inp" type="number" min="0" step="0.01" value="${q?.quotation_amount ?? 0}"></div>
    <div class="field"><label for="${p}Start">เริ่ม</label><input id="${p}Start" class="inp" type="datetime-local" value="${start}"></div>
    <div class="field"><label for="${p}End">เสร็จ</label><input id="${p}End" class="inp" type="datetime-local" value="${localInput(Date.now())}"></div>
    <div class="field"><label for="${p}Down">ระยะเวลา / Downtime (นาที)</label><input id="${p}Down" class="inp" type="number" min="0" placeholder="ว่าง = คำนวณจากเวลาเริ่ม–เสร็จ"></div>
    <div class="field"><label for="${p}Files">รูป / เอกสารหลังซ่อม</label><input id="${p}Files" class="inp" type="file" multiple></div>
    ${issueRows(p, q?.machine_no)}
  </div>`;
}
// เบิกอะไหล่จาก Stock ตอนปิดงาน (อะไหล่ของเครื่องนี้ขึ้นก่อน)
function issueRows(p, mno) {
  const list = D.parts.filter(x => x.active !== false && Number(x.stock) > 0).sort((a, b) => ((b.machines || []).includes(mno) - (a.machines || []).includes(mno)) || a.part_no.localeCompare(b.part_no));
  if (!list.length) return '';
  const o = list.map(x => `<option value="${esc(x.part_no)}">${esc(x.part_no)} · ${esc(x.name)} (คงเหลือ ${qty(x.stock)} ${esc(x.unit)})${(x.machines || []).includes(mno) ? ' ★' : ''}</option>`).join('');
  return `<div class="field full"><span class="flabel">เบิกอะไหล่จาก Stock</span><span class="hint">ตัดยอดคลังให้อัตโนมัติ และบวกค่าอะไหล่เข้าค่าใช้จ่าย · ★ = อะไหล่ของเครื่องนี้</span>
    ${[0, 1, 2].map(i => `<div class="issue-row"><select id="${p}Pt${i}" class="inp" aria-label="อะไหล่รายการที่ ${i + 1}"><option value="">— ไม่เบิก —</option>${o}</select><input id="${p}Pq${i}" class="inp" type="number" min="0" step="any" placeholder="จำนวน" aria-label="จำนวนรายการที่ ${i + 1}"></div>`).join('')}</div>`;
}
function readIssues(p) {
  const out = [];
  for (const i of [0, 1, 2]) {
    const pn = ($('#' + p + 'Pt' + i)?.value || ''), n = parseFloat($('#' + p + 'Pq' + i)?.value);
    if (!pn) continue;
    if (!(n > 0)) { toast('ใส่จำนวนอะไหล่ที่เบิก (' + pn + ')'); return null; }
    if (n > Number(PT(pn).stock)) { toast(`${pn} คงเหลือ ${qty(PT(pn).stock)} ไม่พอเบิก ${n}`); return null; }
    out.push({ part_no: pn, qty: n });
  }
  return out;
}
async function issueParts(reqId, issues) {
  for (const it of issues) {
    const { error } = await sb.from('part_tx').insert({ part_no: it.part_no, qty: -it.qty, kind: 'issue', request_id: reqId, note: 'เบิกใช้ตอนปิดงาน' });
    if (error) throw error;
  }
}
const issueText = issues => issues.map(it => `${it.part_no} ${PT(it.part_no).name || ''} × ${qty(it.qty)}`).join(', ');
const issueCost = issues => issues.reduce((a, it) => a + Number(PT(it.part_no).unit_price || 0) * it.qty, 0);
function readClose(p) {
  const v = id => ($('#' + p + id)?.value || '').trim();
  if (!v('Fix')) { toast('กรอกวิธีการแก้ไข'); return null; }
  const s = v('Start') ? new Date(v('Start')) : null, e = v('End') ? new Date(v('End')) : new Date();
  const mins = v('Down') !== '' ? parseInt(v('Down')) : s ? Math.max(0, Math.round((e - s) / 6e4)) : null;
  const issues = readIssues(p); if (!issues) return null;
  const used = [v('Parts'), issueText(issues)].filter(Boolean).join(', ');
  return { fix_detail: v('Fix'), root_cause: v('Cause') || null, parts_used: used || null, cost_thb: (parseFloat(v('Cost')) || 0) + issueCost(issues), start_at: s ? s.toISOString() : null, end_at: e.toISOString(), downtime_min: mins, closed_by: S.me.email, status: 'closed', _issue: issues };
}
const box = (t, inner) => `<div class="box action"><h3>${t}</h3>${inner}</div>`;
// ---------- ใบเสนอราคา (เทียบราคา 3 ใบ) + ฟอร์ม MEMO ----------
const num2 = v => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const attUrl = path => S.att.find(x => x.path === path)?.url;
function vendorNames(no) {
  const own = new Set(), all = new Set();
  if (M(no).supplier) own.add(M(no).supplier);
  D.requests.forEach(r => { (r.quotes || []).forEach(x => (r.machine_no === no ? own : all).add(x.vendor)); if (r.vendor) (r.machine_no === no ? own : all).add(r.vendor); });
  D.machines.forEach(m => m.supplier && all.add(m.supplier));
  (D.vendors || []).forEach(v => (v.machines || []).includes(no) ? own.add(v.name) : all.add(v.name));
  return [...own, ...[...all].filter(v => !own.has(v))].filter(Boolean);
}
function quoteRows(q) {
  const qs = q.quotes?.length ? q.quotes : (M(q.machine_no).supplier ? [{ vendor: M(q.machine_no).supplier, chosen: true }] : []);
  const hasChosen = qs.some(x => x.chosen);
  return `<datalist id="vlist">${vendorNames(q.machine_no).map(v => `<option value="${esc(v)}">`).join('')}</datalist>
  <div class="tbl-wrap"><table class="qtbl"><thead><tr><th>เลือก</th><th>Vendor</th><th>เลขที่ใบเสนอราคา</th><th>ราคารวม VAT (บาท)</th><th>ส่งของ (วัน)</th><th>ยืนราคาถึง</th><th>ไฟล์ใบเสนอราคา</th></tr></thead><tbody>${[0, 1, 2].map(i => { const x = qs[i] || {}; return `<tr>
    <td class="c"><input type="radio" name="qC" value="${i}" ${x.chosen || (!hasChosen && !i) ? 'checked' : ''} aria-label="เลือกใบที่ ${i + 1}"></td>
    <td><input class="inp" id="qV${i}" list="vlist" value="${esc(x.vendor || '')}" placeholder="Vendor ${i + 1}" aria-label="Vendor ${i + 1}"></td>
    <td><input class="inp" id="qN${i}" value="${esc(x.no || '')}" aria-label="เลขที่ใบเสนอราคา ${i + 1}"></td>
    <td><input class="inp" id="qA${i}" type="number" min="0" step="0.01" value="${x.amount ?? ''}" aria-label="ราคา ${i + 1}"></td>
    <td><input class="inp" id="qL${i}" type="number" min="0" value="${x.lead ?? ''}" aria-label="ส่งของ ${i + 1}"></td>
    <td><input class="inp" id="qX${i}" type="date" value="${esc(x.valid || '')}" aria-label="ยืนราคาถึง ${i + 1}"></td>
    <td>${x.file ? `<span class="attw"><a class="file" href="${esc(attUrl(x.file) || '#')}" target="_blank" rel="noopener">แนบแล้ว</a><button class="attx" type="button" data-attdel="${esc(x.file)}" title="ลบไฟล์ใบเสนอราคาแถว ${i + 1}" aria-label="ลบไฟล์ใบเสนอราคาแถว ${i + 1}">×</button></span><br>` : ''}<input class="inp" id="qF${i}" type="file" aria-label="ไฟล์ใบเสนอราคา ${i + 1}"></td></tr>`; }).join('')}</tbody></table></div>
  <span class="hint">พิมพ์ชื่อ Vendor ใหม่ได้ · แนะนำ 3 ใบ · วิธี “เปรียบเทียบราคา” ต้องมีอย่างน้อย 2 ราย · ใบที่เลือกต้องแนบไฟล์</span>`;
}
function memoDefaults(q) {
  return { to: MEMO_TO, via: '', subject: 'ขออนุมัติจัดหาโดยตรงจากหน่วยงาน', item: q.job_type === 'pmcal' ? `${q.pmcal_kind} เครื่อง ${q.machine_no} ${M(q.machine_no).machine_name || ''}` : q.job_type === 'purchase' ? (q.items || []).map(x => `${x.name} ${qty(x.qty)} ${x.unit || ''}`).join(', ') : q.symptom, reasons: [2], reasonOther: '', method: (q.quotes?.length || 0) >= 2 ? 'compare' : 'special', special: [0], io: '', ce: '523074', cc: '6141-08000', pr: '' };
}
function memoFields(q) {
  const md = { ...memoDefaults(q), ...(q.memo_doc || {}) };
  return `<div class="field full"><span class="flabel">ข้อมูล MEMO (แบบฟอร์ม SC-F-0030 · Direct Purchase Memo)</span><span class="hint" id="authHint"></span></div>
    <div class="field"><span class="flabel">เรียน</span><div style="padding:8px 0">${esc(MEMO_TO)}</div></div>
    <div class="field"><label for="mdVia">ผ่าน (ถ้ามี)</label><input id="mdVia" class="inp" value="${esc(md.via)}"></div>
    <div class="field"><label for="mdSub">เรื่อง</label><input id="mdSub" class="inp" value="${esc(md.subject)}"></div>
    <div class="field"><label for="mfMemoNo">เลขที่ MEMO *</label><input id="mfMemoNo" class="inp" value="${esc(q.memo_no || '')}"></div>
    <div class="field full"><label for="mdItem">รายการที่จัดหา *</label><input id="mdItem" class="inp" value="${esc(md.item)}"></div>
    <div class="field full"><span class="flabel">เหตุผลการจัดหาโดยตรง *</span>${MREASON.map((r, i) => `<label><input type="checkbox" name="mdR" value="${i}" ${md.reasons.includes(i) ? 'checked' : ''}> ${r}</label>`).join('')}
      <input id="mdRo" class="inp" placeholder="ระบุ (เร่งด่วนเนื่องจาก… / เหตุผลอื่น)" value="${esc(md.reasonOther)}" aria-label="ระบุเหตุผลเพิ่มเติม"></div>
    <div class="field full"><span class="flabel">วิธีการจัดหา *</span>${MMETHOD.map(([k, l, d]) => `<label><input type="radio" name="mdM" value="${k}" ${md.method === k ? 'checked' : ''}> ${l} <span class="sub">${d}</span></label>`).join('')}
      <div id="mdSp" style="padding-left:22px" ${md.method === 'special' ? '' : 'hidden'}>${MSPECIAL.map((r, i) => `<label style="display:block"><input type="checkbox" name="mdS" value="${i}" ${md.special.includes(i) ? 'checked' : ''}> ${r}</label>`).join('')}</div></div>
    <div class="field"><label for="mdIo">I/O No.</label><input id="mdIo" class="inp" value="${esc(md.io)}"></div>
    <div class="field"><label for="mdCe">Cost element</label><input id="mdCe" class="inp" value="${esc(md.ce)}"></div>
    <div class="field"><label for="mdCc">Cost center</label><input id="mdCc" class="inp" value="${esc(md.cc)}"></div>
    <div class="field"><label for="mdPr">PR No. (ถ้ามี)</label><input id="mdPr" class="inp" value="${esc(md.pr)}"></div>`;
}
function memoForm(q) {
  const apps = memoApprovers();
  const sel = i => `<div class="field"><label for="mfApp${i}">App ${i + 1}${i === 0 ? ' *' : ''}</label><select id="mfApp${i}" class="inp">${userOpts(apps, q.memo_approvers[i], i === 0 ? '— เลือกผู้อนุมัติ —' : '— ไม่มี —')}</select></div>`;
  return `<div class="form">
    <div class="field full"><span class="flabel">ใบเสนอราคา (แนะนำ 3 ใบเพื่อเทียบราคา · เลือกใบที่จะใช้)</span>${quoteRows(q)}</div>
    <div class="field"><label for="qS">เหตุผลที่เลือก</label><input id="qS" class="inp" value="${esc(q.select_reason || 'ราคาต่ำสุด')}"></div>
    <div class="field"><label for="qR">ถ้ามีน้อยกว่า 3 ใบ เพราะ</label><input id="qR" class="inp" value="${esc(q.quote_reason || '')}" placeholder="เช่น อะไหล่แท้มีตัวแทนเจ้าเดียว"></div>
    ${memoFields(q)}
    <div class="field"><label for="mfMemo">ไฟล์ MEMO ที่ลงนามแล้ว (ถ้ามี)</label><input id="mfMemo" class="inp" type="file" multiple></div>
    <div class="field full"><span class="flabel">ผู้อนุมัติ MEMO ตามลำดับ</span><span class="hint">อนุมัติทีละคน App 1 → App 2 → App 3 · รายชื่อมาจากผู้ใช้ที่ Admin ติ๊ก “อนุมัติ MEMO ได้”</span></div>
    ${sel(0)}${sel(1)}${sel(2)}
  </div>`;
}
// อ่านแถวใบเสนอราคาจากฟอร์ม (null = ข้อมูลไม่ครบ)
function readQuotes(q) {
  const v = id => ($('#' + id)?.value || '').trim(), ci = +(document.querySelector('input[name=qC]:checked')?.value || 0);
  const out = [];
  for (const i of [0, 1, 2]) {
    const vendor = v('qV' + i), amt = v('qA' + i);
    if (!vendor && amt === '') continue;
    if (!vendor || amt === '' || isNaN(parseFloat(amt))) { toast(`ใบเสนอราคาแถว ${i + 1}: กรอกทั้ง Vendor และราคา`); return null; }
    out.push({ i, vendor, no: v('qN' + i) || null, amount: parseFloat(amt), lead: v('qL' + i) === '' ? null : parseInt(v('qL' + i)), valid: v('qX' + i) || null, file: (q.quotes || [])[i]?.vendor === vendor ? (q.quotes[i].file || null) : null, chosen: i === ci });
  }
  return out;
}
function readMemo() {
  const v = id => ($('#' + id)?.value || '').trim(), all = n => [...document.querySelectorAll(`input[name=${n}]:checked`)].map(x => +x.value);
  return { to: MEMO_TO, via: v('mdVia'), subject: v('mdSub'), item: v('mdItem'), reasons: all('mdR'), reasonOther: v('mdRo'), method: document.querySelector('input[name=mdM]:checked')?.value || null, special: all('mdS'), io: v('mdIo'), ce: v('mdCe'), cc: v('mdCc'), pr: v('mdPr') };
}
function authHint() {
  const h = $('#authHint'); if (!h) return;
  const ci = +(document.querySelector('input[name=qC]:checked')?.value || 0), amt = parseFloat($('#qA' + ci)?.value);
  h.innerHTML = isNaN(amt) ? '' : `ราคาที่เลือก ${num2(amt)} บาท · ตามอำนาจดำเนินการ GSC ต้องให้ <b>${authLevel(amt)}</b> อนุมัติ`;
}
function quoteTable(q) {
  const qs = q.quotes || []; if (!qs.length) return '';
  const min = Math.min(...qs.map(x => Number(x.amount))), today = todayStr();
  const prev = D.requests.filter(x => x.id !== q.id && x.machine_no === q.machine_no && x.job_type === q.job_type && (x.job_type !== 'pmcal' || x.pmcal_kind === q.pmcal_kind) && x.status === 'closed' && x.quotation_amount != null).sort((a, b) => String(b.end_at).localeCompare(String(a.end_at)))[0];
  const cur = Number(q.quotation_amount ?? qs.find(x => x.chosen)?.amount ?? 0);
  return `<div class="tbl-wrap"><table><thead><tr><th>Vendor</th><th>เลขที่</th><th class="num">ราคารวม VAT (บาท)</th><th class="num">ส่งของ</th><th>ยืนราคาถึง</th><th>ไฟล์</th><th></th></tr></thead><tbody>${qs.map(x => `<tr class="${x.chosen ? 'chosen' : ''}"><td>${esc(x.vendor)}</td><td class="mono">${esc(x.no || '-')}</td><td class="num">${num2(x.amount)}${Number(x.amount) === min && qs.length > 1 ? ' <span class="pill s-confirm">ต่ำสุด</span>' : ''}</td><td class="num">${x.lead != null ? x.lead + ' วัน' : '-'}</td><td>${x.valid ? fd(x.valid) + (x.valid < today && OPEN(q.status) ? ' <span class="pill s-rej">หมดอายุ</span>' : '') : '-'}</td><td>${x.file && attUrl(x.file) ? `<a class="file" href="${esc(attUrl(x.file))}" target="_blank" rel="noopener">เปิด</a>` : '-'}</td><td>${x.chosen ? '<b>เลือก</b>' : ''}</td></tr>`).join('')}</tbody></table></div>
  ${qs.length < 3 ? `<p class="sub" style="margin:6px 0 0">มี ${qs.length} ใบ (แนะนำ 3 ใบ)${q.quote_reason ? ' · ' + esc(q.quote_reason) : ''}</p>` : ''}${q.select_reason ? `<p class="sub" style="margin:4px 0 0">เหตุผลที่เลือก: ${esc(q.select_reason)}</p>` : ''}
  ${prev ? `<p class="sub" style="margin:4px 0 0">ครั้งก่อน ${esc(prev.id)} (${fd(prev.end_at, false)}): ${esc(prev.vendor || '-')} ${money(prev.quotation_amount)}${cur && Number(prev.quotation_amount) ? ' · ครั้งนี้' + (cur >= Number(prev.quotation_amount) ? 'แพงขึ้น ' : 'ถูกลง ') + Math.abs((cur - prev.quotation_amount) / prev.quotation_amount * 100).toFixed(0) + '%' : ''}</p>` : ''}`;
}
// เวลาที่ App แต่ละคนอนุมัติ (จากประวัติ หลังการส่ง MEMO ครั้งล่าสุด)
function memoApprovedAt(i) {
  let start = -1; S.logs.forEach((l, k) => { if (/^ส่ง MEMO /.test(l.action)) start = k; });
  return S.logs.slice(start + 1).find(l => l.action.startsWith(`App ${i + 1} อนุมัติ MEMO`));
}
function memoHtml(q, md, qs, apps, preview) {
  const ch = qs.find(x => x.chosen) || qs[0] || {}, bx = on => on ? '☑' : '☐', m = M(q.machine_no);
  const done = st => !preview && (['po_vendor', 'closed'].includes(q.status) || (q.status === 'memo_approval' && st < q.memo_step));
  const sig = (who, i) => { const l = i == null ? null : done(i) && memoApprovedAt(i); return `<div class="msig">${i == null ? (preview ? '<span class="sub">ส่งในระบบเมื่อกดส่ง MEMO</span>' : `<span class="ok-t">ส่งในระบบ ${fd(md.date)}</span>`) : done(i) ? `<span class="ok-t">อนุมัติในระบบ${l ? ' ' + fd(l.at) : ''}</span>` : '<span class="sub">รออนุมัติ</span>'}</div><b>( ${esc(nm(who))} )</b>`; };
  return `<div class="memo-doc">
    <div class="memo-title">DIRECT PURCHASE MEMO</div>
    <table class="memo-hd"><tbody>
      <tr><td class="lab">เรียน</td><td><b>${esc(md.to || MEMO_TO)}</b></td><td style="width:34%">DATE : ${fd(md.date || todayStr())}</td></tr>
      <tr><td class="lab">ผ่าน</td><td>${esc(md.via || '')}</td><td>PR No : ${esc(md.pr || '')}</td></tr>
      <tr><td class="lab">จาก</td><td><b>${esc(nm(md.from || S.me.email))}</b></td><td>MEMO No : ${esc(q.memo_no || md.no || '')}</td></tr>
      <tr><td colspan="3"><b>เรื่อง : ${esc(md.subject)}</b></td></tr></tbody></table>
    <div class="memo-body">
      <p class="ind">ตามที่หน่วยงาน CaPD${m.machine_no ? ' ซึ่งเป็นผู้ดูแลเครื่อง ' + esc(m.machine_no) + ' ' + esc(m.machine_name) : ''} ได้รับมอบหมายให้ดำเนินการจัดหา ${esc(md.item)} มูลค่า ${num2(ch.amount)} บาท (รวม VAT) นั้น</p>
      <p class="ind">การจัดซื้อจัดจ้างดังกล่าวมีความจำเป็นต้องดำเนินการโดยวิธีเฉพาะเจาะจง จาก ${esc(ch.vendor || '')} ${ch.no ? '(ใบเสนอราคา ' + esc(ch.no) + ')' : ''} ด้วยเหตุผลดังต่อไปนี้</p>
      ${MREASON.map((r, i) => `<div>${bx(md.reasons.includes(i))} ${r}${(i === 0 || i === 3) && md.reasons.includes(i) && md.reasonOther ? ' ' + esc(md.reasonOther) : ''}</div>`).join('')}
      <div style="margin-top:6px">ด้วยเหตุผลดังกล่าวจึงขออนุมัติจัดหาโดยตรงด้วยวิธี</div>
      ${MMETHOD.map(([k, l, d]) => `<div>${bx(md.method === k)} ${l} <span class="sub">${d}</span></div>`).join('')}
      ${md.method === 'special' ? `<div style="padding-left:2em">เนื่องจาก${MSPECIAL.map((r, i) => `<div>${bx(md.special.includes(i))} ${r}</div>`).join('')}</div>` : ''}
      ${qs.length > 1 ? `<div style="margin-top:6px"><b>ราคาเปรียบเทียบ:</b> ${qs.map(x => `${esc(x.vendor)} ${num2(x.amount)} บาท${x.chosen ? ' (เลือก)' : ''}`).join(' · ')}</div>` : ''}
      <div style="margin-top:8px"><b>งบประมาณที่ใช้ในการดำเนินการ</b> I/O No. ${esc(md.io || '…………')} &nbsp; Cost element ${esc(md.ce || '…………')} &nbsp; Cost center ${esc(md.cc || '…………')}</div>
    </div>
    <div class="memo-sign">
      <div>จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ${sig(md.from || S.me.email, null)}<div>ผู้ขออนุมัติ</div></div>
      <div>อนุมัติ${apps.map((e, i) => `<div style="margin-top:6px">${sig(e, i)}<div>App ${i + 1}</div></div>`).join('') || '<div class="sub">ยังไม่ได้เลือกผู้อนุมัติ</div>'}</div>
    </div>
    <table class="memo-auth"><tbody><tr><td colspan="3"><b>อำนาจดำเนินการ GSC</b></td></tr>${AUTH.map(([lim, l], i) => `<tr class="${authLevel(ch.amount) === l ? 'hit' : ''}"><td>${i < 3 ? 'ไม่เกิน' : 'เกิน'}</td><td>${i < 3 ? lim.toLocaleString() + ' บาท' : '1 ล้านบาท'}</td><td>${l}</td></tr>`).join('')}</tbody></table>
    <div class="memo-note">หมายเหตุ : ระดับการอนุมัติในตารางไว้ใช้สำหรับอ้างอิงเบื้องต้นเท่านั้น สามารถตรวจสอบรายละเอียดได้จากอนก.ของแต่ละบริษัท</div>
    <div class="memo-rev">SC-F-0030 - REV0</div></div>`;
}
function memoModal(q, md, qs, apps, preview) {
  modal(`<div class="btns noprint" style="justify-content:space-between;align-items:center;margin-bottom:10px"><h2 style="margin:0">${preview ? 'ตัวอย่าง ' : ''}MEMO ${esc(q.memo_no || '')}</h2><div class="btns"><button class="btn" id="memoPrint">พิมพ์ / บันทึก PDF</button><button class="btn ghost" data-close>ปิด</button></div></div>
    ${preview ? '<p class="sub noprint" style="margin-top:0">ตัวอย่างจากข้อมูลที่กรอก ยังไม่ได้บันทึก</p>' : ''}${memoHtml(q, md, qs, apps, preview)}`);
  document.body.classList.add('printing-memo');
  const bg = $('#modal'); const obs = new MutationObserver(() => { if (!document.body.contains(bg)) { document.body.classList.remove('printing-memo'); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
  $('#memoPrint').onclick = () => window.print();
}
function openMemo(q) { memoModal(q, { ...memoDefaults(q), ...(q.memo_doc || {}) }, q.quotes || [], q.memo_approvers || [], false); }
function previewMemo(q) {
  const qs = readQuotes(q); if (!qs) return;
  memoModal({ ...q, memo_no: ($('#mfMemoNo')?.value || '').trim() }, readMemo(), qs, [0, 1, 2].map(i => ($('#mfApp' + i)?.value || '')).filter(Boolean), true);
}
// Dashboard เครื่อง: Vendor ที่เคยเสนอราคา
function vendorBox(no) {
  const js = D.requests.filter(r => r.machine_no === no), st = {};
  js.forEach(r => (r.quotes || []).forEach(x => { const o = st[x.vendor] ||= { n: 0, won: 0, last: null, leads: [] }; o.n++; if (x.chosen && r.status !== 'memo_rejected') o.won++; if (x.lead != null) o.leads.push(x.lead); if (!o.last || r.created_at > o.last.at) o.last = { amount: x.amount, at: r.created_at, id: r.id }; }));
  const sup = M(no).supplier; if (sup && !st[sup]) st[sup] = { n: 0, won: 0, last: null, leads: [] };
  (D.vendors || []).filter(v => (v.machines || []).includes(no) && v.active !== false).forEach(v => { st[v.name] ||= { n: 0, won: 0, last: null, leads: [] }; });
  const rows = Object.entries(st).sort((a, b) => b[1].won - a[1].won || b[1].n - a[1].n);
  return `<h3 style="margin-top:14px">Vendor และราคา <span class="pill ${rows.length >= 3 ? 's-confirm' : 's-wait'}">${rows.length} ราย${rows.length < 3 ? ' · แนะนำอย่างน้อย 3 ราย' : ''}</span></h3>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Vendor</th><th class="num">เสนอราคา</th><th class="num">ได้งาน</th><th class="num">ราคาล่าสุด</th><th class="num">ส่งของเฉลี่ย</th></tr></thead><tbody>${rows.map(([v, o]) => `<tr><td>${esc(v)}${v === sup ? ' <span class="sub">(Machine Master)</span>' : ''}</td><td class="num">${o.n}</td><td class="num">${o.won}</td><td class="num">${o.last ? num2(o.last.amount) + `<br><span class="sub">${esc(o.last.id)}</span>` : '-'}</td><td class="num">${o.leads.length ? Math.round(o.leads.reduce((a, b) => a + b, 0) / o.leads.length) + ' วัน' : '-'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="sub">ยังไม่มีข้อมูล Vendor</div>'}`;
}
function actions(q) {
  if (!OPEN(q.status)) return '';
  const me = S.me.email, mine = isMine(q) || isAdmin();
  const waitNote = () => `<div class="note">ขั้นตอนนี้รอ <b>${esc(ownerText(q))}</b></div>`;
  switch (q.status) {
    case 'pending_fd':
      if (!canFD(q.machine_no)) return waitNote();
      if (q.job_type === 'purchase') return box('Foreman Day: อนุมัติคำขอซื้อ', `${itemsTable(q)}<div class="form" style="margin-top:10px">
          <div class="field"><label for="apAssignee">ผู้รับผิดชอบ (ขอใบเสนอราคา / MEMO / รับของ)</label><select id="apAssignee" class="inp">${userOpts([S.me, ...usersBy('member', 'foreman_day').filter(u => u.email !== me)], q.reporter === me || !activeUsers().some(u => u.email === q.reporter && ['member', 'foreman_day'].includes(u.role)) ? me : q.reporter)}</select></div>
          <div class="field"><label for="apNote">หมายเหตุ (ต้องกรอกถ้าไม่อนุมัติ)</label><input id="apNote" class="inp"></div></div>
        <div class="btns" style="margin-top:12px"><button class="btn ok" data-act="fd_approve">อนุมัติคำขอซื้อ</button><button class="btn bad" data-act="fd_reject">ไม่อนุมัติ · ส่งกลับ</button></div>`);
      return box('Foreman Day: อนุมัติซ่อม' + (!fdsFor(q.machine_no).includes(me) && fdsFor(q.machine_no).length ? ' <span class="sub">(แทน ' + esc(fdsFor(q.machine_no).map(nm).join(', ')) + ')</span>' : ''), `<div class="choice">
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
      if (!canFD(q.machine_no)) return waitNote();
      return box(`Foreman Day: สรุปผลการซ่อมของ ${esc(q.repair_unit)} แล้วปิดงาน`, closeFields('ex', q) + `<div class="btns" style="margin-top:12px"><button class="btn ok" data-act="close_ext">สรุปและปิดงาน</button></div>`);
    case 'quotation': case 'memo_rejected':
      if (!(mine || is('foreman_day'))) return waitNote();
      return (q.job_type === 'pmcal' && !q.action_at ? box('เริ่มดำเนินการ PM/CAL', `<p class="sub" style="margin-top:0">กดเมื่อเริ่มขอใบเสนอราคาจาก Vendor แล้ว ระบบจะหยุดส่งอีเมลเตือน</p><div class="btns"><button class="btn warn" data-act="pm_action">เริ่มดำเนินการแล้ว</button></div>`) : '')
        + box(q.status === 'memo_rejected' ? 'แก้ไข MEMO แล้วส่งอนุมัติใหม่' : 'ใบเสนอราคา และออก MEMO', (q.status === 'memo_rejected' ? `<p class="u-Critical" style="margin-top:0">MEMO ไม่อนุมัติ: ${esc(q.return_note || '-')}</p>` : '') + memoForm(q) + `<div class="btns" style="margin-top:12px"><button class="btn ghost" id="memoPrev" type="button">ดูตัวอย่าง MEMO</button><button class="btn ghost" data-act="memo_draft">บันทึกร่าง</button><button class="btn ok" data-act="memo_submit">ส่ง MEMO ให้ Manager อนุมัติ</button></div>`);
    case 'memo_approval': {
      const cur = q.memo_approvers[q.memo_step];
      if (cur !== me) return waitNote();
      return box(`App ${q.memo_step + 1}: พิจารณา MEMO ${esc(q.memo_no || '')}`, `<p style="margin-top:0">เลือก <b>${esc(q.vendor || '-')}</b> · ราคา <b>${money(q.quotation_amount)}</b> · วงเงินนี้ต้องอนุมัติระดับ <b>${authLevel(q.quotation_amount)}</b></p>
        ${quoteTable(q)}${(q.quotes || []).some(x => x.chosen && x.valid && x.valid < todayStr()) ? '<div class="note" style="margin-top:8px;background:var(--bad-bg)">ใบเสนอราคาที่เลือกหมดอายุยืนราคาแล้ว ควรขอยืนยันราคากับ Vendor ก่อนอนุมัติ</div>' : ''}
        ${q.memo_doc ? '<div class="btns" style="margin:8px 0"><button class="btn ghost sm" data-memo="1">เปิด MEMO</button></div>' : ''}
        <div class="field"><label for="maNote">ความเห็น (ต้องกรอกถ้าไม่อนุมัติ)</label><input id="maNote" class="inp"></div>
        <div class="btns" style="margin-top:12px"><button class="btn ok" data-act="memo_approve">อนุมัติ</button><button class="btn bad" data-act="memo_reject">ไม่อนุมัติ · ส่งกลับแก้ไข</button></div>`);
    }
    case 'po_vendor': {
      let html = '';
      if (isAdmin() && !q.po_no) html += box('Admin: ออก PO', `<div class="form"><div class="field"><label for="poNo">เลขที่ PO *</label><input id="poNo" class="inp"></div><div class="field"><label for="poFiles">ไฟล์ PO</label><input id="poFiles" class="inp" type="file" multiple></div></div><div class="btns" style="margin-top:12px"><button class="btn ok" data-act="po_save">บันทึก PO</button></div>`);
      if (q.job_type === 'purchase' && (q.assignee === me || canFD(q.machine_no) || isAdmin())) {
        html += box('รับของ แล้วปิดคำขอซื้อ', q.po_no ? receiveForm(q) : '<div class="note">รับของได้หลังจาก Admin บันทึกเลขที่ PO แล้ว</div>');
      } else if (q.assignee === me || canFD(q.machine_no) || isAdmin()) {
        html += box('นัด Vendor เข้าดำเนินการ', `<div class="form"><div class="field"><label for="vdDate">วันนัด Vendor</label><input id="vdDate" class="inp" type="date" value="${esc(q.vendor_date || '')}"></div></div><div class="btns" style="margin-top:12px"><button class="btn" data-act="vendor_date">บันทึกวันนัด</button></div>`);
        html += box('สรุปผลก่อนปิดงาน', q.po_no ? closeFields('pv', q) + `<div class="btns" style="margin-top:12px"><button class="btn ok" data-act="close_special">สรุปและปิดงาน</button></div>` : '<div class="note">ปิดงานได้หลังจาก Admin บันทึกเลขที่ PO แล้ว</div>');
      }
      return html || waitNote();
    }
  }
  return '';
}

// พักงาน: คนที่ต้องทำขั้นนี้ หรือ Foreman Day ของเครื่อง หรือ Admin (ฐานข้อมูลตรวจซ้ำ)
const canHold = q => HOLD_STATUSES.includes(q.status) && (isAdmin() || isMine(q) || canFD(q.machine_no));
function holdBox(q) {
  if (!canHold(q)) return '';
  if (q.hold_reason) return `<div class="box hold"><h3>พักงานอยู่: ${esc(q.hold_reason)}</h3><p class="sub" style="margin-top:0">ตั้งแต่ ${fd(q.hold_since)} (${daysSince(q.hold_since)} วัน)${q.hold_note ? ' · ' + esc(q.hold_note) : ''}</p><div class="btns"><button class="btn" data-act="hold_off">ดำเนินการต่อ</button></div></div>`;
  return `<details class="box holdq"><summary>พักงาน (รออะไหล่ / รอ Vendor)</summary><div class="form" style="margin-top:10px">
    <div class="field"><label for="hdReason">เหตุผล</label><select id="hdReason" class="inp">${opts(HOLD_REASONS)}</select></div>
    <div class="field"><label for="hdNote">รายละเอียด</label><input id="hdNote" class="inp" placeholder="เช่น สั่ง Bearing แล้ว คาดว่าได้ 20 พ.ย."></div></div>
    <div class="btns" style="margin-top:10px"><button class="btn ghost" data-act="hold_on">พักงาน</button></div></details>`;
}

// ---------- คำขอซื้อ ----------
function itemsTable(q) {
  const it = q.items || []; if (!it.length) return '';
  return `<div class="tbl-wrap"><table><thead><tr><th>รายการ</th><th>Part no</th><th class="num">จำนวน</th>${it.some(x => x.recv != null) ? '<th class="num">รับแล้ว</th><th>คลัง</th>' : ''}</tr></thead><tbody>${it.map(x => `<tr><td>${esc(x.name)}</td><td class="mono">${esc(x.part_no || '-')}</td><td class="num">${qty(x.qty)} ${esc(x.unit || '')}</td>${it.some(y => y.recv != null) ? `<td class="num">${x.recv != null ? qty(x.recv) : '-'}</td><td>${x.stocked ? '<span class="pill s-confirm">เข้าคลัง</span>' : '<span class="sub">ไม่เก็บ Stock</span>'}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}
function receiveForm(q) {
  return `<p class="sub" style="margin-top:0">ใส่จำนวนที่รับจริง · รายการที่มี Part no เข้าคลังอัตโนมัติ${canParts() ? ' · รายการใหม่ติ๊ก “เพิ่มเป็นอะไหล่” เพื่อเปิดรหัสใหม่' : ''}</p>
  <div class="tbl-wrap"><table class="qtbl"><thead><tr><th>รายการ</th><th class="num">สั่ง</th><th>รับจริง</th><th>คลังอะไหล่</th></tr></thead><tbody>${(q.items || []).map((x, i) => `<tr><td>${esc(x.name)}${x.part_no ? `<br><span class="sub mono">${esc(x.part_no)}</span>` : ''}</td><td class="num">${qty(x.qty)} ${esc(x.unit || '')}</td>
    <td><input id="rcQ${i}" class="inp" type="number" min="0" step="any" value="${x.qty}" aria-label="รับจริงรายการที่ ${i + 1}"></td>
    <td>${x.part_no ? `<span class="pill s-confirm">เข้าคลัง ${esc(x.part_no)}</span>` : canParts() ? `<label><input type="checkbox" id="rcNew${i}"> เพิ่มเป็นอะไหล่</label><input id="rcPn${i}" class="inp" placeholder="Part no ใหม่" style="margin-top:4px" aria-label="Part no ใหม่รายการที่ ${i + 1}">` : '<span class="sub">ค่าใช้จ่าย ไม่เก็บ Stock</span>'}</td></tr>`).join('')}</tbody></table></div>
  <div class="form" style="margin-top:10px"><div class="field"><label for="rcNote">หมายเหตุการรับของ</label><input id="rcNote" class="inp" placeholder="เช่น รับครบ ใบส่งของเลขที่ …"></div>
    <div class="field"><label for="rcFiles">ใบส่งของ / รูป</label><input id="rcFiles" class="inp" type="file" multiple></div></div>
  <div class="btns" style="margin-top:12px"><button class="btn ok" data-act="recv_close">รับของและปิดคำขอซื้อ</button></div>`;
}
async function receiveAndClose(q) {
  const items = (q.items || []).map((x, i) => ({ ...x, recv: parseFloat($('#rcQ' + i)?.value) || 0 }));
  const newParts = [];
  for (const [i, x] of items.entries()) if (!x.part_no && $('#rcNew' + i)?.checked) {
    const pn = ($('#rcPn' + i)?.value || '').trim();
    if (!pn) return toast('ใส่ Part no ใหม่ของ ' + x.name);
    if (D.parts.some(y => y.part_no === pn)) return toast('Part no ' + pn + ' มีอยู่แล้ว');
    newParts.push(pn); x.part_no = pn; x.newPart = true;
  }
  $$('[data-act]').forEach(b => b.disabled = true);
  try {
    const total = items.reduce((a, x) => a + x.recv, 0), price = total && q.quotation_amount ? Math.round(Number(q.quotation_amount) / total * 100) / 100 : null;
    for (const x of items) if (x.newPart) {
      const { error } = await sb.from('spare_parts').insert({ part_no: x.part_no, name: x.name, unit: x.unit || 'ชิ้น', unit_price: items.length === 1 ? price : null, machines: q.machine_no ? [q.machine_no] : [], vendor: q.vendor || null });
      if (error) throw error;
    }
    for (const x of items) if (x.part_no && x.recv > 0) {
      const { error } = await sb.from('part_tx').insert({ part_no: x.part_no, qty: x.recv, kind: 'receive', request_id: q.id, unit_price: items.length === 1 ? price : null, note: 'รับของจาก ' + q.id });
      if (error) throw error;
      x.stocked = true;
    }
    const files = await uploadFiles(q.id, 'close', filesOf('rcFiles'));
    const txt = items.map(x => `${x.name} × ${qty(x.recv)}${x.stocked ? ' (เข้าคลัง ' + x.part_no + ')' : ''}`).join(', ');
    const note = ($('#rcNote')?.value || '').trim();
    const { error } = await sb.from('requests').update({ status: 'closed', items: items.map(({ newPart, ...x }) => x), fix_detail: 'รับของ: ' + txt + (note ? ' · ' + note : ''), parts_used: txt, cost_thb: Number(q.quotation_amount || 0), end_at: new Date().toISOString(), attachments: [...(q.attachments || []), ...files] }).eq('id', q.id);
    if (error) throw error;
    await addLog(q.id, 'รับของและปิดคำขอซื้อ · ' + txt + (newParts.length ? ' · เพิ่มอะไหล่ใหม่ ' + newParts.join(', ') : ''));
    toast('รับของและปิดคำขอซื้อแล้ว'); await loadAll(); openDetail(q.id, false);
  } catch (e) { $$('[data-act]').forEach(b => b.disabled = false); fail(e); }
}
function purchaseForm(prefill = []) {
  const rows = prefill.length ? prefill : [{}];
  const ms = D.machines.filter(m => m.status !== 'Inactive');
  modal(`<h2>คำขอซื้อ</h2><p class="sub" style="margin-top:0">ส่งให้ Foreman Day อนุมัติ แล้วต่อด้วยใบเสนอราคา / MEMO / PO / รับของเข้าคลัง</p>
    <datalist id="plist">${D.parts.map(x => `<option value="${esc(x.part_no)}">${esc(x.name)} · คงเหลือ ${qty(x.stock)}</option>`).join('')}</datalist>
    <div class="form"><div class="field"><label for="prMachine">ใช้กับเครื่อง</label><select id="prMachine" class="inp"><option value="">— ไม่ระบุ (ใช้ทั่วไป) —</option>${ms.map(m => `<option value="${esc(m.machine_no)}" ${prefill[0] && (PT(prefill[0].part_no).machines || [])[0] === m.machine_no ? 'selected' : ''}>${esc(m.machine_no)} · ${esc(m.machine_name)}</option>`).join('')}</select></div>
    <div class="field"><span class="flabel">ความเร่งด่วน</span><div class="urg">${OPT.prio.map((p, i) => `<label class="u-${p}" for="prUrg${i}"><input type="radio" name="prUrg" id="prUrg${i}" value="${p}" ${p === 'Normal' ? 'checked' : ''}>${p}</label>`).join('')}</div></div>
    <div class="field full"><label for="prWhy">เหตุผลที่ขอซื้อ *</label><input id="prWhy" class="inp" value="${prefill.length ? 'เติม Stock อะไหล่ที่ต่ำกว่า Min' : ''}"></div></div>
    <div class="tbl-wrap" style="margin-top:12px"><table class="qtbl"><thead><tr><th>Part no (ถ้ามี)</th><th>ชื่อรายการ *</th><th>จำนวน *</th><th>หน่วย</th></tr></thead><tbody id="prRows">${[0, 1, 2, 3, 4].map(i => { const x = rows[i] || {}, pt = PT(x.part_no); return `<tr>
      <td><input id="prPn${i}" class="inp" list="plist" value="${esc(x.part_no || '')}" aria-label="Part no รายการที่ ${i + 1}"></td><td><input id="prNm${i}" class="inp" value="${esc(x.name || pt.name || '')}" aria-label="ชื่อรายการที่ ${i + 1}"></td>
      <td><input id="prQ${i}" class="inp" type="number" min="0" step="any" value="${x.qty ?? ''}" aria-label="จำนวนรายการที่ ${i + 1}" style="width:90px"></td><td><input id="prU${i}" class="inp" value="${esc(x.unit || pt.unit || '')}" aria-label="หน่วยรายการที่ ${i + 1}" style="width:80px"></td></tr>`; }).join('')}</tbody></table></div>
    <div class="btns" style="margin-top:14px"><button class="btn" id="prGo">ส่งคำขอซื้อ</button><button class="btn ghost" data-close>ยกเลิก</button></div>`);
  [0, 1, 2, 3, 4].forEach(i => { $('#prPn' + i).onchange = () => { const pt = PT($('#prPn' + i).value.trim()); if (pt.part_no) { if (!$('#prNm' + i).value) $('#prNm' + i).value = pt.name; if (!$('#prU' + i).value) $('#prU' + i).value = pt.unit; } }; });
  $('#prGo').onclick = async () => {
    const items = [];
    for (const i of [0, 1, 2, 3, 4]) {
      const pn = $('#prPn' + i).value.trim(), name = $('#prNm' + i).value.trim(), n = parseFloat($('#prQ' + i).value);
      if (!pn && !name) continue;
      if (pn && !PT(pn).part_no) return toast('ไม่พบ Part no ' + pn + ' (ถ้าเป็นของใหม่ เว้นช่อง Part no ไว้)');
      if (!name || !(n > 0)) return toast(`รายการที่ ${i + 1}: ใส่ชื่อและจำนวน`);
      items.push({ part_no: pn || null, name, qty: n, unit: $('#prU' + i).value.trim() || PT(pn).unit || 'ชิ้น' });
    }
    if (!items.length) return toast('ใส่รายการที่ขอซื้ออย่างน้อย 1 รายการ');
    const why = $('#prWhy').value.trim(); if (!why) return toast('ใส่เหตุผลที่ขอซื้อ');
    $('#prGo').disabled = true;
    const { data, error } = await sb.from('requests').insert({ machine_no: $('#prMachine').value || null, reporter: S.me.email, job_type: 'purchase', status: 'pending_fd', items, urgency: document.querySelector('input[name=prUrg]:checked').value, symptom: 'ขอซื้อ: ' + items.map(x => `${x.name} × ${qty(x.qty)}`).join(', ') + ' · ' + why }).select().single();
    if (error) { $('#prGo').disabled = false; return fail(error); }
    await addLog(data.id, 'เปิดคำขอซื้อ ' + items.length + ' รายการ ส่ง Foreman Day อนุมัติ');
    closeModal(); toast(data.id + ' ส่งคำขอซื้อแล้ว'); await loadAll(); openDetail(data.id);
  };
}

// ---------- ทะเบียนอะไหล่ ----------
function partForm(pn) {
  const x = pn ? PT(pn) : { unit: 'ชิ้น', active: true };
  const f = (k, l, t = 'text', v = x[k]) => `<div class="field"><label for="pf-${k}">${l}</label><input id="pf-${k}" class="inp" type="${t}" ${t === 'number' ? 'min="0" step="any"' : ''} value="${esc(v ?? '')}" ${k === 'part_no' && pn ? 'readonly' : ''}></div>`;
  modal(`<h2>${pn ? 'แก้ไขอะไหล่ ' + esc(pn) : 'เพิ่มอะไหล่'}</h2><form id="fPart" class="form">
    ${f('part_no', 'Part no *')}${f('name', 'ชื่ออะไหล่ *')}${f('spec', 'Spec')}${f('unit', 'หน่วย')}
    ${pn ? `<div class="field"><span class="flabel">คงเหลือ</span><div style="padding:9px 0"><b>${qty(x.stock)}</b> ${esc(x.unit)} <span class="sub">(แก้ด้วยปุ่ม ปรับยอด)</span></div></div>` : f('stock', 'ยอดยกมา', 'number', 0)}
    ${f('min_qty', 'Min', 'number')}${f('max_qty', 'Max', 'number')}${f('location', 'ที่เก็บ (Rack)')}${f('unit_price', 'ราคา/หน่วย (บาท)', 'number')}${f('lead_days', 'Lead time (วัน)', 'number')}
    ${f('machines', 'ใช้กับเครื่อง (คั่นด้วย ,)', 'text', (x.machines || []).join(', '))}${f('vendor', 'Vendor')}
    <div class="field"><span class="flabel">สถานะ</span><label><input type="checkbox" id="pf-active" ${x.active !== false ? 'checked' : ''}> ใช้งาน</label></div>
    <div class="full btns"><button class="btn" type="submit">บันทึก</button><button class="btn ghost" type="button" data-close>ยกเลิก</button></div></form>`);
  $('#fPart').onsubmit = async e => {
    e.preventDefault();
    const g = k => $('#pf-' + k)?.value.trim(), n = k => g(k) === '' ? null : Number(g(k));
    const row = { part_no: g('part_no'), name: g('name'), spec: g('spec') || null, unit: g('unit') || 'ชิ้น', min_qty: n('min_qty'), max_qty: n('max_qty'), location: g('location') || null, unit_price: n('unit_price'), lead_days: n('lead_days'), machines: g('machines').split(/[,\\s]+/).filter(Boolean), vendor: g('vendor') || null, active: $('#pf-active').checked };
    if (!row.part_no || !row.name) return toast('ใส่ Part no และชื่ออะไหล่');
    const { error } = pn ? await sb.from('spare_parts').update(row).eq('part_no', pn) : await sb.from('spare_parts').insert(row);
    if (error) return fail(error);
    const open0 = pn ? 0 : n('stock');
    if (open0 > 0) { const r2 = await sb.from('part_tx').insert({ part_no: row.part_no, qty: open0, kind: 'opening', note: 'ยอดยกมา' }); if (r2.error) return fail(r2.error); }
    closeModal(); toast('บันทึกอะไหล่แล้ว'); reload();
  };
}
function adjustForm(pn) {
  const x = PT(pn);
  modal(`<h2>ปรับยอด ${esc(pn)}</h2><p style="margin-top:0">${esc(x.name)} · คงเหลือในระบบ <b>${qty(x.stock)}</b> ${esc(x.unit)}</p>
    <div class="form"><div class="field"><label for="adjN">นับได้จริง *</label><input id="adjN" class="inp" type="number" min="0" step="any" value="${x.stock}"></div>
    <div class="field"><label for="adjNote">เหตุผล *</label><input id="adjNote" class="inp" placeholder="เช่น นับสต็อกประจำเดือน"></div></div>
    <div class="btns" style="margin-top:12px"><button class="btn" id="adjGo">บันทึกการปรับยอด</button><button class="btn ghost" data-close>ยกเลิก</button></div>`);
  $('#adjGo').onclick = async () => {
    const n = parseFloat($('#adjN').value), note = $('#adjNote').value.trim();
    if (!(n >= 0)) return toast('ใส่จำนวนที่นับได้'); if (!note) return toast('ใส่เหตุผลการปรับยอด');
    const d = Math.round((n - Number(x.stock)) * 1000) / 1000; if (!d) { closeModal(); return toast('ยอดเท่าเดิม ไม่ต้องปรับ'); }
    const { error } = await sb.from('part_tx').insert({ part_no: pn, qty: d, kind: 'adjust', note });
    if (error) return fail(error);
    closeModal(); toast(`ปรับยอด ${pn} ${d > 0 ? '+' : ''}${qty(d)}`); reload();
  };
}
async function partHistory(pn) {
  const { data, error } = await sb.from('part_tx').select('*').eq('part_no', pn).order('at', { ascending: false });
  if (error) return fail(error);
  const K = { opening: 'ยอดยกมา', receive: 'รับเข้า', issue: 'เบิกใช้', adjust: 'ปรับยอด' };
  modal(`<h2>ความเคลื่อนไหว ${esc(pn)}</h2><p class="sub" style="margin-top:0">${esc(PT(pn).name || '')} · คงเหลือ ${qty(PT(pn).stock)} ${esc(PT(pn).unit || '')}</p>
    ${(data || []).length ? `<div class="tbl-wrap"><table><thead><tr><th>วันที่</th><th>ประเภท</th><th class="num">จำนวน</th><th>ใบงาน</th><th>โดย / หมายเหตุ</th></tr></thead><tbody>${data.map(t => `<tr><td class="num">${fd(t.at)}</td><td>${K[t.kind] || t.kind}</td><td class="num ${t.qty < 0 ? 'u-Critical' : ''}">${t.qty > 0 ? '+' : ''}${qty(t.qty)}</td><td>${t.request_id ? `<a href="#" class="folio" data-open-close="${esc(t.request_id)}">${esc(t.request_id)}</a>` : '-'}</td><td>${esc(nm(t.actor))}${t.note ? '<br><span class="sub">' + esc(t.note) + '</span>' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">ยังไม่มีความเคลื่อนไหว</div>'}
    <div class="btns" style="margin-top:12px"><button class="btn ghost" data-close>ปิด</button></div>`);
  $$('#modal [data-open-close]').forEach(a => a.onclick = e => { e.preventDefault(); closeModal(); openDetail(a.dataset.openClose); });
}

async function act(a) {
  const q = D.requests.find(x => x.id === S.sel); if (!q) return;
  const me = S.me.email, now = new Date().toISOString(), v = id => ($('#' + id)?.value || '').trim();
  let patch = null, log = '', msg = '';
  try {
    switch (a) {
      case 'fd_approve': {
        const t = q.job_type === 'purchase' ? 'purchase' : document.querySelector('input[name=apType]:checked').value;
        if (t === 'purchase') { patch = { status: 'quotation', job_type: 'purchase', assignee: v('apAssignee') || me }; log = 'Foreman Day อนุมัติคำขอซื้อ · ผู้รับผิดชอบ ' + nm(patch.assignee); }
        else if (t === 'special') { patch = { status: 'quotation', job_type: 'special', assignee: v('apAssignee') || me }; log = 'Foreman Day อนุมัติ · Special · ผู้รับผิดชอบ ' + nm(patch.assignee); }
        else { patch = { status: 'wait_admin', job_type: 'normal', repair_unit: t }; log = `Foreman Day อนุมัติ · Normal ส่งซ่อม ${t} (${t === 'FM' ? 'K2' : 'SAP'})`; }
        Object.assign(patch, { return_note: null }); if (v('apNote')) log += ' · ' + v('apNote'); msg = 'อนุมัติแล้ว'; break;
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
        if (q.job_type === 'pmcal') log += ` · อัปเดต ${q.pmcal_kind} ล่าสุดของเครื่องอัตโนมัติ`;
        break;
      }
      case 'recv_close': return receiveAndClose(q);
      case 'hold_on': patch = { hold_reason: v('hdReason'), hold_note: v('hdNote') || null }; log = 'พักงาน · ' + v('hdReason') + (v('hdNote') ? ' · ' + v('hdNote') : ''); msg = 'พักงานแล้ว'; break;
      case 'hold_off': patch = { hold_reason: null, hold_note: null }; log = 'ดำเนินการต่อ (เลิกพักงาน: ' + (q.hold_reason || '') + ')'; msg = 'ดำเนินการต่อแล้ว'; break;
      case 'pm_action': patch = { action_at: now }; log = 'Member เริ่มดำเนินการ (ขอใบเสนอราคา)'; msg = 'บันทึกแล้ว หยุดส่งอีเมลเตือน'; break;
      case 'memo_draft': case 'memo_submit': {
        const qs = readQuotes(q); if (!qs) return;
        const md = readMemo(), memoNo = v('mfMemoNo'), apps = [v('mfApp0'), v('mfApp1'), v('mfApp2')].filter(Boolean);
        const files = {}; qs.forEach(x => { const f = filesOf('qF' + x.i); if (f.length) files[x.i] = f[0]; });
        if (a === 'memo_submit') {
          const ch = qs.find(x => x.chosen);
          if (!qs.length) return toast('กรอกใบเสนอราคาอย่างน้อย 1 ใบ');
          if (!ch) return toast('เลือกใบเสนอราคาที่จะใช้ (ปุ่มวงกลมหน้าแถว)');
          if (!ch.file && !files[ch.i]) return toast('แนบไฟล์ใบเสนอราคาของ Vendor ที่เลือก');
          if (!md.item) return toast('กรอกรายการที่จัดหา');
          if (!md.reasons.length) return toast('เลือกเหตุผลการจัดหาโดยตรงอย่างน้อย 1 ข้อ');
          if ((md.reasons.includes(0) || md.reasons.includes(3)) && !md.reasonOther) return toast('ระบุเหตุผลเพิ่มเติม (เร่งด่วนเนื่องจาก… / เหตุผลอื่น)');
          if (!md.method) return toast('เลือกวิธีการจัดหา');
          if (md.method === 'compare' && qs.length < 2) return toast('วิธีเปรียบเทียบราคาต้องมีใบเสนอราคาอย่างน้อย 2 ราย');
          if (md.method === 'special' && !md.special.length) return toast('เลือกเหตุผลของวิธีพิเศษ');
          if (!memoNo) return toast('กรอกเลขที่ MEMO');
          if (!apps.length) return toast('เลือกผู้อนุมัติ App 1');
          if (new Set(apps).size !== apps.length) return toast('ผู้อนุมัติซ้ำกัน');
        }
        $$('[data-act]').forEach(b => b.disabled = true);
        const added = [];
        try {
          for (const x of qs) if (files[x.i]) { const up = await uploadFiles(q.id, 'quotation', [files[x.i]]); added.push(...up); x.file = up[0].path; }
          added.push(...await uploadFiles(q.id, 'memo', filesOf('mfMemo')));
        } catch (e) { $$('[data-act]').forEach(b => b.disabled = false); return fail(e); }
        const quotes = qs.map(({ i, ...x }) => x);
        patch = { quotes, select_reason: v('qS') || null, quote_reason: v('qR') || null, memo_doc: md, memo_no: memoNo || null, attachments: [...(q.attachments || []), ...added] };
        if (a === 'memo_draft') { log = `บันทึกร่างใบเสนอราคา ${quotes.length} ใบ / MEMO`; msg = 'บันทึกร่างแล้ว'; break; }
        Object.assign(patch, { status: 'memo_approval', memo_approvers: apps, memo_step: 0, memo_round: (q.memo_round || 0) + 1, action_at: q.action_at || now, return_note: null });
        const ch = quotes.find(x => x.chosen);
        log = `ส่ง MEMO ${memoNo} ให้อนุมัติ · ${ch.vendor} ${num2(ch.amount)} บาท (เทียบ ${quotes.length} ราย): ${apps.map((e, i) => 'App' + (i + 1) + ' ' + nm(e)).join(' → ')}`; msg = 'ส่ง MEMO แล้ว'; break;
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
  const issues = patch._issue || []; delete patch._issue;
  if (issues.length) { try { await issueParts(q.id, issues); log += ' · เบิกอะไหล่ ' + issueText(issues); } catch (e) { $$('[data-act]').forEach(b => b.disabled = false); return fail(e); } }
  const { error } = await sb.from('requests').update(patch).eq('id', q.id);
  if (error) { $$('[data-act]').forEach(b => b.disabled = false); return fail(error); }
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
  try { await sb.rpc('ensure_pmcal_jobs'); } catch (e) { /* ignore */ }
  try { await loadAll(); } catch (e) { return fail(e); }
  const no = PENDING_M, jid = PENDING_J; PENDING_M = PENDING_J = null; S.view = 'home';
  try { sessionStorage.removeItem(SCAN_KEY); sessionStorage.removeItem(JOB_KEY); } catch (e) {}
  if (jid) {
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    if (D.requests.some(q => q.id === jid)) { subscribe(); return openDetail(jid); }
    toast('ไม่พบใบงาน ' + jid);
  }
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
  ['maintenance_type', 'Maintenance Type', OPT.mtype], ['responsibility', 'Member ผู้รับผิดชอบ (อีเมล)', 'email'], ['eng_foreman', 'Eng, Foreman (อีเมล · ว่าง = ตามประเภทเครื่อง)', 'email'],
  ['supplier', 'Vendor', 'text'], ['contact_person', 'Contact Person', 'text'], ['phone', 'เบอร์โทรศัพท์', 'text'], ['email', 'E-mail Vendor', 'text'], ['other_contact', 'Line / ช่องทางอื่น', 'text'],
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
    if (!row.eng_foreman) row.eng_foreman = fdOfType(row.machine_type === 'เครื่องทดสอบ' ? 'เครื่องทดสอบ' : 'เครื่องจักร');
    const { error } = await sb.from('machines').upsert(row);
    if (error) return fail(error);
    closeModal(); toast('บันทึกแล้ว'); try { await sb.rpc('ensure_pmcal_jobs'); } catch (e2) {} reload();
  };
  const del = $('#mDel');
  if (del) del.onclick = () => machineDeleteForm(no);
}
// ลบเครื่อง: ถ้ามีใบงานอ้างถึง ให้เลือกเปลี่ยนเป็น Inactive (เก็บประวัติ) หรือลบเครื่องพร้อมใบงานทั้งหมด
async function machineDeleteForm(no) {
  try { await loadAll(); } catch (e) { return fail(e); }
  const m = M(no), jobs = D.requests.filter(q => q.machine_no === no), nOpen = jobs.filter(q => OPEN(q.status)).length;
  const plan = (m.pm_last_date && m.pm_interval_month) || (m.cal_last_date && m.cal_interval_month);
  modal(`<h2>ลบเครื่อง ${esc(no)}</h2>
    ${jobs.length ? `<p>เครื่องนี้มีใบงาน <b>${jobs.length} ใบ</b> (ยังเปิด ${nOpen} · ปิดแล้ว ${jobs.length - nOpen}): ${jobs.slice(0, 8).map(q => esc(q.id)).join(', ')}${jobs.length > 8 ? ' …' : ''}</p>
    <div class="choice">
      <label><input type="radio" name="mdMode" value="inactive" checked> <b>เปลี่ยนสถานะเป็น Inactive</b> · เก็บประวัติไว้ ไม่แสดงในฟอร์มแจ้งซ่อม ไม่เปิดใบงาน PM/CAL อีก (แนะนำสำหรับเครื่องจริงที่เลิกใช้)</label>
      <label><input type="radio" name="mdMode" value="all"> <b>ลบเครื่องพร้อมใบงานทั้งหมด ${jobs.length} ใบ</b> · ใช้ลบข้อมูลทดลอง กู้คืนไม่ได้</label>
    </div>` : `<p>ลบเครื่องนี้ถาวร กู้คืนไม่ได้</p>`}
    ${plan ? '<p class="sub">เครื่องนี้มีแผน PM/CAL ถ้าลบแค่ใบงานแต่ไม่ลบเครื่อง ระบบจะเปิดใบงาน PM/CAL ให้ใหม่เมื่อใกล้ครบกำหนด</p>' : ''}
    <div class="field" id="mdConfirmBox" ${jobs.length ? 'hidden' : ''}><label for="mdConfirm">พิมพ์รหัสเครื่อง <b>${esc(no)}</b> เพื่อยืนยัน</label><input id="mdConfirm" class="inp" autocomplete="off"></div>
    <div class="btns" style="margin-top:12px"><button class="btn ${jobs.length ? '' : 'bad'}" id="mdGo" ${jobs.length ? '' : 'disabled'}>${jobs.length ? 'เปลี่ยนเป็น Inactive' : 'ลบถาวร'}</button><button class="btn ghost" data-close>ยกเลิก</button></div>`);
  const mode = () => document.querySelector('input[name=mdMode]:checked')?.value || 'all';
  const sync = () => { const all = mode() === 'all'; $('#mdConfirmBox').hidden = !all; $('#mdGo').className = 'btn' + (all ? ' bad' : ''); $('#mdGo').textContent = all ? (jobs.length ? `ลบเครื่องและใบงาน ${jobs.length} ใบ` : 'ลบถาวร') : 'เปลี่ยนเป็น Inactive'; $('#mdGo').disabled = all && $('#mdConfirm').value.trim() !== no; };
  $$('input[name=mdMode]').forEach(r => r.onchange = sync);
  $('#mdConfirm').oninput = sync;
  $('#mdGo').onclick = async () => {
    $('#mdGo').disabled = true;
    if (mode() === 'inactive') {
      const { error } = await sb.from('machines').update({ status: 'Inactive', updated_at: new Date().toISOString() }).eq('machine_no', no);
      if (error) { $('#mdGo').disabled = false; return fail(error); }
      closeModal(); toast(no + ' เปลี่ยนเป็น Inactive แล้ว'); return reload();
    }
    if (jobs.length) {
      const { data, error } = await sb.from('requests').delete().eq('machine_no', no).select();
      if (error) { $('#mdGo').disabled = false; return fail(error); }
      const paths = (data || []).flatMap(q => [...(q.photos || []), ...(q.attachments || []).map(a => a.path)]).filter(Boolean);
      if (paths.length) { try { await sb.storage.from('request-photos').remove(paths); } catch (x) { /* ไฟล์ค้างไม่กระทบการใช้งาน */ } }
    }
    const { data, error } = await sb.from('machines').delete().eq('machine_no', no).select();
    if (error || !data?.length) { $('#mdGo').disabled = false; return fail(error ? { message: 'ลบเครื่องไม่ได้: ' + error.message } : { message: 'ลบเครื่องไม่ได้ (ไม่มีสิทธิ์ Admin)' }); }
    closeModal(); toast('ลบ ' + no + (jobs.length ? ` และใบงาน ${jobs.length} ใบแล้ว` : ' แล้ว')); S.view = 'machine'; reload();
  };
}
const xDate = v => { if (!v) return null; if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); if (typeof v === 'number') return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10); const t = String(v).trim(), th = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (th) { let y = +th[3]; if (y > 2400) y -= 543; return y + '-' + pad(th[2]) + '-' + pad(th[1]); } const d = new Date(t); return isNaN(d) ? null : d.toISOString().slice(0, 10); };
function readBook(wb) {
  const find = (...names) => Object.keys(wb.Sheets).find(n => names.some(x => n.trim().toLowerCase() === x.toLowerCase()));
  const sheet = (...names) => { const n = find(...names); if (!n) return null; return XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null }).map(r => { const o = {}; for (const k in r) o[k.replace(/\s+/g, ' ').trim().toLowerCase()] = typeof r[k] === 'string' ? r[k].trim() : r[k]; return o; }); };
  const g = (r, ...keys) => { for (const k of keys) if (r[k] != null && r[k] !== '' && r[k] !== '-') return r[k]; return null; };
  return { sheet, g };
}
const ROLE_IN = { 'member': 'member', 'foreman shift': 'foreman_shift', 'foreman day': 'foreman_day', 'manager': 'manager', 'admin': 'admin' };
const yes = v => /^(y|yes|ใช่|✓|true|1)$/i.test(String(v ?? '').trim());
function parseUsers(rows, g) {
  const out = [], bad = [];
  for (const r of rows || []) {
    const em = String(g(r, 'อีเมล', 'email', 'e-mail') || '').trim().toLowerCase(); if (!em) continue;
    const ro = ROLE_IN[String(g(r, 'บทบาท', 'role') || 'member').trim().toLowerCase()] || ROLE_IN[String(g(r, 'บทบาท', 'role')).replace(/_/g, ' ').toLowerCase()];
    if (!domainOk(em) || !ro) { bad.push(em); continue; }
    const ft = String(g(r, 'foreman day ดูแลประเภท', 'fd_type') || '').trim();
    out.push({ email: em, full_name: g(r, 'ชื่อที่แสดง', 'ชื่อ', 'name') || null, role: ro, fd_type: ro === 'foreman_day' && OPT.fdType.includes(ft) ? ft : null,
      memo_approver: yes(g(r, 'อนุมัติ memo ได้ (y/n)', 'อนุมัติ memo ได้', 'memo')), is_admin: ro === 'admin' || yes(g(r, 'สิทธิ์ admin (y/n)', 'สิทธิ์ admin', 'admin')) });
  }
  return { out, bad };
}
async function importUsers(file) {
  try {
    const { sheet, g } = readBook(XLSX.read(await file.arrayBuffer(), { cellDates: true }));
    const rows = sheet('ผู้ใช้', 'Users');
    if (!rows) return toast('ไม่พบชีท “ผู้ใช้” ในไฟล์');
    const { out, bad } = parseUsers(rows, g);
    if (!out.length) return toast('ไม่พบรายชื่อที่ถูกต้องในชีทผู้ใช้');
    const merged = D.profiles.map(x => out.find(u => u.email === x.email) || x).concat(out.filter(u => !D.profiles.some(x => x.email === u.email)));
    if (!merged.some(x => x.email === S.me.email && (x.role === 'admin' || x.is_admin))) return toast('ไฟล์นี้จะนำสิทธิ์ Admin ของคุณออก ให้ใส่ Y ในคอลัมน์สิทธิ์ Admin ของตัวเองก่อน');
    const { error } = await sb.from('app_users').upsert(out);
    if (error) throw error;
    toast(`นำเข้าผู้ใช้ ${out.length} คน` + (bad.length ? ` · ข้าม ${bad.length} แถว (อีเมล/บทบาทไม่ถูกต้อง: ${bad.slice(0, 3).join(', ')})` : ''));
    reload();
  } catch (e) { fail(e); }
}
async function importExcel(file) {
  try {
    const { sheet, g } = readBook(XLSX.read(await file.arrayBuffer(), { cellDates: true }));
    const mm = sheet('Machine Master') || [];
    const skip = no => /^ตัวอย่าง|^example/i.test(no);
    const engOf = t => fdOfType(t === 'เครื่องทดสอบ' ? 'เครื่องทดสอบ' : 'เครื่องจักร');
    const rows = mm.filter(r => g(r, 'machine number') && !skip(String(g(r, 'machine number')))).map(r => {
      const type = g(r, 'machine type'), eng = String(g(r, 'eng,foreman', 'eng, foreman') || '');
      const pmD = xDate(g(r, 'pm date')), pmI = parseInt(g(r, 'pm interval')) || null, calD = xDate(g(r, 'cal date')), calI = parseInt(g(r, 'cal interval')) || null;
      const row = {
        machine_no: String(g(r, 'machine number')).trim(), machine_name: String(g(r, 'machine name') || g(r, 'machine number')),
        model: g(r, 'model'), serial_number: g(r, 'serial number') && String(g(r, 'serial number')), machine_type: type, location: g(r, 'location'),
        status: g(r, 'staus', 'status') || 'Active', priority: g(r, 'priority') || 'Normal', maintenance_type: g(r, 'maintenance type') || 'No Plan',
        responsibility: g(r, 'responsibility') && String(g(r, 'responsibility')).toLowerCase(), eng_foreman: domainOk(eng.trim()) ? eng.trim().toLowerCase() : engOf(type),
        supplier: g(r, 'vendor', 'supplier'), contact_person: g(r, 'contact person'), phone: g(r, 'เบอร์โทรศัพท์') && String(g(r, 'เบอร์โทรศัพท์')), email: g(r, 'e-mail'), other_contact: g(r, 'line/ช่องทางอื่น'),
        updated_at: new Date().toISOString()
      };
      // คอลัมน์ PM/CAL ในชีทเดียวกัน (แบบฟอร์มใหม่) — ใส่เฉพาะเมื่อมีข้อมูล เพื่อไม่ลบค่าที่ระบบอัปเดตไว้
      if ('pm date' in r || 'pm interval' in r) Object.assign(row, { pm_last_date: pmD, pm_interval_month: pmI });
      if ('cal date' in r || 'cal interval' in r) Object.assign(row, { cal_last_date: calD, cal_interval_month: calI });
      return row;
    });
    let users = 0;
    const ur = sheet('ผู้ใช้');
    if (ur) {
      const { out } = parseUsers(ur, g);
      const merged = D.profiles.map(x => out.find(u => u.email === x.email) || x).concat(out.filter(u => !D.profiles.some(x => x.email === u.email)));
      if (out.length && merged.some(x => x.email === S.me.email && (x.role === 'admin' || x.is_admin))) { const { error } = await sb.from('app_users').upsert(out); if (error) throw error; users = out.length; await loadAll(); rows.forEach(r => { if (!r.eng_foreman) r.eng_foreman = engOf(r.machine_type); }); }
    }
    // upsert แยกตามชุดคอลัมน์ (PostgREST ต้องการคีย์เท่ากันทุกแถว)
    const groups = {}; rows.forEach(r => { const k = Object.keys(r).sort().join(','); (groups[k] ||= []).push(r); });
    for (const g2 of Object.values(groups)) { const { error } = await sb.from('machines').upsert(g2); if (error) throw error; }
    let plan = 0;
    for (const [sh, dk] of [['PM Master', 'pm'], ['CAL Master', 'cal']]) {
      for (const r of (sheet(sh) || []).filter(r => g(r, 'machine number'))) {
        const { error } = await sb.from('machines').update({ [dk + '_last_date']: xDate(g(r, dk + ' date')), [dk + '_interval_month']: parseInt(g(r, 'interval')) || null }).eq('machine_no', String(g(r, 'machine number')));
        if (!error) plan++;
      }
    }
    plan += rows.filter(r => r.pm_last_date || r.cal_last_date).length;
    let created = 0; try { const { data } = await sb.rpc('ensure_pmcal_jobs'); created = data || 0; } catch (e) {}
    // Vendors + Spare Parts (v3.6)
    let nv = 0, np = 0;
    const list = v => String(v || '').split(/[,\s]+/).map(x => x.trim()).filter(Boolean);
    if (D.hasParts) {
      const vrows = (sheet('Vendors') || []).filter(r => g(r, 'vendor') && !/^ตัวอย่าง/.test(String(g(r, 'vendor')))).map(r => ({ name: String(g(r, 'vendor')).trim(), contact_person: g(r, 'contact person'), phone: g(r, 'เบอร์โทรศัพท์') && String(g(r, 'เบอร์โทรศัพท์')), email: g(r, 'e-mail'), other_contact: g(r, 'line/ช่องทางอื่น'), machines: list(g(r, 'machine number (คั่นด้วย ,)', 'machine number')), work_type: g(r, 'ประเภทงาน'), note: g(r, 'หมายเหตุ') }));
      if (vrows.length) { const { error } = await sb.from('vendors').upsert(vrows); if (error) throw error; nv = vrows.length; }
      const prows = (sheet('Spare Parts') || []).filter(r => g(r, 'part no') && !/^ตัวอย่าง/.test(String(g(r, 'part no'))));
      for (const r of prows) {
        const pn = String(g(r, 'part no')).trim(), want = Number(g(r, 'คงเหลือ (ยอดยกมา)', 'คงเหลือ') || 0), had = D.parts.find(x => x.part_no === pn);
        const row = { part_no: pn, name: String(g(r, 'ชื่ออะไหล่') || pn), spec: g(r, 'spec'), unit: g(r, 'หน่วย') || 'ชิ้น', min_qty: g(r, 'min') != null ? Number(g(r, 'min')) : null, max_qty: g(r, 'max') != null ? Number(g(r, 'max')) : null, location: g(r, 'ที่เก็บ (rack)', 'ที่เก็บ'), unit_price: g(r, 'ราคา/หน่วย (บาท)') != null ? Number(g(r, 'ราคา/หน่วย (บาท)')) : null, lead_days: g(r, 'lead time (วัน)') != null ? parseInt(g(r, 'lead time (วัน)')) : null, machines: list(g(r, 'machine number (คั่นด้วย ,)', 'machine number')), vendor: g(r, 'vendor') };
        const { error } = await sb.from('spare_parts').upsert(row); if (error) throw error;
        const diff = want - Number(had?.stock || 0);
        if (diff) { const r2 = await sb.from('part_tx').insert({ part_no: pn, qty: diff, kind: had ? 'adjust' : 'opening', note: 'นำเข้าจาก Excel' }); if (r2.error) throw r2.error; }
        np++;
      }
    }
    const later = (D.hasParts ? ['จุดวัดไฟ', 'ทะเบียนเอกสาร'] : ['Vendors', 'Spare Parts', 'จุดวัดไฟ', 'ทะเบียนเอกสาร']).filter(n => sheet(n)?.length);
    toast(`นำเข้าเครื่องจักร ${rows.length} เครื่อง · แผน PM/CAL ${plan} รายการ · เปิดใบงาน PM/CAL ใหม่ ${created}` + (users ? ` · ผู้ใช้ ${users} คน` : '') + (np ? ` · อะไหล่ ${np} รายการ` : '') + (nv ? ` · Vendor ${nv} ราย` : '') + (later.length ? ` · ชีท ${later.join(', ')} จะนำเข้าในระยะ 3` : ''));
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
  // หัวคอลัมน์เดียวกับแบบฟอร์ม Excel → แก้แล้วนำเข้ากลับได้
  const mm = D.machines.map(m => ({ 'Machine number': m.machine_no, 'Machine Name': m.machine_name, 'Model': m.model, 'Serial Number': m.serial_number, 'Machine Type': m.machine_type, 'Location': m.location, 'Status': m.status, 'Priority': m.priority, 'Maintenance Type': m.maintenance_type, 'Responsibility': m.responsibility, 'Eng,Foreman': m.eng_foreman,
    'Vendor': m.supplier, 'Contact Person': m.contact_person, 'เบอร์โทรศัพท์': m.phone, 'E-mail': m.email, 'Line/ช่องทางอื่น': m.other_contact, 'PM DATE': m.pm_last_date, 'PM Interval': m.pm_interval_month, 'CAL DATE': m.cal_last_date, 'CAL Interval': m.cal_interval_month }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mm), 'Machine Master');
  XLSX.writeFile(wb, 'CAPD-Maintenance-' + todayStr() + '.xlsx');
}

/* ---------- ลบไฟล์แนบ ---------- */
// คนที่แนบไฟล์ลบได้ระหว่างขั้นตอนของตัวเอง · Admin ลบได้ทุกเวลา · ไฟล์ใบเสนอราคา/MEMO ล็อกหลังส่ง MEMO
function canRemoveAtt(q, a) {
  if (isAdmin()) return true;
  const me = S.me.email; if (!OPEN(q.status) || (a.by && a.by !== me) || (!a.by && q.reporter !== me)) return false;
  if (['pending_fd', 'returned'].includes(q.status)) return q.reporter === me;
  if (['quotation', 'memo_rejected'].includes(q.status)) return q.assignee === me || role() === 'foreman_day';
  if (q.status === 'po_vendor') return !['quotation', 'memo'].includes(a.kind) && (q.assignee === me || canFD(q.machine_no));
  return false;
}
async function removeAtt(path, btn) {
  const q = D.requests.find(x => x.id === S.sel); if (!q) return;
  const a = S.att.find(x => x.path === path) || (q.attachments || []).find(x => x.path === path) || { path, name: path.split('/').pop() };
  if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'ลบ?'; btn.classList.add('sure'); setTimeout(() => { if (document.body.contains(btn)) { btn.dataset.sure = ''; btn.textContent = '×'; btn.classList.remove('sure'); } }, 4000); return; }
  btn.disabled = true;
  const patch = { attachments: (q.attachments || []).filter(x => x.path !== path) };
  if ((q.photos || []).includes(path)) patch.photos = q.photos.filter(x => x !== path);
  if ((q.quotes || []).some(x => x.file === path)) patch.quotes = q.quotes.map(x => x.file === path ? { ...x, file: null } : x);
  const { error } = await sb.from('requests').update(patch).eq('id', q.id);
  if (error) { btn.disabled = false; return fail(error); }
  if (isAdmin()) { try { await sb.storage.from('request-photos').remove([path]); } catch (x) { /* ไฟล์ค้างไม่กระทบการใช้งาน */ } }
  await addLog(q.id, `ลบไฟล์แนบ (${ATT[a.kind] || 'ไฟล์'}): ${a.name}`);
  toast('ลบไฟล์แล้ว'); await loadAll(); openDetail(q.id, false);
}

/* ---------- แก้ไข / ลบใบงาน ---------- */
// ผู้เปิดใบงานแก้ข้อมูลแจ้งซ่อมได้จนกว่า FD จะอนุมัติ · Admin แก้ได้ทุกสถานะ (ฐานข้อมูลตรวจซ้ำใน guard_request)
const canEdit = q => isAdmin() || (q.reporter === S.me.email && ['pending_fd', 'returned'].includes(q.status));
const EDIT_BASE = [['machine_no', 'เครื่องจักร', 'machine'], ['urgency', 'ความเร่งด่วน', OPT.prio], ['symptom', 'อาการที่พบ', 'area'], ['first_fix', 'วิธีแก้ไขเบื้องต้น', 'area']];
const EDIT_ADMIN = [['external_ref', 'เลขที่แจ้ง SAP / K2', 'text'], ['vendor', 'Vendor', 'text'], ['quotation_amount', 'ราคาใบเสนอราคา (บาท)', 'number'], ['memo_no', 'เลขที่ MEMO', 'text'], ['po_no', 'เลขที่ PO', 'text'], ['vendor_date', 'วันนัด Vendor', 'date']];
const EDIT_CLOSED = [['fix_detail', 'วิธีการแก้ไข', 'area'], ['root_cause', 'สาเหตุ', 'text'], ['parts_used', 'อะไหล่ที่ใช้', 'text'], ['cost_thb', 'ค่าใช้จ่าย (บาท)', 'number'], ['downtime_min', 'Downtime (นาที)', 'number'], ['start_at', 'เริ่ม', 'datetime-local'], ['end_at', 'เสร็จ', 'datetime-local']];
function editForm(q) {
  const fields = [...EDIT_BASE, ...(isAdmin() ? EDIT_ADMIN : []), ...(isAdmin() && q.status === 'closed' ? EDIT_CLOSED : [])];
  const val = (k, t) => q[k] == null ? '' : t === 'datetime-local' ? localInput(q[k]) : q[k];
  const field = ([k, l, t]) => `<div class="field ${t === 'area' ? 'full' : ''}"><label for="ed-${k}">${l}</label>${
    t === 'machine' ? `<select id="ed-${k}" class="inp">${D.machines.map(m => `<option value="${esc(m.machine_no)}" ${m.machine_no === q.machine_no ? 'selected' : ''}>${esc(m.machine_no)} · ${esc(m.machine_name)}</option>`).join('')}</select>`
    : Array.isArray(t) ? `<select id="ed-${k}" class="inp">${opts(t, q[k])}</select>`
    : t === 'area' ? `<textarea id="ed-${k}" class="inp" rows="2">${esc(val(k, t))}</textarea>`
    : `<input id="ed-${k}" class="inp" type="${t}" ${t === 'number' ? 'min="0" step="any"' : ''} value="${esc(val(k, t))}">`}</div>`;
  modal(`<h2>แก้ไขใบงาน ${esc(q.id)}</h2>
    ${isAdmin() ? '' : '<p class="sub" style="margin-top:0">แก้ได้จนกว่า Foreman Day จะอนุมัติ</p>'}
    <form id="fEdit" class="form">${fields.map(field).join('')}
    <div class="full btns"><button class="btn" type="submit" id="edSave">บันทึก</button><button class="btn ghost" type="button" data-close>ยกเลิก</button></div></form>`);
  $('#fEdit').onsubmit = async e => {
    e.preventDefault();
    const patch = {}, changed = [];
    for (const [k, l, t] of fields) {
      let v = $('#ed-' + k).value.trim();
      v = v === '' ? null : t === 'number' ? Number(v) : t === 'datetime-local' ? new Date(v).toISOString() : v;
      const old = q[k] == null ? null : t === 'number' ? Number(q[k]) : t === 'datetime-local' ? new Date(q[k]).toISOString() : String(q[k]);
      if (v !== old) { patch[k] = v; changed.push(l); }
    }
    if ('symptom' in patch && !patch.symptom) return toast('กรอกอาการที่พบ');
    if (!changed.length) { closeModal(); return toast('ไม่มีการเปลี่ยนแปลง'); }
    $('#edSave').disabled = true;
    const { error } = await sb.from('requests').update(patch).eq('id', q.id);
    if (error) { $('#edSave').disabled = false; return fail(error); }
    await addLog(q.id, 'แก้ไขข้อมูล: ' + changed.join(', '));
    closeModal(); toast('บันทึกการแก้ไขแล้ว'); await loadAll(); openDetail(q.id, false);
  };
}
// ยกเลิกใบงาน: ใบงานและประวัติยังอยู่ (ต่างจากลบ) · Admin ทุกสถานะที่ยังเปิด · ผู้เปิดก่อน FD อนุมัติ
const canCancel = q => OPEN(q.status) && (isAdmin() || (q.reporter === S.me.email && ['pending_fd', 'returned'].includes(q.status)));
function cancelForm(q) {
  modal(`<h2>ยกเลิกใบงาน ${esc(q.id)}</h2>
    <p style="margin-top:0">ใบงานจะเปลี่ยนเป็น <b>ยกเลิก</b> และหยุดอยู่ที่ขั้นนี้ ประวัติและไฟล์แนบยังเก็บไว้ครบ</p>
    <div class="field"><label for="cxNote">เหตุผลที่ยกเลิก *</label><input id="cxNote" class="inp" placeholder="เช่น เปิดซ้ำกับ MR-…, เครื่องกลับมาใช้งานได้เอง"></div>
    <div class="btns" style="margin-top:14px"><button class="btn bad" id="cxGo">ยกเลิกใบงาน</button><button class="btn ghost" data-close>ไม่ยกเลิก</button></div>`);
  $('#cxGo').onclick = async () => {
    const note = $('#cxNote').value.trim(); if (!note) return toast('กรอกเหตุผลที่ยกเลิก');
    $('#cxGo').disabled = true;
    const { error } = await sb.from('requests').update({ status: 'cancelled', return_note: note }).eq('id', q.id);
    if (error) { $('#cxGo').disabled = false; return fail(error); }
    await addLog(q.id, 'ยกเลิกใบงาน · ' + note);
    closeModal(); toast('ยกเลิก ' + q.id + ' แล้ว'); await loadAll(); openDetail(q.id, false);
  };
}
// สำรองข้อมูลทั้งหมดเป็น Excel ไฟล์เดียว (Admin)
async function backupAll() {
  const btn = $('#backupBtn'); if (btn) btn.disabled = true;
  try {
    const { data: logs, error } = await sb.from('request_logs').select('*').order('at');
    if (error) throw error;
    const flat = rows => rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v != null && typeof v === 'object' ? JSON.stringify(v) : v])));
    const wb = XLSX.utils.book_new();
    const tx = D.hasParts ? ((await sb.from('part_tx').select('*').order('at')).data || []) : [];
    [['requests', D.requests], ['request_logs', logs || []], ['machines', D.machines], ['app_users', D.profiles], ['documents', D.docs], ['spare_parts', D.parts], ['part_tx', tx], ['vendors', D.vendors]]
      .forEach(([n, rows]) => XLSX.utils.book_append_sheet(wb, rows.length ? XLSX.utils.json_to_sheet(flat(rows)) : XLSX.utils.aoa_to_sheet([['(ไม่มีข้อมูล)']]), n));
    XLSX.writeFile(wb, 'CAPD-Backup-' + todayStr() + '.xlsx');
    toast(`สำรองแล้ว: ใบงาน ${D.requests.length} · ประวัติ ${(logs || []).length} · เครื่อง ${D.machines.length} · ผู้ใช้ ${D.profiles.length}`);
  } catch (e) { fail(e); } finally { if (btn) btn.disabled = false; }
}

function deleteForm(q) {
  modal(`<h2>ลบใบงาน ${esc(q.id)}</h2>
    <p>ใบงาน ประวัติการดำเนินการ และไฟล์แนบทั้งหมดจะถูกลบถาวร <b>กู้คืนไม่ได้</b></p>
    <p class="sub">ถ้าเป็นใบงานจริงที่ไม่ต้องทำต่อ ควร Export Excel เก็บไว้ก่อน</p>
    <div class="field"><label for="delConfirm">พิมพ์เลขที่ใบงาน <b>${esc(q.id)}</b> เพื่อยืนยัน</label><input id="delConfirm" class="inp" autocomplete="off"></div>
    <div class="btns" style="margin-top:12px"><button class="btn bad" id="delGo" disabled>ลบถาวร</button><button class="btn ghost" data-close>ยกเลิก</button></div>`);
  $('#delConfirm').oninput = e => { $('#delGo').disabled = e.target.value.trim() !== q.id; };
  $('#delGo').onclick = async () => {
    $('#delGo').disabled = true;
    const paths = [...(q.photos || []), ...(q.attachments || []).map(a => a.path)].filter(Boolean);
    const { data, error } = await sb.from('requests').delete().eq('id', q.id).select();
    if (error || !data?.length) { $('#delGo').disabled = false; return fail(error || { message: 'ลบไม่สำเร็จ (ไม่มีสิทธิ์ หรือใบงานถูกลบไปแล้ว)' }); }
    if (paths.length) { try { await sb.storage.from('request-photos').remove(paths); } catch (x) { /* ไฟล์ค้างไม่กระทบการใช้งาน */ } }
    closeModal(); toast('ลบ ' + q.id + ' แล้ว'); S.sel = null; S.view = 'list'; await loadAll(); render();
  };
}

/* ---------- modal ---------- */
function modal(html, cls = '') { closeModal(); const bg = document.createElement('div'); bg.className = 'modal-bg ' + cls; bg.id = 'modal'; bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`; bg.onclick = e => { if (e.target === bg || e.target.hasAttribute('data-close')) closeModal(); }; document.body.appendChild(bg); }
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
  $$('[data-attdel]').forEach(b => b.onclick = e => { e.preventDefault(); removeAtt(b.dataset.attdel, b); });
  $$('[data-memo]').forEach(b => b.onclick = () => { const q = D.requests.find(x => x.id === S.sel); if (q) openMemo(q); });
  $('#memoPrev') && ($('#memoPrev').onclick = () => { const q = D.requests.find(x => x.id === S.sel); if (q) previewMemo(q); });
  $$('input[name=mdM]').forEach(r => r.onchange = () => { $('#mdSp').hidden = document.querySelector('input[name=mdM]:checked').value !== 'special'; });
  $$('input[name=qC], [id^=qA]').forEach(el => { el.addEventListener('change', authHint); el.addEventListener('input', authHint); });
  if ($('#authHint')) authHint();
  $('#qEdit') && ($('#qEdit').onclick = () => { const q = D.requests.find(x => x.id === S.sel); if (q) editForm(q); });
  $('#ptAdd') && ($('#ptAdd').onclick = () => partForm(null));
  $('#prNew') && ($('#prNew').onclick = () => purchaseForm());
  $('#prLow') && ($('#prLow').onclick = () => purchaseForm(lowParts().slice(0, 5).map(x => ({ part_no: x.part_no, name: x.name, unit: x.unit, qty: Math.max(1, Number(x.max_qty ?? x.min_qty ?? 1) - Number(x.stock)) }))));
  $$('[data-pedit]').forEach(b => b.onclick = () => partForm(b.dataset.pedit));
  $$('[data-padj]').forEach(b => b.onclick = () => adjustForm(b.dataset.padj));
  $$('[data-phist]').forEach(b => b.onclick = () => partHistory(b.dataset.phist));
  $$('[data-pbuy]').forEach(b => b.onclick = () => { const x = PT(b.dataset.pbuy); purchaseForm([{ part_no: x.part_no, name: x.name, unit: x.unit, qty: Math.max(1, Number(x.max_qty ?? x.min_qty ?? 1) - Number(x.stock)) }]); });
  $$('[data-pfilter]').forEach(b => b.onclick = () => { S.pfilter = b.dataset.pfilter; render(); });
  $('#qCancel') && ($('#qCancel').onclick = () => { const q = D.requests.find(x => x.id === S.sel); if (q) cancelForm(q); });
  $('#backupBtn') && ($('#backupBtn').onclick = backupAll);
  $('#qDel') && ($('#qDel').onclick = () => { const q = D.requests.find(x => x.id === S.sel); if (q) deleteForm(q); });
  $$('[data-scan]').forEach(a => a.onclick = e => { e.preventDefault(); openScan(a.dataset.scan); });
  $$('[data-newfor]').forEach(b => b.onclick = () => { S.prefill = b.dataset.newfor; S.view = 'new'; render(); window.scrollTo(0, 0); });
  $$('[data-qr]').forEach(b => b.onclick = () => printQR([M(b.dataset.qr)]));
  $('#qrAll') && ($('#qrAll').onclick = () => printQR(D.machines.filter(m => m.status !== 'Inactive')));
  $$('[data-medit]').forEach(b => b.onclick = () => machineForm(b.dataset.medit));
  $$('[data-mdel]').forEach(b => b.onclick = () => machineDeleteForm(b.dataset.mdel));
  $$('[data-done]').forEach(b => b.onclick = async () => {
    const [no, kind] = b.dataset.done.split('|');
    const { error } = await sb.from('machines').update({ [kind === 'PM' ? 'pm_last_date' : 'cal_last_date']: todayStr() }).eq('machine_no', no);
    if (error) return fail(error); toast(`บันทึก ${kind} ${no} แล้ว`); reload();
  });
  const admins = list => list.filter(x => x.active !== false && (x.role === 'admin' || x.is_admin)).length;
  $$('[data-psave]').forEach(b => b.onclick = async () => {
    const i = b.dataset.psave, p = D.profiles[i];
    const row = { full_name: $('#pn' + i).value.trim() || null, role: $('#pr' + i).value, fd_type: $('#pf' + i).value || null, is_admin: $('#pa' + i).checked, memo_approver: $('#pm' + i).checked, active: $('#pact' + i).checked };
    if ($('#pne' + i)) row.notify_email = $('#pne' + i).checked;
    if (row.role !== 'foreman_day') row.fd_type = null;
    if (admins(D.profiles.map(x => x.email === p.email ? { ...x, ...row } : x)) < 1) return toast('ต้องมีผู้ดูแลระบบ (Admin) อย่างน้อย 1 คน');
    if (p.email === S.me.email && !(row.role === 'admin' || row.is_admin) ) return toast('นำสิทธิ์ Admin ของตัวเองออกไม่ได้ ให้ Admin คนอื่นทำ');
    const { error } = await sb.from('app_users').update(row).eq('email', p.email);
    if (error) return fail(error); toast('บันทึกแล้ว'); reload();
  });
  $$('[data-pdel]').forEach(b => b.onclick = async () => {
    const em = b.dataset.pdel;
    if (em === S.me.email) return toast('ลบบัญชีของตัวเองไม่ได้');
    if (admins(D.profiles.filter(x => x.email !== em)) < 1) return toast('ต้องมีผู้ดูแลระบบ (Admin) อย่างน้อย 1 คน');
    if (D.requests.some(q => [q.reporter, q.assignee, q.approved_by, q.closed_by].includes(em))) return toast('ผู้ใช้นี้มีประวัติในใบงาน ให้เอาติ๊ก “ใช้งาน” ออกแทนการลบ');
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'ยืนยันลบ?'; return; }
    const { error } = await sb.from('app_users').delete().eq('email', em);
    if (error) return fail(error); toast('ลบ ' + em + ' แล้ว'); reload();
  });
  const fp = $('#fPreset');
  if (fp) fp.onsubmit = async e => {
    e.preventDefault(); const em = $('#psEmail').value.trim().toLowerCase();
    if (!domainOk(em)) return toast('ใช้ได้เฉพาะอีเมล @' + C.ALLOWED_DOMAIN);
    if (D.profiles.some(x => x.email === em)) return toast(em + ' มีอยู่แล้ว แก้ไขในตารางด้านบน');
    const r = $('#psRole').value;
    const { error } = await sb.from('app_users').insert({ email: em, full_name: $('#psName').value.trim() || null, role: r, fd_type: r === 'foreman_day' ? ($('#psFd').value || null) : null, is_admin: $('#psAdmin').checked, memo_approver: $('#psMemo').checked });
    if (error) return fail(error); toast('เพิ่มผู้ใช้แล้ว'); reload();
  };
  $$('[data-rolesel]').forEach(sel => sel.onchange = () => { const k = sel.dataset.rolesel, f = $(k === 'ps' ? '#psFd' : '#pf' + k); f.disabled = sel.value !== 'foreman_day'; if (f.disabled) f.value = ''; const a = $(k === 'ps' ? '#psAdmin' : '#pa' + k); if (sel.value === 'admin') { a.checked = true; a.disabled = true; } else a.disabled = false; });
  $('#uImport') && ($('#uImport').onchange = e => { const f = e.target.files[0]; if (f) importUsers(f); e.target.value = ''; });
  $('#logout') && ($('#logout').onclick = async () => { await logout(); S.view = 'home'; renderLogin(); });
  $('#themeBtn') && ($('#themeBtn').onclick = cycleTheme);
  $('#moreBtn') && ($('#moreBtn').onclick = moreSheet);
  $$('[data-scanqr]').forEach(b => b.onclick = openScanner);
  $('#refresh').onclick = () => { reload(); toast('รีเฟรชข้อมูลแล้ว'); };
  const live = (id, key) => { const el = $('#' + id); if (el) el.oninput = () => { S[key] = el.value; const pos = el.selectionStart; render(); const n = $('#' + id); n.focus(); n.setSelectionRange(pos, pos); }; };
  live('q', 'q'); live('dq', 'docQ'); live('mq', 'mq'); live('pq', 'pq');
  $$('#expReq').forEach(b => b.onclick = exportRequests);
  $('#mAdd') && ($('#mAdd').onclick = () => machineForm(null));
  $('#mImport') && ($('#mImport').onchange = e => { const f = e.target.files[0]; if (f) importExcel(f); e.target.value = ''; });
  $('#dAdd') && ($('#dAdd').onclick = docForm);
  $$('input[name=rtMode]').forEach(r => r.onchange = () => { const self = document.querySelector('input[name=rtMode]:checked').value === 'self'; $('#rtSelf').hidden = !self; $('#rtResubmit').hidden = self; });

  const ms = $('#nMachine');
  if (ms) {
    ms.onchange = () => { const m = M(ms.value); $('#mInfo').innerHTML = ms.value ? `<div class="mcard"><div><span>Model</span>${esc(m.model || '-')}</div><div><span>Serial</span>${esc(m.serial_number || '-')}</div><div><span>Location</span>${esc(m.location || '-')}</div><div><span>Priority</span>${esc(m.priority)}</div><div><span>Member ผู้รับผิดชอบ</span>${esc(nm(m.responsibility))}</div><div><span>Vendor</span>${esc(m.supplier || '-')}</div></div>` : ''; };
    if (S.prefill) { ms.onchange(); S.prefill = null; }
    const mq = $('#nMachineQ');
    if (mq) mq.oninput = () => { const k = mq.value.trim().toLowerCase(); let first = null, n = 0;
      [...ms.options].forEach(o => { if (!o.value) return; const hit = !k || o.textContent.toLowerCase().includes(k); o.hidden = !hit; if (hit) { n++; first ||= o; } });
      if (k && n === 1 && ms.value !== first.value) { ms.value = first.value; ms.onchange(); } };
    $('#nDown') && ($('#nDown').onchange = () => { $('#nDownBox').hidden = !$('#nDown').checked; const st = $('#sfStart'); if ($('#nDown').checked && st) st.value = $('#nDownAt').value; });
    $('#nDownAt') && ($('#nDownAt').onchange = () => { const st = $('#sfStart'); if (st) st.value = $('#nDownAt').value; });
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
        const down = $('#nDown').checked, downAt = down && $('#nDownAt').value ? new Date($('#nDownAt').value).toISOString() : null;
        const row = { machine_no: ms.value, reporter: S.me.email, symptom: sym, machine_down: down, down_since: downAt, first_fix: $('#nFirst').value.trim() || null, urgency: document.querySelector('input[name=nUrg]:checked').value, attachments };
        const issues = closed?._issue || []; if (closed) delete closed._issue;
        Object.assign(row, self ? { ...closed, job_type: 'self_fix' } : { status: 'pending_fd' });
        const { data, error } = await sb.from('requests').insert(row).select().single();
        if (error) throw error;
        if (issues.length) { try { await issueParts(data.id, issues); } catch (e) { toast('ปิดงานแล้ว แต่เบิกอะไหล่ไม่สำเร็จ: ' + (e.message || e)); } }
        await addLog(data.id, self ? 'เปิดใบงานและแก้ไขเอง · ปิดงาน · ' + closed.fix_detail : 'เปิดใบงานแจ้งซ่อม ส่ง Foreman Day อนุมัติ');
        toast(data.id + (self ? ' บันทึกและปิดงานแล้ว' : ' ส่งแล้ว รอ Foreman Day อนุมัติ'));
        await loadAll(); openDetail(data.id);
      } catch (err) { $('#bSubmit').disabled = false; fail(err); }
    };
  }
}

/* =================== BOOT =================== */
let channel = null;
// โหลดข้อมูลใหม่อัตโนมัติทุก 1 นาที และเมื่อกลับมาที่แท็บ · ไม่ทำตอนกำลังกรอกฟอร์มหรือเปิดหน้าต่างค้างไว้
let lastSync = Date.now(), dirty = false;
document.addEventListener('input', e => { if (e.target.closest('#main, #modal')) dirty = true; });
async function autoSync(force = false) {
  if (!S.me || document.hidden || $('#modal') || dirty || ['new'].includes(S.view)) return;
  if (!force && Date.now() - lastSync < 55e3) return;
  if (document.activeElement?.matches('input,textarea,select')) return;
  lastSync = Date.now();
  const y = window.scrollY;
  try { await loadAll(); } catch (e) { return; }
  if ($('#modal') || dirty) return;
  if (S.view === 'detail') await openDetail(S.sel, false); else render();
  window.scrollTo(0, y);
}
setInterval(() => autoSync(), 60e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastSync > 15e3) autoSync(true); });
function subscribe() {
  if (!channel) channel = sb.channel('requests').on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, () => {
    loadAll().then(() => { if (!$('#modal') && !document.activeElement?.matches('input,textarea,select') && S.view !== 'detail') render(); });
  }).subscribe();
}
async function boot() {
  if (C.SUPABASE_URL.includes('YOUR-PROJECT')) { $('#app').innerHTML = '<div class="login"><div class="login-card"><h1>ยังไม่ได้ตั้งค่า Supabase</h1><p>แก้ไขไฟล์ js/config.js ตามคู่มือใน README.md</p></div></div>'; return; }
  const err = urlAuthError();
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === 'SIGNED_IN' && session) setTimeout(() => enter(session), 0);
    else if (ev === 'SIGNED_OUT' && S.me) { S.me = null; renderLogin('ออกจากระบบแล้ว'); }
  });
  const { data } = await sb.auth.getSession();
  if (data?.session && !err) await enter(data.session);
  else if (TRIAL_USER) await enter({ user: { email: TRIAL_USER } });
  else if (!S.me) renderLogin(err);
}
boot();
})();

/* CAPD Maintenance v3 — frontend (vanilla JS + Supabase, Login ด้วย Microsoft 365)
   สิทธิ์จริงตรวจในฐานข้อมูล (supabase/install.sql) หน้าเว็บแค่ซ่อน/แสดงปุ่มให้ตรงกัน
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
  interval: [1, 2, 3, 4, 6, 12, 24, 36],
  docKind: ['คู่มือ PDF', 'SOP/WI', 'Drawing', 'วิดีโอ', 'วิธีแก้ปัญหาเบื้องต้น', 'Certificate', 'อื่นๆ']
};
const ROLES = { member: 'Member', foreman_shift: 'Foreman Shift', foreman_day: 'Foreman Day', manager: 'Manager', admin: 'Admin', operator: 'ผู้ใช้เครื่อง' };
const SL = { pending_fd: 'รอ Foreman Day อนุมัติ', returned: 'ส่งกลับแก้ไข', wait_admin: 'รอ Admin แจ้งซ่อม', ext_repair: 'RMT/FM กำลังซ่อม', quotation: 'ขอใบเสนอราคา / MEMO', memo_approval: 'รอ Manager อนุมัติ MEMO', memo_rejected: 'MEMO ไม่อนุมัติ', po_vendor: 'ออก PO / นัด Vendor', closed: 'ปิดงาน', cancelled: 'ยกเลิก' };
const SCLS = { pending_fd: 's-wait', returned: 's-rej', wait_admin: 's-queue', ext_repair: 's-work', quotation: 's-queue', memo_approval: 's-wait', memo_rejected: 's-rej', po_vendor: 's-test', closed: 's-done', cancelled: 's-done' };
const STATUS_ORDER = ['pending_fd', 'returned', 'wait_admin', 'ext_repair', 'quotation', 'memo_approval', 'memo_rejected', 'po_vendor', 'closed', 'cancelled'];
const ATT = { photo: 'รูปแจ้งซ่อม', external: 'หลักฐานแจ้ง SAP / K2', quotation: 'ใบเสนอราคา', memo: 'MEMO', po: 'PO', close: 'รูป / เอกสารหลังซ่อม', cert: 'Certificate (CAL)' };
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
  map: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
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
  flow: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="9" width="6" height="6" rx="1.5"/><rect x="16" y="3" width="6" height="6" rx="1.5"/><rect x="16" y="15" width="6" height="6" rx="1.5"/><path d="M8 12h4m0-6v12m0-12h4m-4 12h4"/></svg>',
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
const S = { listView: (() => { try { return localStorage.getItem('capd-list-view') || 'list'; } catch (e) { return 'list'; } })(), calView: (() => { try { return localStorage.getItem('capd-cal-view') || 'list'; } catch (e) { return 'list'; } })(), me: null, view: 'home', sel: null, scanNo: null, prefill: null, filter: 'open', q: '', mq: '', docQ: '', docKind: 'all', photos: [], logs: [], att: [] };
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
const hasShort = () => D.profiles.some(p => 'short_name' in p);
// ชื่อย่อ (เช่น MM, OH, Nutt) → อีเมล · ใช้จับคู่ตอนนำเข้าแผนเดิม แต่หน้าเว็บแสดงชื่อจริงเสมอ
// ใส่ได้หลายชื่อ คั่นด้วย , เช่น "TON, Pang"
const aliases = v => String(v || '').split(/[,/;]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
const byShort = v => { const k = String(v || '').trim().toUpperCase(); return k ? D.profiles.find(p => p.active !== false && aliases(p.short_name).includes(k))?.email || null : null; };
const shortClash = (val, email) => { for (const a of aliases(val)) { const u = D.profiles.find(x => x.email !== email && aliases(x.short_name).includes(a)); if (u) return [a, u]; } return null; };
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
// อุปกรณ์ประกอบ: เครื่อง/อุปกรณ์ที่ระบุว่าเป็นของเครื่องนี้ (v3.6 parent_machine)
const kidsOf = no => D.machines.filter(x => x.parent_machine === no);
const parentTag = m => m.parent_machine ? `<span class="sub">อุปกรณ์ของ <a href="?m=${encodeURIComponent(m.parent_machine)}" class="folio" data-scan="${esc(m.parent_machine)}">${esc(m.parent_machine)}</a></span>` : '';
const lowParts = () => D.parts.filter(x => x.active !== false && x.min_qty != null && Number(x.stock) <= Number(x.min_qty));
const qty = v => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const isFD = () => is('foreman_day', 'admin');
const canCreate = () => is('member', 'foreman_shift', 'foreman_day', 'admin');
const canReport = () => canCreate() || role() === 'operator';   // ผู้ใช้เครื่องแจ้งซ่อมได้ (ใบงานไปรอ Foreman อนุมัติ)
// นอกเวลา Admin: 17:00–08:00 และเสาร์–อาทิตย์ (ตรงกับ public.night_now)
const nightNow = () => { const d = new Date(), h = d.getHours(), w = d.getDay(); return h >= 17 || h < 8 || w === 0 || w === 6; };
const canNightApprove = q => q.status === 'pending_fd' && q.job_type !== 'purchase' && q.urgency === 'Critical' && nightNow() && (role() === 'foreman_shift' || canFD(q.machine_no));
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
    case 'pending_fd': case 'ext_repair': { const f = fdsFor(q.machine_no), adm = q.status === 'ext_repair' && !q.external_ref ? ['admin'] : []; return f.length ? { roles: adm, emails: f } : { roles: ['foreman_day', ...adm], emails: [] }; }
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
  // รูปเครื่องจักร (ถ้ายังไม่ได้รัน install.sql รุ่นใหม่ ให้เป็นรายการว่าง)
  const mp = await sb.from('machine_photos').select('*').order('created_at'); D.mphotos = mp.error ? [] : mp.data; D.hasMPhotos = !mp.error;
  // ตรวจก่อนใช้งานประจำวัน: แบบฟอร์ม + ผลตรวจ 60 วันล่าสุด
  const ct = await sb.from('checklist_templates').select('*').order('name'); D.hasChecklist = !ct.error; D.ckTpl = ct.error ? [] : ct.data;
  try { const pa = await sb.rpc('pmcal_auto_on'); D.pmAuto = pa.error ? null : pa.data !== false; } catch (e) { D.pmAuto = null; }
  const fp = await sb.from('floor_plans').select('*').order('sort'); D.hasMap = !fp.error; D.plans = fp.error ? [] : fp.data;
  if (D.hasChecklist) { const d0 = new Date(); d0.setDate(d0.getDate() - 60); const cr = await sb.from('checklist_runs').select('*').gte('run_date', d0.toISOString().slice(0, 10)).order('created_at', { ascending: false }); D.ckRuns = cr.error ? [] : cr.data; } else D.ckRuns = [];
  // ประวัติทุกใบงาน (หน้า Flow / รายงาน) โหลดเมื่อเปิดหน้านั้นครั้งแรก แล้วรีเฟรชพร้อมข้อมูลอื่น
  if (D.logsAll) { const lg = await sb.from('request_logs').select('request_id, at, action, actor').order('at'); if (!lg.error) D.logsAll = lg.data || []; }
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
function shrink(file, max = 1600) {
  return new Promise(res => {
    const r = new FileReader();
    r.onload = () => { const img = new Image(); img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); c.toBlob(b => res(b), 'image/jpeg', 0.82); }; img.onerror = () => res(null); img.src = r.result; };
    r.readAsDataURL(file);
  });
}
async function uploadFiles(prefix, kind, files, max) {
  const out = [];
  for (const [i, f] of [...(files || [])].entries()) {
    const isImg = /^image\//.test(f.type);
    const body = isImg ? (await shrink(f, max)) || f : f;
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
  $('#actbar')?.remove(); document.body.classList.remove('has-actbar', 'view-detail');
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
const NAV_ICON = { map: 'map', checks: 'approve', home: 'home', new: 'new', list: 'list', approve: 'approve', flow: 'flow', machine: 'machine', parts: 'parts', cal: 'cal', docs: 'docs', report: 'report', admin: 'admin' };
// เมนู: งานประจำวันบน ข้อมูลอ้างอิงล่าง · "แจ้งซ่อม" เป็นปุ่ม · อนุมัติรวมในหน้าหลัก · Flow รวมในใบงาน
function navGroups() {
  if (isOp()) return [['ตรวจเครื่อง', [['home', 'หน้าหลัก'], ...(D.hasMap ? [['map', 'แผนผังเครื่อง']] : [])]]];
  return [
    ['งาน', [['home', 'หน้าหลัก', myTasks().length], ['list', 'ใบงาน'], ['cal', 'PM / CAL', myReminders().length]]],
    ['เครื่องและอะไหล่', [['machine', 'เครื่องจักร'], ...(D.hasChecklist ? [['checks', 'ตรวจประจำวัน', isFD() ? ckNgToday() : 0]] : []), ...(D.hasMap ? [['map', 'แผนผังเครื่อง']] : []), ['parts', 'อะไหล่', canParts() ? lowParts().length : 0]]],
    ['ข้อมูล', [['docs', 'คลังเอกสาร'], ['report', 'รายงาน']]]
  ];
}
function navItems() {
  const nav = navGroups().flatMap(g => g[1]);
  if (isAdmin()) nav.push(['admin', 'ผู้ใช้และสิทธิ์']);
  return nav;
}
const CRUMBS = { map: 'แผนผังเครื่อง', checks: 'ตรวจเครื่องประจำวัน', vendors: 'Vendor', flow: 'Flow งาน', parts: 'คลังอะไหล่', home: 'หน้าหลัก', new: 'แจ้งซ่อม / เปิดใบงาน', list: 'ใบงานทั้งหมด', approve: 'รออนุมัติ', machine: 'เครื่องจักร', cal: 'แผน PM / CAL', docs: 'คลังเอกสาร', report: 'รายงาน', admin: 'ผู้ใช้และสิทธิ์', detail: 'รายละเอียดใบงาน', scan: 'Dashboard เครื่องจักร' };
const navOn = k => S.view === k || (['detail', 'flow'].includes(S.view) && k === 'list') || (S.view === 'approve' && k === 'home') || (['scan', 'vendors'].includes(S.view) && k === 'machine');
function render() {
  if (!S.me) return renderLogin();
  if (isOp() && !['home', 'scan', 'map', 'new', 'detail'].includes(S.view)) S.view = 'home';
  dirty = false; lastSync = Date.now();
  const nav = navItems(), more = nav.filter(([k]) => !['home', 'new', 'list', ...(isOp() ? ['map'] : [])].includes(k)), moreBadge = more.reduce((a, x) => a + (x[2] || 0), 0);
  const sub = S.view === 'detail' ? S.sel : S.view === 'scan' ? S.scanNo : esc(roleText(S.me));
  const back = ['detail', 'scan'].includes(S.view);
  $('#app').innerHTML = `
  <div class="shell">
    <aside class="side" aria-label="เมนูหลัก">
      <div class="brand">${LOGO}<span>CAPD <b>Maintenance</b><small>${esc(C.ORG)}</small></span></div>
      <nav class="side-nav">${canCreate() ? `<button data-nav="new" class="side-cta ${navOn('new') ? 'on' : ''}">${IC.plus}<span>แจ้งซ่อม</span></button>` : ''}${navGroups().map(([g, items]) => `<p class="side-g">${g}</p>${items.map(([k, l, b]) => `<button data-nav="${k}" class="${navOn(k) ? 'on' : ''}">${IC[NAV_ICON[k]]}<span>${l}</span>${b ? `<i class="badge">${b}</i>` : ''}</button>`).join('')}`).join('')}</nav>
      ${isAdmin() ? `<nav class="side-nav side-admin"><button data-nav="admin" class="${navOn('admin') ? 'on' : ''}">${IC.admin}<span>ผู้ใช้และสิทธิ์</span></button></nav>` : ''}
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
  <nav class="bnav ${isOp() ? (D.hasMap ? 'op op4' : 'op') : ''}" aria-label="เมนูหลัก">
    <button data-nav="home" class="${navOn('home') ? 'on' : ''}">${IC.home}<span>หน้าหลัก</span>${myTasks().length ? `<i class="badge">${myTasks().length}</i>` : ''}</button>
    ${isOp() ? (D.hasMap ? `<button data-nav="map" class="${navOn('map') ? 'on' : ''}">${IC.map}<span>แผนผัง</span></button>` : '') : `<button data-nav="new" class="${navOn('new') ? 'on' : ''}">${IC.new}<span>แจ้งซ่อม</span></button>`}
    <button data-scanqr class="fabw" aria-label="สแกน QR ที่เครื่อง"><span class="fab">${IC.qr}</span><span>สแกน</span></button>
    ${isOp() ? '' : `<button data-nav="list" class="${navOn('list') ? 'on' : ''}">${IC.list}<span>ใบงาน</span></button>`}
    <button id="moreBtn" class="${more.some(([k]) => navOn(k)) ? 'on' : ''}">${IC.more}<span>เมนู</span>${moreBadge ? `<i class="badge">${moreBadge}</i>` : ''}</button>
  </nav>`;
  bind();
}
function moreSheet() {
  const nav = navItems().filter(([k]) => !['home', 'new', 'list'].includes(k));
  modal(`<div class="sheet-head">${avatar(S.me.email)}<div><b>${esc(S.me.full_name || S.me.email)}</b><div class="sub">${esc(roleText(S.me))}</div></div></div>
    ${navGroups().map(([g, items]) => { const it = items.filter(([k]) => !['home', 'list'].includes(k)); return it.length ? `<p class="side-g">${g}</p><div class="sheet-grid">${it.map(([k, l, b]) => `<button data-nav="${k}" class="${navOn(k) ? 'on' : ''}">${IC[NAV_ICON[k]]}<span>${l}</span>${b ? `<i class="badge">${b}</i>` : ''}</button>`).join('')}</div>` : ''; }).join('')}
    ${isAdmin() ? `<p class="side-g">ตั้งค่า</p><div class="sheet-grid"><button data-nav="admin" class="${navOn('admin') ? 'on' : ''}">${IC.admin}<span>ผู้ใช้และสิทธิ์</span></button></div>` : ''}
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
    if (isOp()) return opHome();
    const t = myTasks(), open = D.requests.filter(q => OPEN(q.status)), rem = myReminders();
    const crit = open.filter(q => q.urgency === 'Critical').length, soon = rem.filter(q => daysLeft(q.due_date) <= 30).length;
    const tile = (ic, tone, n, label, nav) => `<button class="tile ${tone}" ${nav ? `data-nav="${nav}"` : ''}><span class="ti">${ic}</span><b data-count="${n}">${n}</b><span>${label}</span></button>`;
    const pl = planList(), onTime = pl.filter(x => x.days >= 0).length;
    return `<div class="hello"><h1>สวัสดี, ${esc(String(S.me.full_name || S.me.email).split(' ')[0])}</h1><span class="sub">${esc(roleText(S.me))}${t.length ? ` · มี ${t.length} งานรอคุณ` : ' · ไม่มีงานค้าง'}</span></div>
    <div class="tiles">
      ${tile(IC.approve, 't-info', t.length, 'งานรอฉัน', '')}
      ${tile(IC.list, 't-ok', open.length, 'ใบงานที่ยังเปิด', 'list')}
      ${tile(IC.warn, crit ? 't-bad alert' : 't-bad', crit, 'Critical ที่ยังเปิด', 'list')}
      ${tile(IC.cal, 't-warn', soon, 'PM/CAL ใน 30 วัน', 'cal')}
    </div>
    ${rem.length ? `<div class="remind"><b>${IC.cal} PM / CAL ที่ต้องเริ่มดำเนินการ</b>${rem.map(q => { const d = daysLeft(q.due_date); return `<div class="rrow" data-open="${esc(q.id)}"><span class="tier t${tierOf(d)}">ขั้น ${tierOf(d)}</span><span><b>${esc(q.machine_no)}</b> ${esc(q.pmcal_kind)} ครบกำหนด ${fd(q.due_date)} · ${d < 0 ? 'เกิน ' + (-d) : 'อีก ' + d} วัน</span><span class="sub">${esc(nm(q.assignee))}</span></div>`; }).join('')}</div>` : ''}
    <div class="home-grid">
      <section class="stack">${canCreate() ? `<div class="sec-h"><span class="sp"></span><button class="btn hide-desk" data-nav="new">${IC.plus} แจ้งซ่อม</button></div>` : ''}
        ${(() => { const fdRows = D.requests.filter(q => q.status === 'pending_fd').sort((a, b) => canFD(b.machine_no) - canFD(a.machine_no)), memoRows = D.requests.filter(q => q.status === 'memo_approval' && (isAdmin() || q.memo_approvers[q.memo_step] === S.me.email)); const showAll = isAdmin() || is('foreman_day', 'manager'); return tabs('home', [['mine', 'งานของฉัน', taskTable(t, 'ไม่มีงานค้างสำหรับคุณ', true), t.length], showAll ? ['appr', 'รออนุมัติทั้งหมด', `<h3 class="sec" style="margin-top:4px">ใบแจ้งซ่อมรอ Foreman Day อนุมัติ (${fdRows.length})</h3>${taskTable(fdRows, 'ไม่มีใบงานรออนุมัติ', true)}<h3 class="sec">MEMO รอ${isAdmin() ? ' Manager' : 'คุณ'}อนุมัติ (${memoRows.length})</h3>${taskTable(memoRows, 'ไม่มี MEMO รออนุมัติ', true)}`, fdRows.length + memoRows.length] : null]); })()}
      </section>
      <div class="stack">
        ${ckBox()}
        ${nextUpCard()}
        ${pl.length ? `<section class="box dial-box"><h3>PM / CAL ไม่เกินกำหนด</h3>${dial(onTime, pl.length, 'ตรงเวลา', `${onTime} จาก ${pl.length} แผน · เกินกำหนด ${pl.length - onTime}`)}</section>` : ''}
        <section class="box"><h3>งานเข้า / ปิด รายสัปดาห์</h3>${weekChart()}</section>
      </div>
    </div>`;
  },

  list() {
    let rows = D.requests.slice();
    if (S.filter === 'open') rows = rows.filter(q => OPEN(q.status)); else if (S.filter === 'hold') rows = rows.filter(q => OPEN(q.status) && q.hold_reason); else if (S.filter === 'down') rows = rows.filter(q => OPEN(q.status) && q.machine_down); else if (S.filter !== 'all') rows = rows.filter(q => q.status === S.filter);
    if (S.q) { const k = S.q.toLowerCase(); rows = rows.filter(q => [q.id, q.machine_no, M(q.machine_no).machine_name, q.symptom, q.reporter, q.assignee, q.external_ref, q.memo_no, q.po_no, jobType(q)].join(' ').toLowerCase().includes(k)); }
    const chips = [['open', 'ยังเปิด', D.requests.filter(q => OPEN(q.status)).length], ['all', 'ทั้งหมด', D.requests.length], ['down', 'เครื่องหยุด', D.requests.filter(q => OPEN(q.status) && q.machine_down).length], ['hold', 'พักงาน', D.requests.filter(q => OPEN(q.status) && q.hold_reason).length], ...STATUS_ORDER.map(s => [s, SL[s], D.requests.filter(q => q.status === s).length])].filter(x => x[2] || ['open', 'all'].includes(x[0]));
    if (S.listView === 'flow') return VIEWS.flow();
    return `<div class="h-row"><h1>ใบงานทั้งหมด</h1><span class="sub">${rows.length} รายการ</span>${listToggle()}${moreMenu(['<button class="mi" id="expReq">Export Excel</button>'])}</div>
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
    if (!canReport()) return `<div class="h-row"><h1>แจ้งซ่อม</h1></div><div class="empty">บทบาท ${ROLES[role()]} ไม่ได้เปิดใบงาน (เปิดได้เฉพาะ Member, Foreman Shift, Foreman Day, Admin)</div>`;
    const ms = D.machines.filter(m => m.status !== 'Inactive');
    if (!ms.length) return `<div class="h-row"><h1>แจ้งซ่อม</h1></div><div class="empty">ยังไม่มีเครื่องจักรในระบบ</div>`;
    return `<div class="h-row"><h1>แจ้งซ่อม / เปิดใบงาน</h1><span class="sub">ผู้เปิด: ${esc(S.me.email)}</span></div>
    <form id="fNew" class="form">
      <div class="field full"><label for="nMachine">เครื่องจักร *</label>
        <input id="nMachineQ" class="inp" type="search" placeholder="พิมพ์ค้นหา รหัส / ชื่อเครื่อง / Location" autocomplete="off" aria-label="ค้นหาเครื่องจักร" style="margin-bottom:6px">
        <select id="nMachine" class="inp" required><option value="">— เลือกจากทะเบียนเครื่องจักร —</option>${ms.map(m => `<option value="${esc(m.machine_no)}" ${m.machine_no === S.prefill ? 'selected' : ''}>${esc(m.machine_no)} · ${esc(m.machine_name)} (${esc(m.location || '-')})</option>`).join('')}</select></div>
      <div class="full" id="mInfo"></div>
      <div class="field full"><label for="nSym">อาการที่พบ *</label><textarea id="nSym" class="inp" rows="3" required>${esc(S.prefillSym || '')}</textarea></div>
      <div class="field full"><label for="nFirst">วิธีแก้ไขเบื้องต้นที่ทำไปแล้ว</label><textarea id="nFirst" class="inp" rows="2"></textarea></div>
      <div class="field"><span class="flabel">ความเร่งด่วน *</span><div class="urg">${OPT.prio.map((p, i) => `<label class="u-${p}" for="nUrg${i}"><input type="radio" name="nUrg" id="nUrg${i}" value="${p}" ${p === 'High' ? 'checked' : ''}>${p}</label>`).join('')}</div></div>
      <div class="field"><label for="nPhoto">รูปภาพ</label><input id="nPhoto" type="file" accept="image/*" multiple class="inp"></div>
      <div class="field"><span class="flabel">เครื่องหยุดหรือไม่</span><label><input type="checkbox" id="nDown"> เครื่องหยุดใช้งาน</label>
        <div id="nDownBox" hidden style="margin-top:6px"><label for="nDownAt" class="sub">หยุดตั้งแต่ (ใช้คำนวณ Downtime)</label><input id="nDownAt" class="inp" type="datetime-local" value="${localInput(Date.now())}"></div></div>
      ${isOp() ? '<input type="radio" name="nMode" value="request" checked hidden><p class="sub full" style="margin:0">ใบงานจะส่งให้ Foreman อนุมัติ · ถ้าเร่งด่วนให้แจ้ง Foreman Shift ด้วย</p>' : `<div class="field full choice">
        <label><input type="radio" name="nMode" value="request" id="nModeReq" checked> <b>แก้ไขเองไม่ได้</b> · ส่งให้ Foreman Day อนุมัติซ่อม</label>
        <label><input type="radio" name="nMode" value="self" id="nModeSelf"> <b>แก้ไขเองได้แล้ว</b> · บันทึกวิธีแก้และปิดงานทันที</label>
      </div>`}
      <div class="full" id="selfBox" hidden>${closeFields('sf', null)}</div>
      <div class="full btns"><button class="btn" type="submit" id="bSubmit">ส่งใบงาน</button><button class="btn ghost" type="button" data-nav="home">ยกเลิก</button></div>
    </form>`;
  },

  detail() {
    const q = D.requests.find(x => x.id === S.sel); if (!q) return '<div class="empty">ไม่พบรายการ</div>';
    const m = M(q.machine_no);
    const kv = (k, v) => v == null || v === '' ? '' : `<dt>${k}</dt><dd>${v}</dd>`;
    const att = S.att.length ? Object.entries(ATT).map(([k, label]) => { const a = S.att.filter(x => x.kind === k); return a.length ? `<div class="attg"><span class="sub">${label}</span>${a.map(x => `<span class="attw">${/\.(jpe?g|png|gif|webp)$/i.test(x.name) ? `<a href="${esc(x.url)}" target="_blank" rel="noopener"><img src="${esc(x.url)}" alt="${esc(x.name)}"></a>` : `<a class="file" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>`}${canRemoveAtt(q, x) ? `<button class="attx" data-attdel="${esc(x.path)}" title="ลบไฟล์ ${esc(x.name)}" aria-label="ลบไฟล์ ${esc(x.name)}">×</button>` : ''}</span>`).join('')}</div>` : ''; }).join('') : '';
    const nAtt = S.att.length, nLog = S.logs.length;
    return `<div class="h-row"><h1>${esc(q.id)}</h1>${pill(q.status)}${holdPill(q)}<span class="sp"></span>${moreMenu([
        canEdit(q) ? '<button class="mi" id="qEdit">แก้ไขใบงาน</button>' : '',
        OPEN(q.status) && canHold(q) && !q.hold_reason ? '<button class="mi" id="qHold">พักงาน (รออะไหล่ / รอ Vendor)</button>' : '',
        q.job_type === 'pmcal' && q.machine_no ? `<button class="mi" data-tagjob="1">พิมพ์ Tag ${esc(q.pmcal_kind || '')}${q.status === 'closed' ? '' : ' (ร่าง)'}</button>` : '',
        q.memo_doc && !['quotation'].includes(q.status) ? `<button class="mi" data-memo="1">เปิด MEMO ${esc(q.memo_no || '')}</button>` : '',
        canCancel(q) ? '<button class="mi bad-t" id="qCancel">ยกเลิกใบงาน</button>' : '',
        isAdmin() ? '<button class="mi bad-t" id="qDel">ลบใบงาน</button>' : ''])}</div>
    <div class="jsum">
      <div><span>เครื่องจักร</span>${q.machine_no ? `<a href="?m=${encodeURIComponent(m.machine_no)}" class="folio" data-scan="${esc(m.machine_no)}">${esc(m.machine_no)}</a> ${esc(m.machine_name || '')}` : '<span class="sub">ไม่ระบุ (ใช้ทั่วไป)</span>'}</div>
      <div class="wide"><span>${q.job_type === 'purchase' ? 'รายการ' : 'อาการ'}</span>${esc(q.symptom)}</div>
      <div><span>ความเร่งด่วน</span><b class="u-${esc(q.urgency)}">${esc(q.urgency)}</b>${q.machine_down && OPEN(q.status) ? ' · <b class="u-Critical">เครื่องหยุด</b>' : ''}</div>
      <div><span>${OPEN(q.status) ? 'รอ' : 'สถานะ'}</span><b>${OPEN(q.status) ? esc(ownerText(q)) : q.status === 'closed' ? 'ปิดงานแล้ว' : 'ยกเลิกแล้ว'}</b></div>
    </div>
    ${jobFlow(q)}
    <div class="detail1">
        ${OPEN(q.status) ? holdBox(q) : ''}${actionArea(actions(q))}
        ${tabs('job', [['info', 'ข้อมูลใบงาน', `<div class="stack">
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
        ${q.memo_approvers?.length ? memoChain(q) : ''}
        ${q.status === 'closed' ? `<div class="box"><h3>สรุปผลการซ่อม</h3><dl class="kv">
          ${kv('วิธีการแก้ไข', esc(q.fix_detail))}${kv('สาเหตุ', esc(q.root_cause))}${kv('อะไหล่ที่ใช้', esc(q.parts_used))}
          ${kv('ค่าใช้จ่าย', money(q.cost_thb))}${kv('เริ่ม', fd(q.start_at))}${kv('เสร็จ', fd(q.end_at))}${kv('ระยะเวลา / Downtime', q.downtime_min != null ? q.downtime_min + ' นาที' : '')}
          ${kv('ปิดงานโดย', esc(nm(q.closed_by)))}</dl></div>` : ''}
        </div>`],
          ['files', 'ไฟล์แนบ', att ? `<div class="box"><div class="atts">${att}</div></div>` : '<div class="empty">ยังไม่มีไฟล์แนบ</div>', nAtt || null],
          ['log', 'ประวัติ', `<div class="box"><ul class="timeline">${S.logs.map(l => `<li>${avatar(l.actor, 's')}<div>${esc(l.action)}<small>${esc(nm(l.actor))} · ${fd(l.at)}</small></div></li>`).join('') || '<li><div class="sub">—</div></li>'}</ul></div>`, nLog || null]])}
    </div>`;
  },

  machine() {
    let rows = D.machines;
    if (S.mq) { const k = S.mq.toLowerCase(); rows = rows.filter(m => Object.values(m).join(' ').toLowerCase().includes(k)); }
    return `<div class="h-row"><h1>Machine Master</h1><span class="sub">${D.machines.length} เครื่อง</span>${D.hasParts ? '<button class="btn ghost" data-nav="vendors">Vendor</button>' : ''}
      ${isAdmin() ? `<button class="btn" id="mAdd">+ เพิ่มเครื่อง</button><button class="btn ghost" id="qrAll">พิมพ์ QR ทั้งหมด</button><label class="btn ghost" for="mImport" style="cursor:pointer">นำเข้าจาก Excel</label><input id="mImport" type="file" accept=".xlsx,.xls" hidden>` : ''}</div>
    <div class="fbar"><span class="sub">${isAdmin() ? 'นำเข้าแบบฟอร์ม CAPD-Maintenance-Data-Template.xlsx หรือไฟล์แผนเดิม (ชีท LAB EQUIP.PLAN) · กดรหัสเครื่องเพื่อดู Dashboard' : 'แก้ไขได้เฉพาะ Admin'}</span><div class="sp"></div><label class="sr" for="mq">ค้นหาเครื่อง</label><input id="mq" class="search" placeholder="ค้นหาเครื่อง / Location" value="${esc(S.mq)}"></div>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Machine no.</th><th>Machine Name</th><th>Model</th><th>Serial</th><th>Type</th><th>Location</th><th>Status</th><th>Priority</th><th>Maint. Type</th><th>Responsibility</th><th>Vendor</th><th>Contact</th>${isAdmin() ? '<th></th>' : ''}</tr></thead><tbody>
    ${rows.map(m => `<tr><td class="mono"><span class="mrow">${mPhotos(m.machine_no)[0] ? imgTag(mPhotos(m.machine_no)[0].path, '', 'mthumb') : ''}<a class="folio" href="?m=${encodeURIComponent(m.machine_no)}" data-scan="${esc(m.machine_no)}">${esc(m.machine_no)}</a></span></td><td>${esc(m.machine_name)}${m.parent_machine ? '<br>' + parentTag(m) : ''}${kidsOf(m.machine_no).length ? `<br><span class="sub">อุปกรณ์ประกอบ ${kidsOf(m.machine_no).length} รายการ</span>` : ''}</td><td>${esc(m.model)}</td><td class="mono">${esc(m.serial_number)}</td><td>${esc(m.machine_type)}</td><td>${esc(m.location)}</td><td><span class="pill ${m.status === 'Active' ? 's-confirm' : m.status === 'Maintenance' ? 's-wait' : 's-done'}">${esc(m.status)}</span></td><td class="u-${esc(m.priority)}">${esc(m.priority)}</td><td>${esc(m.maintenance_type)}</td><td>${esc(nm(m.responsibility))}</td><td>${esc(m.supplier)}</td><td>${esc(m.contact_person)}<br><span class="sub">${esc(m.phone)}</span></td>${isAdmin() ? `<td class="row-actions"><button class="btn ghost sm" data-medit="${esc(m.machine_no)}">แก้ไข</button><button class="btn ghost sm" data-qr="${esc(m.machine_no)}">QR</button><button class="btn ghost sm bad-t" data-mdel="${esc(m.machine_no)}">ลบ</button></td>` : ''}</tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">ยังไม่มีข้อมูลเครื่องจักร</div>'}`;
  },

  cal() {
    if (S.calView === 'month') return calMonth();
    if (S.calView === 'week') return calWeek();
    const p = planList();
    const st = d => d < 0 ? `<span class="pill s-rej">เกินกำหนด ${-d} วัน</span>` : d <= 90 ? `<span class="pill s-wait">อีก ${d} วัน · ขั้น ${tierOf(d)}</span>` : `<span class="pill s-confirm">อีก ${d} วัน</span>`;
    return `<div class="h-row"><h1>แผน PM / CAL</h1>${calToggle()}${D.pmAuto === false ? '<span class="pill s-wait" title="Admin ปิดไว้ · กดปุ่ม “เปิดใบงาน” ในแต่ละแถวเมื่อพร้อมเริ่มงาน">เปิดใบงานอัตโนมัติ: ปิด</span>' : '<span class="sub">ระบบเปิดใบงานอัตโนมัติเมื่อเหลือ 90 วัน และแจ้งเตือน 3 ขั้น</span>'}${calMenu()}</div>
    <div class="note" style="margin-bottom:14px">ขั้น 1 (≤ 3 เดือน): Member ผู้รับผิดชอบ · ขั้น 2 (≤ 2 เดือน): + Foreman Day · ขั้น 3 (≤ 1 เดือน): + Manager · เตือนทุกวันจนกว่า Member จะกด “เริ่มดำเนินการ” ในใบงาน</div>
    ${p.length ? `<div class="tbl-wrap"><table><thead><tr><th>Machine</th><th>ประเภท</th><th>ครั้งล่าสุด</th><th>Interval</th><th>ครบกำหนด</th><th>สถานะ</th><th>Member</th><th>ใบงาน</th>${isAdmin() ? '<th></th>' : ''}</tr></thead><tbody>
    ${p.map(x => `<tr><td><b class="mono">${esc(x.m.machine_no)}</b> ${esc(x.m.machine_name)}<br><span class="sub">${esc(x.m.location)}</span>${x.m.parent_machine ? ' · ' + parentTag(x.m) : ''}</td><td>${x.kind}<br><button class="btn ghost sm" data-tag="${esc(x.m.machine_no)}|${x.kind}" title="พิมพ์ Tag ${x.kind}">Tag</button></td><td class="num">${fd(x.last)}</td><td class="num">${x.iv} เดือน</td><td class="num">${fd(x.next)}</td><td>${st(x.days)}</td><td>${esc(nm(x.m.responsibility))}</td><td>${x.job ? `<a class="folio" href="#" data-open="${esc(x.job.id)}">${esc(x.job.id)}</a><br>${pill(x.job.status)}${x.job.action_at ? '' : '<br><span class="sub">ยังไม่เริ่มดำเนินการ</span>'}` : `<span class="sub">-</span>${canOpenPm(x.m) ? `<br><button class="btn ghost sm" data-pmopen="${esc(x.m.machine_no)}|${x.kind}">เปิดใบงาน</button>` : ''}`}</td>${isAdmin() ? `<td><button class="btn ghost sm" data-done="${esc(x.m.machine_no)}|${x.kind}" title="แก้วันที่ทำล่าสุดเป็นวันนี้">ทำแล้ววันนี้</button></td>` : ''}</tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">ยังไม่มีแผน PM/CAL — ใส่วันที่ล่าสุดและ Interval ในหน้าเครื่องจักร</div>'}`;
  },

  parts() {
    if (!D.hasParts) return `<div class="h-row"><h1>คลังอะไหล่</h1></div><div class="empty">ยังไม่ได้เปิดคลังอะไหล่ · Admin รัน supabase/install.sql ใน Supabase</div>`;
    let rows = D.parts;
    if (S.pfilter === 'off') rows = rows.filter(x => x.active === false); else rows = rows.filter(x => x.active !== false);
    const match = x => !S.pq || [x.part_no, x.name, x.spec, x.location, x.vendor, ...(x.machines || [])].join(' ').toLowerCase().includes(S.pq.toLowerCase());
    rows = rows.filter(match);
    const value = D.parts.reduce((a, x) => a + Number(x.stock || 0) * Number(x.unit_price || 0), 0), low = lowParts();
    const openPR = D.requests.filter(q => q.job_type === 'purchase' && OPEN(q.status));
    const table = list => list.length ? `<div class="tbl-wrap"><table class="cardtbl"><thead><tr><th>Part no</th><th>ชื่อ / Spec</th><th class="num">คงเหลือ</th><th class="num">Min / Max</th><th>ที่เก็บ</th><th class="num">ราคา/หน่วย</th><th>ใช้กับเครื่อง</th><th></th></tr></thead><tbody>
      ${list.map(x => { const lo = x.min_qty != null && Number(x.stock) <= Number(x.min_qty); return `<tr class="prow" data-pdetail="${esc(x.part_no)}"><td class="mono" data-label="Part no"><a href="#" class="folio">${esc(x.part_no)}</a></td><td class="c-main">${esc(x.name)}<br><span class="sub">${esc(x.spec || '')}${x.vendor ? ' · ' + esc(x.vendor) : ''}</span></td>
      <td class="num" data-label="คงเหลือ"><span class="pill ${lo ? 's-rej' : 's-confirm'}">${qty(x.stock)} ${esc(x.unit)}${lo ? ' · ต่ำกว่า Min' : ''}</span></td><td class="num" data-label="Min / Max">${x.min_qty ?? '-'} / ${x.max_qty ?? '-'}</td><td data-label="ที่เก็บ">${esc(x.location || '-')}</td><td class="num" data-label="ราคา/หน่วย">${x.unit_price != null ? num2(x.unit_price) : '-'}</td>
      <td data-label="เครื่อง">${(x.machines || []).map(no => `<a href="#" class="folio" data-scan="${esc(no)}">${esc(no)}</a>`).join(', ') || '-'}</td>
      <td class="row-actions">${canCreate() ? (Number(x.stock) > 0 ? `<button class="btn ghost sm" data-pissue="${esc(x.part_no)}">เบิก</button>` : `<button class="btn ghost sm" data-pbuy="${esc(x.part_no)}">ขอซื้อ</button>`) : ''}</td></tr>`; }).join('')}
    </tbody></table></div>` : '<div class="empty">ไม่พบอะไหล่</div>';
    return `<div class="h-row"><h1>คลังอะไหล่</h1><span class="sub">${D.parts.length} รายการ · มูลค่าคงคลัง ${num2(value)} บาท</span><span class="sp"></span>
      ${canCreate() ? '<button class="btn" id="prNew">+ คำขอซื้อ</button>' : ''}${moreMenu([canCreate() ? '<button class="mi" id="ptIssue">เบิกอะไหล่ (ไม่มีใบงาน)</button>' : '', canParts() ? '<button class="mi" id="ptAdd">+ เพิ่มอะไหล่ใหม่</button>' : ''])}</div>
    ${tabs('parts', [
      ['reg', 'ทะเบียนอะไหล่', `<div class="fbar">${[['all', 'ใช้งาน', D.parts.filter(x => x.active !== false).length], ['off', 'เลิกใช้', D.parts.filter(x => x.active === false).length]].map(([k, l, n]) => `<button class="chip ${(S.pfilter === 'off' ? 'off' : 'all') === k ? 'on' : ''}" data-pfilter="${k}">${l} <span class="sub">${n}</span></button>`).join('')}
        <div class="sp"></div><label class="sr" for="pq">ค้นหาอะไหล่</label><input id="pq" class="search" placeholder="ค้นหา Part no / ชื่อ / เครื่อง / Rack" value="${esc(S.pq || '')}"></div>
        <p class="sub" style="margin:0 0 8px">กดที่รายการเพื่อดูประวัติ ปรับยอด หรือแก้ไข</p>${table(rows)}`],
      ['low', 'ต่ำกว่า Min', `${low.length && canCreate() ? '<div class="btns" style="margin-bottom:10px"><button class="btn" id="prLow">ขอซื้อทุกรายการที่ต่ำกว่า Min</button></div>' : ''}${low.length ? table(low) : '<div class="empty">ไม่มีอะไหล่ที่ต่ำกว่า Min</div>'}`, low.length],
      ['pr', 'คำขอซื้อที่ยังไม่ปิด', openPR.length ? taskTable(openPR) : '<div class="empty">ไม่มีคำขอซื้อค้าง</div>', openPR.length]])}`;
  },

  checks() { return ckPage(); },
  map() { return mapPage(); },
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

  vendors() {
    if (!D.hasParts) return '<div class="empty">ยังไม่ได้เปิดใช้ทะเบียน Vendor · Admin รัน supabase/install.sql</div>';
    let rows = D.vendors.slice();
    if (S.vq) { const k = S.vq.toLowerCase(); rows = rows.filter(v => [v.name, v.work_type, v.contact_person, v.phone, v.email, ...(v.machines || [])].join(' ').toLowerCase().includes(k)); }
    return `<div class="h-row"><button class="btn ghost" data-nav="machine">← เครื่องจักร</button><h1>Vendor</h1><span class="sub">${D.vendors.length} ราย · 1 ราย ผูกได้หลายเครื่อง กดชื่อเพื่อแก้ไข</span>${canCreate() ? '<button class="btn" id="vAdd">+ เพิ่ม Vendor</button>' : ''}</div>
    <div class="fbar"><span class="sub">นำเข้าหลายรายพร้อมกันได้จากชีท Vendors ในไฟล์ Excel (เมนู เครื่องจักร → นำเข้าจาก Excel)</span><div class="sp"></div><label class="sr" for="vq">ค้นหา Vendor</label><input id="vq" class="search" placeholder="ค้นหา ชื่อ / เครื่อง / เบอร์" value="${esc(S.vq || '')}"></div>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Vendor</th><th>ประเภทงาน</th><th>ผู้ติดต่อ</th><th>ติดต่อ</th><th>ใช้กับเครื่อง</th></tr></thead><tbody>${rows.map(v => `<tr class="${v.active === false ? 'off' : ''}"><td><a href="#" class="folio" data-vedit="${esc(v.name)}">${esc(v.name)}</a></td><td>${esc(v.work_type || '-')}</td><td>${esc(v.contact_person || '-')}</td>
      <td>${v.phone ? String(v.phone).split(/[,/]/).map(p => `<a href="${esc(telHref(p.trim()))}">${esc(p.trim())}</a>`).join('<br>') : ''}${v.email ? `${v.phone ? '<br>' : ''}<a href="mailto:${esc(v.email)}">${esc(v.email)}</a>` : ''}${!v.phone && !v.email ? '-' : ''}</td>
      <td>${(v.machines || []).length ? `<span class="pill s-queue">${v.machines.length} เครื่อง</span> <span class="sub">${v.machines.slice(0, 4).map(esc).join(', ')}${v.machines.length > 4 ? ' …' : ''}</span>` : '<span class="sub">ยังไม่ได้เลือกเครื่อง</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">ยังไม่มี Vendor</div>'}`;
  },

  flow() {
    if (!D.logsAll) ensureLogs();
    const kinds = [['all', 'ทั้งหมด'], ['repair', 'งานซ่อม'], ['pmcal', 'PM / CAL'], ['purchase', 'คำขอซื้อ']];
    const cnt = k => D.requests.filter(q => OPEN(q.status) && (k === 'all' || flowKind(q) === k)).length;
    const b = flowBoard();
    return `<div class="h-row"><h1>ใบงาน · Flow</h1>${listToggle()}<span class="sub">งานที่ยังไม่ปิด ${cnt('all')} ใบ · กดกล่องเพื่อดูรายการ${D.logsAll ? '' : ' · กำลังโหลดเวลาในแต่ละขั้น…'}</span></div>
    <div class="fbar">${kinds.map(([k, l]) => `<button class="chip ${(S.fkind || 'all') === k ? 'on' : ''}" data-fkind="${k}">${l} <span class="sub">${cnt(k)}</span></button>`).join('')}</div>
    ${b.html}
    <div class="note" style="margin-bottom:14px">สีเขียว = มีงานอยู่ในขั้นนี้ · สีส้ม = มีงานค้าง (อยู่ในขั้นเดิมเกิน 3 วัน · PM/CAL เหลือ ≤ 30 วันแล้วยังไม่เริ่ม) · ตัวเลข = จำนวนใบงานตอนนี้</div>
    ${b.pick ? `<h3 class="sec">${esc(b.pickLabel)} (${b.pick.length})</h3>${taskTable(b.pick.slice().sort((x, y) => isStuck(y) - isStuck(x) || stageAge(y) - stageAge(x)), 'ไม่มีใบงานในขั้นนี้')}` : ''}`;
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
      <div class="tile"><b data-count="${onTime}" data-suffix="%">${onTime}%</b><span>PM/CAL ไม่เกินกำหนด</span></div>
    </div>
    <div class="grid2">
      <div class="box"><h3>จำนวนใบงานตามประเภท</h3>${bars(byType, 'ใบ', k => esc(k))}</div>
      <div class="box"><h3>ค่าซ่อมตามเครื่อง (บาท)</h3>${bars(byCost, '')}</div>
      <div class="box"><h3>เครื่องที่แจ้งซ่อมบ่อย</h3>${bars(cnt, 'ครั้ง')}</div>
    </div>
    ${stageStatsHtml()}`;
  },

  admin() {
    const hasNotify = D.profiles.some(p => 'notify_email' in p);
    const fdSel = (id, v, dis) => `<select id="${id}" class="inp" ${dis ? 'disabled' : ''}><option value="">สำรองทุกประเภท</option>${opts(OPT.fdType, v)}</select>`;
    return `<div class="h-row"><h1>ผู้ใช้และสิทธิ์</h1><span class="sub">${D.profiles.length} คน · ใช้งาน ${activeUsers().length}</span>
      <label class="btn ghost" for="uImport" style="cursor:pointer">นำเข้าผู้ใช้จาก Excel</label><input id="uImport" type="file" accept=".xlsx,.xls" hidden><button class="btn" id="backupBtn">สำรองข้อมูลทั้งหมด</button></div>
    <div class="note" style="margin-bottom:14px">กด <b>สำรองข้อมูลทั้งหมด</b> สัปดาห์ละครั้ง แล้วเก็บไฟล์ไว้ในโฟลเดอร์ของแผนก (ใบงาน, ประวัติ, เครื่องจักร, ผู้ใช้, เอกสาร อยู่ในไฟล์ Excel เดียว) · ไฟล์รูปและเอกสารแนบไม่รวมอยู่ในไฟล์นี้</div>
    <div class="note" style="margin-bottom:14px">ผู้ใช้เข้าระบบด้วยบัญชี Microsoft 365 ของบริษัท เฉพาะอีเมลในรายการนี้ที่ติ๊ก “ใช้งาน” เท่านั้นที่เข้าได้ · Foreman Day รับใบงานตามประเภทเครื่อง (Mold / อื่นๆ ใช้ของเครื่องจักร)</div>
    <div class="tbl-wrap"><table><thead><tr><th>อีเมล</th><th>ชื่อที่แสดง</th>${hasShort() ? '<th title="อักษรย่อ/ชื่อเล่นในไฟล์ Excel เดิม ใส่ได้หลายชื่อคั่นด้วย , · ใช้จับคู่ตอนนำเข้า หน้าเว็บแสดงชื่อจริง">ชื่อย่อ</th>' : ''}<th>บทบาท</th><th>FD ดูแลประเภท</th><th>Admin</th><th>อนุมัติ MEMO</th><th>ใช้งาน</th>${hasNotify ? '<th>รับอีเมล</th>' : ''}<th></th></tr></thead><tbody>
    ${D.profiles.map((p, i) => `<tr class="${p.active === false ? 'off' : ''}"><td>${esc(p.email)}</td>
      <td><label class="sr" for="pn${i}">ชื่อ</label><input id="pn${i}" class="inp" value="${esc(p.full_name || '')}"></td>${hasShort() ? `<td><label class="sr" for="psn${i}">ชื่อย่อ</label><input id="psn${i}" class="inp short-inp" maxlength="20" value="${esc(p.short_name || '')}" placeholder="เช่น MM หรือ TON, Pang"></td>` : ''}
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
      ${hasShort() ? '<div class="field"><label for="psShort">ชื่อย่อ (ในไฟล์ Excel เดิม)</label><input id="psShort" class="inp" maxlength="20" placeholder="เช่น MM หรือ TON, Pang"></div>' : ''}
      <div class="field"><label for="psRole">บทบาท</label><select id="psRole" class="inp" data-rolesel="ps">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><label for="psFd">Foreman Day ดูแลประเภท</label>${fdSel('psFd', '', true)}</div>
      <div class="field"><span class="flabel">สิทธิ์เพิ่มเติม</span><label><input id="psAdmin" type="checkbox"> สิทธิ์ Admin</label><label><input id="psMemo" type="checkbox"> อนุมัติ MEMO ได้ (Manager App)</label></div>
      <div class="full"><button class="btn" type="submit">เพิ่มผู้ใช้</button></div>
    </form>`;
  },

  scan() {
    const m = M(S.scanNo);
    if (!m.machine_no) return '<div class="empty">ไม่พบเครื่องจักรนี้ในระบบ</div>';
    if (isOp()) return opScan(m);
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
    return `<div class="h-row"><h1>${esc(m.machine_no)} · ${esc(m.machine_name)}</h1><span class="pill ${m.status === 'Active' ? 's-confirm' : m.status === 'Maintenance' ? 's-wait' : 's-done'}">${esc(m.status)}</span><span class="sp"></span>
      ${canCreate() ? `<button class="btn hide-phone" data-newfor="${esc(m.machine_no)}" data-primary="1">+ แจ้งซ่อมเครื่องนี้</button>` : ''}${moreMenu([
        isAdmin() ? `<button class="mi" data-medit="${esc(m.machine_no)}">แก้ไขข้อมูลเครื่อง</button>` : '',
        isAdmin() ? `<button class="mi" data-qr="${esc(m.machine_no)}">พิมพ์ QR</button>` : '',
        m.pm_interval_month || m.cal_interval_month ? `<button class="mi" data-tag="${esc(m.machine_no)}">พิมพ์ Tag PM / CAL</button>` : '',
        D.hasMPhotos ? `<label class="mi" for="mpAdd">เพิ่มรูปเครื่อง</label>` : '',
        D.hasParts ? `<button class="mi" data-vlink="${esc(m.machine_no)}">+ Vendor</button>` : '',
        D.hasParts && canCreate() ? `<button class="mi" data-missue="${esc(m.machine_no)}">เบิกอะไหล่ใช้กับเครื่องนี้</button>` : ''])}</div>
    ${machineGallery(m)}
    <div class="mcard">${[['Type', m.machine_type], ['Model', m.model], ['Serial', m.serial_number], ['Location', m.location], ['Priority', m.priority], ['Maintenance', m.maintenance_type], ['PM', m.pm_interval_month ? 'ทุก ' + m.pm_interval_month + ' เดือน' : ''], ['CAL', m.cal_interval_month ? 'ทุก ' + m.cal_interval_month + ' เดือน' : '']].filter(x => x[1]).map(([k, v]) => `<div><span>${k}</span>${esc(v)}</div>`).join('')}${m.parent_machine ? `<div><span>เป็นอุปกรณ์ของ</span><a href="?m=${encodeURIComponent(m.parent_machine)}" class="folio" data-scan="${esc(m.parent_machine)}">${esc(m.parent_machine)}</a> ${esc(M(m.parent_machine).machine_name || '')}</div>` : ''}</div>
    ${ckCard(m)}
    ${machineContacts(m)}
    ${(() => { const ks = kidsOf(m.machine_no); if (!ks.length) return ''; const pl = planList(); return `<h3 class="sec">อุปกรณ์ประกอบ (${ks.length})</h3><div class="tbl-wrap"><table><thead><tr><th>รหัส</th><th>ชื่อ</th><th>สถานะ</th><th>PM / CAL ครบกำหนด</th><th>ใบงานค้าง</th></tr></thead><tbody>${ks.map(k => { const ps = pl.filter(x => x.m.machine_no === k.machine_no), oj = D.requests.filter(q => q.machine_no === k.machine_no && OPEN(q.status)).length; return `<tr><td class="mono"><a href="?m=${encodeURIComponent(k.machine_no)}" class="folio" data-scan="${esc(k.machine_no)}">${esc(k.machine_no)}</a></td><td>${esc(k.machine_name)}<br><span class="sub">${esc(k.model || '')}${k.serial_number ? ' · S/N ' + esc(k.serial_number) : ''}</span></td><td><span class="pill ${k.status === 'Active' ? 's-confirm' : k.status === 'Maintenance' ? 's-wait' : 's-done'}">${esc(k.status)}</span></td><td>${ps.length ? ps.map(x => `${x.kind} ${fd(x.next, false)} ${stp(x.days)}`).join('<br>') : '<span class="sub">ไม่มีแผน</span>'}</td><td class="num">${oj || '-'}</td></tr>`; }).join('')}</tbody></table></div>`; })()}
    ${tabs('mach', [['open', 'ใบงานค้าง', `${open.length ? open.map(q => `<div class="jcard">
      <div class="jinfo"><span class="folio">${esc(q.id)}</span> ${pill(q.status)} <span class="u-${esc(q.urgency)}">${esc(q.urgency)}</span>
        <div>${esc(q.symptom)}</div>
        <div class="sub">${esc(jobType(q))} · เปิดโดย ${esc(nm(q.reporter))} · ${fd(q.created_at)} · ถัดไป: ${esc(ownerText(q))}</div></div>
      <div class="btns"><button class="btn ${isMine(q) ? '' : 'ghost'}" data-open="${esc(q.id)}">${isMine(q) ? 'ดำเนินการ' : 'เปิดใบงาน'}</button></div>
    </div>`).join('') : '<div class="empty">ไม่มีใบงานค้างของเครื่องนี้</div>'}`, open.length],
      ['dash', 'ภาพรวม 12 เดือน', `
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
        ${(() => { const ps = D.parts.filter(x => (x.machines || []).includes(m.machine_no)); return `<h3 style="margin-top:14px">อะไหล่ / อุปกรณ์ของเครื่อง (${ps.length})</h3>${D.hasParts ? `<div class="btns" style="margin:6px 0">${canCreate() ? `<button class="btn ghost sm" data-missue="${esc(m.machine_no)}">เบิกใช้กับเครื่องนี้</button>` : ''}<button class="btn ghost sm" data-muse="${esc(m.machine_no)}">ประวัติเบิกใช้</button></div>` : ''}${ps.length ? `<div class="tbl-wrap"><table><thead><tr><th>Part no</th><th>ชื่อ</th><th class="num">คงเหลือ</th><th>ที่เก็บ</th></tr></thead><tbody>${ps.map(x => `<tr><td class="mono">${esc(x.part_no)}</td><td>${esc(x.name)}</td><td class="num"><span class="pill ${x.min_qty != null && Number(x.stock) <= Number(x.min_qty) ? 's-rej' : 's-confirm'}">${qty(x.stock)} ${esc(x.unit)}</span></td><td>${esc(x.location || '-')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="sub">ยังไม่มีอะไหล่ที่ผูกกับเครื่องนี้</div>'}`; })()}
        <h3 style="margin-top:14px">เอกสารของเครื่อง (${docs.length})</h3>${docs.length ? docs.map(d => `<div><a href="#" class="folio" data-doc="${d.id}">${esc(d.title)}</a> <span class="sub">${esc(d.kind)}</span></div>`).join('') : '<div class="sub">ยังไม่มีเอกสาร</div>'}</div>
    </div>
`],
      D.hasChecklist && (ckOf(m) || D.ckRuns.some(r => r.machine_no === m.machine_no)) ? ['ck', 'ตรวจประจำวัน', ckHistory(m.machine_no)] : null,
      (() => { const jp = jobPhotos(m.machine_no); return jp.length ? ['photos', 'รูปจากใบงาน', `<div class="mg-strip jp">${jp.map((x, i) => `<button class="mg-th" data-jpview="${i}" aria-label="รูปจาก ${esc(x.q.id)}">${imgTag(x.path, 'รูปจาก ' + x.q.id)}<span class="mg-cap">${esc(x.q.id)}</span></button>`).join('')}</div>`, jp.length] : null; })(),
      ['hist', 'ประวัติ', `
    ${closed.length ? `<div class="tbl-wrap"><table><thead><tr><th>เลขที่</th><th>ประเภท</th><th>อาการ / วิธีแก้</th><th>สาเหตุ</th><th>อะไหล่</th><th>Downtime</th><th>ค่าใช้จ่าย</th><th>เสร็จ</th></tr></thead><tbody>
      ${closed.map(q => `<tr class="click" data-open="${esc(q.id)}"><td class="mono">${esc(q.id)}</td><td>${esc(jobType(q))}</td><td>${esc(q.symptom)}<br><span class="sub">${esc(q.fix_detail || '')}</span></td><td>${esc(q.root_cause || '-')}</td><td>${esc(q.parts_used || '-')}</td><td class="num">${q.downtime_min ?? '-'}</td><td class="num">${q.cost_thb != null ? Number(q.cost_thb).toLocaleString() : '-'}</td><td class="num">${fd(q.end_at, false)}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">ยังไม่มีประวัติ</div>'}`, closed.length]])}`;
  }
};

/* ---------- steps + memo chain ---------- */
/* ---------- ส่วนประกอบหน้าจอ: เมนู ⋯ · แท็บ · แถบปุ่มล่างจอ ---------- */
// เมนู ⋯ รวมปุ่มที่ใช้ไม่บ่อย (items = ปุ่ม html ที่ว่างได้)
const moreMenu = items => { const it = items.filter(Boolean); return it.length ? `<details class="more"><summary aria-label="คำสั่งเพิ่มเติม">⋯</summary><div class="menu">${it.join('')}</div></details>` : ''; };
// แท็บ: list = [[key, label, html, count?]] · จำแท็บที่เลือกไว้ต่อกลุ่ม
S.tab = S.tab || {};
function tabs(group, list) {
  const L = list.filter(Boolean); if (!L.length) return '';
  const cur = L.some(x => x[0] === S.tab[group]) ? S.tab[group] : L[0][0];
  return `<div class="tabs" role="tablist" data-tabs="${group}">${L.map(([k, l, , n]) => `<button role="tab" class="${k === cur ? 'on' : ''}" aria-selected="${k === cur}" data-tabbtn="${group}:${k}">${l}${n != null ? ` <span class="tn">${n}</span>` : ''}</button>`).join('')}</div>
    ${L.map(([k, , h]) => `<div class="tpane ${k === cur ? 'on' : ''}" role="tabpanel" data-pane="${group}:${k}">${h}</div>`).join('')}`;
}
function bindTabs() {
  $$('[data-tabbtn]').forEach(b => b.onclick = () => {
    const [g, k] = b.dataset.tabbtn.split(':'); S.tab[g] = k;
    $$(`[data-tabbtn^="${g}:"]`).forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
    $$(`[data-pane^="${g}:"]`).forEach(x => x.classList.toggle('on', x.dataset.pane === b.dataset.tabbtn));
    buildActbar();
  });
}
// งานของฉันในใบงาน: หลายกล่องรวมเป็นกล่องเดียวแบบแท็บ · ปุ่มหลักของแต่ละกล่องติดป้าย mainbtns
function actionArea(html) {
  const t = document.createElement('template'); t.innerHTML = html;
  const boxes = [...t.content.children].filter(e => e.classList.contains('action'));
  boxes.forEach(b => { const rows = b.querySelectorAll('.btns'); if (rows.length) rows[rows.length - 1].classList.add('mainbtns'); });
  if (boxes.length < 2) return `<div id="actArea">${t.innerHTML}</div>`;
  const items = boxes.map((b, i) => { const h = b.querySelector('h3'); const label = h ? h.textContent.replace(/^ขั้นตอนของคุณ/, '').trim() : 'งาน ' + (i + 1); if (h) h.remove(); b.querySelector('.eyebrow-step')?.remove(); return [String(i), esc(label), b.innerHTML]; });
  return `<div id="actArea" class="box action multi"><p class="act-eyebrow">ขั้นตอนของคุณ · ${boxes.length} งาน</p>${tabs('act', items)}</div>`;
}
// แถบปุ่มล่างจอ (มือถือ): ปุ่มหลักของงานที่เปิดอยู่ หรือปุ่มที่ติด data-primary
function buildActbar() {
  $('#actbar')?.remove(); document.body.classList.remove('has-actbar');
  if (!['detail', 'scan'].includes(S.view)) return;
  let src = [...$$('#actArea .tpane.on .mainbtns button, #actArea:not(.multi) .mainbtns button')];
  if (!src.length) src = [...$$('[data-primary]')];
  if (!src.length) return;
  const bar = document.createElement('div'); bar.id = 'actbar'; bar.className = 'actbar';
  src.slice(0, 3).forEach(o => { const c = document.createElement('button'); c.type = 'button'; c.className = o.className.replace(/\bsm\b|\bbig\b|\bhide-phone\b/g, ''); c.textContent = o.textContent.trim(); c.onclick = () => o.click(); bar.appendChild(c); });
  document.body.appendChild(bar); document.body.classList.add('has-actbar');
}
function holdForm(q) {
  modal(`<h2>พักงาน ${esc(q.id)}</h2><p class="sub" style="margin-top:0">ใช้เมื่อต้องรออะไหล่หรือรอ Vendor · ระบบบันทึกเวลาเริ่มพักให้</p>
    <div class="form"><div class="field"><label for="hdReason">เหตุผล</label><select id="hdReason" class="inp">${opts(HOLD_REASONS)}</select></div>
    <div class="field"><label for="hdNote">รายละเอียด</label><input id="hdNote" class="inp" placeholder="เช่น สั่ง Bearing แล้ว คาดว่าได้ 20 พ.ย."></div></div>
    <div class="btns" style="margin-top:12px"><button class="btn" id="hdGo">พักงาน</button><button class="btn ghost" data-close>ยกเลิก</button></div>`);
  $('#hdGo').onclick = async () => { await act('hold_on'); closeModal(); };
}

/* ---------- Flow: ขั้นตอนของใบงาน (ภาพรวม · รายใบ · เวลาเฉลี่ย) ---------- */
// ขั้นในแผนภาพ: สถานะใดอยู่ขั้นไหน
const FST = {
  fd: { l: 'FD อนุมัติ', st: ['pending_fd', 'returned'] },
  admin: { l: 'Admin แจ้ง SAP / K2', st: ['wait_admin'] },
  repair: { l: 'RMT / FM ซ่อม', st: ['ext_repair'] },
  quote: { l: 'ใบเสนอราคา / MEMO', st: ['quotation', 'memo_rejected'] },
  memo: { l: 'Manager อนุมัติ', st: ['memo_approval'] },
  po: { l: 'PO / Vendor / รับของ', st: ['po_vendor'] }
};
const stageOf = s => Object.keys(FST).find(k => FST[k].st.includes(s)) || (s === 'closed' ? 'closed' : s === 'cancelled' ? 'cancelled' : null);
const flowKind = q => q.job_type === 'pmcal' ? 'pmcal' : q.job_type === 'purchase' ? 'purchase' : 'repair';
// สถานะที่ใบงานเข้าไปหลังบันทึกในประวัติ (ข้อความประวัติเขียนโดยหน้าเว็บนี้)
function statusFromLog(a) {
  if (/^Foreman Day อนุมัติ/.test(a)) return /Normal/.test(a) ? 'wait_admin' : 'quotation';
  if (/^Foreman Day ไม่อนุมัติ/.test(a)) return 'returned';
  if (/^ส่งให้ Foreman Day อนุมัติอีกครั้ง/.test(a)) return 'pending_fd';
  if (/^Admin แจ้งซ่อม/.test(a)) return 'ext_repair';
  if (/^ส่ง MEMO/.test(a)) return 'memo_approval';
  if (/ไม่อนุมัติ MEMO/.test(a)) return 'memo_rejected';
  if (/อนุมัติ MEMO.*ครบทุกคน/.test(a)) return 'po_vendor';
  if (/^ยกเลิกใบงาน/.test(a)) return 'cancelled';
  if (/^รับของและปิดคำขอซื้อ|ปิดงาน/.test(a)) return 'closed';
  return null;
}
// ลำดับสถานะของใบงาน พร้อมเวลาเข้าแต่ละขั้น ผู้ทำ และระยะเวลาที่อยู่ในขั้นนั้น
function jobTimeline(q, logs) {
  const ls = (logs || []).slice().sort((a, b) => new Date(a.at) - new Date(b.at));
  const first = q.job_type === 'self_fix' ? 'closed' : q.job_type === 'pmcal' && !ls.some(l => /^Foreman Day/.test(l.action)) ? 'quotation' : 'pending_fd';
  const t = [{ status: first, at: q.created_at, by: q.job_type === 'pmcal' ? 'system' : q.reporter }];
  for (const l of ls) { const s = statusFromLog(l.action); if (s && s !== t[t.length - 1].status) t.push({ status: s, at: l.at, by: l.actor }); }
  if (t[t.length - 1].status !== q.status) t.push({ status: q.status, at: q.updated_at, by: null });
  t.forEach((x, i) => { const end = t[i + 1] ? new Date(t[i + 1].at) : OPEN(x.status) ? new Date() : new Date(x.at); x.ms = Math.max(0, end - new Date(x.at)); x.doneBy = t[i + 1]?.by || null; });
  return t;
}
const durText = ms => { const h = ms / 36e5; return h < 1 ? Math.max(1, Math.round(ms / 6e4)) + ' นาที' : h < 24 ? h.toFixed(h < 10 ? 1 : 0) + ' ชม.' : (h / 24).toFixed(h < 240 ? 1 : 0) + ' วัน'; };
const logsOf = id => (D.logsAll || []).filter(l => l.request_id === id);
async function ensureLogs(force = false) {
  if (S.logsLoading || (D.logsAll && !force)) return;
  S.logsLoading = true;
  try { const { data, error } = await sb.from('request_logs').select('request_id, at, action, actor').order('at'); if (!error) D.logsAll = data || []; }
  finally { S.logsLoading = false; }
  if (['flow', 'report'].includes(S.view)) render();
}
// เวลาที่ใบงานอยู่ในขั้นปัจจุบัน
function stageAge(q) {
  if (!D.logsAll) return Date.now() - new Date(q.updated_at);
  const t = jobTimeline(q, logsOf(q.id)); return t[t.length - 1].ms;
}

// 1) หน้า Flow: ภาพรวมงานทุกใบตามขั้น
const FLANES = {
  all: [['self', 'แก้ไขเอง', []], ['normal', 'Normal · RMT / FM', ['admin', 'repair']], ['quote', 'Special · PM/CAL · คำขอซื้อ', ['quote', 'memo', 'po']]],
  repair: [['self', 'แก้ไขเอง', []], ['normal', 'Normal · RMT / FM', ['admin', 'repair']], ['quote', 'Special · Vendor', ['quote', 'memo', 'po']]],
  pmcal: [['quote', 'PM / CAL', ['quote', 'memo', 'po']]],
  purchase: [['quote', 'คำขอซื้อ', ['quote', 'memo', 'po']]]
};
// งานค้าง: อยู่ในขั้นเดิมเกิน 3 วัน · ใบงาน PM/CAL ที่ระบบเปิดล่วงหน้า 90 วัน นับว่าค้างเมื่อเหลือ ≤ 30 วันแล้วยังไม่เริ่ม
const isStuck = q => q.job_type === 'pmcal' && q.status === 'quotation' && q.due_date ? (!q.action_at && daysLeft(q.due_date) <= 30) : stageAge(q) > 3 * 864e5;
function flowNode(key, label, jobs, sub) {
  const stale = jobs.filter(isStuck).length, hold = jobs.filter(q => q.hold_reason).length, down = jobs.filter(q => q.machine_down).length;
  const avg = jobs.length ? jobs.reduce((a, q) => a + stageAge(q), 0) / jobs.length : 0;
  const cls = !jobs.length ? 'empty' : stale ? 'warn' : 'ok';
  return `<button class="fnode ${cls} ${S.fsel === key ? 'sel' : ''}" data-fnode="${key}" aria-pressed="${S.fsel === key}">
    <span class="fl">${label}</span><b class="fc">${jobs.length}</b>
    <span class="fs">${sub || (jobs.length ? 'อยู่ในขั้นนี้เฉลี่ย ' + durText(avg) : 'ไม่มีงานค้าง')}</span>
    ${stale || hold || down ? `<span class="ftags">${stale ? `<i class="ft-warn">ค้าง ${stale}</i>` : ''}${hold ? `<i class="ft-hold">พัก ${hold}</i>` : ''}${down ? `<i class="ft-bad">เครื่องหยุด ${down}</i>` : ''}</span>` : ''}</button>`;
}
function flowBoard() {
  const kind = S.fkind || 'all';
  const pool = D.requests.filter(q => kind === 'all' || flowKind(q) === kind);
  const inSt = k => pool.filter(q => FST[k].st.includes(q.status) && (k === 'fd' || true));
  const laneJobs = (lane, k) => inSt(k).filter(q => lane === 'normal' ? q.job_type === 'normal' : lane === 'quote' ? q.job_type !== 'normal' : false);
  const m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
  const closedM = pool.filter(q => q.status === 'closed' && new Date(q.end_at || q.updated_at) >= m0);
  const lanes = FLANES[kind];
  const sel = {};
  const fdNode = kind === 'pmcal' ? '' : flowNode('fd', FST.fd.l, (sel.fd = inSt('fd')));
  const laneHtml = lanes.map(([lane, label, ks]) => {
    if (lane === 'self') { const c = closedM.filter(q => q.job_type === 'self_fix'); sel.self = c; return `<div class="flane"><span class="flabel">${label}</span><div class="frow">${flowNode('self', 'แก้แล้วปิดทันที', c, 'เดือนนี้ ' + c.length + ' งาน')}</div></div>`; }
    return `<div class="flane"><span class="flabel">${label}</span><div class="frow">${ks.map((k, i) => { const js = laneJobs(lane, k); sel[lane + ':' + k] = js; return (i ? '<span class="farr" aria-hidden="true"></span>' : '') + flowNode(lane + ':' + k, FST[k].l, js); }).join('')}</div></div>`;
  }).join('');
  sel.closed = closedM;
  const closedNode = flowNode('closed', 'ปิดงานเดือนนี้', closedM, closedM.length ? 'เฉลี่ยเปิด → ปิด ' + durText(closedM.reduce((a, q) => a + (new Date(q.end_at || q.updated_at) - new Date(q.created_at)), 0) / closedM.length) : 'ยังไม่มี');
  const pick = S.fsel && sel[S.fsel] ? sel[S.fsel] : null;
  const pickLabel = S.fsel ? (S.fsel === 'fd' ? FST.fd.l : S.fsel === 'closed' ? 'ปิดงานเดือนนี้' : S.fsel === 'self' ? 'แก้ไขเอง (เดือนนี้)' : FST[S.fsel.split(':')[1]]?.l) : '';
  return { html: `<div class="fboard ${kind === 'pmcal' ? 'nofd' : ''}">
      ${fdNode ? `<div class="fcol fstart">${fdNode}</div><span class="farr big" aria-hidden="true"></span>` : ''}
      <div class="fcol flanes">${laneHtml}</div>
      <span class="farr big" aria-hidden="true"></span>
      <div class="fcol fend">${closedNode}</div></div>`, pick, pickLabel };
}

// 2) Flow ของใบงานแต่ละใบ
function jobFlow(q) {
  const plans = {
    self_fix: [['เปิดใบงาน + แก้ไขเอง', ['closed']]],
    normal: [['FD อนุมัติ', ['pending_fd', 'returned']], ['Admin แจ้ง SAP / K2', ['wait_admin']], ['RMT / FM ซ่อม', ['ext_repair']]],
    special: [['FD อนุมัติ', ['pending_fd', 'returned']], ['ใบเสนอราคา / MEMO', ['quotation', 'memo_rejected']], ['Manager อนุมัติ', ['memo_approval']], ['PO / นัด Vendor', ['po_vendor']]],
    pmcal: [['ใบเสนอราคา / MEMO', ['quotation', 'memo_rejected']], ['Manager อนุมัติ', ['memo_approval']], ['PO / นัด Vendor', ['po_vendor']]],
    purchase: [['FD อนุมัติ', ['pending_fd', 'returned']], ['ใบเสนอราคา / MEMO', ['quotation', 'memo_rejected']], ['Manager อนุมัติ', ['memo_approval']], ['PO / รับของ', ['po_vendor']]],
    none: [['FD อนุมัติ', ['pending_fd', 'returned']], ['ดำเนินการ', []]]
  };
  const plan = (plans[q.job_type] || plans.none).concat(q.job_type === 'self_fix' ? [] : [['ปิดงาน', ['closed']]]);
  const tl = jobTimeline(q, S.logs);
  const steps = plan.map(([label, sts], i) => {
    const hits = tl.filter(x => sts.includes(x.status));
    const ms = hits.reduce((a, x) => a + x.ms, 0);
    const cur = sts.includes(q.status) && OPEN(q.status);
    const idx = plan.findIndex(p => p[1].includes(q.status));
    const done = q.status === 'closed' || (idx >= 0 ? i < idx : hits.length > 0 && !cur);
    const last = hits[hits.length - 1];
    let meta = '';
    if (label === 'ปิดงาน' || (q.job_type === 'self_fix')) meta = q.status === 'closed' ? `${esc(nm(q.closed_by || last?.by))} · ${fd(q.end_at || last?.at, false)}` : '';
    else if (cur) meta = `<b>รอ: ${esc(ownerText(q))}</b> · ${durText(ms)}${q.hold_reason ? ' · พัก: ' + esc(q.hold_reason) : ''}`;
    else if (done && last) meta = `${esc(nm(last.doneBy))} · ${durText(ms)}`;
    const back = hits.some(x => x.status === 'returned' || x.status === 'memo_rejected') ? '<span class="fback">มีส่งกลับแก้ไข</span>' : '';
    return `<li class="${q.status === 'cancelled' && !done ? 'skip' : cur ? 'now' : done ? 'done' : ''}"><span class="c">${done && !cur ? '✓' : i + 1}</span><span class="t">${label}</span>${meta ? `<span class="m">${meta}</span>` : ''}${back}</li>`;
  }).join('');
  const total = q.status === 'closed' ? new Date(q.end_at || q.updated_at) - new Date(q.created_at) : Date.now() - new Date(q.created_at);
  const routes = q.job_type === 'pmcal' || q.job_type === 'purchase' ? '' : `<div class="froutes" aria-label="เส้นทางของใบงาน">${[['self_fix', 'แก้ไขเอง'], ['normal', 'Normal · RMT / FM'], ['special', 'Special · Vendor']].map(([k, l]) => `<span class="${q.job_type === k ? 'on' : q.job_type ? 'off' : ''}">${l}</span>`).join('')}</div>`;
  return `<div class="jflow box">
    <div class="jflow-h"><h3>Flow ของใบงาน</h3><span class="sub">${q.status === 'cancelled' ? 'ยกเลิกแล้ว' : q.status === 'closed' ? 'ใช้เวลาทั้งหมด ' + durText(total) : 'เปิดมาแล้ว ' + durText(total)}</span></div>
    ${routes}<ol class="steps jsteps">${steps}</ol></div>`;
}

// 3) เวลาเฉลี่ยแต่ละขั้น (งานที่ปิดแล้ว)
function stageStats(days) {
  const since = Date.now() - days * 864e5;
  const done = D.requests.filter(q => q.status === 'closed' && new Date(q.end_at || q.updated_at) >= since && q.job_type !== 'self_fix');
  const acc = {}; Object.keys(FST).forEach(k => acc[k] = { ms: 0, n: 0 });
  let lead = 0;
  done.forEach(q => {
    const tl = jobTimeline(q, logsOf(q.id)); const per = {};
    tl.forEach(x => { const k = stageOf(x.status); if (FST[k]) per[k] = (per[k] || 0) + x.ms; });
    Object.entries(per).forEach(([k, ms]) => { acc[k].ms += ms; acc[k].n++; });
    lead += new Date(q.end_at || q.updated_at) - new Date(q.created_at);
  });
  return { rows: Object.entries(acc).filter(([, v]) => v.n).map(([k, v]) => ({ k, label: FST[k].l, avg: v.ms / v.n, n: v.n })), jobs: done.length, lead: done.length ? lead / done.length : 0 };
}
function stageStatsHtml() {
  const days = S.fdays || 90;
  if (!D.logsAll) { ensureLogs(); return '<div class="box"><h3>เวลาเฉลี่ยแต่ละขั้น</h3><div class="sub">กำลังโหลดประวัติ…</div></div>'; }
  const s = stageStats(days), mx = Math.max(1, ...s.rows.map(r => r.avg)), slow = s.rows.reduce((a, r) => !a || r.avg > a.avg ? r : a, null);
  return `<div class="box fstats"><div class="jflow-h"><h3>เวลาเฉลี่ยแต่ละขั้น</h3><div class="chips">${[30, 90, 365].map(d => `<button class="chip ${days === d ? 'on' : ''}" data-fdays="${d}">${d === 365 ? '1 ปี' : d + ' วัน'}</button>`).join('')}</div></div>
    <p class="sub" style="margin-top:0">จากใบงานที่ปิดแล้ว ${s.jobs} ใบ (ไม่รวมงานแก้ไขเอง) · เปิด → ปิดเฉลี่ย <b>${s.jobs ? durText(s.lead) : '-'}</b></p>
    ${s.rows.length ? `<div class="bars">${s.rows.map(r => `<div class="bar ${r === slow && s.rows.length > 1 ? 'slow' : ''}"><span>${esc(r.label)}${r === slow && s.rows.length > 1 ? ' <b class="ft-warn">ช้าที่สุด</b>' : ''}</span><div class="tr"><div class="fl" style="width:${r.avg / mx * 100}%"></div></div><span class="v">${durText(r.avg)} <span class="sub">(${r.n} ใบ)</span></span></div>`).join('')}</div>` : '<div class="empty">ยังไม่มีงานที่ปิดในช่วงนี้</div>'}</div>`;
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
function issueRows(p, mno, hint = 'ตัดยอดคลังให้อัตโนมัติ และบวกค่าอะไหล่เข้าค่าใช้จ่าย · ★ = อะไหล่ของเครื่องนี้') {
  const list = D.parts.filter(x => x.active !== false && Number(x.stock) > 0).sort((a, b) => ((b.machines || []).includes(mno) - (a.machines || []).includes(mno)) || a.part_no.localeCompare(b.part_no));
  if (!list.length) return '';
  const o = list.map(x => `<option value="${esc(x.part_no)}">${esc(x.part_no)} · ${esc(x.name)} (คงเหลือ ${qty(x.stock)} ${esc(x.unit)})${(x.machines || []).includes(mno) ? ' ★' : ''}</option>`).join('');
  return `<div class="field full"><span class="flabel">เบิกอะไหล่จาก Stock</span><span class="hint">${hint}</span>
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
function sapLaterBox(q) {
  if (!isAdmin() || q.job_type !== 'normal' || q.external_ref || !['ext_repair', 'closed'].includes(q.status)) return '';
  return box(`Admin: ใส่เลขที่ ${q.repair_unit === 'FM' ? 'K2' : 'SAP'} ภายหลัง (ซ่อมด่วนนอกเวลา)`, `<div class="form"><div class="field"><label for="slRef">เลขที่ใบแจ้งงาน ${q.repair_unit === 'FM' ? 'K2' : 'SAP'} *</label><input id="slRef" class="inp"></div></div>
    <div class="btns" style="margin-top:12px"><button class="btn ok" data-act="admin_ref">บันทึกเลขที่</button></div>`);
}
function actions(q) {
  if (!OPEN(q.status)) return sapLaterBox(q);
  const me = S.me.email, mine = isMine(q) || isAdmin();
  const waitNote = () => `<div class="note">ขั้นตอนนี้รอ <b>${esc(ownerText(q))}</b></div>`;
  const nightBox = () => box('ซ่อมด่วนนอกเวลา Admin (Critical)', `<p class="sub" style="margin-top:0">ส่งช่างซ่อมได้ทันที ไม่ต้องรอ Admin · Admin จะใส่เลขที่ SAP / K2 ภายหลังในเวลาทำงาน</p>
      <div class="choice"><label><input type="radio" name="ntUnit" value="RMT" checked> <b>RMT</b> · แจ้ง SAP ภายหลัง</label><label><input type="radio" name="ntUnit" value="FM"> <b>FM</b> · แจ้ง K2 ภายหลัง</label></div>
      <div class="form" style="margin-top:10px"><div class="field full"><label for="ntNote">ติดต่อช่าง / หมายเหตุ</label><input id="ntNote" class="inp" placeholder="เช่น โทรแจ้งช่าง RMT กะดึก คุณ…"></div></div>
      <div class="btns" style="margin-top:12px"><button class="btn ok" data-act="night_approve">อนุมัติซ่อมด่วน</button></div>`);
  switch (q.status) {
    case 'pending_fd':
      if (!canFD(q.machine_no)) return canNightApprove(q) ? nightBox() : waitNote();
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
        <div class="btns" style="margin-top:12px"><button class="btn ok" data-act="fd_approve">อนุมัติซ่อม</button><button class="btn bad" data-act="fd_reject">ไม่อนุมัติ · ส่งกลับ</button></div>`) + (canNightApprove(q) ? nightBox() : '');
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
      if (!canFD(q.machine_no)) return sapLaterBox(q) || waitNote();
      return sapLaterBox(q) + box(`Foreman Day: สรุปผลการซ่อมของ ${esc(q.repair_unit)} แล้วปิดงาน`, closeFields('ex', q) + `<div class="btns" style="margin-top:12px"><button class="btn ok" data-act="close_ext">สรุปและปิดงาน</button></div>`);
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
        html += box('รับของเข้า', q.po_no ? receiveForm(q) : '<div class="note">รับของได้หลังจาก Admin บันทึกเลขที่ PO แล้ว</div>');
      } else if (q.assignee === me || canFD(q.machine_no) || isAdmin()) {
        html += box('นัด Vendor เข้าดำเนินการ', `<div class="form"><div class="field"><label for="vdDate">วันนัด Vendor</label><input id="vdDate" class="inp" type="date" value="${esc(q.vendor_date || '')}"></div></div><div class="btns" style="margin-top:12px"><button class="btn" data-act="vendor_date">บันทึกวันนัด</button></div>`);
        const needCert = q.job_type === 'pmcal' && q.pmcal_kind === 'CAL', hasCert = (q.attachments || []).some(a => a.kind === 'cert');
        const certField = needCert ? `<div class="field full cert-f"><label for="pvCert">ใบ Certificate การสอบเทียบ ${hasCert ? '(แนบไว้แล้ว · แนบเพิ่มได้)' : '*'}</label><input id="pvCert" class="inp" type="file" accept=".pdf,image/*" multiple><span class="hint">ไฟล์ PDF หรือรูปถ่ายใบ Certificate จาก Vendor · บังคับสำหรับงาน CAL</span></div>` : '';
        html += box('สรุปผลก่อนปิดงาน', q.po_no ? closeFields('pv', q) + certField + `<div class="btns" style="margin-top:12px"><button class="btn ok" data-act="close_special">สรุปและปิดงาน</button></div>` : '<div class="note">ปิดงานได้หลังจาก Admin บันทึกเลขที่ PO แล้ว</div>');
      }
      return html || waitNote();
    }
  }
  return '';
}

// พักงาน: คนที่ต้องทำขั้นนี้ หรือ Foreman Day ของเครื่อง หรือ Admin (ฐานข้อมูลตรวจซ้ำ)
const canHold = q => HOLD_STATUSES.includes(q.status) && (isAdmin() || isMine(q) || canFD(q.machine_no));
function holdBox(q) {
  if (!canHold(q) || !q.hold_reason) return '';
  return `<div class="box hold"><h3>พักงานอยู่: ${esc(q.hold_reason)}</h3><p class="sub" style="margin-top:0">ตั้งแต่ ${fd(q.hold_since)} (${daysSince(q.hold_since)} วัน)${q.hold_note ? ' · ' + esc(q.hold_note) : ''}</p><div class="btns"><button class="btn" data-act="hold_off">ดำเนินการต่อ</button></div></div>`;
}

// ---------- คำขอซื้อ ----------
function itemsTable(q) {
  const it = q.items || []; if (!it.length) return '';
  return `<div class="tbl-wrap"><table><thead><tr><th>รายการ</th><th>Part no</th><th class="num">จำนวน</th>${it.some(x => x.recv != null) ? '<th class="num">รับแล้ว</th><th class="num">ค้าง</th><th>คลัง</th>' : ''}</tr></thead><tbody>${it.map(x => `<tr><td>${esc(x.name)}</td><td class="mono">${esc(x.part_no || '-')}</td><td class="num">${qty(x.qty)} ${esc(x.unit || '')}</td>${it.some(y => y.recv != null) ? `<td class="num">${x.recv != null ? qty(x.recv) : '-'}</td><td class="num">${left(x) ? `<b class="u-High">${qty(left(x))}</b>` : '-'}</td><td>${x.stocked ? '<span class="pill s-confirm">เข้าคลัง</span>' : '<span class="sub">ไม่เก็บ Stock</span>'}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}
const left = x => Math.max(0, Math.round((Number(x.qty) - Number(x.recv || 0)) * 1000) / 1000);
function receiveForm(q) {
  const it = q.items || [], part = it.some(x => Number(x.recv || 0) > 0);
  return `<p class="sub" style="margin-top:0">ใส่จำนวนที่ได้รับรอบนี้ · ของมาไม่ครบรับบางส่วนก่อนได้ ระบบพักงาน “รอ Vendor” ไว้จนรับครบ · รายการที่มี Part no เข้าคลังอัตโนมัติ${canParts() ? ' · รายการใหม่ติ๊ก “เพิ่มเป็นอะไหล่” เพื่อเปิดรหัสใหม่' : ''}</p>
  <div class="tbl-wrap"><table class="qtbl"><thead><tr><th>รายการ</th><th class="num">สั่ง</th>${part ? '<th class="num">รับแล้ว</th>' : ''}<th>รับรอบนี้</th><th>คลังอะไหล่</th></tr></thead><tbody>${it.map((x, i) => `<tr><td>${esc(x.name)}${x.part_no ? `<br><span class="sub mono">${esc(x.part_no)}</span>` : ''}</td><td class="num">${qty(x.qty)} ${esc(x.unit || '')}</td>${part ? `<td class="num">${qty(x.recv || 0)}</td>` : ''}
    <td><input id="rcQ${i}" class="inp" type="number" min="0" step="any" value="${left(x)}" aria-label="รับรอบนี้รายการที่ ${i + 1}"></td>
    <td>${x.part_no ? `<span class="pill s-confirm">เข้าคลัง ${esc(x.part_no)}</span>` : canParts() ? `<label><input type="checkbox" id="rcNew${i}"> เพิ่มเป็นอะไหล่</label><input id="rcPn${i}" class="inp" placeholder="Part no ใหม่" style="margin-top:4px" aria-label="Part no ใหม่รายการที่ ${i + 1}">` : '<span class="sub">ค่าใช้จ่าย ไม่เก็บ Stock</span>'}</td></tr>`).join('')}</tbody></table></div>
  <div class="form" style="margin-top:10px"><div class="field"><label for="rcNote">หมายเหตุการรับของ</label><input id="rcNote" class="inp" placeholder="เช่น ใบส่งของเลขที่ … · ส่วนที่เหลือได้ 25 พ.ย."></div>
    <div class="field"><label for="rcFiles">ใบส่งของ / รูป</label><input id="rcFiles" class="inp" type="file" multiple></div>
    <div class="field full"><label><input type="checkbox" id="rcForce"> ปิดคำขอซื้อเลย แม้ยังได้ของไม่ครบ (ไม่รอส่วนที่เหลือ)</label></div></div>
  <div class="btns" style="margin-top:12px"><button class="btn ok" data-act="recv_close">บันทึกรับของ</button></div>`;
}
async function receiveAndClose(q) {
  const items = (q.items || []).map((x, i) => ({ ...x, now: parseFloat($('#rcQ' + i)?.value) || 0 }));
  if (items.some(x => x.now < 0)) return toast('จำนวนรับต้องไม่ติดลบ');
  const force = $('#rcForce')?.checked;
  if (!items.some(x => x.now > 0) && !force) return toast('ใส่จำนวนที่ได้รับ หรือติ๊ก “ปิดคำขอซื้อเลย”');
  const newParts = [];
  for (const [i, x] of items.entries()) if (!x.part_no && x.now > 0 && $('#rcNew' + i)?.checked) {
    const pn = ($('#rcPn' + i)?.value || '').trim();
    if (!pn) return toast('ใส่ Part no ใหม่ของ ' + x.name);
    if (D.parts.some(y => y.part_no === pn)) return toast('Part no ' + pn + ' มีอยู่แล้ว');
    newParts.push(pn); x.part_no = pn; x.newPart = true;
  }
  $$('[data-act]').forEach(b => b.disabled = true);
  try {
    const price = items.length === 1 && q.quotation_amount && Number(items[0].qty) ? Math.round(Number(q.quotation_amount) / Number(items[0].qty) * 100) / 100 : null;
    for (const x of items) if (x.newPart) {
      const { error } = await sb.from('spare_parts').insert({ part_no: x.part_no, name: x.name, unit: x.unit || 'ชิ้น', unit_price: price, machines: q.machine_no ? [q.machine_no] : [], vendor: q.vendor || null });
      if (error) throw error;
    }
    for (const x of items) if (x.part_no && x.now > 0) {
      const { error } = await sb.from('part_tx').insert({ part_no: x.part_no, qty: x.now, kind: 'receive', request_id: q.id, machine_no: q.machine_no || null, unit_price: price, note: 'รับของจาก ' + q.id });
      if (error) throw error;
      x.stocked = true;
    }
    items.forEach(x => { x.recv = Math.round((Number(x.recv || 0) + x.now) * 1000) / 1000; });
    const rest = items.filter(x => left(x) > 0), done = !rest.length || force;
    const txt = items.filter(x => x.now > 0).map(x => `${x.name} × ${qty(x.now)}${x.stocked && x.part_no ? ' (เข้าคลัง ' + x.part_no + ')' : ''}`).join(', ');
    const restTxt = rest.map(x => `${x.name} ${qty(left(x))} ${x.unit || ''}`.trim()).join(', ');
    const note = ($('#rcNote')?.value || '').trim();
    const files = await uploadFiles(q.id, 'close', filesOf('rcFiles'));
    const clean = items.map(({ newPart, now, ...x }) => x);
    const all = clean.map(x => `${x.name} × ${qty(x.recv)}`).join(', ');
    const patch = done
      ? { status: 'closed', items: clean, fix_detail: 'รับของ: ' + all + (rest.length ? ' · ไม่รอส่วนที่เหลือ: ' + restTxt : '') + (note ? ' · ' + note : ''), parts_used: all, cost_thb: Number(q.quotation_amount || 0), end_at: new Date().toISOString(), attachments: [...(q.attachments || []), ...files] }
      : { items: clean, hold_reason: 'รอ Vendor / ผู้รับเหมา', hold_note: 'รับของบางส่วนแล้ว ค้าง ' + restTxt + (note ? ' · ' + note : ''), attachments: [...(q.attachments || []), ...files] };
    const { error } = await sb.from('requests').update(patch).eq('id', q.id);
    if (error) throw error;
    await addLog(q.id, (done ? 'รับของและปิดคำขอซื้อ' : 'รับของบางส่วน') + (txt ? ' · ' + txt : '') + (!done ? ' · ค้าง ' + restTxt : rest.length ? ' · ไม่รอส่วนที่เหลือ ' + restTxt : '') + (newParts.length ? ' · เพิ่มอะไหล่ใหม่ ' + newParts.join(', ') : ''));
    toast(done ? 'รับของและปิดคำขอซื้อแล้ว' : 'บันทึกรับของบางส่วนแล้ว · ค้าง ' + restTxt); await loadAll(); openDetail(q.id, false);
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
/* ---------- รูปเครื่องจักร ---------- */
const mPhotos = no => (D.mphotos || []).filter(x => x.machine_no === no).sort((a, b) => (b.is_main - a.is_main) || String(a.created_at).localeCompare(String(b.created_at)));
const canPhotoAdmin = () => isAdmin() || role() === 'foreman_day';
// ลิงก์รูปจาก Storage (ส่วนตัว): ขอทีละชุดแล้วใส่ src ให้รูปที่รออยู่
const URLS = {}; const signQ = new Set(); let signT = null;
function photoUrl(path) {
  const c = URLS[path]; if (c && c.exp > Date.now()) return c.url;
  signQ.add(path); clearTimeout(signT); signT = setTimeout(flushSign, 20); return '';
}
async function flushSign() {
  const ps = [...signQ]; signQ.clear(); if (!ps.length) return;
  const { data } = await sb.storage.from('request-photos').createSignedUrls(ps, 3600);
  (data || []).forEach((d, i) => { if (d?.signedUrl) URLS[ps[i]] = { url: d.signedUrl, exp: Date.now() + 50 * 60e3 }; });
  $$('img[data-ph]').forEach(img => { const u = URLS[img.dataset.ph]; if (u && img.getAttribute('src') !== u.url) img.src = u.url; });
}
const imgTag = (path, alt, cls = '') => { const u = photoUrl(path); return `<img class="${cls}" data-ph="${esc(path)}" alt="${esc(alt)}" ${u ? `src="${esc(u)}"` : ''}>`; };
const isImgFile = a => /\.(jpe?g|png|webp|gif)$/i.test(a.name || a.path || '');
// รูปจากใบงานของเครื่อง (ล่าสุดก่อน)
function jobPhotos(no) {
  const out = [];
  D.requests.filter(q => q.machine_no === no).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).forEach(q => {
    (q.photos || []).forEach(p => out.push({ path: p, q }));
    (q.attachments || []).filter(isImgFile).forEach(a => out.push({ path: a.path, q }));
  });
  return out.slice(0, 12);
}
function machineGallery(m) {
  if (!D.hasMPhotos) return '';
  const ps = mPhotos(m.machine_no), main = ps[0];
  const add = canAddPhoto() ? `<label class="mg-add" for="mpAdd">${IC.plus}<span>เพิ่มรูป</span></label><input id="mpAdd" type="file" accept="image/*" multiple hidden data-mp="${esc(m.machine_no)}">` : '';
  return `<div class="mgal">${main ? `<button class="mg-main" data-mpview="${main.id}" aria-label="ดูรูป ${esc(m.machine_no)}">${imgTag(main.path, 'รูปเครื่อง ' + m.machine_no)}${main.caption ? `<span class="mg-cap">${esc(main.caption)}</span>` : ''}</button>` : `<div class="mg-main empty">${IC.machine}<span>ยังไม่มีรูปเครื่อง</span></div>`}
    <div class="mg-strip">${ps.slice(1).map(x => `<button class="mg-th" data-mpview="${x.id}" aria-label="ดูรูป">${imgTag(x.path, x.caption || 'รูปเครื่อง')}</button>`).join('')}${add}</div></div>`;
}
const canAddPhoto = () => !!S.me;   // ทุกคนเพิ่มรูปได้ · ลบ / เลือกรูปหลัก เฉพาะ Admin / Foreman Day
async function addMachinePhotos(no, files) {
  if (!files.length) return;
  toast('กำลังอัปโหลด ' + files.length + ' รูป…');
  try {
    const up = await uploadFiles('machines/' + no, 'photo', [...files].filter(f => /^image\//.test(f.type)));
    for (const u of up) { const { error } = await sb.from('machine_photos').insert({ machine_no: no, path: u.path }); if (error) throw error; }
    toast('เพิ่มรูปแล้ว'); reload();
  } catch (e) { fail(e); }
}
function photoViewer(list, idx, opts = {}) {
  const x = list[idx]; if (!x) return;
  const isM = !!x.id && !x.q;
  modal(`<div class="pv"><div class="pv-img">${imgTag(x.path, x.caption || 'รูป')}</div>
    <div class="pv-bar"><button class="iconbtn ghosty" data-pv="-1" aria-label="รูปก่อนหน้า" ${idx ? '' : 'disabled'}>‹</button><span class="sub">${idx + 1} / ${list.length}${isM ? ` · เพิ่มโดย ${esc(nm(x.uploaded_by))} · ${fd(x.created_at, false)}` : x.q ? ` · <a href="#" class="folio" data-pv-job="${esc(x.q.id)}">${esc(x.q.id)}</a> ${esc(x.q.symptom || '').slice(0, 40)}` : ''}</span><button class="iconbtn ghosty" data-pv="1" aria-label="รูปถัดไป" ${idx < list.length - 1 ? '' : 'disabled'}>›</button></div>
    ${isM ? `<div class="form" style="margin-top:8px"><div class="field full"><label for="pvCap">คำอธิบายรูป</label><input id="pvCap" class="inp" value="${esc(x.caption || '')}" placeholder="เช่น Nameplate, ตู้ควบคุม" ${canPhotoAdmin() ? '' : 'readonly'}></div></div>` : ''}
    <div class="btns" style="margin-top:10px">${isM && canPhotoAdmin() ? `<button class="btn ghost" data-pva="cap">บันทึกคำอธิบาย</button>${x.is_main ? '<span class="pill s-confirm">รูปหลัก</span>' : '<button class="btn ghost" data-pva="main">ตั้งเป็นรูปหลัก</button>'}<button class="btn ghost bad-t" data-pva="del">ลบรูป</button>` : ''}<button class="btn ghost" data-close>ปิด</button></div></div>`, 'wide');
  $$('#modal [data-pv]').forEach(b => b.onclick = () => photoViewer(list, idx + Number(b.dataset.pv), opts));
  $$('#modal [data-pv-job]').forEach(a => a.onclick = e => { e.preventDefault(); closeModal(); openDetail(a.dataset.pvJob); });
  $$('#modal [data-pva]').forEach(b => b.onclick = async () => {
    const a = b.dataset.pva; b.disabled = true;
    const r = a === 'del' ? await sb.from('machine_photos').delete().eq('id', x.id) : await sb.from('machine_photos').update(a === 'main' ? { is_main: true } : { caption: $('#pvCap').value.trim() || null }).eq('id', x.id);
    if (r.error) { b.disabled = false; return fail(r.error); }
    if (a === 'del') { try { await sb.storage.from('request-photos').remove([x.path]); } catch (e) { /* ไฟล์ค้างได้ ไม่กระทบการใช้งาน */ } }
    closeModal(); toast(a === 'del' ? 'ลบรูปแล้ว' : 'บันทึกแล้ว'); reload();
  });
}

/* ---------- ติดต่อ (Vendor + ผู้รับผิดชอบ) ---------- */
const telHref = p => 'tel:' + String(p).replace(/[^\d+]/g, '');
const teamsChat = e => 'https://teams.microsoft.com/l/chat/0/0?users=' + encodeURIComponent(e);
function contactCard(v, main) {
  const ph = v.phone ? String(v.phone).split(/[,/]/).map(s => s.trim()).filter(Boolean) : [];
  return `<div class="ct ${main ? 'main' : ''}"><div class="ct-h"><b>${esc(v.name)}</b>${main ? '<span class="pill s-confirm">Vendor หลัก</span>' : v.work_type ? `<span class="pill s-queue">${esc(v.work_type)}</span>` : ''}</div>
    ${v.contact_person ? `<div class="sub">${esc(v.contact_person)}</div>` : ''}
    <div class="ct-a">${ph.map(p => `<a class="btn ghost sm" href="${esc(telHref(p))}">📞 ${esc(p)}</a>`).join('')}${v.email ? `<a class="btn ghost sm" href="mailto:${esc(v.email)}">✉️ ${esc(v.email)}</a>` : ''}${v.other_contact ? `<span class="chip-s">${esc(v.other_contact)}</span>` : ''}${!ph.length && !v.email && !v.other_contact ? '<span class="sub">ยังไม่มีข้อมูลติดต่อ</span>' : ''}</div></div>`;
}
function machineContacts(m) {
  const linked = (D.vendors || []).filter(v => v.active !== false && (v.machines || []).includes(m.machine_no));
  const mainRow = m.supplier ? { ...(linked.find(v => v.name === m.supplier) || {}), name: m.supplier, contact_person: m.contact_person || linked.find(v => v.name === m.supplier)?.contact_person, phone: m.phone || linked.find(v => v.name === m.supplier)?.phone, email: m.email || linked.find(v => v.name === m.supplier)?.email, other_contact: m.other_contact || linked.find(v => v.name === m.supplier)?.other_contact } : null;
  const others = linked.filter(v => v.name !== m.supplier);
  const ppl = [[m.responsibility, 'Member ผู้รับผิดชอบ'], ...fdsFor(m.machine_no).map(e => [e, 'Foreman Day'])].filter(x => x[0]);
  return `<div class="box contacts"><div class="jflow-h"><h3>ติดต่อ</h3><div class="btns">${D.hasParts ? `<a href="#" class="folio sub-link" data-nav="vendors">รายชื่อ Vendor ทั้งหมด</a>` : ''}</div></div>
    <div class="ct-grid">${mainRow ? contactCard(mainRow, true) : ''}${others.map(v => contactCard(v)).join('')}${!mainRow && !others.length ? '<div class="sub">ยังไม่มี Vendor ของเครื่องนี้ · เพิ่มได้จากเมนู ⋯ ด้านบน</div>' : ''}</div>
    ${ppl.length ? `<div class="ct-ppl">${ppl.map(([e, r]) => `<div class="ct-p">${avatar(e, 's')}<div><b>${esc(nm(e))}</b><div class="sub">${r}</div></div><a class="btn ghost sm" href="${esc(teamsChat(e))}" target="_blank" rel="noopener">แชท Teams</a><a class="btn ghost sm" href="mailto:${esc(e)}">อีเมล</a></div>`).join('')}</div>` : ''}</div>`;
}

/* ---------- Vendor: 1 ราย ผูกได้หลายเครื่อง ---------- */
const canVendorEdit = () => isAdmin() || role() === 'foreman_day';
function vendorPicker(sel) {
  const ms = D.machines.filter(m => m.status !== 'Inactive');
  const locs = [...new Set(ms.map(m => m.location).filter(Boolean))], types = [...new Set(ms.map(m => m.machine_type).filter(Boolean))];
  return `<div class="field full"><span class="flabel">ใช้กับเครื่อง <b id="vpN">${sel.size}</b> เครื่อง</span>
    <div class="vp-quick"><span class="sub">เลือกทั้งกลุ่ม:</span>${locs.map(l => `<button type="button" class="chip" data-vpg="location" data-vpv="${esc(l)}">${esc(l)}</button>`).join('')}${types.map(t => `<button type="button" class="chip" data-vpg="machine_type" data-vpv="${esc(t)}">${esc(t)}</button>`).join('')}<button type="button" class="chip" data-vpclear>ล้าง</button></div>
    <label class="sr" for="vpQ">ค้นหาเครื่อง</label><input id="vpQ" class="inp" placeholder="ค้นหาเครื่อง / Location">
    <div class="vp-list">${ms.map(m => `<label class="vp-item" data-vpi="${esc([m.machine_no, m.machine_name, m.location, m.machine_type].join(' ').toLowerCase())}"><input type="checkbox" value="${esc(m.machine_no)}" ${sel.has(m.machine_no) ? 'checked' : ''}><span><b class="mono">${esc(m.machine_no)}</b> ${esc(m.machine_name)}<br><span class="sub">${esc(m.location || '')}${m.parent_machine ? ' · อุปกรณ์ของ ' + esc(m.parent_machine) : ''}</span></span></label>`).join('')}</div></div>`;
}
function bindPicker() {
  const boxes = () => [...$$('#modal .vp-item input')];
  const count = () => { $('#vpN').textContent = boxes().filter(b => b.checked).length; };
  boxes().forEach(b => b.onchange = count);
  $('#vpQ').oninput = () => { const k = $('#vpQ').value.trim().toLowerCase(); $$('#modal .vp-item').forEach(l => { l.hidden = !!k && !l.dataset.vpi.includes(k); }); };
  $$('#modal [data-vpg]').forEach(c => c.onclick = () => { const set = D.machines.filter(m => m[c.dataset.vpg] === c.dataset.vpv).map(m => m.machine_no); const on = !boxes().filter(b => set.includes(b.value)).every(b => b.checked); boxes().forEach(b => { if (set.includes(b.value)) b.checked = on; }); count(); });
  $('#modal [data-vpclear]').onclick = () => { boxes().forEach(b => b.checked = false); count(); };
}
function vendorForm(name, presetMachine) {
  const v = name ? (D.vendors.find(x => x.name === name) || { name }) : { machines: presetMachine ? [presetMachine] : [], active: true };
  const ro = name && !canVendorEdit();
  const f = (k, l, ph = '') => `<div class="field"><label for="vf-${k}">${l}</label><input id="vf-${k}" class="inp" value="${esc(v[k] ?? '')}" placeholder="${ph}" ${ro ? 'readonly' : ''}></div>`;
  modal(`<h2>${name ? 'Vendor: ' + esc(name) : 'เพิ่ม Vendor'}</h2>
    <form id="fVendor" class="form">${f('name', 'ชื่อ Vendor *')}<div class="field"><label for="vf-work_type">ประเภทงาน</label><input id="vf-work_type" class="inp" list="vfWT" value="${esc(v.work_type || '')}" ${ro ? 'readonly' : ''}><datalist id="vfWT"><option>ซ่อม</option><option>CAL</option><option>PM</option><option>อะไหล่</option><option>ผู้รับเหมา</option></datalist></div>
    ${f('contact_person', 'ชื่อผู้ติดต่อ')}${f('phone', 'เบอร์โทร', 'หลายเบอร์คั่นด้วย ,')}${f('email', 'อีเมล')}${f('other_contact', 'Line / ช่องทางอื่น')}
    <div class="field full"><label for="vf-note">หมายเหตุ</label><input id="vf-note" class="inp" value="${esc(v.note || '')}" ${ro ? 'readonly' : ''}></div>
    ${vendorPicker(new Set(v.machines || []))}
    ${isAdmin() ? '<div class="field full"><label><input type="checkbox" id="vfMain"> ตั้งเป็น <b>Vendor หลัก</b> ของเครื่องที่เลือก (อัปเดตช่อง Vendor / ผู้ติดต่อ / เบอร์ ในทะเบียนเครื่องให้ทุกเครื่องพร้อมกัน)</label></div>' : ''}
    ${name ? `<div class="field"><span class="flabel">สถานะ</span><label><input type="checkbox" id="vf-active" ${v.active !== false ? 'checked' : ''} ${ro ? 'disabled' : ''}> ใช้งาน</label></div>` : ''}
    <div class="full btns">${ro ? '<span class="sub">แก้ไขได้เฉพาะ Admin / Foreman Day</span>' : '<button class="btn" type="submit">บันทึก</button>'}<button class="btn ghost" type="button" data-close>ปิด</button></div></form>`, 'wide');
  bindPicker();
  if (ro) $$('#modal .vp-item input, #modal [data-vpg], #modal [data-vpclear]').forEach(x => x.disabled = true);
  $('#fVendor').onsubmit = async e => {
    e.preventDefault(); if (ro) return;
    const g = k => ($('#vf-' + k)?.value || '').trim();
    const row = { name: g('name'), work_type: g('work_type') || null, contact_person: g('contact_person') || null, phone: g('phone') || null, email: g('email') || null, other_contact: g('other_contact') || null, note: g('note') || null, machines: [...$$('#modal .vp-item input')].filter(b => b.checked).map(b => b.value) };
    if (!row.name) return toast('ใส่ชื่อ Vendor');
    if (name && $('#vf-active')) row.active = $('#vf-active').checked;
    if (!name && D.vendors.some(x => x.name.toLowerCase() === row.name.toLowerCase())) return toast('มี Vendor ชื่อนี้แล้ว · เปิดจากรายชื่อเพื่อแก้ไข');
    const r = name ? await sb.from('vendors').update(row).eq('name', name) : await sb.from('vendors').insert(row);
    if (r.error) return fail(r.error);
    if ($('#vfMain')?.checked && row.machines.length) {
      for (const no of row.machines) { const u = await sb.from('machines').update({ supplier: row.name, contact_person: row.contact_person, phone: row.phone, email: row.email, other_contact: row.other_contact, updated_at: new Date().toISOString() }).eq('machine_no', no); if (u.error) return fail(u.error); }
    }
    closeModal(); toast('บันทึก Vendor แล้ว' + (row.machines.length ? ` · ${row.machines.length} เครื่อง` : '')); reload();
  };
}
// เพิ่ม Vendor ให้เครื่อง: เลือกจากรายชื่อที่มี (Admin / FD) หรือสร้างใหม่
function vendorLink(no) {
  const avail = D.vendors.filter(v => v.active !== false && !(v.machines || []).includes(no));
  if (!canVendorEdit() || !avail.length) return vendorForm(null, no);
  modal(`<h2>เพิ่ม Vendor ให้ ${esc(no)}</h2><div class="form"><div class="field full"><label for="vlSel">เลือกจาก Vendor ที่มีอยู่</label><select id="vlSel" class="inp">${avail.map(v => `<option value="${esc(v.name)}">${esc(v.name)}${v.work_type ? ' · ' + esc(v.work_type) : ''} (${(v.machines || []).length} เครื่อง)</option>`).join('')}</select></div></div>
    <div class="btns" style="margin-top:12px"><button class="btn" id="vlGo">เพิ่มให้เครื่องนี้</button><button class="btn ghost" id="vlNew">สร้าง Vendor ใหม่</button><button class="btn ghost" data-close>ยกเลิก</button></div>`);
  $('#vlNew').onclick = () => vendorForm(null, no);
  $('#vlGo').onclick = async () => { const v = D.vendors.find(x => x.name === $('#vlSel').value); const { error } = await sb.from('vendors').update({ machines: [...new Set([...(v.machines || []), no])] }).eq('name', v.name); if (error) return fail(error); closeModal(); toast('เพิ่ม ' + v.name + ' ให้ ' + no + ' แล้ว'); reload(); };
}

/* ---------- Dashboard: ถัดไป · หน้าปัด · ตัวเลขนับขึ้น · ปฏิทินรายสัปดาห์ ---------- */
const reduceMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// รายการที่ใกล้ถึง: PM/CAL ใน 60 วัน (หรือเกินแล้ว) + วันนัด Vendor ของใบงานที่ยังเปิด · เรียงตามวัน
function nextUp() {
  const t0 = todayIso(), items = [];
  planList().filter(x => x.days <= 60).forEach(x => items.push({ date: x.next, days: x.days, kind: x.kind, title: `${x.kind} ${x.m.machine_no}`, sub: x.m.machine_name || '', who: x.m.responsibility, open: x.job?.id, scan: x.m.machine_no }));
  D.requests.filter(q => OPEN(q.status) && q.vendor_date && q.vendor_date >= t0).forEach(q => items.push({ date: q.vendor_date, days: daysLeft(q.vendor_date), kind: 'นัด', title: `นัด Vendor ${q.machine_no || ''}`.trim(), sub: q.vendor || q.symptom || '', who: q.assignee, open: q.id }));
  return items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
}
function nextUpCard() {
  const it = nextUp();
  const when = x => x.days < 0 ? `เกิน ${-x.days} วัน` : x.days === 0 ? 'วันนี้' : x.days === 1 ? 'พรุ่งนี้' : `อีก ${x.days} วัน`;
  return `<section class="nextup"><h3>ถัดไป</h3>${it.length ? it.map(x => `<a href="#" class="nu-row ${x.days < 0 ? 'late' : x.days <= 30 ? 'soon' : ''}" ${x.open ? `data-open="${esc(x.open)}"` : `data-scan="${esc(x.scan)}"`}>
      <span class="nu-d"><b>${Number(x.date.slice(8))} ${TH[Number(x.date.slice(5, 7)) - 1]}</b><small>${when(x)}</small></span>
      <span class="nu-t"><b>${esc(x.title)}</b><small>${esc(x.sub)}${x.who ? ' · ' + esc(nm(x.who)) : ''}</small></span></a>`).join('') : '<p class="nu-empty">ไม่มีงานใน 60 วันข้างหน้า</p>'}
    <button class="nu-more" data-nav="cal">ดูปฏิทิน PM / CAL</button></section>`;
}
// หน้าปัด: ขีดรอบ 300 องศา เว้นช่องด้านล่าง · ขีดสว่างไล่ขึ้นถึงค่าจริง
function dial(value, max, label, sub) {
  const size = 200, R = size / 2, r1 = R - 8, r0 = R - 24, ticks = 48;
  const lines = Array.from({ length: ticks }, (_, i) => { const a = (-240 + (i / (ticks - 1)) * 300) * Math.PI / 180; return `<line x1="${(R + Math.cos(a) * r0).toFixed(1)}" y1="${(R + Math.sin(a) * r0).toFixed(1)}" x2="${(R + Math.cos(a) * r1).toFixed(1)}" y2="${(R + Math.sin(a) * r1).toFixed(1)}"/>`; }).join('');
  const v = max ? Math.max(0, Math.min(max, value)) : 0;
  return `<div class="dial" data-dial="${v}" data-max="${max}" data-ticks="${ticks}">
    <svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label)} ${max ? Math.round(v / max * 100) : 0}%">${lines}</svg>
    <div class="dial-c"><b data-count="${max ? Math.round(v / max * 100) : 0}" data-suffix="%">${max ? Math.round(v / max * 100) : 0}%</b><span>${esc(label)}</span></div>
    ${sub ? `<p class="dial-s">${esc(sub)}</p>` : ''}</div>`;
}
const easeOut = t => 1 - Math.pow(1 - t, 3);
// เล่นภาพเคลื่อนไหวเฉพาะตอนเข้าหน้า (ไม่เล่นซ้ำตอนรีเฟรชข้อมูลอัตโนมัติ)
function playDash() {
  const go = S.lastView !== S.view; S.lastView = S.view;
  $$('.dial').forEach(d => {
    const lines = [...d.querySelectorAll('line')], target = Math.round(Number(d.dataset.dial) / (Number(d.dataset.max) || 1) * lines.length);
    const paint = k => lines.forEach((l, i) => l.classList.toggle('on', i < k));
    if (!go || reduceMotion()) return paint(target);
    paint(0); const t0 = performance.now(), dur = 1600;
    const step = now => { const t = Math.min(1, (now - t0) / dur); paint(Math.round(easeOut(t) * target)); if (t < 1 && document.body.contains(d)) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
  $$('[data-count]').forEach(el => {
    const end = Number(el.dataset.count), suf = el.dataset.suffix || '';
    if (!go || reduceMotion() || !end) { el.textContent = end + suf; return; }
    const t0 = performance.now(), dur = 1100;
    const step = now => { const t = Math.min(1, (now - t0) / dur); el.textContent = Math.round(easeOut(t) * end) + suf; if (t < 1 && document.body.contains(el)) requestAnimationFrame(step); };
    el.textContent = '0' + suf; requestAnimationFrame(step);
  });
}
// ปฏิทินรายสัปดาห์ (จันทร์–อาทิตย์) · วันละคอลัมน์
function calWeek() {
  const base = S.calWeek ? new Date(S.calWeek + 'T00:00:00') : new Date(); base.setHours(0, 0, 0, 0);
  const mon = new Date(base); mon.setDate(base.getDate() - ((base.getDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d; });
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const months = [...new Set(days.map(d => d.getFullYear() * 12 + d.getMonth()))];
  const ev = months.flatMap(k => calEvents(Math.floor(k / 12), k % 12));
  const shift = n => { const d = new Date(mon); d.setDate(mon.getDate() + n * 7); return iso(d); };
  const t0 = todayIso(), last = days[6];
  const range = `${days[0].getDate()} ${TH[days[0].getMonth()]} – ${last.getDate()} ${TH[last.getMonth()]} ${last.getFullYear() + 543}`;
  return `<div class="h-row"><h1>แผน PM / CAL</h1>${calToggle()}${calMenu()}</div>
    <div class="cal-nav"><button class="iconbtn ghosty" data-calweek="${shift(-1)}" aria-label="สัปดาห์ก่อน">‹</button><b>${range}</b><button class="iconbtn ghosty" data-calweek="${shift(1)}" aria-label="สัปดาห์ถัดไป">›</button><button class="btn ghost sm" data-calweek="">สัปดาห์นี้</button>
      <span class="cal-leg"><i class="ev-late"></i>เกินกำหนด <i class="ev-t3"></i>≤ 30 วัน <i class="ev-soon"></i>≤ 90 วัน <i class="ev-plan"></i>ตามแผน <i class="ev-done"></i>ทำแล้ว</span></div>
    <div class="wk">${days.map((d, i) => { const ds = iso(d), es = ev.filter(e => e.date === ds); return `<div class="wk-col ${ds === t0 ? 'today' : ''}">
      <div class="wk-h"><span>${['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'][i]}</span><b>${d.getDate()}</b></div>
      <div class="wk-b">${es.map(e => `<a href="#" class="wk-ev ${evCls(e)}" ${e.job ? `data-open="${esc(e.job.id)}"` : `data-scan="${esc(e.m.machine_no)}"`}><b>${e.kind} ${esc(e.m.machine_no)}</b><small>${esc(e.m.machine_name || '')}</small><small>${evText(e)}</small></a>`).join('') || '<span class="wk-none">—</span>'}</div></div>`; }).join('')}</div>`;
}

// ---------- ปฏิทิน PM / CAL ----------
const listToggle = () => `<div class="seg" role="group" aria-label="มุมมองใบงาน"><button class="${S.listView !== 'flow' ? 'on' : ''}" data-listview="list">รายการ</button><button class="${S.listView === 'flow' ? 'on' : ''}" data-listview="flow">Flow</button></div>`;
const calToggle = () => `<div class="seg" role="group" aria-label="มุมมอง"><button class="${S.calView !== 'month' ? 'on' : ''}" data-calview="list">รายการ</button><button class="${S.calView === 'week' ? 'on' : ''}" data-calview="week">สัปดาห์</button><button class="${S.calView === 'month' ? 'on' : ''}" data-calview="month">เดือน</button></div>`;
// รายการในเดือน: รอบที่ครบกำหนด (ต่อจากรอบถัดไปตาม Interval) + งาน PM/CAL ที่ปิดแล้วในเดือนนั้น
function calEvents(y, mo) {
  const from = `${y}-${String(mo + 1).padStart(2, '0')}-01`, to = addMonths(from, 1);
  const ev = [];
  for (const x of planList()) {
    let due = x.next, k = 0;
    while (due < to && k < 60) { if (due >= from) ev.push({ date: due, kind: x.kind, m: x.m, job: k === 0 ? x.job : null, days: daysLeft(due), future: k > 0 }); due = addMonths(due, x.iv); k++; }
  }
  D.requests.filter(q => q.job_type === 'pmcal' && q.status === 'closed' && q.end_at).forEach(q => {
    const d = new Date(q.end_at), ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (ds >= from && ds < to) ev.push({ date: ds, kind: q.pmcal_kind, m: M(q.machine_no), job: q, done: true });
  });
  return ev.sort((a, b) => a.date.localeCompare(b.date) || a.m.machine_no?.localeCompare(b.m.machine_no));
}
const evCls = e => e.done ? 'ev-done' : e.days < 0 ? 'ev-late' : e.days <= 30 ? 'ev-t3' : e.days <= 90 ? 'ev-soon' : 'ev-plan';
const evText = e => e.done ? 'ทำแล้ว' : e.days < 0 ? `เกิน ${-e.days} วัน` : e.days === 0 ? 'วันนี้' : `อีก ${e.days} วัน`;
function calMonth() {
  const now = new Date(), cur = S.calMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [y, m] = cur.split('-').map(Number), mo = m - 1;
  const ev = calEvents(y, mo), first = new Date(y, mo, 1).getDay(), ndays = new Date(y, mo + 1, 0).getDate();
  const todayS = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const shift = n => { const d = new Date(y, mo + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const cells = [];
  for (let i = 0; i < first; i++) cells.push('<div class="cday out"></div>');
  for (let d = 1; d <= ndays; d++) {
    const ds = `${cur}-${String(d).padStart(2, '0')}`, es = ev.filter(e => e.date === ds);
    cells.push(`<button class="cday ${ds === todayS ? 'today' : ''} ${S.calDay === ds ? 'sel' : ''} ${es.length ? 'has' : ''}" data-calday="${ds}" aria-label="${d} ${TH[mo]} ${es.length} รายการ"><span class="dn">${d}</span>
      <span class="evs">${es.slice(0, 3).map(e => `<i class="ev ${evCls(e)}">${e.kind} ${esc(e.m.machine_no)}</i>`).join('')}${es.length > 3 ? `<i class="ev more">+${es.length - 3}</i>` : ''}</span>
      <span class="dots">${es.slice(0, 4).map(e => `<i class="${evCls(e)}"></i>`).join('')}</span></button>`);
  }
  const pick = S.calDay && S.calDay.startsWith(cur) ? ev.filter(e => e.date === S.calDay) : ev;
  const head = S.calDay && S.calDay.startsWith(cur) ? `วันที่ ${Number(S.calDay.slice(8))} ${TH[mo]} ${y + 543}` : `ทั้งเดือน ${TH[mo]} ${y + 543}`;
  return `<div class="h-row"><h1>แผน PM / CAL</h1>${calToggle()}${calMenu()}</div>
    <div class="cal-nav"><button class="iconbtn ghosty" data-calmonth="${shift(-1)}" aria-label="เดือนก่อน">‹</button><b>${TH[mo]} ${y + 543}</b><button class="iconbtn ghosty" data-calmonth="${shift(1)}" aria-label="เดือนถัดไป">›</button><button class="btn ghost sm" data-calmonth="">เดือนนี้</button>
      <span class="cal-leg"><i class="ev-late"></i>เกินกำหนด <i class="ev-t3"></i>≤ 30 วัน <i class="ev-soon"></i>≤ 90 วัน <i class="ev-plan"></i>ตามแผน <i class="ev-done"></i>ทำแล้ว</span></div>
    <div class="cal" role="grid">${['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map(d => `<div class="cdh">${d}</div>`).join('')}${cells.join('')}</div>
    <h3 class="sec">${head} (${pick.length})</h3>
    ${pick.length ? `<div class="cal-list">${pick.map(e => `<a href="#" class="cal-item ${evCls(e)}" ${e.job ? `data-open="${esc(e.job.id)}"` : `data-scan="${esc(e.m.machine_no)}"`}><span class="cd">${Number(e.date.slice(8))} ${TH[Number(e.date.slice(5, 7)) - 1]}</span><span class="ck">${e.kind}</span><span class="cm"><b class="mono">${esc(e.m.machine_no)}</b> ${esc(e.m.machine_name || '')}<br><span class="sub">${esc(nm(e.m.responsibility))}${e.job ? ' · ' + esc(e.job.id) : e.future ? ' · รอบถัดไป' : ''}</span></span><span class="cs">${evText(e)}</span></a>`).join('')}</div>` : '<div class="empty">ไม่มี PM / CAL ในช่วงนี้</div>'}`;
}

// รายละเอียดอะไหล่: ข้อมูล + ปุ่มทั้งหมด + ประวัติเข้าออก
async function partDetail(pn) {
  const x = PT(pn); if (!x.part_no) return;
  const { data, error } = await sb.from('part_tx').select('*').eq('part_no', pn).order('at', { ascending: false });
  if (error) return fail(error);
  const K = { opening: 'ยอดยกมา', receive: 'รับเข้า', issue: 'เบิกใช้', adjust: 'ปรับยอด' };
  const lo = x.min_qty != null && Number(x.stock) <= Number(x.min_qty);
  const kv = (k, v) => `<div><span>${k}</span>${v}</div>`;
  modal(`<div class="pd-head"><div><h2 style="margin:0">${esc(x.name)}</h2><span class="sub mono">${esc(pn)}${x.spec ? ' · ' + esc(x.spec) : ''}</span></div>
      <div class="pd-stock ${lo ? 'low' : ''}"><b>${qty(x.stock)}</b><span>${esc(x.unit)} คงเหลือ${lo ? ' · ต่ำกว่า Min' : ''}</span></div></div>
    <div class="mcard" style="margin:12px 0">${kv('Min / Max', `${x.min_qty ?? '-'} / ${x.max_qty ?? '-'}`)}${kv('ที่เก็บ', esc(x.location || '-'))}${kv('ราคา/หน่วย', x.unit_price != null ? num2(x.unit_price) + ' บาท' : '-')}${kv('Lead time', x.lead_days ? x.lead_days + ' วัน' : '-')}${kv('Vendor', esc(x.vendor || '-'))}${kv('ใช้กับเครื่อง', (x.machines || []).map(no => `<a href="#" class="folio" data-pd-scan="${esc(no)}">${esc(no)}</a>`).join(', ') || '-')}</div>
    <div class="btns pd-acts">${canCreate() && Number(x.stock) > 0 ? '<button class="btn" data-pd="issue">เบิก</button>' : ''}${canCreate() ? '<button class="btn ghost" data-pd="buy">ขอซื้อ</button>' : ''}${canParts() ? '<button class="btn ghost" data-pd="adj">ปรับยอด (นับสต็อก)</button><button class="btn ghost" data-pd="edit">แก้ไขข้อมูล</button>' : ''}<button class="btn ghost" data-close>ปิด</button></div>
    <h3 class="sec" style="margin-top:16px">ความเคลื่อนไหว (${(data || []).length})</h3>
    ${(data || []).length ? `<div class="tbl-wrap"><table><thead><tr><th>วันที่</th><th>ประเภท</th><th class="num">จำนวน</th><th>ใบงาน / เครื่อง</th><th>โดย / หมายเหตุ</th></tr></thead><tbody>${data.map(t => `<tr><td class="num">${fd(t.at)}</td><td>${K[t.kind] || t.kind}</td><td class="num ${t.qty < 0 ? 'u-Critical' : ''}">${t.qty > 0 ? '+' : ''}${qty(t.qty)}</td><td>${t.request_id ? `<a href="#" class="folio" data-open-close="${esc(t.request_id)}">${esc(t.request_id)}</a>` : ''}${t.machine_no ? `${t.request_id ? '<br>' : ''}<span class="mono sub">${esc(t.machine_no)}</span>` : ''}${t.request_id || t.machine_no ? '' : '-'}</td><td>${esc(nm(t.actor))}${t.note ? '<br><span class="sub">' + esc(t.note) + '</span>' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">ยังไม่มีความเคลื่อนไหว</div>'}`, 'wide');
  $$('#modal [data-open-close]').forEach(a => a.onclick = e => { e.preventDefault(); closeModal(); openDetail(a.dataset.openClose); });
  $$('#modal [data-pd-scan]').forEach(a => a.onclick = e => { e.preventDefault(); closeModal(); openScan(a.dataset.pdScan); });
  const go = f => () => { closeModal(); f(); };
  $$('#modal [data-pd]').forEach(b => b.onclick = go({ issue: () => issueForm(pn), buy: () => buyPart(pn), adj: () => adjustForm(pn), edit: () => partForm(pn) }[b.dataset.pd]));
}
const buyPart = pn => { const x = PT(pn); purchaseForm([{ part_no: x.part_no, name: x.name, unit: x.unit, qty: Math.max(1, Number(x.max_qty ?? x.min_qty ?? 1) - Number(x.stock)) }]); };

// เบิกอะไหล่ใช้ทั่วไป / ใช้กับเครื่อง (ไม่มีใบงาน) · ต้องใส่เหตุผล
function issueForm(pn, mno) {
  const ms = D.machines.filter(m => m.status !== 'Inactive');
  modal(`<h2>เบิกอะไหล่</h2><p class="sub" style="margin-top:0">สำหรับเบิกใช้โดยไม่มีใบงานซ่อม เช่น วัสดุสิ้นเปลืองของเครื่องทดสอบ · ถ้าเบิกเพื่อซ่อม ให้เบิกตอนปิดใบงาน</p>
    <div class="form"><div class="field"><label for="isMachine">ใช้กับเครื่อง</label><select id="isMachine" class="inp"><option value="">— ไม่ระบุ (ใช้ทั่วไป) —</option>${ms.map(m => `<option value="${esc(m.machine_no)}" ${m.machine_no === (mno || (PT(pn).machines || [])[0]) ? 'selected' : ''}>${esc(m.machine_no)} · ${esc(m.machine_name)}</option>`).join('')}</select></div>
    <div class="field"><label for="isNote">เหตุผล / ใช้ทำอะไร *</label><input id="isNote" class="inp" placeholder="เช่น ใช้ทดสอบ Lot 2611-A"></div></div>
    <div id="isRows" style="margin-top:10px"></div>
    <div class="btns" style="margin-top:12px"><button class="btn" id="isGo">บันทึกการเบิก</button><button class="btn ghost" data-close>ยกเลิก</button></div>`);
  const draw = () => { const cur = [0, 1, 2].map(i => [$('#isPt' + i)?.value, $('#isPq' + i)?.value]); $('#isRows').innerHTML = issueRows('is', $('#isMachine').value, '★ = อะไหล่ของเครื่องที่เลือก'); cur.forEach(([a, b], i) => { if (a && $('#isPt' + i)) { $('#isPt' + i).value = a; $('#isPq' + i).value = b; } }); };
  draw(); if (pn && $('#isPt0')) { $('#isPt0').value = pn; $('#isPq0').value = 1; }
  $('#isMachine').onchange = draw;
  $('#isGo').onclick = async () => {
    const issues = readIssues('is'); if (!issues) return; if (!issues.length) return toast('เลือกอะไหล่ที่จะเบิก');
    const note = $('#isNote').value.trim(); if (!note) return toast('ใส่เหตุผลการเบิก');
    $('#isGo').disabled = true;
    for (const it of issues) {
      const { error } = await sb.from('part_tx').insert({ part_no: it.part_no, qty: -it.qty, kind: 'issue', machine_no: $('#isMachine').value || null, note });
      if (error) { $('#isGo').disabled = false; return fail(error); }
    }
    closeModal(); toast('เบิก ' + issueText(issues) + ' แล้ว'); reload();
  };
}
async function machineUsage(mno) {
  const { data, error } = await sb.from('part_tx').select('*').eq('machine_no', mno).eq('kind', 'issue').order('at', { ascending: false });
  if (error) return fail(error);
  const tot = {}; (data || []).forEach(t => { tot[t.part_no] = (tot[t.part_no] || 0) - Number(t.qty); });
  const cost = (data || []).reduce((a, t) => a - Number(t.qty) * Number(t.unit_price || 0), 0);
  modal(`<h2>ประวัติเบิกใช้ ${esc(mno)}</h2><p class="sub" style="margin-top:0">${esc(M(mno).machine_name || '')} · ${(data || []).length} ครั้ง · มูลค่ารวม ${num2(cost)} บาท</p>
    ${Object.keys(tot).length ? `<p>${Object.entries(tot).map(([k, v]) => `<b class="mono">${esc(k)}</b> ${esc(PT(k).name || '')} × ${qty(v)}`).join(' · ')}</p>` : ''}
    ${(data || []).length ? `<div class="tbl-wrap"><table><thead><tr><th>วันที่</th><th>อะไหล่</th><th class="num">จำนวน</th><th>ใบงาน</th><th>โดย / เหตุผล</th></tr></thead><tbody>${data.map(t => `<tr><td class="num">${fd(t.at)}</td><td><b class="mono">${esc(t.part_no)}</b> ${esc(PT(t.part_no).name || '')}</td><td class="num">${qty(-t.qty)} ${esc(PT(t.part_no).unit || '')}</td><td>${t.request_id ? `<a href="#" class="folio" data-open-close="${esc(t.request_id)}">${esc(t.request_id)}</a>` : '-'}</td><td>${esc(nm(t.actor))}${t.note ? '<br><span class="sub">' + esc(t.note) + '</span>' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">ยังไม่มีการเบิกใช้กับเครื่องนี้</div>'}
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
      case 'night_approve': {
        const t = document.querySelector('input[name=ntUnit]:checked').value;
        patch = { status: 'ext_repair', job_type: 'normal', repair_unit: t, return_note: null };
        log = `${ROLES[role()] || ''} อนุมัติซ่อมด่วนนอกเวลา · ส่ง ${t} · รอ Admin ใส่เลขที่ ${t === 'FM' ? 'K2' : 'SAP'} ภายหลัง` + (v('ntNote') ? ' · ' + v('ntNote') : ''); msg = 'อนุมัติซ่อมด่วนแล้ว'; break;
      }
      case 'admin_ref':
        if (!v('slRef')) return toast('กรอกเลขที่ใบแจ้งงาน');
        patch = { external_ref: v('slRef') }; log = `Admin ใส่เลขที่ ${q.repair_unit === 'FM' ? 'K2' : 'SAP'} ภายหลัง: ${v('slRef')}`; msg = 'บันทึกเลขที่แล้ว'; break;
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
        const isCal = a === 'close_special' && q.job_type === 'pmcal' && q.pmcal_kind === 'CAL';
        if (isCal && !filesOf('pvCert').length && !(q.attachments || []).some(x => x.kind === 'cert')) return toast('งาน CAL ต้องแนบใบ Certificate ก่อนปิดงาน');
        patch.attachments = [...(q.attachments || []), ...await uploadFiles(q.id, 'close', filesOf(pre + 'Files')), ...(isCal ? await uploadFiles(q.id, 'cert', filesOf('pvCert')) : [])];
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

/* ---------- ตรวจเครื่องก่อนใช้งานประจำวัน (Checklist) ---------- */
const isOp = () => role() === 'operator';
const ckTpl = id => (D.ckTpl || []).find(t => t.id === id);
const ckOf = m => m && m.checklist_template ? ckTpl(m.checklist_template) : null;
const ckMachines = () => D.machines.filter(m => m.status !== 'Inactive' && ckOf(m));
const ckToday = no => (D.ckRuns || []).find(r => r.machine_no === no && r.run_date === todayIso());
const ckNgToday = () => ckMachines().filter(m => ckToday(m.machine_no)?.ng_count).length;
const hhmm = v => { const d = new Date(v); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const ckStat = m => { const r = ckToday(m.machine_no); return r ? (r.ng_count ? `<span class="pill s-rej">NG ${r.ng_count} ข้อ</span>` : '<span class="pill s-confirm">ตรวจแล้ว ปกติ</span>') : '<span class="pill s-wait">ยังไม่ตรวจ</span>'; };
const ckQ = m => esc((m.machine_no + ' ' + (m.machine_name || '') + ' ' + (m.location || '')).toLowerCase());
function ckCard(m) {
  if (!D.hasChecklist || !ckOf(m) || m.status === 'Inactive') return '';
  const r = ckToday(m.machine_no), t = ckOf(m);
  return `<section class="ck-card ${r ? (r.ng_count ? 'ng' : 'ok') : ''}">
    <div class="ck-c1"><b>ตรวจก่อนใช้งานวันนี้</b><span class="sub">แบบฟอร์ม ${esc(t.name)} · ${t.items.length} ข้อ</span></div>
    ${r ? `<div class="ck-c1">${r.ng_count ? `<b class="bad-t">พบ NG ${r.ng_count} ข้อ</b>` : '<b class="ok-t">ปกติทุกข้อ</b>'}<span class="sub">โดย ${esc(nm(r.actor))} · ${hhmm(r.created_at)} น.</span></div><button class="btn ghost" data-ckview="${r.id}">ดูผลตรวจ</button>`
      : `<button class="btn" data-ck="${esc(m.machine_no)}">${IC.approve}<span>ตรวจก่อนใช้งาน</span></button>`}
  </section>`;
}
function ckHistory(no) {
  const rs = (D.ckRuns || []).filter(r => r.machine_no === no);
  if (!rs.length) return '<div class="empty">ยังไม่มีผลตรวจใน 60 วันที่ผ่านมา</div>';
  return `<div class="tbl-wrap"><table><thead><tr><th>วันที่</th><th>ผล</th><th>ผู้ตรวจ</th><th></th></tr></thead><tbody>${rs.map(r => `<tr><td class="num">${dmy(r.run_date)} · ${hhmm(r.created_at)}</td><td>${r.ng_count ? `<span class="pill s-rej">NG ${r.ng_count} ข้อ</span>` : '<span class="pill s-confirm">ปกติ</span>'}</td><td>${esc(nm(r.actor))}</td><td><button class="btn ghost sm" data-ckview="${r.id}">ดู</button></td></tr>`).join('')}</tbody></table></div>`;
}
function ckForm(no) {
  const m = M(no), t = ckOf(m);
  if (!t) return toast('เครื่องนี้ยังไม่ได้ผูกแบบฟอร์มตรวจ');
  if (ckToday(no)) return ckView(ckToday(no).id);
  const items = t.items || [];
  modal(`<div class="h-row" style="margin:0 0 4px"><h2 style="margin:0;flex:1">ตรวจก่อนใช้งาน · ${esc(no)}</h2><button class="btn ghost" data-close>ปิด</button></div>
    <p class="sub" style="margin-top:0">${esc(m.machine_name || '')} · ${esc(t.name)} · ${dmy(todayIso())} · ผู้ตรวจ ${esc(nm(S.me.email))}</p>
    ${items.some(i => i.k !== 'num') ? '<button class="btn ghost sm" id="ckAllOk">ข้อที่ยังไม่เลือก → OK ทั้งหมด</button>' : ''}
    <ol class="ck-list">${items.map((it, i) => `<li class="ck-it" data-i="${i}"><div class="ck-q">${esc(it.t)}${it.k === 'num' && (it.min != null || it.max != null) ? `<span class="sub"> · เกณฑ์ ${it.min ?? '…'} – ${it.max ?? '…'} ${esc(it.u || '')}</span>` : ''}</div>
      <div class="ck-a">${it.k === 'num' ? `<label class="sr" for="ckv${i}">ค่าที่วัดได้</label><input id="ckv${i}" class="inp ck-v" type="number" step="any" inputmode="decimal" placeholder="ค่า"><span class="ck-u">${esc(it.u || '')}</span><span class="ck-auto" id="cka${i}"></span>`
        : `<div class="ck-seg" role="radiogroup" aria-label="ผลข้อ ${i + 1}"><label class="okb"><input type="radio" name="ck${i}" value="1"><span>OK</span></label><label class="ngb"><input type="radio" name="ck${i}" value="0"><span>NG</span></label></div>`}</div>
      <label class="sr" for="ckn${i}">อาการที่พบ</label><input class="inp ck-note" id="ckn${i}" placeholder="อาการที่พบ (ข้อนี้ NG)" hidden></li>`).join('')}</ol>
    <div class="field"><label for="ckNote">หมายเหตุ (ถ้ามี)</label><textarea id="ckNote" class="inp" rows="2"></textarea></div>
    <div class="field"><label for="ckPh">แนบรูป (ถ้ามี · ไม่เกิน 3 รูป)</label><input id="ckPh" type="file" accept="image/*" multiple></div>
    <div class="btns" style="margin-top:12px"><button class="btn" id="ckGo" disabled>บันทึกผลตรวจ</button><span class="sub" id="ckLeft"></span></div>`, 'wide');
  const st = () => items.map((it, i) => {
    if (it.k === 'num') { const v0 = $('#ckv' + i).value.trim(); if (v0 === '') return null; const v = Number(v0); return { v, ok: (it.min == null || v >= it.min) && (it.max == null || v <= it.max) }; }
    const c = document.querySelector(`input[name="ck${i}"]:checked`); return c ? { ok: c.value === '1' } : null;
  });
  const upd = () => {
    const r = st();
    r.forEach((x, i) => { const ng = !!x && !x.ok, li = document.querySelector(`.ck-it[data-i="${i}"]`); $('#ckn' + i).hidden = !ng; li.classList.toggle('is-ng', ng); li.classList.toggle('is-ok', !!x && x.ok); if (items[i].k === 'num') $('#cka' + i).textContent = x ? (x.ok ? 'OK' : 'NG นอกเกณฑ์') : ''; });
    const left = r.filter(x => !x).length; $('#ckGo').disabled = left > 0;
    $('#ckLeft').textContent = left ? `เหลือ ${left} ข้อ` : (r.some(x => !x.ok) ? `NG ${r.filter(x => !x.ok).length} ข้อ` : 'ปกติทุกข้อ');
  };
  [...$$('#modal .ck-list input')].forEach(el => el.addEventListener(el.type === 'number' ? 'input' : 'change', upd));
  $('#ckAllOk') && ($('#ckAllOk').onclick = () => { items.forEach((it, i) => { if (it.k !== 'num' && !document.querySelector(`input[name="ck${i}"]:checked`)) document.querySelector(`input[name="ck${i}"][value="1"]`).checked = true; }); upd(); });
  upd();
  $('#ckGo').onclick = async () => {
    const go = $('#ckGo'); go.disabled = true;
    try {
      const r = st(), files = [...($('#ckPh').files || [])].filter(f => /^image\//.test(f.type)).slice(0, 3);
      const up = files.length ? await uploadFiles(`checklists/${no}/${todayIso()}`, 'ck', files) : [];
      const results = items.map((it, i) => Object.assign({ t: it.t, k: it.k === 'num' ? 'num' : 'ok', ok: r[i].ok }, it.k === 'num' ? { v: r[i].v, u: it.u || '', min: it.min ?? null, max: it.max ?? null } : {}, r[i].ok ? {} : { note: $('#ckn' + i).value.trim() || null }));
      const { error } = await sb.from('checklist_runs').insert({ machine_no: no, template_id: t.id, template_name: t.name, results, note: $('#ckNote').value.trim() || null, photos: up.map(u => u.path) });
      if (error) throw error;
      const ng = results.filter(x => !x.ok).length;
      closeModal(); toast(ng ? `บันทึกผลตรวจแล้ว · พบ NG ${ng} ข้อ` : 'บันทึกผลตรวจแล้ว · ปกติทุกข้อ'); reload();
    } catch (e) { go.disabled = false; fail(e); }
  };
}
function ckView(id) {
  const r = (D.ckRuns || []).find(x => String(x.id) === String(id)); if (!r) return;
  const m = M(r.machine_no);
  modal(`<div class="h-row" style="margin:0 0 4px"><h2 style="margin:0;flex:1">ผลตรวจ ${esc(r.machine_no)} · ${dmy(r.run_date)}</h2><button class="btn ghost" data-close>ปิด</button></div>
    <p class="sub" style="margin-top:0">${esc(m.machine_name || '')} · ${esc(r.template_name || '')} · โดย ${esc(nm(r.actor))} ${hhmm(r.created_at)} น. · ${r.ng_count ? `<b class="bad-t">NG ${r.ng_count} ข้อ</b>` : 'ปกติทุกข้อ'}</p>
    <ol class="ck-list ro">${(r.results || []).map(x => `<li class="ck-it ${x.ok ? 'is-ok' : 'is-ng'}"><div class="ck-q">${esc(x.t)}${x.note ? `<div class="sub bad-t">${esc(x.note)}</div>` : ''}</div><div class="ck-a"><b>${x.k === 'num' ? `${esc(String(x.v))} ${esc(x.u || '')}` : x.ok ? 'OK' : 'NG'}</b>${x.k === 'num' && !x.ok ? ' <span class="sub">นอกเกณฑ์</span>' : ''}</div></li>`).join('')}</ol>
    ${r.note ? `<p><b>หมายเหตุ:</b> ${esc(r.note)}</p>` : ''}
    ${r.ng_count && canReport() && r.run_date === todayIso() ? `<div class="btns" style="margin:10px 0"><button class="btn" id="ckReport">${IC.new}<span>แจ้งซ่อมจากข้อ NG</span></button><span class="sub">กรอกเครื่องและอาการให้ แก้ไขได้ก่อนส่ง</span></div>` : ''}
    ${(r.photos || []).length ? `<div class="ck-phs">${r.photos.map(ph => imgTag(ph, 'รูปประกอบผลตรวจ')).join('')}</div>` : ''}
    ${isAdmin() ? `<div class="btns" style="margin-top:12px"><button class="btn ghost sm bad-t" id="ckDel">ลบผลตรวจนี้</button><span class="sub">ลบแล้วตรวจใหม่ได้ในวันเดียวกัน</span></div>` : ''}`, 'wide');
  $('#ckReport') && ($('#ckReport').onclick = () => {
    S.prefill = r.machine_no; S.prefillSym = 'ตรวจก่อนใช้งาน ' + dmy(r.run_date) + ' พบ NG: ' + r.results.filter(x => !x.ok).map(x => x.t + (x.k === 'num' ? ` (${x.v} ${x.u || ''})` : '') + (x.note ? ` — ${x.note}` : '')).join(' / ');
    closeModal(); S.view = 'new'; render(); window.scrollTo(0, 0);
  });
  $('#ckDel') && ($('#ckDel').onclick = async e => {
    const b = e.currentTarget; if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'ยืนยันลบ?'; return; }
    const { error } = await sb.from('checklist_runs').delete().eq('id', r.id); if (error) return fail(error);
    closeModal(); toast('ลบผลตรวจแล้ว'); reload();
  });
}
function ckBox() {
  if (!D.hasChecklist) return ''; const ms = ckMachines(); if (!ms.length) return '';
  const done = ms.filter(m => ckToday(m.machine_no)), ng = done.filter(m => ckToday(m.machine_no).ng_count).length;
  return `<section class="box ck-box"><h3>ตรวจก่อนใช้งานวันนี้</h3><div class="ck-sum"><b data-count="${done.length}">${done.length}</b><span>/ ${ms.length} เครื่อง</span>${ng ? `<span class="pill s-rej">NG ${ng} เครื่อง</span>` : ''}</div><div class="btns"><button class="btn ghost sm" data-nav="checks">ดูรายละเอียด</button>${D.hasMap && D.plans.length ? `<button class="btn ghost sm" data-nav="map">${IC.map}<span>ดูบนแผนผัง</span></button>` : ''}</div></section>`;
}
function ckPage() {
  if (!D.hasChecklist) return `<div class="h-row"><h1>ตรวจเครื่องประจำวัน</h1></div><div class="empty">ยังไม่ได้เปิดใช้ · Admin รัน supabase/install.sql ใน Supabase</div>`;
  const ms = ckMachines().sort((a, b) => (!!ckToday(a.machine_no)) - (!!ckToday(b.machine_no)) || a.machine_no.localeCompare(b.machine_no));
  const done = ms.filter(m => ckToday(m.machine_no)).length;
  const today = `<div class="fbar"><label class="sr" for="ckq">ค้นหาเครื่อง</label><input id="ckq" class="search" placeholder="ค้นหาเครื่อง" value="${esc(S.ckq || '')}"></div>` + (ms.length ? `<div class="tbl-wrap"><table><thead><tr><th>เครื่อง</th><th>แบบฟอร์ม</th><th>วันนี้</th><th>ผู้ตรวจ</th><th></th></tr></thead><tbody>${ms.map(m => { const r = ckToday(m.machine_no); return `<tr data-q="${ckQ(m)}"><td><a href="?m=${encodeURIComponent(m.machine_no)}" class="folio" data-scan="${esc(m.machine_no)}">${esc(m.machine_no)}</a> ${esc(m.machine_name || '')}<br><span class="sub">${esc(m.location || '')}</span></td><td>${esc(ckOf(m).name)}</td><td>${ckStat(m)}</td><td>${r ? `${esc(nm(r.actor))}<br><span class="sub">${hhmm(r.created_at)} น.</span>` : '<span class="sub">-</span>'}</td><td>${r ? `<button class="btn ghost sm" data-ckview="${r.id}">ดูผล</button>` : `<button class="btn sm" data-ck="${esc(m.machine_no)}">ตรวจ</button>`}</td></tr>`; }).join('')}</tbody></table></div>` : `<div class="empty">ยังไม่มีเครื่องที่ต้องตรวจประจำวัน${isAdmin() ? ' · ไปที่แท็บ “แบบฟอร์ม” แล้วเลือกเครื่องที่ใช้แบบฟอร์มนั้น' : ''}</div>`);
  const runs = (D.ckRuns || []).filter(r => !S.ckNg || r.ng_count);
  const hist = `<div class="fbar"><label><input type="checkbox" id="ckNg" ${S.ckNg ? 'checked' : ''}> แสดงเฉพาะที่มี NG</label></div>` + (runs.length ? `<div class="tbl-wrap"><table><thead><tr><th>วันที่</th><th>เครื่อง</th><th>ผล</th><th>ผู้ตรวจ</th><th></th></tr></thead><tbody>${runs.map(r => `<tr><td class="num">${dmy(r.run_date)} · ${hhmm(r.created_at)}</td><td><b class="mono">${esc(r.machine_no)}</b> ${esc(M(r.machine_no).machine_name || '')}</td><td>${r.ng_count ? `<span class="pill s-rej">NG ${r.ng_count} ข้อ</span>` : '<span class="pill s-confirm">ปกติ</span>'}</td><td>${esc(nm(r.actor))}</td><td><button class="btn ghost sm" data-ckview="${r.id}">ดู</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">ยังไม่มีผลตรวจ</div>');
  const forms = `<div class="ck-tpls">${(D.ckTpl || []).map(t => { const n = D.machines.filter(m => m.checklist_template === t.id).length; return `<div class="card ck-tpl"><h3>${esc(t.name)}</h3><span class="sub">${t.items.length} ข้อ · ใช้กับ ${n} เครื่อง</span><ol>${t.items.slice(0, 4).map(i => `<li>${esc(i.t)}${i.k === 'num' ? ` <span class="sub">(${esc(i.u || 'ตัวเลข')})</span>` : ''}</li>`).join('')}${t.items.length > 4 ? `<li class="sub">… อีก ${t.items.length - 4} ข้อ</li>` : ''}</ol><button class="btn ghost sm" data-cktpl="${esc(t.id)}">${isAdmin() ? 'แก้ไข / เลือกเครื่อง' : 'ดูทั้งหมด'}</button></div>`; }).join('')}</div>${isAdmin() ? '<button class="btn" data-cktpl="" style="margin-top:12px">+ แบบฟอร์มใหม่</button>' : ''}`;
  return `<div class="h-row"><h1>ตรวจเครื่องประจำวัน</h1><span class="sub">วันนี้ ${done} / ${ms.length} เครื่อง</span>${moreMenu(['<button class="mi" data-ckx="0">Export ผลตรวจ เดือนนี้ (Excel)</button>', '<button class="mi" data-ckx="1">Export ผลตรวจ เดือนก่อน (Excel)</button>'])}</div>
    ${tabs('ck', [['today', 'วันนี้', today, ms.length - done], ['hist', 'ประวัติ 60 วัน', hist], ['forms', 'แบบฟอร์ม', forms, (D.ckTpl || []).length]])}`;
}
async function ckExport(back) {
  try {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - back);
    const from = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`, e = new Date(d); e.setMonth(e.getMonth() + 1); const to = `${e.getFullYear()}-${pad(e.getMonth() + 1)}-01`;
    const { data, error } = await sb.from('checklist_runs').select('*').gte('run_date', from).lt('run_date', to).order('run_date');
    if (error) throw error; if (!data.length) return toast('ไม่มีผลตรวจในเดือนนี้');
    const sum = data.map(r => ({ 'วันที่': r.run_date, 'เวลา': hhmm(r.created_at), 'Machine number': r.machine_no, 'ชื่อเครื่อง': M(r.machine_no).machine_name || '', 'แบบฟอร์ม': r.template_name || '', 'ผู้ตรวจ': nm(r.actor), 'NG (ข้อ)': r.ng_count, 'หมายเหตุ': r.note || '' }));
    const det = data.flatMap(r => (r.results || []).map((x, i) => ({ 'วันที่': r.run_date, 'Machine number': r.machine_no, 'ข้อ': i + 1, 'หัวข้อ': x.t, 'ผล': x.ok ? 'OK' : 'NG', 'ค่าที่วัด': x.k === 'num' ? x.v : '', 'หน่วย': x.u || '', 'อาการ (NG)': x.note || '', 'ผู้ตรวจ': nm(r.actor) })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sum), 'สรุปรายวัน'); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(det), 'รายละเอียดทุกข้อ');
    XLSX.writeFile(wb, `CAPD-Checklist-${from.slice(0, 7)}.xlsx`);
  } catch (e) { fail(e); }
}
function ckTplEdit(id) {
  const t = id ? ckTpl(id) : { id: '', name: '', items: [{ t: '', k: 'ok' }] }; if (!t) return;
  if (!isAdmin()) return modal(`<div class="h-row" style="margin:0 0 4px"><h2 style="margin:0;flex:1">${esc(t.name)}</h2><button class="btn ghost" data-close>ปิด</button></div><ol class="ck-list ro">${t.items.map(i => `<li class="ck-it"><div class="ck-q">${esc(i.t)}</div><div class="ck-a sub">${i.k === 'num' ? `${i.min ?? '…'} – ${i.max ?? '…'} ${esc(i.u || '')}` : 'OK / NG'}</div></li>`).join('')}</ol>`, 'wide');
  const items = JSON.parse(JSON.stringify(t.items || []));
  const row = (it, i) => `<div class="ckt-row"><span class="ckt-n">${i + 1}</span><input class="inp ckt-t" data-i="${i}" value="${esc(it.t)}" placeholder="หัวข้อที่ตรวจ" aria-label="หัวข้อที่ ${i + 1}">
    <select class="inp ckt-k" data-i="${i}" aria-label="ชนิดคำตอบข้อ ${i + 1}"><option value="ok" ${it.k !== 'num' ? 'selected' : ''}>OK / NG</option><option value="num" ${it.k === 'num' ? 'selected' : ''}>ตัวเลข</option></select>
    ${it.k === 'num' ? `<input class="inp ckt-u" data-i="${i}" value="${esc(it.u || '')}" placeholder="หน่วย" aria-label="หน่วย"><input class="inp ckt-min" data-i="${i}" type="number" step="any" value="${it.min ?? ''}" placeholder="ต่ำสุด" aria-label="ค่าต่ำสุด"><input class="inp ckt-max" data-i="${i}" type="number" step="any" value="${it.max ?? ''}" placeholder="สูงสุด" aria-label="ค่าสูงสุด">` : ''}
    <span class="ckt-btns"><button class="iconbtn ghosty" data-cku="${i}" aria-label="เลื่อนขึ้น">↑</button><button class="iconbtn ghosty" data-ckd="${i}" aria-label="เลื่อนลง">↓</button><button class="iconbtn ghosty bad-t" data-ckr="${i}" aria-label="ลบข้อนี้">×</button></span></div>`;
  modal(`<div class="h-row" style="margin:0 0 4px"><h2 style="margin:0;flex:1">${id ? 'แก้ไขแบบฟอร์มตรวจ' : 'แบบฟอร์มตรวจใหม่'}</h2><button class="btn ghost" data-close>ยกเลิก</button></div>
    <div class="field"><label for="cktName">ชื่อแบบฟอร์ม</label><input id="cktName" class="inp" value="${esc(t.name)}" placeholder="เช่น เครื่องจักรผลิต"></div>
    <h3 class="sec">หัวข้อที่ตรวจ</h3><p class="sub" style="margin-top:0">ตัวเลข: ใส่ค่าต่ำสุด / สูงสุด ถ้าวัดได้นอกช่วงนี้ ระบบบันทึกเป็น NG ให้เอง</p>
    <div id="cktRows"></div><button class="btn ghost sm" id="cktAdd">+ เพิ่มหัวข้อ</button>
    <h3 class="sec">เครื่องที่ต้องตรวจด้วยแบบฟอร์มนี้ <span class="sub" id="cktN"></span></h3>
    <label class="sr" for="cktQ">ค้นหาเครื่อง</label><input id="cktQ" class="search" placeholder="ค้นหาเครื่อง">
    <div class="ckt-ms" id="cktMs">${D.machines.filter(m => m.status !== 'Inactive').map(m => { const o = m.checklist_template && m.checklist_template !== id ? ckTpl(m.checklist_template) : null; return `<label data-q="${ckQ(m)}"><input type="checkbox" value="${esc(m.machine_no)}" ${id && m.checklist_template === id ? 'checked' : ''}> <b class="mono">${esc(m.machine_no)}</b> ${esc(m.machine_name || '')}${o ? ` <span class="sub">(ตอนนี้ใช้: ${esc(o.name)})</span>` : ''}</label>`; }).join('')}</div>
    <div class="btns" style="margin-top:12px"><button class="btn" id="cktSave">บันทึก</button>${id ? '<button class="btn ghost bad-t" id="cktDel">ลบแบบฟอร์ม</button>' : ''}</div>`, 'wide');
  const num = v => v === '' || v == null ? null : Number(v);
  const sync = () => {
    $$('.ckt-t').forEach(e => items[e.dataset.i].t = e.value); $$('.ckt-k').forEach(e => items[e.dataset.i].k = e.value);
    $$('.ckt-u').forEach(e => items[e.dataset.i].u = e.value); $$('.ckt-min').forEach(e => items[e.dataset.i].min = num(e.value)); $$('.ckt-max').forEach(e => items[e.dataset.i].max = num(e.value));
  };
  const draw = () => {
    $('#cktRows').innerHTML = items.map(row).join('');
    $$('.ckt-k').forEach(e => e.onchange = () => { sync(); draw(); });
    $$('[data-cku]').forEach(b => b.onclick = () => { sync(); const i = +b.dataset.cku; if (i > 0) [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); });
    $$('[data-ckd]').forEach(b => b.onclick = () => { sync(); const i = +b.dataset.ckd; if (i < items.length - 1) [items[i + 1], items[i]] = [items[i], items[i + 1]]; draw(); });
    $$('[data-ckr]').forEach(b => b.onclick = () => { sync(); items.splice(+b.dataset.ckr, 1); draw(); });
  };
  const cnt = () => { $('#cktN').textContent = `(เลือกแล้ว ${[...$$('#cktMs input:checked')].length} เครื่อง)`; };
  draw(); cnt();
  $('#cktAdd').onclick = () => { sync(); items.push({ t: '', k: 'ok' }); draw(); [...$$('.ckt-t')].pop().focus(); };
  $('#cktMs').onchange = cnt;
  $('#cktQ').oninput = e => { const k = e.target.value.trim().toLowerCase(); $$('#cktMs label').forEach(l => l.hidden = !!k && !l.dataset.q.includes(k)); };
  $('#cktSave').onclick = async () => {
    sync();
    const name = $('#cktName').value.trim(), its = items.filter(i => (i.t || '').trim()).map(i => i.k === 'num' ? { t: i.t.trim(), k: 'num', u: (i.u || '').trim(), min: i.min ?? null, max: i.max ?? null } : { t: i.t.trim(), k: 'ok' });
    if (!name) return toast('ใส่ชื่อแบบฟอร์ม'); if (!its.length) return toast('ใส่หัวข้ออย่างน้อย 1 ข้อ');
    const bad = its.find(i => i.k === 'num' && i.min != null && i.max != null && i.min > i.max); if (bad) return toast(`“${bad.t}”: ค่าต่ำสุดมากกว่าค่าสูงสุด`);
    const tid = id || 'tpl-' + Date.now().toString(36), chosen = new Set([...$$('#cktMs input:checked')].map(c => c.value));
    $('#cktSave').disabled = true;
    try {
      const { error } = await sb.from('checklist_templates').upsert({ id: tid, name, items: its }); if (error) throw error;
      for (const m of D.machines) {
        const want = chosen.has(m.machine_no) ? tid : (m.checklist_template === tid ? null : undefined);
        if (want === undefined || want === m.checklist_template) continue;
        const r = await sb.from('machines').update({ checklist_template: want }).eq('machine_no', m.machine_no); if (r.error) throw r.error;
      }
      closeModal(); toast('บันทึกแบบฟอร์มแล้ว · ใช้กับ ' + chosen.size + ' เครื่อง'); reload();
    } catch (e) { $('#cktSave').disabled = false; fail(e); }
  };
  $('#cktDel') && ($('#cktDel').onclick = async e => {
    const b = e.currentTarget; if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'ยืนยันลบ? (เครื่องที่ใช้อยู่จะไม่มีแบบฟอร์ม)'; return; }
    try {
      for (const m of D.machines.filter(x => x.checklist_template === id)) { const r = await sb.from('machines').update({ checklist_template: null }).eq('machine_no', m.machine_no); if (r.error) throw r.error; }
      const { error } = await sb.from('checklist_templates').delete().eq('id', id); if (error) throw error;
      closeModal(); toast('ลบแบบฟอร์มแล้ว'); reload();
    } catch (x) { fail(x); }
  });
}
// หน้าหลักของผู้ใช้เครื่อง: สแกน QR หรือเลือกเครื่องจากรายการ
function opHome() {
  const ms = ckMachines().sort((a, b) => (!!ckToday(a.machine_no)) - (!!ckToday(b.machine_no)) || a.machine_no.localeCompare(b.machine_no));
  const done = ms.filter(m => ckToday(m.machine_no)).length, mine = (D.ckRuns || []).filter(r => r.actor === S.me.email && r.run_date === todayIso()).length;
  return `<div class="hello"><h1>สวัสดี, ${esc(String(S.me.full_name || S.me.email).split(' ')[0])}</h1><span class="sub">ผู้ใช้เครื่อง · วันนี้คุณตรวจแล้ว ${mine} เครื่อง</span></div>
    <button class="ck-scan" data-scanqr>${IC.qr}<span><b>สแกน QR ที่เครื่อง</b><small>เพื่อตรวจก่อนใช้งาน หรือแจ้งซ่อม</small></span></button>
    <button class="btn ghost op-map" data-nav="new">${IC.new}<span>แจ้งซ่อม (เครื่องเสีย / ผิดปกติ)</span></button>
    ${(() => { const mine = D.requests.filter(q => q.reporter === S.me.email).slice(0, 5); return mine.length ? `<h3 class="sec">แจ้งซ่อมของฉัน</h3><div class="ck-mlist">${mine.map(q => `<button class="ck-m" data-open="${esc(q.id)}"><span class="ck-mn"><b class="mono">${esc(q.id)}</b> ${esc(q.machine_no || '')}<small>${esc(String(q.symptom || '').slice(0, 60))}</small></span>${pill(q.status)}</button>`).join('')}</div>` : ''; })()}
    ${D.hasMap && D.plans.length ? `<button class="btn ghost op-map" data-nav="map">${IC.map}<span>ดูแผนผัง: เครื่องไหนยังไม่ได้ตรวจ</span></button>` : ''}
    <h3 class="sec">เครื่องที่ต้องตรวจวันนี้ <span class="sub">ตรวจแล้ว ${done} / ${ms.length}</span></h3>
    ${ms.length ? `<div class="fbar"><label class="sr" for="ckq">ค้นหาเครื่อง</label><input id="ckq" class="search" placeholder="ค้นหาเครื่อง" value="${esc(S.ckq || '')}"></div>
    <div class="ck-mlist">${ms.map(m => { const r = ckToday(m.machine_no); return `<button class="ck-m" data-q="${ckQ(m)}" ${r ? `data-ckview="${r.id}"` : `data-ck="${esc(m.machine_no)}"`}><span class="ck-mn"><b class="mono">${esc(m.machine_no)}</b> ${esc(m.machine_name || '')}<small>${esc(m.location || '')}${r ? ` · ${esc(nm(r.actor))} ${hhmm(r.created_at)} น.` : ''}</small></span>${ckStat(m)}</button>`; }).join('')}</div>` : '<div class="empty">ยังไม่มีเครื่องที่ต้องตรวจ · แจ้ง Admin ให้เลือกเครื่องในแบบฟอร์มตรวจ</div>'}`;
}
function opScan(m) {
  const ph = (D.mphotos || []).filter(x => x.machine_no === m.machine_no).sort((a, b) => (b.is_main ? 1 : 0) - (a.is_main ? 1 : 0))[0];
  return `<div class="h-row"><h1>${esc(m.machine_no)} · ${esc(m.machine_name || '')}</h1><span class="sp"></span><button class="btn ghost" data-newfor="${esc(m.machine_no)}">${IC.new}<span>แจ้งซ่อมเครื่องนี้</span></button></div>
    ${ph ? `<div class="minfo-ph op-ph">${imgTag(ph.path, 'รูปเครื่อง ' + m.machine_no)}</div>` : ''}
    <div class="mcard">${[['Location', m.location], ['Type', m.machine_type], ['Model', m.model]].filter(x => x[1]).map(([k, v]) => `<div><span>${k}</span>${esc(v)}</div>`).join('')}</div>
    ${ckOf(m) && m.status !== 'Inactive' ? ckCard(m) + `<h3 class="sec">ผลตรวจย้อนหลัง</h3>${ckHistory(m.machine_no)}` : '<div class="empty">เครื่องนี้ไม่ต้องตรวจก่อนใช้งานประจำวัน</div>'}`;
}

/* ---------- แผนผังโรงงาน: หมุดเครื่อง สีตามผลตรวจก่อนใช้งานวันนี้ ---------- */
const PINTXT = { todo: 'ยังไม่ตรวจ', ng: 'พบ NG', ok: 'ตรวจแล้ว ปกติ', na: 'ไม่ต้องตรวจ' };
const pinSt = m => { if (!ckOf(m)) return 'na'; const r = ckToday(m.machine_no); return !r ? 'todo' : r.ng_count ? 'ng' : 'ok'; };
function mapPage() {
  const head = extra => `<div class="h-row"><h1>แผนผังเครื่อง</h1>${extra || ''}</div>`;
  if (!D.hasMap) return head() + '<div class="empty">ยังไม่ได้เปิดใช้ · Admin รัน supabase/install.sql ใน Supabase</div>';
  if (!D.plans.length) return head() + `<div class="empty">ยังไม่มีผังโรงงาน${isAdmin() ? '<br><button class="btn" data-mpnew="1" style="margin-top:12px">+ เพิ่มผังแรก</button>' : ' · แจ้ง Admin ให้อัปโหลดรูปผัง'}</div>`;
  const cur = D.plans.find(x => x.id === S.mapPlan) || D.plans[0]; S.mapPlan = cur.id;
  const edit = !!S.mapEdit && isAdmin(), zoom = S.mapZoom || 1;
  const ms = D.machines.filter(m => m.map_plan === cur.id && m.map_x != null && m.map_y != null && m.status !== 'Inactive');
  const cnt = k => ms.filter(m => pinSt(m) === k).length;
  const show = ms.filter(m => edit || !S.mapTodo || ['todo', 'ng'].includes(pinSt(m)));
  const pins = show.map(m => { const k = pinSt(m); return `<button class="pin p-${k} ${S.mapPick === m.machine_no ? 'picked' : ''}" style="left:${(m.map_x * 100).toFixed(2)}%;top:${(m.map_y * 100).toFixed(2)}%" data-pin="${esc(m.machine_no)}" title="${esc(m.machine_no + ' · ' + (m.machine_name || '') + ' · ' + PINTXT[k])}" aria-label="${esc(m.machine_no)} ${PINTXT[k]}"><i></i><span>${esc(m.machine_no)}</span></button>`; }).join('');
  const others = D.machines.filter(m => m.status !== 'Inactive' && !(m.map_plan === cur.id && m.map_x != null));
  const pick = S.mapPick ? M(S.mapPick) : null;
  const editBar = edit ? `<div class="map-edit">
      <div class="map-ed1"><b>ปักหมุด</b><span class="sub">${pick ? `เลือก <b class="mono">${esc(pick.machine_no)}</b> แล้ว · คลิกจุดบนผังเพื่อวาง` : 'เลือกเครื่องจากรายการ หรือคลิกหมุดบนผังเพื่อย้าย แล้วคลิกจุดบนผัง'}</span>
        ${pick && pick.map_plan === cur.id && pick.map_x != null ? `<button class="btn ghost sm bad-t" data-pinrm="${esc(pick.machine_no)}">เอาหมุดออก</button>` : ''}${pick ? '<button class="btn ghost sm" data-pinpick="">ยกเลิก</button>' : ''}</div>
      <label class="sr" for="mapQ">ค้นหาเครื่อง</label><input id="mapQ" class="search" placeholder="ค้นหาเครื่องที่ยังไม่ได้ปักบนผังนี้ (${others.length})">
      <div class="map-list">${others.map(m => `<button class="${S.mapPick === m.machine_no ? 'on' : ''}" data-pinpick="${esc(m.machine_no)}" data-q="${ckQ(m)}"><b class="mono">${esc(m.machine_no)}</b> ${esc(m.machine_name || '')}${m.map_plan ? ` <span class="sub">(อยู่ผัง ${esc((D.plans.find(x => x.id === m.map_plan) || {}).name || '')})</span>` : ''}</button>`).join('')}</div>
    </div>` : '';
  return head(`<span class="sp"></span>${isAdmin() ? `<button class="btn ${edit ? '' : 'ghost'}" data-mapedit="1">${edit ? 'เสร็จสิ้น' : 'แก้ไขผัง / ปักหมุด'}</button>${moreMenu([`<button class="mi" data-mpset="${esc(cur.id)}">ตั้งค่าผังนี้ (ชื่อ / รูป)</button>`, '<button class="mi" data-mpnew="1">+ เพิ่มผังใหม่</button>'])}` : ''}`) + `
    ${D.plans.length > 1 ? `<div class="map-plans" role="tablist">${D.plans.map(x => `<button role="tab" aria-selected="${x.id === cur.id}" class="${x.id === cur.id ? 'on' : ''}" data-plan="${esc(x.id)}">${esc(x.name)}<span class="tn">${D.machines.filter(m => m.map_plan === x.id && m.status !== 'Inactive' && pinSt(m) === 'todo').length || ''}</span></button>`).join('')}</div>` : ''}
    <div class="map-bar"><span class="lg todo"><i></i>ยังไม่ตรวจ <b>${cnt('todo')}</b></span><span class="lg ng"><i></i>พบ NG <b>${cnt('ng')}</b></span><span class="lg ok"><i></i>ปกติ <b>${cnt('ok')}</b></span><span class="lg na"><i></i>ไม่ต้องตรวจ <b>${cnt('na')}</b></span>
      <label class="map-only"><input type="checkbox" id="mapTodo" ${S.mapTodo ? 'checked' : ''}> แสดงเฉพาะที่ต้องดู</label>
      <span class="sp"></span><span class="map-zoom"><button class="iconbtn ghosty" data-mapzoom="-1" aria-label="ย่อ">−</button><span>${Math.round(zoom * 100)}%</span><button class="iconbtn ghosty" data-mapzoom="1" aria-label="ขยาย">+</button></span></div>
    ${editBar}
    <div class="map-wrap"><div class="map-cv ${edit ? 'edit' : ''} ${edit && pick ? 'placing' : ''}" id="mapCv" style="width:${zoom * 100}%">${cur.image_path ? imgTag(cur.image_path, 'ผัง ' + cur.name, 'map-img') : '<div class="map-noimg">ยังไม่มีรูปผัง · กด ⋯ → ตั้งค่าผังนี้ เพื่ออัปโหลด</div>'}${pins}</div></div>
    <p class="sub">${edit ? 'ตำแหน่งบันทึกทันทีที่วางหมุด' : 'แตะหมุดเพื่อตรวจ หรือดูผลตรวจวันนี้ · หมุดที่กะพริบ = ยังไม่ได้ตรวจ'}</p>`;
}
function planForm(id) {
  const x = id ? D.plans.find(p => p.id === id) : null;
  modal(`<div class="h-row" style="margin:0 0 4px"><h2 style="margin:0;flex:1">${x ? 'ตั้งค่าผัง' : 'เพิ่มผังใหม่'}</h2><button class="btn ghost" data-close>ยกเลิก</button></div>
    <div class="field"><label for="plName">ชื่อผัง</label><input id="plName" class="inp" value="${esc(x?.name || '')}" placeholder="เช่น ชั้น 1 · Extruder Area"></div>
    <div class="field"><label for="plImg">รูปผังโรงงาน ${x?.image_path ? '(เลือกใหม่ถ้าจะเปลี่ยน · หมุดเดิมอยู่ตำแหน่งเดิมตามสัดส่วน)' : ''}</label><input id="plImg" type="file" accept="image/*"><span class="sub">ใช้รูป Layout จาก PDF / ภาพถ่าย / ภาพหน้าจอก็ได้ ระบบย่อเหลือด้านยาว 2,400 px</span></div>
    <div class="btns" style="margin-top:12px"><button class="btn" id="plGo2">บันทึก</button>${x ? '<button class="btn ghost bad-t" id="plDel">ลบผังนี้</button>' : ''}</div>`);
  $('#plGo2').onclick = async () => {
    const name = $('#plName').value.trim(), f = $('#plImg').files[0];
    if (!name) return toast('ใส่ชื่อผัง'); if (!x && !f) return toast('เลือกรูปผัง');
    $('#plGo2').disabled = true;
    try {
      const pid = x?.id || 'plan-' + Date.now().toString(36);
      const up = f ? await uploadFiles('plans/' + pid, 'plan', [f], 2400) : [];
      const row = { id: pid, name, sort: x ? x.sort : D.plans.length, updated_at: new Date().toISOString() }; if (up[0]) row.image_path = up[0].path;
      const { error } = await sb.from('floor_plans').upsert(row); if (error) throw error;
      S.mapPlan = pid; closeModal(); toast('บันทึกผังแล้ว'); reload();
    } catch (e) { $('#plGo2').disabled = false; fail(e); }
  };
  $('#plDel') && ($('#plDel').onclick = async e => {
    const b = e.currentTarget; if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'ยืนยันลบ? (หมุดบนผังนี้จะหายไป)'; return; }
    try {
      for (const m of D.machines.filter(m => m.map_plan === x.id)) { const r = await sb.from('machines').update({ map_plan: null, map_x: null, map_y: null }).eq('machine_no', m.machine_no); if (r.error) throw r.error; }
      const { error } = await sb.from('floor_plans').delete().eq('id', x.id); if (error) throw error;
      S.mapPlan = null; closeModal(); toast('ลบผังแล้ว'); reload();
    } catch (er) { fail(er); }
  });
}
async function placePin(no, plan, x, y) {
  const m = M(no); if (!m.machine_no) return;
  const patch = plan ? { map_plan: plan, map_x: Math.round(x * 10000) / 10000, map_y: Math.round(y * 10000) / 10000 } : { map_plan: null, map_x: null, map_y: null };
  Object.assign(m, patch); S.mapPick = null; render();
  const { error } = await sb.from('machines').update(patch).eq('machine_no', no);
  if (error) { fail(error); reload(); } else toast(plan ? `วาง ${no} แล้ว` : `เอา ${no} ออกจากผังแล้ว`);
}
function bindMap() {
  if (S.view !== 'map') return;
  $$('[data-plan]').forEach(b => b.onclick = () => { S.mapPlan = b.dataset.plan; S.mapPick = null; render(); });
  $$('[data-mapedit]').forEach(b => b.onclick = () => { S.mapEdit = !S.mapEdit; S.mapPick = null; render(); });
  $$('[data-mpnew]').forEach(b => b.onclick = () => planForm(null));
  $$('[data-mpset]').forEach(b => b.onclick = () => planForm(b.dataset.mpset));
  $$('[data-mapzoom]').forEach(b => b.onclick = () => { S.mapZoom = Math.min(3, Math.max(1, (S.mapZoom || 1) + 0.5 * Number(b.dataset.mapzoom))); render(); });
  $('#mapTodo') && ($('#mapTodo').onchange = e => { S.mapTodo = e.target.checked; render(); });
  $$('[data-pinpick]').forEach(b => b.onclick = () => { S.mapPick = b.dataset.pinpick || null; render(); });
  $$('[data-pinrm]').forEach(b => b.onclick = () => placePin(b.dataset.pinrm, null));
  $('#mapQ') && ($('#mapQ').oninput = e => { const k = e.target.value.trim().toLowerCase(); $$('.map-list [data-q]').forEach(el => el.hidden = !!k && !el.dataset.q.includes(k)); });
  $$('[data-pin]').forEach(b => b.onclick = e => {
    e.stopPropagation(); const no = b.dataset.pin;
    if (S.mapEdit && isAdmin()) { S.mapPick = S.mapPick === no ? null : no; return render(); }
    const k = pinSt(M(no));
    if (k === 'todo') return ckForm(no);
    if (k === 'ok' || k === 'ng') return ckView(ckToday(no).id);
    openScan(no);
  });
  const cv = $('#mapCv');
  if (cv) cv.onclick = e => {
    if (!(S.mapEdit && isAdmin() && S.mapPick) || e.target.closest('[data-pin]')) return;
    const img = cv.querySelector('.map-img'); if (!img) return toast('อัปโหลดรูปผังก่อน');
    const r = img.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    placePin(S.mapPick, S.mapPlan, x, y);
  };
}

// เมนู ⋯ ของหน้า PM / CAL (ทุกมุมมอง): Export แผนรูปแบบเดิม + นำเข้าแผน
const calMenu = () => { const y = new Date().getFullYear(); return moreMenu([`<button class="mi" data-planx="${y}">Export แผน ${y} (รูปแบบเดิม)</button>`, `<button class="mi" data-planx="${y + 1}">Export แผน ${y + 1} (รูปแบบเดิม)</button>`, isAdmin() && D.pmAuto != null ? `<button class="mi" id="pmAutoT">${D.pmAuto ? 'ปิดการเปิดใบงานอัตโนมัติ' : 'เปิดการเปิดใบงานอัตโนมัติ'}</button>` : '', isAdmin() ? '<button class="mi" id="pfForm">แบบฟอร์มกรอกวันที่ PM / CAL (Excel)</button>' : '', isAdmin() ? '<label class="mi" for="mImport">นำเข้า Excel (แบบฟอร์มกรอกวันที่ / แผนเดิม)</label><input id="mImport" type="file" accept=".xlsx,.xls" hidden>' : '']); };
/* ---------- สวิตช์เปิดใบงาน PM / CAL อัตโนมัติ + เปิดใบงานเอง ---------- */
const canOpenPm = m => D.pmAuto != null && (isAdmin() || role() === 'foreman_day' || m.responsibility === S.me.email);
async function openPmJob(no, kind) {
  try {
    const { data, error } = await sb.rpc('open_pmcal_job', { p_machine: no, p_kind: kind }); if (error) throw error;
    toast(`เปิดใบงาน ${kind} ${no} แล้ว`); await loadAll(); if (data) openDetail(data); else render();
  } catch (e) { fail(e); }
}
function pmAutoToggle() {
  const on = D.pmAuto, auto = D.requests.filter(q => q.job_type === 'pmcal' && q.reporter === 'system' && q.status === 'quotation' && !q.action_at && !(q.quotes || []).length);
  modal(`<div class="h-row" style="margin:0 0 4px"><h2 style="margin:0;flex:1">${on ? 'ปิดการเปิดใบงาน PM / CAL อัตโนมัติ' : 'เปิดการเปิดใบงาน PM / CAL อัตโนมัติ'}</h2><button class="btn ghost" data-close>ยกเลิก</button></div>
    ${on ? `<ul class="sub" style="padding-left:18px;line-height:1.7">
      <li>ระบบจะไม่สร้างใบงาน PM / CAL เอง ทั้งตอนเปิดเว็บ นำเข้า Excel และสรุปตอน 08:00</li>
      <li>หน้า PM / CAL ยังแสดงแผนและวันครบกำหนดตามเดิม · ผู้รับผิดชอบ / Foreman Day / Admin กด <b>เปิดใบงาน</b> ทีละแผนเมื่อพร้อม</li>
      <li>การเตือน 3 ขั้น (90 / 60 / 30 วัน) และ “PM / CAL ที่ต้องเริ่มดำเนินการ” ในหน้าหลัก ทำงานเฉพาะแผนที่เปิดใบงานแล้ว</li></ul>
      ${auto.length ? `<label class="pm-del"><input type="checkbox" id="pmDelAuto"> ลบใบงานที่ระบบเปิดไว้และยังไม่เริ่มดำเนินการ (${auto.length} ใบ)</label><p class="sub" style="margin:4px 0 0">${auto.slice(0, 8).map(q => esc(q.id + ' ' + q.machine_no + ' ' + q.pmcal_kind)).join(' · ')}${auto.length > 8 ? ' …' : ''}</p>` : ''}`
      : '<p class="sub">ระบบจะเปิดใบงาน PM / CAL ให้เองเมื่อเหลือ 90 วันก่อนครบกำหนด และส่งแจ้งเตือน 3 ขั้น (เปิดใบงานที่ถึงเกณฑ์ให้ทันที)</p>'}
    <div class="btns" style="margin-top:12px"><button class="btn" id="pmAutoGo">${on ? 'ปิดอัตโนมัติ' : 'เปิดอัตโนมัติ'}</button></div>`);
  $('#pmAutoGo').onclick = async () => {
    $('#pmAutoGo').disabled = true;
    try {
      const { error } = await sb.rpc('set_pmcal_auto', { p_on: !on }); if (error) throw error;
      let del = 0;
      if (on && $('#pmDelAuto')?.checked) for (const q of auto) { const r = await sb.from('requests').delete().eq('id', q.id); if (r.error) throw r.error; del++; }
      let made = 0; if (!on) { const r = await sb.rpc('ensure_pmcal_jobs'); made = r.data || 0; }
      closeModal(); toast(on ? `ปิดการเปิดใบงานอัตโนมัติแล้ว${del ? ` · ลบใบงาน ${del} ใบ` : ''}` : `เปิดอัตโนมัติแล้ว${made ? ` · เปิดใบงาน ${made} ใบ` : ''}`); reload();
    } catch (e) { $('#pmAutoGo').disabled = false; fail(e); }
  };
}

/* ---------- PM / CAL Tag: สติกเกอร์ 7 × 4 ซม. ---------- */
const dmy = d => d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}/${String(d).slice(0, 4)}` : '';
const TAG_DOC = { PM: '', CAL: 'CP-F-064' };
const calRanges = () => { try { return JSON.parse(localStorage.getItem('capd-cal-range') || '{}'); } catch (e) { return {}; } };
// ค่าเริ่มต้นของ Tag จากข้อมูลเครื่อง + ใบงาน PM/CAL ที่ปิดล่าสุด (แก้ได้ก่อนพิมพ์)
function tagData(m, kind, q) {
  const last = kind === 'PM' ? m.pm_last_date : m.cal_last_date, iv = kind === 'PM' ? m.pm_interval_month : m.cal_interval_month;
  q = q || D.requests.filter(x => x.job_type === 'pmcal' && x.machine_no === m.machine_no && x.pmcal_kind === kind && x.status === 'closed').sort((a, b) => String(b.end_at).localeCompare(String(a.end_at)))[0];
  const date = (q?.end_at ? String(q.end_at).slice(0, 10) : '') || last || todayIso();
  return { no: m.machine_no, name: m.machine_name || '', kind, iv: iv || '', date, by: q ? (q.vendor || nm(q.closed_by)) : '', resp: m.responsibility ? nm(m.responsibility).split(' ')[0] : '', appr: q?.approved_by ? nm(q.approved_by) : '', range: calRanges()[m.machine_no] || '' };
}
function tagHtml(t) {
  const due = t.date && t.iv ? addMonths(t.date, t.iv) : '';
  const f = (k, v, cls = '') => `<div class="tg-f ${cls}"><span>${k}</span><b>${esc(v || '')}</b></div>`;
  const pm = t.kind === 'PM';
  return `<div class="tag"><div class="tg-head"><b>${pm ? 'PM TAG' : 'CALIBRATION TAG'}</b><small>${esc(C.APP_NAME || 'CAPD')}</small></div>
    <div class="tg-body"><div class="tg-l">${f('ID No.', t.no, 'tgm big')}${f('Equipment', t.name)}
      <div class="tg-2">${pm ? f('Interval', t.iv ? t.iv + ' เดือน' : '') : f('Cal. Range', t.range)}${f(pm ? 'PM by' : 'Cal. by', t.by)}</div>
      <div class="tg-2">${f(pm ? 'PM Date' : 'Cal. Date', dmy(t.date), 'tgm')}${f('Responsible', t.resp)}</div>
      <div class="tg-2">${f('Due Date', dmy(due), 'tgm due')}${pm ? f('Approved', t.appr) : `<div class="tg-f"><span></span><small class="tg-doc">${TAG_DOC.CAL}</small></div>`}</div></div>
    <div class="tg-qr">${typeof qrcode === 'function' ? qrSvg(scanUrl(t.no)) : ''}<small>สแกนดูเครื่อง</small></div></div></div>`;
}
// items: [{ m, kind, q? }]
function printTags(items) {
  items = items.filter(x => x.m && x.m.machine_no);
  if (!items.length) return toast('เครื่องนี้ยังไม่มีแผน PM / CAL');
  const T = items.map(x => tagData(x.m, x.kind, x.q));
  let paper = (() => { try { return localStorage.getItem('capd-tag-paper') || 'roll'; } catch (e) { return 'roll'; } })();
  const inp = (i, k, label, type = 'text') => `<label>${label}<input type="${type}" data-tg="${i}" data-k="${k}" value="${esc(T[i][k])}"></label>`;
  modal(`<div class="noprint tag-ui"><div class="h-row" style="margin:0 0 8px"><h2 style="margin:0;flex:1">พิมพ์ Tag PM / CAL (${T.length})</h2><button class="btn" id="tgPrint">พิมพ์</button><button class="btn ghost" data-close>ปิด</button></div>
      <div class="seg" role="group" aria-label="กระดาษ"><button data-paper="roll">สติกเกอร์ม้วน 7 × 4 ซม.</button><button data-paper="a4">กระดาษ A4 (ตัดเอง)</button></div>
      <p class="sub" id="tgHint"></p>
      ${T.map((t, i) => `<details class="tg-edit" ${T.length === 1 ? 'open' : ''}><summary><b>${t.kind}</b> ${esc(t.no)} <span class="sub">${esc(t.name)}</span></summary><div class="fgrid">
        ${inp(i, 'date', t.kind === 'PM' ? 'PM Date (วันที่ทำ)' : 'Cal. Date (วันที่สอบเทียบ)', 'date')}${inp(i, 'iv', 'Interval (เดือน)', 'number')}
        ${inp(i, 'by', t.kind === 'PM' ? 'PM by (ผู้ทำ / Vendor)' : 'Cal. by (ผู้สอบเทียบ / Vendor)')}${inp(i, 'resp', 'Responsible by')}
        ${t.kind === 'PM' ? inp(i, 'appr', 'Approved by') : inp(i, 'range', 'Cal. Range (เช่น 0–50 kN)')}</div></details>`).join('')}</div>
    <div class="tag-sheet" id="tgSheet"></div>`, 'tag-modal');
  const draw = () => {
    $('#tgSheet').innerHTML = T.map(tagHtml).join('');
    $('#tgSheet').className = 'tag-sheet paper-' + paper;
    $$('[data-paper]').forEach(b => b.classList.toggle('on', b.dataset.paper === paper));
    $('#tgHint').textContent = paper === 'roll' ? 'ตั้งขนาดกระดาษในไดรเวอร์เครื่องพิมพ์สติกเกอร์เป็น 70 × 40 มม. · ระยะขอบ “ไม่มี” · สเกล 100% · 1 Tag ต่อ 1 ดวง' : 'พิมพ์ลง A4 ได้ 14 ดวงต่อแผ่น (2 × 7) แล้วตัดตามเส้น';
  };
  let style = document.getElementById('tgPage'); if (!style) { style = document.createElement('style'); style.id = 'tgPage'; document.head.appendChild(style); }
  const page = () => { style.textContent = paper === 'roll' ? '@media print{@page{size:70mm 40mm;margin:0}}' : '@media print{@page{size:A4;margin:8mm}}'; };
  $$('[data-paper]').forEach(b => b.onclick = () => { paper = b.dataset.paper; try { localStorage.setItem('capd-tag-paper', paper); } catch (e) {} page(); draw(); });
  $$('[data-tg]').forEach(el => el.oninput = () => {
    const t = T[el.dataset.tg]; t[el.dataset.k] = el.value;
    if (el.dataset.k === 'range') { try { const r = calRanges(); r[t.no] = el.value; localStorage.setItem('capd-cal-range', JSON.stringify(r)); } catch (e) {} }
    draw();
  });
  page(); draw();
  document.body.classList.add('printing-tag');
  const bg = $('#modal'); const obs = new MutationObserver(() => { if (!document.body.contains(bg)) { document.body.classList.remove('printing-tag'); style.textContent = ''; obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
  $('#tgPrint').onclick = () => window.print();
}
const tagsFor = m => [['PM', m.pm_interval_month], ['CAL', m.cal_interval_month]].filter(x => x[1]).map(([kind]) => ({ m, kind }));

/* ---------- machines: form + import ---------- */
const MF = [
  ['machine_no', 'Machine number *', 'text'], ['machine_name', 'Machine Name *', 'text'], ['model', 'Model', 'text'], ['serial_number', 'Serial Number', 'text'],
  ['machine_type', 'Machine Type', OPT.type], ['location', 'Location', OPT.loc], ['status', 'Status', OPT.mstatus], ['priority', 'Priority', OPT.prio],
  ['maintenance_type', 'Maintenance Type', OPT.mtype], ['responsibility', 'Member ผู้รับผิดชอบ (อีเมล)', 'email'], ['eng_foreman', 'Eng, Foreman (อีเมล · ว่าง = ตามประเภทเครื่อง)', 'email'],
  ['supplier', 'Vendor', 'text'], ['contact_person', 'Contact Person', 'text'], ['phone', 'เบอร์โทรศัพท์', 'text'], ['email', 'E-mail Vendor', 'text'], ['other_contact', 'Line / ช่องทางอื่น', 'text'],
  ['pm_last_date', 'PM ล่าสุด', 'date'], ['pm_interval_month', 'PM Interval (เดือน)', OPT.interval], ['cal_last_date', 'CAL ล่าสุด', 'date'], ['cal_interval_month', 'CAL Interval (เดือน)', OPT.interval],
  ['parent_machine', 'เป็นอุปกรณ์ของเครื่อง (ถ้ามี)', 'parent']
];
const mfFields = () => MF.filter(([k]) => k !== 'parent_machine' || D.hasParts);
function machineForm(no) {
  const m = no ? M(no) : { status: 'Active', priority: 'Normal', maintenance_type: 'No Plan' };
  const field = ([k, l, t]) => `<div class="field"><label for="mf-${k}">${l}</label>${t === 'parent'
    ? `<select id="mf-${k}" class="inp"><option value="">— ไม่ใช่ (เป็นเครื่องหลัก) —</option>${D.machines.filter(x => x.machine_no !== no && !x.parent_machine).map(x => `<option value="${esc(x.machine_no)}" ${m.parent_machine === x.machine_no ? 'selected' : ''}>${esc(x.machine_no)} · ${esc(x.machine_name)}</option>`).join('')}</select>`
    : Array.isArray(t)
    ? `<select id="mf-${k}" class="inp"><option value=""></option>${opts(t, m[k])}</select>`
    : `<input id="mf-${k}" class="inp" type="${t}" value="${esc(m[k] ?? '')}" ${k === 'machine_no' && no ? 'readonly' : ''}>`}</div>`;
  modal(`<h2>${no ? 'แก้ไขเครื่อง ' + esc(no) : 'เพิ่มเครื่องจักร'}</h2><form id="fMachine" class="form">${mfFields().map(field).join('')}
    <div class="full btns"><button class="btn" type="submit">บันทึก</button><button class="btn ghost" type="button" data-close>ยกเลิก</button>${no ? '<button class="btn bad" type="button" id="mDel">ลบเครื่อง</button>' : ''}</div></form>`);
  $('#fMachine').onsubmit = async e => {
    e.preventDefault();
    const row = {}; mfFields().forEach(([k]) => { const val = $('#mf-' + k).value.trim(); row[k] = val === '' ? null : val; });
    if (row.parent_machine && kidsOf(row.machine_no).length) return toast('เครื่องนี้มีอุปกรณ์ประกอบอยู่แล้ว จึงเป็นอุปกรณ์ของเครื่องอื่นไม่ได้');
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
const ROLE_IN = { 'member': 'member', 'foreman shift': 'foreman_shift', 'foreman day': 'foreman_day', 'manager': 'manager', 'admin': 'admin', 'operator': 'operator', 'ผู้ใช้เครื่อง': 'operator' };
const yes = v => /^(y|yes|ใช่|✓|true|1)$/i.test(String(v ?? '').trim());
function parseUsers(rows, g) {
  const out = [], bad = [];
  for (const r of rows || []) {
    const em = String(g(r, 'อีเมล', 'email', 'e-mail') || '').trim().toLowerCase(); if (!em) continue;
    const ro = ROLE_IN[String(g(r, 'บทบาท', 'role') || 'member').trim().toLowerCase()] || ROLE_IN[String(g(r, 'บทบาท', 'role')).replace(/_/g, ' ').toLowerCase()];
    if (!domainOk(em) || !ro) { bad.push(em); continue; }
    const ft = String(g(r, 'foreman day ดูแลประเภท', 'fd_type') || '').trim();
    const sh = g(r, 'ชื่อย่อ (ใน excel เดิม)', 'ชื่อย่อ', 'short name', 'initials');
    out.push({ email: em, full_name: g(r, 'ชื่อที่แสดง', 'ชื่อ', 'name') || null, ...(hasShort() && sh ? { short_name: String(sh).trim() } : {}), role: ro, fd_type: ro === 'foreman_day' && OPT.fdType.includes(ft) ? ft : null,
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
    { const seen = {}; for (const u of out) for (const a of aliases(u.short_name)) { if (seen[a] && seen[a] !== u.email) return toast(`ชื่อย่อ ${a} ซ้ำกัน: ${seen[a]} และ ${u.email} แก้ในไฟล์แล้วนำเข้าใหม่`); seen[a] = u.email; } }
    const merged = D.profiles.map(x => out.find(u => u.email === x.email) || x).concat(out.filter(u => !D.profiles.some(x => x.email === u.email)));
    if (!merged.some(x => x.email === S.me.email && (x.role === 'admin' || x.is_admin))) return toast('ไฟล์นี้จะนำสิทธิ์ Admin ของคุณออก ให้ใส่ Y ในคอลัมน์สิทธิ์ Admin ของตัวเองก่อน');
    const { error } = await sb.from('app_users').upsert(out);
    if (error) throw error;
    toast(`นำเข้าผู้ใช้ ${out.length} คน` + (bad.length ? ` · ข้าม ${bad.length} แถว (อีเมล/บทบาทไม่ถูกต้อง: ${bad.slice(0, 3).join(', ')})` : ''));
    reload();
  } catch (e) { fail(e); }
}
/* ---------- แผน PM / CAL รูปแบบเดิม (ชีท LAB EQUIP.PLAN): นำเข้า + Export ---------- */
const PLAN_SHEET = 'LAB EQUIP.PLAN';
const MON3 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const isGreen = c => { const h = c?.s?.fgColor?.rgb; if (!h || h.length < 6) return false; const x = h.slice(-6), r = parseInt(x.slice(0, 2), 16), g = parseInt(x.slice(2, 4), 16), b = parseInt(x.slice(4, 6), 16); return g > 120 && g > r + 40 && g > b + 40; };
// "1 ปี" "1ปี" "2 เดือน" "4ครั้ง/1 ปี" → เดือน · "ไม่มีการ Cal." → null
function planIv(v) {
  const t = String(v ?? '').replace(/\s+/g, '');
  if (!t || /ไม่มี/.test(t)) return null;
  let m = t.match(/^(\d+)ครั้ง\/(\d*)ปี/); if (m) return Math.max(1, Math.round(12 * (Number(m[2]) || 1) / Number(m[1])));
  m = t.match(/^(\d+(?:\.\d+)?)(ปี|year|yr|y)/i); if (m) return Math.round(Number(m[1]) * 12);
  m = t.match(/^(\d+)(เดือน|month|m)/i); if (m) return Number(m[1]);
  return null;
}
// วันที่ในช่องเดือน: Date จริง · "PM5/3/26" · "29-30/1/25" · "PM14.11.26" · "Pm 1/9/2027" (วัน/เดือน/ปี)
function planDate(v) {
  if (v instanceof Date) return xDate(v);
  const m = String(v ?? '').match(/(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{2,4})/);
  if (!m) return null;
  let d = Number(m[2] || m[1]), mo = Number(m[3]), y = Number(m[4]); if (y < 100) y += 2000; if (y > 2400) y -= 543;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}
const PHONE_RE = /0\d{1,2}[-\s]?\d{3}[-\s]?\d{3,4}/;
function parsePlanSheet(ws) {
  const R = XLSX.utils.decode_range(ws['!ref']), cell = (r, c) => ws[XLSX.utils.encode_cell({ r, c })];
  const val = (r, c) => { const x = cell(r, c); if (!x || x.v == null) return null; return typeof x.v === 'string' ? x.v.replace(/\s+/g, ' ').trim() || null : x.v; };
  let hr = -1; const col = {};
  for (let r = R.s.r; r <= Math.min(R.e.r, 30) && hr < 0; r++) for (let c = R.s.c; c <= Math.min(R.e.c, 40); c++) if (/^machine\s*number$/i.test(String(val(r, c) || ''))) { hr = r; break; }
  if (hr < 0) return null;
  for (let c = R.s.c; c <= R.e.c; c++) {
    const h = String(val(hr, c) || '').toLowerCase().replace(/\s+/g, ' ');
    if (!h) continue;
    const k = /^machine/.test(h) ? 'no' : /^desc/.test(h) ? 'name' : /^sp.?art|spare/.test(h) ? 'spare' : /^supplier|^vendor/.test(h) ? 'supplier' : /^respons/.test(h) ? 'resp' : /^eng/.test(h) ? 'eng' : /^contact/.test(h) ? 'contact' : /^activity/.test(h) ? 'act' : /period|interval/.test(h) ? 'iv' : MON3.includes(h.slice(0, 3)) && h.length <= 9 ? 'm' + MON3.indexOf(h.slice(0, 3)) : null;
    if (k && col[k] == null) col[k] = c;
  }
  if (col.act == null || col.m0 == null) return null;
  // ค่าในเซลล์ที่รวม (merge) อยู่มุมซ้ายบน → กระจายให้ทุกแถวในช่วงนั้น
  const mergedVal = {}; (ws['!merges'] || []).forEach(m => { for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) mergedVal[r + ':' + c] = val(m.s.r, m.s.c); });
  const V = (r, c) => c == null ? null : (val(r, c) ?? mergedVal[r + ':' + c] ?? null);
  const years = {}; const cells = [];
  const out = new Map(), notes = [], skipped = [];
  let cur = null;
  for (let r = hr + 1; r <= R.e.r; r++) {
    const a = val(r, col.no);
    if (a != null) {
      const id = String(a).trim();
      if (/^[A-Za-z]{1,6}[-_ ]?\d[\w\-./]*$/.test(id) && id.length <= 30) {
        cur = out.get(id) || { no: id, row: r + 1, name: '', supplier: null, resp: null, eng: null, contact: null, phone: null, spare: null, inactive: false, kinds: {}, other: [] };
        const name = String(V(r, col.name) || '').trim();
        cur.inactive = /ยกเลิก|ขายซาก/.test(name);
        cur.name = name.replace(/\s*ยกเลิก(ใช้งาน|ใช้)?\s*$/, '').trim() || id;
        cur.supplier = V(r, col.supplier) && String(V(r, col.supplier)).trim();
        cur.resp = V(r, col.resp) && String(V(r, col.resp)).trim();
        cur.eng = V(r, col.eng) && String(V(r, col.eng)).trim();
        const ct = String(V(r, col.contact) || ''); const ph = ct.match(PHONE_RE);
        cur.phone = ph ? ph[0].replace(/\s/g, '') : null; cur.contact = ct.replace(PHONE_RE, '').replace(/[\s,]+$/, '').trim() || null;
        cur.spare = V(r, col.spare);
        out.set(id, cur);
      } else if (!mergedVal[r + ':' + col.no] || mergedVal[r + ':' + col.no] === a) { notes.push({ row: r + 1, text: String(a).trim() }); cur = null; continue; }
    }
    if (!cur) continue;
    const actRaw = String(val(r, col.act) || '').trim(); if (!actRaw) continue;
    const up = actRaw.toUpperCase().replace(/\s+/g, ' ');
    const kinds = /^LOAD/.test(up) ? ['LOAD'] : /^PM\s*[,/&]\s*CAL$/.test(up) ? ['PM', 'CAL'] : up === 'PM' ? ['PM'] : up === 'CAL' ? ['CAL'] : [];
    const ivRaw = val(r, col.iv), iv = planIv(ivRaw);
    const mcells = [];
    for (let k = 0; k < 12; k++) {
      const c = col['m' + k]; if (c == null) continue;
      const x = cell(r, c); const v = x && x.v != null && x.v !== '' ? x.v : null;
      if (v == null && !isGreen(x)) continue;
      const d = planDate(v), green = isGreen(x);
      if (d) years[d.slice(0, 4)] = (years[d.slice(0, 4)] || 0) + 1;
      if (typeof v === 'string' && /ยกเลิก|ขายซาก|รอสั่งซื้อเครื่องใหม่/.test(v)) cur.inactive = true;
      mcells.push({ month: k, raw: v == null ? '' : v instanceof Date ? xDate(v) : String(v).trim(), date: d, green });
    }
    if (!kinds.length) { cur.other.push({ act: actRaw, iv: ivRaw }); skipped.push({ no: cur.no, act: actRaw }); continue; }
    kinds.forEach(kind => { cur.kinds[kind] = { kind, ivRaw, iv, cells: mcells }; cells.push(cur.kinds[kind]); });
  }
  const year = Number(Object.entries(years).sort((a, b) => b[1] - a[1])[0]?.[0]) || new Date().getFullYear();
  const today = todayIso();
  // วันที่ทำล่าสุด: ช่องสีเขียวที่มีวันที่ (มั่นใจ) > ช่องสีเขียวไม่มีวันที่ = วันที่ 1 ของเดือนนั้น (ต้องตรวจ) > วันที่ในอดีตที่ไม่ได้ทำสีเขียว (ต้องตรวจ)
  for (const k of cells) {
    const g = k.cells.filter(c => c.green && c.date && c.date <= today).map(c => c.date).sort();
    const gm = k.cells.filter(c => c.green && !c.date).map(c => `${year}-${pad(c.month + 1)}-01`).filter(d => d <= today).sort();
    const past = k.cells.filter(c => !c.green && c.date && c.date <= today).map(c => c.date).sort();
    k.last = g.at(-1) || null; k.how = k.last ? 'green' : null;
    if (gm.length && (!k.last || gm.at(-1) > k.last)) { k.last = gm.at(-1); k.how = 'month'; }
    if (!k.last && past.length) { k.last = past.at(-1); k.how = 'past'; }
    k.odd = k.cells.some(c => c.date && Number(c.date.slice(5, 7)) !== c.month + 1);
  }
  return { list: [...out.values()], notes, skipped, year, header: hr + 1 };
}
const planMap = () => { try { return JSON.parse(localStorage.getItem('capd-plan-initials') || '{}'); } catch (e) { return {}; } };
function planReview(P, fileName) {
  const map = planMap(), users = D.profiles.filter(p => p.active !== false);
  const initials = [...new Set(P.list.map(m => m.resp).filter(Boolean).map(x => x.toUpperCase()))].sort();
  const autoUser = ini => byShort(ini) || map[ini] || users.find(u => (u.full_name || '').toUpperCase() === ini || u.email.split('@')[0].toUpperCase() === ini)?.email || '';
  const pick = {}; initials.forEach(i => pick[i] = autoUser(i));
  const has = P.list.filter(m => Object.keys(m.kinds).length);
  const sel = new Set(has.map(m => m.no));
  const flag = k => !k ? '' : !k.iv ? '<span class="pill s-done">ไม่มีรอบ</span>' : !k.last ? '<span class="pill s-wait">ไม่มีวันที่ทำ</span>' : k.how === 'green' ? '' : `<span class="pill s-wait" title="${k.how === 'month' ? 'ช่องสีเขียวไม่มีวันที่ ใช้วันที่ 1 ของเดือน' : 'วันที่ในอดีตที่ไม่ได้ทำสีเขียว'}">ตรวจวันที่</span>`;
  const kcell = (m, kind) => { const k = m.kinds[kind]; if (!k) return '<span class="sub">-</span>'; return `<span class="sub">${esc(k.ivRaw || '-')}</span>${k.iv ? ` <b>${k.iv} ด.</b>` : ''}<br><input type="date" class="pl-d" data-no="${esc(m.no)}" data-kind="${kind}" value="${k.last || ''}" ${k.iv ? '' : 'disabled'}> ${flag(k)}${k.odd ? ' <span class="pill s-rej" title="วันที่ในช่องไม่ตรงกับคอลัมน์เดือน">เดือนไม่ตรง</span>' : ''}`; };
  const exists = no => D.machines.some(x => x.machine_no === no);
  const ks = has.flatMap(m => Object.values(m.kinds)).filter(k => k.iv), cnt = { ok: ks.filter(k => k.last && k.how === 'green').length, chk: ks.filter(k => k.last && k.how !== 'green').length, none: ks.filter(k => !k.last).length };
  modal(`<div class="h-row" style="margin:0 0 6px"><h2 style="margin:0;flex:1">นำเข้าแผน PM / CAL รูปแบบเดิม</h2><button class="btn ghost" data-close>ยกเลิก</button></div>
    <p class="sub" style="margin-top:0">${esc(fileName)} · ชีท ${PLAN_SHEET} · แผนปี ${P.year} · ระบบอ่าน “วันที่ทำล่าสุด” จากช่อง<b style="color:#2e9b4f">สีเขียว</b> (Complete) แก้วันที่ได้ก่อนบันทึก</p>
    <div class="pl-sum"><div><b>${has.length}</b><span>เครื่องที่มี PM / CAL</span></div><div><b>${cnt.ok}</b><span>แผนที่มีวันที่ทำ (ช่องเขียว)</span></div><div class="w"><b>${cnt.chk}</b><span>ควรตรวจวันที่</span></div><div class="x"><b>${cnt.none}</b><span>ยังไม่มีวันที่ทำ</span></div></div>
    ${cnt.none ? `<p class="sub" style="margin:0 0 6px">แผนที่ยังไม่มีวันที่ทำ: นำเข้ารอบ (Interval) ไว้ก่อน แล้วกรอกวันที่ในตารางนี้ หรือกด “ทำแล้ววันนี้” ในหน้า PM / CAL ภายหลัง ระบบจึงจะคำนวณวันครบกำหนดได้</p>` : ''}
    ${initials.length ? `<details class="pl-box" open><summary><b>ผู้รับผิดชอบ (Responsibility)</b> · จับคู่จากช่อง “ชื่อย่อ” ในหน้าผู้ใช้แล้ว ${initials.filter(i => byShort(i)).length} / ${initials.length} · ที่เหลือเลือกเองได้</summary>${hasShort() ? '<p class="sub" style="margin:6px 0 0">อักษรย่อที่เลือกเองจะบันทึกเป็น “ชื่อย่อ” ของผู้ใช้คนนั้นให้ (ถ้ายังไม่มี) ครั้งหน้าจับคู่อัตโนมัติ · หน้าเว็บแสดงชื่อจริง</p>' : ''}<div class="pl-ini">${initials.map(i => `<label class="${byShort(i) ? 'auto' : ''}"><b>${esc(i)}</b><select data-ini="${esc(i)}"><option value="">— ไม่ระบุ —</option>${users.map(u => `<option value="${esc(u.email)}" ${pick[i] === u.email ? 'selected' : ''}>${esc(nm(u.email))}</option>`).join('')}</select></label>`).join('')}</div></details>` : ''}
    <div class="pl-opt"><label>ประเภทเครื่อง (เฉพาะเครื่องใหม่)<select id="plType">${OPT.type.map(t => `<option ${t === 'เครื่องทดสอบ' ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label>Location (เฉพาะเครื่องใหม่)<select id="plLoc"><option value="">— ไม่ระบุ —</option>${OPT.loc.map(t => `<option>${esc(t)}</option>`).join('')}</select></label></div>
    <div class="tbl-wrap pl-tbl"><table><thead><tr><th><input type="checkbox" id="plAll" checked aria-label="เลือกทั้งหมด"></th><th>Machine</th><th>PM</th><th>CAL</th><th>Vendor / ผู้รับผิดชอบ</th></tr></thead><tbody>
      ${has.map(m => `<tr><td><input type="checkbox" class="pl-on" data-no="${esc(m.no)}" checked></td><td><b class="mono">${esc(m.no)}</b> ${exists(m.no) ? '<span class="pill s-confirm">มีแล้ว · อัปเดต</span>' : '<span class="pill s-queue">ใหม่</span>'}${m.inactive ? ' <span class="pill s-done">Inactive</span>' : ''}<br><span class="sub">${esc(m.name)}</span></td><td>${kcell(m, 'PM')}</td><td>${kcell(m, 'CAL')}</td><td>${esc(m.supplier || '-')}<br><span class="sub">${esc(m.resp || '')}${m.other.length ? ' · ข้าม: ' + esc(m.other.map(o => o.act).join(', ')) : ''}</span></td></tr>`).join('')}</tbody></table></div>
    ${P.notes.length || P.skipped.length ? `<details class="pl-box"><summary>แถวที่ไม่นำเข้า (${P.notes.length + P.skipped.length})</summary><ul class="pl-skip">${P.notes.map(n => `<li>แถว ${n.row}: บันทึก “${esc(n.text.slice(0, 80))}”</li>`).join('')}${P.skipped.map(x => `<li>${esc(x.no)}: ${esc(x.act)} (ระบบรองรับ PM / CAL)</li>`).join('')}</ul></details>` : ''}
    <div class="btns" style="margin-top:12px"><button class="btn" id="plGo">นำเข้า <span id="plN">${sel.size}</span> เครื่อง</button><span class="sub">เครื่องที่มีอยู่แล้ว: อัปเดตเฉพาะช่องที่ไฟล์มีข้อมูล และไม่ย้อนวันที่ทำล่าสุดให้เก่ากว่าในระบบ</span></div>`, 'wide');
  const n = () => { $('#plN').textContent = sel.size; };
  $$('.pl-on').forEach(c => c.onchange = () => { c.checked ? sel.add(c.dataset.no) : sel.delete(c.dataset.no); n(); });
  $('#plAll').onchange = e => { $$('.pl-on').forEach(c => { c.checked = e.target.checked; c.onchange(); }); };
  $$('[data-ini]').forEach(s2 => s2.onchange = () => { pick[s2.dataset.ini] = s2.value; });
  $$('.pl-d').forEach(d => d.onchange = () => { const k = P.list.find(m => m.no === d.dataset.no).kinds[d.dataset.kind]; k.last = d.value || null; k.how = 'green'; });
  $('#plGo').onclick = async () => {
    const go = $('#plGo'); go.disabled = true;
    try {
      try { localStorage.setItem('capd-plan-initials', JSON.stringify({ ...map, ...pick })); } catch (e) {}
      if (hasShort()) for (const [ini, em] of Object.entries(pick)) { if (!em || byShort(ini)) continue; const u = D.profiles.find(x => x.email === em); if (u && !u.short_name) { const { error } = await sb.from('app_users').update({ short_name: ini }).eq('email', em); if (!error) u.short_name = ini; } }
      const type = $('#plType').value, loc = $('#plLoc').value || null, now = new Date().toISOString();
      const rows = has.filter(m => sel.has(m.no)).map(m => {
        const old = D.machines.find(x => x.machine_no === m.no), pm = m.kinds.PM, cal = m.kinds.CAL;
        const later = (a, b) => !a ? b || null : !b ? a : a > b ? a : b;
        const row = { machine_no: m.no, machine_name: m.name, updated_at: now,
          supplier: m.supplier || old?.supplier || null, contact_person: m.contact || old?.contact_person || null, phone: m.phone || old?.phone || null,
          responsibility: pick[(m.resp || '').toUpperCase()] || old?.responsibility || null,
          status: m.inactive ? 'Inactive' : old?.status || 'Active',
          maintenance_type: pm?.iv && cal?.iv ? 'PM & CAL' : pm?.iv ? 'PM' : cal?.iv ? 'CAL' : old?.maintenance_type || 'No Plan',
          pm_interval_month: pm?.iv || old?.pm_interval_month || null, pm_last_date: later(old?.pm_last_date, pm?.iv ? pm.last : null),
          cal_interval_month: cal?.iv || old?.cal_interval_month || null, cal_last_date: later(old?.cal_last_date, cal?.iv ? cal.last : null) };
        // คอลัมน์ Eng,Foreman ในไฟล์เดิมไม่นำเข้า · เครื่องใหม่ใช้ Foreman Day ตามประเภทเครื่อง
        if (!old) Object.assign(row, { machine_type: type, location: loc, priority: 'Normal', eng_foreman: fdOfType(type === 'เครื่องทดสอบ' ? 'เครื่องทดสอบ' : 'เครื่องจักร') });
        return row;
      });
      const groups = {}; rows.forEach(r => { const k = Object.keys(r).sort().join(','); (groups[k] ||= []).push(r); });
      for (const g2 of Object.values(groups)) { const { error } = await sb.from('machines').upsert(g2); if (error) throw error; }
      let created = 0; try { const { data } = await sb.rpc('ensure_pmcal_jobs'); created = data || 0; } catch (e) {}
      closeModal(); toast(`นำเข้าแผน PM / CAL ${rows.length} เครื่อง` + (created ? ` · เปิดใบงาน PM/CAL ใหม่ ${created}` : '')); reload();
    } catch (e) { go.disabled = false; fail(e); }
  };
}
// Export แผน 12 เดือน หน้าตาเหมือนไฟล์เดิม: เหลือง = แผน · เขียว = ทำแล้ว (วันที่) · ต้องใช้ ExcelJS (โหลดเมื่อกด)
const loadJs = src => new Promise((ok, no) => { if ([...document.scripts].some(s2 => s2.src === src)) return ok(); const el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = () => no(new Error('โหลดตัวสร้าง Excel ไม่สำเร็จ')); document.head.appendChild(el); });
async function exportPlan(year) {
  try {
    if (typeof ExcelJS === 'undefined') await loadJs('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js');
    year = year || new Date().getFullYear();
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet(PLAN_SHEET, { views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }] });
    const Y = 'FFFFFF00', G = 'FF92D050', fill = c => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: c } });
    const thin = { style: 'thin', color: { argb: 'FF999999' } }, border = { top: thin, left: thin, bottom: thin, right: thin };
    ws.getCell('A1').value = 'Plan'; ws.getCell('A1').fill = fill(Y); ws.getCell('A2').value = 'Complete'; ws.getCell('A2').fill = fill(G);
    ws.getCell('C1').value = `PM / CAL Plan ${year}`; ws.getCell('C1').font = { bold: true, size: 14 };
    ws.getCell('C2').value = `${C.APP_NAME} · Export ${dmy(todayIso())}`; ws.getCell('C2').font = { size: 9, color: { argb: 'FF666666' } };
    const head = ['Machine number', 'Description', 'Location', 'Supplier', 'Responsibility', 'Eng,Foreman', 'Contact\nPerson', 'Activity', 'PM\nPeriod', ...['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']];
    const hr = ws.getRow(4); head.forEach((h, i) => { const c = hr.getCell(i + 1); c.value = h; c.font = { bold: true }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.fill = fill('FFD9E1F2'); c.border = border; }); hr.height = 30;
    [16, 40, 18, 16, 16, 14, 22, 8, 10, ...Array(12).fill(11)].forEach((w, i) => ws.getColumn(i + 1).width = w);
    const per = n => !n ? 'ไม่มีการ PM/Cal.' : n % 12 === 0 ? `${n / 12} ปี` : `${n} เดือน`;
    const ms = D.machines.filter(m => m.pm_interval_month || m.cal_interval_month || m.pm_last_date || m.cal_last_date).sort((a, b) => a.machine_no.localeCompare(b.machine_no));
    let r = 5;
    for (const m of ms) {
      const info = [m.machine_no, (m.machine_name || '') + (m.status === 'Inactive' ? ' ยกเลิกใช้งาน' : ''), m.location || '', m.supplier || '', m.responsibility ? nm(m.responsibility) : '', m.eng_foreman ? nm(m.eng_foreman) : '', [m.contact_person, m.phone].filter(Boolean).join(' ')];
      [['PM', m.pm_last_date, m.pm_interval_month], ['CAL', m.cal_last_date, m.cal_interval_month]].forEach(([kind, last, iv], j) => {
        const row = ws.getRow(r + j);
        if (j === 0) info.forEach((v, i) => row.getCell(i + 1).value = v);
        row.getCell(8).value = kind; row.getCell(9).value = per(iv);
        const done = {}; D.requests.filter(q => q.job_type === 'pmcal' && q.machine_no === m.machine_no && q.pmcal_kind === kind && q.status === 'closed' && q.end_at && String(q.end_at).startsWith(String(year))).forEach(q => { done[Number(String(q.end_at).slice(5, 7)) - 1] = String(q.end_at).slice(0, 10); });
        if (last && String(last).startsWith(String(year))) done[Number(String(last).slice(5, 7)) - 1] ||= String(last).slice(0, 10);
        const plan = {}; if (last && iv) { let d = addMonths(last, iv), guard = 0; while (d.slice(0, 4) <= String(year) && guard++ < 60) { if (d.startsWith(String(year))) plan[Number(d.slice(5, 7)) - 1] = d; d = addMonths(d, iv); } }
        for (let k = 0; k < 12; k++) { const c = row.getCell(10 + k); if (done[k]) { c.value = `${kind} ${dmy(done[k])}`; c.fill = fill(G); } else if (plan[k]) { c.value = kind; c.fill = fill(Y); } c.alignment = { horizontal: 'center', vertical: 'middle' }; c.font = { size: 9 }; }
        for (let i = 1; i <= 21; i++) { const c = row.getCell(i); c.border = border; if (i <= 9) c.alignment = { vertical: 'middle', wrapText: true }; }
      });
      for (let c = 1; c <= 7; c++) ws.mergeCells(r, c, r + 1, c);
      r += 2;
    }
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = `PM-CAL-Plan-${year}.xlsx`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast(`Export แผน PM / CAL ปี ${year} · ${ms.length} เครื่อง`);
  } catch (e) { fail(e); }
}

/* ---------- แบบฟอร์มกรอกวันที่ PM / CAL: Export ให้ผู้รับผิดชอบกรอก → นำเข้ากลับ ---------- */
const FORM_SHEET = 'กรอกวันที่ PM-CAL';
const formPlans = () => D.machines.filter(m => m.status !== 'Inactive').flatMap(m => [['PM', m.pm_last_date, m.pm_interval_month], ['CAL', m.cal_last_date, m.cal_interval_month]].filter(x => x[2]).map(([kind, last, iv]) => ({ m, kind, last, iv })))
  .sort((a, b) => nm(a.m.responsibility || '').localeCompare(nm(b.m.responsibility || ''), 'th') || a.m.machine_no.localeCompare(b.m.machine_no) || a.kind.localeCompare(b.kind));
async function exportForm() {
  try {
    if (typeof ExcelJS === 'undefined') await loadJs('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js');
    const rows = formPlans(); if (!rows.length) return toast('ยังไม่มีเครื่องที่มีรอบ PM / CAL');
    const wb = new ExcelJS.Workbook(), fill = c => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: c } });
    const thin = { style: 'thin', color: { argb: 'FFB7C4BF' } }, border = { top: thin, left: thin, bottom: thin, right: thin };
    const hw = wb.addWorksheet('วิธีกรอก'); hw.getColumn(1).width = 110;
    [['แบบฟอร์มกรอกวันที่ PM / CAL · ' + C.APP_NAME, { bold: true, size: 14 }], ['สร้างเมื่อ ' + dmy(todayIso()) + ' · ' + rows.length + ' แผน · ยังไม่มีวันที่ ' + rows.filter(r => !r.last).length + ' แผน (ช่องสีเหลือง)', { color: { argb: 'FF555555' } }], ['', {}],
      ['1. ไปที่ชีท “' + FORM_SHEET + '” แล้วกดลูกศรที่หัวคอลัมน์ “ผู้รับผิดชอบ” เลือกชื่อตัวเอง', {}],
      ['2. กรอกคอลัมน์สีเขียว “วันที่ทำล่าสุด (กรอก)” เป็นวัน/เดือน/ปี ค.ศ. เช่น 15/03/2026 · ดูจาก Certificate CAL, รายงาน PM หรือ Tag ที่เครื่อง', {}],
      ['   Location: กดช่องแล้วกดลูกศรเลือกจากรายการ (เครื่องที่มี PM และ CAL ใส่แถวเดียวก็พอ) · ช่องสีเหลือง = ยังไม่มีข้อมูล', {}],
      ['3. ถ้ารอบไม่ถูก แก้คอลัมน์ “รอบ (เดือน)” ได้ · มีอะไรเพิ่มเติมเขียนในคอลัมน์ “หมายเหตุ”', {}],
      ['4. ไม่รู้วันที่ ปล่อยว่างไว้ · ห้ามเพิ่ม ลบ หรือสลับคอลัมน์ · แก้ได้เฉพาะคอลัมน์สีเขียว', {}],
      ['5. บันทึกไฟล์แล้วส่งกลับให้ Admin · Admin นำเข้าที่หน้า PM / CAL → ⋯ → นำเข้า Excel (ส่งไฟล์แยกคนละไฟล์ได้ นำเข้าทีละไฟล์)', {}]].forEach(([t, f], i) => { const c = hw.getCell(i + 1, 1); c.value = t; c.font = f; c.alignment = { wrapText: true }; });
    const ws = wb.addWorksheet(FORM_SHEET, { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
    const lists = wb.addWorksheet('ตัวเลือก', { state: 'hidden' }); lists.getCell(1, 1).value = 'Location'; OPT.loc.forEach((l, i) => lists.getCell(i + 2, 1).value = l);
    const locRef = `'ตัวเลือก'!$A$2:$A$${OPT.loc.length + 1}`;
    const cols = [['Machine number', 16], ['ชื่อเครื่อง', 36], ['Location', 20], ['งาน', 7], ['รอบ (เดือน)', 10], ['วันที่ทำล่าสุด (ในระบบ)', 14], ['วันที่ทำล่าสุด (กรอก)', 16], ['ครบกำหนดถัดไป', 14], ['ผู้รับผิดชอบ', 22], ['Vendor', 22], ['หมายเหตุ', 30]];
    cols.forEach(([h, w], i) => { ws.getColumn(i + 1).width = w; const c = ws.getCell(1, i + 1); c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = fill([2, 4, 6, 10].includes(i) ? 'FF2E7D4F' : 'FF2F4A43'); c.alignment = { wrapText: true, vertical: 'middle' }; c.border = border; });
    ws.getRow(1).height = 32;
    rows.forEach((r, k) => {
      const row = ws.getRow(k + 2), n = k + 2;
      const v = [r.m.machine_no, r.m.machine_name || '', r.m.location || '', r.kind, r.iv, r.last ? new Date(r.last + 'T00:00:00Z') : null, null, { formula: `IF(G${n}<>"",EDATE(G${n},E${n}),IF(F${n}<>"",EDATE(F${n},E${n}),""))` }, r.m.responsibility ? nm(r.m.responsibility) : '(ยังไม่ระบุ)', r.m.supplier || '', ''];
      v.forEach((x, i) => { const c = row.getCell(i + 1); c.value = x; c.border = border; c.alignment = { vertical: 'middle', wrapText: i === 1 }; });
      [6, 7, 8].forEach(i => row.getCell(i).numFmt = 'dd/mm/yyyy');
      [3, 5, 7, 11].forEach(i => { row.getCell(i).fill = fill((i === 7 && !r.last) || (i === 3 && !r.m.location) ? 'FFFFF2B3' : 'FFE6F4EA'); row.getCell(i).protection = { locked: false }; });
    });
    // 1 ช่วงต่อคอลัมน์ (ใส่ทีละเซลล์แล้ว ExcelJS รวมช่วงซ้อนกัน ทำให้ Excel ขึ้นซ่อมไฟล์)
    const last = rows.length + 1;
    ws.dataValidations.add(`C2:C${last}`, { type: 'list', allowBlank: true, formulae: [locRef], showErrorMessage: true, errorTitle: 'Location', error: 'เลือกจากรายการ (กดลูกศรที่ช่อง)' });
    ws.dataValidations.add(`E2:E${last}`, { type: 'whole', operator: 'between', allowBlank: false, formulae: [1, 120], showErrorMessage: true, error: 'รอบเป็นจำนวนเดือน 1–120' });
    ws.dataValidations.add(`G2:G${last}`, { type: 'date', operator: 'between', allowBlank: true, formulae: [new Date(Date.UTC(2015, 0, 1)), new Date(Date.UTC(2035, 11, 31))], showErrorMessage: true, errorTitle: 'วันที่ไม่ถูกต้อง', error: 'กรอกเป็นวันที่ เช่น 15/03/2026' });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: cols.length } };
    await ws.protect('', { selectLockedCells: true, selectUnlockedCells: true, autoFilter: true, sort: true, formatColumns: true });
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = `CAPD-PMCAL-Dates-${todayIso()}.xlsx`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast(`สร้างแบบฟอร์มแล้ว ${rows.length} แผน · ยังไม่มีวันที่ ${rows.filter(r => !r.last).length}`);
  } catch (e) { fail(e); }
}
function parseForm(rows, g) {
  const out = [], bad = [];
  for (const r of rows) {
    const no = String(g(r, 'machine number') || '').trim(), kind = String(g(r, 'งาน') || '').trim().toUpperCase();
    if (!no || !['PM', 'CAL'].includes(kind)) continue;
    const m = D.machines.find(x => x.machine_no === no); if (!m) { bad.push(`${no}: ไม่พบเครื่องในระบบ`); continue; }
    const rawD = r['วันที่ทำล่าสุด (กรอก)'], d = rawD instanceof Date ? xDate(rawD) : rawD != null && rawD !== '' ? planDate(rawD) || (typeof rawD === 'number' ? xDate(rawD) : null) : null;
    const ivIn = parseInt(g(r, 'รอบ (เดือน)')), old = kind === 'PM' ? m.pm_last_date : m.cal_last_date, oldIv = kind === 'PM' ? m.pm_interval_month : m.cal_interval_month;
    const note = g(r, 'หมายเหตุ'), locIn = String(g(r, 'location') || '').trim();
    const loc = locIn && locIn !== (m.location || '') ? (OPT.loc.includes(locIn) ? locIn : (bad.push(`${no}: Location “${locIn}” ไม่อยู่ในรายการ`), null)) : null;
    if (rawD != null && rawD !== '' && !d) { bad.push(`${no} ${kind}: อ่านวันที่ “${rawD}” ไม่ได้`); continue; }
    if (d && d > todayIso()) { bad.push(`${no} ${kind}: วันที่ ${dmy(d)} อยู่ในอนาคต`); continue; }
    const ivChange = ivIn > 0 && ivIn !== oldIv ? ivIn : null;
    if (!d && !ivChange && !loc) continue;
    out.push({ m, kind, d, old, older: d && old && d < old, same: d && d === old, iv: ivChange, oldIv, note, loc });
  }
  return { out: out.filter(x => !(x.same && !x.iv && !x.loc)), bad: [...new Set(bad)] };
}
function formReview(F, fileName) {
  const use = new Set(F.out.map((x, i) => i).filter(i => !F.out[i].older));
  modal(`<div class="h-row" style="margin:0 0 6px"><h2 style="margin:0;flex:1">นำเข้าแบบฟอร์มกรอกวันที่ PM / CAL</h2><button class="btn ghost" data-close>ยกเลิก</button></div>
    <p class="sub" style="margin-top:0">${esc(fileName)} · พบการเปลี่ยนแปลง ${F.out.length} แผน${F.bad.length ? ` · ข้าม ${F.bad.length} แถว` : ''}</p>
    ${F.out.length ? `<div class="tbl-wrap pl-tbl"><table><thead><tr><th><input type="checkbox" id="fmAll" aria-label="เลือกทั้งหมด" checked></th><th>Machine</th><th>งาน</th><th>วันที่ทำล่าสุด</th><th>รอบ</th><th>Location</th><th>ผู้รับผิดชอบ</th><th>หมายเหตุ</th></tr></thead><tbody>
      ${F.out.map((x, i) => `<tr><td><input type="checkbox" class="fm-on" data-i="${i}" ${use.has(i) ? 'checked' : ''}></td><td><b class="mono">${esc(x.m.machine_no)}</b><br><span class="sub">${esc(x.m.machine_name || '')}</span></td><td>${x.kind}</td>
        <td>${x.d ? `${x.old ? `<span class="sub">${dmy(x.old)} →</span> ` : ''}<b>${dmy(x.d)}</b>${x.older ? ' <span class="pill s-wait" title="เก่ากว่าวันที่ในระบบ ติ๊กเลือกถ้าต้องการแก้ให้ย้อนกลับ">เก่ากว่าในระบบ</span>' : ''}${!x.old ? ' <span class="pill s-confirm">ใหม่</span>' : ''}` : '<span class="sub">-</span>'}</td>
        <td>${x.iv ? `<span class="sub">${x.oldIv || '-'} →</span> <b>${x.iv} เดือน</b>` : `<span class="sub">${x.oldIv} เดือน</span>`}</td><td>${x.loc ? `<span class="sub">${esc(x.m.location || '-')} →</span> <b>${esc(x.loc)}</b>` : `<span class="sub">${esc(x.m.location || '-')}</span>`}</td><td>${esc(nm(x.m.responsibility))}</td><td class="sub">${esc(x.note || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">ไม่มีวันที่หรือรอบที่เปลี่ยนจากในระบบ</div>'}
    ${F.bad.length ? `<details class="pl-box" open><summary>แถวที่ข้าม (${F.bad.length})</summary><ul class="pl-skip">${F.bad.map(b => `<li>${esc(b)}</li>`).join('')}</ul></details>` : ''}
    ${F.out.length ? `<div class="btns" style="margin-top:12px"><button class="btn" id="fmGo">บันทึก <span id="fmN">${use.size}</span> แผน</button><span class="sub">แผนที่วันที่เก่ากว่าในระบบไม่ถูกเลือกไว้ ติ๊กเองถ้าต้องการแก้ย้อนกลับ</span></div>` : ''}`, 'wide');
  const n = () => { const e = $('#fmN'); if (e) e.textContent = use.size; };
  $$('.fm-on').forEach(c => c.onchange = () => { c.checked ? use.add(+c.dataset.i) : use.delete(+c.dataset.i); n(); });
  $('#fmAll') && ($('#fmAll').onchange = e => $$('.fm-on').forEach(c => { c.checked = e.target.checked; c.onchange(); }));
  $('#fmGo') && ($('#fmGo').onclick = async () => {
    const go = $('#fmGo'); go.disabled = true;
    try {
      const per = {};
      [...use].map(i => F.out[i]).forEach(x => { const u = per[x.m.machine_no] ||= {}; const k = x.kind === 'PM' ? 'pm' : 'cal'; if (x.d) u[k + '_last_date'] = x.d; if (x.iv) u[k + '_interval_month'] = x.iv; if (x.loc) u.location = x.loc; });
      for (const [no, u] of Object.entries(per)) { const { error } = await sb.from('machines').update({ ...u, updated_at: new Date().toISOString() }).eq('machine_no', no); if (error) throw error; }
      let created = 0; try { const { data } = await sb.rpc('ensure_pmcal_jobs'); created = data || 0; } catch (e) {}
      closeModal(); toast(`บันทึกวันที่ PM / CAL ${use.size} แผน (${Object.keys(per).length} เครื่อง)` + (created ? ` · เปิดใบงาน PM/CAL ใหม่ ${created}` : '')); reload();
    } catch (e) { go.disabled = false; fail(e); }
  });
}

async function importExcel(file) {
  try {
    const wb0 = XLSX.read(await file.arrayBuffer(), { cellDates: true, cellStyles: true });
    const pn = Object.keys(wb0.Sheets).find(n => n.trim().toUpperCase() === PLAN_SHEET);
    const fn = Object.keys(wb0.Sheets).find(n => n.trim() === FORM_SHEET);
    if (fn) { const { sheet: sh2, g: g2 } = readBook(wb0); const F = parseForm(sh2(FORM_SHEET) || [], g2); return formReview(F, file.name); }
    if (pn) { const P = parsePlanSheet(wb0.Sheets[pn]); if (!P) return toast('อ่านหัวตารางในชีท ' + PLAN_SHEET + ' ไม่ได้ (ต้องมีคอลัมน์ Machine number, Activity, Jan–Dec)'); return planReview(P, file.name); }
    const { sheet, g } = readBook(wb0);
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
    // คอลัมน์ "อุปกรณ์ของเครื่อง" (ถ้ามี): ใส่หลังบันทึกเครื่องทั้งหมดแล้ว เพื่อให้อ้างเครื่องในไฟล์เดียวกันได้
    if (D.hasParts) for (const r of mm) {
      if (!('อุปกรณ์ของเครื่อง' in r || 'parent machine' in r)) continue;
      const no = String(g(r, 'machine number') || '').trim(); if (!no || skip(no)) continue;
      const par = String(g(r, 'อุปกรณ์ของเครื่อง', 'parent machine') || '').trim() || null;
      if (par === no) continue;
      const { error } = await sb.from('machines').update({ parent_machine: par }).eq('machine_no', no); if (error) throw error;
    }
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
      // นำเข้าซ้ำได้: ช่องว่างในไฟล์ไม่ลบข้อมูลเดิม · รายการเครื่องรวมกับที่ผูกไว้แล้ว (เอาเครื่องออกทำในหน้า Vendor)
      const merged = vrows.map(v => { const old = D.vendors.find(x => x.name === v.name); if (!old) return v; const keep = {}; Object.entries(v).forEach(([k, val]) => { if (val != null && val !== '' && k !== 'machines') keep[k] = val; }); return { ...old, ...keep, machines: [...new Set([...(old.machines || []), ...v.machines])] }; });
      if (merged.length) { const { error } = await sb.from('vendors').upsert(merged); if (error) throw error; nv = merged.length; }
      const prows = (sheet('Spare Parts') || []).filter(r => g(r, 'part no') && !/^ตัวอย่าง/.test(String(g(r, 'part no'))));
      for (const r of prows) {
        const pn = String(g(r, 'part no')).trim(), want = Number(g(r, 'คงเหลือ (ยอดยกมา)', 'คงเหลือ') || 0), had = D.parts.find(x => x.part_no === pn);
        const row = { part_no: pn, name: String(g(r, 'ชื่ออะไหล่') || pn), spec: g(r, 'spec'), unit: g(r, 'หน่วย') || 'ชิ้น', min_qty: g(r, 'min') != null ? Number(g(r, 'min')) : null, max_qty: g(r, 'max') != null ? Number(g(r, 'max')) : null, location: g(r, 'ที่เก็บ (rack)', 'ที่เก็บ'), unit_price: g(r, 'ราคา/หน่วย (บาท)') != null ? Number(g(r, 'ราคา/หน่วย (บาท)')) : null, lead_days: g(r, 'lead time (วัน)') != null ? parseInt(g(r, 'lead time (วัน)')) : null, machines: list(g(r, 'machine number (คั่นด้วย ,)', 'machine number')), vendor: g(r, 'vendor') };
        const { error } = await sb.from('spare_parts').upsert(row); if (error) throw error;
        // ยอดยกมาใช้เฉพาะอะไหล่ใหม่ · อะไหล่ที่มีอยู่แล้วไม่เปลี่ยนยอด (นับสต็อกแล้วใช้ปุ่ม ปรับยอด ในเว็บ)
        if (!had && want > 0) { const r2 = await sb.from('part_tx').insert({ part_no: pn, qty: want, kind: 'opening', note: 'ยอดยกมา (นำเข้าจาก Excel)' }); if (r2.error) throw r2.error; }
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
    'Vendor': m.supplier, 'Contact Person': m.contact_person, 'เบอร์โทรศัพท์': m.phone, 'E-mail': m.email, 'Line/ช่องทางอื่น': m.other_contact, 'PM DATE': m.pm_last_date, 'PM Interval': m.pm_interval_month, 'CAL DATE': m.cal_last_date, 'CAL Interval': m.cal_interval_month, ...(D.hasParts ? { 'อุปกรณ์ของเครื่อง': m.parent_machine || '' } : {}) }));
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
  $('#qHold') && ($('#qHold').onclick = () => { const q = D.requests.find(x => x.id === S.sel); if (q) holdForm(q); });
  $$('details.more .mi').forEach(b => b.addEventListener('click', () => b.closest('details').open = false));
  bindTabs(); buildActbar(); playDash();
  document.body.classList.toggle('view-detail', ['detail', 'scan'].includes(S.view));
  $('#memoPrev') && ($('#memoPrev').onclick = () => { const q = D.requests.find(x => x.id === S.sel); if (q) previewMemo(q); });
  $$('input[name=mdM]').forEach(r => r.onchange = () => { $('#mdSp').hidden = document.querySelector('input[name=mdM]:checked').value !== 'special'; });
  $$('input[name=qC], [id^=qA]').forEach(el => { el.addEventListener('change', authHint); el.addEventListener('input', authHint); });
  if ($('#authHint')) authHint();
  $('#qEdit') && ($('#qEdit').onclick = () => { const q = D.requests.find(x => x.id === S.sel); if (q) editForm(q); });
  $('#ptAdd') && ($('#ptAdd').onclick = () => partForm(null));
  $('#prNew') && ($('#prNew').onclick = () => purchaseForm());
  $('#prLow') && ($('#prLow').onclick = () => purchaseForm(lowParts().slice(0, 5).map(x => ({ part_no: x.part_no, name: x.name, unit: x.unit, qty: Math.max(1, Number(x.max_qty ?? x.min_qty ?? 1) - Number(x.stock)) }))));
  $$('[data-pdetail]').forEach(b => b.onclick = e => { if (e.target.closest('[data-pissue],[data-pbuy]')) return; e.preventDefault(); e.stopPropagation(); partDetail(b.dataset.pdetail); });
  $('#ptIssue') && ($('#ptIssue').onclick = () => issueForm());
  $$('[data-pissue]').forEach(b => b.onclick = e => { e.stopPropagation(); issueForm(b.dataset.pissue); });
  $$('[data-missue]').forEach(b => b.onclick = () => issueForm(null, b.dataset.missue));
  $$('[data-muse]').forEach(b => b.onclick = () => machineUsage(b.dataset.muse));
  $$('[data-pbuy]').forEach(b => b.onclick = e => { e.stopPropagation(); buyPart(b.dataset.pbuy); });
  $$('[data-pfilter]').forEach(b => b.onclick = () => { S.pfilter = b.dataset.pfilter; render(); });
  $$('[data-fkind]').forEach(b => b.onclick = () => { S.fkind = b.dataset.fkind; S.fsel = null; render(); });
  $$('[data-fnode]').forEach(b => b.onclick = () => { S.fsel = S.fsel === b.dataset.fnode ? null : b.dataset.fnode; render(); });
  $$('[data-fdays]').forEach(b => b.onclick = () => { S.fdays = +b.dataset.fdays; render(); });
  $$('[data-mpview]').forEach(b => b.onclick = () => { const ps = mPhotos(S.scanNo); photoViewer(ps, Math.max(0, ps.findIndex(x => String(x.id) === b.dataset.mpview))); });
  $$('[data-jpview]').forEach(b => b.onclick = () => photoViewer(jobPhotos(S.scanNo), +b.dataset.jpview));
  $('#mpAdd') && ($('#mpAdd').onchange = e => addMachinePhotos(e.target.dataset.mp, e.target.files));
  $$('[data-vlink]').forEach(b => b.onclick = () => vendorLink(b.dataset.vlink));
  $$('[data-vedit]').forEach(a => a.onclick = e => { e.preventDefault(); vendorForm(a.dataset.vedit); });
  $('#vAdd') && ($('#vAdd').onclick = () => vendorForm(null));
  $$('[data-listview]').forEach(b => b.onclick = () => { S.listView = b.dataset.listview; if (S.view === 'flow') S.view = 'list'; try { localStorage.setItem('capd-list-view', S.listView); } catch (e) {} render(); });
  $$('[data-calview]').forEach(b => b.onclick = () => { S.calView = b.dataset.calview; S.calDay = null; try { localStorage.setItem('capd-cal-view', S.calView); } catch (e) {} render(); });
  $$('[data-calweek]').forEach(b => b.onclick = () => { S.calWeek = b.dataset.calweek || null; render(); });
  $$('[data-calmonth]').forEach(b => b.onclick = () => { S.calMonth = b.dataset.calmonth || null; S.calDay = null; render(); });
  $$('[data-calday]').forEach(b => b.onclick = () => { S.calDay = S.calDay === b.dataset.calday ? null : b.dataset.calday; render(); });
  $('#qCancel') && ($('#qCancel').onclick = () => { const q = D.requests.find(x => x.id === S.sel); if (q) cancelForm(q); });
  $('#backupBtn') && ($('#backupBtn').onclick = backupAll);
  $('#qDel') && ($('#qDel').onclick = () => { const q = D.requests.find(x => x.id === S.sel); if (q) deleteForm(q); });
  $$('[data-scan]').forEach(a => a.onclick = e => { e.preventDefault(); openScan(a.dataset.scan); });
  $$('[data-newfor]').forEach(b => b.onclick = () => { S.prefill = b.dataset.newfor; S.view = 'new'; render(); window.scrollTo(0, 0); });
  $$('[data-qr]').forEach(b => b.onclick = () => printQR([M(b.dataset.qr)]));
  $$('[data-tag]').forEach(b => b.onclick = () => { const [no, kind] = b.dataset.tag.split('|'); const m = M(no); printTags(kind ? [{ m, kind }] : tagsFor(m)); });
  $$('[data-tagjob]').forEach(b => b.onclick = () => { const q = D.requests.find(x => x.id === S.sel); if (q) printTags([{ m: M(q.machine_no), kind: q.pmcal_kind || 'PM', q: q.status === 'closed' ? q : null }]); });
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
    if ($('#psn' + i)) { row.short_name = $('#psn' + i).value.trim() || null; const dup = shortClash(row.short_name, p.email); if (dup) return toast(`ชื่อย่อ ${dup[0]} ใช้กับ ${nm(dup[1].email)} แล้ว`); }
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
    const sh = $('#psShort') ? $('#psShort').value.trim() || null : undefined;
    const dup = sh && shortClash(sh, em); if (dup) return toast(`ชื่อย่อ ${dup[0]} ใช้กับ ${nm(dup[1].email)} แล้ว`);
    const { error } = await sb.from('app_users').insert({ email: em, full_name: $('#psName').value.trim() || null, ...(sh !== undefined ? { short_name: sh } : {}), role: r, fd_type: r === 'foreman_day' ? ($('#psFd').value || null) : null, is_admin: $('#psAdmin').checked, memo_approver: $('#psMemo').checked });
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
  live('q', 'q'); live('dq', 'docQ'); live('mq', 'mq'); live('pq', 'pq'); live('vq', 'vq');
  $$('#expReq').forEach(b => b.onclick = exportRequests);
  $$('[data-planx]').forEach(b => b.onclick = () => exportPlan(Number(b.dataset.planx)));
  bindMap();
  $$('[data-ck]').forEach(b => b.onclick = e => { e.preventDefault(); ckForm(b.dataset.ck); });
  $$('[data-ckview]').forEach(b => b.onclick = e => { e.preventDefault(); ckView(b.dataset.ckview); });
  $$('[data-cktpl]').forEach(b => b.onclick = () => ckTplEdit(b.dataset.cktpl));
  $$('[data-ckx]').forEach(b => b.onclick = () => ckExport(Number(b.dataset.ckx)));
  $('#ckNg') && ($('#ckNg').onchange = e => { S.ckNg = e.target.checked; render(); });
  const ckF = () => { const k = (S.ckq || '').trim().toLowerCase(); $$('#main [data-q]').forEach(el => el.hidden = !!k && !el.dataset.q.includes(k)); };
  $('#ckq') && ($('#ckq').oninput = e => { S.ckq = e.target.value; ckF(); }); ckF();
  $('#pfForm') && ($('#pfForm').onclick = exportForm);
  $('#pmAutoT') && ($('#pmAutoT').onclick = pmAutoToggle);
  $$('[data-pmopen]').forEach(b => b.onclick = () => { const [no, kind] = b.dataset.pmopen.split('|'); b.disabled = true; openPmJob(no, kind); });
  $('#mAdd') && ($('#mAdd').onclick = () => machineForm(null));
  $('#mImport') && ($('#mImport').onchange = e => { const f = e.target.files[0]; if (f) importExcel(f); e.target.value = ''; });
  $('#dAdd') && ($('#dAdd').onclick = docForm);
  $$('input[name=rtMode]').forEach(r => r.onchange = () => { const self = document.querySelector('input[name=rtMode]:checked').value === 'self'; $('#rtSelf').hidden = !self; $('#rtResubmit').hidden = self; });

  const ms = $('#nMachine');
  if (ms) {
    ms.onchange = () => { const m = M(ms.value); const mp0 = mPhotos(ms.value)[0]; $('#mInfo').innerHTML = ms.value ? `${mp0 ? `<div class="minfo-ph">${imgTag(mp0.path, 'รูปเครื่อง ' + ms.value)}</div>` : ''}<div class="mcard"><div><span>Model</span>${esc(m.model || '-')}</div><div><span>Serial</span>${esc(m.serial_number || '-')}</div><div><span>Location</span>${esc(m.location || '-')}</div><div><span>Priority</span>${esc(m.priority)}</div><div><span>Member ผู้รับผิดชอบ</span>${esc(nm(m.responsibility))}</div><div><span>Vendor</span>${esc(m.supplier || '-')}</div>${m.parent_machine ? `<div><span>เป็นอุปกรณ์ของ</span>${esc(m.parent_machine)} ${esc(M(m.parent_machine).machine_name || '')}</div>` : ''}</div>` : ''; };
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
        S.prefillSym = null; await loadAll(); openDetail(data.id);
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
document.addEventListener('click', e => $$('details.more[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; }));
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

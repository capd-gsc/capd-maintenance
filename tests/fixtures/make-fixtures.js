// Builds the files the browser tests upload: a fake quotation PDF and fictional Excel imports.
// Usage: node fixtures/make-fixtures.js <out dir>
const fs = require('fs'), path = require('path'), X = require('xlsx');
const out = process.argv[2] || path.join(__dirname, '..', 'out');
fs.mkdirSync(out, { recursive: true });

// 1. a tiny valid PDF (no real document)
fs.writeFileSync(path.join(out, 'quote.pdf'), '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

// 2. data template like CAPD-Maintenance-Data-Template.xlsx (fictional users, 24 molds, one example row that must be skipped)
const roleLabel = { member: 'Member', foreman_shift: 'Foreman Shift', foreman_day: 'Foreman Day', manager: 'Manager' };
const users = fs.readFileSync(path.join(__dirname, 'users_test.sql'), 'utf8').split('\n').map(l => l.match(/\('(user\d+@scg\.com)','([^']+)','(\w+)',(null|'[^']+'),(true|false),(true|false)\)/)).filter(Boolean)
  .map(([, email, name, role, fd, adm, memo]) => [email, name, roleLabel[role], fd === 'null' ? '' : fd.slice(1, -1), memo === 'true' ? 'Y' : 'N', '', adm === 'true' ? 'Y' : 'N']);
const wb = X.utils.book_new();
X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['อีเมล', 'ชื่อที่แสดง', 'บทบาท', 'Foreman Day ดูแลประเภท', 'อนุมัติ MEMO ได้ (Y/N)', 'หมายเหตุ', 'สิทธิ์ Admin (Y/N)'], ...users]), 'ผู้ใช้');
const mm = [['Machine number', 'Machine Name', 'Model', 'Serial Number', 'Machine Type', 'Location', 'Status', 'Priority', 'Maintenance Type', 'Responsibility', 'Eng,Foreman', 'Vendor', 'Contact Person', 'เบอร์โทรศัพท์', 'E-mail', 'Line/ช่องทางอื่น', 'PM DATE', 'PM Interval', 'CAL DATE', 'CAL Interval'],
  ['ตัวอย่าง-EX-91-01', 'Twin Screw Extruder 40mm', 'ZSK 40', 'EX40-0000', 'เครื่องจักร', 'Extruder Area (Line 91)', 'Active', 'Critical', 'PM', 'user14@scg.com', '', 'บริษัท ตัวอย่าง จำกัด', '', '', '', '', new Date(2026, 5, 5), 6, '', '']];
for (let i = 1; i <= 24; i++) mm.push(['MD-' + String(i).padStart(2, '0'), 'Mold test ' + i, 'Mold', '', 'Mold', 'Injection Area MTD', 'Active', 'Normal', 'No Plan', 'user01@scg.com', '', '', '', '', '', '', '', '', '', '']);
X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(mm, { cellDates: true }), 'Machine Master');
for (const n of ['Vendors', 'Spare Parts', 'จุดวัดไฟ', 'ทะเบียนเอกสาร']) X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['ชื่อ'], ['ตัวอย่าง']]), n);
X.writeFile(wb, path.join(out, 'template.xlsx'));

// 3. one machine with the new "Vendor" header and one with the old "Supplier" header
for (const [f, h, no] of [['v_new.xlsx', 'Vendor', 'VN-01'], ['v_old.xlsx', 'Supplier', 'VO-01']]) {
  const w = X.utils.book_new();
  X.utils.book_append_sheet(w, X.utils.aoa_to_sheet([['Machine number', 'Machine Name', 'Machine Type', h], [no, 'Test', 'เครื่องจักร', 'ABC Co.']]), 'Machine Master');
  X.writeFile(w, path.join(out, f));
}
console.log('fixtures →', out);

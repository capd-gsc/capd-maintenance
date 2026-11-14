-- Data in a database installed with the pre-14-Nov-2026 SQL (trial mode on), before running install.sql
select set_config('capd.system', '1', false);
insert into public.machines(machine_no, machine_name, machine_type, location, responsibility, maintenance_type, cal_last_date, cal_interval_month) values
 ('M-01','Twin Screw Extruder','เครื่องจักร','Extruder Area (Line 91)','user14@scg.com','PM', null, null),
 ('T-01','UTM Tester','เครื่องทดสอบ','Testing Room 1','user21@scg.com','CAL', current_date - interval '10 months', 12);
insert into public.requests(id, machine_no, reporter, symptom, status, job_type) values
 ('MR-2026-0001','M-01','user14@scg.com','Screw ไม่หมุน','pending_fd',null),
 ('MR-2026-0002','T-01','user21@scg.com','ค่าเพี้ยน','closed','self_fix');
insert into public.request_logs(request_id, actor, action) values ('MR-2026-0001','user14@scg.com','เปิดใบงาน');
insert into public.role_presets(email, role) values ('user01@scg.com', 'admin') on conflict do nothing;
select set_config('capd.system', '', false);

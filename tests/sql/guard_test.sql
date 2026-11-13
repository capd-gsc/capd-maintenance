-- Database permission checks: every expect_fail must be blocked; output lines 'ok (blocked) …'
insert into machines(machine_no, machine_name, machine_type, responsibility, pm_last_date, pm_interval_month, cal_last_date, cal_interval_month, maintenance_type)
values ('M-01','Mixer','เครื่องจักร','user14@scg.com', current_date - interval '11 months', 12, null, null,'PM'),
       ('T-01','UTM','เครื่องทดสอบ','user21@scg.com', null, null, current_date - interval '10 months', 12,'CAL');
create or replace function as_user(e text) returns void language sql as $$ select set_config('request.jwt.claims', json_build_object('email', e)::text, false) $$;
create or replace function expect_fail(q text, label text) returns text language plpgsql as $$
begin execute q; raise exception 'SHOULD FAIL: %', label; exception when others then if sqlerrm like 'SHOULD FAIL%' then raise; end if; return 'ok (blocked) ' || label || ': ' || sqlerrm; end $$;
grant execute on function as_user(text), expect_fail(text,text) to authenticated, anon;
set role authenticated;
-- anon-ish (no email)
select as_user('');
select expect_fail($$insert into requests(machine_no, symptom) values ('M-01','x')$$, 'no login insert');
select count(*) as seen_without_login from requests;
select as_user('outsider@scg.com');
select expect_fail($$insert into requests(machine_no, symptom) values ('M-01','x')$$, 'not in app_users');
-- FS opens jobs
select as_user('user05@scg.com');
insert into requests(id, machine_no, symptom, status, job_type) values ('R0','M-01','แก้เอง','closed','self_fix');
insert into requests(id, machine_no, symptom, status, approved_by) values ('R1','M-01','เสียงดัง','quotation','hacker');
insert into requests(id, machine_no, symptom) values ('R2','T-01','ค่าเพี้ยน');
insert into requests(id, machine_no, symptom) values ('R3','M-01','รั่ว');
select id, status, reporter, technician, closed_by from requests order by id;
-- FS can't approve
select expect_fail($$update requests set status='wait_admin', job_type='normal' where id='R1'$$, 'FS approve');
-- wrong FD type
select as_user('user03@scg.com');
select expect_fail($$update requests set status='wait_admin', job_type='normal' where id='R1'$$, 'tester FD on machine');
-- right FD
select as_user('user02@scg.com');
update requests set status='wait_admin', job_type='normal', repair_unit='RMT', approved_by='fake' where id='R1';
select expect_fail($$update requests set status='wait_admin' where id='R2'$$, 'machine FD on tester');
-- backup FD
select as_user('user04@scg.com');
update requests set status='quotation', job_type='special', assignee='user21@scg.com' where id='R2';
update requests set status='returned', return_note='ข้อมูลไม่พอ' where id='R3';
select as_user('user05@scg.com');
update requests set status='pending_fd', symptom='รั่วมาก' where id='R3';
select id, status, job_type, approved_by from requests where id in ('R1','R2','R3') order by id;
-- admin flow for normal
select as_user('user11@scg.com');
select expect_fail($$update requests set status='ext_repair' where id='R1'$$, 'member as admin');
select as_user('user01@scg.com');
update requests set status='ext_repair', external_ref='SAP-123' where id='R1';
select as_user('user02@scg.com');
update requests set status='closed' where id='R1';
-- special: quotation -> memo
select as_user('user21@scg.com');
update requests set vendor='ABC', quotation_amount=12000 where id='R2';
update requests set status='memo_approval', memo_no='MEMO-1', memo_approvers=array['user09@scg.com','user10@scg.com'], memo_step=0 where id='R2';
select as_user('user10@scg.com');
select expect_fail($$update requests set memo_step=1 where id='R2'$$, 'App2 before App1');
select as_user('user09@scg.com');
select expect_fail($$update requests set status='po_vendor' where id='R2'$$, 'App1 skipping App2');
update requests set memo_step=1 where id='R2';
select expect_fail($$update requests set memo_step=2 where id='R2'$$, 'App1 again');
select as_user('user10@scg.com');
update requests set status='po_vendor' where id='R2';
select as_user('user21@scg.com');
select expect_fail($$update requests set status='closed' where id='R2'$$, 'close without PO');
select expect_fail($$update requests set po_no='PO-9' where id='R2'$$, 'member sets PO');
select as_user('user01@scg.com');
update requests set po_no='PO-9', vendor_date=current_date where id='R2';
select as_user('user21@scg.com');
update requests set status='closed' where id='R2';
select id, status, approved_by, closed_by, po_no, memo_step from requests order by id;
-- pmcal
select ensure_pmcal_jobs() as created;
select ensure_pmcal_jobs() as created_again;
select id, machine_no, pmcal_kind, due_date, assignee, status from requests where job_type='pmcal';
select machine_no, tier, recipients from pmcal_reminders;
select as_user('user21@scg.com');
update requests set status='memo_approval', memo_approvers=array['user09@scg.com'], memo_step=0 where job_type='pmcal' and machine_no='T-01';
select as_user('user09@scg.com');
update requests set status='po_vendor' where job_type='pmcal' and machine_no='T-01';
select as_user('user01@scg.com');
update requests set po_no='PO-CAL' where job_type='pmcal' and machine_no='T-01';
select as_user('user21@scg.com');
update requests set status='closed' where job_type='pmcal' and machine_no='T-01';
select machine_no, cal_last_date, pm_last_date from machines order by 1;
-- RLS: member can't edit machines/users
select expect_fail($$insert into app_users(email, role) values ('x@scg.com','admin')$$, 'member adds user');
update machines set machine_name='hack' where machine_no='M-01';
select machine_name from machines where machine_no='M-01';
select expect_fail($$update requests set reporter='x' where id='R0'$$, 'change reporter');
select as_user('user01@scg.com');
insert into app_users(email, full_name, role) values ('newguy@scg.com','New','member');
select expect_fail($$insert into app_users(email, role) values ('x@gmail.com','member')$$, 'non-scg');
select count(*) from app_users;

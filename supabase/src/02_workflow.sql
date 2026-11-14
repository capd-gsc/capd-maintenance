-- ===== 02 workflow: Flow งานซ่อม / PM-CAL อัตโนมัติ =====
-- ---------- 2. ใบงาน: คอลัมน์ใหม่ ----------
alter table public.requests
  add column if not exists job_type text,            -- self_fix / normal / special / pmcal
  add column if not exists repair_unit text,         -- RMT / FM (งาน Normal)
  add column if not exists first_fix text,           -- วิธีแก้ไขเบื้องต้น
  add column if not exists assignee text,            -- ผู้รับผิดชอบงาน Special / PM-CAL
  add column if not exists external_ref text,        -- เลขที่ใบแจ้ง SAP / K2
  add column if not exists vendor text,
  add column if not exists quotation_amount numeric(14,2),
  add column if not exists memo_no text,
  add column if not exists memo_approvers text[] not null default '{}',
  add column if not exists memo_step int not null default 0,
  add column if not exists memo_round int not null default 0,
  add column if not exists po_no text,
  add column if not exists vendor_date date,
  add column if not exists pmcal_kind text,          -- PM / CAL
  add column if not exists due_date date,
  add column if not exists action_at timestamptz,    -- Member เริ่มดำเนินการแล้ว (หยุดอีเมลเตือน)
  add column if not exists return_note text,
  add column if not exists closed_by text,
  add column if not exists attachments jsonb not null default '[]';

alter table public.requests drop constraint if exists requests_status_check;
update public.requests set status = case status
  when 'rejected' then 'returned'
  when 'closed' then 'closed'
  else 'pending_fd' end
  where status not in ('pending_fd','returned','wait_admin','ext_repair','quotation','memo_approval',
                       'memo_rejected','po_vendor','closed','cancelled');
alter table public.requests alter column status set default 'pending_fd';
alter table public.requests add constraint requests_status_check check (status in
  ('pending_fd','returned','wait_admin','ext_repair','quotation','memo_approval','memo_rejected','po_vendor','closed','cancelled'));
alter table public.requests drop constraint if exists requests_job_type_check;
alter table public.requests add constraint requests_job_type_check
  check (job_type is null or job_type in ('self_fix','normal','special','pmcal','purchase'));

create unique index if not exists requests_pmcal_uniq on public.requests(machine_no, pmcal_kind, due_date)
  where job_type = 'pmcal';

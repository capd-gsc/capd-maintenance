-- ตั้งเวลาให้ Edge Function "notify" ทำงาน (รันใน SQL Editor ครั้งเดียว · รันซ้ำได้)
-- ก่อนรัน: 1) เปิด Extensions pg_cron และ pg_net (Database → Extensions)
--          2) แทน <CRON_SECRET> ทั้ง 2 จุดด้วยค่าเดียวกับ secret CRON_SECRET ของ Edge Function
select cron.unschedule(jobname) from cron.job where jobname in ('capd-pmcal-reminders', 'capd-notify-queue', 'capd-notify-daily', 'capd-notify-cleanup');

-- ส่งเรื่องในคิวทุก 1 นาที
select cron.schedule('capd-notify-queue', '* * * * *', $$
  select net.http_post(
    url := 'https://dymnbigvcbthxumrijsb.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{"job":"queue"}'::jsonb)
$$);

-- สรุปรายวัน 08:00 น. เวลาไทย (01:00 UTC)
select cron.schedule('capd-notify-daily', '0 1 * * *', $$
  select net.http_post(
    url := 'https://dymnbigvcbthxumrijsb.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{"job":"daily"}'::jsonb)
$$);

-- ล้างคิวที่ส่งแล้วเกิน 30 วัน ทุกวันอาทิตย์
select cron.schedule('capd-notify-cleanup', '30 1 * * 0', $$ delete from public.notify_queue where sent_at < now() - interval '30 days' $$);

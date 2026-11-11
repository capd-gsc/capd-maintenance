-- ตั้งเวลาส่งอีเมลเตือน PM/CAL ทุกวัน 08:00 น. (เวลาไทย = 01:00 UTC)
-- ก่อนรัน: เปิด Extensions pg_cron และ pg_net (Database → Extensions)
--          และแทน <CRON_SECRET> ด้วยค่าเดียวกับ secret ของ Edge Function
select cron.unschedule('capd-pmcal-reminders') where exists (select 1 from cron.job where jobname = 'capd-pmcal-reminders');
select cron.schedule('capd-pmcal-reminders', '0 1 * * *', $$
  select net.http_post(
    url := 'https://dymnbigvcbthxumrijsb.supabase.co/functions/v1/pmcal-reminders',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb)
$$);

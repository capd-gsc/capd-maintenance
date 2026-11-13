// Supabase Edge Function "notify" — ส่งแจ้งเตือนทางอีเมล (Brevo) และ Microsoft Teams
//   POST {"job":"queue"}  ทุก 1 นาที: ส่งเรื่องในคิว notify_queue (ใบงานเปลี่ยนขั้น)
//   POST {"job":"daily"}  ทุกวัน 08:00: เปิดใบงาน PM/CAL ที่ใกล้ครบ + เตือน PM/CAL + สรุปงานค้างเกิน 3 วันลง Teams
// Secrets (Edge Functions → Secrets): CRON_SECRET, APP_URL และอย่างน้อย 1 ช่องทาง
//   อีเมล: BREVO_API_KEY + MAIL_FROM · Teams: TEAMS_WEBHOOK_URL (งานซ่อม) และ TEAMS_WEBHOOK_URL_PMCAL (PM/CAL, ไม่บังคับ)
// SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY มีให้อัตโนมัติ
import { createClient } from "npm:@supabase/supabase-js@2.89.0";
import { dailyEmails, dailyTeamsPosts, deliver, postTeams, sendEmail, type Config } from "./core.ts";

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return new Response("forbidden", { status: 403 });
  const cfg: Config = { appUrl: Deno.env.get("APP_URL") ?? "", brevoKey: Deno.env.get("BREVO_API_KEY"), mailFrom: Deno.env.get("MAIL_FROM"), teamsUrl: Deno.env.get("TEAMS_WEBHOOK_URL"), teamsUrlPmcal: Deno.env.get("TEAMS_WEBHOOK_URL_PMCAL") };
  if (!(cfg.brevoKey && cfg.mailFrom) && !cfg.teamsUrl && !cfg.teamsUrlPmcal) return Response.json({ error: "ยังไม่ได้ตั้ง BREVO_API_KEY + MAIL_FROM หรือ TEAMS_WEBHOOK_URL" }, { status: 500 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const job = (await req.json().catch(() => ({}))).job ?? "queue";
  const { data: users } = await sb.from("app_users").select("email, full_name, active, notify_email");

  if (job === "daily") {
    await sb.rpc("ensure_pmcal_jobs");
    const [{ data: rem }, { data: stale }] = await Promise.all([sb.from("pmcal_reminders").select("*").order("days_left"), sb.from("stale_jobs").select("*").order("idle_days", { ascending: false })]);
    const errs: string[] = [];
    if (cfg.brevoKey && cfg.mailFrom) for (const m of dailyEmails(rem ?? [], cfg)) {
      const u = (users ?? []).find((x) => x.email === m.to); if (!u || u.active === false || u.notify_email === false) continue;
      try { await sendEmail(fetch, cfg, m.to, m.subject, m.html); } catch (e) { errs.push((e as Error).message); }
    }
    for (const p of dailyTeamsPosts(rem ?? [], stale ?? [], users ?? [], cfg)) {
      try { await postTeams(fetch, p.url, p.card); } catch (e) { errs.push((e as Error).message); }
    }
    return Response.json({ reminders: rem?.length ?? 0, stale: stale?.length ?? 0, errors: errs });
  }

  const { data: items, error } = await sb.from("notify_queue").select("*").is("sent_at", null).lt("attempts", 5).order("id").limit(40);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  let sent = 0; const failed: string[] = [];
  for (const it of items ?? []) {
    const { data: j } = await sb.from("requests").select("*, machines(machine_name)").eq("id", it.request_id).maybeSingle();
    const errs = j ? await deliver(fetch, cfg, it, { ...j, machine_name: j.machines?.machine_name }, users ?? []) : [];
    if (errs.length) { failed.push(...errs); await sb.from("notify_queue").update({ attempts: it.attempts + 1, error: errs.join(" | ").slice(0, 900) }).eq("id", it.id); }
    else { sent++; await sb.from("notify_queue").update({ sent_at: new Date().toISOString(), attempts: it.attempts + 1, error: null }).eq("id", it.id); }
  }
  return Response.json({ queued: items?.length ?? 0, sent, failed });
});

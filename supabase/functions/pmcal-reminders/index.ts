// Supabase Edge Function: ส่งอีเมลเตือน PM/CAL รายวัน
// 1) เปิดใบงาน PM/CAL ที่เหลือ ≤ 90 วัน (ensure_pmcal_jobs)
// 2) อ่าน view pmcal_reminders แล้วส่งอีเมลสรุปให้ผู้รับแต่ละคน 1 ฉบับ
// Secrets ที่ต้องตั้ง: BREVO_API_KEY, MAIL_FROM, APP_URL, CRON_SECRET
// (SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY มีให้อัตโนมัติ)
import { createClient } from "npm:@supabase/supabase-js@2.89.0";

const TIER = { 1: "ขั้น 1 (≤ 3 เดือน)", 2: "ขั้น 2 (≤ 2 เดือน)", 3: "ขั้น 3 (≤ 1 เดือน)" } as Record<number, string>;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return new Response("forbidden", { status: 403 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  await sb.rpc("ensure_pmcal_jobs");
  const { data, error } = await sb.from("pmcal_reminders").select("*").order("days_left");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const byPerson = new Map<string, typeof data>();
  for (const j of data ?? []) for (const e of j.recipients ?? []) {
    if (!/^[^@\s]+@[^@\s]+$/.test(e)) continue;
    byPerson.set(e, [...(byPerson.get(e) ?? []), j]);
  }

  const app = Deno.env.get("APP_URL")!;
  const results: Record<string, number> = {};
  for (const [to, jobs] of byPerson) {
    const rows = jobs.map((j) => `<tr><td>${esc(TIER[j.tier])}</td><td><b>${esc(j.machine_no)}</b> ${esc(j.machine_name)}</td><td>${esc(j.pmcal_kind)}</td><td>${esc(j.due_date)}</td><td>${j.days_left < 0 ? "เกิน " + -j.days_left : "อีก " + j.days_left} วัน</td><td><a href="${app}?m=${encodeURIComponent(j.machine_no)}">${esc(j.id)}</a></td></tr>`).join("");
    const html = `<p>มีงาน PM/CAL ที่ยังไม่เริ่มดำเนินการ ${jobs.length} รายการ</p>
      <table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>ขั้น</th><th>เครื่อง</th><th>ประเภท</th><th>ครบกำหนด</th><th>เหลือ</th><th>ใบงาน</th></tr>${rows}</table>
      <p>Member ผู้รับผิดชอบกด “เริ่มดำเนินการแล้ว” ในใบงานเพื่อหยุดการเตือน · <a href="${app}">เปิดระบบ CAPD Maintenance</a></p>`;
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": Deno.env.get("BREVO_API_KEY")!, "content-type": "application/json" },
      body: JSON.stringify({ sender: { name: "CAPD Maintenance", email: Deno.env.get("MAIL_FROM") }, to: [{ email: to }], subject: `[CAPD] เตือน PM/CAL ${jobs.length} รายการ`, htmlContent: html }),
    });
    results[to] = r.status;
  }
  return Response.json({ jobs: data?.length ?? 0, sent: results });
});

// ไฟล์นี้สร้างจาก tools/build-notify.sh — อย่าแก้ตรงนี้ ให้แก้ core.ts / index.ts แล้วรันสคริปต์ใหม่
// Supabase Edge Function "notify" — ส่งแจ้งเตือนทางอีเมล (Brevo) และ Microsoft Teams
//   POST {"job":"queue"}  ทุก 1 นาที: ส่งเรื่องในคิว notify_queue (ใบงานเปลี่ยนขั้น)
//   POST {"job":"daily"}  ทุกวัน 08:00: เปิดใบงาน PM/CAL ที่ใกล้ครบ + เตือน PM/CAL + สรุปงานค้างเกิน 3 วันลง Teams
// Secrets (Edge Functions → Secrets): CRON_SECRET, APP_URL และอย่างน้อย 1 ช่องทาง
//   อีเมล: BREVO_API_KEY + MAIL_FROM · Teams: TEAMS_WEBHOOK_URL
// SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY มีให้อัตโนมัติ
import { createClient } from "npm:@supabase/supabase-js@2.89.0";
// CAPD Maintenance — notification messages and delivery (no Deno APIs here, so tests can run it in Node).
// index.ts wires it to Supabase; tests/e2e/10-notify.mjs drives it with a fake fetch.

export type Job = {
  id: string; machine_no: string; machine_name?: string; symptom?: string; urgency?: string; status: string;
  job_type?: string | null; repair_unit?: string | null; pmcal_kind?: string | null; due_date?: string | null;
  return_note?: string | null; memo_no?: string | null; memo_step?: number; vendor?: string | null; quotation_amount?: number | string | null; po_no?: string | null;
};
export type QueueItem = { id: number; request_id: string; event: string; status: string; recipients: string[]; actor: string };
export type User = { email: string; full_name?: string | null; active?: boolean; notify_email?: boolean };
export type Config = { appUrl: string; brevoKey?: string; mailFrom?: string; teamsUrl?: string };
export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const money = (v: unknown) => v == null || v === "" ? "-" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " บาท";
export const jobUrl = (cfg: Config, id: string) => cfg.appUrl.replace(/\/?$/, "/") + "?job=" + encodeURIComponent(id);
export const nameOf = (users: User[], e: string) => e === "" || e === "system" ? "ระบบ" : (users.find((u) => u.email === e)?.full_name || e.split("@")[0]);

// หัวเรื่อง (สิ่งที่ผู้รับต้องทำ) ตามเหตุการณ์และสถานะ
export function headline(it: QueueItem, j: Job): string {
  if (it.event === "memo_next") return `MEMO ${j.memo_no ?? ""} รอคุณอนุมัติ (App ${(j.memo_step ?? 0) + 1})`;
  if (it.event === "po_ready") return `ออก PO ${j.po_no ?? ""} แล้ว · นัด Vendor และปิดงาน`;
  if (it.event === "closed") return "ใบงานของคุณปิดงานแล้ว";
  if (it.event === "cancelled") return "ใบงานของคุณถูกยกเลิก";
  switch (it.status) {
    case "pending_fd": return "ใบงานใหม่ รอ Foreman Day อนุมัติ";
    case "returned": return "ใบงานถูกส่งกลับ ลองแก้ไขหรือส่งใหม่";
    case "wait_admin": return `รอ Admin แจ้งซ่อม ${j.repair_unit ?? ""} ผ่าน ${j.repair_unit === "FM" ? "K2" : "SAP"}`;
    case "ext_repair": return `${j.repair_unit ?? "RMT/FM"} กำลังซ่อม · รอ Foreman Day สรุปผลและปิดงาน`;
    case "quotation": return j.job_type === "pmcal" ? `ระบบเปิดใบงาน ${j.pmcal_kind ?? "PM/CAL"} ให้คุณ · ครบกำหนด ${j.due_date ?? "-"}` : "คุณได้รับมอบหมายงาน Special · ขอใบเสนอราคาและออก MEMO";
    case "memo_rejected": return "MEMO ถูกส่งกลับ แก้ไขแล้วส่งใหม่";
    case "memo_approval": return `MEMO ${j.memo_no ?? ""} รอคุณอนุมัติ (App ${(j.memo_step ?? 0) + 1})`;
    case "po_vendor": return j.po_no ? `ออก PO ${j.po_no} แล้ว · นัด Vendor และปิดงาน` : "MEMO อนุมัติครบแล้ว · รอ Admin ออก PO";
    default: return "ใบงานมีความเคลื่อนไหว";
  }
}

function facts(it: QueueItem, j: Job, users: User[]): [string, string][] {
  const f: [string, string][] = [["เครื่องจักร", `${j.machine_no} ${j.machine_name ?? ""}`.trim()], ["อาการ / งาน", j.symptom ?? "-"], ["ความเร่งด่วน", j.urgency ?? "-"]];
  if (j.vendor || j.quotation_amount != null) f.push(["Vendor / ราคา", `${j.vendor ?? "-"} · ${money(j.quotation_amount)}`]);
  if ((it.status === "returned" || it.status === "memo_rejected" || it.event === "cancelled") && j.return_note) f.push(["เหตุผล", j.return_note]);
  f.push(["โดย", nameOf(users, it.actor)]);
  return f;
}

export function buildEmail(it: QueueItem, j: Job, users: User[], cfg: Config) {
  const h = headline(it, j), url = jobUrl(cfg, j.id);
  const rows = facts(it, j, users).map(([k, v]) => `<tr><td style="color:#5c6965;padding:4px 12px 4px 0;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join("");
  return {
    subject: `[CAPD] ${j.id} · ${h}`,
    html: `<div style="font-family:Tahoma,sans-serif;font-size:14px;color:#17201d;max-width:560px">
      <p style="font-size:16px;font-weight:bold;margin:0 0 4px">${esc(h)}</p><p style="color:#5c6965;margin:0 0 12px">ใบงาน ${esc(j.id)}</p>
      <table style="border-collapse:collapse;margin-bottom:16px">${rows}</table>
      <a href="${esc(url)}" style="display:inline-block;background:#0e7c6b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold">เปิดใบงาน</a>
      <p style="color:#5c6965;font-size:12px;margin-top:18px">อีเมลอัตโนมัติจากระบบ CAPD Maintenance · ตอบกลับอีเมลนี้ไม่ได้</p></div>`,
  };
}

const card = (body: unknown[], actions: unknown[]) => ({
  type: "message",
  attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null,
    content: { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4", body, actions } }],
});

export function buildTeamsCard(it: QueueItem, j: Job, users: User[], cfg: Config) {
  const waiting = it.recipients.length ? it.recipients.map((e) => nameOf(users, e)).join(", ") : "-";
  return card([
    { type: "TextBlock", text: headline(it, j), weight: "Bolder", size: "Medium", wrap: true },
    { type: "TextBlock", text: `ใบงาน ${j.id}`, isSubtle: true, spacing: "None" },
    { type: "FactSet", facts: [...facts(it, j, users), ["รอ", waiting]].map(([title, value]) => ({ title, value: String(value) })) },
  ], [{ type: "Action.OpenUrl", title: "เปิดใบงาน", url: jobUrl(cfg, j.id) }]);
}

export async function sendEmail(fetchFn: Fetch, cfg: Config, to: string, subject: string, html: string) {
  const r = await fetchFn("https://api.brevo.com/v3/smtp/email", {
    method: "POST", headers: { "api-key": cfg.brevoKey!, "content-type": "application/json" },
    body: JSON.stringify({ sender: { name: "CAPD Maintenance", email: cfg.mailFrom }, to: [{ email: to }], subject, htmlContent: html }),
  });
  if (!r.ok) throw new Error(`email ${to}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}
export async function postTeams(fetchFn: Fetch, cfg: Config, payload: unknown) {
  const r = await fetchFn(cfg.teamsUrl!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(`teams: ${r.status} ${(await r.text()).slice(0, 200)}`);
}

// ส่ง 1 เรื่องในคิว: อีเมลถึงผู้รับแต่ละคน (ที่เปิดรับอีเมล) + การ์ด Teams 1 ใบ · คืนค่าข้อผิดพลาด (ว่าง = สำเร็จ)
export async function deliver(fetchFn: Fetch, cfg: Config, it: QueueItem, j: Job, users: User[]): Promise<string[]> {
  const errs: string[] = [];
  if (cfg.brevoKey && cfg.mailFrom) {
    const mail = buildEmail(it, j, users, cfg);
    for (const to of it.recipients) {
      const u = users.find((x) => x.email === to);
      if (!u || u.active === false || u.notify_email === false) continue;
      try { await sendEmail(fetchFn, cfg, to, mail.subject, mail.html); } catch (e) { errs.push((e as Error).message); }
    }
  }
  if (cfg.teamsUrl && it.event !== "closed") {   // ปิดงานแจ้งแค่อีเมลถึงผู้เปิด ไม่โพสต์ช่องทีม
    try { await postTeams(fetchFn, cfg, buildTeamsCard(it, j, users, cfg)); } catch (e) { errs.push((e as Error).message); }
  }
  return errs;
}

// ---------- สรุปรายวัน ----------
export type Reminder = { id: string; machine_no: string; machine_name?: string; pmcal_kind: string; due_date: string; days_left: number; tier: number; recipients: string[] };
export type Stale = { id: string; machine_no: string; machine_name?: string; status: string; idle_days: number; waiting_on: string[] };
const TIER: Record<number, string> = { 1: "ขั้น 1 (≤ 3 เดือน)", 2: "ขั้น 2 (≤ 2 เดือน)", 3: "ขั้น 3 (≤ 1 เดือน)" };
const left = (d: number) => d < 0 ? `เกิน ${-d} วัน` : `อีก ${d} วัน`;

export function dailyEmails(rem: Reminder[], cfg: Config) {
  const byPerson = new Map<string, Reminder[]>();
  for (const r of rem) for (const e of r.recipients ?? []) byPerson.set(e, [...(byPerson.get(e) ?? []), r]);
  return [...byPerson].map(([to, list]) => ({
    to, subject: `[CAPD] เตือน PM/CAL ${list.length} รายการ`,
    html: `<div style="font-family:Tahoma,sans-serif;font-size:14px;color:#17201d"><p>มีงาน PM/CAL ที่ยังไม่เริ่มดำเนินการ ${list.length} รายการ</p>
      <table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>ขั้น</th><th>เครื่อง</th><th>ประเภท</th><th>ครบกำหนด</th><th>เหลือ</th><th>ใบงาน</th></tr>${list.map((r) =>
        `<tr><td>${esc(TIER[r.tier])}</td><td><b>${esc(r.machine_no)}</b> ${esc(r.machine_name)}</td><td>${esc(r.pmcal_kind)}</td><td>${esc(r.due_date)}</td><td>${left(r.days_left)}</td><td><a href="${esc(jobUrl(cfg, r.id))}">${esc(r.id)}</a></td></tr>`).join("")}</table>
      <p>Member ผู้รับผิดชอบกด “เริ่มดำเนินการแล้ว” ในใบงานเพื่อหยุดการเตือน</p></div>`,
  }));
}

export function dailyTeamsCard(rem: Reminder[], stale: Stale[], users: User[], cfg: Config) {
  if (!rem.length && !stale.length) return null;
  const body: unknown[] = [{ type: "TextBlock", text: "สรุปเช้านี้ · CAPD Maintenance", weight: "Bolder", size: "Medium" }];
  if (rem.length) body.push({ type: "TextBlock", text: `PM / CAL ที่ยังไม่เริ่ม (${rem.length})`, weight: "Bolder", spacing: "Medium" },
    { type: "FactSet", facts: rem.slice(0, 15).map((r) => ({ title: `${r.machine_no} ${r.pmcal_kind}`, value: `${left(r.days_left)} · ${TIER[r.tier]} · ${nameOf(users, r.recipients?.[0] ?? "")}` })) });
  if (stale.length) body.push({ type: "TextBlock", text: `ใบงานค้างเกิน 3 วัน (${stale.length})`, weight: "Bolder", spacing: "Medium" },
    { type: "FactSet", facts: stale.slice(0, 15).map((s) => ({ title: `${s.id} ${s.machine_no}`, value: `ค้าง ${s.idle_days} วัน · รอ ${(s.waiting_on ?? []).map((e) => nameOf(users, e)).join(", ") || "-"}` })) });
  return card(body, [{ type: "Action.OpenUrl", title: "เปิดระบบ", url: cfg.appUrl }]);
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return new Response("forbidden", { status: 403 });
  const cfg: Config = { appUrl: Deno.env.get("APP_URL") ?? "", brevoKey: Deno.env.get("BREVO_API_KEY"), mailFrom: Deno.env.get("MAIL_FROM"), teamsUrl: Deno.env.get("TEAMS_WEBHOOK_URL") };
  if (!(cfg.brevoKey && cfg.mailFrom) && !cfg.teamsUrl) return Response.json({ error: "ยังไม่ได้ตั้ง BREVO_API_KEY + MAIL_FROM หรือ TEAMS_WEBHOOK_URL" }, { status: 500 });
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
    const daily = dailyTeamsCard(rem ?? [], stale ?? [], users ?? [], cfg);
    if (cfg.teamsUrl && daily) try { await postTeams(fetch, cfg, daily); } catch (e) { errs.push((e as Error).message); }
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

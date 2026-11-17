import { ALERT_MISSING_MAX, alertSubject, alertText, alertTitle, type ChecklistAlert } from "@/lib/checklist-alerts";
import { listTitle } from "@/lib/checklists";
import { dateTR } from "@/lib/format";

import { APP_URL, emailLayout, esc, FONT } from "./digest-template";

/** Personel e-postasının alt notu */
export const ALERT_FOOTER = "Bu e-posta kontrol listelerini dolduran personele gönderildi. Liste tamamlanınca hatırlatma gelmez.";

/** Listenin doldurma ekranı */
export const alertLink = (templateId: number) => `${APP_URL}/panel/kontrol/${templateId}`;

/**
 * Personele kontrol listesi hatırlatması (saatlik iş): bir ya da birkaç uyarı (gecikmeler önce), her biri başlık,
 * son saat, eksik maddeler (en çok ALERT_MISSING_MAX) ve "Listeyi aç" düğmesi. Sabah e-postasıyla aynı kabuk; ödeme ya
 * da maliyet taşımaz.
 */
export function renderChecklistAlert(alerts: ChecklistAlert[], today: string) {
  const subject = alertSubject(alerts, listTitle);
  const late = alerts.some((a) => a.kind === "late");
  const blocks = alerts
    .map((a, n) => {
      const color = a.kind === "late" ? "#b91c1c" : "#171717";
      const missing = a.missing.slice(0, ALERT_MISSING_MAX);
      const more = a.missing.length - missing.length;
      return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="${n ? "margin-top:18px;border-top:1px solid #e4e4e7;padding-top:16px" : ""}"><tr><td style="font-family:${FONT}">
  <div style="font-size:13px;line-height:18px;font-weight:600;color:${a.kind === "late" ? "#b91c1c" : "#71717a"}">${a.kind === "late" ? "Gecikti" : "Zamanı geldi"}</div>
  <h1 style="margin:4px 0 6px;font-size:${n ? 18 : 22}px;line-height:${n ? 24 : 28}px;font-weight:600;letter-spacing:-0.02em;color:${color}">${esc(alertTitle(a, listTitle))}</h1>
  <div style="font-size:14px;line-height:20px;color:#3f3f46">${esc(alertText(a))}</div>
  <ul style="margin:10px 0 0;padding-left:18px;font-size:14px;line-height:21px;color:#3f3f46">${missing.map((m) => `<li>${esc(m)}</li>`).join("")}${more > 0 ? `<li>ve ${more} madde daha</li>` : ""}</ul>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:14px"><tr><td align="center" bgcolor="#171717" style="border-radius:14px;background:#171717">
    <a href="${alertLink(a.templateId)}" style="display:block;padding:14px 20px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:14px">Listeyi aç</a>
  </td></tr></table>
</td></tr></table>`;
    })
    .join("\n");
  const html = emailLayout({
    subject,
    preheader: alerts.map((a) => alertTitle(a, listTitle)).join(" · "),
    brandSub: late ? "Kontrol listesi gecikti" : "Kontrol listesi hatırlatması",
    today,
    card: blocks,
    footer: ALERT_FOOTER,
  });
  const text = [
    `L'Affogato · ${dateTR(today)}`,
    subject,
    ...alerts.flatMap((a) => [
      "",
      `${a.kind === "late" ? "GECİKTİ" : "ZAMANI GELDİ"}: ${alertTitle(a, listTitle)}`,
      alertText(a),
      ...a.missing.slice(0, ALERT_MISSING_MAX).map((m) => `- ${m}`),
      ...(a.missing.length > ALERT_MISSING_MAX ? [`ve ${a.missing.length - ALERT_MISSING_MAX} madde daha`] : []),
      `Listeyi aç: ${alertLink(a.templateId)}`,
    ]),
    "",
    ALERT_FOOTER,
  ].join("\n");
  return { subject, html, text };
}

import { ALERT_MISSING_MAX, alertSubject, alertText, alertTitle, type ChecklistAlert } from "@/lib/checklist-alerts";
import { listTitle } from "@/lib/checklists";
import { button, divider, esc, layout, LIGHT, list, stack, statusBanner } from "@/lib/email";
import { dateTR } from "@/lib/format";

import { APP_URL } from "./digest-template";

/** Personel e-postasının alt notu */
export const ALERT_FOOTER = "Bu e-posta kontrol listelerini dolduran personele gönderildi. Liste tamamlanınca hatırlatma gelmez.";

/** Listenin doldurma ekranı */
export const alertLink = (templateId: number) => `${APP_URL}/panel/kontrol/${templateId}`;

/**
 * Personele kontrol listesi hatırlatması (saatlik iş): bir ya da birkaç uyarı (gecikmeler önce), her biri durum bandı
 * (gecikti kırmızı, zamanı geldi gri; başlık ve son saat), eksik maddeler (en çok ALERT_MISSING_MAX) ve "Listeyi aç"
 * düğmesi; uyarılar arasında ince çizgi. E-posta kitiyle (src/lib/email); ödeme ya da maliyet taşımaz.
 */
export function renderChecklistAlert(alerts: ChecklistAlert[], today: string) {
  const subject = alertSubject(alerts, listTitle);
  const late = alerts.some((a) => a.kind === "late");
  const blocks = alerts.map((a) => {
    const missing = a.missing.slice(0, ALERT_MISSING_MAX);
    const more = a.missing.length - missing.length;
    return stack(
      [
        statusBanner({ tone: a.kind === "late" ? "bad" : "neutral", eyebrow: a.kind === "late" ? "Gecikti" : "Zamanı geldi", title: alertTitle(a, listTitle), sub: alertText(a) }),
        // Sığmayanların sayısı listenin sonunda gri (madde değil, özet)
        list([...missing.map(esc), ...(more > 0 ? [`<span class="e-mute" style="color:${LIGHT.mute}">ve ${more} madde daha</span>`] : [])], { html: true }),
        button(alertLink(a.templateId), "Listeyi aç"),
      ],
      20,
    );
  });
  const html = layout({
    subject,
    preheader: alerts.map((a) => alertTitle(a, listTitle)).join(" · "),
    meta: late ? "Kontrol listesi gecikti" : "Kontrol listesi hatırlatması",
    date: today,
    body: blocks.flatMap((b, n) => (n ? [divider(), b] : [b])),
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

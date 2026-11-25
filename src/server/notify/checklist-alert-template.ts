import { ALERT_MISSING_MAX, alertSubject, alertText, alertTitle, type ChecklistAlert } from "@/lib/checklist-alerts";
import { listTitle } from "@/lib/checklists";
import { button, C, divider, emailShell, esc, FONT, heading, para, pill, TABLE, type Tone } from "@/lib/email-kit";
import { dateTR } from "@/lib/format";
import { longDateTR } from "@/lib/reminders";

import { APP_URL } from "./digest-template";

/** Personel e-postasının alt notu */
export const ALERT_FOOTER = "Bu e-posta kontrol listelerini dolduran personele gönderildi. Liste tamamlanınca hatırlatma gelmez.";

/** Listenin doldurma ekranı */
export const alertLink = (templateId: number) => `${APP_URL}/panel/kontrol/${templateId}`;

/** Uyarının rozeti: gecikme kırmızı, zamanı gelen turuncu (sabah e-postasının "gecikmiş" ve "bugün"üyle aynı ton; kelime yanında) */
const KIND: Record<ChecklistAlert["kind"], { word: string; tone: Tone }> = {
  late: { word: "Gecikti", tone: "bad" },
  due: { word: "Zamanı geldi", tone: "warn" },
};

/** İkinci ve sonraki uyarının başlığı (email-kit'in heading()'i h1; e-postada tek h1 kalsın diye kitin ölçüleriyle h2) */
const subHeading = (text: string) =>
  `<h2 style="margin:0;font-family:${FONT};font-size:20px;line-height:27px;font-weight:700;letter-spacing:-0.01em;color:${C.ink};word-break:break-word">${esc(text)}</h2>`;

/**
 * Yapılmayan maddeler (email-kit'te onay kutulu liste yok; kitin renk ve yazısıyla): her madde boş bir onay kutusuyla
 * (doldurma ekranındaki gibi), satırlar ince çizgiyle ayrılır, metin sarılır; fazlası kutusuz gri "ve N madde daha"
 */
function todoList(items: readonly string[], more: number): string {
  const row = (html: string, i: number, mark: boolean) => {
    const border = `border-top:1px solid ${i ? C.hair : C.line};`;
    return `<tr>
  <td width="30" style="${border}width:30px;padding:16px 0 12px;vertical-align:top">${mark ? `<div style="width:16px;height:16px;border:2px solid ${C.quiet};border-radius:5px;box-sizing:border-box;font-size:0;line-height:0">&nbsp;</div>` : ""}</td>
  <td style="${border}padding:12px 0;font-family:${FONT};font-size:${mark ? 15 : 14}px;line-height:22px;color:${mark ? C.ink : C.mute};vertical-align:top;word-break:break-word">${html}</td>
</tr>`;
  };
  const list = [...items.map((m, i) => row(esc(m), i, true)), ...(more > 0 ? [row(esc(`ve ${more} madde daha`), items.length, false)] : [])];
  return list.length ? `<table ${TABLE} style="border-collapse:collapse;margin-top:18px">${list.join("\n")}</table>` : "";
}

/** Bir uyarı: rozet, başlık (ilki h1), son saat ve eksik sayısı, yapılmayan maddeler, "Listeyi aç" (ilki ana düğme) */
function alertBlock(a: ChecklistAlert, n: number): string {
  const k = KIND[a.kind];
  const missing = a.missing.slice(0, ALERT_MISSING_MAX);
  const title = alertTitle(a, listTitle);
  return [
    n ? divider(36) : "",
    `<div style="margin:${n ? 30 : 0}px 0 12px">${pill(k.word, k.tone)}</div>`,
    n ? subHeading(title) : heading(title),
    para(alertText(a), { top: 8 }),
    todoList(missing, a.missing.length - missing.length),
    button(alertLink(a.templateId), "Listeyi aç", { top: 22, secondary: n > 0 }),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Personele kontrol listesi hatırlatması (saatlik iş): bir ya da birkaç uyarı (gecikmeler önce), her biri rozet,
 * başlık, son saat, eksik maddeler (en çok ALERT_MISSING_MAX) ve "Listeyi aç" düğmesi. E-postaların ortak tasarımı
 * (src/lib/email-kit.ts); ödeme ya da maliyet taşımaz.
 */
export function renderChecklistAlert(alerts: ChecklistAlert[], today: string) {
  const subject = alertSubject(alerts, listTitle);
  const late = alerts.some((a) => a.kind === "late");
  const html = emailShell({
    subject,
    preheader: alerts.map((a) => alertTitle(a, listTitle)).join(" · "),
    brandSubHtml: esc(late ? "Kontrol listesi gecikti" : "Kontrol listesi hatırlatması"),
    dateLabel: longDateTR(today),
    cardHtml: alerts.map(alertBlock).join("\n"),
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

/**
 * Personele giden karaoke e-postaları (saf; "server-only" yok, tests/karaoke-hatirlatma.test.ts sınar): rezervasyon
 * günü sabah o günün listesi ve her rezervasyondan 3 saat önce o rezervasyonun kendisi (kurallar src/lib/karaoke/
 * staff-mail.ts, gönderen src/server/karaoke/staff-mail.ts; docs/KARAOKE.md › Personel e-postaları).
 *
 * İkisinde de ödemesi alınmamış rezervasyon en üstte, kırmızı kutuda: "ÖDEME ALINMADI" ve ücretin misafir odaya girmeden,
 * önden alınacağı. Tutar yazılmaz (personel tutar görmez; ücret kasada). Konu ve ön izleme misafirin adını taşımaz
 * (telefonun kilit ekranında görünür); ad yalnız gövdede. Kabuk sabah e-postasıyla aynı (emailLayout).
 */

import { durationLabel, trClock } from "@/lib/karaoke/session";
import { staffPay, type StaffMailSession } from "@/lib/karaoke/staff-mail";
import { dateTR } from "@/lib/format";

import { APP_URL, emailLayout, esc, FONT } from "./digest-template";

export const STAFF_KARAOKE_FOOTER = "Bu e-posta karaoke rezervasyonu olan günlerde vardiyadaki personele gönderilir. Ücret kasada görünür; e-postada tutar yazmaz.";
/** Ödemesi alınmamış rezervasyonun cümlesi (iki e-postada ve ekranda aynı söz) */
export const COLLECT_FIRST = "Ücreti misafir odaya girmeden ÖNCE, kasada alın.";

const KARAOKE_LINK = `${APP_URL}/panel/karaoke`;
const range = (s: Pick<StaffMailSession, "startsAt" | "endsAt">) => `${trClock(Date.parse(s.startsAt)).time}–${trClock(Date.parse(s.endsAt)).time}`;
const who = (s: Pick<StaffMailSession, "customerName" | "guests">) => [s.customerName?.trim() || "İsimsiz", s.guests ? `${s.guests} kişi` : null].filter(Boolean).join(" · ");

/** Ödeme rozeti: alınmadıysa kırmızı ve büyük harf, sitede ödendiyse yeşil */
function payBadge(s: StaffMailSession): string {
  const collect = staffPay(s) === "collect";
  const text = collect ? (s.status === "requested" ? "ÖDEME ALINMADI · onay bekliyor" : "ÖDEME ALINMADI") : "Ödendi (sitede)";
  return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${collect ? "#dc2626" : "#dcfce7"};color:${collect ? "#ffffff" : "#166534"};font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:0.02em;white-space:nowrap">${esc(text)}</span>`;
}

/** Ödeme alınacak rezervasyonların kırmızı kutusu (yoksa boş) */
function collectBox(count: number, single: boolean): string {
  if (!count) return "";
  const title = single ? "ÖDEME ALINMADI" : `ÖDEME ALINACAK: ${count} rezervasyon`;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 16px"><tr><td bgcolor="#dc2626" style="background:#dc2626;border-radius:16px;padding:14px 16px;font-family:${FONT}">
  <div style="font-size:18px;line-height:24px;font-weight:800;letter-spacing:0.01em;color:#ffffff">${esc(title)}</div>
  <div style="padding-top:4px;font-size:15px;line-height:21px;font-weight:600;color:#ffffff">${esc(COLLECT_FIRST)}</div>
  <div style="padding-top:2px;font-size:13px;line-height:19px;color:#fee2e2">${count === 1 ? "Bu rezervasyon" : "Bu rezervasyonlar"} sitede ödenmedi; ücret kasadan tahsil edilir.</div>
</td></tr></table>`;
}

function button(): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:18px"><tr><td align="center" bgcolor="#171717" style="border-radius:14px;background:#171717">
    <a href="${KARAOKE_LINK}" style="display:block;padding:14px 20px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:14px">Karaoke ekranını aç</a>
  </td></tr></table>`;
}

/** Bir rezervasyonun satırı: saat, kim, ödeme rozeti, not */
function sessionBlock(s: StaffMailSession, first: boolean): string {
  const collect = staffPay(s) === "collect";
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="${first ? "" : "margin-top:12px;"}border:1px solid ${collect ? "#fecaca" : "#e4e4e7"};border-radius:16px;background:${collect ? "#fef2f2" : "#ffffff"}"><tr><td style="padding:14px 16px;font-family:${FONT}">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
    <td style="font-size:22px;line-height:28px;font-weight:700;letter-spacing:-0.02em;color:#171717;white-space:nowrap">${esc(range(s))}</td>
    <td align="right" style="vertical-align:middle">${payBadge(s)}</td>
  </tr></table>
  <div style="padding-top:4px;font-size:15px;line-height:21px;color:#3f3f46">${esc(who(s))}${s.desk === "booking" ? ` <span style="color:#71717a">· elle eklendi</span>` : ""}</div>
  ${collect ? `<div style="padding-top:6px;font-size:14px;line-height:20px;font-weight:600;color:#b91c1c">${esc(COLLECT_FIRST)}</div>` : ""}
  ${s.note?.trim() ? `<div style="padding-top:6px;font-size:13px;line-height:19px;color:#52525b">Not: ${esc(s.note.trim())}</div>` : ""}
</td></tr></table>`;
}

function sessionText(s: StaffMailSession): string[] {
  const collect = staffPay(s) === "collect";
  return [
    `${range(s)} · ${who(s)}${s.desk === "booking" ? " · elle eklendi" : ""}`,
    collect ? `  ÖDEME ALINMADI${s.status === "requested" ? " (onay bekliyor)" : ""}: ${COLLECT_FIRST}` : "  Ödendi (sitede)",
    ...(s.note?.trim() ? [`  Not: ${s.note.trim()}`] : []),
  ];
}

/** Sabah e-postası: bugünün rezervasyonları (en az bir tane), ödeme alınacaklar üstteki kutuda sayılır */
export function renderStaffMorning(sessions: StaffMailSession[], today: string) {
  const collect = sessions.filter((s) => staffPay(s) === "collect").length;
  const n = sessions.length;
  const times = sessions.map(range).join(", ");
  const subject =
    n === 1
      ? `Bugün karaoke: ${times} · ${collect ? "ÖDEME ALINACAK" : "ödendi"}`
      : `Bugün ${n} karaoke rezervasyonu${collect ? ` · ${collect === n ? "hepsinde" : `${collect} rezervasyonda`} ÖDEME ALINACAK` : " · hepsi ödendi"}`;
  const headline = n === 1 ? "Bugün 1 karaoke rezervasyonu var" : `Bugün ${n} karaoke rezervasyonu var`;
  const card = `${collectBox(collect, false)}
<h1 style="margin:0 0 4px;font-family:${FONT};font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.02em;color:#171717">${esc(headline)}</h1>
<div style="margin:0 0 14px;font-family:${FONT};font-size:14px;line-height:20px;color:#52525b">Odayı saatinden önce hazırlayın. Her rezervasyondan 3 saat önce ayrıca hatırlatma gelir.</div>
${sessions.map((s, k) => sessionBlock(s, k === 0)).join("\n")}
${button()}`;
  const html = emailLayout({
    subject,
    preheader: `${times}${collect ? ` · ${collect} rezervasyonda ödeme alınacak` : ""}`,
    brandSub: "Karaoke · bugün",
    today,
    card,
    footer: STAFF_KARAOKE_FOOTER,
  });
  const text = [
    `L'Affogato · ${dateTR(today)}`,
    headline,
    ...(collect ? ["", `ÖDEME ALINACAK: ${collect} rezervasyon. ${COLLECT_FIRST}`] : []),
    "",
    ...sessions.flatMap(sessionText),
    "",
    `Karaoke ekranı: ${KARAOKE_LINK}`,
    "",
    STAFF_KARAOKE_FOOTER,
  ].join("\n");
  return { subject, html, text };
}

/** "3 saat kala" e-postası: tek rezervasyon; ödeme alınmadıysa konu ve en üstteki kutu bunu söyler */
export function renderStaffSoon(s: StaffMailSession, nowMs: number) {
  const collect = staffPay(s) === "collect";
  const start = Date.parse(s.startsAt);
  const from = trClock(start).time;
  // 3 saat kala gider; tetikleyici geciktiyse gerçekte kalan süre yazılır
  const left = durationLabel(Math.max(1, Math.round((start - nowMs) / 60_000 / 5) * 5));
  const subject = `Karaoke ${from} (${left} sonra) · ${collect ? "ÖDEME ALINACAK" : "ödendi"}`;
  const headline = `Karaoke ${left} sonra başlıyor`;
  const today = trClock(nowMs).date;
  const card = `${collectBox(collect ? 1 : 0, true)}
<h1 style="margin:0 0 12px;font-family:${FONT};font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.02em;color:#171717">${esc(headline)}</h1>
${sessionBlock(s, true)}
<div style="margin:14px 0 0;font-family:${FONT};font-size:14px;line-height:20px;color:#52525b">Odayı saatinden önce hazırlayın; sayaç ${esc(from)} olunca kendiliğinden başlar.</div>
${button()}`;
  const html = emailLayout({
    subject,
    preheader: `${range(s)}${s.guests ? ` · ${s.guests} kişi` : ""}${collect ? " · ödeme alınmadı, önden alın" : " · ödendi"}`,
    brandSub: "Karaoke · 3 saat kala",
    today,
    card,
    footer: STAFF_KARAOKE_FOOTER,
  });
  const text = [`L'Affogato · ${dateTR(today)}`, headline, "", ...sessionText(s), "", `Karaoke ekranı: ${KARAOKE_LINK}`, "", STAFF_KARAOKE_FOOTER].join("\n");
  return { subject, html, text };
}

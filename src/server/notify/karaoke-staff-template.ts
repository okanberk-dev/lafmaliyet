/**
 * Personele giden karaoke e-postaları (saf; "server-only" yok, tests/karaoke-hatirlatma.test.ts sınar): rezervasyon
 * günü sabah o günün listesi ve her rezervasyondan 3 saat önce o rezervasyonun kendisi (kurallar src/lib/karaoke/
 * staff-mail.ts, gönderen src/server/karaoke/staff-mail.ts; docs/KARAOKE.md › Personel e-postaları).
 *
 * İkisinde de ödemesi alınmamış rezervasyon en üstte, kırmızı kutuda: "ÖDEME ALINMADI" ve ücretin misafir odaya girmeden,
 * önden alınacağı. Tutar yazılmaz (personel tutar görmez; ücret kasada). Konu ve ön izleme misafirin adını taşımaz
 * (telefonun kilit ekranında görünür); ad yalnız gövdede. Görünüm ortak e-posta tasarımından (src/lib/email-kit.ts:
 * kabuk, başlık, kırmızı kutu, düğme); her rezervasyon kendi kutusunda, ödeme rozeti saatin yanında (dar ekranda altına
 * iner). Renk tek başına anlam taşımaz: kırmızının yanında hep "ÖDEME ALINMADI" yazar.
 */

import { button, C, callout, emailShell, esc, FONT, heading, para, pill, TABLE, TONE } from "@/lib/email-kit";
import { durationLabel, trClock } from "@/lib/karaoke/session";
import { staffPay, type StaffMailSession } from "@/lib/karaoke/staff-mail";
import { dateTR } from "@/lib/format";
import { longDateTR } from "@/lib/reminders";

import { APP_URL } from "./digest-template";

export const STAFF_KARAOKE_FOOTER = "Bu e-posta karaoke rezervasyonu olan günlerde vardiyadaki personele gönderilir. Ücret kasada görünür; e-postada tutar yazmaz.";
/** Ödemesi alınmamış rezervasyonun cümlesi (iki e-postada ve ekranda aynı söz) */
export const COLLECT_FIRST = "Ücreti misafir odaya girmeden ÖNCE, kasada alın.";

const KARAOKE_LINK = `${APP_URL}/panel/karaoke`;
const range = (s: Pick<StaffMailSession, "startsAt" | "endsAt">) => `${trClock(Date.parse(s.startsAt)).time}–${trClock(Date.parse(s.endsAt)).time}`;
const who = (s: Pick<StaffMailSession, "customerName" | "guests">) => [s.customerName?.trim() || "İsimsiz", s.guests ? `${s.guests} kişi` : null].filter(Boolean).join(" · ");

/**
 * Ödeme rozeti: alınmadıysa kırmızı zeminde beyaz, büyük harf (kırmızı kutunun içinde de seçilsin; kitin `pill`'i açık
 * zeminli, bu yüzden yerel), sitede ödendiyse kitin yeşil rozeti
 */
function payBadge(s: StaffMailSession): string {
  if (staffPay(s) !== "collect") return pill("Ödendi (sitede)", "good");
  const text = s.status === "requested" ? "ÖDEME ALINMADI · onay bekliyor" : "ÖDEME ALINMADI";
  return `<span style="display:inline-block;padding:4px 11px;border-radius:999px;background:${TONE.bad.dot};color:#ffffff;font-family:${FONT};font-size:12px;line-height:18px;font-weight:700;letter-spacing:0.02em;white-space:nowrap;vertical-align:middle">${esc(text)}</span>`;
}

/** Ödeme alınacak rezervasyonların kırmızı kutusu (kitin `callout`'u, başlığı büyük; yoksa boş) */
function collectBox(count: number, single: boolean): string {
  if (!count) return "";
  const title = single ? "ÖDEME ALINMADI" : `ÖDEME ALINACAK: ${count} rezervasyon`;
  return callout("bad", [], {
    top: 0,
    html: `<div style="font-size:17px;line-height:24px;font-weight:700;letter-spacing:0.01em">${esc(title)}</div>
  <div style="margin-top:6px;font-size:15px;line-height:22px;font-weight:600">${esc(COLLECT_FIRST)}</div>
  <div style="margin-top:4px">${count === 1 ? "Bu rezervasyon" : "Bu rezervasyonlar"} sitede ödenmedi; ücret kasadan tahsil edilir.</div>`,
  });
}

/**
 * Bir rezervasyonun kutusu: büyük saat ve yanında ödeme rozeti (satıra sığmazsa alta iner), kim, ödenmediyse "önden
 * alın", not. Ödenmemiş rezervasyonun kutusu açık kırmızı (yapılacak iş var), ödenmişinki beyaz ve ince çerçeveli (yeşil
 * rozet seçilsin). Çerçeveli hücrenin köşesi için tablo ayrık kenarlı (kabuğun `border-collapse:collapse`'ı düzleştirir)
 */
function sessionBlock(s: StaffMailSession, first: boolean): string {
  const collect = staffPay(s) === "collect";
  const note = s.note?.trim();
  const box = collect ? `background:${TONE.bad.bg};padding:18px 20px` : `background:${C.card};border:1px solid ${C.line};padding:17px 19px`;
  return `<table ${TABLE} style="margin-top:${first ? 0 : 12}px;border-collapse:separate;border-spacing:0"><tr><td style="${box};border-radius:18px;font-family:${FONT};word-break:break-word">
  <div style="line-height:30px"><span style="font-size:22px;line-height:30px;font-weight:700;letter-spacing:-0.02em;color:${C.ink};white-space:nowrap;font-variant-numeric:tabular-nums;vertical-align:middle;padding-right:10px">${esc(range(s))}</span> ${payBadge(s)}</div>
  <div style="margin-top:6px;font-size:15px;line-height:22px;color:${C.soft}">${esc(who(s))}${s.desk === "booking" ? ` <span style="color:${C.mute}">· elle eklendi</span>` : ""}</div>${collect ? `\n  <div style="margin-top:8px;font-size:15px;line-height:22px;font-weight:600;color:${TONE.bad.fg}">${esc(COLLECT_FIRST)}</div>` : ""}${note ? `\n  <div style="margin-top:10px;padding-top:10px;border-top:1px solid ${collect ? C.card : C.hair};font-size:14px;line-height:21px;color:${C.soft}">Not: ${esc(note)}</div>` : ""}
</td></tr></table>`;
}

/** Kırmızı kutu varsa başlığın üstünde ondan ayıran boşluk */
const gap = (px: number) => `<div style="height:${px}px;line-height:${px}px;font-size:0">&nbsp;</div>`;

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
  const box = collectBox(collect, false);
  const card = `${box}${box ? `\n${gap(26)}` : ""}
${heading(headline, { sub: "Odayı saatinden önce hazırlayın. Her rezervasyondan 3 saat önce ayrıca hatırlatma gelir." })}
${gap(22)}
${sessions.map((s, k) => sessionBlock(s, k === 0)).join("\n")}
${button(KARAOKE_LINK, "Karaoke ekranını aç", { top: 28 })}`;
  const html = emailShell({
    subject,
    preheader: `${times}${collect ? ` · ${collect} rezervasyonda ödeme alınacak` : ""}`,
    brandSubHtml: esc("Karaoke · bugün"),
    dateLabel: longDateTR(today),
    cardHtml: card,
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
  const box = collectBox(collect ? 1 : 0, true);
  const card = `${box}${box ? `\n${gap(26)}` : ""}
${heading(headline)}
${gap(20)}
${sessionBlock(s, true)}
${para(`Odayı saatinden önce hazırlayın; sayaç ${from} olunca kendiliğinden başlar.`, { top: 18 })}
${button(KARAOKE_LINK, "Karaoke ekranını aç", { top: 28 })}`;
  const html = emailShell({
    subject,
    preheader: `${range(s)}${s.guests ? ` · ${s.guests} kişi` : ""}${collect ? " · ödeme alınmadı, önden alın" : " · ödendi"}`,
    brandSubHtml: esc("Karaoke · 3 saat kala"),
    dateLabel: longDateTR(today),
    cardHtml: card,
    footer: STAFF_KARAOKE_FOOTER,
  });
  const text = [`L'Affogato · ${dateTR(today)}`, headline, "", ...sessionText(s), "", `Karaoke ekranı: ${KARAOKE_LINK}`, "", STAFF_KARAOKE_FOOTER].join("\n");
  return { subject, html, text };
}

/**
 * Misafire giden karaoke hatırlatma e-postası (saf; "server-only" yok, tests/karaoke-hatirlatma.test.ts sınar). Elle
 * eklenen rezervasyonda e-posta yazıldıysa rezervasyondan bir gün önce bir kez gider (kurallar src/lib/karaoke/
 * reminder.ts, gönderen src/server/karaoke/reminders.ts; docs/KARAOKE.md › Hatırlatma e-postası).
 *
 * Panelin öteki e-postaları yöneticiye ve personele gider; bu tek ileti misafire gittiği için kendi görünümü var: üstte
 * L'Affogato yazısı, koyu "bilet" kartında gün ve saat, altında üç kısa bilgi ve "Takvime ekle". E-posta istemcileri
 * flex ve dış CSS tanımadığı için tablolar ve satır içi stiller; tek resim sitenin e-postalarındaki L'Af işareti
 * (laffogato.net'ten; engellenirse yerinde "L'Affogato" yazısı görünür), renkler de sitenin e-postalarınınki. Tutar yazmaz:
 * ücret kafede alınır. Tanıtım içermez (yalnız rezervasyonun bilgisi: ticari ileti değil).
 */

import { reminderDay } from "@/lib/karaoke/reminder";
import { durationLabel, trClock } from "@/lib/karaoke/session";
import { longDateTR } from "@/lib/reminders";

import { esc, FONT } from "./digest-template";

export interface KaraokeReminderInput {
  /** Misafirin adı (sitenin panele verdiği ilk ad); boşsa adsız selam */
  firstName: string | null;
  /** Rezervasyonun günü (Türkiye), YYYY-MM-DD */
  date: string;
  startsAt: number;
  endsAt: number;
  guests: number | null;
  /** Ücret sitede ödenmiş mi (elle rezervasyonda hayır: kafede alınır) */
  paid: boolean;
  /** Gönderildiği an: "Yarın" / "Bugün" sözü buna göre */
  nowMs: number;
  /** laffogato.net (alt bağlantı) */
  siteUrl: string;
}

const SERIF = "Georgia,'Times New Roman',Times,serif";
const INK = "#1e2a25";
/** laffogato.net e-postalarının renkleri (site: src/lib/email/templates): derin yeşil bant, altın vurgu, adaçayı */
const GREEN = "#173f35";
const GOLD = "#cba258";
const SAGE = "#c3d3cb";
/** Sitenin e-postalarındaki işaret: derin yeşil zeminde beyaz L'Af, altın çekirdek (162×132, 54×44 basılır) */
export const LOGO_URL = "https://laffogato.net/email/laf-mark-white.png";
/** Köşkün adresi ve telefonu (sitenin e-posta altlığındaki değerler: laffogato src/lib/seo/site.ts) */
export const VENUE = {
  address: "Postane Mah. Atatürk Cad. No: 28 İç Kapı No: 1, 34940 Tuzla / İstanbul",
  phone: "+90 536 429 09 19",
  phoneTel: "+905364290919",
} as const;

/** Selamda yalnız ilk ad, baş harfi büyük ("ayşe yılmaz" → "Ayşe") */
export function greetingName(name: string | null): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first) return null;
  return first.charAt(0).toLocaleUpperCase("tr-TR") + first.slice(1);
}

/** Google Takvim'e ekleme bağlantısı (saatler UTC; yer adı dışında kişisel bilgi taşımaz) */
export function calendarLink(startsAt: number, endsAt: number): string {
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: "Karaoke · L'Affogato",
    dates: `${stamp(startsAt)}/${stamp(endsAt)}`,
    location: `L'Affogato, ${VENUE.address}`,
    details: "L'Affogato karaoke odası rezervasyonunuz.",
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

export function renderKaraokeReminder(i: KaraokeReminderInput): { subject: string; html: string; text: string } {
  const day = reminderDay(i.date, i.nowMs);
  const name = greetingName(i.firstName);
  const from = trClock(i.startsAt).time;
  const to = trClock(i.endsAt).time;
  const dateLong = longDateTR(i.date);
  const length = durationLabel(Math.round((i.endsAt - i.startsAt) / 60_000));
  const meta = [length, i.guests ? `${i.guests} kişi` : null].filter(Boolean).join(" · ");

  const eyebrow = day === "tomorrow" ? "YARIN" : day === "today" ? "BUGÜN" : "YAKLAŞIYOR";
  const headline =
    day === "tomorrow"
      ? `Yarın görüşüyoruz${name ? `, ${name}` : ""}!`
      : day === "today"
        ? `Bugün görüşüyoruz${name ? `, ${name}` : ""}!`
        : `Karaoke gününüz yaklaşıyor${name ? `, ${name}` : ""}!`;
  // Saat eki almaz ("20:00'de", "13:00'te" ayrımı yanlış yazılmasın): aralık olarak söylenir
  const lead =
    day === "today"
      ? `Karaoke odanız bugün ${from}–${to} arasında sizin için ayrıldı.`
      : day === "tomorrow"
        ? `Karaoke odanız yarın ${from}–${to} arasında sizin için ayrıldı.`
        : `Karaoke odanız ${dateLong} günü ${from}–${to} arasında sizin için ayrıldı.`;
  const subject =
    day === "tomorrow" ? `Yarın karaoke: ${from}–${to} · L'Affogato` : day === "today" ? `Bugün karaoke: ${from}–${to} · L'Affogato` : `Karaoke rezervasyonunuz: ${dateLong} ${from}–${to} · L'Affogato`;
  const preheader = `${dateLong}, ${from}–${to}${i.guests ? ` · ${i.guests} kişi` : ""}. Odanız hazır olacak.`;

  const notes: { title: string; body: string }[] = [
    { title: "Süreniz saatinde başlar", body: `Odadaki süreniz rezervasyon saatinde (${from}) başlar; birkaç dakika önce gelmeniz yeterli.` },
    i.paid ? { title: "Ödemeniz alındı", body: "Rezervasyonunuzun ücreti ödendi; kafede ayrıca ödeme gerekmez." } : { title: "Ödeme kafede", body: "Rezervasyonunuzun ücreti geldiğinizde kasada alınır." },
    { title: "Planınız mı değişti?", body: `Lütfen bize haber verin (${VENUE.phone}); saatinizi başka misafirlere açabilelim.` },
  ];
  const calendar = calendarLink(i.startsAt, i.endsAt);
  const site = i.siteUrl.replace(/\/+$/, "");
  const siteLabel = site.replace(/^https?:\/\//, "");
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`L'Affogato, ${VENUE.address}`)}`;
  const footer = "Bu e-posta, L'Affogato'da adınıza yapılan karaoke rezervasyonunu hatırlatmak için bir kez gönderildi; tanıtım iletisi değildir.";

  const noteRows = notes
    .map(
      (n, k) => `<tr>
        <td width="34" valign="top" style="width:34px;padding:${k ? 16 : 0}px 0 0">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td width="26" height="26" align="center" style="width:26px;height:26px;border-radius:13px;background:#eef4f0;font-family:${FONT};font-size:12px;line-height:26px;font-weight:700;color:${INK}">${k + 1}</td></tr></table>
        </td>
        <td valign="top" style="padding:${k ? 16 : 0}px 0 0 6px;font-family:${FONT}">
          <div style="font-size:15px;line-height:21px;font-weight:600;color:${INK}">${esc(n.title)}</div>
          <div style="font-size:14px;line-height:21px;color:#52525b">${esc(n.body)}</div>
        </td>
      </tr>`,
    )
    .join("\n");

  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f2f5f1;-webkit-text-size-adjust:100%;font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f2f5f1"><tr><td align="center" style="padding:28px 12px 32px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px">
  <tr><td align="center" bgcolor="${GREEN}" style="background:${GREEN};border-radius:28px 28px 0 0;padding:30px 26px 0;line-height:0;font-size:0">
    <img src="${LOGO_URL}" width="54" height="44" alt="L'Affogato" style="display:inline-block;border:0;outline:none;text-decoration:none;width:54px;height:44px;font-family:${SERIF};font-size:20px;line-height:44px;color:#ffffff">
    <div style="padding-top:8px;font-family:${FONT};font-size:11px;line-height:16px;font-weight:600;letter-spacing:0.22em;color:${SAGE}">KARAOKE</div>
  </td></tr>
  <tr><td bgcolor="${GREEN}" style="background:${GREEN};padding:22px 26px 6px">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${GOLD}" style="background:${GOLD};border-radius:999px;padding:5px 12px;font-family:${FONT};font-size:11px;line-height:14px;font-weight:700;letter-spacing:0.14em;color:${GREEN}">${eyebrow}</td></tr></table>
    <h1 style="margin:16px 0 8px;font-family:${SERIF};font-size:30px;line-height:36px;font-weight:400;letter-spacing:-0.01em;color:#ffffff">${esc(headline)}</h1>
    <div style="font-family:${FONT};font-size:15px;line-height:22px;color:${SAGE}">${esc(lead)}</div>
  </td></tr>
  <tr><td bgcolor="${GREEN}" style="background:${GREEN};padding:20px 26px 28px;border-radius:0 0 28px 28px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #3f6658;border-radius:20px"><tr>
      <td style="padding:18px 20px;font-family:${FONT}">
        <div style="font-size:11px;line-height:14px;font-weight:600;letter-spacing:0.14em;color:${SAGE}">REZERVASYONUNUZ</div>
        <div style="padding-top:8px;font-size:34px;line-height:38px;font-weight:700;letter-spacing:-0.02em;color:${GOLD};white-space:nowrap">${esc(from)}&nbsp;–&nbsp;${esc(to)}</div>
        <div style="padding-top:6px;font-size:17px;line-height:23px;font-weight:600;color:#ffffff">${esc(dateLong)}</div>
        <div style="padding-top:2px;font-size:14px;line-height:20px;color:${SAGE}">${esc(meta)}</div>
        <div style="padding-top:10px;font-size:13px;line-height:19px;color:${SAGE}">${esc(VENUE.address)}</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="height:12px;line-height:12px;font-size:0">&nbsp;</td></tr>
  <tr><td bgcolor="#ffffff" style="background:#ffffff;border-radius:28px;padding:26px 24px 24px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      ${noteRows}
    </table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:24px"><tr><td align="center" bgcolor="${GREEN}" style="border-radius:16px;background:${GREEN}">
      <a href="${esc(calendar)}" target="_blank" rel="noopener noreferrer" style="display:block;padding:15px 20px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:16px">Takvime ekle</a>
    </td></tr></table>
    <div style="padding-top:14px;text-align:center;font-family:${FONT};font-size:14px;line-height:20px"><a href="${esc(maps)}" target="_blank" rel="noopener noreferrer" style="color:${GREEN};text-decoration:underline">Yol tarifi</a> &nbsp;·&nbsp; <a href="tel:${VENUE.phoneTel}" style="color:${GREEN};text-decoration:underline">${esc(VENUE.phone)}</a> &nbsp;·&nbsp; <a href="${esc(site)}" target="_blank" rel="noopener noreferrer" style="color:${GREEN};text-decoration:underline">${esc(siteLabel)}</a></div>
  </td></tr>
  <tr><td align="center" style="padding:18px 16px 0;font-family:${FONT};font-size:12px;line-height:18px;color:#a8a29e">
    <div style="font-family:${SERIF};font-size:15px;line-height:20px;color:#5b6a63">L&#39;Affogato · Tuzla</div>
    <div style="padding-top:2px">${esc(VENUE.address)} · ${esc(VENUE.phone)}</div>
    <div style="padding-top:6px">${esc(footer)}</div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    headline,
    lead,
    "",
    `Rezervasyonunuz: ${dateLong}, ${from}–${to}${meta ? ` (${meta})` : ""}`,
    `Yer: L'Affogato, ${VENUE.address}`,
    `Telefon: ${VENUE.phone}`,
    "",
    ...notes.map((n, k) => `${k + 1}. ${n.title}: ${n.body}`),
    "",
    `Takvime ekle: ${calendar}`,
    site,
    "",
    footer,
  ].join("\n");

  return { subject, html, text };
}

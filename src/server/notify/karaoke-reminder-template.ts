/**
 * Misafire giden karaoke hatırlatma e-postası (saf; "server-only" yok, tests/karaoke-hatirlatma.test.ts sınar). Elle
 * eklenen rezervasyonda e-posta yazıldıysa rezervasyondan bir gün önce bir kez gider (kurallar src/lib/karaoke/
 * reminder.ts, gönderen src/server/karaoke/reminders.ts; docs/KARAOKE.md › Hatırlatma e-postası).
 *
 * Panelin öteki e-postaları yöneticiye ve personele gider, ortak kabuğu (src/lib/email-kit.ts `emailShell`) panelin L'Af
 * karosuyla açılır. Bu tek ileti misafire gittiği için sitenin e-postalarının kimliğini taşır: derin yeşil bantta L'Af
 * işareti, altın rozet ve büyük saat ("bilet"), altında beyaz kartta üç kısa bilgi, "Takvime ekle" ve yol tarifi / telefon
 * / site. Kabuk bu yüzden burada (`guestDocument`), ama kitin kurallarıyla: tablo düzeni, satır içi stiller, Outlook için
 * 600 px'lik koşullu tablo, yalnız açık renk, ön izlemenin arkasına dolgu ve telefonda (≤ 620 px) daralan kenarlar.
 * Yazı, nötr renkler, başlık (`heading`) ve ana eylem (`button`) kitten. Tek resim sitenin e-postalarındaki L'Af işareti
 * (laffogato.net'ten; engellenirse yerinde "L'Affogato" yazısı görünür). Tutar yazmaz: ücret kafede alınır. Tanıtım
 * içermez (yalnız rezervasyonun bilgisi: ticari ileti değil).
 */

import { button, C, esc, FONT, heading, TABLE } from "@/lib/email-kit";
import { reminderDay } from "@/lib/karaoke/reminder";
import { durationLabel, trClock } from "@/lib/karaoke/session";
import { longDateTR } from "@/lib/reminders";

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
/**
 * laffogato.net e-postalarının renkleri (site: src/lib/email/templates): derin yeşil bant, altın vurgu, adaçayı yazı,
 * bandın içindeki biletin çizgisi, açık yeşil zemin ve madde numarası. Nötr renkler (kart, yazı, çizgi) kitten (`C`).
 */
const GREEN = "#173f35";
const GOLD = "#cba258";
const SAGE = "#c3d3cb";
const TICKET_LINE = "#3f6658";
const CANVAS = "#f2f5f1";
const MINT = "#e6efe9";
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

/** Ön izleme satırının arkasına gövdenin sızmaması için dolgu (kitin kabuğundaki gibi; Gmail ve Apple Mail ~100 karakter gösterir) */
const PREHEADER_FILL = "&#847;&zwnj;&nbsp;".repeat(60);

/**
 * Telefon ayarı (≤ 620 px; okumayan istemci masaüstü düzenini gösterir, o da 390 px'e sığar): kenarlar daralır, büyük
 * saat ve başlık küçülür (`em-hero`, `em-h1` kitin sınıf adları: `heading` h1'i bu sınıfla yazar)
 */
const GUEST_MOBILE_CSS = `@media only screen and (max-width:620px){
.g-outer{padding:12px 8px 28px !important}
.g-band{padding:28px 20px 24px !important;border-radius:22px !important}
.g-ticket{padding:18px 18px 18px !important}
.g-card{padding:28px 20px 24px !important;border-radius:22px !important}
.g-foot{padding:20px 14px 0 !important}
.em-hero{font-size:34px !important;line-height:40px !important}
.em-h1{font-size:22px !important;line-height:28px !important}
}`;

/**
 * Misafir e-postasının kabuğu (kitin `emailShell`'i panelin L'Af karosuyla açılır; misafir sitenin kimliğini görür):
 * açık yeşil zemin, üstte derin yeşil bant, altında beyaz kart, en altta ortalı adres ve not. Kural kitinkiyle aynı: en
 * çok 600 px, Outlook için koşullu tablo, yalnız açık renk. Argümanlar hazır HTML'dir (konu ve ön izleme düz metin)
 */
function guestDocument(o: { subject: string; preheader: string; bandHtml: string; cardHtml: string; footerHtml: string }): string {
  return `<!doctype html><html lang="tr" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"><meta name="x-apple-disable-message-reformatting"><meta name="format-detection" content="telephone=no,date=no,address=no,email=no"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(o.subject)}</title>
<style>:root{color-scheme:light;supported-color-schemes:light}body{margin:0;padding:0}table{border-collapse:collapse}
${GUEST_MOBILE_CSS}</style></head>
<body style="margin:0;padding:0;background:${CANVAS};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;font-family:${FONT};color:${C.ink}">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${CANVAS}">${esc(o.preheader)}${PREHEADER_FILL}</div>
<table ${TABLE} style="background:${CANVAS}"><tr><td align="center" class="g-outer" style="padding:32px 16px 44px">
<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table ${TABLE} style="max-width:600px">
  <tr><td class="g-band" bgcolor="${GREEN}" style="background:${GREEN};border-radius:24px;padding:34px 28px 30px">
${o.bandHtml}
  </td></tr>
  <tr><td style="height:14px;line-height:14px;font-size:0">&nbsp;</td></tr>
  <tr><td class="g-card" bgcolor="${C.card}" style="background:${C.card};border-radius:24px;padding:34px 32px 30px">
${o.cardHtml}
  </td></tr>
  <tr><td class="g-foot" align="center" style="padding:24px 24px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.mute};text-align:center;word-break:break-word">
${o.footerHtml}
  </td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
}

/**
 * Bandın içindeki "bilet": küçük başlık, altın renkte büyük saat aralığı (bölünmez), gün, süre ve kişi; kesik çizginin
 * altında adres. Saat masaüstünde 36 px: telefon ayarını okumayan istemcide de 390 px'e sığar
 */
function ticketHtml(t: { from: string; to: string; dateLong: string; meta: string }): string {
  // Kabuğun `table{border-collapse:collapse}` kuralı çerçeveli hücrenin köşesini düzleştirir: bilet ayrık kenarlı
  return `<table ${TABLE} style="margin-top:24px;border-collapse:separate;border-spacing:0"><tr><td class="g-ticket" style="border:1px solid ${TICKET_LINE};border-radius:18px;padding:20px 20px 20px;font-family:${FONT}">
  <div style="font-size:11px;line-height:14px;font-weight:600;letter-spacing:0.14em;color:${SAGE}">REZERVASYONUNUZ</div>
  <div class="em-hero" style="padding-top:10px;font-size:36px;line-height:42px;font-weight:700;letter-spacing:-0.02em;color:${GOLD};white-space:nowrap;font-variant-numeric:tabular-nums">${esc(t.from)}&nbsp;–&nbsp;${esc(t.to)}</div>
  <div style="padding-top:8px;font-size:17px;line-height:24px;font-weight:600;color:#ffffff">${esc(t.dateLong)}</div>${t.meta ? `\n  <div style="padding-top:2px;font-size:15px;line-height:22px;color:${SAGE}">${esc(t.meta)}</div>` : ""}
  <div style="margin-top:16px;padding-top:14px;border-top:1px dashed ${TICKET_LINE};font-size:13px;line-height:20px;color:${SAGE};word-break:break-word">${addressHtml()}</div>
</td></tr></table>`;
}

/**
 * Kaçışlı metindeki parçalar (telefon numarası, saat aralığı, adresin "34940 Tuzla / İstanbul" sonu) satır sonunda
 * bölünmez: metin aynı, yalnız sarılma
 */
const keepTogether = (html: string, ...pieces: string[]) =>
  pieces.reduce((h, p) => h.split(esc(p)).join(`<span style="white-space:nowrap">${esc(p)}</span>`), html);
/** Adresin bölünmeyen sonu (posta kodu, ilçe, il) */
const CITY = VENUE.address.slice(VENUE.address.lastIndexOf(", ") + 2);
const addressHtml = () => keepTogether(esc(VENUE.address), CITY);

/** Numaralı kısa bilgiler (kitte yok): yeşil halkada numara, kalın başlık, altında açıklama; aralar ferah */
function stepsHtml(list: readonly { title: string; body: string }[]): string {
  const rowsHtml = list.map((n, k) => {
    const top = k ? 22 : 0;
    return `<tr>
  <td width="42" valign="top" style="width:42px;padding:${top}px 0 0;vertical-align:top">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td width="28" height="28" align="center" style="width:28px;height:28px;border-radius:14px;background:${MINT};font-family:${FONT};font-size:13px;line-height:28px;font-weight:700;color:${GREEN}">${k + 1}</td></tr></table>
  </td>
  <td valign="top" style="padding:${top}px 0 0;font-family:${FONT};vertical-align:top;word-break:break-word">
    <div style="padding-top:3px;font-size:16px;line-height:22px;font-weight:600;color:${C.ink}">${esc(n.title)}</div>
    <div style="margin-top:4px;font-size:15px;line-height:23px;color:${C.soft}">${keepTogether(esc(n.body), VENUE.phone)}</div>
  </td>
</tr>`;
  });
  return `<table ${TABLE}>${rowsHtml.join("")}</table>`;
}

/** Kartın altındaki küçük bağlantı (yol tarifi, telefon, site): bölünmez, altı çizili; telefon yeni sekme açmaz */
function linkHtml(href: string, label: string, newTab = true): string {
  return `<a href="${esc(href)}"${newTab ? ` target="_blank" rel="noopener noreferrer"` : ""} style="color:${GREEN};font-weight:600;text-decoration:underline;white-space:nowrap">${esc(label)}</a>`;
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

  const band = `<table ${TABLE}><tr><td align="center" style="line-height:0;font-size:0">
  <img src="${LOGO_URL}" width="54" height="44" alt="L'Affogato" style="display:inline-block;border:0;outline:none;text-decoration:none;width:54px;height:44px;font-family:${SERIF};font-size:20px;line-height:44px;color:#ffffff">
</td></tr><tr><td align="center" style="padding-top:10px;font-family:${FONT};font-size:11px;line-height:16px;font-weight:600;letter-spacing:0.22em;color:${SAGE}">KARAOKE</td></tr></table>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:28px"><tr><td bgcolor="${GOLD}" style="background:${GOLD};border-radius:999px;padding:5px 12px;font-family:${FONT};font-size:11px;line-height:14px;font-weight:700;letter-spacing:0.14em;color:${GREEN}">${esc(eyebrow)}</td></tr></table>
<div style="margin-top:14px;word-break:break-word">${heading(headline, { color: "#ffffff" })}</div>
<div style="margin-top:8px;font-family:${FONT};font-size:16px;line-height:24px;color:${SAGE};word-break:break-word">${keepTogether(esc(lead), `${from}–${to}`)}</div>
${ticketHtml({ from, to, dateLong, meta })}`;

  const card = `${stepsHtml(notes)}
${button(calendar, "Takvime ekle", { top: 30, color: GREEN, newTab: true })}
<div style="margin-top:20px;text-align:center;font-family:${FONT};font-size:14px;line-height:26px;color:${C.quiet}">${linkHtml(maps, "Yol tarifi")}&nbsp;&nbsp;·&nbsp; ${linkHtml(`tel:${VENUE.phoneTel}`, VENUE.phone, false)}&nbsp;&nbsp;·&nbsp; ${linkHtml(site, siteLabel)}</div>`;

  const foot = `<div style="font-family:${SERIF};font-size:15px;line-height:20px;color:${C.soft}">L&#39;Affogato · Tuzla</div>
<div style="padding-top:4px">${addressHtml()} · ${keepTogether(esc(VENUE.phone), VENUE.phone)}</div>
<div style="padding-top:10px">${esc(footer)}</div>`;

  const html = guestDocument({ subject, preheader, bandHtml: band, cardHtml: card, footerHtml: foot });

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

/**
 * Günlük hatırlatma e-postasının şablonu (saf; "server-only" yok, tests/hatirlaticilar-digest.test.ts sınar).
 * Veriyi okuyup gönderen kısım digest.ts'te. Ek kutuların (komisyon, kontrol, tahmin) toplanması da burada
 * (`collectDigestExtras`); kaynakların listesi src/server/notify/digest-extras.ts'te. E-postaların ortak kabuğu
 * (`emailLayout`, `esc`, `FONT`) öteki e-postalar için dışa açık.
 */

import type { BranchScope } from "@/lib/branches";
import { button, C, callout, divider, emailShell, esc, FONT, heading, para, pill, rows as kitRows, sectionTitle, TABLE, TONE, type Tone } from "@/lib/email-kit";
import { CASH_OUT_INVOICES_HREF } from "@/lib/cash-outs";
import { dateTR, money, monthLabel, tl } from "@/lib/format";
import { SYSTEM_ALERT_HELP } from "@/lib/job-health";
import { holdReasonSentence, holdsSummary, HOLDS_HREF } from "@/lib/price-hold";
import { daysLeftLabel, longDateTR, monthShortTR, type NotifyStage, type UpcomingItem } from "@/lib/reminders";
import { capped } from "@/server/jobs/capped";

export const APP_URL = (process.env.APP_URL?.trim() || "https://ladmin.laffogato.net").replace(/\/+$/, "");

/** HTML'e giden her kullanıcı metni buradan geçer (email-kit'inki; eski içe aktarmalar için burada da) */
export { esc, FONT };

/** Aşamanın adı, düz metindeki etiketi, rozetteki kelimesi ve tonu (gecikmiş kırmızı, bugün turuncu, yaklaşan gri) */
const STAGE: Record<NotifyStage, { label: string; title: string; word: string; tone: Tone }> = {
  overdue: { label: "Gecikti", title: "Gecikenler", word: "gecikmiş", tone: "bad" },
  due: { label: "Bugün", title: "Son günü bugün", word: "bugün", tone: "warn" },
  before: { label: "Yaklaşıyor", title: "Yaklaşanlar", word: "yaklaşan", tone: "neutral" },
};
const STAGE_ORDER: NotifyStage[] = ["overdue", "due", "before"];

/** Sabah e-postasının Paraşüt bölümü: son e-postadan bu yana gelen faturalar, kontrol bekleyenler, eşitleme hatası */
export interface DigestInvoices {
  /** unpaid + dueDate: e-faturadaki vadesi gelmemiş (Ödemeler'e düşen) fatura */
  items: { supplier: string; date: string; payable: number; category: string; needsReview: boolean; unpaid?: boolean; dueDate?: string | null }[];
  /** Kontrol bekleyen bütün faturalar (kategorisi tahminle yazılmış ya da mal alışı sayılmayan) */
  reviewCount: number;
  /**
   * Bunların kalemi hammaddeye bağlı ama kategorisi mal alışı olmayanları (E-07): kategorisi tahmin değil, mal alışı
   * sayılmıyor; yoksa 0
   */
  stockOnlyCount?: number;
  /**
   * Kasadan faturalı alımlar (denetim E-42): faturası Faturalar'da yok, Aylık harcamalar'a yazılmadı; sayı ve özet
   * ("Migros 2.400 ₺ ve 1 alım daha"); `duplicates`: Aylık harcamalar'a yazılmışken faturası sonradan gelenler (iki kez
   * sayılıyor, inceleme D2). Tek başına e-postayı göndermez; giden e-postanın Paraşüt bölümünde söylenir
   */
  cashOuts?: { count: number; summary: string; duplicates?: number } | null;
  /** Son eşitleme başarısızsa mesajı */
  syncError?: string | null;
  /**
   * Onay bekleyen hammadde fiyatları (Paraşüt faturasında şimdikinden %40'tan fazla farklı; docs/PARASUT.md 5b): hepsinin
   * sayısı, son Paraşüt bölümlü e-postadan beri gelenler (`fresh`: yalnız bunlar e-postayı gönderir ve konuya girer) ve
   * hammadde başına fark
   */
  priceHolds?: { count: number; fresh: number; items: { name: string; pct: number | null }[] } | null;
}

/** Paraşüt bölümünde e-postayı tek başına gönderen haber: yeni fatura, eşitleme hatası, yeni onaya düşen fiyat */
export function invoiceNewsOf(i: DigestInvoices): boolean {
  return i.items.length > 0 || Boolean(i.syncError) || (i.priceHolds?.fresh ?? 0) > 0;
}

/** Fiyat onayı kartı (Hammaddeler) */
const HOLDS_LINK = `${APP_URL}${HOLDS_HREF}`;

/**
 * Kontrol bekleyen faturaların cümlesi: kategorisi tahminle yazılanlar ve mal alışı sayılmayanlar (kalemi hammaddeye
 * bağlı, kategorisi mal alışı değil; E-07) ayrı söylenir
 */
function reviewSentence(inv: Pick<DigestInvoices, "reviewCount" | "stockOnlyCount">): string {
  const stockOnly = Math.min(inv.stockOnlyCount ?? 0, inv.reviewCount);
  const guessed = inv.reviewCount - stockOnly;
  return [
    guessed ? `${guessed} faturanın kategorisi tahminle yazıldı.` : "",
    stockOnly ? `${stockOnly} fatura mal alışı sayılmıyor: kalemi hammaddeye bağlı, kategorisi mal alışı değil.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Kasadan faturalı alımların cümlesi (E-42; zil ve Bugün'deki gibi) */
function cashOutSentence(c: { count: number; summary: string; duplicates?: number }, html = true): string {
  return [
    c.count
      ? `${c.count} kasadan faturalı alım Faturalar'da yok (${html ? esc(c.summary) : c.summary}): Faturalar'a ekleyin ya da Aylık harcamalar'a yazın, yoksa gelir-gidere girmez.`
      : "",
    c.duplicates ? `${c.duplicates} kasa alımı iki kez sayılıyor (Aylık harcamalar'a yazılmıştı, faturası sonra geldi): gider kaydını silin.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** E-postada listelenen en fazla yeni fatura (kalanı "ve N fatura daha") */
const MAX_INVOICE_ROWS = 10;

/** Sabah e-postasının zam bölümü: son e-postadan bu yana zamlanan hammaddeler ve fiyatı hedefin altına düşen ürünler */
export interface DigestPrices {
  /**
   * Birim fiyatlar ₺/gr, ₺/ml ya da ₺/adet (e-postada kg, L, adet başına yazılır). `monthly`: zammın ayda götürdüğü kâr
   * (TL, price-loss.ts); satış ayı yoksa null ya da yok
   */
  changes: { name: string; unit: string; before: number; after: number; pct: number; monthly?: number | null }[];
  products: { name: string; size: string; price: number; suggestedPrice: number; basis: "target" | "keep"; ratioBefore: number; ratioAfter: number }[];
  /** Maliyet oranı hedefin üstüne çıkan, fiyatı önerilenin altındaki bütün ürünler (listede ilk MAX_PRICE_ROWS) */
  productCount: number;
  /** Bu zamların ayda toplam kâr kaybı (TL) ve dayanağı olan satış ayı (YYYY-MM); satış verisi yoksa null ya da yok */
  monthlyTotal?: number | null;
  basisMonth?: string | null;
}

const MAX_PRICE_ROWS = 6;
const pctText = (v: number) => `%${Math.round(v * 100)}`;
/** Zammın ayda götürdüğü kâr: "ayda ≈ 690 ₺" (1 ₺'den azsa ya da satış ayı yoksa boş) */
const monthlyText = (v: number | null | undefined) => (v != null && v >= 1 ? `ayda ≈ ${tl(v)}` : "");
/** Zam bölümünün başlığının altındaki cümle (satış ayı yoksa ya da kayıp 1 ₺'den azsa boş) */
function lossSentence(p: DigestPrices): string {
  if (p.monthlyTotal == null || p.monthlyTotal < 1 || !p.basisMonth) return "";
  return `Bu zamlar ayda ≈ ${tl(p.monthlyTotal)} kâr götürüyor (${monthLabel(p.basisMonth)} satışlarıyla).`;
}
/** Birim maliyet okunur birimle: ₺/gr → ₺/kg, ₺/ml → ₺/L */
function perUnit(v: number, unit: string): string {
  if (unit === "gr") return `${money(v * 1000)}/kg`;
  if (unit === "ml") return `${money(v * 1000)}/L`;
  return `${money(v)}/${unit}`;
}

/**
 * Sabah e-postasının sistem bölümü: dün çalışmayan ya da hata veren sabah işi, bu sabah çalışmayan Paraşüt işi
 * (src/lib/job-health.ts › emailProblems). Gövdenin en üstünde durur.
 */
export interface DigestSystem {
  items: { title: string; body: string }[];
}
/** Sistem uyarılarının panelde açıldığı yer (Ayarlar › Günlük işler) */
const JOBS_LINK = `${APP_URL}/panel/ayarlar#isler`;

// ---------------------------------------------------------------- Ek kutular (docs/planlar/CRITIQUE2.md R11)

/**
 * Sabah e-postasının ek kutusu. Her grup kendi kutusunu kendi saf modülünde kurar ve sınar; kaynağını
 * src/server/notify/digest-extras.ts › DIGEST_EXTRA_SOURCES'a bir satırla ekler.
 */
export interface DigestBox {
  /** Kutunun başlığı, ör. "Komisyon ve hakediş" */
  title: string;
  /**
   * Satırlar: `strong` kalın ilk satır (varsa metin altına geçer); `tone` satırın rengi (kötü kırmızı, uyarı turuncu,
   * sönük gri ve küçük). Metin sarılır (telefonda taşmaz); tutarı money() / tl() ile yazın: sayı ile ₺ ayrılmaz
   */
  lines: { strong?: string; text: string; tone?: "bad" | "warn" | "muted" }[];
  /** APP_URL'siz panel yolu (ör. "/panel/komisyonlar"); fotoğraf ya da Blob adresi asla: /panel dışı yol panelin girişine düşer */
  href: string;
  /** Bağlantı metni, ör. "Komisyon & hakediş'te aç" (sonuna "→" eklenir; düğme de bunu yazar) */
  link: string;
  /** Konuya eklenen parça; null: konuya girmez (konuya yazılacak başka hiçbir şey yoksa yerine kutunun adı, `title`) */
  subjectPart: string | null;
  /**
   * Ödeme, sistem uyarısı, fatura, kontrol bekleyen ya da fiyat onayı yoksa e-postanın başlığı; null: kutu başlığa aday
   * olmaz (sıra öteki kutuya, sonra zama geçer). Başlık olacak başka hiçbir şey yoksa kutunun konu parçası (ilk harfi
   * büyük), o da yoksa adı: kutulu e-posta "Bugün yeni bir şey yok" demez
   */
  headline: string | null;
}

/**
 * renderDigest'in 6. bağımsız değişkeni: komisyon (komisyon grubu), kontrol (kontrol), onay bekleyen personel istekleri
 * (dalga 10; docs/ONAYLAR.md). `forecast` haber sayılmayan genel kutunun yuvasıdır (zamdan sonra, konuya ve başlığa
 * girmez): adı satış tahmininden kaldı (4 Kasım 2026'da kalktı), bugün onu dolduran kaynak yok
 */
export interface DigestExtras {
  commission?: DigestBox | null;
  kontrol?: DigestBox | null;
  forecast?: DigestBox | null;
  approvals?: DigestBox | null;
}

/** Kaynağın bulduğu kutu ve gönderimden sonra notification_log'a yazılacak anahtarlar (ör. "komisyon:<uyarı>", "kontrol:<gün>") */
export interface DigestExtraLoad {
  box: DigestBox;
  logKeys: string[];
}

/**
 * Yükleyiciye: önizlemede (`preview`) hiçbir şey yazmaz (okuyan yol), gönderimde ilk kayıt gibi yazımlar serbest.
 * `scope`: şubeye bağlı alıcının e-postası (şube kapsamı C P1-11); kontrol listeleri ve onay bekleyenler yalnız o şubenin.
 * Verilmezse bütün şubeler
 */
export interface DigestExtraCtx {
  preview: boolean;
  scope?: BranchScope;
}

/**
 * Ek kutu kaynağı (DIGEST_EXTRA_SOURCES'ın bir satırı). `news`: kutu varsa e-posta gider (yeni bir şey var sayılır);
 * `forecast` yuvası hiçbir zaman haber değildir (yalnız zaten giden e-postaya eklenir; konuya ve başlığa da girmez). `load` boş
 * dönerse (null) kutu yok.
 */
export type DigestExtraSource =
  | { key: "commission" | "kontrol" | "approvals"; news: boolean; load(today: string, ctx: DigestExtraCtx): Promise<DigestExtraLoad | null> }
  | { key: "forecast"; news: false; load(today: string, ctx: DigestExtraCtx): Promise<DigestExtraLoad | null> };

/** Kaynakların toplu sonucu: e-postanın kutuları, "yeni bir şey var mı"ya katkısı, tekil anahtara ve günlüğe giden anahtarlar */
export interface DigestExtrasResult {
  extras: DigestExtras;
  news: boolean;
  logKeys: string[];
  /** Haber olan kutuların konu parçaları, parçası olmayanın adı (bildirimdeki ve önizlemedeki özet satırı için) */
  parts: string[];
}

/** Bir kaynağın en çok bekletebileceği süre; aşan ya da hata veren kutu e-postaya girmez, e-postayı bozmaz */
export const DIGEST_EXTRA_MS = 4_000;
/** Haber sayılmayan kutular (konuya ve başlığa da girmez) */
const NEVER_NEWS: readonly (keyof DigestExtras)[] = ["forecast"];

/**
 * Ek kutuları aynı anda yükler: her biri en çok `ms` (capped); hata veren ya da süresi dolan kaynak yok sayılır ve
 * günlüğe yazılır. Asla hata fırlatmaz. Aynı anahtarda listede önce gelen kaynağın kutusu geçer. Kaynak yoksa sonuç boş:
 * e-posta, konusu, tekil anahtarı ve günlük satırları kutusuz hâliyle birebir aynı kalır.
 */
export async function collectDigestExtras(sources: readonly DigestExtraSource[], today: string, ctx: DigestExtraCtx, ms = DIGEST_EXTRA_MS): Promise<DigestExtrasResult> {
  const TIMEOUT = Symbol("süre doldu");
  const loaded = await Promise.all(
    sources.map(async (src) => {
      try {
        const r = await capped<DigestExtraLoad | null | typeof TIMEOUT>(Promise.resolve().then(() => src.load(today, ctx)), ms, TIMEOUT);
        if (r === TIMEOUT) console.error(`Sabah e-postası ek kutusu (${src.key}): ${ms / 1000} sn içinde yüklenemedi`);
        return r === TIMEOUT ? null : r;
      } catch (e) {
        console.error(`Sabah e-postası ek kutusu (${src.key})`, e);
        return null;
      }
    }),
  );
  const extras: DigestExtras = {};
  const keys = new Set<string>();
  const parts: string[] = [];
  let news = false;
  sources.forEach((src, i) => {
    const r = loaded[i];
    if (!r?.box || extras[src.key]) return;
    extras[src.key] = r.box;
    for (const k of r.logKeys ?? []) if (k) keys.add(k);
    const isNews = src.news && !NEVER_NEWS.includes(src.key);
    news ||= isNews;
    // Konu parçası olmayan haber kutusu özet satırına adıyla girer (tek haberse özet boş kalmasın: "Bugün: .")
    const part = r.box.subjectPart || r.box.title;
    if (isNews && part) parts.push(part);
  });
  return { extras, news, logKeys: [...keys], parts };
}

/** Kutu tonları (email-kit): komisyon, kontrol ve onay bekleyenler turuncu (fiyat onayı kutusu gibi), tahmin gri (bilgi) */
const BOX_TONE: Record<keyof DigestExtras, Tone> = { commission: "warn", kontrol: "warn", forecast: "neutral", approvals: "warn" };
/** Kutu satırının rengi: kötü kırmızı, uyarı turuncu, sönük gri ve küçük (metin anlamı taşır, renk yalnız vurgu) */
const LINE_STYLE: Record<NonNullable<DigestBox["lines"][number]["tone"]>, string> = {
  bad: `color:${TONE.bad.fg}`,
  warn: `color:${TONE.warn.fg}`,
  muted: `color:${C.mute};font-size:13px;line-height:19px`,
};
/** İlk harf büyük, Türkçe ("i" → "İ"): konu parçası küçük harfle başlayabilir ("dünkü kapanış listesi eksik") */
const upperFirst = (v: string) => `${v.charAt(0).toLocaleUpperCase("tr-TR")}${v.slice(1)}`;

/**
 * Kutunun bağlantısı: yalnız panelin bir yolu (harf, rakam, tire, alt çizgi; sorgu ve # serbest). Başka her adres
 * (fotoğraf, Blob, dış site, ".." ya da %2e ile yukarı çıkan yol) panelin girişine düşer.
 */
const PANEL_PATH = /^\/panel(?:\/[\w-]+)*\/?(?:[?#]\S*)?$/;
const boxUrl = (href: string) => `${APP_URL}${PANEL_PATH.test(href) ? href : "/panel"}`;

/**
 * Ek kutunun HTML'i: fiyat onayı kutusu gibi yumuşak renkli not kutusu (email-kit callout); kalın başlık, satırlar,
 * altta bağlantı. Uzun metin sarılır (telefonda taşmaz)
 */
function boxHtml(b: DigestBox, key: keyof DigestExtras, top: number): string {
  const lines = b.lines.map((l) => {
    const style = l.tone ? `;${LINE_STYLE[l.tone]}` : "";
    const body = l.strong ? `<strong>${esc(l.strong)}</strong>${l.text ? `<br>${esc(l.text)}` : ""}` : esc(l.text);
    return `<div style="margin-top:8px${style}">${body}</div>`;
  });
  return callout(BOX_TONE[key], [], { title: b.title, html: lines.join(""), linkHref: boxUrl(b.href), linkLabel: b.link, top });
}

// ---------------------------------------------------------------- Sabah e-postasının yerel parçaları

const NUM = "font-variant-numeric:tabular-nums";
/** Bölünmez boşluk (U+00A0; kaçış gerekmez): "faturalar · 3" telefonda bölünmesin, sayı tek başına alt satıra düşmesin */
const NB = "\u00a0";

/**
 * Liste satırı (ödeme, fatura, zam, ürün): solda isteğe bağlı karo, ortada kalın ad ve altında gri ayrıntı (sarılır),
 * sağda tutar (sarılmaz). email-kit'in rowHtml'i düz metin ve tek renkli alt satır aldığı için yerel; ölçü ve renk
 * kitten. Argümanlar hazır (kaçışlı) HTML
 */
function listRow(o: { lead?: string | null; titleHtml: string; metaHtml?: string | null; valueHtml: string; first: boolean }): string {
  const border = o.first ? "" : `border-top:1px solid ${C.hair};`;
  return `<tr>${o.lead ? `\n  <td width="44" style="${border}width:44px;padding:14px 14px 14px 0;vertical-align:top">${o.lead}</td>` : ""}
  <td style="${border}padding:14px 0;vertical-align:top;font-family:${FONT};word-break:break-word">
    <div style="font-size:15px;line-height:22px;font-weight:600;color:${C.ink}">${o.titleHtml}</div>${o.metaHtml ? `\n    <div style="font-size:13px;line-height:19px;color:${C.mute};margin-top:2px">${o.metaHtml}</div>` : ""}
  </td>
  <td align="right" style="${border}padding:14px 0 14px 16px;vertical-align:top;white-space:nowrap;font-family:${FONT};font-size:15px;line-height:22px;font-weight:600;color:${C.ink};${NUM}">${o.valueHtml}</td>
</tr>`;
}
const listTable = (list: string[]) => `<table ${TABLE} style="border-collapse:collapse">${list.join("\n")}</table>`;

/** Ödeme satırının tarih karosu: üstte ay (aşamanın tonuyla), altta gün */
function dateTile(dueDate: string, stage: NotifyStage): string {
  const t = TONE[STAGE[stage].tone];
  return `<table role="presentation" width="44" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;width:44px;border-radius:12px;overflow:hidden;border:1px solid ${C.line}">
      <tr><td align="center" style="background:${t.bg};color:${t.fg};font-family:${FONT};font-size:11px;line-height:17px;font-weight:700;letter-spacing:0.02em">${esc(monthShortTR(dueDate))}</td></tr>
      <tr><td align="center" style="background:${C.card};color:${C.ink};font-family:${FONT};font-size:18px;line-height:27px;font-weight:700;${NUM}">${Number(dueDate.slice(8, 10))}</td></tr>
    </table>`;
}

/** Satır içinde vurgulanan kısa öbek (vade, kontrol edin, yeni maliyet oranı): tonun mürekkebiyle kalın, bölünmez */
const toneSpan = (tone: Tone, html: string) => `<span style="color:${TONE[tone].fg};font-weight:600;white-space:nowrap">${html}</span>`;
/** Bölünmeyen kısa öbek ("şimdi 120 ₺") */
const keep = (html: string) => `<span style="white-space:nowrap">${html}</span>`;

/** Kart içi bağlantı satırı ("Önerilen fiyatlara bak →") */
const linkLine = (href: string, label: string, top = 14) =>
  `<p style="margin:${top}px 0 0;font-family:${FONT};font-size:14px;line-height:21px"><a href="${esc(href)}" style="color:${C.ink};font-weight:600;text-decoration:underline">${esc(label)} →</a></p>`;

/** Düğmenin altındaki ortalı küçük not (email-kit'in para'sı sola yaslı) */
const centerNote = (text: string) =>
  `<p style="margin:16px 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.mute};text-align:center;word-break:break-word">${esc(text)}</p>`;

/** Ek kutunun düz metni: boş satır, başlık, satırlar, bağlantı */
const boxText = (b: DigestBox) => ["", b.title, ...b.lines.map((l) => `- ${l.strong ? `${l.strong}${l.text ? `: ${l.text}` : ""}` : l.text}`), `${b.link}: ${boxUrl(b.href)}`];

/** Ortak kabuğun alt notu (sabah e-postası, bekçi e-postası) */
const DEFAULT_FOOTER = "Bu e-posta ladmin.laffogato.net bildirim adreslerine gönderildi. Adresleri Ödemeler sayfasından değiştirebilirsiniz.";

/**
 * E-postaların ortak kabuğu: üstte L'Af başlığı ve tarih, ortada beyaz kart (`card`), altta alıcı notu. `card` ve
 * `brandSub` hazır (kaçışlı) HTML; `footer` düz metin (kaçışı burada; verilmezse bildirim adresleri notu).
 */
export function emailLayout(o: { subject: string; preheader: string; brandSub: string; today: string; card: string; footer?: string }): string {
  // Tasarım tek yerde: src/lib/email-kit.ts (ferah kart, telefonda tek sütun)
  return emailShell({ subject: o.subject, preheader: o.preheader, brandSubHtml: o.brandSub, dateLabel: longDateTR(o.today), cardHtml: o.card, footer: o.footer ?? DEFAULT_FOOTER });
}

/** Şubeye bağlı alıcının e-postasında kapsam notu (renderDigest `branch`) */
export function branchDigestNote(branch: string): string {
  return `${branch} ve işletme geneli: ödemeler, onay bekleyen istekler ve kontrol listeleri yalnız bu şubenin. Faturalar, zam ve komisyon firma geneli.`;
}

/**
 * Günlük sabah e-postası, ortak e-posta tasarımıyla (src/lib/email-kit.ts: ferah kart, satır içi stiller ve tablolar,
 * telefonda tek sütun). Üstte kitin başlığı (h1) ve aşamaların rozetleri, varsa sistem uyarıları, aşamalara göre
 * ödemeler (tarih karosu, sağa hizalı tutar), Paraşüt'ten gelen yeni faturalar, renkli not kutuları (kırmızı sorun,
 * turuncu uyarı; kelime yanında), en altta tam genişlikte düğme. Ödeme yoksa yalnız
 * öteki bölümler. Gövde sırası: sistem, ödemeler, faturalar, kontrol bekleyen, fiyat onayı, ek kutular (komisyon,
 * kontrol, onay bekleyenler), zam, tahmin kutusu, düğme.
 *
 * Konu (öncelik sırasıyla; ötekiler " · " ile, hep aynı sırada eklenir: yeni fatura, yeni fiyat onayı, zam, komisyon,
 * kontrol, onay bekleyenler): ödeme varsa "Ödeme hatırlatması: …" (+ önce sistem uyarısı); yoksa sistem uyarısı varsa "Sistem uyarısı:
 * <ilk başlık>"; yoksa yeni faturasız eşitleme hatası "Paraşüt eşitlemesi başarısız"; yoksa yeni fatura, kontrol
 * bekleyen, yeni fiyat onayı, komisyon ya da kontrol kutusundan ilki "Sabah özeti: …"; yoksa zam, yoksa (konu parçası
 * olmayan) komisyon ya da kontrol kutusunun adı, yoksa "bugün yeni bir şey yok". Başlık da aynı sırayla (kutunun
 * `headline`'ı fiyat onayından sonra, zamdan önce; başlıksız kutu en sonda konu parçası ya da adıyla). Bölüm ve kutu
 * ekleyenler konuya yalnız kendi parçasını katar; sırayı burası belirler. Tahmin kutusu konuya, başlığa ve düğmeye hiç
 * girmez. `extras` verilmezse (ya da kutusuzsa) e-posta eskisiyle birebir aynı.
 *
 * `branch` (şube kapsamı C P1-11): adresi tek şubeye bağlı alıcının e-postası; konu şubenin adıyla başlar ("Marina:
 * Ödeme hatırlatması: …"), kartın üstü şubeyi ve kapsamı söyler. Verilmezse (bütün şubeler) e-posta eskisiyle aynı.
 */
export function renderDigest(
  rows: { item: UpcomingItem; stage: NotifyStage }[],
  today: string,
  invoices?: DigestInvoices | null,
  prices?: DigestPrices | null,
  system?: DigestSystem | null,
  extras?: DigestExtras | null,
  branch?: string | null,
) {
  const counts = { overdue: 0, due: 0, before: 0 };
  for (const r of rows) counts[r.stage]++;
  const parts = [counts.overdue ? `${counts.overdue} gecikmiş` : null, counts.due ? `${counts.due} bugün` : null, counts.before ? `${counts.before} yaklaşan` : null].filter(Boolean);
  const inv = invoices && (invoices.items.length || invoices.reviewCount || invoices.syncError || invoices.priceHolds?.count || invoices.cashOuts?.count || invoices.cashOuts?.duplicates) ? invoices : null;
  const cashOuts = inv?.cashOuts?.count || inv?.cashOuts?.duplicates ? inv.cashOuts : null;
  const invPart = inv?.items.length ? `${inv.items.length} yeni fatura` : null;
  const reviewPart = inv?.reviewCount ? `${inv.reviewCount} fatura kontrol bekliyor` : null;
  // Onay bekleyen fiyatlar bölümde hep görünür; konuya ve başlığa yalnız son e-postadan beri yenisi geldiyse girer
  const holds = inv?.priceHolds?.count ? inv.priceHolds : null;
  const holdPart = holds?.fresh ? `${holds.count} fiyat onay bekliyor` : null;
  const zam = prices && prices.changes.length ? prices : null;
  const zamPart = zam ? (zam.productCount ? `zam: ${zam.productCount} ürünün fiyatına bakın` : `${zam.changes.length} hammaddeye zam`) : null;
  const sys = system && system.items.length ? system : null;
  // Ek kutular: komisyon, kontrol ve onay bekleyenler haber (konu, başlık, düğme); tahmin yalnız gövdede
  const com = extras?.commission ?? null;
  const kon = extras?.kontrol ?? null;
  const apv = extras?.approvals ?? null;
  const fc = extras?.forecast ?? null;
  const comPart = com?.subjectPart || null;
  const konPart = kon?.subjectPart || null;
  const apvPart = apv?.subjectPart || null;
  // Konuya eklenen parçaların tek sırası
  const tail = [invPart, holdPart, zamPart, comPart, konPart, apvPart];
  const extra = [sys ? "sistem uyarısı" : null, ...tail].filter(Boolean).join(" · ");
  const sysExtra = tail.filter(Boolean).join(" · ");
  const failExtra = [holdPart, zamPart, comPart, konPart, apvPart].filter(Boolean).join(" · ");
  // "Sabah özeti: <ilk haber>": adayın kuyruktaki yeri (kontrol bekleyen kuyrukta yok); ilk haber kuyruktan çıkar
  const lead = ([[invPart, 0], [reviewPart, -1], [holdPart, 1], [comPart, 3], [konPart, 4], [apvPart, 5]] as const).find(([p]) => p);
  // Başlığı ya da konu parçası olmayan kutu e-postanın tek içeriğiyse konu ve başlık "yeni bir şey yok" demesin: kutunun
  // parçası (başlıkta ilk harfi büyük), o da yoksa adı. Konunun son dalında parça zaten yoktur (varsa `lead` olurdu)
  const boxPart = comPart || konPart || apvPart;
  const boxLast = boxPart ? upperFirst(boxPart) : com?.title || kon?.title || apv?.title || null;
  const subjectOf = rows.length
    ? `Ödeme hatırlatması: ${parts.join(", ")}${extra ? ` · ${extra}` : ""}`
    : sys
      ? `Sistem uyarısı: ${sys.items[0].title}${sysExtra ? ` · ${sysExtra}` : ""}`
      : inv?.syncError && !invPart
        ? `Paraşüt eşitlemesi başarısız${failExtra ? ` · ${failExtra}` : ""}`
        : lead
          ? `Sabah özeti: ${[lead[0], ...tail.filter((_, i) => i !== lead[1])].filter(Boolean).join(" · ")}`
          : `Sabah özeti: ${zamPart ?? boxLast ?? "bugün yeni bir şey yok"}`;
  const subject = branch ? `${branch}: ${subjectOf}` : subjectOf;
  const total = rows.reduce((a, r) => a + (r.item.amount ?? 0), 0);
  const link = `${APP_URL}/panel/hatirlaticilar`;
  const boxHeadline = com?.headline || kon?.headline || apv?.headline || null;
  const headline = rows.length
    ? rows.length === 1
      ? "1 ödeme sizi bekliyor"
      : `${rows.length} ödeme sizi bekliyor`
    : sys
      ? sys.items[0].title
      : inv?.items.length
        ? `Paraşüt'ten ${inv.items.length} yeni fatura geldi`
        : inv?.syncError
          ? "Paraşüt eşitlemesi bu sabah yapılamadı"
          : inv?.reviewCount
            ? `${inv.reviewCount} fatura kontrol bekliyor`
            : holdPart && holds
              ? `${holds.count} hammadde fiyatı onay bekliyor`
              : boxHeadline
                ? boxHeadline
                : zam
                  ? zam.productCount
                    ? `Hammadde zammı: ${zam.productCount} ürünün fiyatına bakın`
                    : `${zam.changes.length} hammaddenin fiyatı arttı`
                  : (boxLast ?? "Bugün yeni bir şey yok");
  const preheader = rows.length ? `${parts.join(", ")} · toplam ${money(total)}${extra ? ` · ${extra}` : ""}` : headline;

  // Aşamaların rozetleri (kelime yanında: renk tek başına anlam taşımaz). Aralarında boşluk: inline-block'u ve span
  // dolgusunu tanımayan Outlook'ta da "1 gecikmiş 1 bugün" ayrı okunur ("gecikmiş1" değil)
  const pills = STAGE_ORDER.filter((st) => counts[st])
    .map((st) => `<span style="display:inline-block;margin:0 2px 6px 0">${pill(`${counts[st]} ${STAGE[st].word}`, STAGE[st].tone)}</span>`)
    .join(" ");

  const row = ({ item, stage }: { item: UpcomingItem; stage: NotifyStage }, i: number) => {
    const tone = STAGE[stage].tone;
    const days = esc(daysLeftLabel(item.daysLeft));
    const meta = [esc(dateTR(item.dueDate)), tone === "neutral" ? days : toneSpan(tone, days), item.detail ? esc(String(item.detail)) : null].filter(Boolean).join(" · ");
    return listRow({
      lead: dateTile(item.dueDate, stage),
      titleHtml: esc(item.title),
      metaHtml: meta,
      valueHtml: item.amount !== null ? esc(money(item.amount)) : `<span style="color:${C.quiet}">–</span>`,
      first: i === 0,
    });
  };

  const sections = STAGE_ORDER.filter((st) => counts[st])
    .map((st, i) => {
      const group = rows.filter((r) => r.stage === st);
      const sum = group.reduce((a, r) => a + (r.item.amount ?? 0), 0);
      return `${sectionTitle(`${STAGE[st].title} · ${group.length}`, { aside: money(sum), dot: STAGE[st].tone, top: i === 0 ? 24 : 32 })}
${listTable(group.map(row))}`;
    })
    .join("\n");
  const totalHtml = rows.length ? `${divider(2)}${kitRows([{ label: "Toplam", value: money(total), strong: true }])}` : "";

  const invoiceTotal = inv ? inv.items.reduce((a, i) => a + i.payable, 0) : 0;
  const invoiceRow = (i: DigestInvoices["items"][number], n: number) =>
    listRow({
      titleHtml: esc(i.supplier),
      metaHtml: `${esc(dateTR(i.date))} · ${esc(i.category)}${i.unpaid && i.dueDate ? ` · ${toneSpan("warn", `vade ${esc(dateTR(i.dueDate))}`)}` : ""}${i.needsReview ? ` · ${toneSpan("warn", "kontrol edin")}` : ""}`,
      valueHtml: esc(money(i.payable)),
      first: n === 0,
    });
  // Paraşüt bölümünün not kutuları: kontrol bekleyen, kasadan faturalı alım, fiyat onayı. Bağlantı cümlenin arkasında;
  // ilki bölümden ayrık, ötekiler ona yakın durur
  const invNotes: string[] = inv
    ? [
        inv.reviewCount ? `${reviewSentence(inv)} <a href="${APP_URL}/panel/faturalar?durum=kontrol" style="color:${TONE.warn.fg};font-weight:600;text-decoration:underline">Kontrol edin →</a>` : "",
        cashOuts ? `${cashOutSentence(cashOuts)} <a href="${APP_URL}${CASH_OUT_INVOICES_HREF}" style="color:${TONE.warn.fg};font-weight:600;text-decoration:underline">Bakın →</a>` : "",
        holds
          ? `${holds.count} hammadde fiyatı onay bekliyor (${esc(holdsSummary(holds.items))}). ${holdReasonSentence(holds.items)}. <a href="${HOLDS_LINK}" style="color:${TONE.warn.fg};font-weight:600;text-decoration:underline">Bakın →</a>`
          : "",
      ].filter(Boolean)
    : [];
  const invoiceSection = inv
    ? [
        inv.syncError ? callout("bad", [inv.syncError], { title: "Paraşüt eşitlemesi başarısız.", linkHref: `${APP_URL}/panel/parasut`, linkLabel: "Paraşüt sayfasını aç", top: 22 }) : "",
        inv.items.length
          ? `${sectionTitle(`Paraşüt'ten gelen yeni faturalar${NB}·${NB}${inv.items.length}`, { aside: money(invoiceTotal), dot: "info", top: rows.length || sys || inv.syncError ? 32 : 24 })}
${listTable(inv.items.slice(0, MAX_INVOICE_ROWS).map(invoiceRow))}${inv.items.length > MAX_INVOICE_ROWS ? `\n${para(`ve ${inv.items.length - MAX_INVOICE_ROWS} fatura daha`, { top: 2, muted: true, size: 13 })}` : ""}`
          : "",
        ...invNotes.map((html, i) => callout("warn", [], { html, top: i === 0 && (inv.items.length || !inv.syncError) ? 22 : 12 })),
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const priceRow = (p: DigestPrices["products"][number], n: number) =>
    listRow({
      titleHtml: `${esc(p.name)} · ${esc(p.size)}`,
      metaHtml: `Maliyet oranı ${esc(pctText(p.ratioBefore))} → ${toneSpan("warn", esc(pctText(p.ratioAfter)))} · ${keep(`şimdi ${esc(money(p.price))}`)}`,
      valueHtml: `<div style="font-size:12px;line-height:17px;font-weight:400;color:${C.mute}">${p.basis === "keep" ? "zammın payı" : "önerilen"}</div><div>${esc(money(p.suggestedPrice))}</div>`,
      first: n === 0,
    });
  const zamLoss = zam ? lossSentence(zam) : "";
  // Zam satırı: ad ve fiyatın eski → yeni hâli solda (sarılır), artış rozeti ve aylık tutar sağda alt alta (telefonda
  // aynı satırda kaydırmasız uzun hücre e-postayı taşırırdı); tutar yoksa yalnız rozet
  const zamRow = (c: DigestPrices["changes"][number], n: number) => {
    const monthly = monthlyText(c.monthly);
    return listRow({
      titleHtml: esc(c.name),
      metaHtml: `${esc(perUnit(c.before, c.unit))} → <strong style="color:${C.ink};font-weight:600">${esc(perUnit(c.after, c.unit))}</strong>`,
      valueHtml: `${pill(`+${pctText(c.pct)}`, "warn")}${monthly ? `<div style="font-size:12px;line-height:18px;font-weight:600;color:${TONE.warn.fg};margin-top:6px">${esc(monthly)}</div>` : ""}`,
      first: n === 0,
    });
  };
  const priceSection = zam
    ? `${sectionTitle(`Hammadde zamları · ${zam.changes.length}`, { dot: "warn" })}${zamLoss ? `\n${callout("warn", [zamLoss], { top: 14 })}` : ""}
${listTable(zam.changes.slice(0, MAX_PRICE_ROWS).map(zamRow))}${
        zam.products.length
          ? `\n${sectionTitle(`Fiyatına bakılacak ürünler · ${zam.productCount}`, { top: 22 })}
${listTable(zam.products.slice(0, MAX_PRICE_ROWS).map(priceRow))}${zam.productCount > MAX_PRICE_ROWS ? `\n${para(`ve ${zam.productCount - MAX_PRICE_ROWS} ürün daha`, { top: 2, muted: true, size: 13 })}` : ""}`
          : `\n${para("Etkilenen ürünlerin maliyet oranı hâlâ hedefte.", { top: 8, muted: true, size: 14 })}`
      }
${linkLine(`${APP_URL}/panel/urunler#zamlar`, "Önerilen fiyatlara bak")}`
    : "";
  // Düğme kutunun bağlantısına: fiyat onayından sonra, zamdan önce (komisyon, sonra kontrol, sonra onay bekleyenler)
  const actionBox = com ?? kon ?? apv;
  const action = rows.length
    ? { href: link, label: "Panelde aç" }
    : inv && (inv.items.length || inv.reviewCount || inv.syncError || cashOuts)
      ? { href: `${APP_URL}/panel/faturalar${inv?.reviewCount || cashOuts ? "?durum=kontrol" : "?kaynak=parasut"}`, label: "Faturaları aç" }
      : holdPart
        ? { href: HOLDS_LINK, label: "Hammaddeleri aç" }
        : actionBox
          ? { href: boxUrl(actionBox.href), label: actionBox.link }
          : zam || !sys
            ? { href: `${APP_URL}/panel/urunler#zamlar`, label: "Ürünleri aç" }
            : { href: JOBS_LINK, label: "Günlük işleri aç" };
  // Ek kutular Paraşüt bölümünden ayrık, birbirine yakın
  const boxes = [com ? ["commission", com] : null, kon ? ["kontrol", kon] : null, apv ? ["approvals", apv] : null]
    .filter((b): b is [keyof DigestExtras, DigestBox] => b !== null)
    .map(([key, b], i) => boxHtml(b, key, i === 0 ? 22 : 12))
    .join("\n");
  const forecastBox = fc ? boxHtml(fc, "forecast", 22) : "";
  // Kapanış notu gövdenin asıl bölümüne göre; yalnız ek kutu varsa not yok (kutular kendi bağlantısını taşır)
  const note = rows.length
    ? "Ödediklerinizi panelde “Ödedim” ile işaretleyin; tekrar edenler sıradaki tarihe geçer."
    : inv || zam || (!sys && !actionBox)
      ? "Faturalar her sabah Paraşüt'ten kendiliğinden gelir; kategorisi tahmin edilenleri panelde onaylayın."
      : sys
        ? "İş yeniden düzgün çalışınca uyarı kendiliğinden kalkar."
        : "";
  const systemSection = sys
    ? callout("bad", [], {
        title: `Sistem uyarıları · ${sys.items.length}`,
        html: sys.items.map((i) => `<div style="margin-top:10px"><strong>${esc(i.title)}</strong><br>${esc(i.body)}</div>`).join(""),
        linkHref: JOBS_LINK,
        linkLabel: "Günlük işleri aç",
        top: rows.length ? 18 : 22,
      })
    : "";

  const html = emailLayout({
    subject,
    preheader,
    brandSub: rows.length ? "Ödemeler &amp; hatırlatıcılar" : "Sabah özeti",
    today,
    card: [
      heading(headline, { eyebrow: `${rows.length ? "Günlük ödeme hatırlatması" : "Günlük sabah özeti"}${branch ? ` · ${branch}` : ""}` }),
      branch ? para(branchDigestNote(branch), { top: 10, muted: true, size: 14 }) : "",
      pills ? `<div style="margin-top:16px">${pills}</div>` : "",
      systemSection,
      sections,
      totalHtml,
      invoiceSection,
      boxes,
      priceSection,
      forecastBox,
      button(action.href, action.label, { top: 32 }),
      note ? centerNote(note) : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const text = [
    `L'Affogato · ${dateTR(today)}`,
    subject,
    ...(branch ? [branchDigestNote(branch)] : []),
    ...(rows.length ? [`Toplam ${money(total)}`] : []),
    ...(sys ? ["", `Sistem uyarıları (${sys.items.length})`, ...sys.items.map((i) => `- ${i.title}: ${i.body}`), `Günlük işler: ${JOBS_LINK}`] : []),
    ...STAGE_ORDER.filter((st) => counts[st]).flatMap((st) => [
      "",
      `${STAGE[st].title} (${counts[st]})`,
      ...rows
        .filter((r) => r.stage === st)
        .map(({ item }) => `- ${item.title} · ${dateTR(item.dueDate)} (${daysLeftLabel(item.daysLeft)}) · ${item.amount !== null ? money(item.amount) : "–"} · ${STAGE[st].label}`),
    ]),
    ...(inv?.syncError ? ["", `Paraşüt eşitlemesi başarısız: ${inv.syncError}`] : []),
    ...(inv?.items.length
      ? ["", `Paraşüt'ten gelen yeni faturalar (${inv.items.length}) · ${money(invoiceTotal)}`, ...inv.items.slice(0, MAX_INVOICE_ROWS).map((i) => `- ${i.supplier} · ${dateTR(i.date)} · ${i.category} · ${money(i.payable)}${i.unpaid && i.dueDate ? ` · vade ${dateTR(i.dueDate)}` : ""}${i.needsReview ? " · kontrol edin" : ""}`), ...(inv.items.length > MAX_INVOICE_ROWS ? [`ve ${inv.items.length - MAX_INVOICE_ROWS} fatura daha`] : [])]
      : []),
    ...(inv?.reviewCount ? ["", `${inv.reviewCount} fatura kontrol bekliyor: ${APP_URL}/panel/faturalar?durum=kontrol`] : []),
    ...(cashOuts ? ["", `${cashOutSentence(cashOuts, false)} ${APP_URL}${CASH_OUT_INVOICES_HREF}`] : []),
    ...(holds ? ["", `${holds.count} hammadde fiyatı onay bekliyor (${holdsSummary(holds.items)}): ${HOLDS_LINK}`] : []),
    ...(com ? boxText(com) : []),
    ...(kon ? boxText(kon) : []),
    ...(apv ? boxText(apv) : []),
    ...(zam
      ? [
          "",
          `Hammadde zamları (${zam.changes.length})`,
          ...(zamLoss ? [zamLoss] : []),
          ...zam.changes.slice(0, MAX_PRICE_ROWS).map((c) => `- ${c.name}: ${perUnit(c.before, c.unit)} → ${perUnit(c.after, c.unit)} (+${pctText(c.pct)})${monthlyText(c.monthly) ? ` · ${monthlyText(c.monthly)}` : ""}`),
          ...(zam.products.length
            ? [
                `Fiyatına bakılacak ürünler (${zam.productCount})`,
                ...zam.products
                  .slice(0, MAX_PRICE_ROWS)
                  .map((p) => `- ${p.name} ${p.size}: maliyet oranı ${pctText(p.ratioBefore)} → ${pctText(p.ratioAfter)} · şimdi ${money(p.price)} · ${p.basis === "keep" ? "zammın payı" : "önerilen"} ${money(p.suggestedPrice)}`),
              ]
            : ["Etkilenen ürünlerin maliyet oranı hâlâ hedefte."]),
          `Önerilen fiyatlar: ${APP_URL}/panel/urunler#zamlar`,
        ]
      : []),
    ...(fc ? boxText(fc) : []),
    "",
    `${action.label}: ${action.href}`,
  ].join("\n");

  return { subject, html, text };
}

/**
 * Bekçi e-postası (Paraşüt işi, 07:00–08:00): dünkü sabah işi çalışmadıysa ya da hata verdiyse kısa uyarı. Sabah
 * e-postasını gönderen iş bozulunca bunu ancak öteki iş söyleyebilir. Sabah e-postasıyla aynı kabuk.
 */
export function renderSystemAlert(items: DigestSystem["items"], today: string) {
  const first = items[0]?.title ?? "Sistem uyarısı";
  const subject = `L'Affogato · ${first}${items.length > 1 ? ` (+${items.length - 1})` : ""}`;
  const headline = items.length > 1 ? `${items.length} sistem uyarısı` : first;
  // Tek uyarıda başlık zaten h1: yalnız açıklaması; birden çoksa her biri başlığı ve açıklamasıyla ayrı satır
  const list =
    items.length > 1
      ? `<table ${TABLE} style="border-collapse:collapse;margin-top:18px">${items
          .map(
            (i, n) => `<tr><td style="${n ? `border-top:1px solid ${C.hair};` : ""}padding:14px 0;font-family:${FONT};word-break:break-word">
  <div style="font-size:15px;line-height:22px;font-weight:600;color:${C.ink}">${esc(i.title)}</div>
  <div style="font-size:14px;line-height:21px;color:${C.soft};margin-top:2px">${esc(i.body)}</div>
</td></tr>`,
          )
          .join("\n")}</table>`
      : items.map((i) => para(i.body, { top: 12 })).join("");
  const html = emailLayout({
    subject,
    preheader: items.map((i) => i.title).join(" · "),
    brandSub: "Sistem uyarısı",
    today,
    card: [heading(headline, { eyebrow: "Günlük işler" }), list, callout("bad", [SYSTEM_ALERT_HELP], { top: 20 }), button(JOBS_LINK, "Günlük işleri aç")].join("\n"),
  });
  const text = [
    `L'Affogato · ${dateTR(today)}`,
    subject,
    "",
    ...items.flatMap((i) => [`- ${i.title}`, `  ${i.body}`]),
    "",
    SYSTEM_ALERT_HELP,
    "",
    `Günlük işleri aç: ${JOBS_LINK}`,
  ].join("\n");
  return { subject, html, text };
}

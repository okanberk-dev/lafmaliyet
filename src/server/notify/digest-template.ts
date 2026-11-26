/**
 * Günlük hatırlatma e-postasının ve bekçi (sistem uyarısı) e-postasının şablonu (saf; "server-only" yok,
 * tests/hatirlaticilar-digest.test.ts sınar). Görünüşü e-posta kitinden (src/lib/email; docs/BILDIRIMLER.md › E-posta
 * tasarımı): kabuk layout(), bölümler section + kvRow, uyarılar note, düğme button. Konu, düz metin ve HTML'deki
 * sözcükler buradaki fonksiyonlardan gelir; kit yalnız görünüşü kurar. Veriyi okuyup gönderen kısım digest.ts'te. Ek
 * kutuların (komisyon, kontrol, tahmin) toplanması da burada (`collectDigestExtras`); kaynakların listesi
 * src/server/notify/digest-extras.ts'te. Eski ortak kabuk (`emailLayout`, `esc`, `FONT`) kite taşınmamış öteki
 * e-postalar için dışa açık kalır.
 */

import type { BranchScope } from "@/lib/branches";
import { CASH_OUT_INVOICES_HREF } from "@/lib/cash-outs";
import { badge, button, kpiGrid, kvRow, layout, LIGHT, link, note, paragraph, section, stack, statusBanner, TONES, type Tone } from "@/lib/email";
import { dateTR, money, monthLabel, tl } from "@/lib/format";
import { SYSTEM_ALERT_HELP } from "@/lib/job-health";
import { holdReasonSentence, holdsSummary, HOLDS_HREF } from "@/lib/price-hold";
import { daysLeftLabel, longDateTR, type NotifyStage, type UpcomingItem } from "@/lib/reminders";
import { capped } from "@/server/jobs/capped";

export const APP_URL = (process.env.APP_URL?.trim() || "https://ladmin.laffogato.net").replace(/\/+$/, "");

/** HTML'e giden her kullanıcı metni buradan geçer */
export const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Ödeme aşamaları: düz metindeki etiket, bölümün başlığı, üstteki rozetin sözcüğü ve tonu (gecikmiş kırmızı, bugün
 * turuncu, yaklaşan gri; satırın tutarı da bu renkte)
 */
const STAGE: Record<NotifyStage, { label: string; title: string; pill: string; tone: Tone }> = {
  overdue: { label: "Gecikti", title: "Gecikenler", pill: "gecikmiş", tone: "bad" },
  due: { label: "Bugün", title: "Son günü bugün", pill: "bugün", tone: "warn" },
  before: { label: "Yaklaşıyor", title: "Yaklaşanlar", pill: "yaklaşan", tone: "neutral" },
};
const STAGE_ORDER: NotifyStage[] = ["overdue", "due", "before"];
/** Bölünmez boşluk (U+00A0): başlıktaki " · 2" telefonda tek başına alt satıra düşmesin */
const NBSP = " ";
export const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Geist,Roboto,Helvetica,Arial,sans-serif";

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

/** Kutu tonları: komisyon, kontrol ve onay bekleyenler turuncu (fiyat onayı kutusu gibi), tahmin gri (bilgi) */
const BOX_TONE: Record<keyof DigestExtras, Tone> = { commission: "warn", kontrol: "warn", forecast: "neutral", approvals: "warn" };
/** Kutu satırının rengi: sınıf koyu temanın tutamağı (src/lib/email/layout.ts), satır içi renk açık temanın */
const LINE_TONE: Record<NonNullable<DigestBox["lines"][number]["tone"]>, { cls: string; style: string }> = {
  bad: { cls: "e-v-bad", style: `color:${TONES.bad.value}` },
  warn: { cls: "e-v-warn", style: `color:${TONES.warn.value}` },
  muted: { cls: "e-mute", style: `color:${LIGHT.mute};font-size:13px;line-height:18px` },
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
 * Ek kutunun HTML'i: kitin notu (tonun yumuşak zemini); üstte kutunun adı küçük etiket, altında satırlar (kalın ilk
 * satır kutunun haberi), en altta bağlantı. Uzun metin sarılır (telefonda taşmaz)
 */
function boxHtml(b: DigestBox, key: keyof DigestExtras): string {
  const tone = BOX_TONE[key];
  const t = TONES[tone];
  const label = `<div class="e-ti-${tone}" style="font-size:13px;line-height:18px;font-weight:600;color:${t.ink}">${esc(b.title)}</div>`;
  const lines = b.lines.map((l) => {
    const body = l.strong ? `<strong>${esc(l.strong)}</strong>${l.text ? `<br>${esc(l.text)}` : ""}` : esc(l.text);
    return l.tone ? `<span class="${LINE_TONE[l.tone].cls}" style="${LINE_TONE[l.tone].style}">${body}</span>` : body;
  });
  return note([label, ...lines, `<div style="padding-top:4px">${link(boxUrl(b.href), `${b.link} →`, tone === "neutral" ? undefined : tone)}</div>`], { tone, html: true });
}

/** Ek kutunun düz metni: boş satır, başlık, satırlar, bağlantı */
const boxText = (b: DigestBox) => ["", b.title, ...b.lines.map((l) => `- ${l.strong ? `${l.strong}${l.text ? `: ${l.text}` : ""}` : l.text}`), `${b.link}: ${boxUrl(b.href)}`];

/** Alt not (sabah e-postası, bekçi e-postası ve eski kabuğun varsayılanı) */
const DEFAULT_FOOTER = "Bu e-posta ladmin.laffogato.net bildirim adreslerine gönderildi. Adresleri Ödemeler sayfasından değiştirebilirsiniz.";

/**
 * Eski ortak kabuk (kite taşınmamış e-postalar için; docs/BILDIRIMLER.md › E-posta tasarımı envanteri): üstte L'Af
 * başlığı ve tarih, ortada beyaz kart (`card`), altta alıcı notu. `card` ve `brandSub` hazır (kaçışlı) HTML; `footer`
 * düz metin (kaçışı burada; verilmezse bildirim adresleri notu). Yeni e-posta src/lib/email'in layout()'unu kullanır.
 */
export function emailLayout(o: { subject: string; preheader: string; brandSub: string; today: string; card: string; footer?: string }): string {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(o.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;-webkit-text-size-adjust:100%;font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f4f5"><tr><td align="center" style="padding:20px 12px 28px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px">
  <tr><td style="padding:0 4px 14px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
      <td style="vertical-align:middle">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
          <td width="38" height="38" align="center" style="width:38px;height:38px;background:#171717;border-radius:11px;color:#c0f21e;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:-0.02em">L'Af</td>
          <td style="padding-left:10px;font-family:${FONT}">
            <div style="font-size:16px;line-height:20px;font-weight:600;color:#171717">L'Affogato</div>
            <div style="font-size:12px;line-height:16px;color:#71717a">${o.brandSub}</div>
          </td>
        </tr></table>
      </td>
      <td align="right" style="vertical-align:middle;font-family:${FONT};font-size:13px;color:#71717a;white-space:nowrap">${esc(longDateTR(o.today))}</td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#ffffff;border-radius:24px;padding:24px 20px 22px">
    ${o.card}
  </td></tr>
  <tr><td style="padding:16px 12px 0;font-family:${FONT};font-size:12px;line-height:17px;color:#a1a1aa;text-align:center">${esc(o.footer ?? DEFAULT_FOOTER)}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/** Şubeye bağlı alıcının e-postasında kapsam notu (renderDigest `branch`) */
export function branchDigestNote(branch: string): string {
  return `${branch} ve işletme geneli: ödemeler, onay bekleyen istekler ve kontrol listeleri yalnız bu şubenin. Faturalar, zam ve komisyon firma geneli.`;
}

/**
 * Günlük sabah e-postası, e-posta kitiyle (src/lib/email): açık ve koyu temada, telefonda tek sütun. Ödeme varsa üstte
 * toplam büyük rakamla ve aşama rozetleri (gecikmiş, bugün, yaklaşan), sonra varsa sistem uyarıları, aşamalara göre
 * ödemeler (ince ayraçlı satırlar, tutar sağda), Paraşüt'ten gelen yeni faturalar ve uyarı notları, en altta tam
 * genişlikte düğme ve kapanış notu. Ödeme yoksa yalnız öteki bölümler. Gövde sırası: toplam, sistem, ödemeler,
 * faturalar, kontrol bekleyen, fiyat onayı, ek kutular (komisyon, kontrol, onay bekleyenler), zam, tahmin kutusu, düğme.
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
  const paymentsLink = `${APP_URL}/panel/hatirlaticilar`;
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

  // Görünüş (src/lib/email): üstte toplam büyük rakamla ve aşama rozetleri, sistem uyarıları, aşama bölümleri (ince
  // ayraçlı satırlar, tutar sağda), Paraşüt bölümü ve uyarı notları, ek kutular, zam, tahmin kutusu, düğme ve kapanış notu
  const pills = STAGE_ORDER.filter((st) => counts[st])
    .map((st) => badge(`${counts[st]} ${STAGE[st].pill}`, STAGE[st].tone))
    .join(" ");
  const totals = rows.length ? stack([kpiGrid([{ label: "Toplam", value: money(total) }]), paragraph(pills, { html: true })], 12) : null;

  // Tutar aşamanın renginde (gecikmiş kırmızı, bugün turuncu); tutarsız satır gri tire
  const paymentRow = ({ item, stage }: { item: UpcomingItem; stage: NotifyStage }) => {
    const meta = [dateTR(item.dueDate), daysLeftLabel(item.daysLeft), item.detail].filter(Boolean).join(" · ");
    return item.amount !== null ? kvRow(item.title, money(item.amount), { sub: meta, tone: STAGE[stage].tone }) : kvRow(item.title, "–", { sub: meta, quiet: true });
  };
  const sections = STAGE_ORDER.filter((st) => counts[st]).map((st) => {
    const group = rows.filter((r) => r.stage === st);
    const sum = group.reduce((a, r) => a + (r.item.amount ?? 0), 0);
    return section(`${STAGE[st].title} · ${group.length}`, group.map(paymentRow), { aside: money(sum) });
  });

  const invoiceTotal = inv ? inv.items.reduce((a, i) => a + i.payable, 0) : 0;
  const invoiceRow = (i: DigestInvoices["items"][number]) =>
    kvRow(i.supplier, money(i.payable), {
      sub: `${dateTR(i.date)} · ${i.category}`,
      valueSub: i.unpaid && i.dueDate ? `vade ${dateTR(i.dueDate)}` : null,
      badge: i.needsReview ? { text: "kontrol edin", tone: "warn" } : null,
    });
  const moreInvoices = inv ? inv.items.length - MAX_INVOICE_ROWS : 0;
  // Paraşüt bölümünün uyarıları (kontrol bekleyen, kasadan faturalı alım, fiyat onayı) tek turuncu notta, her biri kendi
  // paragrafında bağlantısıyla; cümleler ve bağlantılar eskisiyle aynı
  const invoiceWarnings = inv
    ? [
        inv.reviewCount ? `${esc(reviewSentence(inv))} ${link(`${APP_URL}/panel/faturalar?durum=kontrol`, "Kontrol edin →", "warn")}` : null,
        cashOuts ? `${cashOutSentence(cashOuts)} ${link(`${APP_URL}${CASH_OUT_INVOICES_HREF}`, "Bakın →", "warn")}` : null,
        holds ? `${holds.count} hammadde fiyatı onay bekliyor (${esc(holdsSummary(holds.items))}). ${holdReasonSentence(holds.items)}. ${link(HOLDS_LINK, "Bakın →", "warn")}` : null,
      ].filter((x): x is string => Boolean(x))
    : [];
  // Paraşüt bölümü: eşitleme hatası, yeni faturalar (başlıktaki sayı telefonda başlıktan kopmasın: bölünmez boşluk),
  // altında uyarılar
  const invoiceSection = inv
    ? stack(
        [
          inv.syncError
            ? note([esc(inv.syncError), link(`${APP_URL}/panel/parasut`, "Paraşüt sayfasını aç →", "bad")], { tone: "bad", title: "Paraşüt eşitlemesi başarısız.", html: true })
            : null,
          inv.items.length
            ? section(`Paraşüt'ten gelen yeni faturalar${NBSP}·${NBSP}${inv.items.length}`, inv.items.slice(0, MAX_INVOICE_ROWS).map(invoiceRow), {
                aside: money(invoiceTotal),
                afterHtml: moreInvoices > 0 ? paragraph(`ve ${moreInvoices} fatura daha`, { small: true }) : null,
              })
            : null,
          invoiceWarnings.length ? note(invoiceWarnings.map((w, i) => (i ? `<div style="padding-top:8px">${w}</div>` : w)), { tone: "warn", html: true }) : null,
        ],
        16,
      )
    : null;

  // Zam: üstte aylık kayıp küçük turuncu bantta, hammaddeler (eski → yeni, artış rozeti, altında aylık tutar), fiyatına
  // bakılacak ürünler (önerilen fiyat sağda) ve bağlantı
  const changeRow = (c: DigestPrices["changes"][number]) => {
    // Aylık tutar fiyatların altında kendi satırında: aynı satırda kaydırmasız değer e-postayı telefonda taşırırdı
    const monthly = monthlyText(c.monthly);
    return kvRow(c.name, `${esc(perUnit(c.before, c.unit))} → <strong class="e-ink" style="color:${LIGHT.ink}">${esc(perUnit(c.after, c.unit))}</strong>`, {
      html: true,
      quiet: true,
      // Telefonda hepsi alt alta (kısa değer yanında kalsaydı satırlar karışık görünürdü)
      stack: true,
      badge: { text: `+${pctText(c.pct)}`, tone: "warn" },
      valueSub: monthly || null,
    });
  };
  const priceRow = (p: DigestPrices["products"][number]) =>
    kvRow(`${p.name} · ${p.size}`, money(p.suggestedPrice), {
      sub: `Maliyet oranı ${pctText(p.ratioBefore)} → ${pctText(p.ratioAfter)} · şimdi ${money(p.price)}`,
      valueSub: p.basis === "keep" ? "zammın payı" : "önerilen",
      strong: true,
    });
  const zamLoss = zam ? lossSentence(zam) : "";
  const priceSection = zam
    ? stack(
        [
          section(`Hammadde zamları · ${zam.changes.length}`, zam.changes.slice(0, MAX_PRICE_ROWS).map(changeRow), {
            leadHtml: zamLoss ? statusBanner({ tone: "warn", size: "sm", title: zamLoss }) : null,
          }),
          zam.products.length
            ? section(`Fiyatına bakılacak ürünler · ${zam.productCount}`, zam.products.slice(0, MAX_PRICE_ROWS).map(priceRow), {
                afterHtml: zam.productCount > MAX_PRICE_ROWS ? paragraph(`ve ${zam.productCount - MAX_PRICE_ROWS} ürün daha`, { small: true }) : null,
              })
            : paragraph("Etkilenen ürünlerin maliyet oranı hâlâ hedefte.", { small: true }),
          paragraph(link(`${APP_URL}/panel/urunler#zamlar`, "Önerilen fiyatlara bak →"), { html: true }),
        ],
        20,
      )
    : null;
  // Düğme kutunun bağlantısına: fiyat onayından sonra, zamdan önce (komisyon, sonra kontrol, sonra onay bekleyenler)
  const actionBox = com ?? kon ?? apv;
  const action = rows.length
    ? { href: paymentsLink, label: "Panelde aç" }
    : inv && (inv.items.length || inv.reviewCount || inv.syncError || cashOuts)
      ? { href: `${APP_URL}/panel/faturalar${inv?.reviewCount || cashOuts ? "?durum=kontrol" : "?kaynak=parasut"}`, label: "Faturaları aç" }
      : holdPart
        ? { href: HOLDS_LINK, label: "Hammaddeleri aç" }
        : actionBox
          ? { href: boxUrl(actionBox.href), label: actionBox.link }
          : zam || !sys
            ? { href: `${APP_URL}/panel/urunler#zamlar`, label: "Ürünleri aç" }
            : { href: JOBS_LINK, label: "Günlük işleri aç" };
  // Kapanış notu gövdenin asıl bölümüne göre; yalnız ek kutu varsa not yok (kutular kendi bağlantısını taşır)
  const closing = rows.length
    ? "Ödediklerinizi panelde “Ödedim” ile işaretleyin; tekrar edenler sıradaki tarihe geçer."
    : inv || zam || (!sys && !actionBox)
      ? "Faturalar her sabah Paraşüt'ten kendiliğinden gelir; kategorisi tahmin edilenleri panelde onaylayın."
      : sys
        ? "İş yeniden düzgün çalışınca uyarı kendiliğinden kalkar."
        : "";
  const systemSection = sys
    ? note([...sys.items.map((i) => `<strong>${esc(i.title)}</strong><br>${esc(i.body)}`), link(JOBS_LINK, "Günlük işleri aç →", "bad")], {
        tone: "bad",
        title: `Sistem uyarıları · ${sys.items.length}`,
        html: true,
      })
    : null;

  const html = layout({
    subject,
    preheader,
    meta: rows.length ? "Ödemeler & hatırlatıcılar" : "Sabah özeti",
    date: today,
    eyebrow: `${rows.length ? "Günlük ödeme hatırlatması" : "Günlük sabah özeti"}${branch ? ` · ${branch}` : ""}`,
    title: headline,
    body: [
      // Şube kapsamı küçük gri not: başlıktan sonra göz toplama gitsin
      branch ? paragraph(branchDigestNote(branch), { small: true }) : null,
      totals,
      systemSection,
      ...sections,
      invoiceSection,
      com ? boxHtml(com, "commission") : null,
      kon ? boxHtml(kon, "kontrol") : null,
      apv ? boxHtml(apv, "approvals") : null,
      priceSection,
      fc ? boxHtml(fc, "forecast") : null,
      // Kapanış notu sabit cümle (kaçışsız; eskisiyle aynı)
      stack([button(action.href, action.label), closing ? paragraph(closing, { small: true, align: "center", html: true }) : null], 14),
    ],
    footer: DEFAULT_FOOTER,
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

/** Sistem uyarısı e-postasının konusu: üst etiket, "ne yapmalı" kutusu ve düğme (varsayılan: günlük işler) */
export interface SystemAlertAbout {
  label: string;
  help: string;
  link: { href: string; label: string };
}
const JOBS_ABOUT: SystemAlertAbout = { label: "Günlük işler", help: SYSTEM_ALERT_HELP, link: { href: JOBS_LINK, label: "Günlük işleri aç" } };
/** Veritabanı kotası uyarısı (src/server/db-quota/check.ts; docs/YEDEK.md › Veritabanı kotası) */
export const DB_QUOTA_ABOUT: SystemAlertAbout = {
  label: "Veritabanı",
  help: "Ne yapmalı: Neon konsolunda (console.neon.tech) projenin planını yükseltin ya da geliştiriciden eski kayıtların temizlenmesini isteyin. Plan yükseltilince Vercel'de DB_QUOTA_MB'yi yeni kotaya göre güncelleyin. Paneldeki durum: Ayarlar › Veritabanı.",
  link: { href: `${APP_URL}/panel/ayarlar#veritabani`, label: "Veritabanı kullanımını aç" },
};

/**
 * Bekçi e-postası (Paraşüt işi, 07:00–08:00): dünkü sabah işi çalışmadıysa ya da hata verdiyse kısa uyarı. Sabah
 * e-postasını gönderen iş bozulunca bunu ancak öteki iş söyleyebilir. Sabah e-postasıyla aynı kit (src/lib/email).
 * `about` verilirse aynı kabuk başka bir sistem uyarısını taşır (veritabanı kotası).
 */
export function renderSystemAlert(items: DigestSystem["items"], today: string, about: SystemAlertAbout = JOBS_ABOUT) {
  const first = items[0]?.title ?? "Sistem uyarısı";
  const subject = `L'Affogato · ${first}${items.length > 1 ? ` (+${items.length - 1})` : ""}`;
  const headline = items.length > 1 ? `${items.length} sistem uyarısı` : first;
  // Görünüş (src/lib/email): kırmızı üst etiket ve sorun başlıkta; tek sorunda açıklaması başlığın altında, birden
  // çoksa her biri küçük kırmızı bantta; altında ne yapılacağı (gri not) ve düğme
  const html = layout({
    subject,
    preheader: items.map((i) => i.title).join(" · "),
    meta: "Sistem uyarısı",
    date: today,
    eyebrow: about.label,
    eyebrowTone: "bad",
    title: headline,
    lead: items.length === 1 ? items[0].body : null,
    body: [
      items.length > 1 ? stack(items.map((i) => statusBanner({ tone: "bad", size: "sm", title: i.title, sub: i.body })), 10) : null,
      note(about.help),
      button(about.link.href, about.link.label),
    ],
    footer: DEFAULT_FOOTER,
  });
  const text = [
    `L'Affogato · ${dateTR(today)}`,
    subject,
    "",
    ...items.flatMap((i) => [`- ${i.title}`, `  ${i.body}`]),
    "",
    about.help,
    "",
    `${about.link.label}: ${about.link.href}`,
  ].join("\n");
  return { subject, html, text };
}

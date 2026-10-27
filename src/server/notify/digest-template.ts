/**
 * Günlük hatırlatma e-postasının şablonu (saf; "server-only" yok, tests/hatirlaticilar-digest.test.ts sınar).
 * Veriyi okuyup gönderen kısım digest.ts'te. Ek kutuların (komisyon, kontrol, tahmin) toplanması da burada
 * (`collectDigestExtras`); kaynakların listesi src/server/notify/digest-extras.ts'te. E-postaların ortak kabuğu
 * (`emailLayout`, `esc`, `FONT`) öteki e-postalar için dışa açık.
 */

import { dateTR, money, monthLabel, tl } from "@/lib/format";
import { SYSTEM_ALERT_HELP } from "@/lib/job-health";
import { holdReasonSentence, holdsSummary, HOLDS_HREF } from "@/lib/price-hold";
import { daysLeftLabel, longDateTR, monthShortTR, type NotifyStage, type UpcomingItem } from "@/lib/reminders";
import { capped } from "@/server/jobs/capped";

export const APP_URL = (process.env.APP_URL?.trim() || "https://ladmin.laffogato.net").replace(/\/+$/, "");

/** HTML'e giden her kullanıcı metni buradan geçer */
export const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STAGE: Record<NotifyStage, { label: string; title: string; bg: string; fg: string; tile: string; tileFg: string }> = {
  overdue: { label: "Gecikti", title: "Gecikenler", bg: "#fef2f2", fg: "#dc2626", tile: "#dc2626", tileFg: "#ffffff" },
  due: { label: "Bugün", title: "Son günü bugün", bg: "#fff7ed", fg: "#c2410c", tile: "#e8590c", tileFg: "#ffffff" },
  before: { label: "Yaklaşıyor", title: "Yaklaşanlar", bg: "#f4f4f5", fg: "#3f3f46", tile: "#e4e4e7", tileFg: "#3f3f46" },
};
const STAGE_ORDER: NotifyStage[] = ["overdue", "due", "before"];
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
 * renderDigest'in 6. bağımsız değişkeni: komisyon (komisyon grubu), kontrol (kontrol), tahmin (tahmin), onay bekleyen
 * personel istekleri (dalga 10; docs/ONAYLAR.md)
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

/** Yükleyiciye: önizlemede (`preview`) hiçbir şey yazmaz (okuyan yol), gönderimde ilk kayıt gibi yazımlar serbest */
export interface DigestExtraCtx {
  preview: boolean;
}

/**
 * Ek kutu kaynağı (DIGEST_EXTRA_SOURCES'ın bir satırı). `news`: kutu varsa e-posta gider (yeni bir şey var sayılır);
 * tahmin hiçbir zaman haber değildir (yalnız zaten giden e-postaya eklenir; konuya ve başlığa da girmez). `load` boş
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

/** Kutu renkleri: komisyon, kontrol ve onay bekleyenler turuncu (fiyat onayı kutusu gibi), tahmin gri (bilgi) */
const BOX_TONE: Record<keyof DigestExtras, { bg: string; fg: string }> = {
  commission: { bg: "#fff7ed", fg: "#9a3412" },
  kontrol: { bg: "#fff7ed", fg: "#9a3412" },
  forecast: { bg: "#f4f4f5", fg: "#3f3f46" },
  approvals: { bg: "#fff7ed", fg: "#9a3412" },
};
const LINE_TONE: Record<NonNullable<DigestBox["lines"][number]["tone"]>, string> = { bad: "#b91c1c", warn: "#c2410c", muted: "#71717a" };
/** İlk harf büyük, Türkçe ("i" → "İ"): konu parçası küçük harfle başlayabilir ("dünkü kapanış listesi eksik") */
const upperFirst = (v: string) => `${v.charAt(0).toLocaleUpperCase("tr-TR")}${v.slice(1)}`;

/**
 * Kutunun bağlantısı: yalnız panelin bir yolu (harf, rakam, tire, alt çizgi; sorgu ve # serbest). Başka her adres
 * (fotoğraf, Blob, dış site, ".." ya da %2e ile yukarı çıkan yol) panelin girişine düşer.
 */
const PANEL_PATH = /^\/panel(?:\/[\w-]+)*\/?(?:[?#]\S*)?$/;
const boxUrl = (href: string) => `${APP_URL}${PANEL_PATH.test(href) ? href : "/panel"}`;

/** Ek kutunun HTML'i: fiyat onayı kutusu gibi yuvarlak köşeli renkli kutu; uzun metin sarılır (telefonda taşmaz) */
function boxHtml(b: DigestBox, key: keyof DigestExtras): string {
  const t = BOX_TONE[key];
  const lines = b.lines.map((l) => {
    const style = l.tone ? `;color:${LINE_TONE[l.tone]}${l.tone === "muted" ? ";font-size:13px;line-height:18px" : ""}` : "";
    const body = l.strong ? `<strong>${esc(l.strong)}</strong>${l.text ? `<br>${esc(l.text)}` : ""}` : esc(l.text);
    return `<div style="margin-top:6px${style}">${body}</div>`;
  });
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:14px"><tr><td style="background:${t.bg};border-radius:14px;padding:12px 14px;font-family:${FONT};font-size:14px;line-height:20px;color:${t.fg};word-break:break-word">
  <div style="font-size:13px;line-height:18px;font-weight:600">${esc(b.title)}</div>
  ${lines.join("\n  ")}
  <div style="margin-top:8px"><a href="${esc(boxUrl(b.href))}" style="color:${t.fg};font-weight:600">${esc(b.link)} →</a></div>
</td></tr></table>`;
}

/** Ek kutunun düz metni: boş satır, başlık, satırlar, bağlantı */
const boxText = (b: DigestBox) => ["", b.title, ...b.lines.map((l) => `- ${l.strong ? `${l.strong}${l.text ? `: ${l.text}` : ""}` : l.text}`), `${b.link}: ${boxUrl(b.href)}`];

/** Ortak kabuğun alt notu (sabah e-postası, bekçi e-postası) */
const DEFAULT_FOOTER = "Bu e-posta ladmin.laffogato.net bildirim adreslerine gönderildi. Adresleri Ödemeler & hatırlatıcılar sayfasından değiştirebilirsiniz.";

/**
 * E-postaların ortak kabuğu: üstte L'Af başlığı ve tarih, ortada beyaz kart (`card`), altta alıcı notu. `card` ve
 * `brandSub` hazır (kaçışlı) HTML; `footer` düz metin (kaçışı burada; verilmezse bildirim adresleri notu).
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

/**
 * Günlük sabah e-postası: AkmanOS açık teması, satır içi stiller ve tablolarla (e-posta istemcileri flex ve
 * dış CSS tanımaz). Telefonda tek sütun: üstte L'Af başlığı, varsa sistem uyarıları, aşamalara göre ödemeler, sağa
 * hizalı tutarlar, Paraşüt'ten gelen yeni faturalar, en altta tam genişlikte "Panelde aç" düğmesi. Ödeme yoksa yalnız
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
 */
export function renderDigest(
  rows: { item: UpcomingItem; stage: NotifyStage }[],
  today: string,
  invoices?: DigestInvoices | null,
  prices?: DigestPrices | null,
  system?: DigestSystem | null,
  extras?: DigestExtras | null,
) {
  const counts = { overdue: 0, due: 0, before: 0 };
  for (const r of rows) counts[r.stage]++;
  const parts = [counts.overdue ? `${counts.overdue} gecikmiş` : null, counts.due ? `${counts.due} bugün` : null, counts.before ? `${counts.before} yaklaşan` : null].filter(Boolean);
  const inv = invoices && (invoices.items.length || invoices.reviewCount || invoices.syncError || invoices.priceHolds?.count) ? invoices : null;
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
  const subject = rows.length
    ? `Ödeme hatırlatması: ${parts.join(", ")}${extra ? ` · ${extra}` : ""}`
    : sys
      ? `Sistem uyarısı: ${sys.items[0].title}${sysExtra ? ` · ${sysExtra}` : ""}`
      : inv?.syncError && !invPart
        ? `Paraşüt eşitlemesi başarısız${failExtra ? ` · ${failExtra}` : ""}`
        : lead
          ? `Sabah özeti: ${[lead[0], ...tail.filter((_, i) => i !== lead[1])].filter(Boolean).join(" · ")}`
          : `Sabah özeti: ${zamPart ?? boxLast ?? "bugün yeni bir şey yok"}`;
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

  const pills = STAGE_ORDER.filter((st) => counts[st])
    .map((st) => {
      const c = STAGE[st];
      return `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 10px;border-radius:999px;font-size:12px;line-height:16px;font-weight:600;background:${c.bg};color:${c.fg}">${counts[st]} ${esc(st === "overdue" ? "gecikmiş" : st === "due" ? "bugün" : "yaklaşan")}</span>`;
    })
    .join("");

  const row = ({ item, stage }: { item: UpcomingItem; stage: NotifyStage }) => {
    const c = STAGE[stage];
    const day = Number(item.dueDate.slice(8, 10));
    const meta = [dateTR(item.dueDate), daysLeftLabel(item.daysLeft), item.detail].filter(Boolean).map((v) => esc(String(v))).join(" · ");
    return `<tr>
  <td width="44" style="width:44px;padding:12px 12px 12px 0;vertical-align:top">
    <table role="presentation" width="44" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;width:44px;border-radius:10px;overflow:hidden;border:1px solid #e4e4e7">
      <tr><td align="center" style="background:${c.tile};color:${c.tileFg};font-size:10px;line-height:14px;font-weight:600;font-family:${FONT}">${esc(monthShortTR(item.dueDate))}</td></tr>
      <tr><td align="center" style="background:#ffffff;color:#171717;font-size:18px;line-height:26px;font-weight:600;font-family:${FONT}">${day}</td></tr>
    </table>
  </td>
  <td style="padding:12px 0;vertical-align:top;font-family:${FONT}">
    <div style="font-size:15px;line-height:20px;font-weight:600;color:#171717">${esc(item.title)}</div>
    <div style="font-size:13px;line-height:18px;color:#71717a;margin-top:2px">${meta}</div>
  </td>
  <td align="right" style="padding:12px 0 12px 12px;vertical-align:top;white-space:nowrap;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:#171717">${item.amount !== null ? esc(money(item.amount)) : '<span style="color:#a1a1aa">–</span>'}</td>
</tr>`;
  };

  const sections = STAGE_ORDER.filter((st) => counts[st])
    .map((st) => {
      const c = STAGE[st];
      const group = rows.filter((r) => r.stage === st);
      const sum = group.reduce((a, r) => a + (r.item.amount ?? 0), 0);
      return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:20px">
  <tr>
    <td style="padding:0 0 4px;border-bottom:1px solid #e4e4e7;font-family:${FONT}">
      <span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${c.fg};margin-right:6px;vertical-align:middle"></span><span style="font-size:13px;font-weight:600;color:${c.fg};vertical-align:middle">${esc(c.title)} · ${group.length}</span>
    </td>
    <td align="right" style="padding:0 0 4px;border-bottom:1px solid #e4e4e7;font-family:${FONT};font-size:13px;color:#71717a;white-space:nowrap">${esc(money(sum))}</td>
  </tr>
</table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse">${group.map(row).join("\n")}</table>`;
    })
    .join("\n");

  const invoiceTotal = inv ? inv.items.reduce((a, i) => a + i.payable, 0) : 0;
  const invoiceRow = (i: DigestInvoices["items"][number]) => `<tr>
  <td style="padding:10px 0;vertical-align:top;font-family:${FONT}">
    <div style="font-size:15px;line-height:20px;font-weight:600;color:#171717">${esc(i.supplier)}</div>
    <div style="font-size:13px;line-height:18px;color:#71717a;margin-top:2px">${esc(dateTR(i.date))} · ${esc(i.category)}${i.unpaid && i.dueDate ? ` · <span style="color:#c2410c;font-weight:600">vade ${esc(dateTR(i.dueDate))}</span>` : ""}${i.needsReview ? ' · <span style="color:#c2410c;font-weight:600">kontrol edin</span>' : ""}</div>
  </td>
  <td align="right" style="padding:10px 0 10px 12px;vertical-align:top;white-space:nowrap;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:#171717">${esc(money(i.payable))}</td>
</tr>`;
  const invoiceSection = inv
    ? `${
        inv.syncError
          ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:${rows.length ? 22 : 8}px"><tr><td style="background:#fef2f2;border-radius:14px;padding:12px 14px;font-family:${FONT};font-size:14px;line-height:20px;color:#b91c1c"><strong>Paraşüt eşitlemesi başarısız.</strong> ${esc(inv.syncError)}<br><a href="${APP_URL}/panel/parasut" style="color:#b91c1c;font-weight:600">Paraşüt sayfasını aç →</a></td></tr></table>`
          : ""
      }${
        inv.items.length
          ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:22px">
  <tr>
    <td style="padding:0 0 4px;border-bottom:1px solid #e4e4e7;font-family:${FONT}"><span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:#2563eb;margin-right:6px;vertical-align:middle"></span><span style="font-size:13px;font-weight:600;color:#2563eb;vertical-align:middle">Paraşüt'ten gelen yeni faturalar · ${inv.items.length}</span></td>
    <td align="right" style="padding:0 0 4px;border-bottom:1px solid #e4e4e7;font-family:${FONT};font-size:13px;color:#71717a;white-space:nowrap">${esc(money(invoiceTotal))}</td>
  </tr>
</table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse">${inv.items.slice(0, MAX_INVOICE_ROWS).map(invoiceRow).join("\n")}</table>${
              inv.items.length > MAX_INVOICE_ROWS
                ? `<div style="font-family:${FONT};font-size:13px;color:#71717a;padding:4px 0 0">ve ${inv.items.length - MAX_INVOICE_ROWS} fatura daha</div>`
                : ""
            }`
          : ""
      }${
        inv.reviewCount
          ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:14px"><tr><td style="background:#fff7ed;border-radius:14px;padding:12px 14px;font-family:${FONT};font-size:14px;line-height:20px;color:#9a3412">${reviewSentence(inv)} <a href="${APP_URL}/panel/faturalar?durum=kontrol" style="color:#9a3412;font-weight:600">Kontrol edin →</a></td></tr></table>`
          : ""
      }${
        holds
          ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:14px"><tr><td style="background:#fff7ed;border-radius:14px;padding:12px 14px;font-family:${FONT};font-size:14px;line-height:20px;color:#9a3412">${holds.count} hammadde fiyatı onay bekliyor (${esc(holdsSummary(holds.items))}). ${holdReasonSentence(holds.items)}. <a href="${HOLDS_LINK}" style="color:#9a3412;font-weight:600">Bakın →</a></td></tr></table>`
          : ""
      }`
    : "";
  const priceRow = (p: DigestPrices["products"][number]) => `<tr>
  <td style="padding:10px 0;vertical-align:top;font-family:${FONT}">
    <div style="font-size:15px;line-height:20px;font-weight:600;color:#171717">${esc(p.name)} · ${esc(p.size)}</div>
    <div style="font-size:13px;line-height:18px;color:#71717a;margin-top:2px">Maliyet oranı ${esc(pctText(p.ratioBefore))} → <span style="color:#c2410c;font-weight:600">${esc(pctText(p.ratioAfter))}</span> · şimdi ${esc(money(p.price))}</div>
  </td>
  <td align="right" style="padding:10px 0 10px 12px;vertical-align:top;white-space:nowrap;font-family:${FONT}"><div style="font-size:12px;line-height:16px;color:#71717a">${p.basis === "keep" ? "zammın payı" : "önerilen"}</div><div style="font-size:15px;line-height:20px;font-weight:600;color:#171717">${esc(money(p.suggestedPrice))}</div></td>
</tr>`;
  const zamLoss = zam ? lossSentence(zam) : "";
  const priceSection = zam
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:22px">
  <tr><td style="padding:0 0 4px;border-bottom:1px solid #e4e4e7;font-family:${FONT}"><span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:#c2410c;margin-right:6px;vertical-align:middle"></span><span style="font-size:13px;font-weight:600;color:#c2410c;vertical-align:middle">Hammadde zamları · ${zam.changes.length}</span></td></tr>
</table>${zamLoss ? `\n<div style="font-family:${FONT};font-size:14px;line-height:20px;color:#9a3412;padding:10px 0 2px;font-weight:600">${esc(zamLoss)}</div>` : ""}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse">${zam.changes
        .slice(0, MAX_PRICE_ROWS)
        .map((c) => {
          // Aylık tutar fiyatların altında kendi satırında: aynı satırda kaydırmasız (nowrap) hücre e-postayı telefon
          // genişliğinden taşırırdı. İki satırlı hücrede ad üste hizalanır; tutar yoksa satır eskisinin aynısı
          const monthly = monthlyText(c.monthly);
          const top = monthly ? "vertical-align:top;" : "";
          return `<tr><td style="padding:8px 0;${top}font-family:${FONT};font-size:14px;line-height:19px;color:#171717">${esc(c.name)}</td><td align="right" style="padding:8px 0 8px 12px;${top}font-family:${FONT};font-size:13px;line-height:19px;color:#71717a;white-space:nowrap">${esc(perUnit(c.before, c.unit))} → <strong style="color:#171717">${esc(perUnit(c.after, c.unit))}</strong> <span style="color:#c2410c;font-weight:600">+${esc(pctText(c.pct))}</span>${monthly ? `<div style="font-size:12px;line-height:16px;color:#c2410c">${esc(monthly)}</div>` : ""}</td></tr>`;
        })
        .join("\n")}</table>${
        zam.products.length
          ? `<div style="font-family:${FONT};font-size:13px;line-height:18px;color:#3f3f46;padding:14px 0 0;font-weight:600">Fiyatına bakılacak ürünler · ${zam.productCount}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse">${zam.products.slice(0, MAX_PRICE_ROWS).map(priceRow).join("\n")}</table>${
              zam.productCount > MAX_PRICE_ROWS ? `<div style="font-family:${FONT};font-size:13px;color:#71717a;padding:4px 0 0">ve ${zam.productCount - MAX_PRICE_ROWS} ürün daha</div>` : ""
            }`
          : `<div style="font-family:${FONT};font-size:13px;line-height:18px;color:#71717a;padding:10px 0 0">Etkilenen ürünlerin maliyet oranı hâlâ hedefte.</div>`
      }<div style="font-family:${FONT};font-size:14px;padding:10px 0 0"><a href="${APP_URL}/panel/urunler#zamlar" style="color:#c2410c;font-weight:600">Önerilen fiyatlara bak →</a></div>`
    : "";
  // Düğme kutunun bağlantısına: fiyat onayından sonra, zamdan önce (komisyon, sonra kontrol, sonra onay bekleyenler)
  const actionBox = com ?? kon ?? apv;
  const button = rows.length
    ? { href: link, label: "Panelde aç" }
    : inv && (inv.items.length || inv.reviewCount || inv.syncError)
      ? { href: `${APP_URL}/panel/faturalar${inv?.reviewCount ? "?durum=kontrol" : "?kaynak=parasut"}`, label: "Faturaları aç" }
      : holdPart
        ? { href: HOLDS_LINK, label: "Hammaddeleri aç" }
        : actionBox
          ? { href: boxUrl(actionBox.href), label: actionBox.link }
          : zam || !sys
            ? { href: `${APP_URL}/panel/urunler#zamlar`, label: "Ürünleri aç" }
            : { href: JOBS_LINK, label: "Günlük işleri aç" };
  const boxes = [com ? boxHtml(com, "commission") : "", kon ? boxHtml(kon, "kontrol") : "", apv ? boxHtml(apv, "approvals") : ""].join("");
  const forecastBox = fc ? boxHtml(fc, "forecast") : "";
  // Kapanış notu gövdenin asıl bölümüne göre; yalnız ek kutu varsa not yok (kutular kendi bağlantısını taşır)
  const note = rows.length
    ? "Ödediklerinizi panelde “Ödendi” olarak işaretleyin; tekrar edenler sıradaki tarihe geçer."
    : inv || zam || (!sys && !actionBox)
      ? "Faturalar her sabah Paraşüt'ten kendiliğinden gelir; kategorisi tahmin edilenleri panelde onaylayın."
      : sys
        ? "İş yeniden düzgün çalışınca uyarı kendiliğinden kalkar."
        : "";
  const systemSection = sys
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px"><tr><td style="background:#fef2f2;border-radius:14px;padding:12px 14px;font-family:${FONT};font-size:14px;line-height:20px;color:#b91c1c">
  <div style="font-size:13px;line-height:18px;font-weight:600">Sistem uyarıları · ${sys.items.length}</div>
  ${sys.items.map((i) => `<div style="margin-top:8px"><strong>${esc(i.title)}</strong><br>${esc(i.body)}</div>`).join("\n  ")}
  <div style="margin-top:8px"><a href="${JOBS_LINK}" style="color:#b91c1c;font-weight:600">Günlük işleri aç →</a></div>
</td></tr></table>`
    : "";

  const html = emailLayout({
    subject,
    preheader,
    brandSub: rows.length ? "Ödemeler &amp; hatırlatıcılar" : "Sabah özeti",
    today,
    card: `<div style="font-family:${FONT};font-size:13px;line-height:18px;color:#71717a">${rows.length ? "Günlük ödeme hatırlatması" : "Günlük sabah özeti"}</div>
    <h1 style="margin:4px 0 10px;font-family:${FONT};font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.02em;color:#171717">${esc(headline)}</h1>
    <div>${pills}</div>
    ${systemSection}
    ${sections}
    ${
      rows.length
        ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:4px">
      <tr>
        <td style="padding:14px 0 0;border-top:1px solid #e4e4e7;font-family:${FONT};font-size:14px;color:#3f3f46">Toplam</td>
        <td align="right" style="padding:14px 0 0;border-top:1px solid #e4e4e7;font-family:${FONT};font-size:18px;font-weight:600;color:#171717;white-space:nowrap">${esc(money(total))}</td>
      </tr>
    </table>`
        : ""
    }
    ${invoiceSection}${boxes}
    ${priceSection}${forecastBox}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px">
      <tr><td align="center" bgcolor="#171717" style="border-radius:14px;background:#171717">
        <a href="${esc(button.href)}" style="display:block;padding:15px 20px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:14px">${esc(button.label)}</a>
      </td></tr>
    </table>
    ${note ? `<p style="margin:12px 0 0;font-family:${FONT};font-size:13px;line-height:19px;color:#71717a;text-align:center">${note}</p>` : ""}`,
  });

  const text = [
    `L'Affogato · ${dateTR(today)}`,
    subject,
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
    `${button.label}: ${button.href}`,
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
  const list = items
    .map(
      (i) => `<tr><td style="padding:10px 0;border-top:1px solid #e4e4e7;font-family:${FONT}">
  ${items.length > 1 ? `<div style="font-size:15px;line-height:20px;font-weight:600;color:#171717">${esc(i.title)}</div>` : ""}
  <div style="font-size:14px;line-height:20px;color:#3f3f46;margin-top:2px">${esc(i.body)}</div>
</td></tr>`,
    )
    .join("\n");
  const html = emailLayout({
    subject,
    preheader: items.map((i) => i.title).join(" · "),
    brandSub: "Sistem uyarısı",
    today,
    card: `<div style="font-family:${FONT};font-size:13px;line-height:18px;color:#b91c1c;font-weight:600">Günlük işler</div>
    <h1 style="margin:4px 0 10px;font-family:${FONT};font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.02em;color:#171717">${esc(headline)}</h1>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse">${list}</table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:14px"><tr><td style="background:#fef2f2;border-radius:14px;padding:12px 14px;font-family:${FONT};font-size:14px;line-height:20px;color:#b91c1c">${esc(SYSTEM_ALERT_HELP)}</td></tr></table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px">
      <tr><td align="center" bgcolor="#171717" style="border-radius:14px;background:#171717">
        <a href="${JOBS_LINK}" style="display:block;padding:15px 20px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:14px">Günlük işleri aç</a>
      </td></tr>
    </table>`,
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

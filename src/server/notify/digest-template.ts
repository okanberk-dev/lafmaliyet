/**
 * Günlük hatırlatma e-postasının şablonu (saf; "server-only" yok, tests/hatirlaticilar-digest.test.ts sınar).
 * Veriyi okuyup gönderen kısım digest.ts'te.
 */

import { dateTR, money } from "@/lib/format";
import { SYSTEM_ALERT_HELP } from "@/lib/job-health";
import { holdsSummary, HOLDS_HREF } from "@/lib/price-hold";
import { daysLeftLabel, longDateTR, monthShortTR, type NotifyStage, type UpcomingItem } from "@/lib/reminders";

export const APP_URL = (process.env.APP_URL?.trim() || "https://ladmin.laffogato.net").replace(/\/+$/, "");

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STAGE: Record<NotifyStage, { label: string; title: string; bg: string; fg: string; tile: string; tileFg: string }> = {
  overdue: { label: "Gecikti", title: "Gecikenler", bg: "#fef2f2", fg: "#dc2626", tile: "#dc2626", tileFg: "#ffffff" },
  due: { label: "Bugün", title: "Son günü bugün", bg: "#fff7ed", fg: "#c2410c", tile: "#e8590c", tileFg: "#ffffff" },
  before: { label: "Yaklaşıyor", title: "Yaklaşanlar", bg: "#f4f4f5", fg: "#3f3f46", tile: "#e4e4e7", tileFg: "#3f3f46" },
};
const STAGE_ORDER: NotifyStage[] = ["overdue", "due", "before"];
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Geist,Roboto,Helvetica,Arial,sans-serif";

/** Sabah e-postasının Paraşüt bölümü: son e-postadan bu yana gelen faturalar, kontrol bekleyenler, eşitleme hatası */
export interface DigestInvoices {
  /** unpaid + dueDate: e-faturadaki vadesi gelmemiş (Ödemeler'e düşen) fatura */
  items: { supplier: string; date: string; payable: number; category: string; needsReview: boolean; unpaid?: boolean; dueDate?: string | null }[];
  /** Kontrol bekleyen (kategorisi tahminle yazılmış) bütün faturalar */
  reviewCount: number;
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

/** E-postada listelenen en fazla yeni fatura (kalanı "ve N fatura daha") */
const MAX_INVOICE_ROWS = 10;

/** Sabah e-postasının zam bölümü: son e-postadan bu yana zamlanan hammaddeler ve fiyatı hedefin altına düşen ürünler */
export interface DigestPrices {
  /** Birim fiyatlar ₺/gr, ₺/ml ya da ₺/adet (e-postada kg, L, adet başına yazılır) */
  changes: { name: string; unit: string; before: number; after: number; pct: number }[];
  products: { name: string; size: string; price: number; suggestedPrice: number; basis: "target" | "keep"; ratioBefore: number; ratioAfter: number }[];
  /** Maliyet oranı hedefin üstüne çıkan, fiyatı önerilenin altındaki bütün ürünler (listede ilk MAX_PRICE_ROWS) */
  productCount: number;
}

const MAX_PRICE_ROWS = 6;
const pctText = (v: number) => `%${Math.round(v * 100)}`;
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

/**
 * E-postaların ortak kabuğu: üstte L'Af başlığı ve tarih, ortada beyaz kart (`card`), altta alıcı notu. `card` ve
 * `brandSub` hazır (kaçışlı) HTML.
 */
function emailLayout(o: { subject: string; preheader: string; brandSub: string; today: string; card: string }): string {
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
  <tr><td style="padding:16px 12px 0;font-family:${FONT};font-size:12px;line-height:17px;color:#a1a1aa;text-align:center">Bu e-posta ladmin.laffogato.net bildirim adreslerine gönderildi. Adresleri Ödemeler &amp; hatırlatıcılar sayfasından değiştirebilirsiniz.</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/**
 * Günlük sabah e-postası: AkmanOS açık teması, satır içi stiller ve tablolarla (e-posta istemcileri flex ve
 * dış CSS tanımaz). Telefonda tek sütun: üstte L'Af başlığı, varsa sistem uyarıları, aşamalara göre ödemeler, sağa
 * hizalı tutarlar, Paraşüt'ten gelen yeni faturalar, en altta tam genişlikte "Panelde aç" düğmesi. Ödeme yoksa yalnız
 * öteki bölümler.
 *
 * Konu (öncelik sırasıyla; ötekiler " · " ile eklenir): ödeme varsa "Ödeme hatırlatması: …" (+ sistem uyarısı, yeni
 * fatura, yeni fiyat onayı, zam); yoksa sistem uyarısı varsa "Sistem uyarısı: <ilk başlık>"; yoksa yeni faturasız
 * eşitleme hatası "Paraşüt eşitlemesi başarısız"; yoksa yeni fatura, kontrol bekleyen ya da yeni fiyat onayı "Sabah
 * özeti: …"; yoksa zam ya da "bugün yeni bir şey yok". Bölüm ekleyenler konuya yalnız kendi parçasını katar; sırayı
 * burası belirler.
 */
export function renderDigest(
  rows: { item: UpcomingItem; stage: NotifyStage }[],
  today: string,
  invoices?: DigestInvoices | null,
  prices?: DigestPrices | null,
  system?: DigestSystem | null,
) {
  const counts = { overdue: 0, due: 0, before: 0 };
  for (const r of rows) counts[r.stage]++;
  const parts = [counts.overdue ? `${counts.overdue} gecikmiş` : null, counts.due ? `${counts.due} bugün` : null, counts.before ? `${counts.before} yaklaşan` : null].filter(Boolean);
  const inv = invoices && (invoices.items.length || invoices.reviewCount || invoices.syncError || invoices.priceHolds?.count) ? invoices : null;
  const invPart = inv?.items.length ? `${inv.items.length} yeni fatura` : null;
  // Onay bekleyen fiyatlar bölümde hep görünür; konuya ve başlığa yalnız son e-postadan beri yenisi geldiyse girer
  const holds = inv?.priceHolds?.count ? inv.priceHolds : null;
  const holdPart = holds?.fresh ? `${holds.count} fiyat onay bekliyor` : null;
  const zam = prices && prices.changes.length ? prices : null;
  const zamPart = zam ? (zam.productCount ? `zam: ${zam.productCount} ürünün fiyatına bakın` : `${zam.changes.length} hammaddeye zam`) : null;
  const sys = system && system.items.length ? system : null;
  const extra = [sys ? "sistem uyarısı" : null, invPart, holdPart, zamPart].filter(Boolean).join(" · ");
  const sysExtra = [invPart, holdPart, zamPart].filter(Boolean).join(" · ");
  const failExtra = [holdPart, zamPart].filter(Boolean).join(" · ");
  const subject = rows.length
    ? `Ödeme hatırlatması: ${parts.join(", ")}${extra ? ` · ${extra}` : ""}`
    : sys
      ? `Sistem uyarısı: ${sys.items[0].title}${sysExtra ? ` · ${sysExtra}` : ""}`
      : inv?.syncError && !invPart
        ? `Paraşüt eşitlemesi başarısız${failExtra ? ` · ${failExtra}` : ""}`
        : invPart || inv?.reviewCount || holdPart
          ? `Sabah özeti: ${[invPart ?? (inv?.reviewCount ? `${inv.reviewCount} fatura kontrol bekliyor` : null), holdPart, zamPart].filter(Boolean).join(" · ")}`
          : `Sabah özeti: ${zamPart ?? "bugün yeni bir şey yok"}`;
  const total = rows.reduce((a, r) => a + (r.item.amount ?? 0), 0);
  const link = `${APP_URL}/panel/hatirlaticilar`;
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
              : zam
              ? zam.productCount
                ? `Hammadde zammı: ${zam.productCount} ürünün fiyatına bakın`
                : `${zam.changes.length} hammaddenin fiyatı arttı`
              : "Bugün yeni bir şey yok";
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
          ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:14px"><tr><td style="background:#fff7ed;border-radius:14px;padding:12px 14px;font-family:${FONT};font-size:14px;line-height:20px;color:#9a3412">${inv.reviewCount} faturanın kategorisi tahminle yazıldı. <a href="${APP_URL}/panel/faturalar?durum=kontrol" style="color:#9a3412;font-weight:600">Kontrol edin →</a></td></tr></table>`
          : ""
      }${
        holds
          ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:14px"><tr><td style="background:#fff7ed;border-radius:14px;padding:12px 14px;font-family:${FONT};font-size:14px;line-height:20px;color:#9a3412">${holds.count} hammadde fiyatı onay bekliyor (${esc(holdsSummary(holds.items))}). Faturadaki fiyat şimdikinden %40'tan fazla farklı. <a href="${HOLDS_LINK}" style="color:#9a3412;font-weight:600">Bakın →</a></td></tr></table>`
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
  const priceSection = zam
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:22px">
  <tr><td style="padding:0 0 4px;border-bottom:1px solid #e4e4e7;font-family:${FONT}"><span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:#c2410c;margin-right:6px;vertical-align:middle"></span><span style="font-size:13px;font-weight:600;color:#c2410c;vertical-align:middle">Hammadde zamları · ${zam.changes.length}</span></td></tr>
</table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse">${zam.changes
        .slice(0, MAX_PRICE_ROWS)
        .map(
          (c) => `<tr><td style="padding:8px 0;font-family:${FONT};font-size:14px;line-height:19px;color:#171717">${esc(c.name)}</td><td align="right" style="padding:8px 0 8px 12px;font-family:${FONT};font-size:13px;line-height:19px;color:#71717a;white-space:nowrap">${esc(perUnit(c.before, c.unit))} → <strong style="color:#171717">${esc(perUnit(c.after, c.unit))}</strong> <span style="color:#c2410c;font-weight:600">+${esc(pctText(c.pct))}</span></td></tr>`,
        )
        .join("\n")}</table>${
        zam.products.length
          ? `<div style="font-family:${FONT};font-size:13px;line-height:18px;color:#3f3f46;padding:14px 0 0;font-weight:600">Fiyatına bakılacak ürünler · ${zam.productCount}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse">${zam.products.slice(0, MAX_PRICE_ROWS).map(priceRow).join("\n")}</table>${
              zam.productCount > MAX_PRICE_ROWS ? `<div style="font-family:${FONT};font-size:13px;color:#71717a;padding:4px 0 0">ve ${zam.productCount - MAX_PRICE_ROWS} ürün daha</div>` : ""
            }`
          : `<div style="font-family:${FONT};font-size:13px;line-height:18px;color:#71717a;padding:10px 0 0">Etkilenen ürünlerin maliyet oranı hâlâ hedefte.</div>`
      }<div style="font-family:${FONT};font-size:14px;padding:10px 0 0"><a href="${APP_URL}/panel/urunler#zamlar" style="color:#c2410c;font-weight:600">Önerilen fiyatlara bak →</a></div>`
    : "";
  const button = rows.length
    ? { href: link, label: "Panelde aç" }
    : inv && (inv.items.length || inv.reviewCount || inv.syncError)
      ? { href: `${APP_URL}/panel/faturalar${inv?.reviewCount ? "?durum=kontrol" : "?kaynak=parasut"}`, label: "Faturaları aç" }
      : holdPart
        ? { href: HOLDS_LINK, label: "Hammaddeleri aç" }
        : zam || !sys
        ? { href: `${APP_URL}/panel/urunler#zamlar`, label: "Ürünleri aç" }
        : { href: JOBS_LINK, label: "Günlük işleri aç" };
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
    ${invoiceSection}
    ${priceSection}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px">
      <tr><td align="center" bgcolor="#171717" style="border-radius:14px;background:#171717">
        <a href="${button.href}" style="display:block;padding:15px 20px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:14px">${button.label}</a>
      </td></tr>
    </table>
    <p style="margin:12px 0 0;font-family:${FONT};font-size:13px;line-height:19px;color:#71717a;text-align:center">${
      rows.length
        ? "Ödediklerinizi panelde “Ödendi” olarak işaretleyin; tekrar edenler sıradaki tarihe geçer."
        : inv || zam || !sys
          ? "Faturalar her sabah Paraşüt'ten kendiliğinden gelir; kategorisi tahmin edilenleri panelde onaylayın."
          : "İş yeniden düzgün çalışınca uyarı kendiliğinden kalkar."
    }</p>`,
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
    ...(zam
      ? [
          "",
          `Hammadde zamları (${zam.changes.length})`,
          ...zam.changes.slice(0, MAX_PRICE_ROWS).map((c) => `- ${c.name}: ${perUnit(c.before, c.unit)} → ${perUnit(c.after, c.unit)} (+${pctText(c.pct)})`),
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

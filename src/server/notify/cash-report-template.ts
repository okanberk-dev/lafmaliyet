/**
 * Gün sonu kasa raporu e-postası (saf; "server-only" yok, tests/kasa-raporu.test.ts sınar). Sabah e-postasıyla aynı
 * görünüm: üstte L'Af başlığı, büyük kasa sonucu (eksik kırmızı, fazla turuncu, tutuyor yeşil), ModPOS Z raporu, kasa
 * ve banka POS Z (yazarkasa) bölümleri, en altta "Panelde aç". Alıcıları yönetici seçer (personelin adresi düşer,
 * report-store.ts cashEmailRecipients): yazarkasanın toplamı, KDV'si ve ModPOS'la karşılaştırmalar yalnız burada
 * (docs/planlar/okc-z.md İlke 8, §8). Metin sürümü WhatsApp metninin yıldızsız, yöneticinin satırlarıyla hâli.
 */

import {
  branchPart,
  byLine,
  CARD_EXTRA_LABEL,
  OFF_DEVICE_CARD_LABEL,
  carryWarning,
  CASH_TOLERANCE,
  cashOutLines,
  changesText,
  cashReportText,
  computeCash,
  nextWarning,
  paymentLines,
  photoNames,
  reportNo,
  reportSubject,
  unreceiptedText,
  withCardExtra,
  zSectionTitle,
  type CashReportExtras,
  type CashReportIntegrity,
  type CashTextFields,
  type DayWaste,
  revenueWord,
} from "@/lib/cash-report";
import { money } from "@/lib/format";
import { lafposDiffsLine } from "@/lib/lafpos/diffs";
import { lafposIkramCheck, type LafposZKinds } from "@/lib/lafpos/ikram";
import { okcHasFigures, okcReconcile, type OkcReconcileLine } from "@/lib/okc-z";
import { photoDiffText } from "@/lib/photo-read/kasa";
import { longDateTR } from "@/lib/reminders";
import type { TillOnlineRow } from "@/lib/site-sales/calc";
import { handedOverLine } from "@/lib/teslim";

import { APP_URL } from "./digest-template";

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Geist,Roboto,Helvetica,Arial,sans-serif";

const TONE = {
  short: { bg: "#fef2f2", fg: "#dc2626", label: "eksik" },
  over: { bg: "#fff7ed", fg: "#c2410c", label: "fazla" },
  even: { bg: "#f0fdf4", fg: "#15803d", label: "tutuyor" },
} as const;

function row(label: string, value: string, opts: { strong?: boolean; color?: string; sub?: string } = {}) {
  return `<tr>
  <td style="padding:7px 0;font-family:${FONT};font-size:14px;line-height:19px;color:#3f3f46">${esc(label)}${opts.sub ? `<div style="font-size:12px;line-height:16px;color:#71717a">${esc(opts.sub)}</div>` : ""}</td>
  <td align="right" style="padding:7px 0 7px 12px;font-family:${FONT};font-size:${opts.strong ? 16 : 14}px;line-height:19px;font-weight:${opts.strong ? 700 : 600};color:${opts.color ?? "#171717"};white-space:nowrap;vertical-align:top">${esc(value)}</td>
</tr>`;
}

/** Uzun metin satırı (kalem listesi): sarılır, sağa yaslanmaz */
function textRow(label: string, text: string) {
  return `<tr><td colspan="2" style="padding:7px 0;font-family:${FONT};font-size:14px;line-height:20px;color:#171717"><span style="color:#3f3f46">${esc(label)}:</span> ${esc(text)}</td></tr>`;
}

/** Turuncu uyarı kutusu; birden çok uyarı alt alta */
function warnBox(lines: (string | null | undefined)[], marginTop = 6) {
  const list = lines.filter((l): l is string => Boolean(l));
  if (!list.length) return "";
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:${marginTop}px"><tr><td style="background:#fff7ed;border-radius:12px;padding:10px 12px;font-family:${FONT};font-size:13px;line-height:18px;color:#9a3412">${list.map(esc).join("<br>")}</td></tr></table>`;
}

const LINE_TONE: Record<OkcReconcileLine["tone"], { bg: string; fg: string }> = {
  good: { bg: "#f0fdf4", fg: "#15803d" },
  info: { bg: "#f4f4f5", fg: "#3f3f46" },
  warn: { bg: "#fff7ed", fg: "#9a3412" },
};

/** Karşılaştırma satırları (yazarkasa ↔ ModPOS ↔ banka): tonuna göre renkli, alt alta kutular */
function toneLines(lines: { tone: OkcReconcileLine["tone"]; text: string }[]) {
  if (!lines.length) return "";
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:6px">${lines
    .map(
      (l) =>
        `<tr><td style="padding:0 0 4px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="background:${LINE_TONE[l.tone].bg};border-radius:12px;padding:8px 12px;font-family:${FONT};font-size:13px;line-height:18px;color:${LINE_TONE[l.tone].fg}">${esc(l.text)}</td></tr></table></td></tr>`,
    )
    .join("")}</table>`;
}

function section(title: string, rows: string, warning?: string | null | (string | null | undefined)[]) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:20px">
  <tr><td style="padding:0 0 4px;border-bottom:1px solid #e4e4e7;font-family:${FONT};font-size:13px;font-weight:600;color:#3f3f46">${esc(title)}</td></tr>
</table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse">${rows}</table>${warnBox(Array.isArray(warning) ? warning : [warning])}`;
}

export function renderCashReport(
  f: CashTextFields,
  meta: {
    by: string;
    revision: number;
    submittedAt: Date;
    waste?: DayWaste | null;
    /** Panelde kayıtlı ikramın menü fiyatıyla değeri */
    ikramValue?: number | null;
    /**
     * LafPOS gününde günün sonu geldiyse LafPOS'un ikramı (denetim E-38; src/lib/lafpos/ikram.ts): Z'deki ödenmez
     * tutarı, ikram ve zayi satırlarının menü değeri (listValue ikisinin toplamı; yoksa yalnız ikram) ve panele girilip
     * sayılmayan ürün ikramı. Varsa ikram denetimi Z'yi listenin tamamıyla karşılaştırır (LafPOS'un ödenmez tutarı zayi
     * yazılan kalemi de kapsar); yoksa (geçiş günü boş ya da gün sonu gelmedi) bugünkü gibi panelin ikramıyla
     */
    lafposIkram?: {
      offRevenue: number | null;
      ikramValue: number;
      zayiValue?: number;
      listValue?: number;
      notCounted: number;
      /** Faz 2: hazırlanmış iptaller (zayi tüketimi) ve hazırlanmamışlar (bilgi) */
      iptalValue?: number;
      unprepared?: { count: number; value: number };
      /** Faz 2: türe göre Z toplamları ve liste; varsa denetim tür tür (lafposIkramCheck) */
      byKind?: { z: LafposZKinds | null; list: { ikram: number; odenmez: number; zayi: number } };
    } | null;
    /**
     * laffogato.net'in o günkü online satışı ve karaoke ön ödemesi (bilgi; kasadan geçmez, kasa farkına girmez). Site
     * ulaşılamadıysa null: satır yazılmaz.
     */
    online?: TillOnlineRow | null;
    /**
     * Raporun yöneticinin onayıyla kaydedildiği (personelin düzeltme önerisi ya da geç raporu): başlığın altında tek
     * satır ("Yönetici onayıyla düzeltildi: Mehmet önerdi, Ayşe onayladı."); yoksa yazılmaz
     */
    approval?: string | null;
    /**
     * Raporun şubesi, birden çok kasa açıkken (src/lib/branches.ts namedTill): konuda, başlıkta ve metinde numaranın
     * yanında adı, "Panelde aç"ta `&sube=` (zilin bağlantısı gibi; o şubenin raporu açılır). Tek kasada null: bugünkü gibi
     */
    branch?: { id: string; name: string } | null;
    /**
     * Şubenin banka POS'u ve yazarkasanın sicil numarası (Şube ayarları › Banka POS ve yazarkasa; şube ayarı kasa.cihaz):
     * yazarkasa bölümünün başlığında ("Pavo · sicil AB123"). Belirtilmediyse yazılmaz (bugünkü gibi)
     */
    device?: { label: string | null; registerNo: string | null } | null;
  } & CashReportExtras &
    CashReportIntegrity,
) {
  // LafPOS gününde kart karşılaştırması kartla bahşiş ve cari tahsilatını (G11) ve yazarkasadan geçmeyen ödemeyi (Faz 2) düşer
  f = withCardExtra(f, meta.cardExtra, meta.offDevice, meta.kasa);
  const c = computeCash(f);
  const tone = TONE[c.kind];
  const branchName = meta.branch?.name ?? null;
  const subject = reportSubject(f, meta.revision, branchName);
  const headline = c.kind === "even" ? "Kasa tutuyor" : `${money(Math.abs(c.cashDiff))} ${tone.label}`;
  const time = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(meta.submittedAt);
  const zMeta = [f.zNo ? `Z no ${f.zNo}` : null, f.receipts ? `${f.receipts} fiş` : null].filter(Boolean).join(" · ");
  const paymentsWarning =
    Math.abs(c.paymentsDiff) >= CASH_TOLERANCE
      ? `Ödeme türlerinin toplamı (${money(c.paymentsTotal)}) ${revenueWord(c)} ${money(Math.abs(c.paymentsDiff))} ${c.paymentsDiff > 0 ? "fazla" : "az"}: bir tutar yanlış yazılmış olabilir.`
      : null;
  // Yazarkasa alanları boş raporda (eski ya da yalnız banka gün sonu yazılmış) bugünkü "Kart" bölümü, etiket "Banka POS"
  // (§3.7); kart farkı computeCash'in kaynağıyla (D5; burada her zaman banka)
  const okc = okcHasFigures(f);
  const bankDiff = okc ? null : c.cardDiff;
  // Günün kasası (geçiş gününden itibaren LafPOS; denetim E-39): karşılaştırma ve satır adları onun adıyla
  const kasa = meta.kasa ?? "ModPOS";
  const cardWarning =
    bankDiff !== null && Math.abs(bankDiff) >= CASH_TOLERANCE ? `Banka POS ${kasa}'taki karttan ${money(Math.abs(bankDiff))} ${bankDiff > 0 ? "fazla" : "az"}.` : null;

  const laf = meta.lafposIkram ?? null;
  const zRows = [
    row("Toplam satış", money(f.zTotal), { strong: true }),
    ...paymentLines(f).map((p) => row(p.label, money(p.amount))),
    ...(f.discounts ? [row("İndirim", money(f.discounts))] : []),
    ...(f.offRevenue ? [row("Ödenmez / ikram (ciro dışı)", money(f.offRevenue))] : []),
    ...(laf
      ? [
          ...(laf.ikramValue ? [row("LafPOS'taki ikram", money(laf.ikramValue), { sub: "menü fiyatıyla" })] : []),
          ...(laf.zayiValue ? [row("LafPOS'ta zayi yazılan", money(laf.zayiValue), { sub: "menü fiyatıyla" })] : []),
          // Faz 2: hazırlanmış iptal zayi tüketimidir; hazırlanmamış yalnız bilgi (ikisi de ödenmez tutarında yok)
          ...(laf.iptalValue ? [row("İptal, hazırlanmıştı (zayi)", money(laf.iptalValue), { sub: "liste fiyatıyla" })] : []),
          ...(laf.unprepared?.count ? [row("İptal, hazırlanmamıştı", money(laf.unprepared.value), { sub: `${laf.unprepared.count} kalem · tüketim değil` })] : []),
        ]
      : meta.ikramValue
        ? [row("Panelde kayıtlı ikram", money(meta.ikramValue), { sub: "menü fiyatıyla" })]
        : []),
  ].join("\n");
  // LafPOS gününde ikram LafPOS'ta işaretlenir: personel paneli atlar, uyarı LafPOS'un Z'si ile ikram listesini
  // karşılaştırır (ikisi de LafPOS'un; fark varsa bilgi), panele girilen ürün ikramı sayılmadığı söylenir
  const ikramWarning = laf
    ? [
        laf.offRevenue !== null ? lafposIkramCheck(laf.offRevenue, laf.listValue ?? laf.ikramValue + (laf.zayiValue ?? 0), laf.byKind) : null,
        laf.notCounted ? `Panele bu güne girilen ${laf.notCounted} ürün ikramı sayılmadı: ikram LafPOS'tan geliyor.` : null,
      ].filter((x): x is string => x !== null)
    : f.offRevenue !== null && meta.ikramValue != null && Math.abs(f.offRevenue - meta.ikramValue) >= CASH_TOLERANCE
      ? `${kasa}'un ödenmez tutarı panelde kayıtlı ikramdan ${money(Math.abs(f.offRevenue - meta.ikramValue))} ${f.offRevenue > meta.ikramValue ? "fazla" : "az"}: kaydı eksik ikram olabilir.`
      : null;
  const wasteRows = [
    ...(meta.waste?.ikram ? [textRow("İkram", meta.waste.ikram)] : []),
    ...(meta.waste?.zayi ? [textRow("Zayi", meta.waste.zayi)] : []),
  ].join("\n");
  // Kasadan çıkan satırlar "Gün içinde çıkan"ın altında; fotoğrafın kendisi e-postaya girmez (Panelde aç)
  const outs = cashOutLines(meta.cashOuts);
  const outRows = outs.map((l) => `<tr><td colspan="2" style="padding:0 0 4px 12px;font-family:${FONT};font-size:12px;line-height:16px;color:#71717a">· ${esc(l)}</td></tr>`);
  const cashRows = [
    row("Açılış (dünden devir)", money(f.openingCash)),
    row("+ Nakit satış", money(f.cash)),
    ...(f.cashIn ? [row("+ Gün içinde giren", money(f.cashIn))] : []),
    ...(f.cashOut || outs.length ? [row("− Gün içinde çıkan", money(f.cashOut), { sub: f.cashOutNote ?? undefined }), ...outRows] : []),
    row("= Olması gereken", money(c.expectedCash), { strong: true }),
    row("Sayılan", money(f.countedCash), { strong: true }),
    row("Fark", c.kind === "even" ? "Tutuyor" : `${money(Math.abs(c.cashDiff))} ${tone.label}`, { strong: true, color: tone.fg }),
    ...(f.handedOver ? [row("Teslim edilen", handedOverLine(f.handedOver, f.handedToName ?? null))] : []),
    row("Ertesi güne devir", money(c.carryOver)),
  ].join("\n");
  const cardRows =
    bankDiff === null
      ? ""
      : [
          row(`${kasa} kart`, money(f.card)),
          // Faz 2: yazarkasadan geçmeyen kart banka gün sonunda yok; LafPOS kartından düşülür (5.030 − 870 = 4.160)
          ...(meta.offDevice && meta.offDevice.card > 0 ? [row(OFF_DEVICE_CARD_LABEL, money(meta.offDevice.card))] : []),
          row("Banka POS", money(f.bankPos)),
          // Fark bunu düşerek (G11): 10.150 − 150 = 10.000 okunur
          ...(meta.cardExtra && meta.cardExtra > 0 ? [row(CARD_EXTRA_LABEL, money(meta.cardExtra))] : []),
          row("Fark", Math.abs(bankDiff) < CASH_TOLERANCE ? "Yok" : `${money(Math.abs(bankDiff))} ${bankDiff > 0 ? "fazla" : "az"}`, {
            strong: true,
            color: Math.abs(bankDiff) < CASH_TOLERANCE ? "#15803d" : "#c2410c",
          }),
        ].join("\n");
  // Fotoğraftan farklı yazılan: yazarkasa alanları ve banka gün sonu banka POS Z bölümünün altında (bölüm varsa),
  // ötekiler kasanın altında
  const okcDiff = (field: string) => okc && (field.startsWith("okc") || field === "bankPos");
  const diffWarning = (list: NonNullable<typeof meta.photoDiffs>) => (list.length ? `Fotoğraftan farklı yazılan: ${list.map((d) => photoDiffText(d, false)).join("; ")}` : null);
  const photoWarning = diffWarning((meta.photoDiffs ?? []).filter((d) => !okcDiff(d.field)));
  const okcPhotoWarning = diffWarning((meta.photoDiffs ?? []).filter((d) => okcDiff(d.field)));
  // Fişsiz çıkış (bulgu 2): "Gün içinde çıkan" kasadan çıkan satırlarından fazla; kasanın altında, neye çıktığıyla
  const unreceiptedWarning = meta.unreceipted
    ? `${unreceiptedText(meta.unreceipted)}${f.cashOutNote?.trim() ? `; neye çıktı: ${f.cashOutNote.trim()}` : "; neye çıktığı yazılmadı"}.`
    : null;
  // LafPOS'un gün sonundan farklı yazılan (E-09; yalnız LafPOS günlerinde): bölümlerin üstünde turuncu kutu
  const lafposLine = lafposDiffsLine(meta.lafposDiffs ?? []);
  const lafposBox = lafposLine ? warnBox([lafposLine], 14) : "";
  // Düzeltilen raporda neyin değiştiği: bölümlerin üstünde turuncu kutu
  const changesBox = meta.revision > 1 && meta.changes?.length ? warnBox([`Değişen: ${changesText(meta.changes)}`], 14) : "";
  // Banka POS Z (yazarkasa) bölümü: kayıtlı raporun görünümüyle aynı satırlar (cash-summary.tsx), altında yöneticinin
  // bütün karşılaştırma satırları (kart, kendi içinde, nakit, toplam, yemek kartı, banka)
  const okcHead = [
    meta.device?.label ?? null,
    meta.device?.registerNo ? `sicil\u00a0${meta.device.registerNo}` : null,
    f.okcZNo ? `Z no\u00a0${f.okcZNo}` : null,
    f.okcReceipts ? `${f.okcReceipts}\u00a0fiş` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const okcRows = okc
    ? [
        ...(f.okcTotal != null ? [row("Günlük toplam", money(f.okcTotal), { strong: true, sub: f.okcVatTotal != null ? `KDV ${money(f.okcVatTotal)}` : undefined })] : []),
        ...(f.okcVat ?? []).map((l) => row(`%${l.rate}`, money(l.total), { sub: `KDV ${money(l.vat)}` })),
        ...(f.okcCash != null ? [row("Nakit", money(f.okcCash))] : []),
        ...(f.okcCard != null ? [row("Kredi kartı", money(f.okcCard))] : []),
        ...(f.okcMealCard ? [row("Yemek kartı", money(f.okcMealCard))] : []),
        ...(f.okcOther ? [row("Diğer", money(f.okcOther))] : []),
        ...(f.bankPos !== null ? [row("Banka gün sonu", money(f.bankPos))] : []),
      ].join("\n")
    : "";
  const okcLines = okc ? `${toneLines(okcReconcile(f, "admin", kasa))}${warnBox([okcPhotoWarning])}` : "";
  const photoList = photoNames(meta.photos).join(", ");
  // Raporun şubesi bağlantıda: seçici o şubeyi seçer, form o kasayı gösterir (yoksa çerezdeki şubenin raporu açılırdı)
  const link = `${APP_URL}/panel/kasa?gun=${f.date}${meta.branch ? `&sube=${encodeURIComponent(meta.branch.id)}` : ""}`;
  // laffogato.net: bilgi satırı, hesaba katılmaz (sitenin günü gece yarısında biter)
  const onlineRows = meta.online
    ? [
        row("Online (site + uygulama)", money(meta.online.online), { sub: "uygulama ve web siparişleri, iadeler düşülmüş" }),
        row("Karaoke ön ödeme", money(meta.online.karaoke)),
      ].join("\n")
    : "";

  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;-webkit-text-size-adjust:100%;font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(`${headline} · Z ${money(f.zTotal)} · ${meta.by}`)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f4f5"><tr><td align="center" style="padding:20px 12px 28px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px">
  <tr><td style="padding:0 4px 14px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
      <td style="vertical-align:middle">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
          <td width="38" height="38" align="center" style="width:38px;height:38px;background:#171717;border-radius:11px;color:#c0f21e;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:-0.02em">L'Af</td>
          <td style="padding-left:10px;font-family:${FONT}">
            <div style="font-size:16px;line-height:20px;font-weight:600;color:#171717">L'Affogato</div>
            <div style="font-size:12px;line-height:16px;color:#71717a">Gün sonu kasa raporu · ${esc(`${reportNo(f.date)}${branchPart(branchName)}`)}</div>
          </td>
        </tr></table>
      </td>
      <td align="right" style="vertical-align:middle;font-family:${FONT};font-size:13px;color:#71717a;white-space:nowrap">${esc(longDateTR(f.date))}</td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#ffffff;border-radius:24px;padding:24px 20px 22px">
    <div style="font-family:${FONT};font-size:13px;line-height:18px;color:#71717a">${esc(`${byLine(meta.by, meta.countedBy)} · ${time}${meta.revision > 1 ? " · güncellendi" : ""}${zMeta ? ` · ${zMeta}` : ""}`)}</div>${
      photoList ? `\n    <div style="font-family:${FONT};font-size:12px;line-height:17px;color:#71717a;margin-top:2px">${esc(`Fotoğraflar panelde: ${photoList}`)}</div>` : ""
    }${meta.approval ? `\n    <div style="font-family:${FONT};font-size:13px;line-height:18px;color:#3f3f46;font-weight:600;margin-top:4px">${esc(meta.approval)}</div>` : ""}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:10px"><tr><td style="background:${tone.bg};border-radius:16px;padding:14px 16px;font-family:${FONT}">
      <div style="font-size:13px;line-height:18px;color:${tone.fg};font-weight:600">Kasa</div>
      <div style="font-size:26px;line-height:32px;font-weight:700;letter-spacing:-0.02em;color:${tone.fg}">${esc(headline)}</div>
      <div style="font-size:13px;line-height:18px;color:#3f3f46;margin-top:2px">Olması gereken ${esc(money(c.expectedCash))} · sayılan ${esc(money(f.countedCash))}</div>
    </td></tr></table>
    ${changesBox}
    ${lafposBox}
    ${section(zSectionTitle(meta.kasa), zRows, paymentsWarning ?? ikramWarning)}
    ${section("Kasa (nakit)", cashRows, [unreceiptedWarning, meta.carry ? carryWarning(meta.carry) : null, meta.next ? nextWarning(meta.next) : null, photoWarning])}
    ${okc ? `${section(`Banka POS Z raporu (yazarkasa)${okcHead ? ` · ${okcHead}` : ""}`, okcRows)}${okcLines}` : ""}
    ${cardRows ? section("Kart", cardRows, cardWarning) : ""}
    ${wasteRows ? section("Zayi & ikram", wasteRows) : ""}
    ${onlineRows ? section("laffogato.net (kasadan geçmez)", onlineRows, "Bilgi için: kasa farkına ve Z raporuna girmez.") : ""}
    ${f.note ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:18px"><tr><td style="background:#f4f4f5;border-radius:12px;padding:10px 12px;font-family:${FONT};font-size:14px;line-height:20px;color:#3f3f46"><strong>Not:</strong> ${esc(f.note)}</td></tr></table>` : ""}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px">
      <tr><td align="center" bgcolor="#171717" style="border-radius:14px;background:#171717">
        <a href="${esc(link)}" style="display:block;padding:15px 20px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:14px">Panelde aç</a>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:16px 12px 0;font-family:${FONT};font-size:12px;line-height:17px;color:#a1a1aa;text-align:center">Bu e-posta kasa raporu alıcılarına gönderildi. Adresleri panelde Kasa raporu sayfasından değiştirebilirsiniz.</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = `${meta.approval ? `${meta.approval}\n\n` : ""}${cashReportText(f, { ...meta, branchName }, "admin").replace(/\*/g, "")}${meta.online ? `\n\n${meta.online.text}` : ""}\n\nPanelde aç: ${link}`;
  return { subject, html, text };
}

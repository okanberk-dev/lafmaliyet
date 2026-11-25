/**
 * Gün sonu kasa raporu e-postası (saf; "server-only" yok, tests/kasa-raporu.test.ts sınar). Bütün e-postaların ortak
 * tasarımıyla (src/lib/email-kit.ts): üstte L'Af başlığı, büyük kasa sonucu (eksik kırmızı, fazla turuncu, tutuyor yeşil;
 * kelimesi yanında), ModPOS Z raporu, kasa ve banka POS Z (yazarkasa) bölümleri, en altta "Panelde aç". Alıcıları yönetici seçer (personelin adresi düşer,
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
import { button, C, callout, emailShell, esc, FONT, hero, section, TABLE, textRowHtml, type Row, type Tone } from "@/lib/email-kit";
import { money } from "@/lib/format";
import { lafposDiffsLine } from "@/lib/lafpos/diffs";
import { lafposIkramCheck, type LafposZKinds } from "@/lib/lafpos/ikram";
import { okcHasFigures, okcReconcile, type OkcReconcileLine } from "@/lib/okc-z";
import { photoDiffText } from "@/lib/photo-read/kasa";
import { longDateTR } from "@/lib/reminders";
import type { TillOnlineRow } from "@/lib/site-sales/calc";

import { APP_URL } from "./digest-template";

/** Kasa sonucunun tonu ve kelimesi (renk tek başına anlam taşımaz: "eksik", "fazla", "tutuyor" yanında) */
const RESULT: Record<"short" | "over" | "even", { tone: Tone; label: string }> = {
  short: { tone: "bad", label: "eksik" },
  over: { tone: "warn", label: "fazla" },
  even: { tone: "good", label: "tutuyor" },
};

/** Karşılaştırma satırının tonu (yazarkasa ↔ kasa ↔ banka): bilgi gri kalır, renk yalnız iyi ve uyarıda */
const LINE_TONE: Record<OkcReconcileLine["tone"], Tone> = { good: "good", info: "neutral", warn: "warn" };

/** Kartın üstündeki küçük satır (kim, saat, Z; fotoğraflar; onay). Yerel: kitte başlıksız üst satır yok */
function metaLine(text: string, o: { top?: number; size?: number; color?: string; strong?: boolean } = {}) {
  const size = o.size ?? 14;
  return `<div style="margin-top:${o.top ?? 0}px;font-family:${FONT};font-size:${size}px;line-height:${size + 6}px;color:${o.color ?? C.mute};${o.strong ? "font-weight:600;" : ""}word-break:break-word">${esc(text)}</div>`;
}

/** Dikey boşluk (Outlook div kenar boşluğunu her zaman uygulamaz). Yerel: kitte yok */
function space(px: number) {
  return `<table ${TABLE}><tr><td style="height:${px}px;line-height:${px}px;font-size:0">&nbsp;</td></tr></table>`;
}

/** " · " ile ayrılmış parçalar kendi içinde bölünmez (telefonda "Z no" ile "1234" ayrı satıra düşmez); metin aynı */
const keepParts = (text: string) =>
  text
    .split(" · ")
    .map((p) => p.replace(/ /g, "\u00a0"))
    .join(" · ");

/** Turuncu uyarı kutusu; birden çok uyarı alt alta, aralarında boşlukla (boşsa boş metin) */
function warnBox(lines: (string | null | undefined)[], top = 12) {
  const list = lines.filter((l): l is string => Boolean(l));
  if (!list.length) return "";
  return callout("warn", [], { top, html: list.map((l, i) => `<div style="margin-top:${i ? 8 : 0}px">${esc(l)}</div>`).join("") });
}

/** Karşılaştırma satırları (yazarkasa ↔ ModPOS ↔ banka): tonuna göre renkli, alt alta kutular */
function toneLines(lines: { tone: OkcReconcileLine["tone"]; text: string }[]) {
  return lines.map((l, i) => callout(LINE_TONE[l.tone], [l.text], { top: i === 0 ? 12 : 8 })).join("");
}

/** Başlıklı bölüm; altında uyarılar (turuncu kutu) */
function block(title: string, list: readonly (Row | string)[], warning?: string | null | (string | null | undefined)[], o: { top?: number; after?: string } = {}) {
  return section(title, list, { top: o.top, after: `${warnBox(Array.isArray(warning) ? warning : [warning])}${o.after ?? ""}` });
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
  const tone = RESULT[c.kind];
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
  const zRows: Row[] = [
    { label: "Toplam satış", value: money(f.zTotal), strong: true },
    ...paymentLines(f).map((p) => ({ label: p.label, value: money(p.amount) })),
    ...(f.discounts ? [{ label: "İndirim", value: money(f.discounts) }] : []),
    ...(f.offRevenue ? [{ label: "Ödenmez / ikram (ciro dışı)", value: money(f.offRevenue) }] : []),
    ...(laf
      ? [
          ...(laf.ikramValue ? [{ label: "LafPOS'taki ikram", value: money(laf.ikramValue), sub: "menü fiyatıyla" }] : []),
          ...(laf.zayiValue ? [{ label: "LafPOS'ta zayi yazılan", value: money(laf.zayiValue), sub: "menü fiyatıyla" }] : []),
          // Faz 2: hazırlanmış iptal zayi tüketimidir; hazırlanmamış yalnız bilgi (ikisi de ödenmez tutarında yok)
          ...(laf.iptalValue ? [{ label: "İptal, hazırlanmıştı (zayi)", value: money(laf.iptalValue), sub: "liste fiyatıyla" }] : []),
          ...(laf.unprepared?.count ? [{ label: "İptal, hazırlanmamıştı", value: money(laf.unprepared.value), sub: `${laf.unprepared.count} kalem · tüketim değil` }] : []),
        ]
      : meta.ikramValue
        ? [{ label: "Panelde kayıtlı ikram", value: money(meta.ikramValue), sub: "menü fiyatıyla" }]
        : []),
  ];
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
  // Zayi ve ikram kalemleri uzun metin: sağa sıkışmaz, iki sütuna yayılıp sarılır
  const wasteRows = [
    ...(meta.waste?.ikram ? [["İkram", meta.waste.ikram]] : []),
    ...(meta.waste?.zayi ? [["Zayi", meta.waste.zayi]] : []),
  ].map(([label, text], i) => textRowHtml(label, text, i === 0));
  // Kasadan çıkan satırlar "Gün içinde çıkan"ın altında, küçük ve içeride; fotoğrafın kendisi e-postaya girmez (Panelde aç)
  const outs = cashOutLines(meta.cashOuts);
  const outRows = outs.map((l) => textRowHtml(null, `· ${l}`, false, { muted: true, indent: true }));
  const cashRows: (Row | string)[] = [
    { label: "Açılış (dünden devir)", value: money(f.openingCash) },
    { label: "+ Nakit satış", value: money(f.cash) },
    ...(f.cashIn ? [{ label: "+ Gün içinde giren", value: money(f.cashIn) }] : []),
    ...(f.cashOut || outs.length ? [{ label: "− Gün içinde çıkan", value: money(f.cashOut), sub: f.cashOutNote }, ...outRows] : []),
    { label: "= Olması gereken", value: money(c.expectedCash), strong: true },
    { label: "Sayılan", value: money(f.countedCash), strong: true },
    { label: "Fark", value: c.kind === "even" ? "Tutuyor" : `${money(Math.abs(c.cashDiff))} ${tone.label}`, strong: true, tone: tone.tone },
    ...(f.handedOver ? [{ label: "Teslim edilen", value: money(f.handedOver) }] : []),
    { label: "Ertesi güne devir", value: money(c.carryOver) },
  ];
  const cardRows: Row[] =
    bankDiff === null
      ? []
      : [
          { label: `${kasa} kart`, value: money(f.card) },
          // Faz 2: yazarkasadan geçmeyen kart banka gün sonunda yok; LafPOS kartından düşülür (5.030 − 870 = 4.160)
          ...(meta.offDevice && meta.offDevice.card > 0 ? [{ label: OFF_DEVICE_CARD_LABEL, value: money(meta.offDevice.card) }] : []),
          { label: "Banka POS", value: money(f.bankPos) },
          // Fark bunu düşerek (G11): 10.150 − 150 = 10.000 okunur
          ...(meta.cardExtra && meta.cardExtra > 0 ? [{ label: CARD_EXTRA_LABEL, value: money(meta.cardExtra) }] : []),
          Math.abs(bankDiff) < CASH_TOLERANCE
            ? { label: "Fark", value: "Yok", strong: true, tone: "good" }
            : { label: "Fark", value: `${money(Math.abs(bankDiff))} ${bankDiff > 0 ? "fazla" : "az"}`, strong: true, tone: "warn" },
        ];
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
  const okcRows: Row[] = okc
    ? [
        ...(f.okcTotal != null ? [{ label: "Günlük toplam", value: money(f.okcTotal), strong: true, sub: f.okcVatTotal != null ? `KDV ${money(f.okcVatTotal)}` : null }] : []),
        ...(f.okcVat ?? []).map((l) => ({ label: `%${l.rate}`, value: money(l.total), sub: `KDV ${money(l.vat)}` })),
        ...(f.okcCash != null ? [{ label: "Nakit", value: money(f.okcCash) }] : []),
        ...(f.okcCard != null ? [{ label: "Kredi kartı", value: money(f.okcCard) }] : []),
        ...(f.okcMealCard ? [{ label: "Yemek kartı", value: money(f.okcMealCard) }] : []),
        ...(f.okcOther ? [{ label: "Diğer", value: money(f.okcOther) }] : []),
        ...(f.bankPos !== null ? [{ label: "Banka gün sonu", value: money(f.bankPos) }] : []),
      ]
    : [];
  const photoList = photoNames(meta.photos).join(", ");
  // Raporun şubesi bağlantıda: seçici o şubeyi seçer, form o kasayı gösterir (yoksa çerezdeki şubenin raporu açılırdı)
  const link = `${APP_URL}/panel/kasa?gun=${f.date}${meta.branch ? `&sube=${encodeURIComponent(meta.branch.id)}` : ""}`;
  // laffogato.net: bilgi satırı, hesaba katılmaz (sitenin günü gece yarısında biter)
  const onlineRows: Row[] = meta.online
    ? [
        { label: "Online (site + uygulama)", value: money(meta.online.online), sub: "uygulama ve web siparişleri, iadeler düşülmüş" },
        { label: "Karaoke ön ödeme", value: money(meta.online.karaoke) },
      ]
    : [];

  // Sıra: kim ve ne zaman, büyük kasa sonucu (eksik kırmızı, fazla turuncu, tutuyor yeşil), değişen ve LafPOS'tan farklı,
  // Z, kasa, yazarkasa ya da kart, zayi ve ikram, laffogato.net, not, "Panelde aç"
  const sections = [
    block(zSectionTitle(meta.kasa), zRows, paymentsWarning ?? ikramWarning, { top: 30 }),
    block("Kasa (nakit)", cashRows, [unreceiptedWarning, meta.carry ? carryWarning(meta.carry) : null, meta.next ? nextWarning(meta.next) : null, photoWarning]),
    okc ? block(`Banka POS Z raporu (yazarkasa)${okcHead ? ` · ${okcHead}` : ""}`, okcRows, null, { after: `${toneLines(okcReconcile(f, "admin", kasa))}${warnBox([okcPhotoWarning])}` }) : "",
    cardRows.length ? block("Kart", cardRows, cardWarning) : "",
    wasteRows.length ? block("Zayi & ikram", wasteRows) : "",
    onlineRows.length ? block("laffogato.net (kasadan geçmez)", onlineRows, null, { after: callout("neutral", ["Bilgi için: kasa farkına ve Z raporuna girmez."], { top: 12 }) }) : "",
    f.note ? callout("neutral", [], { top: 28, html: `<strong style="font-weight:600;color:${C.ink}">Not:</strong> ${esc(f.note)}` }) : "",
  ].filter(Boolean);

  const html = emailShell({
    subject,
    preheader: `${headline} · Z ${money(f.zTotal)} · ${meta.by}`,
    brandSubHtml: `Gün sonu kasa raporu · ${esc(`${reportNo(f.date)}${branchPart(branchName)}`)}`,
    dateLabel: longDateTR(f.date),
    cardHtml: `${metaLine(keepParts(`${byLine(meta.by, meta.countedBy)} · ${time}${meta.revision > 1 ? " · güncellendi" : ""}${zMeta ? ` · ${zMeta}` : ""}`))}${
      photoList ? `\n${metaLine(`Fotoğraflar panelde: ${photoList}`, { top: 4, size: 13 })}` : ""
    }${meta.approval ? `\n${metaLine(meta.approval, { top: 8, color: C.soft, strong: true })}` : ""}
${space(16)}${hero({ label: "Kasa", value: headline, sub: keepParts(`Olması gereken ${money(c.expectedCash)} · sayılan ${money(f.countedCash)}`), tone: tone.tone })}
${changesBox}${lafposBox}
${sections.join("\n")}
${button(link, "Panelde aç")}`,
    footer: "Bu e-posta kasa raporu alıcılarına gönderildi. Adresleri panelde Kasa raporu sayfasından değiştirebilirsiniz.",
  });

  const text = `${meta.approval ? `${meta.approval}\n\n` : ""}${cashReportText(f, { ...meta, branchName }, "admin").replace(/\*/g, "")}${meta.online ? `\n\n${meta.online.text}` : ""}\n\nPanelde aç: ${link}`;
  return { subject, html, text };
}

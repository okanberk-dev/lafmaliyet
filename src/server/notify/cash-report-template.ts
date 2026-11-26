/**
 * Gün sonu kasa raporu e-postası (saf; "server-only" yok, tests/kasa-raporu.test.ts sınar). E-posta kitiyle
 * (src/lib/email; docs/BILDIRIMLER.md › E-posta tasarımı) LafPOS gün sonu e-postasının kardeşi: üstte büyük kasa sonucu
 * (eksik kırmızı, fazla turuncu, tutuyor yeşil), büyük rakamlar (toplam satış, nakit, kart), fotoğraf ve düzeltme notları,
 * sonra ModPOS Z raporu, kasa ve banka POS Z (yazarkasa) bölümleri, en altta "Panelde aç". Alıcıları yönetici seçer
 * (personelin adresi düşer, report-store.ts cashEmailRecipients): yazarkasanın toplamı, KDV'si ve ModPOS'la
 * karşılaştırmalar yalnız burada (docs/planlar/okc-z.md İlke 8, §8). Metin sürümü WhatsApp metninin yıldızsız,
 * yöneticinin satırlarıyla hâli.
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
  PHOTO_OK_TEXT,
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
import { button, compact, esc, kpiGrid, kvRow, layout, LIGHT, note, section, stack, statusBanner, TONES, type Tone } from "@/lib/email";
import { money } from "@/lib/format";
import { lafposDiffsLine } from "@/lib/lafpos/diffs";
import { lafposIkramCheck, type LafposZKinds } from "@/lib/lafpos/ikram";
import { okcHasFigures, okcReconcile, type OkcReconcileLine } from "@/lib/okc-z";
import { photoDiffText } from "@/lib/photo-read/kasa";
import type { TillOnlineRow } from "@/lib/site-sales/calc";

import { APP_URL } from "./digest-template";

const TABLE = 'role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"';

/** Kasa sonucunun tonu ve sözcüğü: eksik kırmızı, fazla turuncu, tutuyor yeşil */
const RESULT = {
  short: { tone: "bad", label: "eksik" },
  over: { tone: "warn", label: "fazla" },
  even: { tone: "good", label: "tutuyor" },
} as const satisfies Record<string, { tone: Tone; label: string }>;

/** Bölümün altındaki turuncu uyarı kutusu; birden çok uyarı alt alta, hiç yoksa kutu yok */
function warnNote(lines: readonly (string | null | undefined)[]): string | null {
  const list = compact(lines);
  return list.length ? note(list, { tone: "warn" }) : null;
}

/** Karşılaştırma satırlarının tonu (okcReconcile): aynı yeşil, bilgi gri, dikkat turuncu */
const LINE_TONE: Record<OkcReconcileLine["tone"], Tone> = { good: "good", info: "neutral", warn: "warn" };

/**
 * Yazarkasa ↔ ModPOS ↔ banka karşılaştırması: her satırın solunda tonun işareti (✓ i !), yanında cümlesi; dikkat
 * isteyen satır turuncu. Renk tek başına anlam taşımaz (işaret ve cümle aynı şeyi söyler)
 */
function toneLines(lines: readonly { tone: OkcReconcileLine["tone"]; text: string }[]): string | null {
  if (!lines.length) return null;
  const rows = lines.map((l, i) => {
    const tone = LINE_TONE[l.tone];
    const t = TONES[tone];
    const pad = `${i ? 10 : 0}px 0 0`;
    const text = tone === "warn" ? { cls: "e-v-warn", color: t.value } : { cls: "e-soft", color: LIGHT.soft };
    return `<tr><td width="30" valign="top" style="width:30px;padding:${pad};vertical-align:top"><div class="e-m-${tone}" aria-hidden="true" style="width:20px;height:20px;margin-top:1px;border-radius:10px;background:${t.mark};color:${t.markInk};font-size:12px;line-height:20px;font-weight:700;text-align:center">${t.glyph}</div></td><td class="${text.cls}" valign="top" style="padding:${pad};font-size:15px;line-height:22px;color:${text.color};vertical-align:top;word-break:break-word">${esc(l.text)}</td></tr>`;
  });
  return `<table ${TABLE}>${rows.join("")}</table>`;
}

/** Kasadan çıkan satırları: "Gün içinde çıkan" satırının hemen altında, içeriden, küçük ve gri */
function outLines(lines: readonly string[]): string {
  return `<table ${TABLE}><tr><td class="e-mute" style="padding:0 0 12px 14px;font-size:13px;line-height:20px;color:${LIGHT.mute};word-break:break-word">${lines.map((l) => `· ${esc(l)}`).join("<br>")}</td></tr></table>`;
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
     * Raporun yöneticinin onayıyla kaydedildiği (personelin düzeltme önerisi ya da geç raporu): sonucun altındaki notta
     * tek satır ("Yönetici onayıyla düzeltildi: Mehmet önerdi, Ayşe onayladı."); yoksa yazılmaz
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
  const result = RESULT[c.kind];
  const branchName = meta.branch?.name ?? null;
  const subject = reportSubject(f, meta.revision, branchName);
  const headline = c.kind === "even" ? "Kasa tutuyor" : `${money(Math.abs(c.cashDiff))} ${result.label}`;
  const time = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(meta.submittedAt);
  // Parçalar telefonda bölünmez (satır yalnız " · " ayracında kırılır)
  const zMeta = [f.zNo ? `Z no ${f.zNo}` : null, f.receipts ? `${f.receipts} fiş` : null].filter(Boolean).join(" · ");
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
    kvRow("Toplam satış", money(f.zTotal), { strong: true }),
    ...paymentLines(f).map((p) => kvRow(p.label, money(p.amount))),
    ...(f.discounts ? [kvRow("İndirim", money(f.discounts))] : []),
    ...(f.offRevenue ? [kvRow("Ödenmez / ikram (ciro dışı)", money(f.offRevenue))] : []),
    ...(laf
      ? [
          ...(laf.ikramValue ? [kvRow("LafPOS'taki ikram", money(laf.ikramValue), { sub: "menü fiyatıyla" })] : []),
          ...(laf.zayiValue ? [kvRow("LafPOS'ta zayi yazılan", money(laf.zayiValue), { sub: "menü fiyatıyla" })] : []),
          // Faz 2: hazırlanmış iptal zayi tüketimidir; hazırlanmamış yalnız bilgi (ikisi de ödenmez tutarında yok)
          ...(laf.iptalValue ? [kvRow("İptal, hazırlanmıştı (zayi)", money(laf.iptalValue), { sub: "liste fiyatıyla" })] : []),
          ...(laf.unprepared?.count ? [kvRow("İptal, hazırlanmamıştı", money(laf.unprepared.value), { sub: `${laf.unprepared.count} kalem · tüketim değil` })] : []),
        ]
      : meta.ikramValue
        ? [kvRow("Panelde kayıtlı ikram", money(meta.ikramValue), { sub: "menü fiyatıyla" })]
        : []),
  ];
  // LafPOS gününde ikram LafPOS'ta işaretlenir: personel paneli atlar, uyarı LafPOS'un Z'si ile ikram listesini
  // karşılaştırır (ikisi de LafPOS'un; fark varsa bilgi), panele girilen ürün ikramı sayılmadığı söylenir
  const ikramWarning = laf
    ? [
        laf.offRevenue !== null ? lafposIkramCheck(laf.offRevenue, laf.listValue ?? laf.ikramValue + (laf.zayiValue ?? 0), laf.byKind) : null,
        laf.notCounted ? `Panele bu güne girilen ${laf.notCounted} ürün ikramı sayılmadı: ikram LafPOS'tan geliyor.` : null,
      ]
    : [
        f.offRevenue !== null && meta.ikramValue != null && Math.abs(f.offRevenue - meta.ikramValue) >= CASH_TOLERANCE
          ? `${kasa}'un ödenmez tutarı panelde kayıtlı ikramdan ${money(Math.abs(f.offRevenue - meta.ikramValue))} ${f.offRevenue > meta.ikramValue ? "fazla" : "az"}: kaydı eksik ikram olabilir.`
          : null,
      ];
  // Zayi ve ikram kalemleri uzun liste: etiketin altında, sola dayalı
  const wasteRows = [
    ...(meta.waste?.ikram ? [kvRow("İkram", meta.waste.ikram, { stack: "always" })] : []),
    ...(meta.waste?.zayi ? [kvRow("Zayi", meta.waste.zayi, { stack: "always" })] : []),
  ];
  // Kasadan çıkan satırlar "Gün içinde çıkan"ın altında; fotoğrafın kendisi e-postaya girmez (Panelde aç)
  const outs = cashOutLines(meta.cashOuts);
  const cashRows = [
    kvRow("Açılış (dünden devir)", money(f.openingCash)),
    kvRow("+ Nakit satış", money(f.cash)),
    ...(f.cashIn ? [kvRow("+ Gün içinde giren", money(f.cashIn))] : []),
    ...(f.cashOut || outs.length ? [kvRow("− Gün içinde çıkan", money(f.cashOut), { sub: f.cashOutNote }), ...(outs.length ? [outLines(outs)] : [])] : []),
    kvRow("= Olması gereken", money(c.expectedCash), { strong: true }),
    kvRow("Sayılan", money(f.countedCash), { strong: true }),
    kvRow("Fark", c.kind === "even" ? "Tutuyor" : `${money(Math.abs(c.cashDiff))} ${result.label}`, { strong: true, tone: result.tone }),
    ...(f.handedOver ? [kvRow("Teslim edilen", money(f.handedOver))] : []),
    kvRow("Ertesi güne devir", money(c.carryOver)),
  ];
  const cardRows =
    bankDiff === null
      ? []
      : [
          kvRow(`${kasa} kart`, money(f.card)),
          // Faz 2: yazarkasadan geçmeyen kart banka gün sonunda yok; LafPOS kartından düşülür (5.030 − 870 = 4.160)
          ...(meta.offDevice && meta.offDevice.card > 0 ? [kvRow(OFF_DEVICE_CARD_LABEL, money(meta.offDevice.card))] : []),
          kvRow("Banka POS", money(f.bankPos)),
          // Fark bunu düşerek (G11): 10.150 − 150 = 10.000 okunur
          ...(meta.cardExtra && meta.cardExtra > 0 ? [kvRow(CARD_EXTRA_LABEL, money(meta.cardExtra))] : []),
          kvRow("Fark", Math.abs(bankDiff) < CASH_TOLERANCE ? "Yok" : `${money(Math.abs(bankDiff))} ${bankDiff > 0 ? "fazla" : "az"}`, {
            strong: true,
            tone: Math.abs(bankDiff) < CASH_TOLERANCE ? "good" : "warn",
          }),
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
  // LafPOS'un gün sonundan farklı yazılan (E-09; yalnız LafPOS günlerinde) ve düzeltilen raporda neyin değiştiği:
  // sonucun altında turuncu kutular
  const lafposLine = lafposDiffsLine(meta.lafposDiffs ?? []);
  const changesLine = meta.revision > 1 && meta.changes?.length ? `Değişen: ${changesText(meta.changes)}` : null;
  // Banka POS Z (yazarkasa) bölümü: kayıtlı raporun görünümüyle aynı satırlar (cash-summary.tsx), altında yöneticinin
  // bütün karşılaştırma satırları (kart, kendi içinde, nakit, toplam, yemek kartı, banka)
  const okcHead = [
    meta.device?.label ?? null,
    meta.device?.registerNo ? `sicil ${meta.device.registerNo}` : null,
    f.okcZNo ? `Z no ${f.okcZNo}` : null,
    f.okcReceipts ? `${f.okcReceipts} fiş` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const okcRows = okc
    ? [
        ...(f.okcTotal != null ? [kvRow("Günlük toplam", money(f.okcTotal), { strong: true, sub: f.okcVatTotal != null ? `KDV ${money(f.okcVatTotal)}` : null })] : []),
        ...(f.okcVat ?? []).map((l) => kvRow(`%${l.rate}`, money(l.total), { sub: `KDV ${money(l.vat)}` })),
        ...(f.okcCash != null ? [kvRow("Nakit", money(f.okcCash))] : []),
        ...(f.okcCard != null ? [kvRow("Kredi kartı", money(f.okcCard))] : []),
        ...(f.okcMealCard ? [kvRow("Yemek kartı", money(f.okcMealCard))] : []),
        ...(f.okcOther ? [kvRow("Diğer", money(f.okcOther))] : []),
        ...(f.bankPos !== null ? [kvRow("Banka gün sonu", money(f.bankPos))] : []),
      ]
    : [];
  const okcAfter = okc ? stack([toneLines(okcReconcile(f, "admin", kasa)), warnNote([okcPhotoWarning])], 12) : "";
  const photoList = photoNames(meta.photos).join(", ");
  // Fotoğraf okundu ve yazılanlarla tutuyor: yöneticiye olumlu satır (fark varsa aşağıdaki turuncu kutular)
  const photoOk = meta.photoRead && !(meta.photoDiffs ?? []).length ? PHOTO_OK_TEXT : null;
  // Raporun şubesi bağlantıda: seçici o şubeyi seçer, form o kasayı gösterir (yoksa çerezdeki şubenin raporu açılırdı)
  const link = `${APP_URL}/panel/kasa?gun=${f.date}${meta.branch ? `&sube=${encodeURIComponent(meta.branch.id)}` : ""}`;
  // laffogato.net: bilgi satırı, hesaba katılmaz (sitenin günü gece yarısında biter)
  const onlineRows = meta.online
    ? [kvRow("Online (site + uygulama)", money(meta.online.online), { sub: "uygulama ve web siparişleri, iadeler düşülmüş" }), kvRow("Karaoke ön ödeme", money(meta.online.karaoke))]
    : [];
  const info = compact([meta.approval, photoList ? `Fotoğraflar panelde: ${photoList}` : null]);

  // Üstte kasanın sonucu (konudakiyle aynı) ve büyük rakamlar; altında fotoğraf, onay ve düzeltme notları (birbirine
  // yakın), bölümler, raporun notu ve "Panelde aç" (src/lib/email; LafPOS gün sonu e-postasıyla aynı düzen)
  const html = layout({
    subject,
    preheader: `${headline} · Z ${money(f.zTotal)} · ${meta.by}`,
    meta: `Gün sonu kasa raporu · ${reportNo(f.date)}${branchPart(branchName)}`,
    date: f.date,
    eyebrow: `${byLine(meta.by, meta.countedBy)} · ${time}${meta.revision > 1 ? " · güncellendi" : ""}${zMeta ? ` · ${zMeta}` : ""}`,
    body: [
      // "Kasa tutuyor" kendini söyler: üst etiket yalnız eksik ve fazlada. Alt satır telefonda " · " ayracında kırılır
      statusBanner({
        tone: result.tone,
        eyebrow: c.kind === "even" ? null : "Kasa",
        title: headline,
        sub: `Olması gereken ${money(c.expectedCash)} · sayılan ${money(f.countedCash)}`,
        size: "lg",
      }),
      kpiGrid([
        { label: "Toplam satış", value: money(f.zTotal) },
        { label: "Nakit", value: money(f.cash) },
        { label: "Kredi / banka kartı", value: money(f.card) },
      ]),
      stack(
        [
          photoOk ? note(`✓ ${photoOk}`, { tone: "good" }) : null,
          info.length ? note(info) : null,
          changesLine ? note(changesLine, { tone: "warn" }) : null,
          lafposLine ? note(lafposLine, { tone: "warn" }) : null,
        ],
        12,
      ) || null,
      section(zSectionTitle(meta.kasa), zRows, { afterHtml: paymentsWarning ? warnNote([paymentsWarning]) : warnNote(ikramWarning) }),
      section("Kasa (nakit)", cashRows, {
        afterHtml: warnNote([unreceiptedWarning, meta.carry ? carryWarning(meta.carry) : null, meta.next ? nextWarning(meta.next) : null, photoWarning]),
      }),
      okc ? section(`Banka POS Z raporu (yazarkasa)${okcHead ? ` · ${okcHead}` : ""}`, okcRows, { afterHtml: okcAfter || null }) : null,
      cardRows.length ? section("Kart", cardRows, { afterHtml: warnNote([cardWarning]) }) : null,
      wasteRows.length ? section("Zayi & ikram", wasteRows) : null,
      onlineRows.length ? section("laffogato.net (kasadan geçmez)", onlineRows, { sub: "Bilgi için: kasa farkına ve Z raporuna girmez." }) : null,
      f.note ? note(`<strong>Not:</strong> ${esc(f.note)}`, { html: true }) : null,
      button(link, "Panelde aç"),
    ],
    footer: "Bu e-posta kasa raporu alıcılarına gönderildi. Adresleri panelde Kasa raporu sayfasından değiştirebilirsiniz.",
  });

  const text = `${meta.approval ? `${meta.approval}\n\n` : ""}${cashReportText(f, { ...meta, branchName }, "admin").replace(/\*/g, "")}${photoOk ? `\n\n✓ ${photoOk}` : ""}${meta.online ? `\n\n${meta.online.text}` : ""}\n\nPanelde aç: ${link}`;
  return { subject, html, text };
}

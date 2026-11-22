import { carryCheck, carryDiffText, computeCash, openingNeedsNote, type CashReportFields } from "@/lib/cash-report";
import { money } from "@/lib/format";
import { addDays, longDateTR } from "@/lib/reminders";

import type { PosDayZ, PosIkram, PosPayment } from "./day";

/**
 * LafPOS gün sonunun otomasyonu (saf; docs/LAFPOS.md › Gün sonu otomasyonu; sunucu tarafı src/server/lafpos/gun-sonu.ts):
 * LafPOS'un şubesinin (Marina) gün sonu gelince Kasa raporuna kendiliğinden yazılacak alanlar, düzeltme gelince elle
 * düzeltilmiş alanı ezmeyen birleştirme ve gün sonu e-postasının metni. Yalnız geçiş gününden sonraki LafPOS günleri;
 * ModPOS'taki şube (Tuzla) hiçbir şekilde etkilenmez.
 */

/** Otomatik yazılan rapor alanları: Z, kasa ve not (Banka POS / yazarkasa alanları elle ya da fotoğrafla girilir) */
export const AUTO_FIELDS = [
  "zNo",
  "receipts",
  "zTotal",
  "cash",
  "card",
  "mealCard",
  "online",
  "other",
  "offRevenue",
  "discounts",
  "openingCash",
  "cashIn",
  "cashOut",
  "cashOutNote",
  "countedCash",
  "handedOver",
  "note",
] as const;
export type AutoField = (typeof AUTO_FIELDS)[number];
export type AutoValues = Record<AutoField, number | string | null>;

/** Otomatik raporun "gönderen"i */
export const LAFPOS_AUTO_BY = "LafPOS (otomatik)";

/** Fotoğraf ya da elle giriş bekleyen alanların adı */
export const MISSING_LABEL: Record<string, string> = {
  bankPos: "Banka POS Z (yazarkasa)",
  countedCash: "Sayılan nakit (LafPOS'ta sayım yok)",
};

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Panelin Kasadan çıkanlar'ı (o gün, o şube) */
export interface DayOuts {
  count: number;
  total: number;
  note: string | null;
}

/**
 * Eksik alanlar: Banka POS Z'si (yazarkasa) LafPOS'tan gelmez, fotoğrafla ya da elle girilir; LafPOS gün sonunda sayım
 * yoksa sayılan nakit de eksiktir (uydurulmaz: rapor yazılmaz)
 */
export function autoMissing(z: Pick<PosDayZ, "countedCash">): string[] {
  return ["bankPos", ...(z.countedCash === null ? ["countedCash"] : [])];
}

/** Raporun otomatik notu: kaynağı, açılışın önceki devirden farkı ve eksikler */
export function autoNote(o: { missing: readonly string[]; carry: string | null }): string {
  const parts = ["LafPOS gün sonundan otomatik yazıldı."];
  if (o.carry) parts.push(o.carry);
  const missing = o.missing.map((m) => MISSING_LABEL[m] ?? m);
  if (missing.length) parts.push(`Eksik: ${missing.join(", ")}; panelden ekleyin.`);
  return parts.join(" ");
}

/**
 * LafPOS'un Z özetinden raporun alanları (eşleme "LafPOS'tan doldur"unkiyle aynı, src/lib/lafpos/prefill.ts): gün
 * içinde çıkan panelin Kasadan çıkanlar'ıdır (girildiyse; docs/LAFPOS.md E-35), yoksa LafPOS'un harcama + teslimi;
 * teslim edilen 0. Sayım yoksa `countedCash` null (rapor yazılmaz). `prevCarry`: önceki raporun devri (açılış farkı
 * nota yazılır, LafPOS'taki açılış kalır)
 */
export function autoValuesOf(date: string, z: PosDayZ, outs: DayOuts, prevCarry: { date: string; amount: number } | null): AutoValues {
  const check = carryCheck(date, z.openingCash, prevCarry);
  const carry =
    check && openingNeedsNote({ check, openingCash: z.openingCash, prevOpening: null, note: null })
      ? `Açılış önceki raporun devrinden ${carryDiffText(check)}; LafPOS'taki açılış yazıldı.`
      : null;
  return {
    zNo: String(z.zNo),
    receipts: z.receipts,
    zTotal: z.zTotal,
    cash: z.cash,
    card: z.card,
    mealCard: z.mealCard,
    online: z.online,
    other: z.other,
    offRevenue: z.offRevenue,
    discounts: z.discounts,
    openingCash: z.openingCash,
    cashIn: z.cashIn ?? 0,
    cashOut: outs.count ? outs.total : round2(z.cashOut + z.handedOver),
    cashOutNote: outs.count ? outs.note : null,
    countedCash: z.countedCash,
    handedOver: 0,
    note: autoNote({ missing: autoMissing(z), carry }),
  };
}

const same = (a: number | string | null | undefined, b: number | string | null | undefined) =>
  typeof a === "number" && typeof b === "number" ? Math.round(a * 100) === Math.round(b * 100) : (a ?? null) === (b ?? null);

/**
 * Düzeltme gelince birleştirme: kayıtlı değer son otomatik değere eşitse (elle değişmemiş) yenisi yazılır, değilse
 * (personel ya da yönetici düzeltti) kayıtlı kalır. Yeni değer boşsa (ör. sayım yok) kayıtlı kalır. `auto`: bundan
 * sonra karşılaştırılacak otomatik değerler (korunan alanda eskisi)
 */
export function mergeAuto(current: AutoValues, lastAuto: AutoValues, next: AutoValues): { values: AutoValues; auto: AutoValues; changed: AutoField[]; kept: AutoField[] } {
  const values = { ...current };
  const auto = { ...lastAuto };
  const changed: AutoField[] = [];
  const kept: AutoField[] = [];
  for (const f of AUTO_FIELDS) {
    if (next[f] === null && f !== "cashOutNote" && f !== "offRevenue" && f !== "discounts") continue;
    if (!same(current[f], lastAuto[f])) {
      if (!same(current[f], next[f])) kept.push(f);
      continue;
    }
    auto[f] = next[f];
    if (!same(current[f], next[f])) {
      values[f] = next[f];
      changed.push(f);
    }
  }
  return { values, auto, changed, kept };
}

/** Kayıtlı raporun otomatik alanları */
export function autoValuesOfReport(r: Pick<CashReportFields, Exclude<AutoField, "discounts">> & { discounts?: number | null }): AutoValues {
  return Object.fromEntries(AUTO_FIELDS.map((f) => [f, (r as Record<string, unknown>)[f] ?? null])) as AutoValues;
}

/** Günün içerik özeti (FNV-1a, 32 bit): aynı içerik yeniden gelirse e-posta yinelenmez */
export function dayHash(day: { z: unknown; payments: unknown; ikram: unknown }): string {
  const text = JSON.stringify([day.z, day.payments, day.ikram]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------- Gün sonu e-postası

/** Kıyas günü: tarih ve satış (Z toplamı); o gün satış bilinmiyorsa null */
export interface DayCompare {
  date: string;
  zTotal: number | null;
}

/** Kasa raporunun durumu e-postada */
export type ReportState = "auto" | "updated" | "human" | "no-count" | "none";

export interface DayEndMail {
  branchName: string;
  date: string;
  z: PosDayZ;
  payments: readonly PosPayment[];
  ikram: readonly PosIkram[];
  /** Raporun (ya da LafPOS'un) kasa alanları: olması gereken ve fark bunlardan */
  values: AutoValues | null;
  missing: readonly string[];
  report: ReportState;
  /** LafPOS günü düzeltip yeniden gönderdi (önceki e-posta gitti) */
  corrected: boolean;
  yesterday: DayCompare;
  lastWeek: DayCompare;
  /** laffogato.net'in o şubeye düşen online satışı (kasadan geçmez); okunamadıysa null */
  online: number | null;
  link: string;
}

/** Kıyas metni: "18.000 ₺ (%11 fazla)" / "bilinmiyor" */
export function compareText(today: number, other: number | null): string {
  if (other === null) return "bilinmiyor";
  if (other <= 0) return money(other);
  const pct = Math.round(((today - other) / other) * 100);
  return `${money(other)} (${pct === 0 ? "aynı" : `%${Math.abs(pct)} ${pct > 0 ? "fazla" : "az"}`})`;
}

/** Konu: "Marina gün sonu · 22 Kasım Pazar" (düzeltmede sonda "· düzeltildi") */
export function dayEndSubject(branchName: string, date: string, corrected: boolean): string {
  return `${branchName} gün sonu · ${longDateTR(date)}${corrected ? " · düzeltildi" : ""}`;
}

const REPORT_TEXT: Record<ReportState, string> = {
  auto: "Kasa raporu LafPOS'tan kendiliğinden yazıldı.",
  updated: "Kasa raporu LafPOS'un düzeltmesiyle güncellendi; elle düzeltilen alanlar korundu.",
  human: "Kasa raporunu personel girdi; LafPOS'tan farklı yazılan varsa panel gösterir.",
  "no-count": "LafPOS'ta gün sonu sayımı yok: Kasa raporu yazılmadı. Çekmeceyi LafPOS'ta sayın; LafPOS günü yeniden gönderir.",
  none: "Kasa raporu henüz yok.",
};

/** E-postanın satırları (başlık, değer); HTML ve düz metin aynı satırlardan */
export function dayEndSections(m: DayEndMail): { title: string; rows: [string, string][] }[] {
  const z = m.z;
  const pay: [string, string][] = [
    ["Nakit", money(z.cash)],
    ["Kredi / banka kartı", money(z.card)],
    ...(z.mealCard ? ([["Yemek kartı", money(z.mealCard)]] as [string, string][]) : []),
    ...(z.online ? ([["Online (sitede ödendi)", money(z.online)]] as [string, string][]) : []),
    ...(z.other ? ([["Diğer", money(z.other)]] as [string, string][]) : []),
  ];
  const detail: [string, string][] = m.payments
    .filter((p) => p.amount > 0)
    .map((p) => [`· ${p.name}${p.count ? ` (${p.count})` : ""}`, money(p.amount)]);
  const ikramValue = round2(m.ikram.reduce((a, l) => a + l.menuValue, 0));
  const ikramQty = round2(m.ikram.reduce((a, l) => a + l.qty, 0));
  const v = m.values;
  const cash = v && typeof v.countedCash === "number" ? computeCash(cashFieldsOf(v)) : null;
  const kasa: [string, string][] = [
    ["Açılış", money(z.openingCash)],
    ["Olması gereken nakit", money(cash ? cash.expectedCash : (z.expectedCash ?? round2(z.openingCash + z.cash + (z.cashIn ?? 0) - z.cashOut - z.handedOver)))],
    ["Sayılan nakit", z.countedCash === null ? "sayım yok" : money(v && typeof v.countedCash === "number" ? v.countedCash : z.countedCash)],
    ["Kasa farkı", cash ? diffWord(cash.cashDiff) : z.cashDiff === null ? "sayım yok" : diffWord(z.cashDiff)],
  ];
  return [
    { title: "Satış", rows: [["Toplam satış (Z)", money(z.zTotal)], ["Z no · fiş", `${z.zNo} · ${z.receipts} fiş`], ...(z.discounts ? ([["İndirim", money(z.discounts)]] as [string, string][]) : [])] },
    { title: "Ödemeler", rows: [...pay, ...detail] },
    {
      title: "İkram ve ödenmez",
      rows: [
        ["Ödenmez / ikram (Z)", money(z.offRevenue)],
        ["İkram edilen", m.ikram.length ? `${ikramQty} adet · menü değeri ${money(ikramValue)}` : "yok"],
      ],
    },
    { title: "Kasa (nakit)", rows: kasa },
    {
      title: "Kıyas (toplam satış)",
      rows: [
        [`Dün (${longDateTR(m.yesterday.date)})`, compareText(z.zTotal, m.yesterday.zTotal)],
        [`Geçen hafta (${longDateTR(m.lastWeek.date)})`, compareText(z.zTotal, m.lastWeek.zTotal)],
      ],
    },
    ...(m.online !== null ? [{ title: "laffogato.net (kasadan geçmez)", rows: [["Online sipariş", money(m.online)]] as [string, string][] }] : []),
  ];
}

function diffWord(d: number): string {
  if (Math.abs(d) < 0.005) return "tutuyor";
  return `${money(Math.abs(d))} ${d < 0 ? "eksik" : "fazla"}`;
}

function cashFieldsOf(v: AutoValues) {
  const n = (f: AutoField) => (typeof v[f] === "number" ? (v[f] as number) : 0);
  return {
    zTotal: n("zTotal"),
    cash: n("cash"),
    card: n("card"),
    mealCard: n("mealCard"),
    online: n("online"),
    other: n("other"),
    offRevenue: typeof v.offRevenue === "number" ? v.offRevenue : null,
    openingCash: n("openingCash"),
    cashIn: n("cashIn"),
    cashOut: n("cashOut"),
    countedCash: n("countedCash"),
    handedOver: n("handedOver"),
    bankPos: null,
    okcCard: null,
  };
}

/** Üst satırlar: düzeltme notu, raporun durumu, eksikler */
export function dayEndNotes(m: DayEndMail): string[] {
  const out: string[] = [];
  if (m.corrected) out.push("Düzeltildi: LafPOS bu günü yeniden gönderdi; bu e-postadaki rakamlar öncekinin yerine geçer.");
  out.push(REPORT_TEXT[m.report]);
  const missing = m.report === "human" ? [] : m.missing.map((f) => MISSING_LABEL[f] ?? f);
  if (missing.length) out.push(`Panelde tamamlanacak: ${missing.join(", ")}.`);
  return out;
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Gün sonu e-postası: konu, HTML ve düz metin. Maliyet ve kâr yok (alıcılar yönetici ya da hesabı olmayan adres) */
export function renderDayEnd(m: DayEndMail): { subject: string; html: string; text: string } {
  const subject = dayEndSubject(m.branchName, m.date, m.corrected);
  const sections = dayEndSections(m);
  const notes = dayEndNotes(m);
  const rowHtml = ([label, value]: [string, string]) =>
    `<tr><td style="padding:6px 0;font-family:${FONT};font-size:14px;color:#3f3f46">${esc(label)}</td><td align="right" style="padding:6px 0 6px 12px;font-family:${FONT};font-size:14px;font-weight:600;color:#171717;white-space:nowrap">${esc(value)}</td></tr>`;
  const sectionHtml = (s: { title: string; rows: [string, string][] }) =>
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:18px"><tr><td colspan="2" style="padding:0 0 4px;border-bottom:1px solid #e4e4e7;font-family:${FONT};font-size:13px;font-weight:600;color:#3f3f46">${esc(s.title)}</td></tr>${s.rows.map(rowHtml).join("")}</table>`;
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:${FONT}">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f4f5"><tr><td align="center" style="padding:20px 12px 28px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px">
  <tr><td style="padding:0 4px 14px;font-family:${FONT}"><div style="font-size:16px;font-weight:600;color:#171717">L'Affogato ${esc(m.branchName)}</div><div style="font-size:12px;color:#71717a">LafPOS gün sonu · ${esc(longDateTR(m.date))} ${m.date.slice(0, 4)}</div></td></tr>
  <tr><td style="background:#ffffff;border-radius:24px;padding:22px 20px">
    <div style="font-family:${FONT};font-size:13px;color:#71717a">Toplam satış</div>
    <div style="font-family:${FONT};font-size:28px;line-height:34px;font-weight:700;color:#171717">${esc(money(m.z.zTotal))}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:10px"><tr><td style="background:${m.corrected ? "#fff7ed" : "#f4f4f5"};border-radius:12px;padding:10px 12px;font-family:${FONT};font-size:13px;line-height:18px;color:${m.corrected ? "#9a3412" : "#3f3f46"}">${notes.map(esc).join("<br>")}</td></tr></table>
    ${sections.map(sectionHtml).join("\n    ")}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px"><tr><td align="center" bgcolor="#171717" style="border-radius:14px;background:#171717"><a href="${esc(m.link)}" style="display:block;padding:15px 20px;font-family:${FONT};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:14px">Panelde aç</a></td></tr></table>
  </td></tr>
  <tr><td style="padding:16px 12px 0;font-family:${FONT};font-size:12px;color:#a1a1aa;text-align:center">Bu e-posta kasa raporu alıcılarına ve bildirim adreslerine gönderildi.</td></tr>
</table>
</td></tr></table>
</body></html>`;
  const text = [
    subject,
    "",
    `Toplam satış: ${money(m.z.zTotal)}`,
    ...notes,
    ...sections.flatMap((s) => ["", s.title, ...s.rows.map(([l, v]) => `${l}: ${v}`)]),
    "",
    `Panelde aç: ${m.link}`,
  ].join("\n");
  return { subject, html, text };
}

/** Kıyas günleri: dün ve geçen haftanın aynı günü */
export function compareDays(date: string): { yesterday: string; lastWeek: string } {
  return { yesterday: addDays(date, -1), lastWeek: addDays(date, -7) };
}

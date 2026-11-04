import { money } from "@/lib/format";

import type { ModposZ } from "./z";

/**
 * Kasa raporu ile ModPOS kasa föyü (saf; yöneticinin Kasa görünümü, zil ve Bugün aynı kuralı okur;
 * tests/modpos-foy.test.ts). Yalnız ModPOS günlerinde çağrılır (LafPOS geçiş gününden önce ya da geçiş günü boşken).
 *
 * - **Farklı yazılan** (uyarı): Z alanları (Z no, fiş sayısı, toplam satış, nakit, kart, yemek kartı, online, diğer,
 *   ödenmez / ikram) ve sayılan nakit. Personel bunları ModPOS'un Z raporundan yazar; föy aynı Z'nin rakamıdır,
 *   1 kuruştan büyük fark yanlış yazım ya da kapanıştan sonraki bir düzeltmedir. Raporda boş bırakılan isteğe bağlı
 *   alan (Z no, fiş sayısı, ödenmez) farklı sayılmaz. Sayılan nakit yalnız ModPOS'ta Z raporuna dayanan sayım varsa.
 * - **Açılış ModPOS'ta yok** (sahibin kararı, 4 Kasım 2026): kafede ModPOS'a başlangıç nakdi girilmez, açılış önceki
 *   günün devridir (panel onu raporun kendi denetimiyle karşılaştırır: "Açılış ≠ devir"). Açılış ModPOS'la
 *   karşılaştırılmaz; ModPOS'un beklenen nakdi ve kasa farkı tabloda raporun açılışı eklenerek gösterilir
 *   (modposOpening).
 * - **ModPOS'ta girilmemiş sayım** (bilgi, uyarı değil): sayım girilmeden Z'si alınan günde ModPOS sayılanı 0 gönderir;
 *   0 yalnız ModPOS'un beklenen nakdi de 0'sa gerçek sayımdır ve karşılaştırılır (modposNotEntered).
 * - **Bilgi** (uyarı değil): gün içinde çıkan ↔ ModPOS'un gideri, gün içinde giren ↔ nakit cari tahsilat, olması
 *   gereken nakit ve kasa farkı. Kasadan çıkanların kaynağı paneldir (teslim de oradadır; ModPOS'ta yalnız gider),
 *   ikisinin farklı olması olağan olabilir.
 */

/** Karşılaştırılan rapor alanları (CashReportFields'ın alt kümesi; kayıtlı rapor ya da DTO) */
export interface ModposSavedFields {
  zNo: string | null;
  receipts: number | null;
  zTotal: number;
  cash: number;
  card: number;
  mealCard: number;
  online: number;
  other: number;
  offRevenue: number | null;
  openingCash: number;
  cashIn?: number | null;
  cashOut: number;
  countedCash: number;
}

export type ModposDiffField = "zNo" | "receipts" | "zTotal" | "cash" | "card" | "mealCard" | "online" | "other" | "offRevenue" | "openingCash" | "countedCash";

export interface ModposDiff {
  field: ModposDiffField;
  label: string;
  saved: number | string;
  modpos: number | string;
}

const LABELS: Record<ModposDiffField, string> = {
  zNo: "Z no",
  receipts: "Fiş sayısı",
  zTotal: "Toplam satış",
  cash: "Nakit",
  card: "Kart",
  mealCard: "Yemek kartı",
  online: "Online",
  other: "Diğer",
  offRevenue: "Ödenmez / ikram",
  openingCash: "Açılış",
  countedCash: "Sayılan nakit",
};

const kurus = (v: number) => Math.round(v * 100);
const sameMoney = (a: number, b: number) => Math.abs(kurus(a) - kurus(b)) <= 1;
/** Z no baştaki sıfırlar olmadan karşılaştırılır ("0312" = "312") */
const zKey = (v: string) => v.trim().replace(/^0+(?=\d)/, "");

/** ModPOS'ta girilmediği için karşılaştırılmayan alan: beklenen nakit 0 değilken 0 gelen sayım */
export function modposNotEntered(z: ModposZ): Set<"countedCash"> {
  const out = new Set<"countedCash">();
  if (z.countedCash !== null && kurus(z.countedCash) === 0 && !(z.expectedCash !== null && kurus(z.expectedCash) === 0)) out.add("countedCash");
  return out;
}

/** Açılış ModPOS'ta tutulmaz: karşılaştırma tablosunun açılış satırındaki not */
export const MODPOS_NO_OPENING = "ModPOS'ta yok (önceki günün devri)";

/**
 * ModPOS'un hesabındaki açılış: kafede başlangıç nakdi ModPOS'a girilmez (0); öyleyse beklenen nakit ve kasa farkı
 * raporun açılışıyla tamamlanır (ModPOS'ta yazılıysa o)
 */
export function modposOpening(z: ModposZ, reportOpening: number | null | undefined): number {
  return kurus(z.openingCash) === 0 ? (reportOpening ?? 0) : z.openingCash;
}

/** "ModPOS'ta girilmedi" (karşılaştırma tablosunun fark hücresi) */
export const MODPOS_NOT_ENTERED = "ModPOS'ta girilmedi";

/** Raporda farklı yazılan alanlar (yoksa boş) */
export function modposDiffs(saved: ModposSavedFields, z: ModposZ): ModposDiff[] {
  const out: ModposDiff[] = [];
  const skip = modposNotEntered(z);
  const push = (field: ModposDiffField, s: number | string, m: number | string) => out.push({ field, label: LABELS[field], saved: s, modpos: m });
  if (saved.zNo && z.zNo && zKey(saved.zNo) !== zKey(z.zNo)) push("zNo", saved.zNo, z.zNo);
  // Kasasız (föysüz) günde Z no ve fiş sayısı ModPOS'ta yok; tutarlar yine karşılaştırılır
  if (saved.receipts !== null && saved.receipts !== undefined && !z.foysuz && saved.receipts !== z.receipts) push("receipts", saved.receipts, z.receipts);
  for (const f of ["zTotal", "cash", "card", "mealCard", "online", "other"] as const) if (!sameMoney(saved[f], z[f])) push(f, saved[f], z[f]);
  if (saved.offRevenue !== null && saved.offRevenue !== undefined && !sameMoney(saved.offRevenue, z.offRevenue)) push("offRevenue", saved.offRevenue, z.offRevenue);
  if (z.countedCash !== null && !skip.has("countedCash") && !sameMoney(saved.countedCash, z.countedCash)) push("countedCash", saved.countedCash, z.countedCash);
  return out;
}

const shown = (d: ModposDiff, v: number | string) => (d.field === "zNo" || d.field === "receipts" ? String(v) : money(Number(v)));

/** "Nakit 8.190 ₺ (ModPOS föyünde 8.210 ₺)" */
export function modposDiffText(d: ModposDiff): string {
  return `${d.label} ${shown(d, d.saved)} (ModPOS API'de ${shown(d, d.modpos)})`;
}

/** "ModPOS föyünden farklı: Nakit 8.190 ₺ (ModPOS föyünde 8.210 ₺); …" */
export function modposDiffsLine(diffs: readonly ModposDiff[]): string | null {
  return diffs.length ? `ModPOS API'den farklı: ${diffs.map(modposDiffText).join("; ")}` : null;
}

export type CompareTone = "same" | "diff" | "info" | "none";

/** Karşılaştırma tablosunun satırı: rapor ve föy yan yana */
export interface ModposCompareRow {
  key: string;
  label: string;
  /** Raporda (rapor yoksa null) */
  report: number | string | null;
  modpos: number | string | null;
  /** Föy − rapor (tutarlarda; yoksa null) */
  diff: number | null;
  tone: CompareTone;
  /** Tutar mı (para biçimi) yoksa sayı / metin mi */
  money: boolean;
  /** Fark yerine yazılan not (ModPOS'ta girilmemiş alan: MODPOS_NOT_ENTERED) */
  note?: string;
}

/**
 * Yöneticinin gün görünümündeki tablo: önce Z alanları, sonra kasa. Rapor yoksa yalnız föyün sütunu dolu (tone "none").
 * `expected`: raporun olması gereken nakdi (computeCash), varsa
 */
export function modposCompare(saved: (ModposSavedFields & { expectedCash?: number | null; cashDiff?: number | null }) | null, z: ModposZ): ModposCompareRow[] {
  const diffs = saved ? new Set(modposDiffs(saved, z).map((d) => d.field)) : new Set<string>();
  const notEntered: ReadonlySet<string> = modposNotEntered(z);
  const rows: ModposCompareRow[] = [];
  const row = (key: string, label: string, report: number | string | null, modpos: number | string | null, isMoney: boolean, kind: "check" | "info") => {
    const diff = isMoney && typeof report === "number" && typeof modpos === "number" ? Math.round((modpos - report) * 100) / 100 : null;
    // ModPOS'ta girilmemiş alan: rapor da 0 değilse fark değil not (bilgi)
    const missing = notEntered.has(key) && diff !== null && Math.abs(diff) >= 0.01;
    const tone: CompareTone =
      !saved || report === null || modpos === null ? "none" : missing ? "info" : kind === "check" ? (diffs.has(key) ? "diff" : "same") : diff !== null && Math.abs(diff) >= 0.01 ? "info" : "same";
    rows.push({ key, label, report, modpos, diff: diff === 0 ? 0 : diff, tone, money: isMoney, ...(missing && saved ? { note: MODPOS_NOT_ENTERED } : {}) });
  };
  row("zNo", "Z no", saved?.zNo ?? null, z.zNo, false, "check");
  row("receipts", "Fiş (adisyon) sayısı", saved?.receipts ?? null, z.foysuz ? null : z.receipts, false, "check");
  row("zTotal", "Toplam satış (ciro)", saved?.zTotal ?? null, z.zTotal, true, "check");
  row("cash", "Nakit", saved?.cash ?? null, z.cash, true, "check");
  row("card", "Kredi / banka kartı", saved?.card ?? null, z.card, true, "check");
  row("mealCard", "Yemek kartı", saved?.mealCard ?? null, z.mealCard, true, "check");
  row("online", "Online", saved?.online ?? null, z.online, true, "check");
  row("other", "Diğer", saved?.other ?? null, z.other, true, "check");
  row("offRevenue", "Ödenmez / ikram (ciro dışı)", saved?.offRevenue ?? null, z.offRevenue, true, "check");
  if (!z.foysuz) {
    // Açılış ModPOS'ta tutulmaz (önceki günün devri): karşılaştırılmaz; ModPOS'ta yazılmışsa yalnız bilgi
    const noOpening = kurus(z.openingCash) === 0;
    if (noOpening) rows.push({ key: "openingCash", label: "Açılış", report: saved?.openingCash ?? null, modpos: null, diff: null, tone: "none", money: true, ...(saved ? { note: MODPOS_NO_OPENING } : {}) });
    else row("openingCash", "Açılış", saved?.openingCash ?? null, z.openingCash, true, "info");
    row("cashOut", "Gün içinde çıkan ↔ ModPOS API gideri", saved?.cashOut ?? null, z.cashOut, true, "info");
    row("cashIn", "Gün içinde giren ↔ nakit cari tahsilat", saved ? (saved.cashIn ?? 0) : null, z.cashIn, true, "info");
    // ModPOS'un beklenen nakdi ve kasa farkı açılışsızdır: raporun açılışı eklenir (modposOpening)
    const add = noOpening ? (saved?.openingCash ?? 0) : 0;
    const expected = z.expectedCash !== null ? Math.round((z.expectedCash + add) * 100) / 100 : null;
    row("expectedCash", noOpening && add ? "Olması gereken nakit (ModPOS'a raporun açılışı eklendi)" : "Olması gereken nakit", saved?.expectedCash ?? null, expected, true, "info");
    row("countedCash", "Sayılan nakit", saved?.countedCash ?? null, z.countedCash, true, "check");
    const counted = z.countedCash !== null && !notEntered.has("countedCash");
    const modposDiff = counted && expected !== null ? Math.round((z.countedCash! - expected) * 100) / 100 : z.cashDiff;
    row("cashDiff", "Kasa farkı", saved?.cashDiff ?? null, noOpening && add ? (counted && expected !== null ? modposDiff : null) : z.cashDiff, true, "info");
  }
  return rows;
}

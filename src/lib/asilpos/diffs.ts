import { money } from "@/lib/format";
import { fieldText, sameValue, type PrefillField } from "@/lib/photo-read/kasa";

import type { AsilposDay } from "./prefill";

/*
 * Gönderilmiş kasa raporu ile AsilPOS'un gün sonu (saf; denetim E-09, docs/ASILPOS.md › Kasa raporu): kayıtlı görünüm,
 * e-posta, WhatsApp, geç rapor ve onay kartı "AsilPOS'tan farklı yazılan"ı buradan alır. Yalnız AsilPOS günlerinde
 * çağrılır (geçiş günü seçili ve gün ondan önce değil; src/lib/asilpos/switch.ts). cash-report.ts de içe aktarır: bu
 * dosya cash-report.ts'i içe aktarmaz (döngü olmasın).
 */

const round2 = (v: number) => Math.round(v * 100) / 100;
const kurus = (v: number) => Math.round(v * 100);

/** Kayıtlı raporun AsilPOS'tan farklı yazılan alanı (denetim E-09): "Sayılan nakit 9.350 ₺ (AsilPOS'ta 9.000 ₺)" */
export interface AsilposDiff {
  /** Formun alanı; `carry` teslim sayımdan sonra yazıldığında devir (sayılan − teslim) */
  field: PrefillField | "carry" | "outflow";
  label: string;
  saved: number | string;
  asilpos: number | string;
}

/** Kayıtlı raporun karşılaştırılan alanları (CashReportFields'ın alt kümesi) */
export interface AsilposSavedFields {
  zNo: string | null;
  receipts: number | null;
  zTotal: number;
  cash: number;
  card: number;
  mealCard: number;
  online: number;
  other: number;
  offRevenue: number | null;
  discounts?: number | null;
  openingCash: number;
  cashIn?: number | null;
  cashOut: number;
  countedCash: number;
  handedOver: number;
}

const DIFF_LABELS: Record<string, string> = {
  zNo: "Z no",
  receipts: "Fiş sayısı",
  zTotal: "Toplam satış",
  cash: "Nakit",
  card: "Kart",
  mealCard: "Yemek kartı",
  online: "Online",
  other: "Diğer",
  offRevenue: "Ödenmez / ikram",
  discounts: "İndirim",
  openingCash: "Açılış",
  cashIn: "Gün içinde giren",
  cashOut: "Gün içinde çıkan",
  countedCash: "Sayılan nakit",
  outflow: "Gün içinde çıkan + teslim edilen",
  carry: "Ertesi güne devir (sayılan − teslim)",
};

/**
 * Gönderilmiş rapor ile AsilPOS'un gün sonu (denetim E-09; yalnız AsilPOS günlerinde çağrılır): personelin yazdığı ve
 * AsilPOS'tan farklı alanlar. Z alanları, açılış ve gün içinde giren alan alan; boş bırakılan isteğe bağlı alan (Z no,
 * fiş sayısı, ödenmez, indirim) farklı sayılmaz. Kasa: AsilPOS'ta teslim sayımdan önce çıkar (Gün içinde çıkan =
 * harcama + teslim, Teslim edilen 0); personel teslimi sayımdan sonra yazdıysa (Teslim edilen > 0) aynı para iki ayrı
 * biçimde yazılmıştır: o zaman çıkan + teslim AsilPOS'un harcama + teslimiyle, devir (sayılan − teslim) AsilPOS'un
 * sayımıyla karşılaştırılır. AsilPOS'ta sayım yoksa sayılan karşılaştırılmaz. Tutarlar 1 kuruş hassasiyetle.
 */
export function asilposDiffs(saved: AsilposSavedFields, day: Pick<AsilposDay, "prefill" | "till">): AsilposDiff[] {
  const out: AsilposDiff[] = [];
  const v = day.prefill.values;
  const push = (field: AsilposDiff["field"], s: number | string, l: number | string) => out.push({ field, label: DIFF_LABELS[field], saved: s, asilpos: l });
  const cmp = (field: PrefillField, s: number | string | null | undefined) => {
    const l = v[field]?.value;
    if (l === undefined || s === null || s === undefined) return;
    if (!sameValue(field, fieldText(field, s), l)) push(field, s, l);
  };
  for (const f of ["zNo", "receipts", "zTotal", "cash", "card", "mealCard", "online", "other", "offRevenue", "discounts", "openingCash"] as const) cmp(f, saved[f]);
  cmp("cashIn", saved.cashIn ?? 0);
  const asilposOut = round2(day.till.spent + day.till.handed);
  const counted = v.countedCash?.value;
  const same = (a: number, b: number) => Math.abs(kurus(a) - kurus(b)) <= 1;
  if (saved.handedOver > 0) {
    const outflow = round2(saved.cashOut + saved.handedOver);
    if (!same(outflow, asilposOut)) push("outflow", outflow, asilposOut);
    const carry = round2(saved.countedCash - saved.handedOver);
    if (counted !== undefined && !same(carry, Number(counted))) push("carry", carry, Number(counted));
  } else {
    if (!same(saved.cashOut, asilposOut)) push("cashOut", saved.cashOut, asilposOut);
    if (counted !== undefined && !same(saved.countedCash, Number(counted))) push("countedCash", saved.countedCash, Number(counted));
  }
  return out;
}

const diffShown = (d: AsilposDiff, x: number | string) => (d.field === "zNo" || d.field === "receipts" ? String(x) : money(Number(x)));

/** "Sayılan nakit 9.350 ₺ (AsilPOS'ta 9.000 ₺)" */
export function asilposDiffText(d: AsilposDiff): string {
  return `${d.label} ${diffShown(d, d.saved)} (AsilPOS'ta ${diffShown(d, d.asilpos)})`;
}

/** Rapor metninin satırı: "AsilPOS'tan farklı yazılan: Sayılan nakit 9.350 ₺ (AsilPOS'ta 9.000 ₺)" */
export function asilposDiffsLine(diffs: readonly AsilposDiff[]): string | null {
  return diffs.length ? `AsilPOS'tan farklı yazılan: ${diffs.map(asilposDiffText).join("; ")}` : null;
}

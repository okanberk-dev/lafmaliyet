import { money } from "@/lib/format";
import { fieldText, sameValue, type PrefillField } from "@/lib/photo-read/kasa";

import type { LafposDay } from "./prefill";

/*
 * Gönderilmiş kasa raporu ile LafPOS'un gün sonu (saf; denetim E-09, docs/LAFPOS.md › Kasa raporu): kayıtlı görünüm,
 * e-posta, WhatsApp, geç rapor ve onay kartı "LafPOS'tan farklı yazılan"ı buradan alır. Yalnız LafPOS günlerinde
 * çağrılır (geçiş günü seçili ve gün ondan önce değil; src/lib/lafpos/switch.ts). cash-report.ts de içe aktarır: bu
 * dosya cash-report.ts'i içe aktarmaz (döngü olmasın).
 */

const round2 = (v: number) => Math.round(v * 100) / 100;
const kurus = (v: number) => Math.round(v * 100);

/** Kayıtlı raporun LafPOS'tan farklı yazılan alanı (denetim E-09): "Sayılan nakit 9.350 ₺ (LafPOS'ta 9.000 ₺)" */
export interface LafposDiff {
  /** Formun alanı; `carry` teslim sayımdan sonra yazıldığında devir (sayılan − teslim) */
  field: PrefillField | "carry" | "outflow";
  label: string;
  saved: number | string;
  lafpos: number | string;
}

/** Kayıtlı raporun karşılaştırılan alanları (CashReportFields'ın alt kümesi) */
export interface LafposSavedFields {
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
 * Gönderilmiş rapor ile LafPOS'un gün sonu (denetim E-09; yalnız LafPOS günlerinde çağrılır): personelin yazdığı ve
 * LafPOS'tan farklı alanlar. Z alanları, açılış ve gün içinde giren alan alan; boş bırakılan isteğe bağlı alan (Z no,
 * fiş sayısı, ödenmez, indirim) farklı sayılmaz. Kasa: LafPOS'ta teslim sayımdan önce çıkar (Gün içinde çıkan =
 * harcama + teslim, Teslim edilen 0); personel teslimi sayımdan sonra yazdıysa (Teslim edilen > 0) aynı para iki ayrı
 * biçimde yazılmıştır: o zaman çıkan + teslim LafPOS'un harcama + teslimiyle, devir (sayılan − teslim) LafPOS'un
 * sayımıyla karşılaştırılır. LafPOS'ta sayım yoksa sayılan karşılaştırılmaz. Tutarlar 1 kuruş hassasiyetle.
 */
export function lafposDiffs(saved: LafposSavedFields, day: Pick<LafposDay, "prefill" | "till">): LafposDiff[] {
  const out: LafposDiff[] = [];
  const v = day.prefill.values;
  const push = (field: LafposDiff["field"], s: number | string, l: number | string) => out.push({ field, label: DIFF_LABELS[field], saved: s, lafpos: l });
  const cmp = (field: PrefillField, s: number | string | null | undefined) => {
    const l = v[field]?.value;
    if (l === undefined || s === null || s === undefined) return;
    if (!sameValue(field, fieldText(field, s), l)) push(field, s, l);
  };
  for (const f of ["zNo", "receipts", "zTotal", "cash", "card", "mealCard", "online", "other", "offRevenue", "discounts", "openingCash"] as const) cmp(f, saved[f]);
  cmp("cashIn", saved.cashIn ?? 0);
  const lafposOut = round2(day.till.spent + day.till.handed);
  const counted = v.countedCash?.value;
  const same = (a: number, b: number) => Math.abs(kurus(a) - kurus(b)) <= 1;
  if (saved.handedOver > 0) {
    const outflow = round2(saved.cashOut + saved.handedOver);
    if (!same(outflow, lafposOut)) push("outflow", outflow, lafposOut);
    const carry = round2(saved.countedCash - saved.handedOver);
    if (counted !== undefined && !same(carry, Number(counted))) push("carry", carry, Number(counted));
  } else {
    if (!same(saved.cashOut, lafposOut)) push("cashOut", saved.cashOut, lafposOut);
    if (counted !== undefined && !same(saved.countedCash, Number(counted))) push("countedCash", saved.countedCash, Number(counted));
  }
  return out;
}

const diffShown = (d: LafposDiff, x: number | string) => (d.field === "zNo" || d.field === "receipts" ? String(x) : money(Number(x)));

/** "Sayılan nakit 9.350 ₺ (LafPOS'ta 9.000 ₺)" */
export function lafposDiffText(d: LafposDiff): string {
  return `${d.label} ${diffShown(d, d.saved)} (LafPOS'ta ${diffShown(d, d.lafpos)})`;
}

/** Rapor metninin satırı: "LafPOS'tan farklı yazılan: Sayılan nakit 9.350 ₺ (LafPOS'ta 9.000 ₺)" */
export function lafposDiffsLine(diffs: readonly LafposDiff[]): string | null {
  return diffs.length ? `LafPOS'tan farklı yazılan: ${diffs.map(lafposDiffText).join("; ")}` : null;
}

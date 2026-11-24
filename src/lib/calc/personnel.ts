// Personelin çift sayım ve eksik bağlantı uyarıları (Faz 5; saf, testleri tests/personel-yemek-karti.test.ts ve
// tests/personel-part-time.test.ts). Hiçbiri veriyi değiştirmez: yalnız söyler (Genel bakış uyarısı ve Maaşlar).

import { isPartTime, MEAL_CARD_ROW_LABEL, partTimeUnlinkedText, type Model } from "./engine";
import type { FixedExpense, Staff } from "./types";

/** Gelir-gider'in yemek kartı satırının adı (engine.ts MEAL_CARD_ROW_LABEL) */
export const MEAL_CARD_LABEL = MEAL_CARD_ROW_LABEL;

export type StaffWarningKind = "meal-double" | "meal-extras" | "parttime-double" | "parttime-unlinked";

export interface StaffWarning {
  kind: StaffWarningKind;
  level: "warning" | "info";
  title: string;
  detail: string;
  /** İlgili personel (Maaşlar'da satırın uyarısı) */
  staffIds: number[];
  href: string;
}

/** Türkçe küçük harf, ı → i, aksansız (ad karşılaştırması) */
const fold = (s: string) => s.toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** İşletmenin "Personel yemeği" sabit gideri (seed: günlük 330 × açık gün): adı personel yemeği / yemek kartı */
export function isStaffMealItem(f: Pick<FixedExpense, "name">): boolean {
  const n = fold(f.name);
  return /personel\s*yeme|yemek\s*karti|calisan\s*yeme/.test(n);
}

/**
 * Ek ödeme yemek kartı gibi mi duruyor (yalnız ipucu): günlük tutarın tam katı (15–31 gün) ya da Ayarlar'daki aylık
 * tutar. Ek ödeme brütleştirilmez, yemek kartı da: aynı yemek iki kez sayılırdı
 */
export function extrasLookLikeMealCard(extras: number, st: Pick<Model["settings"], "mealCardDaily" | "mealCardDays">): boolean {
  if (!(extras > 0) || !(st.mealCardDaily > 0)) return false;
  if (Math.abs(extras - st.mealCardDaily * st.mealCardDays) < 0.5) return true;
  const days = extras / st.mealCardDaily;
  return Math.abs(days - Math.round(days)) < 1e-6 && days >= 15 && days <= 31;
}

/**
 * Haftalık / sabit "Part-time çalışan" gideri (seed: haftada 3.000 ₺; Kasım 2026 için kalır, sahibin kararı 12): personel
 * bölümünde, adı part-time / yarı zamanlı (tax/pnl.ts'teki kuralla aynı)
 */
export function isPartTimeItem(f: Pick<FixedExpense, "name" | "section">): boolean {
  return f.section === "personel" && /part.?time|yari zamanli/.test(fold(f.name));
}

const names = (xs: readonly { name: string }[]) => [...new Set(xs.map((x) => x.name))].join(", ");

/**
 * Ayın personel uyarıları (seçili şube kapsamında: model şubenin personeli ve sabit giderleriyle kurulur):
 * - meal-double: yemek kartı işaretli kişi + aynı ayda etkin "Personel yemeği" sabit gideri (işletme geneli ya da kişinin
 *   şubesinin): aynı yemek iki kez sayılabilir;
 * - meal-extras: işaretli kişinin ek ödemesi yemek kartı gibi duruyor (günlük tutarın tam katı);
 * - parttime-double: aynı ayda "Part-time çalışan" sabit gideri ve çağrıldığı günü olan günlük part-time satırı (işletme
 *   geneli ya da kişinin şubesinin kalemi): aynı iş iki kez sayılabilir;
 * - parttime-unlinked: Vardiya bağlantısı olmayan part-time: günü bilinmez, ücreti sayılmadı (tahmin yok).
 */
export function staffWarnings(model: Pick<Model, "personnelFor" | "fixedInMonth" | "settings">, month: string): StaffWarning[] {
  const out: StaffWarning[] = [];
  const rows = model.personnelFor(month).rows;
  const flagged: Staff[] = rows.filter((r) => r.mealCard > 0 || (r.staff.mealCard && isPartTime(r.staff))).map((r) => r.staff);
  if (flagged.length) {
    const meals = model.fixedInMonth(month).filter(isStaffMealItem);
    const hits = flagged.filter((s) => meals.some((f) => (f.branchId ?? null) === null || f.branchId === s.branchId));
    const items = meals.filter((f) => hits.some((s) => (f.branchId ?? null) === null || f.branchId === s.branchId));
    if (hits.length) {
      out.push({
        kind: "meal-double",
        level: "warning",
        title: "Personel yemeği iki kez sayılabilir: yemek kartı ve sabit gider",
        detail: `${names(hits)} yemek kartı işaretli (Maaşlar); bu ay "${names(items)}" sabit gideri de sayılıyor. Yemek kartıyla ödenen yemek sabit giderde de duruyorsa sabit gideri bitirin ya da tutarını düşürün. Tutarlar kendiliğinden değişmez.`,
        staffIds: hits.map((s) => s.id),
        href: "/panel/personel",
      });
    }
    const extras = flagged.filter((s) => extrasLookLikeMealCard(s.extras, model.settings));
    if (extras.length) {
      out.push({
        kind: "meal-extras",
        level: "info",
        title: "Ek ödemede yemek kartı olabilir",
        detail: `${names(extras)}: yemek kartı işaretli ve "Yemek / yol / prim" tutarı yemek kartı gibi duruyor. Yemek kartı artık kendi alanında; ekte de yazılıysa iki kez sayılır, ekten düşün.`,
        staffIds: extras.map((s) => s.id),
        href: "/panel/personel",
      });
    }
  }
  const part = rows.filter((r) => isPartTime(r.staff));
  const called = part.filter((r) => (r.calledDays ?? 0) > 0).map((r) => r.staff);
  if (called.length) {
    const weekly = model.fixedInMonth(month).filter(isPartTimeItem);
    const hits = called.filter((s) => weekly.some((f) => (f.branchId ?? null) === null || f.branchId === s.branchId));
    const items = weekly.filter((f) => hits.some((s) => (f.branchId ?? null) === null || f.branchId === s.branchId));
    if (hits.length) {
      out.push({
        kind: "parttime-double",
        level: "warning",
        title: "Part-time iki kez sayılabilir: sabit gider ve günlük ücret",
        detail: `Bu ay "${names(items)}" sabit gideri sayılıyor ve ${names(hits)} günlük part-time olarak Vardiya'daki günleriyle de sayılıyor. Günlük modele geçildiyse sabit giderin son ayını girin (Giderler › Sabit giderler). Tutarlar kendiliğinden değişmez.`,
        staffIds: hits.map((s) => s.id),
        href: "/panel/giderler",
      });
    }
  }
  const unlinked = part.filter((r) => r.calledDays === null).map((r) => r.staff);
  if (unlinked.length) {
    out.push({
      kind: "parttime-unlinked",
      level: "warning",
      title: "Part-time personelin Vardiya bağlantısı yok",
      detail: partTimeUnlinkedText(unlinked),
      staffIds: unlinked.map((s) => s.id),
      href: "/panel/personel",
    });
  }
  return out;
}

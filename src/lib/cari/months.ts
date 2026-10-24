/**
 * Cari işlemlerinin aylara etkisi (saf; tests/cari-ay.test.ts): geçmiş ayın giderini değiştiren işlem o ayı adıyla
 * sorar (K18), "Faturası geldi" önizlemesi gideri ve KDV tahminini ay ay söyler.
 */
import { monthLabel, tl } from "../format";
import { round2 } from "./balance";

export interface MonthEffect {
  /** YYYY-MM */
  month: string;
  /** Giderin değişimi (artı: artar) */
  delta: number;
}

/** Gider değişimlerinden bugünün ayından eski ayların etkisi, ay sırasıyla (değişmeyen ay yok) */
export function pastMonthEffects(changes: readonly { date: string; delta: number }[], today: string): MonthEffect[] {
  const current = today.slice(0, 7);
  const byMonth = new Map<string, number>();
  for (const c of changes) {
    const m = c.date.slice(0, 7);
    if (m >= current) continue;
    byMonth.set(m, (byMonth.get(m) ?? 0) + c.delta);
  }
  return [...byMonth]
    .map(([month, delta]) => ({ month, delta: round2(delta) }))
    .filter((e) => Math.abs(e.delta) >= 0.005)
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Önizleme satırı: "Eylül 2026 gideri 1.200,00 ₺ azalır (geçmiş ay)" */
export function pastMonthText(e: MonthEffect): string {
  return `${monthLabel(e.month)} gideri ${tl(Math.abs(e.delta), 2)} ${e.delta < 0 ? "azalır" : "artar"} (geçmiş ay)`;
}

/** Yılın -in hâli eki ("2026'nın", "2025'in"): sayının okunuşunun son hecesine göre */
export function yearGenitive(year: number): string {
  const last = year % 10;
  const byLast: Record<number, string> = { 1: "'in", 2: "'nin", 3: "'ün", 4: "'ün", 5: "'in", 6: "'nın", 7: "'nin", 8: "'in", 9: "'un" };
  if (last) return `${year}${byLast[last]}`;
  const tens = Math.floor(year / 10) % 10;
  const byTens: Record<number, string> = { 1: "'un", 2: "'nin", 3: "'un", 4: "'ın", 5: "'nin", 6: "'ın", 7: "'in", 8: "'in", 9: "'ın" };
  if (tens) return `${year}${byTens[tens]}`;
  // 2000 "iki bin", 2100 "iki bin yüz"
  return `${year}${Math.floor(year / 100) % 10 ? "'ün" : "'in"}`;
}

/** Onay kutusu: "Eylül 2026'nın kapanmış rakamlarının değişeceğini biliyorum" */
export function pastMonthConfirmText(effects: readonly MonthEffect[]): string {
  const names = effects.map((e) => {
    const [y] = e.month.split("-").map(Number);
    return `${monthLabel(e.month).split(" ")[0]} ${yearGenitive(y)}`;
  });
  return `${names.join(", ")} kapanmış rakamlarının değişeceğini biliyorum`;
}

/**
 * Sunucunun denetimi: işlemin değiştirdiği her geçmiş ay onaylanmış olmalı. Eksik varsa kullanıcıya gösterilecek
 * mesaj ("Bu değişiklik Eylül 2026 giderini değiştirir; onaylayın"), yoksa null.
 */
export function missingPastConfirm(effects: readonly MonthEffect[], confirmed: readonly string[] | null | undefined): string | null {
  const ok = new Set(confirmed ?? []);
  const missing = effects.filter((e) => !ok.has(e.month));
  if (!missing.length) return null;
  return `Bu değişiklik ${missing.map((e) => monthLabel(e.month)).join(", ")} giderini değiştirir; onaylayın`;
}

/** İşlem geçmişinin ekinde: " · geçmiş ay değişti: Eylül 2026" (yoksa boş) */
export function pastMonthLogSuffix(effects: readonly MonthEffect[]): string {
  return effects.length ? ` · geçmiş ay değişti: ${effects.map((e) => monthLabel(e.month)).join(", ")}` : "";
}

// ---------------------------------------------------------------- "Faturası geldi" önizlemesi (§5.2)

/** Ayın adı; bugünün yılından başka bir yılsa yılıyla ("Ekim", "Aralık 2025") */
const monthName = (month: string, today: string) => (month.slice(0, 4) === today.slice(0, 4) ? monthLabel(month).split(" ")[0] : monthLabel(month));

const signed = (v: number) => `${v < 0 ? "−" : "+"}${tl(Math.abs(v), 2)}`;

export interface LinkPreviewInput {
  /** Bağlamanın sildiği gider kayıtları ("gider" ve "mevcut" borçların kayıtları) */
  removed: readonly { date: string; amount: number; categoryName: string }[];
  /** Fatura: gün, KDV hariç net, KDV, Ödenecek; `goods` mal alışı (mal kategorileri) */
  invoice: { date: string; net: number; vat: number; payable: number; goods: boolean };
  /** Bağlanan borçların toplamı */
  debtTotal: number;
  today: string;
}

/**
 * "Ekim gideri −600,00 ₺ (Nakit malzeme alımı), Kasım mal alışı faturada 545,45 ₺ (KDV hariç; zaten sayılıyor) · KDV
 * tahmini Kasım +54,55 ₺ · fark faturada +0,00 ₺". Silinen gider ay ve kategori başına bir parça; fatura zaten gider
 * olduğu için tutarı yalnız söylenir.
 */
export function linkPreview(p: LinkPreviewInput): string {
  const groups = new Map<string, { month: string; category: string; amount: number }>();
  for (const r of p.removed) {
    const k = `${r.date.slice(0, 7)}|${r.categoryName}`;
    const g = groups.get(k) ?? { month: r.date.slice(0, 7), category: r.categoryName, amount: 0 };
    g.amount += r.amount;
    groups.set(k, g);
  }
  const removed = [...groups.values()]
    .sort((a, b) => a.month.localeCompare(b.month) || a.category.localeCompare(b.category, "tr"))
    .map((g) => `${monthName(g.month, p.today)} gideri −${tl(round2(g.amount), 2)} (${g.category})`);
  const im = monthName(p.invoice.date.slice(0, 7), p.today);
  const invoice = `${im} ${p.invoice.goods ? "mal alışı" : "gideri"} faturada ${tl(round2(p.invoice.net), 2)} (KDV hariç; zaten sayılıyor)`;
  return [
    [...removed, invoice].join(", "),
    `KDV tahmini ${im} ${signed(round2(p.invoice.vat))}`,
    `fark faturada ${signed(round2(p.invoice.payable - p.debtTotal))}`,
  ].join(" · ");
}

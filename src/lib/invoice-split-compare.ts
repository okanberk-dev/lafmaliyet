/**
 * Kalem kalem sayma (src/lib/invoice-split.ts) ve faturanın şubesi (src/lib/invoice-branch.ts) geçmiş ayların rakamlarını
 * nasıl değiştirir: aynı veride **eski kural** ile **yeni kural** ay ay karşılaştırılır (scripts/fatura-kalem-karsilastir.ts,
 * tests/fatura-kalem-karsilastirma.test.ts; docs/PARASUT.md › 5f).
 *
 * Eski kural (25 Kasım 2026'dan önceki main):
 * - fatura bütün sayılır, kategorisine göre (kalem listesi yok);
 * - şube seçiliyken şubesi boş her fatura görünür ve işletme genelidir (harcamaya bağlı faturalar şubenin kârına girmez,
 *   "İşletme geneli payı" bilgi satırındadır); eski `branch_id` yalnız ayrı Paraşüt hesabından gelen faturada doluydu.
 *
 * Eski kural eski kodu çağırmaz: veri eski kodun göreceği biçime getirilir (kalem, `companyWide` ve şube kırılımı yok) ve
 * bugünkü motor koşar. Eski kodla birebir aynı sonucu verdiği 25 Kasım'da main'in motoruyla denendi. Saf.
 */

import type { Model } from "./calc/engine";
import type { Dataset, Invoice } from "./calc/types";

/** Eski kuralın faturası: kalem yok, işletme geneli ayrımı yok, harcama payı şubeye yazılmaz */
function oldInvoice(i: Invoice): Invoice {
  const rest: Invoice = { ...i, branchId: null };
  delete rest.lines;
  delete rest.companyWide;
  return rest;
}

/**
 * Eski kuralın verisi. `all`: bütün şubelerin faturaları ("Tümü"nün listesi); `scope`: veri hangi kapsamın ("hepsi" ya
 * da şube kimliği); `oldBranchOf`: faturanın eski `branch_id`'si (yoksa null: işletme geneli). Faturalar dışındaki veri
 * (satış, personel, gider) kapsamın kendi verisidir, değişmez
 */
export function oldRuleDataset(ds: Dataset, o: { all: readonly Invoice[]; scope: string; oldBranchOf?: (i: Invoice) => string | null }): Dataset {
  const branchOf = o.oldBranchOf ?? (() => null);
  const visible = o.scope === "hepsi" ? o.all : o.all.filter((i) => {
    const b = branchOf(i);
    return b === null || b === o.scope;
  });
  return { ...ds, invoices: visible.map(oldInvoice) };
}

/** Bir ayın karşılaştırılan rakamları: anahtar → tutar (TL, KDV hariç) */
export type MonthNumbers = Map<string, number>;

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Ayın rakamları: mal alışı, Gelir-gider'in mal / gider satırları ve toplamları, işletme geneli payı, Tümü'nün şube
 * kırılımı, başabaşın sabit gideri. `labels` anahtarın okunur adını toplar
 */
export function monthNumbers(model: Model, month: string, labels?: Map<string, string>): MonthNumbers {
  const out: MonthNumbers = new Map();
  const put = (key: string, label: string, v: number | null | undefined) => {
    if (v === null || v === undefined || !Number.isFinite(v)) return;
    out.set(key, r2(v));
    labels?.set(key, label);
  };
  put("mal-alisi", "Mal alışı (faturalar)", model.goodsPurchases(month));
  const pm = model.pnlMonth(month);
  const catName = new Map((model.ds.expenseCategories ?? []).map((c) => [`expense:${c.id}`, c.name]));
  for (const [key, cell] of pm.cells) {
    if (!key.startsWith("purchase:") && !key.startsWith("expense:")) continue;
    const label = key.startsWith("purchase:") ? `Mal alışı · ${key.slice("purchase:".length)}` : `Harcama · ${catName.get(key) ?? key}`;
    put(key, label, typeof cell.value === "number" ? cell.value : 0);
  }
  put("alinan", "Alınan mal (mal bölümü)", pm.purchases);
  put("mal-maliyeti", "Mal maliyeti", pm.cogs);
  for (const [k, v] of Object.entries(pm.sections)) put(`bolum:${k}`, `Bölüm · ${k}`, v);
  put("giderler", "Giderler", pm.expenses);
  put("kar", "Kâr / zarar", pm.profit);
  put("isletme-geneli", "İşletme geneli payı (bilgi)", pm.shared.total);
  for (const [b, v] of Object.entries(pm.byBranch)) put(`sube:${b}`, `Şube kırılımı · ${b}`, v);
  put("basabas-sabit", "Başabaşın sabit gideri", model.breakEvenFixedFor(month));
  return out;
}

export interface NumberChange {
  scope: string;
  month: string;
  key: string;
  label: string;
  before: number;
  after: number;
  delta: number;
}

/** İki kuralın rakamları arasındaki farklar (kuruş altı fark sayılmaz); eksik anahtar 0 sayılır */
export function numberChanges(scope: string, month: string, before: MonthNumbers, after: MonthNumbers, labels: ReadonlyMap<string, string>): NumberChange[] {
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  const out: NumberChange[] = [];
  for (const key of keys) {
    const b = before.get(key) ?? 0;
    const a = after.get(key) ?? 0;
    if (Math.abs(a - b) < 0.005) continue;
    out.push({ scope, month, key, label: labels.get(key) ?? key, before: b, after: a, delta: r2(a - b) });
  }
  return out.sort((x, y) => x.key.localeCompare(y.key, "tr"));
}

/**
 * Faturanın şubesi (sahibin isteği, 25 Kasım 2026; docs/SUBE.md › Faturanın şubesi). Her faturanın üç hâli var:
 *
 * - **şube**: `branchId` dolu (Tuzla, Marina, laffogato.net);
 * - **işletme geneli**: `branchId` boş, `companyWide` açık. Bilinçli seçimdir (muhasebe, ortak hizmet), varsayılan değil;
 * - **şubesi seçilmemiş**: ikisi de boş. Tek şube seçiliyken görünmez; "Tümü"de ve uyarı olarak "Şubesi seçilmemiş"
 *   kutusunda durur.
 *
 * Tek şube seçiliyken görünenler: o şubenin faturaları ve işletme geneli olanlar (giderlerin `branchWhereWithShared`
 * kuralı; işletme geneli satır rozetiyle ayrılır). Saf: veritabanına bağlı değil (tests/fatura-sube.test.ts).
 */

import { ALL_BRANCHES, type BranchRow, type BranchScope } from "./branches";

/** Formun ve eylemin "İşletme geneli" değeri (giderlerdeki `EXPENSE_SHARED` ile aynı söz) */
export const INVOICE_SHARED = "isletme";
/** Şubesi seçilmemiş faturanın etiketi (kutu, rozet, süzgeç) */
export const UNASSIGNED_LABEL = "Şubesi seçilmemiş";
export const SHARED_LABEL = "İşletme geneli";

export interface InvoiceBranchCols {
  branchId: string | null;
  companyWide: boolean;
}

/** Formun / seçicinin değeri: şube kimliği, "isletme" ya da null (seçilmemiş) */
export type InvoiceBranchValue = string | null;

export function invoiceBranchValue(row: { branchId?: string | null; companyWide?: boolean | null }): InvoiceBranchValue {
  if (row.branchId) return row.branchId;
  return row.companyWide ? INVOICE_SHARED : null;
}

/** Seçicinin değerinden sütunlar */
export function invoiceBranchCols(value: InvoiceBranchValue): InvoiceBranchCols {
  if (!value) return { branchId: null, companyWide: false };
  if (value === INVOICE_SHARED) return { branchId: null, companyWide: true };
  return { branchId: value, companyWide: false };
}

/** Şubesi seçilmemiş mi (ne şube ne işletme geneli) */
export function isUnassigned(row: { branchId?: string | null; companyWide?: boolean | null }): boolean {
  return !row.branchId && !row.companyWide;
}

/**
 * Fatura seçili kapsamda görünür mü: "Tümü"de hepsi; tek şubede o şubenin ve işletme genelinin faturaları. Şubesi
 * seçilmemiş fatura tek şubede görünmez (uyarı sayar), öbür şubenin faturası hiç.
 */
export function invoiceInScope(row: { branchId?: string | null; companyWide?: boolean | null }, scope: BranchScope): boolean {
  if (scope === ALL_BRANCHES) return true;
  return row.branchId === scope || Boolean(row.companyWide && !row.branchId);
}

/** Ekrandaki ad: "Marina", "İşletme geneli" ya da "Şubesi seçilmemiş" */
export function invoiceBranchLabel(value: InvoiceBranchValue, branches: readonly Pick<BranchRow, "id" | "name">[]): string {
  if (!value) return UNASSIGNED_LABEL;
  if (value === INVOICE_SHARED) return SHARED_LABEL;
  return branches.find((b) => b.id === value)?.name ?? value;
}

/**
 * Yazılacak değerin kuralı (eylemler): null (seçimi kaldır), "isletme" ya da etkin bir şube (fiziksel ya da online
 * kanal: laffogato.net'in kargo faturası kanalındır). Sorun yoksa null
 */
export function invoiceBranchError(value: InvoiceBranchValue, branches: readonly Pick<BranchRow, "id" | "active">[]): string | null {
  if (value === null || value === INVOICE_SHARED) return null;
  return branches.some((b) => b.id === value && b.active) ? null : "Şube bulunamadı; sayfayı yenileyin";
}

/** Seçicinin seçenekleri: etkin şubeler sırasıyla, sonra İşletme geneli (seçilmemiş ayrıca) */
export function invoiceBranchOptions(branches: readonly Pick<BranchRow, "id" | "name" | "active" | "sortOrder">[]): { value: string; label: string }[] {
  return [
    ...[...branches]
      .filter((b) => b.active)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((b) => ({ value: b.id, label: b.name })),
    { value: INVOICE_SHARED, label: SHARED_LABEL },
  ];
}

/** Tedarikçinin varsayılanı (kart): şube, işletme geneli ya da yok */
export interface SupplierDefault {
  defaultBranchId?: string | null;
  defaultCompanyWide?: boolean | null;
}

export function supplierDefaultValue(card: SupplierDefault | null | undefined): InvoiceBranchValue {
  if (!card) return null;
  return invoiceBranchValue({ branchId: card.defaultBranchId ?? null, companyWide: card.defaultCompanyWide ?? false });
}

/**
 * Eşitlemenin yeni açtığı faturanın şubesi (docs/PARASUT.md › Şube başına Paraşüt hesabı): ayrı Paraşüt hesabının
 * faturası hesabın şubesini alır (hesabın seçimi "şubenin"); değilse tedarikçinin varsayılanı; o da yoksa şubesi
 * seçilmemiş. Tahmin yok: kanıt yoksa boş kalır, kutuya düşer. Var olan faturanın şubesi eşitlemede değişmez.
 */
export function newInvoiceBranch(o: { accountBranch: string | null; supplierDefault: InvoiceBranchValue }): InvoiceBranchCols {
  if (o.accountBranch) return { branchId: o.accountBranch, companyWide: false };
  return invoiceBranchCols(o.supplierDefault);
}

/** Öneri kanıtı: tedarikçinin başka bir kaydının şubesi */
export interface BranchEvidence {
  /** Şube kimliği ya da "isletme" */
  value: string;
  source: "fatura" | "kasa";
}

export interface BranchSuggestion {
  value: string;
  /** Neden ("Tedarikçinin varsayılanı", "O tarihte açık tek şube", "Öteki 4 faturası Marina'da"…) */
  reason: string;
  /** Kanıtın türü: varsayılan, tarih ya da geçmiş kayıtlar */
  kind: "varsayilan" | "tarih" | "gecmis";
}

/**
 * Şubesi seçilmemiş faturaya öneri (yazılmaz; yönetici "Uygula" der). Sırası:
 * 1. tedarikçinin varsayılanı (Tedarikçiler'de seçilen);
 * 2. faturanın günü yalnız bir fiziksel şubenin açık olduğu döneme düşüyorsa o şube (Marina'nın açılışından önce Tuzla);
 * 3. tedarikçinin öteki kayıtları (şubesi seçilmiş faturaları, kasadan ödemeleri) tek bir şubeyi gösteriyorsa o şube.
 * Kanıt karışıksa (iki şube) ya da hiç yoksa öneri yok: fatura kutuda bekler.
 */
export function suggestInvoiceBranch(o: {
  date: string;
  supplierDefault: InvoiceBranchValue;
  evidence: readonly BranchEvidence[];
  branches: readonly Pick<BranchRow, "id" | "name" | "kind" | "active" | "openedOn">[];
}): BranchSuggestion | null {
  const name = (v: string) => invoiceBranchLabel(v, o.branches);
  if (o.supplierDefault) return { value: o.supplierDefault, reason: "Tedarikçinin varsayılanı", kind: "varsayilan" };
  // O gün açık fiziksel şubeler: açılış günü boş olan "başından beri" açıktır. Kapanmış şube de o gün açık olabilir
  const physical = o.branches.filter((b) => b.kind === "fiziksel");
  if (physical.length > 1) {
    const open = physical.filter((b) => !b.openedOn || b.openedOn <= o.date);
    // Sonradan açılan bir şube varsa ve o gün yalnız biri açıksa
    if (open.length === 1 && physical.some((b) => b.openedOn && b.openedOn > o.date)) {
      return { value: open[0].id, reason: `O tarihte açık tek şube ${open[0].name}`, kind: "tarih" };
    }
  }
  const counts = new Map<string, { fatura: number; kasa: number }>();
  for (const e of o.evidence) {
    const c = counts.get(e.value) ?? { fatura: 0, kasa: 0 };
    c[e.source]++;
    counts.set(e.value, c);
  }
  if (counts.size !== 1) return null;
  const [[value, c]] = [...counts];
  const parts = [c.fatura ? `${c.fatura} faturası` : null, c.kasa ? `${c.kasa} kasadan ödemesi` : null].filter(Boolean).join(", ");
  return { value, reason: `Tedarikçinin ${parts} ${value === INVOICE_SHARED ? "işletme geneli" : name(value)}`, kind: "gecmis" };
}

/**
 * Kutunun satırları: şubesi seçilmemiş faturalar tedarikçi tedarikçi (en çok fatura önce), her grubun önerisi. Aynı
 * tedarikçinin faturaları farklı öneri alabilir (tarih kuralı); grup, faturaların önerisine göre ayrılır.
 */
export interface UnassignedGroup {
  supplier: string;
  suggestion: BranchSuggestion | null;
  ids: number[];
  total: number;
}

export function unassignedGroups<I extends { id: number; supplier: string; date: string; amount: number; discount: number }>(
  invoices: readonly I[],
  suggest: (inv: I) => BranchSuggestion | null,
  keyOf: (inv: I) => string,
): UnassignedGroup[] {
  const groups = new Map<string, UnassignedGroup & { latest: string }>();
  for (const inv of invoices) {
    const s = suggest(inv);
    const k = `${keyOf(inv)}|${s ? `${s.value}|${s.kind}` : ""}`;
    const g = groups.get(k) ?? { supplier: inv.supplier, suggestion: s, ids: [], total: 0, latest: inv.date };
    g.ids.push(inv.id);
    g.total += inv.amount - inv.discount;
    if (inv.date > g.latest) g.latest = inv.date;
    groups.set(k, g);
  }
  return [...groups.values()]
    .sort((a, b) => b.ids.length - a.ids.length || b.latest.localeCompare(a.latest) || a.supplier.localeCompare(b.supplier, "tr"))
    .map((g) => ({ supplier: g.supplier, suggestion: g.suggestion, ids: g.ids, total: g.total }));
}

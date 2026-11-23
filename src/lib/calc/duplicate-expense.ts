/**
 * Aynı gider iki kez (saf; motor ve testler kullanır; tests/hesap-uyumu-faz1.test.ts; 23 Kasım 2026): bir ayda sayılan
 * sabit gider kalemiyle aynı adı taşıyan, aynı ayda başka bir yoldan da sayılan gider. Fatura (Gelir-gider'e giren:
 * mal, ya da bir harcama kategorisine bağlı fatura kategorisi; tedarikçinin adı ya da kategorisi), aylık harcama
 * (kategorinin adı ya da açıklama) ya da Gelir-gider'e elle yazılmış hücre (satırın adı). İkisi aynı ödemeyse gider iki
 * kez sayılır; ekran "olabilir" der (Genel bakış ve zil: alerts, Gelir-gider: `fixed:<id>` hücresinde işaret).
 *
 * Ad eşleşmesi (sameExpenseName): Türkçe harfler sadeleşir (büyük/küçük, ı/i, şapka), noktalama boşluğa döner. Sabit
 * giderin adı (ya da parantezsiz hâli, ya da parantez içindeki ad: "İlaçlama (Kılavuz IPM)") öteki adla aynıysa ya da
 * öteki adın içinde tam kelimelerle geçiyorsa (en az 4 harf: "Muhasebe" ↔ "Yıldız Muhasebe Ltd."). Kısa ad uzun adın
 * parçası sayılmaz ("Personel" harcaması "Personel yemeği" kalemini işaretlemez).
 */

/** Eşleşen öteki kayıt */
export interface DuplicateMatch {
  kind: "fatura" | "harcama" | "elle";
  /** Faturada tedarikçi, harcamada kategori (ya da açıklama), elle hücrede satırın adı */
  label: string;
  amount: number;
}

export interface DuplicateExpense {
  fixedId: number;
  fixedName: string;
  matches: DuplicateMatch[];
}

/** Karşılaştırma için sade metin: küçük harf, ı → i, şapkasız, harf ve rakam dışı boşluk */
function foldWords(text: string): string {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Sabit giderin adının karşılaştırılan biçimleri: tam ad, parantezsiz ad, parantez içindeki ad(lar) */
function nameVariants(name: string): string[] {
  const inner = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
  const outer = name.replace(/\([^)]*\)/g, " ");
  return [...new Set([name, outer, ...inner].map(foldWords).filter((v) => v.length > 0))];
}

/** `fixedName` (sabit gider) ile `other` aynı gideri mi anlatıyor */
export function sameExpenseName(fixedName: string, other: string): boolean {
  const o = foldWords(other);
  if (!o) return false;
  return nameVariants(fixedName).some((v) => v === o || (v.length >= 4 && ` ${o} `.includes(` ${v} `)));
}

/** Şube uyumu: biri işletme geneliyse (boş) ya da şubeler aynıysa aynı yerin gideri olabilir */
const sameBranch = (a: string | null | undefined, b: string | null | undefined) => a == null || b == null || a === b;

/**
 * Ayın sabit giderleri (bu ay sayılan tutarıyla; 0 ya da boşsa atlanır) ile aynı ayın faturaları, harcamaları ve elle
 * hücreleri. Faturanın ve elle hücrenin şubesi yoktur (işletme geneli); harcamanınki varsa sabit giderinkiyle uyuşmalı
 */
export function duplicateExpenses(input: {
  fixed: readonly { id: number; name: string; amount: number; branchId?: string | null }[];
  invoices: readonly { supplier: string; category: string; amount: number }[];
  expenses: readonly { label: string; description?: string | null; amount: number; branchId?: string | null }[];
  manual: readonly { label: string; amount: number }[];
}): DuplicateExpense[] {
  const out: DuplicateExpense[] = [];
  for (const f of input.fixed) {
    if (!(Math.abs(f.amount) > 0.005)) continue;
    const matches: DuplicateMatch[] = [];
    for (const inv of input.invoices) {
      if (!(Math.abs(inv.amount) > 0.005)) continue;
      if (sameExpenseName(f.name, inv.supplier) || sameExpenseName(f.name, inv.category)) matches.push({ kind: "fatura", label: inv.supplier, amount: inv.amount });
    }
    for (const e of input.expenses) {
      if (!(Math.abs(e.amount) > 0.005) || !sameBranch(f.branchId, e.branchId)) continue;
      if (sameExpenseName(f.name, e.label) || (e.description && sameExpenseName(f.name, e.description))) matches.push({ kind: "harcama", label: e.label, amount: e.amount });
    }
    for (const m of input.manual) {
      if (!(Math.abs(m.amount) > 0.005)) continue;
      if (sameExpenseName(f.name, m.label)) matches.push({ kind: "elle", label: m.label, amount: m.amount });
    }
    if (matches.length) out.push({ fixedId: f.id, fixedName: f.name, matches });
  }
  return out;
}

/** Türü okunur: "harcama", "fatura", "Gelir-gider'e elle yazılan" */
export const DUPLICATE_KIND_TEXT: Record<DuplicateMatch["kind"], string> = { fatura: "fatura", harcama: "harcama", elle: "Gelir-gider'e elle yazılan tutar" };

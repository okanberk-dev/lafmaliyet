/**
 * Aynı gider iki kez (saf; motor ve testler kullanır; tests/hesap-uyumu-faz1.test.ts; 23 Kasım 2026): bir ayda sayılan
 * sabit gider kalemiyle aynı adı taşıyan, aynı ayda başka bir yoldan da sayılan gider. Fatura (Gelir-gider'e giren:
 * mal, komisyon ya da bir harcama kategorisine bağlı fatura kategorisi; tedarikçinin adı ya da kategorisi), aylık
 * harcama (kategorinin adı ya da açıklama) ya da Gelir-gider'e elle yazılmış hücre (satırın adı ya da anahtarı:
 * "manual:dogalgaz"). İkisi aynı ödemeyse gider iki kez sayılır; ekran "olabilir" der (Genel bakış, zil, Tutarlılık:
 * alerts; Gelir-gider: `fixed:<id>` hücresinde işaret, engine.ts pnlMonth). Tutar değişmez, yalnız uyarılır.
 *
 * Ad eşleşmesi (sameExpenseName): Türkçe harfler sadeleşir (büyük/küçük, ı/i, şapka), noktalama boşluğa döner. Sabit
 * giderin adı (ya da parantezsiz hâli, ya da parantez içindeki ad: "İlaçlama (Kılavuz IPM)") öteki adla aynıysa ya da
 * öteki adın içinde tam kelimelerle geçiyorsa (en az 4 harf: "Muhasebe" ↔ "Yıldız Muhasebe Ltd."). Kısa ad uzun adın
 * parçası sayılmaz ("Personel" harcaması "Personel yemeği" kalemini işaretlemez).
 */

import { MONTH_NAMES } from "../constants";
import { money } from "../format";

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

/** Sadeleşmiş biçimler (sabit giderin nameVariants'ı) sadeleşmiş öteki adla aynı ya da onun içinde tam kelimelerle */
const variantsMatch = (variants: readonly string[], o: string) => o.length > 0 && variants.some((v) => v === o || (v.length >= 4 && ` ${o} `.includes(` ${v} `)));

/** `fixedName` (sabit gider) ile `other` aynı gideri mi anlatıyor */
export function sameExpenseName(fixedName: string, other: string): boolean {
  return variantsMatch(nameVariants(fixedName), foldWords(other));
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
  /** `key`: satırın anahtarı ("manual:su"); adı kısa satır ("Su") anahtarıyla da tanınır ("SU GİDERİ") */
  manual: readonly { label: string; amount: number; key?: string }[];
}): DuplicateExpense[] {
  const counted = (amount: number) => Math.abs(amount) > 0.005;
  // Adlar bir kez sadeleşir (Gelir-gider her ay için çağırır)
  const others: { match: DuplicateMatch; names: string[]; branchId?: string | null }[] = [
    ...input.invoices.filter((i) => counted(i.amount)).map((i) => ({ match: { kind: "fatura" as const, label: i.supplier, amount: i.amount }, names: [i.supplier, i.category] })),
    ...input.expenses
      .filter((e) => counted(e.amount))
      .map((e) => ({ match: { kind: "harcama" as const, label: e.label, amount: e.amount }, names: [e.label, e.description ?? ""], branchId: e.branchId })),
    ...input.manual.filter((m) => counted(m.amount)).map((m) => ({ match: { kind: "elle" as const, label: m.label, amount: m.amount }, names: [m.label, m.key ? keyWords(m.key) : ""] })),
  ].map((o) => ({ ...o, names: o.names.map(foldWords).filter((n) => n.length > 0) }));
  const out: DuplicateExpense[] = [];
  for (const f of input.fixed) {
    if (!counted(f.amount)) continue;
    const variants = nameVariants(f.name);
    // Faturanın ve elle hücrenin şubesi yok (işletme geneli); harcamanınki sabit giderinkiyle uyuşmalı
    const matches = others.filter((o) => sameBranch(f.branchId, o.branchId) && o.names.some((n) => variantsMatch(variants, n))).map((o) => o.match);
    if (matches.length) out.push({ fixedId: f.id, fixedName: f.name, matches });
  }
  return out;
}

/** Elle satırın anahtarının kelimeleri: "manual:dogalgaz" → "dogalgaz", "manual:ciro_kirasi" → "ciro kirasi" */
const keyWords = (key: string) => key.replace(/^[a-z]+:/, "").replace(/_/g, " ");

/** Türü okunur: "harcama", "fatura", "Gelir-gider'e elle yazılan tutar" */
export const DUPLICATE_KIND_TEXT: Record<DuplicateMatch["kind"], string> = { fatura: "fatura", harcama: "harcama", elle: "Gelir-gider'e elle yazılan tutar" };

/** Uyarının başlığı (Genel bakış, zil, Tutarlılık; zil kimliği başlıktan) */
export const DUPLICATE_ALERT_TITLE = "Aynı gider iki kez sayılıyor olabilir";

/** Hücredeki eşleşme: "harcama olarak da girildi (Muhasebe)", "faturası da var (Yıldız Muhasebe)" */
const CELL_PART: Record<DuplicateMatch["kind"], (label: string) => string> = {
  harcama: (l) => `harcama olarak da girildi (${l})`,
  fatura: (l) => `faturası da var (${l})`,
  elle: (l) => `Gelir-gider'e elle de yazıldı (${l})`,
};

/** Aynı türden aynı adı bir kez: üç Muhasebe harcaması "harcama olarak da girildi (Muhasebe)" */
function uniqueMatches(d: DuplicateExpense): DuplicateMatch[] {
  const seen = new Map<string, DuplicateMatch>();
  for (const m of d.matches) {
    const k = `${m.kind}|${m.label}`;
    const cur = seen.get(k);
    seen.set(k, cur ? { ...cur, amount: Math.round((cur.amount + m.amount) * 100) / 100 } : m);
  }
  return [...seen.values()];
}

/**
 * `fixed:<id>` hücresinin işareti (PnlCell.warn): "Bu ay harcama olarak da girildi (Muhasebe): iki kez sayılıyor
 * olabilir. İkisi aynı ödemeyse birini silin ya da bu hücreye 0 yazın."
 */
export function duplicateCellWarn(d: DuplicateExpense): string {
  const parts = uniqueMatches(d).map((m) => CELL_PART[m.kind](m.label));
  return `Bu ay ${parts.join(", ")}: iki kez sayılıyor olabilir. İkisi aynı ödemeyse birini silin ya da bu hücreye 0 yazın.`;
}

/**
 * Uyarının metni (alerts): "Muhasebe: sabit gider ve Kasım ayında harcama (Muhasebe, 5.000 ₺). İkisi aynı ödemeyse
 * birini silin ya da sabit gidere bu ay 0 yazın." En çok üç kalem, fazlası "ve N kalem daha"
 */
export function duplicateAlertDetail(list: readonly DuplicateExpense[], month: string): string {
  const ay = MONTH_NAMES[Number(month.slice(5, 7)) - 1];
  const items = list.slice(0, 3).map((d) => `${d.fixedName}: sabit gider ve ${ay} ayında ${uniqueMatches(d).map((m) => `${DUPLICATE_KIND_TEXT[m.kind]} (${m.label}, ${money(m.amount)})`).join(", ")}`);
  const more = list.length > 3 ? ` ve ${list.length - 3} kalem daha` : "";
  return `${items.join("; ")}${more}. İkisi aynı ödemeyse birini silin ya da sabit gidere bu ay 0 yazın.`;
}

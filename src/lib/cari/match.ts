/**
 * Cari kayıtlarının eşleşmeleri (saf; tests/cari-eslesme.test.ts): faturasız alımın sonradan gelen faturası (güçlü ve
 * zayıf aday), Kasa'daki aynı tedarikçinin satırları, Aylık harcamalar'daki benzer kayıt ve borcun varsayılan gideri.
 * Hiçbiri kendiliğinden bağ kurmaz: bağ her zaman bilinçli bir tıklamadır (docs/TEDARIKCILER.md "Hesap hareketleri").
 */
import { supplierMatchKey } from "../../app/panel/faturalar/rules";
import { COMMISSION_CATEGORY, SEPARATE_CATEGORIES } from "../constants";
import { addDays, daysBetween } from "../reminders";
import { round2 } from "./balance";
import type { CariDebt, CostMode } from "./account";

// ---------------------------------------------------------------- Fatura adayları (K17)

/** Pencere: fatura, borcun gününden en çok bu kadar gün önce ya da sonra tarihli olabilir */
export const LINK_WINDOW = { before: 7, after: 45 } as const;

export interface CandidateInvoice {
  id: number;
  date: string;
  payable: number;
  category: string;
}

export interface LinkCandidate {
  invoiceId: number;
  debtIds: number[];
  /** Fatura − borçların toplamı */
  diff: number;
}

/** Güçlü adayın toleransı: max(1 ₺, Ödenecek'in %2'si) */
export const linkTolerance = (payable: number) => Math.max(1, 0.02 * payable);

const inWindow = (debtDate: string, invoiceDate: string) => invoiceDate >= addDays(debtDate, -LINK_WINDOW.before) && invoiceDate <= addDays(debtDate, LINK_WINDOW.after);

/**
 * Faturası gelmiş olabilecek faturasız alımlar. Faturalar: Ödenecek > 0, komisyon ve kafe dışı (karaoke box, Alp Koç)
 * değil, henüz bir borç bağlanmamış. Borçlar: bağsız, gideri "fatura", "gider" ya da "mevcut". Pencere: fatura borcun
 * gününden 7 gün önce ile 45 gün sonra arasında; "Ayrı alım" denmiş çift atlanır.
 * - Güçlü (a): tek borç, |A − P| ≤ max(1, %2·P)
 * - Güçlü (b): penceredeki en az iki borcun toplamı aynı toleransla (alt küme aranmaz, hepsi alınır)
 * - Zayıf: pencerede bağsız bir "Faturası gelecek" borcu var ama güçlü kural tutmuyor
 */
export function linkCandidates(debts: readonly CariDebt[], invoices: readonly CandidateInvoice[]): { strong: LinkCandidate[]; weak: LinkCandidate[] } {
  const linked = new Set(debts.map((d) => d.invoiceId).filter((x): x is number => x !== null));
  const open = debts.filter((d) => d.invoiceId === null && (d.costMode === "fatura" || d.costMode === "gider" || d.costMode === "mevcut"));
  const strong: LinkCandidate[] = [];
  const weak: LinkCandidate[] = [];
  for (const inv of invoices) {
    if (!(inv.payable > 0) || inv.category === COMMISSION_CATEGORY || SEPARATE_CATEGORIES.includes(inv.category) || linked.has(inv.id)) continue;
    const window = open.filter((d) => inWindow(d.date, inv.date) && !(d.dismissedInvoiceIds ?? []).includes(inv.id)).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    if (!window.length) continue;
    const tol = linkTolerance(inv.payable);
    const singles = window.filter((d) => Math.abs(d.amount - inv.payable) <= tol);
    for (const d of singles) strong.push({ invoiceId: inv.id, debtIds: [d.id], diff: round2(inv.payable - d.amount) });
    if (singles.length) continue;
    const total = window.reduce((a, d) => a + d.amount, 0);
    if (window.length >= 2 && Math.abs(total - inv.payable) <= tol) {
      strong.push({ invoiceId: inv.id, debtIds: window.map((d) => d.id), diff: round2(inv.payable - total) });
      continue;
    }
    const expected = window.filter((d) => d.costMode === "fatura");
    if (expected.length) weak.push({ invoiceId: inv.id, debtIds: expected.map((d) => d.id), diff: round2(inv.payable - expected.reduce((a, d) => a + d.amount, 0)) });
  }
  return { strong, weak };
}

// ---------------------------------------------------------------- Kasa satırları (K15, K16)

export interface KasaLine {
  id: number;
  date: string;
  kind: "harcama" | "teslim";
  store: string | null;
  docType: "fis" | "e_arsiv" | "fatura" | "yok";
  amount: number;
}

/**
 * Tedarikçinin adlarıyla eşleşen işlenmemiş Kasa satırları (Kime / Yer alanı, `supplierMatchKey`). İşlenmemiş: bir
 * cari ödemeye bağlı değil ve "Ayrı tut" denmemiş (`handled`). Tutara bakılmaz (900 ile 905 aynı alım olabilir).
 * - `kinds`: Teslim ve / veya Alışveriş
 * - `receiptless`: Alışveriş yalnız fişsizse (belge "yok")
 * - `harcamaDays`: Alışveriş yalnız bu günlerde (grubun o gün açık kalemi varken)
 */
export function kasaMatches<L extends KasaLine>(
  lines: readonly L[],
  opts: {
    keys: Iterable<string>;
    handled: ReadonlySet<number>;
    from: string;
    to: string;
    kinds: readonly KasaLine["kind"][];
    receiptless?: boolean;
    harcamaDays?: ReadonlySet<string>;
  },
): L[] {
  const keys = new Set(opts.keys);
  return lines
    .filter((l) => {
      if (opts.handled.has(l.id) || l.date < opts.from || l.date > opts.to || !opts.kinds.includes(l.kind)) return false;
      if (!l.store || !keys.has(supplierMatchKey(l.store))) return false;
      if (l.kind === "harcama") {
        if (opts.receiptless && l.docType !== "yok") return false;
        if (opts.harcamaDays && !opts.harcamaDays.has(l.date)) return false;
      }
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

/** Borç ekle'nin Kasa denetimi: alım gününün ±3 günü */
export const KASA_DEBT_DAYS = 3;
/** Kalem ipucu, liste şeridi ve zil: son 60 gün */
export const KASA_LOOKBACK_DAYS = 60;

// ---------------------------------------------------------------- Aylık harcamalar'daki kayıtlar (§3.1.3, §3.1.6)

export interface ExpenseLite {
  id: number;
  date: string;
  amount: number;
  categoryId: number;
  description: string | null;
  supplierEntryId: number | null;
  cashOutId: number | null;
}

/**
 * Kopya uyarısı ("Faturası yok · gider yaz" seçiliyken): mal bölümündeki bir kategoride ±3 gün ve ±1 ₺ içindeki,
 * sahibi olmayan kayıtlar
 */
export function expenseDuplicates<E extends ExpenseLite>(entries: readonly E[], debt: { date: string; amount: number }, goodsCategoryIds: ReadonlySet<number>): E[] {
  return entries
    .filter((e) => goodsCategoryIds.has(e.categoryId) && e.supplierEntryId === null && Math.abs(daysBetween(debt.date, e.date)) <= 3 && Math.abs(e.amount - debt.amount) <= 1)
    .sort((a, b) => Math.abs(a.amount - debt.amount) - Math.abs(b.amount - debt.amount) || a.id - b.id);
}

/**
 * "Gideri zaten girildi" adayları: alım gününün ±31 günü, başka bir borcun değil, Kasa'dan yazılmamış (o peşin
 * alımdır). Mal bölümündeki kategoriler önce, sonra tutar farkı en küçük olan.
 */
export function adoptCandidates<E extends ExpenseLite>(entries: readonly E[], debt: { date: string; amount: number }, goodsCategoryIds: ReadonlySet<number>, ownEntryId: number | null = null): E[] {
  return entries
    .filter((e) => (e.supplierEntryId === null || e.supplierEntryId === ownEntryId) && e.cashOutId === null && Math.abs(daysBetween(debt.date, e.date)) <= 31)
    .sort(
      (a, b) =>
        Number(goodsCategoryIds.has(b.categoryId)) - Number(goodsCategoryIds.has(a.categoryId)) ||
        Math.abs(a.amount - debt.amount) - Math.abs(b.amount - debt.amount) ||
        a.id - b.id,
    );
}

// ---------------------------------------------------------------- Varsayılan gider (K8)

/** Son bu kadar günde Paraşüt'ten faturası gelmiş tedarikçi fatura kesiyor sayılır */
export const PARASUT_RECENT_DAYS = 90;

/** Borç ekle'nin varsayılanı: son 90 günde Paraşüt'ten faturası gelmişse "Faturası gelecek", değilse "Faturası yok · gider yaz" */
export function defaultCostMode(invoices: readonly { origin?: string | null; date: string }[], today: string): CostMode {
  const since = addDays(today, -PARASUT_RECENT_DAYS);
  return invoices.some((i) => i.origin === "parasut" && i.date >= since && i.date <= today) ? "fatura" : "gider";
}

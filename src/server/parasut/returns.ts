/**
 * Panele gider olarak girmeyen iadeler (docs/PARASUT.md §2a). Saf modül: eşitleme (sync.ts) listeyi yazar, Paraşüt
 * sayfası gösterir; tests/parasut-iade.test.ts.
 *
 * - **Satış iadesi:** kafenin (ya da sitenin, laffogato.net e-Arşiv / e-Fatura) sattığı malın iadesi. Paraşüt satış
 *   faturasına karşı kesilen iadeyi Giderler'e yazar, şirket müşterisinin iadesi gelen iade e-faturası olarak gelir.
 *   Gider sayılmaz: online satış zaten iadesi düşülmüş gelir, iade bir de gider olsaydı iki kez sayılırdı. Müşterinin
 *   adı saklanmaz (site panele yalnız ilk adı verir; KVKK).
 * - **Tedarikçiye iade:** kafenin tedarikçiye iadesi (giden iade e-faturası). Paraşüt bunu satış faturası olarak tutar,
 *   panel satış faturalarını okumaz: tutar panele girmez. Paraşüt sayfası listeler; Faturalar'a aynı tedarikçiye eksi
 *   tutarlı fatura girilince (±31 gün, tutar ±1 ₺) listeden düşer.
 */

import { sameSupplier } from "./mapping";

export interface ReturnEntry {
  /** Gider faturası ya da e-fatura kimliği ("ei:<kimlik>") */
  id: string;
  date: string;
  /** KDV dahil, artı */
  amount: number;
  invoiceNo: string | null;
  /** Yalnız tedarikçiye iadede: tedarikçinin adı ve vergi nosu */
  supplier?: string;
  taxNumber?: string | null;
  /** İlk görüldüğü an (ISO) */
  seenAt: string;
}

export interface ReturnLog {
  sales: ReturnEntry[];
  supplier: ReturnEntry[];
}

/** integration_state anahtarı */
export const RETURNS_KEY = "parasut.returns";
/** Bundan eski iade listeden düşer */
export const RETURN_KEEP_DAYS = 120;
/** Türüne göre en çok bu kadar iade saklanır */
export const RETURN_KEEP = 60;

const isEntry = (e: unknown): e is ReturnEntry => {
  const x = e as Partial<ReturnEntry> | null;
  return Boolean(x) && typeof x!.id === "string" && typeof x!.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x!.date) && typeof x!.amount === "number" && Number.isFinite(x!.amount);
};

/** Saklanan liste; bozuk kayıt atlanır */
export function parseReturnLog(v: unknown): ReturnLog {
  const o = (v && typeof v === "object" ? v : {}) as Partial<Record<keyof ReturnLog, unknown>>;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter(isEntry) : []);
  return { sales: list(o.sales), supplier: list(o.supplier) };
}

/**
 * Bu çalışmada görülen iadeler saklanan listeye katılır: ilk görülme anı korunur, `cutoff`tan (YYYY-MM-DD) eskiler ve
 * fazlası düşer, en yeni önce. `fresh`: ilk kez görülenlerin sayısı (eşitleme özeti yalnız yenileri söyler)
 */
export function mergeReturns(
  stored: ReturnLog,
  seen: Record<keyof ReturnLog, Iterable<Omit<ReturnEntry, "seenAt">>>,
  opts: { now: string; cutoff: string },
): { log: ReturnLog; fresh: Record<keyof ReturnLog, number> } {
  const fresh = { sales: 0, supplier: 0 };
  const log: ReturnLog = { sales: [], supplier: [] };
  for (const kind of ["sales", "supplier"] as const) {
    const byId = new Map(stored[kind].map((e) => [e.id, e]));
    for (const e of seen[kind]) {
      const old = byId.get(e.id);
      if (!old) fresh[kind]++;
      byId.set(e.id, { ...e, seenAt: old?.seenAt ?? opts.now });
    }
    log[kind] = [...byId.values()]
      .filter((e) => e.date >= opts.cutoff)
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
      .slice(0, RETURN_KEEP);
  }
  return { log, fresh };
}

const dayDiff = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * Tedarikçiye iade panele elle girilmiş mi: aynı tedarikçinin (ad ya da vergi no) eksi tutarlı faturası, ±31 gün,
 * tutar ±1 ₺. Girilmişse Paraşüt sayfası onu artık göstermez.
 */
export function supplierReturnEntered(
  r: Pick<ReturnEntry, "date" | "amount" | "supplier" | "taxNumber">,
  invoices: readonly { date: string; supplier: string; payable: number; supplierTaxNumber: string | null }[],
): boolean {
  return invoices.some(
    (i) =>
      i.payable < 0 &&
      Math.abs(Math.abs(i.payable) - r.amount) <= 1 &&
      dayDiff(i.date, r.date) <= 31 &&
      ((r.taxNumber && i.supplierTaxNumber === r.taxNumber) || (r.supplier ? sameSupplier(i.supplier, r.supplier) : false)),
  );
}

/**
 * Eski faturaların tedarikçi vergi nosunu Paraşüt'ten tamamlayan turun saf kısmı: sayfalama, durma kuralları ve hangi
 * numaranın hangi kayda yazılacağı. Veritabanı ve Paraşüt istemcisi dışarıdan verilir (tax-backfill.ts); saf modül,
 * tests/parasut-vergi.test.ts sahte istemciyle sınar.
 *
 * Sıra: önce gider faturaları (kişi kartının `tax_number`'ı ya da gelen e-belgenin `from_vkn`'i), sonra gelen
 * e-faturalar (`from_vkn`; içeri alınmış e-faturanın gider faturası kaydı da). Her tarama en yeni faturadan geriye
 * iner; boş kayıtların en eskisinden daha eski bir faturaya, boş ya da son sayfaya gelince biter. Süre dolarsa
 * kaldığı sayfa saklanır, sonraki eşitleme oradan sürer.
 */
import { cleanTaxNumber } from "@/app/panel/tedarikciler/logic";

import { eInvoiceToDraft, type EInvoiceAttrs } from "./einvoice";
import type { ListResponse, Resource } from "./jsonapi";
import { billToDraft } from "./mapping";

/** Bir çalışmada bir taramada okunabilecek en fazla sayfa (süre zaten önce biter) */
const MAX_PAGES = 200;

interface Cursor {
  /** Sonraki çalışmanın okuyacağı sayfa */
  page: number;
  done: boolean;
}

/** Tamamlamanın kaldığı yer (integration_state › parasut.taxBackfill) */
export interface TaxBackfillState {
  bills: Cursor;
  eInvoices: Cursor;
  /** Şimdiye kadar numarası yazılan fatura */
  filled: number;
  /** İki tarama da bitti: bir daha çalışmaz (yeni faturalar numarasıyla açılır) */
  finishedAt?: string;
}

const cursor = (raw: unknown): Cursor => {
  const c = (raw ?? {}) as Partial<Cursor>;
  const page = Number.isInteger(c.page) && (c.page as number) > 0 ? (c.page as number) : 1;
  return { page, done: c.done === true };
};

/** Saklanan durum; yoksa ya da bozuksa baştan */
export function parseTaxBackfillState(raw: unknown): TaxBackfillState {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof TaxBackfillState, unknown>>;
  return {
    bills: cursor(v.bills),
    eInvoices: cursor(v.eInvoices),
    filled: typeof v.filled === "number" && v.filled >= 0 ? v.filled : 0,
    ...(typeof v.finishedAt === "string" ? { finishedAt: v.finishedAt } : {}),
  };
}

/** Vergi nosu boş Paraşüt faturaları */
export interface MissingTaxRows {
  /** Paraşüt gider faturası kimliği → fatura kaydı */
  byExternalId: Map<string, number>;
  /** E-fatura kimliği → fatura kaydı */
  byEInvoiceId: Map<string, number>;
  /** Gider faturası bağlı en eski boş kaydın tarihi: gider faturası taraması bundan eskiye inmez */
  billsOldest: string | null;
  /** En eski boş kaydın tarihi (içeri alınmış e-faturanın kaydı da gider faturasıdır) */
  oldest: string | null;
}

export function missingTaxRows(rows: readonly { id: number; externalId: string | null; eInvoiceId: string | null; date: string }[]): MissingTaxRows {
  const out: MissingTaxRows = { byExternalId: new Map(), byEInvoiceId: new Map(), billsOldest: null, oldest: null };
  for (const r of rows) {
    if (r.externalId) {
      out.byExternalId.set(r.externalId, r.id);
      if (!out.billsOldest || r.date < out.billsOldest) out.billsOldest = r.date;
    }
    if (r.eInvoiceId) out.byEInvoiceId.set(r.eInvoiceId, r.id);
    if ((r.externalId || r.eInvoiceId) && (!out.oldest || r.date < out.oldest)) out.oldest = r.date;
  }
  return out;
}

/** Sayfalı Paraşüt listesi (ParasutClient.pages; testte sahte) */
export type PageSource = (path: string, query: Record<string, string>, maxPages: number, startPage: number) => AsyncIterable<ListResponse & { page: number }>;

export interface PassDeps {
  pages: PageSource;
  /** Numarayı kayıt hâlâ boşsa yazar; yazdıysa true (bu arada başka bir yazma doldurduysa false) */
  fill: (invoiceId: number, taxNumber: string) => Promise<boolean>;
  /** Hatanın türü: süre doldu (bırak, kaldığı yerden sürer), istek reddedildi (bu tarama biter), başka (yukarı atılır) */
  errorKind: (e: unknown) => "deadline" | "rejected" | "other";
  now?: () => number;
  log?: (message: string, e: unknown) => void;
}

/**
 * Bir tamamlama turu: `state` yerinde ilerler (sayfa, bitti, yazılan sayısı), `until` (epoch ms) geçilince bırakılır.
 * Yazılan kayıt `missing`ten çıkar.
 */
export async function runTaxBackfillPass(state: TaxBackfillState, missing: MissingTaxRows, deps: PassDeps, until: number): Promise<void> {
  const now = deps.now ?? Date.now;
  const forget = (id: number) => {
    for (const map of [missing.byExternalId, missing.byEInvoiceId]) for (const [k, v] of map) if (v === id) map.delete(k);
  };
  const fill = async (id: number | undefined, raw: string | null | undefined) => {
    const t = cleanTaxNumber(raw);
    if (id === undefined || !t) return;
    if (await deps.fill(id, t)) state.filled++;
    forget(id);
  };

  /** Bir listeyi kaldığı sayfadan geriye tarar; `onPage` sayfadaki faturaların tarihlerini döner */
  const scan = async (label: string, path: string, query: Record<string, string>, c: Cursor, oldest: string | null, onPage: (res: ListResponse) => Promise<string[]>) => {
    if (c.done) return;
    if (!oldest) {
      c.done = true;
      return;
    }
    if (now() > until) return;
    try {
      for await (const res of deps.pages(path, query, MAX_PAGES, c.page)) {
        const dates = (await onPage(res)).filter(Boolean);
        c.page = res.page + 1;
        const total = res.meta?.total_pages;
        if (!res.data.length || (total !== undefined && res.page >= total) || dates.some((d) => d < oldest)) {
          c.done = true;
          return;
        }
        if (now() > until) return;
      }
    } catch (e) {
      const kind = deps.errorKind(e);
      if (kind === "deadline") return;
      if (kind === "rejected") {
        // İstek (ör. include) kabul edilmedi: bu tarama bırakılır, öteki yine çalışır
        c.done = true;
        deps.log?.(`Paraşüt vergi no tamamlama: ${label} okunamadı`, e);
        return;
      }
      throw e;
    }
  };

  await scan("gider faturaları", "purchase_bills", { sort: "-issue_date", include: "supplier,active_e_document" }, state.bills, missing.byExternalId.size ? missing.billsOldest : null, async (res) => {
    const dates: string[] = [];
    for (const bill of res.data) {
      const d = billToDraft(bill, res.included);
      dates.push(d.date);
      // Gelen e-belgedeki numara (imzalı) önce, yoksa kişi kartındaki
      await fill(missing.byExternalId.get(bill.id), d.eDocumentTaxNo ?? d.supplierTaxNo);
    }
    return dates;
  });

  // E-faturalar gider faturalarından sonra: içeri alınmış e-faturanın gider faturası kaydı kişi kartında numara
  // yoksa da buradan dolar. Yalnız gelen e-faturalar (aynı Paraşüt şirketinde giden faturalar da var)
  if (!state.bills.done) return;
  await scan("e-faturalar", "e_invoices", { include: "invoice", sort: "-issue_date" }, state.eInvoices, missing.byExternalId.size || missing.byEInvoiceId.size ? missing.oldest : null, async (res) => {
    const dates: string[] = [];
    for (const r of res.data) {
      const d = eInvoiceToDraft(r as Resource<EInvoiceAttrs>);
      dates.push(d.date);
      if (!d.inbound) continue;
      const ids = new Set([missing.byEInvoiceId.get(r.id), d.importedBillId ? missing.byExternalId.get(d.importedBillId) : undefined]);
      for (const id of ids) await fill(id, d.supplierTaxNo);
    }
    return dates;
  });
}

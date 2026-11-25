import "server-only";

import { and, eq, isNotNull, isNull, or } from "drizzle-orm";

import { parasutKey } from "@/lib/parasut/accounts";
import { getDb, schema as s } from "@/server/db";

import { invoiceAccountWhere } from "./accounts";
import { TAX_BACKFILL_KEY } from "./keys";
import { ParasutAuthError, ParasutDeadlineError, ParasutError, type ParasutClient } from "./client";
import { missingTaxRows, parseTaxBackfillState, runTaxBackfillPass, type TaxBackfillState } from "./tax-backfill-pass";

/**
 * Tedarikçi vergi nosunun eski faturalara bir kerelik tamamlanması. Yeni ve son 75 günün faturaları numarasını
 * eşitlemede alır (sync.ts applyDraft / applyEInvoice); daha eskiler bununla dolar. Her eşitlemenin artan süresinde
 * kaldığı sayfadan sürer, bitince bir daha çalışmaz. "Oturumu sıfırla" ve db:reset durumu siler: baştan başlar.
 * Kurallar ve sayfalama tax-backfill-pass.ts'te. Hesap başına (şube başına Paraşüt hesabı): durum hesap adıyla, yalnız
 * o hesabın faturaları
 */
export { TAX_BACKFILL_KEY };

async function saveState(account: string, state: TaxBackfillState) {
  await getDb()
    .insert(s.integrationState)
    .values({ key: parasutKey(TAX_BACKFILL_KEY, account), value: state })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value: state, updatedAt: new Date() } });
}

/** Bir tur: `until` (epoch ms) geçilince bırakır. `filled` bu turda yazılan, `done` tamamlama bitti */
export async function backfillSupplierTaxNumbers(client: ParasutClient, opts: { until: number }): Promise<{ filled: number; done: boolean }> {
  const db = getDb();
  const account = client.account;
  const [row] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, parasutKey(TAX_BACKFILL_KEY, account))).limit(1);
  const state = parseTaxBackfillState(row?.value);
  if (state.finishedAt) return { filled: 0, done: true };
  const rows = await db
    .select({ id: s.invoices.id, externalId: s.invoices.externalId, eInvoiceId: s.invoices.eInvoiceId, date: s.invoices.date })
    .from(s.invoices)
    .where(and(isNull(s.invoices.supplierTaxNumber), or(isNotNull(s.invoices.externalId), isNotNull(s.invoices.eInvoiceId)), invoiceAccountWhere(account)));
  const before = state.filled;
  try {
    if (rows.length) {
      await runTaxBackfillPass(
        state,
        missingTaxRows(rows),
        {
          pages: (path, query, maxPages, startPage) => client.pages<Record<string, unknown>>(path, query, maxPages, startPage),
          // Yalnız hâlâ boşsa: bu arada elle ya da başka bir yolla yazılmış numara ezilmez
          fill: async (id, taxNumber) =>
            (
              await db
                .update(s.invoices)
                .set({ supplierTaxNumber: taxNumber })
                .where(and(eq(s.invoices.id, id), isNull(s.invoices.supplierTaxNumber)))
                .returning({ id: s.invoices.id })
            ).length > 0,
          errorKind: (e) =>
            e instanceof ParasutDeadlineError
              ? "deadline"
              : e instanceof ParasutError && !(e instanceof ParasutAuthError) && (e.status === 400 || e.status === 422)
                ? "rejected"
                : "other",
          log: (message, e) => console.error(message, e),
        },
        opts.until,
      );
    }
  } finally {
    // Boş kayıt kalmadıysa ya da iki tarama da bittiyse tamamlama biter; hata olsa da kalınan sayfa saklanır
    if (!rows.length || (state.bills.done && state.eInvoices.done)) state.finishedAt = new Date().toISOString();
    await saveState(account, state);
  }
  return { filled: state.filled - before, done: Boolean(state.finishedAt) };
}

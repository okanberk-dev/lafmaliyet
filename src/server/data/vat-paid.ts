import "server-only";

import { eq } from "drizzle-orm";

import { addVatPaid, parseVatPaid, removeVatPaid, type VatPaidEntry } from "@/lib/vat-paid";
import { getDb, schema as s } from "@/server/db";

/** integration_state anahtarı: KDV ve KDV-2 hatırlatıcılarının kalıcı "Ödendi" kaydı (src/lib/vat-paid.ts) */
export const VAT_PAID_KEY = "payments.vat-paid";

/** Listeyi kilitleyip değiştirir; değişmediyse yazmaz. Yardımcı bir kayıttır: yazılamazsa asıl işlem bozulmaz. */
async function update(change: (list: VatPaidEntry[]) => VatPaidEntry[]) {
  try {
    await getDb().transaction(async (tx) => {
      const [row] = await tx.select().from(s.integrationState).where(eq(s.integrationState.key, VAT_PAID_KEY)).for("update");
      const before = parseVatPaid(row?.value);
      const value = change(before);
      if (row && JSON.stringify(value) === JSON.stringify(before)) return;
      await tx
        .insert(s.integrationState)
        .values({ key: VAT_PAID_KEY, value })
        .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
    });
  } catch (e) {
    console.error("vat paid", e);
  }
}

export async function rememberVatPaid(entry: Omit<VatPaidEntry, "at">) {
  const at = new Date().toISOString();
  await update((list) => addVatPaid(list, { ...entry, at }, at));
}

/** "Geri al": hatırlatıcı `fromDue` gününe döndü */
export async function forgetVatPaid(id: number, fromDue: string) {
  await update((list) => removeVatPaid(list, id, fromDue));
}

export async function loadVatPaid(): Promise<VatPaidEntry[]> {
  const [row] = await getDb().select().from(s.integrationState).where(eq(s.integrationState.key, VAT_PAID_KEY)).limit(1);
  return parseVatPaid(row?.value);
}

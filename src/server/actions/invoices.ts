"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { INVOICE_CATEGORIES } from "@/lib/constants";
import { dateTR, tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, zDate, zOptText, zText } from "./util";

const invoiceSchema = z.object({
  id: z.number().int().positive().nullable(),
  date: zDate,
  supplier: zText("Tedarikçi", 120),
  description: zOptText(200),
  invoiceNo: zOptText(60),
  category: z.enum(INVOICE_CATEGORIES as [string, ...string[]], { message: "Kategori seçin" }),
  amount: z.number().finite(),
  discount: z.number().finite().min(0),
  payable: z.number().finite(),
  unpaid: z.boolean(),
  note: zOptText(1000),
});

export async function saveInvoice(input: z.input<typeof invoiceSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id, ...data } = invoiceSchema.parse(input);
    const db = getDb();
    if (id) await db.update(s.invoices).set(data).where(eq(s.invoices.id, id));
    else await db.insert(s.invoices).values(data);
    await logActivity(me, id ? "Fatura düzenlendi" : "Fatura eklendi", `${dateTR(data.date)} ${data.supplier}: ${tl(data.amount - data.discount, 2)} (KDV hariç)`);
    refresh();
    return null;
  });
}

export async function deleteInvoice(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const [d] = await getDb().delete(s.invoices).where(eq(s.invoices.id, id)).returning();
    if (d) await logActivity(me, "Fatura silindi", `${dateTR(d.date)} ${d.supplier} ${d.invoiceNo ?? ""}`);
    refresh();
    return null;
  });
}

export async function setInvoicePaid(id: number, paid: boolean) {
  return attempt(async () => {
    const me = await requireAdmin();
    const [d] = await getDb().update(s.invoices).set({ unpaid: !paid }).where(eq(s.invoices.id, id)).returning();
    if (d) await logActivity(me, paid ? "Fatura ödendi" : "Fatura ödenmedi işaretlendi", `${d.supplier} ${tl(d.payable, 2)}`);
    refresh();
    return null;
  });
}

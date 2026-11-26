import { asc, eq, inArray } from "drizzle-orm";
import { connection } from "next/server";

import type { InvoiceLinesResponse } from "@/lib/invoice-lines";
import { can } from "@/lib/roles";
import { getCurrentUser } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";

/**
 * Faturanın kalemleri (yalnız yönetici): e-fatura belgesinden (UBL) ya da Paraşüt gider faturasından okunanlar,
 * hammaddeye bağlıysa hangi hammadde ve çarpan. Fatura penceresi açılınca istenir.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const me = await getCurrentUser();
  // Yönetici ve muhasebeci (salt okunur)
  if (!me || !can(me.role, "muhasebe.oku")) return Response.json({ error: "Bu işlem için yönetici girişi gerekli" }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Geçersiz fatura" }, { status: 400 });
  const db = getDb();
  const [inv] = await db
    .select({ eInvoiceId: s.invoices.eInvoiceId, externalId: s.invoices.externalId, ublReadAt: s.invoices.ublReadAt })
    .from(s.invoices)
    .where(eq(s.invoices.id, id))
    .limit(1);
  if (!inv) return Response.json({ error: "Fatura bulunamadı" }, { status: 404 });
  const rows = await db.select().from(s.parasutBillLines).where(eq(s.parasutBillLines.invoiceId, id)).orderBy(asc(s.parasutBillLines.id));
  const keys = [...new Set(rows.map((r) => r.productKey))];
  const links = keys.length
    ? await db
        .select({ productKey: s.parasutProductLinks.productKey, factor: s.parasutProductLinks.factor, id: s.ingredients.id, name: s.ingredients.name, unit: s.ingredients.unit })
        .from(s.parasutProductLinks)
        .innerJoin(s.ingredients, eq(s.ingredients.id, s.parasutProductLinks.ingredientId))
        .where(inArray(s.parasutProductLinks.productKey, keys))
    : [];
  const byKey = new Map(links.map((l) => [l.productKey, l]));
  const body: InvoiceLinesResponse = {
    lines: rows.map((r) => {
      const l = byKey.get(r.productKey);
      return {
        id: r.id,
        productKey: r.productKey,
        productName: r.productName,
        description: r.description,
        quantity: r.quantity,
        unit: r.unit,
        unitPrice: r.unitPrice,
        discount: r.discount,
        vatRate: r.vatRate,
        netTotal: r.netTotal,
        ingredient: l ? { id: l.id, name: l.name, unit: l.unit, factor: l.factor } : null,
      };
    }),
    source: rows.length ? (rows[0].externalId.startsWith("ubl:") ? "ubl" : "parasut") : null,
    pending: Boolean(inv.eInvoiceId && !inv.externalId && !inv.ublReadAt),
  };
  return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
}

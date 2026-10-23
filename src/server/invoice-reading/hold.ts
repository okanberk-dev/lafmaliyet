import "server-only";

import { and, eq } from "drizzle-orm";

import { type InvoiceReading } from "@/lib/invoice-reading";
import { factorText } from "@/lib/price-hold";
import { logActivity } from "@/server/actions/log";
import { getDb, schema as s } from "@/server/db";

import { readInvoiceLine, type ReadOutcome } from "./read";

/*
 * Onay bekleyen fiyatın faturasını okuma: düğme sunucu eyleminden (readHoldInvoice), kartın kendiliğinden okuması yol
 * işleyicisinden (POST /api/fiyat-onerileri/{id}/oku) gelir. Kendiliğinden okuma eylem olsaydı tarayıcı sayfadaki
 * Onayla / Reddet / "Çarpanı X yap"ı okuma bitene kadar (Haiku, 55 sn'ye kadar) sıraya koyardı: Next eylemleri
 * istemci başına tek tek yollar.
 */

/** İşlem geçmişi: "LİVİ YENİLEBİLİR BARDAK 150 AD. · ECOLİVİNG ECE2026000000031 → 1 Adet = 150 adet (emin)" */
export function readingLogText(x: { productName: string; supplier: string; invoiceNo: string | null; lineUnit: string | null; unit: string }, reading: InvoiceReading): string {
  const source = `${x.productName} · ${x.supplier}${x.invoiceNo ? ` ${x.invoiceNo}` : ""}`;
  if (!reading.found) return `${source} → kalem bulunamadı`;
  if (reading.factor === null) return `${source} → paket boyu yazmıyor`;
  const sure = reading.confidence === "high" ? "emin" : reading.confidence === "medium" ? "büyük olasılıkla" : "emin değil";
  return `${source} → ${factorText(x.lineUnit, reading.factor, x.unit)} (${sure})`;
}

/** Öneriyi okur ve saklar; öneri artık bekleyen değilse `gone`. Yetkiyi çağıran denetler (yalnız yönetici) */
export async function readHold(me: { id: number; name: string }, id: number, mode: "auto" | "manual" | "force"): Promise<ReadOutcome | { status: "gone" }> {
  const db = getDb();
  const [hold] = await db
    .select({ hold: s.ingredientPriceHolds, ingredient: { name: s.ingredients.name, unit: s.ingredients.unit } })
    .from(s.ingredientPriceHolds)
    .innerJoin(s.ingredients, eq(s.ingredients.id, s.ingredientPriceHolds.ingredientId))
    .where(eq(s.ingredientPriceHolds.id, id))
    .limit(1);
  if (!hold || hold.hold.status !== "pending") return { status: "gone" };
  const h = hold.hold;
  // Açıklama kalemden (önerinin kopyasında yok); miktar ve net önerinin kendi kopyasından (kart onu gösterir)
  const [line] = await db
    .select({ description: s.parasutBillLines.description })
    .from(s.parasutBillLines)
    .where(and(eq(s.parasutBillLines.invoiceId, h.invoiceId), eq(s.parasutBillLines.productKey, h.productKey)))
    .limit(1);
  const out = await readInvoiceLine({
    invoiceId: h.invoiceId,
    productKey: h.productKey,
    line: { name: h.productName, description: line?.description ?? null, quantity: h.quantity, unit: h.unit, netTotal: h.netTotal },
    ingredient: hold.ingredient,
    userId: me.id,
    mode,
  });
  if (out.status === "ok" && !out.cached) {
    await logActivity(me, "Fatura okundu", readingLogText({ productName: h.productName, supplier: h.supplier, invoiceNo: h.invoiceNo, lineUnit: h.unit, unit: hold.ingredient.unit }, out.reading));
  }
  return out;
}

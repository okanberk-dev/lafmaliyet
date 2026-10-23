"use server";

import { and, desc, eq, gt, notInArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { SEPARATE_CATEGORIES } from "@/lib/constants";
import { readingText, type InvoiceReading } from "@/lib/invoice-reading";
import { factorText } from "@/lib/price-hold";
import { requireAdmin } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";
import { readInvoiceLine, type ReadOutcome } from "@/server/invoice-reading/read";

import { logActivity } from "./log";
import { attempt, UserError } from "./util";

/*
 * Faturayı okuma (docs/FATURA-OKUMA.md): Hammaddeler › Onay bekleyen fiyatlar kartı ("Faturayı oku", kanıtı olmayan
 * kartta kendiliğinden bir kez) ve Paraşüt › ürün bağlama formu ("Faturadan oku"). Yalnız yönetici. Okuma fiyat
 * yazmaz; kart ve form önerilen çarpanı gösterir, sahibi tek dokunuşla uygular.
 */

const BUSY = "Bu fatura şu an okunuyor; biraz sonra yeniden deneyin.";

/** auto: kartın kendiliğinden okuması; manual: düğme; force: Yeniden oku (src/server/invoice-reading/read.ts) */
const zMode = z.enum(["auto", "manual", "force"]).default("manual");
const holdSchema = z.object({ id: z.number().int().positive(), mode: zMode });

/** İşlem geçmişi: "LİVİ YENİLEBİLİR BARDAK 150 AD. · ECOLİVİNG ECE2026000000031 → 1 Adet = 150 adet (emin)" */
function logText(x: { productName: string; supplier: string; invoiceNo: string | null; lineUnit: string | null; unit: string }, reading: InvoiceReading): string {
  const source = `${x.productName} · ${x.supplier}${x.invoiceNo ? ` ${x.invoiceNo}` : ""}`;
  if (!reading.found) return `${source} → kalem bulunamadı`;
  if (reading.factor === null) return `${source} → paket boyu yazmıyor`;
  const sure = reading.confidence === "high" ? "emin" : reading.confidence === "medium" ? "büyük olasılıkla" : "emin değil";
  return `${source} → ${factorText(x.lineUnit, reading.factor, x.unit)} (${sure})`;
}

type ReadResult = { status: "ok" } | { status: "error"; message: string } | { status: "busy"; message: string };

const toResult = (out: ReadOutcome): ReadResult => (out.status === "ok" ? { status: "ok" } : out.status === "busy" ? { status: "busy", message: BUSY } : { status: "error", message: out.message });

/**
 * Onay bekleyen fiyatın faturasını okur (Claude Haiku 5.5) ve saklar; kart sayfa yenilenince okumayı ve varsa
 * "Çarpanı X yap"ı gösterir. "Yeniden oku" (`force`) da günlük sınıra sayılır.
 */
export async function readHoldInvoice(input: z.input<typeof holdSchema>) {
  return attempt(async (): Promise<ReadResult> => {
    const me = await requireAdmin();
    const { id, mode } = holdSchema.parse(input);
    const db = getDb();
    const [hold] = await db
      .select({ hold: s.ingredientPriceHolds, ingredient: { name: s.ingredients.name, unit: s.ingredients.unit } })
      .from(s.ingredientPriceHolds)
      .innerJoin(s.ingredients, eq(s.ingredients.id, s.ingredientPriceHolds.ingredientId))
      .where(eq(s.ingredientPriceHolds.id, id))
      .limit(1);
    if (!hold || hold.hold.status !== "pending") throw new UserError("Bu fiyat önerisi artık geçerli değil; sayfayı yenileyin.");
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
      await logActivity(me, "Fatura okundu", logText({ productName: h.productName, supplier: h.supplier, invoiceNo: h.invoiceNo, lineUnit: h.unit, unit: hold.ingredient.unit }, out.reading));
    }
    // Okunuyorsa da: kart "Fatura okunuyor…" gösterir ve okuma bitene kadar kendini tazeler
    refresh();
    return toResult(out);
  });
}

const productSchema = z.object({
  productKey: z.string().min(1).max(600),
  ingredientId: z.number().int().positive({ message: "Önce hammadde seçin" }),
  mode: zMode,
});

export type ProductReading = {
  status: "ok";
  /** Önerilecek çarpan (emin ya da büyük olasılıkla okunduysa); yoksa yalnız metin */
  factor: number | null;
  text: string;
  /** Faturadaki birim ("Adet") */
  lineUnit: string | null;
};

/**
 * Paraşüt › ürün bağlama formundaki "Faturadan oku": ürünün en yeni (ücretli, kafe) faturası okunur, seçilen hammaddenin
 * birimine göre çarpan döner; form çarpanı doldurur ve kanıtı gösterir. Bağlantı kaydedilmez.
 */
export async function readProductInvoice(input: z.input<typeof productSchema>) {
  return attempt(async (): Promise<ProductReading | Exclude<ReadResult, { status: "ok" }>> => {
    const me = await requireAdmin();
    const data = productSchema.parse(input);
    const db = getDb();
    const [ing] = await db
      .select({ name: s.ingredients.name, unit: s.ingredients.unit, packagePrice: s.ingredients.packagePrice, packageSize: s.ingredients.packageSize })
      .from(s.ingredients)
      .where(eq(s.ingredients.id, data.ingredientId))
      .limit(1);
    if (!ing) throw new UserError("Hammadde bulunamadı; sayfayı yenileyin.");
    const columns = {
      invoiceId: s.invoices.id,
      supplier: s.invoices.supplier,
      invoiceNo: s.invoices.invoiceNo,
      name: s.parasutBillLines.productName,
      description: s.parasutBillLines.description,
      quantity: s.parasutBillLines.quantity,
      unit: s.parasutBillLines.unit,
      netTotal: s.parasutBillLines.netTotal,
    };
    // En yeni ücretli kafe kalemi (fiyatı veren); yoksa en yeni kalem
    const newest = (paid: boolean) =>
      db
        .select(columns)
        .from(s.parasutBillLines)
        .innerJoin(s.invoices, eq(s.invoices.id, s.parasutBillLines.invoiceId))
        .where(
          and(
            eq(s.parasutBillLines.productKey, data.productKey),
            notInArray(s.invoices.category, SEPARATE_CATEGORIES),
            paid ? and(gt(s.parasutBillLines.quantity, 0), gt(s.parasutBillLines.netTotal, 0)) : undefined,
          ),
        )
        .orderBy(desc(s.invoices.date), desc(s.parasutBillLines.id))
        .limit(1);
    const paid = await newest(true);
    const [line] = paid.length ? paid : await newest(false);
    if (!line) throw new UserError("Bu ürünün faturası bulunamadı.");
    const out = await readInvoiceLine({
      invoiceId: line.invoiceId,
      productKey: data.productKey,
      line: { name: line.name, description: line.description, quantity: line.quantity, unit: line.unit, netTotal: line.netTotal },
      ingredient: { name: ing.name, unit: ing.unit },
      userId: me.id,
      mode: data.mode === "auto" ? "manual" : data.mode,
    });
    if (out.status !== "ok") return toResult(out) as Exclude<ReadResult, { status: "ok" }>;
    if (!out.cached) await logActivity(me, "Fatura okundu", logText({ productName: line.name, supplier: line.supplier, invoiceNo: line.invoiceNo, lineUnit: line.unit, unit: ing.unit }, out.reading));
    const current = ing.packageSize > 0 ? ing.packagePrice / ing.packageSize : 0;
    const r = out.reading;
    return {
      status: "ok",
      factor: r.found && r.factor !== null && r.confidence !== "low" ? r.factor : null,
      text: readingText(r, { lineUnit: line.unit, unit: ing.unit, quantity: line.quantity, netTotal: line.netTotal, currentUnit: current }),
      lineUnit: line.unit,
    };
  });
}

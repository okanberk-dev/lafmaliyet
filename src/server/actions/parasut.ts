"use server";

import { eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { INVOICE_CATEGORIES } from "@/lib/constants";
import { addIgnored, removeIgnored } from "@/lib/product-ignore";
import { requireAdmin } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";
import { forgetParasutToken, ParasutClient } from "@/server/parasut/client";
import { isParasutConfigured } from "@/server/parasut/config";
import { readEInvoiceLines } from "@/server/parasut/lines";
import { applyProductLinks, PARASUT_STATE_KEYS, parasutSyncRunning, syncParasut, updateIgnoredProducts } from "@/server/parasut/sync";

import { logActivity } from "./log";
import { attempt, UserError, zDate, zText } from "./util";

function ensureConfigured() {
  if (!isParasutConfigured()) throw new UserError("Paraşüt bağlantı bilgileri tanımlı değil (ortam değişkenleri). Kurulum adımlarına bakın.");
}

export async function testParasutConnection() {
  return attempt(async () => {
    await requireAdmin();
    ensureConfigured();
    try {
      const r = await new ParasutClient().ping();
      return r;
    } catch (e) {
      throw new UserError((e as Error).message);
    }
  });
}

export async function runParasutSync(from: string | null) {
  return attempt(async () => {
    await requireAdmin();
    ensureConfigured();
    const r = await syncParasut("manual", from ? { from: zDate.parse(from) } : {});
    if (!r.ok) throw new UserError(r.error);
    refresh();
    return { summary: r.summary, partial: r.partial };
  });
}

/**
 * E-fatura kalemlerini beklemeden okur (eşitleme her seferinde kalan süre kadarını okur; ilk kurulumda 80 küsur
 * fatura birkaç sabah sürerdi). Bir çağrı ~45 saniye çalışır; ekran `remaining` bitene kadar yeniden çağırır.
 */
export async function readParasutLines() {
  return attempt(async () => {
    const me = await requireAdmin();
    ensureConfigured();
    // Eşitleme de aynı kalemleri ve alım miktarlarını yazar: ikisi aynı anda çalışmasın
    if (await parasutSyncRunning()) throw new UserError("Paraşüt eşitlemesi sürüyor; bitince yeniden deneyin.");
    const started = Date.now();
    const client = new ParasutClient();
    // Sayfanın süre sınırı 60 sn: son istek en geç 43. saniyede başlar (istek başına 15 sn pay)
    client.setDeadline(started + 58_000);
    const r = await readEInvoiceLines(client, { until: started + 45_000 });
    const applied = r.months.length ? await applyProductLinks() : null;
    const held = applied?.held ?? 0;
    // Okunan kalemler bağlı ürünü mal alışı sayılmayan faturaya getirdiyse fatura kontrole düşer (E-07)
    const flagged = applied?.flagged ?? 0;
    if (!r.read && !r.failed && r.stoppedBy) throw new UserError(r.stoppedBy);
    if (r.read || r.failed) {
      await logActivity(
        me,
        "E-fatura kalemleri okundu",
        `${r.read} fatura, ${r.lines} kalem${r.corrected ? ` · ${r.corrected} tevkifatlı tutar düzeltildi` : ""}${r.remaining ? ` · ${r.remaining} sırada` : ""}${held ? ` · ${held} fiyat onayda` : ""}`,
      );
    }
    refresh();
    return { read: r.read, lines: r.lines, failed: r.failed, corrected: r.corrected, remaining: r.remaining, stoppedBy: r.stoppedBy, held, flagged };
  });
}

export async function disconnectParasut() {
  return attempt(async () => {
    const me = await requireAdmin();
    await forgetParasutToken();
    await getDb().delete(s.integrationState).where(inArray(s.integrationState.key, PARASUT_STATE_KEYS));
    await logActivity(me, "Paraşüt bağlantısı sıfırlandı", "Kayıtlı oturum ve eşitleme imleci silindi");
    refresh();
    return null;
  });
}

// ---------------------------------------------------------------- kategori kuralları
const ruleSchema = z.object({
  id: z.number().int().positive().nullable(),
  matchType: z.enum(["supplier", "parasut_category", "keyword"]),
  pattern: zText("Eşleşecek metin", 120),
  category: z.enum(INVOICE_CATEGORIES as [string, ...string[]], { message: "Kategori seçin" }),
  priority: z.number().int().min(0).max(1000),
});

/** Kural metni karşılaştırması (eşitlemedeki gibi büyük/küçük harf, Türkçe karakter ve noktalama duyarsız) */
const samePattern = (a: string, b: string) => {
  const n = (t: string) =>
    t
      .toLocaleLowerCase("tr-TR")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  return n(a) === n(b);
};

export async function saveCategoryRule(input: z.input<typeof ruleSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id, ...data } = ruleSchema.parse(input);
    const db = getDb();
    const same = await db.select().from(s.parasutCategoryRules).where(eq(s.parasutCategoryRules.matchType, data.matchType));
    const dup = same.find((r) => r.id !== id && samePattern(r.pattern, data.pattern));
    if (dup) throw new UserError(`“${dup.pattern}” için zaten bir kural var (→ ${dup.category}); onu düzenleyin`);
    if (id) await db.update(s.parasutCategoryRules).set(data).where(eq(s.parasutCategoryRules.id, id));
    else await db.insert(s.parasutCategoryRules).values(data);
    await logActivity(me, "Paraşüt kategori kuralı", `“${data.pattern}” → ${data.category}`);
    refresh();
    return null;
  });
}

export async function deleteCategoryRule(id: number) {
  return attempt(async () => {
    await requireAdmin();
    await getDb().delete(s.parasutCategoryRules).where(eq(s.parasutCategoryRules.id, z.number().int().positive().parse(id)));
    refresh();
    return null;
  });
}

// ---------------------------------------------------------------- ürün → hammadde bağlantıları
const linkSchema = z.object({
  productKey: z.string().min(2).max(300),
  productName: zText("Ürün adı", 300),
  ingredientId: z.number().int().positive({ message: "Hammadde seçin" }),
  factor: z.number().positive("Çarpan sıfırdan büyük olmalı").finite(),
  updatePrice: z.boolean(),
});

export async function saveProductLink(input: z.input<typeof linkSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = linkSchema.parse(input);
    const db = getDb();
    await db
      .insert(s.parasutProductLinks)
      .values(data)
      .onConflictDoUpdate({ target: s.parasutProductLinks.productKey, set: { ingredientId: data.ingredientId, factor: data.factor, updatePrice: data.updatePrice, productName: data.productName } });
    const res = await applyProductLinks();
    const [ing] = await db.select({ name: s.ingredients.name }).from(s.ingredients).where(eq(s.ingredients.id, data.ingredientId)).limit(1);
    await logActivity(me, "Paraşüt ürünü bağlandı", `${data.productName} → ${ing?.name ?? data.ingredientId} (×${data.factor})`);
    refresh();
    return res;
  });
}

/** Önerilen bağlantıları topluca kaydeder (Paraşüt sayfasında "Önerilenleri bağla"); hesap bir kez yapılır */
export async function saveProductLinks(input: z.input<typeof linkSchema>[]) {
  return attempt(async () => {
    const me = await requireAdmin();
    const items = z.array(linkSchema).min(1, "Bağlanacak ürün yok").max(200).parse(input);
    const db = getDb();
    await db.transaction(async (tx) => {
      for (const data of items) {
        await tx
          .insert(s.parasutProductLinks)
          .values(data)
          .onConflictDoUpdate({ target: s.parasutProductLinks.productKey, set: { ingredientId: data.ingredientId, factor: data.factor, updatePrice: data.updatePrice, productName: data.productName } });
      }
    });
    const res = await applyProductLinks();
    await logActivity(me, "Paraşüt ürünleri topluca bağlandı", `${items.length} ürün: ${items.slice(0, 5).map((i) => i.productName).join(", ")}${items.length > 5 ? "…" : ""}`);
    refresh();
    return { ...res, linked: items.length };
  });
}

const ignoreSchema = z.object({
  // Anahtar olduğu gibi saklanır (kırpılmaz): bekleyenler listesi aynı anahtarla eşleşir
  productKey: z.string().min(1, "Ürün gerekli").max(600),
  productName: zText("Ürün adı", 300),
});

/**
 * Bekleyen bir ürünü "hammadde değil" diye işaretler (kargo, hizmet bedeli, ekipman, pompa…): bekleyenler
 * listesinden ve zildeki sayıdan çıkar. Faturadaki tutarına dokunulmaz; geri alınınca listeye döner.
 */
export async function ignoreProduct(input: z.input<typeof ignoreSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = ignoreSchema.parse(input);
    await updateIgnoredProducts((list) => addIgnored(list, { ...data, at: new Date().toISOString(), by: me.name }));
    await logActivity(me, "Paraşüt ürünü hammadde değil işaretlendi", data.productName);
    refresh();
    return null;
  });
}

/** "Hammadde değil" işaretini kaldırır; ürün bağlanmayı bekleyenlere döner */
export async function unignoreProduct(productKey: string) {
  return attempt(async () => {
    const me = await requireAdmin();
    const key = z.string().min(1).max(600).parse(productKey);
    const before = await updateIgnoredProducts((list) => removeIgnored(list, key));
    const name = before.find((e) => e.productKey === key)?.productName;
    if (name) await logActivity(me, "Paraşüt ürünü yeniden bekleyenlere alındı", name);
    refresh();
    return null;
  });
}

export async function deleteProductLink(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const [d] = await getDb().delete(s.parasutProductLinks).where(eq(s.parasutProductLinks.id, z.number().int().positive().parse(id))).returning();
    await applyProductLinks();
    if (d) await logActivity(me, "Paraşüt ürün bağlantısı silindi", d.productName);
    refresh();
    return null;
  });
}

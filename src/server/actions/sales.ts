"use server";

import { and, eq, gte, inArray, isNull, lte, max, sql, sum } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { salesFileProblem } from "@/app/panel/satislar/sales-logic";
import { daysInMonth } from "@/lib/calc/engine";
import { createPosMappingIndex, describeSkipped, extractSalesRows, isSummaryRow, posMatchKey, samePosName } from "@/lib/calc/pos-paste";
import { monthRowEmpty } from "@/lib/cash-month";
import { dateTR, monthLabel, num, tl } from "@/lib/format";
import { modposImportRule, modposOverZText } from "@/lib/lafpos/sales";
import { monthSource } from "@/lib/lafpos/switch";
import { todayTR } from "@/lib/reminders";
import { SALES_COVERAGE_KEY } from "@/lib/sales-coverage";
import { requireAdmin } from "@/server/auth/dal";
import { hasCashReportIn } from "@/server/data/cash-reports";
import { getDb, schema as s } from "@/server/db";
import { rematchPosSalesByName } from "@/server/lafpos/rematch";
import { loadLafposSwitchDay } from "@/server/lafpos/status";

import { logActivity } from "./log";
import { attempt, UserError, zMonth, zOptText, zText } from "./util";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Ayın satış listesinin son gününü yazar (null: ayın tamamı, ayın kaydı silinir). Tek ifadeyle (jsonb birleştirme)
 * güncellenir: iki ayın yüklemesi aynı anda birbirinin kaydını ezmez
 */
async function setCoverage(db: Db | Tx, month: string, through: string | null) {
  await db.execute(sql`
    insert into integration_state (key, value) values (${SALES_COVERAGE_KEY}, '{}'::jsonb)
    on conflict (key) do nothing`);
  // Bozulmuş (nesne olmayan) kayıt boş nesneden başlar
  const current = sql`(case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end)`;
  await db.execute(sql`
    update integration_state
       set value = ${through ? sql`${current} || jsonb_build_object(${month}::text, ${through}::text)` : sql`${current} - ${month}::text`}, updated_at = now()
     where key = ${SALES_COVERAGE_KEY}`);
}

/** Ay satırı açar; alanları boş (indirim ve ödenmez dahil): boş alan kasa raporlarından dolar (src/lib/cash-month.ts) */
async function ensureMonth(month: string) {
  await getDb().insert(s.months).values({ month }).onConflictDoNothing();
}

/**
 * Ay satırı tamamen boşsa (ciro, açık gün, indirim, ödenmez, kartlı oran, not yok) ve o aya bağlı satış satırı ya da
 * Gelir-gider girişi kalmadıysa satırı siler; böylece yanlışlıkla açılan ay (ör. deneme ayı) ay seçicide kalmaz.
 * Hiçbir değer kaybolmaz: yalnızca içi boş kayıt kalkar (kasa raporu olan ay kasadan yine görünür). İndirim ve
 * ödenmezin 0'ı yalnız ayın kasa raporu yoksa boş sayılır (src/lib/cash-month.ts monthRowEmpty).
 */
async function dropEmptyMonth(db: Db | Tx, month: string): Promise<boolean> {
  const [row] = await db.select().from(s.months).where(eq(s.months.month, month));
  if (!row) return false;
  const zeros = row.discounts === 0 || row.offRevenue === 0;
  if (!monthRowEmpty(row, zeros && (await hasCashReportIn(month, db)))) return false;
  const [lines] = await db.select({ n: sql<number>`count(*)::int` }).from(s.salesLines).where(eq(s.salesLines.month, month));
  const [pnl] = await db.select({ n: sql<number>`count(*)::int` }).from(s.pnlEntries).where(eq(s.pnlEntries.month, month));
  if ((lines?.n ?? 0) > 0 || (pnl?.n ?? 0) > 0) return false;
  await db.delete(s.months).where(eq(s.months.month, month));
  return true;
}

const monthInfoSchema = z
  .object({
    month: zMonth,
    openDays: z.number().int("Açık gün tam sayı olmalı").min(0, "Açık gün negatif olamaz").nullable(),
    posRevenue: z.number().finite().min(0, "Ciro negatif olamaz").nullable(),
    // Boş (null): kasa raporlarından; 0 elle yazılmış sıfırdır
    discounts: z.number().finite().min(0, "İndirim negatif olamaz").nullable(),
    offRevenue: z.number().finite().min(0, "Ödenmez tutarı negatif olamaz").nullable(),
    cardShare: z.number().finite().min(0, "Oran negatif olamaz").max(1, "Oran en fazla %100").nullable().default(null),
    note: zOptText(1000),
  })
  .superRefine((d, ctx) => {
    // Açık gün en fazla ayın gün sayısı (Eylül 30, Şubat 28/29); fazlası sabit giderleri %100'ün üstüne taşır
    const dim = daysInMonth(d.month);
    if (d.openDays !== null && d.openDays > dim) {
      ctx.addIssue({ code: "custom", path: ["openDays"], message: `En fazla ${dim} gün (${monthLabel(d.month)} ${dim} gün çeker)` });
    }
  });

export async function saveMonthInfo(input: z.input<typeof monthInfoSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = monthInfoSchema.parse(input);
    const db = getDb();
    await db
      .insert(s.months)
      .values({ ...data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: s.months.month,
        set: {
          openDays: data.openDays,
          posRevenue: data.posRevenue,
          discounts: data.discounts,
          offRevenue: data.offRevenue,
          cardShare: data.cardShare,
          note: data.note,
          updatedAt: new Date(),
        },
      });
    // Bütün alanlar boşaltıldıysa ve ayda başka kayıt yoksa boş ay satırı kalmasın
    const removed = await dropEmptyMonth(db, data.month);
    // Boş alan, ayın kasa raporu varsa oradan gelir: işlem geçmişi ve ekrandaki bildirim bunu söyler ("boşaltıldı" değil)
    const kasa = await hasCashReportIn(data.month, db);
    const empty = kasa ? "kasadan" : "boş";
    await logActivity(
      me,
      "Ay bilgisi",
      removed
        ? `${monthLabel(data.month)}: ${kasa ? "elle yazılanlar boşaltıldı, bilgiler kasa raporlarından" : "bilgiler boşaltıldı"}`
        : `${monthLabel(data.month)}: ciro ${data.posRevenue === null ? empty : tl(data.posRevenue)}, açık gün ${data.openDays ?? empty}`,
    );
    refresh();
    return { removed, kasa };
  });
}

const lineSchema = z.object({
  posName: zText("Ürün adı", 160),
  qty: z.number().finite(),
  revenue: z.number().finite(),
});

/** Kasa raporlarının `from`–`through` günlerindeki Z toplamı (iki uç dahil); rapor yoksa null */
async function zTotalBetween(from: string, through: string): Promise<number | null> {
  const t = s.cashReports;
  const [r] = await getDb()
    .select({ total: sum(t.zTotal).mapWith(Number), n: sql<number>`count(*)::int` })
    .from(t)
    .where(and(gte(t.date, from), lte(t.date, through)));
  return r && r.n > 0 ? (r.total ?? 0) : null;
}

/**
 * Satış listesini aya yükler. Toplam satırları ("TOPLAM", "Genel toplam (KDV dahil)") istemcide zaten
 * atlanır; buraya gelirse de ürün satırı olarak yazılmaz ve kaç tane atlandığı döner (ciro iki kez sayılmasın).
 * LafPOS'a geçiş günü seçiliyse (docs/LAFPOS.md › Günlük satış): ayın tamamı geçiş gününden sonraysa liste
 * reddedilir (satışlar LafPOS'tan gelir); geçiş ayında liste en çok geçiş gününden önceki güne kadardır ve toplamı o
 * günlerin kasa raporu Z toplamını %5'ten fazla aşarsa uyarı döner (liste sonraki günleri de içeriyor olabilir).
 */
export async function importSales(input: { month: string; lines: z.input<typeof lineSchema>[]; mode: "replace" | "append"; through?: string | null }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const month = zMonth.parse(input.month);
    const switchDay = await loadLafposSwitchDay();
    // Süren ayda listenin son günü (verilmezse dün); biten aya yüklenen liste ayın tamamı (src/lib/sales-coverage.ts);
    // geçiş ayında en çok geçiş gününden önceki gün, LafPOS'un ayında red (src/lib/lafpos/sales.ts)
    const rule = modposImportRule(month, switchDay, todayTR(), z.string().max(10).nullish().parse(input.through));
    if (!rule.ok) throw new UserError(rule.error);
    const through = rule.through;
    const parsed = z.array(lineSchema).max(2000, "En fazla 2000 satır yüklenebilir").parse(input.lines);
    const lines = parsed.filter((l) => !isSummaryRow(l.posName));
    const skippedSummary = parsed.length - lines.length;
    if (!lines.length) throw new UserError(skippedSummary ? "Yalnızca toplam satırı var; ürün satırı bulunamadı" : "Satır bulunamadı");
    const mode = z.enum(["replace", "append"]).parse(input.mode);
    const db = getDb();
    const index = createPosMappingIndex(await db.select().from(s.posMappings));
    let matched = 0;
    let replaced = 0;
    await ensureMonth(month);
    await db.transaction(async (tx) => {
      if (mode === "replace") {
        const gone = await tx.delete(s.salesLines).where(eq(s.salesLines.month, month)).returning({ id: s.salesLines.id });
        replaced = gone.length;
      }
      const [{ m }] = await tx.select({ m: max(s.salesLines.sortOrder) }).from(s.salesLines).where(eq(s.salesLines.month, month));
      const base = mode === "replace" ? 0 : (m ?? 0);
      await tx.insert(s.salesLines).values(
        lines.map((l, i) => {
          const mp = index.get(l.posName);
          if (mp && (mp.productId || mp.isService)) matched++;
          return {
            month,
            posName: l.posName.trim().replace(/\s+/g, " "),
            qty: l.qty,
            revenue: l.revenue,
            productId: mp?.productId ?? null,
            isService: mp?.isService ?? false,
            sortOrder: base + i + 1,
          };
        }),
      );
      await setCoverage(tx, month, through);
    });
    // Geçiş ayı: liste toplamı listenin günlerinin Z toplamını aşıyorsa (liste geçiş gününden sonrasını da içerebilir)
    let warning: string | null = null;
    if (through && monthSource(month, switchDay) === "gecis") {
      const [{ total }] = await db.select({ total: sum(s.salesLines.revenue).mapWith(Number) }).from(s.salesLines).where(eq(s.salesLines.month, month));
      warning = modposOverZText(total ?? 0, await zTotalBetween(`${month}-01`, through), `${month}-01`, through);
    }
    await logActivity(
      me,
      "Satış raporu yüklendi",
      `${monthLabel(month)}: ${lines.length} satır, ${matched} eşleşti${replaced ? `, önceki ${replaced} satır değiştirildi` : ""}${skippedSummary ? `, ${skippedSummary} toplam satırı atlandı` : ""}${through ? ` · ${dateTR(through)} tarihine kadar` : ""}`,
    );
    refresh();
    return { count: lines.length, matched, replaced, skippedSummary, through, warning };
  });
}

/**
 * Bir satırı ürünle (ya da HİZMET ile) eşleştirir, aynı aydaki aynı adlı eşleşmemiş satırlara uygular ve
 * POS adını hatırlar. Hafıza anahtarı posMatchKey'dir (büyük/küçük harf ve I/İ farkı yok); aynı anahtara
 * düşen eski kayıtlar (ör. "LATTE MEDİUM" ile "LATTE MEDIUM") tek kayıtta birleşir.
 */
async function writeMatch(
  tx: Tx,
  line: { id: number; month: string; posName: string },
  productId: number | null,
  isService: boolean,
  applyToSameName: boolean,
  storedNames: string[],
): Promise<number> {
  await tx.update(s.salesLines).set({ productId, isService }).where(eq(s.salesLines.id, line.id));
  let others = 0;
  if (applyToSameName) {
    const candidates = await tx
      .select({ id: s.salesLines.id, posName: s.salesLines.posName })
      .from(s.salesLines)
      .where(and(eq(s.salesLines.month, line.month), isNull(s.salesLines.productId), eq(s.salesLines.isService, false)));
    const ids = candidates.filter((o) => o.id !== line.id && samePosName(o.posName, line.posName)).map((o) => o.id);
    if (ids.length) await tx.update(s.salesLines).set({ productId, isService }).where(inArray(s.salesLines.id, ids));
    others = ids.length;
  }
  await writeMapping(tx, line.posName, productId, isService, storedNames);
  // Aynı adla gelmiş ürünsüz LafPOS satırları da bağlanır (denetim E-33; yalnız ürünsüzler, ekranda sayılmaz)
  await rematchPosSalesByName(tx, line.posName, { productId, isService });
  return others;
}

/**
 * POS adı hafızasını yazar (anahtar posMatchKey): aynı anahtara düşen eski kayıtlar tek kayıtta birleşir; ürün yoksa ve
 * hizmet değilse hafızadan silinir
 */
async function writeMapping(tx: Tx, posName: string, productId: number | null, isService: boolean, storedNames: string[]) {
  const key = posMatchKey(posName);
  const stale = storedNames.filter((n) => n !== key);
  if (stale.length) await tx.delete(s.posMappings).where(inArray(s.posMappings.posName, stale));
  if (productId || isService) {
    await tx
      .insert(s.posMappings)
      .values({ posName: key, productId, isService, updatedAt: new Date() })
      .onConflictDoUpdate({ target: s.posMappings.posName, set: { productId, isService, updatedAt: new Date() } });
  } else {
    await tx.delete(s.posMappings).where(eq(s.posMappings.posName, key));
  }
}

/** Satırı bir ürünle (ya da HİZMET ile) eşleştirir ve POS adını hatırlar. productId null + isService false = eşleşmeyi ve hafızayı kaldırır. */
export async function setLineMatch(lineId: number, productId: number | null, isService: boolean, applyToSameName = true) {
  return attempt(async () => {
    const me = await requireAdmin();
    const db = getDb();
    const [line] = await db.select().from(s.salesLines).where(eq(s.salesLines.id, z.number().int().parse(lineId)));
    if (!line) throw new UserError("Satır bulunamadı");
    const pid = isService ? null : productId === null ? null : z.number().int().parse(productId);
    if (pid) {
      const [p] = await db.select({ id: s.products.id }).from(s.products).where(eq(s.products.id, pid));
      if (!p) throw new UserError("Ürün bulunamadı");
    }
    const index = createPosMappingIndex(await db.select().from(s.posMappings));
    const others = await db.transaction((tx) => writeMatch(tx, line, pid, isService, applyToSameName, index.storedNames(line.posName)));
    await logActivity(
      me,
      "POS eşleştirmesi",
      `${line.posName} → ${isService ? "HİZMET" : pid ? `ürün #${pid}` : "eşleşmedi (hafızadan silindi)"}${others ? ` · aynı adlı ${others} satır daha` : ""}`,
    );
    refresh();
    return { others };
  });
}

/**
 * Önerilen eşleşmeleri tek seferde uygular (Satış satırları > "Önerileri uygula"). Her biri tek tek
 * eşleştirmeyle aynıdır: satır, aynı adlı satırlar ve hafıza güncellenir.
 */
export async function applyLineMatches(month: string, items: { lineId: number; productId: number }[]) {
  return attempt(async () => {
    const me = await requireAdmin();
    const m = zMonth.parse(month);
    const list = z
      .array(z.object({ lineId: z.number().int(), productId: z.number().int() }))
      .min(1, "Uygulanacak öneri yok")
      .max(500)
      .parse(items);
    const db = getDb();
    const lines = await db
      .select()
      .from(s.salesLines)
      .where(and(eq(s.salesLines.month, m), inArray(s.salesLines.id, list.map((i) => i.lineId))));
    const byId = new Map(lines.map((l) => [l.id, l]));
    const productIds = [...new Set(list.map((i) => i.productId))];
    const known = new Set((await db.select({ id: s.products.id }).from(s.products).where(inArray(s.products.id, productIds))).map((p) => p.id));
    const mappings = await db.select().from(s.posMappings);
    const index = createPosMappingIndex(mappings);
    let applied = 0;
    let others = 0;
    await db.transaction(async (tx) => {
      for (const it of list) {
        const line = byId.get(it.lineId);
        // Bu arada eşleştirilmiş ya da silinmiş satır atlanır (başka sekmede değişmiş olabilir)
        if (!line || line.productId || line.isService || !known.has(it.productId)) continue;
        others += await writeMatch(tx, line, it.productId, false, true, index.storedNames(line.posName));
        applied++;
      }
    });
    if (!applied) throw new UserError("Öneriler uygulanamadı; satırlar değişmiş olabilir. Sayfayı yenileyin.");
    await logActivity(me, "POS eşleştirmesi", `${monthLabel(m)}: ${applied} öneri uygulandı${others ? ` (aynı adlı ${others} satır daha)` : ""}`);
    refresh();
    return { applied, skipped: list.length - applied };
  });
}

const lafposMatchSchema = z.object({
  /** Satışlar'ın ayı: o ayın bu adlı LafPOS satırlarının hepsi seçilene geçer; null (Ayarlar › LafPOS) yalnız ürünsüzler */
  month: zMonth.nullable(),
  posName: zText("Ürün adı", 160),
  productId: z.number().int().positive().nullable(),
  isService: z.boolean(),
});

/**
 * LafPOS satırını (ay toplamı ya da kartın eşleşmeyen adı) bir ürüne ya da HİZMET'e bağlar (docs/LAFPOS.md › Günlük
 * satış; denetim E-33). POS adı hafızaya yazılır (ModPOS satırının eşleştirmesiyle aynı hafıza, anahtar posMatchKey) ve
 * adı aynı anahtara düşen ürünsüz LafPOS satırları her ayda, yeniden gönderim olmadan bağlanır. `month` verilirse
 * (Satışlar) o ayın bu adlı LafPOS satırlarının hepsi seçilene geçer, bağlı olanlar da (ModPOS satırında olduğu gibi o
 * ayın satırı değişir); ürün seçilmez ve hizmet değilse o ayın satırları ürünsüz kalır, ad hafızadan silinir.
 */
export async function matchLafposName(input: z.input<typeof lafposMatchSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = lafposMatchSchema.parse(input);
    const posName = data.posName.replace(/\s+/g, " ");
    const pid = data.isService ? null : data.productId;
    if (data.month === null && pid === null && !data.isService) throw new UserError("Bir ürün ya da HİZMET seçin");
    const db = getDb();
    if (pid) {
      const [p] = await db.select({ id: s.products.id }).from(s.products).where(eq(s.products.id, pid));
      if (!p) throw new UserError("Ürün bulunamadı");
    }
    const index = createPosMappingIndex(await db.select().from(s.posMappings));
    const t = s.posDailySales;
    const r = await db.transaction(async (tx) => {
      const month = data.month
        ? await tx
            .update(t)
            .set({ productId: pid, isService: data.isService })
            .where(and(eq(t.posName, posName), gte(t.date, `${data.month}-01`), lte(t.date, `${data.month}-31`)))
            .returning({ date: t.date })
        : [];
      if (data.month && !month.length) throw new UserError("Bu ayda bu adla LafPOS satırı yok; sayfayı yenileyin.");
      await writeMapping(tx, posName, pid, data.isService, index.storedNames(posName));
      const others = await rematchPosSalesByName(tx, posName, { productId: pid, isService: data.isService });
      return { days: new Set(month.map((x) => x.date)).size, others };
    });
    const target = data.isService ? "HİZMET" : pid ? `ürün #${pid}` : "eşleşmedi (hafızadan silindi)";
    await logActivity(
      me,
      "POS eşleştirmesi",
      `${posName} (LafPOS) → ${target}${data.month ? ` · ${monthLabel(data.month)}: ${r.days} gün` : ""}${r.others ? ` · ürünsüz ${r.others} satır daha` : ""}`,
    );
    refresh();
    return r;
  });
}

/**
 * LafPOS satırları için önerilen eşleşmeler tek seferde (Satışlar › "Önerileri uygula"; ModPOS satırları
 * applyLineMatches'le): her biri matchLafposName gibi, ama yalnız o ayın hâlâ ürünsüz satırlarına (bu arada eşleştirilen ad
 * atlanır). Ad hafızaya yazılır, başka aylardaki ürünsüz satırlar da bağlanır.
 */
export async function applyLafposMatches(month: string, items: { posName: string; productId: number }[]) {
  return attempt(async () => {
    const me = await requireAdmin();
    const m = zMonth.parse(month);
    const list = z
      .array(z.object({ posName: zText("Ürün adı", 160), productId: z.number().int().positive() }))
      .min(1, "Uygulanacak öneri yok")
      .max(500)
      .parse(items);
    const db = getDb();
    const productIds = [...new Set(list.map((i) => i.productId))];
    const known = new Set((await db.select({ id: s.products.id }).from(s.products).where(inArray(s.products.id, productIds))).map((p) => p.id));
    const index = createPosMappingIndex(await db.select().from(s.posMappings));
    const t = s.posDailySales;
    let applied = 0;
    let others = 0;
    await db.transaction(async (tx) => {
      for (const it of list) {
        if (!known.has(it.productId)) continue;
        const posName = it.posName.replace(/\s+/g, " ");
        const done = await tx
          .update(t)
          .set({ productId: it.productId, isService: false })
          .where(and(eq(t.posName, posName), gte(t.date, `${m}-01`), lte(t.date, `${m}-31`), isNull(t.productId), eq(t.isService, false)))
          .returning({ id: t.id });
        if (!done.length) continue;
        await writeMapping(tx, posName, it.productId, false, index.storedNames(posName));
        others += await rematchPosSalesByName(tx, posName, { productId: it.productId, isService: false });
        applied++;
      }
    });
    if (!applied) throw new UserError("Öneriler uygulanamadı; satırlar değişmiş olabilir. Sayfayı yenileyin.");
    await logActivity(me, "POS eşleştirmesi", `${monthLabel(m)}: LafPOS'ta ${applied} öneri uygulandı${others ? ` (ürünsüz ${others} satır daha)` : ""}`);
    refresh();
    return { applied, skipped: list.length - applied };
  });
}

export async function saveLine(input: { id: number | null; month: string; posName: string; qty: number; revenue: number; note?: string | null }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = lineSchema.parse(input);
    const month = zMonth.parse(input.month);
    // Ayın tamamı LafPOS'tansa elle ModPOS satırı sayılmaz (docs/LAFPOS.md › Günlük satış)
    if (monthSource(month, await loadLafposSwitchDay()) === "lafpos") {
      throw new UserError(`${monthLabel(month)} LafPOS'tan geliyor; satırlar her gün sonunda LafPOS'tan gelir, elle ModPOS satırı eklenmez.`);
    }
    const note = zOptText(300).parse(input.note);
    if (isSummaryRow(data.posName)) {
      throw new UserError(`“${data.posName}” bir toplam satırı; ürün satırı olarak eklenirse ciro iki kez sayılır`);
    }
    const posName = data.posName.replace(/\s+/g, " ");
    const db = getDb();
    const index = createPosMappingIndex(await db.select().from(s.posMappings));
    const mp = index.get(posName);
    let linked = false;
    if (input.id) {
      const [old] = await db.select().from(s.salesLines).where(eq(s.salesLines.id, z.number().int().parse(input.id)));
      if (!old) throw new UserError("Satır bulunamadı");
      // Eşleşmemiş satırın adı düzeltilince hafızadaki eşleşme uygulanır; eşleşmiş satırın seçimi korunur
      const relink = !old.productId && !old.isService && mp && (mp.productId || mp.isService);
      linked = !!relink;
      await db
        .update(s.salesLines)
        .set({ ...data, posName, note, ...(relink ? { productId: mp.productId, isService: mp.isService } : {}) })
        .where(eq(s.salesLines.id, old.id));
    } else {
      await ensureMonth(month);
      const [{ m }] = await db.select({ m: max(s.salesLines.sortOrder) }).from(s.salesLines).where(eq(s.salesLines.month, month));
      linked = !!(mp && (mp.productId || mp.isService));
      await db.insert(s.salesLines).values({
        month,
        ...data,
        posName,
        note,
        productId: mp?.productId ?? null,
        isService: mp?.isService ?? false,
        sortOrder: (m ?? 0) + 1,
      });
    }
    await logActivity(me, input.id ? "Satış satırı düzenlendi" : "Satış satırı eklendi", `${posName}: ${num(data.qty)} adet, ${tl(data.revenue)}`);
    refresh();
    return { linked };
  });
}

export async function deleteLine(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const [l] = await getDb().delete(s.salesLines).where(eq(s.salesLines.id, z.number().int().parse(id))).returning();
    if (l) await logActivity(me, "Satış satırı silindi", `${l.posName} (${monthLabel(l.month)})`);
    refresh();
    return null;
  });
}

/**
 * Ayın satış satırlarını siler. withInfo: elle yazılan ay bilgilerini (ciro, açık gün, indirim, ödenmez, kartlı oran,
 * not) da siler; kasa raporlarından gelenler kalır (raporlar silinmez).
 * Eşleştirme hafızası ve Gelir-gider girişleri kalır. Ay tamamen boşaldıysa ay kaydı da kalkar.
 */
export async function clearMonthSales(month: string, opts?: { withInfo?: boolean }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const m = zMonth.parse(month);
    const db = getDb();
    const withInfo = opts?.withInfo === true;
    const gone = await db.delete(s.salesLines).where(eq(s.salesLines.month, m)).returning({ id: s.salesLines.id });
    await setCoverage(db, m, null);
    if (withInfo) {
      await db
        .update(s.months)
        .set({ openDays: null, posRevenue: null, discounts: null, offRevenue: null, cardShare: null, note: null, updatedAt: new Date() })
        .where(eq(s.months.month, m));
    }
    const monthRemoved = await dropEmptyMonth(db, m);
    await logActivity(me, "Ay satışları silindi", `${monthLabel(m)}: ${gone.length} satır${withInfo ? ", ay bilgileri de" : ""}`);
    refresh();
    return { deleted: gone.length, monthRemoved };
  });
}

/** Yüklenen .xlsx / .csv dosyasından (ürün adı, adet, ciro) satırlarını çıkarır; önizleme için döner. */
export async function parseSalesFile(formData: FormData) {
  return attempt(async () => {
    await requireAdmin();
    const file = formData.get("file");
    if (!(file instanceof File) || !file.size) throw new UserError("Dosya seçin");
    const tooBig = salesFileProblem(file.size);
    if (tooBig) throw new UserError(tooBig);
    const name = file.name.toLowerCase();
    let table: unknown[][] = [];
    if (name.endsWith(".xlsx")) {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ArrayBuffer);
      const ws = wb.worksheets[0];
      if (!ws) throw new UserError("Dosyada sayfa yok");
      ws.eachRow({ includeEmpty: false }, (row) => {
        const vals = (row.values as unknown[]).slice(1).map((v) => {
          if (v && typeof v === "object") {
            const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
            if (o.result !== undefined) return o.result;
            if (o.richText) return o.richText.map((r) => r.text).join("");
            if (o.text !== undefined) return o.text;
          }
          return v;
        });
        table.push(vals);
      });
    } else if (name.endsWith(".csv") || name.endsWith(".txt") || name.endsWith(".tsv")) {
      const text = await file.text();
      const sep = text.includes("\t") ? "\t" : text.split("\n")[0].includes(";") ? ";" : ",";
      table = text.split(/\r?\n/).map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, "").trim()));
    } else {
      throw new UserError("Desteklenen dosyalar: .xlsx, .csv");
    }
    const res = extractSalesRows(table);
    if (!res.rows.length) {
      const why = describeSkipped(res.skipped);
      throw new UserError(`Dosyada 'ürün adı, adet, ciro' sütunları bulunamadı${why ? ` (${why})` : ""}`);
    }
    return res;
  });
}

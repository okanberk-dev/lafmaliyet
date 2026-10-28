"use server";

import { asc, eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { DEFAULT_SETTINGS, MANUAL_PNL_ROWS } from "@/lib/constants";
import { money } from "@/lib/format";
import { todayTR } from "@/lib/reminders";
import { assetCandidates, invoiceLabelOf, invoiceRemaining } from "@/lib/tax/assets";
import { quarterOfMonth } from "@/lib/tax/calendar";
import { accountantCheck, ACCOUNTANT_CHECK_KEYS } from "@/lib/tax/checks";
import {
  adjustmentRefusal,
  assetRefusal,
  categoryClassificationRefusal,
  classificationLogText,
  cleanFiling,
  EMPLOYER_SGK_MAX,
  filingLogText,
  filingPeriodRefusal,
  filingReminders,
  type FilingReminderResult,
  filingSavedText,
  filingTitle,
  FILING_REMOVED_TEXT,
  fixedClassificationRefusal,
  overrideLogText,
  overrideRefusal,
  periodStartRefusal,
  rateText,
  ruleTableValue,
  settingsChangeText,
} from "@/lib/tax/edit";
import { ADJUSTMENT_LABELS, adjustmentPeriodLabel, BEYANNAME_ADJ_WARNING } from "@/lib/tax/pnl";
import { r2, rulesFor, TAX_DOCS, taxDocAllowed, WITHHOLDINGS } from "@/lib/tax/rules";
import { parseTaxSettings, TAX_SETTINGS_KEY, type TaxSettings } from "@/lib/tax/settings";
import type { ReminderRow } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
import { fixedReminderMessage, followFixedReminders, type FollowResult } from "@/server/data/fixed-follow";
import { getDb, schema as s, type DB } from "@/server/db";

import { logActivity } from "./log";
import { attempt, UserError, zDate, zMoney, zOptText, zText } from "./util";

/*
 * Vergi bölümünün eylemleri (plan docs/planlar/vergi.md §7.2; docs/VERGI.md). Yalnız yönetici: her eylem oturumu ve
 * rolü kendisi denetler (requireAdmin), girdiyi zod ve saf kurallarla (src/lib/tax/edit.ts) doğrular, işlem geçmişine
 * yazar ve sayfayı yeniler (refresh). `tax.settings` oku-değiştir-yaz satır kilidiyle yapılır. Para hareketi ve hesap
 * işlemi yok: parolayla onay istenmez. Dosyada yalnız eylemler dışa açıktır.
 */

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

const zId = z.number().int().positive();
const zNote = z.string({ message: "Not gerekli" }).trim().min(3, "Not en az 3 karakter olmalı").max(300, "Not en çok 300 karakter");
const zAmount = zMoney.max(1_000_000_000, "Tutar çok büyük").min(-1_000_000_000, "Tutar çok küçük");

/** `tax.settings`'i satır kilidiyle oku-değiştir-yaz (aynı anda iki kayıt birbirinin alanını silmesin) */
async function updateTaxSettings(tx: Tx, change: (st: TaxSettings) => TaxSettings): Promise<{ before: TaxSettings; after: TaxSettings }> {
  const [row] = await tx.select().from(s.integrationState).where(eq(s.integrationState.key, TAX_SETTINGS_KEY)).for("update");
  const before = parseTaxSettings(row?.value);
  const after = change(before);
  await tx
    .insert(s.integrationState)
    .values({ key: TAX_SETTINGS_KEY, value: after })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value: after, updatedAt: new Date() } });
  return { before, after };
}

async function readTaxSettings(db: DB | Tx): Promise<TaxSettings> {
  const [row] = await db.select().from(s.integrationState).where(eq(s.integrationState.key, TAX_SETTINGS_KEY)).limit(1);
  return parseTaxSettings(row?.value);
}

// ---------------------------------------------------------------- Ayarlar (§4.4)

const settingsSchema = z.object({
  periodStart: zDate.optional(),
  firstActivity: z.enum(["ilk", "devir"]).nullable().optional(),
  quarterDepreciation: z.enum(["kalan", "ay12"]).optional(),
  muhtasarQuarterly: z.boolean().optional(),
  minWageSupport: z.boolean().optional(),
  includeSeparate: z.boolean().optional(),
  carriedLoss: z
    .object({ amount: zMoney.min(0, "Tutar eksi olamaz").max(1_000_000_000, "Tutar çok büyük"), note: zNote })
    .nullable()
    .optional(),
});

/** Vergi ayarları: verilen alanlar değişir (hesap dönemi, kuruluş, amortisman, muhtasar, asgari ücret, kafe dışı, zarar) */
export async function saveTaxSettings(input: z.input<typeof settingsSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = settingsSchema.parse(input);
    const today = todayTR();
    if (data.periodStart !== undefined) {
      const refusal = periodStartRefusal(data.periodStart, today);
      if (refusal) throw new UserError(refusal);
    }
    const { before, after } = await getDb().transaction((tx) =>
      updateTaxSettings(tx, (st) => ({
        ...st,
        ...(data.periodStart !== undefined ? { periodStart: data.periodStart } : {}),
        ...(data.firstActivity !== undefined ? { firstActivity: data.firstActivity } : {}),
        ...(data.quarterDepreciation !== undefined ? { quarterDepreciation: data.quarterDepreciation } : {}),
        ...(data.muhtasarQuarterly !== undefined ? { muhtasarQuarterly: data.muhtasarQuarterly } : {}),
        ...(data.minWageSupport !== undefined ? { minWageSupport: data.minWageSupport } : {}),
        ...(data.includeSeparate !== undefined ? { includeSeparate: data.includeSeparate } : {}),
        ...(data.carriedLoss !== undefined
          ? { carriedLoss: data.carriedLoss ? { amount: r2(data.carriedLoss.amount), note: data.carriedLoss.note, by: me.name, date: today } : null }
          : {}),
      })),
    );
    const changed = settingsChangeText(before, after);
    if (changed.length) await logActivity(me, "Vergi: ayarlar", changed.join(" · "));
    refresh();
    return { changed };
  });
}

const overrideSchema = z.object({ key: z.string().max(80), value: zMoney.nullable(), note: z.string().trim().max(300, "Not en çok 300 karakter").nullish() });

/**
 * Elle değer (K8, §2.4): yalnız elle değiştirilebilen kural; sayı sonlu ve ≥ 0 (`sgk.isverenOran` en çok %21,75); not
 * (kaynak) zorunlu. `value: null` tablodaki değere döner
 */
export async function saveTaxOverride(input: z.input<typeof overrideSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = overrideSchema.parse(input);
    const refusal = overrideRefusal(data.key, data.value);
    if (refusal) throw new UserError(refusal);
    const note = data.note?.trim() ?? "";
    if (data.value !== null && note.length < 3) throw new UserError("Kaynak / not yazın (en az 3 karakter)");
    const table = ruleTableValue(data.key) ?? 0;
    const { before } = await getDb().transaction((tx) =>
      updateTaxSettings(tx, (st) => {
        const overrides = { ...st.overrides };
        if (data.value === null) delete overrides[data.key];
        else overrides[data.key] = { value: data.value, note, by: me.name, date: todayTR() };
        return { ...st, overrides };
      }),
    );
    const prev = before.overrides[data.key];
    const from = typeof prev?.value === "number" ? prev.value : table;
    await logActivity(me, "Vergi: elle değer", overrideLogText(data.key, from, data.value, data.value === null ? "" : note));
    refresh();
    return null;
  });
}

const checkSchema = z.object({ key: z.enum(ACCOUNTANT_CHECK_KEYS as [string, ...string[]]), checked: z.boolean(), note: zOptText(300) });

/** "Muhasebecimle konuştum" (K34): işaret sahibindir; not muhasebecinin söylediğidir. İşaret kaldırılabilir */
export async function saveTaxCheck(input: z.input<typeof checkSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = checkSchema.parse(input);
    const key = data.key as (typeof ACCOUNTANT_CHECK_KEYS)[number];
    await getDb().transaction((tx) =>
      updateTaxSettings(tx, (st) => {
        const checks = { ...st.checks };
        if (data.checked) checks[key] = { by: me.name, date: todayTR(), note: data.note };
        else delete checks[key];
        return { ...st, checks };
      }),
    );
    await logActivity(me, "Vergi: muhasebeciyle konuşuldu", `${accountantCheck(key).title}${data.checked ? "" : " · işaret kaldırıldı"}`);
    refresh();
    return null;
  });
}

// ---------------------------------------------------------------- Sınıflandırma (§4.2)

const zDoc = z.enum(TAX_DOCS as unknown as [string, ...string[]]);
const itemSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("fixed"),
    id: zId,
    doc: zDoc.nullable(),
    withholding: z.enum(WITHHOLDINGS as unknown as [string, ...string[]]).nullable().optional(),
    vatToZero: z.boolean().optional(),
  }),
  z.object({ source: z.literal("category"), id: zId, doc: z.enum(["fatura", "belgeli", "yok"]).nullable() }),
  z.object({ source: z.literal("manual"), key: z.string().max(60), doc: zDoc.nullable() }),
  z.object({ source: z.literal("invoice"), id: zId, notAsset: z.boolean() }),
]);
const classifySchema = z.object({ items: z.array(itemSchema).min(1, "Kaydedilecek değişiklik yok").max(200, "Tek seferde en çok 200 kalem") });

/**
 * Sınıflandırma listesinin toplu kaydı (tek işlem, tek yenileme): sabit giderin belgesi, stopajı ve "KDV yok"u, aylık
 * harcama kategorisinin ve Gelir-gider'in elle satırının belgesi, demirbaş adayının "Gider (demirbaş değil)" kararı.
 * Stopaj ya da KDV değişince "Sabit giderlerden ekle" ile açılmış hatırlatıcının tutarı yeni nete uyar (costs.ts'in
 * kuralı). İşlem geçmişine kalem adı ve belge yazılmaz (K12, K31)
 */
export async function saveTaxClassifications(input: z.input<typeof classifySchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { items } = classifySchema.parse(input);
    const keys = items.map((i) => (i.source === "manual" ? `manual:${i.key}` : `${i.source}:${i.id}`));
    if (new Set(keys).size !== keys.length) throw new UserError("Aynı kalem iki kez gönderildi");
    const follows: FollowResult = { updated: [], manual: [], later: [] };
    await getDb().transaction(async (tx) => {
      // Sabit giderler
      const fixedItems = items.filter((i) => i.source === "fixed");
      if (fixedItems.length) {
        const rows = await tx
          .select()
          .from(s.fixedExpenses)
          .where(inArray(s.fixedExpenses.id, fixedItems.map((i) => i.id)))
          .for("update");
        const byId = new Map(rows.map((r) => [r.id, r]));
        for (const it of fixedItems) {
          const before = byId.get(it.id);
          if (!before) throw new UserError("Sabit gider bulunamadı (sayfayı yenileyin)");
          const doc = it.doc as (typeof before)["taxDoc"];
          const given = it.withholding as (typeof before)["taxWithholding"] | undefined;
          // Verilen belge ve stopaj bölüme uygun mu
          const refusal = fixedClassificationRefusal(before.section, { doc, withholding: given ?? null });
          if (refusal) throw new UserError(`${before.name}: ${refusal}`);
          // Verilmeyen stopaj kalır; yeni belgeyle uygun değilse (personelde dışarıdan hizmet değil) kalkar
          const kept = given === undefined ? before.taxWithholding : given;
          const withholding = kept && fixedClassificationRefusal(before.section, { doc, withholding: kept }) === null ? kept : null;
          if (it.vatToZero && withholding !== "kira") throw new UserError(`${before.name}: 'KDV yok' yalnız şahsa işyeri kirasında seçilebilir`);
          const set = { taxDoc: doc, taxWithholding: withholding, ...(it.vatToZero ? { vatRate: 0 } : {}) };
          await tx.update(s.fixedExpenses).set(set).where(eq(s.fixedExpenses.id, before.id));
          const after = { ...before, ...set };
          if (after.taxWithholding !== before.taxWithholding || after.vatRate !== before.vatRate) {
            const versions = await tx.select().from(s.fixedExpenseVersions).where(eq(s.fixedExpenseVersions.fixedExpenseId, before.id));
            const f = await followFixedReminders(tx, before, versions, after);
            follows.updated.push(...f.updated);
            follows.manual.push(...f.manual);
            follows.later.push(...f.later);
          }
        }
      }
      // Aylık harcama kategorileri
      const catItems = items.filter((i) => i.source === "category");
      if (catItems.length) {
        const rows = await tx
          .select({ id: s.expenseCategories.id, name: s.expenseCategories.name, section: s.expenseCategories.section })
          .from(s.expenseCategories)
          .where(inArray(s.expenseCategories.id, catItems.map((i) => i.id)));
        const byId = new Map(rows.map((r) => [r.id, r]));
        for (const it of catItems) {
          const c = byId.get(it.id);
          if (!c) throw new UserError("Harcama kategorisi bulunamadı (sayfayı yenileyin)");
          const refusal = categoryClassificationRefusal(c.section, it.doc);
          if (refusal) throw new UserError(`${c.name}: ${refusal}`);
          await tx.update(s.expenseCategories).set({ taxDoc: it.doc }).where(eq(s.expenseCategories.id, c.id));
        }
      }
      // Gelir-gider'in elle satırları (tax.settings › manualRows)
      const manualItems = items.filter((i) => i.source === "manual");
      if (manualItems.length) {
        for (const it of manualItems) {
          const row = MANUAL_PNL_ROWS.find((r) => r.key === it.key);
          if (!row) throw new UserError("Satır bulunamadı (sayfayı yenileyin)");
          if (it.doc && !taxDocAllowed(it.doc as TaxSettings["manualRows"][string], row.section)) throw new UserError(`${row.label}: bu belge bu bölümde seçilemez`);
        }
        await updateTaxSettings(tx, (st) => {
          const manualRows = { ...st.manualRows };
          for (const it of manualItems) {
            if (it.doc) manualRows[it.key] = it.doc as TaxSettings["manualRows"][string];
            else delete manualRows[it.key];
          }
          return { ...st, manualRows };
        });
      }
      // Demirbaş adayı: "Gider (demirbaş değil)" ya da geri alınması
      const invItems = items.filter((i) => i.source === "invoice");
      if (invItems.length) {
        const [invoices, assets] = await Promise.all([
          tx
            .select({
              id: s.invoices.id,
              date: s.invoices.date,
              supplier: s.invoices.supplier,
              description: s.invoices.description,
              invoiceNo: s.invoices.invoiceNo,
              category: s.invoices.category,
              amount: s.invoices.amount,
              discount: s.invoices.discount,
              payable: s.invoices.payable,
              unpaid: s.invoices.unpaid,
              note: s.invoices.note,
              taxNotAsset: s.invoices.taxNotAsset,
            })
            .from(s.invoices),
          tx.select({ invoiceId: s.taxAssets.invoiceId, cost: s.taxAssets.cost }).from(s.taxAssets),
        ]);
        for (const it of invItems) {
          const inv = invoices.find((i) => i.id === it.id);
          if (!inv) throw new UserError("Fatura bulunamadı (sayfayı yenileyin)");
          // Karar verilmemiş sayılınca adaysa (geri almada da)
          const undecided = invoices.map((i) => (i.id === it.id ? { ...i, taxNotAsset: false } : i));
          const { rules } = rulesFor(Number(inv.date.slice(0, 4)));
          if (!assetCandidates(undecided, assets, rules).some((c) => c.invoice.id === it.id)) throw new UserError(`${inv.supplier}: fatura demirbaş adayı değil`);
          await tx.update(s.invoices).set({ taxNotAsset: it.notAsset }).where(eq(s.invoices.id, it.id));
        }
      }
    });
    await logActivity(me, "Vergi: sınıflandırma", classificationLogText(items.length));
    refresh();
    return { count: items.length, message: fixedReminderMessage(follows) };
  });
}

// ---------------------------------------------------------------- Muhasebecinin rakamı (§4.5-a)

const filingSchema = z.object({
  kind: z.enum(["gecici", "kv", "mphb", "kdv_matrah"]),
  period: z.string().max(10),
  payable: zAmount.nullable(),
  stamp: zAmount.nullable(),
  values: z.record(z.string().max(30), zAmount.nullable()).default({}),
  note: zOptText(300),
  alsoReminder: z.boolean().default(true),
});

/**
 * Muhasebecinin beyanname / tahakkuk rakamı (K4): dönem başına bir kayıt (varsa üstüne yazılır). "Ödemeler'deki
 * hatırlatıcıya da yaz" işaretliyse sıradaki günü o döneme düşen tek eşleşen hatırlatıcının tutarına ödenecek + damga
 * yazılır; hiç ya da birden çok varsa yazılmaz, sonuç söyler. KDV beyannamesi satışlarında ödenecek ve damga 0
 */
export async function saveTaxFiling(input: z.input<typeof filingSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = filingSchema.parse(input);
    const db = getDb();
    const settings = await readTaxSettings(db);
    const refusal = filingPeriodRefusal(data.kind, data.period, settings, todayTR());
    if (refusal) throw new UserError(refusal);
    const clean = cleanFiling(data.kind, data);
    if (!clean.ok) throw new UserError(clean.error);
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(s.taxFilings)
        .values({ kind: data.kind, period: data.period, payable: clean.payable, stamp: clean.stamp, values: clean.values, note: data.note, enteredBy: me.id, enteredByName: me.name })
        .onConflictDoUpdate({
          target: [s.taxFilings.kind, s.taxFilings.period],
          set: { payable: clean.payable, stamp: clean.stamp, values: clean.values, note: data.note, enteredBy: me.id, enteredByName: me.name, updatedAt: new Date() },
        })
        .returning({ id: s.taxFilings.id });
      let reminder: FilingReminderResult = null;
      if (data.alsoReminder && data.kind !== "kdv_matrah") {
        const rems = (await tx.select().from(s.reminders).where(eq(s.reminders.active, true)).orderBy(asc(s.reminders.dueDate))) as ReminderRow[];
        const hits = filingReminders(rems, data.kind, data.period);
        reminder = hits.length === 1 ? "yazildi" : hits.length ? "birden_cok" : "yok";
        if (hits.length === 1) await tx.update(s.reminders).set({ amount: r2(clean.payable + clean.stamp) }).where(eq(s.reminders.id, hits[0].id));
      }
      return { id: row.id, reminder };
    });
    await logActivity(me, "Vergi: muhasebeci kaydı", filingLogText(data.kind, data.period, clean.payable, result.reminder));
    refresh();
    return { id: result.id, reminder: result.reminder, message: filingSavedText(data.kind, data.period, result.reminder) };
  });
}

/** Muhasebeci kaydını kaldırır: tahmin kullanılır (Ödemeler'deki tutara dokunulmaz) */
export async function deleteTaxFiling(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const fid = zId.parse(id);
    const [row] = await getDb().delete(s.taxFilings).where(eq(s.taxFilings.id, fid)).returning({ kind: s.taxFilings.kind, period: s.taxFilings.period });
    if (!row) throw new UserError("Kayıt bulunamadı (sayfayı yenileyin)");
    await logActivity(me, "Vergi: muhasebeci kaydı", `${filingTitle(row.kind, row.period)} kaldırıldı`);
    refresh();
    return { message: FILING_REMOVED_TEXT };
  });
}

// ---------------------------------------------------------------- Düzeltme (§4.5-b)

const adjustmentSchema = z.object({
  id: zId.nullish(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Ay seçin"),
  span: z.enum(["ay", "ceyrek"]).default("ay"),
  kind: z.enum(["gelir_kafe_disi", "gelir_diger", "gider_kafe_disi", "gider_belgeli", "kkeg", "indirim"]),
  amount: zMoney.max(1_000_000_000, "Tutar çok büyük").refine((v) => v > 0, "Tutar sıfırdan büyük olmalı"),
  label: zText("Açıklama", 120),
  note: zOptText(300),
});

/**
 * Panelin bilemediği gelir ve gider (KDV hariç). Çeyrek yalnız kafe dışı türlerde, tutar çeyreğin son ayına. Sonuçta
 * uyarılar: dönemin geçici vergi kaydı girildiyse düzeltme yalnız sonraki tahmini etkiler; beyanname matrahı olan aya
 * kafe dışı gelir zaten içindedir
 */
export async function saveTaxAdjustment(input: z.input<typeof adjustmentSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = adjustmentSchema.parse(input);
    const db = getDb();
    const settings = await readTaxSettings(db);
    const refusal = adjustmentRefusal(data, settings, todayTR());
    if (refusal) throw new UserError(refusal);
    const values = { month: data.month, span: data.span, kind: data.kind, amount: r2(data.amount), label: data.label, note: data.note };
    let id: number;
    if (data.id) {
      const [row] = await db
        .update(s.taxAdjustments)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(s.taxAdjustments.id, data.id))
        .returning({ id: s.taxAdjustments.id });
      if (!row) throw new UserError("Düzeltme bulunamadı (sayfayı yenileyin)");
      id = row.id;
    } else {
      const [row] = await db
        .insert(s.taxAdjustments)
        .values({ ...values, createdByName: me.name })
        .returning({ id: s.taxAdjustments.id });
      id = row.id;
    }
    const filings = await db
      .select({ kind: s.taxFilings.kind, period: s.taxFilings.period })
      .from(s.taxFilings)
      .where(inArray(s.taxFilings.period, [quarterOfMonth(data.month), data.month]));
    const warnings: string[] = [];
    if (filings.some((f) => f.kind === "gecici")) warnings.push("Bu dönemin beyannamesi girildi; düzeltme yalnız sonraki tahmini etkiler.");
    if (data.kind === "gelir_kafe_disi" && data.span === "ay" && filings.some((f) => f.kind === "kdv_matrah")) warnings.push(BEYANNAME_ADJ_WARNING);
    await logActivity(me, "Vergi: düzeltme", `${ADJUSTMENT_LABELS[data.kind]} · ${adjustmentPeriodLabel(data)} · ${money(r2(data.amount))}${data.id ? " · düzenlendi" : ""}`);
    refresh();
    return { id, warnings };
  });
}

export async function deleteTaxAdjustment(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const aid = zId.parse(id);
    const [row] = await getDb().delete(s.taxAdjustments).where(eq(s.taxAdjustments.id, aid)).returning({ kind: s.taxAdjustments.kind, month: s.taxAdjustments.month, span: s.taxAdjustments.span });
    if (!row) throw new UserError("Düzeltme bulunamadı (sayfayı yenileyin)");
    await logActivity(me, "Vergi: düzeltme", `${ADJUSTMENT_LABELS[row.kind]} · ${adjustmentPeriodLabel(row)} · kaldırıldı`);
    refresh();
    return null;
  });
}

// ---------------------------------------------------------------- Varlık (§3.3, §4.5-c)

const assetSchema = z.object({
  id: zId.nullish(),
  name: zText("Ad", 120),
  invoiceId: zId.nullish(),
  acquiredOn: zDate,
  cost: zMoney.max(1_000_000_000, "Tutar çok büyük").refine((v) => v > 0, "Maliyet sıfırdan büyük olmalı"),
  kind: z.enum(["demirbas", "ozel_maliyet", "diger"]).default("demirbas"),
  method: z.enum(["amortisman", "dogrudan_gider"]).default("amortisman"),
  lifeYears: z.number().int("Ömür tam yıl olmalı").nullish(),
  note: zOptText(300),
});

/**
 * Demirbaş ya da özel maliyet (K14): faturaya bağlanabilir (kafe kategorisinde; bağlı maliyetler faturanın netini
 * aşamaz, fatura satırı kilitlenir), fatura künyesi sunucuda yazılır. Doğrudan gider yalnız VUK 313 sınırına kadar;
 * ömür girilmezse amortisman 0
 */
export async function saveTaxAsset(input: z.input<typeof assetSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = assetSchema.parse(input);
    const lifeYears = data.method === "dogrudan_gider" ? null : (data.lifeYears ?? null);
    const id = await getDb().transaction(async (tx) => {
      let invoice: { category: string; remaining: number } | null = null;
      let invoiceLabel: string | null = null;
      if (data.invoiceId) {
        const [inv] = await tx
          .select({ id: s.invoices.id, supplier: s.invoices.supplier, date: s.invoices.date, category: s.invoices.category, amount: s.invoices.amount, discount: s.invoices.discount })
          .from(s.invoices)
          .where(eq(s.invoices.id, data.invoiceId))
          .for("update");
        if (!inv) throw new UserError("Fatura bulunamadı (sayfayı yenileyin)");
        const linked = await tx.select({ id: s.taxAssets.id, invoiceId: s.taxAssets.invoiceId, cost: s.taxAssets.cost }).from(s.taxAssets).where(eq(s.taxAssets.invoiceId, inv.id));
        invoice = { category: inv.category, remaining: invoiceRemaining(inv, linked, data.id ?? undefined) };
        invoiceLabel = invoiceLabelOf(inv);
      }
      const refusal = assetRefusal({ acquiredOn: data.acquiredOn, cost: data.cost, method: data.method, lifeYears }, invoice, todayTR());
      if (refusal) throw new UserError(refusal);
      const values = { name: data.name, invoiceId: data.invoiceId ?? null, acquiredOn: data.acquiredOn, cost: r2(data.cost), kind: data.kind, method: data.method, lifeYears, note: data.note };
      if (data.id) {
        // Faturası silinmiş varlık yeniden bağlanmadıkça künyesini korur
        const [row] = await tx
          .update(s.taxAssets)
          .set({ ...values, ...(invoiceLabel ? { invoiceLabel } : {}), updatedAt: new Date() })
          .where(eq(s.taxAssets.id, data.id))
          .returning({ id: s.taxAssets.id });
        if (!row) throw new UserError("Varlık bulunamadı (sayfayı yenileyin)");
        return row.id;
      }
      const [row] = await tx
        .insert(s.taxAssets)
        .values({ ...values, invoiceLabel, createdByName: me.name })
        .returning({ id: s.taxAssets.id });
      return row.id;
    });
    await logActivity(me, "Vergi: demirbaş", `${data.name} · ${money(r2(data.cost))}${data.id ? " · düzenlendi" : ""}`);
    refresh();
    return { id };
  });
}

export async function deleteTaxAsset(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const aid = zId.parse(id);
    const [row] = await getDb().delete(s.taxAssets).where(eq(s.taxAssets.id, aid)).returning({ name: s.taxAssets.name });
    if (!row) throw new UserError("Varlık bulunamadı (sayfayı yenileyin)");
    await logActivity(me, "Vergi: demirbaş", `${row.name} · kaldırıldı`);
    refresh();
    return null;
  });
}

// ---------------------------------------------------------------- Ayarlar'daki işveren SGK oranı (K19)

/**
 * Gelir-gider'in işveren SGK oranı (Ayarlar › `isverenSgk`): yalnız bu anahtar yazılır (saveStaffRates dört oranı birden
 * yazar; istemcinin eski değerlerle göndermesi başka sekmedeki değişikliği ezerdi). Bütün ayların gelir-gideri değişir
 */
export async function setEmployerSgkRate(rate: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const value = z
      .number({ message: "Oran girin" })
      .finite("Oran girin")
      .min(0, "Oran negatif olamaz")
      .max(EMPLOYER_SGK_MAX, "İşveren SGK oranı en çok %21,75")
      .parse(rate);
    const db = getDb();
    const prev = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(s.settings).where(eq(s.settings.key, "isverenSgk")).for("update");
      await tx
        .insert(s.settings)
        .values({ key: "isverenSgk", value })
        .onConflictDoUpdate({ target: s.settings.key, set: { value, updatedAt: new Date() } });
      return typeof row?.value === "number" ? row.value : DEFAULT_SETTINGS.isverenSgk;
    });
    await logActivity(me, "SGK oranları", `isverenSgk ${rateText(prev)} → ${rateText(value)} (Vergi)`);
    refresh();
    return null;
  });
}

"use server";

import { and, eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { splitSupplier } from "@/app/panel/faturalar/rules";
import { cleanAliases, nameConflict } from "@/app/panel/tedarikciler/logic";
import { COST_MODE_LABEL, COST_MODES, debtLabel, dueOf, invoiceLabel, type CostMode } from "@/lib/cari/account";
import { CARI_METHODS, EPS, METHOD_LABEL, methodFromCard, round2, type CariMethod } from "@/lib/cari/balance";
import { pastMonthLogSuffix, type MonthEffect } from "@/lib/cari/months";
import { dateTR, tl } from "@/lib/format";
import { addDays, postponeDate, todayTR } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
import {
  applyCredit,
  checkPast,
  deleteEntry,
  NeedsPastConfirm,
  payDebtTx,
  restoreEntry,
  rewriteAllocation,
  writeDebt,
  writePayment,
  type Card,
  type EntrySnapshot,
  type PaymentResult,
} from "@/server/cari/entries";
import { cardInvoiceIds, cardResolver, deleteAllocations, ensureCard, linkDebts, lockCard, lockCards, recomputeAllocated, resettle, unlinkDebt, type CardTarget, type Tx } from "@/server/cari/settle";
import { KASA_AYRI_KEY, KASA_AYRI_LIMIT } from "@/server/data/cari";
import { forgetPaid, rememberPaid } from "@/server/data/recent-paid";
import { supplierSlugOf } from "@/server/data/suppliers";
import { getDb, schema as s } from "@/server/db";
import { loadNotifySettings } from "@/server/notify/settings";
import { open, seal } from "@/server/secret-box";

import { logActivity } from "./log";
import { attempt, UserError, zAmount, zDate, zMonth, zOptText, zText } from "./util";

// Cari hesabın eylemleri (docs/TEDARIKCILER.md "Hesap hareketleri"): elle borç ve ödeme, dağıtım, faturaya bağlama,
// Kasa satırı. Yalnız yönetici; her dışa aktarım bir POST ucudur ve kendi denetimini yapar (tests/cari-guvenlik.test.ts).
// Yazım src/server/cari/entries.ts ve settle.ts'te; burada ayrıştırma, işlem, işlem geçmişi ve yenileme.

const zId = z.number().int().positive();
const zPositive = zAmount.refine((v) => v > 0, "Tutar girin");
const targetSchema = z.union([z.object({ cardId: zId }).strict(), z.object({ key: z.string().trim().min(1).max(300) }).strict()]);
const cashOutSchema = z.discriminatedUnion("mode", [z.object({ mode: z.literal("existing"), id: zId }), z.object({ mode: z.literal("new") })]);
const lineSchema = z.object({ kind: z.enum(["invoice", "debt"]), id: zId, amount: zAmount });
const allocationSchema = z.object({ mode: z.enum(["auto", "manual", "none"]), lines: z.array(lineSchema).max(500).default([]) });
const confirmSchema = z.array(zMonth).max(60).default([]);
const methodSchema = z.enum(CARI_METHODS);

/** "Geri al" kopyasının geçerlilik süresi (bildirimdeki düğme; Kasa'nın deseni) */
const UNDO_MS = 15 * 60_000;
const UNDO_PURPOSE = "cari-undo";

/** Kartın tahmini vade günü: kartta yoksa Ödemeler'deki genel ayar */
async function termDaysOf(card: Card): Promise<number> {
  return card.paymentTermDays ?? (await loadNotifySettings()).invoiceTermDays;
}

/** İşlem: geçmiş ay onayı eksikse yazılmadan geri döner (istemci ayları gösterip onay ister) */
async function inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<{ needs: "past"; effects: MonthEffect[] } | { needs: null; value: T }> {
  try {
    return { needs: null, value: await getDb().transaction(fn) };
  } catch (e) {
    if (e instanceof NeedsPastConfirm) return { needs: "past", effects: e.effects };
    throw e;
  }
}

/** "2 kaleme sayıldı (1 kapandı, 1 kısmen) · hesapta 0,00 ₺" */
function allocationText(lines: readonly { closed: boolean }[], left: number): string {
  const closed = lines.filter((l) => l.closed).length;
  const partial = lines.length - closed;
  const counted = !lines.length
    ? "hiçbir kaleme sayılmadı"
    : !partial
      ? `${lines.length} kalem kapandı`
      : `${lines.length} kaleme sayıldı (${[closed ? `${closed} kapandı` : "", `${partial} kısmen`].filter(Boolean).join(", ")})`;
  return `${counted} · hesapta ${tl(left, 2)}`;
}

const methodText = (m: CariMethod, card: Card) => (m === "kasa" ? `Kasadan (Teslim · ${card.name})` : METHOD_LABEL[m]);

/**
 * Yeni ödeme Ödemeler › Son ödenenler'e yazılır (30 gün geri alınabilir). Ödemenin o anki düzenlenme anı saklanır:
 * sonradan düzenlenen ödeme oradan silinmez (Tedarikçiler'den silinir)
 */
async function rememberPayment(card: Card, p: { id: number; date: string; amount: number; method: CariMethod; items: number }) {
  const [row] = await getDb().select({ updatedAt: s.supplierEntries.updatedAt }).from(s.supplierEntries).where(eq(s.supplierEntries.id, p.id)).limit(1);
  if (!row) return;
  await rememberPaid([{ kind: "cari", id: p.id, title: card.name, amount: p.amount, dueDate: p.date, method: p.method, items: p.items, stamp: row.updatedAt.toISOString() }]);
}

// ---------------------------------------------------------------- Borç

const debtSchema = z.object({
  target: targetSchema,
  id: zId.nullable(),
  date: zDate,
  amount: zPositive,
  description: zText("Ne alındı", 200),
  costMode: z.enum(COST_MODES),
  categoryId: zId.nullable(),
  adoptExpenseId: zId.nullable(),
  dueDate: zDate.nullable(),
  note: zOptText(1000),
  photoId: zId.nullable(),
  applyCredit: z.boolean(),
  paid: z.object({ method: methodSchema, date: zDate, cashOut: cashOutSchema.nullable() }).nullable(),
  confirmPast: confirmSchema,
});

/**
 * Borç ekle / Borcu düzenle (§3.1): faturasız ya da elden alım, eski borç. Kartsız tedarikçiye ilk kayıtta kart
 * açılır (K2). Geçmiş ayın giderini değiştirirse `{ needs: "past" }` döner, onaylanan aylarla yeniden gönderilir.
 */
export async function saveSupplierDebt(input: z.input<typeof debtSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const d = debtSchema.parse(input);
    const today = todayTR();
    if (d.date > addDays(today, 1)) throw new UserError("Alım günü ileri bir tarih olamaz");
    if (d.dueDate && d.dueDate < d.date) throw new UserError("Vade alım gününden önce olamaz");
    if (d.paid && d.paid.date > addDays(today, 1)) throw new UserError("Ödeme günü ileri bir tarih olamaz");
    const r = await inTx(async (tx) => {
      const { card, created } = await ensureCard(tx, d.target as CardTarget);
      const written = await writeDebt(tx, me, card, { ...d, description: d.description, note: d.note }, await termDaysOf(card));
      return { card, created, written };
    });
    if (r.needs) return r;
    const { card, created, written } = r.value;
    const what = d.description;
    const mode: Record<CostMode, string> = {
      fatura: "faturası gelecek",
      gider: `faturası yok · gidere yazıldı (${written.categoryName ?? "kategori"})`,
      mevcut: "gideri zaten girildi",
      devir: "eski borç (devir)",
    };
    const extra = [written.credited > EPS ? `hesaptaki ${tl(written.credited, 2)} sayıldı` : "", written.paid && d.paid ? `ödendi (${methodText(d.paid.method, card)})` : ""].filter(Boolean);
    const suffix = pastMonthLogSuffix(written.effects);
    if (written.prev) {
      const change = Math.abs(written.prev.amount - d.amount) >= 0.005 ? `${tl(written.prev.amount, 2)} → ${tl(d.amount, 2)}` : tl(d.amount, 2);
      await logActivity(me, "Cari borç düzeltildi", [card.name, dateTR(d.date), change, what, written.prev.costMode !== d.costMode ? COST_MODE_LABEL[d.costMode] : "", ...extra].filter(Boolean).join(" · ") + suffix);
    } else {
      await logActivity(me, "Cari borç eklendi", [card.name, dateTR(d.date), tl(d.amount, 2), what, mode[d.costMode], ...extra].join(" · ") + suffix);
    }
    if (written.paid?.created && d.paid) {
      await rememberPayment(card, { id: written.paid.id, date: d.paid.date, amount: round2(written.paid.lines.reduce((a, l) => a + l.amount, 0) + written.paid.left), method: d.paid.method, items: written.paid.lines.length });
    }
    refresh();
    return {
      needs: null,
      id: written.id,
      created: written.created,
      credited: written.credited,
      paidAmount: written.paid ? round2(written.paid.lines.reduce((a, l) => a + l.amount, 0)) : 0,
      paymentId: written.paid?.id ?? null,
      effects: written.effects,
      slug: created ? await supplierSlugOf(card.id) : null,
      cardId: card.id,
    };
  });
}

// ---------------------------------------------------------------- Ödeme

const paymentSchema = z.object({
  target: targetSchema,
  id: zId.nullable(),
  date: zDate,
  amount: zPositive,
  method: methodSchema,
  cashOut: cashOutSchema.nullable(),
  allocation: allocationSchema,
  note: zOptText(500),
  photoId: zId.nullable(),
});

/**
 * Ödeme ekle / Ödemeyi düzenle (§3.2): hesaba, kısmi, toptan, elden ya da kasadan. Yeni ödeme en eski borçtan,
 * seçilen kalemlere ya da hiçbir kaleme sayılır ("Hesapta beklesin"); kalan hesapta durur. İlk ödemede panel takibi
 * başlar (K4).
 */
export async function saveSupplierPayment(input: z.input<typeof paymentSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const p = paymentSchema.parse(input);
    if (p.date > addDays(todayTR(), 1)) throw new UserError("Ödeme günü ileri bir tarih olamaz");
    const { card, created, written } = await getDb().transaction(async (tx) => {
      const { card, created } = await ensureCard(tx, p.target as CardTarget);
      const written: PaymentResult = await writePayment(tx, me, card, { ...p, note: p.note }, await termDaysOf(card));
      return { card, created, written };
    });
    const detail = [card.name, dateTR(p.date), written.prev && Math.abs(written.prev.amount - p.amount) >= 0.005 ? `${tl(written.prev.amount, 2)} → ${tl(p.amount, 2)}` : tl(p.amount, 2), methodText(p.method, card)];
    if (written.created) await logActivity(me, "Cari ödeme eklendi", [...detail, allocationText(written.lines, written.left)].join(" · "));
    else await logActivity(me, "Cari ödeme düzeltildi", [...detail, `hesapta ${tl(written.left, 2)}`].join(" · "));
    if (written.created) await rememberPayment(card, { id: written.id, date: p.date, amount: p.amount, method: p.method, items: written.lines.length });
    refresh();
    return {
      id: written.id,
      created: written.created,
      lines: written.lines,
      left: written.left,
      closed: written.lines.filter((l) => l.closed).length,
      partial: written.lines.filter((l) => !l.closed).length,
      prev: written.prev,
      slug: created ? await supplierSlugOf(card.id) : null,
      cardId: card.id,
    };
  });
}

// ---------------------------------------------------------------- Silme ve geri alma

const undoSchema = z.object({ v: z.literal(1), by: z.number().int(), exp: z.number(), snap: z.unknown() });

/**
 * Kaydı siler (§3.4). Geri almak için mühürlü kopya döner (`undo`; istemci okuyamaz ve değiştiremez, 15 dakika). Borcun
 * kendi gider kaydı geçmiş aydaysa önce onay istenir.
 */
export async function deleteSupplierEntry(input: { id: number; confirmPast?: string[] }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const id = zId.parse(input.id);
    const confirmPast = confirmSchema.parse(input.confirmPast ?? []);
    const r = await inTx((tx) => deleteEntry(tx, id, confirmPast));
    if (r.needs) return r;
    const { card, snapshot, effects, reopened, kept, touched } = r.value;
    const e = snapshot.entry;
    if (e.kind === "borc") {
      await logActivity(me, "Cari borç silindi", [card.name, dateTR(e.date), tl(e.amount, 2), e.description ?? "", ...touched].filter(Boolean).join(" · ") + pastMonthLogSuffix(effects));
    } else {
      const after = [reopened ? `${reopened} fatura yeniden ödenmedi` : "", kept ? `${kept} fatura başka biçimde ödendi işaretli, bırakıldı` : ""].filter(Boolean).join("; ");
      await logActivity(me, "Cari ödeme silindi", [card.name, dateTR(e.date), tl(e.amount, 2), methodText((e.method ?? "diger") as CariMethod, card), after].filter(Boolean).join(" · "));
      await forgetPaid("cari", [e.id]);
    }
    refresh();
    const undo = seal(JSON.stringify({ v: 1, by: me.id, exp: Date.now() + UNDO_MS, snap: snapshot }), UNDO_PURPOSE);
    return { needs: null, undo, kind: e.kind, reopened, kept };
  });
}

/** Silinen kaydı aynı kimlikle geri getirir; kopya yeniden doğrulanır, sığmayan dağıtım hesapta kalır (R4b) */
export async function restoreSupplierEntry(undo: string) {
  return attempt(async () => {
    const me = await requireAdmin();
    const sealed = z.string().max(200_000).safeParse(undo);
    const opened = sealed.success ? open(sealed.data, UNDO_PURPOSE) : null;
    let parsed: z.infer<typeof undoSchema> | null = null;
    try {
      const r = undoSchema.safeParse(opened ? JSON.parse(opened) : null);
      parsed = r.success ? r.data : null;
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.by !== me.id || parsed.exp <= Date.now()) throw new UserError("Geri alma süresi doldu; kaydı yeniden girin");
    const snap = parsed.snap as EntrySnapshot;
    const { card, lost } = await getDb().transaction((tx) => restoreEntry(tx, me, snap));
    const e = snap.entry;
    await logActivity(
      me,
      "Cari kaydı geri alındı",
      [card.name, e.kind === "borc" ? "borç" : "ödeme", dateTR(e.date), tl(e.amount, 2), lost > EPS ? `${tl(lost, 2)} yeniden sayılamadı, hesapta` : ""].filter(Boolean).join(" · "),
    );
    refresh();
    return { lost };
  });
}

// ---------------------------------------------------------------- Dağıtım

/** Borçlara say: kartın hesabındaki sayılmamış para en eski vadeden açık kalemlere sayılır */
export async function applySupplierCredit(input: { cardId: number }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const cardId = zId.parse(input.cardId);
    const { card, r } = await getDb().transaction(async (tx) => {
      const card = await lockCard(tx, cardId);
      return { card, r: await applyCredit(tx, me, card, await termDaysOf(card)) };
    });
    if (r.total <= EPS) throw new UserError("Hesapta sayılacak para ya da açık kalem yok");
    await logActivity(me, "Hesaptaki ödeme borçlara sayıldı", `${card.name} · ${tl(r.total, 2)} → ${r.lines.map((l) => `${l.label} ${tl(l.amount, 2)}`).join(", ")}`);
    refresh();
    return r;
  });
}

const setAllocationSchema = z.object({ paymentId: zId, mode: z.enum(["auto", "manual", "none"]), lines: z.array(lineSchema).max(500).default([]) });

/** Neye sayıldı: ödemenin dağıtımını baştan yazar; önceki satırlar "Geri al" için döner */
export async function setPaymentAllocation(input: z.input<typeof setAllocationSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const a = setAllocationSchema.parse(input);
    const { card, r } = await getDb().transaction(async (tx) => {
      const [peek] = await tx.select({ supplierId: s.supplierEntries.supplierId }).from(s.supplierEntries).where(eq(s.supplierEntries.id, a.paymentId)).limit(1);
      if (!peek) throw new UserError("Ödeme bulunamadı; silinmiş olabilir. Sayfayı yenileyin.");
      const card = await lockCard(tx, peek.supplierId);
      return { card, r: await rewriteAllocation(tx, me, card, a.paymentId, { mode: a.mode, lines: a.lines }, await termDaysOf(card)) };
    });
    await logActivity(me, "Ödemenin dağıtımı değişti", [card.name, `${dateTR(r.date)} ödemesi (${tl(r.amount, 2)})`, allocationText(r.lines, r.left)].join(" · "));
    refresh();
    return { previous: r.previous, lines: r.lines, left: r.left };
  });
}

/**
 * Ödemeden çıkar: dağıtımlar silinir, para ödemenin hesabına döner (defterin kapattığı fatura yeniden açılır).
 * "Borçlara say"ın geri alınması da bununla. Döner: ödemelerin önceki satırları (tek ödemede "Geri al").
 */
export async function removeAllocations(input: { allocationIds: number[] }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const ids = z.array(zId).min(1, "Dağıtım seçin").max(1000).parse(input.allocationIds);
    const r = await getDb().transaction(async (tx) => {
      const rows = await tx
        .select({ id: s.supplierAllocations.id, paymentId: s.supplierAllocations.paymentId, card: s.supplierEntries.supplierId })
        .from(s.supplierAllocations)
        .innerJoin(s.supplierEntries, eq(s.supplierAllocations.paymentId, s.supplierEntries.id))
        .where(inArray(s.supplierAllocations.id, ids));
      if (!rows.length) throw new UserError("Dağıtım bulunamadı; değişmiş olabilir. Sayfayı yenileyin.");
      await lockCards(tx, rows.map((x) => x.card));
      const paymentIds = [...new Set(rows.map((x) => x.paymentId))];
      const before = await tx.select().from(s.supplierAllocations).where(inArray(s.supplierAllocations.paymentId, paymentIds));
      const removed = await deleteAllocations(tx, { ids: rows.map((x) => x.id) });
      const invoices = removed.flatMap((x) => (x.invoiceId !== null ? [x.invoiceId] : []));
      await recomputeAllocated(tx, invoices);
      const settled = await resettle(tx, invoices);
      const [card] = await tx.select().from(s.suppliers).where(eq(s.suppliers.id, rows[0].card)).limit(1);
      const labels = await targetLabels(tx, removed);
      const [pay] = await tx.select({ date: s.supplierEntries.date }).from(s.supplierEntries).where(eq(s.supplierEntries.id, paymentIds[0])).limit(1);
      return {
        card,
        removed,
        labels,
        reopened: settled.reopened.length,
        paymentDate: pay?.date ?? null,
        previous: paymentIds.map((pid) => ({
          paymentId: pid,
          lines: before.filter((b) => b.paymentId === pid).map((b) => ({ kind: b.invoiceId !== null ? ("invoice" as const) : ("debt" as const), id: (b.invoiceId ?? b.debtId)!, amount: b.amount })),
        })),
      };
    });
    const total = round2(r.removed.reduce((a, x) => a + x.amount, 0));
    await logActivity(
      me,
      "Ödeme kalemden çıkarıldı",
      [r.card?.name ?? "", r.paymentDate && r.previous.length === 1 ? `${dateTR(r.paymentDate).slice(0, 5)} ödemesi` : "", `${r.labels.join(", ")} ${tl(total, 2)} hesaba geçti`].filter(Boolean).join(" · "),
    );
    refresh();
    return { total, reopened: r.reopened, previous: r.previous };
  });
}

/** Dağıtımların kalem adları (işlem geçmişi) */
async function targetLabels(tx: Tx, rows: readonly { invoiceId: number | null; debtId: number | null }[]): Promise<string[]> {
  const inv = rows.flatMap((r) => (r.invoiceId !== null ? [r.invoiceId] : []));
  const debts = rows.flatMap((r) => (r.debtId !== null ? [r.debtId] : []));
  const [a, b] = await Promise.all([
    inv.length ? tx.select({ invoiceNo: s.invoices.invoiceNo, date: s.invoices.date }).from(s.invoices).where(inArray(s.invoices.id, inv)) : [],
    debts.length ? tx.select({ description: s.supplierEntries.description, date: s.supplierEntries.date }).from(s.supplierEntries).where(inArray(s.supplierEntries.id, debts)) : [],
  ]);
  return [...a.map((x) => invoiceLabel(x)), ...b.map((x) => debtLabel(x))];
}

/** Düzelt (K12): grubun faturalarının sayılan toplamı dağıtımlardan yeniden yazılır, ödendi işaretleri yeniden dengelenir */
export async function fixAllocatedDrift(input: { cardId: number }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const cardId = zId.parse(input.cardId);
    const card = await getDb().transaction(async (tx) => {
      const card = await lockCard(tx, cardId);
      const ids = await cardInvoiceIds(tx, cardId);
      await recomputeAllocated(tx, ids);
      await resettle(tx, ids);
      return card;
    });
    await logActivity(me, "Cari toplamları düzeltildi", card.name);
    refresh();
    return null;
  });
}

// ---------------------------------------------------------------- Faturası geldi (bağlama)

const linkSchema = z.object({ cardId: zId, debtIds: z.array(zId).min(1, "Alım seçin").max(100), invoiceId: zId, addAlias: z.boolean().default(false), confirmPast: confirmSchema });

/**
 * Faturası geldi (§5.2): bir ya da birkaç faturasız alım tek faturaya bağlanır. Borca sayılan ödemeler faturaya geçer,
 * borcun gider kaydı silinir (geçmiş aysa onay), önceki hâli saklanır. Fatura başka bir tedarikçide görünebilir (R3d):
 * adı kartsızsa `addAlias` ile kartın diğer adı olur (o adla gelen faturalar bu karta geçer); başka bir kartınsa iki
 * kart kimlik sırasıyla kilitlenir, ad eklenmez, fatura o tedarikçide görünmeye devam eder.
 */
export async function linkDebtsToInvoice(input: z.input<typeof linkSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const l = linkSchema.parse(input);
    const r = await inTx(async (tx) => {
      // Faturanın tedarikçisi: bu kart, kartsız ya da başka bir kart (iki kartlı işlemde kartlar kimlik sırasıyla kilitlenir)
      const [peek] = await tx.select({ supplier: s.invoices.supplier, tax: s.invoices.supplierTaxNumber }).from(s.invoices).where(eq(s.invoices.id, l.invoiceId)).limit(1);
      if (!peek) throw new UserError("Fatura bulunamadı; silinmiş olabilir. Sayfayı yenileyin.");
      const owner = (await cardResolver(tx))(peek.supplier, peek.tax);
      await lockCards(tx, owner !== null && owner !== l.cardId ? [l.cardId, owner] : [l.cardId]);
      const card = await lockCard(tx, l.cardId);
      const debts = await tx.select().from(s.supplierEntries).where(inArray(s.supplierEntries.id, l.debtIds));
      if (debts.length !== new Set(l.debtIds).size || debts.some((d) => d.supplierId !== card.id || d.kind !== "borc")) throw new UserError("Alım bulunamadı; değişmiş olabilir. Sayfayı yenileyin.");
      let aliasAdded: string | null = null;
      let elsewhere: string | null = null;
      if (owner !== card.id) {
        if (owner === null && l.addAlias) {
          const alias = splitSupplier(peek.supplier).base.trim() || peek.supplier.trim();
          const all = await tx.select({ id: s.suppliers.id, name: s.suppliers.name, aliases: s.suppliers.aliases }).from(s.suppliers);
          const conflict = nameConflict({ id: card.id, name: card.name, aliases: [alias] }, all);
          if (conflict) throw new UserError(`‘${alias}’ adı ${conflict.owner} tedarikçisinde kayıtlı; diğer ad olarak eklenemez.`);
          await tx
            .update(s.suppliers)
            .set({ aliases: cleanAliases(card.name, [...card.aliases, alias], null), updatedAt: new Date() })
            .where(eq(s.suppliers.id, card.id));
          aliasAdded = alias;
        } else if (owner !== null) {
          const [o] = await tx.select({ name: s.suppliers.name }).from(s.suppliers).where(eq(s.suppliers.id, owner)).limit(1);
          elsewhere = o?.name ?? peek.supplier;
        } else {
          elsewhere = splitSupplier(peek.supplier).base.trim() || peek.supplier;
        }
      }
      const owned = await tx
        .select({ date: s.expenseEntries.date, amount: s.expenseEntries.amount })
        .from(s.expenseEntries)
        .where(inArray(s.expenseEntries.supplierEntryId, l.debtIds));
      // Bağlama borçların gider kayıtlarını siler
      const effects = checkPast(owned.map((o) => ({ date: o.date, delta: -o.amount })), l.confirmPast);
      const res = await linkDebts(tx, l.debtIds, l.invoiceId);
      const [inv] = await tx.select({ invoiceNo: s.invoices.invoiceNo, date: s.invoices.date, payable: s.invoices.payable }).from(s.invoices).where(eq(s.invoices.id, l.invoiceId)).limit(1);
      return { card, debts, inv, res, effects, aliasAdded, elsewhere };
    });
    if (r.needs) return r;
    const { card, debts, inv, res, effects, aliasAdded, elsewhere } = r.value;
    const total = round2(debts.reduce((a, d) => a + d.amount, 0));
    await logActivity(
      me,
      "Faturasız alım faturaya bağlandı",
      `${card.name} · ${debts.length} alım (${tl(total, 2)}) → ${inv ? invoiceLabel(inv) : "fatura"} (${tl(inv?.payable ?? 0, 2)}) · fark ${tl(round2((inv?.payable ?? 0) - total), 2)}${res.trimmed > EPS ? ` · ${tl(res.trimmed, 2)} hesaba geçti` : ""}${
        aliasAdded ? ` · diğer adlara eklendi: ${aliasAdded}` : elsewhere ? ` · fatura ${elsewhere} tedarikçisinde görünüyor` : ""
      }${pastMonthLogSuffix(effects)}`,
    );
    refresh();
    return { needs: null, trimmed: res.trimmed, effects, aliasAdded, elsewhere };
  });
}

const unlinkSchema = z.object({ debtIds: z.array(zId).min(1).max(100), confirmPast: confirmSchema });

/** Bağı kaldır: borçlar eski hâline döner (gider kaydı yeniden yazılır; geçmiş aysa onay), ödemeleri borca geri taşınır */
export async function unlinkDebts(input: z.input<typeof unlinkSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const u = unlinkSchema.parse(input);
    const r = await inTx(async (tx) => {
      const debts = await tx.select().from(s.supplierEntries).where(inArray(s.supplierEntries.id, u.debtIds));
      if (debts.length !== new Set(u.debtIds).size || debts.some((d) => d.kind !== "borc")) throw new UserError("Alım bulunamadı; değişmiş olabilir. Sayfayı yenileyin.");
      await lockCards(tx, debts.map((d) => d.supplierId));
      // Bağ kaldırma bağlarken silinen gider kayıtlarını yeniden yazar
      const effects = checkPast(
        debts.flatMap((d) => (d.linkPrev?.expense && (d.linkPrev.costMode === "gider" || d.linkPrev.costMode === "mevcut") ? [{ date: d.linkPrev.expense.date, delta: d.linkPrev.expense.amount }] : [])),
        u.confirmPast,
      );
      const labels: string[] = [];
      let rewritten = 0;
      let invoiceLabelText = "";
      for (const d of [...debts].sort((a, b) => a.id - b.id)) {
        const res = await unlinkDebt(tx, d.id, me.name);
        if (res.expense) rewritten++;
        labels.push(`${dateTR(d.date).slice(0, 5)} ${d.description ?? ""}`.trim());
        if (!invoiceLabelText) {
          const [inv] = await tx.select({ invoiceNo: s.invoices.invoiceNo, date: s.invoices.date }).from(s.invoices).where(eq(s.invoices.id, res.invoiceId)).limit(1);
          invoiceLabelText = inv ? invoiceLabel(inv) : "";
        }
      }
      const [card] = await tx.select().from(s.suppliers).where(eq(s.suppliers.id, debts[0].supplierId)).limit(1);
      return { card, labels, rewritten, invoiceLabelText, effects };
    });
    if (r.needs) return r;
    const v = r.value;
    await logActivity(
      me,
      "Faturaya bağ kaldırıldı",
      [v.card?.name ?? "", `${v.invoiceLabelText} ← ${v.labels.join(", ")}`, v.rewritten ? "gider kaydı yeniden yazıldı" : ""].filter(Boolean).join(" · ") + pastMonthLogSuffix(v.effects),
    );
    refresh();
    return { needs: null, effects: v.effects };
  });
}

/** Ayrı alım: aday faturayı bu alımların faturası saymaz (aday bir daha önerilmez); `undo` geri alır */
export async function dismissLinkCandidate(input: { debtIds: number[]; invoiceId: number; undo?: boolean }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const debtIds = z.array(zId).min(1).max(100).parse(input.debtIds);
    const invoiceId = zId.parse(input.invoiceId);
    const undo = z.boolean().optional().parse(input.undo) ?? false;
    const rows = await getDb().transaction(async (tx) => {
      const rows = await tx.select().from(s.supplierEntries).where(and(inArray(s.supplierEntries.id, debtIds), eq(s.supplierEntries.kind, "borc")));
      await lockCards(tx, rows.map((r) => r.supplierId));
      for (const r of rows) {
        const cur = Array.isArray(r.dismissedInvoiceIds) ? r.dismissedInvoiceIds : [];
        const next = undo ? cur.filter((x) => x !== invoiceId) : [...new Set([...cur, invoiceId])].slice(-200);
        await tx.update(s.supplierEntries).set({ dismissedInvoiceIds: next, updatedAt: new Date() }).where(eq(s.supplierEntries.id, r.id));
      }
      return rows;
    });
    if (!rows.length) throw new UserError("Alım bulunamadı; sayfayı yenileyin.");
    if (!undo) await logActivity(me, "Ayrı alım işaretlendi", `${rows.map((r) => debtLabel(r)).join(", ")} · fatura #${invoiceId} bu alımın faturası değil`);
    refresh();
    return null;
  });
}

/** Faturası 45 gündür gelmeyen alımda "Beklemeye devam": uyarı 45 gün sonra yeniden çıkar */
export async function snoozeDebt(input: { debtId: number }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const debtId = zId.parse(input.debtId);
    const until = addDays(todayTR(), 45);
    const [row] = await getDb().update(s.supplierEntries).set({ remindAfter: until, updatedAt: new Date() }).where(and(eq(s.supplierEntries.id, debtId), eq(s.supplierEntries.kind, "borc"))).returning();
    if (!row) throw new UserError("Alım bulunamadı; sayfayı yenileyin.");
    await logActivity(me, "Faturası gelmeyen alım beklemeye alındı", `${dateTR(row.date)} ${row.description ?? ""} · ${tl(row.amount, 2)} · ${dateTR(until)} tarihine kadar`);
    refresh();
    return { until };
  });
}

// ---------------------------------------------------------------- Ödemeler'deki cari kalem

/**
 * Ödemeler'de faturasız alımın "Ödendi"si: hesaptaki para önce sayılır, kalan için bugünkü tarihle kartın ödeme
 * şekliyle ödeme kaydı açılır ("Nakit" kasa dışı elden). Geri almak için ödeme ve sayılan dağıtımlar döner.
 */
export async function payDebt(debtId: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const id = zId.parse(debtId);
    const { card, r } = await getDb().transaction(async (tx) => {
      const [peek] = await tx.select({ supplierId: s.supplierEntries.supplierId }).from(s.supplierEntries).where(eq(s.supplierEntries.id, id)).limit(1);
      if (!peek) throw new UserError("Alım bulunamadı; silinmiş olabilir. Sayfayı yenileyin.");
      const card = await lockCard(tx, peek.supplierId);
      const method = methodFromCard(card.paymentMethod);
      return { card, r: await payDebtTx(tx, me, card, id, method, await termDaysOf(card)) };
    });
    const method = r.payment ? methodText(methodFromCard(card.paymentMethod), card) : null;
    await logActivity(me, "Faturasız alım ödendi", [card.name, r.label, tl(r.amount, 2), r.credited > EPS ? `hesaptaki ${tl(r.credited, 2)} sayıldı` : "", method ?? ""].filter(Boolean).join(" · "));
    if (r.payment) await rememberPayment(card, { id: r.payment.id, date: todayTR(), amount: round2(r.amount - r.credited), method: methodFromCard(card.paymentMethod), items: 1 });
    refresh();
    return {
      paymentId: r.payment?.id ?? null,
      creditAllocationIds: r.creditAllocationIds,
      credited: r.credited,
      amount: r.amount,
      method: r.payment ? methodFromCard(card.paymentMethod) : null,
    };
  });
}

/** Ertele: faturasız alımın vadesini bir hafta ya da bir ay öteler; önceki vade "Geri al" için döner */
export async function postponeSupplierDebt(debtId: number, by: "week" | "month") {
  return attempt(async () => {
    const me = await requireAdmin();
    const id = zId.parse(debtId);
    const step = z.enum(["week", "month"]).parse(by);
    const db = getDb();
    const [d] = await db.select().from(s.supplierEntries).where(and(eq(s.supplierEntries.id, id), eq(s.supplierEntries.kind, "borc"))).limit(1);
    if (!d) throw new UserError("Alım bulunamadı; sayfayı yenileyin.");
    const [card] = await db.select().from(s.suppliers).where(eq(s.suppliers.id, d.supplierId)).limit(1);
    const due = dueOf(d, card ? await termDaysOf(card) : 30).date;
    const next = postponeDate(due, step, todayTR());
    await db.update(s.supplierEntries).set({ dueDate: next, updatedAt: new Date() }).where(eq(s.supplierEntries.id, id));
    await logActivity(me, "Faturasız alım ertelendi", `${card?.name ?? ""} · ${debtLabel(d)} · ${dateTR(due)} → ${dateTR(next)}`);
    refresh();
    return { previous: d.dueDate, dueDate: next };
  });
}

/** Ertelemenin geri alınması: vade önceki hâline (boşsa tahmini vadeye) döner */
export async function setSupplierDebtDueDate(debtId: number, due: string | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const id = zId.parse(debtId);
    const date = zDate.nullable().parse(due);
    const [row] = await getDb().update(s.supplierEntries).set({ dueDate: date, updatedAt: new Date() }).where(and(eq(s.supplierEntries.id, id), eq(s.supplierEntries.kind, "borc"))).returning();
    if (!row) throw new UserError("Alım bulunamadı; sayfayı yenileyin.");
    if (row.dueDate && row.dueDate < row.date) throw new UserError("Vade alım gününden önce olamaz");
    await logActivity(me, "Faturasız alımın vadesi değişti", `${debtLabel(row)} · ${date ? dateTR(date) : "tahmini vade"}`);
    refresh();
    return null;
  });
}

// ---------------------------------------------------------------- Kasa satırı

/** Ayrı tut / Ayrı alım: Kasa satırı tedarikçinin hesabına işlenmeyecek (şeritten ve zilden düşer); `undo` geri alır */
export async function dismissCashOut(input: { cashOutId: number; undo?: boolean }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const id = zId.parse(input.cashOutId);
    const undo = z.boolean().optional().parse(input.undo) ?? false;
    const db = getDb();
    const line = await db.transaction(async (tx) => {
      const [line] = await tx.select().from(s.cashOuts).where(eq(s.cashOuts.id, id)).limit(1);
      if (!line) throw new UserError("Kasa satırı bulunamadı; silinmiş olabilir.");
      await tx.insert(s.integrationState).values({ key: KASA_AYRI_KEY, value: [] }).onConflictDoNothing();
      const [state] = await tx.select().from(s.integrationState).where(eq(s.integrationState.key, KASA_AYRI_KEY)).for("update").limit(1);
      const cur = Array.isArray(state?.value) ? (state.value as unknown[]).filter((x): x is number => Number.isInteger(x)) : [];
      const next = undo ? cur.filter((x) => x !== id) : [...cur.filter((x) => x !== id), id].slice(-KASA_AYRI_LIMIT);
      await tx.update(s.integrationState).set({ value: next, updatedAt: new Date() }).where(eq(s.integrationState.key, KASA_AYRI_KEY));
      return line;
    });
    if (!undo) await logActivity(me, "Kasa satırı ayrı tutuldu", `${dateTR(line.date).slice(0, 5)} · ${line.kind === "teslim" ? "Teslim" : "Alışveriş"} · ${line.store ?? ""}`);
    refresh();
    return null;
  });
}

import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, notExists, notInArray, sql } from "drizzle-orm";
import { z } from "zod";

import { supplierResolver } from "@/app/panel/tedarikciler/logic";
import { CASH_OUT_INVOICE_WINDOW, cashOutInvoiceDay, matchCashOutInvoices, nameKey, sameStoreName, type CashOutDocType } from "@/lib/cash-outs";
import { addDays, todayTR } from "@/lib/reminders";
import { getDb, schema as s, type DB } from "@/server/db";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/*
 * Kasadan faturalı alımlar (denetim 26 Eki, E-42; docs/KASA-RAPORU.md "Faturalı alımlar"): personelin Kasa'ya girdiği
 * fatura ya da e-Arşiv belgeli alışveriş Aylık harcamalar'a yazılmaz (staffToExpenses: Paraşüt'ten de gelir, iki kez
 * sayılmasın). Ama e-Arşiv ve kâğıt fatura Paraşüt'e kendiliğinden düşmez (docs/PARASUT.md): eşleşen faturası
 * gelmeyen satır hiçbir hesaba girmezdi. Bekleyen liste: belgesi fatura ya da e-Arşiv, Aylık harcamalar'da kaydı yok,
 * bir tedarikçi ödemesine bağlı değil, yöneticinin elle kapatmadığı ve aynı mağazadan ±7 gün, ±1 ₺ içinde faturası
 * olmayan satırlar. Zil, Bugün ve Faturalar'ın Kontrol süzgeci gösterir; eşleşen fatura gelince kendiliğinden kalkar.
 * Aylık harcamalar'a yazılmış satırın faturası sonradan gelirse alım iki kez sayılıyordur: aynı yerlerde "faturası geldi,
 * gider kaydını silin" diye çıkar (inceleme D2).
 */

/**
 * Yöneticinin kapattığı satırlar (integration_state): "Listeden çıkar" (`invoiceId` yok) ya da "Faturalar'a ekle" ile
 * açılan fatura (`invoiceId`; fatura silinirse satır yeniden bekler). En yeni CASH_OUT_INVOICE_LIMIT kayıt tutulur.
 */
export const CASH_OUT_INVOICE_KEY = "cashOuts.invoiceHandled";
export const CASH_OUT_INVOICE_LIMIT = 2000;

const handledSchema = z.array(z.object({ id: z.number().int().positive(), invoiceId: z.number().int().positive().nullish(), by: z.string(), at: z.string() }));
export type HandledCashOut = z.infer<typeof handledSchema>[number];

function parseHandled(value: unknown): HandledCashOut[] {
  if (!Array.isArray(value)) return [];
  // Bozuk bir satır listenin kalanını düşürmesin
  return value.flatMap((v) => {
    const r = handledSchema.element.safeParse(v);
    return r.success ? [r.data] : [];
  });
}

/** Kapatılmış satırlar */
export async function loadHandledCashOuts(db: DB | Tx = getDb()): Promise<HandledCashOut[]> {
  const [row] = await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, CASH_OUT_INVOICE_KEY)).limit(1);
  return parseHandled(row?.value);
}

/**
 * Kapatılmış satırlara ekler ya da çıkarır (aynı satırın eski kaydının yerine yenisi); durum satırı kilitli okunur (iki
 * sekme aynı anda yazınca biri ötekini ezmesin)
 */
export async function updateHandledCashOuts(tx: Tx, change: { add?: readonly Omit<HandledCashOut, "at">[]; remove?: readonly number[] }) {
  if (!change.add?.length && !change.remove?.length) return;
  await tx.insert(s.integrationState).values({ key: CASH_OUT_INVOICE_KEY, value: [] }).onConflictDoNothing();
  const [row] = await tx.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, CASH_OUT_INVOICE_KEY)).for("update").limit(1);
  const drop = new Set([...(change.remove ?? []), ...(change.add ?? []).map((a) => a.id)]);
  const at = new Date().toISOString();
  const next = [...parseHandled(row?.value).filter((h) => !drop.has(h.id)), ...(change.add ?? []).map((a) => ({ ...a, at }))].slice(-CASH_OUT_INVOICE_LIMIT);
  await tx.update(s.integrationState).set({ value: next, updatedAt: new Date() }).where(eq(s.integrationState.key, CASH_OUT_INVOICE_KEY));
}

/** Bekleyen satır (yalnız yönetici görür: tutar ve belge) */
export interface PendingCashOutInvoice {
  id: number;
  date: string;
  receiptDate: string | null;
  store: string | null;
  description: string | null;
  amount: number;
  vat: number | null;
  docType: CashOutDocType;
  receiptNo: string | null;
  photoId: number | null;
  createdByName: string;
  /** Aynı yerin son Kasa harcamasının kategorisi ("Aylık harcamalar'a yaz"ın önerisi); yoksa null */
  suggestedCategoryId: number | null;
}

/**
 * İki kez sayılan satır (yalnız yönetici görür): Aylık harcamalar'a yazılmış kasadan faturalı alımın faturası sonradan
 * Faturalar'a geldi (muhasebeci e-Arşiv'i Paraşüt'e girdi). Alım hem faturada hem gider kaydında sayılıyor; kayıt
 * silinmeli ("Ayrı alım" denirse listeden çıkar).
 */
export interface DuplicateCashOutInvoice extends Omit<PendingCashOutInvoice, "suggestedCategoryId"> {
  /** Aylık harcamalar'daki kayıt ve kategorisi */
  expenseId: number;
  expenseCategory: string | null;
  /** Eşleşen fatura */
  invoice: { id: number; date: string; supplier: string; invoiceNo: string | null; payable: number };
}

export interface CashOutInvoiceState {
  /** Faturası yok, hiçbir hesaba girmedi (yeniden eskiye) */
  pending: PendingCashOutInvoice[];
  /** Aylık harcamalar'a yazılmış, sonra faturası gelmiş: iki kez sayılıyor (yeniden eskiye) */
  duplicates: DuplicateCashOutInvoice[];
}

/**
 * Bakılan en eski kasa günü: bugünden bu kadar gün önce (daha eskisi kapanmış yıldadır). Kapatılan satırlar sorguda
 * dışarıda kalır; sınır olmasa yıllar içinde biriken eşleşmiş satırlar her zil açılışında okunurdu.
 */
export const CASH_OUT_INVOICE_HORIZON_DAYS = 365;

/**
 * Bekleyen kasadan faturalı alımlar, yeniden eskiye. `ids` verilirse yalnız onlar döner (eylemlerin denetimi: satır
 * hâlâ bekliyor mu); eşleştirme yine bütün satırlarla yapılır (liste ile eylem aynı satırı bekleyen görsün).
 */
export async function loadPendingCashOutInvoices(db: DB | Tx = getDb(), opts: { ids?: readonly number[] } = {}): Promise<PendingCashOutInvoice[]> {
  return (await loadCashOutInvoiceState(db, opts)).pending;
}

/**
 * Kasadan faturalı alımların durumu: bekleyenler ve iki kez sayılanlar. Eşleştirme havuzu: son bir yılın fatura ya da
 * e-Arşiv belgeli harcama satırları (tedarikçi ödemesine bağlı olmayan, yöneticinin kapatmadığı). Aylık harcamalar'a
 * yazılmış satır da havuzdadır: kendi faturasını alır (bir başka bekleyeni kapatmasın), aldıysa iki kez sayılıyordur;
 * hiçbir zaman bekleyen değildir. "Faturalar'a ekle" ile faturasına bağlanmış satırın sonradan gider kaydı olduysa (fatura
 * silinip geri alınırken yazılmış ya da Kasa'da yöneticinin anahtarıyla) o da iki kez sayılıyordur. `ids` verilirse
 * eşleştirmeden sonra yalnız onlar döner.
 */
export async function loadCashOutInvoiceState(db: DB | Tx = getDb(), opts: { ids?: readonly number[] } = {}): Promise<CashOutInvoiceState> {
  if (opts.ids && !opts.ids.length) return { pending: [], duplicates: [] };
  const co = s.cashOuts;
  // Kapatılanlar: "Listeden çıkar" ya da hâlâ duran bir faturayla "Faturalar'a ekle" (önce okunur: sorguda dışarıda
  // kalsınlar, sınırı doldurmasınlar)
  const handled = await loadHandledCashOuts(db);
  const linkedIds = [...new Set(handled.map((h) => h.invoiceId).filter((x): x is number => typeof x === "number"))];
  const alive = new Set(
    linkedIds.length ? (await db.select({ id: s.invoices.id }).from(s.invoices).where(inArray(s.invoices.id, linkedIds))).map((r) => r.id) : [],
  );
  const closed = [...new Set(handled.filter((h) => !h.invoiceId || alive.has(h.invoiceId)).map((h) => h.id))];
  // "Faturalar'a ekle" ile faturasına bağlı satırlar → fatura
  const adopted = new Map(handled.filter((h) => h.invoiceId && alive.has(h.invoiceId)).map((h) => [h.id, h.invoiceId!]));
  const horizon = addDays(todayTR(), -CASH_OUT_INVOICE_HORIZON_DAYS);
  const fields = {
    id: co.id,
    date: co.date,
    receiptDate: co.receiptDate,
    store: co.store,
    description: co.description,
    amount: co.amount,
    vat: co.vat,
    docType: co.docType,
    receiptNo: co.receiptNo,
    photoId: co.photoId,
    createdByName: co.createdByName,
    // Aylık harcamalar'daki kaydı (personel kuralı dışında yöneticinin anahtarıyla ya da buradan yazılmış)
    expenseId: s.expenseEntries.id,
    expenseCategory: s.expenseCategories.name,
    // Kayıt bir cari borcun ("Gideri zaten girildi"): faturası Tedarikçiler'de borca bağlanır, bağlama kaydı siler
    expenseDebtId: s.expenseEntries.supplierEntryId,
  };
  // Tedarikçi ödemesine bağlı satır cari hesabında izlenir (borç, faturası orada bağlanır)
  const notPayment = notExists(db.select({ one: sql`1` }).from(s.supplierEntries).where(eq(s.supplierEntries.cashOutId, co.id)));
  const [rows, adoptedRows] = await Promise.all([
    db
      .select(fields)
      .from(co)
      .leftJoin(s.expenseEntries, eq(s.expenseEntries.cashOutId, co.id))
      .leftJoin(s.expenseCategories, eq(s.expenseCategories.id, s.expenseEntries.categoryId))
      .where(
        and(
          eq(co.kind, "harcama"),
          inArray(co.docType, ["fatura", "e_arsiv"]),
          gte(co.date, horizon),
          closed.length ? notInArray(co.id, closed) : undefined,
          notPayment,
        ),
      )
      .orderBy(desc(co.date), desc(co.id)),
    // Faturasına bağlı satırlardan gider kaydı olanlar (cari borcun kaydı değil)
    adopted.size
      ? db
          .select(fields)
          .from(co)
          .innerJoin(s.expenseEntries, eq(s.expenseEntries.cashOutId, co.id))
          .leftJoin(s.expenseCategories, eq(s.expenseCategories.id, s.expenseEntries.categoryId))
          .where(and(inArray(co.id, [...adopted.keys()]), eq(co.kind, "harcama"), gte(co.date, horizon), isNull(s.expenseEntries.supplierEntryId), notPayment))
          .orderBy(desc(co.date), desc(co.id))
      : Promise.resolve([] as never[]),
  ]);
  if (!rows.length && !adoptedRows.length) return { pending: [], duplicates: [] };

  // Pencerenin faturaları (±7 gün) ve tedarikçi kartları (diğer adları, vergi no): aynı karta giden ad aynı mağazadır
  const days = rows.map(cashOutInvoiceDay).sort();
  const from = days.length ? addDays(days[0], -CASH_OUT_INVOICE_WINDOW.days) : null;
  const to = days.length ? addDays(days[days.length - 1], CASH_OUT_INVOICE_WINDOW.days) : null;
  const adoptedInvoiceIds = [...new Set(adoptedRows.map((r) => adopted.get(r.id)!))];
  const invoiceFields = {
    id: s.invoices.id,
    date: s.invoices.date,
    supplier: s.invoices.supplier,
    supplierTaxNumber: s.invoices.supplierTaxNumber,
    payable: s.invoices.payable,
    invoiceNo: s.invoices.invoiceNo,
  };
  const [invoices, adoptedInvoices, cards, refs, recent] = await Promise.all([
    from && to ? db.select(invoiceFields).from(s.invoices).where(and(gte(s.invoices.date, from), lte(s.invoices.date, to))) : Promise.resolve([]),
    adoptedInvoiceIds.length ? db.select(invoiceFields).from(s.invoices).where(inArray(s.invoices.id, adoptedInvoiceIds)) : Promise.resolve([]),
    db.select({ id: s.suppliers.id, name: s.suppliers.name, aliases: s.suppliers.aliases, taxNumber: s.suppliers.taxNumber }).from(s.suppliers),
    db.selectDistinct({ supplier: s.invoices.supplier, supplierTaxNumber: s.invoices.supplierTaxNumber }).from(s.invoices),
    // Aynı yerin son Kasa harcamalarının kategorisi (öneri)
    db
      .select({ store: s.cashOuts.store, categoryId: s.expenseEntries.categoryId })
      .from(s.expenseEntries)
      .innerJoin(s.cashOuts, eq(s.cashOuts.id, s.expenseEntries.cashOutId))
      .where(isNotNull(s.cashOuts.store))
      .orderBy(desc(s.expenseEntries.date), desc(s.expenseEntries.id))
      .limit(300),
  ]);
  const { resolve } = supplierResolver(cards, refs);
  const storeGroup = new Map<string, string>();
  const groupOfStore = (store: string) => {
    if (!storeGroup.has(store)) storeGroup.set(store, resolve(store, null).id);
    return storeGroup.get(store)!;
  };
  // "Faturalar'a ekle" ile başka bir satırdan açılmış fatura o satırındır, bir başkasını kapatmaz
  const candidates = invoices.filter((i) => !alive.has(i.id));
  const { matched } = matchCashOutInvoices(rows, candidates, (o, i) => sameStoreName(o.store ?? "", i.supplier) || groupOfStore(o.store ?? "") === resolve(i.supplier, i.supplierTaxNumber).id);
  const wanted = opts.ids ? new Set(opts.ids) : null;
  const pick = <R extends { id: number }>(list: R[]) => (wanted ? list.filter((r) => wanted.has(r.id)) : list);
  const suggested = new Map<string, number>();
  for (const r of recent) {
    const k = r.store ? nameKey(r.store) : "";
    if (k && !suggested.has(k)) suggested.set(k, r.categoryId);
  }
  const invoiceById = new Map([...candidates, ...adoptedInvoices].map((i) => [i.id, i]));
  const pending: PendingCashOutInvoice[] = [];
  const duplicates: DuplicateCashOutInvoice[] = [];
  // Kasa satırının kendisi (gider kaydının alanları olmadan)
  const rowOf = (r: (typeof rows)[number]) => ({
    id: r.id,
    date: r.date,
    receiptDate: r.receiptDate,
    store: r.store,
    description: r.description,
    amount: r.amount,
    vat: r.vat,
    docType: r.docType,
    receiptNo: r.receiptNo,
    photoId: r.photoId,
    createdByName: r.createdByName,
  });
  const duplicate = (r: (typeof rows)[number], expenseId: number, inv: (typeof invoices)[number]): DuplicateCashOutInvoice => ({
    ...rowOf(r),
    expenseId,
    expenseCategory: r.expenseCategory,
    invoice: { id: inv.id, date: inv.date, supplier: inv.supplier, invoiceNo: inv.invoiceNo, payable: inv.payable },
  });
  for (const r of pick(rows)) {
    const inv = invoiceById.get(matched.get(r.id) ?? 0);
    if (r.expenseId === null) {
      if (!inv) pending.push({ ...rowOf(r), suggestedCategoryId: (r.store && suggested.get(nameKey(r.store))) || null });
    } else if (inv && r.expenseDebtId === null) {
      // Cari borcun kaydı sayılmaz: faturası geldiyse Tedarikçiler'de borca bağlanır (kayıt orada silinir)
      duplicates.push(duplicate(r, r.expenseId, inv));
    }
  }
  for (const r of pick(adoptedRows)) {
    const inv = invoiceById.get(adopted.get(r.id)!);
    if (inv && r.expenseId !== null) duplicates.push(duplicate(r, r.expenseId, inv));
  }
  // Yeniden eskiye (iki kaynak birleşti)
  duplicates.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  return { pending, duplicates };
}

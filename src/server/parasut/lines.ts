import "server-only";

import { and, count, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { INVOICE_CATEGORIES } from "@/lib/constants";
import { dateTR, money } from "@/lib/format";
import { todayTR } from "@/lib/reminders";
import { getDb, schema as s } from "@/server/db";

import { ParasutAuthError, ParasutClient, ParasutDeadlineError, ParasutError } from "./client";
import { afterTransientFailure, orderLineReads, type UblRetries } from "./line-queue";
import { recategorizeFromLines } from "./mapping";
import { extractUblXml, parseUbl, paymentPlan, ublLinesToDrafts, withholdingCorrection, type UblInvoice } from "./ubl";

/**
 * E-fatura kalemleri. İçeri alınmamış (Paraşüt'te gider faturası olmayan) e-faturalardan açılan kayıtların ve
 * Excel'den gelip e-faturaya bağlanan kayıtların kalemleri UBL belgesinden okunur ve gider faturası kalemleriyle
 * aynı tabloya (parasut_bill_lines) yazılır; hammaddeye bağlı kalemlerden alınan miktar ve fiyat güncellenir
 * (applyProductLinks, eşitlemenin sonunda). Belgesi bir kez okunan fatura (ubl_read_at) yeniden okunmaz; e-fatura
 * değişirse eşitleme alanı boşaltır.
 * Canlı veride 82 gelen e-faturanın 82'sinde kalem toplamı faturayı kuruşu kuruşuna tuttu (20 Eki 2026).
 */

export interface LineReadStats {
  /** Belgesi okunan fatura */
  read: number;
  /** Yazılan kalem */
  lines: number;
  /** Belgesi alınamayan ya da çözülemeyen fatura (bir daha denenmez) */
  failed: number;
  /** KDV hariç tutarı belgeden düzeltilen fatura (tevkifatlı) */
  corrected: number;
  /** Vadesi gelmediği için "ödenmedi" yapılan fatura */
  unpaid: number;
  /** Sırada kalan */
  remaining: number;
  /** Kalemi değişen aylar (alınan miktarlar yeniden hesaplanır) */
  months: string[];
  /** Paraşüt yavaş/erişilemez olduğu için yarıda bırakıldıysa nedeni */
  stoppedBy: string | null;
}

/** Kalemi okunacak kayıtlar: e-faturaya bağlı, kendi kalemleri olan gider faturası olmayan, henüz okunmamış */
const pendingWhere = () => and(isNotNull(s.invoices.eInvoiceId), isNull(s.invoices.externalId), isNull(s.invoices.ublReadAt));

/** Belgesi geçici bir hatayla alınamayan faturaların deneme sayısı (line-queue.ts) */
const RETRY_KEY = "parasut.ublRetries";

export async function pendingLineReads(): Promise<number> {
  const [{ n }] = await getDb().select({ n: count() }).from(s.invoices).where(pendingWhere());
  return n;
}

/**
 * Bir sonraki denemede düzelebilecek hata (Paraşüt yavaş, oturum, hız sınırı): fatura işaretlenmez, UBL_MAX_TRIES
 * denemeye kadar sonraki turlarda yeniden denenir
 */
function transient(e: unknown): boolean {
  if (e instanceof ParasutError) return e.status === 0 || e.status === 401 || e.status === 403 || e.status === 429 || e.status >= 500;
  return false;
}

function appendNote(note: string | null, add: string): string {
  if (note?.includes(add)) return note;
  return note ? `${note} · ${add}` : add;
}

/**
 * Sıradaki faturaların (en yeni önce; geçici hatayla alınamamış olanlar sonda) UBL kalemlerini okur ve yazar. `until`
 * (epoch ms) geçilince bırakır; kalanı sonraki eşitleme sürdürür. Belgedeki ödeme tarihi boş vadeye yazılır;
 * e-faturadan açılan kayıt vadesi gelmemişse "ödenmedi" olur (paymentPlan).
 */
export async function readEInvoiceLines(client: ParasutClient, opts: { until: number; limit?: number }): Promise<LineReadStats> {
  const db = getDb();
  const stats: LineReadStats = { read: 0, lines: 0, failed: 0, corrected: 0, unpaid: 0, remaining: 0, months: [], stoppedBy: null };
  const today = todayTR();
  const months = new Set<string>();
  const rows = await db
    .select({
      id: s.invoices.id,
      eInvoiceId: s.invoices.eInvoiceId,
      supplier: s.invoices.supplier,
      date: s.invoices.date,
      dueDate: s.invoices.dueDate,
      unpaid: s.invoices.unpaid,
      origin: s.invoices.origin,
      amount: s.invoices.amount,
      discount: s.invoices.discount,
      vat: s.invoices.vat,
      note: s.invoices.note,
      category: s.invoices.category,
      needsReview: s.invoices.needsReview,
    })
    .from(s.invoices)
    .where(pendingWhere())
    .orderBy(desc(s.invoices.date), desc(s.invoices.id))
    .limit(opts.limit ?? 500);
  const [retryRow] = rows.length ? await db.select().from(s.integrationState).where(eq(s.integrationState.key, RETRY_KEY)).limit(1) : [];
  const stored = (retryRow?.value as UblRetries | undefined) ?? {};
  // Sıradan çıkmış (okunmuş, silinmiş) faturaların sayısı tutulmaz
  const retries: UblRetries = Object.fromEntries(rows.filter((r) => stored[r.id]).map((r) => [r.id, stored[r.id]]));
  let retriesDirty = Object.keys(retries).length !== Object.keys(stored).length;
  const rules = rows.length ? await db.select().from(s.parasutCategoryRules) : [];

  let streak = 0;
  for (const row of orderLineReads(rows, retries)) {
    if (Date.now() > opts.until) break;
    let inv: UblInvoice | null = null;
    try {
      // 404/204: Paraşüt belgeyi vermedi; fatura okunmuş sayılır
      const file = await client.getBytes(`e_invoices/${encodeURIComponent(row.eInvoiceId!)}/signed_ubl`);
      if (file) inv = parseUbl(extractUblXml(file.bytes));
    } catch (e) {
      if (e instanceof ParasutDeadlineError) break;
      if (transient(e)) {
        stats.stoppedBy = (e as Error).message;
        // Tek bir belgenin kalıcı hatası (ör. hep 500) sıradakileri bekletmesin: fatura bu turda atlanır ve sonraki
        // turlarda sona alınır; art arda iki hata ya da oturum hatası Paraşüt'ün kendisinde sorun demek, bırakılır
        const auth = e instanceof ParasutAuthError || (e as ParasutError).status === 401;
        const next = afterTransientFailure(retries[row.id] ?? 0, streak, auth);
        if (next !== "give-up") {
          if (!auth) {
            retries[row.id] = (retries[row.id] ?? 0) + 1;
            retriesDirty = true;
          }
          if (next === "stop") break;
          streak++;
          continue;
        }
      }
      console.error("E-fatura kalemleri", row.eInvoiceId, e);
    }
    streak = 0;
    if (retries[row.id]) {
      delete retries[row.id];
      retriesDirty = true;
    }

    if (!inv) {
      await db.update(s.invoices).set({ ublReadAt: new Date() }).where(eq(s.invoices.id, row.id));
      stats.failed++;
      continue;
    }

    const drafts = ublLinesToDrafts(inv, row.eInvoiceId!, row.supplier);
    const patch: Partial<typeof s.invoices.$inferInsert> = { ublReadAt: new Date() };
    let note = row.note;
    // Ödeme (vade, valör) tarihi: boş vadeye yazılır. E-faturadan açılan kayıt (Excel/elle değil, vadesine henüz
    // dokunulmamış) vadesi gelmemişse "ödenmedi" olur ve Ödemeler & hatırlatıcılar'a düşer; peşin ve vadesi geçmiş
    // faturalar ödendi sayılır.
    const plan = paymentPlan(inv, row.date, today);
    if (!row.dueDate && plan.dueDate) patch.dueDate = plan.dueDate;
    if (row.origin === "parasut" && !row.dueDate && !row.unpaid && plan.unpaid && plan.dueDate) {
      patch.unpaid = true;
      note = appendNote(note, `vade e-faturadan: ${dateTR(plan.dueDate)}`);
      stats.unpaid++;
    }
    // Tutar e-fatura listesinden geldiyse ("ödenecek − KDV") tevkifat geri eklenir: tevkifatlı faturada liste
    // tedarikçiye ödenecek tutarı verir, maliyet eksik kalır. ÖİV/ÖTV maliyette kalır; elle değiştirilmiş tutara
    // dokunulmaz (withholdingCorrection).
    const fix = withholdingCorrection(row, inv);
    if (fix) {
      patch.amount = fix.amount;
      if (fix.vat !== null) patch.vat = fix.vat;
      note = appendNote(
        (note ?? "").replace(" · tevkifatlı: tutarı kontrol edin", "").replace("tevkifatlı: tutarı kontrol edin", "") || null,
        `tevkifatlı: KDV hariç tutar e-fatura belgesinden (önce ${money(fix.was)})`,
      );
      stats.corrected++;
    }
    if (!inv.linesMatch) note = appendNote(note, "kalemlerin toplamı faturayı tutmuyor; kalem fiyatlarını kontrol edin");
    // Kalemsiz açılıp "eşleşme yok" kalan kayıt: kategori kalem adlarıyla (kural, ipucu) yeniden denenir; kayıt
    // kontrol bekleyen kalır
    const recat = recategorizeFromLines({ ...row, note }, drafts, rules, INVOICE_CATEGORIES);
    if (recat) {
      if (recat.category !== row.category) patch.category = recat.category;
      note = recat.note;
    }
    if (note !== row.note) patch.note = note;

    await db.transaction(async (tx) => {
      await tx.delete(s.parasutBillLines).where(eq(s.parasutBillLines.invoiceId, row.id));
      if (drafts.length) {
        // Aynı e-fatura başka bir kayda bağlıyken yazılmış kalemler varsa kopya kalmasın
        await tx.delete(s.parasutBillLines).where(inArray(s.parasutBillLines.externalId, drafts.map((d) => d.externalId)));
        await tx.insert(s.parasutBillLines).values(drafts.map((d) => ({ ...d, invoiceId: row.id })));
      }
      await tx.update(s.invoices).set(patch).where(eq(s.invoices.id, row.id));
    });
    months.add(row.date.slice(0, 7));
    stats.read++;
    stats.lines += drafts.length;
  }
  if (retriesDirty) {
    await db
      .insert(s.integrationState)
      .values({ key: RETRY_KEY, value: retries })
      .onConflictDoUpdate({ target: s.integrationState.key, set: { value: retries, updatedAt: new Date() } });
  }
  stats.months = [...months];
  stats.remaining = await pendingLineReads();
  return stats;
}

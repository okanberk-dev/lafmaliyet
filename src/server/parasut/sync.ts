import "server-only";

import { and, desc, eq, gte, inArray, isNotNull, like, lt, notInArray, notLike, or, sql } from "drizzle-orm";

import { cleanTaxNumber } from "@/app/panel/tedarikciler/logic";
import { takesCreditOnArrival } from "@/lib/cari/balance";
import { COMMISSION_CATEGORY, INVOICE_CATEGORIES, SEPARATE_CATEGORIES } from "@/lib/constants";
import { LINKABLE_CATEGORIES } from "@/lib/invoice-linking";
import { appliedKeyOf, firstPriceCertain, holdLogText, livePct, previousInvoicePrice, priceStep, reopenApplied, repeatCount, staleHolds } from "@/lib/price-hold";
import { packEvidence } from "@/lib/product-match";
import { parseIgnored, type IgnoredProduct } from "@/lib/product-ignore";
import { addDays, syncedDueDate, todayTR } from "@/lib/reminders";
import { bulkPrice } from "@/lib/supplier-prices";
import { logActivity } from "@/server/actions/log";
import { supersedeHolds } from "@/server/data/price-holds";
import { suspectFactorLine } from "@/server/data/purchase-lots-query";
import { applyCreditOnArrival, arrivalLedgerBase, releaseInvoiceLinks, resettleAfterSync, trackedCardResolver, type TrackedCard } from "@/server/cari/settle";
import { loadPaidOnDelivery, loadPaymentsSince, type PaidOnDelivery } from "@/server/data/suppliers";
import { getDb, schema as s } from "@/server/db";

import { PAGE_SIZE, ParasutAuthError, ParasutClient, ParasutDeadlineError, ParasutError } from "./client";
import { MANAGED_QTY_NOTE, NO_PURCHASE_NOTE } from "./constants";
import { readParasutConfig } from "./config";
import { str, type ListResponse, type ShowResponse } from "./jsonapi";
import { categoryNeedsReview, eInvoiceToDraft, isSupplierReturn, shouldImportEInvoice, withholdingVatFill, type EInvoiceAttrs, type EInvoiceDraft } from "./einvoice";
import { parseLateCursor, runLateScan } from "./late-bills";
import { readEInvoiceLines, type LineReadStats } from "./lines";
import {
  billToDraft,
  CUSTOMER_CONTACT_NOTE,
  customerContactBill,
  eInvoiceDeleted,
  feedsSupplierHistory,
  findByEInvoiceNo,
  findExisting,
  newInvoicePayment,
  nextTaxNumber,
  pickCategory,
  SALES_RETURN,
  shouldImport,
  supplierHistory,
  supplierKey,
  type BillDraft,
  type ExistingInvoice,
} from "./mapping";
import { mergeReturns, parseReturnLog, RETURN_KEEP_DAYS, RETURNS_KEY, type ReturnEntry, type ReturnLog } from "./returns";
import { backfillSupplierTaxNumbers, TAX_BACKFILL_KEY } from "./tax-backfill";

const CURSOR_KEY = "parasut.cursor";
const PRICE_KEY = "parasut.prices";
const RESUME_KEY = "parasut.resume";
const CONTACTS_KEY = "parasut.contacts";
const PENDING_KEY = "parasut.pendingEInvoices";
/** Gelen e-faturaların imleci (son e-fatura tarihi); gider faturalarınınkinden ayrı */
const E_CURSOR_KEY = "parasut.eInvoiceCursor";
/**
 * Ödenmemiş Paraşüt faturalarının Paraşüt'teki son vadesi (dış kimlik → vade): panelde ertelenen vade, Paraşüt'teki
 * vade değişmedikçe eşitlemede ezilmesin (syncedDueDate)
 */
const DUE_KEY = "parasut.dueDates";
/** Panelde silinen Paraşüt faturaları (bir sonraki eşitlemede geri gelmesin) */
export const IGNORE_KEY = "parasut.ignore";
/** Tedarikçi geçmişinin kaldığı yer: Paraşüt kişi kimliği → sonraki çalışmanın okuyacağı sayfa (eskiden yeniye) */
const HISTORY_KEY = "parasut.supplierHistory";
/**
 * Geç girilen faturalar: görülmüş en büyük gider faturası kimliği ve bitmemiş taramanın yeri (late-bills.ts). Paraşüt
 * kimlikleri artarak verilir; tarihi eski ama yeni girilmiş fatura (kâğıt fatura, KDV'si sonraki yıl sonuna kadar
 * indirilebilir) 75 günlük pencerenin dışında kalsa da kimliği büyüktür (catchLateBills)
 */
const LAST_BILL_KEY = "parasut.lastBillId";
/** Eşitlemenin kendi durumu; "Oturumu sıfırla" bunları siler (vergi no tamamlaması da baştan başlar) */
export const PARASUT_STATE_KEYS = [CURSOR_KEY, RESUME_KEY, PENDING_KEY, E_CURSOR_KEY, HISTORY_KEY, LAST_BILL_KEY, TAX_BACKFILL_KEY];
const PLACEHOLDER_SUPPLIER = "Paraşüt tedarikçisi";
/** Önceki eşitlemeden sonra değişmiş olabilecek faturalar için geriye bakış */
const LOOKBACK_DAYS = 75;
/** Okuma + yazma toplam süresi (Vercel işlevi 60 sn) */
const DEADLINE_MS = 45_000;
/** Aynı anda tek eşitleme: başlangıç denetimi bu danışma kilidi altında (client.ts TOKEN_LOCK = 7_340_211) */
const SYNC_LOCK = 7_340_212;
/**
 * Bundan eski "sürüyor" kaydı yarıda kesilmiş sayılır (işlev en çok 60 sn çalışır); daha yenisi süren bir
 * eşitlemedir
 */
const STALE_RUN_MS = 120_000;
/** Başka bir eşitleme sürerken verilen yanıt (cron işleri ve "Şimdi eşitle" bunu gösterir) */
export const SYNC_BUSY = "Paraşüt eşitlemesi zaten sürüyor; bir iki dakika sonra yeniden deneyin.";
/** Okumanın payı; kalan süre yazmaya ve doğrulamaya kalır */
const FETCH_SHARE = 0.6;
/** Tedarikçi adlarını /contacts ile okumanın bırakıldığı an (sürenin payı) */
const CONTACTS_SHARE = 0.75;
/** Bir çalışmada tek tek yeniden okunacak en fazla fatura (listede görünmeyenler + pencere dışı ödenmemişler) */
const RECHECK_LIMIT = 8;
/** Geç girilenler için bir çalışmada en çok okunacak sayfa (25'er fatura; günde birkaç fatura girilir) */
const LATE_PAGES = 4;
/**
 * "supplier" belgelenen include listesinde yok ama çalışıyor (topluluk istemcileri); reddedilirse
 * tedarikçisiz, o da olmazsa ürünsüz istenir. Tedarikçi adı gelmeyen faturalar için /contacts/{id} okunur.
 */
const INCLUDES = ["supplier,category,details,details.product,active_e_document", "supplier,category,details,details.product", "category,details,details.product", "category,details"];
/** Tek fatura okumasında (yeniden denetim) belgelenmiş include'lar */
const SHOW_INCLUDE = "category,details,details.product";

type SyncOk = { ok: true; summary: string; runId: number; fetched: number; created: number; updated: number; removed: number; partial: boolean };
/** `busy`: başka bir eşitleme sürdüğü için başlamadı (hata sayılmaz) */
type SyncErr = { ok: false; error: string; runId: number | null; busy?: true };

interface Resume {
  /** Sonraki çalışmanın okuyacağı ilk sayfa (yazılmış son sayfanın bir sonrası) */
  page: number;
  windowStart: string;
  include: string;
  /** Bu tam turda görülen en yeni fatura tarihi (tur bitince imleç olur) */
  maxDate: string;
}

async function getState<T>(key: string): Promise<T | null> {
  const [row] = await getDb().select().from(s.integrationState).where(eq(s.integrationState.key, key)).limit(1);
  return (row?.value as T | undefined) ?? null;
}

async function setState(key: string, value: unknown) {
  await getDb()
    .insert(s.integrationState)
    .values({ key, value })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
}

/** Panelde silinen bir Paraşüt faturasını yok sayılacaklar listesine ekler */
export async function ignoreParasutBill(externalId: string) {
  const list = (await getState<string[]>(IGNORE_KEY)) ?? [];
  if (!list.includes(externalId)) await setState(IGNORE_KEY, [...list, externalId].slice(-2000));
}

/** Yeni tedarikçi adını paneldeki kısa adla eşler ("SÜTAŞ SÜT ÜRÜNLERİ A.Ş." → "Sütaş"); gelir-gider satırları dağılmasın */
function supplierAliases(names: string[]) {
  const byKey = new Map<string, string>();
  for (const n of names) {
    const k = supplierKey(n);
    if (k.length >= 3 && !byKey.has(k)) byKey.set(k, n);
  }
  return (name: string) => {
    if (name === PLACEHOLDER_SUPPLIER) return name;
    const k = supplierKey(name);
    if (byKey.has(k)) return byKey.get(k)!;
    let best: string | null = null;
    let bestLen = 0;
    for (const [ek, display] of byKey) {
      if (ek.length >= 4 && k.startsWith(`${ek} `) && ek.length > bestLen) {
        best = display;
        bestLen = ek.length;
      }
    }
    return best ?? name;
  };
}

/** Kişi kartlarının önbelleği: ad, vergi no ve tür (`account_type`; eski kayıtlarda yok) */
type ContactCache = Record<string, { name: string; taxNo: string | null; type?: string | null }>;

/** Gider faturası Paraşüt'te: silinmiş ya da iptal ("gone"), duruyor ("present"), okunamadı ("unknown") */
type BillState = "gone" | "present" | "unknown";

type Existing = ExistingInvoice & {
  vat: number | null;
  eInvoiceId: string | null;
  unpaid: boolean;
  syncedAt: Date | null;
  dueDate: string | null;
  origin: "manual" | "excel" | "parasut";
  source: "manual" | "excel" | "parasut";
  note: string | null;
  parasutUnpaid: boolean | null;
  outstanding: number | null;
  paidAt: string | null;
  paymentRequestedAt: string | null;
  supplierTaxNumber: string | null;
};

interface Ctx {
  existing: Existing[];
  rules: Awaited<ReturnType<typeof loadRules>>;
  history: Map<string, string>;
  alias: (name: string) => string;
  ignored: Set<string>;
  /**
   * Kalemleri e-fatura belgesinden (UBL) okunmuş kayıtlar: fatura sonradan Paraşüt'te içeri alınınca kalemleri gider
   * faturasınınkiyle değiştirilmez
   */
  ublLines: Set<number>;
  /** Bu çalışmada yazılmış Paraşüt kimlikleri (sayfalar kayarsa aynı fatura iki kez gelebilir) */
  applied: Set<string>;
  touchedMonths: Set<string>;
  counts: { created: number; updated: number; removed: number };
  /** Paraşüt'ün son gönderdiği vadeler (DUE_KEY); `dueDirty` değiştiyse çalışma sonunda yazılır */
  dueSeen: Record<string, string | null>;
  dueDirty: boolean;
  /** Peşin çalışılan tedarikçinin kartı (yeni faturası ödendi gelir); ötekilerin yeni faturası ödenmedi gelir */
  paidOnDelivery: PaidOnDelivery;
  /** Ödeme takibinin başlangıcı: bundan eski yeni fatura (geçmişi yeniden alırken) Paraşüt'teki durumuyla gelir */
  paymentsSince: string;
  /** Bu çalışmada vergi nosu yazılan fatura (yeni ve var olan; özet satırında, "güncellendi"ye sayılmaz) */
  taxFilled: number;
  /** Bu çalışmanın listesinde görünen gider faturaları (yeniden içeri alınan e-fatura: eski fatura hâlâ duruyor mu) */
  listed: Set<string>;
  /** Gider faturası Paraşüt'te silinmiş ya da iptal mi (tek okuma; okunamazsa "unknown") */
  billState: (externalId: string) => Promise<BillState>;
  /** Bu çalışmada görülen, panele girmeyen iadeler (kimliğe göre) */
  returns: { sales: Map<string, Omit<ReturnEntry, "seenAt">>; supplier: Map<string, Omit<ReturnEntry, "seenAt">> };
  /**
   * Cari (docs/TEDARIKCILER.md "Hesap hareketleri"): faturanın kartı takipliyse (ödeme kaydı var) kart ve takibin
   * başladığı gün; yeni faturası takip gününden önceki tarihliyse Paraşüt'te ödenen kısmı, değilse 0 taban alır
   * (arrivalLedgerBase). Liste çalışmanın başında bir kez okunur
   */
  trackedCard: (supplier: string, taxNumber?: string | null) => TrackedCard | null;
  /** Tutarı değişen faturalar: çalışmanın sonunda dağıtımları yeniden dengelenir (resettleAfterSync) */
  payableChanged: { id: number; from: number; to: number }[];
  /**
   * Peşin ve takipli kartın takip günü ve sonrasının yeni faturaları: çalışmanın sonunda hesaptaki para sayılır
   * (applyCreditOnArrival; takesCreditOnArrival)
   */
  pesinTracked: { id: number; cardId: number }[];
}

/** Panele girmeyen iadeyi bu çalışmanın listesine ekler (çalışma sonunda saklanır: saveReturns) */
function noteReturn(ctx: Ctx, kind: keyof ReturnLog, e: Omit<ReturnEntry, "seenAt">) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(e.date)) ctx.returns[kind].set(e.id, e);
}

/**
 * Bu çalışmanın iadelerini saklanan listeye katar (eskiler RETURN_KEEP_DAYS günde düşer); yeni görülenlerin sayısını
 * döner (eşitleme özeti yalnız yenileri söyler, aynı iade her sabah yeniden yazılmasın)
 */
async function saveReturns(ctx: Ctx, today: string): Promise<Record<keyof ReturnLog, number>> {
  if (!ctx.returns.sales.size && !ctx.returns.supplier.size) return { sales: 0, supplier: 0 };
  const stored = parseReturnLog(await getState(RETURNS_KEY));
  const { log, fresh } = mergeReturns(
    stored,
    { sales: ctx.returns.sales.values(), supplier: ctx.returns.supplier.values() },
    { now: new Date().toISOString(), cutoff: addDays(today, -RETURN_KEEP_DAYS) },
  );
  await setState(RETURNS_KEY, log);
  return fresh;
}

/**
 * Var olan faturanın tedarikçi vergi nosunu Paraşüt'ten gelenle yazar (nextTaxNumber: boşsa yazılır, e-fatura
 * geçer, kişi kartındaki numara e-faturalı kaydı ezmez)
 */
async function fillTaxNumber(ctx: Ctx, row: Existing, raw: string | null | undefined, from: "bill" | "einvoice") {
  const t = nextTaxNumber(row.supplierTaxNumber, raw, { from, hasEInvoice: Boolean(row.eInvoiceId) });
  if (!t) return;
  await getDb().update(s.invoices).set({ supplierTaxNumber: t }).where(eq(s.invoices.id, row.id));
  row.supplierTaxNumber = t;
  ctx.taxFilled++;
}

/** Ödenmemiş faturanın Paraşüt'teki vadesini kaydeder; ödenmiş ya da kaldırılmış faturanın kaydı silinir */
function rememberDue(ctx: Ctx, externalId: string, dueDate: string | null, unpaid: boolean) {
  if (unpaid) {
    if (ctx.dueSeen[externalId] === dueDate) return;
    ctx.dueSeen[externalId] = dueDate;
  } else {
    if (!Object.hasOwn(ctx.dueSeen, externalId)) return;
    delete ctx.dueSeen[externalId];
  }
  ctx.dueDirty = true;
}

const loadRules = () => getDb().select().from(s.parasutCategoryRules);

/** Gider faturasının kalemleri (e-fatura belgesinden okunan `ubl:` kalemleri değil) */
const billLinesOf = (invoiceId: number) => and(eq(s.parasutBillLines.invoiceId, invoiceId), notLike(s.parasutBillLines.externalId, "ubl:%"));

/**
 * Paraşüt'ten açılmış kaydı siler; önce cari bağları aynı işlemde çözülür (K11): bağlı faturasız alımlar eski hâline
 * döner, borçtan gelen ödemeler borca, öteki ödemeler hesaba geçer. Bağı yoksa yalnız silinir. Döner: silindi mi.
 */
async function deleteWithLinks(match: Existing): Promise<boolean> {
  const db = getDb();
  let links: Awaited<ReturnType<typeof releaseInvoiceLinks>>;
  try {
    links = await db.transaction(async (tx) => {
      const l = await releaseInvoiceLinks(tx, match.id);
      await tx.delete(s.invoices).where(eq(s.invoices.id, match.id));
      return l;
    });
  } catch (err) {
    // Bağlar çözülemezse (kilit zaman aşımı, bağlantı kopması) fatura silinmez: bağsız silinirse bağlı alımın gider
    // kaydı geri gelmez ve borcun ödemesi kaybolurdu. Eşitleme durmaz; sonraki çalışma yeniden dener
    console.error("[cari] Paraşüt'te silinen faturanın bağları çözülemedi", match.id, err);
    await logActivity(null, "Sistem · Paraşüt'te silinen fatura", `${match.supplier} · ${match.invoiceNo ?? match.date} · cari bağları çözülemedi; fatura silinmedi, sonraki eşitleme yeniden dener`);
    return false;
  }
  if (!links.allocations.length && !links.debtIds.length) return true;
  const money = links.allocations.reduce((a, x) => a + x.amount, 0);
  const detail = [
    `${match.supplier} · ${match.invoiceNo ?? match.date}`,
    money > 0.005 ? `${money.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺ ödeme hesaba geçti` : "",
    links.debtIds.length ? `${links.debtIds.length} faturasız alım yeniden açık` : "",
  ].filter(Boolean);
  await logActivity(null, "Sistem · Paraşüt'te silinen fatura", detail.join(" · "));
  return true;
}

/**
 * Paraşüt'te kaldırılmış (iptal, silinmiş) ya da gider sayılmayan (satış iadesi) bir faturanın panel karşılığı.
 *
 * `billOnly`: yalnız gider faturası kalktı (silindi, iptal edildi). Kayıt gelen bir e-faturaya da bağlıysa silinmez:
 * e-fatura duruyor, borç da duruyor. Yalnız gider faturasının bağı çözülür (kategori, ödeme durumu, vade ve not
 * kalır), gider faturasının kalemleri silinir; e-faturanın belgeden okunmuş kalemleri kalır, yoksa sıradaki okumada
 * belgeden okunur. Bundan sonrasını e-fatura eşitlemesi yürütür: e-fatura reddedilir ya da arşivlenirse yalnız ondan
 * açılan kayıt kalkar, yeniden içeri alınırsa kayıt yeni gider faturasına bağlanır. Silinseydi e-fatura aynı çalışmada
 * "ödenmedi" yeni kayıt olarak geri gelir, işaretlenen ödeme kaybolurdu.
 */
async function retire(match: Existing, reason: string, ctx: Ctx, billOnly = false) {
  const db = getDb();
  ctx.touchedMonths.add(match.date.slice(0, 7));
  if (match.externalId) rememberDue(ctx, match.externalId, null, false);
  if (billOnly && match.eInvoiceId) {
    const syncedAt = new Date();
    await db.delete(s.parasutBillLines).where(billLinesOf(match.id));
    const keepsLines = ctx.ublLines.has(match.id);
    await db
      .update(s.invoices)
      .set({ externalId: null, parasutUnpaid: null, outstanding: null, syncedAt, ...(keepsLines ? {} : { ublReadAt: null }) })
      .where(eq(s.invoices.id, match.id));
    Object.assign(match, { externalId: null, parasutUnpaid: null, outstanding: null, syncedAt });
    ctx.counts.updated++;
    return;
  }
  if (match.origin === "parasut") {
    if (!(await deleteWithLinks(match))) return;
    const i = ctx.existing.indexOf(match);
    if (i >= 0) ctx.existing.splice(i, 1);
    ctx.counts.removed++;
  } else {
    // Elle/Excel'le girilmiş kayıt silinmez: bağı çözülür ve not düşülür. E-faturaya da bağlıysa belgeden okunan
    // kalemleri kalır; okunmamışsa sıradaki okumada belgeden okunur
    const note = `${match.note ? `${match.note} · ` : ""}Paraşüt'te ${reason} — kontrol edin`;
    const syncedAt = new Date();
    const rereadLines = Boolean(match.eInvoiceId) && !ctx.ublLines.has(match.id);
    await db
      .update(s.invoices)
      .set({ externalId: null, source: match.origin, syncedAt, parasutUnpaid: null, note, ...(rereadLines ? { ublReadAt: null } : {}) })
      .where(eq(s.invoices.id, match.id));
    await db.delete(s.parasutBillLines).where(billLinesOf(match.id));
    Object.assign(match, { externalId: null, source: match.origin, parasutUnpaid: null, note, syncedAt });
    ctx.counts.updated++;
  }
}

/**
 * Tek bir Paraşüt faturasını panele yazar (yeni / güncelle / kaldır). "deferred": bu çalışmada yazılamadı (yeniden
 * içeri alınan e-faturanın eski gider faturası Paraşüt'e sorulamadı), sonraki çalışma yeniden dener
 */
async function applyDraft(d: BillDraft, ctx: Ctx): Promise<"deferred" | undefined> {
  const db = getDb();
  if (ctx.ignored.has(d.externalId) || ctx.applied.has(d.externalId)) return;
  ctx.applied.add(d.externalId);
  // Aynı fatura e-fatura eşitlemesiyle (içeri alınmadan) zaten açılmış olabilir: e-belge kimliği önce bakılır
  const eInvoiceId = d.eDocument?.type === "e_invoices" ? d.eDocument.id : null;
  const byExt = ctx.existing.find((e) => e.externalId === d.externalId) ?? null;
  const holder = !byExt && eInvoiceId ? (ctx.existing.find((e) => e.eInvoiceId === eInvoiceId) ?? null) : null;
  let byEDoc = holder && !holder.externalId ? holder : null;
  // E-faturanın kaydı başka bir gider faturasına bağlı: e-fatura Paraşüt'te o fatura silinip yeniden içeri alındıysa
  // kayıt yenisine geçer (ödeme durumu, kategori, not korunur; tek kayıt). Eski fatura hâlâ duruyorsa aynı e-fatura
  // iki gider faturasında: yenisi açılır ama kontrol bekler, çift sayım görünür olsun
  let relinkFrom: string | null = null;
  let twin: Existing | null = null;
  if (holder?.externalId) {
    const state = ctx.listed.has(holder.externalId) ? "present" : await ctx.billState(holder.externalId);
    if (state === "unknown") {
      // Eski fatura okunamadı (ağ, zaman aşımı, Paraşüt hatası): yeni fatura bu çalışmada yazılmaz, sonraki çalışma
      // yeniden sorar. "Duruyor" sayılsaydı aynı e-fatura ödenmedi ikinci bir kayıt olarak açılır, eski fatura sonra
      // silinmiş görülse de iki kayıt hiç birleşmezdi (ödeme iki kez yapılabilirdi)
      ctx.applied.delete(d.externalId);
      console.warn("Paraşüt: yeniden içeri alınan e-faturanın eski faturası okunamadı, sonraki eşitlemeye kaldı", { bill: d.externalId, previous: holder.externalId });
      return "deferred";
    }
    if (state === "gone") {
      byEDoc = holder;
      relinkFrom = holder.externalId;
    } else twin = holder;
  }
  const match = (byExt ?? byEDoc ?? findExisting(d, ctx.existing)) as Existing | null;
  // Paneldeki e-fatura kaydı silinmiş (ei:<kimlik> yok sayılıyor): Paraşüt'te içeri alınınca gider faturası olarak da
  // geri gelmez; var olan bir kayda denk gelirse o kayıt yine bağlanır/güncellenir
  if (!match && eInvoiceDeleted(d, ctx.ignored)) return;
  // e-fatura kimliği başka bir kayıtta duruyorsa (benzersiz) bu kayda yazılmaz
  const eInvoiceFree = eInvoiceId && !ctx.existing.some((e) => e.eInvoiceId === eInvoiceId && e !== match) ? eInvoiceId : null;
  const verdict = shouldImport(d);
  if (!verdict.ok) {
    // Satış iadesi gider sayılmaz: daha önce gider olarak alındıysa e-faturası olsa da kalkar. İptal edilen gider
    // faturasının yalnız bağı çözülür (e-faturası duruyorsa kayıt e-faturayla kalır)
    const salesReturn = verdict.reason === SALES_RETURN;
    if (salesReturn) noteReturn(ctx, "sales", { id: d.externalId, date: d.date, amount: Math.abs(d.payable), invoiceNo: d.invoiceNo });
    if (match && match.externalId === d.externalId) await retire(match, verdict.reason, ctx, !salesReturn);
    return;
  }
  // Tedarikçinin vergi nosu: gelen e-faturadaki (imzalı belge) önce, yoksa Paraşüt'teki kişi kartındaki
  const taxRaw = d.eDocumentTaxNo ?? d.supplierTaxNo;
  const taxFrom = d.eDocumentTaxNo ? ("einvoice" as const) : ("bill" as const);
  const common = {
    date: d.date,
    invoiceNo: d.invoiceNo,
    amount: d.amount,
    discount: d.discount,
    vat: d.vat,
    payable: d.payable,
    outstanding: d.outstanding,
    parasutUnpaid: d.unpaid,
    externalId: d.externalId,
    source: "parasut" as const,
    syncedAt: new Date(),
    ...(eInvoiceFree ? { eInvoiceId: eInvoiceFree } : {}),
  };
  let invoiceId: number;
  if (match) {
    // Kategori, tedarikçi adı ve "ödendi/ödenmedi" panelde kalır: ödeme durumunu kullanıcı işaretler, Paraşüt'ünki
    // yalnız ipucu olarak yazılır (parasutUnpaid; Tedarikçiler'de "Paraşüt'te ödendi"). Vade: panelde ertelenen vade,
    // Paraşüt'teki vade o zamandan beri aynıysa korunur; Paraşüt'te vade yoksa paneldeki vade kalır.
    // Yer tutucu ad, yalnızca gerçek tedarikçi adı okunabildiyse düzeltilir (açıklamayla değil)
    const supplierFix = match.supplier === PLACEHOLDER_SUPPLIER && d.supplierResolved ? { supplier: ctx.alias(d.supplier) } : {};
    // Paraşüt borcu kapattı ama panelde hâlâ ödenmedi: bilinen kalan tutar korunur (Paraşüt'ün 0'ı yazılsa kalan borç
    // faturanın tamamına dönerdi)
    const keepOutstanding = match.unpaid && !d.unpaid;
    // Yer tutucu adla açılmış fatura gerçek adıyla peşin çalışılan tedarikçinin kartına düştü: yeni faturadaki kural
    // (tedarikçi Tedarikçiler'deki gibi adla ve vergi noyla bulunur)
    const card =
      supplierFix.supplier && match.origin === "parasut" && match.unpaid && !match.paidAt && !match.paymentRequestedAt ? ctx.paidOnDelivery(supplierFix.supplier, taxRaw ?? match.supplierTaxNumber) : null;
    const settle = card ? { unpaid: false, paidAt: match.date, paidVia: card.paymentMethod } : {};
    // Yeniden içeri alınan e-faturada eski gider faturasının vadesi: panelde ertelenen vade, Paraşüt'teki vade aynıysa kalır
    const dueKey = match.externalId === d.externalId ? d.externalId : relinkFrom;
    const seenDue = dueKey && Object.hasOwn(ctx.dueSeen, dueKey) ? ctx.dueSeen[dueKey] : undefined;
    const dueDate = syncedDueDate(match.dueDate, d.dueDate, seenDue);
    if (relinkFrom) rememberDue(ctx, relinkFrom, null, false);
    // Cari: tutarı değişen faturanın dağıtımı çalışmanın sonunda yeniden dengelenir (K20)
    if (match.payable !== d.payable) ctx.payableChanged.push({ id: match.id, from: match.payable, to: d.payable });
    await db
      .update(s.invoices)
      .set({ ...common, ...(keepOutstanding ? { outstanding: match.outstanding } : {}), ...supplierFix, ...settle, dueDate })
      .where(eq(s.invoices.id, match.id));
    invoiceId = match.id;
    if (match.date !== d.date) ctx.touchedMonths.add(match.date.slice(0, 7));
    Object.assign(match, {
      ...supplierFix,
      ...(eInvoiceFree ? { eInvoiceId: eInvoiceFree } : {}),
      externalId: d.externalId,
      invoiceNo: d.invoiceNo,
      source: "parasut",
      date: d.date,
      payable: d.payable,
      dueDate,
      parasutUnpaid: d.unpaid,
      syncedAt: common.syncedAt,
      ...(keepOutstanding ? {} : { outstanding: d.outstanding }),
      ...(card ? { unpaid: false, paidAt: match.date } : {}),
    });
    // E-fatura bağı yukarıda kayda yazıldı: kişi kartındaki numara e-faturalı kaydın numarasını ezmez
    await fillTaxNumber(ctx, match, taxRaw, taxFrom);
    rememberDue(ctx, d.externalId, d.dueDate, match.unpaid);
    ctx.counts.updated++;
  } else {
    const supplier = ctx.alias(d.supplier);
    const { category, reason } =
      supplier === PLACEHOLDER_SUPPLIER
        ? pickCategory({ ...d, supplier }, ctx.rules, new Map(), INVOICE_CATEGORIES)
        : pickCategory({ ...d, supplier }, ctx.rules, ctx.history, INVOICE_CATEGORIES);
    const pay = newInvoicePayment(
      // Komisyon yalnız kategori güvenilirse (kural, geçmiş, platform listesi) ödendi sayılır; ipucu tahmini sayılmaz
      { payable: d.payable, date: d.date, parasutUnpaid: d.unpaid, commission: category === COMMISSION_CATEGORY && !categoryNeedsReview(reason) },
      ctx.paidOnDelivery(supplier, taxRaw),
      ctx.paymentsSince,
    );
    const supplierTaxNumber = cleanTaxNumber(taxRaw);
    // Cari takipteki kartın yeni faturası panelde sayılır: taban 0, takip başlamadan önceki tarihliyse (geçmişi alırken,
    // geç girilmiş fatura) Paraşüt'te o güne kadar ödenen kısım
    const trackedCard = ctx.trackedCard(supplier, taxRaw);
    // Aynı e-fatura başka bir (hâlâ duran) gider faturasında ya da kişisi müşteri kartı: kayıt kontrol bekler
    const doubt = [
      twin ? `aynı e-fatura başka bir gider faturasında da var (${twin.invoiceNo ?? twin.externalId}); çift sayılmasın, kontrol edin` : "",
      customerContactBill(d) ? CUSTOMER_CONTACT_NOTE : "",
    ].filter(Boolean);
    const [row] = await db
      .insert(s.invoices)
      .values({
        ...common,
        ...pay,
        dueDate: d.dueDate,
        origin: "parasut",
        supplier,
        supplierTaxNumber,
        category,
        description: d.description,
        needsReview: categoryNeedsReview(reason) || doubt.length > 0,
        note: [`Paraşüt'ten alındı · kategori: ${reason}`, ...doubt].join(" · "),
        ledgerBase: arrivalLedgerBase(trackedCard, { date: d.date, payable: d.payable, unpaid: pay.unpaid, outstanding: d.outstanding }),
      })
      .returning({ id: s.invoices.id });
    // Peşin çalışılan takipli kart: hesaptaki para çalışmanın sonunda faturaya sayılır (K21); takipten önceki tarihli
    // fatura (Geçmiş faturaları al) kapıda ödenmişti, avans almaz (E-14)
    if (trackedCard !== null && takesCreditOnArrival({ date: d.date, unpaid: pay.unpaid }, trackedCard.since) && ctx.paidOnDelivery(supplier, taxRaw)) {
      ctx.pesinTracked.push({ id: row.id, cardId: trackedCard.id });
    }
    if (twin) console.warn("Paraşüt: aynı e-fatura iki gider faturasında", { eInvoiceId, bills: [twin.externalId, d.externalId] });
    invoiceId = row.id;
    if (supplierTaxNumber) ctx.taxFilled++;
    ctx.existing.push({
      id: row.id,
      vat: common.vat,
      eInvoiceId: eInvoiceFree,
      externalId: d.externalId,
      invoiceNo: d.invoiceNo,
      supplier,
      date: d.date,
      payable: d.payable,
      unpaid: pay.unpaid,
      dueDate: d.dueDate,
      origin: "parasut",
      source: "parasut",
      note: null,
      parasutUnpaid: d.unpaid,
      outstanding: d.outstanding,
      paidAt: pay.paidAt,
      paymentRequestedAt: null,
      syncedAt: common.syncedAt,
      supplierTaxNumber,
    });
    rememberDue(ctx, d.externalId, d.dueDate, pay.unpaid);
    ctx.counts.created++;
  }
  ctx.touchedMonths.add(d.date.slice(0, 7));
  // Kalemleri e-fatura belgesinden (UBL) okunmuş kayıt: fatura sonradan Paraşüt'te içeri alınınca kalemler korunur;
  // gider faturasının kalemleriyle değişseydi ürün anahtarları (e:… → p:…) değişir, hammadde bağlantıları düşerdi
  if (ctx.ublLines.has(invoiceId)) return;
  // Kalemler her seferinde baştan yazılır (aynı kalem başka bir satıra bağlı kalmışsa o da silinir)
  await db.delete(s.parasutBillLines).where(eq(s.parasutBillLines.invoiceId, invoiceId));
  if (d.lines.length) {
    await db.delete(s.parasutBillLines).where(inArray(s.parasutBillLines.externalId, d.lines.map((l) => l.externalId)));
    await db.insert(s.parasutBillLines).values(d.lines.map((l) => ({ ...l, invoiceId })));
  }
}

/** Şu an süren bir eşitleme var mı ("Kalemleri şimdi oku" aynı kalemleri eşitlemeyle birlikte yazmasın) */
export async function parasutSyncRunning(): Promise<boolean> {
  const [run] = await getDb()
    .select({ id: s.parasutSyncRuns.id })
    .from(s.parasutSyncRuns)
    .where(and(eq(s.parasutSyncRuns.status, "running"), gte(s.parasutSyncRuns.startedAt, new Date(Date.now() - STALE_RUN_MS))))
    .limit(1);
  return Boolean(run);
}

/**
 * Eşitleme kaydını açar; başka bir eşitleme sürüyorsa null. Önceki bir çalışma işlev süresi dolduğu için yarıda
 * kesildiyse "sürüyor" kalmasın. Sabah işi, e-posta işinin yeniden denemesi, "Şimdi eşitle" ve tedarikçi geçmişi aynı
 * anda çalışıp aynı faturaları yazmaya kalkmasın: denetim ve kayıt kilit altında (oturum kilidi havuzlu bağlantıda
 * güvenilmez, işlem kilidi işlem bitince bırakılır)
 */
async function openRun(trigger: "cron" | "manual" | "history", started: number): Promise<number | null> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SYNC_LOCK})`);
    await tx
      .update(s.parasutSyncRuns)
      .set({ status: "error", finishedAt: new Date(), message: "Yarıda kesildi (işlev süresi doldu)" })
      .where(and(eq(s.parasutSyncRuns.status, "running"), lt(s.parasutSyncRuns.startedAt, new Date(started - STALE_RUN_MS))));
    const [busy] = await tx.select({ id: s.parasutSyncRuns.id }).from(s.parasutSyncRuns).where(eq(s.parasutSyncRuns.status, "running")).limit(1);
    if (busy) return null;
    const [run] = await tx.insert(s.parasutSyncRuns).values({ trigger }).returning({ id: s.parasutSyncRuns.id });
    return run.id;
  });
}

/**
 * Faturaları yazmanın bağlamı: paneldeki faturalar, kurallar, yok sayılanlar, vadeler, peşin kartlar. `client`
 * verilirse yeniden içeri alınan e-faturanın eski gider faturası Paraşüt'e sorulur (yoksa kayıt taşınmaz)
 */
async function loadCtx(listed: Iterable<string> = [], client: ParasutClient | null = null): Promise<Ctx> {
  const db = getDb();
  const [existingRows, rules, ignoredList, dueSeen, ublRows, paidOnDelivery, paymentsSince, trackedCard] = await Promise.all([
    db
      .select({
        id: s.invoices.id,
        externalId: s.invoices.externalId,
        eInvoiceId: s.invoices.eInvoiceId,
        invoiceNo: s.invoices.invoiceNo,
        supplier: s.invoices.supplier,
        date: s.invoices.date,
        payable: s.invoices.payable,
        vat: s.invoices.vat,
        unpaid: s.invoices.unpaid,
        dueDate: s.invoices.dueDate,
        origin: s.invoices.origin,
        source: s.invoices.source,
        note: s.invoices.note,
        parasutUnpaid: s.invoices.parasutUnpaid,
        outstanding: s.invoices.outstanding,
        paidAt: s.invoices.paidAt,
        paymentRequestedAt: s.invoices.paymentRequestedAt,
        syncedAt: s.invoices.syncedAt,
        category: s.invoices.category,
        needsReview: s.invoices.needsReview,
        supplierTaxNumber: s.invoices.supplierTaxNumber,
      })
      .from(s.invoices),
    loadRules(),
    getState<string[]>(IGNORE_KEY),
    getState<Record<string, string | null>>(DUE_KEY),
    db
      .selectDistinct({ id: s.parasutBillLines.invoiceId })
      .from(s.parasutBillLines)
      .where(like(s.parasutBillLines.externalId, "ubl:%")),
    loadPaidOnDelivery(),
    loadPaymentsSince(),
    trackedCardResolver(),
  ]);
  // Kısa adlar kaydı ilk açanın (origin) Paraşüt olmadığı faturalardan öğrenilir. Tedarikçi geçmişine eşitlemenin
  // açıp kontrol edilmiş (onaylanmış, kategorisi değiştirilmiş ya da kurala/geçmişe dayanan) faturaları da katılır;
  // kontrol bekleyen tahminler katılmaz (yanlış bir tahmin kendini çoğaltmasın)
  const own = existingRows.filter((i) => i.origin !== "parasut");
  const history = supplierHistory(existingRows.filter(feedsSupplierHistory));
  const alias = supplierAliases(own.map((i) => i.supplier));
  return {
    existing: existingRows as Existing[],
    rules,
    history,
    alias,
    ignored: new Set(ignoredList ?? []),
    ublLines: new Set(ublRows.map((r) => r.id)),
    applied: new Set(),
    touchedMonths: new Set(),
    counts: { created: 0, updated: 0, removed: 0 },
    dueSeen: { ...(dueSeen ?? {}) },
    dueDirty: false,
    paidOnDelivery,
    paymentsSince,
    taxFilled: 0,
    listed: new Set(listed),
    billState: client ? (id) => billState(client, id) : async () => "present",
    returns: { sales: new Map(), supplier: new Map() },
    trackedCard,
    payableChanged: [],
    pesinTracked: [],
  };
}

/**
 * Cari son adımları (K20, K21): tutarı değişen faturaların dağıtımı yeniden dengelenir, peşin takipli kartın yeni
 * faturasına hesaptaki para sayılır. Hatası eşitlemeyi bozmaz; özet satırının parçası döner (yoksa boş)
 */
async function cariFinalSteps(ctx: Ctx): Promise<string> {
  try {
    const moved = ctx.payableChanged.length ? await resettleAfterSync(ctx.payableChanged) : null;
    const credited = ctx.pesinTracked.length ? await applyCreditOnArrival(ctx.pesinTracked) : null;
    const parts = [
      moved?.movedInvoices ? `${moved.movedInvoices} faturada ödeme hesaba geçti` : "",
      moved?.reopened ? `${moved.reopened} fatura yeniden ödenmedi` : "",
      credited?.invoices ? `${credited.invoices} peşin faturaya hesaptaki ödeme sayıldı` : "",
    ].filter(Boolean);
    return parts.length ? `Cari: ${parts.join(", ")}` : "";
  } catch (err) {
    console.error("[cari] eşitlemenin son adımları", err);
    return "";
  }
}

/**
 * Gider faturası Paraşüt'te silinmiş (404) ya da iptal edilmiş mi. Okunamazsa (ağ, zaman aşımı, 5xx, süre) "unknown":
 * kayıt taşınmaz, yeni fatura da yazılmaz (applyDraft)
 */
async function billState(client: ParasutClient, externalId: string): Promise<BillState> {
  try {
    const res = await client.show<Record<string, unknown>>(`purchase_bills/${encodeURIComponent(externalId)}`);
    return str(res.data.attributes.item_type) === "cancelled" ? "gone" : "present";
  } catch (e) {
    return e instanceof ParasutError && !(e instanceof ParasutAuthError) && e.status === 404 ? "gone" : "unknown";
  }
}

/**
 * Paraşüt'ten gider faturalarını çeker ve panele yazar: yeni fatura eklenir, değişen güncellenir, iptal edilen ya
 * da Paraşüt'te silinen kaldırılır; kalemler saklanır, hammaddeye bağlı kalemlerden aylık alınan miktar ve
 * (istenirse) hammadde fiyatı güncellenir.
 *
 * Süre: okuma `deadlineMs`in %60'ında bırakılır, kalan süre yazmaya ayrılır; yarım kalan tur kaldığı sayfadan
 * sürer. İmleç (son fatura tarihi) yalnızca tur tamamlanınca ve bugünü geçmeyecek şekilde ilerler.
 */
export async function syncParasut(
  trigger: "cron" | "manual",
  opts: { from?: string; deadlineMs?: number } = {},
): Promise<SyncOk | SyncErr> {
  const started = Date.now();
  const deadline = opts.deadlineMs ?? DEADLINE_MS;
  const fetchUntil = started + deadline * FETCH_SHARE;
  const overBudget = () => Date.now() - started > deadline;
  const db = getDb();
  let runId: number | null = null;
  try {
    const cfg = readParasutConfig();
    const id = await openRun(trigger, started);
    if (id === null) return { ok: false, error: SYNC_BUSY, runId: null, busy: true };
    runId = id;

    const today = todayTR();
    const cursor = await getState<{ lastIssueDate?: string }>(CURSOR_KEY);
    const storedResume = await getState<Resume>(RESUME_KEY);
    // Elle verilen başlangıç tarihi yeni bir tur başlatır; daha geriden süren yarım tur varsa ona dokunulmaz
    const resume = opts.from ? null : storedResume;
    const anchor = cursor?.lastIssueDate && cursor.lastIssueDate < today ? cursor.lastIssueDate : today;
    const windowStart = opts.from ?? resume?.windowStart ?? (cursor?.lastIssueDate ? addDays(anchor, -LOOKBACK_DAYS) : (cfg.syncFrom ?? `${today.slice(0, 4)}-01-01`));
    const startPage = resume ? Math.max(1, resume.page) : 1;
    const keepStoredResume = Boolean(opts.from && storedResume && storedResume.windowStart < windowStart);

    const client = new ParasutClient(cfg);
    client.setDeadline(started + deadline);
    const drafts: (BillDraft & { page: number })[] = [];
    let partial = false;
    let reachedEnd = false;
    let include = resume?.include ?? INCLUDES[0];

    const fetchPages = async () => {
      for await (const page of client.pages<Record<string, unknown>>("purchase_bills", { sort: "-issue_date", include }, 200, startPage)) {
        const res = page as ListResponse<Record<string, unknown>> & { page: number };
        let older = false;
        for (const bill of res.data) {
          const d = billToDraft(bill, res.included);
          if (d.date && d.date < windowStart) {
            older = true;
            continue;
          }
          drafts.push({ ...d, page: res.page });
        }
        const total = res.meta?.total_pages;
        if (older || !res.data.length || (total !== undefined && res.page >= total)) {
          reachedEnd = true;
          return;
        }
        if (Date.now() > fetchUntil) {
          partial = true;
          return;
        }
      }
      reachedEnd = true;
    };
    // Okuma payı dolduktan sonra yeni istek başlamaz (son istek en çok REQUEST_TIMEOUT kadar sürer)
    client.setDeadline(fetchUntil + 15_000);
    for (let i = Math.max(0, INCLUDES.indexOf(include)); ; i++) {
      try {
        await fetchPages();
        break;
      } catch (e) {
        if (e instanceof ParasutDeadlineError) {
          partial = true;
          break;
        }
        // Yalnızca fatura isteğinin reddi include'u değiştirir; giriş hatası (yanlış parola) yeniden denenmez
        if (e instanceof ParasutError && !(e instanceof ParasutAuthError) && (e.status === 400 || e.status === 422) && i < INCLUDES.length - 1) {
          include = INCLUDES[i + 1];
          drafts.length = 0;
          continue;
        }
        throw e;
      }
    }
    client.setDeadline(started + deadline);
    const contacts = (await getState<ContactCache>(CONTACTS_KEY)) ?? {};
    if (!include.startsWith("supplier")) await fillSupplierNames(client, drafts, contacts, started + deadline * CONTACTS_SHARE);

    // ---- panel verisi
    const ctx = await loadCtx(
      drafts.map((d) => d.externalId),
      client,
    );

    let maxDate = resume?.maxDate ?? "";
    let processedUntilPage = startPage - 1;
    const seen = new Set<string>();
    for (let idx = 0; idx < drafts.length; idx++) {
      const d = drafts[idx];
      // Yazma da süreye dahil; en az bir sayfa yazıldıktan sonra sayfa sınırında bırakılır, kalan sayfa sonraki
      // çalışmada yeniden okunur
      if (idx > 0 && d.page !== drafts[idx - 1].page && overBudget()) {
        partial = true;
        reachedEnd = false;
        break;
      }
      processedUntilPage = d.page;
      seen.add(d.externalId);
      if (shouldImport(d).ok && d.date <= today && d.date > maxDate) maxDate = d.date;
      await applyDraft(d, ctx);
    }

    // ---- tam turdan sonra: listede görünmeyen (Paraşüt'te silinmiş/iptal) ve pencere dışında kalmış ödenmemiş
    // faturalar tek tek yeniden okunur (sınırlı sayıda; kalanı sonraki günlere)
    // Yarım turun devamında ilk sayfalar bu çalışmada okunmadığı için "görünmeyen" denetimi yapılmaz. En uzun
    // süredir denetlenmeyenler önce gelir; her gün başka faturalara sıra gelir. Tek bir faturanın hatası eşitlemeyi
    // bozmaz (kaydedilir, sonraki faturaya geçilir).
    let rechecked = 0;
    if (reachedEnd && !partial) {
      const bySync = (a: Existing, b: Existing) => (a.syncedAt?.getTime() ?? 0) - (b.syncedAt?.getTime() ?? 0);
      const unseen = resume
        ? []
        : ctx.existing.filter((e) => e.source === "parasut" && e.externalId && e.date >= windowStart && !seen.has(e.externalId)).sort(bySync);
      const oldOpen = ctx.existing.filter((e) => e.source === "parasut" && e.externalId && e.unpaid && e.date < windowStart).sort(bySync);
      for (const e of [...unseen, ...oldOpen].slice(0, RECHECK_LIMIT)) {
        if (overBudget()) break;
        const externalId = e.externalId!;
        try {
          // Tek fatura okumasında belgelenmiş include'lar istenir; tedarikçi adı önbellekten gelir
          const res = await client.show<Record<string, unknown>>(`purchase_bills/${encodeURIComponent(externalId)}`, { include: SHOW_INCLUDE });
          const d = billToDraft(res.data, (res as ShowResponse).included);
          applyContacts([d], contacts);
          await applyDraft(d, ctx);
        } catch (err) {
          if (err instanceof ParasutDeadlineError) break;
          if (err instanceof ParasutAuthError) {
            console.error("Paraşüt yeniden denetim: oturum", err);
            break;
          }
          try {
            if (err instanceof ParasutError && err.status === 404) await retire(e, "silinmiş", ctx, true);
            else console.error("Paraşüt yeniden denetim", externalId, err);
          } catch (inner) {
            console.error("Paraşüt yeniden denetim", externalId, inner);
          }
        }
        rechecked++;
      }
    }

    // ---- geç girilen eski tarihli faturalar (kimlik sırasıyla; tam turdan sonra, e-faturalara süre kalacak kadar)
    let late: { created: number; done: boolean } | null = null;
    if (reachedEnd && !partial && Date.now() - started < deadline - 14_000) {
      try {
        late = await catchLateBills(client, ctx, { include, contacts, until: started + deadline * CONTACTS_SHARE });
      } catch (err) {
        if (!(err instanceof ParasutDeadlineError)) console.error("Paraşüt geç girilen faturalar", err);
      }
    }

    // ---- gelen e-faturalar: Paraşüt'te "içeri al" yapılmamış olanlar da gider olarak gelir
    let eStats: EInvoiceStats | null = null;
    let eError: string | null = null;
    if (Date.now() - started < deadline - 10_000) {
      const eCursor = await getState<{ lastIssueDate?: string }>(E_CURSOR_KEY);
      const eAnchor = eCursor?.lastIssueDate && eCursor.lastIssueDate < today ? eCursor.lastIssueDate : today;
      const eWindowStart = opts.from ?? (eCursor?.lastIssueDate ? addDays(eAnchor, -LOOKBACK_DAYS) : (cfg.syncFrom ?? `${today.slice(0, 4)}-01-01`));
      try {
        eStats = await syncEInvoices(client, ctx, { windowStart: eWindowStart, until: started + deadline - 6_000, today });
        if (eStats.complete && eStats.maxDate && eStats.maxDate >= (eCursor?.lastIssueDate ?? "")) await setState(E_CURSOR_KEY, { lastIssueDate: eStats.maxDate, at: new Date().toISOString() });
        await setState(PENDING_KEY, { count: eStats.notImported, total: Math.round(eStats.notImportedTotal * 100) / 100, ingested: true, at: new Date().toISOString() });
      } catch (err) {
        if (!(err instanceof ParasutDeadlineError)) {
          eError = err instanceof Error ? err.message : String(err);
          console.error("Paraşüt e-fatura eşitlemesi", err);
        }
      }
    }

    // ---- e-fatura kalemleri (UBL): ürün, miktar, birim fiyat; süre kaldıkça en yeni faturadan başlayarak
    let lineStats: LineReadStats | null = null;
    if (Date.now() - started < deadline - 8_000) {
      try {
        lineStats = await readEInvoiceLines(client, { until: started + deadline - 4_000 });
        for (const m of lineStats.months) ctx.touchedMonths.add(m);
      } catch (err) {
        if (!(err instanceof ParasutDeadlineError)) console.error("Paraşüt e-fatura kalemleri", err);
      }
    }

    // ---- eski faturaların tedarikçi vergi nosu (bir kerelik, kaldığı yerden sürer; tax-backfill.ts): yalnız artan
    // sürede, hatası eşitlemeyi bozmaz; ilerlemesi yalnız bu özetteki "vergi no yazıldı" sayısında görünür
    let backfill: { filled: number; done: boolean } | null = null;
    if (Date.now() - started < deadline - 6_000) {
      try {
        backfill = await backfillSupplierTaxNumbers(client, { until: started + deadline - 3_000 });
      } catch (err) {
        if (!(err instanceof ParasutDeadlineError)) console.error("Paraşüt vergi no tamamlama", err);
      }
    }

    if (ctx.dueDirty) await setState(DUE_KEY, ctx.dueSeen);
    const returns = await saveReturns(ctx, today);
    const linked = ctx.touchedMonths.size ? await applyProductLinks([...ctx.touchedMonths]) : null;
    // Cari: tutarı değişen faturaların dağıtımı ve peşin kartın yeni faturası (docs/TEDARIKCILER.md)
    const cari = await cariFinalSteps(ctx);
    if (partial && !reachedEnd) {
      // Hiç sayfa yazılamadıysa kalınan yer değişmez
      if (!keepStoredResume && processedUntilPage >= startPage) {
        await setState(RESUME_KEY, { page: processedUntilPage + 1, windowStart, include, maxDate } satisfies Resume);
      } else if (!keepStoredResume && !resume) {
        await setState(RESUME_KEY, { page: startPage, windowStart, include, maxDate } satisfies Resume);
      }
    } else {
      if (!keepStoredResume) await db.delete(s.integrationState).where(eq(s.integrationState.key, RESUME_KEY));
      if (maxDate && maxDate >= (cursor?.lastIssueDate ?? "")) await setState(CURSOR_KEY, { lastIssueDate: maxDate, at: new Date().toISOString() });
    }

    const { created, updated, removed } = ctx.counts;
    const fetched = drafts.length + (eStats?.fetched ?? 0);
    // Yeni faturalar, var olanlar, e-fatura belgesinden okunanlar ve eski faturaların tamamlaması birlikte
    const taxFilled = ctx.taxFilled + (lineStats?.taxFilled ?? 0) + (backfill?.filled ?? 0);
    const parts = [
      `${drafts.length} gider faturası${eStats ? ` · ${eStats.fetched} e-fatura` : ""} okundu`,
      `${created} yeni`,
      `${updated} güncellendi`,
      removed ? `${removed} kaldırıldı` : "",
      rechecked ? `${rechecked} yeniden denetlendi` : "",
      taxFilled ? `${taxFilled} faturaya vergi no yazıldı` : "",
      lineStats?.read ? `${lineStats.read} e-faturanın kalemleri okundu` : "",
      lineStats?.corrected ? `${lineStats.corrected} tevkifatlı faturanın tutarı belgeden düzeltildi` : "",
      lineStats?.remaining ? `${lineStats.remaining} faturanın kalemleri sırada` : "",
      late?.created ? `${late.created} geç girilmiş eski fatura alındı` : "",
      returns.sales ? `${returns.sales} satış iadesi gider sayılmadı` : "",
      returns.supplier ? `${returns.supplier} tedarikçiye iade panele girmedi (Paraşüt sayfasında)` : "",
      linked?.held ? `${linked.held} fiyat onaya düştü (%40'tan fazla fark)` : "",
      cari,
      partial || (eStats && !eStats.complete) ? "süre doldu, kalanı sonraki eşitlemede sürecek" : "",
      eError ? `e-faturalar okunamadı: ${eError}` : "",
    ].filter(Boolean);
    const summary = parts.join(" · ");
    await db
      .update(s.parasutSyncRuns)
      .set({ status: "ok", finishedAt: new Date(), fetched, created, updated, removed, message: summary })
      .where(eq(s.parasutSyncRuns.id, runId));
    if (created || updated || removed || taxFilled) await logActivity(null, trigger === "cron" ? "Paraşüt eşitlemesi (otomatik)" : "Paraşüt eşitlemesi", summary);
    return { ok: true, summary, runId, fetched, created, updated, removed, partial };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (runId) await db.update(s.parasutSyncRuns).set({ status: "error", finishedAt: new Date(), message: error.slice(0, 1000) }).where(eq(s.parasutSyncRuns.id, runId));
    console.error("Paraşüt eşitlemesi", e);
    return { ok: false, error, runId };
  }
}

// ---------------------------------------------------------------- Tedarikçinin geçmiş faturaları

/** Ada göre kişi aramasında bakılan en fazla ad ve faturadan kimlik okumada bakılan en fazla fatura */
const HISTORY_LOOKUPS = 4;

export interface SupplierHistoryTarget {
  /** İşlem geçmişinde ve eşitleme kaydında görünen ad */
  label: string;
  /** Tedarikçinin paneldeki Paraşüt faturalarının dış kimlikleri, en yeni önce (kişi kimliği bunlardan okunur) */
  billIds: string[];
  /** Kartta yazılı vergi no: faturası yoksa kişi bununla aranır */
  taxNumber: string | null;
  /** Faturası ve vergi nosu yoksa kişi bu adlarla aranır */
  names: string[];
  /** Paraşüt'teki kişi adı bu tedarikçinin mi: "same" aynı ad (anahtar), "similar" baştaki kelimeleri tutuyor */
  match: (name: string) => "same" | "similar" | null;
}

export type HistoryOk = {
  ok: true;
  summary: string;
  /** Bulunan Paraşüt kişileri (adıyla) */
  contacts: { id: string; name: string }[];
  fetched: number;
  created: number;
  updated: number;
  /** Paraşüt'te iptal edilmiş olduğu için panelden kaldırılan (günlük eşitlemedeki gibi) */
  removed: number;
  /** Okunan faturaların bu eşitlemenin verdiği tedarikçi adları (kartın diğer adlarına eklenebilir) */
  names: string[];
  oldest: string | null;
  /** Süre doldu, okunacak sayfa kaldı: yeniden basınca kaldığı yerden sürer */
  partial: boolean;
  /** Yazılamayan fatura (yeniden içeri alınan e-faturanın eski faturası Paraşüt'e sorulamadı) */
  deferred: number;
  /** Yazılamayan fatura kalınan yeri kendi sayfasına geri aldı: yeniden basınca denenir (yoksa sonraki tam okumada) */
  held: boolean;
  /** Önceki yarım kalan okumanın devamı (ilk sayfalar bu sefer okunmadı) */
  resumed: boolean;
};

/** Paraşüt `filter[supplier_id]`i uygulamadı: liste başka tedarikçinin faturasını getirdi */
class FilterIgnoredError extends Error {}

/**
 * Panel tedarikçisinin Paraşüt kişi kimlikleri: kendi faturalarından, yoksa vergi nosundan, o da yoksa adından. Adla
 * aramada aynı adlı kişiler alınır; yoksa benzer adlı (ör. kısa ad ↔ tam unvan) tek bir kişi varsa o alınır, birden
 * çoksa hiçbiri (yanlış firmanın faturaları gelmesin). Aramalar yalnız tedarikçi kişilerde.
 */
async function findSupplierContacts(client: ParasutClient, t: SupplierHistoryTarget): Promise<{ id: string; name: string }[]> {
  const found = new Map<string, string>();
  for (const id of t.billIds.slice(0, HISTORY_LOOKUPS)) {
    try {
      // İlişkinin kimliği yalnız include edilince gelir (docs/parasut-api-spec.md)
      const bill = await client.show<Record<string, unknown>>(`purchase_bills/${encodeURIComponent(id)}`, { include: "supplier" });
      const rel = bill.data.relationships?.supplier?.data;
      if (rel && !Array.isArray(rel) && !found.has(rel.id)) found.set(rel.id, t.label);
    } catch (e) {
      // Paraşüt'te silinmiş fatura atlanır; oturum ve süre hataları yukarı çıkar
      if (!(e instanceof ParasutError) || e.status !== 404) throw e;
    }
    if (found.size) break;
  }
  if (found.size) return [...found].map(([id, name]) => ({ id, name }));
  const search = async (filter: Record<string, string>) => {
    const res = await client.get<ListResponse<{ name?: string }>>("contacts", { ...filter, "filter[account_type]": "supplier", "page[size]": 25 });
    return res.data.map((c) => ({ id: c.id, name: c.attributes.name?.trim() ?? "" })).filter((c) => c.name);
  };
  if (t.taxNumber) for (const c of await search({ "filter[tax_number]": t.taxNumber })) found.set(c.id, c.name);
  if (found.size) return [...found].map(([id, name]) => ({ id, name }));
  const same = new Map<string, string>();
  const similar = new Map<string, string>();
  for (const n of t.names.slice(0, HISTORY_LOOKUPS)) {
    for (const c of await search({ "filter[name]": n })) {
      const m = t.match(c.name);
      if (m === "same") same.set(c.id, c.name);
      else if (m === "similar") similar.set(c.id, c.name);
    }
  }
  const pick = same.size ? same : similar.size === 1 ? similar : new Map<string, string>();
  return [...pick].map(([id, name]) => ({ id, name }));
}

/** Bitmiş kişi (HISTORY_KEY): bütün kişileri bitince kayıt silinir, sonraki basış baştan okur */
const HISTORY_DONE = -1;

/**
 * Tedarikçinin Paraşüt'teki bütün gider faturaları, tarih sınırı olmadan (tedarikçi sayfasındaki "Geçmiş faturaları
 * al"). Paraşüt kişi kimliğiyle süzülür (`filter[supplier_id]`) ve eşitlemenin kuralıyla yazılır: var olan fatura
 * güncellenir, panelde silinen (yok sayılan) gelmez, Paraşüt'te iptal edilmiş olan kaldırılır, yeni açılan eski
 * fatura Paraşüt'teki ödeme durumuyla gelir (newInvoicePayment, payments.since). Eşitlemeden farkı: listede
 * görünmeyen fatura kaldırılmaz, imleç ve yarım tur kaydı değişmez, gelen e-fatura kutusu okunmaz (o liste tedarikçiye
 * göre süzülemiyor). Kayıt "history" türüyle düşer: günlük eşitlemenin sağlığına (zil, sabah e-postası, yeniden
 * deneme) sayılmaz. Faturalar eskiden yeniye okunur; süre dolarsa okunan sayfalar yazılır ve kalınan sayfa saklanır,
 * yeniden basınca oradan sürer. Yazılamayan fatura (yeniden içeri alınan e-faturanın eski faturası Paraşüt'e
 * sorulamadı) kalınan yeri kendi sayfasına geri alır; o sayfadan yeniden denenip yine yazılamazsa geçilir, sonraki tam
 * okumada denenir. Paraşüt süzgeci uygulamazsa (liste başka tedarikçinin faturasını getirirse) hiçbir şey yazılmaz.
 */
export async function syncSupplierHistory(target: SupplierHistoryTarget, opts: { deadlineMs?: number } = {}): Promise<HistoryOk | SyncErr> {
  const started = Date.now();
  const deadline = opts.deadlineMs ?? DEADLINE_MS;
  const fetchUntil = started + deadline * FETCH_SHARE;
  const db = getDb();
  let runId: number | null = null;
  try {
    const cfg = readParasutConfig();
    const client = new ParasutClient(cfg);
    client.setDeadline(fetchUntil + 15_000);
    // Kişi önce bulunur (yalnız okur): bulunamazsa eşitleme kaydı açılmaz
    const contacts = await findSupplierContacts(client, target);
    if (!contacts.length) {
      return { ok: false, error: "Bu tedarikçi Paraşüt'te bulunamadı. Paraşüt'teki adı farklıysa bilgilerine vergi numarasını yazıp yeniden deneyin.", runId: null };
    }
    runId = await openRun("history", started);
    if (runId === null) return { ok: false, error: SYNC_BUSY, runId: null, busy: true };

    const progress = (await getState<Record<string, number>>(HISTORY_KEY)) ?? {};
    // Bütün kişileri bitmişse baştan; yoksa bitenler atlanır, kalanlar kaldığı sayfadan sürer
    if (contacts.every((c) => progress[c.id] === HISTORY_DONE)) for (const c of contacts) delete progress[c.id];
    const resumed = contacts.some((c) => (progress[c.id] ?? 1) !== 1);
    const drafts: (BillDraft & { contactId: string; page: number })[] = [];
    /** Bu basışta her kişinin okumaya başladığı sayfa */
    const startPages = new Map<string, number>();
    let partial = false;
    let include = INCLUDES[0];
    for (const contact of contacts) {
      if (progress[contact.id] === HISTORY_DONE) continue;
      const startPage = Math.max(1, progress[contact.id] ?? 1);
      startPages.set(contact.id, startPage);
      let next = startPage;
      for (let i = INCLUDES.indexOf(include); ; i++) {
        const got: (BillDraft & { contactId: string; page: number })[] = [];
        next = startPage;
        try {
          for await (const res of client.pages<Record<string, unknown>>("purchase_bills", { "filter[supplier_id]": contact.id, sort: "id", include }, 400, startPage)) {
            for (const bill of res.data) {
              const d = billToDraft(bill, res.included);
              if (d.supplierId !== contact.id) throw new FilterIgnoredError();
              got.push({ ...d, contactId: contact.id, page: res.page });
            }
            next = res.page + 1;
            const total = res.meta?.total_pages;
            const more = res.data.length > 0 && !(total !== undefined && res.page >= total);
            if (more && Date.now() > fetchUntil) {
              partial = true;
              break;
            }
          }
          if (!partial) next = HISTORY_DONE;
        } catch (e) {
          if (e instanceof ParasutError && !(e instanceof ParasutAuthError) && !(e instanceof ParasutDeadlineError) && (e.status === 400 || e.status === 422) && i < INCLUDES.length - 1) {
            include = INCLUDES[i + 1];
            continue;
          }
          if (!(e instanceof ParasutDeadlineError)) throw e;
          partial = true;
        }
        drafts.push(...got);
        break;
      }
      progress[contact.id] = next;
      if (partial) break;
    }

    client.setDeadline(started + deadline);
    const cache = (await getState<ContactCache>(CONTACTS_KEY)) ?? {};
    if (!include.startsWith("supplier")) await fillSupplierNames(client, drafts, cache, started + deadline * CONTACTS_SHARE);

    const ctx = await loadCtx(
      drafts.map((d) => d.externalId),
      client,
    );
    // Yazılamayan fatura (yeniden içeri alınan e-faturanın eski faturası Paraşüt'e sorulamadı): kalınan yer o faturanın
    // sayfasına geri alınır, yeniden basınca oradan denenir. Yalnız bu basışın başladığı sayfadan sonrasına: kalınan
    // yer her basışta ilerler, okuma hep biter. Başladığı sayfada yine yazılamayan fatura geçilir, sonraki tam okumada
    // denenir (geç girilenlerin LATE_HOLD_RUNS'ı gibi). Para etkilenmez: e-faturanın kaydı yerinde kalır, çift kayıt açılmaz
    let deferred = 0;
    let held = false;
    for (const d of drafts) {
      if ((await applyDraft(d, ctx)) !== "deferred") continue;
      deferred++;
      const at = progress[d.contactId];
      if (d.page > (startPages.get(d.contactId) ?? 1) && (at === HISTORY_DONE || d.page < at)) {
        progress[d.contactId] = d.page;
        held = true;
      }
    }
    // Bütün kişiler bittiyse kayıt silinir, sonraki basış baştan okur (geri alınan yer bitmiş kişiye yazılmasın diye burada)
    if (contacts.every((c) => progress[c.id] === HISTORY_DONE)) for (const c of contacts) delete progress[c.id];
    if (ctx.dueDirty) await setState(DUE_KEY, ctx.dueSeen);
    await saveReturns(ctx, todayTR());
    const linked = ctx.touchedMonths.size ? await applyProductLinks([...ctx.touchedMonths]) : null;
    await setState(HISTORY_KEY, progress);
    const cari = await cariFinalSteps(ctx);

    const written = new Set(drafts.map((d) => d.externalId));
    const rows = ctx.existing.filter((e) => e.externalId && written.has(e.externalId));
    // Eşitlemenin bu kişinin faturalarına verdiği ad (paneldeki eski faturaların elle değişmiş adları değil)
    const names = [...new Set(drafts.filter((d) => d.supplierResolved).map((d) => ctx.alias(d.supplier)))];
    const oldest = rows.reduce<string | null>((a, r) => (!a || r.date < a ? r.date : a), null);
    const { created, updated, removed } = ctx.counts;
    const summary = [
      `${target.label}: ${drafts.length} gider faturası okundu`,
      `${created} yeni`,
      `${updated} güncellendi`,
      removed ? `${removed} kaldırıldı (Paraşüt'te iptal)` : "",
      linked?.held ? `${linked.held} fiyat onaya düştü (%40'tan fazla fark)` : "",
      cari,
      deferred ? `${deferred} fatura yazılamadı (yeniden içeri alınan e-faturanın eski faturası Paraşüt'e sorulamadı)` : "",
      partial ? "süre doldu, kalanı için yeniden basın" : held ? "yeniden basınca denenir" : deferred ? "sonraki tam okumada denenir" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    await db
      .update(s.parasutSyncRuns)
      .set({ status: "ok", finishedAt: new Date(), fetched: drafts.length, created, updated, removed, message: `Tedarikçi geçmişi · ${summary}` })
      .where(eq(s.parasutSyncRuns.id, runId));
    return { ok: true, summary, contacts, fetched: drafts.length, created, updated, removed, names, oldest, partial, deferred, held, resumed };
  } catch (e) {
    const error =
      e instanceof FilterIgnoredError
        ? "Paraşüt listeyi tedarikçiye göre süzmedi; karışıklık olmasın diye hiçbir fatura yazılmadı. Paraşüt sayfasındaki “Tarihten eşitle” ile geçmişi alabilirsiniz."
        : e instanceof Error
          ? e.message
          : String(e);
    if (runId) await db.update(s.parasutSyncRuns).set({ status: "error", finishedAt: new Date(), message: `Tedarikçi geçmişi · ${target.label}: ${error}`.slice(0, 1000) }).where(eq(s.parasutSyncRuns.id, runId));
    console.error("Paraşüt tedarikçi geçmişi", e);
    return { ok: false, error, runId };
  }
}

/**
 * Geç girilen faturalar: Paraşüt'e bugün girilen ama tarihi 75 günlük pencereden eski fatura günlük taramada görünmez
 * (liste tarihe göre okunur). Kimliğe göre azalan sırayla (`sort=-id`) önceki taramanın en büyük kimliğine kadar
 * okunur, panelde olmayanlar yazılır (pencere içindekiler bu çalışmada zaten yazıldı, tekrar yazılmaz). Bir çalışmada
 * en çok LATE_PAGES sayfa; tarama bitmezse kaldığı yer saklanır, sonraki çalışma oradan sürer (late-bills.ts). İlk
 * çalışmada yalnız en büyük kimlik kaydedilir (eskiler "Tarihten eşitle" ile alınır). `created`: yeni açılan kayıt
 * (var olan kayda bağlanan fatura sayılmaz; özet aynı faturayı her sabah yeniden saymasın)
 */
async function catchLateBills(
  client: ParasutClient,
  ctx: Ctx,
  opts: { include: string; contacts: ContactCache; until: number },
): Promise<{ created: number; done: boolean }> {
  const before = ctx.counts.created;
  const run = await runLateScan<BillDraft>(
    parseLateCursor(await getState(LAST_BILL_KEY)),
    {
      read: async (page) => {
        let res: ListResponse<Record<string, unknown>>;
        try {
          res = await client.get<ListResponse<Record<string, unknown>>>("purchase_bills", { sort: "-id", include: opts.include, "page[number]": page, "page[size]": PAGE_SIZE });
        } catch (e) {
          // Süre doldu: okunmuş sayfalar yazılır, kalınan yer saklanır
          if (e instanceof ParasutDeadlineError) return null;
          throw e;
        }
        const bills = res.data.map((b) => ({ n: Number(b.id), bill: b })).filter((b) => Number.isSafeInteger(b.n));
        return { bills: bills.map(({ n, bill }) => ({ n, bill: billToDraft(bill, res.included) })), totalPages: res.meta?.total_pages };
      },
      prepare: async (found) => {
        if (!opts.include.startsWith("supplier")) await fillSupplierNames(client, found, opts.contacts, opts.until);
        for (const d of found) ctx.listed.add(d.externalId);
      },
      apply: (d) => applyDraft(d, ctx),
    },
    { pages: LATE_PAGES, until: opts.until },
  );
  if (run.passed.length) console.warn("Paraşüt geç girilen faturalar: art arda yazılamayan fatura geçildi", run.passed);
  if (run.save) await setState(LAST_BILL_KEY, { ...run.save, at: new Date().toISOString() });
  return { created: ctx.counts.created - before, done: run.complete };
}

/** Önbellekteki tedarikçi adlarını taslaklara yazar; ad henüz okunamadıysa yer tutucu kalır (sonraki eşitlemede düzelir) */
function applyContacts(drafts: BillDraft[], cache: ContactCache) {
  for (const d of drafts) {
    if (d.supplierResolved || !d.supplierId) continue;
    const c = cache[d.supplierId];
    if (c && c.name !== PLACEHOLDER_SUPPLIER) {
      d.supplier = c.name;
      d.supplierTaxNo = c.taxNo;
      d.supplierResolved = true;
      d.contactType = c.type?.toLowerCase() ?? null;
    } else {
      d.supplier = PLACEHOLDER_SUPPLIER;
    }
  }
}

/** Tedarikçi "included"da gelmediyse adları /contacts/{id} ile okunur (önbellekli; `until` anına kadar) */
async function fillSupplierNames(client: ParasutClient, drafts: BillDraft[], cache: ContactCache, until: number) {
  const missing = [...new Set(drafts.filter((d) => !d.supplierResolved && d.supplierId && !cache[d.supplierId]).map((d) => d.supplierId!))];
  let added = 0;
  for (const id of missing) {
    if (Date.now() > until) break;
    try {
      const res = await client.show<{ name?: string; tax_number?: string; account_type?: string }>(`contacts/${encodeURIComponent(id)}`);
      cache[id] = { name: res.data.attributes.name?.trim() || PLACEHOLDER_SUPPLIER, taxNo: res.data.attributes.tax_number ?? null, type: res.data.attributes.account_type ?? null };
      added++;
    } catch (e) {
      if (e instanceof ParasutDeadlineError || e instanceof ParasutAuthError) break;
      // okunamazsa yer tutucuyla devam
    }
  }
  if (added) await setState(CONTACTS_KEY, cache);
  applyContacts(drafts, cache);
}

interface EInvoiceStats {
  /** Okunan gelen e-fatura */
  fetched: number;
  /** Paraşüt'te içeri alınmamış, panele doğrudan alınan */
  notImported: number;
  notImportedTotal: number;
  maxDate: string;
  /** Pencerenin başına kadar okundu mu (imleç yalnız o zaman ilerler) */
  complete: boolean;
}

/**
 * Gelen e-faturaları okur (yalnız tarihe göre sıralı istek; süzgeç desteklenmiyor) ve panele yazar. Pencere
 * gider faturalarınınkinden bağımsızdır; kayıt kayıt yazılır, süre dolarsa kalanı sonraki çalışmada.
 */
async function syncEInvoices(client: ParasutClient, ctx: Ctx, opts: { windowStart: string; until: number; today: string }): Promise<EInvoiceStats> {
  const stats: EInvoiceStats = { fetched: 0, notImported: 0, notImportedTotal: 0, maxDate: "", complete: false };
  for await (const page of client.pages<EInvoiceAttrs>("e_invoices", { include: "invoice", sort: "-issue_date" }, 60)) {
    let older = false;
    for (const r of page.data) {
      const d = eInvoiceToDraft(r);
      if (d.date && d.date < opts.windowStart) {
        older = true;
        continue;
      }
      // Kafenin tedarikçiye iadesi (giden iade e-faturası) panele girmez, Paraşüt sayfasında listelenir
      if (isSupplierReturn(d)) {
        noteReturn(ctx, "supplier", {
          id: `ei:${d.eInvoiceId}`,
          date: d.date,
          amount: Math.abs(d.payable),
          invoiceNo: d.invoiceNo,
          supplier: d.supplier,
          taxNumber: cleanTaxNumber(d.receiverTaxNo),
        });
      }
      if (!d.inbound) continue;
      stats.fetched++;
      const ok = shouldImportEInvoice(d).ok;
      if (ok && !d.importedBillId) {
        stats.notImported++;
        stats.notImportedTotal += d.payable;
      }
      if (ok && d.date <= opts.today && d.date > stats.maxDate) stats.maxDate = d.date;
      await applyEInvoice(d, ctx);
    }
    const total = page.meta?.total_pages;
    if (older || !page.data.length || (total !== undefined && page.page >= total)) {
      stats.complete = true;
      break;
    }
    if (Date.now() > opts.until) break;
  }
  return stats;
}

/** Notun sonuna ek (aynı ek iki kez yazılmaz) */
function appendNote(note: string | null, add: string): string {
  if (note?.includes(add)) return note;
  return note ? `${note} · ${add}` : add;
}

/**
 * Tek bir gelen e-faturayı panele yazar:
 * - içeri alınmışsa tutarları gider faturası taşır; burada yalnız belge için e-fatura bağı kurulur;
 * - panelde aynı fatura (e-fatura kimliği ya da Excel/elle girilmiş aynı numara, tarih, tutar) varsa ona bağlanır;
 *   Excel kaydının tutarı e-faturadakiyle aynıysa dokunulmaz, farklıysa e-faturadaki yazılır ve kontrol istenir;
 * - yoksa yeni kayıt açılır (kategori kurallardan / tedarikçinin geçmişinden; ödeme durumu e-faturada olmadığından
 *   "ödenmedi" açılır, ödendiğini kullanıcı işaretler; peşin çalışılan tedarikçininki ödendi);
 * - reddedilen/arşivlenen e-faturanın yalnız ondan açılmış kaydı kaldırılır.
 */
async function applyEInvoice(d: EInvoiceDraft, ctx: Ctx): Promise<"created" | "linked" | "updated" | "removed" | "skipped"> {
  const db = getDb();
  const key = `ei:${d.eInvoiceId}`;
  if (ctx.ignored.has(key) || ctx.applied.has(key)) return "skipped";
  ctx.applied.add(key);
  const verdict = shouldImportEInvoice(d);
  let match: Existing | null = ctx.existing.find((e) => e.eInvoiceId === d.eInvoiceId) ?? null;
  if (!match && d.importedBillId) match = ctx.existing.find((e) => e.externalId === d.importedBillId) ?? null;
  // Gelen iade e-faturası (satış iadesi): içeri alınmışsa gider faturasının kimliğiyle (iki yoldan bir kez listelenir)
  if (!verdict.ok && verdict.reason === SALES_RETURN) {
    noteReturn(ctx, "sales", { id: d.importedBillId ?? key, date: d.date, amount: Math.abs(d.payable), invoiceNo: d.invoiceNo });
  }

  if (!verdict.ok) {
    // Gider faturasına bağlı kayıt (içeri alınmış ya da Paraşüt'e elle girilmiş) gider faturasını izler: e-faturanın
    // arşivlenmesi (elle girdikten sonra olağan temizlik) ya da reddi kayda dokunmaz; Paraşüt'te gider faturası iptal
    // edilirse o eşitleme kaldırır
    if (match?.externalId) return "skipped";
    if (match && match.eInvoiceId === d.eInvoiceId) {
      ctx.touchedMonths.add(match.date.slice(0, 7));
      if (match.origin === "parasut" && !match.externalId) {
        if (!(await deleteWithLinks(match))) return "skipped";
        ctx.existing.splice(ctx.existing.indexOf(match), 1);
        ctx.counts.removed++;
        return "removed";
      }
      const note = appendNote(match.note, `Paraşüt'te e-fatura ${verdict.reason} — kontrol edin`);
      await db.update(s.invoices).set({ eInvoiceId: null, eInvoiceUuid: null, note, needsReview: true }).where(eq(s.invoices.id, match.id));
      Object.assign(match, { eInvoiceId: null, note });
      ctx.counts.updated++;
    }
    return "skipped";
  }

  if (d.importedBillId) {
    // İçeri alınmış e-fatura: tutarları gider faturası taşır, imzalı belgedeki vergi no kayda yazılır
    if (match) await fillTaxNumber(ctx, match, d.supplierTaxNo, "einvoice");
    if (match && !match.eInvoiceId && !ctx.existing.some((e) => e.eInvoiceId === d.eInvoiceId)) {
      await db.update(s.invoices).set({ eInvoiceId: d.eInvoiceId, eInvoiceUuid: d.uuid }).where(eq(s.invoices.id, match.id));
      match.eInvoiceId = d.eInvoiceId;
      return "linked";
    }
    return "skipped";
  }

  if (!match) {
    // Excel'den ya da elle girilmiş aynı fatura; gider faturasına bağlı ya da başka e-faturaya bağlı olanlar aday değil
    const candidates = ctx.existing.filter((e) => !e.eInvoiceId && !e.externalId);
    match = findExisting({ externalId: key, invoiceNo: d.invoiceNo, date: d.date, payable: d.payable, supplier: d.supplier }, candidates) as Existing | null;
  }
  if (!match) {
    // Paraşüt'e "içeri al" yerine elle girilmiş gider faturası (aynı tam e-fatura numarası; aynı çalışmada gider
    // faturaları önce yazılır): yalnız e-fatura bağı kurulur, tutarları ve kalemleri gider faturası taşır
    const bill = findByEInvoiceNo(d, ctx.existing.filter((e) => e.externalId && !e.eInvoiceId));
    if (bill) {
      await db.update(s.invoices).set({ eInvoiceId: d.eInvoiceId, eInvoiceUuid: d.uuid }).where(eq(s.invoices.id, bill.id));
      bill.eInvoiceId = d.eInvoiceId;
      await fillTaxNumber(ctx, bill, d.supplierTaxNo, "einvoice");
      return "linked";
    }
  }

  const now = new Date();
  const values = { date: d.date, invoiceNo: d.invoiceNo, amount: d.amount, discount: 0, vat: d.vat, payable: d.payable };
  if (match) {
    const firstLink = match.eInvoiceId !== d.eInvoiceId;
    const fromThis = match.origin === "parasut" && !match.externalId;
    const differs = Math.abs(match.payable - d.payable) > 1 || match.date !== d.date;
    // Değişmemiş e-faturada da (eski kayıtta boşsa) vergi no yazılır
    await fillTaxNumber(ctx, match, d.supplierTaxNo, "einvoice");
    // Tevkifatlı e-faturaya bağlı Excel / elle kaydın boş KDV'si belgedekiyle dolar (KDV-2 tahmini ondan)
    const vat = fromThis ? null : withholdingVatFill(match, d);
    if (vat !== null) {
      await db.update(s.invoices).set({ vat }).where(eq(s.invoices.id, match.id));
      match.vat = vat;
      ctx.touchedMonths.add(match.date.slice(0, 7));
    }
    if (!firstLink && !(fromThis && differs)) return "skipped";
    const set: Partial<typeof s.invoices.$inferInsert> = { eInvoiceId: d.eInvoiceId, eInvoiceUuid: d.uuid, source: "parasut", syncedAt: now };
    if (fromThis) Object.assign(set, values);
    // E-fatura değişti: kalemler ve belgedeki tutar sıradaki okumada yenilenir
    if (fromThis && differs) set.ublReadAt = null;
    else if (differs) {
      // Excel/elle kayıt ilk kez bağlanıyor ve tutarı farklı: e-faturadaki geçerli, kontrol istenir
      Object.assign(set, values, { needsReview: true, note: appendNote(match.note, `tutar e-faturaya göre güncellendi (önce ${match.payable.toLocaleString("tr-TR")} ₺)`) });
    }
    if (set.payable !== undefined && set.payable !== match.payable) ctx.payableChanged.push({ id: match.id, from: match.payable, to: set.payable });
    await db.update(s.invoices).set(set).where(eq(s.invoices.id, match.id));
    if (match.date !== d.date) ctx.touchedMonths.add(match.date.slice(0, 7));
    ctx.touchedMonths.add(d.date.slice(0, 7));
    Object.assign(match, { eInvoiceId: d.eInvoiceId, source: "parasut", syncedAt: now, ...(set.date ? { date: d.date, payable: d.payable, invoiceNo: d.invoiceNo } : {}), ...(set.note ? { note: set.note } : {}) });
    ctx.counts.updated++;
    return firstLink ? "linked" : "updated";
  }

  const supplier = ctx.alias(d.supplier);
  const { category, reason } = pickCategory(
    { supplier, description: null, parasutCategory: null, lines: [] },
    ctx.rules,
    supplier === PLACEHOLDER_SUPPLIER ? new Map() : ctx.history,
    INVOICE_CATEGORIES,
  );
  const note = `Paraşüt e-faturası (içeri alınmadan) · kategori: ${reason}${d.withholding ? " · tevkifatlı: tutarı kontrol edin" : ""}`;
  // E-faturada ödeme bilgisi yok (parasutUnpaid null)
  const pay = newInvoicePayment(
    { payable: d.payable, date: d.date, parasutUnpaid: null, commission: category === COMMISSION_CATEGORY && !categoryNeedsReview(reason) },
    ctx.paidOnDelivery(supplier, d.supplierTaxNo),
    ctx.paymentsSince,
  );
  const supplierTaxNumber = cleanTaxNumber(d.supplierTaxNo);
  const trackedCard = ctx.trackedCard(supplier, d.supplierTaxNo);
  const [row] = await db
    .insert(s.invoices)
    .values({
      ...values,
      supplier,
      supplierTaxNumber,
      category,
      ...pay,
      source: "parasut",
      origin: "parasut",
      eInvoiceId: d.eInvoiceId,
      eInvoiceUuid: d.uuid,
      syncedAt: now,
      needsReview: categoryNeedsReview(reason) || d.withholding,
      note,
      // E-faturada ödeme bilgisi yok (kalan boş): taban 0
      ledgerBase: arrivalLedgerBase(trackedCard, { date: d.date, payable: d.payable, unpaid: pay.unpaid, outstanding: null }),
    })
    .returning({ id: s.invoices.id });
  if (trackedCard !== null && takesCreditOnArrival({ date: d.date, unpaid: pay.unpaid }, trackedCard.since) && ctx.paidOnDelivery(supplier, d.supplierTaxNo)) {
    ctx.pesinTracked.push({ id: row.id, cardId: trackedCard.id });
  }
  if (supplierTaxNumber) ctx.taxFilled++;
  ctx.existing.push({
    id: row.id,
    vat: d.vat,
    eInvoiceId: d.eInvoiceId,
    externalId: null,
    invoiceNo: d.invoiceNo,
    supplier,
    date: d.date,
    payable: d.payable,
    unpaid: pay.unpaid,
    dueDate: null,
    origin: "parasut",
    source: "parasut",
    note,
    parasutUnpaid: null,
    outstanding: null,
    paidAt: pay.paidAt,
    paymentRequestedAt: null,
    syncedAt: now,
    supplierTaxNumber,
  });
  ctx.touchedMonths.add(d.date.slice(0, 7));
  ctx.counts.created++;
  return "created";
}

/**
 * Hammaddeye bağlı Paraşüt kalemlerinden (bağlantıda istenmişse) hammaddenin paket fiyatını en son faturadaki birim
 * fiyatla günceller, sonra verilen ayların alınan miktarlarını yeniden hesaplar (recomputePurchaseQuantities).
 * Şimdikinden %40'tan fazla farklı fiyat ve çarpanı faturanın biriminden gelmeyen ilk fiyat yazılmaz, onaya düşer
 * (`held`; docs/PARASUT.md 5b). Alınan miktar fiyattan sonra: bu çalışmada onaya düşen fiyatın çarpanı da şüpheli sayılır.
 */
export async function applyProductLinks(months?: string[]) {
  const db = getDb();
  const links = await db.select().from(s.parasutProductLinks);
  if (!links.length) {
    // Bağlantı kalmadıysa yönetilen (Paraşüt kaynaklı) alınan miktar satırları da kalkar, bekleyen fiyat önerileri de
    // geçersiz olur
    await db.delete(s.purchaseQuantities).where(eq(s.purchaseQuantities.note, MANAGED_QTY_NOTE));
    await supersedeHolds(null, "Bağlantı kaldırıldı");
    return { quantities: 0, prices: 0, held: 0 };
  }
  const byKey = new Map(links.map((l) => [l.productKey, l]));

  const rows = await db
    .select({
      invoiceId: s.invoices.id,
      productKey: s.parasutBillLines.productKey,
      productName: s.parasutBillLines.productName,
      description: s.parasutBillLines.description,
      unit: s.parasutBillLines.unit,
      quantity: s.parasutBillLines.quantity,
      netTotal: s.parasutBillLines.netTotal,
      date: s.invoices.date,
      supplier: s.invoices.supplier,
      invoiceNo: s.invoices.invoiceNo,
    })
    .from(s.parasutBillLines)
    .innerJoin(s.invoices, eq(s.invoices.id, s.parasutBillLines.invoiceId))
    // Kafe dışı faturalar (karaoke box, Alp Koç) kafenin alınan miktarına ve fiyatına girmez (aynı ürün kafeye de gelse)
    .where(and(inArray(s.parasutBillLines.productKey, links.map((l) => l.productKey)), notInArray(s.invoices.category, SEPARATE_CATEGORIES)));

  // Fiyat: her bağlantı için en yeni faturadaki birim fiyat (iskonto sonrası, KDV hariç)
  const applied = (await getState<Record<string, string>>(PRICE_KEY)) ?? {};
  let prices = 0;
  const latest = new Map<number, (typeof rows)[number]>();
  for (const r of rows) {
    const link = byKey.get(r.productKey)!;
    if (!link.updatePrice || r.quantity <= 0 || r.netTotal <= 0) continue;
    const cur = latest.get(link.ingredientId);
    if (!cur || r.date > cur.date) latest.set(link.ingredientId, r);
  }

  // Onay bekleyen fiyatlar (docs/PARASUT.md 5b): bağlantısı silinen, başka hammaddeye geçen, çarpanı değişen, fiyat
  // güncellemesi kapanan ya da kalemi fiyat kapsamından çıkan öneri geçersiz olur. Değerlendirilecek hammaddelerin
  // son kararları da okunur (reddedilen fatura yeniden sorulmaz)
  const hs = s.ingredientPriceHolds;
  const holds = await db
    .select()
    .from(hs)
    .where(latest.size ? or(eq(hs.status, "pending"), inArray(hs.ingredientId, [...latest.keys()])) : eq(hs.status, "pending"))
    .orderBy(desc(hs.createdAt), desc(hs.id));
  const stale = staleHolds(
    holds.filter((h) => h.status === "pending"),
    links,
    rows,
  );
  for (const reason of new Set(stale.map((x) => x.reason))) {
    await supersedeHolds(
      stale.filter((x) => x.reason === reason).map((x) => x.id),
      reason,
    );
  }
  const staleIds = new Set(stale.map((x) => x.id));
  // Geçersiz kalan önerinin fiyatı hiç uygulanmadı: değişiklik geri dönünce (ör. "Fiyatı güncelle" yanlışlıkla kapatılıp
  // açılınca) aynı fatura yeniden değerlendirilir, öneri kaybolmaz
  reopenApplied(applied, holds.filter((h) => staleIds.has(h.id)));
  const pendingBy = new Map(holds.filter((h) => h.status === "pending" && !staleIds.has(h.id)).map((h) => [h.ingredientId, h]));
  const linkOf = new Map(links.map((l) => [l.productKey, { ingredientId: l.ingredientId, factor: l.factor }]));
  const held: string[] = [];

  for (const [ingredientId, r] of latest) {
    const link = byKey.get(r.productKey)!;
    // Anahtar bağlantıyı da içerir: çarpan ya da ürün değişince aynı faturanın fiyatı yeni çarpanla yeniden yazılır
    const appliedKey = appliedKeyOf(ingredientId, link.productKey, link.factor);
    if ((applied[appliedKey] ?? "") >= r.date) continue;
    const packagePrice = Math.round((r.netTotal / r.quantity) * 100) / 100;
    const packageSize = link.factor;
    const [ing] = await db.select().from(s.ingredients).where(eq(s.ingredients.id, ingredientId)).limit(1);
    if (!ing) continue;
    const before = ing.packagePrice / (ing.packageSize || 1);
    const after = packagePrice / (packageSize || 1);
    applied[appliedKey] = r.date;
    // Her zaman hammaddenin şimdiki fiyatına göre: onaylanan fiyat sonrakilerin tabanı olur, reddedilende eski fiyat kalır.
    // İlk fiyat (şimdiki fiyat yok) yalnız çarpanı faturanın ölçü biriminden geliyorsa yazılır, yoksa onaya düşer (E-06)
    const firstCertain = firstPriceCertain(packEvidence({ name: r.productName, description: r.description, unit: r.unit, quantity: r.quantity }, ing.unit), link.factor);
    const step = priceStep({ before, after, exempt: ing.priceSource === "water", firstCertain });
    const pending = pendingBy.get(ingredientId) ?? null;
    if (step === "same") {
      if (pending) await supersedeHolds([pending.id], "Daha yeni faturada fiyat aynı");
      continue;
    }
    if (step === "apply") {
      await db.transaction(async (tx) => {
        // Önce öneri, sonra hammadde: onay ve geri alma da bu sırayla kilitler (aynı anda çalışınca kilitlenmesinler)
        if (pending) await supersedeHolds([pending.id], `Daha yeni faturanın fiyatı uygulandı (${bulkPrice(after, ing.unit)})`, tx);
        await tx.update(s.ingredients).set({ packagePrice, packageSize, isEstimate: false }).where(eq(s.ingredients.id, ingredientId));
        await tx.insert(s.ingredientPrices).values({
          ingredientId,
          packagePrice,
          packageSize,
          changedBy: "Paraşüt",
          note: `${r.supplier}${r.invoiceNo ? ` ${r.invoiceNo}` : ""} (${r.date})`,
        });
      });
      prices++;
      continue;
    }
    // %40'tan fazla fark: yanlış çarpan ya da tek seferlik fatura bütün reçete maliyetlerini sessizce değiştirmesin,
    // çarpan hatası sahte zam uyarısı açmasın. Aynı öneri zaten bekliyorsa (yeniden çalışma, yarıda kalan eşitleme) ya
    // da sahibi bu faturanın fiyatını reddettiyse yeni satır açılmaz
    const same = (x: (typeof holds)[number]) => x.invoiceId === r.invoiceId && x.productKey === r.productKey && x.factor === link.factor;
    if (pending && same(pending)) continue;
    if (holds.some((x) => x.ingredientId === ingredientId && x.status === "rejected" && same(x))) continue;
    const prev = previousInvoicePrice(rows, linkOf, ingredientId, { invoiceId: r.invoiceId, date: r.date });
    const inserted = await db.transaction(async (tx) => {
      if (pending) await supersedeHolds([pending.id], "Daha yeni fatura geldi", tx);
      // Kısmi tekil dizin hammadde başına tek bekleyen öneriyi korur (eşitleme ile elle bağlama aynı anda çalışırsa)
      const [row] = await tx
        .insert(hs)
        .values({
          ingredientId,
          invoiceId: r.invoiceId,
          productKey: r.productKey,
          productName: r.productName,
          factor: link.factor,
          quantity: r.quantity,
          unit: r.unit,
          netTotal: r.netTotal,
          invoiceDate: r.date,
          supplier: r.supplier,
          invoiceNo: r.invoiceNo,
          packagePrice,
          packageSize,
          prevPackagePrice: ing.packagePrice,
          prevPackageSize: ing.packageSize,
          prevIsEstimate: ing.isEstimate,
          lastUnitPrice: prev?.unitPrice ?? null,
          lastDate: prev?.date ?? null,
          lastSupplier: prev?.supplier ?? null,
          repeats: repeatCount(rows, linkOf, ingredientId, { invoiceId: r.invoiceId, date: r.date, unitPrice: after }),
        })
        .onConflictDoNothing({ target: hs.ingredientId, where: sql`status = 'pending'` })
        .returning({ id: hs.id });
      return Boolean(row);
    });
    if (inserted) held.push(holdLogText({ name: ing.name, pct: livePct(after, before), supplier: r.supplier, date: r.date }));
  }
  await setState(PRICE_KEY, applied);
  if (held.length) await logActivity(null, "Fiyat onaya düştü", held.join(", "));
  const quantities = await recomputePurchaseQuantities(months);
  return { quantities, prices, held: held.length };
}

/** Alınan miktarın yeniden hesabı tek seferde (eşitleme, bağlama, fiyat kararı aynı anda çalışınca satırlar çakışmasın) */
const PURCHASE_LOCK = 7_340_213;

/**
 * Alınan miktar (Tutarlılık'ın "alınan"ı): hammaddeye bağlı kafe kalemlerinden ay ve hammadde başına miktar × çarpan.
 * Çarpanı şüpheli kalem sayılmaz (suspectFactorLine: fiyatı bugünkü çarpanla onay bekleyen bağlantının bütün kalemleri,
 * reddedilen fiyatın kendi faturası); stok partileriyle aynı yüklem, Tutarlılık onları "Fiyat onayı bekliyor" diye
 * işaretler (denetim 26 Eki, E-27). Fiyat kararı (onay, red, geri alma) da bunu çağırır.
 *
 * Yönetilen satırlar (notu MANAGED_QTY_NOTE): önce bu ayların (ay verilmediyse bütün ayların) satırları silinir, sonra
 * hesaplananlar yazılır. Kullanıcının elle düzelttiği satırın notu değişir ve artık eşitlemeye ait olmaz. Tutarlılık'ın
 * "Alım yok (0)" satırı (NO_PURCHASE_NOTE) elle girilmiş sayılmaz: o ay için faturası sonradan gelirse yerini faturadaki
 * miktar alır. Ayın toplamı 0 ise (alış ve iadesi) 0 yazılır; eksi toplam (iadesi fazla) yazılmaz.
 */
export async function recomputePurchaseQuantities(months?: string[]): Promise<number> {
  const db = getDb();
  const bl = s.parasutBillLines;
  const ln = s.parasutProductLinks;
  const pq = s.purchaseQuantities;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${PURCHASE_LOCK})`);
    const rows = await tx
      .select({ date: s.invoices.date, ingredientId: ln.ingredientId, quantity: bl.quantity, factor: ln.factor, held: suspectFactorLine(bl) })
      .from(bl)
      .innerJoin(s.invoices, eq(s.invoices.id, bl.invoiceId))
      .innerJoin(ln, eq(ln.productKey, bl.productKey))
      .where(notInArray(s.invoices.category, SEPARATE_CATEGORIES));
    const wanted = months ? new Set(months) : null;
    const qty = new Map<string, number>(); // month|ingredientId → miktar
    for (const r of rows) {
      if (r.held) continue;
      const m = r.date.slice(0, 7);
      if (wanted && !wanted.has(m)) continue;
      const k = `${m}|${r.ingredientId}`;
      qty.set(k, (qty.get(k) ?? 0) + r.quantity * r.factor);
    }
    const managedMonths = months ? [] : (await tx.select({ month: pq.month }).from(pq).where(eq(pq.note, MANAGED_QTY_NOTE))).map((r) => r.month);
    const monthList = months ?? [...new Set([...rows.map((r) => r.date.slice(0, 7)), ...managedMonths])];
    if (!monthList.length) return 0;
    await tx.delete(pq).where(and(inArray(pq.month, monthList), eq(pq.note, MANAGED_QTY_NOTE)));
    const kept = await tx.select({ id: pq.id, month: pq.month, ingredientId: pq.ingredientId, note: pq.note }).from(pq).where(inArray(pq.month, monthList));
    const keyOf = (r: { month: string; ingredientId: number }) => `${r.month}|${r.ingredientId}`;
    const manualKeys = new Set(kept.filter((r) => r.note !== NO_PURCHASE_NOTE).map(keyOf));
    const values = [...qty]
      .map(([k, v]) => [k, Math.round(v * 1000) / 1000] as const)
      .filter(([k, v]) => v >= 0 && !manualKeys.has(k))
      .map(([k, v]) => {
        const [month, ing] = k.split("|");
        return { month, ingredientId: Number(ing), qty: v, note: MANAGED_QTY_NOTE };
      });
    // Faturası sonradan gelen ayın "Alım yok (0)" satırının yerine faturadaki miktar
    const replaced = kept.filter((r) => r.note === NO_PURCHASE_NOTE && values.some((v) => keyOf(v) === keyOf(r))).map((r) => r.id);
    if (replaced.length) await tx.delete(pq).where(inArray(pq.id, replaced));
    if (values.length) await tx.insert(pq).values(values);
    return values.length;
  });
}

// Hammaddeye bağlanmaya aday kalemlerin geldiği fatura kategorileri (mal alışları ve "Diğer") tek yerde tanımlı:
// fatura penceresinin "Hammaddeye bağla" bağlantısı da aynı listeye bakar (src/lib/invoice-linking.ts)
export { LINKABLE_CATEGORIES };

/** "Hammadde değil" denen ürünler (kargo, hizmet, ekipman): bekleyenler listesine ve zil sayısına girmez */
export const PRODUCT_IGNORE_KEY = "parasut.productIgnore";

export async function ignoredProducts(): Promise<IgnoredProduct[]> {
  return parseIgnored(await getState(PRODUCT_IGNORE_KEY));
}

/** Listeyi kilitleyip değiştirir (iki sekmede aynı anda işaretlenince biri diğerini ezmesin); önceki listeyi döner */
export async function updateIgnoredProducts(change: (list: IgnoredProduct[]) => IgnoredProduct[]): Promise<IgnoredProduct[]> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(s.integrationState).where(eq(s.integrationState.key, PRODUCT_IGNORE_KEY)).for("update").limit(1);
    const before = parseIgnored(row?.value);
    const value = change(before);
    await tx
      .insert(s.integrationState)
      .values({ key: PRODUCT_IGNORE_KEY, value })
      .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
    return before;
  });
}

/** Hammaddeye bağlanmayı bekleyen ürün sayısı (zil ve ana sayfa için; listeyle aynı süzgeç) */
export async function countUnlinkedProducts(): Promise<number> {
  const db = getDb();
  const ignored = (await ignoredProducts()).map((i) => i.productKey);
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${s.parasutBillLines.productKey})`.mapWith(Number) })
    .from(s.parasutBillLines)
    .innerJoin(s.invoices, eq(s.invoices.id, s.parasutBillLines.invoiceId))
    .where(
      and(
        inArray(s.invoices.category, LINKABLE_CATEGORIES),
        notInArray(s.parasutBillLines.productKey, db.select({ k: s.parasutProductLinks.productKey }).from(s.parasutProductLinks)),
        ignored.length ? notInArray(s.parasutBillLines.productKey, ignored) : undefined,
      ),
    );
  return row?.n ?? 0;
}

/**
 * Ekran için: bağlanmamış Paraşüt ürünleri (en çok geçenler önce); `total` kesilmeden önceki sayı. En yeni kalemin
 * açıklaması ve miktarı paket boyunun kanıtı için (src/lib/product-match.ts packEvidence: "150 AD." 1 adet mi 150 mi)
 */
export async function unlinkedProducts(limit = 40) {
  const db = getDb();
  const [lines, links, ignored] = await Promise.all([
    db
      .select({
        productKey: s.parasutBillLines.productKey,
        productName: s.parasutBillLines.productName,
        description: s.parasutBillLines.description,
        unit: s.parasutBillLines.unit,
        quantity: s.parasutBillLines.quantity,
        netTotal: s.parasutBillLines.netTotal,
        date: s.invoices.date,
        supplier: s.invoices.supplier,
      })
      .from(s.parasutBillLines)
      .innerJoin(s.invoices, eq(s.invoices.id, s.parasutBillLines.invoiceId))
      .where(and(isNotNull(s.parasutBillLines.productKey), inArray(s.invoices.category, LINKABLE_CATEGORIES)))
      .orderBy(desc(s.invoices.date)),
    db.select({ productKey: s.parasutProductLinks.productKey }).from(s.parasutProductLinks),
    ignoredProducts(),
  ]);
  // Bağlı ve "hammadde değil" denen ürünler bekleyen sayılmaz
  const linked = new Set([...links.map((l) => l.productKey), ...ignored.map((i) => i.productKey)]);
  const agg = new Map<
    string,
    { productKey: string; productName: string; description: string | null; unit: string | null; count: number; lastDate: string; lastQuantity: number; lastUnitPrice: number; supplier: string }
  >();
  const unitPrice = (l: (typeof lines)[number]) => (l.quantity > 0 && l.netTotal > 0 ? l.netTotal / l.quantity : 0);
  for (const l of lines) {
    if (linked.has(l.productKey)) continue;
    const a = agg.get(l.productKey);
    if (a) {
      a.count++;
      // Son fatura bedava (iskonto %100) kalemse fiyat bir önceki ücretli kalemden
      if (!a.lastUnitPrice) a.lastUnitPrice = unitPrice(l);
    } else
      agg.set(l.productKey, {
        productKey: l.productKey,
        productName: l.productName,
        description: l.description,
        unit: l.unit,
        count: 1,
        lastDate: l.date,
        lastQuantity: l.quantity,
        lastUnitPrice: unitPrice(l),
        supplier: l.supplier,
      });
  }
  const all = [...agg.values()].sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate));
  return { items: all.slice(0, limit), total: all.length };
}

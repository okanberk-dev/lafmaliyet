import "server-only";

import { and, desc, eq, inArray, isNotNull, lt } from "drizzle-orm";

import { INVOICE_CATEGORIES } from "@/lib/constants";
import { addDays, todayTR } from "@/lib/reminders";
import { logActivity } from "@/server/actions/log";
import { getDb, schema as s } from "@/server/db";

import { ParasutAuthError, ParasutClient, ParasutDeadlineError, ParasutError } from "./client";
import { MANAGED_QTY_NOTE } from "./constants";
import { readParasutConfig } from "./config";
import type { ListResponse, ShowResponse } from "./jsonapi";
import { billToDraft, findExisting, pickCategory, shouldImport, supplierHistory, supplierKey, type BillDraft, type ExistingInvoice } from "./mapping";

const CURSOR_KEY = "parasut.cursor";
const PRICE_KEY = "parasut.prices";
const RESUME_KEY = "parasut.resume";
const CONTACTS_KEY = "parasut.contacts";
const PENDING_KEY = "parasut.pendingEInvoices";
/** Panelde silinen Paraşüt faturaları (bir sonraki eşitlemede geri gelmesin) */
export const IGNORE_KEY = "parasut.ignore";
/** Eşitlemenin kendi durumu; "Oturumu sıfırla" bunları siler */
export const PARASUT_STATE_KEYS = [CURSOR_KEY, RESUME_KEY, PENDING_KEY];
const PLACEHOLDER_SUPPLIER = "Paraşüt tedarikçisi";
/** Önceki eşitlemeden sonra değişmiş olabilecek faturalar için geriye bakış */
const LOOKBACK_DAYS = 75;
/** Okuma + yazma toplam süresi (Vercel işlevi 60 sn) */
const DEADLINE_MS = 45_000;
/** Okumanın payı; kalan süre yazmaya ve doğrulamaya kalır */
const FETCH_SHARE = 0.6;
/** Tedarikçi adlarını /contacts ile okumanın bırakıldığı an (sürenin payı) */
const CONTACTS_SHARE = 0.75;
/** Bir çalışmada tek tek yeniden okunacak en fazla fatura (listede görünmeyenler + pencere dışı ödenmemişler) */
const RECHECK_LIMIT = 8;
/**
 * "supplier" belgelenen include listesinde yok ama çalışıyor (topluluk istemcileri); reddedilirse
 * tedarikçisiz, o da olmazsa ürünsüz istenir. Tedarikçi adı gelmeyen faturalar için /contacts/{id} okunur.
 */
const INCLUDES = ["supplier,category,details,details.product", "category,details,details.product", "category,details"];

type SyncOk = { ok: true; summary: string; runId: number; fetched: number; created: number; updated: number; removed: number; partial: boolean };
type SyncErr = { ok: false; error: string; runId: number | null };

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

type ContactCache = Record<string, { name: string; taxNo: string | null }>;

type Existing = ExistingInvoice & {
  unpaid: boolean;
  syncedAt: Date | null;
  dueDate: string | null;
  origin: "manual" | "excel" | "parasut";
  source: "manual" | "excel" | "parasut";
  note: string | null;
  parasutUnpaid: boolean | null;
};

interface Ctx {
  existing: Existing[];
  rules: Awaited<ReturnType<typeof loadRules>>;
  history: Map<string, string>;
  alias: (name: string) => string;
  ignored: Set<string>;
  /** Bu çalışmada yazılmış Paraşüt kimlikleri (sayfalar kayarsa aynı fatura iki kez gelebilir) */
  applied: Set<string>;
  touchedMonths: Set<string>;
  counts: { created: number; updated: number; removed: number };
}

const loadRules = () => getDb().select().from(s.parasutCategoryRules);

/** Paraşüt'te kaldırılmış (iptal, silinmiş) bir faturanın panel karşılığı */
async function retire(match: Existing, reason: string, ctx: Ctx) {
  const db = getDb();
  ctx.touchedMonths.add(match.date.slice(0, 7));
  if (match.origin === "parasut") {
    await db.delete(s.invoices).where(eq(s.invoices.id, match.id));
    const i = ctx.existing.indexOf(match);
    if (i >= 0) ctx.existing.splice(i, 1);
    ctx.counts.removed++;
  } else {
    // Elle/Excel'le girilmiş kayıt silinmez: bağı çözülür ve not düşülür
    const note = `${match.note ? `${match.note} · ` : ""}Paraşüt'te ${reason} — kontrol edin`;
    const syncedAt = new Date();
    await db
      .update(s.invoices)
      .set({ externalId: null, source: match.origin, syncedAt, parasutUnpaid: null, note })
      .where(eq(s.invoices.id, match.id));
    await db.delete(s.parasutBillLines).where(eq(s.parasutBillLines.invoiceId, match.id));
    Object.assign(match, { externalId: null, source: match.origin, parasutUnpaid: null, note, syncedAt });
    ctx.counts.updated++;
  }
}

/** Tek bir Paraşüt faturasını panele yazar (yeni / güncelle / kaldır) */
async function applyDraft(d: BillDraft, ctx: Ctx) {
  const db = getDb();
  if (ctx.ignored.has(d.externalId) || ctx.applied.has(d.externalId)) return;
  ctx.applied.add(d.externalId);
  const match = findExisting(d, ctx.existing) as Existing | null;
  const verdict = shouldImport(d);
  if (!verdict.ok) {
    if (match && match.externalId === d.externalId) await retire(match, verdict.reason, ctx);
    return;
  }
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
  };
  let invoiceId: number;
  if (match) {
    // Kategori ve tedarikçi adı panelde kalır. "Ödendi/ödenmedi" panelde elle değiştirilmişse ve Paraşüt'teki değer
    // o zamandan beri aynıysa paneldeki kalır; Paraşüt değiştiyse Paraşüt'ünki gelir. İlk bağlanmada Paraşüt'ünki
    // alınır (Excel kayıtlarında ödeme durumu tutulmamıştı). Paraşüt'te vade yoksa paneldeki vade korunur.
    const localOverride = match.source === "parasut" && match.parasutUnpaid !== null && match.unpaid !== match.parasutUnpaid && d.unpaid === match.parasutUnpaid;
    // Yer tutucu ad, yalnızca gerçek tedarikçi adı okunabildiyse düzeltilir (açıklamayla değil)
    const supplierFix = match.supplier === PLACEHOLDER_SUPPLIER && d.supplierResolved ? { supplier: ctx.alias(d.supplier) } : {};
    const unpaid = localOverride ? match.unpaid : d.unpaid;
    const dueDate = d.dueDate ?? match.dueDate;
    await db
      .update(s.invoices)
      .set({ ...common, ...supplierFix, unpaid, dueDate })
      .where(eq(s.invoices.id, match.id));
    invoiceId = match.id;
    if (match.date !== d.date) ctx.touchedMonths.add(match.date.slice(0, 7));
    Object.assign(match, {
      ...supplierFix,
      externalId: d.externalId,
      invoiceNo: d.invoiceNo,
      source: "parasut",
      date: d.date,
      payable: d.payable,
      unpaid,
      dueDate,
      parasutUnpaid: d.unpaid,
      syncedAt: common.syncedAt,
    });
    ctx.counts.updated++;
  } else {
    const supplier = ctx.alias(d.supplier);
    const { category, reason } =
      supplier === PLACEHOLDER_SUPPLIER
        ? pickCategory({ ...d, supplier }, ctx.rules, new Map(), INVOICE_CATEGORIES)
        : pickCategory({ ...d, supplier }, ctx.rules, ctx.history, INVOICE_CATEGORIES);
    const [row] = await db
      .insert(s.invoices)
      .values({ ...common, unpaid: d.unpaid, dueDate: d.dueDate, origin: "parasut", supplier, category, description: d.description, note: `Paraşüt'ten alındı · kategori: ${reason}` })
      .returning({ id: s.invoices.id });
    invoiceId = row.id;
    ctx.existing.push({
      id: row.id,
      externalId: d.externalId,
      invoiceNo: d.invoiceNo,
      supplier,
      date: d.date,
      payable: d.payable,
      unpaid: d.unpaid,
      dueDate: d.dueDate,
      origin: "parasut",
      source: "parasut",
      note: null,
      parasutUnpaid: d.unpaid,
      syncedAt: common.syncedAt,
    });
    ctx.counts.created++;
  }
  ctx.touchedMonths.add(d.date.slice(0, 7));
  // Kalemler her seferinde baştan yazılır (aynı kalem başka bir satıra bağlı kalmışsa o da silinir)
  await db.delete(s.parasutBillLines).where(eq(s.parasutBillLines.invoiceId, invoiceId));
  if (d.lines.length) {
    await db.delete(s.parasutBillLines).where(inArray(s.parasutBillLines.externalId, d.lines.map((l) => l.externalId)));
    await db.insert(s.parasutBillLines).values(d.lines.map((l) => ({ ...l, invoiceId })));
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
    // Önceki bir çalışma işlev süresi dolduğu için yarıda kesildiyse "sürüyor" kalmasın
    await db
      .update(s.parasutSyncRuns)
      .set({ status: "error", finishedAt: new Date(), message: "Yarıda kesildi (işlev süresi doldu)" })
      .where(and(eq(s.parasutSyncRuns.status, "running"), lt(s.parasutSyncRuns.startedAt, new Date(started - 120_000))));
    const [run] = await db.insert(s.parasutSyncRuns).values({ trigger }).returning({ id: s.parasutSyncRuns.id });
    runId = run.id;

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
    const [existingRows, rules, ignoredList] = await Promise.all([
      db
        .select({
          id: s.invoices.id,
          externalId: s.invoices.externalId,
          invoiceNo: s.invoices.invoiceNo,
          supplier: s.invoices.supplier,
          date: s.invoices.date,
          payable: s.invoices.payable,
          unpaid: s.invoices.unpaid,
          dueDate: s.invoices.dueDate,
          origin: s.invoices.origin,
          source: s.invoices.source,
          note: s.invoices.note,
          parasutUnpaid: s.invoices.parasutUnpaid,
          syncedAt: s.invoices.syncedAt,
          category: s.invoices.category,
        })
        .from(s.invoices),
      loadRules(),
      getState<string[]>(IGNORE_KEY),
    ]);
    // Tedarikçi geçmişi ve kısa adlar, kaydı ilk açanın (origin) Paraşüt olmadığı faturalardan öğrenilir; eşitlemenin
    // kendi tahminleri geçmişe katılmaz (yanlış bir tahmin kendini çoğaltmasın)
    const own = existingRows.filter((i) => i.origin !== "parasut");
    const history = supplierHistory(own);
    const alias = supplierAliases(own.map((i) => i.supplier));
    const ctx: Ctx = {
      existing: existingRows as Existing[],
      rules,
      history,
      alias,
      ignored: new Set(ignoredList ?? []),
      applied: new Set(),
      touchedMonths: new Set(),
      counts: { created: 0, updated: 0, removed: 0 },
    };

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
          const res = await client.show<Record<string, unknown>>(`purchase_bills/${encodeURIComponent(externalId)}`, { include: INCLUDES[1] });
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
            if (err instanceof ParasutError && err.status === 404) await retire(e, "silinmiş", ctx);
            else console.error("Paraşüt yeniden denetim", externalId, err);
          } catch (inner) {
            console.error("Paraşüt yeniden denetim", externalId, inner);
          }
        }
        rechecked++;
      }
    }

    if (ctx.touchedMonths.size) await applyProductLinks([...ctx.touchedMonths]);
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
    if (Date.now() - started < deadline - 15_000) await countPendingEInvoices(client).catch(() => null);

    const { created, updated, removed } = ctx.counts;
    const fetched = drafts.length;
    const summary = `${fetched} fatura okundu · ${created} yeni · ${updated} güncellendi${removed ? ` · ${removed} kaldırıldı` : ""}${rechecked ? ` · ${rechecked} yeniden denetlendi` : ""}${partial ? " · süre doldu, kalanı sonraki eşitlemede sürecek" : ""}`;
    await db
      .update(s.parasutSyncRuns)
      .set({ status: "ok", finishedAt: new Date(), fetched, created, updated, removed, message: summary })
      .where(eq(s.parasutSyncRuns.id, runId));
    if (created || updated || removed) await logActivity(null, trigger === "cron" ? "Paraşüt eşitlemesi (otomatik)" : "Paraşüt eşitlemesi", summary);
    return { ok: true, summary, runId, fetched, created, updated, removed, partial };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (runId) await db.update(s.parasutSyncRuns).set({ status: "error", finishedAt: new Date(), message: error.slice(0, 1000) }).where(eq(s.parasutSyncRuns.id, runId));
    console.error("Paraşüt eşitlemesi", e);
    return { ok: false, error, runId };
  }
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
      const res = await client.show<{ name?: string; tax_number?: string }>(`contacts/${encodeURIComponent(id)}`);
      cache[id] = { name: res.data.attributes.name?.trim() || PLACEHOLDER_SUPPLIER, taxNo: res.data.attributes.tax_number ?? null };
      added++;
    } catch (e) {
      if (e instanceof ParasutDeadlineError || e instanceof ParasutAuthError) break;
      // okunamazsa yer tutucuyla devam
    }
  }
  if (added) await setState(CONTACTS_KEY, cache);
  applyContacts(drafts, cache);
}

/**
 * Paraşüt'e gelen ama "içeri al" yapılmadığı için henüz gider faturası olmayan e-faturalar (yaklaşık).
 * GET /e_invoices belgelenmemiş ama çalışıyor; gelen (inbound), reddedilmemiş ve faturaya bağlanmamış, son 60
 * günün kayıtları sayılır. En yeniler önce istenir (sıralama reddedilirse varsayılan sırayla son iki sayfa).
 */
async function countPendingEInvoices(client: ParasutClient) {
  type EAttr = { direction?: string; archived?: boolean; issue_date?: string; contact_name?: string; response_type?: string };
  const since = addDays(todayTR(), -60);
  let pages: ListResponse<EAttr>[] = [];
  try {
    const first = await client.get<ListResponse<EAttr>>("e_invoices", { include: "invoice", sort: "-issue_date", "page[size]": 25, "page[number]": 1 });
    pages = [first];
    if ((first.meta?.total_pages ?? 1) > 1) pages.push(await client.get<ListResponse<EAttr>>("e_invoices", { include: "invoice", sort: "-issue_date", "page[size]": 25, "page[number]": 2 }));
  } catch (e) {
    if (!(e instanceof ParasutError) || (e.status !== 400 && e.status !== 422)) throw e;
    const first = await client.get<ListResponse<EAttr>>("e_invoices", { include: "invoice", "page[size]": 25, "page[number]": 1 });
    const total = first.meta?.total_pages ?? 1;
    pages = [first];
    for (const p of [total, total - 1].filter((p) => p > 1)) pages.push(await client.get<ListResponse<EAttr>>("e_invoices", { include: "invoice", "page[size]": 25, "page[number]": p }));
  }
  const seen = new Set<string>();
  const pending: { from: string | null; date: string | null }[] = [];
  for (const page of pages) {
    for (const e of page.data) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      const a = e.attributes;
      const inv = e.relationships?.invoice?.data;
      const open = inv === null || (Array.isArray(inv) && !inv.length);
      const answered = a.response_type === "rejected" || a.response_type === "refunded";
      if (a.direction === "inbound" && !a.archived && open && !answered && (!a.issue_date || a.issue_date.slice(0, 10) >= since)) {
        pending.push({ from: a.contact_name ?? null, date: a.issue_date ?? null });
      }
    }
  }
  await setState(PENDING_KEY, { count: pending.length, sample: pending.slice(0, 5), at: new Date().toISOString() });
  return pending.length;
}

/**
 * Hammaddeye bağlı Paraşüt kalemlerinden verilen ayların alınan miktarlarını yeniden hesaplar ve
 * (bağlantıda istenmişse) hammaddenin paket fiyatını en son faturadaki birim fiyatla günceller.
 * Elle girilmiş alınan miktar satırlarına dokunulmaz; yalnızca notu "Paraşüt" olanlar yönetilir.
 */
export async function applyProductLinks(months?: string[]) {
  const db = getDb();
  const links = await db.select().from(s.parasutProductLinks);
  if (!links.length) {
    // Bağlantı kalmadıysa yönetilen (Paraşüt kaynaklı) alınan miktar satırları da kalkar
    await db.delete(s.purchaseQuantities).where(eq(s.purchaseQuantities.note, MANAGED_QTY_NOTE));
    return { quantities: 0, prices: 0 };
  }
  const byKey = new Map(links.map((l) => [l.productKey, l]));

  const rows = await db
    .select({
      productKey: s.parasutBillLines.productKey,
      quantity: s.parasutBillLines.quantity,
      netTotal: s.parasutBillLines.netTotal,
      date: s.invoices.date,
      supplier: s.invoices.supplier,
      invoiceNo: s.invoices.invoiceNo,
    })
    .from(s.parasutBillLines)
    .innerJoin(s.invoices, eq(s.invoices.id, s.parasutBillLines.invoiceId))
    .where(inArray(s.parasutBillLines.productKey, links.map((l) => l.productKey)));

  const wanted = months ? new Set(months) : null;
  const qty = new Map<string, number>(); // month|ingredientId → miktar
  for (const r of rows) {
    const link = byKey.get(r.productKey)!;
    const m = r.date.slice(0, 7);
    if (wanted && !wanted.has(m)) continue;
    const k = `${m}|${link.ingredientId}`;
    qty.set(k, (qty.get(k) ?? 0) + r.quantity * link.factor);
  }

  // Yönetilen satırlar: önce bu ayların (ay verilmediyse bütün ayların) Paraşüt satırları silinir, sonra
  // hesaplananlar yazılır. Kullanıcının elle düzelttiği satırın notu değişir ve artık eşitlemeye ait olmaz.
  const managedMonths = months
    ? []
    : (await db.select({ month: s.purchaseQuantities.month }).from(s.purchaseQuantities).where(eq(s.purchaseQuantities.note, MANAGED_QTY_NOTE))).map((r) => r.month);
  const monthList = months ?? [...new Set([...rows.map((r) => r.date.slice(0, 7)), ...managedMonths])];
  let quantities = 0;
  if (monthList.length) {
    await db.delete(s.purchaseQuantities).where(and(inArray(s.purchaseQuantities.month, monthList), eq(s.purchaseQuantities.note, MANAGED_QTY_NOTE)));
    const manual = await db
      .select({ month: s.purchaseQuantities.month, ingredientId: s.purchaseQuantities.ingredientId })
      .from(s.purchaseQuantities)
      .where(inArray(s.purchaseQuantities.month, monthList));
    const manualKeys = new Set(manual.map((r) => `${r.month}|${r.ingredientId}`));
    const values = [...qty]
      .filter(([k, v]) => v > 0 && !manualKeys.has(k))
      .map(([k, v]) => {
        const [month, ing] = k.split("|");
        return { month, ingredientId: Number(ing), qty: Math.round(v * 1000) / 1000, note: MANAGED_QTY_NOTE };
      });
    if (values.length) await db.insert(s.purchaseQuantities).values(values);
    quantities = values.length;
  }

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
  for (const [ingredientId, r] of latest) {
    const link = byKey.get(r.productKey)!;
    // Anahtar bağlantıyı da içerir: çarpan ya da ürün değişince aynı faturanın fiyatı yeni çarpanla yeniden yazılır
    const appliedKey = `${ingredientId}|${link.productKey}|${link.factor}`;
    if ((applied[appliedKey] ?? "") >= r.date) continue;
    const packagePrice = Math.round((r.netTotal / r.quantity) * 100) / 100;
    const packageSize = link.factor;
    const [ing] = await db.select().from(s.ingredients).where(eq(s.ingredients.id, ingredientId)).limit(1);
    if (!ing) continue;
    const before = ing.packagePrice / (ing.packageSize || 1);
    const after = packagePrice / (packageSize || 1);
    applied[appliedKey] = r.date;
    if (before > 0 && Math.abs(after - before) / before < 0.005) continue;
    await db.update(s.ingredients).set({ packagePrice, packageSize, isEstimate: false }).where(eq(s.ingredients.id, ingredientId));
    await db.insert(s.ingredientPrices).values({
      ingredientId,
      packagePrice,
      packageSize,
      changedBy: "Paraşüt",
      note: `${r.supplier}${r.invoiceNo ? ` ${r.invoiceNo}` : ""} (${r.date})`,
    });
    prices++;
  }
  await setState(PRICE_KEY, applied);
  return { quantities, prices };
}

/** Ekran için: bağlanmamış Paraşüt ürünleri (en çok geçenler önce) */
export async function unlinkedProducts(limit = 40) {
  const db = getDb();
  const [lines, links] = await Promise.all([
    db
      .select({ productKey: s.parasutBillLines.productKey, productName: s.parasutBillLines.productName, unit: s.parasutBillLines.unit, quantity: s.parasutBillLines.quantity, netTotal: s.parasutBillLines.netTotal, date: s.invoices.date, supplier: s.invoices.supplier })
      .from(s.parasutBillLines)
      .innerJoin(s.invoices, eq(s.invoices.id, s.parasutBillLines.invoiceId))
      .where(isNotNull(s.parasutBillLines.productKey))
      .orderBy(desc(s.invoices.date)),
    db.select({ productKey: s.parasutProductLinks.productKey }).from(s.parasutProductLinks),
  ]);
  const linked = new Set(links.map((l) => l.productKey));
  const agg = new Map<string, { productKey: string; productName: string; unit: string | null; count: number; lastDate: string; lastUnitPrice: number; supplier: string }>();
  for (const l of lines) {
    if (linked.has(l.productKey)) continue;
    const a = agg.get(l.productKey);
    if (a) a.count++;
    else
      agg.set(l.productKey, {
        productKey: l.productKey,
        productName: l.productName,
        unit: l.unit,
        count: 1,
        lastDate: l.date,
        lastUnitPrice: l.quantity > 0 ? l.netTotal / l.quantity : 0,
        supplier: l.supplier,
      });
  }
  return [...agg.values()].sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate)).slice(0, limit);
}

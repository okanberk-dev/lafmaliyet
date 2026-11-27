import "server-only";

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";

import { ALL_BRANCHES, type BranchScope, tillBranches } from "@/lib/branches";
import { cardFor, cardIndex, groupSuppliers, methodLabel, supplierHref, type SupplierCard, type SupplierGroup } from "@/app/panel/tedarikciler/logic";
import { invoiceLabel } from "@/lib/cari/account";
import { METHOD_LABEL, type CariMethod } from "@/lib/cari/balance";
import { BANK_MATCH, isPosLine, SUPPLIER_MATCH, type Candidate, type Decision, type MatchLine, type RecordKind } from "@/lib/mutabakat/match";
import { type BranchPos, branchPos, branchRecon, type BranchRecon } from "@/lib/mutabakat/branch";
import type { StatementKind } from "@/lib/mutabakat/parse";
import { posCardOf, posReconciliation, posSalesFrom, type PosSaleDay } from "@/lib/mutabakat/pos";
import { missingFor, poolOf, reconcilePool, statementSummary, supplierScope, type ReconRow, type StatementSummary } from "@/lib/mutabakat/view";
import { addDays, todayTR } from "@/lib/reminders";
import { listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";
import { loadLedgerInvoices, loadSupplierCards, type LedgerRow } from "@/server/data/suppliers";

import { readPosBlockDays } from "./store";

// Mutabakatın okuma yolu (docs/MUTABAKAT.md): ekstreler, satırları, panel kayıtları (adaylar) ve eşleşme. Eşleşme her
// okumada yeniden hesaplanır (src/lib/mutabakat/view.ts reconcilePool): panelde bir kayıt düzelince ya da eklenince
// ekran kendiliğinden güncellenir. Ekstre işletme genelidir (banka hesabı ve cari şubeye bölünmez): eşleşme her kipte
// firmanın bütün kayıtlarıyla; Mutabakat alanının şube kipinde (şube ayrımı parça 5) yalnız gösterim ayrılır
// (src/lib/mutabakat/branch.ts: şubenin kaydıyla eşleşenler üstte, gerisi İşletme geneli; POS'ta şubenin beklenen neti).

/** Adayların ekstre döneminin bu kadar gün öncesinden ve sonrasından okunur (elle eşleştirme penceresi ±45 gün) */
const WINDOW_DAYS = 45;

export interface LineRow extends MatchLine {
  statementId: number;
  rowNo: number;
  balance: number | null;
  decidedByName: string | null;
}

export interface StatementInfo {
  id: number;
  kind: StatementKind;
  account: string;
  fileName: string | null;
  periodFrom: string;
  periodTo: string;
  lineCount: number;
  duplicates: number;
  uploadedOn: string;
  expiresOn: string;
  createdByName: string;
  createdAt: Date;
  /** Tedarikçinin sayfası (tedarikçi ekstresi; tedarikçi artık bulunamıyorsa null) */
  supplierHref: string | null;
}

export interface StatementView extends StatementInfo {
  summary: StatementSummary;
  rows: ReconRow<LineRow>[];
  /** Ekstrenin döneminde panelde olup ekstrede eşleşmeyen kayıtlar */
  missing: Candidate[];
  /** Tedarikçi ekstresinde tedarikçi bulunamadı (kartı silindi, adı değişti): eşleşme yapılamaz */
  orphan: boolean;
  /** Mutabakat alanının şube kipi: şubenin adı ve hareketlerin ayrımı; firma kipinde ve "Tümü"de null */
  branch: (BranchRecon<ReconRow<LineRow>> & { name: string }) | null;
}

interface Pool {
  kind: StatementKind;
  candidates: Candidate[];
  rows: ReconRow<LineRow>[];
  free: Candidate[];
}

// ---------------------------------------------------------------- Tedarikçiler

type Group = SupplierGroup<LedgerRow, SupplierCard>;

/** Tedarikçiler ekranıyla aynı gruplar (kart + faturalardaki adlar; src/app/panel/tedarikciler/logic.ts) */
async function supplierGroups(): Promise<Group[]> {
  const [cards, invoices] = await Promise.all([loadSupplierCards(), loadLedgerInvoices()]);
  return groupSuppliers(invoices, cards, { today: todayTR(), termDays: 30 });
}

/** Yükleme penceresinin tedarikçi listesi (ada göre) */
export async function loadSupplierOptions(): Promise<{ slug: string; name: string; invoices: number }[]> {
  const groups = await supplierGroups();
  return groups
    .map((g) => ({ slug: g.slug, name: g.name, invoices: g.invoices.length }))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

/** Yüklemede seçilen tedarikçi: grubu, kimliği ve adları */
export async function resolveSupplier(slug: string): Promise<{ name: string; cardId: number | null; keys: string[]; scope: string } | null> {
  const g = (await supplierGroups()).find((x) => x.slug === slug);
  if (!g) return null;
  return { name: g.name, cardId: g.card?.id ?? null, keys: g.keys, scope: supplierScope(g.card?.id ?? null, g.key) };
}

/** Ekstrenin tedarikçisi: kartı varsa kartla, yoksa ad anahtarlarından biriyle */
function groupOf(groups: readonly Group[], st: { supplierCardId: number | null; supplierNames: string[] }): Group | null {
  if (st.supplierCardId !== null) {
    const byCard = groups.find((g) => g.card?.id === st.supplierCardId);
    if (byCard) return byCard;
  }
  const keys = new Set(st.supplierNames);
  return groups.find((g) => g.keys.some((k) => keys.has(k))) ?? null;
}

const cardNames = (c: Pick<SupplierCard, "name" | "legalName" | "accountHolder" | "aliases"> | null | undefined): string[] =>
  c ? [c.name, c.legalName ?? "", c.accountHolder ?? "", ...c.aliases].filter(Boolean) : [];

// ---------------------------------------------------------------- Adaylar

/**
 * Banka hareketinin adayları (+ giren / − çıkan): kartla ya da havaleyle ödenen harcama (kasadan çıkan ve cari borcun
 * gideri hariç: ilki kasadan, ikincisinin ödemesi ayrı kayıttır), tedarikçi ödemesi (kasa ve elden hariç), "Ödendi"
 * işaretli fatura (nakit ve cari ödemeyle kapanan hariç) ve kasadan teslim (bankaya yatırılan para, giriş).
 */
async function bankCandidates(from: string, to: string, groups: readonly Group[]): Promise<Candidate[]> {
  const db = getDb();
  const [expenses, payments, invoices, deposits, cards] = await Promise.all([
    db
      .select({
        id: s.expenseEntries.id,
        date: s.expenseEntries.date,
        amount: s.expenseEntries.amount,
        description: s.expenseEntries.description,
        category: s.expenseCategories.name,
        method: s.expenseEntries.paymentMethod,
        branchId: s.expenseEntries.branchId,
      })
      .from(s.expenseEntries)
      .innerJoin(s.expenseCategories, eq(s.expenseEntries.categoryId, s.expenseCategories.id))
      .where(
        and(
          gte(s.expenseEntries.date, from),
          lte(s.expenseEntries.date, to),
          inArray(s.expenseEntries.paymentMethod, ["kart", "havale", "diger"]),
          isNull(s.expenseEntries.cashOutId),
          isNull(s.expenseEntries.supplierEntryId),
        ),
      ),
    db
      .select({ id: s.supplierEntries.id, date: s.supplierEntries.date, amount: s.supplierEntries.amount, method: s.supplierEntries.method, supplierId: s.supplierEntries.supplierId })
      .from(s.supplierEntries)
      .where(and(eq(s.supplierEntries.kind, "odeme"), gte(s.supplierEntries.date, from), lte(s.supplierEntries.date, to), inArray(s.supplierEntries.method, ["havale", "kart", "cek", "diger"]))),
    db
      .select({
        id: s.invoices.id,
        paidAt: s.invoices.paidAt,
        payable: s.invoices.payable,
        supplier: s.invoices.supplier,
        invoiceNo: s.invoices.invoiceNo,
        date: s.invoices.date,
        paidVia: s.invoices.paidVia,
        branchId: s.invoices.branchId,
      })
      .from(s.invoices)
      .where(
        and(
          eq(s.invoices.unpaid, false),
          eq(s.invoices.paidByLedger, false),
          isNotNull(s.invoices.paidAt),
          gte(s.invoices.paidAt, from),
          lte(s.invoices.paidAt, to),
          or(isNull(s.invoices.paidVia), ne(s.invoices.paidVia, "nakit")),
        ),
      ),
    db
      .select({ id: s.cashOuts.id, date: s.cashOuts.date, amount: s.cashOuts.amount, store: s.cashOuts.store, branchId: s.cashOuts.branchId })
      .from(s.cashOuts)
      .where(and(eq(s.cashOuts.kind, "teslim"), gte(s.cashOuts.date, from), lte(s.cashOuts.date, to))),
    loadSupplierCards(),
  ]);
  const byCard = new Map(cards.map((c) => [c.id, c]));
  const index = cardIndex(cards);
  const slugOfCard = new Map(groups.flatMap((g) => (g.card ? [[g.card.id, g.slug] as const] : [])));
  const slugOfInvoice = new Map(groups.flatMap((g) => g.invoices.map((i) => [i.id, g.slug] as const)));
  const out: Candidate[] = [];
  for (const e of expenses) {
    out.push({
      kind: "harcama",
      id: e.id,
      date: e.date,
      amount: -Math.abs(e.amount),
      label: [e.category, e.description?.trim()].filter(Boolean).join(" · "),
      names: [e.description ?? "", e.category].filter(Boolean),
      href: `/panel/harcamalar?ay=${e.date.slice(0, 7)}`,
      branchId: e.branchId ?? null,
    });
  }
  for (const p of payments) {
    const card = byCard.get(p.supplierId);
    const slug = slugOfCard.get(p.supplierId);
    out.push({
      kind: "odeme",
      id: p.id,
      date: p.date,
      amount: -Math.abs(p.amount),
      label: `${card?.name ?? "Tedarikçi"} · ${METHOD_LABEL[(p.method ?? "diger") as CariMethod]}`,
      names: cardNames(card),
      href: slug ? `${supplierHref(slug)}?sekme=hareketler` : null,
      // Cari ödeme firmanın hesabından (şubesi yok)
      branchId: null,
    });
  }
  for (const i of invoices) {
    const slug = slugOfInvoice.get(i.id);
    out.push({
      kind: "fatura-odeme",
      id: i.id,
      date: i.paidAt!,
      amount: -Math.abs(i.payable),
      label: `${i.supplier} · ${invoiceLabel(i)}${i.paidVia ? ` · ${methodLabel(i.paidVia)}` : ""}`,
      names: [i.supplier, ...cardNames(cardFor(index, i.supplier))],
      ref: i.invoiceNo,
      href: slug ? `${supplierHref(slug)}?fatura=${i.id}` : null,
      branchId: i.branchId ?? null,
    });
  }
  for (const d of deposits) {
    out.push({
      kind: "teslim",
      id: d.id,
      date: d.date,
      amount: Math.abs(d.amount),
      label: `Kasadan teslim${d.store?.trim() ? ` · ${d.store.trim()}` : ""}`,
      names: d.store ? [d.store] : [],
      href: `/panel/kasa?gun=${d.date}&sube=${encodeURIComponent(d.branchId)}`,
      branchId: d.branchId,
    });
  }
  return out.filter((c) => Math.abs(c.amount) >= 0.005);
}

/**
 * Tedarikçi ekstresinin adayları (+ fatura / − ödeme): grubun faturaları (Ödenecek, KDV dahil), "Ödendi" işaretli
 * faturaların ödemesi (cari ödemeyle kapananlar hariç: onların ödemesi cari kayıttır) ve kartın cari ödemeleri (her
 * şekli: kasadan, elden, havale).
 */
async function supplierCandidates(g: Group, from: string, to: string): Promise<Candidate[]> {
  const inWindow = (d: string) => d >= from && d <= to;
  const href = (id: number) => `${supplierHref(g.slug)}?fatura=${id}`;
  const out: Candidate[] = [];
  for (const i of g.invoices) {
    if (inWindow(i.date) && Math.abs(i.payable) >= 0.005) {
      out.push({ kind: "fatura", id: i.id, date: i.date, amount: i.payable, label: invoiceLabel(i), ref: i.invoiceNo, href: href(i.id), branchId: i.branchId ?? null });
    }
    if (!i.unpaid && i.paidAt && !i.paidByLedger && inWindow(i.paidAt) && Math.abs(i.payable) >= 0.005) {
      out.push({
        kind: "fatura-odeme",
        id: i.id,
        date: i.paidAt,
        amount: -Math.abs(i.payable),
        label: `${invoiceLabel(i)} ödemesi${i.paidVia ? ` (${methodLabel(i.paidVia)})` : ""}`,
        ref: i.invoiceNo,
        href: href(i.id),
        branchId: i.branchId ?? null,
      });
    }
  }
  if (g.card) {
    const payments = await getDb()
      .select({ id: s.supplierEntries.id, date: s.supplierEntries.date, amount: s.supplierEntries.amount, method: s.supplierEntries.method })
      .from(s.supplierEntries)
      .where(and(eq(s.supplierEntries.supplierId, g.card.id), eq(s.supplierEntries.kind, "odeme"), gte(s.supplierEntries.date, from), lte(s.supplierEntries.date, to)));
    for (const p of payments) {
      out.push({
        kind: "odeme",
        id: p.id,
        date: p.date,
        amount: -Math.abs(p.amount),
        label: `Ödeme · ${METHOD_LABEL[(p.method ?? "diger") as CariMethod]}`,
        href: `${supplierHref(g.slug)}?sekme=hareketler`,
        branchId: null,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Ekstreler ve eşleşme

const STATEMENT_COLUMNS = {
  id: s.reconStatements.id,
  kind: s.reconStatements.kind,
  account: s.reconStatements.account,
  supplierCardId: s.reconStatements.supplierCardId,
  supplierNames: s.reconStatements.supplierNames,
  fileName: s.reconStatements.fileName,
  periodFrom: s.reconStatements.periodFrom,
  periodTo: s.reconStatements.periodTo,
  lineCount: s.reconStatements.lineCount,
  duplicates: s.reconStatements.duplicates,
  uploadedOn: s.reconStatements.uploadedOn,
  expiresOn: s.reconStatements.expiresOn,
  createdByName: s.reconStatements.createdByName,
  createdAt: s.reconStatements.createdAt,
};

const LINE_COLUMNS = {
  id: s.reconLines.id,
  statementId: s.reconLines.statementId,
  scope: s.reconLines.scope,
  rowNo: s.reconLines.rowNo,
  date: s.reconLines.date,
  description: s.reconLines.description,
  amount: s.reconLines.amount,
  balance: s.reconLines.balance,
  ref: s.reconLines.ref,
  decision: s.reconLines.decision,
  matchKind: s.reconLines.matchKind,
  matchId: s.reconLines.matchId,
  decidedByName: s.reconLines.decidedByName,
};

const toLine = (r: { [K in keyof typeof LINE_COLUMNS]: unknown }): LineRow => r as unknown as LineRow;

/**
 * Bütün ekstreler, eşleşmeleriyle (yeni yüklenen önce). Banka ekstreleri tek havuzda, tedarikçi ekstreleri tedarikçi
 * başına eşleşir (view.ts poolOf). `pools` elle eşleştirmenin denetimi içindir (eylemler). `scope` bir şubeyse
 * (Mutabakat alanının şube kipi) eşleşme aynı kalır, gösterim ayrılır: her ekstrenin `branch` ayrımı kurulur, `rows`
 * şubenin hareketleri ve İşletme geneli (öbür şubenin kaydı adsız), `missing` yalnız şubenin kayıtları; havuzlar dönmez
 * (eylemler loadRecon()'u kapsamsız, firmanın havuzuyla çağırır)
 */
export async function loadRecon(scope: BranchScope = ALL_BRANCHES): Promise<{ statements: StatementView[]; pools: Map<string, Pool>; poolOfStatement: Map<number, string> }> {
  const db = getDb();
  const [statements, lines] = await Promise.all([
    db.select(STATEMENT_COLUMNS).from(s.reconStatements).orderBy(desc(s.reconStatements.uploadedOn), desc(s.reconStatements.id)),
    db.select(LINE_COLUMNS).from(s.reconLines).orderBy(asc(s.reconLines.date), asc(s.reconLines.id)),
  ]);
  const pools = new Map<string, Pool>();
  const poolOfStatement = new Map<number, string>();
  if (!statements.length) return { statements: [], pools, poolOfStatement };

  const groups = await supplierGroups();
  const scopeOf = new Map<number, string>();
  for (const l of lines) if (!scopeOf.has(l.statementId)) scopeOf.set(l.statementId, l.scope);
  const groupOfStatement = new Map<number, Group | null>();
  const members = new Map<string, typeof statements>();
  for (const st of statements) {
    const g = st.kind === "tedarikci" ? groupOf(groups, st) : null;
    groupOfStatement.set(st.id, g);
    // Tedarikçi ekstresi grubun kimliğiyle havuzlanır (kart sonradan açıldıysa eski ve yeni yükleme aynı havuzda)
    const pool = st.kind === "banka" ? "banka" : g ? supplierScope(g.card?.id ?? null, g.key) : poolOf({ kind: st.kind, scope: scopeOf.get(st.id) ?? `yetim:${st.id}` });
    poolOfStatement.set(st.id, pool);
    members.set(pool, [...(members.get(pool) ?? []), st]);
  }

  for (const [pool, sts] of members) {
    const kind = sts[0].kind;
    const ids = new Set(sts.map((x) => x.id));
    const poolLines = lines.filter((l) => ids.has(l.statementId)).map(toLine);
    const from = addDays(sts.reduce((m, x) => (x.periodFrom < m ? x.periodFrom : m), sts[0].periodFrom), -WINDOW_DAYS);
    const to = addDays(sts.reduce((m, x) => (x.periodTo > m ? x.periodTo : m), sts[0].periodTo), WINDOW_DAYS);
    const g = kind === "tedarikci" ? groupOfStatement.get(sts[0].id) : null;
    const candidates = kind === "banka" ? await bankCandidates(from, to, groups) : g ? await supplierCandidates(g, from, to) : [];
    const { rows, free } = reconcilePool(kind, poolLines, candidates, kind === "banka" ? BANK_MATCH : SUPPLIER_MATCH);
    pools.set(pool, { kind, candidates, rows, free });
  }

  const branchName = scope === ALL_BRANCHES ? null : ((await listBranches(db)).find((b) => b.id === scope)?.name ?? scope);
  const views: StatementView[] = statements.map((st) => {
    const pool = pools.get(poolOfStatement.get(st.id)!)!;
    const all = pool.rows.filter((r) => r.line.statementId === st.id);
    const g = groupOfStatement.get(st.id) ?? null;
    const allMissing = missingFor(pool.free, { from: st.periodFrom, to: st.periodTo });
    const branch = branchName === null || scope === ALL_BRANCHES ? null : { name: branchName, ...branchRecon(all, allMissing, scope) };
    // Şube kipinde satırlar ekrandaki sırayla (şubenin, sonra İşletme geneli) ve öbür şubenin kaydı adsız
    const rows = branch ? [...branch.own, ...branch.shared] : all;
    const missing = branch ? branch.missing : allMissing;
    return {
      id: st.id,
      kind: st.kind,
      account: st.account,
      fileName: st.fileName,
      periodFrom: st.periodFrom,
      periodTo: st.periodTo,
      lineCount: st.lineCount,
      duplicates: st.duplicates,
      uploadedOn: st.uploadedOn,
      expiresOn: st.expiresOn,
      createdByName: st.createdByName,
      createdAt: st.createdAt,
      supplierHref: g ? supplierHref(g.slug) : null,
      summary: statementSummary(all),
      rows,
      missing,
      orphan: st.kind === "tedarikci" && !g,
      branch,
    };
  });
  if (scope !== ALL_BRANCHES) return { statements: views, pools: new Map(), poolOfStatement: new Map() };
  return { statements: views, pools, poolOfStatement };
}

/** Elle eşleştirmenin seçenekleri ve denetimi için satırın havuzu */
export async function loadLinePool(lineId: number): Promise<{ line: LineRow; kind: StatementKind; pool: Pool } | null> {
  const [row] = await getDb().select({ statementId: s.reconLines.statementId }).from(s.reconLines).where(eq(s.reconLines.id, lineId)).limit(1);
  if (!row) return null;
  const { pools, poolOfStatement } = await loadRecon();
  const pool = pools.get(poolOfStatement.get(row.statementId) ?? "");
  const match = pool?.rows.find((r) => r.line.id === lineId);
  if (!pool || !match) return null;
  return { line: match.line, kind: pool.kind, pool };
}

/** Kararın denetimi: kayıt havuzda var mı, başka satıra elle bağlı mı */
export function candidateFor(pool: Pool, lineId: number, kind: RecordKind, id: number): { candidate: Candidate | null; takenBy: number | null } {
  const candidate = pool.candidates.find((c) => c.kind === kind && c.id === id) ?? null;
  const taker = pool.rows.find((r) => r.line.id !== lineId && r.line.decision === "elle" && r.line.matchKind === kind && r.line.matchId === id);
  return { candidate, takenBy: taker?.line.id ?? null };
}

// ---------------------------------------------------------------- POS hakediş

export interface PosView {
  blockDays: number;
  branches: { id: string; name: string; rate: number }[];
  coverage: { from: string; to: string } | null;
  /** POS hakedişi sayılan banka satırı sayısı */
  inflowCount: number;
  bankStatements: number;
  result: ReturnType<typeof posReconciliation>;
  /** Mutabakat alanının şube kipi: şubenin kart satışı ve beklenen neti (gelen para firmanın); firma kipinde null */
  branch: (BranchPos & { name: string }) | null;
}

/**
 * POS hakediş karşılaştırması: kasa raporlarının kart satışı (banka gün sonu fişi, yoksa Z'nin kart satırı) şube
 * şube, şubenin POS komisyon oranı (branches.pos_rate) ve bloke günüyle beklenen net; banka ekstrelerindeki POS
 * hakedişi satırları gelen. Ekstrelerin kapsadığı günler bütün banka ekstrelerinin ilk ve son hareketi arası.
 */
export async function loadPosView(today = todayTR(), scope: BranchScope = ALL_BRANCHES): Promise<PosView> {
  const db = getDb();
  const [blockDays, branchRows, bankLines, bankStatements] = await Promise.all([
    readPosBlockDays(db),
    listBranches(db),
    db
      .select({ id: s.reconLines.id, date: s.reconLines.date, amount: s.reconLines.amount, description: s.reconLines.description, decision: s.reconLines.decision })
      .from(s.reconLines)
      .innerJoin(s.reconStatements, eq(s.reconLines.statementId, s.reconStatements.id))
      .where(eq(s.reconStatements.kind, "banka")),
    db.select({ from: s.reconStatements.periodFrom, to: s.reconStatements.periodTo }).from(s.reconStatements).where(eq(s.reconStatements.kind, "banka")),
  ]);
  const coverage = bankStatements.length
    ? { from: bankStatements.reduce((m, x) => (x.from < m ? x.from : m), bankStatements[0].from), to: bankStatements.reduce((m, x) => (x.to > m ? x.to : m), bankStatements[0].to) }
    : null;
  const inflows = bankLines.filter((l) => isPosLine({ amount: l.amount, description: l.description, decision: l.decision as Decision | null })).map((l) => ({ date: l.date, amount: l.amount }));
  // Ekstre yokken son 30 günün satışı "ekstre bekleniyor" olarak görünür
  const salesFrom = coverage ? posSalesFrom(coverage.from, blockDays) : addDays(today, -30);
  const reports = await db
    .select({ date: s.cashReports.date, branchId: s.cashReports.branchId, card: s.cashReports.card, bankPos: s.cashReports.bankPos })
    .from(s.cashReports)
    .where(and(gte(s.cashReports.date, salesFrom), lte(s.cashReports.date, today)));
  const tills = tillBranches(branchRows);
  const all = branchRows.filter((b) => b.kind === "fiziksel");
  const rates = Object.fromEntries(all.map((b) => [b.id, b.posRate ?? 0.02]));
  const days: PosSaleDay[] = reports.map((r) => ({ date: r.date, branchId: r.branchId, ...posCardOf(r) }));
  const settings = { blockDays, rates, defaultRate: 0.02 };
  const result = posReconciliation({ days, inflows, settings, coverage, today });
  const branchRow = scope === ALL_BRANCHES ? null : branchRows.find((b) => b.id === scope);
  const shownBranches = (tills.length ? tills : all).filter((b) => !branchRow || b.id === branchRow.id);
  return {
    branch: branchRow ? { name: branchRow.name, ...branchPos({ branch: branchRow.id, days, settings, coverage, today, firmRows: result.rows }) } : null,
    blockDays,
    branches: shownBranches.map((b) => ({ id: b.id, name: b.name, rate: b.posRate ?? 0.02 })),
    coverage,
    inflowCount: inflows.length,
    bankStatements: bankStatements.length,
    // Şube kipinde firmanın valör satırları (öbür şubenin satışıyla) dönmez: yalnız toplamlar (bankaya gelen firmanın)
    result: branchRow ? { rows: [], totals: result.totals } : result,
  };
}

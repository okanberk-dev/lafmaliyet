import "server-only";

import { and, asc, eq, gte, lte, or } from "drizzle-orm";

import { ALL_BRANCHES, branchScopeLabel, type BranchScope } from "@/lib/branches";
import { fixedMonthly } from "@/lib/calc/engine";
import { accountDate, monthLastDay, monthTitle, periodStateOf } from "@/lib/closed-period";
import { FIXED_PERIODS, FIXED_SECTIONS } from "@/lib/constants";
import { dateTR } from "@/lib/format";
import { invoiceSourceLabel } from "@/lib/import-labels";
import { SHARED_LABEL, UNASSIGNED_LABEL } from "@/lib/invoice-branch";
import {
  autoSendMonth,
  buildPackageWorkbook,
  PACKAGE_SETTINGS_KEY,
  packageFileName,
  packageSummary,
  parsePackageSettings,
  type PackageData,
  type PackageSettings,
} from "@/lib/muhasebe/paket";
import { logActivity } from "@/server/actions/log";
import { branchWhere, branchWhereWithShared, withBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { loadClosedPeriods } from "@/server/closed-period";
import { invoiceScopeWhere } from "@/server/invoice-scope";
import { loadModel } from "@/server/data/dataset";
import { getDb, schema as s, type DB } from "@/server/db";
import { sendableRecipients } from "@/server/notify/recipients";
import { renderPackageMail } from "@/server/notify/muhasebe-template";
import { isEmailConfigured, resolveFrom, sendEmail, sendFailureText, type SendOptions } from "@/server/notify/resend";
import { loadNotifySettings } from "@/server/notify/settings";

/*
 * Muhasebeci paketi (docs/MUHASEBE-PAKETI.md): ayın verisini toplar, .xlsx'i kurar (src/lib/muhasebe/paket.ts) ve
 * muhasebeci alıcılarına ekli e-postayla gönderir. Ayarlar integration_state'te ("muhasebe.paket").
 */

type Reader = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

export async function loadPackageSettings(db: Reader = getDb()): Promise<PackageSettings> {
  const [row] = await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, PACKAGE_SETTINGS_KEY)).limit(1);
  return parsePackageSettings(row?.value);
}

export async function savePackageSettings(db: Reader, value: PackageSettings): Promise<void> {
  await db
    .insert(s.integrationState)
    .values({ key: PACKAGE_SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
}

const PAYMENT: Record<string, string> = { nakit: "Nakit", kart: "Kart", havale: "Havale", diger: "Diğer", cek: "Çek" };
const DOCUMENT: Record<string, string> = { fis: "Fiş", e_arsiv: "e-Arşiv", fatura: "Fatura", yok: "Belgesiz" };

/**
 * Ayın paketi: `scope` verilmezse bütün şubeler (muhasebe şirketindir; aylık e-posta hep böyle). Elle indirmede şube
 * seçiliyken o şubenin paketi (şube ayrımı parça 6; `?sube=`): şubenin kasa raporları, şubeye seçilmiş faturalar,
 * şubenin harcamaları ve sabit giderleri; işletme geneli fatura, harcama ve sabit gider İşletme geneli giderler alanının
 * kipiyle ("Tutarla göster"de "İşletme geneli" şube sütunuyla, "Yalnız not"ta yok). Şubenin paketinde KDV yok (KDV
 * sütunları, KDV özeti, Z KDV dökümü): vergi şubeye bölünmez (sahibin kararı 27 Kasım 2026; `branchFile`). Faturalar
 * ve harcamalar dönem kapanışının hesap gününe göre: belgesi bu aydaki ve bu ayda sayılanlar; kapalı döneme düşüp karar
 * bekleyen ve başka aya alınan kayıt notuyla listelenir, toplama girmez (packageSummary). Kasa raporları ve yazarkasa KDV
 * dökümü ayın günleri, sabit giderler modelin ayı.
 */
export async function loadPackageData(month: string, now = new Date(), scope: BranchScope = ALL_BRANCHES): Promise<PackageData> {
  const db = getDb();
  const from = `${month}-01`;
  const to = monthLastDay(month);
  // Şubenin paketinde modelin veri kümesi İşletme geneli giderler alanının kipini taşır (sharedCostsHidden)
  const model = await loadModel({ scope });
  const sharedShown = scope === ALL_BRANCHES || !model.ds.sharedCostsHidden;
  const [periods, branches, invoices, expenses, reports] = await Promise.all([
    loadClosedPeriods(db),
    listBranches(),
    db
      .select()
      .from(s.invoices)
      .where(
        and(
          or(and(gte(s.invoices.date, from), lte(s.invoices.date, to)), and(gte(s.invoices.periodDate, from), lte(s.invoices.periodDate, to))),
          sharedShown ? invoiceScopeWhere(scope) : branchWhere(s.invoices.branchId, scope),
        ),
      )
      .orderBy(asc(s.invoices.date), asc(s.invoices.id)),
    db
      .select({ e: s.expenseEntries, category: s.expenseCategories.name, docType: s.cashOuts.docType })
      .from(s.expenseEntries)
      .leftJoin(s.expenseCategories, eq(s.expenseCategories.id, s.expenseEntries.categoryId))
      .leftJoin(s.cashOuts, eq(s.cashOuts.id, s.expenseEntries.cashOutId))
      .where(
        and(
          or(and(gte(s.expenseEntries.date, from), lte(s.expenseEntries.date, to)), and(gte(s.expenseEntries.periodDate, from), lte(s.expenseEntries.periodDate, to))),
          sharedShown ? branchWhereWithShared(s.expenseEntries.branchId, scope) : branchWhere(s.expenseEntries.branchId, scope),
        ),
      )
      .orderBy(asc(s.expenseEntries.date), asc(s.expenseEntries.id)),
    db
      .select()
      .from(s.cashReports)
      .where(and(gte(s.cashReports.date, from), lte(s.cashReports.date, to), branchWhere(s.cashReports.branchId, scope)))
      .orderBy(asc(s.cashReports.date), asc(s.cashReports.branchId)),
  ]);
  const branchName = (id: string | null | undefined) => (id ? (branches.find((b) => b.id === id)?.name ?? id) : null);
  const closed = periods.months[month] ?? null;
  /** Dönem notu ve hesap günü: bekleyen kaydın hesap günü belgesininki (toplama girmez, `held`) */
  const periodOf = (r: { date: string; createdAt: Date; periodDate: string | null }) => {
    const st = periodStateOf(r, periods);
    const acct = accountDate(r, periods);
    if (st.kind === "held") return { accountDate: r.date, held: true, status: `${monthTitle(st.month)} kapalı döneme düştü, karar bekliyor (toplama girmedi)` };
    if (acct && acct !== r.date) {
      return acct.slice(0, 7) === month
        ? { accountDate: acct, held: false, status: `Belge ${monthTitle(r.date.slice(0, 7))} tarihli; ${dateTR(acct)} gününde bu aya alındı` }
        : { accountDate: acct, held: false, status: `${dateTR(acct)} gününde sayılır (${monthTitle(acct.slice(0, 7))}); bu ayın toplamına girmedi` };
    }
    return { accountDate: acct ?? r.date, held: false, status: st.kind === "accepted" ? "Kapalı aya sonradan işlendi" : null };
  };
  const fixedInMonth = model.fixedInMonth(month);
  return {
    month,
    scope: scope === ALL_BRANCHES ? "Bütün şubeler" : branchScopeLabel(scope, branches),
    ...(scope === ALL_BRANCHES ? {} : { branchFile: true }),
    createdAt: now,
    closed: closed ? { at: closed.at, by: closed.by } : null,
    invoices: invoices.map((i) => {
      const p = periodOf(i);
      return {
        date: i.date,
        accountDate: p.accountDate,
        held: p.held,
        supplier: i.supplier,
        taxNumber: i.supplierTaxNumber,
        invoiceNo: i.invoiceNo,
        category: i.category,
        amount: i.amount,
        discount: i.discount,
        vat: i.vat,
        payable: i.payable,
        unpaid: i.unpaid,
        branch: i.companyWide ? SHARED_LABEL : (branchName(i.branchId) ?? UNASSIGNED_LABEL),
        source: invoiceSourceLabel(i.source) ?? "",
        status: p.status,
      };
    }),
    expenses: expenses.map(({ e, category, docType }) => {
      const p = periodOf(e);
      return {
        date: e.date,
        accountDate: p.accountDate,
        held: p.held,
        category: category ?? "",
        description: e.description,
        amount: e.amount,
        vat: e.vat,
        payment: e.paymentMethod ? (PAYMENT[e.paymentMethod] ?? e.paymentMethod) : null,
        document: docType ? (DOCUMENT[docType] ?? docType) : null,
        branch: branchName(e.branchId) ?? SHARED_LABEL,
        status: p.status,
      };
    }),
    cash: reports.map((r) => ({
      date: r.date,
      branch: branchName(r.branchId) ?? "",
      zNo: r.zNo,
      zTotal: r.zTotal,
      cash: r.cash,
      card: r.card,
      mealCard: r.mealCard,
      online: r.online,
      other: r.other,
      cashOut: r.cashOut,
      cashDiff: r.cashDiff,
      okcZNo: r.okcZNo,
      okcTotal: r.okcTotal,
      okcVat: r.okcVatTotal,
    })),
    // Z KDV dökümü yalnız bütün şubelerin paketinde (vergi şubeye bölünmez)
    vat: (scope === ALL_BRANCHES ? reports : []).flatMap((r) =>
      (r.okcVat ?? []).map((v) => ({ date: r.date, branch: branchName(r.branchId) ?? "", zNo: r.okcZNo, rate: v.rate, total: v.total, vat: v.vat })),
    ),
    fixed: fixedInMonth.map((f) => ({
      name: f.name,
      section: FIXED_SECTIONS.find((x) => x.key === f.section)?.label ?? f.section,
      amount: f.amount,
      period: FIXED_PERIODS.find((x) => x.key === f.period)?.label ?? f.period,
      monthly: fixedMonthly(f, model.settings),
      branch: branchName(f.branchId) ?? SHARED_LABEL,
      note: f.note ?? null,
    })),
  };
}

/** Ayın paketi .xlsx olarak (indirme ve e-postanın eki); `scope` şubenin paketi (elle indirme), verilmezse bütün şubeler */
export async function packageFile(month: string, now = new Date(), scope: BranchScope = ALL_BRANCHES): Promise<{ data: PackageData; bytes: Uint8Array; filename: string }> {
  const data = await loadPackageData(month, now, scope);
  const buffer = await buildPackageWorkbook(data).xlsx.writeBuffer();
  return { data, bytes: new Uint8Array(buffer as ArrayBuffer), filename: packageFileName(month, scope === ALL_BRANCHES ? null : scope) };
}

export type PackageSendResult =
  | { status: "sent"; month: string; to: string[]; dropped: string[] }
  | { status: "skip"; reason: "day" | "off" | "norecipient" | "sent" | "nokey" }
  | { status: "error"; error: string };

/**
 * Paketi muhasebeci alıcılarına ekli e-postayla gönderir. `trigger` "cron": yalnız gönderim günüyse (autoSendMonth) ve
 * o ay kendiliğinden gönderilmediyse; aynı ayın anahtarıyla (Resend ikinci gönderimi yutar). "manual": istenen ay, her
 * basışta yeniden. Personel, müdür ya da pasif hesabın adresi düşer (sabah e-postasıyla aynı kural). Son gönderim ayara
 * yazılır.
 */
export async function sendAccountingPackage(
  o: { trigger: "cron"; today: string; opts?: SendOptions } | { trigger: "manual"; month: string; by: { id?: number; name: string }; opts?: SendOptions },
): Promise<PackageSendResult> {
  const db = getDb();
  const settings = await loadPackageSettings(db);
  let month: string;
  if (o.trigger === "cron") {
    const plan = autoSendMonth(o.today, settings);
    if ("skip" in plan) return { status: "skip", reason: plan.skip };
    month = plan.month;
  } else {
    month = o.month;
    if (!settings.recipients.length) return { status: "error", error: "Muhasebeci adresi yok; önce Ayarlar › Muhasebeci paketi'nde adres yazın" };
  }
  if (!isEmailConfigured()) return o.trigger === "cron" ? { status: "skip", reason: "nokey" } : { status: "error", error: "E-posta kurulmadı (RESEND_API_KEY)" };
  const { to, dropped } = await sendableRecipients(db, settings.recipients);
  if (!to.length) return { status: "error", error: "Muhasebeci adreslerinin hepsi personel, müdür ya da pasif hesaba ait; e-posta gitmedi" };
  const now = new Date();
  // Aylık e-posta firmanın (alıcı muhasebe şirketi): seçiciden ve kişinin şube görünümünden bağımsız, bütün şubeler
  // şube-ayrımı: muhasebe.paket-eposta
  const [file, notify] = await Promise.all([withBranchScope(ALL_BRANCHES, () => packageFile(month, now)), loadNotifySettings()]);
  const msg = renderPackageMail(file.data, packageSummary(file.data), { auto: o.trigger === "cron" });
  const res = await sendEmail(
    {
      from: resolveFrom(notify.from),
      to,
      ...msg,
      attachments: [{ filename: file.filename, content: file.bytes, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }],
      ...(o.trigger === "cron" ? { idempotencyKey: `muhasebe-paket-${month}` } : {}),
    },
    o.opts,
  );
  if (!res.ok) {
    const error = sendFailureText(res);
    await logActivity(o.trigger === "cron" ? null : o.by, "Muhasebe paketi gönderilemedi", `${monthTitle(month)} · ${error}`);
    return { status: "error", error };
  }
  const by = o.trigger === "cron" ? "Günlük iş" : o.by.name;
  // Ayar okunduktan sonra değişmiş olabilir (alıcılar): yalnız gönderim alanları yeniden okunan kayda yazılır
  const latest = await loadPackageSettings(db);
  await savePackageSettings(db, { ...latest, last: { month, at: now.toISOString(), to, by }, ...(o.trigger === "cron" ? { autoMonth: month } : {}) });
  await logActivity(o.trigger === "cron" ? null : o.by, "Muhasebe paketi gönderildi", `${monthTitle(month)} → ${to.join(", ")}${dropped.length ? ` (gitmeyen: ${dropped.map((d) => d.email).join(", ")})` : ""}`);
  return { status: "sent", month, to, dropped: dropped.map((d) => d.email) };
}

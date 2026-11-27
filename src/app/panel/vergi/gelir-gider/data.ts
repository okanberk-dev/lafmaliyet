import { shiftMonth } from "@/lib/calc/engine";
import type { ExpenseEntry, FixedExpense, Invoice } from "@/lib/calc/types";
import { FIXED_SECTIONS, fixedVatRate, SEPARATE_CATEGORIES } from "@/lib/constants";
import { dateTR, money, monthLabel, num, tl } from "@/lib/format";
import { invoiceInScope } from "@/lib/invoice-branch";
import { periodQuarters, quarterLabel, yearOptions } from "@/lib/tax/calendar";
import type { TaxFiling } from "@/lib/tax/corporate";
import { ALP_KOC_NOTE, type TaxAdjustment } from "@/lib/tax/pnl";
import { PART_TIME_NOTE, rulesFor, taxDocOptions, withholdingGrossHint, WITHHOLDINGS } from "@/lib/tax/rules";
import type { TaxSettings } from "@/lib/tax/settings";
import type { TaxView } from "@/lib/tax/view";
import { unreachable } from "@/lib/unreachable";

import type { AdjustmentChoices, AdjustmentRow } from "../adjustment-dialog";
import type { InvoiceChoice } from "../asset-dialog";
import type { ClassifyData, ClassifyItem } from "./classify-list";

/*
 * Vergiye göre'nin istemci verisi (plan docs/planlar/vergi.md §4.2): sınıflandırma listesi, düzeltmelerin seçenekleri.
 * Sunucuda kurulur; istemciye düz veri gider.
 */

const SECTION_LABEL: Record<string, string> = { ...Object.fromEntries(FIXED_SECTIONS.map((s) => [s.key, s.label])), mal: "Mal alışları" };
const SECTION_ORDER = ["kira", "genel", "personel", "faturalar", "mal"];

export const SEPARATE_NOTE = "Kafe dışı geliri de girin; yalnız gider girmek vergiyi düşük gösterir.";

export function classifyData(view: TaxView, ctx: { invoices: readonly Invoice[]; settings: TaxSettings; choices: InvoiceChoice[]; today: string }): ClassifyData {
  const { year } = view;
  const inYear = (d: string) => d.startsWith(`${year}-`) && d >= ctx.settings.periodStart;
  const items: ClassifyItem[] = [];
  const targets = [...view.classify.targets].sort((a, b) =>
    a.source === "fixed" && b.source === "fixed" ? SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) : 0,
  );
  for (const t of targets) {
    const counted = t.doc === "belgeli";
    const options = taxDocOptions(t.section)
      .filter((o) => t.source !== "category" || o.value !== "bordro")
      .map((o) => ({ value: o.value ?? "", label: o.label }));
    items.push({
      key: t.key,
      source: t.source,
      id: t.id,
      name: t.name,
      sectionLabel: t.source === "fixed" ? (SECTION_LABEL[t.section] ?? null) : null,
      detail: `${year}: ${tl(t.total)} · ${counted ? "vergide sayılıyor" : t.doc === null ? "seçilmedi, sayılmıyor" : "burada sayılmıyor"}`,
      doc: t.doc ?? "",
      options,
      withholdingFor: t.source !== "fixed" ? null : t.section === "kira" || t.section === "genel" ? "always" : t.section === "personel" ? "belgeli" : null,
      withholding: t.withholding,
      vat: t.source === "fixed" ? fixedVatRate({ section: t.section as Exclude<typeof t.section, "mal">, vatRate: t.vatRate }) : 0,
      note: t.partTime ? PART_TIME_NOTE : null,
      idle: t.total === 0 && t.doc === null && t.source !== "fixed",
    });
  }
  // Demirbaş adayları ve "Gider (demirbaş değil)" denenler (karar geri alınabilsin)
  const candidateInvoices = [
    ...view.classify.candidates.map((c) => ({ inv: c.invoice, net: c.net })),
    ...ctx.invoices.filter((i) => i.taxNotAsset && inYear(i.date)).map((i) => ({ inv: i, net: Math.round((i.amount - i.discount) * 100) / 100 })),
  ].sort((a, b) => a.inv.date.localeCompare(b.inv.date) || a.inv.id - b.inv.id);
  for (const { inv, net } of candidateInvoices) {
    items.push({
      key: `invoice:${inv.id}`,
      source: "invoice",
      id: inv.id,
      name: inv.supplier,
      sectionLabel: null,
      detail: `${dateTR(inv.date)} · ${inv.category} · ${money(net)} (KDV hariç)`,
      doc: inv.taxNotAsset ? "gider" : "",
      options: [
        { value: "", label: "Seçilmedi" },
        { value: "gider", label: "Gider (demirbaş değil)" },
      ],
      withholdingFor: null,
      withholding: null,
      vat: 0,
      note: null,
      idle: false,
    });
  }
  return {
    items,
    noDocText: view.classify.noDoc.text,
    entries: view.classify.excluded.filter((x) => x.source === "entry").map((x) => ({ key: x.key, name: x.name, amount: x.raw, note: x.note ?? null })),
    unlisted: view.classify.unlisted.map((u) => ({ id: u.invoiceId, supplier: u.supplier, date: u.date, dateText: dateTR(u.date), remaining: u.remaining })),
    separate: ctx.invoices
      .filter((i) => SEPARATE_CATEGORIES.includes(i.category) && inYear(i.date))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
      .map((i) => ({ id: i.id, label: `${i.supplier} · ${i.category} · ${dateTR(i.date)}`, net: Math.round((i.amount - i.discount) * 100) / 100, note: i.category === "Alp Koç" ? ALP_KOC_NOTE : null })),
    includeSeparate: ctx.settings.includeSeparate,
    separateNote: SEPARATE_NOTE,
    invoices: ctx.choices,
    directLimit: rulesFor(year).rules.vuk.dogrudanGider.value,
    grossHints: Object.fromEntries(
      WITHHOLDINGS.flatMap((w) => {
        const hint = withholdingGrossHint(w, rulesFor(year, ctx.settings.overrides).rules);
        return hint ? [[w, hint]] : [];
      }),
    ),
    today: ctx.today,
  };
}

/**
 * Eksik belgelerin şube kipi (şube ayrımı parça 5, docs/SUBE.md › Şube ayrımı › Alanlar): faturalar (demirbaş adayı,
 * listede olmayan demirbaş, kafe dışı, bağlanacak fatura seçenekleri) şubenin ve işletme genelinin; sabit gider ve
 * harcama şubenin ve işletme genelinin (şubesi boş). Kategori ve Gelir-gider'in elle satırları işletmenin, kalır. Öbür
 * şubenin ve şubesi seçilmemiş faturanın kalemi listeden çıkar, sayısı `scopeNote`'ta. Kapsam "Tümü" ise olduğu gibi
 */
export function scopeClassify(
  data: ClassifyData,
  branch: string,
  refs: { invoices: readonly Pick<Invoice, "id" | "branchId" | "companyWide">[]; fixed: readonly Pick<FixedExpense, "id" | "branchId">[]; entries: readonly Pick<ExpenseEntry, "id" | "branchId">[] },
): ClassifyData {
  const inv = new Map(refs.invoices.map((i) => [i.id, i]));
  const fixed = new Map(refs.fixed.map((f) => [f.id, f.branchId ?? null]));
  const entry = new Map(refs.entries.map((e) => [e.id, e.branchId ?? null]));
  const invoiceOk = (id: number | null) => {
    const i = id === null ? undefined : inv.get(id);
    return i !== undefined && invoiceInScope(i, branch);
  };
  const ownerOk = (owner: string | null | undefined) => owner === undefined || owner === null || owner === branch;
  let hidden = 0;
  const keep = <T>(xs: readonly T[], ok: (x: T) => boolean): T[] =>
    xs.filter((x) => {
      const y = ok(x);
      if (!y) hidden++;
      return y;
    });
  const itemOk = (it: ClassifyItem): boolean => {
    switch (it.source) {
      case "invoice":
        return invoiceOk(it.id);
      case "fixed":
        return ownerOk(it.id === null ? null : fixed.get(it.id));
      case "category":
      case "manual":
        return true;
      default:
        return unreachable(it.source);
    }
  };
  const items = keep(data.items, itemOk);
  const entries = keep(data.entries, (e) => ownerOk(entry.get(Number(e.key.split(":")[1]))));
  const unlisted = keep(data.unlisted, (u) => invoiceOk(u.id));
  const separate = keep(data.separate, (x) => invoiceOk(x.id));
  return {
    ...data,
    items,
    entries,
    unlisted,
    separate,
    invoices: data.invoices.filter((c) => invoiceOk(c.id)),
    scopeNote: hidden ? `${num(hidden)} kalem öbür şubelerde ya da şubesi seçilmemiş: Tümü'de ya da firma geneli görünümde.` : null,
  };
}

/** Düzeltme penceresinin seçenekleri: hesap dönemindeki aylar (bu aya kadar) ve bitmiş çeyrekler */
export function adjustmentChoices(today: string, settings: TaxSettings, filings: readonly TaxFiling[]): AdjustmentChoices {
  const cur = today.slice(0, 7);
  const months: AdjustmentChoices["months"] = [];
  for (let m = cur; m >= settings.periodStart.slice(0, 7); m = shiftMonth(m, -1)) months.push({ value: m, label: monthLabel(m) });
  const quarters = yearOptions(today, settings)
    .flatMap((y) => periodQuarters(y, settings))
    .filter((q) => q.to.slice(0, 7) <= cur)
    .reverse()
    .map((q) => ({ value: q.to.slice(0, 7), label: quarterLabel(q.key), key: q.key }));
  return {
    months,
    quarters,
    filedQuarters: filings.filter((f) => f.kind === "gecici").map((f) => f.period),
    matrahMonths: filings.filter((f) => f.kind === "kdv_matrah").map((f) => f.period),
  };
}

export function adjustmentRows(adjustments: readonly TaxAdjustment[], year: number): AdjustmentRow[] {
  return adjustments
    .filter((a) => a.month.startsWith(`${year}-`))
    .sort((a, b) => b.month.localeCompare(a.month) || b.id - a.id)
    .map((a) => ({ id: a.id, month: a.month, span: a.span, kind: a.kind, amount: a.amount, label: a.label, note: a.note ?? null }));
}

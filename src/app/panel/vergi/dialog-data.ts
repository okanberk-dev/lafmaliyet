import { shiftMonth } from "@/lib/calc/engine";
import type { Invoice } from "@/lib/calc/types";
import { SEPARATE_CATEGORIES } from "@/lib/constants";
import { dateTR, money, monthLabel, num } from "@/lib/format";
import { dayMonthTR, type ReminderRow } from "@/lib/reminders";
import { invoiceRemaining, type TaxAsset } from "@/lib/tax/assets";
import { periodOf, periodQuarters, quarterLabel, yearOptions } from "@/lib/tax/calendar";
import { filingFor, type TaxFiling, type TaxFilingKind } from "@/lib/tax/corporate";
import { filingPeriodRefusal, filingReminders } from "@/lib/tax/edit";
import type { MuhtasarMonth } from "@/lib/tax/muhtasar";
import type { PayrollMonth } from "@/lib/tax/payroll";
import { r2 } from "@/lib/tax/rules";
import type { TaxSettings } from "@/lib/tax/settings";
import { geciciStamp, kvStamps, muhtasarStamp } from "@/lib/tax/stamp";

import type { FilingKindData, FilingOption } from "./filing-dialog";
import type { InvoiceChoice } from "./asset-dialog";
import type { PayrollSheetMonth } from "./payroll-sheet";

/*
 * Pencerelerin verisi sunucuda kurulur (plan docs/planlar/vergi.md §4.5): muhasebeci kaydının dönemleri, kayıtlı
 * değerleri, damganın dolu gelen tutarı ve Ödemeler'deki karşılığı; bordro dökümünün ayları; varlık penceresinin fatura
 * seçenekleri. İstemciye yalnız düz veri gider.
 */

/** Muhtasar ve KDV beyannamesi satışları: son 12 ay (§4.5-a) */
const FILING_MONTHS = 12;

const PRESET_OF: Record<TaxFilingKind, string | null> = { gecici: "gecici", kv: "kv", mphb: "muhtasar", kdv_matrah: null };

function periodsOf(kind: TaxFilingKind, today: string, settings: Pick<TaxSettings, "periodStart">): { period: string; label: string }[] {
  const ok = (p: string) => filingPeriodRefusal(kind, p, settings, today) === null;
  switch (kind) {
    case "gecici":
      return yearOptions(today, settings)
        .flatMap((y) => periodQuarters(y, settings).map((q) => q.key))
        .filter(ok)
        .reverse()
        .map((p) => ({ period: p, label: quarterLabel(p) }));
    case "kv":
      return yearOptions(today, settings)
        .filter((y) => periodOf(y, settings))
        .map(String)
        .filter(ok)
        .reverse()
        .map((p) => ({ period: p, label: p }));
    case "mphb":
    case "kdv_matrah": {
      const out: { period: string; label: string }[] = [];
      for (let i = 0, m = today.slice(0, 7); i < FILING_MONTHS; i++, m = shiftMonth(m, -1)) {
        if (m < settings.periodStart.slice(0, 7)) break;
        if (ok(m)) out.push({ period: m, label: monthLabel(m) });
      }
      return out;
    }
  }
}

function stampOf(kind: TaxFilingKind, period: string, settings: Pick<TaxSettings, "overrides">, muhtasar: readonly MuhtasarMonth[]): number {
  switch (kind) {
    case "gecici":
      return geciciStamp(period, settings.overrides).amount;
    case "kv":
      return kvStamps(Number(period), settings.overrides).total;
    case "mphb": {
      const m = muhtasar.find((x) => x.period === period);
      return m && m.damga > 0 ? m.damga : muhtasarStamp(period, true, false, settings.overrides).amount;
    }
    case "kdv_matrah":
      return 0;
  }
}

function reminderOf(kind: TaxFilingKind, period: string, reminders: readonly ReminderRow[]): FilingOption["reminder"] {
  if (kind === "kdv_matrah") return null;
  const hits = filingReminders(reminders, kind, period);
  if (hits.length === 1) {
    const r = hits[0];
    return { state: "tek", text: `Ödemeler'de: ${r.title} · ${dayMonthTR(r.dueDate)} · ${r.amount !== null ? money(r.amount) : "tutar yok"}` };
  }
  if (hits.length > 1) return { state: "birden_cok", text: "Ödemeler'de birden çok karşılığı var; kaydedince tutarı hatırlatıcıya elle yazın." };
  return { state: "yok", text: "Ödemeler'de karşılığı yok" };
}

/**
 * Muhasebecinin rakamı penceresinin verisi: türün dönemleri (geçici: hesap dönemindeki başlamış çeyrekler; kurumlar:
 * yıllar; muhtasar ve KDV satışları: son 12 ay), kayıtlı değerler ve Ödemeler'deki karşılık (`reminders` null ise
 * bilinmiyor: KDV satışlarında karşılık yoktur)
 */
export function filingKindData(
  kind: TaxFilingKind,
  ctx: { today: string; settings: TaxSettings; filings: readonly TaxFiling[]; reminders: readonly ReminderRow[] | null; muhtasar?: readonly MuhtasarMonth[] },
): FilingKindData {
  const options: FilingOption[] = periodsOf(kind, ctx.today, ctx.settings).map(({ period, label }) => {
    const f = filingFor(ctx.filings, kind, period);
    const values: Record<string, number> = {};
    if (f) for (const [k, v] of Object.entries(f.values)) if (typeof v === "number") values[k] = v;
    const preset = PRESET_OF[kind];
    return {
      period,
      label,
      filing: f ? { id: f.id, payable: f.payable, stamp: f.stamp, values, note: f.note ?? null, by: f.enteredByName ?? null } : null,
      defaultStamp: stampOf(kind, period, ctx.settings, ctx.muhtasar ?? []),
      reminder: ctx.reminders ? reminderOf(kind, period, ctx.reminders) : null,
      addHref: preset ? `/panel/hatirlaticilar?yeni=${preset}` : null,
    };
  });
  return { kind, options };
}

/** Bordro dökümünün ayları (§4.5-e): personeli olan aylar, yeni ay önce */
export function payrollSheetMonths(payroll: Iterable<PayrollMonth>): PayrollSheetMonth[] {
  const out: PayrollSheetMonth[] = [];
  for (const p of payroll) {
    if (!p.totals.people) continue;
    const sum = (f: (x: PayrollMonth["people"][number]) => number) => r2(p.people.reduce((a, x) => a + f(x), 0));
    out.push({
      month: p.month,
      label: monthLabel(p.month),
      people: p.people.map((x) => ({
        name: x.name,
        values: {
          net: x.net,
          gross: x.gross,
          isciSgk: x.isciSgk,
          isciIssizlik: x.isciIssizlik,
          gvMatrah: x.gvMatrah,
          cumBase: x.cumBase,
          gvHesap: x.gvHesap,
          gvIstisna: x.gvIstisna,
          gv: x.gv,
          dv: x.dv,
          isverenSgk: x.isverenSgk,
          isverenIssizlik: x.isverenIssizlik,
          extras: x.extras,
          cost: x.cost,
        },
      })),
      total: {
        net: p.totals.net,
        gross: p.totals.gross,
        isciSgk: p.totals.isciSgk,
        isciIssizlik: p.totals.isciIssizlik,
        gvMatrah: sum((x) => x.gvMatrah),
        cumBase: sum((x) => x.cumBase),
        gvHesap: sum((x) => x.gvHesap),
        gvIstisna: sum((x) => x.gvIstisna),
        gv: p.totals.gv,
        dv: p.totals.dv,
        isverenSgk: p.totals.isverenSgk,
        isverenIssizlik: p.totals.isverenIssizlik,
        extras: p.totals.extras,
        cost: p.totals.cost,
      },
      support: p.totals.support,
      rates: `İşçi %${pctText(p.rates.isciSgk)} + %${pctText(p.rates.isciIssizlik)}; işveren %${pctText(p.rates.isverenSgk)} + %${pctText(p.rates.isverenIssizlik)}`,
    });
  }
  return out.sort((a, b) => b.month.localeCompare(a.month));
}

const pctText = (x: number) => (Math.round(x * 10_000) / 100).toLocaleString("tr-TR");

/**
 * Varlık penceresinin fatura seçenekleri (§4.5-c): son 18 ayın kafe faturaları (kafe dışı değil), "Tedarikçi · tarih ·
 * net · kalan", yeni önce. Kalanı olmayan fatura yalnız bu varlığa bağlıysa listede kalır
 */
export function invoiceChoices(invoices: readonly Invoice[], assets: readonly TaxAsset[], today: string): InvoiceChoice[] {
  const from = `${shiftMonth(today.slice(0, 7), -18)}-01`;
  return invoices
    .filter((i) => i.date >= from && !SEPARATE_CATEGORIES.includes(i.category))
    .map((i) => {
      const net = r2(i.amount - i.discount);
      const linked = assets.filter((a) => a.invoiceId === i.id).map((a) => ({ id: a.id, cost: a.cost }));
      return {
        id: i.id,
        supplier: i.supplier,
        date: i.date,
        category: i.category,
        net,
        // Varlığa bağlı tutarlar düşülmüş kalan; düzenlenen varlığın kendi maliyeti pencerede geri eklenir
        remaining: invoiceRemaining(i, assets),
        linked,
        label: `${i.supplier} · ${dateTR(i.date)} · ${num(net, 2, 2)}`,
      };
    })
    .filter((c) => c.remaining > 0.005 || c.linked.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

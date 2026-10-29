import { monthName } from "@/lib/tax/calendar";
import { r2 } from "@/lib/tax/rules";
import type { TaxMonth, TaxRow } from "@/lib/tax/pnl";
import type { QuarterView } from "@/lib/tax/view";

/*
 * Vergiye göre tablosunun satırları ve sütunları (plan docs/planlar/vergi.md §4.2): seçilen çeyreğin ayları, "Çeyrek
 * toplamı" ve "Kümülatif (yılbaşından)". Masaüstü tablosu ve telefonun tek kartı aynı veriyi çizer. Saf.
 */

export interface GridCol {
  key: string;
  label: string;
  /** "bugüne kadar" (süren ay) */
  sub: string | null;
}

export interface GridRow {
  key: string;
  label: string;
  /** Esas rozeti: "fatura tarihi", "mali belge · beyanname", "Yönetim verisi (ModPOS), mali belge değil" … */
  badge: string | null;
  /** Ayların notları ("Ekim: 16 gün") */
  note: string | null;
  /** Sütun başına tutar; satırın o sütunda değeri yoksa null */
  values: (number | null)[];
  /** Sütun başına döküm (kategori kategori, SMM'nin parçaları …) */
  items: { label: string; amount: number }[][];
  strong?: boolean;
  tone?: "bad";
}

export interface GridGroup {
  key: "gelir" | "gider" | "sonuc";
  label: string;
  rows: GridRow[];
}

export interface GridData {
  columns: GridCol[];
  groups: GridGroup[];
}

const sum = (xs: readonly number[]) => r2(xs.reduce((a, b) => a + b, 0));

/** Kalemleri adına göre toplar (çeyrek ve kümülatif sütun) */
function mergeItems(lists: readonly (readonly { label: string; amount: number }[])[]): { label: string; amount: number }[] {
  const out = new Map<string, number>();
  for (const l of lists) for (const x of l) out.set(x.label, r2((out.get(x.label) ?? 0) + x.amount));
  return [...out].map(([label, amount]) => ({ label, amount }));
}

/** Gelir ya da gider satırları: aylarda görülen her satır (anahtar + ad), sütunlarıyla */
function rowsOf(pick: (m: TaxMonth) => readonly TaxRow[], qMonths: readonly TaxMonth[], ytdMonths: readonly TaxMonth[]): GridRow[] {
  const keys: { id: string; key: string; label: string; badge: string | null }[] = [];
  for (const m of ytdMonths) {
    for (const r of pick(m)) {
      const id = `${r.key}|${r.label}`;
      if (!keys.some((k) => k.id === id)) keys.push({ id, key: r.key, label: r.label, badge: r.badge ?? null });
    }
  }
  return keys.map((k) => {
    const find = (m: TaxMonth) => pick(m).find((r) => `${r.key}|${r.label}` === k.id) ?? null;
    const monthRows = qMonths.map(find);
    const ytdRows = ytdMonths.map(find).filter((r): r is TaxRow => r !== null);
    const qRows = monthRows.filter((r): r is TaxRow => r !== null);
    // Her ayda aynı not tek kez, ayrışan notlar ay adıyla
    const raw = qMonths.map((m, i) => ({ m, note: monthRows[i]?.note ?? null })).filter((x) => x.note);
    const same = raw.length > 1 && raw.length === qRows.length && raw.every((x) => x.note === raw[0].note);
    const notes = same ? [raw[0].note!] : raw.map((x) => `${monthName(x.m.month)}: ${x.note}`);
    return {
      key: k.id,
      label: k.label,
      badge: k.badge,
      note: notes.length ? notes.join(" · ") : null,
      values: [...monthRows.map((r) => (r ? r.amount : null)), qRows.length ? sum(qRows.map((r) => r.amount)) : null, ytdRows.length ? sum(ytdRows.map((r) => r.amount)) : null],
      items: [...monthRows.map((r) => r?.items ?? []), mergeItems(qRows.map((r) => r.items ?? [])), mergeItems(ytdRows.map((r) => r.items ?? []))],
    };
  });
}

/**
 * Çeyreğin tablosu. `yearMonths`: seçilen yılın ayları (kümülatif sütun çeyreğin sonuna kadar olanları toplar). Çeyrek
 * ve kümülatif sütunda çeyrek sonu stoğu düzeltmesi ayrı satırdır (K15); amortisman, doğrudan gider, indirilemeyen
 * gider, indirim ve kurum kazancı yalnız bu iki sütunda
 */
export function quarterGrid(q: QuarterView, yearMonths: readonly TaxMonth[]): GridData {
  const qMonths = q.months;
  const lastMonth = q.totals.months.at(-1) ?? qMonths.at(-1)?.month ?? "";
  const ytdMonths = yearMonths.filter((m) => m.month <= lastMonth);
  const columns: GridCol[] = [
    ...qMonths.map((m) => ({ key: m.month, label: monthName(m.month), sub: m.inProgress ? "bugüne kadar" : null })),
    { key: "ceyrek", label: "Çeyrek toplamı", sub: q.label },
    { key: "kumulatif", label: "Kümülatif (yılbaşından)", sub: null },
  ];
  const onlyTotals = (key: string, label: string, quarter: number | null, ytd: number | null, extra: Partial<GridRow> = {}): GridRow => ({
    key,
    label,
    badge: null,
    note: null,
    values: [...qMonths.map(() => null), quarter, ytd],
    items: columns.map(() => []),
    ...extra,
  });

  const income = rowsOf((m) => m.income.rows, qMonths, ytdMonths);
  income.push({
    key: "gelir:toplam",
    label: "Gelir toplamı",
    badge: null,
    note: null,
    values: [...qMonths.map((m) => m.income.total), q.totals.income, q.ytd.income],
    items: columns.map(() => []),
    strong: true,
  });

  const expense = rowsOf((m) => m.expense.rows, qMonths, ytdMonths);
  const qStock = r2(q.totals.expense - sum(qMonths.map((m) => m.expense.total)));
  const ytdStock = r2(q.ytd.expense - sum(ytdMonths.map((m) => m.expense.total)));
  if (Math.abs(qStock) >= 0.005 || Math.abs(ytdStock) >= 0.005) {
    const used = q.totals.stock;
    expense.push(
      onlyTotals("gider:stok", "Çeyrek sonu stoğu (en son sayım)", qStock, ytdStock, {
        note: used.usedFrom ? `${monthName(used.usedFrom)} sonu sayımı kullanıldı` : "sayım yok: stok 0 sayıldı",
        tone: used.warning ? "bad" : undefined,
      }),
    );
  }
  expense.push({
    key: "gider:toplam",
    label: "Gider toplamı",
    badge: null,
    note: null,
    values: [...qMonths.map((m) => m.expense.total), q.totals.expense, q.ytd.expense],
    items: columns.map(() => []),
    strong: true,
  });

  const result: GridRow[] = [
    {
      key: "sonuc",
      label: "Sonuç (amortisman öncesi)",
      badge: null,
      note: null,
      values: [...qMonths.map((m) => m.result), q.totals.result, q.ytd.result],
      items: columns.map(() => []),
      strong: true,
    },
    onlyTotals("amortisman", `Amortisman (${q.depreciationMethod.replace(/^Amortisman: /, "")})`, -q.totals.depreciation, -q.ytd.depreciation),
  ];
  if (q.totals.direct || q.ytd.direct) result.push(onlyTotals("dogrudan", "Doğrudan gider yazılan demirbaş", -q.totals.direct, -q.ytd.direct));
  if (q.totals.kkeg || q.ytd.kkeg) result.push(onlyTotals("kkeg", "İndirilemeyen gider (eklenen)", q.totals.kkeg, q.ytd.kkeg));
  if (q.corp) {
    result.push(onlyTotals("donem", "Dönem kazancı", q.corp.periodResult, null, { strong: true }));
    result.push(
      onlyTotals("kazanc", "Kurum kazancı (kümülatif)", null, q.corp.cumulative, {
        strong: true,
        note: q.corp.anchor ? `${q.corp.anchor.period.replace("-Q", "/")} muhasebeci kaydının matrahından` : null,
      }),
    );
  }
  if (q.totals.indirim || q.ytd.indirim) result.push(onlyTotals("indirim", "İndirim (matrahtan düşülür)", -q.totals.indirim, -q.ytd.indirim));

  return {
    columns,
    groups: [
      { key: "gelir", label: "Gelir", rows: income },
      { key: "gider", label: "Gider", rows: expense },
      { key: "sonuc", label: "Sonuç", rows: result },
    ],
  };
}

import type { BreakdownGroup, BreakdownRow } from "@/lib/breakdown";
import { listDaysText, type consistency, type ConsistencyRow } from "@/lib/calc/insights";
import { num, qty, tlUnit } from "@/lib/format";

import { RATIO_GUIDE, SEVERITY, severityOf } from "./severity";

/** Sayfanın kullandığı tutarlılık hesabı (insights.consistency) */
export type ConsistencyCalc = Pick<ReturnType<typeof consistency>, "rows" | "sales">;

/** Tutarlılık'taki dört özet kartının dökümü */
export interface ConsistencyBreakdowns {
  /** Büyük fark (adet): büyük farklı malzemeler; fark var ve tutarlı olanlar toplama girmeden altta */
  severity: BreakdownGroup[];
  /** Fatura farkı: (alınan − reçeteye göre kullanılan) × birim maliyet, fazla ve az alınan ayrı */
  diff: BreakdownGroup[];
  /** Sayım sapması: (gerçek tüketim − reçeteye göre) × birim maliyet; alım girilmeli ve reçetesiz tüketim altta */
  variance: BreakdownGroup[];
  /** Satış ↔ POS: ürün listesi − indirimler − POS ciro raporu = fark */
  sales: BreakdownGroup[];
}

/** Tabloda o malzemeyi süzen bağlantı (aynı sayfa; pencere kapanır, tablo süzülür) */
export const tableHref = (month: string, name: string) => `/panel/tutarlilik?ay=${month}&ara=${encodeURIComponent(name)}#malzeme-tablosu`;

/** Miktar: gram ve mililitre tam, adet ve dilim bir ondalıkla (tablodaki gibi birimiyle) */
const amountOf = (v: number, unit: string) => qty(v, unit, unit === "gr" || unit === "ml" ? 0 : 1);

/** Oran yazısı: "2,35×"; ay içinde hiç kullanılmadığı hâlde alım varsa "Kullanım yok" */
function ratioText(r: ConsistencyRow): string {
  if (r.ratio !== null) return `${num(r.ratio, 2)}×`;
  return r.purchased !== null && r.purchased > 0 && !r.usage ? "Kullanım yok" : "–";
}

/** Bölümdeki eksi kalem varsa pay sütunu anlamsız (payda net toplam olur) */
export function hasNegative(groups: BreakdownGroup[]): boolean {
  return groups.some((g) => !g.apart && g.rows.some((r) => r.amount < 0));
}

export function consistencyBreakdowns(c: ConsistencyCalc, month: string): ConsistencyBreakdowns {
  const href = (r: ConsistencyRow) => tableHref(month, r.ingredient.name);
  const unitOf = (r: ConsistencyRow) => r.ingredient.unit;

  // ---------------------------------------------------------------- Büyük fark (adet)
  // Her malzeme 1 sayılır, yanında oranı yazar; en çok sapan en üstte (kullanılmadan alınan en başta, ne alınan ne
  // kullanılan en sonda). Eşit sırada büyük fark tutarı, sonra ad.
  const rank = (r: ConsistencyRow) => r.ratio ?? ((r.purchased ?? 0) > 0 && !r.usage ? Infinity : -Infinity);
  const severityRows = (sev: "big" | "diff" | "ok", tone: BreakdownRow["tone"]): BreakdownRow[] =>
    c.rows
      .filter((r) => severityOf(r) === sev)
      .sort(
        (a, b) =>
          (rank(a) === rank(b) ? 0 : rank(b) - rank(a)) ||
          (b.diffAmount ?? 0) - (a.diffAmount ?? 0) ||
          a.ingredient.name.localeCompare(b.ingredient.name, "tr"),
      )
      .map((r) => ({
        key: `${sev}:${r.ingredient.id}`,
        label: r.ingredient.name,
        sub: `Alınan ${amountOf(r.purchased ?? 0, unitOf(r))} · reçeteye göre ${amountOf(r.usage, unitOf(r))}`,
        amount: 1,
        display: ratioText(r),
        tone,
        href: href(r),
      }));
  const severity: BreakdownGroup[] = [
    { key: "big", label: `${SEVERITY.big.label} (${SEVERITY.big.range})`, note: `Reçete, fire ya da ikram kontrol edilmeli. ${RATIO_GUIDE.bottles}`, rows: severityRows("big", "bad") },
    { key: "diff", label: `${SEVERITY.diff.label} (${SEVERITY.diff.range})`, note: "Stok veya fire olabilir.", apart: true, rows: severityRows("diff", "warn") },
    { key: "ok", label: `${SEVERITY.ok.label} (${SEVERITY.ok.range})`, note: RATIO_GUIDE.below1, apart: true, rows: severityRows("ok", "good") },
  ];

  // ---------------------------------------------------------------- Fatura farkı (₺)
  const priced = c.rows.filter((r) => r.diffAmount !== null);
  const diffRow = (r: ConsistencyRow): BreakdownRow => ({
    key: `diff:${r.ingredient.id}`,
    label: r.ingredient.name,
    sub: `Alınan ${amountOf(r.purchased ?? 0, unitOf(r))} · reçeteye göre ${amountOf(r.usage, unitOf(r))} · ${tlUnit(r.unitCost)}/${unitOf(r)}`,
    amount: r.diffAmount ?? 0,
    href: href(r),
  });
  const diff: BreakdownGroup[] = [
    { key: "fazla", label: "Reçeteden fazla alınan", rows: priced.filter((r) => (r.diffAmount ?? 0) > 0).map(diffRow) },
    {
      key: "az",
      label: "Reçeteden az alınan",
      note: "Alınandan fazlası önceki ayın stoğundan harcanmış.",
      rows: priced.filter((r) => (r.diffAmount ?? 0) < 0).map(diffRow),
    },
  ];

  // ---------------------------------------------------------------- Sayım sapması (₺)
  const complete = c.rows.filter((r) => r.stock === "complete");
  const varianceRow = (r: ConsistencyRow): BreakdownRow => ({
    key: `var:${r.ingredient.id}`,
    label: r.ingredient.name,
    sub: `${r.inRecipe ? "" : "Reçetede yok · "}Gerçek tüketim ${amountOf(r.actualUsage ?? 0, unitOf(r))} · reçeteye göre ${amountOf(r.usage, unitOf(r))}`,
    amount: r.varianceAmount ?? 0,
    href: href(r),
  });
  const needs = c.rows.filter((r) => r.stock === "needsPurchase").sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name, "tr"));
  const held = c.rows.filter((r) => r.stock === "held").sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name, "tr"));
  // insights.consistency'deki "reçetesiz tüketim" ile aynı süzgeç ve tutar (kartın alt satırı)
  const unreciped = c.rows.filter((r) => !r.inRecipe && r.stockDrop !== null && r.stockDrop + (r.purchased ?? 0) > 0);
  const variance: BreakdownGroup[] = [
    {
      key: "fazla",
      label: "Reçeteden fazla tüketilen",
      note: "Fire, ikram, porsiyon kaçağı ya da eksik reçete.",
      rows: complete.filter((r) => (r.varianceAmount ?? 0) > 0).map(varianceRow),
    },
    { key: "az", label: "Reçeteden az tüketilen", rows: complete.filter((r) => (r.varianceAmount ?? 0) < 0).map(varianceRow) },
    {
      key: "eksik",
      label: "Alım girilmeli",
      note: "İki ayı sayılmış ama bu ayın alım miktarı girilmemiş; sapması hesaplanamaz. Bu ay alınmadıysa tabloda “Alım yok (0)”.",
      apart: true,
      display: `${num(needs.length)} malzeme`,
      rows: needs.map((r) => ({
        key: `eksik:${r.ingredient.id}`,
        label: r.ingredient.name,
        sub: `Sayım ${amountOf(r.opening ?? 0, unitOf(r))} → ${amountOf(r.closing ?? 0, unitOf(r))}`,
        amount: 0,
        display: "Alım yok",
        tone: "warn" as const,
        href: href(r),
      })),
    },
    {
      key: "onay",
      label: "Fiyat onayı bekliyor",
      note: "Bu ayın bir faturasının çarpanı onay bekliyor: o fatura alınan miktara girmedi, sapması fiyat onayı karara bağlanınca hesaplanır (Hammaddeler › Onay bekleyen fiyatlar).",
      apart: true,
      display: `${num(held.length)} malzeme`,
      rows: held.map((r) => ({
        key: `onay:${r.ingredient.id}`,
        label: r.ingredient.name,
        sub: `${num(r.held?.invoices ?? 0)} fatura alınana girmedi · sayım ${amountOf(r.opening ?? 0, unitOf(r))} → ${amountOf(r.closing ?? 0, unitOf(r))}`,
        amount: 0,
        display: "Onayda",
        tone: "warn" as const,
        href: href(r),
      })),
    },
    {
      key: "recetesiz",
      label: "Reçetesiz tüketim",
      note: "Hiçbir reçetede olmayıp stoktan düşen malzemeler, en az (devir − devreden + alınan) × birim maliyet. Alımı girilenler yukarıdaki sapmada da var; bu bölüm ayrıca eklenmez.",
      apart: true,
      rows: unreciped.map((r) => ({
        key: `recetesiz:${r.ingredient.id}`,
        label: r.ingredient.name,
        sub: `Stoktan düşen ${amountOf(r.stockDrop ?? 0, unitOf(r))}${r.purchased !== null ? ` · alınan ${amountOf(r.purchased, unitOf(r))}` : " · alım girilmemiş"}`,
        amount: ((r.stockDrop ?? 0) + (r.purchased ?? 0)) * r.unitCost,
        href: href(r),
      })),
    },
  ];

  // ---------------------------------------------------------------- Satış ↔ POS (₺)
  const s = c.sales;
  const salesHref = `/panel/satislar?ay=${month}`;
  // Liste kasa raporlarından kısa bir dönemi kapsıyorsa (süren ayda yapıştırılan liste) indirim ve POS o dönemin
  const period = s.listPeriod ? `${listDaysText(s.listPeriod)} kasa raporları` : "Satışlar > ay bilgileri";
  const sales: BreakdownGroup[] = s.hasLines
    ? [
        {
          key: "hesap",
          label: "Hesaplanan ciro",
          rows: [
            { key: "liste", label: "Ürün listesi toplamı", sub: "POS ürün listesi, indirim öncesi", amount: s.listTotal, href: `${salesHref}#satirlar` },
            { key: "indirim", label: "Yönetici indirimleri", sub: period, amount: -s.discounts, href: salesHref },
          ],
        },
        {
          key: "pos",
          label: "POS ciro raporu",
          noSubtotal: s.pos === null,
          rows: [
            s.pos === null
              ? { key: "pos", label: "POS ciro raporu", sub: "Satışlar > ay bilgileri", amount: 0, display: "Girilmedi", tone: "warn", href: salesHref }
              : { key: "pos", label: "POS ciro raporu (düşülür)", sub: period, amount: -s.pos, href: salesHref },
          ],
        },
        {
          key: "odenmez",
          label: "Ciroya girmeyen",
          note: "Satış listesine dahil değil; tahmini malzeme maliyeti Panel'deki kâra da dahil değil.",
          apart: true,
          noSubtotal: true,
          rows: [
            { key: "odenmez", label: "Ödenmez (sahip / personel tüketimi)", sub: "Satışlar > ay bilgileri", amount: s.offRevenue, href: salesHref },
            { key: "odenmez-maliyet", label: "Ödenmezlerin tahmini malzeme maliyeti", sub: "Tutar ÷ (1 + KDV) × ortalama maliyet oranı", amount: s.offRevenueCost },
          ],
        },
      ]
    : [];

  return { severity, diff, variance, sales };
}

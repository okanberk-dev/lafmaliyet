import { withRemainder, type BreakdownGroup, type BreakdownRow } from "@/lib/breakdown";
import type { PnlMonthCalc, PnlRowDef } from "@/lib/calc/engine";
import type { Role } from "@/lib/constants";
import { monthLabel, num, tl } from "@/lib/format";
import { openableHref } from "@/lib/roles";

import type { GridSection } from "./pnl-grid";

/** Büyük harfli satır adlarını ("PERSONEL MAAŞ") cümle düzenine çevirir; kısaltmalar büyük kalır */
const ACRONYMS = ["POS", "SGK", "KDV", "AVM"];
export function sentenceCase(s: string): string {
  let out = s.toLocaleLowerCase("tr-TR");
  // Kısaltmalar önce: ad bir kısaltmayla başlasa da ("KDV …") doğru kalır
  for (const a of ACRONYMS) out = out.replace(new RegExp(`(^|[^\\p{L}])${a.toLocaleLowerCase("tr-TR")}(?![\\p{L}])`, "gu"), `$1${a}`);
  return out.charAt(0).toLocaleUpperCase("tr-TR") + out.slice(1);
}

/**
 * Gelir-gider satırının görünen adı (tablo, kart dökümleri, Genel bakış'taki faturaya göre kâr): tedarikçi ve sabit
 * gider adları girildiği gibi, diğerleri cümle düzeninde. `fixedNames`: "fixed:<id>" → sabit giderin adı.
 */
export function pnlRowLabel(def: Pick<PnlRowDef, "key" | "label">, fixedNames: ReadonlyMap<string, string>): string {
  if (def.key.startsWith("purchase:")) return def.key.slice("purchase:".length);
  if (def.key.startsWith("commission:") && def.key !== "commission:pos") return `${def.key.slice("commission:".length)} komisyonu`;
  return fixedNames.get(def.key) ?? sentenceCase(def.label);
}

/** Yılın ay hesaplarından dökümün kullandıkları (online satış laffogato.net'ten; çekilmemiş ayda yok) */
export type YearMonthCalc = Pick<PnlMonthCalc, "opening" | "closing" | "cogs" | "sections" | "revenueNet"> & Partial<Pick<PnlMonthCalc, "site">>;

/** Ciro dökümünün ay hesabından kullandıkları (açık gün: Satışlar'a girilen, girilmediyse null) */
export type RevenueMonthCalc = Pick<PnlMonthCalc, "month" | "revenue" | "revenueNet"> &
  Partial<Pick<PnlMonthCalc, "site">> & { info?: { openDays: number | null } | undefined };

/** Ayın KDV hariç cirosu: ModPOS + laffogato.net online satışı */
const monthRevenue = (c: Pick<PnlMonthCalc, "revenueNet"> & Partial<Pick<PnlMonthCalc, "site">>) => (c.revenueNet ?? 0) + (c.site?.total ?? 0);

/**
 * Yıl cirosu kartının dökümü: ay ay ciro (KDV hariç; ModPOS + laffogato.net online satışı), takvim sırasıyla; aya
 * dokununca Satışlar'da o ay açılır. Kalemler kartın rakamını (cirosu girilmiş ayların KDV hariç cirosu toplamı,
 * yearTotals) tutar. Gideri, açık günü ya da online satışı olup POS cirosu girilmemiş aylar toplama girmeyen ayrı
 * bölümde. `calcs` bu aya kadarki aylar (sonrakiler sayfada kesilir). `role` bakanın rolü: Satışlar'ı açamayan role
 * (muhasebeci) aylar bağlantısızdır, "Satışlar'da ciro girilir" de denmez (src/lib/roles.ts › openableHref).
 */
export function revenueBreakdown(calcs: RevenueMonthCalc[], activeMonths: string[], role: Role = "admin"): BreakdownGroup[] {
  const days = (c: RevenueMonthCalc) => (c.info?.openDays ? `${num(c.info.openDays)} açık gün` : null);
  const link = (href: string) => {
    const open = openableHref(role, href);
    return open ? { href: open } : {};
  };
  const canEnter = openableHref(role, "/panel/satislar") !== null;
  // POS cirosu girilmemiş ay yıl toplamına girmez (yearTotals): online satışı olsa da bu bölümde, kâra girmeden
  const missing = calcs.filter((c) => c.revenueNet === null && (activeMonths.includes(c.month) || c.site));
  return [
    {
      key: "ciro",
      rows: calcs
        .filter((c) => c.revenueNet !== null)
        .map((c) => ({
          key: c.month,
          label: monthLabel(c.month),
          sub: [
            c.revenueNet !== null ? `POS cirosu ${tl(c.revenue)} (KDV dahil)` : "POS cirosu girilmedi",
            c.site ? `online ${tl(c.site.total)} (KDV hariç)` : null,
            days(c),
          ]
            .filter(Boolean)
            .join(" · "),
          amount: monthRevenue(c),
          ...link(`/panel/satislar?ay=${c.month}`),
          // Sıfır girilen ay da görünsün: cirosu girilmemiş aydan ayrı
          ...(monthRevenue(c) === 0 ? { display: tl(0) } : {}),
        })),
    },
    {
      key: "girilmedi",
      label: "Cirosu girilmemiş aylar",
      note: `Gideri, açık günü ya da online satışı var, POS cirosu yok: yıl toplamına ve kâra girmez.${canEnter ? " Aya dokununca Satışlar'da ciro girilir." : ""}`,
      apart: true,
      noSubtotal: true,
      rows: missing.map((c) => ({
        key: c.month,
        label: monthLabel(c.month),
        sub: [c.site ? `online ${tl(c.site.total)} (KDV hariç; kâra girmedi)` : null, days(c)].filter(Boolean).join(" · ") || undefined,
        amount: 0,
        display: "Girilmedi",
        tone: "warn" as const,
        ...link(`/panel/satislar?ay=${c.month}#m-pos`),
      })),
    },
  ];
}

/** Satılan mal maliyetinden sonraki gider bölümleri (tablodaki sırayla) */
const EXPENSE_SECTIONS = [
  { key: "personel", label: "Personel giderleri" },
  { key: "faturalar", label: "Faturalar" },
  { key: "kira", label: "Kira" },
  { key: "genel", label: "İşletme genel giderleri" },
  { key: "komisyon", label: "Komisyon giderleri" },
] as const;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Gelir-gider kartlarının yıl dökümü, tablonun satırlarından (yıl toplamı sütunu): giderler bölüm bölüm, satılan mal
 * maliyeti (mal alışları + stok devri) ve kâr (ciro − bölüm giderleri). Her bölüm ay hesaplarının toplamını tutar:
 * tabloda satırı olmayan bir tutar (ör. eski bir elle giriş) "Diğer" kalemi olur, döküm kartla aynı toplamı verir.
 */
export function yearBreakdowns(
  sections: GridSection[],
  calcs: YearMonthCalc[],
  /** Ayların kasası (src/lib/asilpos/kasa.ts periodKasa; geçiş günü boşken ModPOS) */
  kasa: string = "ModPOS",
): { cogs: BreakdownGroup[]; expenses: BreakdownGroup[]; profit: BreakdownGroup[] } {
  const rowsOf = (key: string): BreakdownRow[] =>
    (sections.find((s) => s.key === key)?.rows ?? [])
      .filter((r) => r.def.kind !== "total" && r.total !== null)
      .map((r) => ({ key: r.def.key, label: r.def.label, sub: r.def.sub, amount: r.total ?? 0 }));
  const cogsRows = withRemainder(
    [
      ...rowsOf("mal"),
      { key: "stock:change", label: "Stok devri", sub: "Önceki aydan devir − ay sonu stok (sayım)", amount: sum(calcs.map((c) => c.opening - c.closing)) },
    ],
    sum(calcs.map((c) => c.cogs)),
    "Diğer",
    "cogs:other",
  );
  const expenses: BreakdownGroup[] = [
    { key: "cogs", label: "Satılan mal maliyeti", rows: cogsRows },
    ...EXPENSE_SECTIONS.map(({ key, label }) => ({
      key,
      label,
      rows: withRemainder(rowsOf(key), sum(calcs.map((c) => c.sections[key])), "Diğer (tabloda ayrı satırı yok)", `${key}:other`),
    })),
  ];
  const revenueNet = sum(calcs.map((c) => c.revenueNet ?? 0));
  // laffogato.net online satışı: yalnız çekilmiş aylar (KDV hariç), ayrı gelir satırları
  const online = calcs.some((c) => c.site);
  const siteRow = (key: "cafe" | "shop" | "karaoke", label: string): BreakdownRow => ({
    key: `site:${key}`,
    label,
    sub: "laffogato.net · KDV hariç",
    amount: sum(calcs.map((c) => c.site?.[key] ?? 0)),
  });
  return {
    cogs: [{ key: "cogs", rows: cogsRows }],
    expenses,
    // Kâr: önce ciro, sonra bölüm giderleri eksi olarak, büyükten küçüğe
    profit: [
      {
        key: "gelir",
        label: "Gelir",
        rows: [
          { key: "revenueNet", label: online ? `${kasa} cirosu (KDV hariç)` : "Ciro (KDV hariç)", amount: revenueNet },
          ...(online ? [siteRow("cafe", "Kafe online (site + uygulama)"), siteRow("shop", "Mağaza (online)"), siteRow("karaoke", "Karaoke (ön ödemeli)")] : []),
        ],
      },
      {
        key: "gider",
        label: "Giderler",
        rows: expenses.map((g) => ({ key: g.key, label: g.label ?? g.key, amount: -sum(g.rows.map((r) => r.amount)) })).sort((a, b) => a.amount - b.amount),
      },
    ],
  };
}

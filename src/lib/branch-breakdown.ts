// "Tümü"nün şube kırılımı (Faz 5, sahibin kararı 4; docs/SUBE.md › Dalga 2'nin kararları): her şubenin kâr / zararı kendi
// görünümündeki gibi (işletme geneli giderler şubenin kârına girmez), fiziksel olmayan kanallara (online) yazılan giderler
// kendi sütununda, işletme geneli ayrı sütunda bir kez, Tümü ise işletmenin toplamı. Bölüştürme yok: işletme geneli sütunu
// giderlerin tamamıdır. Saf; testi tests/isletme-geneli.test.ts.

import type { PnlMonthCalc } from "./calc/engine";

/** Kırılımın ay hesabından kullandıkları */
export type BreakdownMonth = Pick<PnlMonthCalc, "revenueTotalNet" | "expenses" | "profit" | "shared"> & Partial<Pick<PnlMonthCalc, "site" | "byBranch">>;

export interface BreakdownColumn {
  key: string;
  label: string;
  /** Ciro (KDV hariç) */
  revenue: number;
  /** Mal maliyeti ve giderler */
  expenses: number;
  profit: number;
}

export interface BranchBreakdown {
  /**
   * Şubeler (verildiği sırayla), varsa "Diğer kanallar" (fiziksel olmayan kanala yazılan giderler; tek kanalsa onun adı),
   * "İşletme geneli" ve "Tümü"
   */
  columns: BreakdownColumn[];
  /**
   * Tümü − (şubeler + diğer kanallar + işletme geneli): mal maliyetinin yöntemi (Tümü sayım ve faturalardan, şube
   * satışından reçeteye göre) ve elle yazılan işletme toplamları (personel, POS komisyonu) yüzünden; yuvarlamadan büyükse
   * kırılımın altında yazılır. Hiçbir gider iki kez sayılmaz
   */
  residual: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Şube kırılımı: `branches` her şubenin kendi görünümündeki ayları (aynı aylar), `all` Tümü'nün ayları. Diğer kanallar
 * sütunu (inceleme bulgusu 5): Tümü'nün `branches`'ta olmayan şubelere (online kanal) yazdığı giderler
 * (PnlMonthCalc.byBranch); yoksa sütun yok. `names` kanalların adı (tek kanalsa sütun onun adıyla). İşletme geneli
 * sütunu: giderler Tümü'nün işletme geneli toplamı (PnlMonthCalc.shared), ciro laffogato.net online satışı (şubenin
 * değil, işletmenin cirosu; docs/SUBE.md)
 */
export function branchBreakdown(
  branches: readonly { id: string; name: string; months: readonly BreakdownMonth[] }[],
  all: readonly BreakdownMonth[],
  names: Readonly<Record<string, string>> = {},
): BranchBreakdown {
  const columns: BreakdownColumn[] = branches.map((b) => ({
    key: b.id,
    label: b.name,
    revenue: sum(b.months.map((m) => m.revenueTotalNet ?? 0)),
    expenses: sum(b.months.map((m) => m.expenses)),
    profit: sum(b.months.map((m) => m.profit)),
  }));
  const shown = new Set(branches.map((b) => b.id));
  const channels = new Map<string, number>();
  for (const m of all) {
    for (const [id, v] of Object.entries(m.byBranch ?? {})) if (!shown.has(id)) channels.set(id, (channels.get(id) ?? 0) + v);
  }
  const channelCost = sum([...channels.values()]);
  if (Math.abs(channelCost) >= 0.005) {
    const ids = [...channels.keys()];
    columns.push({ key: "kanallar", label: ids.length === 1 && names[ids[0]] ? names[ids[0]] : "Diğer kanallar", revenue: 0, expenses: channelCost, profit: -channelCost });
  }
  const online = sum(all.map((m) => m.site?.total ?? 0));
  const shared = sum(all.map((m) => m.shared.total));
  columns.push({ key: "isletme", label: "İşletme geneli", revenue: online, expenses: shared, profit: online - shared });
  const total: BreakdownColumn = {
    key: "tumu",
    label: "Tümü",
    revenue: sum(all.map((m) => m.revenueTotalNet ?? 0)),
    expenses: sum(all.map((m) => m.expenses)),
    profit: sum(all.map((m) => m.profit)),
  };
  const residual = total.profit - sum(columns.map((c) => c.profit));
  columns.push(total);
  return { columns, residual: Math.abs(residual) < 0.005 ? 0 : residual };
}

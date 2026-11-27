/**
 * Nakit planının şube kipi: "Şubenin nakit akışı" (şube ayrımı D parça 4, 27 Kasım 2026; docs/SUBE.md › Şube ayrımı,
 * docs/NAKIT-PLANI.md). Saf: plan iki kez kurulur (src/server/data/cash-plan.ts › loadAreaCashPlan):
 *
 * - **şubenin planı**: şubenin satış tahmini ve kasa devri (gelen); şubenin hatırlatıcıları, şubeye seçilmiş
 *   faturaları, personelinin maaşı, şubenin sabit giderleri ve harcamaları, mal tahmini (giden). Açılış bakiyesi yok:
 *   satır "Net akış"tır (bakiye firmanındır), vergi, KDV ve SGK satırı yok;
 * - **firmanın planı** (bugünkü): buradan yalnız işletme geneli kalemler alınır ve hafta hafta tek satırda toplanır
 *   ("İşletme geneli"): KDV, vergi ve damga, SGK, işletme geneli hatırlatıcılar, işletme geneli faturalar ve faturasız
 *   borçlar (cari). Bu satır şubenin akışına girmez (bilgi); "Tümü"de hepsi firmanın planında.
 */

import type { CashPlan, PlanLine } from "./cash-plan";

/** İşletme geneli kalemleri tanımak için: işletme geneli hatırlatıcıların ve faturaların kimlikleri */
export interface SharedPlanIds {
  reminders: ReadonlySet<number>;
  invoices: ReadonlySet<number>;
}

/** Firmanın planındaki satır işletme geneli mi (şubenin akışına girmez, İşletme geneli satırında toplanır) */
export function isSharedPlanLine(l: Pick<PlanLine, "key" | "kind" | "direction">, ids: SharedPlanIds): boolean {
  if (l.direction !== "out") return false;
  switch (l.kind) {
    case "kdv":
    case "vergi":
    case "sgk":
      return true;
    case "reminder": {
      const id = Number(/^reminder:(\d+)@/.exec(l.key)?.[1]);
      return Number.isInteger(id) && ids.reminders.has(id);
    }
    case "invoice": {
      if (l.key.startsWith("cari:")) return true;
      const id = Number(/^invoice:(\d+)$/.exec(l.key)?.[1]);
      return Number.isInteger(id) && ids.invoices.has(id);
    }
    default:
      return false;
  }
}

/** Haftanın İşletme geneli satırı: tutar ve en büyük kalemlerin adları */
export interface SharedWeek {
  index: number;
  amount: number;
  /** En büyük üç kalem ("KDV (Ekim) 42.000 ₺"); ekran kısa yazar */
  top: { title: string; amount: number }[];
  count: number;
}

export interface BranchCashFlow {
  /** Şubenin adı */
  name: string;
  /** Hafta hafta İşletme geneli satırı (firmanın planından; şubenin akışına girmez) */
  shared: SharedWeek[];
  /** Altı haftanın İşletme geneli toplamı */
  sharedTotal: number;
  /** Firmanın açılış bakiyesi (bilgi; şubenin akışında kullanılmaz). Girilmediyse null */
  firmOpening: { amount: number; date: string } | null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Şubenin akışının İşletme geneli satırları: firmanın planının haftaları şubeninkiyle aynı (aynı bugün, aynı ufuk);
 * her haftanın işletme geneli kalemleri toplanır
 */
export function branchCashFlow(company: Pick<CashPlan, "weeks" | "opening">, ids: SharedPlanIds, name: string): BranchCashFlow {
  const shared = company.weeks.map((w): SharedWeek => {
    const lines = w.lines.filter((l) => isSharedPlanLine(l, ids));
    return {
      index: w.index,
      amount: r2(lines.reduce((a, l) => a + l.amount, 0)),
      top: [...lines]
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 3)
        .map((l) => ({ title: l.title, amount: l.amount })),
      count: lines.length,
    };
  });
  return {
    name,
    shared,
    sharedTotal: r2(shared.reduce((a, w) => a + w.amount, 0)),
    firmOpening: company.opening ? { amount: company.opening.amount, date: company.opening.date } : null,
  };
}

/** Şube kipinde planın dışında tutulan tahminler: vergi, KDV ve SGK firmanın (İşletme geneli satırında) */
export const BRANCH_PLAN_EXCLUDED = ["kdv", "vergi", "sgk"] as const;

/** Şubenin akışının açıklaması (ekranın notu) */
export function branchFlowNote(name: string): { title: string; text: string } {
  return {
    title: `Şubenin nakit akışı · ${name}`,
    text: "Şubenin satış tahmini ve kasa devri ile şubenin ödemeleri, faturaları, maaşları ve sabit giderleri. Vergi, KDV, SGK, işletme geneli ödemeler ve faturasız borçlar her haftanın “İşletme geneli” satırında; şubenin akışına girmez. Bakiye firmanındır: elinizdeki parayla kalan Tümü'de ya da Firma geneli görünümde.",
  };
}

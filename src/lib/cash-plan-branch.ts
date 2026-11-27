/**
 * Nakit planının şube kipi: "Şubenin nakit akışı" (şube ayrımı D parça 4, 27 Kasım 2026; docs/SUBE.md › Şube ayrımı,
 * docs/NAKIT-PLANI.md). Saf: plan iki kez kurulur (src/server/data/cash-plan.ts › loadAreaCashPlan):
 *
 * - **şubenin planı**: şubenin satış tahmini ve kasa devri (gelen); şubenin hatırlatıcıları, şubeye seçilmiş
 *   faturaları, personelinin maaşı, şubenin sabit giderleri ve harcamaları, mal tahmini (giden). Açılış bakiyesi yok:
 *   satır "Net akış"tır (bakiye firmanındır);
 * - **firmanın planı** (bugünkü): buradan yalnız işletme geneli kalemler alınır ve hafta hafta tek satırda toplanır
 *   ("İşletme geneli"): işletme geneli hatırlatıcılar, işletme geneli faturalar ve faturasız borçlar (cari). Bu satır
 *   şubenin akışına girmez (bilgi); "Tümü"de hepsi firmanın planında.
 *
 * **Vergi ve SGK şubeye bölünmez** (sahibin kararı 27 Kasım 2026: "Vergi ile ilgili olan kısımları tamamen çıkar"):
 * KDV, KDV-2, muhtasar (stopajlı sabit giderin stopajı da), geçici ve kurumlar vergisi, damga, yerel vergiler ve SGK ne
 * şubenin akışında ne İşletme geneli satırında; şubenin planında KDV tahmini ve SGK tahmini de yok
 * (`branchPlanWithoutTax`). Ekran tek not yazar: "Vergi ve SGK ödemeleri firma geneli: Tümü'de görünür" (`FIRM_TAX_NOTE`).
 */

import { type CashPlan, FIRM_TAX_NOTE, type PlanLine } from "./cash-plan";
import {
  isLocalTaxReminder,
  isMuhtasarReminder,
  isProvisionalTaxReminder,
  isVatReminder,
  isVatWithholdingReminder,
  reminderCategory,
  type ReminderRow,
  vatStampReminder,
} from "./reminders";

/** İşletme geneli kalemleri tanımak için: işletme geneli hatırlatıcıların ve faturaların kimlikleri */
export interface SharedPlanIds {
  reminders: ReadonlySet<number>;
  invoices: ReadonlySet<number>;
}

/**
 * İşletme geneli kalemlerin kimlikleri firmanın ödemelerinden (`loadUpcoming`'in "Tümü" okuması): şubesiz hatırlatıcılar
 * (vergi ve SGK hatırlatıcısı değil: vergi şubeye bölünmez, `isTaxPlanReminder`) ve işletme geneli faturalar (şubesi
 * seçilmemiş fatura işletme geneli değildir: hiçbir şubenin akışında yok, Tümü'de var)
 */
export function sharedPlanIdsOf(up: {
  reminders: readonly (Pick<ReminderRow, "kind" | "title"> & { id: number; branchId: string | null })[];
  invoiceBranches: ReadonlyMap<number, { branchId: string | null; companyWide: boolean }>;
}): SharedPlanIds {
  return {
    reminders: new Set(up.reminders.filter((r) => !r.branchId && !isTaxPlanReminder(r)).map((r) => r.id)),
    invoices: new Set([...up.invoiceBranches].filter(([, i]) => i.companyWide && !i.branchId).map(([id]) => id)),
  };
}

/** Şubenin akışına giren fatura: yalnız o şubeye seçilmiş fatura (işletme geneli olan İşletme geneli satırında) */
export function ownPlanInvoice(ref: { branchId: string | null; companyWide: boolean } | undefined, branch: string): boolean {
  return Boolean(ref && ref.branchId === branch);
}

/**
 * Vergi ya da SGK ödemesinin hatırlatıcısı: KDV, KDV-2, muhtasar (kira stopajı da), geçici ve kurumlar vergisi, damga,
 * yerel vergiler (ÇTV, ilan reklam) ve SGK (Ödemeler'deki "Vergi / SGK" türü ya da başlığı). Şubenin akışına da İşletme
 * geneli satırına da girmez: vergi ve SGK firmanın, Tümü'de görünür
 */
export function isTaxPlanReminder(r: Pick<ReminderRow, "kind" | "title">): boolean {
  const cat = reminderCategory(r.kind, r.title);
  return (
    cat === "vergi" ||
    cat === "sgk" ||
    isVatReminder(r) ||
    isVatWithholdingReminder(r) ||
    isMuhtasarReminder(r) ||
    isProvisionalTaxReminder(r) ||
    vatStampReminder(r) !== null ||
    isLocalTaxReminder(r) !== null
  );
}

/**
 * Firmanın planındaki satır işletme geneli mi (şubenin akışına girmez, İşletme geneli satırında toplanır). Vergi, KDV ve
 * SGK satırları değil: vergi şubeye bölünmez (Tümü'de görünür)
 */
export function isSharedPlanLine(l: Pick<PlanLine, "key" | "kind" | "direction">, ids: SharedPlanIds): boolean {
  if (l.direction !== "out") return false;
  switch (l.kind) {
    case "kdv":
    case "vergi":
    case "sgk":
      return false;
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
  /** En büyük üç kalem ("Muhasebe 12.000 ₺"); ekran kısa yazar */
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

/** Şube kipinde planın dışında tutulan tahminler: KDV, vergi ve SGK firmanın (şubeye bölünmez, Tümü'de görünür) */
export const BRANCH_PLAN_EXCLUDED = ["kdv", "vergi", "sgk"] as const;

const TAX_ESTIMATES: ReadonlySet<string> = new Set(BRANCH_PLAN_EXCLUDED);

/**
 * Şubenin planından vergiyi kaldırır (sahibin kararı 27 Kasım 2026): KDV tahmini kartı yok (`vat`), "Tahmine
 * katılanlar"da KDV, vergi ve SGK satırı yok, "Nasıl hesaplandı" tek not yazar (`taxFirmWide`). Satırlar zaten vergisiz
 * kurulur (src/server/data/cash-plan.ts › loadCashPlan: vergi ve SGK hatırlatıcıları, KDV, vergi ve SGK tahmini, vergi
 * beslemesi yok; stopajlı sabit gider net)
 */
export function branchPlanWithoutTax(plan: CashPlan): CashPlan {
  return { ...plan, vat: null, estimates: plan.estimates.filter((r) => !TAX_ESTIMATES.has(r.key)), taxFirmWide: true };
}

/**
 * Şube kipinde KDV tahmini kartının yerindeki not (`taxFirmWide`; ekranda `#kdv` çapası bunda): Vergi takviminin,
 * Yardım'ın ve asistanın rehberinin "KDV tahmini" bağlantısı boşa inmesin. Düğmesi Nakit planı'nı Firma geneli görünüme
 * geçirir (ekranın çipiyle aynı eylem)
 */
export const BRANCH_VAT_NOTE = {
  title: "KDV tahmini, devreden KDV ve Ödendi kayıtları firma geneli",
  text: "Tümü'de ya da Firma geneli görünümde; vergi şubeye bölünmez.",
  action: "Firma geneline geç",
} as const;

/** Şubenin akışının açıklaması (ekranın notu) */
export function branchFlowNote(name: string): { title: string; text: string } {
  return {
    title: `Şubenin nakit akışı · ${name}`,
    text: `Şubenin satış tahmini ve kasa devri ile şubenin ödemeleri, faturaları, maaşları ve sabit giderleri. İşletme geneli ödemeler ve faturasız borçlar her haftanın “İşletme geneli” satırında; şubenin akışına girmez. ${FIRM_TAX_NOTE}. Bakiye firmanındır: elinizdeki parayla kalan Tümü'de ya da Firma geneli görünümde.`,
  };
}

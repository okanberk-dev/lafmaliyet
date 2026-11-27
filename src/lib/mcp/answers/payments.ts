/*
 * odemeler: Ödemeler ekranındaki liste (ödenmemiş faturalar, tedarikçilerin faturasız borçları ve hatırlatıcılar;
 * upcomingWithCari, summarize, inSummaryRange) ve istenirse 6 haftalık nakit planının haftalık özeti (insight:
 * buildCashPlan, planNotes). Hatırlatıcı notları gönderilmez; başlıklar (yöneticinin yazdığı) gider. Saf;
 * tests/claude-araclar.test.ts.
 */

import { planNotes, rangeText, weekTitle, type CashPlan } from "../../cash-plan";
import { inSummaryRange, REMINDER_REPEATS, summarize, SUMMARY_RANGES, type SummaryRange, type UpcomingItem } from "../../reminders";
import { unreachable } from "../../unreachable";
import type { OdemelerInput } from "../schemas";
import { cleanName, money, num, panelUrl, r2 } from "./common";

export interface PaymentsAnswer {
  bugun: string;
  ozet: Record<SummaryRange, { adet: number; toplam: number }>;
  kalemler: {
    baslik: string;
    tur: "fatura" | "hatırlatıcı" | "cari borç";
    vade: string;
    kalanGun: number;
    durum: "gecikti" | "bugün" | "yakında" | "sonra";
    tutar: number | null;
    tahminiVade: boolean;
    tekrar: string | null;
  }[];
  tutariGirilmemis: number;
  nakitPlani?: {
    bakiye: { tutar: number; tarih: string } | null;
    haftalar: { baslik: string; aralik: string; gelen: number; giden: number; haftaSonu: number | null }[];
    enSikisikGun: { tarih: string; tutar: number; dayanak: "bakiye" | "birikimli" } | null;
    notlar: string[];
  } | null;
  hesap: string[];
  kaynak: string[];
  panelAdresi: string;
}

const STATUS = { overdue: "gecikti", today: "bugün", soon: "yakında", later: "sonra" } as const;
const RANGE_LABEL: Record<SummaryRange, string> = { gecikmis: "Gecikmiş", hafta: "Bu hafta", ay: "Bu ay", "45gun": "45 gün içinde" };
const REPEAT = new Map(REMINDER_REPEATS.map((r) => [r.value, r.label]));
const flat = (s: string) => s.replace(/\u00a0/g, " ");

/**
 * Vadesi yazılmamış faturanın ve faturasız borcun vadesi tahminidir: satırın açıklaması "vade tahmini (N gün)" der
 * (src/lib/reminders.ts invoiceItem, cariItem; tests/claude-araclar.test.ts bu metni sabitler)
 */
export function isEstimatedDue(i: Pick<UpcomingItem, "source" | "detail">): boolean {
  switch (i.source) {
    case "invoice":
    case "cari":
      return /vade tahmini/.test(i.detail ?? "");
    case "reminder":
      return false;
    default:
      return unreachable(i.source);
  }
}

/** Kalemin türü (çıktıdaki `tur`) */
function typeOf(i: Pick<UpcomingItem, "source">): PaymentsAnswer["kalemler"][number]["tur"] {
  switch (i.source) {
    case "invoice":
      return "fatura";
    case "cari":
      return "cari borç";
    case "reminder":
      return "hatırlatıcı";
    default:
      return unreachable(i.source);
  }
}

/** Girdideki kaynak süzgecinin kalemi alıp almadığı */
function inSource(i: Pick<UpcomingItem, "source">, kaynak: OdemelerInput["kaynak"]): boolean {
  if (kaynak === "hepsi") return true;
  switch (i.source) {
    case "invoice":
      return kaynak === "fatura";
    case "cari":
      return kaynak === "cari";
    case "reminder":
      return kaynak === "hatirlatici";
    default:
      return unreachable(i.source);
  }
}

export function upcomingPayments(
  up: { today: string; items: UpcomingItem[]; invoiceTermDays: number },
  input: OdemelerInput,
  plan: { plan: CashPlan; komisyon: number; acikGun: number } | null,
  ctx: { base: string },
): PaymentsAnswer {
  const { today } = up;
  const items = up.items.filter((i) => inSource(i, input.kaynak));
  const sums = summarize(items, today);
  const ozet = Object.fromEntries(SUMMARY_RANGES.map((r) => [r, { adet: sums[r].count, toplam: r2(sums[r].total) }])) as PaymentsAnswer["ozet"];
  const inRange = items.filter((i) => inSummaryRange(i.dueDate, input.aralik, today));
  const unknown = inRange.filter((i) => i.amount === null).length;

  const hesap = SUMMARY_RANGES.map((r) => `${RANGE_LABEL[r]}: ${num(ozet[r].adet)} ödeme, ${money(ozet[r].toplam)}`);
  hesap.push("Bu hafta ve bu ay bugünden başlar; gecikmişler ayrıca sayılır. Faturada tutar kalan borçtur (kısmen ödenmişte kalan).");
  if (items.some((i) => i.credited)) hesap.push("Tedarikçinin hesabındaki sayılmamış ödeme borçlarından düşüldü (en eski vadeden)");
  if (unknown) hesap.push(`Tutarı girilmemiş ${num(unknown)} hatırlatıcı toplama girmedi`);
  hesap.push(`Vadesi yazılmamış faturanın vadesi: fatura günü + tedarikçinin vade günü (kartta yoksa ${num(up.invoiceTermDays)} gün)`);

  let nakitPlani: PaymentsAnswer["nakitPlani"] = undefined;
  const kaynak = ["Ödemeler ekranındaki liste: ödenmemiş faturalar, tedarikçilere faturasız borçlar ve etkin hatırlatıcılar; banka hareketi değil, 'ödendi' panelin işareti"];
  if (input.nakitPlani) {
    if (plan) {
      const p = plan.plan;
      nakitPlani = {
        bakiye: p.opening ? { tutar: r2(p.opening.amount), tarih: p.opening.date } : null,
        haftalar: p.weeks.map((w) => ({
          baslik: weekTitle(w.index),
          aralik: flat(rangeText(w.from, w.to)),
          gelen: r2(w.in),
          giden: r2(w.outKnown + w.outEstimated),
          haftaSonu: w.endBalance === null ? null : r2(w.endBalance),
        })),
        enSikisikGun: p.lowest ? { tarih: p.lowest.date, tutar: r2(p.lowest.value), dayanak: p.lowest.basis === "balance" ? "bakiye" : "birikimli" } : null,
        notlar: planNotes(p, { komisyon: plan.komisyon, acikGun: plan.acikGun, invoiceTermDays: up.invoiceTermDays }).map((n) => flat(`${n.title}: ${n.text}`)),
      };
      kaynak.push(
        p.opening
          ? "Nakit planı: girilen banka + kasa bakiyesinden başlar (Ödemeler › Nakit planı)"
          : "Nakit planı: bakiye girilmedi; haftaSonu yok, en sıkışık gün bugünden birikimli net",
      );
    } else {
      nakitPlani = null;
      kaynak.push("Nakit planı şu an okunamadı");
    }
  }

  return {
    bugun: today,
    ozet,
    kalemler: inRange.map((i) => ({
      baslik: cleanName(i.title),
      tur: typeOf(i),
      vade: i.dueDate,
      kalanGun: i.daysLeft,
      durum: STATUS[i.status],
      tutar: i.amount === null ? null : r2(i.amount),
      tahminiVade: isEstimatedDue(i),
      tekrar: i.repeat === "none" ? null : (REPEAT.get(i.repeat) ?? null),
    })),
    tutariGirilmemis: unknown,
    ...(nakitPlani !== undefined ? { nakitPlani } : {}),
    hesap,
    kaynak,
    panelAdresi: panelUrl(ctx.base, `/panel/hatirlaticilar?aralik=${input.aralik}`),
  };
}

/**
 * Şube kipinin İşletme geneli bilgisi (odemeler; şube ayrımı parça 4): şubenin listesine girmeyen faturasız borçlar,
 * şubesi seçilmemiş faturalar ve (nakit planı istendiyse) planın İşletme geneli satırlarının toplamı. Başlık ve tedarikçi
 * adı gönderilmez
 */
export function sharedPaymentsAnswer(
  shared: readonly Pick<UpcomingItem, "amount">[],
  unassigned: { count: number; total: number },
  flow: { sharedTotal: number } | null,
): { faturasizBorc: { adet: number; toplam: number }; subesiSecilmemisFatura: { adet: number; toplam: number }; nakitPlaniIsletmeGeneli: number | null; aciklama: string } {
  return {
    faturasizBorc: { adet: shared.length, toplam: r2(shared.reduce((a, i) => a + (i.amount ?? 0), 0)) },
    subesiSecilmemisFatura: { adet: unassigned.count, toplam: r2(unassigned.total) },
    nakitPlaniIsletmeGeneli: flow ? r2(flow.sharedTotal) : null,
    aciklama:
      "Şube görünümünde liste yalnız bu şubenin ve işletme genelinin ödemeleri ve faturaları; faturasız borçlar firmanın, şubesi seçilmemiş faturalar hiçbir şubenin listesinde değil (Tümü'de var). Nakit planında işletme geneli ödemeler ayrı satırda, şubenin akışına girmez. Vergi ve SGK ödemeleri firma geneli: şubeye bölünmez, nakit planının şube görünümünde yok (Tümü'de görünür).",
  };
}

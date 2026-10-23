/*
 * odemeler: Ödemeler ekranındaki liste (ödenmemiş faturalar ve hatırlatıcılar; upcomingItems, summarize,
 * inSummaryRange) ve istenirse 6 haftalık nakit planının haftalık özeti (insight: buildCashPlan, planNotes).
 * Hatırlatıcı notları gönderilmez; başlıklar (yöneticinin yazdığı) gider. Saf; tests/claude-araclar.test.ts.
 */

import { planNotes, rangeText, weekTitle, type CashPlan } from "../../cash-plan";
import { inSummaryRange, REMINDER_REPEATS, summarize, SUMMARY_RANGES, type SummaryRange, type UpcomingItem } from "../../reminders";
import type { OdemelerInput } from "../schemas";
import { cleanName, money, num, panelUrl, r2 } from "./common";

export interface PaymentsAnswer {
  bugun: string;
  ozet: Record<SummaryRange, { adet: number; toplam: number }>;
  kalemler: {
    baslik: string;
    tur: "fatura" | "hatırlatıcı";
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
 * Vadesi yazılmamış faturanın vadesi tahminidir: fatura satırının açıklaması "vade tahmini (N gün)" der
 * (src/lib/reminders.ts invoiceItem; tests/claude-araclar.test.ts bu metni sabitler)
 */
export const isEstimatedDue = (i: Pick<UpcomingItem, "source" | "detail">) => i.source === "invoice" && /vade tahmini/.test(i.detail ?? "");

export function upcomingPayments(
  up: { today: string; items: UpcomingItem[]; invoiceTermDays: number },
  input: OdemelerInput,
  plan: { plan: CashPlan; komisyon: number; acikGun: number } | null,
  ctx: { base: string },
): PaymentsAnswer {
  const { today } = up;
  const items = up.items.filter((i) => input.kaynak === "hepsi" || (input.kaynak === "fatura" ? i.source === "invoice" : i.source === "reminder"));
  const sums = summarize(items, today);
  const ozet = Object.fromEntries(SUMMARY_RANGES.map((r) => [r, { adet: sums[r].count, toplam: r2(sums[r].total) }])) as PaymentsAnswer["ozet"];
  const inRange = items.filter((i) => inSummaryRange(i.dueDate, input.aralik, today));
  const unknown = inRange.filter((i) => i.amount === null).length;

  const hesap = SUMMARY_RANGES.map((r) => `${RANGE_LABEL[r]}: ${num(ozet[r].adet)} ödeme, ${money(ozet[r].toplam)}`);
  hesap.push("Bu hafta ve bu ay bugünden başlar; gecikmişler ayrıca sayılır. Faturada tutar kalan borçtur (kısmen ödenmişte kalan).");
  if (unknown) hesap.push(`Tutarı girilmemiş ${num(unknown)} hatırlatıcı toplama girmedi`);
  hesap.push(`Vadesi yazılmamış faturanın vadesi: fatura günü + tedarikçinin vade günü (kartta yoksa ${num(up.invoiceTermDays)} gün)`);

  let nakitPlani: PaymentsAnswer["nakitPlani"] = undefined;
  const kaynak = ["Ödemeler ekranındaki liste: ödenmemiş faturalar ve etkin hatırlatıcılar; banka hareketi değil, 'ödendi' panelin işareti"];
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
      tur: i.source === "invoice" ? "fatura" : "hatırlatıcı",
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

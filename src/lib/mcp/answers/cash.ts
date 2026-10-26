/*
 * kasa_raporlari: tarih aralığındaki gün sonu raporları (Z toplamı, ödeme türleri, kasa farkı), raporu girilmemiş
 * günler ve kasa bütünlüğü (açılış ↔ önceki devir: carryChecks; sonradan düzeltilen rapor). Raporu giren ya da
 * kasayı sayan kişinin adı, notlar ve "neye çıktı" metni gönderilmez. Saf; tests/claude-araclar.test.ts.
 */

import { carryChecks, diffKind, type CashReportFields } from "../../cash-report";
import { addDays } from "../../reminders";
import { cleanName, money, num, panelUrl, r2 } from "./common";

/** Raporun bu araca gereken alanları (kişi adları ve notlar burada yok) */
export type CashReportLike = Pick<
  CashReportFields,
  "date" | "zTotal" | "cash" | "card" | "mealCard" | "online" | "other" | "openingCash" | "cashIn" | "cashOut" | "countedCash" | "handedOver"
> & { cashDiff: number; revision: number };

export interface CashAnswer {
  donem: { baslangic: string; bitis: string };
  raporSayisi: number;
  eksikGunSayisi: number;
  /** En çok 31 gün listelenir */
  eksikGunler: string[];
  toplam: {
    zToplam: number;
    nakit: number;
    kart: number;
    yemekKarti: number;
    online: number;
    diger: number;
    gunIcindeGiren: number;
    gunIcindeCikan: number;
    teslimEdilen: number;
    kasaFarkiToplam: number;
    eksikGun: number;
    fazlaGun: number;
    tutanGun: number;
  };
  gunluk: {
    tarih: string;
    zToplam: number;
    nakit: number;
    kart: number;
    yemekKarti: number;
    online: number;
    kasaFarki: number;
    fark: "eksik" | "fazla" | "tutuyor";
    revizyon: number;
    acilisDevirleTutmuyor: boolean;
    sonradanDuzeltildi: boolean;
  }[];
  uyarilar: string[];
  hesap: string[];
  kaynak: string[];
  panelAdresi: string;
}

const FARK = { short: "eksik", over: "fazla", even: "tutuyor" } as const;

/**
 * `before`: aralığın ilk gününden önceki son raporun ertesi güne devri (previousCarryOver); `firstReport`: ilk
 * raporun günü (ondan önceki günler eksik sayılmaz); `through`: eksik günlerin arandığı son gün (bugünün raporu akşam
 * girilir: düne kadar).
 */
export function cashReportSummary(
  reports: readonly CashReportLike[],
  ctx: { from: string; to: string; through: string; firstReport: string | null; before: { date: string; amount: number } | null; base: string },
): CashAnswer {
  const days = [...reports].sort((a, b) => a.date.localeCompare(b.date));
  const have = new Set(days.map((r) => r.date));
  const missing: string[] = [];
  if (ctx.firstReport) {
    const start = ctx.from > ctx.firstReport ? ctx.from : ctx.firstReport;
    const end = ctx.to < ctx.through ? ctx.to : ctx.through;
    for (let d = start; d <= end; d = addDays(d, 1)) if (!have.has(d)) missing.push(d);
  }
  const carry = carryChecks(days, ctx.before);
  const sum = (f: (r: CashReportLike) => number) => r2(days.reduce((a, r) => a + f(r), 0));
  const kinds = days.map((r) => diffKind(r.cashDiff));
  const toplam = {
    zToplam: sum((r) => r.zTotal),
    nakit: sum((r) => r.cash),
    kart: sum((r) => r.card),
    yemekKarti: sum((r) => r.mealCard),
    online: sum((r) => r.online),
    diger: sum((r) => r.other),
    gunIcindeGiren: sum((r) => r.cashIn),
    gunIcindeCikan: sum((r) => r.cashOut),
    teslimEdilen: sum((r) => r.handedOver),
    kasaFarkiToplam: sum((r) => r.cashDiff),
    eksikGun: kinds.filter((k) => k === "short").length,
    fazlaGun: kinds.filter((k) => k === "over").length,
    tutanGun: kinds.filter((k) => k === "even").length,
  };
  const gunluk = days.map((r) => ({
    tarih: r.date,
    zToplam: r2(r.zTotal),
    nakit: r2(r.cash),
    kart: r2(r.card),
    yemekKarti: r2(r.mealCard),
    online: r2(r.online),
    kasaFarki: r2(r.cashDiff),
    fark: FARK[diffKind(r.cashDiff)],
    revizyon: r.revision,
    acilisDevirleTutmuyor: carry.has(r.date),
    sonradanDuzeltildi: r.revision > 1,
  }));

  const uyarilar: string[] = [];
  if (missing.length) uyarilar.push(`${num(missing.length)} günün raporu yok; kafe o günler kapalı olabilir.`);
  if (carry.size) uyarilar.push(`${num(carry.size)} günde açılış önceki raporun devriyle tutmuyor (Kasa › Günden güne).`);
  const revised = gunluk.filter((g) => g.sonradanDuzeltildi).length;
  if (revised) uyarilar.push(`${num(revised)} rapor sonradan düzeltildi (düzeltme geçmişi Kasa'da).`);
  if (!days.length) uyarilar.push("Bu aralıkta kasa raporu yok.");

  return {
    donem: { baslangic: ctx.from, bitis: ctx.to },
    raporSayisi: days.length,
    eksikGunSayisi: missing.length,
    eksikGunler: missing.slice(0, 31),
    toplam,
    gunluk,
    uyarilar,
    hesap: [
      "Kasa farkı = sayılan nakit − (açılış + nakit satış + gün içinde giren − gün içinde çıkan); 1 ₺'den küçük fark tutuyor sayılır",
      `Dönemde ${num(days.length)} rapor: Z toplamı ${money(toplam.zToplam)} (nakit ${money(toplam.nakit)}, kart ${money(toplam.kart)}, yemek kartı ${money(toplam.yemekKarti)}, online ${money(toplam.online)}, diğer ${money(toplam.diger)})`,
      `Kasa farkı toplamı ${money(toplam.kasaFarkiToplam)}: ${num(toplam.eksikGun)} gün eksik, ${num(toplam.fazlaGun)} gün fazla, ${num(toplam.tutanGun)} gün tuttu`,
    ],
    kaynak: [
      "Personelin her akşam girdiği gün sonu kasa raporları (Kasa raporu)",
      "Z'deki online: platform satışları (Yemeksepeti, Getir, Trendyol); laffogato.net online satışları kasadan geçmez, burada yok",
      ...(ctx.firstReport ? [`İlk kasa raporu ${cleanName(ctx.firstReport, 10)}; ondan önceki günler eksik sayılmaz`] : ["Henüz hiç kasa raporu yok"]),
    ],
    panelAdresi: panelUrl(ctx.base, `/panel/kasa?ay=${ctx.to.slice(0, 7)}`),
  };
}

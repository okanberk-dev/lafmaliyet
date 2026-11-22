/*
 * kasa_raporlari: tarih aralığındaki gün sonu raporları (Z toplamı, ödeme türleri, kasa farkı), raporu girilmemiş
 * günler ve kasa bütünlüğü (açılış ↔ önceki devir: carryChecks; sonradan düzeltilen rapor). Raporu giren ya da
 * kasayı sayan kişinin adı, notlar ve "neye çıktı" metni gönderilmez. Saf; tests/claude-araclar.test.ts.
 *
 * Birden çok kasa ("Tümü"de iki şube; `tills`): kasa raporu şube başınadır. Günlük satırlar şubenin adını taşır, eksik
 * günler ve açılış ↔ devir zinciri şube şube (bir şubenin raporu ötekinin eksik gününü örtmez; Marina'nın açılışı
 * Tuzla'nın deviriyle karşılaştırılmaz).
 */

import { branchDayKey, carryChecks, carryChecksByBranch, diffKind, type CarryCheck, type CashReportFields } from "../../cash-report";
import { addDays } from "../../reminders";
import { cleanName, money, num, panelUrl, r2 } from "./common";

/** Raporun bu araca gereken alanları (kişi adları ve notlar burada yok) */
export type CashReportLike = Pick<
  CashReportFields,
  "date" | "zTotal" | "cash" | "card" | "mealCard" | "online" | "other" | "openingCash" | "cashIn" | "cashOut" | "countedCash" | "handedOver"
> & { cashDiff: number; revision: number; branchId?: string };

/** Birden çok kasada bir şubenin kasası: kimlik, ad, ilk raporu ve aralıktan önceki son devri */
export interface CashTillLike {
  id: string;
  name: string;
  firstReport: string | null;
  before: { date: string; amount: number } | null;
}

export interface CashAnswer {
  donem: { baslangic: string; bitis: string };
  raporSayisi: number;
  /** Birden çok kasada (şube, gün) çiftlerinin sayısı */
  eksikGunSayisi: number;
  /** En çok 31 gün listelenir; birden çok kasada "2026-11-12 · Marina" */
  eksikGunler: string[];
  /** Yalnız birden çok kasada: şube şube rapor ve eksik gün sayısı */
  subeler?: { sube: string; raporSayisi: number; eksikGunSayisi: number }[];
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
    /** Yalnız birden çok kasada: raporun şubesi */
    sube?: string;
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

/** [firstReport ya da from, to ya da through] içinde raporu olmayan günler */
function missingDays(have: ReadonlySet<string>, firstReport: string | null, ctx: { from: string; to: string; through: string }): string[] {
  const out: string[] = [];
  if (!firstReport) return out;
  const start = ctx.from > firstReport ? ctx.from : firstReport;
  const end = ctx.to < ctx.through ? ctx.to : ctx.through;
  for (let d = start; d <= end; d = addDays(d, 1)) if (!have.has(d)) out.push(d);
  return out;
}

/**
 * `before`: aralığın ilk gününden önceki son raporun ertesi güne devri (previousCarryOver); `firstReport`: ilk
 * raporun günü (ondan önceki günler eksik sayılmaz); `through`: eksik günlerin arandığı son gün (bugünün raporu akşam
 * girilir: düne kadar). `tills`: birden çok kasa ("Tümü"de açık şubeler; her birinin ilk raporu ve önceki devri): en az
 * iki kasa verilince eksik günler ve devir zinciri şube şube, günlük satırlarda şube (`before` ve `firstReport`
 * kullanılmaz). Verilmezse tek kasa, bugünkü gibi.
 */
export function cashReportSummary(
  reports: readonly CashReportLike[],
  ctx: {
    from: string;
    to: string;
    through: string;
    firstReport: string | null;
    before: { date: string; amount: number } | null;
    base: string;
    tills?: readonly CashTillLike[];
  },
): CashAnswer {
  const tills = ctx.tills && ctx.tills.length > 1 ? ctx.tills : null;
  const order = new Map((tills ?? []).map((t, i) => [t.id, i]));
  const branchOf = (r: CashReportLike) => r.branchId ?? tills?.[0]?.id ?? "";
  const nameOf = (id: string) => tills?.find((t) => t.id === id)?.name ?? id;
  const days = [...reports].sort((a, b) => a.date.localeCompare(b.date) || (order.get(branchOf(a)) ?? 99) - (order.get(branchOf(b)) ?? 99));
  let missing: string[];
  let carryOf: (r: CashReportLike) => CarryCheck | undefined;
  let subeler: CashAnswer["subeler"];
  if (tills) {
    const perTill = tills.map((t) => {
      const own = days.filter((r) => branchOf(r) === t.id);
      return { t, own, missing: missingDays(new Set(own.map((r) => r.date)), t.firstReport, ctx) };
    });
    missing = perTill.flatMap((x) => x.missing.map((d) => ({ d, i: order.get(x.t.id)! }))).sort((a, b) => a.d.localeCompare(b.d) || a.i - b.i).map((x) => `${x.d} · ${tills[x.i].name}`);
    const checks = carryChecksByBranch(
      days.map((r) => ({ ...r, branchId: branchOf(r) })),
      (id) => tills.find((t) => t.id === id)?.before ?? null,
    );
    carryOf = (r) => checks.get(branchDayKey(branchOf(r), r.date));
    subeler = perTill.map((x) => ({ sube: x.t.name, raporSayisi: x.own.length, eksikGunSayisi: x.missing.length }));
  } else {
    missing = missingDays(new Set(days.map((r) => r.date)), ctx.firstReport, ctx);
    const checks = carryChecks(days, ctx.before);
    carryOf = (r) => checks.get(r.date);
  }
  const carryCount = days.filter((r) => carryOf(r)).length;
  const sum = (f: (r: CashReportLike) => number) => r2(days.reduce((a, r) => a + f(r), 0));
  // Gün günde bir (denetim 13 Kasım HM-07): "Tümü"de aynı günün şube raporlarından en kötüsü (eksik > fazla > tutuyor)
  const worst = new Map<string, ReturnType<typeof diffKind>>();
  for (const r of days) {
    const k = diffKind(r.cashDiff);
    const had = worst.get(r.date);
    if (!had || k === "short" || (k === "over" && had === "even")) worst.set(r.date, k);
  }
  const kinds = [...worst.values()];
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
    ...(tills ? { sube: nameOf(branchOf(r)) } : {}),
    zToplam: r2(r.zTotal),
    nakit: r2(r.cash),
    kart: r2(r.card),
    yemekKarti: r2(r.mealCard),
    online: r2(r.online),
    kasaFarki: r2(r.cashDiff),
    fark: FARK[diffKind(r.cashDiff)],
    revizyon: r.revision,
    acilisDevirleTutmuyor: carryOf(r) !== undefined,
    sonradanDuzeltildi: r.revision > 1,
  }));

  const uyarilar: string[] = [];
  if (missing.length && subeler) {
    const parts = subeler.filter((x) => x.eksikGunSayisi).map((x) => `${x.sube} ${num(x.eksikGunSayisi)} gün`);
    uyarilar.push(`Raporu olmayan günler (şube şube): ${parts.join(", ")}; şube o günler kapalı olabilir.`);
  } else if (missing.length) uyarilar.push(`${num(missing.length)} günün raporu yok; kafe o günler kapalı olabilir.`);
  if (carryCount) uyarilar.push(`${num(carryCount)} ${tills ? "raporda" : "günde"} açılış önceki raporun devriyle tutmuyor (Kasa › Günden güne).`);
  const revised = gunluk.filter((g) => g.sonradanDuzeltildi).length;
  if (revised) uyarilar.push(`${num(revised)} rapor sonradan düzeltildi (düzeltme geçmişi Kasa'da).`);
  if (!days.length) uyarilar.push("Bu aralıkta kasa raporu yok.");

  return {
    donem: { baslangic: ctx.from, bitis: ctx.to },
    raporSayisi: days.length,
    eksikGunSayisi: missing.length,
    eksikGunler: missing.slice(0, 31),
    ...(subeler ? { subeler } : {}),
    toplam,
    gunluk,
    uyarilar,
    hesap: [
      "Kasa farkı = sayılan nakit − (açılış + nakit satış + gün içinde giren − gün içinde çıkan); 1 ₺'den küçük fark tutuyor sayılır",
      `Dönemde ${num(days.length)} rapor${subeler ? ` (${subeler.map((x) => `${x.sube} ${num(x.raporSayisi)}`).join(", ")}; her şubenin kasası ayrı, toplamlar şubelerin toplamı)` : ""}: Z toplamı ${money(toplam.zToplam)} (nakit ${money(toplam.nakit)}, kart ${money(toplam.kart)}, yemek kartı ${money(toplam.yemekKarti)}, online ${money(toplam.online)}, diğer ${money(toplam.diger)})`,
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

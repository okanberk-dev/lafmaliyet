import { computeCash } from "@/lib/cash-report";
import { money } from "@/lib/format";
import type { CashPrefill, PrefillField, PrefillPlan, ReadCheck, ReadValue } from "@/lib/photo-read/kasa";

import type { PosDayZ } from "./day";

/**
 * Kasa raporunun "LafPOS'tan doldur"u (saf; docs/LAFPOS.md › Kasa raporu): LafPOS'un gün sonu Z özeti formun ModPOS Z
 * ve kasa alanlarına, fotoğraf okumasının biçimiyle (CashPrefill, `source: "lafpos"`). Form aynı kuralla uygular: yalnız
 * boş alanlar dolar, yazılmış ve farklı olanın altında "LafPOS'ta …" ve "LafPOS'takini yaz" çıkar; hiçbir şey
 * kendiliğinden kaydedilmez, personel bakıp gönderir. Rakamlar LafPOS'un kendi hesabıdır (tahmin yok): güveni hep "high".
 * Kasa alanlarında LafPOS'un teslimi gün içinde çıkana katılır, çekmeceye giren nakit "Gün içinde kasaya giren"e
 * yazılır (lafposTill). Personele de gider: yalnız formun zaten yazdırdığı rakamlar (maliyet, kâr, komisyon, ödeme
 * kanalı yok).
 */

/** Günün LafPOS özeti: formun "LafPOS'tan doldur" bandı */
export interface LafposDay {
  /** LafPOS'un son gönderiminin geldiği an (ISO); düzeltme yeniden gönderilince değişir */
  receivedAt: string;
  prefill: CashPrefill;
}

/**
 * Gün LafPOS'ta sayılmadan kapandıysa sayılan nakit boş kalır, altında bu yazar. Sayım panelde yapılmaz: form o anda
 * Z'nin rakamlarını gösterir, sayım kör olmaz. LafPOS'un kasa föyüne girilen sayımla LafPOS günü yeniden gönderir.
 */
export const LAFPOS_NO_COUNT_TEXT = "LafPOS'ta gün sonu sayımı yok: çekmeceyi LafPOS'ta Kasa › Geçmiş günler › Kasa föyü'nden sayın; LafPOS günü yeniden gönderir.";

const round2 = (v: number) => Math.round(v * 100) / 100;
const kurus = (v: number) => Math.round(v * 100);

/**
 * LafPOS'un kasa hareketleri → panelin kasa alanları (docs/LAFPOS.md › Kasa raporu). LafPOS'ta teslim gün açıkken,
 * sayımdan önce çekmeceden çıkar; panelin "Teslim edilen"i ise sayımdan sonra verilen paradır (olması gerekenden değil
 * devirden düşer). Bu yüzden teslim gün içinde çıkana katılır, Teslim edilen 0 olur; nakit satış dışında çekmeceye
 * giren (`cashIn`: giriş, nakit tahsilat ve nakit bahşiş; eski gövdede yoksa 0) panelin "Gün içinde kasaya giren"idir:
 *
 *   gün içinde çıkan = harcama + teslim
 *   gün içinde giren = giren
 *
 * Böylece panelin olması gerekeni (açılış + nakit + giren − çıkan, computeCash) LafPOS'unkine eşit olur, devir sayılan
 * nakittir; giren çıkandan fazla da olsa (bahşiş, tahsilat günü) eksi tutar ya da kesinti gerekmez. LafPOS kendi
 * olması gerekenini (`expectedCash`) gönderdiyse ve panelin aynı rakamlarla hesabından 0,01 TL'den fazla ayrılıyorsa
 * bilgi satırı LafPOS'un rakamını gösterir.
 */
function lafposTill(z: PosDayZ): { cashOut: number; cashIn: number; checks: ReadCheck[] } {
  const cashOut = round2(z.cashOut + z.handedOver);
  const cashIn = z.cashIn ?? 0;
  const checks: ReadCheck[] = [];
  if (z.expectedCash !== null && z.expectedCash !== undefined) {
    const panel = computeCash({ ...z, cashIn, cashOut, countedCash: z.countedCash ?? 0, handedOver: 0, bankPos: null }).expectedCash;
    const gap = kurus(panel) - kurus(z.expectedCash);
    if (Math.abs(gap) > 1) {
      checks.push({
        fields: [],
        level: "info",
        text: `LafPOS'ta olması gereken nakit ${money(z.expectedCash)}; panel aynı rakamlarla ${money(panel)} hesaplıyor (${money(Math.abs(gap) / 100)} ${gap < 0 ? "az" : "fazla"}).`,
      });
    }
  }
  return { cashOut, cashIn, checks };
}

/** LafPOS'un Z özeti → formun alanları (zNo metin: formdaki Z no metindir) */
export function lafposPrefill(z: PosDayZ): CashPrefill {
  const values: Partial<Record<PrefillField, ReadValue>> = {};
  const put = (field: PrefillField, value: number | string | null) => {
    if (value !== null) values[field] = { value, confidence: "high" };
  };
  const till = lafposTill(z);
  put("zNo", String(z.zNo));
  put("receipts", z.receipts);
  put("zTotal", z.zTotal);
  put("cash", z.cash);
  put("card", z.card);
  put("mealCard", z.mealCard);
  put("online", z.online);
  put("other", z.other);
  put("offRevenue", z.offRevenue);
  put("discounts", z.discounts);
  put("openingCash", z.openingCash);
  put("cashIn", till.cashIn);
  put("cashOut", till.cashOut);
  put("countedCash", z.countedCash);
  // LafPOS'un teslimi sayımdan önce çıktı (gün içinde çıkanda); sayımdan sonra teslim LafPOS'ta yok
  put("handedOver", 0);
  return { source: "lafpos", values, checks: till.checks, missing: z.countedCash === null ? ["countedCash"] : [] };
}

/** "LafPOS'tan doldur"dan sonraki satır */
export function lafposSummary(plan: PrefillPlan): string {
  const filled = plan.fill.length;
  const differs = plan.differs.length;
  if (filled && differs) return `LafPOS'tan ${filled} alan dolduruldu; ${differs} alan yazdığınızdan farklı, turuncu olanlara bakın.`;
  if (filled) return `LafPOS'tan ${filled} alan dolduruldu. Kontrol edip gönderin.`;
  if (differs) return `LafPOS'ta ${differs} alan yazdığınızdan farklı; turuncu olanlara bakın.`;
  if (plan.missing.length) return LAFPOS_NO_COUNT_TEXT;
  return "Yazdıklarınız LafPOS'takiyle aynı.";
}

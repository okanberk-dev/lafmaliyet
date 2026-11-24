import { computeCash } from "@/lib/cash-report";
import { money } from "@/lib/format";
import type { CashPrefill, PrefillField, PrefillPlan, ReadCheck, ReadValue } from "@/lib/photo-read/kasa";

import type { PosDayZ, PosOffDevice, PosOkc } from "./day";

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
  /**
   * LafPOS'un kasa hareketleri ayrı ayrı (denetim E-35): harcama ve gün içindeki teslim. Formda "Gün içinde çıkan"
   * birleşiktir (harcama + teslim); bilgi satırı panelin Kasadan çıkanlar'ıyla bunları karşılaştırır
   */
  till: { spent: number; handed: number };
  /**
   * Kartla bahşiş + kartla cari tahsilatı (Z'nin kartında yok, banka POS'unda var); eski gövdede 0. Personelin formuna
   * da gider: kart karşılaştırması her okurda aynı kuralla düşer (form, kayıtlı görünüm, WhatsApp; G11). Rakam
   * personelin yazdığı Banka POS ile kartın farkından zaten çıkar; metinlerde tutarı yalnız yöneticinin metni yazar
   */
  cardExtra: number;
  /**
   * Faz 2: yazarkasadan geçmeyen satış ödemeleri (gövdenin `offDevice`'ı; eski gövdede null). Mali fişi yazarkasada
   * kesilmediği için yazarkasanın kartında ve nakdinde, Pavo'nun banka gün sonunda yoktur; kart karşılaştırması kartı,
   * yazarkasanın nakit ve toplam satırları ikisini düşer (withCardExtra). Tutarı yalnız yöneticinin metni yazar
   */
  offDevice: (PosOffDevice & { okcCard?: number | null }) | null;
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

/**
 * Kartla bahşiş + kartla cari tahsilatı: banka POS'unun gördüğü, Z'nin kartına girmeyen (eski gövdede 0). Gün sonu tam:
 * yazarkasadan geçmeyen kart ödemelerinin bahşişi (offDevice.cardTips) Pavo'nun batch'inde de yoktur, düşer (LafPOS'un
 * cardBasis'iyle aynı; yoksa Banka POS dolunca her kart satırı yanlış bir bahşiş farkı gösterirdi)
 */
export function lafposCardExtra(z: PosDayZ, offDevice?: Pick<PosOffDevice, "cardTips"> | null): number {
  return round2(Math.max(0, (z.cardTips ?? 0) + (z.cardCollections ?? 0) - (offDevice?.cardTips ?? 0)));
}

/**
 * Saklanan Z özetinden günün LafPOS özeti (Kasa raporunun okuyucusu: src/server/data/lafpos-day.ts). `offDevice`
 * gövdenin üst düzey alanıdır (Z'nin değil): ayrı sütundan gelir, yoksa (eski gövde) null
 */
export function lafposDayOf(z: PosDayZ, receivedAt: Date | string, offDevice?: PosOffDevice | null, okc?: Pick<PosOkc, "voided"> & Partial<Pick<PosOkc, "card">> | null): LafposDay {
  // Gün sonu tam: cihazda iptal edilen belgenin ödemesi Z'de kalır, yazarkasanın ve Pavo'nun toplamında yoktur
  // (okc.cash = z.cash − offDevice.cash − voided.cash): karşılaştırmalar onu da düşer
  const card = round2((offDevice?.card ?? 0) + (okc?.voided.card ?? 0));
  const cash = round2((offDevice?.cash ?? 0) + (okc?.voided.cash ?? 0));
  return {
    receivedAt: typeof receivedAt === "string" ? receivedAt : receivedAt.toISOString(),
    prefill: lafposPrefill(z),
    till: { spent: z.cashOut, handed: z.handedOver },
    cardExtra: lafposCardExtra(z, offDevice),
    // Cihaz belgelerinin kartı da: raporun yazarkasa kartı ondan geldiyse kart karşılaştırması bahşişi düşmez (okcFromDevice)
    offDevice: card > 0 || cash > 0 || okc?.card != null ? { card, cash, ...(okc?.card != null ? { okcCard: okc.card } : {}) } : null,
  };
}

/**
 * "Gün içinde çıkan"ın iki kaynağı (denetim E-35): panelin Kasadan çıkanlar'ı kaynaktır (Aylık harcamalar ve tedarikçi
 * ödemeleri oradan okunur), LafPOS'un harcama + teslimi bilgidir. Sahip sorusu 5 yanıtlandı (23 Kasım 2026, Faz 3):
 * kasa hareketlerini gönderen LafPOS'un günü satır satır gelir (src/server/lafpos/cash-moves.ts) ve ikisi kendiliğinden
 * tutar; bu satır eski LafPOS'un gününde ya da panele LafPOS'ta olmayan bir çıkış girildiğinde görünür.
 * İkisi tutmuyorsa formun bilgi satırı: "LafPOS'ta harcama 450 ₺ + teslim 5.000 ₺; Kasadan çıkanlar'da 450 ₺." Fark
 * LafPOS'taki teslim kadarsa ne yapılacağı söylenir: teslim Kasadan çıkanlar'a "Teslim" olarak eklenince Gün içinde
 * çıkan kendiliğinden toplamı alır (fişsiz çıkış ya da sahte eksik olmaz). Tutuyorsa null.
 */
export function lafposOutsCheck(till: LafposDay["till"], outsTotal: number): ReadCheck | null {
  const lafpos = round2(till.spent + till.handed);
  const panel = round2(outsTotal);
  if (Math.abs(kurus(lafpos) - kurus(panel)) <= 1) return null;
  const parts = [`harcama ${money(till.spent)}`, ...(till.handed > 0 ? [`teslim ${money(till.handed)}`] : [])].join(" + ");
  const head = `LafPOS'ta ${parts}; ${panel > 0 ? `Kasadan çıkanlar'da ${money(panel)}` : "Kasadan çıkanlar'a bir şey girilmedi"}.`;
  const gap = round2(lafpos - panel);
  const tail =
    till.handed > 0 && Math.abs(kurus(gap) - kurus(till.handed)) <= 1
      ? ` Teslimi Kasadan çıkanlar'a "Teslim" olarak ekleyin; Gün içinde çıkan kendiliğinden ${money(lafpos)} olur.`
      : gap > 0
        ? ` ${money(gap)} LafPOS'ta var, panelde yok: fişi ya da teslimi Kasadan çıkanlar'a ekleyin.`
        : ` Panelde ${money(-gap)} fazla: LafPOS'a girilmemiş bir çıkış olabilir.`;
  return { fields: [], level: "info", text: head + tail };
}

/**
 * Raporun "Gün içinde çıkan"ı kayıtlı kasadan çıkanlardan fazlaysa farkın ne kadarı LafPOS'ta olup Kasadan çıkanlar'a
 * girilmemiş teslim (E-35): o kısım fişsiz çıkış sayılmaz (geç rapor ve düzeltme kartı), kalanı (`rest`) yine
 * fişsizdir. Panelde "Teslim" satırı olarak girilmiş kısım (`teslimTotal`) LafPOS'un tesliminden düşülür: teslimin
 * bir kısmı girildiyse yalnız kalanı beklenir (`handed`). Fark beklenenden azsa (başka bir yanlış) ayrıştırılmaz: null.
 * Panelde "Teslim" diye girilen bir tedarikçi ödemesi LafPOS'ta harcamaysa bu ihtiyatlıdır (fişsizi az değil çok gösterir).
 */
export function lafposHandedGap(cashOut: number, outsTotal: number, till: LafposDay["till"] | null, teslimTotal = 0): { handed: number; rest: number } | null {
  if (!till || till.handed <= 0) return null;
  const pending = round2(Math.max(0, till.handed - teslimTotal));
  if (pending < 1) return null;
  const gap = round2(cashOut - outsTotal);
  if (kurus(gap) < kurus(pending) - 100) return null;
  const rest = round2(gap - pending);
  return { handed: pending, rest: rest < 1 ? 0 : rest };
}

/**
 * "LafPOS'tan doldur"dan sonraki satır (form, alanların şimdiki işaretlerinden de kurar: yalnız sayılar okunur).
 * `writer`: alanları kim yazdı; "staff" yöneticinin "Düzeltip onayla"sında (personelin yazdıkları; yönetici bir şey
 * yazmadı)
 */
export function lafposSummary(plan: { fill: readonly unknown[]; differs: readonly unknown[]; missing: readonly unknown[] } | PrefillPlan, writer: "self" | "staff" = "self"): string {
  const filled = plan.fill.length;
  const differs = plan.differs.length;
  const written = writer === "staff" ? "personelin yazdığından" : "yazdığınızdan";
  if (filled && differs) return `LafPOS'tan ${filled} alan dolduruldu; ${differs} alan ${written} farklı, turuncu olanlara bakın.`;
  if (filled) return `LafPOS'tan ${filled} alan dolduruldu. Kontrol edip gönderin.`;
  if (differs) return `LafPOS'ta ${differs} alan ${written} farklı; turuncu olanlara bakın.`;
  if (plan.missing.length) return LAFPOS_NO_COUNT_TEXT;
  return writer === "staff" ? "Personelin yazdıkları LafPOS'takiyle aynı." : "Yazdıklarınız LafPOS'takiyle aynı.";
}

import type { AutoValues } from "./gun-sonu";
import type { PosDayZ } from "./day";
import { TEL_KAYNAK } from "./eski-adlar";

/**
 * Kasa zinciri (Faz 3, 23 Kasım 2026; docs/ASILPOS.md › Kasa zinciri): AsilPOS günü açarken çekmecedeki nakdi önceki gerçek
 * günün devriyle karşılaştırır. Devir panelde saklanmaz: o günün Kasa raporunun sayılan − teslim edileni
 * (computeCash.carryOver; ertesi günün açılışı formda da ondan dolar). Bu dosya ertesi günün beklenen açılışını
 * (`nextOpening`) verir: `POST /api/pos/gun`'un 200 yanıtı ve `GET /api/panel/pos/devir` aynı nesneyi döner
 * (src/server/asilpos/devir.ts). Saf; testleri tests/kasa-zinciri.test.ts.
 */

/**
 * Ertesi günün beklenen açılışı (TL): `kasa_raporu` panelin Kasa raporundan, TEL_KAYNAK rapor yokken AsilPOS'un sayımı.
 * Değer telde eski adla gider: kurulu kasa bilinmeyen değerde devri bütünüyle reddeder (plan A1; kalıcı)
 */
export interface NextOpening {
  amount: number;
  source: "kasa_raporu" | typeof TEL_KAYNAK;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const same = (a: unknown, b: unknown) => (typeof a === "number" && typeof b === "number" ? Math.round(a * 100) === Math.round(b * 100) : (a ?? null) === (b ?? null));

/**
 * Günün devri:
 * - gün AsilPOS'un sayılan günü değilse (geçiş gününden önce, deneme) null;
 * - günün Kasa raporu varsa sayılan − teslim (`kasa_raporu`). Rapor AsilPOS'un elle değişmemiş otomatik raporuysa
 *   (asilpos_day_ends raporu gösteriyor ve otomatik değerleri duruyor) sayılan ve teslim gelen gövdeden, otomatik raporun
 *   birleştirmesiyle (gun-sonu.ts mergeAuto: alan son otomatik değerindeyse yenisi; kişinin düzelttiği alan kalır; yeni
 *   değer boşsa kayıtlı kalır). Otomatik rapor yanıttan sonra yazılır (after()): kayıtlı rapor önceki gönderimin
 *   sayımını taşır, yeniden sayımın yanıtı onu yankılamamalı. Kişinin yazdığı ya da düzelttiği rapor hep geçer. Teslim
 *   sayılandan büyükse (rapor tutarsız) null: eksi devir gönderilmez;
 * - rapor yoksa AsilPOS'un sayımı (TEL_KAYNAK); sayım da yoksa null.
 *
 * `z`: gelen (ya da saklı) gövdenin Z'si; `auto`: günün otomasyon durumu (asilpos_day_ends.reportId ve autoValues).
 * Otomatik rapor sayılanı AsilPOS'un sayımından, teslimi 0 yazar (gun-sonu.ts autoValuesOf: AsilPOS'un teslimi gün içinde
 * çıkandadır, sayım ondan sonradır).
 */
export function nextOpeningOf(o: {
  counted: boolean;
  z: Pick<PosDayZ, "countedCash"> | null;
  report: { id: number; countedCash: number; handedOver: number } | null;
  auto: { reportId: number | null; autoValues: AutoValues | null } | null;
}): NextOpening | null {
  if (!o.counted) return null;
  const { report, auto, z } = o;
  if (report) {
    let counted = report.countedCash;
    let handed = report.handedOver;
    const last = auto && auto.reportId === report.id ? auto.autoValues : null;
    if (last && z) {
      // gun-sonu.ts mergeAuto'nun iki alanı (sayılan ve teslim); tests/kasa-zinciri.test.ts ikisinin aynı kaldığını denetler
      if (z.countedCash !== null && same(counted, last.countedCash)) counted = z.countedCash;
      if (same(handed, last.handedOver)) handed = 0;
    }
    // Teslim sayılandan büyükse rapor tutarsız (ör. kişinin yazdığı teslim, birleştirmenin gövdeden aldığı yeni sayım):
    // eksi devir gönderilmez (AsilPOS'ta tutar ≥ 0; eksi değer yanıtı ve devir ucunun gövdesini okunamaz yapar). Null:
    // lafmaliyet bilmiyor, AsilPOS kendi sayımına döner; rapor düzeltilince doğru devir gelir
    const amount = r2(counted - handed);
    return amount < 0 ? null : { amount, source: "kasa_raporu" };
  }
  if (z?.countedCash != null) return { amount: z.countedCash, source: TEL_KAYNAK };
  return null;
}

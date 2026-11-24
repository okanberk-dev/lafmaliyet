import type { AutoValues } from "./gun-sonu";
import type { PosDayZ } from "./day";

/**
 * Kasa zinciri (Faz 3, 23 Kasım 2026; docs/LAFPOS.md › Kasa zinciri): LafPOS günü açarken çekmecedeki nakdi önceki gerçek
 * günün devriyle karşılaştırır. Devir panelde saklanmaz: o günün Kasa raporunun sayılan − teslim edileni
 * (computeCash.carryOver; ertesi günün açılışı formda da ondan dolar). Bu dosya ertesi günün beklenen açılışını
 * (`nextOpening`) verir: `POST /api/pos/gun`'un 200 yanıtı ve `GET /api/panel/pos/devir` aynı nesneyi döner
 * (src/server/lafpos/devir.ts). Saf; testleri tests/kasa-zinciri.test.ts.
 */

/** Ertesi günün beklenen açılışı (TL): `kasa_raporu` panelin Kasa raporundan, `lafpos` rapor yokken LafPOS'un sayımı */
export interface NextOpening {
  amount: number;
  source: "kasa_raporu" | "lafpos";
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const same = (a: unknown, b: unknown) => (typeof a === "number" && typeof b === "number" ? Math.round(a * 100) === Math.round(b * 100) : (a ?? null) === (b ?? null));

/**
 * Günün devri:
 * - gün LafPOS'un sayılan günü değilse (geçiş gününden önce, deneme) null;
 * - günün Kasa raporu varsa sayılan − teslim (`kasa_raporu`). Rapor LafPOS'un elle değişmemiş otomatik raporuysa
 *   (lafpos_day_ends raporu gösteriyor ve otomatik değerleri duruyor) sayılan ve teslim gelen gövdeden, otomatik raporun
 *   birleştirmesiyle (gun-sonu.ts mergeAuto: alan son otomatik değerindeyse yenisi; kişinin düzelttiği alan kalır; yeni
 *   değer boşsa kayıtlı kalır). Otomatik rapor yanıttan sonra yazılır (after()): kayıtlı rapor önceki gönderimin
 *   sayımını taşır, yeniden sayımın yanıtı onu yankılamamalı. Kişinin yazdığı ya da düzelttiği rapor hep geçer. Teslim
 *   sayılandan büyükse (rapor tutarsız) null: eksi devir gönderilmez;
 * - rapor yoksa LafPOS'un sayımı (`lafpos`); sayım da yoksa null.
 *
 * `z`: gelen (ya da saklı) gövdenin Z'si; `auto`: günün otomasyon durumu (lafpos_day_ends.reportId ve autoValues).
 * Otomatik rapor sayılanı LafPOS'un sayımından, teslimi 0 yazar (gun-sonu.ts autoValuesOf: LafPOS'un teslimi gün içinde
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
    // eksi devir gönderilmez (LafPOS'ta tutar ≥ 0; eksi değer yanıtı ve devir ucunun gövdesini okunamaz yapar). Null:
    // lafmaliyet bilmiyor, LafPOS kendi sayımına döner; rapor düzeltilince doğru devir gelir
    const amount = r2(counted - handed);
    return amount < 0 ? null : { amount, source: "kasa_raporu" };
  }
  if (z?.countedCash != null) return { amount: z.countedCash, source: "lafpos" };
  return null;
}

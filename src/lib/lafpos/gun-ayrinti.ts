import { money } from "@/lib/format";

import type { PosDayPush, PosRefund } from "./day";

/**
 * LafPOS gün sonunun Faz 2 ayrıntısı (23 Kasım 2026; docs/LAFPOS.md › Faz 2 alanları): yöneticinin Kasa gün görünümü
 * (src/app/panel/kasa/lafpos-day-card.tsx) ve gün sonu e-postası (gun-sonu.ts dayEndSections) aynı satırları buradan
 * okur. Saf. Eski LafPOS'un gününde alanlar yoktur: satır da yoktur (uydurulmaz).
 *
 * - Yazarkasadan geçmeyen: mali fişi yazarkasada kesilmeyen satış ödemeleri (başka POS, "Başka yoldan aldım"); banka
 *   POS'unun (Pavo) batch'inde ve yazarkasanın Z'sinde yoktur
 * - Ödeme iptalleri: günün iptal edilen ödemeleri (ödeme türünün adıyla; kişi değil)
 * - İptal edilen kalemler: hazırlanmış olan zayi tüketimidir (src/lib/lafpos/ikram.ts iptalWasteLines), hazırlanmamış
 *   yalnız bilgi
 * - Yazarkasa Z no (okcZNo): LafPOS'un Z no'sundan ayrı, kasa raporunun "Yazarkasa Z no"suna otomatik yazılır
 */

export interface LafposDayDetail {
  /** Başlık ve satırlar (etiket, değer); boş bölüm yazılmaz */
  sections: { title: string; rows: [string, string][] }[];
  /** Ödeme iptalleri tek tek (ad ödeme türünün adı) */
  refunds: { name: string; amount: string; reason: string | null }[];
  /** "Düzeltme: gün yeniden açıldı (Geç gelen masa)"; düzeltilmemiş günde null */
  correction: string | null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const sum = (xs: readonly number[]) => r2(xs.reduce((a, v) => a + v, 0));

/** Düzeltmenin metni (yeniden açılış ya da kapandıktan sonra sayım) */
export function correctionText(c: NonNullable<PosDayPush["correction"]>): string {
  const what = c.kind === "reopen" ? "gün yeniden açıldı" : "kapandıktan sonra kasa sayımı değişti";
  return c.reason ? `${what} (${c.reason})` : what;
}

/** Oranın etiketi: "KDV %10" */
const rateLabel = (rate: number) => `KDV %${Number.isInteger(rate) ? rate : rate.toLocaleString("tr-TR")}`;

export function lafposDayDetail(d: Pick<PosDayPush, "z" | "offDevice" | "refunds" | "iptal" | "revision" | "correction">): LafposDayDetail {
  const sections: LafposDayDetail["sections"] = [];
  const pay: [string, string][] = [];
  if (d.offDevice) {
    pay.push(["Yazarkasadan geçmeyen kart", money(d.offDevice.card)], ["Yazarkasadan geçmeyen nakit", money(d.offDevice.cash)]);
  }
  const refunds: PosRefund[] = d.refunds ?? [];
  if (d.refunds) pay.push(["Ödeme iptalleri", refunds.length ? `${refunds.length} · ${money(sum(refunds.map((x) => x.amount)))}` : "yok"]);
  if (pay.length) sections.push({ title: "Ödemeler (LafPOS)", rows: pay });
  if (d.iptal) {
    const prepared = d.iptal.filter((l) => l.prepared);
    const rest = d.iptal.filter((l) => !l.prepared);
    const rows: [string, string][] = [];
    rows.push(["İptal, hazırlanmıştı (zayi)", prepared.length ? `${prepared.length} kalem · ${money(sum(prepared.map((l) => l.listValue)))}` : "yok"]);
    rows.push(["İptal, hazırlanmamıştı", rest.length ? `${rest.length} kalem · ${money(sum(rest.map((l) => l.listValue)))} · tüketim değil` : "yok"]);
    sections.push({ title: "İptal edilen kalemler", rows });
  }
  const fiscal: [string, string][] = [];
  if (d.z.okcZNo !== undefined) fiscal.push(["Yazarkasa Z no", d.z.okcZNo ?? "yok"]);
  for (const v of d.z.vat ?? []) fiscal.push([rateLabel(v.rate), `matrah ${money(v.base)} · KDV ${money(v.vat)}`]);
  if (fiscal.length) sections.push({ title: "Yazarkasa ve KDV", rows: fiscal });
  if (d.revision !== undefined) sections.push({ title: "Gönderim", rows: [["Gönderim", `${d.revision}. gönderim`]] });
  return {
    sections,
    refunds: refunds.map((x) => ({ name: x.name, amount: money(x.amount), reason: x.reason })),
    correction: d.correction ? `Düzeltme: ${correctionText(d.correction)}` : null,
  };
}

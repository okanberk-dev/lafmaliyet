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
 *   yalnız bilgi; kapanmış adisyondan iade (`refund`) ayrı satırda
 * - Yazarkasa Z no (okcZNo): LafPOS'un Z no'sundan ayrı, kasa raporunun "Yazarkasa Z no"suna otomatik yazılır
 * - Kasa açılışı (Faz 3, kasa zinciri): LafPOS'un açılışta beklediği (önceki günün devri), fark ve kasiyerin yazdığı neden
 * - Kasa hareketleri (Faz 3): harcama, teslim ve giriş, türüne göre sayı ve toplam; harcama ve teslim "Kasadan
 *   çıkanlar"a satır satır gelir (src/server/lafpos/cash-moves.ts), giriş yalnız burada görünür
 * - Gün sonu tam (24 Kasım 2026): kasaya giren nakdin parçaları (giriş, nakit bahşiş, cari tahsilatı), yazarkasanın cihaz
 *   belgeleri (belge sayısı, tutar, cihazda iptal), LafPOS'un kapanış notu, föyde sayılan, vardiya devri sayımları ve
 *   indirim satırları
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

/** İşaretli tutar: "+100 ₺", "−20,50 ₺", "0 ₺" */
const signedMoney = (v: number) => (v > 0 ? `+${money(v)}` : v < 0 ? `−${money(-v)}` : money(0));

/** Tahsilatın satır adı ödeme alanına göre */
const COLLECTION_LABEL: Record<string, string> = {
  cash: "Nakit tahsilat (cari)",
  card: "Kartla tahsilat (cari)",
  meal_card: "Yemek kartıyla tahsilat (cari)",
  online: "Online tahsilat (cari)",
  other: "Diğer tahsilat (cari)",
};

export function lafposDayDetail(
  d: Pick<PosDayPush, "z" | "offDevice" | "refunds" | "iptal" | "revision" | "correction" | "cashMoves"> & Partial<Pick<PosDayPush, "okc" | "collections" | "shiftCounts" | "discountLines">>,
): LafposDayDetail {
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
    // Kapanmış adisyondan iade (`refund`, hazırlanmamış): hazırlanmamış iptalle karışmaz, ayrı satırda (son denetim, 24
    // Kasım 2026). Hazırlanmış iade zayi tüketimidir (iptalWasteLines), orada kalır
    const refunded = d.iptal.filter((l) => !l.prepared && l.refund);
    const rest = d.iptal.filter((l) => !l.prepared && !l.refund);
    const rows: [string, string][] = [];
    rows.push(["İptal, hazırlanmıştı (zayi)", prepared.length ? `${prepared.length} kalem · ${money(sum(prepared.map((l) => l.listValue)))}` : "yok"]);
    rows.push(["İptal, hazırlanmamıştı", rest.length ? `${rest.length} kalem · ${money(sum(rest.map((l) => l.listValue)))} · tüketim değil` : "yok"]);
    if (refunded.length) rows.push(["İade (kapanmış adisyondan)", `${refunded.length} kalem · ${money(sum(refunded.map((l) => l.listValue)))}`]);
    sections.push({ title: "İptal edilen kalemler", rows });
  }
  const fiscal: [string, string][] = [];
  if (d.z.okcZNo !== undefined) fiscal.push(["Yazarkasa Z no", d.z.okcZNo ?? "yok"]);
  // Gün sonu tam: yazarkasanın cihaz belgeleri (kasa raporunun yazarkasa alanları bunlardan)
  if (d.okc) {
    fiscal.push(["Cihaz belgesi", `${d.okc.docs} belge · ${money(d.okc.total)}`]);
    if (d.okc.voided.count) fiscal.push(["Cihazda iptal", `${d.okc.voided.count} · ${money(sum([d.okc.voided.cash, d.okc.voided.card]))}`]);
  }
  for (const v of d.z.vat ?? []) fiscal.push([rateLabel(v.rate), `matrah ${money(v.base)} · KDV ${money(v.vat)}`]);
  if (fiscal.length) sections.push({ title: "Yazarkasa ve KDV", rows: fiscal });
  // Kasa zinciri (Faz 3): beklenen bilinmiyorsa (önceki gerçek gün yok) yalnız o satır
  if (d.z.expectedOpening !== undefined) {
    const opening: [string, string][] = [["Beklenen açılış", d.z.expectedOpening === null ? "bilinmiyor" : money(d.z.expectedOpening)]];
    if (d.z.expectedOpening !== null && d.z.openingDiff != null) opening.push(["Açılış farkı", signedMoney(d.z.openingDiff)]);
    if (d.z.openingReason) opening.push(["Farkın nedeni", d.z.openingReason]);
    sections.push({ title: "Kasa açılışı (LafPOS)", rows: opening });
  }
  if (d.cashMoves) {
    const of = (kind: string) => {
      const ms = d.cashMoves!.filter((m) => m.kind === kind);
      return ms.length ? `${ms.length} · ${money(sum(ms.map((m) => m.amount)))}` : "yok";
    };
    sections.push({
      title: "Kasa hareketleri (LafPOS)",
      rows: [
        ["Harcama", of("harcama")],
        ["Teslim", of("teslim")],
        ["Kasaya giren (giriş)", of("giris")],
      ],
    });
  }
  // Gün sonu tam: kasaya giren nakdin parçaları (z.cashIn = giriş + nakit tahsilat + nakit bahşiş) ve kartla tahsilat
  if (d.z.cashTips !== undefined || d.collections) {
    const rows: [string, string][] = [];
    if (d.z.cashTips) rows.push(["Nakit bahşiş", money(d.z.cashTips)]);
    for (const field of ["cash", "card", "meal_card", "online", "other"] as const) {
      const cs = (d.collections ?? []).filter((c) => c.zField === field);
      if (cs.length) rows.push([COLLECTION_LABEL[field], `${cs.reduce((a, c) => a + c.count, 0)} · ${money(sum(cs.map((c) => c.amount)))}`]);
    }
    if (rows.length) sections.push({ title: "Kasaya giren ve tahsilat (LafPOS)", rows });
  }
  // Kapanış: LafPOS'un notu, föyde ödeme türü başına sayılan (bilgi; Banka POS'u doldurmaz) ve vardiya devri sayımları
  const close: [string, string][] = [];
  if (d.z.closeNote) close.push(["Kapanış notu", d.z.closeNote]);
  for (const m of d.z.methodCounts ?? []) close.push([`Föyde sayılan · ${m.name}`, money(m.counted)]);
  (d.shiftCounts ?? []).forEach((c, k) => close.push([`Vardiya devri ${k + 1}`, `sayılan ${money(c.counted)} · fark ${signedMoney(c.diff)}${c.confirmed ? "" : " · onaylanmadı"}`]));
  if (close.length) sections.push({ title: "Kapanış (LafPOS)", rows: close });
  if (d.discountLines?.length) {
    const withReason = d.discountLines.filter((l) => l.reason);
    sections.push({
      title: "İndirimler (LafPOS)",
      rows: [
        ["İndirim satırı", `${d.discountLines.length} · ${money(sum(d.discountLines.map((l) => l.amount)))}`],
        ...withReason.slice(0, 10).map((l, k): [string, string] => [`${k + 1}. ${l.reason}`, money(l.amount)]),
      ],
    });
  }
  if (d.revision !== undefined) sections.push({ title: "Gönderim", rows: [["Gönderim", `${d.revision}. gönderim`]] });
  return {
    sections,
    refunds: refunds.map((x) => ({ name: x.name, amount: money(x.amount), reason: x.reason })),
    correction: d.correction ? `Düzeltme: ${correctionText(d.correction)}` : null,
  };
}

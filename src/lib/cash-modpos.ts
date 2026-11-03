import { computeCash, type CashReportFields } from "@/lib/cash-report";
import { money, num } from "@/lib/format";
import { modposCompare, modposDiffs, type ModposCompareRow, type ModposDiff, type ModposSavedFields } from "@/lib/modpos/compare";
import { MODPOS_UYARI, type FoyAraKasa, type FoyGider, type FoyOdeme, type FoyTahsilat, type KasaFoyu } from "@/lib/modpos/foy";
import { timeText } from "@/lib/modpos/status";
import { foyWarnings, type ModposSheetPrevious, type ModposZ } from "@/lib/modpos/z";

/**
 * Yöneticinin Kasa ekranındaki ModPOS kasa föyünün metinleri ve kuralları (saf; docs/MODPOS-API.md › Nerede görünür;
 * tests/modpos-kasa.test.ts). Gün görünümünün "ModPOS kasa föyü" kartı ve günden güne listesinin rozeti buradan okur;
 * karşılaştırmanın kendisi çekirdekte (src/lib/modpos/compare.ts). Yalnız yöneticiye çizilir: personelin hiçbir
 * yüküne girmez (WhatsApp, e-posta ve personelin sayfası föyü bilmez).
 *
 * Gün açıkken alınan föy (Ayarlar'da bugünü "Bu günü çek", ya da kapanmamış kasa) o anki tutarlardır: rapora göre
 * "farklı" sayılmaz, tabloda bilgi olarak görünür; ertesi sabah kesin föy gelince karşılaştırılır.
 */

/** Raporun föyle karşılaştırılan alanları (kayıtlı rapor ya da DTO) */
export type ModposReportFields = Pick<
  CashReportFields,
  "zNo" | "receipts" | "zTotal" | "cash" | "card" | "mealCard" | "online" | "other" | "offRevenue" | "openingCash" | "cashIn" | "cashOut" | "countedCash" | "handedOver" | "bankPos" | "okcCard"
>;

/** Saklanan föyün kartta okunan kısmı (src/server/modpos/store.ts › ModposSheet) */
export interface ModposSheetView {
  state: "KAPALI" | "ACIK" | "BOS";
  final: boolean;
  revision: number;
  previous: ModposSheetPrevious | null;
  fetchedAt: string;
  foy: KasaFoyu;
}

/**
 * Raporun karşılaştırma girdisi: Z ve kasa alanları, olması gereken nakit ve kasa farkı formun hesabından (computeCash;
 * kayıtlı cashDiff'in kaynağı da odur)
 */
export function modposSavedOf(r: ModposReportFields): ModposSavedFields & { expectedCash: number; cashDiff: number } {
  const c = computeCash(r);
  return {
    zNo: r.zNo,
    receipts: r.receipts,
    zTotal: r.zTotal,
    cash: r.cash,
    card: r.card,
    mealCard: r.mealCard,
    online: r.online,
    other: r.other,
    offRevenue: r.offRevenue,
    openingCash: r.openingCash,
    cashIn: r.cashIn,
    cashOut: r.cashOut,
    countedCash: r.countedCash,
    expectedCash: c.expectedCash,
    cashDiff: c.cashDiff,
  };
}

/** Föy rapora göre karşılaştırılır mı: bütün kasalar kapalı (gün açıkken alınan föyün tutarları o anki) */
export function modposComparable(z: ModposZ): boolean {
  return z.durum === "KAPALI";
}

/** Raporda farklı yazılan alanlar; rapor yoksa ya da föy gün açıkken alındıysa boş */
export function modposReportDiffs(report: ModposReportFields | null, z: ModposZ): ModposDiff[] {
  return report && modposComparable(z) ? modposDiffs(modposSavedOf(report), z) : [];
}

/**
 * Kartın tablosu (Alan | Kasa raporu | ModPOS föyü | Fark): çekirdeğin satırları; gün açıkken alınan föyde "farklı"
 * satırlar bilgi olur (uyarı rengi yok)
 */
export function modposTableRows(report: ModposReportFields | null, z: ModposZ): ModposCompareRow[] {
  const rows = modposCompare(report ? modposSavedOf(report) : null, z);
  return modposComparable(z) ? rows : rows.map((r) => (r.tone === "diff" ? { ...r, tone: "info" as const } : r));
}

/**
 * Günden güne listesinin bir günü (yalnız yöneticiye; tarihe göre): föyün cirosu (raporu girilmemiş günün satırı),
 * raporda farklı yazılanlar ("ModPOS'tan farklı" rozeti ve gün ayrıntısındaki liste) ve föy gün açıkken mi alındı
 */
export interface ModposDayView {
  zTotal: number;
  diffs: ModposDiff[];
  open: boolean;
}

export function modposDayView(report: ModposReportFields | null, z: ModposZ): ModposDayView {
  return { zTotal: z.zTotal, diffs: modposReportDiffs(report, z), open: !modposComparable(z) };
}

const STATE_TEXT: Record<ModposSheetView["state"], string> = { KAPALI: "Kapalı", ACIK: "Açık", BOS: "Kasa açılmamış" };

/** "Kapalı", "Kapalı (06:00'da kendiliğinden)", "Açık", "Kasa açılmamış" */
export function modposStateText(state: ModposSheetView["state"], z: ModposZ | null): string {
  return state === "KAPALI" && z?.otomatikKapandi ? "Kapalı (06:00'da kendiliğinden)" : STATE_TEXT[state];
}

/** Kartın başlık satırı: "Z 0312 · Kapalı · Kesin (alındı: bugün 08:02)"; birden çok kasada "2 kasa" */
export function modposHeadline(sheet: Pick<ModposSheetView, "state" | "final" | "fetchedAt">, z: ModposZ | null, now: Date): string {
  const parts: string[] = [];
  if (z?.zNo) parts.push(`Z ${z.zNo}`);
  else if (z && z.kasaSayisi > 1) parts.push(`${z.kasaSayisi} kasa`);
  parts.push(modposStateText(sheet.state, z));
  parts.push(`${sheet.final ? "Kesin" : "Kesin değil"} (alındı: ${timeText(sheet.fetchedAt, now)})`);
  return parts.join(" · ");
}

/**
 * Föy olmayan günün satırı: bugün için yarın sabah; geçmiş gün için sabah işi (dün + bir geçmiş gün) ya da Ayarlar'dan
 * elle çekim (docs/MODPOS-API.md › Kota ve çekme sırası)
 */
export function modposMissingText(date: string, today: string): string {
  return date >= today
    ? "Bugünün föyü yarın sabah 08:00'de gelir (Ayarlar › ModPOS kasa föyü'nden de çekilebilir)."
    : "Her sabah 08:00'de dünün föyü gelir (Ayarlar › ModPOS kasa föyü'nden de çekilebilir).";
}

/** İşaretli tutar: "+120 ₺", "−20 ₺", "0 ₺" */
export function signedMoney(v: number): string {
  const r = Math.round(v * 100) / 100;
  return r > 0 ? `+${money(r)}` : r < 0 ? `−${money(-r)}` : money(0);
}

/** Tablonun hücresi: tutar para biçiminde, sayı ve metin olduğu gibi, yoksa "–" */
export function modposCell(v: number | string | null, isMoney: boolean): string {
  if (v === null) return "–";
  return isMoney && typeof v === "number" ? money(v) : typeof v === "number" ? num(v) : v;
}

/** ModPOS'un uyarıları (kasalardan, tekilleştirilmiş): bilinen kodun Türkçesi, bilinmeyenin servis mesajı, tutarıyla */
export function modposWarningTexts(foy: KasaFoyu): string[] {
  return foyWarnings(foy).map((u) => {
    const known = Object.hasOwn(MODPOS_UYARI, u.kod) ? MODPOS_UYARI[u.kod as keyof typeof MODPOS_UYARI] : null;
    return `${known ?? u.mesaj}${u.tutar !== null ? `: ${signedMoney(u.tutar)}` : ""}`;
  });
}

const CLOCK = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "17:12" (Türkiye); zaman yoksa null */
export function modposClock(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? null : CLOCK.format(t);
}

/**
 * Ödeme yönteminin alt satırı: cari tahsilat, sistem ve defter ("cari tahsilat 1.500 ₺ · sistem 17.620,50 ₺ · defter
 * 17.620,50 ₺"); defter girilmediyse "defter girilmedi", ciroya dahil değilse söylenir. Defter farkı ayrı
 * (modposPaymentGap): sıfırdan farklıysa kartta turuncu yazılır
 */
export function modposPaymentDetail(o: FoyOdeme): string {
  const parts: string[] = [];
  if (!o.ciroyaDahil) parts.push("ciroya dahil değil");
  if (Math.abs(o.cariTahsilat) >= 0.01) parts.push(`cari tahsilat ${money(o.cariTahsilat)}`, `sistem ${money(o.sistem)}`);
  parts.push(o.defter === null ? "defter girilmedi" : `defter ${money(o.defter)}`);
  return parts.join(" · ");
}

/** Defter − sistem ("fark −20 ₺"; eksi: açık); defter yoksa null, `off`: 1 kuruştan büyük */
export function modposPaymentGap(o: FoyOdeme): { text: string; off: boolean } | null {
  return o.fark === null ? null : { text: `fark ${signedMoney(o.fark)}`, off: Math.abs(o.fark) >= 0.01 };
}

/** Kırılım satırı: "Garanti BBVA 9.800 ₺ · Akbank 6.320,50 ₺" (yoksa null) */
export function modposBreakdownText(o: FoyOdeme): string | null {
  return o.kirilim.length ? o.kirilim.map((k) => `${k.ad} ${money(k.tutar)}`).join(" · ") : null;
}

/** Gider satırının adı: "Market · Temizlik malzemesi" */
export function modposExpenseLabel(g: FoyGider): string {
  return [g.kategori ?? "Kategorisiz", g.aciklama].filter(Boolean).join(" · ");
}

/** Cari tahsilatın satırı (müşterinin adı föyde yok, KVKK): "Kredi Kartı · 17:12" */
export function modposCollectionLabel(t: FoyTahsilat): string {
  return [t.yontem ?? "Yöntem yok", modposClock(t.zaman)].filter(Boolean).join(" · ");
}

/** Ara kasanın satırı: "1. ara kasa · 15:00 · ciro 11.200 ₺ · nakit 3.400 ₺ · 88 adisyon · gider 320 ₺ · beklenen … · sayılan … · fark 0 ₺" */
export function modposAraKasaText(a: FoyAraKasa): string {
  const m = (label: string, v: number | null) => (v === null ? null : `${label} ${money(v)}`);
  return [
    a.no !== null ? `${a.no}. ara kasa` : "Ara kasa",
    modposClock(a.zaman),
    m("ciro", a.ciro),
    m("nakit", a.nakit),
    a.adisyonSayisi !== null ? `${num(a.adisyonSayisi)} adisyon` : null,
    m("gider", a.gider),
    m("beklenen", a.beklenen),
    m("sayılan", a.sayilan),
    a.fark !== null ? `fark ${signedMoney(a.fark)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Kişi sayısı, bahşiş ve kartla alınan cari tahsilat (bilgi; föysüz günde yok) */
export function modposServiceLine(z: ModposZ): string | null {
  if (z.foysuz) return null;
  const parts = [z.covers !== null ? `Kişi sayısı ${num(z.covers)}` : null, `bahşiş ${money(z.tips)}`];
  if (Math.abs(z.cardCollections) >= 0.01) parts.push(`kartla cari tahsilat ${money(z.cardCollections)} (banka POS'unda var, Z'nin kartında yok)`);
  const t = parts.filter(Boolean).join(" · ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Sayım olmayan günün nedeni (tablonun altında; föysüz günü föysüz satırı söyler) */
export function modposNoCountText(z: ModposZ): string | null {
  if (z.noCount === "acik") return "Sayım yok: föy alındığında gün açıktı.";
  if (z.noCount === "otomatik") return "Sayım yok: gün 06:00'da kendiliğinden kapandı (ModPOS defterdeki nakdi yazar).";
  return null;
}

/** Kasası açılmamış satış: gün föysüzse tutarların kaynağı, kasa açıkken gelen föysüz satış (başka şube) ayrıca */
export function modposFoysuzText(z: ModposZ): string | null {
  if (z.foysuz) return "Kasa açılmadan satış yapılmış: tutarlar föysüz satıştan, açılış ve sayım yok.";
  if (Math.abs(z.foysuzCiro) >= 0.01) return `Kasası açılmamış satış da var: ciro ${money(z.foysuzCiro)}; yukarıdaki toplamlara girmez.`;
  return null;
}

/** Tanınmayan ödeme kodları (belge §6: "diğer" sayılır) */
export function modposUnknownCodesText(z: ModposZ): string | null {
  return z.unknownCodes.length ? `Tanınmayan ödeme kodu: ${z.unknownCodes.join(", ")}; ciroya dahilse Diğer'e sayıldı.` : null;
}

/**
 * Föy kendi içinde tutmuyor (ödemelerin ciroya dahil toplamı ≠ ciro; docs/MODPOS-API.md › Eşleme): uyarının başlığı,
 * 1 kuruştan küçük farkta null
 */
export function modposGapTitle(z: ModposZ): string | null {
  if (Math.abs(z.paymentsGap) < 0.01) return null;
  return `ModPOS föyünde ödemeler cirodan ${money(Math.abs(z.paymentsGap))} ${z.paymentsGap > 0 ? "fazla" : "eksik"}`;
}

const PREVIOUS_FIELDS = [
  ["cash", "nakit"],
  ["card", "kart"],
  ["mealCard", "yemek kartı"],
  ["online", "online"],
  ["other", "diğer"],
  ["offRevenue", "ödenmez / ikram"],
  ["countedCash", "sayılan nakit"],
] as const;

/**
 * Föy değiştiyse (sürüm > 1) önceki sürümle farkı: "Önceki sürüm (dün 23:10): toplam satış 12.400 ₺ → 11.900 ₺ ·
 * nakit … → …". Toplam satış her zaman yazılır (değişmediyse "değişmedi"); öteki alanlar yalnız değiştiyse.
 */
export function modposPreviousLine(sheet: Pick<ModposSheetView, "revision" | "previous" | "state">, z: ModposZ | null, now: Date): string | null {
  const p = sheet.previous;
  if (sheet.revision <= 1 || !p) return null;
  const cur = {
    zTotal: z?.zTotal ?? 0,
    cash: z?.cash ?? 0,
    card: z?.card ?? 0,
    mealCard: z?.mealCard ?? 0,
    online: z?.online ?? 0,
    other: z?.other ?? 0,
    offRevenue: z?.offRevenue ?? 0,
    receipts: z?.receipts ?? 0,
    countedCash: z?.countedCash ?? null,
  };
  const same = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 0.01);
  const parts = [same(p.zTotal, cur.zTotal) ? `toplam satış ${money(cur.zTotal)}, değişmedi` : `toplam satış ${money(p.zTotal)} → ${money(cur.zTotal)}`];
  if (p.state !== sheet.state) parts.push(`durum ${STATE_TEXT[p.state].toLocaleLowerCase("tr")} → ${STATE_TEXT[sheet.state].toLocaleLowerCase("tr")}`);
  for (const [k, label] of PREVIOUS_FIELDS) if (!same(p[k], cur[k])) parts.push(`${label} ${p[k] === null ? "–" : money(p[k])} → ${cur[k] === null ? "–" : money(cur[k])}`);
  if (p.receipts !== cur.receipts) parts.push(`fiş sayısı ${num(p.receipts)} → ${num(cur.receipts)}`);
  return `Önceki sürüm (${timeText(p.fetchedAt, now)} alınan): ${parts.join(" · ")}`;
}

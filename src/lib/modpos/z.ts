import { dayRevenue } from "@/lib/cash-revenue";
import { asilposChannel, type ChannelKey } from "@/lib/commission/channels";

import type { FoyKasa, FoyOdeme, KasaFoyu } from "./foy";

/**
 * Kasa föyü → kasa raporunun ModPOS Z ve kasa alanları (saf; docs/MODPOS-API.md › Eşleme; tests/modpos-foy.test.ts).
 *
 * Ödeme kodları (docs/modpos-kasa-foyu-api.md §6) formun beş ödeme alanına dağılır; ciroya dahil olmayanlar (ikram,
 * ödenmez, hediye kartı, sadakat ikramı, değişim mahsubu, zayi) ödeme değildir, "Ödenmez / ikram" föyün `ciroDisi`'sidir.
 * Tanınmayan kod belgenin dediği gibi "diğer" sayılır (ciroya dahilse Diğer'e, değilse hiçbir alana). Bir günde birden
 * çok kasa (ya da şube) varsa tutarlar toplanır, Z no yalnız tek kasada yazılır.
 */

/** Formun ödeme alanı; `off`: ciroya dahil değil (ödeme alanına girmez) */
export type ModposBucket = "cash" | "card" | "mealCard" | "online" | "other" | "off";

const BUCKETS: Record<string, ModposBucket> = {
  NAKIT: "cash",
  KREDI_KARTI: "card",
  YEMEK_KARTI: "mealCard",
  MULTINET: "mealCard",
  PLUXEE: "mealCard",
  SODEXO: "mealCard",
  SETCARD: "mealCard",
  EDENRED: "mealCard",
  TOKENFLEX: "mealCard",
  PAYE: "mealCard",
  METROPOL: "mealCard",
  ONLINE_WEB: "online",
  TRENDYOL_ONLINE: "online",
  YEMEK_SEPETI_ONLINE: "online",
  MIGROS_YEMEK_ONLINE: "online",
  GETIR_ONLINE: "online",
  // Ciroya dahil, kart / yemek kartı / online olmayanlar: Diğer
  MOBIL_ODEME: "other",
  HAVALE: "other",
  CARI_HESAP: "other",
  FIYUU: "other",
  SADAKAT_PUANI: "other",
  // Ciroya dahil olmayanlar
  IKRAM: "off",
  ODENMEZ: "off",
  HEDIYE_KARTI: "off",
  SADAKAT_IKRAMI: "off",
  DEGISIM_MAHSUBU: "off",
  ZAYI: "off",
};

/** Belgede adı geçen kodlar (tanınmayan kod uyarı satırına çıkar) */
export const KNOWN_CODES: ReadonlySet<string> = new Set([...Object.keys(BUCKETS), "DIGER"]);

/** Ödemenin formdaki alanı: kod tanınıyorsa koddan, tanınmıyorsa (ve DIGER) `ciroyaDahil`'e göre Diğer ya da hiçbiri */
export function modposBucket(o: Pick<FoyOdeme, "kod" | "ciroyaDahil">): ModposBucket {
  const b = BUCKETS[o.kod];
  if (b) return b;
  return o.ciroyaDahil ? "other" : "off";
}

/** Komisyon kanalı kodu (yemek kartı firmaları ve platformlar); Sodexo'nun yeni adı Pluxee */
const CHANNELS: Record<string, ChannelKey> = {
  MULTINET: "multinet",
  PLUXEE: "pluxee",
  SODEXO: "pluxee",
  SETCARD: "setcard",
  EDENRED: "edenred",
  METROPOL: "metropol",
  TRENDYOL_ONLINE: "trendyol",
  YEMEK_SEPETI_ONLINE: "yemeksepeti",
  MIGROS_YEMEK_ONLINE: "migros",
  GETIR_ONLINE: "getir",
};

/**
 * Ödemenin komisyon kanalı: koddan (MULTINET → multinet), genel "Yemek Kartı"da kırılımın adından ("Pluxee")
 * kırılım kırılım. Kanalı olmayan (nakit, kart, Tokenflex, Paye, laffogato.net) null.
 */
export function modposChannels(o: FoyOdeme): { channel: ChannelKey | null; amount: number }[] {
  const direct = CHANNELS[o.kod];
  if (direct) return [{ channel: direct, amount: o.satis }];
  if (o.kod === "YEMEK_KARTI" && o.kirilim.length) {
    const parts = o.kirilim.map((k) => ({ channel: asilposChannel(k.ad), amount: k.tutar }));
    const rest = round2(o.satis - parts.reduce((a, p) => a + p.amount, 0));
    return Math.abs(rest) >= 0.01 ? [...parts, { channel: null, amount: rest }] : parts;
  }
  return [{ channel: asilposChannel(o.yontem), amount: o.satis }];
}

const round2 = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
};

/** Föyün formun diline çevrilmiş özeti: kasa raporunun ModPOS Z alanları ve kasa alanları (TL) */
export interface ModposZ {
  kasaGunu: string;
  kasaSayisi: number;
  /** Bütün kasalar kapalıysa KAPALI */
  durum: "KAPALI" | "ACIK";
  otomatikKapandi: boolean;
  /** Tek kasada Z no; birden çok kasada null */
  zNo: string | null;
  receipts: number;
  zTotal: number;
  cash: number;
  card: number;
  mealCard: number;
  online: number;
  other: number;
  /** Ödenmez / ikram (föyün ciroDisi'si) */
  offRevenue: number;
  openingCash: number;
  /** Kasadan çıkan: föyün giderleri */
  cashOut: number;
  /** Gün içinde kasaya giren: nakit cari tahsilat */
  cashIn: number;
  /** Sayılan nakit: yalnız Z raporuna dayanan sayım (gün açık ya da kendiliğinden kapandıysa null) */
  countedCash: number | null;
  /** ModPOS'un olması gereken nakdi (açılış + nakit + nakit cari tahsilat − gider) */
  expectedCash: number | null;
  /** ModPOS'un kasa farkı (sayılan − beklenen) */
  cashDiff: number | null;
  /** Kartla alınan cari tahsilat: banka POS'unda var, Z'nin kartında yok */
  cardCollections: number;
  /** Bahşiş, kişi sayısı (bilgi) */
  tips: number;
  covers: number | null;
  /** Sayım yoksa nedeni: gün açık (CANLI), kendiliğinden kapandı (defterdeki nakit) ya da kasa hiç açılmadı (föysüz) */
  noCount: "acik" | "otomatik" | "foysuz" | null;
  /**
   * Ödemelerin ciroya dahil toplamı − günün cirosu (sıfırdan farklıysa föy kendi içinde tutmuyor). Ciro dayRevenue'nün
   * kuralıyla (KP-08): ödemeler ciroyu ya da ciro − ödenmez'i tutuyorsa 0; ikisini de tutmuyorsa ödemeler − ciro
   */
  paymentsGap: number;
  /** Tanınmayan ödeme kodları */
  unknownCodes: string[];
  /** Kasa açılmamış, tutarlar föysüz satıştan */
  foysuz: boolean;
  /** Föysüz satışın cirosu (kasa açıkken toplamlara girmez; bilgi) */
  foysuzCiro: number;
}

function sumKasa(list: FoyKasa[], f: (k: FoyKasa) => number): number {
  return round2(list.reduce((a, k) => a + f(k), 0));
}

/**
 * Föyün Z özeti. Kasa açılmamış ama satış yapılmış gün ("föysüz gün", belge §5.1) kasasız Z'dir: tutarlar föysüz
 * satıştan, kasa alanları boş (`foysuz: true`). Kasa da föysüz satış da yoksa (satışsız gün) null. Kasa açılmışken gelen
 * föysüz satış (başka bir şube) toplamlara girmez, `foysuzCiro`'da ayrıca görünür.
 */
export function foyZ(foy: KasaFoyu): ModposZ | null {
  const ks = foy.kasalar;
  const foysuzCiro = round2(foy.foysuzGunler.reduce((a, f) => a + f.ciro, 0));
  if (!ks.length) return foysuzCiro !== 0 || foy.foysuzGunler.some((f) => (f.adisyonSayisi ?? 0) > 0) ? foysuzZ(foy, foysuzCiro) : null;
  const by = (b: ModposBucket) => sumKasa(ks, (k) => k.odemeler.filter((o) => modposBucket(o) === b).reduce((a, o) => a + o.satis, 0));
  const zTotal = sumKasa(ks, (k) => k.satis.ciro);
  const cash = by("cash");
  const card = by("card");
  const mealCard = by("mealCard");
  const online = by("online");
  const other = by("other");
  const durum = ks.every((k) => k.durum === "KAPALI") ? "KAPALI" : "ACIK";
  const auto = ks.some((k) => k.otomatikKapandi || k.nakitKasa?.dayanak === "OTOMATIK_KAPANIS");
  // Sayım yalnız Z raporuna dayanan kasada vardır; birinde yoksa toplam sayım da yok
  const counted = ks.every((k) => k.nakitKasa?.dayanak === "Z_RAPORU" && k.nakitKasa.sayilan !== null);
  const expectedKnown = ks.every((k) => k.nakitKasa?.beklenen !== null && k.nakitKasa?.beklenen !== undefined);
  const unknown = [...new Set(ks.flatMap((k) => k.odemeler.map((o) => o.kod)).filter((c) => !KNOWN_CODES.has(c)))];
  return {
    kasaGunu: foy.kasaGunu,
    kasaSayisi: ks.length,
    durum,
    otomatikKapandi: auto,
    zNo: ks.length === 1 ? ks[0].zNo : null,
    receipts: ks.reduce((a, k) => a + k.satis.adisyonSayisi, 0),
    zTotal,
    cash,
    card,
    mealCard,
    online,
    other,
    offRevenue: sumKasa(ks, (k) => k.satis.ciroDisi),
    openingCash: sumKasa(ks, (k) => k.nakitKasa?.acilis ?? k.acilis.nakit ?? 0),
    cashOut: sumKasa(ks, (k) => k.nakitKasa?.gider ?? k.giderler.toplam),
    cashIn: sumKasa(ks, (k) => k.nakitKasa?.nakitCariTahsilat ?? k.cariTahsilatlar.nakit),
    countedCash: counted ? sumKasa(ks, (k) => k.nakitKasa!.sayilan!) : null,
    expectedCash: expectedKnown ? sumKasa(ks, (k) => k.nakitKasa!.beklenen!) : null,
    cashDiff: counted && ks.every((k) => k.nakitKasa!.fark !== null) ? sumKasa(ks, (k) => k.nakitKasa!.fark!) : null,
    cardCollections: sumKasa(ks, (k) => k.odemeler.filter((o) => modposBucket(o) === "card").reduce((a, o) => a + o.cariTahsilat, 0)),
    tips: sumKasa(ks, (k) => k.satis.bahsis),
    covers: ks.every((k) => k.satis.kisiSayisi !== null) ? ks.reduce((a, k) => a + (k.satis.kisiSayisi ?? 0), 0) : null,
    noCount: counted ? null : durum === "ACIK" ? "acik" : auto ? "otomatik" : null,
    paymentsGap: paymentsGap(cash + card + mealCard + online + other, zTotal, sumKasa(ks, (k) => k.satis.ciroDisi)),
    unknownCodes: unknown,
    foysuz: false,
    foysuzCiro,
  };
}

/**
 * Föyün kendi içinde tutmama farkı: ödemeler − günün cirosu. Ciro ödenmezi içeriyorsa (ödemeler = ciro − ödenmez;
 * docs/MODPOS-API.md § 4) gün tutarlıdır, form ve kayıtlı rapor gibi (src/lib/cash-revenue.ts dayRevenue; KP-08)
 */
function paymentsGap(payments: number, zTotal: number, offRevenue: number): number {
  return round2(payments - dayRevenue({ zTotal, offRevenue, payments: round2(payments) }).revenue);
}

/**
 * Föysüz satışın ödemesinin alanı: ciroyaDahil gelmediyse (belge yazmaz) tanınmayan kod ve DIGER Diğer'dir (ciroya
 * dahil); geldiyse ödeme satırınınki gibi (modposBucket). Z özeti de ödenmez / ikram dökümü de bunu kullanır
 */
export function foysuzBucket(o: { kod: string; ciroyaDahil?: boolean }): ModposBucket {
  return o.ciroyaDahil === undefined ? (BUCKETS[o.kod] ?? "other") : modposBucket({ kod: o.kod, ciroyaDahil: o.ciroyaDahil });
}

/** Kasasız gün: föysüz satışın ödemeleri kodlarına göre (ciroya dahil bilgisi yok: tanınmayan kod Diğer) */
function foysuzZ(foy: KasaFoyu, zTotal: number): ModposZ {
  const pays = foy.foysuzGunler.flatMap((f) => f.odemeler);
  const by = (b: ModposBucket) => round2(pays.filter((o) => foysuzBucket(o) === b).reduce((a, o) => a + o.tutar, 0));
  const cash = by("cash");
  const card = by("card");
  const mealCard = by("mealCard");
  const online = by("online");
  const other = by("other");
  return {
    kasaGunu: foy.kasaGunu,
    kasaSayisi: 0,
    durum: "KAPALI",
    otomatikKapandi: false,
    zNo: null,
    receipts: foy.foysuzGunler.reduce((a, f) => a + (f.adisyonSayisi ?? 0), 0),
    zTotal,
    cash,
    card,
    mealCard,
    online,
    other,
    offRevenue: by("off"),
    openingCash: 0,
    cashOut: 0,
    cashIn: 0,
    countedCash: null,
    expectedCash: null,
    cashDiff: null,
    cardCollections: 0,
    tips: 0,
    covers: null,
    noCount: "foysuz",
    paymentsGap: paymentsGap(cash + card + mealCard + online + other, zTotal, by("off")),
    unknownCodes: [...new Set(pays.map((o) => o.kod).filter((c) => !KNOWN_CODES.has(c)))],
    foysuz: true,
    foysuzCiro: zTotal,
  };
}

/**
 * Saklanan föyün karşılaştırmaya giren Z'si: kasasız (föysüz) föy kesinleşmeden alındıysa (gün içinde "Bu günü çek")
 * gün sürüyor sayılır (durum ACIK): akşamki raporla karşılaştırılmaz, ertesi sabah kesin föy gelir
 */
export function sheetZ(sheet: { foy: KasaFoyu; final?: boolean }): ModposZ | null {
  const z = foyZ(sheet.foy);
  return z && z.foysuz && sheet.final === false ? { ...z, durum: "ACIK" } : z;
}

/** Günün bütün uyarı kodları (kasalardan, tekilleştirilmiş, sıralı) */
export function foyWarnings(foy: KasaFoyu): { kod: string; mesaj: string; tutar: number | null }[] {
  const seen = new Map<string, { kod: string; mesaj: string; tutar: number | null }>();
  for (const k of foy.kasalar)
    for (const u of k.uyarilar) {
      const prev = seen.get(u.kod);
      seen.set(u.kod, prev ? { ...prev, tutar: prev.tutar === null || u.tutar === null ? (prev.tutar ?? u.tutar) : round2(prev.tutar + u.tutar) } : { ...u });
    }
  return [...seen.values()];
}

/** Kasa günü kesin mi: bütün kasalar kapalı ve föy günün ertesi sabahı 07:00'den (TR) sonra hazırlandı (belge §8) */
export function isFinalFoy(foy: KasaFoyu, fetchedAt: Date): boolean {
  if (!foy.kasalar.every((k) => k.durum === "KAPALI")) return false;
  return fetchedAt.getTime() >= finalAfter(foy.kasaGunu);
}

/** Kasa gününün kesinleştiği an: ertesi gün 07:00 TR (04:00 UTC; Türkiye'de yaz saati yok) */
export function finalAfter(day: string): number {
  return Date.parse(`${day}T04:00:00Z`) + 24 * 3600_000;
}

/** Değişen föyün önceki sürümünün kısa özeti (modpos_cash_sheets.previous; yalnız sonuncusu) */
export interface ModposSheetPrevious {
  /** Önceki sürümün çekildiği an */
  fetchedAt: string;
  generatedAt: string | null;
  revision: number;
  state: "KAPALI" | "ACIK" | "BOS";
  zTotal: number;
  cash: number;
  card: number;
  mealCard: number;
  online: number;
  other: number;
  offRevenue: number;
  receipts: number;
  countedCash: number | null;
}

/** Föyün durumu: hiç kasa yoksa BOS, hepsi kapalıysa KAPALI, değilse ACIK */
export function sheetState(foy: KasaFoyu): "KAPALI" | "ACIK" | "BOS" {
  if (!foy.kasalar.length) return "BOS";
  return foy.kasalar.every((k) => k.durum === "KAPALI") ? "KAPALI" : "ACIK";
}

/** Önceki sürüm özeti (değişiklik satırı: "Toplam satış 12.400 ₺ → 11.900 ₺") */
export function sheetPrevious(foy: KasaFoyu, at: { fetchedAt: string; generatedAt: string | null; revision: number }): ModposSheetPrevious {
  const z = foyZ(foy);
  return {
    ...at,
    state: sheetState(foy),
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
}

/**
 * Parmak izinin girdisi: föyün içeriği, hazırlanma anı ve kota hariç (aynı gün yeniden çekilince yalnız bunlar değişir).
 * Anahtarlar sıralı (kanonik JSON); sunucu bunun sha256'sını saklar
 */
export function sheetCanonical(foy: KasaFoyu): string {
  return canonical({ ...foy, olusturulma: undefined, kota: undefined });
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

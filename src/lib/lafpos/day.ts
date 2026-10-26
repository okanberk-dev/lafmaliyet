import { z } from "zod";

import { businessDate } from "@/lib/cash-report";
import { SITE_MENU_ID } from "@/lib/site-menu/schema";

/**
 * LafPOS'un gün sonu (docs/LAFPOS.md; sözleşme LafPOS deposunda docs/03-ENTEGRASYON.md §4). Kafedeki kasa internetten
 * erişilemediği için panel çekmez: LafPOS her iş gününü kapanışta bir kez, düzeltmede yeniden `POST /api/pos/gun` ile
 * iter; aynı `date` öncekinin yerine geçer. Saf modül: uç, veritabanı katmanı ve testler paylaşır
 * (tests/lafpos.test.ts).
 *
 * Beyaz liste: yalnız burada adı geçen alanlar okunur ve saklanır, bilinmeyen alan atılır (kişisel veri gelse de
 * yazılmaz). Tutarlar TL (iki ondalık; fazlası yuvarlanır), ciro ve menü değeri KDV dahil. `date` iş günüdür (05:00
 * kuralı, Kasa raporuyla aynı).
 */

/** Gövdenin sürümü: tanınmayan sürüm reddedilir (400, alan `version`) */
export const LAFPOS_VERSION = 1;
/** Gövde en çok 256 KB (katı JSON) */
export const POS_DAY_MAX_BYTES = 256 * 1024;

const MAX_TL = 100_000_000;
const round2 = (v: number) => Math.round(v * 100) / 100;

const tl = z.number().finite().min(0).max(MAX_TL).transform(round2);
const signedTl = z.number().finite().min(-MAX_TL).max(MAX_TL).transform(round2);
const count = z.number().int().min(0).max(10_000_000);
const qty = z.number().finite().min(0).max(10_000_000);
/** POS adı: sales_lines'taki gibi boşluklar sadeleşir (eşleştirme posMatchKey ile) */
const posName = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .transform((v) => v.replace(/\s+/g, " "));
const siteMenuId = z.string().regex(SITE_MENU_ID).nullable();
const slot = z.enum(["M", "L"]).nullable();

/**
 * Z özeti: Kasa raporunun ModPOS Z ve kasa alanları (docs/03-ENTEGRASYON.md §3.2). `cashIn` ve `expectedCash` sonradan
 * geldi: eski LafPOS'un gövdesinde (ve saklanmış eski özetlerde) yoktur, yazılmayabilir; `cashIn` yoksa 0 sayılır.
 */
export const posZSchema = z.object({
  zNo: z.number().int().min(0).max(999_999_999),
  receipts: count,
  zTotal: tl,
  cash: tl,
  card: tl,
  mealCard: tl,
  online: tl,
  other: tl,
  offRevenue: tl,
  discounts: tl,
  openingCash: tl,
  /** LafPOS'un harcama türü kasa hareketleri */
  cashOut: tl,
  /** Gün sonu sayımı; sayılmadan kapanan günde null */
  countedCash: tl.nullable(),
  /** LafPOS'un teslim türü kasa hareketleri: gün açıkken, sayımdan önce çekmeceden çıkar */
  handedOver: tl,
  /** Sayılan − beklenen nakit (LafPOS'un hesabı); sayım yoksa null */
  cashDiff: signedTl.nullable(),
  /** Nakit satış dışında çekmeceye giren nakit: giriş türü kasa hareketleri, nakit müşteri tahsilatı ve nakit bahşiş (isteğe bağlı) */
  cashIn: tl.nullable().optional(),
  /** LafPOS'un olması gereken nakdi: açılış + nakit satış + cashIn − harcama − teslim (isteğe bağlı) */
  expectedCash: signedTl.nullable().optional(),
});

const lineSchema = z.object({
  posName,
  siteMenuId,
  slot,
  qty,
  /** TL, KDV dahil */
  revenue: tl,
  isService: z.boolean(),
});

const ikramSchema = z.object({
  posName,
  siteMenuId,
  slot,
  qty,
  /** İkram edilenin menü değeri, TL, KDV dahil */
  menuValue: tl,
  reason: z
    .string()
    .max(1000)
    .nullable()
    .transform((v) => v?.trim().slice(0, 200) || null),
});

const paymentSchema = z.object({
  name: z.string().trim().min(1).max(60),
  zField: z.enum(["cash", "card", "meal_card", "online", "other"]),
  /** Komisyon kanalı (pluxee, multinet, edenred, setcard, metropol, yemeksepeti…) */
  channel: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .transform((v) => v || null),
  count,
  amount: tl,
});

export const posDaySchema = z.object({
  version: z.literal(LAFPOS_VERSION),
  source: z.literal("lafpos"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(realDate),
  z: posZSchema,
  lines: z.array(lineSchema).max(3000),
  ikram: z.array(ikramSchema).max(2000),
  payments: z.array(paymentSchema).max(200),
});

export type PosDayPush = z.output<typeof posDaySchema>;
export type PosDayZ = z.output<typeof posZSchema>;
export type PosDayLine = PosDayPush["lines"][number];
export type PosIkram = PosDayPush["ikram"][number];
export type PosPayment = PosDayPush["payments"][number];

/** Takvimde olan gün (2026-02-30 değil), 2020'den sonra */
function realDate(v: string): boolean {
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return y >= 2020 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export type PosDayParse = { ok: true; data: PosDayPush } | { ok: false; field: string };

/**
 * Gövdeyi okur: katı JSON, şema, ileri tarih (bugünün iş gününden sonrası; LafPOS'un saati kaymış) ve aynı POS adının
 * iki kez geçmesi (günde bir ada bir satır: lafmaliyet ürünü adla eşleştirir). Hata yanıtı yalnız ilk sorunlu alanın
 * yolunu verir (`lines.3.qty`); gövde okunamazsa `body`.
 */
export function parsePosDay(body: string, now: Date = new Date()): PosDayParse {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, field: "body" };
  }
  const r = posDaySchema.safeParse(json);
  if (!r.success) {
    const path = r.error.issues[0]?.path ?? [];
    return { ok: false, field: path.length ? path.map(String).join(".") : "body" };
  }
  if (r.data.date > businessDate(now)) return { ok: false, field: "date" };
  const seen = new Set<string>();
  for (const [i, l] of r.data.lines.entries()) {
    if (seen.has(l.posName)) return { ok: false, field: `lines.${i}.posName` };
    seen.add(l.posName);
  }
  return { ok: true, data: r.data };
}

/** Sitenin kalemi ve boyu → panel ürünü aramasının anahtarı */
export const siteSlotKey = (siteMenuId: string, slot: "M" | "L") => `${siteMenuId}|${slot}`;

export interface PosLineMatch {
  productId: number | null;
  isService: boolean;
  /** Nereden bulundu: sitenin kalemi, POS adı eşleştirmesi, LafPOS'un hizmet işareti; bulunmadıysa null */
  via: "site" | "eslestirme" | "hizmet" | null;
}

/**
 * Satırın panel ürünü (docs/03-ENTEGRASYON.md §4): LafPOS'un hizmet satırı (karaoke) ürüne bağlanmaz; sonra sitenin
 * kalemi ve boyu (`products.site_menu_id` + `site_menu_slot`); bulunmazsa POS adı eşleştirmesi (`pos_mappings`,
 * posMatchKey: büyük / küçük harf ve I / İ farkı yok; ModPOS'tan öğrenilmiş eşleştirmeler çalışmaya devam eder;
 * HİZMET eşleştirmesi de). Hiçbiri yoksa ürünsüz satır.
 */
export function resolvePosLine(
  line: Pick<PosDayLine, "posName" | "siteMenuId" | "slot" | "isService">,
  bySite: ReadonlyMap<string, number>,
  mapping: (posName: string) => { productId: number | null; isService: boolean } | undefined,
): PosLineMatch {
  if (line.isService) return { productId: null, isService: true, via: "hizmet" };
  if (line.siteMenuId && line.slot) {
    const id = bySite.get(siteSlotKey(line.siteMenuId, line.slot));
    if (id !== undefined) return { productId: id, isService: false, via: "site" };
  }
  const m = mapping(line.posName);
  if (m && (m.productId !== null || m.isService)) return { productId: m.productId, isService: m.isService, via: "eslestirme" };
  return { productId: null, isService: false, via: null };
}

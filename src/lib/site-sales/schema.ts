import { z } from "zod";

/**
 * laffogato.net'in online satışları (kâr-zarar, tüketim, kasa raporu): sitenin `GET /api/panel/sales` yanıtının panelde
 * doğrulanması (saf; sunucu ve testler paylaşır). Sözleşme sitenin docs/PANEL-SALES.md'si, sitedeki karşılığı
 * src/lib/panel/sales-export-core.ts; panel tarafı docs/SITE-SATIS.md.
 *
 * Kullanılan her alan katıdır: tanınmayan sürüm, sorulandan başka bir dönem, eksi ya da kesirli tutar, bilinmeyen boy
 * bütün yanıtı reddeder. Kâr-zarara sessizce eksik giren bir ay, panelin yeniden sorduğu bir aydan kötüdür (sitenin
 * kuralı da bu: eksik cevap yok). Ad gösterim içindir, kısaltılır; bilinmeyen yeni alanlar atılır. Müşteri verisi
 * gelmez (ad, e-posta, sipariş numarası yok): yalnız toplamlar ve ürün satırları.
 */

export const SITE_SALES_VERSION = 1;
/** Tutar tavanı (kuruş): 10 milyar ₺. Bundan büyüğü bozuk yanıt sayılır */
export const SITE_SALES_MAX_MINOR = 1_000_000_000_000;
/** Bir dönemde en çok bu kadar ürün satırı */
export const SITE_SALES_MAX_LINES = 5000;

export type SalesLineSize = "M" | "L" | "single";

export interface SiteSalesTotals {
  orders: number;
  /** Siparişlerin toplamı (KDV dahil), iade düşülmeden */
  grossMinor: number;
  discountMinor: number;
  deliveryMinor: number;
  refundedMinor: number;
  /** gross − refunded: köşkte kalan, KDV dahil */
  netMinor: number;
  /** netMinor'un içindeki faturanın KDV'si (oranı bilinen siparişlerden) */
  kdvMinor: number;
  /** Oranı saklı olmayan siparişlerin neti: panel kendi varsayılan oranıyla ayırır */
  unknownKdvNetMinor: number;
}

export interface SiteSalesLine {
  /** Menü kalemi (mnu-0003); kalemsiz satırda "" */
  menuItemId: string;
  /** L kalemin L fiyatına, M ve single ilk fiyatına (M yuvası) bağlı ürüne eşlenir */
  size: SalesLineSize;
  name: string;
  qty: number;
  /** Birim fiyat × adet, indirim ve iade düşülmeden (bilgi için) */
  listMinor: number;
}

export interface SiteSalesKaraoke {
  bookings: number;
  collectedMinor: number;
  refundedMinor: number;
  netMinor: number;
  refundPendingMinor: number;
  kdvMinor: number;
  unknownKdvNetMinor: number;
}

export interface SiteSales {
  /** Sitenin yanıt anındaki saati */
  now: string;
  from: string;
  to: string;
  /** Dönemin son günü köşkte bitti; rakamlar yalnız sonradan gelen iadeyle değişir */
  closed: boolean;
  cafe: SiteSalesTotals & { lines: SiteSalesLine[] };
  shop: SiteSalesTotals;
  karaoke: SiteSalesKaraoke;
  /** Panelden elle girilen siparişler: kasada (ModPOS) zaten var, ciroya eklenmez */
  manual: { orders: number; grossMinor: number; netMinor: number };
}

/** Panelde ay başına saklanan kayıt (integration_state `site_sales:YYYY-MM`) */
export interface SiteSalesMonth extends SiteSales {
  /** YYYY-MM */
  month: string;
  /** Panelin çektiği an */
  pulledAt: string;
}

/** Sitenin yanıtı beklenen biçimde değil: yöneticiye gösterilecek açıklamayla */
export class SiteSalesFormatError extends Error {}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const iso = z
  .string()
  .max(40)
  .refine((v) => Number.isFinite(Date.parse(v)), "Geçersiz zaman");
const minor = z.number().int().min(0).max(SITE_SALES_MAX_MINOR);
const count = z.number().int().min(0).max(10_000_000);

const totals = {
  orders: count,
  grossMinor: minor,
  discountMinor: minor,
  deliveryMinor: minor,
  refundedMinor: minor,
  netMinor: minor,
  kdvMinor: minor,
  unknownKdvNetMinor: minor,
};

const lineSchema = z.object({
  menuItemId: z.string().max(64),
  size: z.enum(["M", "L", "single"]),
  name: z
    .string()
    .catch("")
    .transform((v) => Array.from(v.replace(/\s+/g, " ").trim()).slice(0, 120).join("") || "Ürün"),
  qty: count,
  listMinor: minor,
});

const salesSchema = z.object({
  now: iso,
  from: day,
  to: day,
  closed: z.boolean(),
  cafe: z.object({ ...totals, lines: z.array(lineSchema).max(SITE_SALES_MAX_LINES) }),
  shop: z.object(totals),
  karaoke: z.object({
    bookings: count,
    collectedMinor: minor,
    refundedMinor: minor,
    netMinor: minor,
    refundPendingMinor: minor,
    kdvMinor: minor,
    unknownKdvNetMinor: minor,
  }),
  manual: z.object({ orders: count, grossMinor: minor, netMinor: minor }),
});

/** İlk sorunun yeri, ör. "cafe.lines.3.size" */
function where(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue?.path.length ? issue.path.join(".") : "biçim";
}

/**
 * Satış ucunun yanıtı; `expected` sorulan dönem (imzalı sorguyla aynı olmalı). Tanınmayan sürüm, başka dönem ya da
 * bozuk tutar / boy: SiteSalesFormatError.
 */
export function parseSiteSales(json: unknown, expected: { from: string; to: string }): SiteSales {
  const version = json && typeof json === "object" ? (json as { version?: unknown }).version : undefined;
  if (version !== SITE_SALES_VERSION) {
    throw new SiteSalesFormatError(
      version === undefined
        ? "Sitenin satış yanıtı okunamadı (sürüm yok)"
        : `Sitenin satış yanıtı tanınmayan sürümde (${String(version).slice(0, 20)}); panel güncel değil`,
    );
  }
  const parsed = salesSchema.safeParse(json);
  if (!parsed.success) throw new SiteSalesFormatError(`Sitenin satış yanıtı okunamadı (${where(parsed.error)})`);
  const s = parsed.data;
  if (s.from !== expected.from || s.to !== expected.to) {
    throw new SiteSalesFormatError(`Site başka bir dönemin satışını gönderdi (${s.from} – ${s.to}; sorulan ${expected.from} – ${expected.to})`);
  }
  return s;
}

/** Bir ayın ilk ve son günü: "2026-02" → { from: "2026-02-01", to: "2026-02-28" } */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/**
 * Saklanan kaydı okur (integration_state'teki JSON; şema değişmiş ya da elle bozulmuşsa null). Kayıt sitenin yanıtıyla
 * aynı kurallardan geçer: kâr-zarara yalnız doğrulanmış rakam girer.
 */
export function readSalesRecord(value: unknown): SiteSalesMonth | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<SiteSalesMonth>;
  if (typeof v.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v.month) || typeof v.pulledAt !== "string") return null;
  try {
    const parsed = parseSiteSales({ ...v, version: SITE_SALES_VERSION }, monthRange(v.month));
    return { ...parsed, month: v.month, pulledAt: v.pulledAt };
  } catch {
    return null;
  }
}

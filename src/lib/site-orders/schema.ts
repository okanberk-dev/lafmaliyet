import { z } from "zod";

import { awaitingCount } from "./follow";

/**
 * laffogato.net'in açık kafe siparişleri (bar ekranı): sitenin `GET /api/panel/orders` yanıtının panelde doğrulanması
 * (saf; sunucu, ekran ve testler paylaşır). Sözleşme sitenin docs/PANEL-ORDERS.md'si, sitedeki karşılığı
 * src/lib/panel/orders-feed-core.ts; panel tarafı docs/SITE-SIPARIS.md.
 *
 * Yanıt: { version: 1, now, complete, orders: [...], awaitingPayment?, calls? }. Tanınmayan sürüm ya da bozuk iskelet bütün
 * yanıtı reddeder (ekran son doğru listeyi göstermeye devam eder ve hatayı söyler). Tek bir siparişin kullanılan alanı bozuksa
 * (kimlik, aşama, ödeme anı, satırlar) yalnız o sipariş atlanır ve sayılır: bir siparişteki hata bütün ekranı
 * boşaltmasın. Ekranda gösterilen metinler kısaltılır; bilinmeyen yeni alanlar atılır (site v1'e alan ekleyebilir).
 *
 * KVKK: panele yalnız müşterinin adı gelir (soyad, telefon, e-posta, adres, kurye notu asla); panel siparişin tutarını
 * kullanmadığı için saklamaz da. Müşterinin siparişe yazdığı not (v1'e sonradan eklenen, isteğe bağlı `note`: "fındık
 * alerjim var") yalnız masa ve gel-al siparişinde gelir; kurye siparişinde o alan adres notuyla birleşiktir (kapı kodu,
 * adres tarifi): site göndermez, gönderse de panel atar. İçeceğe yazılan satır notu ("çok sıcak olmasın") her siparişte
 * gelir, kurye dahil (içeceğin notudur, adres değil). İkisi kartta gösterilir; zile, bildirime ve günlüğe girmez.
 */

export const SITE_ORDERS_VERSION = 1;
/** Site en çok 200 sipariş gönderir (`complete: false` fazlası olduğunu söyler); bundan çoğu bozuk yanıt sayılır */
export const SITE_ORDERS_MAX = 500;
/** Bir siparişte en çok bu kadar satır */
export const SITE_ORDER_LINES_MAX = 100;

export type OrderStage = "new" | "preparing" | "ready";
export type OrderFulfillment = "table" | "pickup" | "delivery";
export type OrderLineSize = "M" | "L" | "single";

export const ORDER_STAGES: readonly OrderStage[] = ["new", "preparing", "ready"];

export interface SiteOrderLine {
  /** Menü kalemi (mnu-0003); kalemsiz satırda "" */
  menuItemId: string;
  name: string;
  size: OrderLineSize;
  /** Seçenekler, "M · yulaf · +1 shot"; yoksa "" */
  detail: string;
  qty: number;
  /** Müşterinin bu içeceğe notu ("çok sıcak olmasın"); yalnız yazıldıysa (en çok 200 karakter) */
  note?: string;
}

export interface SiteOrder {
  id: string;
  orderNo: number;
  stage: OrderStage;
  fulfillment: OrderFulfillment;
  /** Nereye: "Masa 4", "Gel-al", "Kurye" (sitenin sipariş zilindekiyle aynı) */
  label: string;
  /** Müşterinin yalnız adı (gel-al'da seslenmek için); bilinmiyorsa "" */
  firstName: string;
  /** Planlı saat (ISO); "" = hemen */
  scheduledFor: string;
  paidAt: string;
  lines: SiteOrderLine[];
  /** Siparişin sitenin panelindeki sayfası ("/admin/siparisler/ord-0042"); güvenli değilse "" (bağlantı yok) */
  path: string;
  /**
   * Müşterinin siparişe notu ("fındık alerjim var, şurupsuz"); yalnız masa ve gel-al siparişinde ve yazıldıysa (en çok
   * 300 karakter). Kurye siparişinde hiç yok (KVKK: kapı kodu, adres tarifi)
   */
  note?: string;
}

/** Masa çağrısının sebebi; sitenin bilmediğimiz yeni bir sebebi "other" olur (kart "Çağırıyor" der, çağrı atılmaz) */
export type CallReason = "waiter" | "water" | "napkin" | "other";
export const CALL_REASONS: readonly CallReason[] = ["waiter", "water", "napkin", "other"];

/**
 * Masadan "Garson çağır" (v1'e 6 Kas 2026'da eklenen, isteğe bağlı `calls`): masanın QR kodu, masanın adı ve sebep.
 * Müşteriye dair hiçbir şey yok. Site yalnız açık ve 15 dakikadan yeni çağrıları gönderir
 */
export interface SiteCall {
  /** Sitenin kimliği ("tcl-…") */
  id: string;
  /** Masanın QR kodu ("K7Q2M9X4TB"); okunamazsa "" (gösterilmez) */
  tableCode: string;
  /** "Masa 4" */
  label: string;
  reason: CallReason;
  createdAt: string;
}

export interface SiteOrderList {
  /** Sitenin yanıt anındaki saati (eski yanıt yenisinin üstüne yazılmasın) */
  now: string;
  /** false: sitede 200'den çok açık sipariş var, liste kısa */
  complete: boolean;
  orders: SiteOrder[];
  /** Okunamayıp atlanan sipariş sayısı */
  skipped: number;
  /**
   * Ödemesini bekleyen bar ekranı siparişlerinin sayısı (son ödeme sayfası son 30 dakikada açılmış; yalnız sayı). Site
   * 28 Ekim 2026'da ekledi (laffogato #270): alan yoksa ya da bozuksa 0, liste yine okunur (src/lib/site-orders/follow.ts)
   */
  awaitingPayment: number;
  /** Açık masa çağrıları (alan yoksa boş; eski site göndermez) */
  calls: SiteCall[];
  /** Okunamayıp atlanan masa çağrısı sayısı */
  callsSkipped: number;
}

/** Sitenin yanıtı beklenen biçimde değil: yöneticiye gösterilecek açıklamayla */
export class SiteOrdersFormatError extends Error {}

const iso = z
  .string()
  .max(40)
  .refine((v) => Number.isFinite(Date.parse(v)), "Geçersiz zaman");
const text = (max: number) =>
  z
    .string()
    .catch("")
    .transform((v) => Array.from(v.replace(/\s+/g, " ").trim()).slice(0, max).join(""));

/** Sipariş kimliği: sitenin "ord-0042" biçimi ve benzerleri (yol ve anahtar olarak güvenli) */
export const SITE_ORDER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** Sitenin panelindeki sayfa: yalnız /admin altı, başka siteye çıkamaz (//, \, .. ve boşluk yok) */
const SAFE_PATH = /^\/admin\/[A-Za-z0-9_\-.~%/]{1,200}$/;

export function safeOrderPath(path: unknown): string {
  if (typeof path !== "string" || !SAFE_PATH.test(path) || path.includes("//") || path.includes("..")) return "";
  return path;
}

const lineSchema = z.object({
  menuItemId: z
    .string()
    .catch("")
    .transform((v) => (/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v) ? v : "")),
  name: text(80).transform((v) => v || "Ürün"),
  size: z.enum(["M", "L", "single"]).catch("single"),
  detail: text(160),
  qty: z.number().int().min(1).max(999),
  // İsteğe bağlı (eski site göndermez); bozuksa boş sayılır, sipariş atlanmaz
  note: text(200).optional(),
});

const orderSchema = z.object({
  id: z.string().regex(SITE_ORDER_ID),
  orderNo: z.number().int().min(0).catch(0),
  stage: z.enum(["new", "preparing", "ready"]),
  fulfillment: z.enum(["table", "pickup", "delivery"]),
  label: text(40),
  firstName: text(40),
  scheduledFor: z
    .string()
    .catch("")
    .transform((v) => (v && Number.isFinite(Date.parse(v)) ? v.slice(0, 40) : "")),
  paidAt: iso,
  lines: z.array(lineSchema).min(1).max(SITE_ORDER_LINES_MAX),
  path: z.unknown().transform(safeOrderPath),
  note: text(300).optional(),
});

/** Bir yanıtta en çok bu kadar masa çağrısı okunur (fazlası atlanmış sayılır) */
export const SITE_CALLS_MAX = 100;

const callSchema = z.object({
  id: z.string().regex(SITE_ORDER_ID),
  tableCode: z
    .string()
    .catch("")
    .transform((v) => (/^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : "")),
  label: text(40).transform((v) => v || "Masa"),
  reason: z
    .unknown()
    .transform((v): CallReason => (v === "waiter" || v === "water" || v === "napkin" ? v : "other")),
  createdAt: iso,
});

const listSchema = z.object({
  now: iso,
  complete: z.boolean(),
  orders: z.array(z.unknown()).max(SITE_ORDERS_MAX),
});

const FALLBACK_LABEL: Record<OrderFulfillment, string> = { table: "Masa", pickup: "Gel-al", delivery: "Kurye" };

/** İlk sorunun yeri, ör. "orders" */
function where(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue?.path.length ? issue.path.join(".") : "biçim";
}

/**
 * Tek bir sipariş, listedeki bir eleman biçiminde (aşama ucunun yanıtı da aynı biçimi kullanır: `{ order }`). Kullanılan
 * alanı bozuksa null; metinler kısaltılır, bilinmeyen alanlar atılır, boş etiket varsayılana düşer.
 */
export function parseSiteOrder(raw: unknown): SiteOrder | null {
  const r = orderSchema.safeParse(raw);
  if (!r.success) return null;
  const { note, lines, ...rest } = r.data;
  // Not yalnız yazıldıysa taşınır; kurye siparişinin notu hiç taşınmaz (site göndermese de savunma)
  const orderNote = rest.fulfillment !== "delivery" && note ? note : "";
  return {
    ...rest,
    label: rest.label || FALLBACK_LABEL[rest.fulfillment],
    lines: lines.map(({ note: lineNote, ...l }) => (lineNote ? { ...l, note: lineNote } : l)),
    ...(orderNote ? { note: orderNote } : {}),
  };
}

/** Tek bir masa çağrısı; kimliği ya da anı bozuksa null. Bilinmeyen sebep "other" olur, metinler kısaltılır */
export function parseSiteCall(raw: unknown): SiteCall | null {
  const r = callSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/**
 * Yanıtın isteğe bağlı `calls` alanı: yoksa ya da dizi değilse boş (eski site; bütün yanıt reddedilmez). Bozuk ya da
 * iki kez geçen çağrı atlanır ve sayılır; `SITE_CALLS_MAX`'tan fazlası da atlanmış sayılır.
 */
export function parseSiteCalls(raw: unknown): { calls: SiteCall[]; skipped: number } {
  if (!Array.isArray(raw)) return { calls: [], skipped: 0 };
  const calls: SiteCall[] = [];
  const seen = new Set<string>();
  let skipped = Math.max(0, raw.length - SITE_CALLS_MAX);
  for (const item of raw.slice(0, SITE_CALLS_MAX)) {
    const call = parseSiteCall(item);
    if (!call || seen.has(call.id)) {
      skipped++;
      continue;
    }
    seen.add(call.id);
    calls.push(call);
  }
  return { calls, skipped };
}

/**
 * Okuma ucunun yanıtı. Tanınmayan sürüm ya da bozuk iskelet: SiteOrdersFormatError. Tek bir siparişin bozuk alanı ya
 * da iki kez geçen kimlik: o sipariş atlanır (`skipped`).
 */
export function parseSiteOrders(json: unknown): SiteOrderList {
  const version = json && typeof json === "object" ? (json as { version?: unknown }).version : undefined;
  if (version !== SITE_ORDERS_VERSION) {
    throw new SiteOrdersFormatError(
      version === undefined
        ? "Sitenin sipariş yanıtı okunamadı (sürüm yok)"
        : `Sitenin sipariş listesi tanınmayan sürümde (${String(version).slice(0, 20)}); panel güncel değil`,
    );
  }
  const parsed = listSchema.safeParse(json);
  if (!parsed.success) throw new SiteOrdersFormatError(`Sitenin sipariş listesi okunamadı (${where(parsed.error)})`);
  const orders: SiteOrder[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of parsed.data.orders) {
    const order = parseSiteOrder(raw);
    if (!order || seen.has(order.id)) {
      skipped++;
      continue;
    }
    seen.add(order.id);
    orders.push(order);
  }
  // İsteğe bağlı (S2 öncesi site göndermez); yoksa ya da bozuksa 0, bütün yanıt reddedilmez
  const awaitingPayment = awaitingCount((json as { awaitingPayment?: unknown }).awaitingPayment);
  // Masa çağrıları (6 Kas 2026): isteğe bağlı; yoksa boş, bozuk çağrı atlanır ve sayılır
  const { calls, skipped: callsSkipped } = parseSiteCalls((json as { calls?: unknown }).calls);
  return { now: parsed.data.now, complete: parsed.data.complete, orders, skipped, awaitingPayment, calls, callsSkipped };
}

import { z } from "zod";

/**
 * laffogato.net menüsünün panele görünen biçimi (sitedeki karşılığı src/lib/panel/menu-link-core.ts, sözleşme
 * sitenin docs/PANEL-MENU.md'si; panel tarafı docs/SITE-MENU.md). Saf modül: sunucu ve testler paylaşır.
 *
 * Okuma (GET /api/panel/menu): { version: 1, now, items: [...] }, bütün kalemler, satışta olmayanlar da.
 * Yazma (POST /api/panel/menu) yanıtı: { item } aynı biçimde.
 *
 * Fiyat ve durum alanları (id, priceMinor, priceMinorL, isActive) katıdır: biri bozuksa liste bütünüyle reddedilir
 * (bozuk satırı atlamak onu "sitede silinmiş" gösterip bağlantıyı kaldırırdı). Ad, kategori, sıra ve zaman gösterim
 * içindir; bozuksa boş ya da 0 sayılır, metinler kısaltılır. Bilinmeyen yeni alanlar atılır (site v1'e alan ekleyebilir).
 */

/** Sitenin liste sürümü; panel tanımadığı sürümü uygulamaz */
export const SITE_MENU_VERSION = 1;
/** Sitenin katalog tavanı (kuruş, KDV dahil): CATALOG_MONEY_MAX_MINOR = 1.000.000 ₺ */
export const SITE_MONEY_MAX_MINOR = 100_000_000;
/** Sitenin olay kaydına düşen panel kullanıcısı adı en çok bu kadar karakter */
export const SITE_ACTOR_MAX = 80;
/** Kalem kimliği (mnu-0011): sitenin yazma ucunun kuralıyla aynı */
export const SITE_MENU_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
/** Listede en çok bu kadar kalem (fazlası bozuk yanıt sayılır) */
export const SITE_MENU_MAX_ITEMS = 2000;

export interface SiteMenuItem {
  id: string;
  name: string;
  categoryKey: string;
  categoryLabel: string;
  /** Kuruş, KDV dahil: M ya da tek fiyat */
  priceMinor: number;
  /** Kuruş, KDV dahil: L; 0 = kalem tek boy */
  priceMinorL: number;
  /** "Satışta"; false = "Tükendi" */
  isActive: boolean;
  sortOrder: number;
  updatedAt: string;
}

const isoTime = z
  .string()
  .max(40)
  .refine((v) => Number.isFinite(Date.parse(v)), "Geçersiz zaman");
const minor = z.number().int().min(0).max(SITE_MONEY_MAX_MINOR);
const label = (max: number) =>
  z
    .string()
    .catch("")
    .transform((v) => v.trim().slice(0, max));

export const siteMenuItemSchema = z.object({
  id: z.string().regex(SITE_MENU_ID),
  name: label(120),
  categoryKey: label(40),
  categoryLabel: label(60),
  priceMinor: minor,
  priceMinorL: minor,
  isActive: z.boolean(),
  sortOrder: z.number().int().catch(0),
  updatedAt: z
    .string()
    .catch("")
    .transform((v) => (Number.isFinite(Date.parse(v)) ? v.slice(0, 40) : "")),
});

const listSchema = z.object({
  version: z.literal(SITE_MENU_VERSION),
  now: isoTime,
  items: z.array(siteMenuItemSchema).max(SITE_MENU_MAX_ITEMS),
});

/** Sitenin yanıtı beklenen biçimde değil: yöneticiye gösterilecek açıklamayla */
export class SiteMenuFormatError extends Error {}

/** İlk sorunun yeri, ör. "items.3.priceMinor" */
function where(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue?.path.length ? issue.path.join(".") : "biçim";
}

export interface SiteMenuList {
  /** Sitenin yanıt anındaki saati (eski yanıt yenisinin üstüne yazılmasın diye) */
  now: string;
  items: SiteMenuItem[];
}

/** Okuma ucunun yanıtı. Tanınmayan sürüm, bozuk fiyat / durum alanı ya da iki kez geçen kimlik: hata */
export function parseSiteMenuList(json: unknown): SiteMenuList {
  const version = json && typeof json === "object" ? (json as { version?: unknown }).version : undefined;
  if (version !== SITE_MENU_VERSION) {
    throw new SiteMenuFormatError(
      version === undefined ? "Sitenin menü yanıtı okunamadı (sürüm yok)" : `Sitenin menü listesi tanınmayan sürümde (${String(version).slice(0, 20)}); panel güncel değil`,
    );
  }
  const parsed = listSchema.safeParse(json);
  if (!parsed.success) throw new SiteMenuFormatError(`Sitenin menü listesi okunamadı (${where(parsed.error)})`);
  const seen = new Set<string>();
  for (const item of parsed.data.items) {
    if (seen.has(item.id)) throw new SiteMenuFormatError(`Sitenin menü listesinde ${item.id} iki kez geçiyor`);
    seen.add(item.id);
  }
  return { now: parsed.data.now, items: parsed.data.items };
}

/** Yazma ucunun yanıtındaki kalem ({ item }); okunamazsa null (site yine de kabul etmiştir) */
export function parseSiteMenuAnswer(json: unknown): SiteMenuItem | null {
  const parsed = z.object({ item: siteMenuItemSchema }).safeParse(json);
  return parsed.success ? parsed.data.item : null;
}

/** Hata yanıtındaki alan ({"error":"invalid","field":"priceMinor"}); yoksa null */
export function errorField(json: unknown): string | null {
  const parsed = z.object({ field: z.string().max(40) }).safeParse(json);
  return parsed.success ? parsed.data.field : null;
}

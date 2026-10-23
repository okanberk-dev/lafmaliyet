/**
 * Mal siparişinin (docs/MAL-SIPARISI.md) ortak tipleri ve ayarları: tedarikçiye giden siparişin kalemleri (gönderim
 * anının kopyası, supplier_orders.lines) ve faturayla karşılaştırmanın sonucu (supplier_orders.delivery_check). Şema
 * (src/server/db/schema.ts) bunları yalnız tip olarak okur; burada veritabanı ya da tarayıcı yok.
 *
 * Adlar: arayüzde "Mal siparişi", kodda `reorder`. Yalın "sipariş" uygulama siparişidir (laffogato.net, bar ekranı).
 */

import type { Unit } from "../calc/types";

// ---------------------------------------------------------------- Ayarlar (integration_state "reorder.settings")

export interface ReorderSettings {
  /** Hızlı sayım günleri: 1 = Pazartesi … 7 = Pazar */
  countWeekdays: number[];
  /** Emniyet payı (0,2 = %20): günlük kullanımın üstüne eklenir */
  marginPct: number;
  /** Kalemde ve tedarikçide yazılmamışsa teslim süresi (gün) */
  defaultLeadDays: number;
  /** WhatsApp mesajındaki ad: "Merhaba, *L'Affogato* siparişimiz:" */
  signature: string;
}

export const DEFAULT_REORDER: ReorderSettings = { countWeekdays: [1], marginPct: 0.2, defaultLeadDays: 2, signature: "L'Affogato" };

/** Ayarların anahtarı (integration_state); kimlik taşımaz, db:reset silmez */
export const REORDER_SETTINGS_KEY = "reorder.settings";

const intIn = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);

/**
 * Kayıtlı ayarları okur; eksik ya da bozuk alan varsayılanı alır (eski kayıt, elle değiştirilmiş değer). Sayım günleri
 * tekrarsız ve sıralı; hiçbiri geçerli değilse varsayılan (Pazartesi).
 */
export function parseReorderSettings(raw: unknown): ReorderSettings {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const days = Array.isArray(v.countWeekdays) ? [...new Set(v.countWeekdays.map((d) => intIn(d, 1, 7)).filter((d): d is number => d !== null))].sort((a, b) => a - b) : [];
  const margin = typeof v.marginPct === "number" && Number.isFinite(v.marginPct) && v.marginPct >= 0 && v.marginPct <= 1 ? v.marginPct : DEFAULT_REORDER.marginPct;
  const signature = typeof v.signature === "string" && v.signature.trim() ? v.signature.trim().slice(0, 60) : DEFAULT_REORDER.signature;
  return {
    countWeekdays: days.length ? days : [...DEFAULT_REORDER.countWeekdays],
    marginPct: margin,
    defaultLeadDays: intIn(v.defaultLeadDays, 0, 30) ?? DEFAULT_REORDER.defaultLeadDays,
    signature,
  };
}

// ---------------------------------------------------------------- Gönderilen sipariş

/** supplier_orders.lines: gönderim anının kopyası (hammadde sonradan değişse de ne istendiği okunur) */
export interface ReorderLine {
  ingredientId: number;
  /** Hammaddenin paneldeki adı */
  name: string;
  /** Mesajda yazılan ad (tedarikçinin ürün adı) */
  orderName: string;
  /** Sipariş biriminde miktar (mesajdaki sayı) */
  qty: number;
  /** Sipariş birimi, küçük harf ("koli") */
  unit: string;
  /** 1 birimin içeriği, malzemenin kendi biriminde (12 litrelik koli: 12000 ml) */
  unitSize: number;
  baseUnit: Unit;
  /** Gönderim anındaki sayım birimi (KG, LT, ADET, DİLİM): "2 koli (24 LT)" */
  countUnit: string | null;
  leadDays: number;
  /** Önerilen birim sayısı (miktar elle değişti mi); öneri yoksa null */
  suggested: number | null;
  /** Gönderim anında eldeki ve hedef, kendi biriminde */
  onHand: number | null;
  par: number | null;
  /**
   * Beklenen birim fiyat (₺ / kendi birimi, KDV hariç): bu tedarikçinin son faturası, yoksa hammaddenin fiyatı. 0 ya
   * da bilinmiyorsa null (tutar tahmini ve fiyat karşılaştırması yok). Yalnız yönetici görür.
   */
  expectedUnitPrice: number | null;
  /** Fiyat tahmin (hammadde "Tahmini": personelin ya da ilk yüklemenin yazdığı): yalnız "~" tutar, fiyat farkı uyarısı yok */
  priceEstimated: boolean;
}

// ---------------------------------------------------------------- Teslim kontrolü (faturayla karşılaştırma)

export type CheckStatus = "tamam" | "eksik" | "gelmedi" | "fazla" | "siparis-disi" | "bagli-degil";

export interface CheckRow {
  /** Hammaddeye bağlı değilse null */
  ingredientId: number | null;
  name: string;
  /** Faturadaki ürün adları */
  productNames: string[];
  /** Sipariş edilen ve faturada gelen, malzemenin kendi biriminde (siparişte yoksa ordered null) */
  ordered: number | null;
  delivered: number | null;
  /** Metin için sipariş birimi ve 1 birimin içeriği ("1 koli eksik") */
  unit: string;
  unitSize: number;
  baseUnit: Unit | null;
  countUnit: string | null;
  status: CheckStatus;
  /** Faturadaki birim fiyat (Σ net ÷ Σ miktar, bedava ve iade kalemleri hariç) ve beklenen */
  unitPrice: number | null;
  expectedUnitPrice: number | null;
  /** unitPrice ÷ beklenen − 1 */
  priceDiff: number | null;
  /** Fark ±%3'ü aşıyor (beklenen fiyat tahminse hiç) */
  priceFlag: boolean;
  /** Gelen siparişin yaklaşık tam katı (ya da tam bölümü): ürün bağlantısının çarpanı yanlış olabilir */
  ratioHint: number | null;
}

export interface DeliveryCheck {
  invoiceId: number;
  invoiceNo: string | null;
  invoiceDate: string;
  payable: number;
  /** Faturanın kalemleri okundu (kalemsiz fatura: kâğıt, elle girilen ya da e-faturası henüz okunmamış) */
  linesRead: boolean;
  rows: CheckRow[];
  counts: { eksik: number; gelmedi: number; fazla: number; fiyat: number; disi: number; bagliDegil: number };
  /** Kalemler okundu, her sipariş satırı tamam, fiyat farkı ve siparişte olmayan kalem yok */
  ok: boolean;
  /** Toplu (birden çok siparişi kapsayan) fatura gibi */
  consolidated: boolean;
  /** Karşılaştırmanın anı (ISO) */
  at: string;
}

export type OrderStatus = "open" | "closed" | "cancelled";

/** Bir siparişin ekranlara ve hesaplara giden hâli (src/server/data/reorder.ts loadOrders) */
export interface OrderLite {
  id: number;
  supplier: string;
  /** Tedarikçinin grubu (Tedarikçiler'deki gibi; yükleyici çözer, çözemezse null) */
  supplierKey?: string | null;
  sentAt: string;
  /** Gönderim günü (Türkiye) */
  sentDay: string;
  expectedOn: string;
  status: OrderStatus;
  receivedAt: string | null;
  receivedByName: string | null;
  invoiceId: number | null;
  manualMatch: boolean;
  lines: ReorderLine[];
  check: DeliveryCheck | null;
  closedAt: string | null;
  closedByName: string | null;
  closeNote: string | null;
  phone: string | null;
  channel: "whatsapp" | "kopya";
  message: string;
  note: string | null;
  sentByName: string;
}

// ---------------------------------------------------------------- Bugün

/** Bugün ekranının olguları (src/server/data/reorder.ts loadReorderDay; satırlar src/app/panel/bugun/logic.ts) */
export interface ReorderDayFacts {
  /** Takipteki (etkin, sayım birimli) kalem */
  total: number;
  /** Bugün (iş günü) sayılan: hızlı sayım ya da ay sonu sayımı */
  countedToday: number;
  /** Son sayım günü (hızlı sayım ya da takipteki kalemin ay sonu sayımı); hiç yoksa null */
  lastCountDay: string | null;
  /** Sayım günleri (sayım günü mü, gecikti mi) */
  countWeekdays: number[];
  // ---- Yalnız yönetici
  /** Sipariş hazır: son sayım bugün ya da dün ve siparişi gönderilmemiş önerisi olan tedarikçiler, önerilen kalem */
  ready?: { suppliers: string[]; lines: number } | null;
  /** Teslim farkı olan siparişler ve beklenen günde gelmeyenlerin sayısı */
  delivery?: { issues: { supplier: string; summary: string }[]; late: number } | null;
}

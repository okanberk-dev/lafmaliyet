import type { Role } from "./constants";
import type { KaraokeSessionDTO } from "./karaoke/session";
import type { SiteOrder } from "./site-orders/schema";
import type { UserRepeat } from "./user-reminders";

/**
 * Canlı ucun (/api/canli) yanıtı: açık panel sekmesinin uyarı motoru (src/components/panel/live) bununla karaoke
 * sayaçlarını, laffogato.net'in açık kafe siparişlerini (bar ekranı), kişisel hatırlatmaları ve bildirim aboneliğini
 * yönetir. Değişiklik yoksa uç 304 döner (ETag).
 */
export interface LiveResponse {
  serverNow: string;
  me: { id: number; role: Role };
  karaoke: {
    /** laffogato.net bağlantısı kurulu (KARAOKE_SYNC_SECRET) */
    configured: boolean;
    sessions: KaraokeSessionDTO[];
  };
  /** laffogato.net'in açık kafe siparişleri: son çekmenin listesi ve bağlantının durumu (docs/SITE-SIPARIS.md) */
  orders: LiveOrders;
  /** Yarına kadar (gecikenler dahil) açık kişisel hatırlatıcılar */
  reminders: {
    id: number;
    title: string;
    note: string | null;
    dueDate: string;
    dueTime: string | null;
    anchorDate: string;
    repeat: UserRepeat;
    active: boolean;
    doneAt: string | null;
  }[];
  /** Tarayıcının abone olurken kullanacağı genel anahtar; bildirim kurulamıyorsa null */
  push: { publicKey: string | null };
}

/** Bar ekranının sipariş verisi (tutar yok: ekran yalnız hazırlamak ve teslim etmek için gerekeni gösterir) */
export interface LiveOrders {
  /** laffogato.net bağlantısı kurulu (KARAOKE_SYNC_SECRET) */
  configured: boolean;
  /** Ekranın sırasıyla (masa siparişi önce, sonra vakti en yakın) */
  list: SiteOrder[];
  /** false: sitede 200'den çok açık sipariş var, liste kısa */
  complete: boolean;
  /** Okunamayıp atlanan sipariş sayısı (panel güncel değil olabilir) */
  skipped: number;
  /** Listenin alındığı an; hiç alınmadıysa null */
  at: string | null;
  /** Son çekme denemesi, son başarılı çekme ve son denemenin hatası (başarılıysa null) */
  pulledAt: string | null;
  okAt: string | null;
  error: string | null;
  /** Sitenin son pingi ve listenin son değiştiği an (ekranın "yoğun" sayılması için) */
  pingAt: string | null;
  changeAt: string | null;
}

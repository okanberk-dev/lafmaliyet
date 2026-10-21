import type { Role } from "./constants";
import type { KaraokeSessionDTO } from "./karaoke/session";
import type { UserRepeat } from "./user-reminders";

/**
 * Canlı ucun (/api/canli) yanıtı: açık panel sekmesinin uyarı motoru (src/components/panel/live) bununla karaoke
 * sayaçlarını, kişisel hatırlatmaları ve bildirim aboneliğini yönetir. Değişiklik yoksa uç 304 döner (ETag).
 */
export interface LiveResponse {
  serverNow: string;
  me: { id: number; role: Role };
  karaoke: {
    /** laffogato.net bağlantısı kurulu (KARAOKE_SYNC_SECRET) */
    configured: boolean;
    sessions: KaraokeSessionDTO[];
  };
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

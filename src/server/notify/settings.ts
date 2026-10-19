import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema as s } from "@/server/db";

/** Bildirim ayarları (integration_state, anahtar "notify.settings") */
export interface NotifySettings {
  /** Hatırlatma e-postaları gitsin mi */
  emailEnabled: boolean;
  /** Gönderen; boşsa EMAIL_FROM ya da varsayılan */
  from: string | null;
  /** Ödenmemiş faturaların vadesinden kaç gün önce haber verilsin */
  invoiceDaysBefore: number;
  /** Vadesi girilmemiş faturalar fatura tarihinden kaç gün sonra vadeli sayılsın */
  invoiceTermDays: number;
}

export const DEFAULT_NOTIFY: NotifySettings = { emailEnabled: true, from: null, invoiceDaysBefore: 3, invoiceTermDays: 30 };
const KEY = "notify.settings";

export async function loadNotifySettings(): Promise<NotifySettings> {
  const [row] = await getDb().select().from(s.integrationState).where(eq(s.integrationState.key, KEY)).limit(1);
  return { ...DEFAULT_NOTIFY, ...((row?.value as Partial<NotifySettings> | undefined) ?? {}) };
}

export async function saveNotifySettings(value: NotifySettings) {
  await getDb()
    .insert(s.integrationState)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
}

import "server-only";

import { getDb, schema as s } from "@/server/db";

/**
 * İşlem geçmişine kayıt düşer: kişinin o anki adı ve (oturumdaki kullanıcıysa) hesabı. Ad serbest metindir, kişi
 * kendi adını değiştirebilir; hesap kimliği yazıldığı için İşlem geçmişi kaydı yapan hesabın e-postasını gösterir
 * (başkasının adını alan, sahibi gibi görünemez). Sistemin ve sitenin kayıtlarında hesap yok. Hata olursa ana işlemi
 * bozmaz.
 */
export async function logActivity(user: { id?: number; name: string } | null, action: string, detail?: string) {
  try {
    await getDb()
      .insert(s.activityLog)
      .values({ userName: user?.name ?? "Sistem", userId: typeof user?.id === "number" ? user.id : null, action, detail: detail?.slice(0, 500) });
  } catch (e) {
    console.error("activity log", e);
  }
}

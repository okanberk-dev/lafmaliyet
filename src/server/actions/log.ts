import "server-only";

import { getDb, schema as s } from "@/server/db";

/** İşlem geçmişine kayıt düşer. Hata olursa ana işlemi bozmaz. */
export async function logActivity(user: { name: string } | null, action: string, detail?: string) {
  try {
    await getDb().insert(s.activityLog).values({ userName: user?.name ?? "Sistem", action, detail: detail?.slice(0, 500) });
  } catch (e) {
    console.error("activity log", e);
  }
}

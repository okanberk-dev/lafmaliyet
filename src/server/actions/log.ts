import "server-only";

import { ALL_BRANCHES } from "@/lib/branches";
import { currentVia } from "@/server/activity-via";
import { currentBranchScope } from "@/server/branch-scope";
import { getDb, schema as s } from "@/server/db";

export { runViaAssistant } from "@/server/activity-via";

/**
 * Kaydın şubesi (şube ayrımı, migration 0101; docs/SUBE.md › Şube ayrımı): verilmişse o (formun şubesi, kaydın şubesi;
 * null = işletme geneli), yoksa isteğin şube seçimi (`withBranchScope` içinde o kapsam; şubesine kilitli hesapta kendi
 * şubesi); "Tümü"de ve istek dışında (sistem, arka plan işi) boş
 */
export async function activityBranch(given?: string | null): Promise<string | null> {
  if (given !== undefined) return given;
  try {
    const scope = await currentBranchScope();
    return scope === ALL_BRANCHES ? null : scope;
  } catch {
    return null;
  }
}

/**
 * İşlem geçmişine kayıt düşer: kişinin o anki adı ve (oturumdaki kullanıcıysa) hesabı. Ad serbest metindir, kişi
 * kendi adını değiştirebilir; hesap kimliği yazıldığı için İşlem geçmişi kaydı yapan hesabın e-postasını gösterir
 * (başkasının adını alan, sahibi gibi görünemez). Sistemin ve sitenin kayıtlarında hesap yok. Hata olursa ana işlemi
 * bozmaz. Panel asistanının onay kartından gelen işlemde (`runViaAssistant`) kayıt "asistan aracılığıyla" işaretlenir.
 * Kaydın şubesi `opts.branchId` (yazımın şubesi belliyse; null = işletme geneli), verilmezse seçili şube (`activityBranch`).
 */
export async function logActivity(user: { id?: number; name: string } | null, action: string, detail?: string, opts: { branchId?: string | null } = {}) {
  try {
    const branchId = await activityBranch(opts.branchId);
    await getDb()
      .insert(s.activityLog)
      .values({ userName: user?.name ?? "Sistem", userId: typeof user?.id === "number" ? user.id : null, action, detail: detail?.slice(0, 500), via: currentVia(), branchId });
  } catch (e) {
    console.error("activity log", e);
  }
}

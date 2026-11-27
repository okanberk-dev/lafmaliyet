import "server-only";

import { ALL_BRANCHES, type BranchScope } from "@/lib/branches";
import { planReminderText } from "@/lib/vardiya-bildirim";
import type { PanelNotification } from "@/server/actions/notifications";
import { getDb } from "@/server/db";
import { missingNextWeekPlans } from "@/server/vardiya/notify";

/**
 * Yöneticinin zilinde vardiya hatırlatması (docs/VARDIYA.md › Bildirimler): Perşembe 18:00'den Pazar sonuna kadar
 * gelecek haftanın planı hiç yazılmamış her şube için "Gelecek haftanın vardiyası yazılmadı" (birden çok şubede adıyla),
 * o haftanın o şubesine götürür. Tek şube seçiliyken yalnız o şubeninki, "Tümü"de hepsi. Online kanal seçiliyken hiçbiri
 * (şube ayrımı, 27 Kasım 2026: kanalın vardiyası yok; önceden bütün şubelerinki görünüyordu). Plan yazılınca satır
 * kalkar; kimlik şube ve haftadan.
 */
export async function vardiyaBell(scope: BranchScope, now: Date = new Date()): Promise<PanelNotification[]> {
  const { monday, branches, manyBranches } = await missingNextWeekPlans(getDb(), now);
  // Seçili kapsam bir şubeyse yalnız onunki (online kanalda vardiya yok: boş); "Tümü"de hepsi
  const shown = scope === ALL_BRANCHES ? branches : branches.filter((b) => b.id === scope);
  return shown.map((b) => {
    const t = planReminderText(b, monday, { manyBranches });
    return { id: t.id, kind: "warning", title: t.title, body: t.body, timeLabel: "", unread: true, href: t.href, group: "uyari" };
  });
}

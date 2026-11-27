import "server-only";

import { compareEmptyText } from "@/lib/branch-view";
import { currentBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";

/**
 * Şube karşılaştırma ve İşçilik / ciro raporunun boş hâli (şube ayrımı parça 6): "Yalnız seçili şube" kipinde online
 * kanal seçiliyse kanalın metni, değilse "Açık şube yok" (src/lib/branch-view.ts › compareEmptyText)
 */
export async function compareEmpty(): Promise<{ title: string; description: string }> {
  const [scope, branches] = await Promise.all([currentBranchScope(), listBranches()]);
  return compareEmptyText(scope, branches);
}

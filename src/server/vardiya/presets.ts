import "server-only";

import { SHIFT_PRESET_GROUP } from "@/lib/branch-settings/groups";
import { shiftPresetsOf, type ShiftPreset } from "@/lib/vardiya";
import { resolveBranchSetting } from "@/server/branch-settings";
import { getDb, type DB } from "@/server/db";

/**
 * Şubenin hazır vardiyaları (sabahçı / akşamcı; docs/VARDIYA.md › Hazır vardiyalar): şube ayarı `vardiya.hazir`
 * (Şube ayarları › Hazır vardiyalar), seçilmemişse bugünkü sabit saatler (src/lib/vardiya.ts SHIFT_PRESETS). Vardiya
 * ekranı, PDF, yazarak doldurma ve asistanın vardiya kartı aynı listeyi buradan okur. Okuma satır yazmaz.
 */
export async function loadShiftPresets(branchId: string, db: Pick<DB, "select"> = getDb()): Promise<ShiftPreset[]> {
  const { value } = await resolveBranchSetting(SHIFT_PRESET_GROUP, branchId, db);
  return shiftPresetsOf(branchId, value.presets);
}

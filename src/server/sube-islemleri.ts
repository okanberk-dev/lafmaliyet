import "server-only";

import { eq } from "drizzle-orm";

import type { AsilposBranchData } from "@/components/sube-islemleri/kasa-anahtari";
import { ASILPOS_GROUP, BRANCH_SETTING_GROUPS } from "@/lib/branch-settings/groups";
import { branchDeleteError, type BranchRow } from "@/lib/branches";
import { ASILPOS_SWITCH_MAX_AHEAD, ASILPOS_SWITCH_MIN, switchEffects } from "@/lib/asilpos/switch";
import type { KasaDurumu } from "@/lib/asilpos/kasa-durumu";
import { businessDate } from "@/lib/cash-report";
import { LEGACY_POS_BRANCH_ID } from "@/lib/pos/tills";
import { addDays } from "@/lib/reminders";
import { STOCK_ESTIMATE_BRANCH } from "@/lib/stock-estimate";
import { posKeyState } from "@/server/asilpos/branch";
import { loadKasaDurumu, loadSerbestBilgileri } from "@/server/asilpos/kasa-durumu";
import { branchSettingsCloseError, resolveBranchSetting } from "@/server/branch-settings";
import { branchUsageCount, listBranches } from "@/server/branches";
import { getDb, schema as s, type DB } from "@/server/db";
import { loadPosTillIds } from "@/server/pos/tills";

/** Geçiş günü formunun verisi (src/components/sube-islemleri/gecis-gunu.tsx) */
export interface GecisGunuVerisi {
  effects: string[];
  value: string | null;
  today: string;
  min: string;
  max: string;
  /** Şubenin anahtarı kullanılabilir mi (değilse onay penceresi "bağlantı kurulmadı" der) */
  linked: boolean;
}

export interface SubeIslemVerisi {
  branch: BranchRow;
  /** Bütün şubeler (ekran kapatma ve tür kurallarını sunucuyla aynı işlevle önceden söyler: branchChangeError) */
  rows: BranchRow[];
  /** Fiziksel şubenin kasa durumu; online kanalda null */
  kasa: KasaDurumu | null;
  /** Son CANLI_GUN günde kasadan gün sonu geldi (canlı şube, bugün Marina): yıkıcı işlemlerde belirgin uyarı */
  canli: boolean;
  /** Silinemiyorsa nedeni (deleteBranch'in kuralı: sabit kayıt, verisi olan şube, ayarı başka şubece kullanılan şube) */
  silinemez: string | null;
  /** Kasa anahtarı kartı: kasası AsilPOS olan ya da AsilPOS kurulumu yapılmış şubede; yoksa null */
  asilpos: AsilposBranchData | null;
  /** Kasası artık AsilPOS olmayan şubede kalan, panelde saklı eski anahtar (yalnız silinir) */
  eskiAnahtar: boolean;
  /** Geçiş günü: yalnız kasası AsilPOS olan şubede (sunucu da yalnız orada yazar); yoksa null */
  gecis: GecisGunuVerisi | null;
}

/**
 * Yönetim konsolu › Şubeler ve kasalar › şube (/yonetim/sube/[id]; docs/SUBE.md › Şube işlemleri): bir şubenin açık /
 * kapalı durumu, türü, kasa programı, silinip silinemeyeceği, kasa durumu, canlı mı, AsilPOS'a geçiş günü ve kasa
 * anahtarının durumu. Anahtarın kendisi dönmez (yalnız kaynağı ve sorunu). Yalnız okur: anahtar üretmez, kasanın
 * çağırdığı uçlara dokunmaz. Ölçütler ladmin'in Şube ayarları sayfasıyla ve sunucu eylemleriyle aynı (kasası AsilPOS ya
 * da kurulumu yapılmış şubede kasa anahtarı kartı; geçiş günü yalnız kasası AsilPOS olanda). Yetki denetimi burada değil:
 * çağıran sayfa requireYonetim ister. Şube yoksa null
 */
export async function subeIslemVerisi(id: string, db: DB = getDb(), now: Date = new Date()): Promise<SubeIslemVerisi | null> {
  const rows = await listBranches(db);
  const branch = rows.find((b) => b.id === id);
  if (!branch) return null;
  const silinemez = branchDeleteError(branch, await branchUsageCount(db, id)) ?? (await branchSettingsCloseError(db, branch, BRANCH_SETTING_GROUPS));
  if (branch.kind !== "fiziksel") return { branch, rows, kasa: null, canli: false, silinemez, asilpos: null, eskiAnahtar: false, gecis: null };

  const [{ ids: tillIds }, [installed], setting, kasa, serbest] = await Promise.all([
    loadPosTillIds(db, now.getTime(), true),
    db.select({ id: s.asilposInstalls.id }).from(s.asilposInstalls).where(eq(s.asilposInstalls.branchId, id)).limit(1),
    resolveBranchSetting(ASILPOS_GROUP, id, db),
    loadKasaDurumu(id, db, now),
    loadSerbestBilgileri([id], db, now),
  ]);
  const till = tillIds.includes(id);
  const asilposHere = till || Boolean(installed);
  const stored = setting.secrets.secret ?? "none";
  const key = asilposHere ? await posKeyState(id, db) : null;
  const asilpos: AsilposBranchData | null = key
    ? {
        branchId: id,
        switchDay: setting.value.switchDay,
        stored,
        source: key.source,
        problem: key.problem,
        envName: key.envName,
        sourceModpos: branch.posSource !== "asilpos",
        till,
        legacy: id === LEGACY_POS_BRANCH_ID,
      }
    : null;
  const today = businessDate(now);
  const gecis: GecisGunuVerisi | null =
    till && key
      ? {
          effects: switchEffects({
            branchName: branch.name,
            modposNames: rows.filter((b) => b.active && b.kind === "fiziksel" && b.posSource === "modpos").map((b) => b.name),
            stockEstimate: id === STOCK_ESTIMATE_BRANCH,
          }),
          value: setting.value.switchDay,
          today,
          min: ASILPOS_SWITCH_MIN,
          max: addDays(today, ASILPOS_SWITCH_MAX_AHEAD),
          linked: key.problem === null,
        }
      : null;
  return {
    branch,
    rows,
    kasa,
    canli: serbest[id]?.canli ?? false,
    silinemez,
    asilpos,
    eskiAnahtar: !asilposHere && stored !== "none",
    gecis,
  };
}

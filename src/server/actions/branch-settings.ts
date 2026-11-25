"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { branchSettingGroup, PARASUT_GROUP } from "@/lib/branch-settings/groups";
import { BRANCH_ID_MAX } from "@/lib/branches";
import { requireAdmin } from "@/server/auth/dal";
import { linkBranchSetting, logSetting, unlinkBranchSetting } from "@/server/branch-settings";
import { listBranches } from "@/server/branches";
import { getDb } from "@/server/db";
import { beforeParasutLink } from "@/server/parasut/accounts";

import { attempt, UserError } from "./util";

// Şube başına ayarların "Diğer şubeyle aynı" seçimi (docs/SUBE.md › Şube başına ayarlar). Yalnız yönetici. Değerlerin
// kendisi grubun kendi ucundan yazılır (kasa raporu alıcıları: cash-report.ts updateCashSettings).

const linkInput = z.object({
  branchId: z.string().trim().min(1).max(BRANCH_ID_MAX),
  group: z.string().trim().min(1).max(40),
  /** Bağlanacak şube; null: "aynı" kapatılır, o anki değer şubeye kopyalanır */
  sameAs: z.string().trim().min(1).max(BRANCH_ID_MAX).nullable(),
});

/**
 * Şubenin bir gruptaki "Diğer şubeyle aynı" seçimini değiştirir. Açılınca şubenin kendi değeri silinir, değer hedeften
 * okunur; kapatılınca o anki değer şubeye kopyalanır (gizli alanlar kopyalanmaz: `secretsLeft` yeniden girilecekler).
 * Tek işlem; işlem geçmişine yazılır.
 *
 * Paraşüt hesabı (docs/PARASUT.md › Şube başına Paraşüt hesabı) istisnadır: kapatılınca hiçbir şey kopyalanmaz (aynı
 * firma iki hesaptan iki kez eşitlenip faturaları çiftlerdi), şube boş bir hesapla başlar ve bağlanmayı bekler. Açılınca
 * şubenin kendi hesabından fatura geldiyse reddedilir; gelmediyse hesabın ayarları, oturumu ve eşitleme durumu aynı
 * işlemde silinir (beforeParasutLink).
 */
export async function setBranchSettingLink(input: z.input<typeof linkInput>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const d = linkInput.parse(input);
    const group = branchSettingGroup(d.group);
    if (!group) throw new UserError("Ayar grubu bulunamadı");
    const branches = await listBranches();
    const name = (id: string) => branches.find((b) => b.id === id)?.name ?? id;
    const out = await getDb().transaction(async (tx) => {
      if (d.sameAs) {
        if (group.id === PARASUT_GROUP.id) await beforeParasutLink(tx, d.branchId);
        await linkBranchSetting(tx, group, d.branchId, d.sameAs, me.name);
        await logSetting(tx, me, "Şube ayarı", `${name(d.branchId)} · ${group.label}: ${name(d.sameAs)} ile aynı`);
        return { secretsLeft: [] as string[] };
      }
      const r = await unlinkBranchSetting(tx, group, d.branchId, me.name);
      const what = group.id === PARASUT_GROUP.id ? "ayrı hesap (boş; Paraşüt ekranından bağlanacak)" : "kendi ayarı (değerler kopyalandı)";
      await logSetting(tx, me, "Şube ayarı", `${name(d.branchId)} · ${group.label}: ${what}`);
      return r;
    });
    refresh();
    return out;
  });
}

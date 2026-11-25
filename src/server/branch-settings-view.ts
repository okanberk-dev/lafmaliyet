import "server-only";

import type { BranchSettingGroup } from "@/lib/branch-settings/groups";
import { settingDependents, settingLinkTargets, type SettingMode } from "@/lib/branch-settings/rules";
import { tillBranches } from "@/lib/branches";
import { resolveBranchSetting, settingLinks, type SecretState } from "@/server/branch-settings";
import { listBranches } from "@/server/branches";

/**
 * Şube ayarları ekranındaki bir grubun kartının verisi (docs/SUBE.md › Şube başına ayarlar): değer, "Diğer şubeyle aynı"
 * durumu ve gizli alanların yalnız durumu. Gizli alanın kendisi istemciye hiç gitmez (yalnız "kayıtlı mı").
 */

/** "Diğer şubeyle aynı" bölümü (birden çok kasa açıkken ve grup "aynı" sunuyorsa) */
export interface SettingLinkView {
  mode: SettingMode;
  /** Bağlıysa bağlandığı şubenin adı */
  toName: string | null;
  /** "Aynı" seçilebilecek şubeler (kendi ayarı olan açık şubeler) */
  targets: { id: string; name: string }[];
  /** Bu şubenin ayarını kullanan şubelerin adları */
  sharedWith: string[];
}

export interface BranchSettingView<T> {
  branchId: string;
  /** Birden çok kasa açıkken şubenin adı (başlıkta); tek kasada null */
  branchName: string | null;
  /** Kullanılan değer; gizli alanlar çıkarılmış (değerleri yalnız sunucuda, burada hiç yok) */
  value: T;
  link: SettingLinkView | null;
  /** Gizli alanların durumu */
  secrets: Record<string, SecretState>;
}

/** Grubun bu şubedeki kart verisi. Gizli alanlar değerden çıkarılır (yalnız `secrets` durumu gider) */
export async function branchSettingView<T extends Record<string, unknown>>(group: BranchSettingGroup<T>, branchId: string): Promise<BranchSettingView<T>> {
  const [resolved, branches, links] = await Promise.all([resolveBranchSetting(group, branchId), listBranches(), settingLinks(group.id)]);
  const many = tillBranches(branches).length > 1;
  const name = (id: string) => branches.find((b) => b.id === id)?.name ?? id;
  const value = Object.fromEntries(Object.entries(resolved.value).filter(([k]) => !group.secretFields.includes(k))) as T;
  return {
    branchId,
    branchName: many ? name(branchId) : null,
    value,
    link:
      many && group.linkable
        ? {
            mode: resolved.mode,
            toName: resolved.mode.kind === "linked" ? name(resolved.mode.to) : null,
            targets: settingLinkTargets(group, branchId, links, branches).map((b) => ({ id: b.id, name: b.name })),
            sharedWith: settingDependents(group, branchId, links, branches).map((b) => b.name),
          }
        : null,
    secrets: resolved.secrets,
  };
}

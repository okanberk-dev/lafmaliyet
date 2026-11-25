/*
 * Şube başına ayarların saf kuralları (docs/SUBE.md › Şube başına ayarlar): bir şubenin bir grupta kendi ayarı mı var,
 * başka şubeye mi bağlı, değeri hangi şubeden okunur, "aynı" seçimi geçerli mi. Sunucu (src/server/branch-settings.ts)
 * bu kurallarla okur ve yazar; tests/branch-settings.test.ts doğrudan sınar.
 */

import { DEFAULT_BRANCH_ID, type BranchRow } from "@/lib/branches";

import type { BranchSettingGroup } from "./groups";

/** Bir grubun bir şubedeki satırı (yalnız bağ bilgisi) */
export interface SettingLink {
  branchId: string;
  sameAs: string | null;
}

/**
 * Şubenin bir gruptaki durumu: kendi ayarı ya da başka şubenin ayarını kullanıyor. `implicit`: satırı yok, "aynı"
 * sunulan grupta varsayılan şubeye örtük bağlı (geçişte öbür şubeler böyle başlar)
 */
export type SettingMode = { kind: "own" } | { kind: "linked"; to: string; implicit: boolean };

type Group = Pick<BranchSettingGroup, "linkable">;
type Branch = Pick<BranchRow, "id" | "name" | "kind" | "active">;

/** Şube bu grupta kendi ayarını mı tutuyor, yoksa başka şubeninkini mi kullanıyor */
export function settingMode(group: Group, branchId: string, rows: readonly SettingLink[], defaultBranchId = DEFAULT_BRANCH_ID): SettingMode {
  const row = rows.find((r) => r.branchId === branchId);
  // Varsayılan şube öbürlerinin örtük hedefidir: hiçbir zaman bağlı sayılmaz (bozuk bir satır da okumayı döngüye sokmasın)
  if (branchId === defaultBranchId || !group.linkable) return { kind: "own" };
  if (row) return row.sameAs && row.sameAs !== branchId ? { kind: "linked", to: row.sameAs, implicit: false } : { kind: "own" };
  return { kind: "linked", to: defaultBranchId, implicit: true };
}

const isTill = (b: Branch | undefined): b is Branch => !!b && b.kind === "fiziksel" && b.active;

/**
 * Değerin okunacağı şube: kendi ayarıysa kendisi, bağlıysa hedefi. Hedef artık geçerli değilse (kapandı, kendisi de
 * başka şubeye bağlandı; sunucu yazarken bunu reddeder, okurken yine de) varsayılan şube: değer hiçbir zaman zincirle
 * ya da döngüyle aranmaz.
 */
export function settingSource(group: Group, branchId: string, rows: readonly SettingLink[], branches: readonly Branch[], defaultBranchId = DEFAULT_BRANCH_ID): { from: string; mode: SettingMode } {
  const mode = settingMode(group, branchId, rows, defaultBranchId);
  if (mode.kind === "own") return { from: branchId, mode };
  const target = branches.find((b) => b.id === mode.to);
  const ok = isTill(target) && settingMode(group, target.id, rows, defaultBranchId).kind === "own";
  return { from: ok ? mode.to : defaultBranchId, mode };
}

/** Bu şubenin ayarını kullanan (açık) şubeler: örtük bağlılar dahil */
export function settingDependents(group: Group, branchId: string, rows: readonly SettingLink[], branches: readonly Branch[], defaultBranchId = DEFAULT_BRANCH_ID): Branch[] {
  return branches.filter((b) => {
    if (b.id === branchId || !isTill(b)) return false;
    const m = settingMode(group, b.id, rows, defaultBranchId);
    return m.kind === "linked" && m.to === branchId;
  });
}

/**
 * "Diğer şubeyle aynı" seçimi geçerli mi: "aynı" sunulan grup, kendisi değil, açık bir şube, hedefin kendi ayarı var
 * (bağ tek adım), bu şubeye bağlı başka şube yok (yoksa onlar zincire girerdi). Varsayılan şube öbürlerinin örtük
 * hedefidir, kendisi bağlanamaz.
 */
export function settingLinkError(
  group: Pick<BranchSettingGroup, "linkable" | "label">,
  branchId: string,
  target: string,
  rows: readonly SettingLink[],
  branches: readonly Branch[],
  defaultBranchId = DEFAULT_BRANCH_ID,
): string | null {
  const name = (id: string) => branches.find((b) => b.id === id)?.name ?? id;
  if (!group.linkable) return `${group.label} şube başına tutulur; başka şubeyle aynı seçilemez`;
  if (target === branchId) return "Şube kendisiyle aynı seçilemez";
  if (branchId === defaultBranchId) return `${name(branchId)} öbür şubelerin bağlandığı ana ayardır; başka şubeye bağlanamaz`;
  const t = branches.find((b) => b.id === target);
  if (!isTill(t)) return "Bağlanacak şube açık bir şube olmalı";
  if (settingMode(group, target, rows, defaultBranchId).kind !== "own") return `${t.name} de başka şubenin ayarını kullanıyor; doğrudan o şubeyi seçin`;
  const deps = settingDependents(group, branchId, rows, branches, defaultBranchId);
  if (deps.length) return `${deps.map((d) => d.name).join(", ")} bu şubenin ayarını kullanıyor; önce onu ayırın`;
  return null;
}

/** "Aynı" seçilebilecek şubeler: açık, kendisi değil, kendi ayarı olan (ekrandaki seçim listesi) */
export function settingLinkTargets(group: Group, branchId: string, rows: readonly SettingLink[], branches: readonly Branch[], defaultBranchId = DEFAULT_BRANCH_ID): Branch[] {
  if (!group.linkable || branchId === defaultBranchId) return [];
  return branches.filter((b) => b.id !== branchId && isTill(b) && settingMode(group, b.id, rows, defaultBranchId).kind === "own");
}

/** Şubeyi kapatmadan önce: bu şubenin ayarını kullanan açık şubeler varsa ret metni (her grup için) */
export function settingCloseError(
  groups: readonly Pick<BranchSettingGroup, "linkable" | "label" | "id">[],
  branch: Pick<BranchRow, "id" | "name">,
  rowsByGroup: ReadonlyMap<string, readonly SettingLink[]>,
  branches: readonly Branch[],
  defaultBranchId = DEFAULT_BRANCH_ID,
): string | null {
  for (const g of groups) {
    const deps = settingDependents(g, branch.id, rowsByGroup.get(g.id) ?? [], branches, defaultBranchId);
    if (deps.length) return `${deps.map((d) => d.name).join(", ")}, ${g.label.toLocaleLowerCase("tr-TR")} için ${branch.name} şubesinin ayarını kullanıyor; önce Şube ayarları'ndan ayırın`;
  }
  return null;
}

/** Kartın durum çipi: "Kendi ayarı" ya da "Tuzla ile aynı" */
export function settingModeText(mode: SettingMode, branches: readonly Pick<BranchRow, "id" | "name">[]): string {
  if (mode.kind === "own") return "Kendi ayarı";
  return `${branches.find((b) => b.id === mode.to)?.name ?? mode.to} ile aynı`;
}

import "server-only";

import { PARASUT_GROUP } from "@/lib/branch-settings/groups";
import { settingDependents, settingLinkTargets, settingMode, type SettingMode } from "@/lib/branch-settings/rules";
import { tillBranches } from "@/lib/branches";
import { accountOfBranch } from "@/lib/parasut/accounts";
import { missingSettings } from "@/lib/parasut/settings";
import { settingLinks } from "@/server/branch-settings";
import { listBranches } from "@/server/branches";

import { parasutConnection } from "./client";
import { configFrom, hasParasutInvoices, loadParasutSettings } from "./config";

/** Şube ayarları ekranındaki Paraşüt kartının verisi (yalnız yönetici çizer; sır yok, yalnız durum) */
export interface ParasutLinkCardData {
  branchId: string;
  branchName: string;
  /** Birden çok kasa açık mı (tek kasada "aynı" seçimi çizilmez) */
  many: boolean;
  mode: SettingMode;
  /** Bağlıysa bağlandığı şubenin adı */
  toName: string | null;
  /** "Aynı" seçilebilecek şubeler (kendi hesabı olan açık şubeler) */
  targets: { id: string; name: string }[];
  /** Bu şubenin hesabını kullanan öbür şubeler */
  sharedWith: string[];
  /** Kullanılan hesabın durumu (bağlıysa hedef şubeninki) */
  account: { id: string; name: string; configured: boolean; connected: boolean; companyId: string | null };
  /** Şubenin kendi hesabından fatura geldi mi ("aynı" açılamaz) */
  hasInvoices: boolean;
}

/**
 * Şube ayarları › Paraşüt hesabı kartı (docs/PARASUT.md › Şube başına Paraşüt hesabı): şubenin "aynı" durumu ve
 * kullandığı hesabın bağlantı özeti. Ayarların kendisi Paraşüt ekranında, o şube seçiliyken düzenlenir
 */
export async function parasutLinkCardData(branchId: string): Promise<ParasutLinkCardData> {
  const [branches, links] = await Promise.all([listBranches(), settingLinks(PARASUT_GROUP.id)]);
  const name = (id: string) => branches.find((b) => b.id === id)?.name ?? id;
  const mode = settingMode(PARASUT_GROUP, branchId, links);
  const account = accountOfBranch(branchId, links, branches);
  const [{ resolved }, hasInvoices] = await Promise.all([loadParasutSettings(account), hasParasutInvoices(branchId)]);
  const configured = missingSettings(resolved).length === 0;
  const connection = await parasutConnection(undefined, configured ? configFrom(resolved, account) : null, account);
  return {
    branchId,
    branchName: name(branchId),
    many: tillBranches(branches).length > 1,
    mode,
    toName: mode.kind === "linked" ? name(mode.to) : null,
    targets: settingLinkTargets(PARASUT_GROUP, branchId, links, branches).map((b) => ({ id: b.id, name: b.name })),
    sharedWith: settingDependents(PARASUT_GROUP, branchId, links, branches).map((b) => b.name),
    account: { id: account, name: name(account), configured, connected: connection.connected, companyId: resolved.companyId.value },
    hasInvoices: mode.kind === "own" && hasInvoices,
  };
}

import "server-only";

import { CASH_REPORT_GROUP } from "@/lib/branch-settings/groups";
import { settingDependents, settingLinkTargets, type SettingMode } from "@/lib/branch-settings/rules";
import { tillBranches } from "@/lib/branches";
import type { DroppedRecipient } from "@/lib/notify-recipients";
import { settingLinks } from "@/server/branch-settings";
import { listBranches } from "@/server/branches";
import { loadCashSettingsView, type CashSettings } from "@/server/data/cash-reports";
import { getDb } from "@/server/db";
import { sendableRecipients } from "@/server/notify/recipients";

/** Kasa raporu ayarları kartının "diğer şubeyle aynı" bölümü (birden çok kasa açıkken) */
export interface CashSettingsLink {
  mode: SettingMode;
  /** Bağlıysa bağlandığı şubenin adı */
  toName: string | null;
  /** "Aynı" seçilebilecek şubeler (kendi ayarı olan açık şubeler) */
  targets: { id: string; name: string }[];
  /** Bu şubenin alıcılarını kullanan şubelerin adları ("Marina da bu alıcıları kullanıyor") */
  sharedWith: string[];
}

/** Kartın sunucudan gelen her şeyi (yalnız yönetici çizer; sırlar yok, bu grupta gizli alan da yok) */
export interface CashSettingsCardData {
  settings: CashSettings;
  /** Kayıtlı adreslerden personel ya da pasif hesabın olanlar (E-53): gönderimde düşer */
  blocked: DroppedRecipient[];
  /** Ayarın şubesi: kayıt buraya iner */
  branchId: string;
  /** Birden çok kasa açıkken şubenin adı (başlıkta); tek kasada null */
  branchName: string | null;
  link: CashSettingsLink | null;
  /** Çalışan listesi alanı: AsilPOS'lu şubede ya da listesi doluysa (ModPOS'lu şubede çalışan e-postası gitmez) */
  showStaff: boolean;
}

/**
 * Kasa raporu ayarları kartının verisi: kasanın (şubenin) ayarı, "aynı" durumu ve düşen adresler. Kasa sayfası ve Şube
 * ayarları ekranı aynı kartı bununla çizer (iki yerde iki kod yok).
 */
export async function cashSettingsCardData(branchId: string): Promise<CashSettingsCardData> {
  const [view, branches, links] = await Promise.all([loadCashSettingsView(branchId), listBranches(), settingLinks(CASH_REPORT_GROUP.id)]);
  const { dropped } = await sendableRecipients(getDb(), view.settings.recipients);
  const tills = tillBranches(branches);
  const branch = branches.find((b) => b.id === branchId);
  const many = tills.length > 1;
  const name = (id: string) => branches.find((b) => b.id === id)?.name ?? id;
  return {
    settings: view.settings,
    blocked: dropped,
    branchId,
    branchName: many ? (branch?.name ?? branchId) : null,
    link: many
      ? {
          mode: view.mode,
          toName: view.mode.kind === "linked" ? name(view.mode.to) : null,
          targets: settingLinkTargets(CASH_REPORT_GROUP, branchId, links, branches).map((b) => ({ id: b.id, name: b.name })),
          sharedWith: settingDependents(CASH_REPORT_GROUP, branchId, links, branches).map((b) => b.name),
        }
      : null,
    showStaff: branch?.posSource === "asilpos" || Boolean(view.settings.staffRecipients?.length),
  };
}

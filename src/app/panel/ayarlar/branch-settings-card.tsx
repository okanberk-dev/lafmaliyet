import { Building2, ChevronRight } from "lucide-react";

import { ButtonLink } from "@/components/ui/button";
import { hasFeature, offFeatureLabels } from "@/lib/branch-features";
import { CALENDAR_GROUP, CASH_REPORT_GROUP, COMMISSION_GROUP, PARASUT_GROUP } from "@/lib/branch-settings/groups";
import { settingMode, settingModeText, type SettingMode } from "@/lib/branch-settings/rules";
import { tillBranches } from "@/lib/branches";
import { currentBranchScope } from "@/server/branch-scope";
import { settingLinks } from "@/server/branch-settings";
import { listBranches } from "@/server/branches";

import { SectionCard } from "./section-card";

/**
 * Şube başına ayarlara ve şube özelliklerine giriş (docs/SUBE.md › Şube başına ayarlar, Şube özellikleri): ayarların ve
 * özellik anahtarlarının kendisi Şube ayarları ekranında (/panel/subeler/[id]). Tek şube seçiliyken doğrudan o şubenin
 * ekranı, "Tümü"de şube listesi açılır (her satırda "Kendi ayarı / Tuzla ile aynı"). Özet satırı karaokenin şubesini ve
 * kullanılmayan özellikleri de söyler. Telefonda öteki bölümlerle aynı satır, dokununca ekran açılır.
 */
export async function BranchSettingsLinkCard() {
  const [scope, branches, links, parasutLinks, commissionLinks, calendarLinks] = await Promise.all([
    currentBranchScope(),
    listBranches(),
    settingLinks(CASH_REPORT_GROUP.id),
    settingLinks(PARASUT_GROUP.id),
    settingLinks(COMMISSION_GROUP.id),
    settingLinks(CALENDAR_GROUP.id),
  ]);
  const tills = tillBranches(branches);
  const selected = tills.find((b) => b.id === scope) ?? (tills.length === 1 ? tills[0] : null);
  const href = selected ? `/panel/subeler/${encodeURIComponent(selected.id)}` : "/panel/subeler";
  // Şube özellikleri (docs/SUBE.md › Şube özellikleri): karaoke hangi şubede, hangi özellik kullanılmıyor
  const features = (b: (typeof tills)[number]) => {
    const off = offFeatureLabels(b);
    return [hasFeature(b, "karaoke") ? "karaoke" : null, off.length ? `kullanılmıyor: ${off.join(", ").toLocaleLowerCase("tr-TR")}` : null].filter(Boolean).join(", ");
  };
  // Bağlar şube adıyla, adın büyük harfi korunur: "rapor alıcıları Tuzla ile aynı, Paraşüt Tuzla ile aynı"
  const linkText = (what: string, own: string, mode: SettingMode) => (mode.kind === "own" ? `${what} ${own}` : `${what} ${settingModeText(mode, branches)}`);
  const line = (b: (typeof tills)[number]) =>
    [
      linkText("rapor alıcıları", "kendi", settingMode(CASH_REPORT_GROUP, b.id, links)),
      linkText("Paraşüt", "kendi hesabı", settingMode(PARASUT_GROUP, b.id, parasutLinks)),
      // Tek kasada "aynı" yok: komisyon ve takvim satırı yalnız birden çok kasada (yoksa her şey "kendi")
      tills.length > 1 ? linkText("komisyon", "kendi", settingMode(COMMISSION_GROUP, b.id, commissionLinks)) : null,
      tills.length > 1 ? linkText("takvim", "kendi", settingMode(CALENDAR_GROUP, b.id, calendarLinks)) : null,
      features(b),
    ]
      .filter(Boolean)
      .join(", ");
  const summary = selected ? `${selected.name} · ${line(selected)}` : tills.map((b) => `${b.name}: ${line(b)}`).join(" · ");
  return (
    <SectionCard
      id="sube-ayarlari"
      href={href}
      icon={<Building2 />}
      title="Şube ayarları"
      summary={summary}
      description="Şubede kullanılan özellikler (karaoke, uygulama siparişleri, garson çağır, yemek kartı) ve şubeye göre değişen ayarlar: kasa raporu alıcıları, çalışanların gün sonu e-postası, Paraşüt hesabı, LafPOS ya da ModPOS bağlantısı, banka POS ve yazarkasa, komisyon kanalları ve çalışma takvimi. Bir şube öbürüyle aynı ayarı kullanabilir; değer tek yerden düzenlenir."
      actions={
        <ButtonLink href={href} variant="primary">
          {selected ? `${selected.name} ayarları` : "Şubeleri aç"} <ChevronRight size={16} />
        </ButtonLink>
      }
    />
  );
}

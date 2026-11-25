import type { ReactNode } from "react";

import { ButtonLink } from "@/components/ui/button";
import { BRANCH_PARAM } from "@/lib/branches";
import { POS_ELSEWHERE, posElsewhereText } from "@/lib/pos-cards";

import { SectionCard } from "./section-card";
import type { SettingsSectionId } from "./sections";

/**
 * Seçili şubede kullanılmayan kasa sisteminin kartı (Ayarlar › LafPOS ve ModPOS; şube kapsamı C P2-2): kapalıyken tek
 * satır "Bu şubede kullanılmıyor", açılınca sistemin hangi şubenin kasası olduğu ve o şubeyi seçtiren bağlantı
 * (`?sube=`, seçici çereze benimsetir; bölüm adresle açılır). Veri okunmaz: kartın durumu o şube seçiliyken görünür.
 * Sunucu bileşeni; düğmeler bağlantıdır (44 px).
 */
export function PosElsewhereCard({
  id,
  icon,
  title,
  system,
  users,
}: {
  id: Extract<SettingsSectionId, "lafpos" | "modpos">;
  icon: ReactNode;
  title: string;
  /** Metindeki adı: "LafPOS", "ModPOS" */
  system: string;
  /** Sistemin kullanıldığı şubeler */
  users: readonly { id: string; name: string }[];
}) {
  return (
    <SectionCard
      id={id}
      icon={icon}
      title={title}
      summary={POS_ELSEWHERE}
      description={`${POS_ELSEWHERE}. ${posElsewhereText(system, users)}`}
      actions={users.map((b) => (
        <ButtonLink key={b.id} href={`/panel/ayarlar?${BRANCH_PARAM}=${encodeURIComponent(b.id)}#${id}`} variant="secondary" className="min-h-11">
          {b.name}
        </ButtonLink>
      ))}
    />
  );
}

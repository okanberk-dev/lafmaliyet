"use client";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

/**
 * Pencereyi kapatmadan önceki soru, ayrı bir onay penceresi yerine pencerenin kendi altbilgisinde: üst üste iki
 * <dialog> açıkken Esc'ye art arda basılınca tarayıcı ikisini birden kapatabiliyor, Dialog da kendini yeniden
 * açınca soru arkada (görünmez) kalıyordu. Burada soru hep görünür; "Geri dön" pencereye döner.
 */
export function CloseGuardFooter({
  title,
  description,
  confirmLabel,
  onStay,
  onLeave,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onStay: () => void;
  onLeave: () => void;
}) {
  return (
    <>
      <Notice tone="warn" size="sm" live="assertive" className="w-full" title={title} text={description} />
      {/* Klavyeyle gelen soru da odağı güvenli seçeneğe alır */}
      <Button variant="ghost" autoFocus onClick={onStay} className="max-sm:h-11 max-sm:bg-panel">
        Geri dön
      </Button>
      <Button variant="danger" onClick={onLeave} className="max-sm:h-11">
        {confirmLabel}
      </Button>
    </>
  );
}

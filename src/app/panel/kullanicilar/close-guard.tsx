"use client";

import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

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
      <p role="alert" className="flex w-full items-start gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-[13px] leading-5 text-warn">
        <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          <span className="font-semibold">{title}</span> {description}
        </span>
      </p>
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

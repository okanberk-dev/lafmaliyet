"use client";

import { CircleDashed } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useQueryState } from "@/components/ui/filters";

import { parseStatus } from "./rules";

/**
 * Listenin üstündeki uyarı: eşitleme bazı faturaların kategorisini tahminle yazdı. Düğme listeyi "Kontrol
 * bekleyen" süzgecine alır (?durum=kontrol); süzgeç açıkken uyarı çekilir (liste ve alttaki çubuk aynı şeyi söyler).
 * Sayı sunucudan gelir; onaylayınca sunucu eylemi sayfayı yeniler.
 */
export function ReviewNotice({ count }: { count: number }) {
  const [rawStatus, setStatus] = useQueryState<string>("durum", "tumu");
  if (!count || parseStatus(rawStatus) === "kontrol") return null;

  function show() {
    setStatus("kontrol");
    // Görünen liste: Next önceki gezinmenin sayfasını gizli tutabilir (aynı kimlikli ikinci, görünmez kopya)
    requestAnimationFrame(() => {
      const list = [...document.querySelectorAll<HTMLElement>("#fatura-listesi")].find((el) => el.getClientRects().length > 0);
      list?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
  }

  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
      <CircleDashed size={18} className="shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-pretty">
        <span className="font-semibold">{count} fatura kategorisi tahminle yazıldı;</span> kontrol edin.
        <span className="text-warn/85 max-sm:hidden"> Doğruysa onaylayın, değilse kategoriyi değiştirin.</span>
      </p>
      <Button variant="secondary" size="sm" onClick={show} className="text-ink max-sm:w-full">
        Kontrol bekleyenleri göster
      </Button>
    </div>
  );
}

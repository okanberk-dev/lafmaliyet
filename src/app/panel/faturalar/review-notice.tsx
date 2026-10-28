"use client";

import { CircleDashed } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useQueryState } from "@/components/ui/filters";

import { parseStatus } from "./rules";

/**
 * Listenin üstündeki uyarı: eşitleme bazı faturaların kategorisini tahminle yazdı ya da (E-07) kalemi hammaddeye bağlı
 * faturanın kategorisi mal alışı değil (`stockOnly`: stoğa giriyor, gelir-gidere girmiyor) ya da (E-42) kasadan
 * faturalı alımın faturası yok (`cashOuts`: hiçbir hesaba girmedi). Düğme listeyi "Kontrol
 * bekleyen" süzgecine alır (?durum=kontrol); süzgeç açıkken uyarı çekilir (liste ve alttaki çubuk aynı şeyi söyler).
 * Sayı sunucudan gelir; onaylayınca sunucu eylemi sayfayı yeniler.
 */
export function ReviewNotice({ count, stockOnly = 0, cashOuts = 0 }: { count: number; stockOnly?: number; cashOuts?: number }) {
  const [rawStatus, setStatus] = useQueryState<string>("durum", "tumu");
  if ((!count && !cashOuts) || parseStatus(rawStatus) === "kontrol") return null;
  const guessed = count - stockOnly;

  function show() {
    setStatus("kontrol");
    // Görünen liste: Next önceki gezinmenin sayfasını gizli tutabilir (aynı kimlikli ikinci, görünmez kopya). Kasadan
    // faturalı alımlar varsa onların kartı (listenin üstünde)
    const target = cashOuts ? "#kasa-faturali" : "#fatura-listesi";
    requestAnimationFrame(() => {
      const list = [...document.querySelectorAll<HTMLElement>(target)].find((el) => el.getClientRects().length > 0);
      list?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
  }

  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
      <CircleDashed size={18} className="shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-pretty">
        {guessed > 0 ? (
          <span className="block">
            <span className="font-semibold">{guessed} fatura kategorisi tahminle yazıldı;</span> kontrol edin.
            <span className="text-warn/85 max-sm:hidden"> Doğruysa onaylayın, değilse kategoriyi değiştirin.</span>
          </span>
        ) : null}
        {stockOnly > 0 ? (
          <span className="block">
            <span className="font-semibold">{stockOnly} fatura mal alışı sayılmıyor:</span> kalemleri hammaddeye bağlı, stoğa giriyor ama gelir-gidere
            girmiyor. Kategorisini mal alışı (Hammadde &amp; İçecek, Tatlı &amp; Hazır Ürün, Ambalaj) yapın.
          </span>
        ) : null}
        {cashOuts > 0 ? (
          <span className="block">
            <span className="font-semibold">{cashOuts} kasadan faturalı alım bekliyor:</span> e-Arşiv ya da faturalı, faturası Faturalar&apos;da yok ve
            gelir-gidere girmedi. Faturalar&apos;a ekleyin ya da Aylık harcamalar&apos;a yazın.
          </span>
        ) : null}
      </p>
      <Button variant="secondary" size="sm" onClick={show} className="text-ink max-sm:w-full">
        Kontrol bekleyenleri göster
      </Button>
    </div>
  );
}

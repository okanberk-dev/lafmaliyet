"use client";

import { Button } from "@/components/ui/button";
import { useQueryState } from "@/components/ui/filters";
import { Notice } from "@/components/ui/notice";

import { parseStatus } from "./rules";

/**
 * Listenin üstündeki uyarı: eşitleme bazı faturaların kategorisini tahminle yazdı ya da (E-07) kalemi hammaddeye bağlı
 * faturanın kategorisi mal alışı değil (`stockOnly`: stoğa giriyor, gelir-gidere girmiyor) ya da (E-42) kasadan
 * faturalı alımın faturası yok (`cashOuts`: hiçbir hesaba girmedi) ya da Aylık harcamalar'a yazılmış kasa alımının
 * faturası sonradan geldi (`cashOutDuplicates`: iki kez sayılıyor). Düğme listeyi "Kontrol
 * bekleyen" süzgecine alır (?durum=kontrol); süzgeç açıkken uyarı çekilir (liste ve alttaki çubuk aynı şeyi söyler).
 * Sayı sunucudan gelir; onaylayınca sunucu eylemi sayfayı yeniler.
 */
export function ReviewNotice({ count, stockOnly = 0, cashOuts = 0, cashOutDuplicates = 0 }: { count: number; stockOnly?: number; cashOuts?: number; cashOutDuplicates?: number }) {
  const [rawStatus, setStatus] = useQueryState<string>("durum", "tumu");
  if ((!count && !cashOuts && !cashOutDuplicates) || parseStatus(rawStatus) === "kontrol") return null;
  const guessed = count - stockOnly;

  function show() {
    setStatus("kontrol");
    // Görünen liste: Next önceki gezinmenin sayfasını gizli tutabilir (aynı kimlikli ikinci, görünmez kopya). Kasadan
    // faturalı alımlar varsa onların kartı (listenin üstünde)
    const target = cashOuts || cashOutDuplicates ? "#kasa-faturali" : "#fatura-listesi";
    requestAnimationFrame(() => {
      const list = [...document.querySelectorAll<HTMLElement>(target)].find((el) => el.getClientRects().length > 0);
      list?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
  }

  // Her gerçek bir kez: ilki başlık; birden çoksa ötekilerin başlığı ikinci satırda, açıklamaları Ayrıntı'da
  const facts = [
    guessed > 0 ? { head: `${guessed} faturanın kategorisi tahmin: kontrol edin`, body: "Doğruysa onaylayın, değilse kategoriyi değiştirin." } : null,
    stockOnly > 0
      ? {
          head: `${stockOnly} fatura mal alışı sayılmıyor`,
          body: "Kalemleri hammaddeye bağlı, stoğa giriyor ama gelir-gidere girmiyor. Kategorisini mal alışı (Hammadde & İçecek, Tatlı & Hazır Ürün, Ambalaj) yapın.",
        }
      : null,
    cashOuts > 0
      ? {
          head: `${cashOuts} kasadan faturalı alım bekliyor`,
          body: "E-Arşiv ya da faturalı, faturası Faturalar'da yok ve gelir-gidere girmedi. Faturalar'a ekleyin ya da Aylık harcamalar'a yazın.",
        }
      : null,
    cashOutDuplicates > 0 ? { head: `${cashOutDuplicates} kasa alımı iki kez sayılıyor`, body: "Aylık harcamalar'a yazılmıştı, faturası sonra geldi. Gider kaydını silin." } : null,
  ].filter((f) => f !== null);
  const [first, ...rest] = facts;
  if (!first) return null;

  return (
    <Notice
      tone="warn"
      live="polite"
      // Kasa alımı gelir-gidere girmedi ya da iki kez sayılıyor: ayın gideri yanlış (katlanmaz)
      risk={cashOuts || cashOutDuplicates ? "para" : undefined}
      className="mb-4"
      title={first.head}
      text={rest.length ? rest.map((f) => f.head).join(" · ") : first.body}
      action={
        <Button variant="secondary" size="xs" onClick={show}>
          Kontrol bekleyenleri göster
        </Button>
      }
    >
      {rest.length
        ? facts.map((f) => (
            <p key={f.head}>
              <span className="font-medium text-ink">{f.head}:</span> {f.body}
            </p>
          ))
        : null}
    </Notice>
  );
}

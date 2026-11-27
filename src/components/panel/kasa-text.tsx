import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import { loadTillScope } from "@/server/data/till-scope";

/**
 * Bugünün kasasına göre metin (denetim E-39; src/lib/asilpos/kasa.ts): geçiş günü boşken, bugün ondan önceyse ya da ayar
 * okunamazsa `modpos` (bugünkü metin, beklerken de o görünür), geçiş gününden itibaren `asilpos`. Yalnız sunucuda çizilen
 * sayfa başlıkları için (ör. Kasa raporunun açıklaması); verisi zaten okunan ekran metni yükleyicinin `kasa`'sını kullanır.
 */
export function KasaText({ modpos, asilpos }: { modpos: ReactNode; asilpos: ReactNode }) {
  return (
    <Suspense fallback={modpos}>
      <KasaTextNow modpos={modpos} asilpos={asilpos} />
    </Suspense>
  );
}

async function KasaTextNow({ modpos, asilpos }: { modpos: ReactNode; asilpos: ReactNode }) {
  // Saat isteğin anında okunur (önceden çizilen kabukta ModPOS metni kalır)
  await connection();
  const scope = await loadTillScope().catch(() => null);
  return scope?.asilpos ? asilpos : modpos;
}

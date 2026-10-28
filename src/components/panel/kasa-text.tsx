import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import { loadTillScope } from "@/server/data/till-scope";

/**
 * Bugünün kasasına göre metin (denetim E-39; src/lib/lafpos/kasa.ts): geçiş günü boşken, bugün ondan önceyse ya da ayar
 * okunamazsa `modpos` (bugünkü metin, beklerken de o görünür), geçiş gününden itibaren `lafpos`. Yalnız sunucuda çizilen
 * sayfa başlıkları için (ör. Kasa raporunun açıklaması); verisi zaten okunan ekran metni yükleyicinin `kasa`'sını kullanır.
 */
export function KasaText({ modpos, lafpos }: { modpos: ReactNode; lafpos: ReactNode }) {
  return (
    <Suspense fallback={modpos}>
      <KasaTextNow modpos={modpos} lafpos={lafpos} />
    </Suspense>
  );
}

async function KasaTextNow({ modpos, lafpos }: { modpos: ReactNode; lafpos: ReactNode }) {
  // Saat isteğin anında okunur (önceden çizilen kabukta ModPOS metni kalır)
  await connection();
  const scope = await loadTillScope().catch(() => null);
  return scope?.lafpos ? lafpos : modpos;
}

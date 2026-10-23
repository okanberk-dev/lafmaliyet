"use client";

import { usePathname } from "next/navigation";

import { ErrorView } from "@/components/panel/error-view";
import { autoRetryPath } from "@/lib/error-retry";

/**
 * Panel sayfalarının hata ekranı. "Tekrar dene" sayfayı sunucudan yeniden ister (`retry`); bar ekranı (Karaoke)
 * gözetimsiz açık durduğu için orada kendiliğinden de dener (src/lib/error-retry.ts). Panelin kenar çubuğundaki
 * (layout) hata bu sınırın dışında kalır: onu src/app/error.tsx karşılar.
 */
export default function PanelError({ error, retry }: { error: unknown; retry: () => void }) {
  const pathname = usePathname();
  return <ErrorView error={error} retry={retry} auto={autoRetryPath(pathname)} />;
}

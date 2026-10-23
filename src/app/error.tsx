"use client";

import { usePathname } from "next/navigation";

import { ErrorView } from "@/components/panel/error-view";
import { autoRetryPath } from "@/lib/error-retry";

/**
 * Uygulamanın hata ekranı: panelin düzenindeki (kenar çubuğu: oturum, arama dizini) ve giriş gibi sayfalardaki hata.
 * Bir sayfanın kendi hata sınırı (src/app/panel/error.tsx) düzeni sarmaz; bu olmadan Next'in biçimsiz, düğmesiz
 * varsayılan sayfası çıkıyordu. Kök düzendeki hata src/app/global-error.tsx'te.
 */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  const pathname = usePathname();
  return (
    <main className="min-h-dvh bg-background px-4 py-6">
      <ErrorView error={error} retry={retry} auto={autoRetryPath(pathname)} />
    </main>
  );
}

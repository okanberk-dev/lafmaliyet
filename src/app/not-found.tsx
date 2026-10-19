import { ArrowLeft, BookOpen } from "lucide-react";

import { LafMark } from "@/components/brand";
import { ButtonLink } from "@/components/ui/button";

/** Bulunamayan adres: panel kullanıcısı da (eski bağlantı) QR'dan gelen misafir de (yanlış adres) yolunu bulsun */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-6 py-12 text-center">
      <LafMark tone="green" className="h-14 w-auto" />
      <p className="mt-2 font-mono text-[13px] font-medium text-ink-mute">404</p>
      <h1 className="font-display text-3xl font-bold tracking-tight text-balance text-ink">Sayfa bulunamadı</h1>
      <p className="max-w-sm text-pretty text-ink-mute">Aradığınız sayfa taşınmış ya da hiç var olmamış olabilir. Adresi kontrol edin ya da aşağıdan devam edin.</p>
      <div className="mt-2 flex w-full max-w-xs flex-col gap-2 sm:w-auto sm:max-w-none sm:flex-row">
        <ButtonLink href="/panel" variant="primary" size="lg">
          <ArrowLeft size={16} aria-hidden="true" /> Panele dön
        </ButtonLink>
        <ButtonLink href="/menu" variant="secondary" size="lg">
          <BookOpen size={16} aria-hidden="true" /> Menüye git
        </ButtonLink>
      </div>
    </main>
  );
}

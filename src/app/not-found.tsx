import { LafMark } from "@/components/brand";
import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
      <LafMark tone="green" className="h-14 w-auto" />
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Sayfa bulunamadı</h1>
      <p className="max-w-sm text-ink-mute">Aradığınız sayfa taşınmış ya da hiç var olmamış olabilir.</p>
      <ButtonLink href="/panel" variant="primary">
        Panele dön
      </ButtonLink>
    </div>
  );
}

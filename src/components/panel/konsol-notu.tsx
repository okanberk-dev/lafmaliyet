import { ExternalLink } from "lucide-react";

import { KONSOLDA_YAPILIR } from "@/lib/asil-yonetici";
import { cn } from "@/lib/utils";

/**
 * ladmin'de Yönetim konsoluna taşınan bir işin yerinde duran tek cümle (docs/planlar/yonetim-konsolu.md › K-C): "Bu iş
 * Yönetim konsolunda yapılır". `href` yalnız sayfayı açan asıl yöneticiyse dolu (sunucu `panelden(...)` ile kurar,
 * src/lib/yonetim-host.ts): konsolun ilgili sayfasına bağlantı; öteki yöneticiye yalnız cümle. `konu` cümlenin önüne
 * hangi işin taşındığını yazar ("Şube açmak ve kasa kurmak"). "use client" yok, işlev prop'u yok: sunucu ve istemci
 * bileşenleri birlikte kullanır
 */
export function KonsolNotu({ href, konu, className }: { href: string | null; konu?: string; className?: string }) {
  return (
    <p className={cn("text-[13px] leading-5 text-pretty text-ink-mute", className)}>
      {konu ? <span className="font-medium text-ink-soft">{konu}: </span> : null}
      {KONSOLDA_YAPILIR}
      {href ? (
        <>
          {" "}
          <a
            href={href}
            className="inline-flex items-center gap-1 font-medium whitespace-nowrap text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
          >
            Yönetim konsolunu aç <ExternalLink size={12} aria-hidden />
          </a>
        </>
      ) : null}
    </p>
  );
}

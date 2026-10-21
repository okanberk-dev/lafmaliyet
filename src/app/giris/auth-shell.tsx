import { ChartPie, LockKeyhole, Receipt, ShieldCheck, Wallet } from "lucide-react";
import type { ReactNode } from "react";

import { LafMark } from "@/components/brand";

/** Uygulama ikonunun yeşili (LafTile ile aynı): koyu orman yeşili, ışık sol üstten */
const GREEN = "bg-[radial-gradient(120%_90%_at_15%_0%,#2a9474_0%,#1d6d56_42%,#0c3b2d_100%)]";
const CREAM = "text-[#fbf8f4]";

const FEATURES = [
  { icon: ChartPie, text: "Ürün maliyeti, kâr ve menü fiyatları" },
  { icon: Receipt, text: "Paraşüt'ten her sabah gelen faturalar" },
  { icon: Wallet, text: "Kasa raporu, ödemeler ve tedarikçiler" },
];

/** Kahve fincanına yukarıdan bakış: krema halkaları ve çekirdek rengi ışıltı (yalnız süs, ekran okuyucudan gizli) */
function Crema({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 400" aria-hidden="true" className={className}>
      <defs>
        <radialGradient id="auth-crema" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#e8c877" stopOpacity="0.55" />
          <stop offset="60%" stopColor="#c9a24a" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#c9a24a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="200" cy="200" r="190" fill="url(#auth-crema)" />
      {[60, 95, 130, 165, 190].map((r, i) => (
        <circle key={r} cx="200" cy="200" r={r} fill="none" stroke="#fbf8f4" strokeOpacity={0.16 - i * 0.022} strokeWidth={i === 0 ? 1.5 : 1} strokeDasharray={i % 2 ? "2 7" : undefined} />
      ))}
    </svg>
  );
}

/**
 * Giriş ve parola belirleme sayfalarının çerçevesi. Masaüstünde solda form, sağda kafenin renkleriyle marka paneli
 * (L'Af işareti, ne işe yaradığı, güvenlik notu); telefonda üstte kısa marka alanı, form onun üstüne binen kartta.
 * Süsler hareketi azalt ayarında durur.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-dvh bg-background lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Marka paneli: telefonda üstte, masaüstünde sağda (sayfayla birlikte kaymaz) */}
      <aside
        className={`relative isolate overflow-hidden ${GREEN} ${CREAM} max-lg:flex max-lg:min-h-[36dvh] max-lg:flex-col max-lg:justify-center max-lg:rounded-b-[32px] max-lg:px-6 max-lg:pt-[max(2rem,env(safe-area-inset-top))] max-lg:pb-14 lg:sticky lg:top-3 lg:order-last lg:m-3 lg:flex lg:h-[calc(100dvh-1.5rem)] lg:flex-col lg:rounded-[28px] lg:p-10 xl:p-12`}
      >
        <Crema className="pointer-events-none absolute -right-24 -bottom-28 -z-10 size-[420px] motion-safe:animate-[spin_90s_linear_infinite] lg:-right-28 lg:-bottom-32 lg:size-[560px]" />
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 -left-16 -z-10 size-72 rounded-full bg-[#2fa37f]/30 blur-3xl" />

        {/* Telefon: ortada işaret ve tek satır */}
        <div className="flex flex-col items-center text-center lg:hidden">
          <LafMark tone="cream" className="h-12" title="L'Affogato" />
          <p className="mt-3 text-sm font-medium text-[#fbf8f4]/80">Yönetim paneli</p>
          <p className="mt-1 text-[13px] text-[#fbf8f4]/60">Maliyet, fatura ve kasa tek yerde</p>
        </div>

        {/* Masaüstü */}
        <div className="flex items-center gap-3 max-lg:hidden">
          <LafMark tone="cream" className="h-9" title="L'Affogato" />
          <span className="h-6 w-px bg-[#fbf8f4]/25" aria-hidden="true" />
          <span className="text-sm font-medium text-[#fbf8f4]/80">Yönetim paneli</span>
        </div>
        <div className="my-auto max-w-md py-10 max-lg:hidden">
          <h2 className="text-[34px] leading-[1.15] font-semibold tracking-tight text-balance xl:text-[40px]">Maliyet, fatura ve kasa tek yerde.</h2>
          <p className="mt-4 text-[15px] leading-7 text-[#fbf8f4]/75">L&apos;Affogato&apos;nun hesabı her sabah güncel: ne kazandığınızı, kime ne ödeyeceğinizi ve kasada ne olduğunu görün.</p>
          <ul className="mt-8 space-y-3.5">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-[15px] text-[#fbf8f4]/90">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#fbf8f4]/10 ring-1 ring-[#fbf8f4]/15 ring-inset">
                  <Icon className="size-[18px] text-[#e8c877]" aria-hidden="true" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="flex items-center gap-2 text-[13px] text-[#fbf8f4]/70 max-lg:hidden">
          <ShieldCheck className="size-4 shrink-0 text-[#e8c877]" aria-hidden="true" />
          Şifreli bağlantı · iki adımlı doğrulama · yalnız davetli kullanıcılar
        </p>
      </aside>

      {/* Form: telefonda marka alanının üstüne biner */}
      <main className="relative z-10 flex justify-center px-4 max-lg:-mt-10 max-lg:pb-[max(2rem,env(safe-area-inset-bottom))] lg:min-h-dvh lg:items-center lg:px-10 lg:py-12">
        <div className="w-full max-w-[400px]">
          {children}
          <div className="mt-5 flex flex-col items-center gap-1 text-center text-xs leading-5 text-chart-muted">
            <p className="flex items-center gap-1.5">
              <LockKeyhole className="size-3.5 shrink-0" aria-hidden="true" />
              Ortak cihazda işiniz bitince çıkış yapın.
            </p>
            <a href="https://laffogato.net" className="-my-2 inline-flex min-h-11 items-center px-1 font-medium text-foreground underline-offset-2 hover:underline">
              laffogato.net
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}

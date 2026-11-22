import { CircleAlert } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/*
 * Giriş, parola sıfırlama ve davet ekranlarının ortak parçaları: yeşil zemin üstünde beyaz kart, çerçeveli alan
 * (etiketi alanın içinde, yazınca yukarı kayar), hap biçimli yeşil düğme, altı çizili yeşil bağlantı. Renkler
 * kahve dükkânı yeşilleri: zemin #006241, düğme ve bağlantı #00754A.
 */

/** Beyaz kart (yeşil zeminde). Koyu temada `auth-card` kapsamında siyah ↔ beyaz yer değiştirir (globals.css): kart #1E1C1B */
export const authCard = "auth-card w-full rounded-2xl bg-white p-6 text-black/90 shadow-[0_14px_40px_-14px_rgb(0_0_0/0.45)] sm:p-9 dark:shadow-none";

/** Çerçeveli alan; telefonda 16px yazı (iOS odaklanınca yakınlaştırmaz) */
export const authInput =
  "h-14 w-full rounded-lg border border-black/35 bg-white px-4 text-base text-black/90 outline-none transition-[border-color,box-shadow] hover:border-black/60 focus:border-[#00754A] dark:focus:border-good focus:shadow-[inset_0_0_0_1px_#00754A] dark:focus:shadow-[inset_0_0_0_1px_var(--color-good)] aria-invalid:border-[#d62b1f] dark:aria-invalid:border-bad";

/** Hap biçimli birincil düğme */
export const authButton =
  "inline-flex h-12 min-w-36 cursor-pointer items-center justify-center gap-2 rounded-full bg-[#00754A] dark:bg-primary dark:text-on-primary dark:shadow-none px-7 text-base font-semibold text-white shadow-[0_0_6px_rgb(0_0_0/0.24),0_8px_12px_rgb(0_0_0/0.14)] transition-[background-color,box-shadow,transform] hover:bg-[#006241] dark:hover:bg-primary/85 active:scale-[0.97] active:shadow-none disabled:cursor-not-allowed disabled:opacity-60";

/** Altı çizili yeşil bağlantı ya da bağlantı gibi düğme */
export const authLink = "cursor-pointer font-semibold text-[#00754A] dark:text-good underline underline-offset-2 hover:text-[#006241] dark:hover:text-good/85";

/**
 * Etiketi alanın içinde duran çerçeveli alan: boşken etiket ortada, odaklanınca ya da doluyken yukarı kayar
 * (`placeholder=" "` ve :placeholder-shown ile; tarayıcının otomatik doldurması da etiketi kaldırır).
 */
export function FloatingField({ id, label, trailing, className, ...props }: ComponentProps<"input"> & { id: string; label: string; trailing?: ReactNode }) {
  return (
    <div className="relative">
      <input id={id} placeholder=" " className={cn(authInput, "peer pt-5 pb-1", trailing ? "pr-12" : null, className)} {...props} />
      <label
        htmlFor={id}
        className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-base text-black/60 transition-all duration-150 peer-focus:top-[1.05rem] peer-focus:text-xs peer-focus:font-semibold peer-focus:text-[#00754A] dark:peer-focus:text-good peer-[:not(:placeholder-shown)]:top-[1.05rem] peer-[:not(:placeholder-shown)]:text-xs peer-[:not(:placeholder-shown)]:font-semibold"
      >
        {label}
      </label>
      {trailing ? <div className="absolute top-1/2 right-1 -translate-y-1/2">{trailing}</div> : null}
    </div>
  );
}

/** Hata kutusu */
export function AuthError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2.5 rounded-lg bg-[#fdf3f2] dark:bg-bad-soft px-4 py-3 text-sm leading-6 text-[#c82014] dark:text-bad">
      <CircleAlert className="mt-1 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** Kartın başlığı */
export function AuthHeading({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-[26px] leading-tight font-bold tracking-tight text-pretty text-black/90 sm:text-[28px]">{title}</h1>
      {subtitle ? <p className="mt-1.5 text-[15px] leading-6 text-black/60">{subtitle}</p> : null}
    </header>
  );
}

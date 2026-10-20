import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * AkmanOS tablo dili: kartın gri zemininde, başlık satırı kalın 13px (büyük harf yok),
 * satırlar ince çizgiyle ayrılır, üzerine gelince hafif beyazlar.
 * Kartın içinde `<TableWrap>` yanlardan 8px, hücreler 12px boşluk verir.
 */
export function TableWrap({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("scroll-thin overflow-x-auto px-2 pb-2 first:pt-2", className)} {...props} />;
}

export function Table({ className, ...props }: ComponentProps<"table">) {
  return <table className={cn("w-full border-collapse text-sm", className)} {...props} />;
}

export function THead({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("text-left", className)} {...props} />;
}

/**
 * Sabit sütunun solundaki 8px'lik TableWrap boşluğunu kapatan şerit: kayan hücreler o aralıktan görünmesin
 * (border-collapse tablolarda hücre gölgesi çizilmediği için gölge yerine ::before).
 */
const STICKY_EDGE = "before:pointer-events-none before:absolute before:inset-y-0 before:-left-2 before:w-2 before:bg-panel";

/** Yatay kayan geniş tablolarda ilk sütunu sabitler (opak zemin, satır üzerine gelinince aynı ton) */
const STICKY = cn("sticky left-0 z-10 bg-panel group-hover:bg-[color-mix(in_oklab,var(--color-panel),white_60%)]", STICKY_EDGE);

export function TH({ className, numeric, sticky, ...props }: ComponentProps<"th"> & { numeric?: boolean; sticky?: boolean }) {
  return (
    <th
      className={cn(
        "border-b border-line-strong px-3 pt-1 pb-3 text-sm font-semibold whitespace-nowrap text-ink",
        numeric && "text-right",
        sticky && cn("sticky left-0 z-10 bg-panel", STICKY_EDGE),
        className,
      )}
      {...props}
    />
  );
}

export function TR({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("group border-b border-line-strong/70 transition-colors last:border-0 hover:bg-surface/60", className)} {...props} />;
}

export function TD({ className, numeric, sticky, ...props }: ComponentProps<"td"> & { numeric?: boolean; sticky?: boolean }) {
  return <td className={cn("px-3 py-3 align-middle text-ink", numeric && "text-right whitespace-nowrap tabular", sticky && STICKY, className)} {...props} />;
}

/** Toplam / alt bilgi satırı */
export function TFootRow({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("border-t border-line-strong font-semibold [&>td]:py-3", className)} {...props} />;
}

/**
 * Sıralanabilir başlık düğmesi (AkmanOS "User ↑ · Email ⇅"). Bir TH'nin içine konur.
 * `dir` yalnızca etkin sütunda verilir; diğerlerinde soluk ⇅ görünür. Dokunmatikte (tablet) görünmez bir kenarla
 * 44px yüksekliğinde dokunma alanı; başlık satırının yüksekliği değişmez.
 */
export function SortButton({
  children,
  dir,
  onClick,
  numeric,
}: {
  children: ReactNode;
  dir?: "asc" | "desc" | null;
  onClick: () => void;
  numeric?: boolean;
}) {
  const Icon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative -mx-1 inline-flex cursor-pointer items-center gap-1 rounded-md px-1 font-semibold hover:text-ink",
        "pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-3 pointer-coarse:after:content-['']",
        "text-ink",
        numeric && "flex-row-reverse",
      )}
    >
      {children}
      <Icon size={13} strokeWidth={2} className={dir ? "text-ink" : "text-ink-mute"} aria-hidden="true" />
      <span className="sr-only">{dir === "asc" ? "artan sırada" : dir === "desc" ? "azalan sırada" : "sırala"}</span>
    </button>
  );
}

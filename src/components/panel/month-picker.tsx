"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

const arrow =
  "flex h-full w-8 cursor-pointer items-center justify-center rounded-xl text-ink-mute hover:text-ink disabled:cursor-default disabled:opacity-30 pointer-coarse:w-11";

/**
 * Ay seçicinin yükleme ekranındaki yeri: aynı yükseklik (h-9, dokunmatikte h-11) ve yaklaşık genişlik (dokunmatikte
 * geniş oklar; telefonda yazı 16 px, sm: 14 px). Başlık yüklenince boyu değişmez, altındaki sekme satırı kaymaz.
 */
export function MonthPickerSkeleton() {
  return (
    <span
      aria-hidden
      className="block h-9 w-[13rem] animate-pulse rounded-xl bg-panel pointer-coarse:h-11 pointer-coarse:w-[14.5rem] sm:w-48 sm:pointer-coarse:w-[13.5rem]"
    />
  );
}

/**
 * ?ay=YYYY-MM parametresini değiştiren ay seçici (dokunmatikte 44px yüksekliğinde, oklar 44px). Diğer parametreler
 * korunur; `omit` ay değişince düşecek olanlar (ör. Stok sayımı'nın yalnız açılan aya ait ?izinsiz= notu).
 */
export function MonthPicker({ months, value, param = "ay", omit }: { months: string[]; value: string; param?: string; omit?: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, start] = useTransition();
  const list = months.includes(value) ? months : [...months, value].sort();
  const idx = list.indexOf(value);

  const go = (m: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set(param, m);
    for (const k of omit ?? []) sp.delete(k);
    start(() => router.push(`${pathname}?${sp.toString()}`));
  };

  return (
    <div
      role="group"
      aria-label="Ay"
      aria-busy={pending || undefined}
      className={cn(
        "inline-flex h-9 items-center rounded-xl bg-surface ring-1 ring-inset ring-line-strong shadow-[0_1px_1px_rgb(33_28_24/0.03)] transition-opacity pointer-coarse:h-11",
        pending && "opacity-60",
      )}
    >
      <button
        type="button"
        className={arrow}
        disabled={idx <= 0}
        onClick={() => go(list[idx - 1])}
        aria-label="Önceki ay"
        title={idx > 0 ? `Önceki ay: ${monthLabel(list[idx - 1])}` : undefined}
      >
        <ChevronLeft size={18} />
      </button>
      <select
        value={value}
        onChange={(e) => go(e.target.value)}
        // Yerel ok yerine küçük bir ok: telefonda seçici + yanındaki düğme tek satıra sığsın. 16px yazı iOS'ta yakınlaştırmayı önler.
        className="h-full cursor-pointer appearance-none border-x border-line bg-transparent bg-[length:14px] bg-[right_6px_center] bg-no-repeat pr-6 pl-2.5 text-base font-medium text-ink tabular focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-inset sm:text-sm"
        style={{ backgroundImage: CHEVRON }}
        aria-label="Ay seçin"
      >
        {list.map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={arrow}
        disabled={idx >= list.length - 1}
        onClick={() => go(list[idx + 1])}
        aria-label="Sonraki ay"
        title={idx < list.length - 1 ? `Sonraki ay: ${monthLabel(list[idx + 1])}` : undefined}
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

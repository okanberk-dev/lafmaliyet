"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/** ?ay=YYYY-MM parametresini değiştiren ay seçici */
export function MonthPicker({ months, value, param = "ay" }: { months: string[]; value: string; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, start] = useTransition();
  const list = months.includes(value) ? months : [...months, value].sort();
  const idx = list.indexOf(value);

  const go = (m: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set(param, m);
    start(() => router.push(`${pathname}?${sp.toString()}`));
  };

  return (
    <div className={cn("inline-flex h-9 items-center rounded-xl bg-surface ring-1 ring-inset ring-line-strong shadow-[0_1px_1px_rgb(33_28_24/0.03)]", pending && "opacity-60")}>
      <button
        type="button"
        className="flex h-9 w-8 cursor-pointer items-center justify-center rounded-xl text-ink-mute hover:text-ink disabled:opacity-30"
        disabled={idx <= 0}
        onClick={() => go(list[idx - 1])}
        aria-label="Önceki ay"
      >
        <ChevronLeft size={18} />
      </button>
      <select
        value={value}
        onChange={(e) => go(e.target.value)}
        className="h-9 cursor-pointer border-x border-line bg-transparent px-2 text-sm font-medium text-ink focus:outline-none"
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
        className="flex h-9 w-8 cursor-pointer items-center justify-center rounded-xl text-ink-mute hover:text-ink disabled:opacity-30"
        disabled={idx >= list.length - 1}
        onClick={() => go(list[idx + 1])}
        aria-label="Sonraki ay"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

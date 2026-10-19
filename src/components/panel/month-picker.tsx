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
    <div className={cn("inline-flex items-center rounded-lg border border-coffee-200 bg-white shadow-sm", pending && "opacity-60")}>
      <button
        type="button"
        className="flex h-10 w-9 items-center justify-center text-coffee-500 hover:text-coffee-900 disabled:opacity-30"
        disabled={idx <= 0}
        onClick={() => go(list[idx - 1])}
        aria-label="Önceki ay"
      >
        <ChevronLeft size={18} />
      </button>
      <select
        value={value}
        onChange={(e) => go(e.target.value)}
        className="h-10 border-x border-coffee-100 bg-transparent px-2 text-sm font-medium text-coffee-900 focus:outline-none"
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
        className="flex h-10 w-9 items-center justify-center text-coffee-500 hover:text-coffee-900 disabled:opacity-30"
        disabled={idx >= list.length - 1}
        onClick={() => go(list[idx + 1])}
        aria-label="Sonraki ay"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

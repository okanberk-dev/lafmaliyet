"use client";

import { ChevronDown, ChevronRight, CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";

import { ActivityItem, ActivityList } from "@/components/ui/activity";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FilterBar, FilterChip, useQueryState } from "@/components/ui/filters";
import type { PastelTone } from "@/components/ui/icon-tile";
import type { Alert } from "@/lib/calc/insights";
import { cn } from "@/lib/utils";

const STYLE: Record<Alert["level"], { icon: ReactNode; tone: PastelTone; label: string }> = {
  danger: { icon: <CircleAlert />, tone: 3, label: "Önemli" },
  warning: { icon: <TriangleAlert />, tone: 1, label: "Uyarı" },
  info: { icon: <Info />, tone: 2, label: "Bilgi" },
};

const LEVELS: Alert["level"][] = ["danger", "warning", "info"];
const RANK: Record<Alert["level"], number> = { danger: 0, warning: 1, info: 2 };

/** Kart kısa kalsın: ilk bu kadar uyarı görünür, kalanı "N uyarı daha" ile açılır */
const FIRST = 4;

/** Uyarı metnindeki tutarlarda "₺" satır başına tek başına düşmesin (bölünmez boşluk) */
const keepUnit = (text: string) => text.replace(/ ₺/g, "\u00a0₺");

/**
 * "Dikkat edilmesi gerekenler": uyarılar önem sırasına dizilir (önce kırmızı), önem düzeyine göre süzülür
 * (?uyari=danger, adreste kalır) ve uzun listede ilk birkaçı gösterilir.
 */
export function DashboardAlerts({ items, className }: { items: Alert[]; className?: string }) {
  const [level, setLevel] = useQueryState<"" | Alert["level"]>("uyari", "");
  const [open, setOpen] = useState(false);

  const sorted = items.map((a, i) => ({ a, i })).sort((x, y) => RANK[x.a.level] - RANK[y.a.level] || x.i - y.i);
  const count = (l: Alert["level"]) => items.filter((a) => a.level === l).length;
  const present = LEVELS.filter((l) => count(l) > 0);
  // Adresteki düzey bu ay yoksa süzgeç yok sayılır (ay değişince liste boş kalmasın)
  const active = level && present.includes(level) ? level : "";
  const shown = sorted.filter(({ a }) => !active || a.level === active);
  const visible = open ? shown : shown.slice(0, FIRST);
  const hidden = shown.length - visible.length;
  const important = count("danger");

  return (
    <Card className={className}>
      <CardHeader
        icon={<TriangleAlert />}
        title="Dikkat edilmesi gerekenler"
        description="Sistem verileri otomatik kontrol eder; tıklayınca ilgili sayfaya gidersiniz."
        meta={
          items.length ? (
            <>
              <span className="tabular">{items.length} uyarı</span>
              {important ? (
                <>
                  <span className="text-ink-quiet">·</span>
                  <span className="font-medium text-bad tabular">{important} önemli</span>
                </>
              ) : null}
            </>
          ) : null
        }
      />
      {present.length > 1 && items.length > FIRST ? (
        <FilterBar className="px-5 pb-2" active={!!active} onClear={() => setLevel("")}>
          {present.map((l) => (
            <FilterChip key={l} active={active === l} count={count(l)} onToggle={() => setLevel(active === l ? "" : l)}>
              <span aria-hidden="true" className={cn("size-1.5 rounded-full", l === "danger" ? "bg-bad" : l === "warning" ? "bg-[#ff9f0a]" : "bg-info")} />
              {STYLE[l].label}
            </FilterChip>
          ))}
        </FilterBar>
      ) : null}
      <CardContent className="pb-3">
        <ActivityList>
          {visible.length ? (
            visible.map(({ a, i }) => (
              <ActivityItem
                key={`${a.level}-${i}`}
                wrap
                icon={STYLE[a.level].icon}
                tone={STYLE[a.level].tone}
                title={keepUnit(a.title)}
                description={keepUnit(a.detail)}
                href={a.href}
                dot={a.level === "danger" ? "danger" : undefined}
                aside={a.href ? <ChevronRight size={16} className="text-ink-quiet" aria-hidden="true" /> : undefined}
              />
            ))
          ) : (
            <ActivityItem icon={<CircleCheck />} tone={0} title="Şu an dikkat gerektiren bir şey yok" description="Otomatik kontroller bu ay için bir sorun bulmadı." />
          )}
        </ActivityList>
        {hidden > 0 || (open && shown.length > FIRST) ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="mt-1 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-ink-mute transition-colors hover:bg-ink/[0.05] hover:text-ink pointer-coarse:h-10"
          >
            <ChevronDown size={15} aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
            {open ? "Daha az göster" : `${hidden} uyarı daha göster`}
          </button>
        ) : null}
      </CardContent>
    </Card>
  );
}

"use client";

import { ChevronDown, ChevronRight, CircleCheck, ListChecks } from "lucide-react";
import { useState } from "react";

import { ActivityItem, ActivityList } from "@/components/ui/activity";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FilterBar, FilterChip, useQueryState } from "@/components/ui/filters";
import { TONE_ICON, TONE_TILE, type NoticeTone } from "@/components/ui/notice";
import type { Alert } from "@/lib/calc/insights";
import { cn } from "@/lib/utils";

import { alertTone } from "./alert-tone";

// Uyarının görünen önemi alertTone'dan (zille aynı); ikon ve kuyu uyarılarınkiyle aynı tablodan (TONE_ICON / TONE_TILE)
const LABEL: Record<Exclude<NoticeTone, "good">, string> = { bad: "Önemli", warn: "Dikkat", neutral: "Bilgi" };
const DOT: Record<Exclude<NoticeTone, "good">, string> = { bad: "bg-bad", warn: "bg-warn", neutral: "bg-ink-quiet" };

// Adresteki süzgeç değeri (?uyari=danger|warning|info) eski adlarıyla kalır; görünen öneme eşlenir
type Level = Alert["level"];
const TONE_OF: Record<Level, Exclude<NoticeTone, "good">> = { danger: "bad", warning: "warn", info: "neutral" };
const LEVELS: Level[] = ["danger", "warning", "info"];
const RANK: Record<NoticeTone, number> = { bad: 0, warn: 1, neutral: 2, good: 3 };

/** Kart kısa kalsın: ilk bu kadar uyarı görünür, kalanı "N uyarı daha" ile açılır */
const FIRST = 4;

/** Uyarı metnindeki tutarlarda "₺" satır başına tek başına düşmesin (bölünmez boşluk) */
const keepUnit = (text: string) => text.replace(/ ₺/g, "\u00a0₺");

/**
 * "Dikkat edilmesi gerekenler": uyarılar önem sırasına dizilir (önce kırmızı), önem düzeyine göre süzülür
 * (?uyari=danger, adreste kalır) ve uzun listede ilk birkaçı gösterilir.
 */
export function DashboardAlerts({ items, className }: { items: Alert[]; className?: string }) {
  const [level, setLevel] = useQueryState<"" | Level>("uyari", "");
  const [open, setOpen] = useState(false);

  const toned = items.map((a, i) => ({ a, i, tone: alertTone(a) }));
  const sorted = toned.sort((x, y) => RANK[x.tone] - RANK[y.tone] || x.i - y.i);
  const count = (l: Level) => toned.filter((x) => x.tone === TONE_OF[l]).length;
  const present = LEVELS.filter((l) => count(l) > 0);
  // Adresteki düzey bu ay yoksa süzgeç yok sayılır (ay değişince liste boş kalmasın)
  const active = level && present.includes(level) ? level : "";
  const shown = sorted.filter((x) => !active || x.tone === TONE_OF[active]);
  const visible = open ? shown : shown.slice(0, FIRST);
  const hidden = shown.length - visible.length;
  const important = count("danger");

  return (
    <Card className={className}>
      <CardHeader
        icon={<ListChecks />}
        title="Dikkat edilmesi gerekenler"
        // Telefonda kart kısa kalsın: satırlardaki ok zaten bağlantı olduğunu söylüyor
        description={<span className="max-sm:hidden">Sistem verileri otomatik kontrol eder; tıklayınca ilgili sayfaya gidersiniz.</span>}
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
              <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT[TONE_OF[l]])} />
              {LABEL[TONE_OF[l]]}
            </FilterChip>
          ))}
        </FilterBar>
      ) : null}
      <CardContent className="pb-3">
        <ActivityList>
          {visible.length ? (
            visible.map(({ a, i, tone }) => {
              const Icon = TONE_ICON[tone];
              return (
              <ActivityItem
                key={`${a.level}-${i}`}
                wrap
                icon={<Icon />}
                well={TONE_TILE[tone]}
                title={keepUnit(a.title)}
                description={keepUnit(a.detail)}
                href={a.href}
                dot={tone === "bad" ? "danger" : undefined}
                aside={a.href ? <ChevronRight size={16} className="text-ink-quiet" aria-hidden="true" /> : undefined}
              />
              );
            })
          ) : (
            <ActivityItem icon={<CircleCheck />} well={TONE_TILE.good} title="Şu an dikkat gerektiren bir şey yok" description="Otomatik kontroller bu ay için bir sorun bulmadı." />
          )}
        </ActivityList>
        {hidden > 0 || (open && shown.length > FIRST) ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="mt-1 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-ink-mute transition-colors hover:bg-ink/[0.05] hover:text-ink pointer-coarse:h-11"
          >
            <ChevronDown size={15} aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
            {open ? "Daha az göster" : `${hidden} uyarı daha göster`}
          </button>
        ) : null}
      </CardContent>
    </Card>
  );
}

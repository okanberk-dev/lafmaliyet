"use client";

import { Store } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { BRANCH_VIEW_DESCRIPTION, BRANCH_VIEW_TITLE, type BranchViewPrefs, type BulkView, type ViewArea, type ViewMode } from "@/lib/branch-view";
import { saveBranchView } from "@/server/actions/branch-view";

/** Kartın bir satırı (sunucu kurar: src/app/panel/hesap/page.tsx) */
export interface BranchViewRow {
  area: ViewArea;
  label: string;
  help: string;
  modes: Record<ViewMode, string>;
  firmOnly: string | null;
  /** Rolün varsayılanı (tercih yoksa geçen) */
  fallback: ViewMode;
}

/**
 * Hesabım › Şube görünümü (şube ayrımı D; docs/SUBE.md › Şube ayrımı): ekran ekran "Yalnız şube | Firma geneli", toplu
 * düğmeler ve hep firma geneli kalanların listesi. Seçim hemen kaydedilir (kişinin kendi satırı, `saveBranchView`); hata
 * olursa seçim geri döner. Şubesine kilitli hesapta ve tek şube açıkken sayfa bu kartı çizmez.
 */
export function BranchViewCard({ rows, prefs, always }: { rows: BranchViewRow[]; prefs: BranchViewPrefs; always: readonly { title: string; reason: string }[] }) {
  const [saved, setSaved] = useState<BranchViewPrefs>(prefs);
  const [pending, run] = useActionTransition();
  const busy = useRef(false);
  const modeOf = (r: BranchViewRow) => saved[r.area] ?? r.fallback;

  const save = (input: { area: ViewArea; mode: ViewMode } | { all: BulkView }, optimistic: BranchViewPrefs) => {
    if (busy.current) return;
    busy.current = true;
    const before = saved;
    setSaved(optimistic);
    run(async () => {
      try {
        const res = await saveBranchView(input);
        if (!res.ok) {
          setSaved(before);
          toast.error(res.error);
          return;
        }
        setSaved(res.data.prefs);
        if ("all" in input) toast.success(input.all === "varsayilan" ? "Varsayılanlara dönüldü" : input.all === "sube" ? "Hepsi yalnız şube" : "Hepsi firma geneli");
      } catch (e) {
        setSaved(before);
        throw e;
      } finally {
        busy.current = false;
      }
    });
  };

  const bulk = (kind: BulkView) =>
    save({ all: kind }, kind === "varsayilan" ? {} : { ...saved, ...Object.fromEntries(rows.map((r) => [r.area, kind])) });

  return (
    <>
      <CardHeader icon={<Store />} title={BRANCH_VIEW_TITLE} description={BRANCH_VIEW_DESCRIPTION} />
      <CardContent className="space-y-4">
        <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
          {rows.map((r) => {
            const mode = modeOf(r);
            return (
              <li key={r.area} data-area={r.area} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-ink">
                    {r.label}
                    {saved[r.area] === undefined ? <Badge tone="gray">Varsayılan</Badge> : null}
                  </p>
                  <p className="mt-0.5 text-[13px] leading-5 text-ink-mute">{r.help}</p>
                  {r.firmOnly ? <p className="mt-0.5 text-[13px] leading-5 text-ink-mute">Hep firmanın: {r.firmOnly}.</p> : null}
                </div>
                <Segmented
                  label={`${r.label}: görünüm`}
                  className="shrink-0 self-start"
                  value={mode}
                  onChange={(v) => (v === mode ? undefined : save({ area: r.area, mode: v }, { ...saved, [r.area]: v }))}
                  options={[
                    { value: "sube", label: r.modes.sube },
                    { value: "firma", label: r.modes.firma },
                  ]}
                />
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => bulk("sube")}>
            Hepsi yalnız şube
          </Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => bulk("firma")}>
            Hepsi firma geneli
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => bulk("varsayilan")}>
            Varsayılanlara dön
          </Button>
        </div>
      </CardContent>
      <CardFooter className="block space-y-2">
        <p className="font-medium text-ink-soft">Her zaman firma geneli</p>
        <ul className="space-y-1.5">
          {always.map((a) => (
            <li key={a.title} className="leading-5">
              <span className="font-medium text-ink-soft">{a.title}</span>: {a.reason}
            </li>
          ))}
        </ul>
      </CardFooter>
    </>
  );
}

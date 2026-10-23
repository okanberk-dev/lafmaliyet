import { ListChecks } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/misc";
import { isStarted, itemsText, listTitle, timeTR, whoText, type ChecklistLite, type ListState } from "@/lib/checklists";
import { num } from "@/lib/format";

import { listBadge } from "./status";

/**
 * Kontrol listeleri ekranında bugünün bir listesi: saat aralığı, madde sayısı, ilerleme, kimin doldurduğu ve listeyi
 * açan düğme (sıradaki işse siyah, telefonda tam genişlik ve 48 px).
 */
export function ListCard({ list: l, state, next }: { list: ChecklistLite; state: ListState; next: boolean }) {
  const badge = listBadge(l, state);
  const run = l.run;
  const started = isStarted(l);
  const done = run?.done ?? 0;
  const required = run?.required ?? l.required;
  const action = state === "done" ? "Listeye bak" : started ? "Devam et" : "Listeyi aç";
  return (
    <Card>
      <CardHeader
        icon={<ListChecks />}
        title={listTitle(l.name)}
        description={`${l.opensAt} – ${l.dueAt} · ${itemsText(l)}`}
        meta={
          <Badge tone={badge.tone} dot>
            {badge.text}
          </Badge>
        }
      />
      <div className="space-y-3 px-5 pb-5">
        <div>
          <Progress value={required ? done / required : 0} tone={state === "done" ? "green" : state === "overdue" ? "amber" : "ink"} />
          <p className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 text-[13px] text-ink-mute">
            <span className="tabular">
              {num(done)} / {num(required)} madde
              {run && run.photosLeft && state !== "done" ? ` · ${num(run.photosLeft)} fotoğraf kaldı` : ""}
            </span>
            {run && state === "done" && run.completedAt ? (
              <span>
                Tamamlandı {timeTR(run.completedAt)} · {whoText(run.contributors)}
              </span>
            ) : run && started && run.firstAt && run.lastAt ? (
              <span>
                {whoText(run.contributors)} · ilk {timeTR(run.firstAt)}, son {timeTR(run.lastAt)}
              </span>
            ) : null}
          </p>
        </div>
        <ButtonLink href={`/panel/kontrol/${l.templateId}`} variant={next ? "primary" : "secondary"} className="max-sm:h-12 max-sm:w-full">
          {action}
        </ButtonLink>
      </div>
    </Card>
  );
}

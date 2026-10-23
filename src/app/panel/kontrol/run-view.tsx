"use client";

import { Camera, CircleCheck, Thermometer, Type } from "lucide-react";
import { useState, type ReactNode } from "react";

import { PhotoViewer } from "@/components/panel/photo-viewer";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import {
  earlyStart,
  groupBySection,
  isAnswered,
  lateFinish,
  listTitle,
  rangeText,
  runSummary,
  timeTR,
  valueText,
  type AnswerLite,
  type ChecklistAnswerVersion,
  type ChecklistItemSnap,
  type ChecklistItemType,
} from "@/lib/checklists";
import { num } from "@/lib/format";
import { photoUrl } from "@/lib/photo-rules";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<ChecklistItemType, ReactNode> = {
  check: <CircleCheck size={16} aria-hidden="true" />,
  photo: <Camera size={16} aria-hidden="true" />,
  number: <Thermometer size={16} aria-hidden="true" />,
  text: <Type size={16} aria-hidden="true" />,
};

export interface RunViewProps {
  name: string;
  day: string;
  /** Bugünün listesi (henüz bitmemiş olabilir: "Yapılmadı" yerine "Bekliyor") */
  today: boolean;
  opensAt: string;
  dueAt: string;
  /** Kaydın tamamlandığı an; kayıt yoksa `run` false */
  run: boolean;
  completedAt: string | null;
  items: ChecklistItemSnap[];
  answers: AnswerLite[];
  /** Fotoğrafların 60 günlük saklaması bu gün için doldu mu (sunucu hesaplar) */
  photosExpired: boolean;
}

/** "Ayşe 08:51–09:12, Mehmet 09:40": kişi başına ilk ve son yanıtın saati */
function whoWithTimes(answers: AnswerLite[]): string {
  const times = new Map<string, { first: string; last: string }>();
  const entries = answers.flatMap((a) => [...a.history.map((v) => ({ by: v.by, at: v.at })), { by: a.by, at: a.at }]).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const e of entries) {
    const t = times.get(e.by);
    times.set(e.by, t ? { first: t.first, last: e.at } : { first: e.at, last: e.at });
  }
  return [...times]
    .map(([by, t]) => {
      const a = timeTR(t.first);
      const b = timeTR(t.last);
      return `${by} ${a === b ? a : `${a}–${b}`}`;
    })
    .join(", ");
}

/** Önceki hâlin kısa metni: "6 °C (aralık dışı)", "Tamam", "Sorun: …", "Fotoğraf", yazı */
function versionText(item: ChecklistItemSnap, v: ChecklistAnswerVersion): string {
  if (item.type === "number" && v.value !== null) return `${valueText(item, v.value)}${v.status === "issue" ? " (aralık dışı)" : ""}`;
  if (item.type === "check") return v.status === "issue" ? `Sorun: ${v.note ?? ""}` : "Tamam";
  if (item.type === "photo") return v.photo ? "Fotoğraf" : "Fotoğrafsız";
  return v.textValue ?? "";
}

/**
 * Bir günün bir listesi, salt okunur (Kontrol geçmişi): kim, ne zaman (kişi başına ilk ve son yanıt), erken / geç
 * doldurma işareti, maddeler bölüm bölüm; aralık dışı değer kırmızı, önceki ölçümler sönük ("Önce: 6 °C · 09:12
 * Ayşe"), fotoğraf küçük resimle (dokununca büyür). Saklama süresi dolan fotoğraf yerine "60 günden eski" notu.
 */
export function RunView(p: RunViewProps) {
  const [viewer, setViewer] = useState<{ id: number; caption: string } | null>(null);
  const summary = runSummary(p.items, p.answers, p.completedAt);
  const byItem = new Map(p.answers.map((a) => [a.itemId, a]));
  const started = p.run && summary.lastAt !== null;
  const badge = summary.complete
    ? { tone: "green" as const, text: "Tamamlandı" }
    : started
      ? p.today
        ? { tone: "blue" as const, text: `${num(summary.done)} / ${num(summary.required)}` }
        : { tone: "amber" as const, text: `${num(summary.required - summary.done)} eksik` }
      : p.today
        ? { tone: "gray" as const, text: "Başlanmadı" }
        : { tone: "red" as const, text: "Yapılmadı" };
  const flags = [
    started && earlyStart({ date: p.day, opensAt: p.opensAt, firstAt: summary.firstAt }) && summary.firstAt ? `Erken dolduruldu (${timeTR(summary.firstAt)})` : null,
    summary.complete && lateFinish({ date: p.day, dueAt: p.dueAt, completedAt: p.completedAt }) && p.completedAt ? `Geç tamamlandı (${timeTR(p.completedAt)})` : null,
  ].filter((f): f is string => Boolean(f));
  return (
    <Card>
      <CardHeader
        title={listTitle(p.name)}
        description={`${p.opensAt} – ${p.dueAt}${started ? ` · ${whoWithTimes(p.answers)}` : ""}`}
        meta={
          <>
            <Badge tone={badge.tone} dot>
              {badge.text}
            </Badge>
            {flags.map((f) => (
              <Badge key={f} tone="amber">
                {f}
              </Badge>
            ))}
          </>
        }
      />
      <div className="space-y-4 px-5 pb-5">
        {!started ? (
          <p className="text-sm text-ink-mute">
            {p.today ? "Henüz başlanmadı" : "Bu gün hiç açılmadı"} · {num(p.items.filter((i) => i.required).length)} madde.
          </p>
        ) : null}
        {started
          ? groupBySection(p.items).map((g) => (
              <section key={g.section ?? "-"} aria-label={g.section ?? "Maddeler"}>
                {g.section ? <h3 className="mb-1.5 text-[12px] font-semibold tracking-wide text-ink-mute uppercase">{g.section}</h3> : null}
                <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
                  {g.items.map((item) => {
                    const a = byItem.get(item.id) ?? null;
                    return (
                      <li key={item.id} className="flex gap-3 px-3.5 py-3">
                        <span className="mt-0.5 shrink-0 text-ink-mute">{TYPE_ICON[item.type]}</span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                            <p className="min-w-0 text-sm font-medium text-pretty text-ink">{item.label}</p>
                            {a ? (
                              <span className="shrink-0 text-xs text-ink-mute tabular">
                                {a.by} · {timeTR(a.at)}
                              </span>
                            ) : null}
                          </div>
                          <Answer item={item} answer={a} today={p.today} photosExpired={p.photosExpired} onPhoto={setViewer} />
                          {a?.history.map((v, i) => (
                            <p key={i} className="text-xs text-pretty break-words text-ink-mute">
                              Önce: {versionText(item, v)} · {timeTR(v.at)} {v.by}
                              {v.note && !(item.type === "check" && v.status === "issue") ? ` · Not: ${v.note}` : ""}
                            </p>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          : null}
      </div>
      <PhotoViewer photo={viewer} onClose={() => setViewer(null)} />
    </Card>
  );
}

function Answer({
  item,
  answer: a,
  today,
  photosExpired,
  onPhoto,
}: {
  item: ChecklistItemSnap;
  answer: AnswerLite | null;
  today: boolean;
  photosExpired: boolean;
  onPhoto: (p: { id: number; caption: string }) => void;
}) {
  if (!a || !isAnswered(item, a)) {
    if (!item.required) return <p className="text-[13px] text-ink-mute">—</p>;
    return today ? <p className="text-[13px] text-ink-mute">Bekliyor</p> : <p className="text-[13px] font-medium text-bad">Yapılmadı</p>;
  }
  const note = a.note ? <p className="text-[13px] text-pretty break-words text-ink-soft">Not: {a.note}</p> : null;
  if (item.type === "check") {
    return a.status === "issue" ? (
      <p className="inline-block rounded-lg bg-warn-soft px-2 py-1 text-[13px] text-pretty break-words text-warn">Sorun: {a.note}</p>
    ) : (
      <p className="text-[13px] text-good-ink">Tamam</p>
    );
  }
  if (item.type === "number" && a.value !== null) {
    const bad = a.status === "issue";
    return (
      <div className="space-y-1">
        <p className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className={cn("font-semibold tabular", bad ? "rounded-full bg-bad-soft px-2.5 py-0.5 text-bad" : "text-ink")}>{valueText(item, a.value)}</span>
          {bad && rangeText(item) ? <span className="text-ink-mute">aralık {rangeText(item)}</span> : null}
        </p>
        {note}
      </div>
    );
  }
  if (item.type === "text") return <p className="text-[13px] text-pretty break-words whitespace-pre-line text-ink">{a.textValue}</p>;
  // Fotoğraf
  return (
    <div className="space-y-1">
      {a.photoId ? (
        <button
          type="button"
          onClick={() => onPhoto({ id: a.photoId!, caption: item.label })}
          aria-label={`${item.label} fotoğrafını büyüt`}
          className="block h-20 w-28 cursor-pointer overflow-hidden rounded-xl bg-panel ring-1 ring-line hover:ring-line-strong"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- yetkili yol; görsel iyileştirici giriş çerezini taşımaz */}
          <img src={photoUrl(a.photoId)} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
        </button>
      ) : (
        <p className="text-[13px] text-ink-mute">{photosExpired ? "Fotoğraf çekildi · 60 günden eski olduğu için silindi" : "Fotoğraf bulunamadı"}</p>
      )}
      {note}
    </div>
  );
}

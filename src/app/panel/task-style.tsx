import { CircleCheck, CircleDashed, Clock3 } from "lucide-react";
import type { ReactNode } from "react";

import type { Tone } from "@/components/ui/badge";
import { TONE_ICON } from "@/components/ui/notice";

import type { TaskStatus } from "./dashboard-tasks";

// İş listelerinin durum görünümü: Genel bakış'taki ayın işleri (dashboard-checklist*.tsx) ve Bugün ekranının
// "Yapılacaklar" kartı (bugun/today-tasks.tsx) aynı ikonu, kuyu rengini ve rozeti kullanır. "use client" yok: sunucu ve
// istemci bileşenleri birlikte içe aktarır. Turuncu yalnız uyarıdır: "Yapılacak" gri, kırmızı yalnız gerçek sorunda
// (docs/planlar/ux-sade.md §4.7); sorunun ikonu uyarılarınkiyle aynı (TONE_ICON).

const BadIcon = TONE_ICON.bad;

/** Durumun ikonu, ikon kuyusunun rengi, rozet tonu ve rozet verilmezse yazılan adı */
export const TASK_STYLE: Record<TaskStatus, { icon: ReactNode; well: string; tone: Tone; label: string }> = {
  done: { icon: <CircleCheck />, well: "bg-lime/25 text-good-ink", tone: "green", label: "Tamam" },
  todo: { icon: <CircleDashed />, well: "bg-note text-ink-soft", tone: "gray", label: "Yapılacak" },
  warn: { icon: <BadIcon />, well: "bg-bad-soft text-bad-ink", tone: "red", label: "Sorun var" },
  later: { icon: <Clock3 />, well: "bg-panel text-ink-mute ring-1 ring-inset ring-line", tone: "gray", label: "Sonra" },
};

/** Özet satırındaki ilerleme şeridinin renkleri (listedeki rozetlerle aynı anlam) */
export const TASK_BAR: Record<TaskStatus, string> = { done: "bg-good", todo: "bg-ink/40", warn: "bg-bad", later: "bg-panel-deep" };

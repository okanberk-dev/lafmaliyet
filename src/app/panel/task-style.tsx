import { CircleAlert, CircleCheck, CircleDashed, Clock3 } from "lucide-react";
import type { ReactNode } from "react";

import type { Tone } from "@/components/ui/badge";

import type { TaskStatus } from "./dashboard-tasks";

// İş listelerinin durum görünümü: Genel bakış'taki "Bu ayın işleri" (dashboard-checklist*.tsx) ve Bugün ekranının
// "Yapılacaklar" kartı (bugun/today-tasks.tsx) aynı ikonu, kuyu rengini ve rozeti kullanır. "use client" yok: sunucu ve
// istemci bileşenleri birlikte içe aktarır.

/** Durumun ikonu, ikon kuyusunun rengi, rozet tonu ve rozet verilmezse yazılan adı */
export const TASK_STYLE: Record<TaskStatus, { icon: ReactNode; well: string; tone: Tone; label: string }> = {
  done: { icon: <CircleCheck />, well: "bg-lime/25 text-good-ink", tone: "green", label: "Tamam" },
  todo: { icon: <CircleDashed />, well: "bg-warn-soft text-warn", tone: "amber", label: "Yapılacak" },
  warn: { icon: <CircleAlert />, well: "bg-bad-soft text-bad", tone: "red", label: "Sorun var" },
  later: { icon: <Clock3 />, well: "bg-panel text-ink-mute ring-1 ring-inset ring-line", tone: "gray", label: "Sonra" },
};

/** Özet satırındaki ilerleme şeridinin renkleri (listedeki rozetlerle aynı anlam) */
export const TASK_BAR: Record<TaskStatus, string> = { done: "bg-good", todo: "bg-brass-500", warn: "bg-bad", later: "bg-panel-deep" };

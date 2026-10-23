import type { Tone } from "@/components/ui/badge";
import { isStarted, listState, nowBusinessMinute, type ChecklistLite, type ListState } from "@/lib/checklists";
import { num } from "@/lib/format";

/** Kontrol listesi kartlarının rozeti: Tamam, sorun, Gecikti, Sonra, ilerleme ya da Yapılmadı */
export function listBadge(l: ChecklistLite, state: ListState): { tone: Tone; text: string } {
  const open = l.run?.issues.filter((x) => x.open).length ?? 0;
  if (state === "done") return open ? { tone: "amber", text: `${num(open)} sorun` } : { tone: "green", text: "Tamam" };
  if (state === "overdue") return { tone: "amber", text: "Gecikti" };
  if (state === "before") return { tone: "gray", text: "Sonra" };
  if (state === "missed") return isStarted(l) ? { tone: "amber", text: `${num(l.run!.required - l.run!.done)} eksik` } : { tone: "red", text: "Yapılmadı" };
  return { tone: "blue", text: `${num(l.run?.done ?? 0)} / ${num(l.run?.required ?? l.required)}` };
}

/** Bugünün listesinin durumu (şimdiki saatle) */
export const todayState = (l: ChecklistLite, now: Date) => listState(l, nowBusinessMinute(now), false);

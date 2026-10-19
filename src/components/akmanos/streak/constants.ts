export type StreakDayStatus = "completed" | "missed" | "today" | "upcoming";

export type StreakDay = {
  id: string;
  label: string;
  status: StreakDayStatus;
};

export const STREAK_TITLE = "Activity streak";

export const STREAK_ICON_SRC = "/streak/gfastreak.png";

export const CURRENT_STREAK = 12;

export const BEST_STREAK = 24;

export const WEEK_COMPLETED = 3;

export const STREAK_DAYS: StreakDay[] = [
  { id: "mon", label: "M", status: "completed" },
  { id: "tue", label: "T", status: "completed" },
  { id: "wed", label: "W", status: "today" },
  { id: "thu", label: "T", status: "upcoming" },
  { id: "fri", label: "F", status: "upcoming" },
  { id: "sat", label: "S", status: "upcoming" },
  { id: "sun", label: "S", status: "upcoming" },
];

export function getStreakMessage(streak: number) {
  if (streak >= 30) return "Legendary streak!";
  if (streak >= 14) return "Unstoppable!";
  if (streak >= 7) return "You are on fire!";
  if (streak >= 3) return "Heating up!";
  return "Keep the flame alive!";
}

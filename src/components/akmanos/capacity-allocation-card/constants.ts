export type CapacityPeriod = "week" | "month" | "year";

export const CAPACITY_PERIODS: { id: CapacityPeriod; label: string }[] = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

export type CapacityPeriodStats = {
  percent: number;
  delta: number;
  queuedOrders: number;
  memberCount: number;
};

/** Demo metrics per range — Week matches the reference card. */
export const CAPACITY_BY_PERIOD: Record<CapacityPeriod, CapacityPeriodStats> = {
  week: {
    percent: 86,
    delta: 5.8,
    queuedOrders: 3840,
    memberCount: 6,
  },
  month: {
    percent: 79,
    delta: 3.2,
    queuedOrders: 14280,
    memberCount: 6,
  },
  year: {
    percent: 91,
    delta: 11.4,
    queuedOrders: 168420,
    memberCount: 8,
  },
};

/** Contribution-style ticks across the allocation bar. */
export const CAPACITY_SEGMENT_COUNT = 48;

export const CAPACITY_ACCENT = "#22c55e";
export const CAPACITY_ACCENT_DARK = "#4ade80";

export type CapacityMember = {
  id: string;
  name: string;
  initials: string;
  toneClass: string;
  src?: string;
};

export const CAPACITY_MEMBERS: CapacityMember[] = [
  {
    id: "m1",
    name: "Gokhan",
    initials: "GK",
    toneClass: "bg-[#0a0a0a] text-[#fafafa]",
    src: "/avatars/gokhan.png",
  },
  {
    id: "m2",
    name: "Ayla",
    initials: "AY",
    toneClass: "bg-[#0f766e] text-[#ecfdf5]",
  },
  {
    id: "m3",
    name: "Deniz",
    initials: "DZ",
    toneClass: "bg-[#1d4ed8] text-[#eff6ff]",
  },
];

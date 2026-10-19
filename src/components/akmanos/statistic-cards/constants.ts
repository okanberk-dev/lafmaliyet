export const GROWTH_BADGE_POSITIVE = {
  background: "#c0f21e",
  text: "#1f3a08",
} as const;

export const STAT_CARDS = [
  {
    key: "customers",
    label: "Customers",
    value: 14592,
    growth: 5.3,
  },
  {
    key: "unitsSold",
    label: "Unit sold",
    value: 385,
    growth: -2.1,
  },
  {
    key: "orders",
    label: "Orders",
    value: 1394,
    growth: 0,
  },
  {
    key: "supportTickets",
    label: "Support tickets",
    value: 708,
    growth: 12.8,
  },
] as const;

export type StatCardKey = (typeof STAT_CARDS)[number]["key"];

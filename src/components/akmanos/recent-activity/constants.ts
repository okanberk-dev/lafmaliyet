import type { RecentActivityItem } from "./types";

export const RECENT_ACTIVITY_TITLE = "Activity";
export const RECENT_ACTIVITY_LIVE_LABEL = "Live";
export const RECENT_ACTIVITY_VIEW_ALL_LABEL = "Show More";

export const DEFAULT_RECENT_ACTIVITY: RecentActivityItem[] = [
  {
    id: "a1",
    kind: "upload",
    title: "Files",
    description: "Maya added 12 assets to Marketing.",
    timeLabel: "now",
    unread: true,
  },
  {
    id: "a2",
    kind: "deploy",
    title: "Deploy",
    description: "akmanos.com is live · 42s build.",
    timeLabel: "18m",
    unread: true,
  },
  {
    id: "a3",
    kind: "comment",
    title: "Elena",
    description: "Commented on Pricing Card.",
    timeLabel: "1h",
    unread: true,
  },
  {
    id: "a4",
    kind: "member",
    title: "Alex",
    description: "Joined Acme Design.",
    timeLabel: "3h",
  },
  {
    id: "a5",
    kind: "billing",
    title: "Apple Account",
    description: "Your yearly plan was renewed.",
    timeLabel: "1d",
  },
  {
    id: "a6",
    kind: "system",
    title: "Library",
    description: "65 components ready for agents.",
    timeLabel: "2d",
  },
];

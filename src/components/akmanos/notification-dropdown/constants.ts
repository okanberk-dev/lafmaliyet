export type NotificationKind =
  | "mention"
  | "comment"
  | "deploy"
  | "billing"
  | "invite"
  | "system"
  | "danger"
  | "warning"
  | "info";

export type NotificationItem = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  timeLabel: string;
  unread?: boolean;
};

export const NOTIFICATION_DROPDOWN_TITLE = "Bildirimler";
export const NOTIFICATION_MARK_ALL_LABEL = "Tümünü okundu say";
export const NOTIFICATION_EMPTY_LABEL = "Dikkat isteyen bir şey yok.";
export const NOTIFICATION_VIEW_ALL_LABEL = "Genel bakışta gör";

export const DEFAULT_NOTIFICATIONS: NotificationItem[] = [
  {
    id: "n1",
    kind: "mention",
    title: "Mara mentioned you",
    body: "Can you review the funnel chart copy before we ship?",
    timeLabel: "2m",
    unread: true,
  },
  {
    id: "n2",
    kind: "deploy",
    title: "Production deploy ready",
    body: "akmanos.com built in 42s — all checks passed.",
    timeLabel: "18m",
    unread: true,
  },
  {
    id: "n3",
    kind: "comment",
    title: "New comment on Pricing Card",
    body: "Elena: Love the liquid metal shell — keep the CTA as is.",
    timeLabel: "1h",
    unread: true,
  },
  {
    id: "n4",
    kind: "invite",
    title: "Workspace invite",
    body: "Alex invited you to join Acme Design.",
    timeLabel: "3h",
  },
  {
    id: "n5",
    kind: "billing",
    title: "Invoice paid",
    body: "Your yearly plan renewed successfully.",
    timeLabel: "1d",
  },
  {
    id: "n6",
    kind: "system",
    title: "Library update",
    body: "12 new components are available in the gallery.",
    timeLabel: "2d",
  },
];

export type RecentActivityKind =
  | "upload"
  | "deploy"
  | "member"
  | "billing"
  | "comment"
  | "system";

export type RecentActivityItem = {
  id: string;
  kind: RecentActivityKind;
  title: string;
  description: string;
  timeLabel: string;
  unread?: boolean;
};

export type RecentActivityProps = {
  title?: string;
  items?: RecentActivityItem[];
  liveLabel?: string;
  viewAllLabel?: string;
  onViewAll?: () => void;
  onItemSelect?: (item: RecentActivityItem) => void;
  className?: string;
};

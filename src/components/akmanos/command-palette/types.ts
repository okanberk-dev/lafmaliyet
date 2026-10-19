import type { LucideIcon } from "lucide-react";

export type CommandPaletteResultKind = "document" | "person" | "integration";

export type PersonStatus = "active" | "idle" | "offline";

export type CommandPaletteCategory = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Draw a vertical divider after this chip */
  dividerAfter?: boolean;
};

export type CommandPaletteResult = {
  id: string;
  kind: CommandPaletteResultKind;
  title: string;
  subtitle: string;
  categoryId: string;
  avatarSrc?: string;
  personStatus?: PersonStatus;
  faviconDomain?: string;
  accent?: string;
};

/** Chrome copy — host apps can localize without forking the component. */
export type CommandPaletteLabels = {
  title: string;
  searchPlaceholder: string;
  searchTrigger: string;
  recentLabel: string;
  selectLabel: string;
  openHint: string;
  closeAria: string;
  moreCategoriesAria: string;
  noResults: string;
  copyLinkAria: string;
  removeAria: string;
  navigate: string;
  open: string;
  actions: string;
  guide: string;
  close: string;
  returnKey: string;
};

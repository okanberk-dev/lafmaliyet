import {
  BarChart3,
  FileText,
  FolderKanban,
  Inbox,
  LayoutTemplate,
  ListTodo,
  Users,
} from "lucide-react";
import type {
  CommandPaletteCategory,
  CommandPaletteLabels,
  CommandPaletteResult,
} from "./types";

export const COMMAND_PALETTE_TITLE = "Command palette";
export const COMMAND_PALETTE_SEARCH_PLACEHOLDER =
  "Search anything or enter a command";
export const COMMAND_PALETTE_RECENT_LABEL = "Recent results:";
export const COMMAND_PALETTE_SELECT_LABEL = "Select";
export const COMMAND_PALETTE_OPEN_HINT = "Press ⌘K or Ctrl+K to open";

export const COMMAND_PALETTE_DEFAULT_LABELS: CommandPaletteLabels = {
  title: COMMAND_PALETTE_TITLE,
  searchPlaceholder: COMMAND_PALETTE_SEARCH_PLACEHOLDER,
  searchTrigger: "Search",
  recentLabel: COMMAND_PALETTE_RECENT_LABEL,
  selectLabel: COMMAND_PALETTE_SELECT_LABEL,
  openHint: COMMAND_PALETTE_OPEN_HINT,
  closeAria: "Close command palette",
  moreCategoriesAria: "More categories",
  noResults: "No results for this search.",
  copyLinkAria: "Copy link",
  removeAria: "Remove",
  navigate: "Navigate",
  open: "Open",
  actions: "Actions",
  guide: "Guide",
  close: "Close",
  returnKey: "Return",
};

export const COMMAND_PALETTE_CATEGORIES: CommandPaletteCategory[] = [
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "inbox", label: "Inbox", icon: Inbox, dividerAfter: true },
  { id: "people", label: "People", icon: Users, dividerAfter: true },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "templates", label: "Templates", icon: LayoutTemplate },
];

export const COMMAND_PALETTE_DEMO_RESULTS: CommandPaletteResult[] = [
  {
    id: "investor-update",
    kind: "document",
    title: "Investor Update: Growth Metrics",
    subtitle: "Documents • 9:45 PM, October 22",
    categoryId: "documents",
  },
  {
    id: "board-report",
    kind: "document",
    title: "Monthly Board Report",
    subtitle: "Documents • 9:45 PM, October 22",
    categoryId: "documents",
  },
  {
    id: "luisa",
    kind: "person",
    title: "Luisa",
    subtitle: "People • Active",
    categoryId: "people",
    personStatus: "active",
    accent: "#6366f1",
  },
  {
    id: "andrei",
    kind: "person",
    title: "Andrei",
    subtitle: "People • Active",
    categoryId: "people",
    personStatus: "active",
    accent: "#0ea5e9",
  },
  {
    id: "michael",
    kind: "person",
    title: "Michael",
    subtitle: "People • Idle",
    categoryId: "people",
    personStatus: "idle",
    accent: "#f59e0b",
  },
  {
    id: "sarala",
    kind: "person",
    title: "Sarala",
    subtitle: "People • Offline",
    categoryId: "people",
    personStatus: "offline",
    accent: "#ec4899",
  },
  {
    id: "stripe",
    kind: "integration",
    title: "Stripe Payments",
    subtitle: "App Library • Connected on 12:30 PM, January 18",
    categoryId: "inbox",
    faviconDomain: "stripe.com",
  },
  {
    id: "dropbox",
    kind: "integration",
    title: "Dropbox Files",
    subtitle: "App Library • Connected on 12:30 PM, January 18",
    categoryId: "inbox",
    faviconDomain: "dropbox.com",
  },
];

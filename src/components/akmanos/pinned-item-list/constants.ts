export type PinnedListItem = {
  id: string;
  title: string;
  description?: string;
};

export const PINNED_ITEMS: PinnedListItem[] = [
  { id: "a", title: "Design review", description: "Thursday · 45 min" },
  { id: "b", title: "Sprint planning", description: "Friday morning" },
  { id: "c", title: "API contract draft", description: "Backend + web" },
  { id: "d", title: "Release notes", description: "v0.4.0" },
  { id: "e", title: "Usability study", description: "3 participant sessions" },
];

export const DEFAULT_PINNED_IDS = ["a", "c"];

export const PINNED_SECTION_TITLE = "PINNED ITEMS";
export const ALL_SECTION_TITLE = "ALL ITEMS";
export const PINNED_EMPTY_LABEL = "No pinned items";
export const ALL_EMPTY_LABEL = "Everything is pinned";

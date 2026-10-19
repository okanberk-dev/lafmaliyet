export type SortDirection = "asc" | "desc";

export type ListSort<Key extends string> = {
  key: Key;
  direction: SortDirection;
};

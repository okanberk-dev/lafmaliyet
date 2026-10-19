import type { ListSort, SortDirection } from "./types";

export const LIST_TABLE_PAGE_SIZE = 8;
export const LIST_TABLE_FADE_MS = 220;
export const LIST_TABLE_LOAD_MS = 480;

export function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function getPageCount(total: number, pageSize: number) {
  if (total <= 0) return 1;
  return Math.ceil(total / pageSize);
}

export function paginateRows<T>(rows: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

export function compareValues(left: string | number, right: string | number) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left).localeCompare(String(right), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

export function nextListSort<Key extends string>(
  current: ListSort<Key>,
  key: Key,
  defaultDirection: SortDirection = "asc",
): ListSort<Key> {
  if (current.key !== key) {
    return { key, direction: defaultDirection };
  }

  return {
    key,
    direction: current.direction === "asc" ? "desc" : "asc",
  };
}

export function formatListCount(value: number) {
  return value.toLocaleString("en-US");
}

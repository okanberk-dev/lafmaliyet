"use client";

import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Icon } from "@/components/akmanos/icons/icon";
import type { ListSort } from "./types";

export function ListSortableHeader<Key extends string>({
  columnKey,
  label,
  sort,
  onSort,
  disabled,
  className,
}: {
  columnKey: Key;
  label: string;
  sort: ListSort<Key>;
  onSort: (key: Key) => void;
  disabled?: boolean;
  className?: string;
}) {
  const active = sort.key === columnKey;
  const sortIcon: LucideIcon = !active
    ? ArrowUpDown
    : sort.direction === "asc"
      ? ArrowUp
      : ArrowDown;

  return (
    <th
      className={`pb-3 pr-4 text-sm font-medium text-chart-muted ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        disabled={disabled}
        className={`inline-flex items-center gap-1 transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50 ${
          active ? "text-foreground" : "text-chart-muted"
        }`}
        aria-label={`Sort by ${label}`}
      >
        <span>{label}</span>
        <Icon
          icon={sortIcon}
          size={14}
          className={active ? "text-foreground" : "text-chart-muted"}
        />
      </button>
    </th>
  );
}

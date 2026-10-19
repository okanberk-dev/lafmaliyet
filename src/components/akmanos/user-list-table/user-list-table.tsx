"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Ban,
  Download,
  Eye,
  Pencil,
  PlayCircle,
  Trash2,
  Users,
} from "lucide-react";
import { RefreshIcon } from "@/components/akmanos/charts/area-chart/icons";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { Icon } from "@/components/akmanos/icons/icon";
import { MetricIconBox } from "@/components/akmanos/icons/metric-icon-box";
import {
  BulkSelectionBar,
  IconActionButton,
  ListSkeletonBar,
  ListSortableHeader,
  ListTableEmptyState,
  ListTableErrorState,
  ListTablePagination,
  LIST_TABLE_FADE_MS,
  LIST_TABLE_LOAD_MS,
  LIST_TABLE_PAGE_SIZE,
  nextListSort,
  wait,
} from "@/components/akmanos/list-table";
import {
  COLUMNS,
  DEFAULT_SORT,
  ROW_NUMBER_LABEL,
  type UserColumnKey,
  type UserSort,
  type MembershipType,
  type UserStatus,
} from "./constants";
import {
  downloadUsersCsv,
  formatListCount,
  generateUsers,
  getActiveUserCount,
  getPageCount,
  paginateRows,
  sortUsers,
  type UserRow,
} from "./data";

const AVATAR_TONES = [
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
] as const;

function avatarTone(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash + seed.charCodeAt(index)) % AVATAR_TONES.length;
  }
  return AVATAR_TONES[hash];
}

function initials(fullName: string) {
  return fullName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function MembershipBadge({ type }: { type: MembershipType }) {
  const premium = type === "premium";

  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
        premium
          ? "bg-[#c0f21e]/25 text-[#1f3a08] dark:bg-[#a3d018]/20 dark:text-[#c0f21e]"
          : "bg-chart-metric-bg text-chart-muted"
      }`}
    >
      {premium ? "Premium" : "Free"}
    </span>
  );
}

function UserAvatar({ user }: { user: UserRow }) {
  return (
    <span
      className={`flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarTone(user.id)}`}
      aria-hidden="true"
    >
      {initials(user.fullName)}
    </span>
  );
}

function SelectCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = Boolean(indeterminate);
    }
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      aria-label={label}
      className="size-4 shrink-0 rounded border-border accent-foreground disabled:opacity-40"
    />
  );
}

function UserRowView({
  user,
  rowNumber,
  banded,
  selected,
  onToggleSelect,
  onView,
  onEdit,
  onDelete,
  onSuspend,
  onActivate,
  disabled,
}: {
  user: UserRow;
  rowNumber: number;
  banded: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSuspend: () => void;
  onActivate: () => void;
  disabled?: boolean;
}) {
  const suspended = user.status === "suspended";

  return (
    <tr
      className={`border-b border-border/70 transition-colors ${
        banded ? "bg-chart-bg/50" : ""
      } ${suspended ? "opacity-70" : ""}`}
    >
      <td className="w-10 min-w-10 py-3 pl-1 pr-2">
        <SelectCheckbox
          checked={selected}
          onChange={onToggleSelect}
          label={`Select ${user.username}`}
          disabled={disabled}
        />
      </td>
      <td className="w-11 min-w-11 py-3 pr-4 font-mono text-sm tabular-nums text-chart-muted">
        {rowNumber}
      </td>
      <td className="py-3 pr-4">
        <div className="flex min-w-[10rem] items-center gap-2.5">
          <UserAvatar user={user} />
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">@{user.username}</p>
            {suspended ? (
              <p className="text-[11px] text-chart-muted">Suspended</p>
            ) : null}
          </div>
        </div>
      </td>
      <td className="max-w-[11rem] truncate py-3 pr-4 text-foreground">
        {user.email}
      </td>
      <td className="min-w-[9.5rem] whitespace-nowrap py-3 pr-4 font-mono text-sm tabular-nums text-foreground">
        {user.phone}
      </td>
      <td className="py-3 pr-4 text-foreground">{user.fullName}</td>
      <td className="py-3 pr-4">
        <MembershipBadge type={user.membershipType} />
      </td>
      <td className="py-3 pr-1">
        <div className="flex items-center gap-1">
          <IconActionButton
            icon={Eye}
            label="View user"
            onClick={onView}
            disabled={disabled}
          />
          <IconActionButton
            icon={Pencil}
            label="Edit user"
            onClick={onEdit}
            disabled={disabled}
          />
          <IconActionButton
            icon={Trash2}
            label="Delete user"
            onClick={onDelete}
            tone="danger"
            disabled={disabled}
          />
          {suspended ? (
            <IconActionButton
              icon={PlayCircle}
              label="Activate user"
              onClick={onActivate}
              disabled={disabled}
            />
          ) : (
            <IconActionButton
              icon={Ban}
              label="Suspend user"
              onClick={onSuspend}
              disabled={disabled}
            />
          )}
        </div>
      </td>
    </tr>
  );
}

function SkeletonRow({ rowNumber, banded }: { rowNumber: number; banded: boolean }) {
  return (
    <tr className={`border-b border-border/70 ${banded ? "bg-chart-bg/50" : ""}`}>
      <td className="w-10 min-w-10 py-3 pl-1 pr-2">
        <ListSkeletonBar className="size-4 rounded" />
      </td>
      <td className="w-11 min-w-11 py-3 pr-4 font-mono text-sm tabular-nums text-chart-muted">
        {rowNumber}
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2.5">
          <ListSkeletonBar className="size-9 rounded-full" />
          <ListSkeletonBar className="h-4 w-28" />
        </div>
      </td>
      <td className="py-3 pr-4">
        <ListSkeletonBar className="h-4 w-36" />
      </td>
      <td className="min-w-[9.5rem] py-3 pr-4">
        <ListSkeletonBar className="h-4 w-[8.5rem]" />
      </td>
      <td className="py-3 pr-4">
        <ListSkeletonBar className="h-4 w-24" />
      </td>
      <td className="py-3 pr-4">
        <ListSkeletonBar className="h-5 w-16 rounded-full" />
      </td>
      <td className="py-3 pr-1">
        <ListSkeletonBar className="h-8 w-40" />
      </td>
    </tr>
  );
}

export function UserListTable() {
  const [seed, setSeed] = useState(0);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<UserSort>(DEFAULT_SORT);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [tableVisible, setTableVisible] = useState(true);
  const loadIdRef = useRef(0);
  const tableTransitionRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sortedUsers = useMemo(() => sortUsers(users, sort), [users, sort]);
  const activeCount = useMemo(() => getActiveUserCount(users), [users]);
  const pageCount = getPageCount(sortedUsers.length, LIST_TABLE_PAGE_SIZE);
  const pageUsers = useMemo(
    () => paginateRows(sortedUsers, page, LIST_TABLE_PAGE_SIZE),
    [sortedUsers, page],
  );
  const pageIds = useMemo(() => pageUsers.map((user) => user.id), [pageUsers]);
  const selectedCount = selectedIds.size;
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const somePageSelected =
    pageIds.some((id) => selectedIds.has(id)) && !allPageSelected;

  const showTable = !loading && !error && sortedUsers.length > 0;
  const showEmpty = !loading && !error && sortedUsers.length === 0;
  const showError = !loading && error !== null;
  const tableBusy = loading || !tableVisible;

  function updateUserStatus(ids: string[], status: UserStatus) {
    const idSet = new Set(ids);
    setUsers((current) =>
      current.map((user) =>
        idSet.has(user.id) ? { ...user, status } : user,
      ),
    );
  }

  function deleteUsers(ids: string[]) {
    const idSet = new Set(ids);
    setUsers((current) => current.filter((user) => !idSet.has(user.id)));
    setSelectedIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePageSelection() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allPageSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function runTableTransition(action: () => void) {
    if (loading || tableTransitionRef.current) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (reducedMotion || !tableVisible) {
      action();
      return;
    }

    tableTransitionRef.current = true;
    setTableVisible(false);
    await wait(LIST_TABLE_FADE_MS);
    action();
    requestAnimationFrame(() => {
      setTableVisible(true);
      tableTransitionRef.current = false;
    });
  }

  async function loadUsers(nextSeed: number, withFadeOut: boolean) {
    const loadId = ++loadIdRef.current;

    if (withFadeOut && visible) {
      setVisible(false);
      await wait(LIST_TABLE_FADE_MS);
      if (loadId !== loadIdRef.current) return;
    }

    setLoading(true);
    setError(null);
    setVisible(true);
    await wait(LIST_TABLE_LOAD_MS);
    if (loadId !== loadIdRef.current) return;

    setVisible(false);
    await wait(LIST_TABLE_FADE_MS);
    if (loadId !== loadIdRef.current) return;

    try {
      const nextUsers = generateUsers(nextSeed);
      setUsers(nextUsers);
      setPage(1);
      setSort(DEFAULT_SORT);
      setSelectedIds(new Set());
      setError(null);
      setLoading(false);
      setTableVisible(true);
      requestAnimationFrame(() => {
        if (loadId !== loadIdRef.current) return;
        setVisible(true);
        scrollRef.current?.scrollTo({ top: 0, left: 0 });
      });
    } catch (loadError) {
      setUsers([]);
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load users",
      );
      setLoading(false);
      setTableVisible(true);
      requestAnimationFrame(() => {
        if (loadId !== loadIdRef.current) return;
        setVisible(true);
      });
    }
  }

  useEffect(() => {
    void loadUsers(0, false);
    // Initial load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRefresh() {
    if (loading) return;
    const nextSeed = seed + 1;
    setSeed(nextSeed);
    void loadUsers(nextSeed, true);
  }

  function handlePageChange(nextPage: number) {
    if (tableBusy || nextPage === page) return;
    void runTableTransition(() => {
      setPage(nextPage);
      scrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    });
  }

  function handleSort(key: UserColumnKey) {
    if (tableBusy) return;
    void runTableTransition(() => {
      setSort((current) => nextListSort(current, key));
      setPage(1);
      scrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    });
  }

  function handleExportCsv() {
    if (loading || sortedUsers.length === 0) return;
    downloadUsersCsv(sortedUsers);
  }

  function handleRetry() {
    if (loading) return;
    void loadUsers(seed, true);
  }

  const bulkActions = [
    {
      id: "bulk-suspend",
      label: "Suspend",
      onClick: () => updateUserStatus([...selectedIds], "suspended"),
    },
    {
      id: "bulk-activate",
      label: "Activate",
      onClick: () => updateUserStatus([...selectedIds], "active"),
    },
    {
      id: "bulk-delete",
      label: "Delete",
      tone: "danger" as const,
      onClick: () => deleteUsers([...selectedIds]),
    },
  ];

  const tableHead = (
    <thead className="sticky top-0 z-10 bg-chart-card-bg">
      <tr className="border-b border-border">
        <th className="w-10 min-w-10 pb-3 pl-1 pr-2">
          {showTable ? (
            <SelectCheckbox
              checked={allPageSelected}
              indeterminate={somePageSelected}
              onChange={togglePageSelection}
              label="Select all on page"
              disabled={tableBusy}
            />
          ) : (
            <span className="sr-only">Select</span>
          )}
        </th>
        <th className="w-11 min-w-11 pb-3 pr-4 text-sm font-medium text-chart-muted">
          {ROW_NUMBER_LABEL}
        </th>
        {COLUMNS.map((column) => (
          <ListSortableHeader
            key={column.key}
            columnKey={column.key}
            label={column.label}
            sort={sort}
            onSort={handleSort}
            disabled={tableBusy || loading}
            className={
              column.key === "phone" ? "min-w-[9.5rem] whitespace-nowrap" : undefined
            }
          />
        ))}
        <th className="pb-3 pr-1 text-sm font-medium text-chart-muted">Actions</th>
      </tr>
    </thead>
  );

  return (
    <div
      className="w-full rounded-3xl bg-chart-card-bg p-4 sm:p-5"
      data-component="user-list-table"
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-3">
          <MetricIconBox icon={Users} />
          <div>
            <h2 className="text-lg font-semibold text-foreground">User list</h2>
            <p className="text-sm text-chart-muted">Manage accounts and membership</p>
            <div
              className="mt-1 flex min-h-5 items-center gap-2"
              aria-live="polite"
              aria-label={`Active users ${formatListCount(activeCount)}`}
            >
              <span className="text-sm text-chart-muted">Active</span>
              <span className="text-sm text-chart-muted">·</span>
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {loading ? (
                  "…"
                ) : (
                  <AnimatedNumber value={activeCount} format={formatListCount} />
                )}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <p className="text-sm text-chart-muted tabular-nums">
            {loading ? "…" : error ? "0 users" : `${users.length} users`}
          </p>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={loading || sortedUsers.length === 0}
            className="flex h-9 min-h-9 items-center gap-1.5 rounded-xl bg-chart-metric-bg px-3 text-sm font-medium text-chart-muted transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            aria-label="Export CSV"
          >
            <Icon icon={Download} size="sm" />
            <span>CSV</span>
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="flex h-9 min-h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-chart-metric-bg text-chart-muted transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            aria-label="Refresh users"
          >
            <RefreshIcon
              className={loading ? "animate-spin text-chart-muted" : undefined}
            />
          </button>
        </div>
      </div>

      <div
        className={`transition-opacity duration-200 ease-out ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      >
        {loading ? (
          <div
            ref={scrollRef}
            className="traffic-table-scroll h-[320px] overflow-auto overscroll-contain px-3 sm:px-4"
          >
            <table className="w-full min-w-[54rem] text-left text-sm">
              {tableHead}
              <tbody aria-busy={true}>
                {Array.from({ length: LIST_TABLE_PAGE_SIZE }, (_, index) => (
                  <SkeletonRow
                    key={`skeleton-${index}`}
                    rowNumber={index + 1}
                    banded={index % 2 === 1}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {showError ? (
          <ListTableErrorState message={error ?? ""} onRetry={handleRetry} />
        ) : null}

        {showEmpty ? (
          <ListTableEmptyState
            title="No users found"
            description="Users will appear here once accounts are created."
            onRefresh={handleRefresh}
          />
        ) : null}

        {showTable ? (
          <div
            ref={scrollRef}
            className="traffic-table-scroll h-[320px] overflow-auto overscroll-contain px-3 sm:px-4"
          >
            <table className="w-full min-w-[54rem] text-left text-sm">
              {tableHead}
              <tbody
                className={`transition-opacity duration-200 ease-out ${
                  tableVisible ? "opacity-100" : "opacity-0"
                }`}
              >
                {pageUsers.map((user, index) => (
                  <UserRowView
                    key={user.id}
                    user={user}
                    rowNumber={(page - 1) * LIST_TABLE_PAGE_SIZE + index + 1}
                    banded={index % 2 === 1}
                    selected={selectedIds.has(user.id)}
                    onToggleSelect={() => toggleSelect(user.id)}
                    onView={() => undefined}
                    onEdit={() => undefined}
                    onDelete={() => deleteUsers([user.id])}
                    onSuspend={() => updateUserStatus([user.id], "suspended")}
                    onActivate={() => updateUserStatus([user.id], "active")}
                    disabled={tableBusy}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {showTable ? (
        <div
          className={`mt-4 border-t border-border pt-4 transition-opacity duration-200 ease-out ${
            tableVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          <ListTablePagination
            page={page}
            pageCount={pageCount}
            onPageChange={handlePageChange}
            disabled={tableBusy}
          />
        </div>
      ) : null}

      <BulkSelectionBar
        selectedCount={selectedCount}
        actions={bulkActions}
        onClear={clearSelection}
      />
    </div>
  );
}

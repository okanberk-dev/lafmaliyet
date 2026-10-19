import type { ListSort } from "@/components/akmanos/list-table";

export const ROW_NUMBER_LABEL = "#";

export const COLUMNS = [
  { key: "username", label: "User" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "fullName", label: "Full name" },
  { key: "membershipType", label: "Membership" },
] as const;

export type UserColumnKey = (typeof COLUMNS)[number]["key"];

export type UserSort = ListSort<UserColumnKey>;

export const DEFAULT_SORT: UserSort = {
  key: "username",
  direction: "asc",
};

export type MembershipType = "premium" | "free";
export type UserStatus = "active" | "suspended";

export const MEMBERSHIP_LABELS: Record<MembershipType, string> = {
  premium: "Premium",
  free: "Free",
};

export const TOTAL_USERS = 48;

export const DEMO_ERROR_SEED_MOD = 11;
export const DEMO_EMPTY_SEED_MOD = 13;

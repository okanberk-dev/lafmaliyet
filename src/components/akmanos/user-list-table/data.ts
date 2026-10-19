import {
  compareValues,
  formatListCount,
  getPageCount,
  paginateRows,
} from "@/components/akmanos/list-table";
import {
  DEMO_EMPTY_SEED_MOD,
  DEMO_ERROR_SEED_MOD,
  MEMBERSHIP_LABELS,
  TOTAL_USERS,
  type MembershipType,
  type UserColumnKey,
  type UserSort,
  type UserStatus,
} from "./constants";

export type UserRow = {
  id: string;
  username: string;
  email: string;
  phone: string;
  fullName: string;
  membershipType: MembershipType;
  status: UserStatus;
};

const FIRST_NAMES = [
  "Alex",
  "Jordan",
  "Taylor",
  "Morgan",
  "Casey",
  "Riley",
  "Avery",
  "Quinn",
  "Sam",
  "Jamie",
] as const;

const LAST_NAMES = [
  "Reed",
  "Brooks",
  "Hayes",
  "Monroe",
  "Parker",
  "Ellis",
  "Blake",
  "Sawyer",
  "Rowe",
  "Finch",
] as const;

const DOMAINS = ["gmail.com", "outlook.com", "company.io", "studio.dev"] as const;

function formatPhone(seed: number) {
  const area = 200 + (seed % 800);
  const mid = String(100 + ((seed * 3) % 900)).padStart(3, "0");
  const last = String((seed * 7) % 10000).padStart(4, "0");
  return `+1 ${area}-${mid}-${last}`;
}

export function getMembershipLabel(type: MembershipType) {
  return MEMBERSHIP_LABELS[type];
}

export function generateUsers(seed = 0): UserRow[] {
  if (seed > 0 && seed % DEMO_ERROR_SEED_MOD === 0) {
    throw new Error("Failed to load users");
  }

  if (seed > 0 && seed % DEMO_EMPTY_SEED_MOD === 0) {
    return [];
  }

  return Array.from({ length: TOTAL_USERS }, (_, index) => {
    const offset = seed * 9 + index;
    const firstName = FIRST_NAMES[offset % FIRST_NAMES.length];
    const lastName = LAST_NAMES[(offset * 2) % LAST_NAMES.length];
    const username = `${firstName.toLowerCase()}${lastName.toLowerCase()}${(offset % 90) + 10}`;
    const domain = DOMAINS[offset % DOMAINS.length];

    return {
      id: `user-${seed}-${index}`,
      username,
      email: `${username}@${domain}`,
      phone: formatPhone(offset + 11),
      fullName: `${firstName} ${lastName}`,
      membershipType: offset % 4 === 0 ? "premium" : "free",
      status: offset % 9 === 0 ? "suspended" : "active",
    };
  });
}

export function getActiveUserCount(users: UserRow[]) {
  return users.filter((user) => user.status === "active").length;
}

function getSortValue(user: UserRow, key: UserColumnKey) {
  switch (key) {
    case "username":
      return user.username;
    case "email":
      return user.email;
    case "phone":
      return user.phone;
    case "fullName":
      return user.fullName;
    case "membershipType":
      return user.membershipType;
    default:
      return user.username;
  }
}

export function sortUsers(users: UserRow[], sort: UserSort) {
  const sorted = [...users];

  sorted.sort((left, right) => {
    const result = compareValues(
      getSortValue(left, sort.key),
      getSortValue(right, sort.key),
    );
    return sort.direction === "asc" ? result : -result;
  });

  return sorted;
}

export function downloadUsersCsv(users: UserRow[]) {
  const header = ["Username", "Email", "Phone", "Full name", "Membership", "Status"];
  const rows = users.map((user) => [
    user.username,
    user.email,
    user.phone,
    user.fullName,
    getMembershipLabel(user.membershipType),
    user.status,
  ]);

  const csv = [header, ...rows]
    .map((row) =>
      row
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "users.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export { formatListCount, getPageCount, paginateRows };

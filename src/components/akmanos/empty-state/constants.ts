import type { ReactNode } from "react";

export type EmptyStateAction = {
  label: string;
  onClick?: () => void;
  href?: string;
};

export type EmptyStateProps = {
  title?: string;
  description?: string;
  /** Custom illustration. Defaults to the soft stacked records graphic. */
  illustration?: ReactNode;
  /** Pass an action object to show a CTA. Omit for illustration-only empty states. */
  primaryAction?: EmptyStateAction | null;
  secondaryAction?: EmptyStateAction | null;
  className?: string;
};

export const EMPTY_STATE_TITLE = "Your record space is empty";
export const EMPTY_STATE_DESCRIPTION =
  "Connect a live source or upload a CSV to start organizing people, teams, and attributes in one place.";
export const EMPTY_STATE_PRIMARY: EmptyStateAction = {
  label: "Get started",
};

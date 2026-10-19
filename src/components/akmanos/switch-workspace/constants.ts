export type Workspace = {
  id: string;
  name: string;
  subtitle?: string;
  avatarSrc?: string;
  /** Fetches favicon via Google s2 service when no custom avatar */
  faviconDomain?: string;
  /** Accent for initials avatar when no image — hex */
  accent?: string;
};

export const DEFAULT_WORKSPACES: Workspace[] = [
  {
    id: "resend",
    name: "Resend",
    subtitle: "Email API",
    faviconDomain: "resend.com",
  },
  {
    id: "gmail",
    name: "Gmail",
    subtitle: "Inbox",
    faviconDomain: "gmail.com",
  },
  {
    id: "github",
    name: "GitHub",
    subtitle: "Repositories",
    faviconDomain: "github.com",
  },
  {
    id: "drive",
    name: "Drive",
    subtitle: "Files",
    faviconDomain: "drive.google.com",
  },
];

export const SWITCH_WORKSPACE_LABEL = "Switch workspace";
export const ADD_SPACE_LABEL = "Add space";
export const CONNECTED_LABEL = "Connected";

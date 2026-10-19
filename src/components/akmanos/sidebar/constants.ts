import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bot,
  Package,
  Plug,
  Settings,
  Users,
} from "lucide-react";
import { PRODUCT_NAME } from "@/components/akmanos/lib/brand";

export type SidebarNavChild = {
  id: string;
  label: string;
  href?: string;
};

export type SidebarNavItem = {
  id: string;
  label: string;
  icon?: LucideIcon;
  href?: string;
  children?: SidebarNavChild[];
};

export const DEFAULT_SIDEBAR_TITLE = PRODUCT_NAME;
export const DEFAULT_SIDEBAR_LOGO_SRC = "/brand/gfaicon.png";

export const DEFAULT_SIDEBAR_PAGES: SidebarNavItem[] = [
  {
    id: "analytics",
    label: "Analytics",
    icon: BarChart3,
    children: [
      {
        id: "statistic-cards",
        label: "Statistic Cards",
        href: "#analytics/statistic-cards",
      },
      {
        id: "visitor-insights",
        label: "Visitor Insights Chart",
        href: "#analytics/visitor-insights",
      },
      {
        id: "active-users-heatmap",
        label: "Active Users Heatmap",
        href: "#analytics/active-users-heatmap",
      },
      {
        id: "bar-chart",
        label: "Bar Chart",
        href: "#analytics/bar-chart",
      },
    ],
  },
  {
    id: "ai-interface",
    label: "AI Interface",
    icon: Bot,
    children: [
      { id: "chat", label: "Chat", href: "#ai-interface/chat" },
      { id: "agents", label: "Agents", href: "#ai-interface/agents" },
      { id: "prompts", label: "Prompts", href: "#ai-interface/prompts" },
    ],
  },
  {
    id: "users",
    label: "Users",
    icon: Users,
    href: "#users",
  },
  {
    id: "products",
    label: "Products",
    icon: Package,
    children: [
      { id: "catalog", label: "Catalog", href: "#products/catalog" },
      { id: "inventory", label: "Inventory", href: "#products/inventory" },
      { id: "pricing", label: "Pricing", href: "#products/pricing" },
    ],
  },
  {
    id: "addons-integrations",
    label: "Add-ons & integrations",
    icon: Plug,
    href: "#addons-integrations",
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    children: [
      { id: "account", label: "Account", href: "#settings/account" },
      { id: "billing", label: "Billing", href: "#settings/billing" },
      { id: "team", label: "Team", href: "#settings/team" },
    ],
  },
];

export const SIDEBAR_PAGES_LABEL = "Pages";

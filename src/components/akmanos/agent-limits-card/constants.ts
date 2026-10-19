import type { AgentLimitsContext, AgentLimitsPlan } from "./types";

export const CONTEXT_WINDOW_LABEL = "Context window";
export const PLAN_LIMITS_LABEL = "Plan usage limits";
export const PLAN_LIMITS_TIER = "Max (5x)";
export const FREE_SPACE_LABEL = "Free space";

export const DEFAULT_AGENT_LIMITS_CONTEXT: AgentLimitsContext = {
  usedK: 820,
  totalK: 1000,
  percent: 82,
  segments: [
    { id: "messages", label: "Messages", valueK: 520, percent: 52, color: "#3b82f6" },
    { id: "system-tools", label: "System tools", valueK: 96, percent: 9.6, color: "#8b5cf6" },
    { id: "mcp-tools", label: "MCP tools", valueK: 68, percent: 6.8, color: "#ec4899" },
    { id: "skills", label: "Skills", valueK: 54, percent: 5.4, color: "#eab308" },
    { id: "system-prompt", label: "System prompt", valueK: 42, percent: 4.2, color: "#22c55e" },
    { id: "memory-files", label: "Memory files", valueK: 24, percent: 2.4, color: "#38bdf8" },
    { id: "custom-agents", label: "Custom agents", valueK: 16, percent: 1.6, color: "#14b8a6" },
    {
      id: "mcp-deferred",
      label: "MCP tools (deferred)",
      valueK: 69.9,
      percent: 0,
      color: "#d4d4d8",
      deferred: true,
    },
    {
      id: "system-tools-deferred",
      label: "System tools (deferred)",
      valueK: 16.1,
      percent: 0,
      color: "#d4d4d8",
      deferred: true,
    },
    {
      id: "free-space",
      label: FREE_SPACE_LABEL,
      valueK: 180,
      percent: 18,
      color: "transparent",
    },
  ],
  expandableGroups: [
    {
      id: "mcp-tools-group",
      label: "MCP tools",
      totalK: 137.9,
      itemCount: 4,
      items: [
        { id: "browser", label: "browser", valueK: 54.2 },
        { id: "figma", label: "figma", valueK: 41.8 },
        { id: "vercel", label: "vercel", valueK: 26.5 },
        { id: "session", label: "session", valueK: 15.4 },
      ],
    },
    {
      id: "memory-files-group",
      label: "Memory files",
      totalK: 24,
      itemCount: 2,
      items: [
        { id: "notes", label: "notes.md", valueK: 14.2 },
        { id: "prefs", label: "preferences.json", valueK: 9.8 },
      ],
    },
    {
      id: "custom-agents-group",
      label: "Custom agents",
      totalK: 16,
      itemCount: 3,
      items: [
        { id: "reviewer", label: "reviewer", valueK: 6.4 },
        { id: "writer", label: "writer", valueK: 5.1 },
        { id: "planner", label: "planner", valueK: 4.5 },
      ],
    },
  ],
};

export const DEFAULT_AGENT_LIMITS_PLAN: AgentLimitsPlan = {
  title: PLAN_LIMITS_LABEL,
  subtitle: PLAN_LIMITS_TIER,
  limits: [
    {
      id: "five-hour",
      label: "5-hour limit",
      resetLabel: "Resets in 2 hr 46 min",
      percent: 38,
    },
    {
      id: "weekly-all",
      label: "Weekly · all models",
      resetLabel: "Resets Tue 3:00 PM",
      percent: 3,
    },
    {
      id: "weekly-pro",
      label: "Weekly · Pro",
      resetLabel: "Resets Tue 3:00 PM",
      percent: 5,
    },
  ],
};

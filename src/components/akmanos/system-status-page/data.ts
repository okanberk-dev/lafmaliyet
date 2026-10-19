export const SYSTEM_COMPONENT_STATUSES = [
  "OPERATIONAL",
  "DEGRADED",
  "PARTIAL_OUTAGE",
  "MAJOR_OUTAGE",
  "MAINTENANCE",
] as const;

export type SystemComponentStatus = (typeof SYSTEM_COMPONENT_STATUSES)[number];

export type SystemDayStatus = SystemComponentStatus | "NONE";

export const SYSTEM_STATUS_LABELS: Record<SystemComponentStatus, string> = {
  OPERATIONAL: "Operational",
  DEGRADED: "Degraded",
  PARTIAL_OUTAGE: "Partial outage",
  MAJOR_OUTAGE: "Major outage",
  MAINTENANCE: "Maintenance",
};

export const SYSTEM_OVERALL_LABELS: Record<SystemComponentStatus, string> = {
  OPERATIONAL: "All Systems Operational",
  DEGRADED: "Degraded Performance",
  PARTIAL_OUTAGE: "Partial Outage",
  MAJOR_OUTAGE: "Major Outage",
  MAINTENANCE: "Scheduled Maintenance",
};

export const SYSTEM_INCIDENT_STATUS_LABELS = {
  INVESTIGATING: "Investigating",
  IDENTIFIED: "Identified",
  MONITORING: "Monitoring",
  RESOLVED: "Resolved",
} as const;

export type SystemIncidentStatus = keyof typeof SYSTEM_INCIDENT_STATUS_LABELS;

export type PublicSystemIncidentUpdate = {
  id: string;
  status: SystemIncidentStatus;
  message: string;
  createdAt: string;
};

export type PublicSystemIncident = {
  id: string;
  title: string;
  severity: "MINOR" | "MAJOR" | "CRITICAL";
  status: SystemIncidentStatus;
  startedAt: string;
  resolvedAt: string | null;
  updates: PublicSystemIncidentUpdate[];
};

export type PublicSystemComponent = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: SystemComponentStatus;
  history: SystemDayStatus[];
  uptimePercent: number;
};

export type PublicStatusDay = {
  date: string;
  label: string;
  incidents: PublicSystemIncident[];
};

export type PublicSystemStatusSnapshot = {
  overall: SystemComponentStatus;
  overallLabel: string;
  checkedAt: string;
  components: PublicSystemComponent[];
  activeIncidents: PublicSystemIncident[];
  pastDays: PublicStatusDay[];
};

function utcYmd(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatDayHeading(ymd: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${ymd}T12:00:00Z`));
}

function historyDates(days: number) {
  const out: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() - i);
    out.push(utcYmd(d));
  }
  return out;
}

function seededStatus(seed: number): SystemDayStatus {
  const n = seed % 97;
  if (n === 11) return "DEGRADED";
  if (n === 23) return "PARTIAL_OUTAGE";
  if (n === 41) return "MAINTENANCE";
  if (n === 67) return "MAJOR_OUTAGE";
  return "OPERATIONAL";
}

function buildHistory(seedBase: number, days: string[]): {
  history: SystemDayStatus[];
  uptimePercent: number;
} {
  const history = days.map((day, index) => {
    const seed = seedBase * 17 + index * 13 + day.length * 3;
    return seededStatus(seed);
  });
  const up =
    history.filter((d) => d === "OPERATIONAL" || d === "NONE").length /
    Math.max(history.length, 1);
  return {
    history,
    uptimePercent: Math.round(up * 10000) / 100,
  };
}

export function buildDemoSystemStatusSnapshot(): PublicSystemStatusSnapshot {
  const days = historyDates(90);
  const calendar = days.slice(-14);
  const componentsSpec = [
    { id: "c1", key: "storefront", name: "Storefront", seed: 3, status: "OPERATIONAL" as const },
    { id: "c2", key: "api", name: "API", seed: 7, status: "OPERATIONAL" as const },
    { id: "c3", key: "database", name: "Database", seed: 11, status: "OPERATIONAL" as const },
    { id: "c4", key: "cache", name: "Cache", seed: 13, status: "DEGRADED" as const },
    { id: "c5", key: "checkout", name: "Checkout & orders", seed: 17, status: "OPERATIONAL" as const },
    { id: "c6", key: "auth", name: "Sign-in & accounts", seed: 19, status: "OPERATIONAL" as const },
    { id: "c7", key: "search", name: "Search & discovery", seed: 23, status: "OPERATIONAL" as const },
  ];

  const components = componentsSpec.map((item) => {
    const { history, uptimePercent } = buildHistory(item.seed, days);
    history[history.length - 1] = item.status;
    return {
      id: item.id,
      key: item.key,
      name: item.name,
      description: null,
      status: item.status,
      history,
      uptimePercent,
    };
  });

  const overall: SystemComponentStatus = components.some((c) => c.status === "DEGRADED")
    ? "DEGRADED"
    : "OPERATIONAL";

  const pastIncident: PublicSystemIncident = {
    id: "inc-1",
    title: "Elevated latency on the cache layer",
    severity: "MINOR",
    status: "RESOLVED",
    startedAt: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
    resolvedAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    updates: [
      {
        id: "u1",
        status: "INVESTIGATING",
        message: "Increased Redis response times were observed.",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
      },
      {
        id: "u2",
        status: "IDENTIFIED",
        message: "The connection pool limit was reached.",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 28).toISOString(),
      },
      {
        id: "u3",
        status: "RESOLVED",
        message: "Pool size was increased and service returned to normal.",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
      },
    ],
  };

  const incidentDay = utcYmd(new Date(pastIncident.startedAt));

  return {
    overall,
    overallLabel: SYSTEM_OVERALL_LABELS[overall],
    checkedAt: new Date().toISOString(),
    components,
    activeIncidents: [],
    pastDays: [...calendar].reverse().map((date) => ({
      date,
      label: formatDayHeading(date),
      incidents: date === incidentDay ? [pastIncident] : [],
    })),
  };
}

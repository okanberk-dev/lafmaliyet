"use client";

import {
  SYSTEM_INCIDENT_STATUS_LABELS,
  SYSTEM_STATUS_LABELS,
  buildDemoSystemStatusSnapshot,
  type PublicSystemIncident,
  type PublicSystemStatusSnapshot,
  type SystemComponentStatus,
  type SystemDayStatus,
} from "./data";

const BAR: Record<SystemDayStatus, string> = {
  OPERATIONAL: "bg-[#22c55e]",
  DEGRADED: "bg-[#eab308]",
  PARTIAL_OUTAGE: "bg-[#f97316]",
  MAJOR_OUTAGE: "bg-[#ef4444]",
  MAINTENANCE: "bg-[#38bdf8]",
  NONE: "bg-border",
};

const STATUS_TEXT: Record<SystemComponentStatus, string> = {
  OPERATIONAL: "text-[#16a34a] dark:text-[#4ade80]",
  DEGRADED: "text-[#ca8a04] dark:text-[#facc15]",
  PARTIAL_OUTAGE: "text-[#ea580c] dark:text-[#fb923c]",
  MAJOR_OUTAGE: "text-[#dc2626] dark:text-[#f87171]",
  MAINTENANCE: "text-[#0284c7] dark:text-[#38bdf8]",
};

const BANNER: Record<SystemComponentStatus, string> = {
  OPERATIONAL: "bg-[#22c55e] text-white",
  DEGRADED: "bg-[#eab308] text-[#171717]",
  PARTIAL_OUTAGE: "bg-[#f97316] text-white",
  MAJOR_OUTAGE: "bg-[#ef4444] text-white",
  MAINTENANCE: "bg-[#0ea5e9] text-white",
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatUptime(value: number) {
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: 2,
  })}% uptime`;
}

function dayLabel(status: SystemDayStatus) {
  if (status === "NONE") return "No data for this day";
  return SYSTEM_STATUS_LABELS[status];
}

function IncidentBlock({ incident }: { incident: PublicSystemIncident }) {
  return (
    <article className="mt-4">
      <h3 className="text-[15px] font-semibold text-foreground">{incident.title}</h3>
      <ol className="mt-3 space-y-3 border-l border-border pl-4">
        {incident.updates.map((update) => (
          <li key={update.id}>
            <p className="text-[13px] leading-relaxed text-chart-muted">
              <span className="font-semibold text-foreground">
                {SYSTEM_INCIDENT_STATUS_LABELS[update.status]}
              </span>
              {" — "}
              {update.message}
            </p>
            <p className="mt-1 text-[12px] text-chart-muted">{formatTime(update.createdAt)}</p>
          </li>
        ))}
      </ol>
    </article>
  );
}

export type SystemStatusPageProps = {
  snapshot?: PublicSystemStatusSnapshot;
  className?: string;
};

export function SystemStatusPage({ snapshot, className }: SystemStatusPageProps) {
  const data = snapshot ?? buildDemoSystemStatusSnapshot();

  return (
    <div
      data-component="system-status-page"
      className={`bg-background text-foreground ${className ?? ""}`.trim()}
    >
      <div className="mx-auto w-full max-w-[920px] px-4 pb-16 pt-6 sm:px-6 sm:pb-24 sm:pt-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[13px] text-chart-muted">
              <span>Home</span>
              <span aria-hidden> / </span>
              System status
            </p>
            <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-foreground sm:text-[28px]">
              Status
            </h1>
          </div>
        </div>

        <div
          className={`mt-6 flex min-h-14 items-center rounded-[10px] px-4 py-3 text-[16px] font-semibold sm:px-5 sm:text-[18px] ${BANNER[data.overall]}`}
        >
          {data.overallLabel}
        </div>

        <p className="mt-6 text-[13px] text-chart-muted">Uptime over the last 90 days.</p>

        <section className="mt-4 divide-y divide-border border-y border-border">
          {data.components.map((component) => (
            <div key={component.id} className="py-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[14px] font-medium text-foreground sm:text-[15px]">
                  {component.name}
                </h2>
                <p className={`text-[13px] font-medium ${STATUS_TEXT[component.status]}`}>
                  {SYSTEM_STATUS_LABELS[component.status]}
                </p>
              </div>

              <div
                className="mt-3 flex h-8 gap-px sm:h-9"
                role="img"
                aria-label={`${component.name} 90-day uptime`}
              >
                {component.history.map((day, index) => (
                  <span
                    key={`${component.id}-${index}`}
                    title={dayLabel(day)}
                    className={`min-w-0 flex-1 rounded-[1px] ${BAR[day]}`}
                  />
                ))}
              </div>

              <div className="mt-2 flex items-center justify-between text-[11px] text-chart-muted sm:text-[12px]">
                <span>90 days ago</span>
                <span>{formatUptime(component.uptimePercent)}</span>
                <span>Today</span>
              </div>
            </div>
          ))}
        </section>

        <ul className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-[12px] text-chart-muted">
          {(
            [
              ["OPERATIONAL", "Operational"],
              ["DEGRADED", "Degraded"],
              ["PARTIAL_OUTAGE", "Partial outage"],
              ["MAJOR_OUTAGE", "Major outage"],
              ["MAINTENANCE", "Maintenance"],
            ] as const
          ).map(([status, label]) => (
            <li key={status} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-[2px] ${BAR[status]}`} />
              {label}
            </li>
          ))}
        </ul>

        {data.activeIncidents.length > 0 ? (
          <section className="mt-12">
            <h2 className="text-[18px] font-semibold tracking-tight text-foreground">
              Active incidents
            </h2>
            <div className="mt-4 divide-y divide-border border-t border-border">
              {data.activeIncidents.map((incident) => (
                <div key={incident.id} className="py-5">
                  <IncidentBlock incident={incident} />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-12">
          <h2 className="text-[18px] font-semibold tracking-tight text-foreground">
            Past incidents
          </h2>
          <div className="mt-4 divide-y divide-border border-t border-border">
            {data.pastDays.map((day) => (
              <div key={day.date} className="py-5">
                <h3 className="text-[14px] font-semibold capitalize text-foreground">
                  {day.label}
                </h3>
                {day.incidents.length === 0 ? (
                  <p className="mt-2 text-[13px] text-chart-muted">No incidents reported.</p>
                ) : (
                  day.incidents.map((incident) => (
                    <IncidentBlock key={incident.id} incident={incident} />
                  ))
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

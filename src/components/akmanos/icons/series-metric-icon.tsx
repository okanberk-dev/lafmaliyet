import type { LucideIcon } from "lucide-react";
import { Activity } from "lucide-react";
import { Icon } from "./icon";

export function SeriesMetricIcon({
  color,
  icon = Activity,
}: {
  color: string;
  icon?: LucideIcon;
}) {
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
      style={{ backgroundColor: `${color}22` }}
    >
      <Icon icon={icon} size="md" style={{ color }} />
    </div>
  );
}

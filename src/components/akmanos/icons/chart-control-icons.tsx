import {
  Calendar,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import { Icon } from "./icon";

export function ChartCalendarIcon({ className }: { className?: string }) {
  return (
    <Icon
      icon={Calendar}
      size="sm"
      className={className ?? "text-chart-muted"}
    />
  );
}

export function ChartChevronDownIcon({ className }: { className?: string }) {
  return (
    <Icon
      icon={ChevronDown}
      size="sm"
      className={className ?? "text-chart-muted"}
    />
  );
}

export function ChartRefreshIcon({ className }: { className?: string }) {
  return (
    <Icon icon={RefreshCw} size="sm" className={className ?? "text-chart-muted"} />
  );
}

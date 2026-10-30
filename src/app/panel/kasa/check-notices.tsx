import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/utils";

/**
 * Fotoğraf okumasının denetimleri (kasa raporundaki Z / fiş fotoğrafı ve kasadan çıkan fişi): önce uyarılar (turuncu),
 * sonra bilgiler (nötr); en çok `max` tanesi. İki yerin aynı listesi tek bileşende (docs/planlar/ux-sade.md §5).
 */
export function CheckNotices({ checks, max, className }: { checks: readonly { level: "warn" | "info"; text: string }[]; max: number; className?: string }) {
  if (!checks.length) return null;
  return (
    <ul className={cn("space-y-1.5", className)}>
      {checks.slice(0, max).map((c, i) => (
        <li key={i}>
          <Notice tone={c.level === "warn" ? "warn" : "neutral"} size="sm" title={c.text} />
        </li>
      ))}
    </ul>
  );
}

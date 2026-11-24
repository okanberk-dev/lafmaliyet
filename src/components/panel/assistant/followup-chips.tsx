import { CornerDownRight } from "lucide-react";

/**
 * Yanıtın altındaki takip önerileri (src/lib/assistant/followups.ts; docs/ASISTAN.md › Takip önerileri): modelin aynı
 * yanıtta önerdiği 2–3 kısa soru. Dokununca soru olarak gider. Yazı React metnidir (HTML yok); dokunma alanı telefonda
 * 44 px. Sade: zemin yok, ince çizgi, ikincil yazı rengi.
 */
export function FollowupChips({ items, onPick, disabled }: { items: readonly string[]; onPick: (q: string) => void; disabled?: boolean }) {
  if (!items.length) return null;
  return (
    <ul aria-label="Önerilen sorular" className="flex flex-wrap gap-2 pt-1" data-component="followups">
      {items.map((q) => (
        <li key={q} className="min-w-0">
          <button
            type="button"
            onClick={() => onPick(q)}
            disabled={disabled}
            className="inline-flex min-h-9 max-w-full cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-left text-[13px] leading-5 text-ink-soft ring-1 ring-line hover:bg-panel hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none disabled:opacity-50 max-lg:min-h-11 max-lg:px-3.5 max-lg:text-[15px] pointer-coarse:min-h-11"
          >
            <CornerDownRight className="size-3.5 shrink-0 text-ink-quiet" aria-hidden="true" />
            <span className="min-w-0 break-words">{q}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

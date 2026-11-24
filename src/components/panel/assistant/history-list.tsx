import { ArrowLeft, Trash2 } from "lucide-react";

import { HISTORY_MAX, type Conversation } from "@/lib/assistant/history";
import { cn } from "@/lib/utils";

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
};

/**
 * Asistanın sohbet geçmişi (src/lib/assistant/history.ts; docs/ASISTAN.md › Sohbet geçmişi): bu cihazdaki son 10
 * sohbet. Satıra dokununca sohbet açılır, çöp kutusu siler. Başlık ve tarih React yazısı (HTML yok). Telefonda her
 * satır ve düğme en az 44 px; sade: kenarlık yerine ince ayraç.
 */
export function HistoryList({
  items,
  activeId,
  onOpen,
  onDelete,
  onBack,
  disabled,
}: {
  items: readonly Conversation[];
  activeId: string | null;
  onOpen: (c: Conversation) => void;
  onDelete: (c: Conversation) => void;
  onBack: () => void;
  disabled?: boolean;
}) {
  return (
    <section aria-label="Sohbet geçmişi" className="space-y-3" data-component="assistant-history">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] leading-5 font-semibold text-ink-soft max-lg:text-[15px]">Son sohbetler</h3>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-ink-mute hover:bg-panel hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none max-lg:h-11 max-lg:text-[14px] pointer-coarse:h-11"
        >
          <ArrowLeft className="size-3.5 max-lg:size-4" aria-hidden="true" /> Sohbete dön
        </button>
      </div>
      {items.length ? (
        <ul className="divide-y divide-line">
          {items.map((c) => (
            <li key={c.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onOpen(c)}
                disabled={disabled}
                aria-current={c.id === activeId ? "true" : undefined}
                className="flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col items-start justify-center rounded-lg px-1.5 py-2 text-left hover:bg-panel focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none disabled:opacity-50"
              >
                <span className={cn("w-full truncate text-[14px] leading-5 text-ink max-lg:text-[16px] max-lg:leading-6", c.id === activeId && "font-semibold")}>{c.title}</span>
                <span className="text-[12px] leading-4 text-ink-mute max-lg:text-[13px] max-lg:leading-5">
                  {when(c.updatedAt)} · {Math.ceil(c.messages.length / 2)} soru{c.id === activeId ? " · açık" : ""}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(c)}
                aria-label={`Sil: ${c.title}`}
                title="Sil"
                className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-mute hover:bg-panel hover:text-bad-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none max-lg:size-11 pointer-coarse:size-11"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px] leading-6 text-ink-mute max-lg:text-[15px]">Henüz kayıtlı sohbet yok.</p>
      )}
      <p className="text-[12px] leading-5 text-ink-mute max-lg:text-[13px]">
        Son {HISTORY_MAX} sohbet yalnız bu cihazda ve yalnız sizin için durur; onay kartlarının yalnız başlığı ve durumu saklanır. Çıkış yapınca silinir.
      </p>
    </section>
  );
}

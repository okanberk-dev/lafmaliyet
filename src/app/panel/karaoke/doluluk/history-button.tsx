"use client";

import { History } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { historyToast } from "@/lib/karaoke/occupancy-text";
import { importKaraokeHistoryNow } from "@/server/actions/karaoke-doluluk";

/**
 * "Geçmişi siteden al" / "Devam et" / "Yeniden al": laffogato.net'in geçmiş rezervasyonlarını ay ay alır (en çok 45 sn;
 * yetmezse kalanı Devam et ile). Bitince bildirim çıkar, sayfa sunucu eylemiyle yenilenir.
 */
export function HistoryButton({ label, variant = "secondary" }: { label: string; variant?: "primary" | "secondary" }) {
  const [pending, start] = useTransition();

  function run() {
    start(async () => {
      const res = await importKaraokeHistoryNow();
      if (!res.ok) return void toast.error(res.error);
      const t = historyToast(res.data);
      (t.tone === "success" ? toast.success : t.tone === "info" ? toast.warning : toast.error)(t.text);
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button variant={variant} size="sm" onClick={run} disabled={pending}>
        <History size={14} aria-hidden="true" /> {pending ? "Alınıyor…" : label}
      </Button>
      {pending ? (
        <span role="status" className="text-xs text-ink-mute">
          Site ay ay okunuyor; en çok bir dakika sürer.
        </span>
      ) : null}
    </span>
  );
}

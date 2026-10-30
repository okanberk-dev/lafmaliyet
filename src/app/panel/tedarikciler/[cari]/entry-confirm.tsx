"use client";

import { useState, type ReactNode } from "react";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import type { MonthEffect } from "@/lib/cari/months";

import { PastConfirm } from "../cari-ui";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Cari kaydını silme ya da bağını kaldırma onayı: eylem geçmiş ayın giderini değiştiriyorsa sunucu ayları döndürür,
 * pencere onları gösterip onay kutusu işaretlenince yeniden gönderir (K18). `initialPast`: sunucunun zaten döndürdüğü
 * aylar (Son ödenenler'in Geri al'ı); pencere onlarla açılır.
 */
export function EntryConfirm<R extends { needs: "past"; effects: MonthEffect[] } | { needs: null }>({
  title,
  description,
  confirmLabel,
  tone = "danger",
  initialPast = [],
  run,
  onDone,
  onClose,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
  initialPast?: MonthEffect[];
  run: (confirmPast: string[]) => Promise<Result<R>>;
  onDone: (data: Extract<R, { needs: null }>) => void;
  onClose: () => void;
}) {
  const [past, setPast] = useState<MonthEffect[]>(initialPast);
  const [pastOk, setPastOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useActionTransition();

  function confirm() {
    setError(null);
    start(async () => {
      const r = await run(pastOk ? past.map((e) => e.month) : []);
      if (!r.ok) return void setError(r.error);
      const d = r.data;
      if (d.needs === "past") {
        setPast((d as { effects: MonthEffect[] }).effects);
        setPastOk(false);
        return;
      }
      onClose();
      onDone(d as Extract<R, { needs: null }>);
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending} data-autofocus className="max-sm:bg-panel">
            Vazgeç
          </Button>
          <Button variant={tone} onClick={confirm} disabled={pending || (past.length > 0 && !pastOk)}>
            {pending ? "Bekleyin…" : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-1">
        <div className="text-sm leading-6 text-ink-mute">{description}</div>
        <PastConfirm effects={past} checked={pastOk} onChange={setPastOk} />
        {error ? (
          <Notice tone="bad" size="sm" live="assertive" title={error} />
        ) : null}
      </div>
    </Dialog>
  );
}

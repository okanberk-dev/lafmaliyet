"use client";

import type { ReactNode } from "react";

import { Button } from "./button";
import { Dialog } from "./dialog";

/** Geri alınamaz eylemler için onay penceresi (sil, temizle) */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Sil",
  pending,
  tone = "danger",
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  pending?: boolean;
  tone?: "danger" | "primary";
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending} data-autofocus>
            Vazgeç
          </Button>
          <Button variant={tone} onClick={onConfirm} disabled={pending}>
            {pending ? "Bekleyin…" : confirmLabel}
          </Button>
        </>
      }
    >
      {description ? <p className="text-sm text-ink-mute">{description}</p> : null}
    </Dialog>
  );
}

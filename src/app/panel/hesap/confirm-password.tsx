"use client";

import { useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";

/**
 * Hesabım'da parola isteyen eylemlerin penceresi (iki adımlı doğrulamayı aç / kapat, kurtarma kodları, diğer
 * cihazlardaki oturumlar). `onConfirm` eylemi parolayla çalıştırır; hata olursa sözünü döndürür, pencere açık kalır.
 */
export function ConfirmPasswordDialog({
  title,
  description,
  confirmLabel,
  danger = false,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: (password: string) => Promise<string | null>;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const problem = await onConfirm(password);
      if (problem) setError(problem);
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form="confirm-password" variant={danger ? "danger" : "primary"} disabled={pending || !password}>
            {pending ? "Bekleyin…" : confirmLabel}
          </Button>
        </>
      }
    >
      <form id="confirm-password" onSubmit={submit} className="pb-2">
        <Field label="Parolanız" htmlFor="confirm-pw" error={error}>
          <Input id="confirm-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={error ? true : undefined} data-autofocus />
        </Field>
      </form>
    </Dialog>
  );
}

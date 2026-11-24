"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";

import { actionErrorText } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { PasswordInput } from "@/components/ui/password-input";

/**
 * Kendi parolanızı isteyen eylemlerin penceresi: Hesabım (iki adımlı doğrulamayı aç / kapat, kurtarma kodları, diğer
 * cihazlardaki oturumlar) ve Kullanıcılar'daki yönetici işlemleri. `onConfirm` eylemi parolayla çalıştırır; hata olursa
 * sözünü döndürür, pencere açık kalır. Eylem atarsa (ağ kesildi, panel güncellendi; denetim E-51) sayfa hata ekranına
 * düşmez: pencere ve yazılan parola yerinde kalır, nedeni alanın altında ayrı bir durum satırında görünür (parola
 * alanı geçersiz işaretlenmez: istek sunucuya ulaşmadı, parola yanlış değil). `description` başlığın altında satır
 * içi durur (Dialog <p> içinde gösterir); özet gibi blok içerik `children` ile alanın üstüne gelir. Açık bir pencerenin
 * içinde değil yanında bağlanır.
 */
export function ConfirmPasswordDialog({
  title,
  description,
  confirmLabel,
  danger = false,
  children,
  onClose,
  onConfirm,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  children?: ReactNode;
  onClose: () => void;
  onConfirm: (password: string) => Promise<string | null>;
}) {
  const [password, setPassword] = useState("");
  /** Eylemin döndürdüğü hata (yanlış parola gibi): alanın kendi hatası, alan geçersiz işaretlenir */
  const [error, setError] = useState<string | null>(null);
  /** Atılan eylem (ağ kesildi, panel güncellendi): parolayla ilgisi yok, ayrı durum satırı */
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const problem = await onConfirm(password);
        if (problem) setError(problem);
      } catch (e) {
        setNotice(actionErrorText(e));
      }
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
          <Button variant="ghost" onClick={onClose} className="max-sm:h-11 max-sm:bg-panel">
            Vazgeç
          </Button>
          <Button type="submit" form="confirm-password" variant={danger ? "danger" : "primary"} disabled={pending || !password} className="max-sm:h-11">
            {pending ? "Bekleyin…" : confirmLabel}
          </Button>
        </>
      }
    >
      <form id="confirm-password" onSubmit={submit} className="space-y-3 pb-2">
        {children}
        <Field label="Parolanız" htmlFor="confirm-pw" error={error}>
          <PasswordInput id="confirm-pw" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={error ? true : undefined} data-autofocus className="h-11 pointer-coarse:h-11" />
        </Field>
        {notice ? (
          <Notice tone="warn" size="sm" live="polite" title={notice} />
        ) : null}
      </form>
    </Dialog>
  );
}

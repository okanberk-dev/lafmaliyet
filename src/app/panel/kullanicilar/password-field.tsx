"use client";

import { Check, Copy, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";

import { generatePassword } from "./access";

/** Panoya kopyalar; eski tarayıcıda ve güvenli olmayan bağlamda gizli metin alanıyla */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // aşağıdaki yönteme düş
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    // Açık <dialog> içindeyken seçim yalnızca pencerenin içinde çalışır
    (document.querySelector("dialog[open]") ?? document.body).appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * "Kopyalandı" geri bildirimi 1,8 saniye görünen kopyala düğmesi durumu. `quiet`: başarı bildirimi (toast) çıkmaz;
 * sonucu çağıran sayfa kendi içinde gösterir (telefonda üstteki bildirim pencere başlığını örtmesin).
 */
export function useCopied({ quiet = false }: { quiet?: boolean } = {}) {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(key: string, text: string, okMessage = "Kopyalandı"): Promise<boolean> {
    if (await copyText(text)) {
      setCopied(key);
      if (!quiet) toast.success(okMessage);
      window.setTimeout(() => setCopied((k) => (k === key ? null : k)), 1800);
      return true;
    }
    toast.error("Kopyalanamadı; metni basılı tutup elle kopyalayın");
    return false;
  }
  return { copied, copy };
}

/**
 * Parola alanı: göster/gizle, "Güçlü parola oluştur" (okunur 12 karakter, karışan harf ve rakam yok) ve kopyala.
 * Telefonda 44px dokunma alanı, 16px yazı (iOS yakınlaştırmaz). Kutu panelin parola kutusu (ui/password-input.tsx):
 * gizliyken karakterler DOM'a yazılmaz, altında parola gücü.
 */
export function PasswordField({
  id,
  label,
  hint,
  error,
  value,
  onChange,
  initiallyVisible = false,
  email,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (v: string) => void;
  initiallyVisible?: boolean;
  /** Kişinin e-postası: parola gücü sunucu gibi e-postayı içeren parolayı da "Zayıf" sayar */
  email?: string | null;
}) {
  const [visible, setVisible] = useState(initiallyVisible);
  // Sonuç düğmede yazar ("Kopyalandı"); telefonda üstteki bildirim pencerenin başlığını örtmesin
  const { copied, copy } = useCopied({ quiet: true });
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <PasswordInput
        id={id}
        autoComplete="new-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        className="h-11 pointer-coarse:h-11"
        visible={visible}
        onVisibleChange={setVisible}
        strength={{ email }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          className="h-11 flex-1 pointer-coarse:h-11 sm:flex-none sm:pointer-fine:h-9"
          onClick={() => {
            onChange(generatePassword());
            setVisible(true);
          }}
        >
          <Sparkles size={15} /> Güçlü parola oluştur
        </Button>
        <Button variant="secondary" className="h-11 flex-1 pointer-coarse:h-11 sm:flex-none sm:pointer-fine:h-9" disabled={!value} onClick={() => copy(id, value, "Parola kopyalandı")}>
          {copied === id ? <Check size={15} /> : <Copy size={15} />} {copied === id ? "Kopyalandı" : "Kopyala"}
        </Button>
        <span role="status" className="sr-only">
          {copied === id ? "Parola kopyalandı" : ""}
        </span>
      </div>
    </Field>
  );
}

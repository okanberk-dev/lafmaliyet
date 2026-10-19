"use client";

import { motion } from "motion/react";
import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { AvatarFallback, LiquidMetalAvatar } from "@/components/akmanos/liquid-metal-avatar";
import { EASE_OUT } from "@/components/akmanos/lib/motion-ease";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { changePasswordAction, type PasswordState } from "@/server/actions/auth";

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toLocaleUpperCase("tr-TR"))
    .join("") || "?";

/**
 * AkmanOS sıvı metal avatar (kenar çubuğundaki profil menüsüyle aynı). Fotoğraf yok: baş harfler gösterilir.
 * Hareket azaltma tercihinde metal akışı durur; kart açılırken avatar hafifçe belirir.
 */
export function AccountAvatar({ name }: { name: string }) {
  const reduce = useCalmMotion();
  return (
    // Başlangıç sunucuda ve istemcide aynı (hidrasyon uyuşmazlığı olmasın); hareket azaltılınca anında görünür
    <motion.div
      initial={reduce ? false : { opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={reduce ? { duration: 0 } : { duration: 0.45, ease: EASE_OUT }}
    >
      <LiquidMetalAvatar size="lg" speed={reduce ? 0 : 0.28} className="size-20" aria-hidden="true">
        <AvatarFallback className="text-xl font-semibold tracking-tight text-ink">{initialsOf(name)}</AvatarFallback>
      </LiquidMetalAvatar>
    </motion.div>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState<PasswordState, FormData>(changePasswordAction, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      toast.success("Parolanız değiştirildi");
      ref.current?.reset();
    }
  }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-4">
      <Field label="Mevcut parola" htmlFor="pw-c">
        <Input id="pw-c" name="current" type="password" autoComplete="current-password" required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Yeni parola" hint="En az 8 karakter" htmlFor="pw-n">
          <Input id="pw-n" name="next" type="password" autoComplete="new-password" required minLength={8} />
        </Field>
        <Field label="Yeni parola (tekrar)" htmlFor="pw-r">
          <Input id="pw-r" name="repeat" type="password" autoComplete="new-password" required minLength={8} />
        </Field>
      </div>
      {state.error ? (
        <p role="alert" className="rounded-2xl bg-bad-soft px-3.5 py-2.5 text-sm text-bad">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Kaydediliyor…" : "Parolayı değiştir"}
      </Button>
    </form>
  );
}

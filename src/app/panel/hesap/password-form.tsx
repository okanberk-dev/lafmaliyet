"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { changePasswordAction, type PasswordState } from "@/server/actions/auth";

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
    <form ref={ref} action={action} className="space-y-3">
      <Field label="Mevcut parola" htmlFor="pw-c">
        <Input id="pw-c" name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="Yeni parola" hint="En az 8 karakter" htmlFor="pw-n">
        <Input id="pw-n" name="next" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Yeni parola (tekrar)" htmlFor="pw-r">
        <Input id="pw-r" name="repeat" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      {state.error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Kaydediliyor…" : "Parolayı değiştir"}
      </Button>
    </form>
  );
}

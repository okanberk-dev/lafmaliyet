"use client";

import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { useCalmMotion } from "@/components/ui/motion";
import { AvatarFallback, LiquidMetalAvatar } from "@/components/akmanos/liquid-metal-avatar";
import { EASE_OUT } from "@/components/akmanos/lib/motion-ease";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { PASSWORD_MIN, passwordProblem } from "@/lib/password-rules";
import { changePasswordAction, updateProfile, type PasswordState } from "@/server/actions/auth";

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
  // Yazarken uyarı: kısa parola ve tekrarın tutmaması gönderilmeden görünsün (sunucu yine denetler)
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const tooShort = next.length > 0 && next.length < PASSWORD_MIN;
  // Kolay tahmin edilen parola da yazarken söylenir (e-postayla ilgili kuralı sunucu ekler)
  const weak = !tooShort && next.length > 0 ? passwordProblem(next) : null;
  const mismatch = repeat.length > 0 && repeat !== next;
  useEffect(() => {
    if (state.ok) {
      toast.success("Parolanız değiştirildi");
      ref.current?.reset();
    }
  }, [state]);
  return (
    <form
      ref={ref}
      action={action}
      onReset={() => {
        setNext("");
        setRepeat("");
      }}
      className="space-y-4"
    >
      <Field label="Mevcut parola" htmlFor="pw-c">
        <Input id="pw-c" name="current" type="password" autoComplete="current-password" required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Yeni parola" hint="En az 8 karakter" error={tooShort ? `En az ${PASSWORD_MIN} karakter (şu an ${next.length})` : (weak ?? undefined)} htmlFor="pw-n">
          <Input
            id="pw-n"
            name="next"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            aria-invalid={tooShort || Boolean(weak) || undefined}
          />
        </Field>
        <Field label="Yeni parola (tekrar)" error={mismatch ? "İki parola aynı değil" : undefined} htmlFor="pw-r">
          <Input
            id="pw-r"
            name="repeat"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            aria-invalid={mismatch || undefined}
          />
        </Field>
      </div>
      {state.error ? (
        <p role="alert" className="rounded-2xl bg-bad-soft px-3.5 py-2.5 text-sm text-bad">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending || tooShort || Boolean(weak) || mismatch} className="w-full">
        {pending ? "Kaydediliyor…" : "Parolayı değiştir"}
      </Button>
    </form>
  );
}

/** Ad ve giriş e-postası; değişiklik parolayla onaylanır */
export function ProfileForm({ name: initialName, email: initialEmail }: { name: string; email: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useActionTransition();
  const dirty = name.trim() !== initialName || email.trim().toLowerCase() !== initialEmail;

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await updateProfile({ name, email, password });
      if (!res.ok) return setError(res.error);
      setPassword("");
      toast.success("Bilgileriniz güncellendi");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ad" htmlFor="pr-n">
          <Input id="pr-n" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={80} />
        </Field>
        <Field label="Giriş e-postası" htmlFor="pr-e">
          <Input id="pr-e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </Field>
      </div>
      {dirty ? (
        <Field label="Parolanız (onay için)" htmlFor="pr-p" hint="Değişikliği kaydetmek için mevcut parolanızı girin">
          <Input id="pr-p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-2xl bg-bad-soft px-3.5 py-2.5 text-sm text-bad">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="secondary" disabled={pending || !dirty || !password} className="w-full sm:w-auto">
        {pending ? "Kaydediliyor…" : "Bilgileri kaydet"}
      </Button>
    </form>
  );
}

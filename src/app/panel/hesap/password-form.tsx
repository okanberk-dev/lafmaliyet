"use client";

import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { catchingFormAction, useActionTransition } from "@/components/ui/action-error";
import { useCalmMotion } from "@/components/ui/motion";
import { AvatarFallback, LiquidMetalAvatar } from "@/components/akmanos/liquid-metal-avatar";
import { EASE_OUT } from "@/components/akmanos/lib/motion-ease";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { PasswordInput } from "@/components/ui/password-input";
import { PASSWORD_MIN, passwordProblem } from "@/lib/password-rules";
import { changePasswordAction, updateProfile, type PasswordState } from "@/server/actions/auth";

/** Ağ kesilirse ya da panel güncellendiyse form hata ekranına düşmez; nedeni formun hata satırında (E-51) */
const changePassword = catchingFormAction(changePasswordAction);

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

/** `email`: kişinin giriş e-postası (parolada geçmesin kuralı yazarken de söylenir) */
export function PasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<PasswordState, FormData>(changePassword, {});
  const ref = useRef<HTMLFormElement>(null);
  // Yazarken uyarı: kısa parola ve tekrarın tutmaması gönderilmeden görünsün (sunucu yine denetler)
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const tooShort = next.length > 0 && next.length < PASSWORD_MIN;
  // Kolay tahmin edilen ve e-postayı içeren parola da yazarken söylenir (sunucu aynı kuralla yine denetler)
  const weak = !tooShort && next.length > 0 ? passwordProblem(next, email) : null;
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
        <PasswordInput id="pw-c" name="current" autoComplete="current-password" required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Yeni parola" hint="En az 8 karakter" error={tooShort ? `En az ${PASSWORD_MIN} karakter (şu an ${next.length})` : (weak ?? undefined)} htmlFor="pw-n">
          <PasswordInput
            id="pw-n"
            name="next"
            autoComplete="new-password"
            required
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            aria-invalid={tooShort || Boolean(weak) || undefined}
            strength={{ email }}
          />
        </Field>
        <Field label="Yeni parola (tekrar)" error={mismatch ? "İki parola aynı değil" : undefined} htmlFor="pw-r">
          <PasswordInput
            id="pw-r"
            name="repeat"
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
        <Notice tone="bad" size="sm" live="assertive" title={state.error} />
      ) : null}
      <Button type="submit" disabled={pending || tooShort || Boolean(weak) || mismatch} className="w-full">
        {pending ? "Kaydediliyor…" : "Parolayı değiştir"}
      </Button>
    </form>
  );
}

/**
 * Ad ve giriş e-postası; değişiklik parolayla onaylanır. `emailLocked`: asıl yöneticinin e-postası değişmez (yetki adrese
 * bağlı; docs/ROLLER.md › Asıl yönetici): alan salt okunur, nedeni altında (sunucu da reddeder)
 */
export function ProfileForm({ name: initialName, email: initialEmail, emailLocked = null }: { name: string; email: string; emailLocked?: string | null }) {
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
        <Field label="Giriş e-postası" htmlFor="pr-e" hint={emailLocked ?? undefined}>
          <Input
            id="pr-e"
            type="email"
            value={email}
            readOnly={emailLocked !== null}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            className={emailLocked !== null ? "bg-panel text-ink-mute" : undefined}
          />
        </Field>
      </div>
      {dirty ? (
        <Field label="Parolanız (onay için)" htmlFor="pr-p" hint="Değişikliği kaydetmek için mevcut parolanızı girin">
          <PasswordInput id="pr-p" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
      ) : null}
      {error ? (
        <Notice tone="bad" size="sm" live="assertive" title={error} />
      ) : null}
      <Button type="submit" variant="secondary" disabled={pending || !dirty || !password} className="w-full sm:w-auto">
        {pending ? "Kaydediliyor…" : "Bilgileri kaydet"}
      </Button>
    </form>
  );
}

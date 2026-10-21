"use client";

import { CircleCheck, Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { PASSWORD_MIN, passwordProblem } from "@/lib/password-rules";
import { setPasswordWithToken, type SetPasswordState } from "@/server/actions/invites";

import { AuthError, authButton, authInput } from "@/app/giris/auth-ui";

import { rememberLoginEmail } from "./keys";
import { TokenProblem } from "./problem";

const MIN = PASSWORD_MIN;

// Giriş ekranıyla aynı çerçeveli alan (16px yazı: iOS alana odaklanınca sayfayı yakınlaştırmaz)
const input = authInput;

/**
 * Yeni parola + tekrarı (en az 8, göster/gizle). Kaydedilince kısa bir onay gösterilir ve giriş sayfasına
 * ("Parolanız kaydedildi" mesajıyla) geçilir. Oturum açılmaz.
 */
export function SetPasswordForm({ token, name, email, kind, until }: { token: string; name: string; email: string; kind: "invite" | "reset"; until: string }) {
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(setPasswordWithToken, {});
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [show, setShow] = useState(false);
  const router = useRouter();
  const short = password.length > 0 && password.length < MIN;
  // Kolay tahmin edilen parola da yazarken söylenir (e-postayla ilgili kuralı sunucu ekler)
  const weak = !short && password.length > 0 ? passwordProblem(password) : null;
  const mismatch = repeat.length > 0 && repeat !== password;

  useEffect(() => {
    if (!state.done) return;
    rememberLoginEmail(email);
    const t = window.setTimeout(() => router.replace("/giris?parola=yeni"), 2200);
    return () => window.clearTimeout(t);
  }, [state.done, email, router]);

  if (state.status) return <TokenProblem status={state.status} />;

  if (state.done) {
    return (
      <div className="flex flex-col gap-4" role="status">
        <div className="flex items-start gap-3 rounded-lg bg-[#d4e9e2] px-4 py-3.5 text-[#1e3932]">
          <CircleCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-base font-bold">Parolanız kaydedildi</h2>
            <p className="mt-1 text-[15px] leading-6">Giriş sayfasına geçiliyor. Yeni parolanız ve bu e-postayla giriş yapın:</p>
            <p className="mt-1 text-[15px] font-semibold wrap-anywhere">{email}</p>
          </div>
        </div>
        <Link href="/giris?parola=yeni" replace className={`${authButton} w-full`}>
          Giriş sayfasına git
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="t" value={token} />
      {/* Parola yöneticisi doğru hesaba kaydetsin */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <dl className="divide-y divide-black/10 rounded-lg bg-black/[0.03] px-4 py-1 text-[15px]">
        <div className="py-2.5">
          <dt className="text-xs text-black/60">Ad</dt>
          <dd className="mt-0.5 font-semibold break-words text-black/90">{name}</dd>
        </div>
        <div className="py-2.5">
          <dt className="text-xs text-black/60">Giriş e-postası</dt>
          <dd className="mt-0.5 font-semibold wrap-anywhere text-black/90">{email}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="sp-new" className="text-sm font-semibold text-black/70">
          {kind === "invite" ? "Parolanız" : "Yeni parola"}
        </label>
        <div className="relative">
          <input
            id="sp-new"
            type={show ? "text" : "password"}
            name="password"
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            minLength={MIN}
            maxLength={200}
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={short || weak ? true : undefined}
            aria-describedby="pw-hint"
            className={`${input} pr-12`}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute top-1/2 right-1 flex size-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-black/60 hover:bg-black/[0.04] hover:text-black"
            aria-label={show ? "Parolaları gizle" : "Parolaları göster"}
            aria-pressed={show}
          >
            {show ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
          </button>
        </div>
        <span id="pw-hint" className={`text-sm ${short || weak ? "font-semibold text-[#c82014]" : "text-black/60"}`}>
          {short ? `En az ${MIN} karakter (şu an ${password.length})` : (weak ?? `En az ${MIN} karakter. Başka yerde kullanmadığınız bir parola seçin.`)}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="sp-repeat" className="text-sm font-semibold text-black/70">
          Parola (tekrar)
        </label>
        <input
          id="sp-repeat"
          type={show ? "text" : "password"}
          name="repeat"
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          maxLength={200}
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          aria-invalid={mismatch ? true : undefined}
          aria-describedby={mismatch ? "pw-repeat" : undefined}
          className={input}
        />
        {mismatch ? (
          <span id="pw-repeat" className="text-sm font-semibold text-[#c82014]">
            İki parola aynı değil
          </span>
        ) : null}
      </div>

      {state.error ? (
        <AuthError>{state.error}</AuthError>
      ) : null}

      <button
        type="submit"
        disabled={pending || short || Boolean(weak) || mismatch || !password || !repeat}
        className={`${authButton} w-full`}
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {pending ? "Kaydediliyor…" : "Parolayı kaydet"}
      </button>
      <p className="text-center text-sm leading-5 text-black/60">
        Bağlantı tek kullanımlık · son geçerlilik {until}
      </p>
    </form>
  );
}

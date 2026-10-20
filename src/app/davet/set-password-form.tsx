"use client";

import { CircleCheck, Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { setPasswordWithToken, type SetPasswordState } from "@/server/actions/invites";

import { rememberLoginEmail } from "./keys";
import { TokenProblem } from "./problem";

const MIN = 8;

// 16px yazı: iOS alana odaklanınca sayfayı yakınlaştırmaz; 48px yükseklik
const input =
  "h-12 w-full rounded-xl bg-chart-metric-bg px-3 text-base text-foreground outline-none placeholder:text-chart-muted transition-colors focus:ring-2 focus:ring-foreground/15 aria-invalid:bg-red-50 aria-invalid:ring-1 aria-invalid:ring-red-300";

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
        <div className="flex items-start gap-3 rounded-2xl bg-chart-metric-bg px-4 py-3.5">
          <CircleCheck className="mt-0.5 size-5 shrink-0 text-good" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Parolanız kaydedildi</h2>
            <p className="mt-1 text-sm leading-6 text-chart-muted">Giriş sayfasına geçiliyor. Yeni parolanız ve bu e-postayla giriş yapın:</p>
            <p className="mt-1 text-sm font-medium wrap-anywhere text-foreground">{email}</p>
          </div>
        </div>
        <Link href="/giris?parola=yeni" replace className="flex h-12 w-full items-center justify-center rounded-xl bg-foreground text-[15px] font-semibold text-background">
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
      <dl className="divide-y divide-chart-card-bg rounded-2xl bg-chart-metric-bg px-4 py-1 text-sm">
        <div className="py-2.5">
          <dt className="text-xs text-chart-muted">Ad</dt>
          <dd className="mt-0.5 font-medium break-words text-foreground">{name}</dd>
        </div>
        <div className="py-2.5">
          <dt className="text-xs text-chart-muted">Giriş e-postası</dt>
          <dd className="mt-0.5 font-medium wrap-anywhere text-foreground">{email}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="sp-new" className="text-sm text-chart-muted">
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
            aria-invalid={short ? true : undefined}
            aria-describedby="pw-hint"
            className={`${input} pr-12`}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute top-1/2 right-1 flex size-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-chart-muted hover:text-foreground"
            aria-label={show ? "Parolaları gizle" : "Parolaları göster"}
            aria-pressed={show}
          >
            {show ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
          </button>
        </div>
        <span id="pw-hint" className={`text-xs ${short ? "text-red-600" : "text-chart-muted"}`}>
          {short ? `En az ${MIN} karakter (şu an ${password.length})` : `En az ${MIN} karakter. Başka yerde kullanmadığınız bir parola seçin.`}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="sp-repeat" className="text-sm text-chart-muted">
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
          <span id="pw-repeat" className="text-xs text-red-600">
            İki parola aynı değil
          </span>
        ) : null}
      </div>

      {state.error ? (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-600">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || short || mismatch || !password || !repeat}
        className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-foreground text-[15px] font-semibold text-background disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {pending ? "Kaydediliyor…" : "Parolayı kaydet"}
      </button>
      <p className="text-center text-xs leading-5 text-chart-muted">
        Bağlantı tek kullanımlık · son geçerlilik {until}
      </p>
    </form>
  );
}

"use client";

import { CircleCheck, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { catchingFormAction } from "@/components/ui/action-error";
import { PasswordInput } from "@/components/ui/password-input";
import { PASSWORD_MIN, passwordProblem } from "@/lib/password-rules";
import { setPasswordWithToken, type SetPasswordState } from "@/server/actions/invites";

import { AuthError, authButton, authInput, authToggle } from "@/app/giris/auth-ui";

import { rememberLoginEmail } from "./keys";
import { TokenProblem } from "./problem";

/** Ağ kesilirse ya da panel güncellendiyse form hata ekranına düşmez; nedeni formun hata satırında (E-51) */
const submitNewPassword = catchingFormAction(setPasswordWithToken);

const MIN = PASSWORD_MIN;

// Giriş ekranıyla aynı çerçeveli alan (16px yazı: iOS alana odaklanınca sayfayı yakınlaştırmaz)
const input = authInput;

/**
 * Yeni parola + tekrarı (en az 8, göster/gizle). Kaydedilince kısa bir onay gösterilir ve giriş sayfasına
 * ("Parolanız kaydedildi" mesajıyla) geçilir. Oturum açılmaz. Alanlar panelin parola kutusu (ui/password-input.tsx):
 * ilk alanın göz düğmesi ikisini birden gösterir; ilk alanın altında parola gücü (aynı `passwordProblem` kuralıyla).
 */
export function SetPasswordForm({ token, name, email, kind, until }: { token: string; name: string; email: string; kind: "invite" | "reset"; until: string }) {
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(submitNewPassword, {});
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [show, setShow] = useState(false);
  const router = useRouter();
  const short = password.length > 0 && password.length < MIN;
  // Kolay tahmin edilen ve e-postayı içeren parola da yazarken söylenir: sunucunun reddi beklenmez (YO-06)
  const weak = !short && password.length > 0 ? passwordProblem(password, email) : null;
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
        <div className="flex items-start gap-3 rounded-lg bg-[#d4e9e2] dark:bg-good-soft px-4 py-3.5 text-[#1e3932] dark:text-good-ink">
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
        <PasswordInput
          id="sp-new"
          plain
          name="password"
          autoComplete="new-password"
          required
          minLength={MIN}
          maxLength={200}
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={short || weak ? true : undefined}
          aria-describedby="pw-hint"
          className={input}
          visible={show}
          onVisibleChange={setShow}
          toggleLabels={{ show: "Parolaları göster", hide: "Parolaları gizle" }}
          toggleClassName={authToggle}
          strength={{ email }}
        />
        <span id="pw-hint" className={`text-sm ${short || weak ? "font-semibold text-[#c82014] dark:text-bad" : "text-black/60"}`}>
          {short ? `En az ${MIN} karakter (şu an ${password.length})` : (weak ?? `En az ${MIN} karakter. Başka yerde kullanmadığınız bir parola seçin.`)}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="sp-repeat" className="text-sm font-semibold text-black/70">
          Parola (tekrar)
        </label>
        <PasswordInput
          id="sp-repeat"
          plain
          name="repeat"
          autoComplete="new-password"
          required
          maxLength={200}
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          aria-invalid={mismatch ? true : undefined}
          aria-describedby={mismatch ? "pw-repeat" : undefined}
          className={input}
          visible={show}
          toggle={false}
        />
        {mismatch ? (
          <span id="pw-repeat" className="text-sm font-semibold text-[#c82014] dark:text-bad">
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

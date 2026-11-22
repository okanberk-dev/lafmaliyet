"use client";

import { ArrowLeft, CircleCheck, Eye, EyeOff, KeyRound, Loader2, Mail, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { takeLoginEmail } from "@/app/davet/keys";
import { catchingFormAction } from "@/components/ui/action-error";
import { cancelLoginCodeAction, loginAction, verifyLoginCodeAction, type LoginState, type TotpState } from "@/server/actions/auth";
import { requestPasswordReset, type ForgotState } from "@/server/actions/invites";

import { AuthError, AuthHeading, authButton, authCard, authInput, authLink, FloatingField } from "./auth-ui";

/**
 * Ağ kesilirse ya da panel güncellendiyse form hata ekranına düşmez; nedeni formun hata satırında (E-51). Yazılan
 * e-posta duruma geri konur: React formu boşaltır, alan `state.email`'den dolar (hatalı parolada olduğu gibi)
 */
const login = catchingFormAction(loginAction, (fd: FormData) => ({ email: String(fd.get("email") ?? "") }));
const verifyCode = catchingFormAction(verifyLoginCodeAction);
const forgotPassword = catchingFormAction(requestPasswordReset);

/**
 * Giriş kartı: e-posta ve parola, gerekirse ikinci adımda doğrulama kodu. "Parolamı unuttum" aynı kartta ayrı bir
 * adım: e-posta istenir, yanıt her durumda aynıdır (hesabın var olup olmadığı anlaşılmaz). Sade, hareketsiz: kart
 * yeşil zeminde beyaz, alanlar çerçeveli, düğme hap biçimli (auth-ui.tsx).
 */

function SubmitButton({ pending, idle, busy, className }: { pending: boolean; idle: string; busy: string; className?: string }) {
  return (
    <button type="submit" disabled={pending} className={`${authButton} ${className ?? ""}`}>
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {pending ? busy : idle}
    </button>
  );
}

/** İkinci adım: doğrulama uygulamasındaki kod ya da kurtarma kodu */
function CodeStep({ email, onBack, onExpired }: { email?: string; onBack: () => void; onExpired: (message: string) => void }) {
  const [state, action, pending] = useActionState<TotpState, FormData>(verifyCode, {});
  const [mode, setMode] = useState<"app" | "recovery">("app");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.expired) onExpired(state.error ?? "Süre doldu, yeniden giriş yapın.");
  }, [state, onExpired]);
  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  return (
    <form action={action} className="flex flex-col gap-5">
      {/* Kod tutmazsa sunucunun metni kipe göre: kurtarma kodunda "uygulamadaki kodu girin" denmez */}
      <input type="hidden" name="mode" value={mode} />
      <p className="flex items-start gap-2.5 text-[15px] leading-6 text-black/70">
        <ShieldCheck className="mt-1 size-4 shrink-0 text-[#00754A] dark:text-good" aria-hidden />
        <span>
          {mode === "app" ? "Doğrulama uygulamanızdaki 6 haneli kodu girin." : "Kaydettiğiniz kurtarma kodlarından birini girin (her kod bir kez çalışır)."}
          {email ? <span className="block font-semibold text-black/90">{email}</span> : null}
        </span>
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-black/70">{mode === "app" ? "Doğrulama kodu" : "Kurtarma kodu"}</span>
        {mode === "app" ? (
          <input
            ref={inputRef}
            key="app"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            required
            placeholder="123 456"
            className={`${authInput} text-center font-mono text-xl tracking-[0.35em] placeholder:text-black/30`}
          />
        ) : (
          <input
            ref={inputRef}
            key="recovery"
            name="code"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            placeholder="abcde-fghjk"
            className={`${authInput} text-center font-mono tracking-wider placeholder:text-black/30`}
          />
        )}
      </label>
      {state.error && !state.expired ? <AuthError>{state.error}</AuthError> : null}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={onBack} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 self-start text-[15px] font-semibold text-black/70 hover:text-black">
          <ArrowLeft className="size-4" aria-hidden /> Geri
        </button>
        <SubmitButton pending={pending} idle="Doğrula ve gir" busy="Doğrulanıyor…" className="max-sm:w-full" />
      </div>
      <button type="button" onClick={() => setMode((m) => (m === "app" ? "recovery" : "app"))} className={`inline-flex min-h-11 items-center gap-1.5 self-start text-[15px] ${authLink}`}>
        <KeyRound className="size-4" aria-hidden />
        {mode === "app" ? "Telefonum yanımda değil" : "Uygulama kodunu kullan"}
      </button>
    </form>
  );
}

/**
 * "Parolamı unuttum": e-posta → genel yanıt. Sunucuda e-posta gönderimi kapalıysa (RESEND_API_KEY yok) form hiç
 * gösterilmez; baştan yöneticiye başvurması söylenir (bağlantı gönderilecekmiş gibi vaat edilmez).
 */
function ForgotStep({ defaultEmail, onBack, emailConfigured }: { defaultEmail: string; onBack: () => void; emailConfigured: boolean }) {
  const [state, action, pending] = useActionState<ForgotState, FormData>(forgotPassword, {});
  const backButton = (
    <button type="button" onClick={onBack} className={`inline-flex min-h-11 items-center gap-1.5 self-start text-[15px] ${authLink}`}>
      <ArrowLeft className="size-4" aria-hidden /> Girişe dön
    </button>
  );
  if (!emailConfigured) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="text-[15px] leading-6 text-black/70">
          Bu panelde e-posta gönderimi kapalı. Parolanızı yenilemek için yöneticinize başvurun; size WhatsApp ya da e-postayla tek kullanımlık bir sıfırlama
          bağlantısı iletebilir.
        </p>
        {backButton}
      </div>
    );
  }
  if (state.message) {
    return (
      <div className="flex flex-col gap-4">
        <p
          role="status"
          className={`flex items-start gap-2.5 rounded-lg px-4 py-3 text-[15px] leading-6 ${state.tone === "ok" ? "bg-[#d4e9e2] dark:bg-good-soft text-[#1e3932] dark:text-good-ink" : "bg-black/[0.04] text-black/80"}`}
        >
          {state.tone === "ok" ? <Mail className="mt-1 size-4 shrink-0" aria-hidden /> : <KeyRound className="mt-1 size-4 shrink-0" aria-hidden />}
          <span>{state.message}</span>
        </p>
        {backButton}
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-5">
      <p className="text-[15px] leading-6 text-black/70">Giriş e-postanızı yazın. Kayıtlıysa parolanızı yenilemeniz için bir bağlantı gönderilir.</p>
      <FloatingField
        id="forgot-email"
        label="* E-posta"
        type="email"
        name="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        inputMode="email"
        autoFocus
        required
        defaultValue={defaultEmail}
      />
      {state.error ? <AuthError>{state.error}</AuthError> : null}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        {backButton}
        <SubmitButton pending={pending} idle="Bağlantı gönder" busy="Gönderiliyor…" className="max-sm:w-full" />
      </div>
    </form>
  );
}

export function LoginForm({ emailConfigured = true }: { emailConfigured?: boolean }) {
  const params = useSearchParams();
  const next = params.get("next") ?? "";
  const expired = params.get("oturum") === "bitti";
  // /davet'te parola kaydedildi
  const passwordSet = params.get("parola") === "yeni";
  const [view, setView] = useState<"login" | "forgot">("login");
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [forgotEmail, setForgotEmail] = useState("");
  // Davet / sıfırlama sayfası e-postayı bu sekmede bırakır: alan hazır dolar, parolaya odaklanılır
  useEffect(() => {
    const saved = takeLoginEmail();
    if (saved && emailRef.current && !emailRef.current.value) {
      emailRef.current.value = saved;
      passwordRef.current?.focus();
    }
  }, []);
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  const [show, setShow] = useState(false);
  // Parola yazarken Caps Lock açıksa uyar (en sık "parola yanlış" sebebi)
  const [caps, setCaps] = useState(false);
  // Kod adımından "Geri" denince aynı sonuç yeniden kod adımı açmasın
  const [left, setLeft] = useState<LoginState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const codeStep = state.step === "totp" && left !== state;
  const error = codeStep ? null : left === state ? notice : (state.error ?? (expired && !state.email ? "Oturumunuz sona erdi, yeniden giriş yapın." : null));

  function back(message?: string) {
    setLeft(state);
    setNotice(message ?? null);
    // En iyi çaba: bekleyen kod adımının çerezi silinir; istek düşerse çerez kendi süresiyle kalkar
    cancelLoginCodeAction().catch(() => undefined);
  }

  return (
    <div data-component="login-card" className={authCard}>
      {codeStep ? (
        <>
          <AuthHeading title="İki adımlı doğrulama" subtitle="Son bir adım kaldı." />
          <CodeStep email={state.email} onBack={() => back()} onExpired={back} />
        </>
      ) : view === "forgot" ? (
        <>
          <AuthHeading title="Parolamı unuttum" subtitle="Parola sıfırlama bağlantısı" />
          <ForgotStep defaultEmail={forgotEmail} onBack={() => setView("login")} emailConfigured={emailConfigured} />
        </>
      ) : (
        <>
          <AuthHeading title="Giriş yap" subtitle="L'Affogato yönetim paneli" />
          <form action={action} className="flex flex-col gap-5">
            <input type="hidden" name="next" value={next} />
            {passwordSet && !state.error ? (
              <p role="status" className="flex items-start gap-2.5 rounded-lg bg-[#d4e9e2] dark:bg-good-soft px-4 py-3 text-[15px] leading-6 text-[#1e3932] dark:text-good-ink">
                <CircleCheck className="mt-1 size-4 shrink-0" aria-hidden />
                <span>Parolanız kaydedildi. E-postanız ve yeni parolanızla giriş yapın.</span>
              </p>
            ) : null}
            <p className="-mt-2 text-sm text-black/60">* zorunlu alan</p>
            <FloatingField
              ref={emailRef}
              id="login-email"
              label="* E-posta"
              type="email"
              name="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="email"
              // Hatalı denemeden sonra e-posta dolu gelir; o zaman parola alanına odaklanılır
              autoFocus={!state.email}
              required
              defaultValue={state.email}
            />
            <div className="flex flex-col gap-1.5">
              <FloatingField
                ref={passwordRef}
                id="login-password"
                label="* Parola"
                type={show ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                autoFocus={Boolean(state.email)}
                onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))}
                onBlur={() => setCaps(false)}
                aria-describedby={caps ? "caps-warning" : undefined}
                required
                trailing={
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    className="flex size-11 cursor-pointer items-center justify-center rounded-full text-black/60 hover:bg-black/[0.04] hover:text-black"
                    aria-label={show ? "Parolayı gizle" : "Parolayı göster"}
                  >
                    {show ? <EyeOff className="size-5" strokeWidth={1.75} /> : <Eye className="size-5" strokeWidth={1.75} />}
                  </button>
                }
              />
              {caps ? (
                <span id="caps-warning" role="status" className="text-sm font-semibold text-[#c82014] dark:text-bad">
                  Caps Lock açık
                </span>
              ) : null}
            </div>

            {error ? <AuthError>{error}</AuthError> : null}

            <div className="mt-1 flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => {
                  setForgotEmail(emailRef.current?.value ?? "");
                  setView("forgot");
                }}
                className={`inline-flex min-h-11 items-center self-start text-[15px] ${authLink}`}
              >
                Parolamı unuttum
              </button>
              <SubmitButton pending={pending} idle="Giriş yap" busy="Giriş yapılıyor…" className="max-sm:w-full" />
            </div>
          </form>
        </>
      )}
    </div>
  );
}

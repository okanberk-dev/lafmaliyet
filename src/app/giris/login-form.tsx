"use client";

import { ArrowLeft, CircleCheck, Eye, EyeOff, KeyRound, Loader2, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { useSearchParams } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";

import { useCalmMotion } from "@/components/ui/motion";
import { LafTile } from "@/components/brand";
import { SPRING_PRESS, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { takeLoginEmail } from "@/app/davet/keys";
import { cancelLoginCodeAction, loginAction, verifyLoginCodeAction, type LoginState, type TotpState } from "@/server/actions/auth";
import { requestPasswordReset, type ForgotState } from "@/server/actions/invites";

/**
 * AkmanOS "Login Card" (src/components/akmanos/login-card) düzeni ve hareketleri, panelin sunucu eylemiyle:
 * zinc-100 kart, beyaz alanlar, sırayla beliren satırlar, parola göster/gizle, siyah gönder düğmesi.
 * Sosyal giriş, "beni hatırla" ve kayıt bağlantısı panelde olmadığı için çıkarıldı. "Parolamı unuttum" aynı kartta
 * ayrı bir adım: e-posta istenir, yanıt her durumda aynıdır (hesabın var olup olmadığı anlaşılmaz).
 */
const STAGGER: Variants = { hidden: {}, visible: { transition: { staggerChildren: 0.07, delayChildren: 0.08 } } };
const ITEM: Variants = {
  hidden: { opacity: 0, y: 14, filter: "blur(6px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)", transition: SPRING_SWAP },
};

function Row({ children }: { children: ReactNode }) {
  return <motion.div variants={ITEM}>{children}</motion.div>;
}

// Telefonda 16px yazı: iOS alana odaklanınca sayfayı yakınlaştırmaz
const input =
  "h-11 w-full rounded-xl bg-chart-metric-bg px-3 text-base text-foreground sm:text-sm outline-none placeholder:text-chart-muted ring-1 ring-black/[0.06] ring-inset transition-[background-color,box-shadow] focus:bg-chart-bg focus:ring-2 focus:ring-foreground/15 pointer-coarse:h-12";
/** Solunda simge olan alan */
const withIcon = `${input} pl-10`;

/** Alanın solundaki simge (tıklamayı alana bırakır) */
function FieldIcon({ children }: { children: ReactNode }) {
  return <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-chart-muted [&_svg]:size-4">{children}</span>;
}

function SubmitButton({ pending, idle, busy, reduce }: { pending: boolean; idle: string; busy: string; reduce: boolean }) {
  return (
    <motion.button
      type="submit"
      disabled={pending}
      whileHover={reduce || pending ? undefined : { y: -1 }}
      whileTap={reduce || pending ? undefined : { scale: 0.97 }}
      transition={SPRING_PRESS}
      className="flex h-11 min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-foreground text-sm font-semibold text-background disabled:opacity-60"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={pending ? "loading" : "idle"}
          initial={reduce ? false : { opacity: 0, y: 8, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={reduce ? undefined : { opacity: 0, y: -6, filter: "blur(4px)" }}
          transition={reduce ? { duration: 0 } : SPRING_SWAP}
          className="flex items-center gap-2"
        >
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {pending ? busy : idle}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

function ErrorText({ children, reduce }: { children: ReactNode; reduce: boolean }) {
  return (
    <motion.p
      role="alert"
      initial={reduce ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? undefined : { opacity: 0 }}
      className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-600"
    >
      {children}
    </motion.p>
  );
}

/** İkinci adım: doğrulama uygulamasındaki kod ya da kurtarma kodu */
function CodeStep({ email, onBack, onExpired, reduce }: { email?: string; onBack: () => void; onExpired: (message: string) => void; reduce: boolean }) {
  const [state, action, pending] = useActionState<TotpState, FormData>(verifyLoginCodeAction, {});
  const [mode, setMode] = useState<"app" | "recovery">("app");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.expired) onExpired(state.error ?? "Süre doldu, yeniden giriş yapın.");
  }, [state, onExpired]);
  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-xl bg-chart-metric-bg px-3 py-3 text-sm text-chart-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden />
        <p>
          {mode === "app" ? "Doğrulama uygulamanızdaki 6 haneli kodu girin" : "Kaydettiğiniz kurtarma kodlarından birini girin (her kod bir kez çalışır)"}
          {email ? (
            <>
              {" "}
              · <span className="font-medium text-foreground">{email}</span>
            </>
          ) : null}
        </p>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-chart-muted">{mode === "app" ? "Doğrulama kodu" : "Kurtarma kodu"}</span>
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
            className={`${input} text-center font-mono text-lg tracking-[0.35em] sm:text-lg`}
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
            className={`${input} text-center font-mono tracking-wider`}
          />
        )}
      </label>
      <AnimatePresence>{state.error && !state.expired ? <ErrorText reduce={reduce}>{state.error}</ErrorText> : null}</AnimatePresence>
      <SubmitButton pending={pending} idle="Doğrula ve gir" busy="Doğrulanıyor…" reduce={reduce} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button type="button" onClick={onBack} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-1 text-chart-muted hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> Geri
        </button>
        <button
          type="button"
          onClick={() => setMode((m) => (m === "app" ? "recovery" : "app"))}
          className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-1 font-medium text-foreground hover:underline"
        >
          <KeyRound className="size-4" aria-hidden />
          {mode === "app" ? "Telefonum yanımda değil" : "Uygulama kodunu kullan"}
        </button>
      </div>
    </form>
  );
}

/**
 * "Parolamı unuttum": e-posta → genel yanıt. Sunucuda e-posta gönderimi kapalıysa (RESEND_API_KEY yok) form hiç
 * gösterilmez; baştan yöneticiye başvurması söylenir (bağlantı gönderilecekmiş gibi vaat edilmez).
 */
function ForgotStep({ defaultEmail, onBack, reduce, emailConfigured }: { defaultEmail: string; onBack: () => void; reduce: boolean; emailConfigured: boolean }) {
  const [state, action, pending] = useActionState<ForgotState, FormData>(requestPasswordReset, {});
  const backButton = (
    <button type="button" onClick={onBack} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 self-start rounded-lg px-1 text-sm text-chart-muted hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden /> Girişe dön
    </button>
  );
  if (!emailConfigured) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="flex items-start gap-2.5 rounded-xl bg-chart-metric-bg px-3 py-3 text-sm leading-6 text-foreground">
          <KeyRound className="mt-1 size-4 shrink-0" aria-hidden />
          <span>
            Bu panelde e-posta gönderimi kapalı. Parolanızı yenilemek için yöneticinize başvurun; size WhatsApp ya da e-postayla tek kullanımlık bir
            sıfırlama bağlantısı iletebilir.
          </span>
        </p>
        {backButton}
      </div>
    );
  }
  if (state.message) {
    return (
      <div className="flex flex-col gap-4">
        <motion.p
          role="status"
          initial={reduce ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex items-start gap-2.5 rounded-xl px-3 py-3 text-sm leading-6 ${state.tone === "ok" ? "bg-lime/25 text-good-ink" : "bg-chart-metric-bg text-foreground"}`}
        >
          {state.tone === "ok" ? <Mail className="mt-1 size-4 shrink-0" aria-hidden /> : <KeyRound className="mt-1 size-4 shrink-0" aria-hidden />}
          <span>{state.message}</span>
        </motion.p>
        {backButton}
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-sm leading-6 text-chart-muted">Giriş e-postanızı yazın. Kayıtlıysa parolanızı yenilemeniz için bir bağlantı gönderilir.</p>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-chart-muted">E-posta</span>
        <input
          type="email"
          name="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="email"
          autoFocus
          required
          defaultValue={defaultEmail}
          placeholder="ornek@laffogato.net"
          className={input}
        />
      </label>
      <AnimatePresence>{state.error ? <ErrorText reduce={reduce}>{state.error}</ErrorText> : null}</AnimatePresence>
      <SubmitButton pending={pending} idle="Bağlantı gönder" busy="Gönderiliyor…" reduce={reduce} />
      {backButton}
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
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  const reduce = useCalmMotion() ?? false;
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
    void cancelLoginCodeAction();
  }

  return (
    <motion.div
      data-component="login-card"
      className="w-full max-w-[400px] rounded-3xl bg-chart-card-bg p-5 shadow-[0_24px_60px_-28px_rgb(12_59_45/0.45)] ring-1 ring-black/[0.05] sm:p-6 lg:shadow-[0_24px_60px_-32px_rgb(0_0_0/0.25)]"
      initial={reduce ? false : { opacity: 0, y: 20, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduce ? { duration: 0 } : SPRING_SWAP}
    >
      <motion.div className="flex flex-col gap-6" variants={STAGGER} initial={reduce ? false : "hidden"} animate="visible">
        <Row>
          <header className="flex items-center gap-3">
            <motion.span
              className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-chart-metric-bg"
              aria-hidden
              initial={reduce ? false : { scale: 0.6, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={reduce ? { duration: 0 } : SPRING_PRESS}
            >
              <LafTile className="size-8 rounded-[10px]" />
            </motion.span>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight text-foreground">
                {codeStep ? "İki adımlı doğrulama" : view === "forgot" ? "Parolamı unuttum" : "Tekrar hoş geldiniz"}
              </h1>
              <p className="text-sm text-chart-muted">{codeStep ? "Son bir adım kaldı" : view === "forgot" ? "Parola sıfırlama bağlantısı" : "L'Affogato yönetim paneline giriş"}</p>
            </div>
          </header>
        </Row>

        {codeStep ? (
          <CodeStep email={state.email} onBack={() => back()} onExpired={back} reduce={reduce} />
        ) : view === "forgot" ? (
          <ForgotStep defaultEmail={forgotEmail} onBack={() => setView("login")} reduce={reduce} emailConfigured={emailConfigured} />
        ) : (
          <form action={action} className="flex flex-col gap-4">
            <input type="hidden" name="next" value={next} />
            {passwordSet && !state.error ? (
              <p role="status" className="flex items-start gap-2.5 rounded-xl bg-lime/25 px-3 py-2.5 text-sm leading-6 text-good-ink">
                <CircleCheck className="mt-1 size-4 shrink-0" aria-hidden />
                <span>Parolanız kaydedildi. E-postanız ve yeni parolanızla giriş yapın.</span>
              </p>
            ) : null}
            <Row>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-chart-muted">E-posta</span>
                <span className="relative">
                  <FieldIcon>
                    <Mail />
                  </FieldIcon>
                  <motion.input
                    ref={emailRef}
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
                    placeholder="ornek@laffogato.net"
                    className={withIcon}
                  />
                </span>
              </label>
            </Row>
            <Row>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-chart-muted">Parola</span>
                <div className="relative">
                  <FieldIcon>
                    <LockKeyhole />
                  </FieldIcon>
                  <motion.input
                    ref={passwordRef}
                    type={show ? "text" : "password"}
                    name="password"
                    autoComplete="current-password"
                    autoFocus={Boolean(state.email)}
                    onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))}
                    onBlur={() => setCaps(false)}
                    aria-describedby={caps ? "caps-warning" : undefined}
                    required
                    placeholder="Parolanız"
                    className={`${withIcon} pr-11`}
                  />
                  <motion.button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    whileTap={reduce ? undefined : { scale: 0.9 }}
                    whileHover={reduce ? undefined : { scale: 1.06 }}
                    className="absolute top-1/2 right-0 flex size-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-chart-muted transition-colors hover:text-foreground"
                    aria-label={show ? "Parolayı gizle" : "Parolayı göster"}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={show ? "hide" : "show"}
                        initial={reduce ? false : { opacity: 0, rotate: -90, scale: 0.6 }}
                        animate={{ opacity: 1, rotate: 0, scale: 1 }}
                        exit={reduce ? undefined : { opacity: 0, rotate: 90, scale: 0.6 }}
                        transition={reduce ? { duration: 0 } : SPRING_PRESS}
                        className="flex items-center justify-center"
                      >
                        {show ? <EyeOff className="size-4" strokeWidth={2} /> : <Eye className="size-4" strokeWidth={2} />}
                      </motion.span>
                    </AnimatePresence>
                  </motion.button>
                </div>
                {caps ? (
                  <span id="caps-warning" role="status" className="text-xs font-medium text-warn">
                    Caps Lock açık
                  </span>
                ) : null}
              </label>
              <div className="mt-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setForgotEmail(emailRef.current?.value ?? "");
                    setView("forgot");
                  }}
                  className="-mr-1 inline-flex min-h-11 cursor-pointer items-center rounded-lg px-1 text-sm font-medium text-foreground hover:underline"
                >
                  Parolamı unuttum
                </button>
              </div>
            </Row>

            <AnimatePresence>{error ? <ErrorText reduce={reduce}>{error}</ErrorText> : null}</AnimatePresence>

            <Row>
              <SubmitButton pending={pending} idle="Giriş yap" busy="Giriş yapılıyor…" reduce={reduce} />
            </Row>
          </form>
        )}

      </motion.div>
    </motion.div>
  );
}

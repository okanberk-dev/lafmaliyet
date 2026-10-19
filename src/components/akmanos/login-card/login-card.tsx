"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Variants,
} from "motion/react";
import { cn } from "@/components/akmanos/lib/cn";
import { SPRING_PRESS, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import {
  LOGIN_DIVIDER_LABEL,
  LOGIN_EMAIL_LABEL,
  LOGIN_EMAIL_PLACEHOLDER,
  LOGIN_FORGOT_LABEL,
  LOGIN_PASSWORD_LABEL,
  LOGIN_PASSWORD_PLACEHOLDER,
  LOGIN_REMEMBER_LABEL,
  LOGIN_SIGNUP_LABEL,
  LOGIN_SIGNUP_PROMPT,
  LOGIN_SOCIAL_PROVIDERS,
  LOGIN_SUBMIT_LABEL,
  LOGIN_SUBTITLE,
  LOGIN_TITLE,
  type LoginSocialProviderId,
} from "./constants";

export type LoginCardProps = {
  title?: string;
  subtitle?: string;
  className?: string;
  defaultEmail?: string;
  loading?: boolean;
  onSubmit?: (payload: {
    email: string;
    password: string;
    remember: boolean;
  }) => void;
  onForgotPassword?: () => void;
  onSignUp?: () => void;
  onSocialLogin?: (provider: LoginSocialProviderId) => void;
};

const STAGGER_CONTAINER: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.08,
    },
  },
};

const STAGGER_ITEM: Variants = {
  hidden: { opacity: 0, y: 14, filter: "blur(6px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: SPRING_SWAP,
  },
};

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden>
      <path
        d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.39.6.11.82-.26.82-.58 0-.29-.01-1.07-.01-2.08-3.34.73-4.03-1.42-4.03-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.49 1 .11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.66 1.65.24 2.87.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.61-2.8 5.37-5.48 5.66.43.37.81 1.1.81 2.22 0 1.6-.01 2.88-.01 3.27 0 .32.21.7.82.58A12 12 0 0 0 24 12c0-6.63-5.37-12-12-12z"
      />
    </svg>
  );
}

function SocialIcon({ provider }: { provider: LoginSocialProviderId }) {
  if (provider === "google") {
    return <GoogleMark />;
  }

  return <GitHubMark />;
}

function Stagger({
  reduceMotion,
  children,
  className,
}: {
  reduceMotion: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      variants={STAGGER_CONTAINER}
      initial={reduceMotion ? false : "hidden"}
      animate="visible"
    >
      {children}
    </motion.div>
  );
}

function StaggerChild({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div className={className} variants={STAGGER_ITEM}>
      {children}
    </motion.div>
  );
}

export function LoginCard({
  title = LOGIN_TITLE,
  subtitle = LOGIN_SUBTITLE,
  className,
  defaultEmail = "",
  loading = false,
  onSubmit,
  onForgotPassword,
  onSignUp,
  onSocialLogin,
}: LoginCardProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isBusy = loading || submitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = { email, password, remember };

    if (onSubmit) {
      onSubmit(payload);
      return;
    }

    setSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 1400));
    setSubmitting(false);
  }

  return (
    <motion.div
      data-component="login-card"
      className={cn(
        "w-full max-w-[400px] rounded-3xl bg-chart-card-bg p-5 sm:p-6",
        className,
      )}
      initial={reduceMotion ? false : { opacity: 0, y: 20, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion ? { duration: 0 } : SPRING_SWAP}
    >
      <Stagger reduceMotion={reduceMotion} className="flex flex-col gap-6">
        <StaggerChild>
          <header className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <motion.span
                className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-chart-metric-bg"
                aria-hidden
                initial={reduceMotion ? false : { scale: 0.6, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={reduceMotion ? { duration: 0 } : SPRING_PRESS}
              >
                <motion.span
                  className="size-2.5 rounded-full bg-[#c0f21e]"
                  animate={
                    reduceMotion
                      ? undefined
                      : { scale: [1, 1.18, 1], opacity: [1, 0.82, 1] }
                  }
                  transition={
                    reduceMotion
                      ? undefined
                      : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
                  }
                />
              </motion.span>
              <div className="min-w-0">
                <h1 className="text-lg font-semibold tracking-tight text-foreground">
                  {title}
                </h1>
                <p className="text-sm text-chart-muted">{subtitle}</p>
              </div>
            </div>
          </header>
        </StaggerChild>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <StaggerChild>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-chart-muted">
                {LOGIN_EMAIL_LABEL}
              </span>
              <motion.input
                type="email"
                name="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={LOGIN_EMAIL_PLACEHOLDER}
                whileFocus={
                  reduceMotion ? undefined : { scale: 1.01, y: -1 }
                }
                transition={SPRING_PRESS}
                className="h-11 w-full rounded-xl bg-chart-metric-bg px-3 text-sm text-foreground outline-none placeholder:text-chart-muted transition-colors focus:bg-chart-bg"
              />
            </label>
          </StaggerChild>

          <StaggerChild>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-chart-muted">
                {LOGIN_PASSWORD_LABEL}
              </span>
              <div className="relative">
                <motion.input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={LOGIN_PASSWORD_PLACEHOLDER}
                  whileFocus={
                    reduceMotion ? undefined : { scale: 1.01, y: -1 }
                  }
                  transition={SPRING_PRESS}
                  className="h-11 w-full rounded-xl bg-chart-metric-bg px-3 pr-11 text-sm text-foreground outline-none placeholder:text-chart-muted transition-colors focus:bg-chart-bg"
                />
                <motion.button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  whileTap={reduceMotion ? undefined : { scale: 0.9 }}
                  whileHover={reduceMotion ? undefined : { scale: 1.06 }}
                  className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-chart-muted transition-colors hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={showPassword ? "hide" : "show"}
                      initial={
                        reduceMotion
                          ? false
                          : { opacity: 0, rotate: -90, scale: 0.6 }
                      }
                      animate={{ opacity: 1, rotate: 0, scale: 1 }}
                      exit={
                        reduceMotion
                          ? undefined
                          : { opacity: 0, rotate: 90, scale: 0.6 }
                      }
                      transition={
                        reduceMotion ? { duration: 0 } : SPRING_PRESS
                      }
                      className="flex items-center justify-center"
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" strokeWidth={2} />
                      ) : (
                        <Eye className="size-4" strokeWidth={2} />
                      )}
                    </motion.span>
                  </AnimatePresence>
                </motion.button>
              </div>
            </label>
          </StaggerChild>

          <StaggerChild>
            <div className="flex items-center justify-between gap-3">
              <label className="flex min-h-11 items-center gap-2 text-sm text-chart-muted">
                <motion.input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  whileTap={reduceMotion ? undefined : { scale: 0.88 }}
                  className="size-4 rounded accent-foreground"
                />
                {LOGIN_REMEMBER_LABEL}
              </label>
              <motion.button
                type="button"
                onClick={onForgotPassword}
                whileHover={reduceMotion ? undefined : { y: -1 }}
                whileTap={reduceMotion ? undefined : { scale: 0.96 }}
                className="min-h-11 text-sm font-medium text-foreground"
              >
                {LOGIN_FORGOT_LABEL}
              </motion.button>
            </div>
          </StaggerChild>

          <StaggerChild>
            <motion.button
              type="submit"
              disabled={isBusy}
              whileHover={reduceMotion || isBusy ? undefined : { y: -1 }}
              whileTap={reduceMotion || isBusy ? undefined : { scale: 0.97 }}
              transition={SPRING_PRESS}
              className="flex h-11 min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-foreground text-sm font-semibold text-background disabled:opacity-60"
            >
              <AnimatePresence mode="wait" initial={false}>
                {isBusy ? (
                  <motion.span
                    key="loading"
                    initial={
                      reduceMotion ? false : { opacity: 0, y: 8, filter: "blur(4px)" }
                    }
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={
                      reduceMotion
                        ? undefined
                        : { opacity: 0, y: -6, filter: "blur(4px)" }
                    }
                    transition={reduceMotion ? { duration: 0 } : SPRING_SWAP}
                    className="flex items-center gap-2"
                  >
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Signing in…
                  </motion.span>
                ) : (
                  <motion.span
                    key="idle"
                    initial={
                      reduceMotion ? false : { opacity: 0, y: 8, filter: "blur(4px)" }
                    }
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={
                      reduceMotion
                        ? undefined
                        : { opacity: 0, y: -6, filter: "blur(4px)" }
                    }
                    transition={reduceMotion ? { duration: 0 } : SPRING_SWAP}
                  >
                    {LOGIN_SUBMIT_LABEL}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          </StaggerChild>
        </form>

        <StaggerChild>
          <div className="flex flex-col gap-4">
            <p className="text-center text-xs text-chart-muted">
              {LOGIN_DIVIDER_LABEL}
            </p>

            <div className="grid grid-cols-2 gap-2">
              {LOGIN_SOCIAL_PROVIDERS.map((provider, index) => (
                <motion.button
                  key={provider.id}
                  type="button"
                  onClick={() => onSocialLogin?.(provider.id)}
                  initial={
                    reduceMotion
                      ? false
                      : { opacity: 0, y: 10, scale: 0.94 }
                  }
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { ...SPRING_SWAP, delay: 0.42 + index * 0.08 }
                  }
                  whileHover={reduceMotion ? undefined : { y: -2, scale: 1.02 }}
                  whileTap={reduceMotion ? undefined : { scale: 0.96 }}
                  className="flex h-11 min-h-11 items-center justify-center gap-2 rounded-xl bg-chart-metric-bg text-sm font-medium text-foreground transition-colors hover:bg-chart-bg"
                >
                  <SocialIcon provider={provider.id} />
                  {provider.label}
                </motion.button>
              ))}
            </div>
          </div>
        </StaggerChild>

        <StaggerChild>
          <p className="text-center text-sm text-chart-muted">
            {LOGIN_SIGNUP_PROMPT}{" "}
            <motion.button
              type="button"
              onClick={onSignUp}
              whileHover={reduceMotion ? undefined : { y: -1 }}
              whileTap={reduceMotion ? undefined : { scale: 0.96 }}
              className="font-semibold text-foreground"
            >
              {LOGIN_SIGNUP_LABEL}
            </motion.button>
          </p>
        </StaggerChild>
      </Stagger>
    </motion.div>
  );
}

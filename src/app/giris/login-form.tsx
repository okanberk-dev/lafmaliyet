"use client";

import { Eye, EyeOff, Loader2 } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { useSearchParams } from "next/navigation";
import { useActionState, useState, type ReactNode } from "react";

import { useCalmMotion } from "@/components/ui/motion";
import { LafTile } from "@/components/brand";
import { SPRING_PRESS, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { loginAction, type LoginState } from "@/server/actions/auth";

/**
 * AkmanOS "Login Card" (src/components/akmanos/login-card) düzeni ve hareketleri, panelin sunucu eylemiyle:
 * zinc-100 kart, beyaz alanlar, sırayla beliren satırlar, parola göster/gizle, siyah gönder düğmesi.
 * Sosyal giriş, "beni hatırla" ve kayıt bağlantısı panelde olmadığı için çıkarıldı.
 */
const STAGGER: Variants = { hidden: {}, visible: { transition: { staggerChildren: 0.07, delayChildren: 0.08 } } };
const ITEM: Variants = {
  hidden: { opacity: 0, y: 14, filter: "blur(6px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)", transition: SPRING_SWAP },
};

function Row({ children }: { children: ReactNode }) {
  return <motion.div variants={ITEM}>{children}</motion.div>;
}

const input =
  "h-11 w-full rounded-xl bg-chart-metric-bg px-3 text-sm text-foreground outline-none placeholder:text-chart-muted transition-colors focus:bg-chart-bg focus:ring-2 focus:ring-foreground/10";

export function LoginForm() {
  const next = useSearchParams().get("next") ?? "";
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  const reduce = useCalmMotion() ?? false;
  const [show, setShow] = useState(false);

  return (
    <motion.div
      data-component="login-card"
      className="w-full max-w-[400px] rounded-3xl bg-chart-card-bg p-5 sm:p-6"
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
              <h1 className="text-lg font-semibold tracking-tight text-foreground">Tekrar hoş geldiniz</h1>
              <p className="text-sm text-chart-muted">L&apos;Affogato yönetim paneline giriş</p>
            </div>
          </header>
        </Row>

        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          <Row>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-chart-muted">E-posta</span>
              <motion.input
                type="email"
                name="email"
                autoComplete="username"
                required
                defaultValue={state.email}
                placeholder="ornek@laffogato.net"
                whileFocus={reduce ? undefined : { scale: 1.01, y: -1 }}
                transition={SPRING_PRESS}
                className={input}
              />
            </label>
          </Row>
          <Row>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-chart-muted">Parola</span>
              <div className="relative">
                <motion.input
                  type={show ? "text" : "password"}
                  name="password"
                  autoComplete="current-password"
                  required
                  placeholder="Parolanız"
                  whileFocus={reduce ? undefined : { scale: 1.01, y: -1 }}
                  transition={SPRING_PRESS}
                  className={`${input} pr-11`}
                />
                <motion.button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  whileTap={reduce ? undefined : { scale: 0.9 }}
                  whileHover={reduce ? undefined : { scale: 1.06 }}
                  className="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-chart-muted transition-colors hover:text-foreground"
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
            </label>
          </Row>

          <AnimatePresence>
            {state.error ? (
              <motion.p
                role="alert"
                initial={reduce ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0 }}
                className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-600"
              >
                {state.error}
              </motion.p>
            ) : null}
          </AnimatePresence>

          <Row>
            <motion.button
              type="submit"
              disabled={pending}
              whileHover={reduce || pending ? undefined : { y: -1 }}
              whileTap={reduce || pending ? undefined : { scale: 0.97 }}
              transition={SPRING_PRESS}
              className="flex h-11 min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-foreground text-sm font-semibold text-background disabled:opacity-60"
            >
              <AnimatePresence mode="wait" initial={false}>
                {pending ? (
                  <motion.span
                    key="loading"
                    initial={reduce ? false : { opacity: 0, y: 8, filter: "blur(4px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={reduce ? undefined : { opacity: 0, y: -6, filter: "blur(4px)" }}
                    transition={reduce ? { duration: 0 } : SPRING_SWAP}
                    className="flex items-center gap-2"
                  >
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Giriş yapılıyor…
                  </motion.span>
                ) : (
                  <motion.span
                    key="idle"
                    initial={reduce ? false : { opacity: 0, y: 8, filter: "blur(4px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={reduce ? undefined : { opacity: 0, y: -6, filter: "blur(4px)" }}
                    transition={reduce ? { duration: 0 } : SPRING_SWAP}
                  >
                    Giriş yap
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          </Row>
        </form>

        <Row>
          <p className="text-center text-sm text-chart-muted">
            Kafenin sitesi:{" "}
            <a href="https://laffogato.net" className="font-medium text-foreground hover:underline">
              laffogato.net
            </a>
          </p>
        </Row>
      </motion.div>
    </motion.div>
  );
}

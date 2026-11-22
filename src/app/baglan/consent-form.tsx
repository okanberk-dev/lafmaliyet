"use client";

import { Ban, Eye, EyeOff, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import { AuthError, AuthHeading, authButton, authCard, FloatingField } from "@/app/giris/auth-ui";
import { actionErrorText, useActionTransition } from "@/components/ui/action-error";
import type { ConsentText, Rich } from "@/lib/mcp/oauth";
import { approveConnection, denyConnection } from "@/server/actions/mcp";

/*
 * Onay kartı: isteğin geldiği adres, Claude'un neler yapabileceği, hesap, süre, uyarılar ve parola. "İzin ver" kodu
 * alır, "Reddet" reddi; ikisinde de kart "Claude'a dönülüyor…" der ve tarayıcı Claude'un dönüş adresine geçer (geri
 * tuşu bu sayfaya dönmesin diye replace). Bu sayfada pencere (dialog) yok.
 */

const secondaryButton =
  "inline-flex h-12 min-w-36 cursor-pointer items-center justify-center gap-2 rounded-full border-2 border-[#00754A] dark:border-good bg-white px-7 text-base font-semibold text-[#00754A] dark:text-good transition-[background-color,transform] hover:bg-[#00754A]/[0.06] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60";

function Strong({ parts }: { parts: Rich }) {
  return (
    <>
      {parts[0]}
      <strong className="font-semibold text-black/90">{parts[1]}</strong>
      {parts[2]}
    </>
  );
}

function Leaving({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-center gap-3 py-6 text-[17px] font-semibold text-black/80">
      <Loader2 className="size-5 shrink-0 animate-spin text-[#00754A] dark:text-good" aria-hidden />
      {text}
    </p>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 rounded-lg bg-[#fff7e6] dark:bg-warn-soft px-4 py-3 text-sm leading-6 text-[#8a5300] dark:text-warn-ink">
      <TriangleAlert className="mt-1 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** Personel ya da bağlantı tavanı: yalnız "Reddet ve Claude'a dön" */
export function DenyButton({ istek, label }: { istek: string; label: string }) {
  const [pending, start] = useActionTransition();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (leaving) return <Leaving text="Reddedildi. Claude'a dönülüyor…" />;
  return (
    <div className="flex flex-col gap-3">
      {error ? <AuthError>{error}</AuthError> : null}
      <button
        type="button"
        disabled={pending}
        className={`${secondaryButton} max-sm:w-full`}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await denyConnection({ istek });
            if (!res.ok) return setError(res.error);
            setLeaving(true);
            window.location.replace(res.data.redirectTo);
          })
        }
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {label}
      </button>
    </div>
  );
}

export function ConsentForm({ istek, text }: { istek: string; text: ConsentText }) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [, start] = useActionTransition();

  function go(kind: "approve" | "deny") {
    setError(null);
    setBusy(kind);
    start(async () => {
      let res: Awaited<ReturnType<typeof approveConnection>> | Awaited<ReturnType<typeof denyConnection>>;
      try {
        res = kind === "approve" ? await approveConnection({ istek, password }) : await denyConnection({ istek });
      } catch (e) {
        // Ağ kesildi ya da panel güncellendi (E-51): düğmeler bırakılır, nedeni formda
        setBusy(null);
        setError(actionErrorText(e));
        return;
      }
      if (!res.ok) {
        setBusy(null);
        setError(res.error);
        return;
      }
      setLeaving(kind === "approve" ? "Claude'a dönülüyor…" : "Reddedildi. Claude'a dönülüyor…");
      window.location.replace(res.data.redirectTo);
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    go("approve");
  }

  return (
    <div className={authCard}>
      <AuthHeading title={text.title} subtitle={<Strong parts={text.from} />} />
      {leaving ? (
        <Leaving text={leaving} />
      ) : (
        <div className="flex flex-col gap-5">
          {text.selfName ? <p className="-mt-3 text-sm leading-6 break-words text-black/55">{text.selfName}</p> : null}
          <section className="rounded-lg bg-[#f2f0eb] dark:bg-surface p-4 text-[15px] leading-6 text-black/80" aria-labelledby="claude-can">
            <h2 id="claude-can" className="font-semibold text-black/90">
              {text.abilitiesTitle}
            </h2>
            <ul className="mt-2 flex flex-col gap-2">
              {text.abilities.map((line, i) => {
                const Icon = [Eye, Ban, ShieldCheck][i];
                return (
                  <li key={line} className="flex items-start gap-2.5">
                    <Icon className="mt-1 size-4 shrink-0 text-[#00754A] dark:text-good" aria-hidden="true" />
                    <span>{line}</span>
                  </li>
                );
              })}
            </ul>
          </section>
          <div className="flex flex-col gap-1.5 text-[15px] leading-6 text-black/70">
            <p className="break-words">
              Hesap: <strong className="font-semibold text-black/90">{text.account.name}</strong> <span className="break-all">({text.account.email})</span>
            </p>
            <p>
              <Strong parts={text.validity} />
            </p>
          </div>
          <Notice>
            <Strong parts={text.warning} />
          </Notice>
          {text.loopbackWarning ? <Notice>{text.loopbackWarning}</Notice> : null}
          {text.totpHint ? <p className="-mt-2 text-sm text-black/55">{text.totpHint}</p> : null}
          <form onSubmit={submit} className="flex flex-col gap-5">
            {/* Parola yöneticisi alanı doğru hesaba bağlasın */}
            <input type="hidden" name="username" autoComplete="username" value={text.account.email} readOnly />
            <FloatingField
              id="password"
              label="Parolanız"
              type={show ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "consent-error" : undefined}
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
            {error ? (
              <div id="consent-error">
                <AuthError>{error}</AuthError>
              </div>
            ) : null}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" disabled={busy !== null} onClick={() => go("deny")} className={`${secondaryButton} max-sm:w-full`}>
                {busy === "deny" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Reddet
              </button>
              <button type="submit" disabled={busy !== null} className={`${authButton} max-sm:w-full`}>
                {busy === "approve" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {busy === "approve" ? "Bekleyin…" : "İzin ver"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

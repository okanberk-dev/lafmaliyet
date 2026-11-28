"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useActionState, useState } from "react";

import { AuthError, AuthHeading, authButton, authCard, authLink, FloatingField, FloatingPasswordField } from "@/app/giris/auth-ui";
import { CodeStep } from "@/app/giris/login-form";
import { catchingFormAction } from "@/components/ui/action-error";
import { yonetimGirisAction, yonetimKodAction, yonetimKodVazgecAction, type YonetimGirisState } from "@/server/actions/yonetim-giris";

/**
 * Yönetim konsolunun giriş kartı (docs/planlar/yonetim-konsolu.md › Kim girer): e-posta ve parola, iki adımlı açıksa
 * kod adımı (panelin CodeStep'i, konsolun eylemiyle). Yanlış hesabın yanıtı kayıtsız e-postanınkiyle aynı; "yalnız asıl
 * yönetici" sayfada sabit metin. "Parolamı unuttum" ve "ladmin" bağlantıları panelin adresinden (APP_URL) gelir.
 */

const giris = catchingFormAction(yonetimGirisAction, (fd: FormData) => ({ email: String(fd.get("email") ?? "") }));
const kod = catchingFormAction(yonetimKodAction);

export function YonetimGirisForm({ parolaUnuttum, ladminGiris }: { parolaUnuttum: string; ladminGiris: string }) {
  const params = useSearchParams();
  const expired = params.get("oturum") === "bitti";
  const [state, action, pending] = useActionState<YonetimGirisState, FormData>(giris, {});
  // Kod adımından "Geri" denince aynı sonuç yeniden kod adımı açmasın
  const [left, setLeft] = useState<YonetimGirisState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const codeStep = state.step === "totp" && left !== state;
  const error = codeStep ? null : left === state ? notice : (state.error ?? (expired && !state.email ? "Oturumunuz sona erdi, yeniden giriş yapın." : null));

  function back(message?: string) {
    setLeft(state);
    setNotice(message ?? null);
    yonetimKodVazgecAction().catch(() => undefined);
  }

  return (
    <div data-component="yonetim-giris" className={authCard}>
      {codeStep ? (
        <>
          <AuthHeading title="İki adımlı doğrulama" subtitle="Son bir adım kaldı." />
          <CodeStep email={state.email} onBack={() => back()} onExpired={back} verifyAction={kod} />
        </>
      ) : (
        <>
          <AuthHeading title="Yönetim konsolu" subtitle="Şubeler, kasalar ve lisans" />
          <div className="mb-5 flex flex-col gap-1.5 rounded-lg bg-black/[0.04] px-4 py-3 text-[15px] leading-6 text-black/75">
            <p className="flex items-start gap-2.5">
              <ShieldCheck className="mt-1 size-4 shrink-0 text-[#00754A] dark:text-good" aria-hidden />
              <span>Bu adres yalnız asıl yöneticinin.</span>
            </p>
            <p className="pl-6.5">İlk girişte yeni cihaz e-postası gelebilir.</p>
          </div>
          <form action={action} className="flex flex-col gap-5">
            <FloatingField
              id="yonetim-email"
              label="* E-posta"
              type="email"
              name="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="email"
              autoFocus={!state.email}
              required
              defaultValue={state.email}
            />
            <FloatingPasswordField id="yonetim-password" label="* Parola" name="password" autoComplete="current-password" autoFocus={Boolean(state.email)} required />
            {error ? (
              <AuthError>
                {error}
                {state.kurulum && left !== state ? (
                  <>
                    {" "}
                    <a href={ladminGiris} className={authLink}>
                      ladmin girişi
                    </a>
                  </>
                ) : null}
              </AuthError>
            ) : null}
            <div className="mt-1 flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
              <a href={parolaUnuttum} className={`inline-flex min-h-11 items-center self-start text-[15px] ${authLink}`}>
                Parolamı unuttum
              </a>
              <button type="submit" disabled={pending} className={`${authButton} max-sm:w-full`}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {pending ? "Giriş yapılıyor…" : "Giriş yap"}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

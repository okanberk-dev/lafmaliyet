"use client";

import { Check, CircleCheck, Copy, Download, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";

import { forgetDeviceOnSignOut } from "@/components/panel/live/push-client";
import { actionErrorText, useActionTransition } from "@/components/ui/action-error";
import { ADMIN_2FA_REQUIRED_TEXT } from "@/lib/admin-security";
import { forgetAssistantData } from "@/lib/assistant/history";
import { isSetupEnded } from "@/lib/two-factor-setup";
import { beginTotpSetup, cancelTotpSetup, confirmTotpSetup, logoutAction } from "@/server/actions/auth";

import { AuthError, AuthHeading, authButton, authCard, authInput, authLink, FloatingPasswordField } from "../auth-ui";

type Setup = { qr: string; secret: string; uri: string };
type Step = { at: "start" } | { at: "scan"; setup: Setup } | { at: "codes"; codes: string[] };

/** Tarayıcı deposu (kapalıysa null: gizli sekme, engelli site verisi) */
function safeStore(kind: "localStorage" | "sessionStorage"): Storage | null {
  try {
    return window[kind];
  } catch {
    return null;
  }
}

/**
 * Zorunlu iki adımlı kurulum (yönetici; src/lib/admin-security.ts). Hesabım'daki kurulumla aynı sunucu eylemleri ve
 * aynı sınırlar (parolayla başlar, 15 dakika, 5 hatalı kod; src/lib/two-factor-setup.ts), giriş kartının görünümüyle:
 * parola → QR'ı okut, kodu gir → kurtarma kodlarını sakla → panele geç. `enabled`: iki adımlı zaten açık (kurulum az
 * önce bitti ya da sayfa sonradan açıldı); kodlar ekrandaysa onlar, değilse yalnız "panele geç" gösterilir. Eylem
 * atarsa (bağlantı koptu, panel güncellendi) kart hata ekranına düşmez, neden kartın kendi hata satırında görünür.
 */
export function TwoFactorSetup({ userId, email, enabled, next }: { userId: number; email: string; enabled: boolean; next: string }) {
  const [step, setStep] = useState<Step>({ at: "start" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startAction] = useActionTransition();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);

  /** Eylemi kartın içinde bekler: atılan hata (ağ, eski sayfa) kartın hata satırına yazılır */
  const run = (fn: () => Promise<void>) =>
    startAction(async () => {
      try {
        await fn();
      } catch (e) {
        setError(actionErrorText(e));
      }
    });

  function begin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    run(async () => {
      const res = await beginTotpSetup(password);
      if (!res.ok) return setError(res.error);
      setPassword("");
      setCode("");
      setStep({ at: "scan", setup: res.data });
    });
  }

  function confirm(e: FormEvent) {
    e.preventDefault();
    setError(null);
    run(async () => {
      const res = await confirmTotpSetup(code);
      if (!res.ok) {
        setError(res.error);
        // Süresi doldu ya da 5 hatalı kod: bekleyen anahtar silindi, kurulum parolayla yeniden başlar
        if (isSetupEnded(res.error)) setStep({ at: "start" });
        return;
      }
      setStep({ at: "codes", codes: res.data.codes });
    });
  }

  function back() {
    // Yanıt beklenmez: anahtar silinemezse de süresi dolunca onaylanamaz
    void cancelTotpSetup().catch(() => {});
    setError(null);
    setStep({ at: "start" });
  }

  // Çıkış panelin çıkışı gibi: bu cihazın bildirim aboneliği ve asistanın sohbet geçmişi bu kullanıcıyla gider
  function signOut() {
    setLeaving(true);
    forgetAssistantData(userId, [safeStore("localStorage"), safeStore("sessionStorage")]);
    void forgetDeviceOnSignOut().finally(() =>
      logoutAction().catch((e: unknown) => {
        setLeaving(false);
        setError(actionErrorText(e));
      }),
    );
  }

  const signOutButton = (
    <button
      type="button"
      onClick={signOut}
      disabled={leaving}
      className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 self-start text-[15px] font-semibold text-black/70 hover:text-black disabled:cursor-default disabled:opacity-60"
    >
      <LogOut className="size-4" aria-hidden /> Çıkış yap
    </button>
  );

  if (step.at === "codes") {
    const text = `L'Affogato Panel kurtarma kodları\n(her kod bir kez kullanılır)\n\n${step.codes.join("\n")}\n`;
    const download = () => {
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: "laffogato-kurtarma-kodlari.txt" });
      a.click();
      URL.revokeObjectURL(url);
      setSaved(true);
    };
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(step.codes.join("\n"));
        setCopied(true);
        setSaved(true);
        setTimeout(() => setCopied(false), 1600);
      } catch {
        setError("Kopyalanamadı; kodları elle seçip kopyalayın ya da indirin.");
      }
    };
    return (
      <div className={authCard}>
        <AuthHeading title="Kurtarma kodlarınız" subtitle="İki adımlı doğrulama açıldı. Telefonunuz yanınızda değilken girişte bu kodlardan birini kullanırsınız; her kod bir kez çalışır ve bir daha gösterilmez." />
        <div className="flex flex-col gap-5">
          <ul className="grid grid-cols-2 gap-2 rounded-xl bg-black/[0.04] p-3 font-mono text-sm tracking-wide text-black/90">
            {step.codes.map((c) => (
              <li key={c} className="rounded-lg bg-white px-2 py-2 text-center select-all">
                {c}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <button type="button" onClick={download} className={`inline-flex min-h-11 items-center gap-1.5 text-[15px] ${authLink}`}>
              <Download className="size-4" aria-hidden /> İndir (.txt)
            </button>
            <button type="button" onClick={copy} className={`inline-flex min-h-11 items-center gap-1.5 text-[15px] ${authLink}`}>
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? "Kopyalandı" : "Kopyala"}
            </button>
          </div>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[15px] leading-6 text-black/80">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-1 size-5 shrink-0 accent-[#00754A]" />
            <span>Kodları güvenli bir yere kaydettim.</span>
          </label>
          {error ? <AuthError>{error}</AuthError> : null}
          {/* Tam sayfa geçiş: panel yenilenen oturum çereziyle baştan yüklenir */}
          <button type="button" disabled={!saved} onClick={() => window.location.assign(next)} className={`${authButton} w-full`}>
            Panele geç
          </button>
        </div>
      </div>
    );
  }

  if (enabled) {
    return (
      <div className={authCard}>
        <AuthHeading title="İki adımlı doğrulama açık" subtitle={email} />
        <div className="flex flex-col gap-5">
          <p className="flex items-start gap-2.5 text-[15px] leading-6 text-black/70">
            <CircleCheck className="mt-1 size-4 shrink-0 text-[#00754A] dark:text-good" aria-hidden />
            <span>Hesabınız iki adımlı doğrulamayla korunuyor. Kurtarma kodlarını Hesabım › İki adımlı doğrulama&apos;dan yenileyebilirsiniz.</span>
          </p>
          <button type="button" onClick={() => window.location.assign(next)} className={`${authButton} w-full`}>
            Panele geç
          </button>
        </div>
      </div>
    );
  }

  if (step.at === "scan") {
    const { setup } = step;
    return (
      <div className={authCard}>
        <AuthHeading title="QR kodu okutun" subtitle="Doğrulama uygulamasıyla (Google Authenticator, Microsoft Authenticator, 1Password) okutun, ardından uygulamadaki 6 haneli kodu girin." />
        <form onSubmit={confirm} className="flex flex-col gap-5">
          <div className="flex flex-col items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- sunucuda üretilen data: URL */}
            <img src={setup.qr} alt="Doğrulama uygulaması için QR kod" width={184} height={184} className="size-46 rounded-xl border border-black/10 bg-white p-1.5" />
            <p className="text-center text-sm leading-6 text-black/60">
              QR okutamıyorsanız uygulamada &ldquo;anahtarı elle gir&rdquo;i seçin:
              <code className="mt-1 block font-mono text-[13px] break-all text-black/90 select-all">{setup.secret}</code>
            </p>
            <a href={setup.uri} className={`inline-flex min-h-11 items-center text-[15px] sm:hidden ${authLink}`}>
              Bu telefondaki uygulamada aç
            </a>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold text-black/70">Uygulamadaki kod</span>
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={7}
              required
              placeholder="123 456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
              aria-invalid={error ? true : undefined}
              className={`${authInput} text-center font-mono text-xl tracking-[0.35em] placeholder:text-black/30`}
            />
          </label>
          {error ? <AuthError>{error}</AuthError> : null}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={back} className="inline-flex min-h-11 cursor-pointer items-center self-start text-[15px] font-semibold text-black/70 hover:text-black">
              Geri
            </button>
            <button type="submit" disabled={pending || code.replace(/\s/g, "").length !== 6} className={`${authButton} max-sm:w-full`}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {pending ? "Doğrulanıyor…" : "Doğrula ve aç"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className={authCard}>
      <AuthHeading title="İki adımlı doğrulamayı kurun" subtitle={ADMIN_2FA_REQUIRED_TEXT} />
      <form onSubmit={begin} className="flex flex-col gap-5">
        <p className="flex items-start gap-2.5 text-[15px] leading-6 text-black/70">
          <ShieldCheck className="mt-1 size-4 shrink-0 text-[#00754A] dark:text-good" aria-hidden />
          <span>
            Birkaç dakika sürer: telefonunuza bir doğrulama uygulaması (Google Authenticator, Microsoft Authenticator ya da 1Password) kurun, parolanızı girin, QR kodu okutun. Bundan sonra
            girişte parolanın ardından uygulamadaki 6 haneli kod istenir. Açılınca diğer cihazlardaki oturumlarınız kapanır.
            <span className="block font-semibold text-black/90">{email}</span>
          </span>
        </p>
        {/* Parola yöneticisi doğru hesabı önersin */}
        <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
        <FloatingPasswordField id="setup-password" label="Parolanız" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error ? <AuthError>{error}</AuthError> : null}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          {signOutButton}
          <button type="submit" disabled={pending || !password} className={`${authButton} max-sm:w-full`}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? "Denetleniyor…" : "Devam"}
          </button>
        </div>
      </form>
    </div>
  );
}

"use client";

import { Check, Copy, Download, KeyRound, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ConfirmPasswordDialog } from "@/components/panel/confirm-password-dialog";
import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { isSetupEnded } from "@/lib/two-factor-setup";
import { beginTotpSetup, cancelTotpSetup, confirmTotpSetup, disableTotp, regenerateRecoveryCodes } from "@/server/actions/auth";

import { sessionsNote } from "./session-note";

type Setup = { qr: string; secret: string; uri: string };

/**
 * İki adımlı doğrulama (isteğe bağlı): açıkken girişte parolanın ardından telefondaki uygulamanın 6 haneli kodu
 * istenir. Kurulum: parola → QR'ı okut → kodu gir → kurtarma kodlarını sakla. Açmak, kapatmak ve yeni kurtarma kodu
 * parola ister: açık kalmış bir oturumla başkası kendi telefonunu bağlayamasın. Açmak ve kapatmak diğer cihazlardaki
 * oturumları (yöneticide Claude bağlantısını da) kapatır; pencereler bunu önceden söyler. `claude`: etkin bir Claude
 * bağlantısı var.
 */
export function TwoFactorCard({ enabled, recoveryLeft, claude = false }: { enabled: boolean; recoveryLeft: number; claude?: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [askPassword, setAskPassword] = useState<"enable" | "disable" | "regenerate" | null>(null);

  return (
    <>
      <CardHeader
        icon={<ShieldCheck />}
        title="İki adımlı doğrulama"
        description="İsteğe bağlı. Açıkken girişte parolanın ardından telefonunuzdaki doğrulama uygulamasının 6 haneli kodu istenir."
        meta={
          enabled ? (
            <Badge dot tone="green">
              Açık · {recoveryLeft} kurtarma kodu kaldı
            </Badge>
          ) : (
            <Badge dot tone="gray">
              Kapalı
            </Badge>
          )
        }
      />
      <CardContent className="space-y-3">
        {enabled ? (
          <>
            {recoveryLeft <= 2 ? (
              <Notice tone="warn" size="sm" risk="veri" live="polite" title="Kurtarma kodunuz azaldı: yenilerini oluşturun" text="Güvenli bir yere kaydedin." />
            ) : null}
            <div className="flex flex-wrap gap-2 max-sm:[&>*]:flex-1">
              <Button variant="secondary" onClick={() => setAskPassword("regenerate")}>
                <KeyRound size={16} /> Yeni kurtarma kodları
              </Button>
              <Button variant="ghost" onClick={() => setAskPassword("disable")}>
                <ShieldOff size={16} /> Kapat
              </Button>
            </div>
          </>
        ) : (
          <>
            <ol className="space-y-1.5 text-sm text-ink-soft">
              <li className="flex gap-2">
                <span className="tabular font-semibold text-ink">1.</span> Telefona Google Authenticator, Microsoft Authenticator ya da 1Password kurun.
              </li>
              <li className="flex gap-2">
                <span className="tabular font-semibold text-ink">2.</span> Ekrandaki QR kodu uygulamayla okutun.
              </li>
              <li className="flex gap-2">
                <span className="tabular font-semibold text-ink">3.</span> Uygulamadaki kodu girin, kurtarma kodlarını saklayın.
              </li>
            </ol>
            <Button onClick={() => setAskPassword("enable")} className="w-full sm:w-auto">
              <Smartphone size={16} /> İki adımlı doğrulamayı aç
            </Button>
          </>
        )}
      </CardContent>

      {setup ? (
        <SetupDialog
          setup={setup}
          claude={claude}
          onClose={() => setSetup(null)}
          onDone={(c) => {
            setSetup(null);
            setCodes(c);
            router.refresh();
          }}
        />
      ) : null}
      {askPassword === "enable" ? (
        <ConfirmPasswordDialog
          title="İki adımlı doğrulamayı aç"
          description={`Onaylamak için parolanızı girin; ardından QR kodu gösterilir. ${sessionsNote(claude, "Açılınca")}`}
          confirmLabel="Devam"
          onClose={() => setAskPassword(null)}
          onConfirm={async (password) => {
            const res = await beginTotpSetup(password);
            if (!res.ok) return res.error;
            setAskPassword(null);
            setSetup(res.data);
            return null;
          }}
        />
      ) : askPassword === "disable" ? (
        <ConfirmPasswordDialog
          title="İki adımlı doğrulama kapatılsın mı?"
          description={`Girişte yalnızca parola istenir. ${sessionsNote(claude)}`}
          confirmLabel="Kapat"
          danger
          onClose={() => setAskPassword(null)}
          onConfirm={async (password) => {
            const res = await disableTotp(password);
            if (!res.ok) return res.error;
            toast.success("İki adımlı doğrulama kapatıldı");
            setAskPassword(null);
            router.refresh();
            return null;
          }}
        />
      ) : askPassword === "regenerate" ? (
        <ConfirmPasswordDialog
          title="Yeni kurtarma kodları"
          description="Eski kodların hepsi geçersiz olur. Onaylamak için parolanızı girin."
          confirmLabel="Oluştur"
          onClose={() => setAskPassword(null)}
          onConfirm={async (password) => {
            const res = await regenerateRecoveryCodes(password);
            if (!res.ok) return res.error;
            toast.success("Yeni kurtarma kodları oluşturuldu");
            setAskPassword(null);
            setCodes(res.data.codes);
            router.refresh();
            return null;
          }}
        />
      ) : null}
      {codes ? <RecoveryCodesDialog codes={codes} onClose={() => setCodes(null)} /> : null}
    </>
  );
}

/**
 * QR, anahtar ve onay kodu. Vazgeçilince onaylanmamış anahtar sunucuda silinir; süresi dolan ya da 5 hatalı kodla
 * durdurulan kurulumda pencere kapanır, kurulum parolayla yeniden başlar (src/lib/two-factor-setup.ts).
 */
function SetupDialog({ setup, claude, onClose, onDone }: { setup: Setup; claude: boolean; onClose: () => void; onDone: (codes: string[]) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useActionTransition();
  const cancel = () => {
    // Yanıt beklenmez: anahtar silinemezse de süresi dolunca onaylanamaz
    void cancelTotpSetup().catch(() => {});
    onClose();
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await confirmTotpSetup(code);
      if (!res.ok) {
        if (!isSetupEnded(res.error)) return setError(res.error);
        toast.error(res.error);
        return onClose();
      }
      toast.success("İki adımlı doğrulama açıldı");
      onDone(res.data.codes);
    });
  }

  return (
    <Dialog
      open
      onClose={cancel}
      title="İki adımlı doğrulamayı aç"
      description={`QR kodu doğrulama uygulamasıyla okutun, ardından uygulamadaki 6 haneli kodu girin. ${sessionsNote(claude, "Açılınca")}`}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>
            Vazgeç
          </Button>
          <Button type="submit" form="totp-setup" disabled={pending || code.replace(/\s/g, "").length !== 6}>
            {pending ? "Doğrulanıyor…" : "Doğrula ve aç"}
          </Button>
        </>
      }
    >
      <form id="totp-setup" onSubmit={submit} className="space-y-4 pb-2">
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-panel p-4 sm:flex-row sm:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element -- sunucuda üretilen data: URL */}
          <img src={setup.qr} alt="Doğrulama uygulaması için QR kod" width={168} height={168} className="size-42 shrink-0 rounded-2xl bg-white p-1.5" />
          <div className="min-w-0 space-y-2 text-sm">
            <p className="text-ink-soft">QR okutamıyorsanız uygulamada &ldquo;anahtarı elle gir&rdquo;i seçip bu anahtarı yazın:</p>
            <CopyField value={setup.secret} label="Anahtar" />
            <a href={setup.uri} className="inline-flex min-h-11 items-center text-[13px] font-medium text-ink underline-offset-2 hover:underline sm:hidden">
              Bu telefondaki uygulamada aç
            </a>
          </div>
        </div>
        <Field label="Uygulamadaki kod" htmlFor="totp-code" error={error}>
          {/* Telefonda kendiliğinden odaklanmaz: klavye QR'ı, anahtarı ve "uygulamada aç" bağlantısını örtmesin (kod
              doğrulama uygulamasından dönünce yazılır); geniş ekranda pencere açılınca bu alana odaklanılır */}
          <Input
            id="totp-code"
            data-autofocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            placeholder="123 456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
            aria-invalid={error ? true : undefined}
            className="text-center font-mono text-lg tracking-[0.3em]"
          />
        </Field>
      </form>
    </Dialog>
  );
}

/**
 * Kodlar bir kez gösterilir. İndirilmeden ya da kopyalanmadan kapatılmak istenirse (telefonda arka plana yanlışlıkla
 * dokunma, sayfayı aşağı çekme, Esc ya da Kapat) önce sorulur: kodlar sessizce kaybolmaz.
 */
function RecoveryCodesDialog({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const text = `L'Affogato Panel kurtarma kodları\n(her kod bir kez kullanılır)\n\n${codes.join("\n")}\n`;
  const [saved, setSaved] = useState(false);
  const [askClose, setAskClose] = useState(false);
  const requestClose = () => (saved ? onClose() : setAskClose(true));

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "laffogato-kurtarma-kodlari.txt" });
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  }

  return (
    <>
      <Dialog
        open
        onClose={requestClose}
        title="Kurtarma kodlarınız"
        description="Telefonunuz yanınızda değilken girişte bu kodlardan birini kullanabilirsiniz. Her kod bir kez çalışır ve bir daha gösterilmez."
        footer={
          <Button onClick={requestClose} variant={saved ? "primary" : "secondary"}>
            {saved ? "Kaydettim, kapat" : "Kapat"}
          </Button>
        }
      >
        <div className="space-y-4 pb-2">
          <ul className="grid grid-cols-2 gap-2 rounded-3xl bg-panel p-4 font-mono text-sm tracking-wide text-ink">
            {codes.map((c) => (
              <li key={c} className="rounded-xl bg-surface px-3 py-2 text-center select-all">
                {c}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 max-sm:[&>*]:flex-1">
            <Button variant="secondary" onClick={download}>
              <Download size={16} /> İndir (.txt)
            </Button>
            <CopyButton value={codes.join("\n")} label="Kopyala" onCopied={() => setSaved(true)} />
          </div>
        </div>
      </Dialog>
      {/* Onay penceresi ana pencerenin içinde değil yanında: React içteki <dialog>'un close/cancel olayını dıştakine de
          iletir; içteki kapanınca dıştaki soruyu yeniden açmaya çalışırdı */}
      <ConfirmDialog
        open={askClose}
        onClose={() => setAskClose(false)}
        onConfirm={() => {
          setAskClose(false);
          onClose();
        }}
        title="Kodlar kaydedilmedi"
        description="Kurtarma kodları bir daha gösterilmez. Kapatırsanız yeni kodları ancak parolanızla yeniden oluşturabilirsiniz."
        confirmLabel="Yine de kapat"
      />
    </>
  );
}

function CopyButton({ value, label, onCopied }: { value: string; label: string; onCopied?: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          onCopied?.();
          setTimeout(() => setDone(false), 1600);
        } catch {
          toast.error("Kopyalanamadı; elle seçip kopyalayın");
        }
      }}
    >
      {done ? <Check size={16} /> : <Copy size={16} />} {done ? "Kopyalandı" : label}
    </Button>
  );
}

function CopyField({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-1 rounded-xl bg-surface py-1 pr-1 pl-3 ring-1 ring-line ring-inset">
      <code className="min-w-0 flex-1 font-mono text-[13px] break-all text-ink select-all" aria-label={label}>
        {value}
      </code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value.replace(/\s/g, ""));
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          } catch {
            toast.error("Kopyalanamadı; elle seçip kopyalayın");
          }
        }}
        className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-mute hover:bg-ink/[0.05] hover:text-ink pointer-coarse:size-11"
        aria-label={done ? "Kopyalandı" : `${label} kopyala`}
      >
        {done ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </div>
  );
}

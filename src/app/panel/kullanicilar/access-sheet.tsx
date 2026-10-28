"use client";

import { Check, Copy, Mail, MessageCircle, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { tryAction } from "@/components/ui/action-error";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { emailAccess } from "@/server/actions/invites";

import { accessSheetText, credentialsText, formatExpiry, whatsappUrl, type AccessInfo } from "./access";
import { CloseGuardFooter } from "./close-guard";
import { useCopied } from "./password-field";

const TAP = "h-11 pointer-coarse:h-11 w-full";

function Row({
  label,
  children,
  note,
  copyKey,
  value,
  copied,
  onCopy,
}: {
  label: string;
  children: ReactNode;
  note?: ReactNode;
  copyKey: string;
  value: string;
  copied: string | null;
  onCopy: (key: string, value: string, okMessage: string) => void | Promise<void>;
}) {
  return (
    <div className="flex items-start gap-2 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <dt className="text-xs text-ink-mute">{label}</dt>
        <dd className="mt-0.5 text-[15px] font-medium wrap-anywhere text-ink select-all">{children}</dd>
        {note ? <dd className="mt-1 text-xs text-ink-mute">{note}</dd> : null}
      </div>
      <button
        type="button"
        onClick={() => onCopy(copyKey, value, `${label} kopyalandı.`)}
        className="-mr-1 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-ink-mute hover:bg-panel hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none"
        aria-label={`${label} kopyala`}
      >
        {copied === copyKey ? <Check size={17} className="text-good" /> : <Copy size={17} />}
      </button>
    </div>
  );
}

/**
 * "Giriş bilgileri": kullanıcı eklenince, yeni parola verilince, davet ya da sıfırlama bağlantısı oluşunca açılır.
 * Panel adresi, e-posta, parola (yalnızca yönetici belirlediyse) ya da tek kullanımlık bağlantı; hepsi tek mesaj
 * olarak kopyalanır, WhatsApp'ta paylaşılır ya da kişinin e-postasına gönderilir. Parola ve bağlantı bir daha
 * gösterilmez: hiçbiri kopyalanmadan, paylaşılmadan ya da gönderilmeden kapatılmak istenirse (arka plana dokunma,
 * aşağı çekme, Esc, ✕, Tamam) önce sorulur.
 */
export function AccessSheet({ info, emailConfigured, onClose }: { info: AccessInfo; emailConfigured: boolean; onClose: () => void }) {
  // Kopyalama sonucu pencerenin içinde yazar: telefonda üstte çıkan bildirim başlığı ve ✕'i örtmesin
  const { copied, copy } = useCopied({ quiet: true });
  const [note, setNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  // Parola ya da bağlantı bir yere aktarıldı mı (kopyala, WhatsApp, e-posta)
  const [kept, setKept] = useState(false);
  const [asking, setAsking] = useState(false);
  const message = credentialsText(info);
  const secret = info.kind === "password" ? info.handle : info.token;
  const { title, description } = accessSheetText(info);
  const what = info.kind === "password" ? "Parola" : "Bağlantı";

  const copyRow = async (key: string, value: string, okMessage: string) => {
    const ok = await copy(key, value);
    if (!ok) return;
    setNote(okMessage);
    if (key === "password" || key === "link" || key === "all") keep();
  };
  // Parola ya da bağlantı iletildi: kapatmak artık sorulmaz (soru açıksa kalkar)
  const keep = () => {
    setKept(true);
    setAsking(false);
  };
  // Arka plana dokunma, aşağı çekme, Esc, ✕ ve Tamam: iletilmediyse pencerenin altında sorulur (soru açıkken tekrar
  // denemek pencereyi kapatmaz; "Yine de kapat" gerekir)
  const requestClose = () => {
    if (kept) onClose();
    else setAsking(true);
  };

  async function sendMail() {
    if (!secret) return;
    setSending(true);
    const res = await tryAction(() => emailAccess({ userId: info.userId, kind: info.kind, secret, reason: info.reason }));
    setSending(false);
    if (!res) return;
    if (!res.ok) return void toast.error(res.error);
    // Sonuç düğmede ("Gönderildi") ve altındaki satırda yazar
    setSentTo(res.data.to);
    setNote(null);
    keep();
  }

  return (
    <Dialog
      open
      onClose={requestClose}
      title={title}
      description={description}
      footer={
        asking ? (
          <CloseGuardFooter
            title={`${what} henüz iletilmedi.`}
            description={`Kopyalamadınız, paylaşmadınız ya da e-postayla göndermediniz. Pencere kapanınca ${what.toLocaleLowerCase("tr-TR")} bir daha gösterilmez${
              info.kind === "password" ? "; yeniden parola belirlemeniz gerekir." : "; yeni bağlantı oluşturmanız gerekir."
            }`}
            confirmLabel="Yine de kapat"
            onStay={() => setAsking(false)}
            onLeave={onClose}
          />
        ) : (
          <Button onClick={requestClose} className="max-sm:h-11 max-sm:w-full">
            Tamam
          </Button>
        )
      }
    >
      <div className="space-y-4 pb-2">
        <dl className="divide-y divide-line rounded-2xl bg-panel px-4 py-3.5">
          <Row label="Panel adresi" copyKey="url" value={info.loginUrl} copied={copied} onCopy={copyRow}>
            {info.loginUrl}
          </Row>
          <Row label="Giriş e-postası" copyKey="email" value={info.email} copied={copied} onCopy={copyRow}>
            {info.email}
          </Row>
          {info.kind === "password" && info.password ? (
            <Row label="Parola" copyKey="password" value={info.password} copied={copied} onCopy={copyRow}>
              <span className="font-mono text-base tracking-wide">{info.password}</span>
            </Row>
          ) : null}
          {info.link ? (
            <Row
              label={info.kind === "invite" ? "Davet bağlantısı" : "Sıfırlama bağlantısı"}
              copyKey="link"
              value={info.link}
              copied={copied}
              onCopy={copyRow}
              note={info.expiresAt ? `Tek kullanımlık · son geçerlilik ${formatExpiry(info.expiresAt)}` : "Tek kullanımlık"}
            >
              <span className="text-[13px] leading-5 font-normal text-ink-soft">{info.link}</span>
            </Row>
          ) : null}
        </dl>

        <div className="space-y-2">
          <div className="grid gap-2">
            <Button className={TAP} onClick={() => copyRow("all", message, "Mesaj kopyalandı; WhatsApp'a ya da SMS'e yapıştırın.")}>
              {copied === "all" ? <Check size={16} /> : <Copy size={16} />} {copied === "all" ? "Kopyalandı" : "Kopyala"}
            </Button>
            <a
              href={whatsappUrl(message)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                keep();
                setNote("WhatsApp açıldı; kişiyi seçip gönderin.");
              }}
              className={buttonClass("secondary", "md", TAP)}
            >
              <MessageCircle size={16} /> WhatsApp&apos;ta paylaş
            </a>
            <Button variant="secondary" className={TAP} disabled={!emailConfigured || sending || !secret || sentTo !== null} onClick={sendMail}>
              {sentTo ? <Check size={16} /> : <Mail size={16} />} {sending ? "Gönderiliyor…" : sentTo ? "Gönderildi" : "E-postayla gönder"}
            </Button>
          </div>
          {/* Kopyalama / gönderim sonucu burada yazar (ekran okuyucu da duyurur) */}
          <div role="status" aria-live="polite" className="space-y-1 text-xs leading-5">
            {note ? (
              <p className="flex items-start gap-1.5 font-medium text-good-ink">
                <Check size={14} className="mt-0.5 shrink-0" aria-hidden /> {note}
              </p>
            ) : null}
            {!emailConfigured ? (
              <p className="text-ink-mute">E-posta gönderimi kapalı (sunucuda RESEND_API_KEY tanımlı değil). Kopyala ya da WhatsApp ile iletin.</p>
            ) : sentTo ? (
              <p className="flex items-start gap-1.5 font-medium text-good-ink">
                <Check size={14} className="mt-0.5 shrink-0" aria-hidden /> {sentTo} adresine gönderildi. Gelmezse istenmeyen klasörüne baksın.
              </p>
            ) : null}
          </div>
        </div>

        <details className="group rounded-2xl bg-surface ring-1 ring-line">
          <summary className="flex min-h-11 cursor-pointer list-none items-center px-4 text-[13px] font-medium text-ink-soft select-none">Gidecek mesajı gör</summary>
          <pre className="px-4 pb-4 font-sans text-[13px] leading-5 whitespace-pre-wrap break-words text-ink-soft">{message}</pre>
        </details>

        <p className="flex items-start gap-2 rounded-2xl bg-warn-soft px-3.5 py-3 text-xs leading-5 text-warn">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
          {info.kind === "password"
            ? "Parola bu pencere kapanınca bir daha gösterilmez. Unutulursa düzenle › Güvenlik'ten sıfırlama bağlantısı oluşturun."
            : "Bağlantı bu pencere kapanınca bir daha gösterilmez. Kaybolursa yenisini oluşturun; eskisi o an geçersiz olur."}
        </p>
      </div>
    </Dialog>
  );
}

"use client";

import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmPasswordDialog } from "@/components/panel/confirm-password-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form";
import { documentsDownloadBytes, documentsTooBigText, PANEL_DOCUMENTS_MAX_BYTES, sizeText, type LastBackup } from "@/lib/backup/format";
import { prepareBackupDownload } from "@/server/actions/backup";

/**
 * İndirme bitince kart son yedeği göstersin diye sayfa bir kez yenilenir: belgesiz yedek ~1 MB, birkaç saniyede iner
 * (son yedek kaydını rota dosyanın sonunda yazar). Daha uzun sürerse kart bir sonraki açılışta güncellenir.
 */
const REFRESH_AFTER_MS = 5_000;

/**
 * Ayarlar › Yedek › Yedeği indir: parolayla onaylanır, sonra dosya düz bir bağlantıyla iner (tarayıcı kendisi
 * kaydeder; sayfa yönlendirmesi değil). Parola rotaya gitmez: eylem iki dakika geçerli, bu kişiye özel bir bağlantı
 * verir. Yüklenmiş fatura belgeleri isteğe bağlı; belgelerle dosya panelden indirilebilecek sınırı aşacaksa seçilemez
 * (tahmin belgelerden ve son belgesiz yedeğin boyutundan; bilgisayardan alınır, docs/YEDEK.md › Belgeler).
 */
export function BackupDownload({ uploads, last }: { uploads: { count: number; bytes: number }; last: Pick<LastBackup, "dataBytes"> | null }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [documents, setDocuments] = useState(false);
  const refreshTimer = useRef<number | null>(null);
  const estimate = documentsDownloadBytes(uploads.bytes, last);
  const tooBig = estimate > PANEL_DOCUMENTS_MAX_BYTES;

  // Sayfadan çıkılırsa bekleyen yenileme başka bir ekranı yenilemesin
  useEffect(
    () => () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    },
    [],
  );
  const size = `${uploads.count} dosya · ${sizeText(uploads.bytes)}`;

  return (
    <>
      <Button onClick={() => setAsking(true)} className="max-sm:w-full">
        <Download size={16} aria-hidden="true" /> Yedeği indir
      </Button>
      {asking ? (
        <ConfirmPasswordDialog
          title="Yedeği indir"
          description="Parolanızı girin: yedek paneldeki bütün veriyi taşır."
          confirmLabel="İndir"
          onClose={() => setAsking(false)}
          onConfirm={async (password) => {
            const res = await prepareBackupDownload({ password, documents: documents && !tooBig });
            if (!res.ok) return res.error;
            // Önce pencere kapanır, sonra indirme başlar
            setAsking(false);
            setDocuments(false);
            const a = document.createElement("a");
            a.href = res.data.url;
            a.download = res.data.fileName;
            document.body.append(a);
            a.click();
            a.remove();
            toast.success("Yedek iniyor", { description: res.data.fileName });
            if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
            refreshTimer.current = window.setTimeout(() => router.refresh(), REFRESH_AFTER_MS);
            return null;
          }}
        >
          {uploads.count > 0 ? (
            <div className="rounded-2xl bg-panel px-3.5 py-2.5">
              <Checkbox
                label="Yüklenen fatura belgelerini de ekle"
                checked={documents && !tooBig}
                disabled={tooBig}
                onChange={(e) => setDocuments(e.target.checked)}
                className={tooBig ? "cursor-not-allowed text-ink-mute [&>input]:cursor-not-allowed" : undefined}
              />
              <p className="mt-0.5 pl-6 text-xs leading-5 text-pretty text-ink-mute pointer-coarse:pl-7">
                {tooBig ? documentsTooBigText(estimate) : `${size}; dosya büyür, Wi-Fi'de indirin`}
              </p>
            </div>
          ) : null}
        </ConfirmPasswordDialog>
      ) : null}
    </>
  );
}

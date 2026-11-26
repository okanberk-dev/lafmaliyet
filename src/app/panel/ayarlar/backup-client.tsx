"use client";

import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmPasswordDialog } from "@/components/panel/confirm-password-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form";
import { documentsDownloadBytes, documentsTooBigText, PANEL_DOCUMENTS_MAX_BYTES, sizeText, type LastBackup } from "@/lib/backup/format";
import { prepareBackupDownload, prepareStoredBackupDownload } from "@/server/actions/backup";

/**
 * İndirme bitince kart son yedeği göstersin diye sayfa bir kez yenilenir: belgesiz yedek ~1 MB, birkaç saniyede iner
 * (son yedek kaydını rota dosyanın sonunda yazar). Daha uzun sürerse kart bir sonraki açılışta güncellenir.
 */
const REFRESH_AFTER_MS = 5_000;

/** Dosya düz bir bağlantıyla iner (tarayıcı kendisi kaydeder; sayfa yönlendirmesi değil) */
function startDownload(url: string, fileName: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  toast.success("Yedek iniyor", { description: fileName });
}

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
            startDownload(res.data.url, res.data.fileName);
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
                {tooBig ? `${documentsTooBigText(estimate)}; belgeli yedeği geliştiriciden isteyin` : `${size}; dosya büyür, Wi-Fi'de indirin`}
              </p>
            </div>
          ) : null}
        </ConfirmPasswordDialog>
      ) : null}
    </>
  );
}

/** Ayarlar › Yedek › Otomatik haftalık yedek: listedeki bir satır (sunucu biçimler) */
export interface StoredBackupRow {
  name: string;
  /** "23 Kasım 2026 Pazartesi 08:12" */
  label: string;
  /** "1,2 MB" */
  size: string;
}

/**
 * Depodaki otomatik yedekler (yeni önce) ve her birinin İndir'i: elle indirmeyle aynı kalıp, parola penceresinden sonra
 * iki dakika geçerli, bu kişiye özel bağlantı (prepareStoredBackupDownload; dosyayı /api/yedek/kayitli verir).
 */
export function StoredBackupList({ items }: { items: StoredBackupRow[] }) {
  const [asking, setAsking] = useState<StoredBackupRow | null>(null);
  return (
    <>
      <ul className="mt-2 divide-y divide-line border-t border-line">
        {items.map((b, i) => (
          <li key={b.name} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="text-sm text-pretty text-ink">
                {b.label}
                {i === 0 ? <span className="ml-1.5 text-[13px] text-ink-mute">(en yeni)</span> : null}
              </p>
              <p className="text-[13px] text-ink-mute tabular">{b.size}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setAsking(b)} aria-label={`${b.label} yedeğini indir`}>
              <Download size={14} aria-hidden="true" /> İndir
            </Button>
          </li>
        ))}
      </ul>
      {asking ? (
        <ConfirmPasswordDialog
          title="Otomatik yedeği indir"
          description={`Parolanızı girin: ${asking.label} yedeği paneldeki bütün veriyi taşır.`}
          confirmLabel="İndir"
          onClose={() => setAsking(null)}
          onConfirm={async (password) => {
            const res = await prepareStoredBackupDownload({ password, name: asking.name });
            if (!res.ok) return res.error;
            setAsking(null);
            startDownload(res.data.url, res.data.fileName);
            return null;
          }}
        />
      ) : null}
    </>
  );
}

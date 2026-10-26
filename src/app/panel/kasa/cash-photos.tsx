"use client";

import { ImageMinus, Info, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PhotoThumb, ReadError } from "@/components/panel/photo-picker";
import { PhotoViewer } from "@/components/panel/photo-viewer";
import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { photoDiffText, type CashPhotoKind, type CashReading, type PhotoDiff, type ReadCheck } from "@/lib/photo-read/kasa";
import { photoCaption } from "@/lib/photo-rules";
import { cn } from "@/lib/utils";
import { requestPhotoRemoval } from "@/server/actions/cash-out-requests";
import { deleteStoredPhoto } from "@/server/actions/photos";
import type { CashPhotoDTO } from "@/server/data/cash-photos";

import { newClientKey } from "./cash-requests";

/** Formdaki (henüz gönderilmemiş) fotoğraf ve okuması */
export interface FormPhoto {
  id: number;
  kind: CashPhotoKind;
  createdAt: string;
  byName: string;
  reading: CashReading | null;
  /** Okunamadı ya da yanlış belge (kırmızı) */
  error: string | null;
  /** `error` yönergedir (Banka POS bölümünde yazarkasanın Z'si): turuncu, düğmesiz */
  advice?: boolean;
  /** Yanlış bölüme okutulan fiş: öteki bölüme okut */
  switchTo: CashPhotoKind | null;
  canRetry: boolean;
  /** Okumadan sonraki yeşil satır */
  summary: string | null;
}

/** Okumanın denetimleri: önce uyarılar (turuncu), sonra bilgiler (mavi); en çok dördü */
export function ReadChecks({ checks, className }: { checks: ReadCheck[]; className?: string }) {
  if (!checks.length) return null;
  return (
    <ul className={cn("space-y-1.5", className)}>
      {checks.slice(0, 4).map((c, i) => (
        <li key={i} className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-[13px] leading-5", c.level === "warn" ? "bg-warn-soft text-warn" : "bg-info-soft text-info")}>
          {c.level === "warn" ? <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> : <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
          <span className="min-w-0">{c.text}</span>
        </li>
      ))}
    </ul>
  );
}

const SWITCH_LABEL: Record<CashPhotoKind, string> = { "kasa-pos": "Banka POS bölümüne okut", "kasa-okc": "Banka POS Z bölümüne okut", "kasa-z": "ModPOS bölümüne okut" };

/**
 * Bir kartın (ModPOS Z raporu ya da Banka POS Z raporu) fotoğrafları: rapora bağlı olanlar salt okunur, formdakiler
 * kaldırılabilir. Her fotoğrafın altında okumanın sonucu: yeşil özet, kırmızı hata (yeniden dene / öteki bölüme okut)
 * ya da turuncu yönerge (rakam fişten yazılır; düğme yok).
 */
export function CardPhotos({
  saved,
  photos,
  busy,
  onRemove,
  onRetry,
  onSwitch,
}: {
  saved: CashPhotoDTO[];
  photos: FormPhoto[];
  busy: boolean;
  onRemove: (id: number) => void;
  onRetry: (p: FormPhoto) => void;
  onSwitch: (p: FormPhoto) => void;
}) {
  const [viewer, setViewer] = useState<{ id: number; caption: string } | null>(null);
  if (!saved.length && !photos.length) return null;
  return (
    <div className="space-y-2.5">
      {saved.map((p) => {
        const caption = photoCaption(p.kind, p.createdAt, p.byName);
        return (
          <PhotoThumb key={p.id} id={p.id} caption={caption} onOpen={() => setViewer({ id: p.id, caption })}>
            <p className="text-ink-mute">Raporla gönderildi</p>
          </PhotoThumb>
        );
      })}
      {photos.map((p) => {
        const caption = photoCaption(p.kind, p.createdAt, p.byName);
        return (
          <PhotoThumb key={p.id} id={p.id} caption={caption} onOpen={() => setViewer({ id: p.id, caption })} onRemove={() => onRemove(p.id)}>
            {p.summary ? <p className="text-good-ink">{p.summary}</p> : null}
            {p.error && p.advice ? (
              <p role="status" className="flex items-start gap-1.5 text-warn">
                <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0">{p.error}</span>
              </p>
            ) : p.error ? (
              <div className="space-y-1.5">
                <ReadError message={p.error} onRetry={p.canRetry ? () => onRetry(p) : undefined} busy={busy} />
                {p.switchTo ? (
                  <Button size="xs" variant="secondary" onClick={() => onSwitch(p)} disabled={busy}>
                    {SWITCH_LABEL[p.switchTo]}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {!p.summary && !p.error ? <p className="text-ink-mute">Fotoğraf eklendi; gönderince raporla saklanır.</p> : null}
          </PhotoThumb>
        );
      })}
      <PhotoViewer photo={viewer} onClose={() => setViewer(null)} />
    </div>
  );
}

/**
 * Gönderilmiş raporun fotoğrafları (görebilene): "Z raporu · 23:52 · Ayşe". Yönetici bir fotoğrafı silebilir; rapor
 * kalır. Personel yanlış Z / POS fotoğrafının kaldırılmasını isteyebilir (`removal`; yöneticinin onayıyla, fotoğraf 30
 * gün saklanır): raporun tek Z fotoğrafında ve fotoğraftan farklı yazılan alanda düğme yok, bekleyende "Kaldırma
 * istendi". Kayıtlı değerler net okunmuş bir değerden farklıysa uyarı kutusu.
 */
export function SavedPhotos({ photos, diffs, admin, removal }: { photos: CashPhotoDTO[]; diffs: PhotoDiff[]; admin: boolean; removal?: Record<number, "ok" | "pending" | "blocked"> }) {
  const [viewer, setViewer] = useState<{ id: number; caption: string } | null>(null);
  const [confirm, setConfirm] = useState<CashPhotoDTO | null>(null);
  const [ask, setAsk] = useState<CashPhotoDTO | null>(null);
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(newClientKey);
  const [pending, start] = useActionTransition();
  if (!photos.length && !diffs.length) return null;
  function remove() {
    const p = confirm;
    if (!p) return;
    start(async () => {
      const res = await deleteStoredPhoto(p.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Fotoğraf silindi");
      setConfirm(null);
    });
  }
  function requestRemoval() {
    const p = ask;
    if (!p) return;
    start(async () => {
      const res = await requestPhotoRemoval({ photoId: p.id, message: reason.trim() || null, clientKey: key });
      if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
      toast.success("Kaldırma isteği gönderildi", { description: "Yönetici onaylarsa fotoğraf rapordan çıkar." });
      setAsk(null);
      setReason("");
      setKey(newClientKey());
    });
  }
  return (
    <div className="space-y-2">
      {photos.length ? (
        <section aria-label="Fotoğraflar" className="rounded-2xl bg-surface px-3 py-2.5 ring-1 ring-line">
          <h3 className="mb-2 text-[13px] font-semibold text-ink-soft">Fotoğraflar</h3>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {photos.map((p) => {
              const caption = photoCaption(p.kind, p.createdAt, p.byName);
              const state = removal?.[p.id];
              return (
                <div key={p.id} className="flex min-w-0 items-center gap-2">
                  <PhotoThumb id={p.id} caption={caption} onOpen={() => setViewer({ id: p.id, caption })} className="flex-1">
                    {state === "pending" ? <Badge tone="amber">Kaldırma istendi</Badge> : null}
                  </PhotoThumb>
                  {admin ? (
                    <IconButton label="Fotoğrafı sil" tone="danger" onClick={() => setConfirm(p)} disabled={pending}>
                      <Trash2 size={15} />
                    </IconButton>
                  ) : state === "ok" ? (
                    <IconButton label="Kaldırılmasını iste" onClick={() => setAsk(p)} disabled={pending}>
                      <ImageMinus size={15} />
                    </IconButton>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
      {diffs.length ? (
        <p className="flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2 text-[13px] leading-5 text-warn">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">Fotoğraftan farklı yazılan: {diffs.map((d) => photoDiffText(d)).join("; ")}</span>
        </p>
      ) : null}
      <PhotoViewer photo={viewer} onClose={() => setViewer(null)} />
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={remove}
        pending={pending}
        title="Fotoğraf silinsin mi?"
        description="Rapor kalır, yalnız fotoğraf silinir."
        confirmLabel="Sil"
      />
      <Dialog
        open={ask !== null}
        onClose={() => setAsk(null)}
        title="Fotoğraf kaldırılsın mı?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAsk(null)} disabled={pending} className="max-sm:bg-panel">
              Vazgeç
            </Button>
            <Button variant="danger" onClick={requestRemoval} disabled={pending}>
              {pending ? "Gönderiliyor…" : "Kaldırılmasını iste"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-mute">Yönetici onaylarsa rapordan çıkar; fotoğraf 30 gün saklanır.</p>
          <Field label="Neden? (isteğe bağlı)" htmlFor="foto-kaldir-neden">
            <Textarea id="foto-kaldir-neden" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={200} placeholder="ör. başka günün fişi" />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

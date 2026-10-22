"use client";

import { Camera, ImagePlus, LoaderCircle, RotateCw, X } from "lucide-react";
import { useRef, useState, type ChangeEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/documents";
import { compressImage, COMPRESS_ERROR_TEXT, PhotoCompressError } from "@/lib/photo-compress";
import type { PhotoUploadResponse } from "@/lib/photo-read/reading";
import { photoUrl, uploadErrorText, type PhotoKind } from "@/lib/photo-rules";
import { cn } from "@/lib/utils";

/*
 * Fotoğraf ekleme (kasa raporu, kasadan çıkan fiş): telefonda "Fotoğraf çek" arka kamerayı açar (<input capture>:
 * getUserMedia değil, panelin camera=() kuralı değişmez), "Galeriden seç" galeriyi. Fotoğraf telefonda 1600 px JPEG'e
 * küçültülür (EXIF ve konum düşer), POST /api/foto ile yüklenir ve aynı istekte okunur. Aşamalar ekranda:
 * küçültülüyor → yükleniyor → okunuyor; hata kırmızı. Kurallar ve hata metinleri src/lib/photo-rules.ts'te.
 */

export type PhotoPhase =
  | { kind: "idle" }
  | { kind: "compressing" }
  | { kind: "uploading"; size: number }
  | { kind: "reading" }
  | { kind: "error"; message: string };

/** XHR: yükleme bitince (gövde gitti) okuma aşamasına geçilir; fetch yüklemenin bittiğini söylemez */
function post(url: string, body: FormData | string, onSent?: () => void): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    if (typeof body === "string") xhr.setRequestHeader("Content-Type", "application/json");
    xhr.responseType = "json";
    // Sunucu okumayı en çok 45 sn bekler, yol 60 sn'de kesilir
    xhr.timeout = 75_000;
    if (onSent) xhr.upload.onload = onSent;
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.response as unknown });
    xhr.onerror = xhr.ontimeout = xhr.onabort = () => resolve({ status: 0, body: null });
    xhr.send(body);
  });
}

/** Fotoğrafı küçültüp yükler (isteğe bağlı okumayla) ya da saklanmış fotoğrafı yeniden okutur; aşama ekranda */
export function usePhotoUpload() {
  const [phase, setPhase] = useState<PhotoPhase>({ kind: "idle" });
  const busy = phase.kind === "compressing" || phase.kind === "uploading" || phase.kind === "reading";

  function finish(res: { status: number; body: unknown }): PhotoUploadResponse | null {
    const ok = res.status === 200 && Boolean(res.body) && (res.body as { ok?: unknown }).ok === true;
    if (!ok) {
      setPhase({ kind: "error", message: uploadErrorText(res.status, res.body) });
      return null;
    }
    setPhase({ kind: "idle" });
    return res.body as PhotoUploadResponse;
  }

  async function upload(file: File, o: { kind: PhotoKind; day: string; read: boolean }): Promise<PhotoUploadResponse | null> {
    setPhase({ kind: "compressing" });
    let blob: Blob;
    try {
      blob = await compressImage(file);
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof PhotoCompressError ? e.message : COMPRESS_ERROR_TEXT });
      return null;
    }
    const form = new FormData();
    form.append("dosya", blob, "foto.jpg");
    form.append("tur", o.kind);
    form.append("gun", o.day);
    if (o.read) form.append("oku", "1");
    setPhase({ kind: "uploading", size: blob.size });
    return finish(await post("/api/foto", form, o.read ? () => setPhase({ kind: "reading" }) : undefined));
  }

  async function reread(id: number, kind: PhotoKind, day: string): Promise<PhotoUploadResponse | null> {
    setPhase({ kind: "reading" });
    return finish(await post(`/api/foto/${id}/oku`, JSON.stringify({ tur: kind, gun: day })));
  }

  return { phase, busy, upload, reread, reset: () => setPhase({ kind: "idle" }) };
}

/**
 * "Fotoğraf çek" (yalnız dokunmatik ekranda) ve "Galeriden seç". Okuma kapalıyken "Fotoğraf ekle" / "Galeriden ekle":
 * fotoğraf yalnız kanıt olarak saklanır. Aynı dosya yeniden seçilebilsin diye alan boşaltılır.
 */
export function PhotoPicker({ onPick, read, disabled, className }: { onPick: (file: File) => void; read: boolean; disabled?: boolean; className?: string }) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onPick(file);
  };
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <Button variant="secondary" disabled={disabled} onClick={() => cameraRef.current?.click()} className="flex-1 text-ink pointer-fine:hidden max-sm:min-h-12">
        <Camera size={16} aria-hidden="true" /> {read ? "Fotoğraf çek" : "Fotoğraf ekle"}
      </Button>
      <Button variant="secondary" disabled={disabled} onClick={() => galleryRef.current?.click()} className="flex-1 text-ink max-sm:min-h-12">
        <ImagePlus size={16} aria-hidden="true" /> {read ? "Galeriden seç" : "Galeriden ekle"}
      </Button>
      <input ref={galleryRef} type="file" accept="image/*" hidden onChange={pick} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
    </div>
  );
}

/** Aşama satırı (ekran okuyucuya duyurulur) ve hata */
export function PhotoStatus({ phase, className }: { phase: PhotoPhase; className?: string }) {
  if (phase.kind === "error") {
    return (
      <p role="alert" className={cn("text-[13px] leading-5 text-bad", className)}>
        {phase.message}
      </p>
    );
  }
  const text = phase.kind === "compressing" ? "Fotoğraf küçültülüyor…" : phase.kind === "uploading" ? `Yükleniyor… ${formatBytes(phase.size)}` : phase.kind === "reading" ? "Okunuyor… genelde 5–10 saniye" : null;
  return (
    <p aria-live="polite" className={cn("flex items-center gap-2 text-[13px] text-ink-mute empty:hidden", className)}>
      {text ? (
        <>
          <LoaderCircle size={14} className="shrink-0 animate-spin" aria-hidden="true" /> {text}
        </>
      ) : null}
    </p>
  );
}

/** Okuma hatası: fotoğraf saklandı; yeniden denenebilir */
export function ReadError({ message, onRetry, busy }: { message: string; onRetry?: () => void; busy?: boolean }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-5 text-bad">
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry ? (
        <Button size="xs" variant="secondary" onClick={onRetry} disabled={busy}>
          <RotateCw size={13} aria-hidden="true" /> Yeniden dene
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Küçük resim (56 px) ve altyazı; dokununca büyük hâli açılır. Resim yalnız panelin yetkili yolundan
 * (/api/foto/{id}); next/image kullanılmaz, onun sunucu tarafı isteği giriş çerezini taşımaz.
 */
export function PhotoThumb({
  id,
  caption,
  children,
  onOpen,
  onRemove,
  size = "md",
  className,
}: {
  id: number;
  caption: string;
  children?: ReactNode;
  onOpen: () => void;
  onRemove?: () => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${caption}: fotoğrafı büyüt`}
        className={cn("shrink-0 cursor-pointer overflow-hidden rounded-lg bg-panel ring-1 ring-line hover:ring-line-strong", size === "md" ? "size-14" : "size-10")}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- yetkili yol; görsel iyileştirici giriş çerezini taşımaz */}
        <img src={photoUrl(id)} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
      </button>
      <div className="min-w-0 flex-1 text-[13px] leading-5">
        <p className="truncate text-ink">{caption}</p>
        {children}
      </div>
      {onRemove ? (
        <Button size="xs" variant="ghost" onClick={onRemove} className="shrink-0">
          <X size={13} aria-hidden="true" /> Kaldır
        </Button>
      ) : null}
    </div>
  );
}

"use client";

import { Camera, ImagePlus, LoaderCircle, RotateCw, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/documents";
import { compressImage, COMPRESS_ERROR_TEXT, PhotoCompressError } from "@/lib/photo-compress";
import type { PhotoUploadResponse } from "@/lib/photo-read/reading";
import { photoUrl, uploadErrorText, type PhotoKind } from "@/lib/photo-rules";
import { isScanKind, MAX_SCAN_PARTS, ORIGINAL_COMPRESS, scanPartsKind, type ScanInfo } from "@/lib/photo-scan";
import { cn } from "@/lib/utils";

import { refreshLiveCamera, shootPhoto } from "./camera-shot";
import type { ScanChoice, ScannedPart } from "./scan-editor";

/*
 * Fotoğraf ekleme (kasa raporu, kasadan çıkan fiş): telefonda "Fotoğraf çek" panelin canlı vizörünü açar (kâğıdın
 * kenarları canlı, sabit tutulunca kendiliğinden çeker; camera-shot.ts, live-camera.tsx); izin verilmezse ya da tarayıcı
 * desteklemezse telefonun kendi kamerası (<input capture>). "Galeriden seç" galeriyi. Belge türlerinde (Z, yazarkasa Z,
 * fiş; kontrol listesi değil) önce tarama ekranı açılır (scan-editor.tsx; docs/FOTOGRAF.md › Belge tarama): taranmış
 * hâl okunan ve gösterilen dosya olur, asıl fotoğraf küçültülüp yanında saklanır. Fotoğraf telefonda JPEG'e
 * küçültülür (en çok 2576 px / ~3,7 MP; EXIF ve konum düşer), POST /api/foto ile yüklenir ve aynı istekte okunur.
 * Aşamalar ekranda: taranıyor → küçültülüyor → yükleniyor → okunuyor; hata kırmızı. Kurallar ve hata metinleri
 * src/lib/photo-rules.ts'te.
 */

/**
 * Tarama ekranını açar (ilk açılışta yüklenir: tarayıcı çekirdeği ve Worker yalnız gerekince iner). Ekran yüklenemezse
 * (bağlantı koptu) tarama atlanır, fotoğraf olduğu gibi yüklenir
 */
async function openScan(file: Blob, kind: PhotoKind, hint: boolean, room: number, keep: (close: () => void) => void): Promise<ScanChoice | null> {
  let mod: typeof import("./scan-editor");
  try {
    mod = await import("./scan-editor");
  } catch {
    return { kind: "skip", file };
  }
  // Çekim uyarılarındaki ad: "Raporun altı kesilmiş", "Fişte parlama var". Uzun fişte "Devamını çek" (en çok 3 parça)
  const parts = scanPartsKind(kind) ? { max: MAX_SCAN_PARTS, room } : undefined;
  const { result, close } = mod.openScanEditor(file, { hint, noun: kind === "fis" ? "fis" : "rapor", parts });
  keep(close);
  return result;
}

export type PhotoPhase =
  | { kind: "idle" }
  | { kind: "scanning" }
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

/**
 * Fotoğrafı (belge türünde önce tarayıp) küçültür ve yükler (isteğe bağlı okumayla) ya da saklanmış fotoğrafı yeniden
 * okutur; aşama ekranda. Tarama ekranı kapatılırsa hiçbir şey yüklenmez (null, aşama boş).
 *
 * Uzun fiş parça parça çekilip birleştirilemediyse parçalar ayrı fotoğraf olarak yüklenebilir: çağıran `room` (bu
 * yüklemeye ayırabileceği fotoğraf sayısı, varsayılan 1) ve `onMore` (ilkinden sonraki her parçanın yanıtı) verir.
 * Vermeyende ekran parçaları birleştiremezse uyarır, ayrı yüklemez.
 */
export function usePhotoUpload() {
  const [phase, setPhase] = useState<PhotoPhase>({ kind: "idle" });
  const busy = phase.kind === "scanning" || phase.kind === "compressing" || phase.kind === "uploading" || phase.kind === "reading";
  // Açık tarama ekranı: sayfa değişirse kapanır
  const closeScan = useRef<(() => void) | null>(null);
  useEffect(() => () => closeScan.current?.(), []);

  function finish(res: { status: number; body: unknown }): PhotoUploadResponse | null {
    const ok = res.status === 200 && Boolean(res.body) && (res.body as { ok?: unknown }).ok === true;
    if (!ok) {
      setPhase({ kind: "error", message: uploadErrorText(res.status, res.body) });
      return null;
    }
    setPhase({ kind: "idle" });
    return res.body as PhotoUploadResponse;
  }

  async function upload(
    file: File,
    o: { kind: PhotoKind; day: string; read: boolean; room?: number; onMore?: (res: PhotoUploadResponse) => void },
  ): Promise<PhotoUploadResponse | null> {
    let source: Blob = file;
    let scan: ScannedPart | null = null;
    let more: ScannedPart[] = [];
    if (isScanKind(o.kind)) {
      setPhase({ kind: "scanning" });
      // Kod emin değilse yapay zekâya köşe yalnız okuma açıkken sorulur
      const room = o.onMore ? Math.max(1, o.room ?? 1) : 1;
      const choice = await openScan(file, o.kind, o.read, room, (close) => (closeScan.current = close));
      closeScan.current = null;
      if (!choice) {
        setPhase({ kind: "idle" });
        return null;
      }
      if (choice.kind === "scan") {
        scan = choice;
        more = choice.more ?? [];
      } else source = choice.file;
    }
    const first = await send(o, scan, source);
    // Birleştirilemeyen uzun fişin sonraki parçaları: sırayla ayrı fotoğraf (biri olmazsa kalanlar bırakılır)
    for (const part of more) {
      if (!first) break;
      const res = await send(o, part, part.original);
      if (!res) break;
      o.onMore?.(res);
    }
    return first;
  }

  /** Bir fotoğrafı (taranmışsa asıl hâli ve tarama bilgisiyle) küçültüp yükler */
  async function send(o: { kind: PhotoKind; day: string; read: boolean }, scan: { scanned: Blob; info: ScanInfo; original: Blob } | null, source: Blob): Promise<PhotoUploadResponse | null> {
    setPhase({ kind: "compressing" });
    let blob: Blob;
    let original: Blob | null = null;
    try {
      if (scan) {
        blob = scan.scanned;
        original = await compressImage(scan.original, ORIGINAL_COMPRESS);
      } else blob = await compressImage(source);
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof PhotoCompressError ? e.message : COMPRESS_ERROR_TEXT });
      return null;
    }
    const form = new FormData();
    form.append("dosya", blob, "foto.jpg");
    if (scan && original) {
      form.append("asil", original, "asil.jpg");
      form.append("tarama", JSON.stringify(scan.info));
    }
    form.append("tur", o.kind);
    form.append("gun", o.day);
    if (o.read) form.append("oku", "1");
    setPhase({ kind: "uploading", size: blob.size + (original?.size ?? 0) });
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
  // İzin sonradan verildiyse canlı vizör yeniden denenir
  useEffect(() => refreshLiveCamera(), []);
  // Canlı vizör (çekilen dosya döner) ya da telefonun kamerası (dosya alanın change olayıyla gelir)
  const shoot = async () => {
    const file = await shootPhoto(cameraRef.current);
    if (file) onPick(file);
  };
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <Button variant="secondary" disabled={disabled} onClick={() => void shoot()} className="flex-1 text-ink pointer-fine:hidden max-sm:min-h-12">
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
  const text = phase.kind === "scanning" ? "Belge taranıyor…" : phase.kind === "compressing" ? "Fotoğraf küçültülüyor…" : phase.kind === "uploading" ? `Yükleniyor… ${formatBytes(phase.size)}` : phase.kind === "reading" ? "Okunuyor… genelde 5–10 saniye" : null;
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

"use client";

import { Camera, LoaderCircle, RotateCcw, RotateCw } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";

import { PhotoViewer } from "@/components/panel/photo-viewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { DAY_CLOSED_TEXT, NOTE_MAX, timeTR, type AnswerLite, type ChecklistItemSnap, type RunLite } from "@/lib/checklists";
import { compressImage, COMPRESS_ERROR_TEXT, PhotoCompressError, PHOTO_COMPRESS } from "@/lib/photo-compress";
import { photoUrl, uploadErrorText } from "@/lib/photo-rules";
import { cn } from "@/lib/utils";

import type { Submit } from "./run-form";

/** Yükleme en çok bu kadar bekler (yavaş bağlantı); sonra "Tekrar dene" */
const UPLOAD_TIMEOUT_MS = 60_000;

type Phase =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "uploading"; preview: string }
  | { kind: "error"; preview: string; message: string };

/** Fotoğrafın yanıtı ve listenin özeti (POST /api/kontrol/foto) */
type UploadResult = { ok: true; answer: AnswerLite; summary: RunLite; completedNow: boolean };

/**
 * Fotoğraflı madde: "Fotoğraf çek" telefonun arka kamerasını açar (<input capture>: getUserMedia değil, panelin
 * camera=() kuralı değişmez; masaüstünde dosya seçici açılır). Fotoğraf telefonda küçültülür (PHOTO_COMPRESS; EXIF ve
 * konum düşer), önizlemesi soluk görünürken POST /api/kontrol/foto ile yüklenir; yanıt aynı istekte yazılır. Hata olursa
 * küçültülmüş fotoğraf bellekte kalır, "Tekrar dene" onu yeniden yollar; başarı, yeniden çekme ve sayfadan çıkışta
 * bırakılır. Yükleme Server Action değil: işaretler fotoğrafı beklemesin (eylemler istemcide sırayla gider).
 */
export function PhotoItem({
  item,
  answer,
  templateId,
  day,
  photos,
  submit,
  onUploaded,
  onRefused,
}: {
  item: ChecklistItemSnap;
  answer: AnswerLite | null;
  templateId: number;
  day: string;
  photos: boolean;
  submit: Submit;
  onUploaded: (itemId: number, answer: AnswerLite, completedNow: boolean) => void;
  onRefused: (error: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const blobRef = useRef<Blob | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [viewer, setViewer] = useState<{ id: number; caption: string } | null>(null);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const preview = phase.kind === "uploading" || phase.kind === "error" ? phase.preview : null;

  // Önizleme adresi bırakılır (yeni fotoğraf, başarı ya da sayfadan çıkış)
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  async function upload(blob: Blob, url: string) {
    setPhase({ kind: "uploading", preview: url });
    const form = new FormData();
    form.append("foto", blob, "foto.jpg");
    form.append("templateId", String(templateId));
    form.append("date", day);
    form.append("itemId", String(item.id));
    let status = 0;
    let body: unknown = null;
    try {
      const res = await fetch("/api/kontrol/foto", { method: "POST", body: form, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
      status = res.status;
      body = await res.json().catch(() => null);
    } catch {
      status = 0;
    }
    const ok = status === 200 && body !== null && (body as { ok?: unknown }).ok === true;
    if (!ok) {
      const message = uploadErrorText(status, body);
      // Gün döndü ya da liste değişti: fotoğraf bırakılır, sayfa yeni günün listesini açar
      if (message === DAY_CLOSED_TEXT || message.startsWith("Liste değişti")) {
        blobRef.current = null;
        setPhase({ kind: "idle" });
        onRefused(message);
        return;
      }
      setPhase({ kind: "error", preview: url, message });
      return;
    }
    blobRef.current = null;
    setPhase({ kind: "idle" });
    const r = body as UploadResult;
    onUploaded(item.id, r.answer, r.completedNow);
  }

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Aynı fotoğraf yeniden seçilebilsin
    e.target.value = "";
    if (!file) return;
    setPhase({ kind: "preparing" });
    let blob: Blob;
    try {
      blob = await compressImage(file, PHOTO_COMPRESS);
    } catch (err) {
      setPhase({ kind: "idle" });
      toast.error(err instanceof PhotoCompressError ? err.message : COMPRESS_ERROR_TEXT);
      return;
    }
    blobRef.current = blob;
    await upload(blob, URL.createObjectURL(blob));
  }

  const retry = () => {
    const blob = blobRef.current;
    if (!blob || phase.kind !== "error") return;
    void upload(blob, phase.preview);
  };
  const take = () => inputRef.current?.click();
  const busy = phase.kind === "preparing" || phase.kind === "uploading";

  const saveNote = async () => {
    setSavingNote(true);
    const ok = await submit(item, { op: "note", note: note.trim() || null }, answer ? { ...answer, note: note.trim() || null } : undefined);
    setSavingNote(false);
    if (ok) setNoting(false);
  };

  if (!photos && !answer?.photoAt) {
    return <p className="text-[13px] text-ink-mute">Fotoğraf deposu bu ortamda kurulu değil; bu madde şimdilik doldurulamaz.</p>;
  }

  return (
    <div className="space-y-2.5">
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      {preview ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- bellekteki önizleme (blob:) */}
          <img src={preview} alt="" className={cn("h-24 w-32 shrink-0 rounded-xl object-cover ring-1 ring-line", phase.kind === "uploading" && "opacity-60")} />
          {phase.kind === "uploading" ? (
            <p aria-live="polite" className="flex items-center gap-2 text-[13px] text-ink-mute">
              <LoaderCircle size={14} className="shrink-0 animate-spin" aria-hidden="true" /> Yükleniyor…
            </p>
          ) : null}
        </div>
      ) : answer?.photoId ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setViewer({ id: answer.photoId!, caption: item.label })}
            aria-label={`${item.label} fotoğrafını büyüt`}
            className="h-24 w-32 shrink-0 cursor-pointer overflow-hidden rounded-xl bg-panel ring-1 ring-line hover:ring-line-strong"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- yetkili yol; görsel iyileştirici giriş çerezini taşımaz */}
            <img src={photoUrl(answer.photoId)} alt="" decoding="async" className="size-full object-cover" />
          </button>
          <div className="min-w-0 flex-1 space-y-1 text-[13px]">
            <p className="text-ink-mute">Çekildi {answer.photoAt ? timeTR(answer.photoAt) : ""}</p>
            {answer.note && !noting ? <p className="text-pretty break-words text-ink-soft">Not: {answer.note}</p> : null}
          </div>
        </div>
      ) : answer?.photoAt ? (
        <p className="text-[13px] text-ink-mute">Fotoğraf çekildi; şu an görüntülenemiyor.</p>
      ) : null}

      {phase.kind === "preparing" ? (
        <p aria-live="polite" className="flex items-center gap-2 text-[13px] text-ink-mute">
          <LoaderCircle size={14} className="shrink-0 animate-spin" aria-hidden="true" /> Hazırlanıyor…
        </p>
      ) : null}
      {phase.kind === "error" ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-bad">
          <span className="min-w-0 flex-1">Yüklenemedi: {phase.message}</span>
          <Button size="sm" variant="secondary" onClick={retry}>
            <RotateCw size={14} aria-hidden="true" /> Tekrar dene
          </Button>
        </div>
      ) : null}

      {noting ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label={`${item.label}: not`} value={note} maxLength={NOTE_MAX} placeholder="Kısa not" onChange={(e) => setNote(e.target.value)} className="min-w-0 flex-1 max-sm:h-12" />
          <Button onClick={saveNote} disabled={savingNote} className="max-sm:h-12">
            Kaydet
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setNoting(false)} disabled={savingNote}>
            Vazgeç
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {answer?.photoAt || phase.kind === "error" ? (
          <Button variant="secondary" onClick={take} disabled={busy || !photos} className="text-ink max-sm:h-12 max-sm:flex-1">
            <RotateCcw size={16} aria-hidden="true" /> Yeniden çek
          </Button>
        ) : (
          <Button variant="secondary" onClick={take} disabled={busy} className="w-full text-ink max-sm:h-12 sm:w-auto">
            <Camera size={16} aria-hidden="true" /> Fotoğraf çek
          </Button>
        )}
        {answer?.photoAt && !noting && !busy ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setNote(answer.note ?? "");
              setNoting(true);
            }}
            className="text-ink underline decoration-line-strong underline-offset-2"
          >
            {answer.note ? "Notu değiştir" : "Not ekle"}
          </Button>
        ) : null}
      </div>
      <PhotoViewer photo={viewer} onClose={() => setViewer(null)} />
    </div>
  );
}

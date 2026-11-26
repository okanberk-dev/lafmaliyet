"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { photoUrl } from "@/lib/photo-rules";
import { originalPhotoUrl } from "@/lib/photo-scan";

type Variant = "taranmis" | "asil";

/**
 * Fotoğrafın büyük hâli (telefonda alttan açılan sayfa; yakınlaştırma tarayıcının). Görsel yalnız panelin yetkili
 * yolundan gelir; açılamazsa (silinmiş, süresi dolmuş, yetki yok) boş resim yerine kısa bir metin görünür. Belge
 * taranarak yüklendiyse (docs/FOTOGRAF.md › Belge tarama) "Taranmış / Orijinal" seçimi çıkar: asıl fotoğrafın varlığı
 * aynı yetkili yoldan, indirmeden sorulur (HEAD /api/foto/{id}?v=asil).
 */
export function PhotoViewer({ photo, onClose }: { photo: { id: number; caption: string } | null; onClose: () => void }) {
  const [failed, setFailed] = useState<string | null>(null);
  const [withOriginal, setWithOriginal] = useState<number | null>(null);
  const [choice, setChoice] = useState<{ id: number; variant: Variant } | null>(null);
  const id = photo?.id ?? null;

  useEffect(() => {
    if (id === null) return;
    const ac = new AbortController();
    fetch(originalPhotoUrl(id), { method: "HEAD", cache: "no-cache", signal: ac.signal })
      .then((r) => {
        if (r.ok) setWithOriginal(id);
      })
      .catch(() => {});
    return () => ac.abort();
  }, [id]);

  const variant: Variant = photo && choice?.id === photo.id ? choice.variant : "taranmis";
  const src = photo ? (variant === "asil" ? originalPhotoUrl(photo.id) : photoUrl(photo.id)) : "";
  return (
    <Dialog
      open={photo !== null}
      onClose={onClose}
      title={photo?.caption ?? "Fotoğraf"}
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Kapat
        </Button>
      }
    >
      {photo ? (
        <div className="flex flex-col gap-3">
          {withOriginal === photo.id ? (
            <Segmented
              label="Fotoğrafın hâli"
              value={variant}
              onChange={(v) => setChoice({ id: photo.id, variant: v })}
              options={[
                { value: "taranmis", label: "Taranmış" },
                { value: "asil", label: "Orijinal" },
              ]}
              className="self-center"
            />
          ) : null}
          <div className="flex justify-center rounded-2xl bg-panel p-2">
            {failed === src ? (
              <p className="px-3 py-8 text-sm text-ink-mute">Fotoğraf açılamadı; silinmiş ya da saklama süresi dolmuş olabilir.</p>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- yetkili yol; görsel iyileştirici giriş çerezini taşımaz
              <img
                key={src}
                src={src}
                alt={variant === "asil" ? `${photo.caption} (orijinal)` : photo.caption}
                decoding="async"
                className="max-h-[70vh] w-auto max-w-full rounded-xl object-contain"
                onError={() => setFailed(src)}
              />
            )}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

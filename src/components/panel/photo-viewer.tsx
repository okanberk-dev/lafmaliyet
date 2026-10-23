"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { photoUrl } from "@/lib/photo-rules";

/**
 * Fotoğrafın büyük hâli (telefonda alttan açılan sayfa; yakınlaştırma tarayıcının). Görsel yalnız panelin yetkili
 * yolundan gelir; açılamazsa (silinmiş, süresi dolmuş, yetki yok) boş resim yerine kısa bir metin görünür.
 */
export function PhotoViewer({ photo, onClose }: { photo: { id: number; caption: string } | null; onClose: () => void }) {
  const [failed, setFailed] = useState<number | null>(null);
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
        <div className="flex justify-center rounded-2xl bg-panel p-2">
          {failed === photo.id ? (
            <p className="px-3 py-8 text-sm text-ink-mute">Fotoğraf açılamadı; silinmiş ya da saklama süresi dolmuş olabilir.</p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- yetkili yol; görsel iyileştirici giriş çerezini taşımaz
            <img
              key={photo.id}
              src={photoUrl(photo.id)}
              alt={photo.caption}
              decoding="async"
              className="max-h-[70vh] w-auto max-w-full rounded-xl object-contain"
              onError={() => setFailed(photo.id)}
            />
          )}
        </div>
      ) : null}
    </Dialog>
  );
}

"use client";

import { Check, Coffee, Mic, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { matches, SearchField } from "@/components/ui/filters";
import { IconTile, toneFor } from "@/components/ui/icon-tile";
import { num, tl } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Seçicinin ürünü (yalnız yönetici ekranları: Satışlar, Ayarlar › LafPOS; maliyet ve fiyat görünür) */
export interface ProductOption {
  id: number;
  name: string;
  size: string;
  category: string;
  cost: number;
  price: number;
  active: boolean;
}

const PICKER_LIMIT = 80;

/**
 * POS adını menüdeki bir ürüne (ya da HİZMET'e) bağlamanın penceresi: Satışlar'ın satırları ve Ayarlar › LafPOS'un
 * eşleşmeyen adları. Arama yokken şu anki eşleşme en üstte; "Eşleşmeyi kaldır" eşleşmemiş adda kapalı
 */
export function ProductPicker({
  onClose,
  products,
  title,
  currentId,
  isService,
  onPick,
}: {
  onClose: () => void;
  products: ProductOption[];
  title: string;
  currentId: number | null;
  isService: boolean;
  onPick: (v: { productId: number | null; isService: boolean }) => void;
}) {
  const [q, setQ] = useState("");
  const found = products.filter((p) => matches(`${p.name} ${p.size} ${p.category}`, q));
  // Arama yokken şu anki eşleşme en üstte (uzun listede aranmasın)
  const current = !isService && currentId ? found.find((p) => p.id === currentId) : undefined;
  const list = (current && !q.trim() ? [current, ...found.filter((p) => p !== current)] : found).slice(0, PICKER_LIMIT);
  return (
    <Dialog open onClose={onClose} title="Ürünle eşleştir" description={title} size="md">
      <div className="space-y-3 pb-2">
        {/* Enter ilk sonucu seçer: ada göre arayıp tek tuşla eşleştirme */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim() && list[0]) onPick({ productId: list[0].id, isService: false });
          }}
        >
          <SearchField value={q} onChange={setQ} placeholder="Ürün, boy ya da kategori" label="Menüde ara" shortcut={false} />
        </form>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onPick({ productId: null, isService: true })}
            aria-pressed={isService}
            className={cn("pointer-coarse:h-11", isService && "text-info ring-info/30")}
          >
            <Mic size={15} /> HİZMET (maliyetsiz, ör. karaoke)
            {isService ? <Check size={14} aria-hidden="true" /> : null}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onPick({ productId: null, isService: false })}
            disabled={!currentId && !isService}
            className="pointer-coarse:h-11"
            title={!currentId && !isService ? "Bu satır henüz eşleşmedi" : undefined}
          >
            <X size={15} /> Eşleşmeyi kaldır
          </Button>
        </div>
        <ul className="scroll-thin max-h-80 divide-y divide-line overflow-y-auto overscroll-contain rounded-2xl bg-surface ring-1 ring-line-strong">
          {list.map((p) => {
            const current = !isService && p.id === currentId;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  aria-current={current ? "true" : undefined}
                  className={cn(
                    "flex min-h-12 w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-panel",
                    current && "bg-panel",
                  )}
                  onClick={() => onPick({ productId: p.id, isService: false })}
                >
                  <IconTile size="sm" tone={toneFor(p.category)}>
                    <Coffee />
                  </IconTile>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-ink">{p.name}</span>
                      <Badge tone="gray">{p.size}</Badge>
                      {!p.active ? <Badge tone="amber">Pasif</Badge> : null}
                    </span>
                    <span className="block text-xs text-ink-mute">{p.category}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-ink-mute tabular">
                    <span className="text-ink-soft">{tl(p.price)}</span>
                    <span className="block">maliyet {tl(p.cost, 2)}</span>
                  </span>
                  {current ? (
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-white">
                      <Check size={13} aria-label="Şu anki eşleşme" />
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
          {!list.length ? (
            <li className="px-3 py-4 text-sm text-ink-mute">
              Sonuç yok. Ürün yoksa önce{" "}
              <Link href="/panel/urunler" className="font-medium text-ink underline underline-offset-2">
                Ürünler
              </Link>{" "}
              sayfasından ekleyin.
            </li>
          ) : null}
        </ul>
        {found.length > PICKER_LIMIT || (q.trim() && list.length) ? (
          <p className="text-xs text-ink-mute">
            {found.length > PICKER_LIMIT ? `İlk ${PICKER_LIMIT} sonuç gösteriliyor (${num(found.length)} ürün). Aramayı daraltın. ` : null}
            {q.trim() && list.length ? "Enter ilk sonucu seçer." : null}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}


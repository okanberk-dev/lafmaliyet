"use client";

import { KeyRound, Link2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmPasswordDialog } from "@/components/panel/confirm-password-dialog";
import { useActionTransition } from "@/components/ui/action-error";
import { Button, IconButton } from "@/components/ui/button";
import { num } from "@/lib/format";
import { ASILPOS_RESEND_HINT } from "@/lib/asilpos/status";
import { dayMonthYearTR } from "@/lib/asilpos/switch";
import { isStepUpError } from "@/lib/step-up";
import { deleteAsilposDay, testAsilposKeys } from "@/server/actions/asilpos";
import { matchAsilposName } from "@/server/actions/sales";

import { ProductPicker, type ProductOption } from "../satislar/product-picker";

/**
 * Bir günün AsilPOS kaydını sil (409 z_conflict'in çözümü ya da deneme gününün temizliği): yöneticinin parolasıyla.
 * AsilPOS reddedilen ya da silinen günü kendisi yeniden göndermez: yenisi AsilPOS'ta Kasa › Geçmiş günler › o günün Z
 * raporu › Gönder ile gelir (ASILPOS_RESEND_HINT). `label` verilirse metinli düğme, yoksa satır sonunda çöp kutusu.
 */
export function AsilposDayDelete({ branchId, date, zNo, lines, label }: { branchId: string; date: string; zNo: number; lines: number; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const title = `${dayMonthYearTR(date)} AsilPOS kaydını sil`;
  return (
    <>
      {label ? (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)} className="max-sm:w-full">
          <Trash2 size={14} aria-hidden="true" /> {label}
        </Button>
      ) : (
        <IconButton tone="danger" label={title} onClick={() => setOpen(true)}>
          <Trash2 size={16} aria-hidden="true" />
        </IconButton>
      )}
      {open ? (
        <ConfirmPasswordDialog
          title={title}
          description={`Günün özeti (Z ${zNo}) ve ${lines} satış satırı silinir; geri alınamaz. ${ASILPOS_RESEND_HINT}`}
          confirmLabel="Sil"
          danger
          onClose={() => setOpen(false)}
          onConfirm={async (password) => {
            const res = await deleteAsilposDay({ branchId, date, zNo }, { password });
            if (!res.ok) {
              // Parola hataları pencerede kalır; öteki hatalar (gün yeniden gönderildi) bildirimle
              if (isStepUpError(res.error)) return res.error;
              setOpen(false);
              toast.error(res.error);
              router.refresh();
              return null;
            }
            setOpen(false);
            toast.success(`${dayMonthYearTR(date)} silindi (Z ${res.data.zNo}, ${res.data.lines} satır)`);
            router.refresh();
            return null;
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Ürüne bağlanamayan POS adları (Ayarlar › AsilPOS kartı; denetim E-33): her ad menüdeki bir ürüne ya da HİZMET'e
 * bağlanır. Ad Satışlar'ın POS adı hafızasına yazılır ve bu adla gelmiş bütün ürünsüz AsilPOS satırları (deneme günleri
 * dahil) yeniden gönderim olmadan bağlanır; sonraki gün sonları da tanır. Geçiş günü boşken AsilPOS adları yalnız bu
 * kartta görünür (sahibin kararı); bağlama hiçbir hesabı değiştirmez ama ad hafızası ModPOS listeleriyle ortaktır: aynı
 * ad sonraki ModPOS yüklemelerinde de tanınır. Yalnız AsilPOS'ta geçen ad kasadaki (ModPOS) fiyat listesinde "Kasada"
 * diye gösterilmez (src/server/data/pos-staff.ts modposNameFilter).
 */
export function AsilposUnmatchedList({
  items,
  more,
  products,
  ikram = false,
}: {
  items: { posName: string; qty: number; days: number }[];
  more: number;
  products: ProductOption[];
  /** İkramın adları: bağ okuma anında çözülür, geçmiş günlerin ikramı da o ürünle sayılır */
  ikram?: boolean;
}) {
  const router = useRouter();
  const [picking, setPicking] = useState<{ posName: string; qty: number } | null>(null);
  const [pending, start] = useActionTransition();
  const pick = (posName: string, v: { productId: number | null; isService: boolean }) =>
    start(async () => {
      setPicking(null);
      const res = await matchAsilposName({ month: null, posName, productId: v.productId, isService: v.isService });
      if (!res.ok) return void toast.error(res.error);
      toast.success(v.isService ? "HİZMET olarak işaretlendi" : "Bağlandı", {
        description: ikram
          ? `“${posName}”: AsilPOS'un ikramı bu ürünle sayılıyor (geçmiş günler de); sonraki gün sonlarında otomatik tanınacak.`
          : `“${posName}”: ${num(res.data.others)} AsilPOS satırı bağlandı; sonraki gün sonlarında otomatik tanınacak.`,
      });
      router.refresh();
    });
  return (
    <>
      <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
        {items.map((u) => (
          <li key={u.posName} className="flex items-center gap-3 px-4 py-2 text-sm">
            <p className="min-w-0 flex-1">
              <span className="font-medium break-words text-ink">{u.posName}</span>
              <span className="block text-[13px] text-ink-mute tabular">
                {num(u.qty)} adet · {num(u.days)} gün
              </span>
            </p>
            <Button size="sm" variant="secondary" onClick={() => setPicking(u)} disabled={pending} className="shrink-0 pointer-coarse:h-11">
              <Link2 size={14} aria-hidden="true" /> Bağla
            </Button>
          </li>
        ))}
      </ul>
      {more > 0 ? <p className="text-[13px] text-ink-mute">ve {num(more)} ad daha (en çok {ikram ? "ikram edilen" : "satılan"} 10 ad gösteriliyor)</p> : null}
      {picking ? (
        <ProductPicker
          key={picking.posName}
          onClose={() => setPicking(null)}
          products={products}
          title={`${picking.posName} (${num(picking.qty)} adet, AsilPOS)`}
          currentId={null}
          isService={false}
          onPick={(v) => pick(picking.posName, v)}
        />
      ) : null}
    </>
  );
}

/**
 * Ayarlar › AsilPOS › Uzaktan ve site anahtarı › Anahtarları sına (docs/ASILPOS.md › Anahtar değişimi): iki uç panelin
 * dağıttığı anahtarı şimdi kabul ediyor mu; sonuç bildirimde, kart yeni durumu gösterir
 */
export function AsilposKeyTest() {
  const [pending, start] = useActionTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      className="max-sm:w-full"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await testAsilposKeys();
          if (!res.ok) return void toast.error(res.error);
          if (res.data.ok) toast.success("Anahtarlar uyumlu", { description: res.data.ozet });
          else if (res.data.panelEski) toast.warning("Panelin anahtarı eski", { description: res.data.ozet });
          else toast.error("Anahtar uyuşmuyor", { description: res.data.ozet });
        })
      }
    >
      <KeyRound size={15} aria-hidden="true" className={pending ? "animate-pulse" : undefined} />
      {pending ? "Sınanıyor…" : "Anahtarları sına"}
    </Button>
  );
}

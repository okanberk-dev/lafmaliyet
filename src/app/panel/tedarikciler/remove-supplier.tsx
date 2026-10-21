"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { keepScroll } from "@/components/ui/filters";
import { money, num } from "@/lib/format";
import { removeSupplier, restoreSupplier, unhideSupplier } from "@/server/actions/suppliers";

import { supplierHref } from "./logic";

export interface RemoveTarget {
  cardId: number | null;
  key: string;
  name: string;
  invoiceCount: number;
  openCount: number;
  open: number;
}

/**
 * Tedarikçiyi silme penceresi. Faturası yoksa kartı silinir. Faturası varsa faturalar silinmez (gider ve aylık
 * hesaplar değişmesin), tedarikçi listeden kaldırılır. Ödenmemiş faturası varsa kaldırılamaz; pencere nedenini söyler.
 * Bildirimdeki "Geri al" ikisini de geri getirir ve tedarikçinin sayfasını açar. `onDone`: silindi ya da kaldırıldı
 * (sayfa listeye döner).
 */
export function RemoveSupplierDialog({ target, onClose, onDone }: { target: RemoveTarget; onClose: () => void; onDone: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const { name } = target;

  if (target.openCount) {
    return (
      <Dialog
        open
        onClose={onClose}
        size="sm"
        title="Önce borç kapanmalı"
        footer={
          <Button onClick={onClose} data-autofocus>
            Tamam
          </Button>
        }
      >
        <p className="text-sm leading-6 text-ink-mute">
          {name}: {num(target.openCount)} ödenmemiş fatura ({money(target.open)}). Borcu olan tedarikçi silinemez: faturaları ödendiyse Ödendi yapın, yanlış geldiyse
          Faturalar&apos;dan silin.
        </p>
      </Dialog>
    );
  }

  const hides = target.invoiceCount > 0;

  async function confirm() {
    setPending(true);
    keepScroll();
    const r = await removeSupplier({ cardId: target.cardId, key: target.key });
    setPending(false);
    if (!r.ok) return void toast.error(r.error);
    onClose();
    onDone();
    const res = r.data;
    const undo = async () => {
      keepScroll();
      const back = res.mode === "deleted" ? await restoreSupplier(res.snapshot) : await unhideSupplier({ cardId: res.cardId, created: res.created });
      if (!back.ok) return void toast.error(back.error);
      toast.success(res.mode === "deleted" ? "Tedarikçi geri alındı" : "Tedarikçi listeye geri alındı", { description: name });
      if (back.data.slug) router.push(supplierHref(back.data.slug));
    };
    toast.success(res.mode === "deleted" ? "Tedarikçi silindi" : "Tedarikçi listeden kaldırıldı", {
      description: res.mode === "deleted" ? name : `${name} · faturaları Faturalar'da duruyor`,
      action: { label: "Geri al", onClick: () => void undo() },
      duration: 10000,
    });
  }

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={confirm}
      pending={pending}
      title={hides ? "Tedarikçi listeden kaldırılsın mı?" : "Tedarikçi silinsin mi?"}
      confirmLabel={hides ? "Listeden kaldır" : "Sil"}
      description={
        hides
          ? `${name} listeden kalkar; ${num(target.invoiceCount)} faturası Faturalar'da kalır, giderler ve aylık hesaplar değişmez. Bilgileri saklanır: listenin altındaki “Listeden kaldırılanlar”dan geri getirebilirsiniz. Yeni faturası gelirse listeye kendiliğinden döner.`
          : `${name}: unvan, IBAN ve iletişim bilgileri silinir. Bildirimdeki “Geri al” ile geri getirebilirsiniz.`
      }
    />
  );
}

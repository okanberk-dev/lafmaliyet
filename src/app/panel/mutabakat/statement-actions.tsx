"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteStatement } from "@/server/actions/mutabakat";

/** Ekstreyi sil: satırları ve kararları da gider (panel kayıtlarına dokunmaz) */
export function DeleteStatement({ id, label }: { id: number; label: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useActionTransition();
  const router = useRouter();
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} disabled={pending}>
        <Trash2 size={15} /> Sil
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        pending={pending}
        title="Ekstre silinsin mi?"
        description={`${label}: hareketler ve verdiğiniz eşleştirme kararları silinir. Panel kayıtları (fatura, harcama, ödeme) değişmez; dosyayı yeniden yükleyebilirsiniz.`}
        onConfirm={() =>
          start(async () => {
            const r = await deleteStatement(id);
            if (!r.ok) return void toast.error(r.error);
            setOpen(false);
            toast.success("Ekstre silindi");
            router.push("/panel/mutabakat");
          })
        }
      />
    </>
  );
}

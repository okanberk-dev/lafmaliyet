"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cancelParasutConnection, confirmParasutConnection } from "@/server/actions/parasut";

/** Paraşüt dönüşünde onaya bekletilen bağlantının sorusu (metin sunucuda kurulur: src/lib/parasut/company.ts taxConfirmCopy) */
export interface ConnectQuestion {
  account: string;
  /** "same": aynı vergi numarası; "unknown": karşılaştırılamadı */
  kind: "same" | "unknown";
  title: string;
  description: string;
  confirmLabel: string;
}

/**
 * "Aynı vergi numarası mı?" (docs/PARASUT.md › Şube başına Paraşüt hesabı › Aynı vergi numarası): ikinci Paraşüt
 * firması bağlanırken vergi numarası başka hesabın firmasınınkiyle aynı çıktıysa (ya da okunamadıysa) Paraşüt'ün verdiği
 * yetki yazılmadan bekler. Pencere sayfa açılınca kendiliğinden açılır: onaylanırsa yetki yazılır, "Vazgeç" (ya da
 * pencereyi kapatmak) bağlantıyı siler. Aynı faturalar iki hesaptan gelip iki kez sayılmasın.
 */
export function ConnectQuestionDialog({ question }: { question: ConnectQuestion }) {
  const [pending, start] = useActionTransition();
  const [open, setOpen] = useState(true);

  const answer = (connect: boolean) =>
    start(async () => {
      const r = connect ? await confirmParasutConnection(question.account) : await cancelParasutConnection(question.account);
      if (!r.ok) return void toast.error(r.error);
      setOpen(false);
      if (connect) toast.success("Paraşüt hesabı bağlandı");
      else toast("Paraşüt hesabı bağlanmadı", { description: "Paraşüt'ün verdiği yetki silindi." });
    });

  return (
    <ConfirmDialog
      open={open}
      onClose={() => answer(false)}
      onConfirm={() => answer(true)}
      tone={question.kind === "same" ? "danger" : "primary"}
      title={question.title}
      description={<p className="text-pretty">{question.description}</p>}
      confirmLabel={question.confirmLabel}
      pending={pending}
    />
  );
}

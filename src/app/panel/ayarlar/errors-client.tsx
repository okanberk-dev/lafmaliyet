"use client";

import { Check, CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { resolveAllErrorEntries, resolveErrorEntry } from "@/server/actions/error-log";

/** Satırın "Çözüldü"sü: satır açık listeden çıkar, hata yeniden görülürse geri gelir */
export function ResolveErrorButton({ id }: { id: number }) {
  const router = useRouter();
  const [pending, start] = useActionTransition();
  return (
    <Button
      variant="ghost"
      size="xs"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await resolveErrorEntry(id);
          if (!res.ok) return void toast.error(res.error);
          router.refresh();
        })
      }
    >
      <Check size={14} aria-hidden="true" /> Çözüldü
    </Button>
  );
}

/** Açık satırların hepsi çözüldü */
export function ResolveAllErrorsButton({ count }: { count: number }) {
  const router = useRouter();
  const [pending, start] = useActionTransition();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      className="max-sm:w-full"
      onClick={() =>
        start(async () => {
          const res = await resolveAllErrorEntries();
          if (!res.ok) return void toast.error(res.error);
          toast.success(res.data.resolved ? `${res.data.resolved} satır çözüldü işaretlendi` : "Açık satır yok");
          router.refresh();
        })
      }
    >
      <CheckCheck size={16} aria-hidden="true" /> Hepsi çözüldü ({count})
    </Button>
  );
}

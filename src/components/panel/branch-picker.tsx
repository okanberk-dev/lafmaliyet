"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import {
  ALL_BRANCHES,
  BRANCH_PARAM,
  branchLinkStep,
  type BranchRow,
  type BranchScope,
  sortBranches,
} from "@/lib/branches";
import { chooseBranchScope } from "@/server/actions/branches";

import { useActionTransition } from "../ui/action-error";
import { Select } from "../ui/form";
import { BRANCH_LEAVE } from "../ui/leave-guard";

/**
 * Panelin şube seçicisi (docs/SUBE.md › Seçici). Kenar çubuğunun başlığının altında durur: masaüstünde sürekli
 * görünür, telefonda çekmecenin içinde.
 *
 * Seçim yalnız görünümü süzer, yetki vermez. Tek kaynağı ÇEREZ'dir (`chooseBranchScope`): Next'te `layout.tsx`
 * adresin sorgusunu almaz, yani seçici `?sube=`'yi kendi başına göremez — çerez olmasa kenar çubuğu ile sayfanın
 * içeriği ayrı şube gösterebilirdi. Paylaşılan bağlantıdaki `?sube=` bu yüzden açılışta çereze BENİMSETİLİR ve
 * adresten düşürülür: bağlantı yine çalışır, panelin tamamı tek seçimde kalır.
 *
 * Tek şube açıkken seçici gösterilmez: tek şubeli bir işletmeye "Tümü / Tuzla" sormak gürültü olur.
 */
export function BranchPicker({ scope, branches, locked = false }: { scope: BranchScope; branches: readonly BranchRow[]; locked?: boolean }) {
  const [pending, run] = useActionTransition();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  /** Benimsenen bağlantı (yol + sorgu); adreste ?sube= yokken null */
  const benimsenen = useRef<string | null>(null);

  // Derin bağlantı: her bağlantının ?sube='si BİR KEZ çereze yazılır ve adresten düşer (çerez zaten oysa yalnız düşer).
  // Anahtar bağlantının kendisi, değer değil: aynı bağlantı yeniden açılınca yine benimsenir; adreste kalmış eski
  // ?sube= de seçiciden sonradan yapılan seçimi geri almaz (branchLinkStep; denetim 21 Kasım #22). Şubesi kilitli
  // personelde benimsenmez (sunucu da reddeder).
  useEffect(() => {
    const adim = branchLinkStep({ pathname, search, scope, branches, locked, adopted: benimsenen.current });
    benimsenen.current = adim.key;
    if (!adim.adopt) return;
    const { scope: secim, href } = adim.adopt;
    run(async () => {
      if (secim !== null) await chooseBranchScope({ scope: secim });
      router.replace(href);
    });
  }, [pathname, search, scope, branches, locked, router, run]);

  const acik = sortBranches(branches.filter((b) => b.active));
  if (acik.length < 2) return null;

  // Şubesi yönetici tarafından belirlenen personel: seçici yerine yalnız şubenin adı
  if (locked) {
    return (
      <div className="shrink-0 px-1">
        <p className="mb-1.5 text-[11px] font-medium text-chart-muted">Şube</p>
        <p className="rounded-xl bg-surface px-3 py-2 text-sm font-medium text-ink ring-1 ring-line ring-inset">{acik.find((b) => b.id === scope)?.name ?? scope}</p>
      </div>
    );
  }

  return (
    <div className="shrink-0 px-1">
      <label htmlFor="sube-secici" className="mb-1.5 block text-[11px] font-medium text-chart-muted">
        Şube
      </label>
      <Select
        id="sube-secici"
        value={scope}
        disabled={pending}
        aria-busy={pending}
        onChange={(e) => {
          const secim = e.target.value;
          // Kaydedilmemiş form (Stok sayımı; şube değişince baştan kurulur) önce sorar: olayı iptal eder, seçici yerinde
          // kalır. "Kaydetmeden geç" bu adrese gider, ?sube= yukarıdaki etkiyle çereze benimsenir (src/components/ui/leave-guard.ts)
          const q = new URLSearchParams(search);
          q.set(BRANCH_PARAM, secim);
          if (!window.dispatchEvent(new CustomEvent(BRANCH_LEAVE, { cancelable: true, detail: `${pathname}?${q}` }))) {
            e.target.value = scope;
            return;
          }
          run(() => chooseBranchScope({ scope: secim }), { maybeSaved: true });
        }}
      >
        <option value={ALL_BRANCHES}>Tümü</option>
        {acik.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

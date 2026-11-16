"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import {
  ALL_BRANCHES,
  BRANCH_PARAM,
  parseBranchScope,
  type BranchRow,
  type BranchScope,
  sortBranches,
} from "@/lib/branches";
import { chooseBranchScope } from "@/server/actions/branches";

import { useActionTransition } from "../ui/action-error";
import { Select } from "../ui/form";

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
  const params = useSearchParams();
  const benimsenen = useRef<string | null>(null);

  // Derin bağlantı: ?sube= çereze yazılır, sonra adresten düşürülür (bir kez; çerez eşitlenince koşul kapanır)
  const istenen = parseBranchScope(params.get(BRANCH_PARAM), branches);
  // Şubesi kilitli personelde derin bağlantı benimsenmez (sunucu da reddeder)
  const farkli = !locked && params.has(BRANCH_PARAM) && istenen !== scope;
  useEffect(() => {
    if (!farkli || benimsenen.current === istenen) return;
    benimsenen.current = istenen;
    run(async () => {
      await chooseBranchScope({ scope: istenen });
      const kalan = new URLSearchParams(params);
      kalan.delete(BRANCH_PARAM);
      const qs = kalan.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }, [farkli, istenen, params, pathname, router, run]);

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

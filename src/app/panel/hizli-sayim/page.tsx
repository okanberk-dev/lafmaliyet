import { ShoppingBasket } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { ButtonLink } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/misc";
import { num } from "@/lib/format";
import { requireUser } from "@/server/auth/dal";
import { loadQuickCountSheet } from "@/server/data/reorder";

import { QuickCountForm } from "./quick-count-form";

export const metadata: Metadata = { title: "Hızlı sayım" };

/**
 * Hızlı sayım (docs/MAL-SIPARISI.md): mal siparişi için haftalık kısa sayım, telefondan. Personel de sayar ve gelen
 * malı işaretler; ekranda fiyat, tutar ya da sipariş listesi yok (yönetici Mal siparişi'nde görür).
 */
export default function QuickCountPage() {
  return (
    <Suspense
      fallback={
        <>
          {/* Rol henüz bilinmediği için sekmeler yalnızca içerik yüklenince (yöneticiye) çizilir */}
          <PageHeader eyebrow="Stok" title="Hızlı sayım" description="Yükleniyor…" />
          <PageSkeleton rows={8} />
        </>
      }
    >
      <QuickCountContent />
    </Suspense>
  );
}

async function QuickCountContent() {
  const user = await requireUser();
  const admin = user.role === "admin";
  const sheet = await loadQuickCountSheet();
  return (
    <>
      <PageHeader
        eyebrow="Stok"
        title="Hızlı sayım"
        description={`Haftalık kısa sayım: ${num(sheet.total)} kritik kalem. Miktarı sayım biriminde yazın (KG, LT, ADET, DİLİM); yarım = 0,5. Ay sonu sayımı ayrıdır.`}
        actions={
          admin ? (
            <ButtonLink href="/panel/mal-siparisi" variant="secondary">
              <ShoppingBasket size={16} aria-hidden="true" /> Sipariş listesi
            </ButtonLink>
          ) : undefined
        }
        tabs={admin ? <SectionTabs section="malSiparisi" current="/panel/hizli-sayim" /> : undefined}
      />
      <QuickCountForm sheet={sheet} admin={admin} />
    </>
  );
}

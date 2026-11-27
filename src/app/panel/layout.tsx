import type { Metadata } from "next";
import { Suspense } from "react";

// Arc UI belirteçleri yalnız `.arc` kabının içinde (src/components/arc/README.md)
import "@/components/arc/foundation.css";
import { PanelAssistantGate } from "@/components/panel/assistant/assistant-gate";
import { Sidebar, SidebarSkeleton } from "@/components/panel/sidebar";
import { Notice } from "@/components/ui/notice";
import { assistantEnabled } from "@/lib/assistant/protocol";
import { isReadOnly } from "@/lib/roles";
import { getCurrentUser, requireUser } from "@/server/auth/dal";
import { branchScope } from "@/server/branch-scope";
import { loadSearchIndex } from "@/server/data/search";

export const metadata: Metadata = {
  title: { default: "Panel", template: "%s · L'Affogato" },
  robots: { index: false, follow: false },
};

async function SidebarWithUser() {
  const user = await requireUser();
  const [index, branch] = await Promise.all([
    user.role === "admin" ? loadSearchIndex() : Promise.resolve([]),
    branchScope(),
  ]);
  return (
    <Sidebar
      user={{ id: user.id, name: user.name, email: user.email, role: user.role }}
      index={index}
      branch={{ scope: branch.scope, branches: branch.branches, locked: branch.locked }}
      // Telefonda alt menünün "Asistan" sekmesi: asistanın kapısıyla aynı koşul (yönetici, ASISTAN_KAPALI değil)
      assistant={user.role === "admin" && assistantEnabled()}
    />
  );
}

/**
 * Salt okunur hesabın şeridi (muhasebeci; docs/ROLLER.md): her ekranın başında bir satır. Ekranda kalan bir düğmeye
 * basınca sunucu "salt okunur" diye reddeder (src/server/auth/dal.ts); şerit bunu önceden söyler
 */
async function ReadOnlyBanner() {
  const user = await getCurrentUser();
  if (!user || !isReadOnly(user.role)) return null;
  return <Notice tone="neutral" size="sm" className="mb-4" title="Salt okunur hesap" text="Kayıtları rakamlarıyla görürsünüz; değiştiremez, silemez, ekleyemezsiniz. Düzeltme için yöneticiye yazın." />;
}

/**
 * AkmanOS "App Shell": solda 17.5rem zinc-100 kenar çubuğu, sağda beyaz içerik. Telefon ve tablette (lg altı) üstte
 * yapışkan çubuk, altta alt menü; içeriğin altında alt menü kadar boşluk bırakılır (globals.css, --mobile-nav-space).
 */
export default function PanelLayout({ children }: LayoutProps<"/panel">) {
  return (
    <div data-component="app-shell" className="min-h-dvh bg-background text-foreground lg:pl-[17.5rem]">
      {/* Klavyeyle gezinenler için: menüyü atlayıp doğrudan sayfa içeriğine. Karaoke şeridi varken onun altında
          görünür (--alarm-h, globals.css). Telefonda asistanın sayfası açıkken yok (içerik etkisiz; panel-assistant.tsx) */}
      <a
        href="#icerik"
        className="no-print sr-only in-data-[assistant=sheet]:hidden focus:not-sr-only focus:fixed focus:top-[calc(var(--alarm-h)+0.75rem)] focus:left-3 focus:z-[70] focus:rounded-xl focus:bg-ink focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-on-solid"
      >
        İçeriğe geç
      </a>
      <Suspense fallback={<SidebarSkeleton />}>
        <SidebarWithUser />
      </Suspense>
      <main id="icerik" tabIndex={-1} className="min-w-0 outline-none">
        <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          {/* Ses yuvası: ses kilitliyken AlertCenter "Sesli uyarılar kapalı" satırını buraya çizer (sayfayla kayar,
              içeriği örtmez; docs/planlar/ux-sade.md §4.6). Boşken yer kaplamaz. */}
          <div id="ses-yuvasi" />
          <Suspense fallback={null}>
            <ReadOnlyBanner />
          </Suspense>
          {children}
        </div>
      </main>
      {/* Panel asistanı (yalnız yönetici; docs/ASISTAN.md): masaüstünde sağ altta düğme (yeri globals.css
          --assistant-bottom), telefonda alt menünün "Asistan" sekmesi */}
      <Suspense fallback={null}>
        <PanelAssistantGate />
      </Suspense>
    </div>
  );
}

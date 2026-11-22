import type { Metadata } from "next";
import { Suspense } from "react";

// Arc UI belirteçleri yalnız `.arc` kabının içinde (src/components/arc/README.md)
import "@/components/arc/foundation.css";
import { Sidebar, SidebarSkeleton } from "@/components/panel/sidebar";
import { requireUser } from "@/server/auth/dal";
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
    />
  );
}

/**
 * AkmanOS "App Shell": solda 17.5rem zinc-100 kenar çubuğu, sağda beyaz içerik. Telefon ve tablette (lg altı) üstte
 * yapışkan çubuk, altta alt menü; içeriğin altında alt menü kadar boşluk bırakılır (globals.css, --mobile-nav-space).
 */
export default function PanelLayout({ children }: LayoutProps<"/panel">) {
  return (
    <div data-component="app-shell" className="min-h-dvh bg-background text-foreground lg:pl-[17.5rem]">
      {/* Klavyeyle gezinenler için: menüyü atlayıp doğrudan sayfa içeriğine. Karaoke şeridi varken onun altında
          görünür (--alarm-h, globals.css) */}
      <a
        href="#icerik"
        className="no-print sr-only focus:not-sr-only focus:fixed focus:top-[calc(var(--alarm-h)+0.75rem)] focus:left-3 focus:z-[70] focus:rounded-xl focus:bg-ink focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-on-solid"
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
          {children}
        </div>
      </main>
    </div>
  );
}

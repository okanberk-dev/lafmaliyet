import type { Metadata } from "next";
import { Suspense } from "react";

import { Sidebar, SidebarSkeleton } from "@/components/panel/sidebar";
import { requireUser } from "@/server/auth/dal";
import { loadSearchIndex } from "@/server/data/search";

export const metadata: Metadata = {
  title: { default: "Panel", template: "%s · L'Affogato" },
  robots: { index: false, follow: false },
};

async function SidebarWithUser() {
  const user = await requireUser();
  const index = user.role === "admin" ? await loadSearchIndex() : [];
  return <Sidebar user={{ name: user.name, email: user.email, role: user.role }} index={index} />;
}

/** AkmanOS "App Shell": solda 17.5rem zinc-100 kenar çubuğu, sağda beyaz içerik */
export default function PanelLayout({ children }: LayoutProps<"/panel">) {
  return (
    <div data-component="app-shell" className="min-h-dvh bg-background text-foreground lg:pl-[17.5rem]">
      <Suspense fallback={<SidebarSkeleton />}>
        <SidebarWithUser />
      </Suspense>
      <main className="min-w-0">
        <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</div>
      </main>
    </div>
  );
}

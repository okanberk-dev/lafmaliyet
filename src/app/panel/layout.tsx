import type { Metadata } from "next";
import { Suspense } from "react";

import { Sidebar, SidebarSkeleton } from "@/components/panel/sidebar";
import { requireUser } from "@/server/auth/dal";

export const metadata: Metadata = {
  title: { default: "Panel", template: "%s · L'Affogato Panel" },
  robots: { index: false, follow: false },
};

async function SidebarWithUser() {
  const user = await requireUser();
  return <Sidebar user={{ name: user.name, email: user.email, role: user.role }} />;
}

export default function PanelLayout({ children }: LayoutProps<"/panel">) {
  return (
    <div className="min-h-dvh lg:pl-64">
      <Suspense fallback={<SidebarSkeleton />}>
        <SidebarWithUser />
      </Suspense>
      <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}

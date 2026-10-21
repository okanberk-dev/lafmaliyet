import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { requireUser } from "@/server/auth/dal";
import { loadMyReminders } from "@/server/data/user-reminders";

import { MyReminders } from "./my-reminders";

export const metadata: Metadata = { title: "Hatırlatıcılarım" };

export default function MyRemindersPage() {
  return (
    <>
      <PageHeader
        title="Hatırlatıcılarım"
        eyebrow="Günlük"
        description="Kendinize not ve hatırlatma: sipariş verilecekler, temizlik, aranacaklar. Yalnızca siz görürsünüz. Saat verirseniz panel açıkken saatinde sesli uyarır; bildirim açıksa sabah özeti gelir."
      />
      <Suspense fallback={<PageSkeleton rows={6} />}>
        <MyRemindersContent />
      </Suspense>
    </>
  );
}

async function MyRemindersContent() {
  const user = await requireUser();
  const { open, done } = await loadMyReminders(user.id);
  return <MyReminders role={user.role} open={open} done={done} />;
}

import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { requireUser } from "@/server/auth/dal";
import { loadMyReminders } from "@/server/data/user-reminders";

import { MyReminders } from "./my-reminders";

export const metadata: Metadata = { title: "Hatırlatıcılarım" };

/** Başlık iki rolde: bağlam satırı rolün ağacından (yöneticide "Kafe"; personelde üst düzey ekran, satır yok) */
function MyRemindersHeader({ role }: { role: "admin" | "staff" }) {
  return (
    <PageHeader
      title="Hatırlatıcılarım"
      path="/panel/hatirlaticilarim"
      role={role}
      description="Kendinize not ve hatırlatma: sipariş verilecekler, temizlik, aranacaklar. Yalnızca siz görürsünüz. Saat verirseniz panel açıkken saatinde sesli uyarır; bildirim açıksa sabah özeti gelir."
    />
  );
}

export default function MyRemindersPage() {
  return (
    <Suspense
      fallback={
        <>
          <MyRemindersHeader role="staff" />
          <PageSkeleton rows={6} />
        </>
      }
    >
      <MyRemindersContent />
    </Suspense>
  );
}

async function MyRemindersContent() {
  const user = await requireUser();
  const { open, done } = await loadMyReminders(user.id);
  return (
    <>
      <MyRemindersHeader role={user.role} />
      <MyReminders role={user.role} open={open} done={done} />
    </>
  );
}

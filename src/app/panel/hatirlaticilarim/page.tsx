import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { adminActor } from "@/lib/roles";
import { requireCan } from "@/server/auth/dal";
import { loadMyReminders, assignablePeople } from "@/server/data/user-reminders";

import { MyReminders } from "./my-reminders";

export const metadata: Metadata = { title: "Hatırlatıcılarım" };

/** Başlık iki rolde: bağlam satırı rolün ağacından (yöneticide "Kafe"; personelde üst düzey ekran, satır yok) */
function MyRemindersHeader({ role }: { role: "admin" | "staff" }) {
  return (
    <PageHeader
      title="Hatırlatıcılarım"
      path="/panel/hatirlaticilarim"
      role={role}
      description={
        role === "admin"
          ? "Kendinize ya da ekibinize kurun; saatinde o kişinin ekranında açılır, yalnız o görür."
          : "Kendinize notlar: sipariş, temizlik, aranacaklar. Yalnız siz görürsünüz."
      }
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
  const user = adminActor(await requireCan("kayit.yaz"));
  const [{ open, done }, people] = await Promise.all([
    loadMyReminders(user.id),
    // Yalnız yönetici başkasına hatırlatıcı kurabilir (src/server/actions/user-reminders.ts assignTarget)
    user.role === "admin" ? assignablePeople(user.id) : Promise.resolve([]),
  ]);
  return (
    <>
      <MyRemindersHeader role={user.role} />
      <MyReminders role={user.role} open={open} done={done} people={people} />
    </>
  );
}

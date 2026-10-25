import { CalendarCheck, Info } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { IconTile, toneFor } from "@/components/ui/icon-tile";
import { PageSkeleton } from "@/components/ui/misc";
import { requireUser } from "@/server/auth/dal";

import { buildFaq } from "../faq-build";
import { HelpFaq, HelpFaqFallback } from "../faq-search";
import { RoutineSteps } from "../routine-steps";
import { STAFF_FAQ_GROUPS, STAFF_ROUTINE, staffPathText } from "./content";

export const metadata: Metadata = { title: "Yardım" };

const FAQ = buildFaq(STAFF_FAQ_GROUPS, staffPathText);

/**
 * Personelin Yardım'ı (plan docs/planlar/personel-yetki.md §2.10): yalnız personelin ekranları, içerik content.tsx'te.
 * Yöneticinin Yardım'ının süzülmüş bir kopyası değildir; yönetici bölümleri bu sayfanın verisine hiç girmez. Menüde
 * (ağacın en altında) ve profil menüsünde; yönetici de açabilir (Yardım başlığındaki "Personelin Yardım'ı"). İçerik bir
 * Suspense çocuğunda, oturum okunduktan sonra çizilir: pasif ya da çıkış yapmış hesap içeriği göremez.
 */
export default function StaffHelpPage() {
  return (
    <>
      <PageHeader eyebrow="Personel" title="Yardım" description="Ekranlarınızda ne yapılır, adım adım. Soruya dokunun ya da arayın." />
      <Suspense fallback={<PageSkeleton rows={6} />}>
        <StaffHelpContent />
      </Suspense>
    </>
  );
}

async function StaffHelpContent() {
  await requireUser();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader icon={<CalendarCheck />} title="Ne zaman ne yapılır?" description="Bir günün sırası; her adım ilgili ekranı açar." />
        <CardContent>
          <RoutineSteps
            steps={STAFF_ROUTINE.map((r) => ({
              title: r.title,
              href: r.href,
              body: r.body,
              icon: (
                <IconTile size="sm" tone={toneFor(r.href)}>
                  <r.icon />
                </IconTile>
              ),
            }))}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader icon={<Info />} title="Nasıl yapılır?" description="Ekranlarınızdaki işler ve yöneticinin onayına gidenler. Açmak için soruya dokunun ya da arayın." />
        <CardContent>
          <Suspense fallback={<HelpFaqFallback groups={FAQ} />}>
            <HelpFaq groups={FAQ} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

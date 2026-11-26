import { Banknote, CalendarRange, FileArchive, FileText, HelpCircle, Landmark, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/misc";
import { businessDate } from "@/lib/cash-report";
import { monthTitle, prevMonth } from "@/lib/closed-period";
import { requireCan } from "@/server/auth/dal";

import { PackageDownload } from "./package-download";

export const metadata: Metadata = { title: "Muhasebe" };

const DESCRIPTION = "Faturalar, gelir-gider, vergi, aylık harcamalar ve kasa raporları; aylık muhasebeci paketi.";

/** Paketin seçilebilen ayları: geçen aydan geriye 12 ay (Ayarlar › Muhasebeci paketi ile aynı) */
const MONTHS = 12;

/** Muhasebecinin ekranları (src/lib/roles.ts › ACCOUNTANT_PATHS); hepsi salt okunur */
const SCREENS = [
  { href: "/panel/faturalar", label: "Faturalar", text: "Alış faturaları, belgeleri ve kalemleri; ödenmemiş kalan.", icon: FileText },
  { href: "/panel/gelir-gider", label: "Gelir-gider", text: "Aylık tablo: ciro, mal maliyeti, giderler, kâr / zarar (personel gideri toplam olarak).", icon: CalendarRange },
  { href: "/panel/vergi", label: "Vergi, KDV, SGK", text: "Tahmini vergi takvimi, KDV, SGK ve muhtasar toplamları, vergi kârı, demirbaş.", icon: Landmark },
  { href: "/panel/harcamalar", label: "Aylık harcamalar", text: "Faturasız ve her ay değişen giderler, kasadan ödenenler.", icon: Wallet },
  { href: "/panel/kasa", label: "Kasa raporları", text: "Şubelerin akşam raporları rakamlarıyla: Z, nakit, kart, fark, devir, yazarkasa.", icon: Banknote },
] as const;

/**
 * Muhasebe (docs/ROLLER.md › Muhasebeci): muhasebecinin ana ekranı. Ekranlarının listesi ve muhasebeci paketinin indirmesi;
 * yönetici de açar. Salt okunur: hiçbir kayıt değişmez (sunucu eylemleri muhasebeciyi reddeder), ayarlar, kişi başı maaş
 * (Maaşlar, bordro dökümü) ve personel belgeleri yok.
 */
export default function AccountingHomePage() {
  return (
    <>
      <PageHeader path="/panel/muhasebe" role="accountant" title="Muhasebe" description={DESCRIPTION} />
      <Suspense fallback={<PageSkeleton rows={6} />}>
        <AccountingContent />
      </Suspense>
    </>
  );
}

async function AccountingContent() {
  await requireCan("muhasebe.oku");
  const months: { month: string; title: string }[] = [];
  let m = prevMonth(businessDate().slice(0, 7));
  for (let i = 0; i < MONTHS; i++, m = prevMonth(m)) months.push({ month: m, title: monthTitle(m) });
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader icon={<FileText />} title="Ekranlar" description="Hepsi salt okunur: rakamları görürsünüz, kayıtları değiştiremezsiniz." />
        <ul className="divide-y divide-line border-t border-line">
          {SCREENS.map((s) => (
            <li key={s.href}>
              <Link href={s.href} className="flex items-start gap-3 px-5 py-3 hover:bg-panel/60 pointer-coarse:py-4">
                <s.icon size={18} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-mute" />
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{s.label}</span>
                  <span className="block text-sm text-pretty text-ink-mute">{s.text}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader
            icon={<FileArchive />}
            title="Muhasebeci paketi"
            description="Ayın faturaları, harcamaları, kasa raporları, yazarkasa Z'lerinin KDV dökümü ve sabit giderleri tek çalışma kitabında (.xlsx), bütün şubeler."
          />
          <CardContent>
            <PackageDownload months={months} />
          </CardContent>
        </Card>
        <Card id="yardim" className="scroll-mt-20">
          <CardHeader icon={<HelpCircle />} title="Hesabınız" description="Muhasebeci hesabı salt okunurdur." />
          <CardContent className="space-y-2 text-sm text-pretty text-ink-soft">
            <p>Bir kaydı düzeltmek gerekirse yöneticiye yazın; düğmelere basarsanız işlem &ldquo;salt okunur&rdquo; diye reddedilir.</p>
            <p>Kişi başı maaş ve bordro dökümü, personel belgeleri, ayarlar ve Paraşüt bağlantısı bu hesapta görünmez. Gelir-gider ve vergide personel giderleri toplam olarak durur.</p>
            <p>
              İki adımlı doğrulamayı ve parolanızı Hesabım&apos;dan yönetirsiniz: iki adımlı isteğe bağlıdır, zorunluluk açıksa kurmadan paneli kullanamazsınız.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

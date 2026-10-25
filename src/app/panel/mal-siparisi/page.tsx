import { ClipboardPen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { ButtonLink } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/misc";
import { monthLabel, num } from "@/lib/format";
import { STALE_DAYS } from "@/lib/reorder/levels";
import { longDateTR } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
import { liveDraftBadges } from "@/server/data/order-drafts";
import { loadOrderPlan } from "@/server/data/reorder";

import { OrderPlanClient } from "./order-plan";

export const metadata: Metadata = { title: "Mal siparişi" };

/** "09:42" (Türkiye) */
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

/**
 * Mal siparişi (docs/MAL-SIPARISI.md): tedarikçi tedarikçi sipariş önerisi (hedef − eldeki − siparişte, sipariş
 * birimine yuvarlı), WhatsApp ile gönderme. Yalnız yönetici; fiyatlar son alışlardan, KDV hariç.
 */
export default function OrderPlanPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader eyebrow="Stok" title="Mal siparişi" description="Yükleniyor…" tabs={<SectionTabs section="malSiparisi" current="/panel/mal-siparisi" />} />
          <PageSkeleton rows={8} />
        </>
      }
    >
      <OrderPlanContent />
    </Suspense>
  );
}

async function OrderPlanContent() {
  await requireAdmin();
  // Personelin taslağı onayda ya da onaylı tedarikçiler ("Taslak onayda · Ayşe"); okunamazsa rozet yok
  const [view, drafts] = await Promise.all([loadOrderPlan(), liveDraftBadges().catch(() => new Map())]);
  const q = view.lastQuick;
  const stale = view.staleDays !== null && view.staleDays > STALE_DAYS;
  return (
    <>
      <PageHeader
        eyebrow="Stok"
        title="Mal siparişi"
        description={
          q
            ? `Son hızlı sayım: ${longDateTR(q.day)} ${hhmm(q.at)} · ${q.by} · ${num(q.counted)} / ${num(view.total)} kalem. Öneri = hedef − eldeki − siparişte, sipariş birimine yuvarlanır.`
            : "Henüz hızlı sayım yok. Önce kritik kalemleri sayın; liste sayıma göre hazırlanır."
        }
        actions={
          view.total > 0 ? (
            <ButtonLink href="/panel/hizli-sayim" variant={stale || !q ? "primary" : "secondary"}>
              <ClipboardPen size={16} aria-hidden="true" /> Hızlı sayım
            </ButtonLink>
          ) : undefined
        }
        tabs={<SectionTabs section="malSiparisi" current="/panel/mal-siparisi" />}
      />
      {view.total > 0 && stale ? (
        <p className="mb-4 flex flex-wrap items-center gap-x-2 rounded-2xl bg-warn-soft px-4 py-3 text-[13px] leading-5 text-warn" role="status">
          Son sayım {num(view.staleDays)} gün önce: öneri eski stoka göre.
          <Link href="/panel/hizli-sayim" className="font-semibold underline-offset-2 hover:underline">
            Hızlı sayım yapın →
          </Link>
        </p>
      ) : null}
      {view.total > 0 && view.basis?.old ? (
        <p className="mb-4 flex flex-wrap items-center gap-x-2 rounded-2xl bg-panel px-4 py-3 text-[13px] leading-5 text-ink-soft ring-1 ring-line" role="status">
          Günlük kullanım {monthLabel(view.basis.month)} satışlarından; yeni satış raporu yükleyince öneriler güncellenir.
          <Link href="/panel/satislar" className="font-semibold text-ink underline-offset-2 hover:underline">
            Satışlar →
          </Link>
        </p>
      ) : null}
      <OrderPlanClient view={view} drafts={Object.fromEntries(drafts)} />
    </>
  );
}

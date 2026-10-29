import { ChevronDown, FileQuestion, Scale } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { HashScroll } from "@/components/panel/hash-scroll";
import { MonthPicker } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, PageSkeleton, SectionTitle, Stat } from "@/components/ui/misc";
import { groupOf, shownChannels } from "@/lib/commission/report";
import { COMMISSION_CATEGORY } from "@/lib/constants";
import { dateTR, money, monthLabel, num, pct } from "@/lib/format";
import { dayAblativeTR } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
import { loadCommissionReport } from "@/server/data/commission";

import { ChannelCard, FlagList } from "./channel-card";
import { ChannelSettingsCard } from "./channel-settings";
import { MealTotalCard } from "./meal-total-card";
import { PendingCard } from "./pending-card";
import { mealStatSub, openPayouts, openPayoutsSub, overMealLimit, platformTillLine } from "./texts";

export const metadata: Metadata = { title: "Komisyon & hakediş" };

const TITLE = "Komisyon & hakediş";
const DESCRIPTION =
  "Yemek kartı şirketlerinin ve sipariş platformlarının her ay gerçekte ne kadar kestiği, faturadaki ücretler ve hakedişin gelip gelmediği. Faturalar Paraşüt'ten, satış kasa raporlarından ya da kanalın ekstresinden gelir; hakediş gelince siz işaretlersiniz.";

function Header({ description = DESCRIPTION, actions }: { description?: string; actions?: ReactNode }) {
  return <PageHeader path="/panel/komisyonlar" title={TITLE} description={description} actions={actions} />;
}

export default function CommissionPage({ searchParams }: PageProps<"/panel/komisyonlar">) {
  return (
    <Suspense
      fallback={
        <>
          <Header description="Yükleniyor…" />
          <PageSkeleton rows={6} />
        </>
      }
    >
      <CommissionContent searchParams={searchParams} />
    </Suspense>
  );
}

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Satış › Komisyon & hakediş (docs/KOMISYON.md); yalnız yönetici, proxy personeli buraya sokmaz */
async function CommissionContent({ searchParams }: { searchParams: PageProps<"/panel/komisyonlar">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  const report = await loadCommissionReport();
  const raw = pick(sp.ay);
  const month = raw && report.months.includes(raw) ? raw : report.defaultMonth;
  const hasData = report.rows.length > 0 || report.unmatched.length > 0 || report.groups.some((g) => (g.zTotal ?? 0) > 0);

  if (!hasData) {
    return (
      <>
        <Header />
        <Card>
          <EmptyState
            icon={<Scale />}
            title="Henüz komisyon faturası yok"
            description="Yemek kartı ya da platform faturası Paraşüt'ten gelince (kategori Komisyon) burada ay ay görünür."
          />
        </Card>
      </>
    );
  }

  const monthRows = report.rows.filter((r) => r.month === month);
  const meal = groupOf(report, "meal", month);
  // Toplam kartı yemek kartı satışı ya da faturası olan ayda (kasa raporu olup Z'de yemek kartı 0 olan ayda yalnız karo)
  const mealTotal = meal && (meal.invoiceCount > 0 || (meal.zTotal ?? 0) > 0) ? meal : null;
  const platform = groupOf(report, "platform", month);
  const mealChannels = shownChannels(report, "meal", month);
  const platformChannels = shownChannels(report, "platform", month);
  const invoiceCount = monthRows.reduce((a, r) => a + r.invoices.length, 0);
  const fees = Math.round(monthRows.reduce((a, r) => a + r.feesTotal, 0) * 100) / 100;
  const open = openPayouts(report.rows);
  const openSub = openPayoutsSub(open);
  const unmatched = report.unmatched.filter((u) => u.date.slice(0, 7) === month);

  return (
    <>
      <Header
        description={report.switchDay ? DESCRIPTION.replace("satış kasa raporlarından", "satış kasa raporlarından, LafPOS'un ödemelerinden") : DESCRIPTION}
        actions={<MonthPicker months={report.dataMonths} value={month} />}
      />
      <HashScroll key={month} />
      <div className="space-y-6">
        {report.pending.length ? <PendingCard rows={report.pending} /> : null}

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          <Stat compact label="Kesilen (KDV hariç)" value={money(fees)} sub={`${num(invoiceCount)} fatura`} />
          <Stat
            compact
            label="Yemek kartı oranı"
            value={meal?.rate != null ? pct(meal.rate) : "–"}
            tone={overMealLimit(meal?.rate) ? "bad" : "default"}
            sub={mealStatSub(meal)}
          />
          <Stat
            compact
            className="col-span-2 lg:col-span-1"
            label="Bekleyen hakediş"
            value={open.total !== null ? `~${money(open.total)}` : "–"}
            sub={openSub.bad ? <span className="text-bad">{openSub.text}</span> : openSub.text}
          />
        </div>

        <section aria-label="Yemek kartları">
          <SectionTitle>Yemek kartları</SectionTitle>
          {mealTotal || mealChannels.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {mealTotal ? <MealTotalCard group={mealTotal} rows={monthRows.filter((r) => r.kind === "meal")} className="lg:col-span-2" /> : null}
              {mealChannels.map((ch) => (
                <ChannelCard key={ch} channel={ch} month={month} report={report} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-mute">{monthLabel(month)} ve önceki beş ayda yemek kartı faturası yok.</p>
          )}
        </section>

        <section aria-label="Platformlar">
          <SectionTitle>Platformlar</SectionTitle>
          <p className="-mt-1.5 mb-3 text-[13px] text-ink-mute">{platformTillLine(platform)}</p>
          {platform?.flags.length ? (
            <div className="mb-3">
              <FlagList flags={platform.flags} />
            </div>
          ) : null}
          {platformChannels.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {platformChannels.map((ch) => (
                <ChannelCard key={ch} channel={ch} month={month} report={report} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-mute">{monthLabel(month)} ve önceki beş ayda platform faturası yok.</p>
          )}
        </section>

        {unmatched.length ? (
          <Card>
            <CardHeader
              icon={<FileQuestion />}
              title="Kanalı bulunamayan komisyon faturaları"
              description={`${monthLabel(month)} · kategorisi Komisyon ama hiçbir yemek kartı ya da platformla eşleşmedi`}
            />
            <ul className="mx-5 divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
              {unmatched.map((u) => (
                <li key={u.id}>
                  <Link
                    href={`/panel/faturalar?ara=${encodeURIComponent(u.supplier)}&ay=${u.date.slice(0, 7)}&kategori=${encodeURIComponent(COMMISSION_CATEGORY)}#fatura-listesi`}
                    className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 text-sm text-ink outline-none hover:bg-panel/60 focus-visible:ring-2 focus-visible:ring-ink/30"
                  >
                    <span className="min-w-0 truncate">
                      {u.supplier} · {dateTR(u.date)}
                    </span>
                    <span className="shrink-0 tabular">{money(u.net)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="px-5 pt-3 pb-5 text-[13px] leading-5 text-ink-mute">
              Bu bir yemek kartı ya da platformsa Tedarikçiler&apos;de o tedarikçinin &quot;Diğer adlar&quot;ına bu adı ekleyin; fatura kanala geçer. Banka POS komisyonu gibi başka
              bir şeyse dokunmayın.
            </p>
          </Card>
        ) : null}

        <ChannelSettingsCard settings={report.settings} />

        <RulesCard switchDay={report.switchDay} />
      </div>
    </>
  );
}

/**
 * Kurallar ve hesap (kapalı başlar): yasal dayanak, oranın ve hakedişin nasıl hesaplandığı. LafPOS'a geçiş günü
 * seçiliyse satışın o günden itibaren LafPOS'tan geldiği de yazar (geçiş günü yokken metin bugünküyle aynı)
 */
function RulesCard({ switchDay }: { switchDay: string | null }) {
  const items: { title: string; body: string }[] = [
    {
      title: "Yemek kartı",
      body: "Komisyon en çok %6 olabilir. Komisyon dışında uygulama barındırma, kira, sarf malzemesi, işletim, teknik destek, bakım ya da depozito gibi adlarla ücret alınamaz. Hakediş, fatura tarihinden başlayarak en geç 30 gün içinde ödenir. (Perakende Ticarette Uygulanacak İlke ve Kurallar Hakkında Yönetmelik, madde 12/A)",
    },
    {
      title: "Sipariş platformları",
      body: "1 Nisan 2026'dan beri kestikleri her ücreti satıcı panelinde kalem kalem göstermek zorundalar. Sipariş alma, iletme ve ödeme altyapısı için ayrı ücret alınamaz; reklam ve kampanya isteğe bağlıdır. (Ticaret Bakanlığı Genelgesi 2026/1)",
    },
    {
      title: "Gerçek oran",
      body: `Kanalın o ay kestiği her şey (komisyon, erken ödeme ve diğer ücretler, KDV hariç) ÷ o kanaldan yapılan satış (KDV dahil). Satış, Hakediş penceresine yazdığınız aylık ekstreden gelir; yazmadıysanız ve o ay tek yemek kartının (ya da tek platformun) faturası varsa (sonraki ayın 15'ine kadar başkasınınki de gelmediyse) kasa raporlarındaki Z toplamından. Z'de kartlar tek toplam olduğu için birden çok kart kullanılan ayda kart kart oran ancak ekstreyle çıkar; yemek kartlarının toplam oranı her zaman hesaplanır.${
        switchDay
          ? ` LafPOS'a geçtiğiniz ${dayAblativeTR(switchDay)} itibaren satış, yazmadıysanız, LafPOS'un gün sonundaki ödeme türlerinden kart kart gelir (ödeme türünün kanalı LafPOS'ta seçili olmalı); yazdığınız ekstre yine önce gelir.`
          : ""
      }`,
    },
    {
      title: "Hangi ay",
      body: "Yemek kartı faturası ayın ilk 5 gününde kesildiyse önceki ayın satışları için sayılır. Ay sonunda kesilmeyen yemek kartı faturası (düzeltme, iki aylık fatura) başka bir ayın ücretini de taşıyabilir; o ayda %6 aşımı kesin sayılmaz. Haftalık platform faturaları ay sınırında kaydığı için platformlarda 3 aylık oran gösterilir. Gelir-gider ise her faturayı kendi tarihinin ayına yazar.",
    },
    {
      title: "Hakediş",
      body: "Beklenen = satış − kanalın faturaları (KDV dahil). Son gün = ayın son faturasının tarihi + ödeme süresi (Kanallar). Banka hesabı panele bağlı olmadığı için geldiğini siz işaretlersiniz; takip başlamadan son günü geçenler “takip öncesi” kalır, alarm vermez.",
    },
    {
      title: "Uyarılar",
      body: "Uyarılar faturadaki kalem adlarına bakar; kesin hüküm değildir. Şüphede önce kanalın müşteri hizmetine yazın; çözülmezse Ticaret Bakanlığı'nın il müdürlüğüne şikâyet edebilirsiniz.",
    },
  ];
  return (
    <Card>
      <details className="group/rules">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-3xl px-5 py-4 outline-none select-none focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink [&>svg]:size-[18px] [&>svg]:stroke-[1.75]">
              <Scale />
            </span>
            <span className="text-base font-semibold tracking-tight text-ink">Kurallar ve hesap nasıl yapılır</span>
          </span>
          <ChevronDown size={18} aria-hidden="true" className="shrink-0 text-ink-quiet transition-transform group-open/rules:rotate-180" />
        </summary>
        <div className="space-y-3 px-5 pb-5 text-[13px] leading-6 text-ink-soft">
          {items.map((i) => (
            <p key={i.title}>
              <strong className="font-semibold text-ink">{i.title}:</strong> {i.body}
            </p>
          ))}
        </div>
      </details>
    </Card>
  );
}

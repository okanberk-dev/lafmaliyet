import { eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { PageSkeleton } from "@/components/ui/misc";
import { countFactor, shiftMonth } from "@/lib/calc/engine";
import { stockVatSummary } from "@/lib/calc/insights";
import { countGroupOptions } from "@/lib/count-item";
import { monthLabel, monthShort } from "@/lib/format";
import { requireUser } from "@/server/auth/dal";
import { availableMonths, loadModel } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";

import { counterLine, countComplete, countStatus, defaultCountMonth, staffCountMonths } from "./logic";
import { CountMonthPicker, StockCountForm, type FormGroup } from "./stock-form";

export const metadata: Metadata = { title: "Stok sayımı" };

export default function StockPage({ searchParams }: PageProps<"/panel/sayim">) {
  return (
    <Suspense
      fallback={
        <>
          {/* Rol henüz bilinmediği için sekmeler yalnızca içerik yüklenince (yöneticiye) çizilir */}
          <PageHeader title="Stok sayımı" eyebrow="Stok" excel="Sayım" />
          <PageSkeleton rows={12} />
        </>
      }
    >
      <StockContent searchParams={searchParams} />
    </Suspense>
  );
}

async function StockContent({ searchParams }: { searchParams: PageProps<"/panel/sayim">["searchParams"] }) {
  const user = await requireUser();
  const sp = await searchParams;
  const model = await loadModel();
  const ay = Array.isArray(sp.ay) ? sp.ay[0] : sp.ay;
  const isAdmin = user.role === "admin";
  const requested = ay && /^\d{4}-(0[1-9]|1[0-2])$/.test(ay) ? ay : null;
  // Personel bu ayın sayımını, ayın ilk 10 gününde geçen ayınkini de değiştirebilir (sunucu da reddeder): başka ay
  // açılıp boşuna sayılmasın
  const staffMonths = staffCountMonths();
  const allowed = (m: string) => isAdmin || staffMonths.includes(m);
  if (!requested || !allowed(requested)) {
    // Adreste ay yoksa: ayın ilk 10 gününde geçen ayın sayımı tamamlanmamışsa geçen ay, değilse bu ay (iş günü, 05:00).
    // Ay adrese yazılır: kayıttan sonraki yenileme (gece yarısı geçse de) ayı değiştiremez. Personelin açamadığı ay
    // istendiyse sayfa bunu söyler (?izinsiz=)
    const month = defaultCountMonth(new Date(), (m) => countComplete(model.stockSheet(m)));
    const q = new URLSearchParams({ ay: month });
    if (requested) q.set("izinsiz", requested);
    // Süzgeçler (?ara, ?durum, ?grup) kalır
    for (const [k, v] of Object.entries(sp)) if (k !== "ay" && k !== "izinsiz" && typeof v === "string") q.set(k, v);
    redirect(`/panel/sayim?${q}`);
  }
  const month = requested;
  const denied = typeof sp.izinsiz === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.izinsiz) && !allowed(sp.izinsiz) ? sp.izinsiz : null;
  const prevMonth = shiftMonth(month, -1);

  const counters = await getDb()
    .select({ by: s.stockCounts.countedBy, last: sql<Date | string | null>`max(${s.stockCounts.updatedAt})` })
    .from(s.stockCounts)
    .where(eq(s.stockCounts.month, month))
    .groupBy(s.stockCounts.countedBy);

  const sheet = model.stockSheet(month);
  const prev = model.stockSheet(prevMonth);
  const vat = stockVatSummary(sheet);
  const prevById = new Map(prev.groups.flatMap((g) => g.lines.filter((l) => l.qty !== null).map((l) => [l.ingredient.id, { qty: l.qty as number, unit: l.countUnit }])));
  const ml = monthLabel(month);
  // Sayım düzeni: seçili ay dahil son 6 ayın sayımı tamam mı, yarım mı (countStatus: tek kural); personelin açamadığı
  // ay bağlantı olmaz
  const history = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5)).map((m) => {
    const sh = model.stockSheet(m);
    const st = countStatus(sh);
    return { month: m, short: monthShort(m), label: monthLabel(m), counted: st.counted, total: st.total, hasData: sh.hasData, open: allowed(m) };
  });
  // Gelir-giderde elle girilen stok bu sayımın yerine geçer: sayım ekranı bunu söylemeli
  const closing = model.closingStock(month);
  const opening = model.closingStock(prevMonth);

  const groups: FormGroup[] = sheet.groups.map((g, gi) => ({
    name: g.name,
    excelRate: vat.groups[gi]?.excelRate ?? 0,
    mismatches: isAdmin ? (vat.groups[gi]?.mismatches ?? []).map((x) => ({ name: x.ingredient.name, vatRate: x.vatRate })) : [],
    lines: g.lines.map((l) => {
      const p = prevById.get(l.ingredient.id);
      return {
        id: l.ingredient.id,
        name: l.ingredient.name,
        packageDesc: l.ingredient.packageDesc,
        countUnit: l.countUnit,
        unitNow: l.ingredient.countUnit,
        archived: l.archived,
        archivedReason: !l.archived ? null : l.ingredient.active ? "sayilmaz" : "pasif",
        passiveInUse: l.passiveInUse,
        unitChanged: l.unitChanged,
        qty: l.qty,
        prevQty: p?.qty ?? null,
        prevUnit: p?.unit ?? null,
        unitPrice: isAdmin ? l.unitPrice : 0,
        // Yeni ya da değişen miktar bugünkü sayım birimiyle, ayın sonunda geçerli fiyatla (kayıttan sonraki değeriyle aynı)
        unitPriceNow: isAdmin ? model.unitCostAtMonthEnd(l.ingredient.id, month) * countFactor(l.ingredient.countUnit) : 0,
        vatRate: isAdmin ? l.ingredient.vatRate : 0,
        // FIFO (yalnız yönetici): kayıtlı tutar, havuz ve ay sonu fiyatı; formda değişen miktar sunucunun kuralıyla
        // değerlenir (logic.ts lineAmount). Personele fiyat, katman ve tutar gitmez
        amount: isAdmin ? l.amount : 0,
        pool: isAdmin ? l.pool : [],
        fallbackUnit: isAdmin ? l.fallbackUnit : 0,
        factor: l.factor,
        factorNow: countFactor(l.ingredient.countUnit),
      };
    }),
  }));

  return (
    <>
      <PageHeader
        eyebrow="Stok"
        title="Stok sayımı"
        excel="Sayım"
        description={`${ml} ay sonu sayımı: ayın son günü kapanıştan sonra sayın. Miktarı sayım biriminde yazın (KG, LT, ADET, DİLİM); yarım = 0,5.`}
        // Kaydedilmemiş sayım varken ay geçişi önce sorulur (form ay değişince baştan kurulur)
        actions={
          <CountMonthPicker months={[...new Set([...(isAdmin ? [...availableMonths(model), model.currentMonth] : staffMonths), month])].sort()} value={month} />
        }
        tabs={isAdmin ? <SectionTabs section="stok" current="/panel/sayim" /> : undefined}
      />
      <StockCountForm
        key={month}
        month={month}
        monthLabel={ml}
        prevMonthLabel={monthLabel(prevMonth)}
        isAdmin={isAdmin}
        groups={groups}
        valuation={isAdmin ? { fifo: sheet.valuation === "fifo", covered: sheet.fifoCovered, total: sheet.total, start: model.fifoStart ? monthLabel(model.fifoStart) : null } : null}
        extras={sheet.extras.map((e) => ({ name: e.name, unit: e.unit, qty: e.qty, unitPrice: isAdmin ? e.unitPrice : 0, priced: e.unitPrice > 0 }))}
        prevExtras={prev.extras.map((e) => ({ name: e.name, unit: e.unit, qty: e.qty, unitPrice: isAdmin ? e.unitPrice : 0, priced: e.unitPrice > 0 }))}
        hasPrev={prev.hasData}
        history={history}
        prevTotal={isAdmin && (prev.hasData || opening.overridden) ? { value: opening.value, overridden: opening.overridden } : null}
        closingOverride={isAdmin && closing.overridden ? closing.value : null}
        counter={counterLine(counters)}
        me={user.name}
        denied={denied ? monthLabel(denied) : null}
        // "Listeye ekle": personel yalnız sayımını değiştirebildiği ayda (bu ay, ilk 10 günde geçen ay; sunucu da denetler)
        addItem={
          allowed(month)
            ? {
                groups: countGroupOptions(
                  sheet.groups.map((g) => g.name),
                  [...model.ds.ingredients].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
                ),
              }
            : null
        }
      />
    </>
  );
}

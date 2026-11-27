import { and, eq, inArray, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { BranchChooser } from "@/components/panel/branch-chooser";
import { BranchViewChip } from "@/components/panel/branch-view-chip";
import { MonthPickerSkeleton } from "@/components/panel/month-picker";
import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { ButtonLink } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/misc";
import { ALL_BRANCHES, tillBranches } from "@/lib/branches";
import { countFactor, shiftMonth } from "@/lib/calc/engine";
import { stockVatSummary } from "@/lib/calc/insights";
import { countGroupOptions } from "@/lib/count-item";
import { monthLabel, monthShort } from "@/lib/format";
import { STOCK_ESTIMATE_BRANCH, STOCK_ESTIMATE_PATH } from "@/lib/stock-estimate";
import { adminActor } from "@/lib/roles";
import { requireCan } from "@/server/auth/dal";
import { areaScope, currentBranchScope, currentPhysicalBranch, withBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { availableMonths, loadModel } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";

import { counterLine, countComplete, countOpeningNote, countOpeningOf, countStatus, defaultCountMonth, staffCountMonths, stockOverrides } from "./logic";
import { CountMonthPicker, StockCountForm, type FormGroup } from "./stock-form";

export const metadata: Metadata = { title: "Stok sayımı" };

/** Başlığın açıklaması; ayın adı önüne gelir */
const COUNT_RULE = "ay sonu sayımı: ayın son günü kapanıştan sonra sayın. Miktarı sayım biriminde yazın (KG, LT, ADET, DİLİM); yarım = 0,5.";

/**
 * Sayım başlığı. Yükleme ekranı (`month` null) yüklenen sayfayla aynı boyda çizilir: açıklama aynı metin, ay adının
 * yerinde bir iskelet; ay seçicinin yerinde onun boyunda bir kutu. Böylece içerik gelince sekme satırı aşağı kaymaz,
 * telefonda sekmeye dokunan açıklamaya basmış olmaz (denetim B04 incelemesi, K1).
 */
function StockHeader({ month, role, picker, branch }: { month: string | null; role: "admin" | "staff"; picker?: ReactNode; branch?: string | null }) {
  return (
    <PageHeader
      path="/panel/sayim"
      role={role}
      title="Stok sayımı"
      description={
        month ? (
          `${branch ? `${branch} · ` : ""}${monthLabel(month)} ${COUNT_RULE}`
        ) : (
          <>
            <span aria-hidden className="inline-block h-3.5 w-[4.5rem] animate-pulse rounded bg-panel align-middle" /> {COUNT_RULE}
          </>
        )
      }
      actions={picker ?? <MonthPickerSkeleton />}
      tabs={<SectionTabs section="stok" current="/panel/sayim" role={role} />}
    />
  );
}

export default function StockPage({ searchParams }: PageProps<"/panel/sayim">) {
  return (
    <Suspense
      fallback={
        <>
          {/* Rol ve ay henüz bilinmiyor: iki rolün de gördüğü sekmeler (Sayım, Zayi & ikram), yöneticinin Tutarlılık'ı
              içerik yüklenince eklenir; başlık yüklenen sayfanınkiyle aynı boyda, sekme satırı yer değiştirmez */}
          <StockHeader month={null} role="staff" />
          <PageSkeleton rows={12} />
        </>
      }
    >
      <StockContent searchParams={searchParams} />
    </Suspense>
  );
}

async function StockContent({ searchParams }: { searchParams: PageProps<"/panel/sayim">["searchParams"] }) {
  const user = adminActor(await requireCan("kayit.yaz"));
  const sp = await searchParams;
  // Sayım şube başına (docs/SUBE.md): seçili fiziksel şubenin sayımı gösterilir ve ona yazılır ("Tümü" ya da online
  // kanal seçiliyken Tuzla). Birden çok açık şube varken başlık hangi şubenin sayıldığını söyler
  const [branch, branches, scope] = await Promise.all([currentPhysicalBranch(), listBranches(), currentBranchScope()]);
  const tills = tillBranches(branches);
  const branchLabel = tills.length > 1 ? branch.name : null;
  // "Tümü" ya da online kanal seçiliyken birden çok kasa açıksa sayım formu çizilmeden önce şube sorulur (şube kapsamı C
  // P1-6): önceden sessizce Tuzla'nın sayımı açılıyordu. Kilitli personelin seçimi zaten kendi şubesidir
  if (tills.length > 1 && !tills.some((b) => b.id === scope)) {
    const ay = Array.isArray(sp.ay) ? sp.ay[0] : sp.ay;
    return (
      <>
        <PageHeader path="/panel/sayim" role={user.role} title="Stok sayımı" description={`${COUNT_RULE.charAt(0).toLocaleUpperCase("tr-TR")}${COUNT_RULE.slice(1)}`} tabs={<SectionTabs section="stok" current="/panel/sayim" role={user.role} />} />
        <BranchChooser
          title="Hangi şubeyi sayıyorsunuz?"
          description="Stok sayımı şube başına tutulur. Şubeyi seçin; sayım o şubenin listesiyle açılır."
          path="/panel/sayim"
          params={{ ay }}
          branches={tills}
        />
      </>
    );
  }
  const isAdmin = user.role === "admin";
  // Stok değeri alanının kipi (şube ayrımı parça 5): şube kipinde FIFO havuzu şubenin ve işletme genelinin faturaları,
  // devir kartı şubenin kendi sayımı (Gelir-gider'e elle yazılan işletme geneli devir gösterilmez); firma kipinde bütün
  // faturalar ve işletme geneli devir (bugünkü gibi). Veri kümesi aynı kuralla okur (dataset.ts, sayılan şubenin kapsamında)
  const [model, valueScope] = await Promise.all([
    loadModel({ scope: branch.id }),
    // şube-ayrımı: alan.stok_degeri
    isAdmin && branchLabel !== null ? withBranchScope(branch.id, () => areaScope("stok_degeri")) : Promise.resolve(ALL_BRANCHES),
  ]);
  const branchValue = valueScope !== ALL_BRANCHES;
  const ay = Array.isArray(sp.ay) ? sp.ay[0] : sp.ay;
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

  const db = getDb();
  const [counters, stockEntries] = await Promise.all([
    db
      .select({ by: s.stockCounts.countedBy, last: sql<Date | string | null>`max(${s.stockCounts.updatedAt})` })
      .from(s.stockCounts)
      .where(and(eq(s.stockCounts.month, month), eq(s.stockCounts.branchId, branch.id)))
      .groupBy(s.stockCounts.countedBy),
    // Gelir-giderde elle yazılan stok devirleri işletme genelidir: şubenin modeli onları görmez (branchPnlEntry), burada
    // ayrıca okunur (yalnız yönetici; 21 Kasım denetimi #20)
    isAdmin && !branchValue
      ? db
          .select({ month: s.pnlEntries.month, rowKey: s.pnlEntries.rowKey, amount: s.pnlEntries.amount })
          .from(s.pnlEntries)
          .where(and(inArray(s.pnlEntries.month, [month, prevMonth]), inArray(s.pnlEntries.rowKey, ["stock:closing", "stock:opening"])))
      : Promise.resolve([]),
  ]);

  const sheet = model.stockSheet(month);
  const prev = model.stockSheet(prevMonth);
  const vat = stockVatSummary(sheet, model.settings);
  const prevById = new Map(prev.groups.flatMap((g) => g.lines.filter((l) => l.qty !== null).map((l) => [l.ingredient.id, { qty: l.qty as number, unit: l.countUnit }])));
  const ml = monthLabel(month);
  // Sayım düzeni: seçili ay dahil son 6 ayın sayımı tamam mı, yarım mı (countStatus: tek kural); personelin açamadığı
  // ay bağlantı olmaz
  const history = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5)).map((m) => {
    const sh = model.stockSheet(m);
    const st = countStatus(sh);
    return { month: m, short: monthShort(m), label: monthLabel(m), counted: st.counted, total: st.total, hasData: sh.hasData, open: allowed(m) };
  });
  // Gelir-giderde elle girilen stok bu sayımın yerine geçer: sayım ekranı bunu söylemeli. Açılış kâr-zararınki: geçen
  // ayın devreden malı ya da bu ayın "Önceki aydan devir"i elle değiştirilebilir (denetim E-30). Elle yazılan devir
  // işletme genelidir; sayfa şubenin modeliyle açıldığından (model o hücreleri görmez) ayrıca okunur, sayım tutarı
  // şubenin kalır (21 Kasım denetimi #20). Yalnız yönetici görür
  const overrides = stockOverrides(stockEntries, month);
  const opening = isAdmin ? countOpeningOf(overrides, model.closingStock(prevMonth).computed, prev.hasData) : null;

  const groups: FormGroup[] = sheet.groups.map((g, gi) => ({
    name: g.name,
    rate: vat.groups[gi]?.rate ?? 0,
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
      <StockHeader
        month={month}
        role={user.role}
        branch={branchLabel}
        // Kaydedilmemiş sayım varken ay geçişi önce sorulur (form ay değişince baştan kurulur). Tahmini stok yalnız
        // Marina'nın (AsilPOS'un şubesi, geçiş günü seçiliyken; docs/STOK-TAHMINI.md): Tuzla'nın başlığı aynı kalır.
        // Kaydedilmemiş sayım varken bağlantıyı da form durdurup sorar (useLeaveGuard)
        picker={
          <>
            {branch.id === STOCK_ESTIMATE_BRANCH && model.settings.asilposGecisGunu ? (
              <ButtonLink href={STOCK_ESTIMATE_PATH} variant="secondary">
                Tahmini stok
              </ButtonLink>
            ) : null}
            <CountMonthPicker months={[...new Set([...(isAdmin ? [...availableMonths(model), model.currentMonth] : staffMonths), month])].sort()} value={month} />
          </>
        }
      />
      {/* Şube seçiliyken: Stok değeri alanının kipi (şube ayrımı D); yalnız yöneticide (çip bütün şubeleri görene) */}
      <BranchViewChip area="stok_degeri" className="mb-4" />
      <StockCountForm
        key={`${branch.id}:${month}`}
        branchId={branch.id}
        branchLabel={branchLabel}
        month={month}
        monthLabel={ml}
        prevMonthLabel={monthLabel(prevMonth)}
        isAdmin={isAdmin}
        groups={groups}
        extrasVatRate={model.settings.alisKdvGida}
        valuation={
          isAdmin
            ? {
                fifo: sheet.valuation === "fifo",
                covered: sheet.fifoCovered,
                total: sheet.total,
                start: model.fifoStart ? monthLabel(model.fifoStart) : null,
                shared: branchLabel !== null && !branchValue,
                lots: branchValue ? branch.name : null,
              }
            : null
        }
        extras={sheet.extras.map((e) => ({ name: e.name, unit: e.unit, qty: e.qty, unitPrice: isAdmin ? e.unitPrice : 0, priced: e.unitPrice > 0 }))}
        prevExtras={prev.extras.map((e) => ({ name: e.name, unit: e.unit, qty: e.qty, unitPrice: isAdmin ? e.unitPrice : 0, priced: e.unitPrice > 0 }))}
        hasPrev={prev.hasData}
        history={history}
        prevTotal={opening && (prev.hasData || opening.source !== "sayim") ? { value: opening.value, note: countOpeningNote(opening, month, branchLabel) } : null}
        closingOverride={isAdmin ? overrides.closing : null}
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

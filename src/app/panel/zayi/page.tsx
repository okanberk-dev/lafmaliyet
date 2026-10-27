import { ArrowLeft, BarChart3, CalendarX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, PageSkeleton, Stat } from "@/components/ui/misc";
import { businessDate } from "@/lib/cash-report";
import { num, tl } from "@/lib/format";
import { LAFPOS_IKRAM_TEXT, panelWasteCounts, productIkramNote } from "@/lib/lafpos/ikram";
import { monthSource } from "@/lib/lafpos/switch";
import { addDays, longDateTR, monthShortTR, monthTitleTR, shiftMonth, todayTR } from "@/lib/reminders";
import { productLabel, qtyText, WASTE_KIND_LABEL, type WasteKind } from "@/lib/waste";
import { lateWasteDays, staffDeleteMode, staffWasteMode, WASTE_REQUEST_TEXT, wasteDayLabel, wasteItemText, type WasteDeleteMode } from "@/lib/waste-requests";
import { requireUser } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { loadDayLafposIkram } from "@/server/data/lafpos-ikram";
import { wasteChoices, wasteEntriesBetween } from "@/server/data/waste";
import { myWasteRequests, pendingWasteSummary, wasteDayMarks } from "@/server/data/waste-requests";
import { getDb } from "@/server/db";
import { wasteLock } from "@/server/waste/core";

import { WasteDayStrip } from "./day-picker";
import { WasteBoard, type LafposDayView } from "./waste-board";

export const metadata: Metadata = { title: "Zayi & ikram" };

/**
 * Başlık ve Stok sekmeleri (Sayım, Zayi & ikram, yöneticide Tutarlılık; nav.ts SECTION_TABS). Rol bilinmeden (yükleniyor)
 * iki rolün de gördüğü sekmeler çizilir; yöneticinin Tutarlılık'ı içerik gelince eklenir, sekme satırı yer değiştirmez.
 */
function WasteHeader({ role }: { role: "admin" | "staff" }) {
  return (
    <PageHeader
      title="Zayi & ikram"
      eyebrow="Stok"
      description="Atılan, bozulan, dökülen (zayi) ve ödenmeden verilen (ikram: müşteriye, personele, tadım) ürün ve malzemeyi gün içinde girin. Tutarlılık ekranı bunları satıştan ayrı gösterir; günün özeti kasa raporuna geçer."
      tabs={<SectionTabs section="stok" current="/panel/zayi" role={role} />}
    />
  );
}

export default function WastePage({ searchParams }: PageProps<"/panel/zayi">) {
  return (
    <Suspense
      fallback={
        <>
          <WasteHeader role="staff" />
          <PageSkeleton rows={8} />
        </>
      }
    >
      <WasteContent searchParams={searchParams} />
    </Suspense>
  );
}

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function WasteContent({ searchParams }: { searchParams: PageProps<"/panel/zayi">["searchParams"] }) {
  const user = await requireUser();
  const admin = user.role === "admin";
  const sp = await searchParams;
  const header = <WasteHeader role={user.role} />;
  const now = new Date();
  const today = businessDate(now);
  const gun = pick(sp.gun);
  const date = gun && /^\d{4}-\d{2}-\d{2}$/.test(gun) && gun <= today ? gun : today;
  const yesterday = addDays(today, -1);
  const short = (d: string) => `${Number(d.slice(8, 10))} ${monthShortTR(d)}`;
  const strip = (
    <div className="flex flex-wrap items-center gap-2">
      <WasteDayStrip
        date={date}
        today={{ day: today, label: short(today) }}
        yesterday={{ day: yesterday, label: short(yesterday) }}
        days={lateWasteDays(now).map((d) => ({ day: d, label: wasteDayLabel(d) }))}
      />
      {admin && date < addDays(today, -14) ? <Badge tone="blue">{longDateTR(date)}</Badge> : null}
      <ButtonLink href="/panel/kasa" variant="ghost" size="sm" className="ml-auto">
        Kasa raporu
      </ButtonLink>
    </div>
  );
  // Personel: günün kipi (doğrudan / istek / kapalı) ve satırların silme kipi sunucuda (kasanın kilidiyle)
  const lock = admin ? null : await wasteLock(getDb(), date);
  const mode = lock ? staffWasteMode(date, now, lock) : "direct";
  if (mode === "closed") {
    return (
      <div className="space-y-4">
        {header}
        {strip}
        <EmptyState
          icon={<CalendarX />}
          title={WASTE_REQUEST_TEXT.windowOld}
          description={`${longDateTR(date)} için kaydı yönetici girer.`}
          action={
            <ButtonLink href="/panel/zayi" variant="secondary">
              {WASTE_REQUEST_TEXT.backToday}
            </ButtonLink>
          }
        />
      </div>
    );
  }
  const [choices, entries, marks, mine, waiting, laf] = await Promise.all([
    wasteChoices(),
    wasteEntriesBetween(date, date),
    wasteDayMarks(date),
    admin ? Promise.resolve([]) : myWasteRequests(user.id, now),
    admin ? pendingWasteSummary({ day: date }) : Promise.resolve(null),
    // LafPOS gününde (geçiş gününden itibaren) ürün ikramı LafPOS'tan; geçiş günü boşken null, ekran bugünkü gibi
    loadDayLafposIkram(date),
  ]);
  // LafPOS'un ikramı salt okunur: personele ad ve adet, yöneticiye nedeni, menü değeri ve ürüne bağlı olmayanlar da
  const lafpos: LafposDayView | null = laf
    ? {
        note: productIkramNote(laf.switchDay),
        received: laf.received,
        lines: laf.lines.map((l) => ({
          name: l.name,
          qty: l.qty,
          reason: admin ? l.reason : null,
          menuValue: admin ? l.menuValue : null,
          unmatched: admin && l.productId === null,
        })),
        notCounted: laf.received ? entries.filter((e) => !panelWasteCounts(e, new Set([date]))).map((e) => e.id) : [],
      }
    : null;
  const deleteModes: Record<number, WasteDeleteMode> = Object.fromEntries(entries.map((e) => [e.id, lock ? staffDeleteMode(e, user, now, lock) : "direct"]));
  const deleteAsks: Record<number, { requestId: number; by: string; mine: boolean }[]> = {};
  for (const a of marks.deleteAsks) (deleteAsks[a.entryId] ??= []).push({ requestId: a.requestId, by: a.by, mine: a.byId === user.id });
  const lateBadges = Object.fromEntries(marks.lateApprovals.map((a) => [a.entryId, `Geç kayıt · ${a.by} onayladı ${short(todayTR(new Date(a.at)))}`]));
  const pendingLate = mine
    .filter((r) => r.kind === "zayi-gec" && r.status === "pending" && r.day === date && r.item)
    .map((r) => ({ id: r.id, item: wasteItemText(r.item!), reason: r.item!.reason }));
  const board = (
    <WasteBoard
      key={date}
      date={date}
      choices={choices}
      entries={entries}
      mode={mode}
      deleteModes={deleteModes}
      deleteAsks={deleteAsks}
      lateBadges={lateBadges}
      pendingLate={pendingLate}
      lafpos={lafpos}
    />
  );
  if (!admin) {
    return (
      <div className="space-y-4">
        {header}
        {strip}
        {board}
      </div>
    );
  }

  const ay = pick(sp.ay);
  const month = ay && /^\d{4}-(0[1-9]|1[0-2])$/.test(ay) && ay <= today.slice(0, 7) ? ay : today.slice(0, 7);
  return (
    <div className="space-y-6">
      {header}
      {strip}
      {waiting?.count ? (
        <p className="rounded-xl bg-warn-soft px-4 py-2.5 text-sm text-warn">
          Bu gün için {num(waiting.count)} istek onay bekliyor ·{" "}
          <Link href={`/panel/onaylar#istek-${waiting.firstId}`} className="font-medium underline underline-offset-2">
            Onaylar
          </Link>
        </p>
      ) : null}
      {board}
      <WasteMonth month={month} today={today} />
    </div>
  );
}

/** Ayın kasası, ödenmez tutarının etiketi için: geçiş ayında iki kasa birden */
const OFF_LABEL = { modpos: "ModPOS ödenmez / ikram", gecis: "Kasa ödenmez / ikram", lafpos: "LafPOS ödenmez / ikram" } as const;

/**
 * Yöneticinin ay özeti: zayi ve ikramın malzeme maliyeti, ikramın menü değeri ve kasanın ödenmez tutarı, en çok giden
 * kalemler. Geçiş gününden itibaren LafPOS'un ikramı da sayılır ("LafPOS" rozetiyle); LafPOS'un gün sonu gelen günde
 * panele girilmiş ürün ikramı sayılmaz (src/lib/lafpos/ikram.ts). Geçiş günü boşken bugünkü gibi yalnız panel.
 */
async function WasteMonth({ month, today }: { month: string; today: string }) {
  const end = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const [model, entries] = await Promise.all([loadModel(), wasteEntriesBetween(`${month}-01`, end)]);
  const sum = model.wasteSummary(month);
  const lafposDays = new Set(model.ds.lafposIkram?.days ?? []);
  // Kalem başına: adet / miktar ve malzeme maliyeti (ürün: reçetenin malzeme toplamı, fire payı olmadan)
  const rows = new Map<string, { kind: WasteKind; lafpos: boolean; name: string; unit: string; qty: number; cost: number; count: number }>();
  const add = (key: string, base: { kind: WasteKind; lafpos: boolean; name: string; unit: string }, qty: number, cost: number) => {
    const r = rows.get(key) ?? { ...base, qty: 0, cost: 0, count: 0 };
    r.qty += qty;
    r.cost += cost;
    r.count += 1;
    rows.set(key, r);
  };
  for (const e of entries) {
    if (!panelWasteCounts(e, lafposDays)) continue;
    add(`${e.kind}|${e.name}|${e.unit}`, { kind: e.kind, lafpos: false, name: e.name, unit: e.unit }, e.qty, model.wasteCost(e));
  }
  for (const w of model.countedWaste) {
    if (w.source !== "lafpos" || w.date < `${month}-01` || w.date > end) continue;
    const p = w.productId !== null ? model.productById.get(w.productId) : undefined;
    const name = p ? productLabel(p) : (w.name ?? "LafPOS ikramı");
    add(`lafpos|${name}`, { kind: "ikram", lafpos: true, name, unit: "adet" }, w.qty, model.wasteCost(w));
  }
  const top = [...rows.values()].sort((a, b) => b.cost - a.cost).slice(0, 15);
  const off = model.monthInfo.get(month)?.offRevenue ?? 0;
  const source = monthSource(month, model.ds.settings.lafposGecisGunu ?? null);
  return (
    <Card>
      <CardHeader
        icon={<BarChart3 />}
        title={`${monthTitleTR(month)} özeti`}
        description="Malzeme maliyeti KDV hariç; stok farkının içinde olduğu için gelir-gidere ayrıca gider yazılmaz"
        actions={
          <div className="flex items-center gap-1">
            <ButtonLink href={`/panel/zayi?ay=${shiftMonth(month, -1)}`} variant="ghost" size="sm" scroll={false}>
              <ArrowLeft size={14} /> Önceki ay
            </ButtonLink>
            {month < today.slice(0, 7) ? (
              <ButtonLink href={`/panel/zayi?ay=${shiftMonth(month, 1)}`} variant="ghost" size="sm" scroll={false}>
                Sonraki ay
              </ButtonLink>
            ) : null}
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 px-5 pb-4 lg:grid-cols-4">
        <Stat label="Zayi" value={tl(sum.zayi.cost)} sub={`${num(sum.zayi.count)} kayıt · malzeme maliyeti`} tone={sum.zayi.cost > 0 ? "bad" : "default"} compact />
        <Stat
          label="İkram"
          value={tl(sum.ikram.cost)}
          sub={`${num(sum.ikram.count)} kayıt${sum.ikram.lafpos ? ` (${num(sum.ikram.lafpos)} LafPOS'tan)` : ""} · malzeme maliyeti`}
          compact
        />
        <Stat label="İkramın menü değeri" value={tl(sum.ikram.menuValue)} sub="Menü fiyatıyla, KDV dahil" compact />
        <Stat
          label={OFF_LABEL[source]}
          value={off ? tl(off) : "–"}
          sub={
            <Link href={`/panel/satislar?ay=${month}`} className="font-medium text-ink-soft underline underline-offset-2 hover:text-ink">
              {off ? "Satışlar'da girildi" : "Satışlar'da girilmemiş"}
            </Link>
          }
          compact
        />
      </div>
      {top.length ? (
        <ul className="divide-y divide-line border-t border-line">
          {top.map((r) => (
            <li key={`${r.lafpos ? "lafpos" : r.kind}|${r.name}|${r.unit}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
              <Badge tone={r.kind === "zayi" ? "red" : "blue"}>{WASTE_KIND_LABEL[r.kind]}</Badge>
              {r.lafpos ? <Badge tone="gray">LafPOS</Badge> : null}
              <span className="min-w-0 flex-1 font-medium break-words text-ink">{r.name}</span>
              <span className="text-ink-mute tabular">
                {qtyText(r.qty, r.unit)} · {num(r.count)} kayıt
              </span>
              <span className="w-24 text-right font-semibold text-ink tabular">{tl(r.cost)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-line px-5 py-6 text-sm text-ink-mute">Bu ay zayi ya da ikram girilmemiş.</p>
      )}
      {sum.notCounted ? (
        <p className="border-t border-line px-5 py-3 text-[13px] text-ink-mute">
          Panele girilen {num(sum.notCounted)} ürün ikramı sayılmıyor: o günlerin ikramı LafPOS&apos;tan geldi (gün listesinde &quot;{LAFPOS_IKRAM_TEXT.notCounted}&quot;).
        </p>
      ) : null}
      <p className="border-t border-line px-5 py-3 text-[13px] text-ink-mute">
        Stok farkındaki payı için{" "}
        <Link href={`/panel/tutarlilik?ay=${month}`} className="font-medium text-ink-soft underline underline-offset-2 hover:text-ink">
          Tutarlılık
        </Link>
        : her malzemenin sapmasından kayıtlı zayi ve ikram düşülür, kalanı açıklanamayan fark olarak görünür.
      </p>
    </Card>
  );
}

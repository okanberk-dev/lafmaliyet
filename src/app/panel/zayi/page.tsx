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
import { Notice, NoticeLink } from "@/components/ui/notice";
import { businessDate } from "@/lib/cash-report";
import { num, tl } from "@/lib/format";
import { LAFPOS_IKRAM_TEXT, lafposReasonText, panelWasteCounts, productIkramClosed, productIkramNote } from "@/lib/lafpos/ikram";
import { monthSource } from "@/lib/lafpos/switch";
import { addDays, isCalendarDate, longDateTR, monthShortTR, monthTitleTR, shiftMonth, todayTR } from "@/lib/reminders";
import { productLabel, qtyText, WASTE_KIND_LABEL, type WasteKind } from "@/lib/waste";
import { lateWasteDays, staffDeleteMode, staffWasteMode, WASTE_REQUEST_TEXT, wasteDayLabel, wasteItemText, type WasteDeleteMode, type WasteLock } from "@/lib/waste-requests";
import { requireUser } from "@/server/auth/dal";
import { DEFAULT_BRANCH_ID, tillBranches } from "@/lib/branches";
import { currentBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
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
function WasteHeader({ role, branch = null }: { role: "admin" | "staff"; branch?: string | null }) {
  return (
    <PageHeader
      // Birden çok kasa açıkken formun şubesi başlıkta ("Tuzla · Zayi & ikram"); "Tümü"de form şubeyi sorar
      title={branch ? `${branch} · Zayi & ikram` : "Zayi & ikram"}
      path="/panel/zayi"
      role={role}
      // İki rolde tek cümle (docs/planlar/ux-sade.md §8): yöneticinin karşılaştırma ekranı anılmaz, personel açamaz. LafPOS gününde
      // ürün ikramının LafPOS'ta işaretlendiğini İkram seçilince formun notu söyler (productIkramNote, lafpos.note)
      description="Atılan, bozulan (zayi) ve ödenmeden verilen (ikram) ürünleri girin."
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
  const now = new Date();
  const today = businessDate(now);
  // Formun şubesi bir kez çözülür; kilit ve form aynı değeri kullanır (docs/SUBE.md › Yazarken hangi şube). Seçili fiziksel
  // şube; "Tümü" ya da online kanal seçiliyken birden çok kasa açıksa form şubeyi sorar (varsayılan yok), tek kasada o kasa
  const [scope, branchRows] = await Promise.all([currentBranchScope(), listBranches()]);
  const tills = tillBranches(branchRows);
  const chosen = tills.find((b) => b.id === scope) ?? (tills.length === 1 ? tills[0] : null);
  const formBranches = (chosen ? [chosen] : tills).map((b) => ({ id: b.id, name: b.name }));
  const header = <WasteHeader role={user.role} branch={chosen && tills.length > 1 ? chosen.name : null} />;
  const gun = pick(sp.gun);
  // Takvimde olmayan gün (2026-02-30, ay 00) bugüne düşer (KP-09'daki kasa sayfası gibi)
  const date = gun && isCalendarDate(gun) && gun <= today ? gun : today;
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
  // Personel: günün kipi (doğrudan / istek / kapalı) ve satırların silme kipi sunucuda (kasanın kilidiyle). Kilit şube
  // başına (denetim 21 Kasım #13): formun kipi kaydın ineceği şubenin kasasından (formun şubesi; "Tümü"de şube seçilene
  // kadar Tuzla'nınki gösterilir, kayıt anında sunucu seçilen şubenin kilidine bakar)
  const branchId = admin ? null : (chosen?.id ?? DEFAULT_BRANCH_ID);
  const lock = branchId ? await wasteLock(getDb(), date, branchId) : null;
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
  // LafPOS'un ikram ve zayi satırları salt okunur: personele ad ve adet, yöneticiye nedeni, menü değeri ve ürüne bağlı
  // olmayanlar da. Ürün ikramı gün sonu geldiyse ya da gün bugünse panelden kapalı (gün sonu gelmeyen geçmiş günde açık)
  const lafposZayi = new Set(laf?.lines.filter((l) => l.kind === "zayi" && l.productId !== null).map((l) => l.productId) ?? []);
  const lafpos: LafposDayView | null = laf
    ? {
        note: productIkramNote(laf.switchDay),
        received: laf.received,
        closed: productIkramClosed(date, laf.switchDay, { received: laf.received, today }),
        past: date < today,
        lines: laf.lines.map((l) => ({
          kind: l.kind,
          name: l.name,
          qty: l.qty,
          // Yöneticiye nedeni: iptalde iptal nedeni, ödenmezde kişinin türü (lafposReasonText)
          reason: admin ? lafposReasonText(l) : null,
          menuValue: admin ? l.menuValue : null,
          unmatched: admin && l.productId === null && !l.isService,
          service: admin && l.isService,
        })),
        notCounted: laf.received ? entries.filter((e) => !panelWasteCounts(e, new Set([date]))).map((e) => e.id) : [],
        // Paneldeki ürün zayisi, aynı gün aynı ürün LafPOS'ta da zayi yazıldıysa: ikisi de sayılır, aynıysa biri silinir
        maybeTwice: entries.filter((e) => e.kind === "zayi" && e.productId !== null && lafposZayi.has(e.productId)).map((e) => e.id),
      }
    : null;
  // Satırın silme kipi kaydın kendi şubesinin kilidiyle (removeWaste gibi): "Tümü"deki şubesiz personel öteki şubenin
  // kaydını da görür
  const locks = new Map<string, WasteLock>();
  if (branchId && lock) {
    locks.set(branchId, lock);
    for (const b of new Set(entries.map((e) => e.branchId))) if (!locks.has(b)) locks.set(b, await wasteLock(getDb(), date, b));
  }
  const deleteModes: Record<number, WasteDeleteMode> = Object.fromEntries(
    entries.map((e) => [e.id, lock ? staffDeleteMode(e, user, now, locks.get(e.branchId) ?? lock) : "direct"]),
  );
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
      branches={formBranches}
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
        <Notice tone="warn" title={`Bu gün ${num(waiting.count)} istek onay bekliyor`} action={<NoticeLink href={`/panel/onaylar#istek-${waiting.firstId}`}>Onaylar</NoticeLink>} />
      ) : null}
      {board}
      <WasteMonth month={month} today={today} />
    </div>
  );
}

/** Ayın kasası, ödenmez tutarının etiketi için: geçiş ayında iki kasa birden */
const OFF_LABEL = { modpos: "ModPOS ödenmez / ikram", gecis: "Kasa ödenmez / ikram", lafpos: "LafPOS ödenmez / ikram" } as const;

/** Yöneticinin ay özeti: zayi ve ikramın malzeme maliyeti, ikramın menü değeri ve kasanın ödenmez tutarı, en çok giden
 * kalemler. Geçiş gününden itibaren LafPOS'un ikram ve zayi satırları da sayılır (adın yanında "LafPOS"); LafPOS'un gün sonu gelen günde
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
    const name = p ? productLabel(p) : (w.name ?? (w.kind === "zayi" ? "LafPOS zayisi" : "LafPOS ikramı"));
    add(`lafpos|${w.kind}|${name}`, { kind: w.kind, lafpos: true, name, unit: "adet" }, w.qty, model.wasteCost(w));
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
        <Stat
          label="Zayi"
          value={tl(sum.zayi.cost)}
          sub={`${num(sum.zayi.count)} kayıt${sum.zayi.lafpos ? ` (${num(sum.zayi.lafpos)} LafPOS'tan)` : ""} · malzeme maliyeti`}
          tone={sum.zayi.cost > 0 ? "bad" : "default"}
          compact
        />
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
            // Telefonda miktar adın altına iner: ad sütunu daralıp harf harf kırılmasın
            <li key={`${r.lafpos ? "lafpos|" : ""}${r.kind}|${r.name}|${r.unit}`} className="flex items-center gap-x-3 px-5 py-2.5 text-sm">
              <Badge tone={r.kind === "zayi" ? "red" : "blue"}>{WASTE_KIND_LABEL[r.kind]}</Badge>
              <span className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
                <span className="block font-medium break-words text-ink sm:flex-1">
                  {r.name}
                  {r.lafpos ? <span className="ml-1.5 text-xs font-normal text-ink-mute">LafPOS</span> : null}
                </span>
                <span className="block text-xs text-ink-mute tabular sm:text-sm">
                  {qtyText(r.qty, r.unit)} · {num(r.count)} kayıt
                </span>
              </span>
              <span className="w-20 shrink-0 text-right font-semibold text-ink tabular sm:w-24">{tl(r.cost)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-line px-5 py-6 text-sm text-ink-mute">Bu ay zayi ya da ikram girilmemiş.</p>
      )}
      {sum.notCounted ? (
        <p className="border-t border-line px-5 py-3 text-[13px] text-ink-mute">
          Panele girilen {num(sum.notCounted)} ürün ikramı sayılmıyor: o günlerin ikramı LafPOS&apos;tan geldi (gün listesinde “{LAFPOS_IKRAM_TEXT.notCounted}”).
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

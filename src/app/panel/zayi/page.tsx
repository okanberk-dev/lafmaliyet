import { ArrowLeft, BarChart3 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { businessDate, staffCanReport } from "@/lib/cash-report";
import { num, tl } from "@/lib/format";
import { addDays, longDateTR, monthTitleTR, shiftMonth } from "@/lib/reminders";
import { qtyText, WASTE_KIND_LABEL, type WasteKind } from "@/lib/waste";
import { requireUser } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { wasteChoices, wasteEntriesBetween, type WasteEntryDTO } from "@/server/data/waste";

import { WasteBoard } from "./waste-board";

export const metadata: Metadata = { title: "Zayi & ikram" };

export default function WastePage({ searchParams }: PageProps<"/panel/zayi">) {
  return (
    <>
      <PageHeader
        title="Zayi & ikram"
        eyebrow="Stok"
        description="Atılan, bozulan, dökülen (zayi) ve ödenmeden verilen (ikram: müşteriye, personele, tadım) ürün ve malzemeyi gün içinde girin. Tutarlılık ekranı bunları satıştan ayrı gösterir; günün özeti kasa raporuna geçer."
      />
      <Suspense fallback={<PageSkeleton rows={8} />}>
        <WasteContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function WasteContent({ searchParams }: { searchParams: PageProps<"/panel/zayi">["searchParams"] }) {
  const user = await requireUser();
  const admin = user.role === "admin";
  const sp = await searchParams;
  const today = businessDate();
  const gun = pick(sp.gun);
  let date = gun && /^\d{4}-\d{2}-\d{2}$/.test(gun) && gun <= today ? gun : today;
  if (!admin && !staffCanReport(date)) date = today;
  const yesterday = addDays(today, -1);
  const [choices, entries] = await Promise.all([wasteChoices(), wasteEntriesBetween(date, date)]);

  const days = (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Gün">
      {[today, yesterday].map((d) => (
        <ButtonLink key={d} href={`/panel/zayi?gun=${d}`} variant={d === date ? "primary" : "secondary"} size="sm" aria-current={d === date ? "page" : undefined}>
          {d === today ? "Bugün" : "Dün"} · {longDateTR(d).split(" ").slice(0, 2).join(" ")}
        </ButtonLink>
      ))}
      {admin && date !== today && date !== yesterday ? <Badge tone="blue">{longDateTR(date)}</Badge> : null}
      <ButtonLink href="/panel/kasa" variant="ghost" size="sm" className="ml-auto">
        Kasa raporu
      </ButtonLink>
    </div>
  );
  const board = <WasteBoard key={date} date={date} choices={choices} entries={entries} meId={user.id} admin={admin} />;
  if (!admin) {
    return (
      <div className="space-y-4">
        {days}
        {board}
      </div>
    );
  }

  const ay = pick(sp.ay);
  const month = ay && /^\d{4}-(0[1-9]|1[0-2])$/.test(ay) && ay <= today.slice(0, 7) ? ay : today.slice(0, 7);
  return (
    <div className="space-y-6">
      {days}
      {board}
      <WasteMonth month={month} today={today} />
    </div>
  );
}

/** Yöneticinin ay özeti: zayi ve ikramın malzeme maliyeti, ikramın menü değeri ve ModPOS'un ödenmez tutarı, en çok giden kalemler */
async function WasteMonth({ month, today }: { month: string; today: string }) {
  const end = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const [model, entries] = await Promise.all([loadModel(), wasteEntriesBetween(`${month}-01`, end)]);
  const sum = model.wasteSummary(month);
  // Kalem başına: adet / miktar ve malzeme maliyeti (ürün: reçetenin malzeme toplamı, fire payı olmadan)
  const rows = new Map<string, { kind: WasteKind; name: string; unit: string; qty: number; cost: number; count: number }>();
  const costOf = (e: WasteEntryDTO) => {
    const product = e.productId !== null ? model.productById.get(e.productId) : undefined;
    if (product) return model.computeProduct(product).ingredientTotal * e.qty;
    return e.ingredientId !== null ? (model.unitCost.get(e.ingredientId) ?? 0) * e.qty * e.factor : 0;
  };
  for (const e of entries) {
    const key = `${e.kind}|${e.name}|${e.unit}`;
    const r = rows.get(key) ?? { kind: e.kind, name: e.name, unit: e.unit, qty: 0, cost: 0, count: 0 };
    r.qty += e.qty;
    r.cost += costOf(e);
    r.count += 1;
    rows.set(key, r);
  }
  const top = [...rows.values()].sort((a, b) => b.cost - a.cost).slice(0, 15);
  const off = model.monthInfo.get(month)?.offRevenue ?? 0;
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
        <Stat label="İkram" value={tl(sum.ikram.cost)} sub={`${num(sum.ikram.count)} kayıt · malzeme maliyeti`} compact />
        <Stat label="İkramın menü değeri" value={tl(sum.ikram.menuValue)} sub="Menü fiyatıyla, KDV dahil" compact />
        <Stat
          label="ModPOS ödenmez / ikram"
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
            <li key={`${r.kind}|${r.name}|${r.unit}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
              <Badge tone={r.kind === "zayi" ? "red" : "blue"}>{WASTE_KIND_LABEL[r.kind]}</Badge>
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

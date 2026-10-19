"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { MenuMatrix } from "@/components/charts";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, NumberInput, Select } from "@/components/ui/form";
import { InfoTip, Signed } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { parseNumberTR } from "@/lib/calc/expr";
import { applyScenario, type MenuClass, type ScenarioBase } from "@/lib/calc/insights";
import { num, pct, tl } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Item {
  id: number;
  name: string;
  size: string;
  categoryId: number;
  category: string;
  qty: number;
  mix: number;
  cm: number;
  totalCm: number;
  cls: MenuClass;
  margin: number;
  price: number;
  suggestedPrice: number;
}

const ORDER: MenuClass[] = ["star", "plowhorse", "puzzle", "dog"];

export function MenuEngineering({
  monthLabel,
  items: allItems,
  popThreshold: allThreshold,
  avgCm: allAvg,
  classInfo,
  categories,
}: {
  monthLabel: string;
  items: Item[];
  popThreshold: number;
  avgCm: number;
  classInfo: Record<MenuClass, { label: string; advice: string; tone: string }>;
  categories: { id: number; name: string }[];
}) {
  const [cat, setCat] = useState<number | null>(null);
  const [cls, setCls] = useState<MenuClass | null>(null);

  // Kategori seçilince sınıflar o kategori içinde yeniden hesaplanır
  const { items, popThreshold, avgCm } = useMemo(() => {
    if (cat === null) return { items: allItems, popThreshold: allThreshold, avgCm: allAvg };
    const list = allItems.filter((i) => i.categoryId === cat);
    const totalQty = list.reduce((a, i) => a + i.qty, 0);
    const thr = list.length ? (1 / list.length) * 0.7 : 0;
    const avg = totalQty ? list.reduce((a, i) => a + i.cm * i.qty, 0) / totalQty : 0;
    return {
      items: list.map((i) => {
        const mix = totalQty ? i.qty / totalQty : 0;
        const c: MenuClass = mix >= thr ? (i.cm >= avg ? "star" : "plowhorse") : i.cm >= avg ? "puzzle" : "dog";
        return { ...i, mix, cls: c };
      }),
      popThreshold: thr,
      avgCm: avg,
    };
  }, [cat, allItems, allThreshold, allAvg]);

  const shown = items.filter((i) => !cls || i.cls === cls).sort((a, b) => b.totalCm - a.totalCm);

  return (
    <Card>
      <CardHeader
        title={`Menü mühendisliği · ${monthLabel}`}
        description={`Her ürün satış payına (adet) ve birim kârına göre dört gruba ayrılır. Popülerlik eşiği: satış payı ≥ %${num(popThreshold * 100, 1)} (eşit payın %70'i). Kâr eşiği: satış ağırlıklı ortalama birim kâr ${tl(avgCm, 1)}.`}
        actions={
          <Select value={cat ?? ""} onChange={(e) => setCat(e.target.value ? Number(e.target.value) : null)} className="w-auto min-w-44" aria-label="Kategori">
            <option value="">Bütün menü</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        }
      />
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {ORDER.map((k) => {
            const list = items.filter((i) => i.cls === k);
            const active = cls === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setCls(active ? null : k)}
                className={cn("rounded-xl border p-3 text-left transition", active ? "border-coffee-800 bg-coffee-50" : "border-coffee-100 hover:border-coffee-300")}
              >
                <div className="flex items-center justify-between">
                  <Badge tone={classInfo[k].tone as Tone}>{classInfo[k].label}</Badge>
                  <span className="text-xl font-semibold">{list.length}</span>
                </div>
                <p className="mt-2 text-xs text-coffee-600">{classInfo[k].advice}</p>
                <p className="mt-1 text-xs font-medium text-coffee-800">{tl(list.reduce((a, i) => a + i.totalCm, 0))} brüt kâr</p>
              </button>
            );
          })}
        </div>
        <MenuMatrix
          points={items.filter((i) => i.qty > 0).map((i) => ({ name: `${i.name} · ${i.size}`, mix: i.mix, cm: i.cm, qty: i.qty, cls: classInfo[i.cls].label }))}
          popThreshold={popThreshold}
          avgCm={avgCm}
        />
        <p className="text-xs text-coffee-500">Grafikte yalnızca bu ay satılan ürünler var; hiç satılmayanlar tabloda &quot;Zayıf&quot; ya da &quot;Bilmece&quot; olarak görünür.</p>
      </CardContent>
      <TableWrap className="border-t border-coffee-100">
        <Table>
          <THead>
            <tr>
              <TH>Ürün</TH>
              <TH>Grup</TH>
              <TH numeric>Satış</TH>
              <TH numeric>Satış payı</TH>
              <TH numeric>Birim kâr</TH>
              <TH numeric>Toplam brüt kâr</TH>
              <TH numeric>Marj</TH>
              <TH numeric>Fiyat (→ önerilen)</TH>
            </tr>
          </THead>
          <tbody>
            {shown.map((i) => (
              <TR key={i.id}>
                <TD>
                  <Link href={`/panel/urunler/${i.id}`} className="font-medium hover:underline">
                    {i.name} · {i.size}
                  </Link>
                  <span className="block text-xs text-coffee-500">{i.category}</span>
                </TD>
                <TD>
                  <Badge tone={classInfo[i.cls].tone as Tone}>{classInfo[i.cls].label}</Badge>
                </TD>
                <TD numeric>{num(i.qty)}</TD>
                <TD numeric>{pct(i.mix)}</TD>
                <TD numeric>{tl(i.cm, 2)}</TD>
                <TD numeric className="font-medium">{tl(i.totalCm)}</TD>
                <TD numeric>{pct(i.margin)}</TD>
                <TD numeric>
                  {tl(i.price)}
                  {i.price < i.suggestedPrice ? <span className="text-rose-700"> → {tl(i.suggestedPrice)}</span> : null}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </Card>
  );
}

function Slider({ label, value, onChange, min, max, step, suffix, info }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; suffix: string; info?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-coffee-900">
          {label} {info ? <InfoTip text={info} /> : null}
        </span>
        <span className="font-semibold tabular">
          {value > 0 ? "+" : ""}
          {num(value, 0)}
          {suffix}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-coffee-800" aria-label={label} />
    </div>
  );
}

export function ScenarioSimulator({ base, acikGun, monthLabel }: { base: ScenarioBase; acikGun: number; monthLabel: string }) {
  const [price, setPrice] = useState(0);
  const [cost, setCost] = useState(0);
  const [volume, setVolume] = useState(0);
  const [extra, setExtra] = useState("0");
  const [target, setTarget] = useState("50.000");
  const extraNum = parseNumberTR(extra) ?? 0;
  const { base: b, scenario: s } = applyScenario(base, { priceChangePct: price / 100, costChangePct: cost / 100, volumeChangePct: volume / 100, extraFixed: extraNum }, acikGun);

  // Başabaş için gereken ortalama zam ve satış artışı (diğerleri sabitken)
  const priceForBreakEven = base.net - base.commission - base.discountsNet > 0 ? (base.material + base.fixed) / (base.net - base.commission - base.discountsNet) - 1 : null;
  const unitContribution = base.net - base.material - base.commission - base.discountsNet;
  const volumeForBreakEven = unitContribution > 0 ? base.fixed / unitContribution - 1 : null;
  const targetNum = parseNumberTR(target) ?? 0;
  const dailyForTarget = s.grossRatio > 0 ? (s.fixed + targetNum) / s.grossRatio / acikGun : null;

  const rows: { label: string; b: number; s: number; good: "up" | "down" }[] = [
    { label: "Ciro (KDV dahil)", b: b.revenue, s: s.revenue, good: "up" },
    { label: "Net satış (KDV hariç)", b: b.net, s: s.net, good: "up" },
    { label: "– Malzeme + ambalaj", b: b.material, s: s.material, good: "down" },
    { label: "– POS komisyonu", b: b.commission, s: s.commission, good: "down" },
    { label: "Brüt kâr", b: b.gross, s: s.gross, good: "up" },
    { label: "– İndirimler", b: b.discountsNet, s: s.discountsNet, good: "down" },
    { label: "– Sabit giderler", b: b.fixed, s: s.fixed, good: "down" },
  ];

  return (
    <Card>
      <CardHeader
        title="Senaryo simülatörü"
        description={`${monthLabel} satış karmasından yola çıkar: "Bütün menüye %5 zam yaparsam, süt %10 zamlanırsa, satışlar %15 artarsa ay sonu ne olur?"`}
        actions={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setPrice(0);
              setCost(0);
              setVolume(0);
              setExtra("0");
            }}
          >
            Sıfırla
          </Button>
        }
      />
      <CardContent className="grid gap-8 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-4">
          <Slider label="Menü fiyatları" value={price} onChange={setPrice} min={-20} max={40} step={1} suffix="%" info="Bütün ürünlere aynı oranda zam / indirim. Müşterinin satın alma alışkanlığı aynı kalır varsayılır." />
          <Slider label="Malzeme maliyetleri" value={cost} onChange={setCost} min={-20} max={50} step={1} suffix="%" info="Tedarikçi zamları ya da daha ucuz tedarikçi." />
          <Slider label="Satış adedi" value={volume} onChange={setVolume} min={-50} max={100} step={1} suffix="%" info="Daha çok / daha az müşteri." />
          <Field label="Aylık sabit gider değişimi (₺)" hint="ör. reklamı 30.000 ₺ azaltmak için -30000" htmlFor="sc-extra">
            <NumberInput id="sc-extra" value={extra} onChange={(e) => setExtra(e.target.value)} className="cell-input" />
          </Field>
        </div>
        <div className="space-y-4 lg:col-span-8">
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Aylık</TH>
                  <TH numeric>Şu an</TH>
                  <TH numeric>Senaryo</TH>
                  <TH numeric>Fark</TH>
                </tr>
              </THead>
              <tbody>
                {rows.map((r) => {
                  const d = r.s - r.b;
                  const better = r.good === "up" ? d > 0 : d < 0;
                  return (
                    <TR key={r.label}>
                      <TD>{r.label}</TD>
                      <TD numeric>{tl(r.b)}</TD>
                      <TD numeric>{tl(r.s)}</TD>
                      <TD numeric className={cn(Math.abs(d) < 1 ? "text-coffee-300" : better ? "text-emerald-700" : "text-rose-700")}>
                        {Math.abs(d) < 1 ? "–" : `${d > 0 ? "+" : ""}${tl(d)}`}
                      </TD>
                    </TR>
                  );
                })}
                <TR className="bg-coffee-50/60 text-base font-semibold">
                  <TD>Net kâr / zarar</TD>
                  <TD numeric>
                    <Signed value={b.profit}>{tl(b.profit)}</Signed>
                  </TD>
                  <TD numeric>
                    <Signed value={s.profit}>{tl(s.profit)}</Signed>
                  </TD>
                  <TD numeric className={cn(s.profit - b.profit >= 0 ? "text-emerald-700" : "text-rose-700")}>
                    {s.profit - b.profit >= 0 ? "+" : ""}
                    {tl(s.profit - b.profit)}
                  </TD>
                </TR>
              </tbody>
            </Table>
          </TableWrap>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-coffee-50 p-3">
              <p className="text-xs text-coffee-600">Başabaş günlük ciro</p>
              <p className="mt-1 text-lg font-semibold">{tl(s.breakEvenDaily)}</p>
              <p className="text-xs text-coffee-500">Şu an {tl(b.breakEvenDaily)}</p>
            </div>
            <div className="rounded-xl bg-coffee-50 p-3">
              <p className="text-xs text-coffee-600">Zarar etmemek için (tek başına)</p>
              <p className="mt-1 text-sm font-semibold">{priceForBreakEven !== null ? `%${num(priceForBreakEven * 100, 1)} ortalama zam` : "–"}</p>
              <p className="text-sm font-semibold">{volumeForBreakEven !== null ? `ya da %${num(volumeForBreakEven * 100, 0)} daha fazla satış` : ""}</p>
            </div>
            <div className="rounded-xl bg-coffee-50 p-3">
              <Field label="Hedef aylık kâr (₺)" htmlFor="sc-target">
                <NumberInput id="sc-target" value={target} onChange={(e) => setTarget(e.target.value)} className="h-8" />
              </Field>
              <p className="mt-1 text-xs text-coffee-600">
                Gereken günlük ciro: <strong>{tl(dailyForTarget)}</strong>
              </p>
            </div>
          </div>
          <p className="text-xs text-coffee-500">
            Varsayımlar: satış karması ve indirim oranı sabit; komisyon cironun aynı yüzdesi; sabit giderler {acikGun} açık güne göre. Malzeme maliyeti reçetelere göredir (fire ve ikram hariç).
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

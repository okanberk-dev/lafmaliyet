"use client";

import { Layers } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { tryAction } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/form";
import { InfoTip } from "@/components/ui/misc";
import { monthShift, valuationFor } from "@/lib/calc/fifo";
import { monthLabel, pct, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { saveStockValuationStart } from "@/server/actions/settings";

import { SectionCard } from "./section-card";

/**
 * Sayımı olan bir ayın iki yöntemle değeri (engine.ts valuationPreview); `overridden`: Gelir-giderde elle girildi.
 * FIFO tutarı başlangıç ayına bağlı (başlangıçtan önceki sayım ay sonu fiyatıyla taşınır): `fifo` o aya kadarki her
 * başlangıç seçeneğinin tutarı ve faturalardan gelen kısmı.
 */
export interface ValuationRow {
  month: string;
  old: number;
  fifo: Record<string, { value: number; covered: number }>;
  overridden: boolean;
}

/** Ayarlarda kapalı seçeneğinin değeri (select metin ister) */
const OFF = "";

/**
 * Ayarlar › Stok değerleme: ilk giren ilk çıkar (FIFO) başlangıç ayı ve ay ay önce / sonra kapanış stoğu önizlemesi.
 * Değer kayıtlı başlangıçla "şimdi", seçilen başlangıçla "sonra"; kâr etkisi kapanış farkı eksi önceki ayın kapanış
 * farkı (SMM = açılış + alış − kapanış). Gelir-giderde elle girilen kapanış yöntemden etkilenmez.
 */
export function StockValuationCard({
  start,
  rows,
  months,
  openingOverrides = [],
  branch = null,
}: {
  start: string | null;
  rows: ValuationRow[];
  months: string[];
  /** Gelir-giderde açılış stoğu ("stock:opening") elle girilmiş aylar: önceki ayın kapanış farkı onlara geçmez */
  openingOverrides?: string[];
  /**
   * Stok değeri alanının şube kipinde önizlemenin şubesi (şube ayrımı parça 5): satırlar şubenin sayımları ve şubenin ve
   * işletme genelinin faturalarıyla; ayar yine firmanın. Firma kipinde ve "Tümü"de null ("Tümü"nün önizlemesi)
   */
  branch?: string | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(start ?? OFF);
  const [busy, setBusy] = useState(false);
  const next = draft || null;
  const dirty = next !== start;
  const fifoWith = (r: ValuationRow, from: string | null) => (from && valuationFor(r.month, from) === "fifo" ? (r.fifo[from] ?? null) : null);
  const valueWith = (r: ValuationRow, from: string | null) => (r.overridden ? null : (fifoWith(r, from)?.value ?? r.old));
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const openOv = new Set(openingOverrides);
  const delta = (r: ValuationRow | undefined) => (r ? (valueWith(r, next) ?? 0) - (valueWith(r, start) ?? 0) : 0);
  // Ayın kâr etkisi: kendi kapanış farkı eksi açılışına geçen önceki ayın kapanış farkı (açılış elle girildiyse 0)
  const carried = (m: string) => (openOv.has(m) ? 0 : delta(byMonth.get(monthShift(m, -1))));
  const profitOf = (r: ValuationRow) => delta(r) - carried(r.month);
  const shown = rows.filter((r) => r.old || Object.values(r.fifo).some((f) => f.value)).slice(-12);
  // Değişen aylar bütün sayımlı aylardan (tablo son 12'yi gösterir); sayımı olmayan sonraki ayın açılışı da değişir
  const changed = rows.filter((r) => Math.abs(delta(r)) >= 0.5 || Math.abs(profitOf(r)) >= 0.5);
  const openings = rows
    .filter((r) => Math.abs(delta(r)) >= 0.5 && !byMonth.has(monthShift(r.month, 1)) && !openOv.has(monthShift(r.month, 1)))
    .map((r) => ({ month: monthShift(r.month, 1), delta: delta(r) }));
  const signed = (v: number) => `${v > 0 ? "+" : "−"}${tl(Math.abs(v))}`;

  const save = async () => {
    setBusy(true);
    const res = await tryAction(() => saveStockValuationStart(next));
    setBusy(false);
    if (!res) return;
    if (!res.ok) return void toast.error(res.error);
    toast.success(res.data.change ?? "Değişiklik yok");
    router.refresh();
  };

  return (
    <SectionCard
      id="stok"
      icon={<Layers />}
      title="Stok değerleme"
      summary={start ? `FIFO · ${monthLabel(start)} ayından` : "Ay sonu fiyatı (FIFO kapalı)"}
      dirty={dirty}
      description={
        <>
          {start
            ? `Stok değerleme: İlk giren ilk çıkar (FIFO), ${monthLabel(start)} ayından itibaren. Önceki aylar ay sonu fiyatıyla kalır; başlangıcı geriye almak kapanmış ayların stok değerini ve kârını değiştirir.`
            : "Stok değerleme: her ay ay sonu fiyatı (FIFO kapalı). Sayılan miktar ayın sonunda geçerli fiyatla değerlenir."}{" "}
          <InfoTip text="FIFO'da rafta kalan mal en son alınandır: sayılan miktar en yeni Paraşüt faturasından geriye doğru, her parça kendi faturasının birim fiyatıyla (KDV hariç) değerlenir; faturası bulunamayan kısım ay sonu fiyatıyla. Reçete ve menü maliyeti değişmez: son alış fiyatıyla kalır (yenileme maliyeti). Vergi: VUK m.274 FIFO'yu ve ağırlıklı ortalamayı kabul eder; resmi defterler muhasebecinin yöntemini izler." />
        </>
      }
      actions={
        dirty ? (
          <>
            <Button variant="ghost" onClick={() => setDraft(start ?? OFF)} disabled={busy}>
              Vazgeç
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </>
        ) : null
      }
    >
      <CardContent className="space-y-4">
        {branch ? (
          <p className="text-xs leading-5 text-ink-mute">
            Önizleme {branch} görünümü: şubenin sayımları, şubenin ve işletme genelinin faturalarıyla. Yöntem firmanın ayarıdır, bütün şubelere uygulanır.
          </p>
        ) : null}
        <Field label="Yöntem ve başlangıç ayı" htmlFor="s-fifo" hint="Seçince önce / sonra aşağıda hemen görünür; Kaydet'e basınca kâr-zarar, sayım ve dışa aktarım bu yöntemle hesaplanır.">
          <Select id="s-fifo" value={draft} onChange={(e) => setDraft(e.target.value)} className="max-w-sm">
            <option value={OFF}>Ay sonu fiyatı (FIFO kapalı)</option>
            {months.map((m) => (
              <option key={m} value={m}>
                İlk giren ilk çıkar (FIFO), {monthLabel(m)} ayından
              </option>
            ))}
          </Select>
        </Field>
        {shown.length ? (
          <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
            <table className="w-full text-sm tabular sm:min-w-[34rem]">
              <caption className="sr-only">Ay sonu stoğu: kayıtlı yöntem ve seçilen yöntem</caption>
              <thead className="bg-surface text-left text-xs text-ink-mute">
                <tr>
                  <th className="px-2 py-2 font-medium sm:px-3">Ay</th>
                  <th className="px-2 py-2 text-right font-medium sm:px-3">Şimdi</th>
                  <th className="px-2 py-2 text-right font-medium sm:px-3">Seçilenle</th>
                  <th className="px-2 py-2 text-right font-medium sm:px-3">
                    Kâr etkisi <InfoTip className="ml-1" text="Kapanış stoğu artarsa o ayın mal maliyeti düşer, kâr artar; sonraki ayın açılışı da aynı kadar artar ve o ayın kârı düşer." />
                  </th>
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Faturadan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((r) => {
                  const now = valueWith(r, start);
                  const after = valueWith(r, next);
                  const profit = profitOf(r);
                  const fifoNow = valuationFor(r.month, next) === "fifo";
                  const fifoNext = fifoWith(r, next);
                  return (
                    <tr key={r.month} className={cn(Math.abs(profit) >= 0.5 && "bg-warn-soft/40")}>
                      <td className="px-2 py-2 sm:px-3 sm:whitespace-nowrap">
                        {monthLabel(r.month)}{" "}
                        {r.overridden ? (
                          <Badge tone="gray">Elle</Badge>
                        ) : fifoNow ? (
                          <Badge tone="green">FIFO</Badge>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-right sm:px-3">{now === null ? "elle girildi" : tl(now)}</td>
                      <td className="px-2 py-2 text-right font-medium text-ink sm:px-3">{after === null ? "elle girildi" : tl(after)}</td>
                      <td className={cn("px-2 py-2 text-right sm:px-3", profit > 0.5 ? "text-good" : profit < -0.5 ? "text-bad" : "text-ink-mute")}>
                        {Math.abs(profit) < 0.5 ? "–" : signed(profit)}
                      </td>
                      <td className="hidden px-3 py-2 text-right text-ink-mute sm:table-cell">{fifoNext && fifoNext.value > 0 ? pct(fifoNext.covered / fifoNext.value, 0) : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-2xl bg-surface px-4 py-3 text-[13px] text-ink-mute ring-1 ring-line">Henüz sayım girilmiş ay yok; yöntem ilk sayımdan itibaren uygulanır.</p>
        )}
        {dirty && shown.length ? (
          <p className="text-xs text-ink-mute">
            {changed.length ? `Değişen ay: ${changed.map((r) => monthLabel(r.month)).join(", ")}.` : "Sayımı olan aylarda değer değişmiyor."}{" "}
            {openings.map((o) => `${monthLabel(o.month)} açılışı ${signed(o.delta)} (sayımı yok; o ayın kârı ${signed(-o.delta)}).`).join(" ")}
            {openings.length ? " " : ""}
            <span className="max-sm:hidden">Faturadan: FIFO tutarının Paraşüt faturalarıyla karşılanan kısmı; kalan ay sonu fiyatıyla.</span>
          </p>
        ) : null}
      </CardContent>
    </SectionCard>
  );
}

"use client";

import { Layers } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/form";
import { InfoTip } from "@/components/ui/misc";
import { valuationFor } from "@/lib/calc/fifo";
import { monthLabel, pct, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { saveStockValuationStart } from "@/server/actions/settings";

import { SectionCard } from "./section-card";

/** Sayımı olan bir ayın iki yöntemle değeri (engine.ts valuationPreview); `overridden`: Gelir-giderde elle girildi */
export interface ValuationRow {
  month: string;
  old: number;
  fifo: number;
  covered: number;
  overridden: boolean;
}

/** Ayarlarda kapalı seçeneğinin değeri (select metin ister) */
const OFF = "";

/**
 * Ayarlar › Stok değerleme: ilk giren ilk çıkar (FIFO) başlangıç ayı ve ay ay önce / sonra kapanış stoğu önizlemesi.
 * Değer kayıtlı başlangıçla "şimdi", seçilen başlangıçla "sonra"; kâr etkisi kapanış farkı eksi önceki ayın kapanış
 * farkı (SMM = açılış + alış − kapanış). Gelir-giderde elle girilen kapanış yöntemden etkilenmez.
 */
export function StockValuationCard({ start, rows, months }: { start: string | null; rows: ValuationRow[]; months: string[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState(start ?? OFF);
  const [busy, setBusy] = useState(false);
  const next = draft || null;
  const dirty = next !== start;
  const valueWith = (r: ValuationRow, from: string | null) => (r.overridden ? null : valuationFor(r.month, from) === "fifo" ? r.fifo : r.old);
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const prevMonth = (m: string) => {
    const [y, mm] = m.split("-").map(Number);
    return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, "0")}`;
  };
  const delta = (r: ValuationRow | undefined) => (r ? (valueWith(r, next) ?? 0) - (valueWith(r, start) ?? 0) : 0);
  const shown = rows.filter((r) => r.old || r.fifo).slice(-12);
  const changed = shown.filter((r) => Math.abs(delta(r)) >= 0.5 || Math.abs(delta(byMonth.get(prevMonth(r.month)))) >= 0.5);

  const save = async () => {
    setBusy(true);
    const res = await saveStockValuationStart(next);
    setBusy(false);
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
            <table className="w-full min-w-[34rem] text-sm tabular">
              <caption className="sr-only">Ay sonu stoğu: kayıtlı yöntem ve seçilen yöntem</caption>
              <thead className="bg-surface text-left text-xs text-ink-mute">
                <tr>
                  <th className="px-3 py-2 font-medium">Ay</th>
                  <th className="px-3 py-2 text-right font-medium">Şimdi</th>
                  <th className="px-3 py-2 text-right font-medium">Seçilenle</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Kâr etkisi <InfoTip className="ml-1" text="Kapanış stoğu artarsa o ayın mal maliyeti düşer, kâr artar; sonraki ayın açılışı da aynı kadar artar ve o ayın kârı düşer." />
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Faturadan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((r) => {
                  const now = valueWith(r, start);
                  const after = valueWith(r, next);
                  const profit = delta(r) - delta(byMonth.get(prevMonth(r.month)));
                  const fifoNow = valuationFor(r.month, next) === "fifo";
                  return (
                    <tr key={r.month} className={cn(Math.abs(profit) >= 0.5 && "bg-warn-soft/40")}>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {monthLabel(r.month)}{" "}
                        {r.overridden ? (
                          <Badge tone="gray">Elle</Badge>
                        ) : fifoNow ? (
                          <Badge tone="green">FIFO</Badge>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right">{now === null ? "elle girildi" : tl(now)}</td>
                      <td className="px-3 py-2 text-right font-medium text-ink">{after === null ? "elle girildi" : tl(after)}</td>
                      <td className={cn("px-3 py-2 text-right", profit > 0.5 ? "text-good" : profit < -0.5 ? "text-bad" : "text-ink-mute")}>
                        {Math.abs(profit) < 0.5 ? "–" : `${profit > 0 ? "+" : "−"}${tl(Math.abs(profit))}`}
                      </td>
                      <td className="px-3 py-2 text-right text-ink-mute">{r.fifo > 0 && fifoNow ? pct(r.covered / r.fifo, 0) : "–"}</td>
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
            {changed.length ? `Değişen ay: ${changed.map((r) => monthLabel(r.month)).join(", ")}.` : "Sayımı olan aylarda değer değişmiyor."} Faturadan: FIFO tutarının Paraşüt
            faturalarıyla karşılanan kısmı; kalan ay sonu fiyatıyla.
          </p>
        ) : null}
      </CardContent>
    </SectionCard>
  );
}

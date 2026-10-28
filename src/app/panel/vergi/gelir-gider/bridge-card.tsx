import { ArrowRightLeft } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { money } from "@/lib/format";
import { monthName } from "@/lib/tax/calendar";
import { type BridgeRow, bridge } from "@/lib/tax/pnl";
import type { QuarterView } from "@/lib/tax/view";

import { DetailList, Explain, NoteList } from "../ui";

/*
 * Köprü kartı (plan docs/planlar/vergi.md §3.2 `bridge`, §4.2): Gelir-gider ekranındaki giderden vergiye göre gidere,
 * çeyrek ve ay ay. Gelir için yalnız kaynak yazar; yönetim verisiyle mali belge arasındaki fark hiçbir yerde yazılmaz (K11).
 */

const signed = (r: BridgeRow) => (r.key === "start" || r.key === "end" ? money(r.amount) : r.amount < 0 ? `− ${money(-r.amount)}` : `+ ${money(r.amount)}`);
const rowsOf = (rows: readonly BridgeRow[]) => rows.map((r) => ({ label: r.label, value: signed(r), strong: r.key === "start" || r.key === "end" }));

export function BridgeCard({ quarter }: { quarter: QuarterView }) {
  const months = quarter.months.map((m) => ({ m, b: bridge(m) }));
  const incomes = [...new Set(months.map((x) => x.b.income))];
  const incomeLines = incomes.length <= 1 ? incomes : months.map((x) => `${monthName(x.m.month)}: ${x.b.income.replace(/^Gelir: /, "")}`);
  // Personel cümlesi (§3.2): son tam ayın; ay ay köprüde her ayınki
  const withPersonnel = months.filter((x) => x.b.personnel);
  const lastPersonnel = withPersonnel.filter((x) => !x.m.inProgress).at(-1) ?? withPersonnel.at(-1);
  return (
    <Card>
      <CardHeader icon={<ArrowRightLeft />} title="Gelir-gider'den vergiye" description={`Gelir-gider ekranındaki gider vergiye göre gidere nasıl dönüşüyor (${quarter.label}, KDV hariç)`} />
      <CardContent className="space-y-3">
        <DetailList rows={rowsOf(quarter.bridge)} />
        <NoteList notes={[...incomeLines, ...(lastPersonnel ? [`${monthName(lastPersonnel.m.month)}: ${lastPersonnel.b.personnel}`] : [])]} />
        {months.length ? (
          <Explain title="Ay ay köprü">
            {months.map(({ m, b }) => (
              <section key={m.month} aria-label={monthName(m.month)} className="space-y-1.5">
                <h3 className="text-xs font-semibold text-ink-soft">{monthName(m.month)}</h3>
                <DetailList rows={rowsOf(b.rows)} />
                <NoteList notes={[b.income, ...(b.personnel ? [b.personnel] : [])]} />
              </section>
            ))}
          </Explain>
        ) : null}
      </CardContent>
    </Card>
  );
}

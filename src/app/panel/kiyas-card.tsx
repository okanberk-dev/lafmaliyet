import { ArrowLeftRight } from "lucide-react";
import type { ReactNode } from "react";

import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, Well } from "@/components/ui/card";
import { GrowthPill, InfoTip } from "@/components/ui/misc";
import { num, tl } from "@/lib/format";
import { changeSpeech, changeText, daysInMonth, diffText, type KiyasRow, type KiyasSummary } from "@/lib/kiyas";
import { dayLocativeTR, dayMonthTR, longDateTR, monthLocativeTR, shiftMonth } from "@/lib/reminders";
import { cn } from "@/lib/utils";

/** Değişim hapı: ok, işaret ve yüzde (renk tek başına anlam taşımaz); ekran okuyucuya ne ile kıyaslandığı, aynı eşikle */
function Pill({ g, against }: { g: number; against: string }) {
  return (
    <GrowthPill value={g} marker={false}>
      <span aria-hidden>{changeText(g)}</span>
      <span className="sr-only">
        {against} ile kıyasla {changeSpeech(g)}
      </span>
    </GrowthPill>
  );
}

/** Cümle içinde: "Geçen hafta" → "geçen hafta" (ay adları büyük harfle kalır) */
const inline = (s: string) => (/^(Bu|Geçen|Önceki|Son|Dün)( |$)/.test(s) ? s.charAt(0).toLocaleLowerCase("tr-TR") + s.slice(1) : s);

/** Dönemin tarafı cümle içinde: "bu hafta", "Kasım'da", "son 7 günde" / "geçen hafta", "Ekim'de", "önceki 7 günde" */
function sidePhrase(row: KiyasRow, side: "cur" | "prev"): string {
  if (row.key === "son-7") return side === "cur" ? "son 7 günde" : "önceki 7 günde";
  const label = side === "cur" ? row.label : row.prevLabel;
  if (row.key === "bu-ay" && !/^(Bu|Geçen) ay$/.test(label)) {
    return monthLocativeTR(side === "cur" ? row.curFrom : (row.prevFrom ?? shiftMonth(row.curFrom.slice(0, 7), -1)));
  }
  return inline(label);
}

/**
 * Kıyas dışı kalanların notları. Verisi olmayan şube "veri yok" (gün satırında hangi gün, dönemde kaç gün ve hangi
 * tarafta); kıyaslanan tarafta henüz açılmamış şube "henüz açılmamıştı" (veri yok sayılmaz). Tek şubede kıyas hiç
 * yapılamadıysa sağdaki durum yeter
 */
function exclusionNotes(row: KiyasRow, branches: number, period: boolean): string[] {
  const multi = branches > 1;
  const out: string[] = [];
  if (!(row.state === "veri-yok" && !multi)) {
    for (const e of row.excluded) {
      const where = period
        ? [e.curDays ? `${sidePhrase(row, "cur")} ${e.curDays} gün` : null, e.prevDays ? `${sidePhrase(row, "prev")} ${e.prevDays} gün` : null].filter(Boolean).join(", ")
        : [e.curDays ? dayMonthTR(row.curFrom) : null, e.prevDays && row.prevFrom ? dayMonthTR(row.prevFrom) : null].filter(Boolean).join(" ve ");
      const text = period ? `veri yok (${where}), kıyas dışı` : `${where} veri yok, kıyas dışı`;
      out.push(multi ? `${e.name}: ${text}` : text.charAt(0).toLocaleUpperCase("tr-TR") + text.slice(1));
    }
  }
  if (!(row.state === "acilmamis" && !multi)) {
    for (const n of row.notOpen) {
      const when = period ? `${sidePhrase(row, "prev")} ${n.days} gün` : row.prevFrom ? dayLocativeTR(row.prevFrom) : "o gün";
      out.push(`${n.name} ${when} henüz açılmamıştı, kıyas dışı`);
    }
  }
  return out;
}

/** Kıyaslananlar satırın tutarlarından ayrıldıysa (bir şube ya da gün kıyas dışı) yüzdenin dayandığı tutarlar */
function comparedLine(row: KiyasRow): string | null {
  if (row.state !== "ok" || !row.cur || !row.prev || row.diff === null) return null;
  const same = row.cur.revenue === row.curAll?.revenue && row.prev.revenue === row.prevAll?.revenue;
  return same ? null : `Kıyaslanan (iki günü de bilinenler): ${tl(row.cur.revenue)} ↔ ${tl(row.prev.revenue)} · ${diffText(row.diff)}`;
}

function receiptLine(row: KiyasRow): string | null {
  if (row.state !== "ok") return null;
  const parts = [
    row.receiptsChange !== null && row.cur?.receipts != null && row.prev?.receipts != null
      ? `Fiş ${num(row.prev.receipts)} → ${num(row.cur.receipts)} (${changeText(row.receiptsChange)})`
      : null,
    row.avgReceiptChange !== null ? `ort. fiş ${tl(row.prev?.avgReceipt)} → ${tl(row.cur?.avgReceipt)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

const Muted = ({ children }: { children: ReactNode }) => <span className="text-sm text-ink-mute">{children}</span>;
const Amount = ({ v }: { v: number }) => <span className="text-sm font-semibold tabular text-ink">{tl(v)}</span>;

function Line({ label, sub, right, notes }: { label: string; sub: string | null; right: ReactNode; notes: (string | null)[] }) {
  const shown = notes.filter((n): n is string => Boolean(n));
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{label}</p>
          {sub ? <p className="text-xs text-ink-mute">{sub}</p> : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">{right}</div>
      </div>
      {shown.length ? (
        <div className="mt-1 space-y-0.5 text-xs text-ink-mute tabular">
          {shown.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Tek günlük kıyas satırı: satır kıyaslanan günündür (alt yazıda tarihi). Sağda o günün cirosu ve hap; o gün satış yoksa
 * "o gün satış yok" (0 ₺ yazılmaz). Gösterilen günde satış yoksa sağda kıyaslanan günün cirosu, notta gösterilen günün
 * satışsız olduğu
 */
function DayLine({ row, branches }: { row: KiyasRow; branches: number }) {
  const prevMonth = shiftMonth(row.curFrom.slice(0, 7), -1);
  const sub = row.prevFrom ? longDateTR(row.prevFrom) : `${monthLocativeTR(prevMonth)} ${daysInMonth(prevMonth)} gün var`;
  const prevSold = row.sides?.prev === "satis" && row.prevAll ? row.prevAll.revenue : null;
  let right: ReactNode;
  if (row.state === "ok" && prevSold !== null && row.change !== null) {
    right = (
      <>
        <Amount v={prevSold} />
        <Pill g={row.change} against={row.label} />
      </>
    );
  } else if (row.state === "satis-yok") {
    right = prevSold !== null ? <Amount v={prevSold} /> : <Muted>{row.sides?.prev === "satis-yok" ? "o gün de satış yok" : "veri yok"}</Muted>;
  } else {
    right = (
      <Muted>
        {row.state === "onceki-satis-yok" ? "o gün satış yok" : row.state === "acilmamis" ? "o gün açılmamıştı" : row.state === "tarih-yok" ? "bu tarih yok" : "veri yok"}
      </Muted>
    );
  }
  const compared = comparedLine(row);
  return (
    <Line
      label={row.label}
      sub={sub}
      right={right}
      notes={[
        row.state === "ok" && row.diff !== null && !compared ? `${diffText(row.diff)} fark` : null,
        compared,
        row.state === "satis-yok" ? `${dayLocativeTR(row.curFrom)} satış yok` : null,
        ...exclusionNotes(row, branches, false),
        receiptLine(row),
      ]}
    />
  );
}

/**
 * Dönem satırı: sağda dönemin ciro toplamı (bilinen bütün günler) ve hap; altında kıyaslanan dönemin toplamı, yüzde bir
 * gün ya da şube kıyas dışı kaldığı için başka tutarlara dayanıyorsa onlar, son 7 günde açık gün başına ortalama
 */
function PeriodLine({ row, branches }: { row: KiyasRow; branches: number }) {
  const ok = row.state === "ok" && row.change !== null && row.diff !== null;
  const sub = row.curFrom === row.curTo ? dayMonthTR(row.curFrom) : `${dayMonthTR(row.curFrom)} – ${dayMonthTR(row.curTo)}`;
  const curSold = row.sides?.cur === "satis" && row.curAll ? row.curAll.revenue : null;
  const stateText =
    row.state === "satis-yok"
      ? "satış yok"
      : row.state === "onceki-satis-yok"
        ? `${sidePhrase(row, "prev")} satış yok`
        : row.state === "acilmamis"
          ? `${sidePhrase(row, "prev")} açılmamıştı`
          : curSold !== null
            ? "kıyas için veri yok"
            : "veri yok";
  const right =
    curSold !== null ? (
      <>
        <Amount v={curSold} />
        {ok ? <Pill g={row.change!} against={row.prevLabel} /> : <Muted>{stateText}</Muted>}
      </>
    ) : (
      <Muted>{stateText}</Muted>
    );
  const compared = comparedLine(row);
  const prevSide = row.sides?.prev;
  const prevAmount = prevSide === "satis" && row.prevAll ? tl(row.prevAll.revenue) : prevSide === "satis-yok" ? "satış yok" : "veri yok";
  const prevRange = row.prevFrom && row.prevTo ? ` (${row.prevFrom === row.prevTo ? dayMonthTR(row.prevFrom) : `${dayMonthTR(row.prevFrom)} – ${dayMonthTR(row.prevTo)}`})` : "";
  // Açılmamış dönemin tutarı yazılmaz (veri yok değil; notta); kıyaslanan dönemde satış yoksa sağda yazar
  const prevText = row.state === "acilmamis" || row.state === "onceki-satis-yok" ? null : `${row.prevLabel}: ${prevAmount}${prevRange}${ok && !compared ? ` · ${diffText(row.diff!)}` : ""}`;
  const unpaired = row.unpairedDays ? `${monthLocativeTR(shiftMonth(row.curFrom.slice(0, 7), -1))} olmayan ${row.unpairedDays} gün kıyas dışı` : null;
  const perDay =
    row.key === "son-7" && row.curAll?.dailyAvg != null
      ? `Açık gün başına: günde ${tl(row.curAll.dailyAvg)} (${row.curAll.openDays} gün)${row.prevAll?.dailyAvg != null ? ` ↔ ${tl(row.prevAll.dailyAvg)} (${row.prevAll.openDays} gün)` : ""}`
      : null;
  return (
    <Line
      label={row.label}
      sub={sub}
      right={right}
      notes={[prevText, compared, unpaired, ...exclusionNotes(row, branches, true), perDay, receiptLine(row)]}
    />
  );
}

/**
 * "Kıyas" kartı (Genel bakış'ın üstünde, Bugün'de yöneticinin sağ sütununda; docs/KIYAS.md). Son kapanmış iş gününün
 * cirosu, önceki gün / geçen hafta / geçen ay ile kıyası ve dönem kıyasları. `narrow`: dar sütunda (Bugün) tek sütun.
 */
export function KiyasCard({ data, branchNames, narrow = false }: { data: KiyasSummary; branchNames: string[]; narrow?: boolean }) {
  const { day } = data;
  const scope = branchNames.length === 1 ? branchNames[0] : `${branchNames.length} şube`;
  const names = (xs: { name: string }[]) => xs.map((x) => x.name).join(", ");
  return (
    <Card>
      <CardHeader
        icon={<ArrowLeftRight />}
        title="Kıyas"
        description={
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            {scope} · KDV dahil, ödenmez / ikram hariç
            <InfoTip text="Gün: bütün şubeler bugünün gün sonunu verdiyse bugün, yoksa dün. Ciro kasa raporundan (girilmemişse AsilPOS gün sonu ya da ModPOS föyü), Genel bakış'ın günlük cirosuyla aynı. Satırdaki tutar günün ya da dönemin bilinen cirosu; yüzde şube şube ve gün gün eşlenerek, iki günü de bilinenlerle hesaplanır. Verisi olmayan gün (veri yok) sıfır sayılmaz. Kapalı işaretli ya da Z'si sıfır gün 'satış yok'; bir şubenin verisi yokken öteki kapalıysa 'veri yok'. Son 7 gün: 7 günün toplam cirosu." />
          </span>
        }
        actions={
          <ButtonLink href={`/panel/kasa?gun=${day.date}`} variant="secondary" size="sm" className="pointer-coarse:h-11">
            Kasa
          </ButtonLink>
        }
      />
      <CardContent className={cn("grid gap-4", !narrow && "lg:grid-cols-2 lg:gap-6")}>
        <div className="min-w-0 space-y-4">
          <Well className="p-4">
            <p className="text-[13px] text-ink-mute">
              {day.isToday ? "Bugün" : "Dün"} · {longDateTR(day.date)}
            </p>
            {day.state === "satis" ? (
              <>
                <p className="mt-0.5 text-3xl font-semibold tracking-tight tabular text-ink dark:font-normal">{tl(day.revenue)}</p>
                <p className="mt-1 text-xs text-ink-mute tabular">
                  {day.receipts ? `${num(day.receipts)} fiş · ortalama ${tl(day.avgReceipt)}` : "Fiş sayısı girilmedi"}
                </p>
              </>
            ) : (
              <p className="mt-1 text-xl font-semibold text-ink-mute">{day.state === "satis-yok" ? "Satış yok" : "Veri yok"}</p>
            )}
            {day.state === "satis" && day.missing.length ? (
              <p className="mt-1 text-xs text-warn-ink">{names(day.missing)}: gün sonu yok, toplama girmedi</p>
            ) : null}
            {day.state === "veri-yok" && day.missing.length && day.noSale.length ? (
              <p className="mt-1 text-xs text-ink-mute">
                {names(day.missing)}: gün sonu yok · {names(day.noSale)}: satış yok
              </p>
            ) : null}
          </Well>
          <ul className="divide-y divide-line" aria-label="Günlük kıyas">
            {data.days.map((r) => (
              <DayLine key={r.key} row={r} branches={branchNames.length} />
            ))}
          </ul>
        </div>
        <div className="min-w-0">
          <h3 className="mb-2 text-sm font-semibold text-ink">Dönem</h3>
          <ul className="divide-y divide-line" aria-label="Dönem kıyası">
            {data.periods.map((r) => (
              <PeriodLine key={r.key} row={r} branches={branchNames.length} />
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

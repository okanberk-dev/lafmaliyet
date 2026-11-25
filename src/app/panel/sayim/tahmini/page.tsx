import { Boxes, ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/misc";
import { Notice, NoticeLink } from "@/components/ui/notice";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ALL_BRANCHES, type BranchRow } from "@/lib/branches";
import { dateTR, monthLabel, monthShort, num } from "@/lib/format";
import { addDays, dayAblativeTR, dayMonthTR, shiftMonth } from "@/lib/reminders";
import {
  STOCK_ESTIMATE_BRANCH,
  STOCK_ESTIMATE_PATH,
  stockQty,
  thresholdInputValue,
  type SkippedRows,
  type StockEstimateLine,
} from "@/lib/stock-estimate";
import { genitive } from "@/lib/recipe-change";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/dal";
import { currentBranchScope, staffBranchLock } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { loadReceiptInvoices, loadStockEstimate, unassignedCount, type ReceiptInvoice } from "@/server/data/stock-estimate";

import { ReceiptChoice } from "./receipt-choice";
import { ThresholdInput } from "./threshold-input";

export const metadata: Metadata = { title: "Tahmini stok" };

/** Tek cümle, 100 harfi geçmez (docs/planlar/ux-sade.md §8) */
const DESCRIPTION = "Marina'da son sayımdan bu yana gelen mal, LafPOS satışı, zayi ve ikramla hesaplanan stok.";

/**
 * Başlık ve Stok sekmeleri (ekran Stok sayımı'nın alt ekranı: sekmede Sayım seçili). Rol bilinmeden (yükleniyor)
 * personelin sekmeleri çizilir; yöneticinin Tutarlılık'ı içerik gelince eklenir.
 */
function Header({ role, meta }: { role: "admin" | "staff"; meta?: ReactNode }) {
  return (
    <PageHeader
      path={STOCK_ESTIMATE_PATH}
      role={role}
      title="Tahmini stok"
      description={DESCRIPTION}
      meta={meta}
      tabs={<SectionTabs section="stok" current="/panel/sayim" role={role} />}
    />
  );
}

/**
 * Tahmini stok (docs/STOK-TAHMINI.md): yalnız Marina, yalnız LafPOS'a geçildiyse. İki rol açar (Stok sayımı'nın alt
 * ekranı); eşik ve faturanın şubesi yalnız yöneticide. Ekranda para yok: tutar, fiyat ve fatura tutarı gösterilmez.
 */
export default function StockEstimatePage() {
  return (
    <Suspense
      fallback={
        <>
          <Header role="staff" />
          <PageSkeleton rows={10} />
        </>
      }
    >
      <StockEstimateContent />
    </Suspense>
  );
}

async function StockEstimateContent() {
  const user = await requireUser();
  const admin = user.role === "admin";
  // Başka şubeye kilitli personel Marina'nın stoğunu görmez (docs/SUBE.md › Personel hesabının şubesi)
  const lock = admin ? null : await staffBranchLock();
  if (lock !== null && lock !== STOCK_ESTIMATE_BRANCH) {
    return (
      <>
        <Header role={user.role} />
        <Notice tone="neutral" title="Tahmini stok yalnız Marina için tutulur" text="Hesabınız başka bir şubede." />
      </>
    );
  }
  const data = await loadStockEstimate();
  if (!data) {
    return (
      <>
        <Header role={user.role} />
        <Notice tone="neutral" title="Marina LafPOS'a geçmedi: tahmin yok" text="Satışlar LafPOS'tan gün gün gelmeye başlayınca tahmin açılır." />
      </>
    );
  }
  const { estimate, today, lafposFrom } = data;
  // Faturanın şubesi kartı yalnız yöneticide ve tahmin başladıysa (dönemin faturaları)
  const [receipts, branches, scope] = await Promise.all([
    admin && estimate.from ? loadReceiptInvoices(estimate.from, today) : Promise.resolve<ReceiptInvoice[]>([]),
    admin ? listBranches() : Promise.resolve<BranchRow[]>([]),
    currentBranchScope(),
  ]);
  // Başka şube seçiliyken (ör. Tuzla) ekran yine Marina'nın tahminidir: söylenir (şube kapsamı tarama #78)
  const otherScope = scope !== ALL_BRANCHES && scope !== STOCK_ESTIMATE_BRANCH ? (branches.find((b) => b.id === STOCK_ESTIMATE_BRANCH)?.name ?? "Marina") : null;
  const physical = branches.filter((b) => b.active && b.kind === "fiziksel").map((b) => ({ id: b.id, name: b.name }));
  const unassigned = unassignedCount(receipts);
  const meta =
    estimate.from !== null
      ? `${estimate.lastDay ? `Son gün sonu ${dayMonthTR(estimate.lastDay)}` : "Henüz gün sonu gelmedi"} · bugünün satışı gün sonuyla gelir`
      : undefined;
  // Tahmin hiç başlamadıysa hangi sayımla başlayacağı: LafPOS'un sayıldığı ilk günü kapsayan ay ya da bitmiş son ay
  const firstMonth = addDays(lafposFrom, -1).slice(0, 7);
  const lastFinished = shiftMonth(today.slice(0, 7), -1);
  const startMonth = lastFinished > firstMonth ? lastFinished : firstMonth;
  const skipped = estimate.unmatched.lines + estimate.noRecipe.lines;

  return (
    <>
      <Header role={user.role} meta={meta} />
      <div className="space-y-4">
        {otherScope ? <Notice tone="neutral" size="sm" title={`Tahmini stok yalnız ${otherScope} için tutulur`} text={`Seçili şubenin değil, ${genitive(otherScope)} tahmini görünüyor.`} /> : null}
        {estimate.counts.tahmin === 0 ? (
          <Notice
            tone="neutral"
            title={`Tahmin ${monthLabel(startMonth)} sayımı girilince başlar`}
            text={
              lafposFrom > today
                ? `LafPOS'un satışı ${dayAblativeTR(lafposFrom)} itibaren sayılacak; ay sonu sayımı tahminin başlangıcıdır.`
                : `LafPOS'un satışı ${dayAblativeTR(lafposFrom)} beri gün gün geliyor; ay sonu sayımı tahminin başlangıcıdır.`
            }
          />
        ) : null}
        {admin && unassigned > 0 ? (
          <Notice
            tone="neutral"
            title={`${num(unassigned)} faturanın şubesi seçilmedi`}
            text="Marina'ya gelen faturayı seçin; seçilmeyen fatura tahmine girmez."
            action={<NoticeLink href="#faturalar">Faturalara git</NoticeLink>}
          />
        ) : null}
        {admin && estimate.missingDays.length ? (
          <Notice tone="neutral" title={`${num(estimate.missingDays.length)} günün LafPOS gün sonu gelmedi`} text="O günlerin satışı tahmine girmedi; stok olduğundan fazla görünür.">
            <p>
              {estimate.missingDays.map(dayMonthTR).join(", ")}. LafPOS&apos;ta Kasa › Geçmiş günler&apos;de o günün Z raporundan Gönder&apos;e basın.
            </p>
          </Notice>
        ) : null}
        {admin && skipped ? (
          <Notice tone="neutral" title={`${num(skipped)} satır tüketime girmedi`} text="Ürüne bağlı olmayan ya da reçetesi boş: malzemesi düşülmedi, stok fazla görünür.">
            {estimate.unmatched.lines ? <p>{skippedText("Ürüne bağlı değil", estimate.unmatched)} Ayarlar › LafPOS (kasa)&apos;da bağlanır.</p> : null}
            {estimate.noRecipe.lines ? <p>{skippedText("Reçetesi boş", estimate.noRecipe)} Ürünler & kârlılık&apos;ta reçete yazılır.</p> : null}
          </Notice>
        ) : null}

        <Card>
          <CardHeader
            icon={<Boxes />}
            title="Malzemeler"
            description="Rakamlar tahminidir; gerçek stok ay sonu sayımıdır."
            meta={
              <>
                <span className="tabular">{num(estimate.lines.length)} malzeme</span>
                {estimate.critical.length ? (
                  <Badge tone="red" dot>
                    {num(estimate.critical.length)} kritik
                  </Badge>
                ) : null}
                {estimate.counts["sayim-yok"] ? <span className="tabular">· {num(estimate.counts["sayim-yok"])} sayım yok</span> : null}
              </>
            }
          />
          <CardContent className="px-3 sm:px-5">
            {/* Geniş ekranda tablo, telefonda kart (docs/TASARIM.md §6) */}
            <TableWrap className="-mx-2 max-md:hidden">
              <Table>
                <THead>
                  <tr>
                    <TH>Malzeme</TH>
                    <TH numeric>Son sayım</TH>
                    <TH numeric>Gelen</TH>
                    <TH numeric>Satış</TH>
                    <TH numeric>Zayi ve ikram</TH>
                    <TH numeric>Tahmini</TH>
                    <TH>Kritik eşik</TH>
                  </tr>
                </THead>
                <tbody>
                  {estimate.lines.map((l) => (
                    <TR key={l.ingredientId}>
                      <TD>
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium">{l.name}</span>
                          <StatusBadge line={l} />
                        </span>
                      </TD>
                      <TD numeric>{countText(l)}</TD>
                      <TD numeric>{signed(l.purchased, l, "+")}</TD>
                      <TD numeric>{signed(l.sold, l, "−")}</TD>
                      <TD numeric>{signed(l.wasted, l, "−")}</TD>
                      <TD numeric>
                        <EstimateValue line={l} />
                      </TD>
                      <TD>{admin ? <Threshold line={l} /> : thresholdText(l)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
            <ul className="divide-y divide-line-strong/70 md:hidden">
              {estimate.lines.map((l) => (
                <li key={l.ingredientId} className="space-y-2 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-ink">{l.name}</span>
                      <StatusBadge line={l} />
                    </span>
                    <span className="shrink-0 text-right">
                      <EstimateValue line={l} />
                    </span>
                  </div>
                  {l.status === "tahmin" ? (
                    <p className="text-[13px] text-ink-mute tabular">
                      Sayım {countText(l)} · gelen {signed(l.purchased, l, "+")} · satış {signed(l.sold, l, "−")} · zayi ve ikram {signed(l.wasted, l, "−")}
                    </p>
                  ) : null}
                  <div className="flex items-center gap-2 text-[13px] text-ink-mute">
                    <span>Kritik eşik</span>
                    {admin ? <Threshold line={l} /> : <span className="text-ink tabular">{thresholdText(l)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {admin && estimate.from ? (
          <Card id="faturalar" className="scroll-mt-20">
            <CardHeader
              icon={<ReceiptText />}
              title="Marina'ya gelen faturalar"
              description="Faturalar şubeye bölünmez: Marina'ya geleni seçin; yalnız tahmini stok değişir."
              meta={<span className="tabular">{`${dayAblativeTR(estimate.from)} bugüne · ${num(receipts.length)} fatura`}</span>}
            />
            <CardContent className="px-3 sm:px-5">
              {receipts.length ? (
                <ul className="divide-y divide-line-strong/70">
                  {[...receipts]
                    .sort((a, b) => Number(a.branchId !== null) - Number(b.branchId !== null))
                    .map((inv) => (
                      <li key={inv.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                        <span className="min-w-0">
                          <span className="block font-medium text-ink">
                            {inv.supplier} <span className="font-normal text-ink-mute tabular">· {dateTR(inv.date)}</span>
                          </span>
                          <span className="block text-[13px] text-ink-mute">
                            {inv.items.join(", ")}
                            {inv.more ? ` ve ${num(inv.more)} kalem daha` : ""}
                          </span>
                        </span>
                        <ReceiptChoice invoiceId={inv.id} label={`${inv.supplier} ${dateTR(inv.date)}`} value={inv.branchId} branches={physical} />
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="pb-1 text-[13px] text-ink-mute">Bu dönemde hammaddeye bağlı kalemi olan fatura yok.</p>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}

/** "Ürüne bağlı değil (2 satır, 4 adet): PUMPKIN LATTE, TADIM." */
function skippedText(head: string, s: SkippedRows): string {
  const rest = s.names > s.top.length ? ` ve ${num(s.names - s.top.length)} ad daha` : "";
  return `${head} (${num(s.lines)} satır, ${num(s.qty, 1)} adet): ${s.top.join(", ")}${rest}.`;
}

/** Sayılan miktar ve ayı: "10 LT · Kas" */
function countText(l: StockEstimateLine): string {
  if (l.counted === null || !l.countMonth) return "–";
  return `${stockQty(l.counted, l)} · ${monthShort(l.countMonth)}`;
}

/** Hareket: "+12 LT", "−2,1 LT"; tahmin yoksa ya da hareket yoksa "–" */
function signed(v: number | null, l: StockEstimateLine, sign: "+" | "−"): string {
  if (v === null || Math.abs(v) < 1e-9) return "–";
  const text = stockQty(Math.abs(v), l);
  // Eksi alış (iade fazla) ve eksi zayi olmaz; alışta eksi işaretle yazılır
  return v < 0 ? `−${text}` : `${sign}${text}`;
}

function thresholdText(l: StockEstimateLine): string {
  return l.threshold === null ? "Yok" : stockQty(l.threshold, l);
}

function StatusBadge({ line }: { line: StockEstimateLine }) {
  if (line.critical)
    return (
      <Badge tone="red" dot>
        Kritik
      </Badge>
    );
  if (line.status === "sayim-yok") return <Badge tone="gray">Sayım yok</Badge>;
  if (line.status === "lafpos-oncesi") return <Badge tone="gray">Sayım LafPOS&apos;tan önce</Badge>;
  return null;
}

/** Tahmini miktar: "≈ 16,8 LT"; kritikse kırmızı ve kalın, tahmin yoksa "–" */
function EstimateValue({ line }: { line: StockEstimateLine }) {
  if (line.estimate === null) return <span className="text-ink-quiet">–</span>;
  return (
    <span className={cn("font-semibold tabular", line.critical ? "text-bad" : "text-ink")}>
      ≈ {line.estimate < 0 ? `−${stockQty(-line.estimate, line)}` : stockQty(line.estimate, line)}
    </span>
  );
}

function Threshold({ line }: { line: StockEstimateLine }) {
  const initial = thresholdInputValue(line.threshold, line.factor);
  return <ThresholdInput key={initial} ingredientId={line.ingredientId} name={line.name} unit={line.unit} initial={initial} />;
}

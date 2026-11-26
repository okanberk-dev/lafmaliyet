import { ArrowLeft, ArrowLeftRight, CircleCheck, CircleDashed, CircleSlash, CreditCard, FileSpreadsheet, ListX, Scale } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { CompanyWideNotice } from "@/components/panel/company-wide-notice";
import { PageHeader } from "@/components/panel/page-header";
import { Badge, type Tone } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState, PageSkeleton, Stat } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { SegmentedLinks } from "@/components/ui/segmented";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { dateTR, money, num, pct } from "@/lib/format";
import { BASIS_LABEL, KEEP_DAYS, RECORD_LABEL } from "@/lib/mutabakat/match";
import { POS_STATUS_LABEL, type PosRow, type PosStatus } from "@/lib/mutabakat/pos";
import { filterRows, KIND_LABEL, lineActions, ROW_FILTERS, rowStatus, STATUS_LABEL, type RowFilter, type RowStatus } from "@/lib/mutabakat/view";
import { daysBetween, todayTR } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
import { listBranches } from "@/server/branches";
import { loadPosView, loadRecon, loadSupplierOptions, type StatementView } from "@/server/mutabakat/load";

import { BlockDaysForm } from "./block-days-form";
import { LineActions } from "./line-actions";
import { DeleteStatement } from "./statement-actions";
import { UploadButton } from "./upload-dialog";

export const metadata: Metadata = { title: "Mutabakat" };

const TITLE = "Mutabakat";
const DESCRIPTION = "Banka ve tedarikçi ekstresini panel kayıtlarıyla, kart satışını bankaya gelen parayla karşılaştırın.";
// Eski uzun açıklama: başlıktaki ⓘ "Nasıl çalışır?" (docs/planlar/ux-sade.md §8)
const MORE =
  "Bankanın ya da tedarikçinin ekstresini (.xlsx ya da CSV) yükleyin: hareketler harcamalar, tedarikçi ödemeleri, ödendi işaretli faturalar ve kasadan teslimlerle (tedarikçi ekstresinde faturalar ve ödemelerle) eşleşir. Eşleşmeyeni elle eşleştirin ya da yok sayın. POS hakediş sekmesi kasa raporlarının kart satışını bankaya gelen POS parasıyla karşılaştırır. Panel kaydına hiçbir şey yazılmaz; dosya saklanmaz, okunan hareketler 90 gün sonra silinir.";

const BASE = "/panel/mutabakat";

function Header({ tab, actions }: { tab: "ekstre" | "pos"; actions?: ReactNode }) {
  return (
    <PageHeader
      path={BASE}
      title={TITLE}
      description={DESCRIPTION}
      more={MORE}
      actions={actions}
      tabs={
        <SegmentedLinks
          label="Mutabakat"
          value={tab}
          options={[
            { value: "ekstre", label: "Banka & tedarikçi", href: BASE },
            { value: "pos", label: "POS hakediş", href: `${BASE}?sekme=pos` },
          ]}
        />
      }
    />
  );
}

export default function ReconPage({ searchParams }: PageProps<"/panel/mutabakat">) {
  return (
    <Suspense
      fallback={
        <>
          <Header tab="ekstre" />
          <PageSkeleton rows={8} />
        </>
      }
    >
      <ReconContent searchParams={searchParams} />
    </Suspense>
  );
}

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Kâr & ödemeler › Mutabakat (docs/MUTABAKAT.md); yalnız yönetici, proxy personeli buraya sokmaz */
async function ReconContent({ searchParams }: { searchParams: PageProps<"/panel/mutabakat">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  if (pick(sp.sekme) === "pos") return <PosSection />;
  const id = Number(pick(sp.ekstre));
  const { statements } = await loadRecon();
  const st = Number.isInteger(id) && id > 0 ? statements.find((x) => x.id === id) : undefined;
  if (st) {
    const raw = pick(sp.durum);
    const filter: RowFilter = ROW_FILTERS.includes(raw as RowFilter) ? (raw as RowFilter) : "hepsi";
    return <StatementDetail st={st} filter={filter} />;
  }
  const suppliers = await loadSupplierOptions();
  const accounts = [...new Set(statements.filter((x) => x.kind === "banka").map((x) => x.account))];
  const upload = <UploadButton suppliers={suppliers} accounts={accounts} />;
  return (
    <>
      <Header tab="ekstre" actions={upload} />
      <CompanyWideNotice screen="mutabakat" className="mb-4" />
      {statements.length ? (
        <StatementList statements={statements} />
      ) : (
        <Card>
          <EmptyState
            icon={<FileSpreadsheet />}
            title="Henüz ekstre yok"
            description="Bankanın hesap hareketlerini ya da tedarikçinin cari ekstresini .xlsx ya da CSV olarak indirip yükleyin: hareketler panel kayıtlarıyla eşleşir."
            action={upload}
          />
        </Card>
      )}
      <p className="mt-4 text-xs leading-5 text-ink-mute">
        Yüklenen dosya saklanmaz: yalnız okunan hareketler (gün, açıklama, tutar) tutulur, IBAN ve kart numarası örtülür; ekstre yüklendikten {num(KEEP_DAYS)} gün sonra
        silinir.
      </p>
    </>
  );
}

// ---------------------------------------------------------------- Ekstre listesi

function expiryText(expiresOn: string, today: string): string {
  const left = daysBetween(today, expiresOn);
  return left <= 0 ? "Bu gece silinir" : `${num(left)} gün sonra silinir`;
}

function StatementList({ statements }: { statements: StatementView[] }) {
  const today = todayTR();
  return (
    <Card>
      <CardHeader icon={<ArrowLeftRight />} title="Ekstreler" description="Yeni yüklenen önce. Ekstreye dokununca hareketleri ve eşleşmeleri açılır." meta={`${num(statements.length)} ekstre`} />
      <div className="max-md:hidden">
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>Ekstre</TH>
                <TH>Dönem</TH>
                <TH numeric>Hareket</TH>
                <TH numeric>Eşleşti</TH>
                <TH numeric>Tutarı farklı</TH>
                <TH numeric>Eşleşmedi</TH>
                <TH>Saklama</TH>
              </tr>
            </THead>
            <tbody>
              {statements.map((st) => (
                <TR key={st.id}>
                  <TD>
                    <Link href={`${BASE}?ekstre=${st.id}`} className="inline-flex items-center gap-2 font-medium hover:underline">
                      <Badge tone={st.kind === "banka" ? "blue" : "violet"}>{KIND_LABEL[st.kind]}</Badge>
                      {st.account}
                    </Link>
                    {st.orphan ? <p className="mt-1 text-xs text-warn">Tedarikçi bulunamadı</p> : null}
                  </TD>
                  <TD className="whitespace-nowrap">
                    {dateTR(st.periodFrom)} – {dateTR(st.periodTo)}
                  </TD>
                  <TD numeric>{num(st.summary.total)}</TD>
                  <TD numeric>{num(st.summary.eslesti)}</TD>
                  <TD numeric className={st.summary.fark ? "text-warn" : undefined}>
                    {num(st.summary.fark)}
                  </TD>
                  <TD numeric className={st.summary.yok ? "text-bad" : undefined}>
                    {num(st.summary.yok)}
                  </TD>
                  <TD className="text-xs whitespace-nowrap text-ink-mute">{expiryText(st.expiresOn, today)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </div>
      <ul className="flex flex-col gap-2 px-3 pb-3 md:hidden">
        {statements.map((st) => (
          <li key={st.id}>
            <Link href={`${BASE}?ekstre=${st.id}`} className="flex flex-col gap-1.5 rounded-2xl bg-surface p-3.5 ring-1 ring-line-strong">
              <span className="flex items-center gap-2 font-medium text-ink">
                <Badge tone={st.kind === "banka" ? "blue" : "violet"}>{KIND_LABEL[st.kind]}</Badge>
                <span className="min-w-0 truncate">{st.account}</span>
              </span>
              <span className="text-[13px] text-ink-mute">
                {dateTR(st.periodFrom)} – {dateTR(st.periodTo)} · {num(st.summary.total)} hareket
              </span>
              <span className="text-[13px] text-ink-mute">
                {num(st.summary.eslesti)} eşleşti · <span className={st.summary.fark ? "text-warn" : undefined}>{num(st.summary.fark)} farklı</span> ·{" "}
                <span className={st.summary.yok ? "text-bad" : undefined}>{num(st.summary.yok)} eşleşmedi</span>
              </span>
              <span className="text-xs text-ink-mute">{expiryText(st.expiresOn, today)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------- Ekstrenin ayrıntısı

const STATUS_TONE: Record<RowStatus, Tone> = { eslesti: "green", fark: "amber", yok: "red", yoksay: "gray", pos: "blue" };

function StatementDetail({ st, filter }: { st: StatementView; filter: RowFilter }) {
  const today = todayTR();
  const rows = filterRows(st.rows, filter);
  const counts: Record<RowFilter, number> = {
    hepsi: st.rows.length,
    yok: st.summary.yok,
    fark: st.summary.fark,
    eslesti: st.summary.eslesti,
    yoksay: st.summary.yoksay,
    pos: st.summary.pos,
  };
  const filters = ROW_FILTERS.filter((f) => f === "hepsi" || counts[f] > 0 || f === filter);
  const href = (f: RowFilter) => `${BASE}?ekstre=${st.id}${f === "hepsi" ? "" : `&durum=${f}`}`;
  const back = (
    <ButtonLink href={BASE} variant="ghost" size="sm">
      <ArrowLeft size={16} /> Ekstreler
    </ButtonLink>
  );
  const sign = st.kind === "banka" ? "Giren + / çıkan −" : "Fatura + / ödeme −";
  return (
    <>
      <Header tab="ekstre" actions={back} />
      <CompanyWideNotice screen="mutabakat" className="mb-4" />
      {st.orphan ? (
        <Notice tone="warn" className="mb-4" title="Tedarikçi bulunamadı">
          Ekstrenin tedarikçisi Tedarikçiler&apos;de artık yok (kartı silinmiş ya da adı değişmiş olabilir): hareketler hiçbir kayıtla eşleşmez. Ekstreyi silip tedarikçiyi seçerek yeniden yükleyin.
        </Notice>
      ) : null}
      <Card className="mb-4">
        <CardHeader
          icon={<FileSpreadsheet />}
          title={
            <span className="inline-flex flex-wrap items-center gap-2">
              <Badge tone={st.kind === "banka" ? "blue" : "violet"}>{KIND_LABEL[st.kind]}</Badge>
              {st.supplierHref ? (
                <Link href={st.supplierHref} className="hover:underline">
                  {st.account}
                </Link>
              ) : (
                st.account
              )}
            </span>
          }
          description={`${dateTR(st.periodFrom)} – ${dateTR(st.periodTo)} · ${num(st.lineCount)} hareket${st.duplicates ? ` (${num(st.duplicates)} hareket önceki yüklemede vardı)` : ""}`}
          meta={
            <>
              <span>
                {dateTR(st.uploadedOn)} · {st.createdByName}
                {st.fileName ? ` · ${st.fileName}` : ""}
              </span>
              <span aria-hidden>·</span>
              <span>{expiryText(st.expiresOn, today)}</span>
            </>
          }
          actions={<DeleteStatement id={st.id} label={`${KIND_LABEL[st.kind]} · ${st.account}`} />}
        />
      </Card>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat compact icon={<CircleCheck />} label="Eşleşti" value={num(st.summary.eslesti)} tone="good" />
        <Stat compact icon={<Scale />} label="Tutarı farklı" value={num(st.summary.fark)} tone={st.summary.fark ? "warn" : "default"} sub={st.summary.fark ? `Fark ${money(st.summary.farkAmount)}` : undefined} />
        <Stat compact icon={<CircleDashed />} label="Eşleşmedi" value={num(st.summary.yok)} tone={st.summary.yok ? "bad" : "default"} sub={st.summary.yok ? money(st.summary.yokAmount) : undefined} />
        {st.kind === "banka" ? (
          <Stat compact icon={<CreditCard />} label="POS hakedişi" value={num(st.summary.pos)} sub={st.summary.pos ? <Link href={`${BASE}?sekme=pos`} className="underline">{money(st.summary.posAmount)} · POS hakediş</Link> : undefined} />
        ) : (
          <Stat compact icon={<CircleSlash />} label="Yok sayıldı" value={num(st.summary.yoksay)} />
        )}
      </div>
      <Card className="mb-4">
        <CardHeader title="Hareketler" description={`Tutar: ${sign}. Fark = ekstredeki − paneldeki.`} />
        <div className="px-3 pb-2">
          <SegmentedLinks
            label="Durum"
            value={filter}
            options={filters.map((f) => ({ value: f, label: f === "hepsi" ? "Hepsi" : STATUS_LABEL[f], href: href(f), count: counts[f] }))}
          />
        </div>
        {rows.length ? (
          <>
            <div className="max-lg:hidden">
              <TableWrap>
                <Table>
                  <THead>
                    <tr>
                      <TH>Gün</TH>
                      <TH>Açıklama</TH>
                      <TH numeric>Tutar</TH>
                      <TH>Panel kaydı</TH>
                      <TH numeric>Fark</TH>
                      <TH>Durum</TH>
                      <TH className="text-right">İşlem</TH>
                    </tr>
                  </THead>
                  <tbody>
                    {rows.map((r) => {
                      const status = rowStatus(r);
                      return (
                        <TR key={r.line.id}>
                          <TD className="whitespace-nowrap">{dateTR(r.line.date)}</TD>
                          <TD className="max-w-[22rem]">
                            <span className="line-clamp-2 break-words">{r.line.description || "–"}</span>
                            {r.line.ref ? <span className="text-xs text-ink-mute">{r.line.ref}</span> : null}
                          </TD>
                          <TD numeric className={r.line.amount < 0 ? "text-ink" : "text-good-ink"}>
                            {money(r.line.amount)}
                          </TD>
                          <TD className="max-w-[18rem]">
                            <RecordCell r={r} />
                          </TD>
                          <TD numeric className={r.status === "fark" ? "text-warn" : "text-ink-mute"}>
                            {r.candidate ? money(r.diff) : "–"}
                          </TD>
                          <TD>
                            <Badge tone={STATUS_TONE[status]} dot>
                              {STATUS_LABEL[status]}
                            </Badge>
                          </TD>
                          <TD className="text-right">
                            <LineActions lineId={r.line.id} amount={r.line.amount} actions={lineActions(st.kind, r)} pos={r.pos} matched={Boolean(r.candidate)} summary={`${dateTR(r.line.date)} · ${money(r.line.amount)}`} description={r.line.description} />
                          </TD>
                        </TR>
                      );
                    })}
                  </tbody>
                </Table>
              </TableWrap>
            </div>
            <ul className="flex flex-col gap-2 px-3 pb-3 lg:hidden">
              {rows.map((r) => {
                const status = rowStatus(r);
                return (
                  <li key={r.line.id} className="flex flex-col gap-2 rounded-2xl bg-surface p-3.5 ring-1 ring-line-strong">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] text-ink-mute">{dateTR(r.line.date)}</p>
                        <p className="text-sm break-words text-ink">{r.line.description || "–"}</p>
                      </div>
                      <span className={r.line.amount < 0 ? "shrink-0 font-medium tabular text-ink" : "shrink-0 font-medium tabular text-good-ink"}>{money(r.line.amount)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={STATUS_TONE[status]} dot>
                        {STATUS_LABEL[status]}
                      </Badge>
                      {r.status === "fark" && r.candidate ? <span className="text-xs text-warn">Fark {money(r.diff)}</span> : null}
                    </div>
                    {r.candidate || r.line.decision ? <RecordCell r={r} /> : null}
                    <LineActions lineId={r.line.id} amount={r.line.amount} actions={lineActions(st.kind, r)} pos={r.pos} matched={Boolean(r.candidate)} summary={`${dateTR(r.line.date)} · ${money(r.line.amount)}`} description={r.line.description} />
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <CardContent>
            <p className="text-sm text-ink-mute">Bu süzgeçte hareket yok.</p>
          </CardContent>
        )}
      </Card>
      <MissingCard st={st} />
    </>
  );
}

/** Satırın eşleştiği panel kaydı ve dayanağı; kararlı satırda kararı veren */
function RecordCell({ r }: { r: StatementView["rows"][number] }) {
  if (r.candidate) {
    const c = r.candidate;
    return (
      <div className="flex flex-col gap-0.5 text-[13px]">
        {c.href ? (
          <Link href={c.href} className="font-medium text-ink hover:underline">
            {c.label}
          </Link>
        ) : (
          <span className="font-medium text-ink">{c.label}</span>
        )}
        <span className="text-xs text-ink-mute">
          {RECORD_LABEL[c.kind]} · {dateTR(c.date)} · {money(c.amount)}
          {r.basis ? ` · ${BASIS_LABEL[r.basis]}` : ""}
          {r.basis === "elle" && r.line.decidedByName ? ` (${r.line.decidedByName})` : ""}
        </span>
      </div>
    );
  }
  if (r.stale) return <span className="text-xs text-warn">Elle eşleştirilen kayıt artık yok; yeniden eşleştirin</span>;
  if (r.line.decision && r.line.decidedByName) return <span className="text-xs text-ink-mute">{r.line.decidedByName} karar verdi</span>;
  return <span className="text-xs text-ink-mute">–</span>;
}

function MissingCard({ st }: { st: StatementView }) {
  if (st.orphan) return null;
  const what = st.kind === "banka" ? "harcama, tedarikçi ödemesi, ödendi işaretli fatura ve kasadan teslim" : "fatura ve ödeme";
  return (
    <Card>
      <CardHeader
        icon={<ListX />}
        title="Panelde var, ekstrede yok"
        description={`Ekstrenin döneminde (${dateTR(st.periodFrom)} – ${dateTR(st.periodTo)}) hiçbir harekete eşleşmeyen ${what} kayıtları.`}
        meta={`${num(st.missing.length)} kayıt`}
      />
      {st.missing.length ? (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>Gün</TH>
                <TH>Kayıt</TH>
                <TH>Tür</TH>
                <TH numeric>Tutar</TH>
              </tr>
            </THead>
            <tbody>
              {st.missing.map((c) => (
                <TR key={`${c.kind}:${c.id}`}>
                  <TD className="whitespace-nowrap">{dateTR(c.date)}</TD>
                  <TD>
                    {c.href ? (
                      <Link href={c.href} className="hover:underline">
                        {c.label}
                      </Link>
                    ) : (
                      c.label
                    )}
                  </TD>
                  <TD className="text-[13px] whitespace-nowrap text-ink-mute">{RECORD_LABEL[c.kind]}</TD>
                  <TD numeric>{money(c.amount)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      ) : (
        <CardContent>
          <p className="text-sm text-ink-mute">Dönemdeki bütün kayıtlar ekstrede bulundu.</p>
        </CardContent>
      )}
      {st.kind === "banka" && st.missing.length ? (
        <CardContent className="pt-0">
          <p className="text-xs leading-5 text-ink-mute">Birden çok banka hesabı varsa öteki hesaptan ödenen kayıt da burada görünür; o hesabın ekstresini de yükleyince eşleşir.</p>
        </CardContent>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------- POS hakediş

const POS_TONE: Record<PosStatus, Tone> = { tamam: "green", fark: "amber", gecikti: "red", "gec-geldi": "amber", bekleniyor: "gray", beklenmeyen: "violet" };

async function PosSection() {
  const today = todayTR();
  const [view, branchNames] = await Promise.all([loadPosView(today), listBranches()]);
  const nameOf = new Map(branchNames.map((b) => [b.id, b.name]));
  const { rows, totals } = view.result;
  const shown = [...rows].reverse();
  const many = view.branches.length > 1;
  return (
    <>
      <Header tab="pos" />
      <CompanyWideNotice screen="mutabakat" className="mb-4" />
      {!view.coverage ? (
        <Notice tone="neutral" className="mb-4" title="Banka ekstresi yok">
          Kasa raporlarının kart satışı bankaya gelen parayla karşılaştırılır. Banka ve tedarikçi sekmesinden POS hakedişinin geldiği hesabın ekstresini yükleyin.
        </Notice>
      ) : view.inflowCount === 0 ? (
        <Notice tone="warn" className="mb-4" title="Ekstrelerde POS hakedişi bulunamadı">
          Açıklamasında POS, üye işyeri ya da hakediş geçen giriş yok. Hakediş satırını ekstrenin hareketlerinde &quot;POS hakedişi&quot; düğmesiyle işaretleyin.
        </Notice>
      ) : null}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat compact icon={<CreditCard />} label="Beklenen net" value={money(totals.expected)} sub={`Kart satışı ${money(totals.gross)}`} />
        <Stat compact icon={<CircleCheck />} label="Bankaya gelen" value={money(totals.received)} sub={totals.effectiveRate !== null ? `Gerçek kesinti ${pct(totals.effectiveRate, 2)}` : undefined} />
        <Stat compact icon={<Scale />} label="Fark" value={money(totals.diff)} tone={Math.abs(totals.diff) >= 1 ? (totals.diff < 0 ? "bad" : "warn") : "good"} sub="Gelen − beklenen" />
        <Stat
          compact
          icon={<CircleDashed />}
          label="Geciken"
          value={num(totals.lateCount)}
          tone={totals.lateCount ? "bad" : "default"}
          sub={totals.lateCount ? `${money(totals.lateAmount)} gelmedi` : totals.waitingAmount ? `${money(totals.waitingAmount)} bekleniyor` : undefined}
        />
      </div>
      <Card className="mb-4">
        <CardHeader
          icon={<CreditCard />}
          title="Valör günleri"
          description={
            view.coverage
              ? `Banka ekstreleri ${dateTR(view.coverage.from)} – ${dateTR(view.coverage.to)} arasını kapsıyor. Beklenen net = kart satışı × (1 − şubenin POS oranı); valör = satış günü + bloke günü (hafta sonu pazartesiye kayar).`
              : "Beklenen net = kart satışı × (1 − şubenin POS oranı); valör = satış günü + bloke günü (hafta sonu pazartesiye kayar)."
          }
        />
        {shown.length ? (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Valör</TH>
                  <TH>Satış</TH>
                  <TH numeric>Kart satışı</TH>
                  <TH numeric>Beklenen net</TH>
                  <TH numeric>Gelen</TH>
                  <TH numeric>Fark</TH>
                  <TH>Durum</TH>
                </tr>
              </THead>
              <tbody>
                {shown.map((r) => (
                  <TR key={`${r.due}:${r.status}`}>
                    <TD className="whitespace-nowrap">{dateTR(r.due)}</TD>
                    <TD className="text-[13px]">
                      <SalesCell r={r} many={many} nameOf={nameOf} />
                    </TD>
                    <TD numeric>{r.gross ? money(r.gross) : "–"}</TD>
                    <TD numeric>{r.expected ? money(r.expected) : "–"}</TD>
                    <TD numeric>
                      {r.received ? money(r.received) : "–"}
                      {r.receivedOn ? <span className="block text-xs text-ink-mute">{dateTR(r.receivedOn)}</span> : null}
                    </TD>
                    <TD numeric className={r.status === "fark" || r.status === "gecikti" ? "text-bad" : "text-ink-mute"}>
                      {r.status === "bekleniyor" ? "–" : money(r.diff)}
                    </TD>
                    <TD>
                      <Badge tone={POS_TONE[r.status]} dot>
                        {POS_STATUS_LABEL[r.status]}
                        {r.lateDays && (r.status === "gecikti" || r.status === "gec-geldi") ? ` · ${num(r.lateDays)} gün` : ""}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <CardContent>
            <p className="text-sm text-ink-mute">Bu dönemde kart satışı olan kasa raporu yok.</p>
          </CardContent>
        )}
      </Card>
      <Card>
        <CardHeader title="Hesap" description="Bloke günü bankanın POS sözleşmesindeki gündür (ertesi gün ödeme: 1). Oranlar Şubeler'de, şube şube." />
        <CardContent className="flex flex-col gap-4">
          <BlockDaysForm value={view.blockDays} />
          <ul className="flex flex-col gap-1 text-sm">
            {view.branches.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3">
                <span className="text-ink-mute">{b.name} · banka POS oranı</span>
                <span className="tabular">{pct(b.rate, 2)}</span>
              </li>
            ))}
          </ul>
          <Link href="/panel/subeler" className="text-[13px] text-ink-mute underline">
            Oranı Şubeler&apos;de değiştir
          </Link>
          <p className="text-xs leading-5 text-ink-mute">
            Kart satışı kasa raporundan: banka gün sonu fişi yazıldıysa o, yoksa Z raporunun kart satırı. Resmi tatile denk gelen ödeme &quot;Geç geldi&quot; görünür.
            Yemek kartı ve platform hakedişleri Komisyon &amp; hakediş&apos;te.
          </p>
        </CardContent>
      </Card>
    </>
  );
}

function SalesCell({ r, many, nameOf }: { r: PosRow; many: boolean; nameOf: Map<string, string> }) {
  if (!r.sales.length) return <span className="text-ink-mute">Kasa raporunda karşılığı yok</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {r.sales.map((s) => (
        <li key={`${s.date}:${s.branchId}`} className="whitespace-nowrap">
          {dateTR(s.date)}
          {many ? ` · ${nameOf.get(s.branchId) ?? s.branchId}` : ""}
          <span className="text-ink-mute">
            {" "}
            · {money(s.card)}
            {s.source === "z" ? " (Z)" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

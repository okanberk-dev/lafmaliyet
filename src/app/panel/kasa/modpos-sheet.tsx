import { ClipboardList, GitCompareArrows } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import {
  modposAraKasaText,
  modposBreakdownText,
  modposCash,
  modposCell,
  modposClock,
  modposCollectionLabel,
  modposCompareRows,
  modposCompareSummary,
  modposExpenseLabel,
  modposExtraLines,
  modposFacts,
  modposFoysuzText,
  modposGapTitle,
  modposHeadline,
  modposMissingText,
  modposNoCountText,
  modposOffLines,
  modposOpenFor,
  modposPaymentDetail,
  modposPaymentGap,
  modposPayments,
  modposPeople,
  modposPeopleLine,
  modposPreviousLine,
  modposReportDiffs,
  modposSheetMeta,
  modposUnknownCodesText,
  modposWarningTexts,
  signedMoney,
  MODPOS_RAW_SHOWN,
  type ModposReportFields,
  type ModposSheetView,
} from "@/lib/cash-modpos";
import type { LadminReport } from "@/lib/cash-ladmin";
import { money, num } from "@/lib/format";
import type { ModposCompareRow } from "@/lib/modpos/compare";
import type { FoyKasa, FoysuzGun } from "@/lib/modpos/foy";
import { finalAfter, type ModposZ } from "@/lib/modpos/z";
import { cn } from "@/lib/utils";

import { FactGrid, H3, LineList, MutedLines } from "./day-parts";
import { LadminReportCard } from "./ladmin-report";
import { ModposDiffList } from "./modpos-diffs";

/**
 * Yöneticinin gün görünümündeki üç bölüm (docs/MODPOS-API.md › Nerede görünür; yalnız yönetici dalında, kasa raporu
 * formunun altında): **ModPOS** (kasa föyünün ayrıntısı), **ladmin** (panelde yazılan raporun ayrıntısı) ve
 * **Karşılaştırma** (alan alan, farklı yazılanların uyarısıyla). Föy yoksa ve anahtar kurulmamışsa hiçbir şey (Ayarlar'daki
 * kart "Kurulmadı" der); föy henüz gelmediyse ModPOS bölümü ne zaman geleceğini söyler, ladmin yine görünür. Sunucu
 * bileşenidir: föyün kendisi tarayıcıya veri olarak gitmez, yalnız çizilen metin. Sayfa açılışı ModPOS'a istek
 * göndermez (saklanan föy; src/server/data/modpos-day.ts).
 */
export function ModposSections({
  date,
  today,
  sheet,
  z,
  report,
  ladmin,
  keySet,
  now,
}: {
  date: string;
  today: string;
  sheet: ModposSheetView | null;
  z: ModposZ | null;
  /** Günün kayıtlı raporu (yoksa null: ladmin "Rapor yok", karşılaştırmanın ladmin sütunu boş) */
  report: (ModposReportFields & LadminReport) | null;
  /** ladmin bölümünün öteki girdileri: günün kasadan çıkanları, fotoğraf sayısı, sürümler, devir zinciri */
  ladmin: Omit<Parameters<typeof LadminReportCard>[0], "report">;
  /** ModPOS anahtarı kurulu mu (modposKeySet) */
  keySet: boolean;
  now: Date;
}) {
  if (!sheet && !keySet) return null;
  return (
    <div className="space-y-4" aria-label="ModPOS, ladmin ve karşılaştırma" role="group">
      <ModposSheetCard date={date} today={today} sheet={sheet} z={z} now={now} />
      <LadminReportCard report={report} {...ladmin} />
      <ModposCompareCard sheet={sheet} z={z} report={report} awaiting={awaitingFinal(sheet, date, now)} />
    </div>
  );
}

/**
 * Kesinleşmeden alınmış boş föyün kesin föyü hâlâ bekleniyor mu: ertesi sabahın sabah işi bitene kadar (kesinleşme anı
 * 07:00 + 2 saat = 09:00 TR). Sonrası beklenmez: o sabah alınamamıştır, uyarılar yine çıkar
 */
function awaitingFinal(sheet: ModposSheetView | null, date: string, now: Date): boolean {
  return Boolean(sheet && !sheet.final && now.getTime() < finalAfter(date) + 2 * 3_600_000);
}

/**
 * "ModPOS" bölümü: föyün künyesi (Z no, durum, kesin mi, alındığı an), karolar (ciro, adisyon ve ortalaması, kişi ve
 * kişi başı, ciro dışı, bahşiş, kasa farkı), ödeme dağılımı ve nakit kasanın hesabı, föyün kendi içindeki tutarsızlığı,
 * ModPOS'un uyarıları ve notları, her kasanın ayrıntısı (açılış / kapanış ve açık kalma süresi, ödeme yöntemleri ve banka
 * kırılımı, giderler, cari tahsilatlar, ara kasalar, notlar), föysüz satış ve föy değiştiyse önceki sürüm
 */
export function ModposSheetCard({ date, today, sheet, z, now }: { date: string; today: string; sheet: ModposSheetView | null; z: ModposZ | null; now: Date }) {
  if (!sheet) {
    return (
      <Card aria-label="ModPOS kasa föyü">
        <CardHeader icon={<ClipboardList />} title="ModPOS" description="Kasa föyü" actions={<Badge tone="gray">Föy yok</Badge>} />
        <CardContent>
          <Notice tone="neutral" size="sm" title="ModPOS föyü henüz alınmadı" text={modposMissingText(date, today)} />
        </CardContent>
      </Card>
    );
  }
  const gap = z ? modposGapTitle(z) : null;
  const warnings = modposWarningTexts(sheet.foy);
  const multi = sheet.foy.kasalar.length > 1;
  // Gün açıkken alınan föyde sayımın yokluğunu üstteki not söyler
  const notes = z ? [z.durum === "ACIK" ? null : modposNoCountText(z), modposFoysuzText(z), modposUnknownCodesText(z)].filter((t): t is string => t !== null) : [];
  const previous = modposPreviousLine(sheet, z, now);
  const extras = modposExtraLines(sheet.foy);
  return (
    <Card aria-label="ModPOS kasa föyü">
      <CardHeader icon={<ClipboardList />} title="ModPOS" description={`Kasa föyü · ${modposHeadline(sheet, z, now)}`} actions={<StateBadge sheet={sheet} z={z} />} />
      <CardContent className="space-y-4">
        {z ? null : (
          <p className="text-sm text-ink-mute">
            {sheet.final
              ? "Bu gün ModPOS'ta kasa açılmamış, satış yok."
              : awaitingFinal(sheet, date, now)
                ? "Föy alındığında ModPOS'ta kasa henüz açılmamıştı, satış yoktu; kesin föy ertesi sabah gelir."
                : "Föy alındığında ModPOS'ta kasa henüz açılmamıştı; kesin föy henüz alınamadı (sabah işi yeniden dener)."}
          </p>
        )}
        {gap ? <Notice tone="warn" risk="para" size="sm" title={gap} text="ModPOS'ta ödemeleri kontrol edin; karşılaştırmadaki ödeme alanları bu yüzden farklı görünebilir." /> : null}
        {z && z.durum === "ACIK" ? (
          <Notice tone="neutral" size="sm" title="Föy gün açıkken alındı" text="Tutarlar o anki; rapor ertesi sabahki kesin föyle karşılaştırılır." />
        ) : null}
        {z ? (
          <>
            <FactGrid facts={modposFacts(z)} label="ModPOS özeti" />
            <div className="grid gap-5 sm:grid-cols-2">
              <LineList title="Ödeme dağılımı" lines={modposPayments(z)} />
              <LineList title="Nakit kasa" lines={modposCash(z, sheet.foy)} />
              <LineList title="Ödenmez / ikram dökümü" lines={modposOffLines(sheet.foy, z)} />
              <LineList title="Kişiler" lines={modposPeople(sheet.foy)} />
            </div>
          </>
        ) : null}
        {notes.length ? <MutedLines lines={notes} /> : null}
        {warnings.length ? (
          <Notice
            tone="neutral"
            size="sm"
            title={`ModPOS'un ${warnings.length} uyarısı`}
            text={
              <ul className="list-disc pl-4">
                {warnings.map((t) => (
                  <li key={t} className="break-words">
                    {t}
                  </li>
                ))}
              </ul>
            }
          />
        ) : null}
        {sheet.foy.kasalar.map((k, i) => (
          <KasaDetail key={`${k.sube}:${k.kasaAdi}:${i}`} kasa={k} heading={multi ? [k.sube, k.kasaAdi, k.zNo ? `Z ${k.zNo}` : null].filter(Boolean).join(" · ") : null} />
        ))}
        {sheet.foy.foysuzGunler.length ? <FoysuzList list={sheet.foy.foysuzGunler} /> : null}
        {extras.length ? (
          <Notice
            tone="neutral"
            size="sm"
            title={`ModPOS'un kitapçıkta olmayan ${extras.length} alanı`}
            text={
              <ul className="list-disc pl-4">
                {extras.map((t, i) => (
                  <li key={`${t}:${i}`} className="break-words">
                    {t}
                  </li>
                ))}
              </ul>
            }
          />
        ) : null}
        <MutedLines lines={[...modposSheetMeta(sheet, now), ...(previous ? [previous] : [])]} />
        {sheet.raw ? <RawSheet raw={sheet.raw} /> : null}
      </CardContent>
    </Card>
  );
}

/** ModPOS'un gönderdiği ham XML, kapalı açılır kutuda (kitapçıkta olmayan alan da burada görünür) */
function RawSheet({ raw }: { raw: string }) {
  const cut = raw.length > MODPOS_RAW_SHOWN;
  return (
    <details className="rounded-2xl bg-surface px-3 py-2 text-[13px]">
      <summary className="cursor-pointer text-ink-soft pointer-coarse:py-2">Ham föy (ModPOS&apos;un gönderdiği XML)</summary>
      <pre className="mt-2 max-h-96 overflow-auto font-mono text-[11px] leading-4 whitespace-pre-wrap break-all text-ink-soft">
        {cut ? raw.slice(0, MODPOS_RAW_SHOWN) : raw}
      </pre>
      {cut ? <p className="mt-1 text-ink-mute">İlk {num(MODPOS_RAW_SHOWN)} karakter gösteriliyor; saklanan föy tamdır.</p> : null}
    </details>
  );
}

/** ModPOS başlığının rozeti: kesin / kesin değil (gün açıkken alındı) / kasa açılmamış */
function StateBadge({ sheet, z }: { sheet: ModposSheetView; z: ModposZ | null }) {
  // Kesinleşmeden alınan boş föy (gün içinde "Bu günü çek", kasa açılmadan): gün sürüyor, "kasa açılmamış" kesin değil
  if (!z) return <Badge tone="gray">{sheet.final ? "Kasa açılmamış" : "Kesin değil"}</Badge>;
  if (z.durum === "ACIK") return <Badge tone="gray">Gün açıkken alındı</Badge>;
  return sheet.final ? (
    <Badge tone="blue" dot>
      Kesin
    </Badge>
  ) : (
    <Badge tone="gray">Kesin değil</Badge>
  );
}

/**
 * "Karşılaştırma" bölümü: ModPOS föyü ↔ ladmin raporu. Rozet (rapor yok, föy açıkken alındı, farklı alan sayısı ya da
 * raporla aynı), özet satırı, farklı yazılanların uyarısı ve alan alan tablo (fark ModPOS − ladmin; bilgi satırları
 * soluk). Föy yoksa ne zaman karşılaştırılacağı; ModPOS'ta kasa açılmamış ama raporda satış varsa uyarı
 */
export function ModposCompareCard({
  sheet,
  z,
  report,
  awaiting = false,
}: {
  sheet: ModposSheetView | null;
  z: ModposZ | null;
  report: (ModposReportFields & Partial<Pick<LadminReport, "submittedByName" | "countedByName">>) | null;
  /** Kesinleşmeden alınmış boş föyün kesin föyü bekleniyor (bugün ya da dün): karşılaştırma ertelenir */
  awaiting?: boolean;
}) {
  const header = (badge: ReactNode) => <CardHeader icon={<GitCompareArrows />} title="Karşılaştırma" description="ModPOS föyü ↔ ladmin kasa raporu" actions={badge} />;
  if (!sheet || !z) {
    const sales = Boolean(report && Math.abs(report.zTotal) >= 0.01);
    // Kesinleşmeden alınan boş föy (kasa açılmadan "Bu günü çek"): gün sürüyordu, kesin föy beklenirken akşamki raporla
    // karşılaştırılmaz; beklenen sabah geçtiyse (kesin föy alınamadı) uyarı yine çıkar
    const text = !sheet
      ? "ModPOS föyü gelince ladmin'deki raporla alan alan karşılaştırılır."
      : awaiting
        ? "Föy kasa açılmadan alındı: ertesi sabahki kesin föyle karşılaştırılır."
        : sales
          ? null
          : sheet.final
            ? "İkisinde de satış yok."
            : "Kesin föy alınamadı: ModPOS'ta o gün satış olup olmadığı bilinmiyor (föy kasa açılmadan alınmıştı).";
    return (
      <Card aria-label="ModPOS ve ladmin karşılaştırması">
        {header(null)}
        <CardContent>
          {text ? (
            <p className="text-sm text-ink-mute">{text}</p>
          ) : (
            <Notice
              tone="warn"
              risk="para"
              size="sm"
              title={
                sheet!.final
                  ? `ModPOS'ta bu gün kasa açılmamış, ladmin'de ${money(report!.zTotal)} satış yazılı`
                  : `ModPOS föyü kasa açılmadan alındı (kesin föy yok), ladmin'de ${money(report!.zTotal)} satış yazılı`
              }
              text={
                sheet!.final
                  ? "Raporun günü ya da ModPOS'taki kasa günü yanlış olabilir."
                  : "Föy kasa açılmadan alınmıştı ve kesin föy henüz alınamadı; ModPOS'ta günü ve raporun gününü kontrol edin."
              }
            />
          )}
        </CardContent>
      </Card>
    );
  }
  const diffs = modposReportDiffs(report, z);
  const rows = modposCompareRows(report, z);
  const gap = modposGapTitle(z);
  const people = modposPeopleLine(sheet.foy, report);
  return (
    <Card aria-label="ModPOS ve ladmin karşılaştırması">
      {header(<SheetBadge z={z} report={report} diffs={diffs.length} />)}
      <CardContent className="space-y-4">
        <p className="text-sm text-ink-soft">{modposCompareSummary(rows, z, report !== null)}</p>
        <ModposDiffList diffs={diffs} />
        {gap ? <p className="text-[13px] leading-5 text-ink-mute">{`${gap}: ödeme satırları bu yüzden farklı görünebilir.`}</p> : null}
        {people ? <p className="text-[13px] leading-5 text-ink-mute">{people}</p> : null}
        <CompareTable rows={rows} />
      </CardContent>
    </Card>
  );
}

/** Karşılaştırmanın rozeti: rapor yok, föy açıkken alındı, farklı alan sayısı ya da raporla aynı */
function SheetBadge({ z, report, diffs }: { z: ModposZ; report: ModposReportFields | null; diffs: number }) {
  if (z.durum === "ACIK") return <Badge tone="gray">Gün açıkken alındı</Badge>;
  if (!report) return <Badge tone="gray">Rapor yok</Badge>;
  return diffs ? (
    <Badge tone="amber" dot>
      {diffs} alan farklı
    </Badge>
  ) : (
    <Badge tone="green" dot>
      Raporla aynı
    </Badge>
  );
}

/** Farkın hücresi: farklı yazılan turuncu rozet, bilgi farkı soluk, aynı "aynı", karşılaştırılamayan "–" */
function DiffCell({ row }: { row: ModposCompareRow }) {
  if (row.tone === "diff")
    return (
      <Badge tone="amber" dot>
        {row.diff !== null ? signedMoney(row.diff) : "farklı"}
      </Badge>
    );
  if (row.tone === "info") return <span className="text-ink-mute tabular">{row.diff !== null ? signedMoney(row.diff) : "farklı"}</span>;
  if (row.tone === "same") return <span className="text-ink-mute">aynı</span>;
  return <span className="text-ink-mute">–</span>;
}

/**
 * ladmin ↔ ModPOS tablosu: telefonda (sm altı) satır kartı, geniş ekranda tablo (TASARIM §6 "Listeler"). Fark föy − rapor;
 * "farklı yazılan" alanlar turuncu rozetle, bilgi satırları (gider, giren, olması gereken, kasa farkı) soluk
 */
function CompareTable({ rows }: { rows: ModposCompareRow[] }) {
  return (
    <div>
      <ul className="divide-y divide-line sm:hidden" aria-label="ladmin kasa raporu ve ModPOS föyü">
        {rows.map((r) => (
          <li key={r.key} className="py-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className={cn("min-w-0", r.tone === "diff" ? "font-medium text-ink" : "text-ink-soft")}>{r.label}</span>
              <span className="shrink-0">
                <DiffCell row={r} />
              </span>
            </div>
            <p className="text-xs text-ink-mute tabular">
              ladmin {modposCell(r.report, r.money)} · ModPOS {modposCell(r.modpos, r.money)}
            </p>
          </li>
        ))}
      </ul>
      <TableWrap className="-mx-2 max-sm:hidden">
        <Table>
          <THead>
            <tr>
              <TH>Alan</TH>
              <TH numeric>ladmin</TH>
              <TH numeric>ModPOS</TH>
              <TH numeric>Fark</TH>
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => (
              <TR key={r.key}>
                <TD className={cn("py-2", r.tone === "diff" ? "font-medium" : "text-ink-soft")}>{r.label}</TD>
                <TD numeric className="py-2">
                  {modposCell(r.report, r.money)}
                </TD>
                <TD numeric className="py-2">
                  {modposCell(r.modpos, r.money)}
                </TD>
                <TD numeric className="py-2">
                  <DiffCell row={r} />
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </div>
  );
}

/** Tek satır: solda ad (altında soluk ayrıntı), sağda tutar */
function Row({ label, value, sub, extra }: { label: ReactNode; value: string; sub?: string | null; extra?: ReactNode }) {
  return (
    <li className="py-1.5 text-sm">
      <div className="flex items-baseline justify-between gap-4">
        <span className="min-w-0 break-words text-ink">{label}</span>
        <span className="shrink-0 text-right text-ink tabular">{value}</span>
      </div>
      {sub || extra ? (
        <p className="text-xs break-words text-ink-mute">
          {sub}
          {sub && extra ? " · " : null}
          {extra}
        </p>
      ) : null}
    </li>
  );
}

/** Bir kasanın föyü: açılış / kapanış, ödeme yöntemleri (kırılımıyla), giderler, cari tahsilatlar, ara kasalar, notlar */
function KasaDetail({ kasa: k, heading }: { kasa: FoyKasa; heading: string | null }) {
  const who = (n: string | null | undefined) => (n ? ` (${n})` : "");
  const opened = [modposClock(k.acilis.zaman), k.acilis.nakit !== null ? money(k.acilis.nakit) : null].filter(Boolean).join(", ") + (k.acilis.zaman || k.acilis.nakit !== null ? who(k.acilis.personel) : "");
  const closed = [modposClock(k.kapanis.zaman), k.kapanis.nakit !== null ? money(k.kapanis.nakit) : null].filter(Boolean).join(", ") + (k.kapanis.zaman || k.kapanis.nakit !== null ? who(k.kapanis.personel) : "");
  const times = [
    k.gunNo !== null ? `Gün no ${k.gunNo}` : null,
    opened ? `açılış ${opened}` : null,
    k.durum === "KAPALI" ? (closed ? `kapanış ${closed}` : "kapandı") : "kapanmadı",
    modposOpenFor(k) ? `açık kaldı ${modposOpenFor(k)}` : null,
    k.defterGirildi ? "kasa defteri girildi" : "kasa defteri girilmedi",
  ].filter(Boolean);
  const notes = [k.notlar.kapanis ? `Kapanış notu: ${k.notlar.kapanis}` : null, k.notlar.fark ? `Fark notu: ${k.notlar.fark}` : null].filter((t): t is string => t !== null);
  return (
    <div className="space-y-3">
      {heading ? <p className="text-sm font-semibold text-ink">{heading}</p> : null}
      <p className="text-[13px] leading-5 text-ink-mute">{times.join(" · ").replace(/^./, (c) => c.toLocaleUpperCase("tr"))}</p>
      <div className="grid gap-5 sm:grid-cols-2">
        {k.odemeler.length ? (
          <section aria-label="Ödeme yöntemleri">
            <h3 className={H3}>Ödeme yöntemleri (ModPOS&apos;taki adıyla)</h3>
            <ul className="divide-y divide-line">
              {k.odemeler.map((o, i) => {
                const gap = modposPaymentGap(o);
                const parts = modposBreakdownText(o);
                return (
                  <Row
                    key={`${o.kod}:${i}`}
                    label={
                      <>
                        {o.yontem} <span className="font-mono text-[11px] text-ink-mute">{o.kod}</span>
                      </>
                    }
                    value={money(o.satis)}
                    sub={[modposPaymentDetail(o), parts].filter(Boolean).join(" · ")}
                    extra={gap ? <span className={gap.off ? "text-warn" : undefined}>{gap.text}</span> : null}
                  />
                );
              })}
            </ul>
          </section>
        ) : null}
        {k.giderler.kalemler.length || k.giderler.toplam ? (
          <section aria-label="Giderler">
            <h3 className={H3}>Giderler · {money(k.giderler.toplam)}</h3>
            <ul className="divide-y divide-line">
              {k.giderler.kalemler.map((g, i) => (
                <Row key={i} label={modposExpenseLabel(g)} value={money(g.tutar)} />
              ))}
            </ul>
          </section>
        ) : null}
        {k.cariTahsilatlar.kalemler.length || k.cariTahsilatlar.toplam ? (
          <section aria-label="Cari tahsilatlar">
            <h3 className={H3}>
              Cari tahsilatlar · {money(k.cariTahsilatlar.toplam)}
              {k.cariTahsilatlar.nakit ? ` (nakit ${money(k.cariTahsilatlar.nakit)})` : ""}
            </h3>
            <ul className="divide-y divide-line">
              {k.cariTahsilatlar.kalemler.map((t, i) => (
                <Row key={i} label={modposCollectionLabel(t)} value={money(t.tutar)} />
              ))}
            </ul>
          </section>
        ) : null}
        {k.araKasalar.length ? (
          <section aria-label="Ara kasalar">
            <h3 className={H3}>Ara kasalar</h3>
            <ul className="divide-y divide-line">
              {k.araKasalar.map((a, i) => (
                <li key={i} className="py-1.5 text-[13px] leading-5 break-words text-ink-soft tabular">
                  {modposAraKasaText(a)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {notes.length ? (
          <section aria-label="Notlar">
            <h3 className={H3}>Notlar</h3>
            {notes.map((t) => (
              <p key={t} className="pt-1.5 text-sm break-words whitespace-pre-line text-ink">
                {t}
              </p>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** Kasası açılmamış satış (föysüz gün; belge §5.1): şube, ciro, adisyon ve ödemeler */
function FoysuzList({ list }: { list: FoysuzGun[] }) {
  return (
    <section aria-label="Föysüz satış">
      <h3 className={H3}>Kasası açılmamış satış</h3>
      <ul className="divide-y divide-line">
        {list.map((f, i) => (
          <Row
            key={`${f.sube}:${i}`}
            label={f.sube}
            value={money(f.ciro)}
            sub={[f.adisyonSayisi !== null ? `${num(f.adisyonSayisi)} adisyon` : null, ...f.odemeler.map((o) => `${o.yontem} ${money(o.tutar)}`)].filter(Boolean).join(" · ") || null}
          />
        ))}
      </ul>
    </section>
  );
}

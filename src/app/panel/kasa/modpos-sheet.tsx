import { ClipboardList } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import {
  modposAraKasaText,
  modposBreakdownText,
  modposCell,
  modposClock,
  modposCollectionLabel,
  modposExpenseLabel,
  modposFoysuzText,
  modposGapTitle,
  modposHeadline,
  modposMissingText,
  modposNoCountText,
  modposPaymentDetail,
  modposPaymentGap,
  modposPreviousLine,
  modposReportDiffs,
  modposServiceLine,
  modposTableRows,
  modposUnknownCodesText,
  modposWarningTexts,
  signedMoney,
  type ModposReportFields,
  type ModposSheetView,
} from "@/lib/cash-modpos";
import { money, num } from "@/lib/format";
import type { ModposCompareRow } from "@/lib/modpos/compare";
import type { FoyKasa, FoysuzGun } from "@/lib/modpos/foy";
import type { ModposZ } from "@/lib/modpos/z";
import { cn } from "@/lib/utils";

import { ModposDiffList } from "./modpos-diffs";

/**
 * Yöneticinin gün görünümündeki "ModPOS kasa föyü" kartı (docs/MODPOS-API.md › Nerede görünür; yalnız yönetici dalında,
 * formun altında): kasa raporu ile föy yan yana (Z alanları, açılış, sayılan; gider, giren, olması gereken ve kasa farkı
 * bilgi olarak), farklı yazılanların uyarısı, ödeme yöntemleri ve banka kırılımı, giderler, cari tahsilatlar, ara
 * kasalar, kişi sayısı, bahşiş, ModPOS'un uyarıları ve notları, föy değiştiyse önceki sürüm. Föy yoksa ne zaman
 * geleceği (anahtar kurulmamışsa hiçbir şey: Ayarlar'daki kart "Kurulmadı" der). Sunucu bileşenidir: föyün kendisi tarayıcıya veri olarak gitmez, yalnız çizilen metin. Sayfa açılışı
 * ModPOS'a istek göndermez (saklanan föy; src/server/data/modpos-day.ts).
 */
export function ModposSheetCard({
  date,
  today,
  sheet,
  z,
  report,
  keySet,
  now,
}: {
  date: string;
  today: string;
  sheet: ModposSheetView | null;
  z: ModposZ | null;
  /** Günün kayıtlı raporu (yoksa null: tablonun rapor sütunu boş) */
  report: ModposReportFields | null;
  /** ModPOS anahtarı kurulu mu (modposKeySet) */
  keySet: boolean;
  now: Date;
}) {
  if (!sheet) return keySet ? <Notice tone="neutral" title="ModPOS föyü henüz alınmadı" text={modposMissingText(date, today)} /> : null;
  const diffs = z ? modposReportDiffs(report, z) : [];
  const gap = z ? modposGapTitle(z) : null;
  const warnings = modposWarningTexts(sheet.foy);
  const multi = sheet.foy.kasalar.length > 1;
  // Gün açıkken alınan föyde sayımın yokluğunu üstteki not söyler
  const notes = z ? [z.durum === "ACIK" ? null : modposNoCountText(z), modposFoysuzText(z), modposUnknownCodesText(z)].filter((t): t is string => t !== null) : [];
  const previous = modposPreviousLine(sheet, z, now);
  const service = z ? modposServiceLine(z) : null;
  return (
    <Card aria-label="ModPOS kasa föyü">
      <CardHeader icon={<ClipboardList />} title="ModPOS kasa föyü" description={modposHeadline(sheet, z, now)} actions={<SheetBadge z={z} report={report} diffs={diffs.length} />} />
      <CardContent className="space-y-4">
        {z ? null : <p className="text-sm text-ink-mute">Bu gün ModPOS&apos;ta kasa açılmamış, satış yok.</p>}
        <ModposDiffList diffs={diffs} />
        {gap ? <Notice tone="warn" risk="para" size="sm" title={gap} text="ModPOS'ta ödemeleri kontrol edin; tablodaki ödeme alanları bu yüzden farklı görünebilir." /> : null}
        {z && z.durum === "ACIK" ? (
          <Notice tone="neutral" size="sm" title="Föy gün açıkken alındı" text="Tutarlar o anki; rapor ertesi sabahki kesin föyle karşılaştırılır." />
        ) : null}
        {z ? <CompareTable rows={modposTableRows(report, z)} /> : null}
        {notes.length || previous ? (
          <div className="space-y-1 text-[13px] leading-5 break-words text-ink-mute">
            {notes.map((t) => (
              <p key={t}>{t}</p>
            ))}
            {previous ? <p>{previous}</p> : null}
          </div>
        ) : null}
        {service ? <p className="text-sm text-ink-soft">{service}</p> : null}
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
      </CardContent>
    </Card>
  );
}

/** Başlığın sağındaki tek rozet: rapor yok, föy açıkken alındı, farklı alan sayısı ya da raporla aynı */
function SheetBadge({ z, report, diffs }: { z: ModposZ | null; report: ModposReportFields | null; diffs: number }) {
  if (!z) return null;
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
 * Rapor ↔ föy tablosu: telefonda (sm altı) satır kartı, geniş ekranda tablo (TASARIM §6 "Listeler"). Fark föy − rapor;
 * "farklı yazılan" alanlar turuncu rozetle, bilgi satırları (gider, giren, olması gereken, kasa farkı) soluk
 */
function CompareTable({ rows }: { rows: ModposCompareRow[] }) {
  return (
    <div>
      <ul className="divide-y divide-line sm:hidden" aria-label="Kasa raporu ve ModPOS föyü">
        {rows.map((r) => (
          <li key={r.key} className="py-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className={cn("min-w-0", r.tone === "diff" ? "font-medium text-ink" : "text-ink-soft")}>{r.label}</span>
              <span className="shrink-0">
                <DiffCell row={r} />
              </span>
            </div>
            <p className="text-xs text-ink-mute tabular">
              Rapor {modposCell(r.report, r.money)} · ModPOS {modposCell(r.modpos, r.money)}
            </p>
          </li>
        ))}
      </ul>
      <TableWrap className="-mx-2 max-sm:hidden">
        <Table>
          <THead>
            <tr>
              <TH>Alan</TH>
              <TH numeric>Kasa raporu</TH>
              <TH numeric>ModPOS föyü</TH>
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

const H3 = "border-b border-line pb-1 text-[13px] font-semibold text-ink-soft";

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
  const opened = [modposClock(k.acilis.zaman), k.acilis.nakit !== null ? money(k.acilis.nakit) : null].filter(Boolean).join(", ");
  const closed = [modposClock(k.kapanis.zaman), k.kapanis.nakit !== null ? money(k.kapanis.nakit) : null].filter(Boolean).join(", ");
  const times = [
    k.gunNo !== null ? `Gün no ${k.gunNo}` : null,
    opened ? `açılış ${opened}` : null,
    k.durum === "KAPALI" ? (closed ? `kapanış ${closed}` : "kapandı") : "kapanmadı",
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
            <h3 className={H3}>Ödeme yöntemleri</h3>
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

import { History, Tag } from "lucide-react";

import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ablativeTR, money, num } from "@/lib/format";
import { effectiveText, statusText, type ChangeStatus } from "@/lib/prices/branch";
import { dayMonthTR } from "@/lib/reminders";
import { OLD_PRICE_DAYS, type OldPriceReport } from "@/server/data/branch-prices";

const STATUS_TONE: Record<ChangeStatus["kind"], Tone> = { bekliyor: "gray", uygulandi: "green", uygulanmadi: "red", bilinmiyor: "amber" };
const STATUS_TITLE: Record<ChangeStatus["kind"], string> = {
  bekliyor: "Anı gelmedi ya da o andan sonra bu boy satılmadı",
  uygulandi: "AsilPOS bu günden itibaren yeni fiyattan sattı",
  uygulanmadi: "O andan sonraki tam günlerde yalnız başka fiyattan satıldı: AsilPOS fiyatı almamış olabilir",
  bilinmiyor: "Gün sonu liste fiyatı taşımıyor (eski AsilPOS): ciro ya da adetten çıkarılmaz",
};

/**
 * Fiyatlar › Eski fiyattan satılanlar (docs/FIYATLAR.md › Şube fiyatı): şubenin fiyat değişiklikleri ve her birinin
 * durumu (Bekliyor / Uygulandı · gün / Uygulanmadı / Bilinmiyor), altında o gün geçerli fiyatlardan farklı bir liste
 * fiyatıyla satılanlar. Hepsi AsilPOS gün sonunun dondurulan liste fiyatlarından; ciro / adetten çıkarılmaz.
 */
export function OldPriceReportView({ report }: { report: OldPriceReport }) {
  const { branch, changes, sales, names } = report;
  if (!branch) return <EmptyState title="Şube yok" description="Şube fiyatı Tuzla dışındaki açık bir şubede yazılır (Ayarlar › Şubeler)." />;
  const name = (id: string) => names[id] ?? id;
  const loss = sales.reduce((a, s) => a + s.loss, 0);
  return (
    <div className="space-y-4">
      {!report.hasListPrices ? (
        <Notice
          tone="neutral"
          title="AsilPOS liste fiyatı göndermiyor"
          text={`${branch.name} gün sonlarında satılan fiyatlar yok (AsilPOS güncel değil ya da henüz gün sonu gelmedi): durum "Bilinmiyor", eski fiyattan satış bulunamaz.`}
        />
      ) : null}
      <Card>
        <CardHeader icon={<History />} title="Fiyat değişiklikleri" description={`${branch.name} şube fiyatları ve AsilPOS'ta uygulanıp uygulanmadığı.`} meta={<span className="tabular">{num(changes.length)}</span>} />
        {changes.length ? (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Kalem</TH>
                  <TH>Geçerlilik</TH>
                  <TH numeric>Değişiklik</TH>
                  <TH>Durum</TH>
                </tr>
              </THead>
              <tbody>
                {changes.map((c) => (
                  <TR key={`${c.siteMenuId}:${c.slot}:${c.effectiveFrom}`}>
                    <TD>
                      <span className="font-medium break-words">{name(c.siteMenuId)}</span> <span className="text-ink-mute">· {c.slot}</span>
                    </TD>
                    <TD className="whitespace-nowrap tabular">{effectiveText(c.effectiveFrom)}</TD>
                    <TD numeric>
                      <span className="text-ink-mute">{money(c.before)}</span> → <span className="font-semibold">{money(c.after)}</span>
                    </TD>
                    <TD>
                      <Badge tone={STATUS_TONE[c.status.kind]} dot title={STATUS_TITLE[c.status.kind]}>
                        {statusText(c.status)}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState title="Değişiklik yok" description={`${branch.name} için şube fiyatı yazılmadı; fiyat tabandır.`} />
        )}
      </Card>
      <Card>
        <CardHeader
          icon={<Tag />}
          title="Eski fiyattan satılanlar"
          description={`Son ${num(OLD_PRICE_DAYS)} gün (${ablativeTR(dayMonthTR(report.from))}): o gün geçerli fiyattan farklı liste fiyatıyla satılanlar. Gün içinde fiyat değiştiyse iki fiyat da doğru sayılır.`}
          meta={sales.length ? <span className="tabular">{loss > 0 ? `${money(loss)} eksik` : `${num(sales.length)} satır`}</span> : null}
        />
        {sales.length ? (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>Gün</TH>
                  <TH>Kalem</TH>
                  <TH numeric>Satılan fiyat</TH>
                  <TH numeric>Olması gereken</TH>
                  <TH numeric>Adet</TH>
                  <TH numeric>Fark</TH>
                </tr>
              </THead>
              <tbody>
                {sales.map((s) => (
                  <TR key={`${s.date}:${s.siteMenuId}:${s.slot}:${s.price}`}>
                    <TD className="whitespace-nowrap tabular">{dayMonthTR(s.date)}</TD>
                    <TD>
                      <span className="font-medium break-words">{name(s.siteMenuId)}</span> <span className="text-ink-mute">· {s.slot}</span>
                    </TD>
                    <TD numeric>{money(s.price)}</TD>
                    <TD numeric>{money(s.expected)}</TD>
                    <TD numeric>{num(s.qty)}</TD>
                    <TD numeric className={s.loss > 0 ? "text-bad" : "text-ink-soft"}>
                      {s.loss > 0 ? `−${money(s.loss)}` : `+${money(-s.loss)}`}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState title="Eski fiyattan satış yok" description={report.hasListPrices ? `Son ${num(OLD_PRICE_DAYS)} günde her satış o gün geçerli fiyattan.` : "AsilPOS liste fiyatı gönderince burada görünür."} />
        )}
      </Card>
    </div>
  );
}

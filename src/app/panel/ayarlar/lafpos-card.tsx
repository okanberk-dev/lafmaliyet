import { Store } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { CardContent } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/misc";
import { dateTimeTR, money, num } from "@/lib/format";
import { lafposCardSummary, rejectionText, unverifiedText } from "@/lib/lafpos/status";
import { dayMonthYearTR, LAFPOS_SWITCH_MAX_AHEAD, LAFPOS_SWITCH_MIN } from "@/lib/lafpos/switch";
import { addDays, longDateTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { loadLafposCard } from "@/server/lafpos/status";

import { LafposDayDelete, LafposSwitchDayForm } from "./lafpos-client";
import { SectionCard } from "./section-card";

/** İmzası tutmayan isteklerin satırı bu kadar gün görünür */
const UNVERIFIED_DAYS = 14;

/**
 * Ayarlar › LafPOS (kasa) (docs/LAFPOS.md › Durum ve onarım, Geçiş günü): bağlantının durumu (kurulmadı, bağlı, geçiş
 * bekliyor, kasa LafPOS), son ret ve çözümü ("Bu günün LafPOS kaydını sil", 409), imzası tutmayan istekler, LafPOS'a
 * geçiş günü, gelen ve gelmeyen günler, ürüne bağlanamayan POS adları. Geçiş günü boşken LafPOS'un gönderdiği günler
 * yalnız burada görünür (deneme), başka hiçbir ekrana ya da hesaba girmez (sahibin 26 Ekim kararı). Yalnız yönetici
 * (Ayarlar sayfası requireAdmin).
 */
export async function LafposCard() {
  const now = new Date();
  const data = await loadLafposCard(undefined, now).catch((e) => {
    console.error("LafPOS durumu okunamadı", e);
    return null;
  });
  if (!data) {
    return (
      <SectionCard id="lafpos" icon={<Store />} title="LafPOS (kasa)" summary="Durum okunamadı">
        <CardContent>
          <p className="rounded-2xl bg-bad-soft px-4 py-3 text-[13px] text-bad">LafPOS bağlantısının durumu okunamadı; sayfayı yenileyin.</p>
        </CardContent>
      </SectionCard>
    );
  }
  const sum = lafposCardSummary(data);
  const { state, today } = data;
  const err = state.lastError;
  const errFresh = sum.rejected;
  // 409'un çözümü: o gün hâlâ reddeden Z ile kayıtlıysa silinebilir
  const errDay = data.errorDay;
  const conflictDay = err && err.error === "z_conflict" && err.clearedAt === null && err.date && errDay && errDay.zNo === err.zNo ? { date: err.date, ...errDay } : null;
  // Silinen gün yeniden geldi mi (409'un çözümü tamamlandı)
  const resent = err?.clearedAt && errDay && Date.parse(errDay.receivedAt) > Date.parse(err.clearedAt) ? errDay : null;
  const unverified = state.unverified && now.getTime() - Date.parse(state.unverified.lastAt) < UNVERIFIED_DAYS * 86_400_000 ? state.unverified : null;
  const linked = data.secretProblem === null;
  return (
    <SectionCard
      id="lafpos"
      icon={<Store />}
      title="LafPOS (kasa)"
      summary={sum.short}
      description={
        <>
          Kafenin kasası LafPOS her iş gününü kapanışta buraya gönderir. Geçiş günü seçilene kadar kasa ModPOS sayılır: LafPOS&apos;un gönderdiği günler
          yalnız burada görünür, hiçbir hesaba girmez.{" "}
          <InfoTip text="Açılış sırası: 1) anahtarlar (Vercel'de bu panele LAFPOS_SYNC_SECRET; LafPOS'a aynı değerle LAFMALIYET_SYNC_SECRET ve LAFMALIYET_URL; sitenin LAFPOS_SYNC_SECRET'ı ayrı bir değerdir), 2) deneme gönderimi (LafPOS'ta bir gün kapatılır, burada 'deneme' görünür), 3) geçiş günü. Ayrıntı docs/LAFPOS.md." />
        </>
      }
    >
      <CardContent className="space-y-4">
        <div className="space-y-1.5 rounded-2xl bg-surface px-4 py-3 text-sm ring-1 ring-line">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone={sum.tone} dot>
              {sum.badge}
            </Badge>
            <span className="text-ink">{sum.headline}</span>
          </p>
          {sum.lines.map((l) => (
            <p key={l} className="text-[13px] leading-5 text-pretty text-ink-mute">
              {l}
            </p>
          ))}
        </div>

        {err ? (
          err.clearedAt ? (
            <p className="text-[13px] leading-5 text-pretty text-ink-mute">
              {err.date ? `${dayMonthYearTR(err.date)} kaydı ${dateTimeTR(err.clearedAt)} silindi` : "Kayıt silindi"}
              {resent ? `, LafPOS yeniden gönderdi (Z ${resent.zNo}, ${dateTimeTR(resent.receivedAt)}).` : "; LafPOS günü yeniden gönderince yazılır."}
            </p>
          ) : (
            <div className={cn("space-y-2 rounded-2xl px-4 py-3 text-[13px] leading-5 text-pretty", errFresh ? "bg-bad-soft text-bad" : "bg-surface text-ink-mute ring-1 ring-line")}>
              <p>
                <span className="font-medium">{errFresh ? "Son gönderim reddedildi" : "Önceki ret"}</span> · {dateTimeTR(err.at)} · {err.status}
              </p>
              <p>{rejectionText(err, today)}</p>
              {conflictDay ? <LafposDayDelete date={conflictDay.date} zNo={conflictDay.zNo} lines={conflictDay.lines} label="Bu günün LafPOS kaydını sil" /> : null}
            </div>
          )
        ) : null}
        {unverified ? <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13px] leading-5 text-pretty text-warn">{unverifiedText(unverified)}</p> : null}

        <LafposSwitchDayForm value={data.switchDay} today={today} min={LAFPOS_SWITCH_MIN} max={addDays(today, LAFPOS_SWITCH_MAX_AHEAD)} linked={linked} />

        {data.days.length ? (
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-ink-soft">
              Gelen günler{data.totalDays > data.days.length ? ` (son ${data.days.length}; toplam ${num(data.totalDays)})` : ""}
            </p>
            <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
              {data.days.map((d) => (
                <li key={d.date} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-ink">{longDateTR(d.date)}</span>
                      {d.counted ? (
                        <Badge tone="green">Sayılıyor</Badge>
                      ) : (
                        <Badge tone="gray" title="Geçiş gününden önce: hiçbir hesaba girmez">
                          Deneme
                        </Badge>
                      )}
                    </p>
                    <p className="mt-0.5 text-[13px] text-ink-mute tabular">
                      Z {d.zNo} · {num(d.receipts)} fiş · {money(d.zTotal)} · {num(d.lines)} satır · alındı {dateTimeTR(d.receivedAt)}
                    </p>
                  </div>
                  <LafposDayDelete date={d.date} zNo={d.zNo} lines={d.lines} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {data.unmatchedCount ? (
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium text-ink-soft">
              Ürüne bağlanamayan POS adları: {num(data.unmatchedCount)}{" "}
              <InfoTip text="Bu satırlar maliyete ve stoğa girmez. Ürünler › Site eşleştirmesinde ürünü sitenin kalemine bağlayın ya da Satışlar'daki POS eşleştirmesiyle adı ürüne bağlayın; gün LafPOS'tan yeniden gelince geçer." />
            </p>
            <p className="text-[13px] leading-5 text-pretty text-ink-mute">
              {data.unmatched.map((u) => `${u.posName} (${num(u.qty)} adet, ${num(u.days)} gün)`).join(" · ")}
              {data.unmatchedCount > data.unmatched.length ? ` ve ${num(data.unmatchedCount - data.unmatched.length)} ad daha` : ""}
            </p>
          </div>
        ) : null}
      </CardContent>
    </SectionCard>
  );
}

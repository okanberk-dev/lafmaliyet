import { Store } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { CardContent } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { dateTimeTR, money, num } from "@/lib/format";
import { clearedText, isUnverifiedAfterOk, lafposCardSummary, rejectionText, unverifiedText } from "@/lib/lafpos/status";
import { LAFPOS_SWITCH_MAX_AHEAD, LAFPOS_SWITCH_MIN } from "@/lib/lafpos/switch";
import { addDays, longDateTR } from "@/lib/reminders";
import { loadLafposCard } from "@/server/lafpos/status";

import type { ProductOption } from "../satislar/product-picker";
import { LafposDayDelete, LafposSwitchDayForm, LafposUnmatchedList } from "./lafpos-client";
import { SectionCard } from "./section-card";

/** İmzası doğrulanamayan isteklerin satırı bu kadar gün görünür */
const UNVERIFIED_DAYS = 14;

/**
 * Ayarlar › LafPOS (kasa) (docs/LAFPOS.md › Durum ve onarım, Geçiş günü): bağlantının durumu (kurulmadı, bağlı, geçiş
 * bekliyor, kasa LafPOS), güne göre açık retler ve çözümü ("Bu günün LafPOS kaydını sil", 409; sonra LafPOS'tan elle
 * Gönder), güne bağlanamayan son ret, imzası doğrulanamayan istekler, LafPOS'a
 * geçiş günü, gelen ve gelmeyen günler, ürüne bağlanamayan POS adları. Geçiş günü boşken LafPOS'un gönderdiği günler
 * yalnız burada görünür (deneme), başka hiçbir ekrana ya da hesaba girmez (sahibin 26 Ekim kararı). Yalnız yönetici
 * (Ayarlar sayfası requireAdmin).
 */
export async function LafposCard({ products }: { products: ProductOption[] }) {
  const now = new Date();
  const data = await loadLafposCard(undefined, now).catch((e) => {
    console.error("LafPOS durumu okunamadı", e);
    return null;
  });
  if (!data) {
    return (
      <SectionCard id="lafpos" icon={<Store />} title="LafPOS (kasa)" summary="Durum okunamadı">
        <CardContent>
          <Notice tone="bad" size="sm" title="LafPOS bağlantısının durumu okunamadı; sayfayı yenileyin" />
        </CardContent>
      </SectionCard>
    );
  }
  const sum = lafposCardSummary(data);
  const { state, today } = data;
  const linked = data.secretProblem === null;
  // Bağlantı kapalıyken retler kırmızı değil (özet de saymaz)
  const rejectTone = linked ? "bad" : "neutral";
  const undated = sum.undated;
  const unverified = state.unverified && now.getTime() - Date.parse(state.unverified.lastAt) < UNVERIFIED_DAYS * 86_400_000 ? state.unverified : null;
  // Sonradan başarılı gönderim geldiyse bağlantı çalışıyor: uyarı değil, soluk bilgi
  const unverifiedLoud = unverified !== null && isUnverifiedAfterOk(state);
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

        {sum.dayRejections.map(({ rejection: e, day, status }) =>
          status === "cleared" ? (
            <Notice key={e.date} tone={linked ? "warn" : "neutral"} size="sm" title={`LafPOS'tan Gönder bekleniyor · ${longDateTR(e.date)}`} text={clearedText(e, today)} />
          ) : (
            <Notice
              key={e.date}
              tone={rejectTone}
              size="sm"
              title={`${longDateTR(e.date)} reddedildi · ${dateTimeTR(e.at)} · ${e.status}`}
              // 409'un çözümü: gün hâlâ reddeden Z ile kayıtlıysa silinebilir
              action={e.error === "z_conflict" && day && day.zNo === e.zNo ? <LafposDayDelete date={e.date} zNo={day.zNo} lines={day.lines} label="Bu günün LafPOS kaydını sil" /> : undefined}
            >
              {rejectionText(e, today)}
            </Notice>
          ),
        )}
        {undated ? (
          <Notice
            tone={undated.fresh ? rejectTone : "neutral"}
            size="sm"
            title={`${undated.fresh ? "Son gönderim reddedildi" : "Önceki ret"} · ${dateTimeTR(undated.rejection.at)} · ${undated.rejection.status}`}
          >
            {rejectionText(undated.rejection, today)}
          </Notice>
        ) : null}
        {unverified ? (
          <Notice tone={unverifiedLoud ? "warn" : "neutral"} size="sm" title={`${unverifiedText(unverified)}${unverifiedLoud ? "" : " O günden beri gün sonları geliyor."}`} />
        ) : null}

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
              <InfoTip
                text={`${
                  data.switchDay
                    ? "Geçiş gününden önceki günlerde hiçbir hesaba girmez. Geçiş gününden sonra ciroya girer, maliyeti ortalama maliyet oranından tahmin edilir; reçeteye göre tüketime (Tutarlılık, stok) girmez."
                    : "Geçiş günü seçilene kadar hiçbir hesaba girmez. Seçildikten sonra ciroya girer, maliyeti ortalama maliyet oranından tahmin edilir; reçeteye göre tüketime (Tutarlılık, stok) girmez."
                } Adı buradan bir ürüne bağlayın (Satışlar'ın POS adı hafızasına yazılır), ürünü Ürünler › Site menüsü'nde sitenin kalemine bağlayın ya da geçiş gününden sonraki aylarda Satışlar'da eşleştirin. Bağlanınca kayıtlı günler de yeniden gönderim olmadan güncellenir.`}
              />
            </p>
            <LafposUnmatchedList items={data.unmatched} more={data.unmatchedCount - data.unmatched.length} products={products} />
          </div>
        ) : null}

        {data.unmatchedIkramCount ? (
          // Yalnız ikram edilen kalem satış listesine düşmez: tüketime girmesi için burada bağlanır (denetim B10)
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium text-ink-soft">
              İkramda ürüne bağlanamayan POS adları: {num(data.unmatchedIkramCount)}{" "}
              <InfoTip text="LafPOS'ta ikram edilen, zayi yazılan ya da hazırlandıktan sonra iptal edilen ama ürüne bağlanamayan kalem kayıtlı tüketime (Tutarlılık) girmez; Zayi & ikram'da “ürüne bağlı değil” der. Adı buradan bir ürüne bağlayın (Satışlar'ın POS adı hafızasına yazılır) ya da ürünü Ürünler › Site menüsü'nde sitenin kalemine bağlayın. Bağlanınca geçmiş günlerin ikramı da o ürünle sayılır." />
            </p>
            <LafposUnmatchedList items={data.unmatchedIkram} more={data.unmatchedIkramCount - data.unmatchedIkram.length} products={products} ikram />
          </div>
        ) : null}
      </CardContent>
    </SectionCard>
  );
}

import { ChevronRight, ReceiptTurkishLira } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { CardContent } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { modposDayBadges, modposDayLine } from "@/lib/modpos/ayarlar";
import { timeText } from "@/lib/modpos/status";
import { longDateTR } from "@/lib/reminders";
import { loadModposCard } from "@/server/modpos/status";

import { ModposFallbackSwitch, ModposFetchForm } from "./modpos-client";
import { SectionCard } from "./section-card";

const SETUP_TIP =
  "Kurulum: 1) Gafdigi'nin verdiği anahtarı Vercel › lafmaliyet › Settings › Environment Variables'a yalnız Production olarak MODPOS_API_KEY adıyla ekleyip yeniden yayınlayın (önizlemeler canlının veritabanını paylaşır, çekmez); 2) anahtara IP kısıtı koydurmayın, Vercel'in sabit çıkış IP'si yok; 3) ilk föy ertesi sabah 08:00'de gelir ya da aşağıdan Bu günü çek ile hemen alınır. Günde 2 çekim hakkı var (Türkiye saatiyle gece yarısı yenilenir): sabah işi önce dünün föyünü, kalan hakla geçmişte eksik bir günü çeker. İsteğe bağlı: MODPOS_SYNC_FROM (geçmişin tamamlanacağı ilk gün, YYYY-MM-DD) ve MODPOS_API_URL. Ayrıntı docs/MODPOS-API.md.";

/**
 * Ayarlar › ModPOS (kasa föyü) (docs/MODPOS-API.md › Nerede görünür, Kota ve çekme sırası, Ay rakamına yedek):
 * bağlantının durumu (Kurulmadı / Henüz çekilmedi / Bağlı / Uyarı / Hata), bugünkü kalan hak ve yenilenme saati,
 * kapsam, son çekim ve son hata, "Bu günü çek", son çekilen günler (Kasa'nın o gününe bağlantıyla) ve ay rakamına yedek
 * anahtarı. Yalnız okur: sayfa açılışı ModPOS'a istek göndermez, arka planda da çekmez (günde 2 hak).
 * Yalnız yönetici (Ayarlar sayfası requireAdmin); föyün parası personele gitmez.
 */
export async function ModposCard() {
  const now = new Date();
  const data = await loadModposCard(undefined, now).catch((e) => {
    console.error("ModPOS durumu okunamadı", e);
    return null;
  });
  if (!data) {
    return (
      <SectionCard id="modpos" icon={<ReceiptTurkishLira />} title="ModPOS (kasa föyü)" summary="Durum okunamadı">
        <CardContent>
          <Notice tone="bad" size="sm" title="ModPOS kasa föyünün durumu okunamadı; sayfayı yenileyin" />
        </CardContent>
      </SectionCard>
    );
  }
  const sum = data.summary;
  const run = data.lastRun;
  return (
    <SectionCard
      id="modpos"
      icon={<ReceiptTurkishLira />}
      title="ModPOS (kasa föyü)"
      summary={sum.short}
      summaryTone={sum.tone === "red" ? "bad" : sum.badge === "Uyarı" ? "warn" : undefined}
      description={
        <>
          ModPOS&apos;un kasa föyü her sabah buraya gelir: ciro, ödeme yöntemleri, açılış ve sayım, giderler ve kasa farkı. Kasa ekranında yöneticinin
          gördüğü raporla yan yana durur; personelin ekranı değişmez. <InfoTip text={SETUP_TIP} />
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
          {run?.text ? (
            <p className="text-[13px] leading-5 text-pretty text-ink-mute">
              Son çalışma ({run.trigger === "cron" ? "sabah işi" : "elle"}, {timeText(run.at, now)}): {run.text}
            </p>
          ) : null}
        </div>

        <ModposFetchForm today={data.today} defaultDay={data.defaultDay} left={sum.left} canFetch={sum.canFetch} blocked={sum.fetchBlocked} stored={data.stored} />

        {data.days.length ? (
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-ink-soft">
              Son çekilen günler{data.input.stored.count > data.days.length ? ` (son ${data.days.length}; toplam ${data.input.stored.count})` : ""}
            </p>
            <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
              {data.days.map((d) => (
                <li key={d.day}>
                  <Link href={`/panel/kasa?gun=${d.day}`} className="flex items-center gap-3 px-4 py-2.5 text-sm outline-none hover:bg-panel focus-visible:bg-panel">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-ink">{longDateTR(d.day)}</span>
                        {modposDayBadges(d).map((b) => (
                          <Badge key={b.text} tone={b.tone} title={b.title}>
                            {b.text}
                          </Badge>
                        ))}
                      </p>
                      <p className="mt-0.5 text-[13px] text-ink-mute tabular">{modposDayLine(d.z)}</p>
                    </div>
                    <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-mute" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <ModposFallbackSwitch on={data.fallback} />
      </CardContent>
    </SectionCard>
  );
}

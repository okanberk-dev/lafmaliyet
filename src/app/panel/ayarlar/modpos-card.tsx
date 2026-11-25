import { ChevronRight, ReceiptTurkishLira } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { CardContent } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import type { BranchRow } from "@/lib/branches";
import { modposDayBadges, modposDayLine } from "@/lib/modpos/ayarlar";
import { timeText } from "@/lib/modpos/status";
import { modposCardView } from "@/lib/pos-cards";
import { longDateTR } from "@/lib/reminders";
import { loadModposCard, type ModposCardData } from "@/server/modpos/status";

import { ModposFallbackSwitch, ModposFetchForm } from "./modpos-client";
import { PosElsewhereCard } from "./pos-elsewhere";
import { SectionCard } from "./section-card";

/**
 * Ayarlar › ModPOS (kasa föyü) (docs/MODPOS-API.md › Nerede görünür, Kota ve çekme sırası, Ay rakamına yedek):
 * bağlantının durumu (Kurulmadı / Henüz çekilmedi / Bağlı / Uyarı / Hata), bugünkü kalan hak ve yenilenme saati,
 * kapsam, son çekim ve son hata, "Bu günü çek", son çekilen günler (Kasa'nın o gününe bağlantıyla) ve ay rakamına yedek
 * anahtarı. Yalnız okur: sayfa açılışı ModPOS'a istek göndermez, arka planda da çekmez (günde 2 hak).
 * Yalnız yönetici (Ayarlar sayfası requireAdmin); föyün parası personele gitmez.
 *
 * Seçili şubeye göre (şube kapsamı C P2-2, src/lib/pos-cards.ts): tek şube seçiliyken yalnız o şubenin bölümü; kasası
 * ModPOS olmayan şube ya da online kanal seçiliyken kart "Bu şubede kullanılmıyor" satırına iner (durum okunmaz).
 * "Tümü"de birden çok kasa açıkken her bölüm şubenin adıyla.
 */
export async function ModposCard({ scope, branches }: { scope: string; branches: BranchRow[] }) {
  const view = modposCardView(scope, branches);
  if (view.kind === "elsewhere") return <PosElsewhereCard id="modpos" icon={<ReceiptTurkishLira />} title="ModPOS API" system="ModPOS" users={view.users} />;
  const now = new Date();
  const data = await (async () => {
    // ModPOS'tan çekilen her şubenin kendi bölümü (anahtar, hak, günler; docs/MODPOS-API.md › Şubeler); hiç yoksa Tuzla.
    // Tek şube seçiliyken yalnız onunki
    const cards = await Promise.all(view.ids.map((id) => loadModposCard(undefined, now, process.env, id, branches)));
    return { branches, cards };
  })().catch((e) => {
    console.error("ModPOS durumu okunamadı", e);
    return null;
  });
  if (!data) {
    return (
      <SectionCard id="modpos" icon={<ReceiptTurkishLira />} title="ModPOS API" summary="Durum okunamadı">
        <CardContent>
          <Notice tone="bad" size="sm" title="ModPOS API'nin durumu okunamadı; sayfayı yenileyin" />
        </CardContent>
      </SectionCard>
    );
  }
  // Bölümler şube adıyla: birden çok ModPOS şubesi ya da "Tümü"de birden çok kasa
  const many = data.cards.length > 1 || view.named;
  const nameOf = (id: string) => data.branches.find((b) => b.id === id)?.name ?? id;
  const sums = data.cards.map((c) => c.summary);
  const red = sums.some((x) => x.tone === "red");
  const warn = sums.some((x) => x.badge === "Uyarı");
  return (
    <SectionCard
      id="modpos"
      icon={<ReceiptTurkishLira />}
      title="ModPOS API"
      summary={many ? data.cards.map((c) => `${nameOf(c.branchId)}: ${c.summary.short}`).join(" · ") : sums[0].short}
      summaryTone={red ? "bad" : warn ? "warn" : undefined}
      description={
        <>
          ModPOS API&apos;den kasa verisi her sabah buraya gelir: ciro, ödeme yöntemleri, açılış ve sayım, giderler ve kasa farkı. Kasa ekranında yöneticinin
          gördüğü raporla yan yana durur; personelin ekranı değişmez.{data.cards.length > 1 ? " Her şube kendi anahtarı ve günlük hakkıyla çekilir, verisi yalnız kendi şubesine yazılır." : ""}
        </>
      }
    >
      <CardContent className="space-y-4">
        {data.cards.map((c) => (
          <ModposBranchSection key={c.branchId} data={c} now={now} branch={many ? data.branches.find((b) => b.id === c.branchId) ?? null : null} />
        ))}

        <ModposFallbackSwitch on={data.cards[0].fallback} />
      </CardContent>
    </SectionCard>
  );
}

/** Bir şubenin bölümü: durum, "Bu günü çek" ve son çekilen günler (`branch` yalnız birden çok ModPOS şubesi varken: başlık ve bağlantıdaki şube) */
function ModposBranchSection({ data, now, branch }: { data: ModposCardData; now: Date; branch: BranchRow | null }) {
  const sum = data.summary;
  const run = data.lastRun;
  const sube = branch ? `&sube=${branch.id}` : "";
  return (
    <div className="space-y-4">
      {branch ? <p className="text-sm font-semibold text-ink">{branch.name}</p> : null}
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

      <ModposFetchForm
        branchId={data.branchId}
        today={data.today}
        defaultDay={data.defaultDay}
        left={sum.left}
        canFetch={sum.canFetch}
        blocked={sum.fetchBlocked}
        stored={data.stored}
      />

      {data.days.length ? (
        <div className="space-y-2">
          <p className="text-[13px] font-medium text-ink-soft">
            Son çekilen günler{data.input.stored.count > data.days.length ? ` (son ${data.days.length}; toplam ${data.input.stored.count})` : ""}
          </p>
          <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
            {data.days.map((d) => (
              <li key={d.day}>
                <Link href={`/panel/kasa?gun=${d.day}${sube}`} className="flex items-center gap-3 px-4 py-2.5 text-sm outline-none hover:bg-panel focus-visible:bg-panel">
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
    </div>
  );
}

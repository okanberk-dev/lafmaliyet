import { Bug } from "lucide-react";

import { Badge, type Tone } from "@/components/ui/badge";
import { CardContent } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { Notice } from "@/components/ui/notice";
import { cspEnforced } from "@/lib/csp";
import { cspVerdict, DAILY_NEW_CAP, errorSummary, RETENTION_DAYS, seenText, SOURCE_LABELS, type ErrorRow } from "@/lib/error-log";
import { loadErrorLog } from "@/server/errors/store";

import { ResolveAllErrorsButton, ResolveErrorButton } from "./errors-client";
import { SectionCard } from "./section-card";

const SOURCE_TONE: Record<ErrorRow["source"], Tone> = { server: "red", action: "red", client: "amber", csp: "gray" };

/** Listede üç satıra kısalan ileti (sorgu hatası: neden + SQL); tamamı Ayrıntı'da */
const isLong = (message: string) => message.length > 120 || message.split("\n").length > 3;

function ErrorItem({ r, now }: { r: ErrorRow; now: Date }) {
  const tone = r.overflow ? "gray" : r.source === "csp" && r.level === "error" ? "amber" : SOURCE_TONE[r.source];
  const long = isLong(r.message);
  const hasDetails = Boolean(r.stack || r.detail || r.name || long);
  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone={tone} dot>
              {SOURCE_LABELS[r.source]}
            </Badge>
            {r.count > 1 ? <span className="text-[13px] text-ink-mute tabular">× {r.count.toLocaleString("tr-TR")}</span> : null}
            <span className="text-[13px] text-ink-mute">son {seenText(r.lastSeen, now)}</span>
          </p>
          <p className="mt-1 line-clamp-3 font-medium break-words whitespace-pre-line text-ink">{r.message}</p>
          <p className="mt-0.5 text-[13px] break-words text-ink-mute">
            {r.path ? <span className="font-mono text-[12px]">{r.path}</span> : null}
            {r.path ? " · " : null}ilk {seenText(r.firstSeen, now)}
            {/* Hata ekranındaki kod: son görülüşlerin kodları, açıkta (sayfada aranınca bulunsun) */}
            {r.digests.length ? (
              <>
                {" · "}hata kodu <span className="font-mono text-[12px] text-ink-soft">{r.digests.join(", ")}</span>
              </>
            ) : null}
          </p>
          {hasDetails ? (
            <details className="group mt-1">
              <summary className="cursor-pointer text-[13px] font-medium text-ink-mute select-none hover:text-ink">Ayrıntı</summary>
              {long ? <p className="mt-1 text-[13px] break-words whitespace-pre-line text-ink">{r.message}</p> : null}
              <dl className="mt-1 space-y-0.5 text-[13px] text-ink-mute">
                {r.name ? (
                  <div>
                    <dt className="inline">Ad: </dt>
                    <dd className="inline break-words text-ink">{r.name}</dd>
                  </div>
                ) : null}
                {r.detail ? (
                  <div>
                    <dt className="inline">Yer: </dt>
                    <dd className="inline break-words text-ink">{r.detail}</dd>
                  </div>
                ) : null}
              </dl>
              {r.stack ? (
                <pre className="mt-1 max-h-48 overflow-y-auto rounded-xl bg-panel px-3 py-2 font-mono text-[11px] leading-4 break-all whitespace-pre-wrap text-ink-soft">{r.stack}</pre>
              ) : null}
            </details>
          ) : null}
        </div>
        <ResolveErrorButton id={r.id} />
      </div>
    </li>
  );
}

/**
 * Ayarlar › Hata kaydı (docs/HATA-KAYDI.md): panelde oluşan hatalar (sunucu, işlem, tarayıcı, CSP), aynı hata tek
 * satırda sayısı ve ilk / son görülüşüyle; satırı ya da hepsini "Çözüldü". Üstte güvenlik politikasının (CSP) kararı
 * kanıtla (src/lib/error-log.ts cspVerdict). Sayfa yalnız yöneticiye açık; burada yalnız okunur.
 */
export async function ErrorLogCard() {
  const view = await loadErrorLog().catch((e) => {
    console.error("Hata kaydı okunamadı", (e as Error)?.message);
    return null;
  });
  const now = new Date();
  const summary = view ? errorSummary(view.open, now) : { text: "Kayıt okunamadı", tone: "bad" as const };
  const verdict = view ? cspVerdict(view.csp, { enforced: cspEnforced(process.env), since: view.since, now }) : null;
  return (
    <SectionCard
      id="hatalar"
      icon={<Bug />}
      title="Hata kaydı"
      summary={summary.text}
      summaryTone={summary.tone}
      description={
        <>
          Panelde oluşan hatalar {RETENTION_DAYS} gün burada durur: aynı hata tek satırda, kaç kez ve en son ne zaman görüldüğüyle. Sunucuda hata olunca yöneticilere
          günde en çok bir e-posta gider. Düzelen satırı Çözüldü işaretleyin; hata yeniden görülürse satır geri gelir.{" "}
          <InfoTip
            text={`Sunucu: sayfa ve bağlantı hataları. İşlem: kaydet gibi bir düğmenin "İşlem tamamlanamadı" dediği hata. Tarayıcı: telefonda ya da bilgisayarda ekranın kendi hatası. CSP: güvenlik politikasının engellediği (ya da engelleyeceği) kaynak. Aynı CSP ihlali hangi ekranda olursa olsun tek satırdır; tarayıcı eklentisinin ihlali yazılmaz. Kişisel veri ve parola yazılmaz; metinler kısaltılır. Bir günde sunucu ve işlemde ${DAILY_NEW_CAP.server}, tarayıcı ve CSP'de ${DAILY_NEW_CAP.csp} farklı hata ayrı satır açar, sonrakiler yalnız sayılır.`}
          />
        </>
      }
      actionsClassName="max-sm:w-full"
      actions={view?.openCount ? <ResolveAllErrorsButton count={view.openCount} /> : null}
    >
      <CardContent className="space-y-3">
        {verdict ? <Notice tone={verdict.tone} size="sm" title={verdict.title} text={verdict.text} tech={verdict.tech} /> : null}
        {!view ? (
          <Notice tone="bad" size="sm" title="Hata kaydı okunamadı; sayfayı yenileyin" />
        ) : view.open.length ? (
          <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
            {view.open.map((r) => (
              <ErrorItem key={r.id} r={r} now={now} />
            ))}
          </ul>
        ) : (
          <Notice tone="good" size="sm" title="Açık hata yok" />
        )}
        {view && (view.openCount > view.open.length || view.resolvedCount) ? (
          <p className="text-[13px] leading-5 text-pretty text-ink-mute">
            {view.openCount > view.open.length ? `Son görülen ${view.open.length} açık satır gösteriliyor (toplam ${view.openCount}). ` : null}
            {view.resolvedCount ? `${view.resolvedCount} çözülmüş satır gizli; aynı hata yeniden görülürse açılır.` : null}
          </p>
        ) : null}
      </CardContent>
    </SectionCard>
  );
}

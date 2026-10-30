import { CheckCircle2, ChevronDown, ChevronRight, Circle, Landmark, ListChecks } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Notice, NoticeLink } from "@/components/ui/notice";
import { money } from "@/lib/format";
import { badgeLabel, plainLabel } from "@/lib/tax/glossary";
import { formatEstimate } from "@/lib/tax/rules";
import { type GeciciCard, type KvCard, profitTaxTitle, type TaxView } from "@/lib/tax/view";
import { cn } from "@/lib/utils";

import { FilingButton, type FilingKindData } from "./filing-dialog";
import type { RuleRef } from "./refs";
import { DetailList, Explain, NoteList, RuleRefList } from "./ui";

/*
 * Özet'in kartları (plan docs/planlar/vergi.md §4.1, K21, K33; docs/planlar/ux-sade.md §7.3, §7.6): Başlarken (tek
 * satır) ve şirketin kâr vergisi (geçici vergi peşinatı ve yıllık kurumlar vergisi tek kartta, iki bölüm). Kart tahmini
 * "kafenin payı" diye yazar; şirketin vergisi muhasebecinin rakamıdır. Eksik bilgide tek rakam yok ("şimdilik en
 * çok"), alt sınır yalnız "Nasıl hesaplandı"da. Etiketler sade sözle (glossary.ts), veri resmî adla kalır.
 */

/** Kartın rozeti: takvimle aynı sözler (K16); "Ödemeler'de" kartta büyük rakamın kaynağı olduğu için rozet kalır */
function CardBadge({ badge }: { badge: string | null }) {
  const b = badgeLabel(badge);
  if (b) return <Badge tone={b.tone}>{b.label}</Badge>;
  return badge === "Ödemeler'de" ? <Badge tone="blue">Ödemeler&apos;de</Badge> : null;
}

/**
 * Başlarken (K33, §7.3): tek satır "Başlarken: 2 / 4 · sıradaki: …"; açılınca açıklama ve dört adım. Hepsi bitince
 * "Hazırlık tamam · yeniden aç". `#baslarken` kartın kendisi
 */
export function GettingStartedCard({ data }: { data: TaxView["gettingStarted"] }) {
  const steps = (
    <ul className="mx-2 divide-y divide-line overflow-hidden rounded-2xl bg-surface ring-1 ring-line sm:mx-5">
      {data.steps.map((s) => (
        <li key={s.key}>
          <Link
            href={s.href}
            className="flex min-h-14 items-center gap-3 px-4 py-2.5 outline-none hover:bg-panel/60 focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-inset"
          >
            {s.done ? (
              <CheckCircle2 size={20} className="shrink-0 text-good" aria-label="Bitti" />
            ) : (
              <Circle size={20} className="shrink-0 text-ink-quiet" aria-label="Yapılacak" />
            )}
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sm leading-5 font-medium break-words", s.done ? "text-ink-mute" : "text-ink")}>{s.title}</span>
              {s.detail ? <span className="block text-xs leading-4 break-words text-ink-mute">{s.detail}</span> : null}
            </span>
            <ChevronRight size={16} className="shrink-0 text-ink-quiet" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
  const done = data.done === data.total;
  const next = data.steps.find((s) => !s.done);
  return (
    <Card id="baslarken" className="scroll-mt-20">
      <details className="group/gs">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-3xl px-5 py-3 outline-none select-none focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
          {done ? (
            <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
              <CheckCircle2 size={18} className="shrink-0 text-good" aria-hidden="true" />
              Hazırlık tamam · yeniden aç
            </span>
          ) : (
            <span className="flex min-w-0 items-center gap-2 text-sm">
              <ListChecks size={18} className="shrink-0 text-ink-soft" aria-hidden="true" />
              <span className="shrink-0 font-medium text-ink">
                Başlarken: {data.done} / {data.total}
              </span>
              {next ? <span className="min-w-0 truncate text-ink-mute max-sm:hidden">· sıradaki: {next.title}</span> : null}
            </span>
          )}
          <ChevronDown size={18} aria-hidden="true" className="shrink-0 text-ink-quiet motion-safe:transition-transform group-open/gs:rotate-180" />
        </summary>
        <div className="pb-5">
          {done ? null : <p className="px-5 pb-3 text-[13px] leading-5 text-pretty text-ink-mute">Hesabın asıl belirleyicisi bu adımlar; bitene kadar geçici ve kurumlar vergisi taslaktır.</p>}
          {steps}
        </div>
      </details>
    </Card>
  );
}

/** Geçici vergi bölümünün "Nasıl hesaplandı"sı: dönemin hesabı ve alt sınır */
function GeciciExplain({ card, rules }: { card: GeciciCard; rules: RuleRef[] }) {
  const c = card.calc;
  const floorRows = [
    { label: "Alt sınırla yılbaşından beri kâr", value: money(c.floor.cumulative) },
    { label: "Alt sınırla vergi hesabındaki kâr (matrah)", value: money(c.floor.matrah) },
    { label: "Alt sınırla kafenin payı", value: formatEstimate(c.floor.estimate) },
  ];
  const calcRows = [
    { label: plainLabel("Dönemin sonucu (amortisman öncesi)"), value: money(c.periodResult + c.depreciation + c.direct - c.kkeg) },
    { label: plainLabel("Amortisman"), value: money(-c.depreciation) },
    ...(c.direct ? [{ label: "Bu yıl gider yazılan demirbaş", value: money(-c.direct) }] : []),
    ...(c.kkeg ? [{ label: "İndirilemeyen gider (eklenen)", value: money(c.kkeg) }] : []),
    { label: plainLabel("Dönem kazancı"), value: money(c.periodResult), strong: true },
    ...(c.anchor ? [{ label: `Çapa: ${c.anchor.period.replace("-Q", "/")} muhasebeci kaydının matrahı`, value: money(c.anchor.matrah) }] : []),
    { label: plainLabel("Kümülatif kurum kazancı"), value: money(c.cumulative), strong: true },
    ...(c.loss ? [{ label: "Devreden zarar", value: money(-c.loss) }] : []),
    ...(c.indirim ? [{ label: "İndirim", value: money(-c.indirim) }] : []),
    { label: plainLabel("Matrah"), value: money(c.matrah) },
    { label: "Hesaplanan vergi (× %25)", value: money(c.hesaplanan) },
    { label: "Asgari kurumlar vergisi", value: c.asgari === null ? "uygulanmaz" : money(c.asgari) },
    { label: plainLabel("Önceki dönemler"), value: money(-c.previous) },
    { label: plainLabel("Kafenin katkısı"), value: money(c.estimate), strong: true },
  ];
  return (
    <Explain>
      <DetailList rows={calcRows} />
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-ink-soft">Alt sınır</p>
        <p className="text-xs leading-5 text-ink-mute">
          Belgesi seçilmemiş kalemler belgeli, demirbaş adayları gider, demirbaş listesine eklenmemiş Kuruluş &amp; Demirbaş faturaları ve ömrü girilmemiş demirbaşların maliyeti
          tamamen gider sayılsaydı. Kesin bir sınır değil; ekranın başlığına yazılmaz.
        </p>
        <DetailList rows={floorRows} />
      </div>
      <RuleRefList refs={rules} />
    </Explain>
  );
}

/** Kurumlar vergisi bölümünün "Nasıl hesaplandı"sı */
function KvExplain({ card, rules }: { card: KvCard; rules: RuleRef[] }) {
  const k = card.calc;
  const calcRows = [
    { label: k.filing ? "Kurum kazancı (muhasebecinin kaydı)" : plainLabel("Kümülatif kurum kazancı"), value: money(k.income) },
    ...(k.carried ? [{ label: "Önceki yıllardan devreden zarar", value: money(k.carried) }] : []),
    ...(k.loss ? [{ label: "Düşülen zarar", value: money(-k.loss) }] : []),
    ...(k.indirim ? [{ label: "İndirim", value: money(-k.indirim) }] : []),
    { label: plainLabel("Matrah"), value: money(k.matrah) },
    { label: plainLabel("Hesaplanan"), value: money(k.hesaplanan) },
    { label: "Asgari kurumlar vergisi", value: k.asgari === null ? "uygulanmaz" : money(k.asgari) },
    { label: "Kurumlar vergisi", value: money(k.tax), strong: true },
    ...k.paidQuarters.map((p) => ({ label: `Ödenen peşinat (geçici vergi) ${p.period.replace("-Q", "/")}`, value: money(-p.amount) })),
  ];
  return (
    <Explain>
      <DetailList rows={calcRows} />
      <RuleRefList refs={rules} />
    </Explain>
  );
}

const plainRows = (rows: readonly { label: string; value: string }[]) => rows.map((r) => ({ ...r, label: plainLabel(r.label) }));

/** "Peşinat: 3. çeyrek 2026 (geçici vergi)" */
const quarterHeading = (key: string) => `Peşinat: ${key.slice(6)}. çeyrek ${key.slice(0, 4)} (geçici vergi)`;

/**
 * Şirketin kâr vergisi (K14, §7.6): geçici vergi peşinatı (sıradaki çeyrek) ve yıllık kurumlar vergisi tek kartta.
 * Eksik bilgideki geçici vergide gider belgesi uyarısı kartın başında (hukuki sonucu var: katlanmaz). `#kar-vergisi`
 * kartın kendisi, `#gecici` peşinat bölümü (Başlarken'in "Muhasebecinin rakamları" adımı)
 */
export function ProfitTaxCard({
  gecici,
  kv,
  scope,
  filings,
  rules,
}: {
  gecici: GeciciCard | null;
  kv: KvCard;
  scope: TaxView["scope"]["key"];
  filings: { gecici: FilingKindData; kv: FilingKindData };
  rules: { gecici: RuleRef[]; kv: RuleRef[] };
}) {
  // Uyarı yalnız gider belgesi eksikken (belgesi seçilmemiş gider ya da demirbaş adayı): eksik bilginin öteki sebepleri
  // (gelir belgesi, kafe dışı işler) bölümün "Eksik bilgi" rozetinde kalır
  const missingDocs = gecici !== null && gecici.missingDocs && !gecici.calc.filing;
  // Alt satır "henüz hesaba girmedi" cümlesiyse uyarıya taşınır (tekrar yazılmaz); Ödemeler'deki tutarın satırı kalır
  const docsLine = missingDocs && gecici.headline.startsWith("Giderler sınıflandırılınca") ? gecici.subline : null;
  return (
    <Card id="kar-vergisi" className="scroll-mt-20">
      <CardHeader
        icon={<Landmark />}
        title={profitTaxTitle(gecici?.key ?? null, kv.year)}
        description={
          <>
            3 ayda bir peşin ödenir (geçici vergi); Nisan&apos;da yıl kapanır (kurumlar vergisi), peşinler düşülür.{" "}
            {scope === "kafe_elle" ? "Rakamlar kafenin ve elle girilen kafe dışı işlerin payı" : "Rakamlar yalnız kafenin payı"}; şirketin vergisi muhasebecinin beyannamesindedir.
          </>
        }
      />
      <CardContent className="space-y-5">
        {missingDocs ? (
          <Notice
            tone="warn"
            size="sm"
            risk="hukuk"
            title="Eksik belgeler var: rakam yüksek çıkabilir"
            text={docsLine ?? undefined}
            action={<NoticeLink href="/panel/vergi/gelir-gider#siniflandir">Belgesini seç</NoticeLink>}
          />
        ) : null}
        {gecici ? (
          <section id="gecici" aria-labelledby="gecici-baslik" className="scroll-mt-20 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id="gecici-baslik" className="text-sm font-semibold text-ink">
                  {quarterHeading(gecici.key)}
                </h3>
                <p className="text-[13px] leading-5 text-ink-mute">{gecici.periodLine}</p>
              </div>
              <CardBadge badge={gecici.badge} />
            </div>
            <div>
              <p className={cn("font-semibold tracking-tight text-ink tabular", gecici.badge === "Taslak" ? "text-base leading-6" : "text-2xl")}>{gecici.headline}</p>
              {gecici.subline && gecici.subline !== docsLine ? <p className="mt-1 text-[13px] leading-5 text-ink-mute">{gecici.subline}</p> : null}
            </div>
            <DetailList rows={plainRows(gecici.rows)} />
            <NoteList notes={gecici.notes} />
            <p className="text-[13px] leading-5 text-ink-soft">{gecici.footer}</p>
            <div className="flex flex-wrap gap-2">
              <FilingButton data={filings.gecici} period={gecici.key} />
              <ButtonLink href={`/panel/vergi/gelir-gider?ceyrek=${gecici.key}`} size="sm">
                Vergi kârını aç
              </ButtonLink>
            </div>
            <GeciciExplain card={gecici} rules={rules.gecici} />
          </section>
        ) : null}
        <section aria-labelledby="kv-baslik" className={cn("space-y-4", gecici && "border-t border-line pt-5")}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 id="kv-baslik" className="text-sm font-semibold text-ink">
                Yıl sonu: {kv.year} (kurumlar vergisi)
              </h3>
              {kv.subtitle ? <p className="text-[13px] leading-5 text-ink-mute">{kv.subtitle}</p> : null}
            </div>
            <CardBadge badge={kv.badge} />
          </div>
          <DetailList rows={plainRows(kv.rows)} />
          <NoteList notes={kv.notes} />
          <p className="text-[13px] leading-5 text-ink-soft">{kv.footer}</p>
          <div className="flex flex-wrap gap-2">
            <FilingButton data={filings.kv} period={String(kv.year)} />
          </div>
          <KvExplain card={kv} rules={rules.kv} />
        </section>
      </CardContent>
    </Card>
  );
}

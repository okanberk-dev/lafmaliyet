import { Building2, CheckCircle2, ChevronDown, ChevronRight, Circle, Landmark, ListChecks } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { money } from "@/lib/format";
import { formatEstimate } from "@/lib/tax/rules";
import type { GeciciCard, KvCard, TaxView } from "@/lib/tax/view";
import { cn } from "@/lib/utils";

import { FilingButton, type FilingKindData } from "./filing-dialog";
import type { RuleRef } from "./refs";
import { DetailList, Explain, NoteList, RuleRefList } from "./ui";

/*
 * Özet'in kartları (plan docs/planlar/vergi.md §4.1, K21, K33): Başlarken, kafenin geçici vergi matrahına katkısı ve
 * kurumlar vergisi. Kartlar tahmini "kafenin katkısı" diye yazar; şirketin vergisi muhasebecinin rakamıdır. Taslakta
 * tek rakam yok ("şimdilik en çok"), alt sınır yalnız "Nasıl hesaplandı"da.
 */

const STATE_TONE = { Muhasebeci: "green", Taslak: "amber" } as const;

/** Başlarken (K33): dört adım; hepsi bitince kart katlanır ("Hazırlık tamam · yeniden aç") */
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
  if (data.done === data.total) {
    return (
      <Card id="baslarken" className="scroll-mt-20">
        <details className="group/gs">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-3xl px-5 py-4 outline-none select-none focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
            <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
              <CheckCircle2 size={18} className="shrink-0 text-good" aria-hidden="true" />
              Hazırlık tamam · yeniden aç
            </span>
            <ChevronDown size={18} aria-hidden="true" className="shrink-0 text-ink-quiet transition-transform group-open/gs:rotate-180" />
          </summary>
          <div className="pb-5">{steps}</div>
        </details>
      </Card>
    );
  }
  return (
    <Card id="baslarken" className="scroll-mt-20">
      <CardHeader
        icon={<ListChecks />}
        title="Başlarken"
        description="Hesabın asıl belirleyicisi bu adımlar; bitene kadar geçici ve kurumlar vergisi taslaktır."
        meta={`${data.done} / ${data.total} tamam`}
      />
      <div className="pb-5">{steps}</div>
    </Card>
  );
}

/** Kafenin geçici vergi matrahına katkısı (yalnız kafe): sıradaki dönem */
export function GeciciCardView({ card, filing, rules }: { card: GeciciCard; filing: FilingKindData; rules: RuleRef[] }) {
  const c = card.calc;
  const floorRows = [
    { label: "Alt sınırla kümülatif kazanç", value: money(c.floor.cumulative) },
    { label: "Alt sınırla matrah", value: money(c.floor.matrah) },
    { label: "Alt sınırla kafenin katkısı", value: formatEstimate(c.floor.estimate) },
  ];
  const calcRows = [
    { label: "Dönemin sonucu (amortisman öncesi)", value: money(c.periodResult + c.depreciation + c.direct - c.kkeg) },
    { label: "Amortisman", value: money(-c.depreciation) },
    ...(c.direct ? [{ label: "Doğrudan gider yazılan demirbaş", value: money(-c.direct) }] : []),
    ...(c.kkeg ? [{ label: "İndirilemeyen gider (eklenen)", value: money(c.kkeg) }] : []),
    { label: "Dönem kazancı", value: money(c.periodResult), strong: true },
    ...(c.anchor ? [{ label: `Çapa: ${c.anchor.period.replace("-Q", "/")} muhasebeci kaydının matrahı`, value: money(c.anchor.matrah) }] : []),
    { label: "Kümülatif kurum kazancı", value: money(c.cumulative), strong: true },
    ...(c.loss ? [{ label: "Devreden zarar", value: money(-c.loss) }] : []),
    ...(c.indirim ? [{ label: "İndirim", value: money(-c.indirim) }] : []),
    { label: "Matrah", value: money(c.matrah) },
    { label: "Hesaplanan (× %25)", value: money(c.hesaplanan) },
    { label: "Asgari kurumlar vergisi", value: c.asgari === null ? "uygulanmaz" : money(c.asgari) },
    { label: "Önceki dönemler", value: money(-c.previous) },
    { label: "Kafenin katkısı", value: money(c.estimate), strong: true },
  ];
  return (
    <Card>
      <CardHeader
        icon={<Landmark />}
        title={card.title}
        description={card.periodLine}
        actions={card.badge ? <Badge tone={STATE_TONE[card.badge as keyof typeof STATE_TONE] ?? "gray"}>{card.badge}</Badge> : null}
      />
      <CardContent className="space-y-4">
        <div>
          <p className={cn("font-semibold tracking-tight text-ink tabular", card.state === "taslak" && !c.filing ? "text-base leading-6" : "text-2xl")}>{card.headline}</p>
          {card.subline ? <p className="mt-1 text-[13px] leading-5 text-ink-mute">{card.subline}</p> : null}
          {card.state === "taslak" && !c.filing ? (
            <ButtonLink href="/panel/vergi/gelir-gider#siniflandir" size="sm" variant="primary" className="mt-3">
              Giderleri sınıflandır
            </ButtonLink>
          ) : null}
        </div>
        <DetailList rows={card.rows} />
        <NoteList notes={card.notes} />
        <p className="text-[13px] leading-5 text-ink-soft">{card.footer}</p>
        <div className="flex flex-wrap gap-2">
          <FilingButton data={filing} period={card.key} />
          <ButtonLink href={`/panel/vergi/gelir-gider?ceyrek=${card.key}`} size="sm">
            Vergiye göre&apos;yi aç
          </ButtonLink>
        </div>
        <Explain>
          <DetailList rows={calcRows} />
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-ink-soft">Alt sınır</p>
            <p className="text-xs leading-5 text-ink-mute">
              Sınıflandırılmamış kalemler belgeli, demirbaş adayları gider, varlık listesine eklenmemiş Kuruluş &amp; Demirbaş faturaları ve ömrü girilmemiş varlıkların maliyeti tamamen gider sayılsaydı.
              Kesin bir sınır değil; ekranın başlığına yazılmaz.
            </p>
            <DetailList rows={floorRows} />
          </div>
          <RuleRefList refs={rules} />
        </Explain>
      </CardContent>
    </Card>
  );
}

/** Kurumlar vergisi (yıl) · kafenin katkısı */
export function KvCardView({ card, filing, rules }: { card: KvCard; filing: FilingKindData; rules: RuleRef[] }) {
  const k = card.calc;
  const calcRows = [
    { label: k.filing ? "Kurum kazancı (muhasebecinin kaydı)" : "Kümülatif kurum kazancı", value: money(k.income) },
    ...(k.carried ? [{ label: "Önceki yıllardan devreden zarar", value: money(k.carried) }] : []),
    ...(k.loss ? [{ label: "Düşülen zarar", value: money(-k.loss) }] : []),
    ...(k.indirim ? [{ label: "İndirim", value: money(-k.indirim) }] : []),
    { label: "Matrah", value: money(k.matrah) },
    { label: "Hesaplanan", value: money(k.hesaplanan) },
    { label: "Asgari kurumlar vergisi", value: k.asgari === null ? "uygulanmaz" : money(k.asgari) },
    { label: "Kurumlar vergisi", value: money(k.tax), strong: true },
    ...k.paidQuarters.map((p) => ({ label: `Ödenen geçici vergi ${p.period.replace("-Q", "/")}`, value: money(-p.amount) })),
  ];
  return (
    <Card>
      <CardHeader
        icon={<Building2 />}
        title={card.title}
        description={card.subtitle ?? undefined}
        actions={card.badge ? <Badge tone={STATE_TONE[card.badge as keyof typeof STATE_TONE] ?? "gray"}>{card.badge}</Badge> : null}
      />
      <CardContent className="space-y-4">
        <DetailList rows={card.rows} />
        <NoteList notes={card.notes} />
        <p className="text-[13px] leading-5 text-ink-soft">{card.footer}</p>
        <div className="flex flex-wrap gap-2">
          <FilingButton data={filing} period={String(card.year)} />
        </div>
        <Explain>
          <DetailList rows={calcRows} />
          <RuleRefList refs={rules} />
        </Explain>
      </CardContent>
    </Card>
  );
}

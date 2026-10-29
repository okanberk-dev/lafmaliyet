import { BookOpenCheck, CircleSlash, MessagesSquare, Settings2 } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/misc";
import { money } from "@/lib/format";
import { todayTR } from "@/lib/reminders";
import { ACCOUNTANT_CHECKS, accountantCheck, checkDoneText, checksChipText, checkStatus } from "@/lib/tax/checks";
import { allRules, INFO_STATUS_LABELS, overrideAllowed, overrideText, RULE_GROUPS, RULES_CHECK_NOTE, RULES_COMPILED_AT, rulesCompiledText, rulesFor, rulesStaleNotes, ruleValueText } from "@/lib/tax/rules";
import { requireAdmin } from "@/server/auth/dal";
import { loadTaxSettings } from "@/server/data/tax";

import { type BannerData, ConfidenceBadge, DisclaimerBody, SourceLinks, TaxBanner, VergiHeader } from "../ui";
import { ChecksList } from "./checks-list";
import { OverrideButton, type OverrideRule } from "./override-dialog";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Muhasebeci" };

const TITLE = "Muhasebeci";
const DESCRIPTION = "Vergi ayarları, muhasebecinize sorulacaklar ve hesabın kullandığı Türkiye kuralları: değer, dayanak, güven ve kaynak.";

export default function TaxRulesPage() {
  return (
    <Suspense
      fallback={
        <>
          <VergiHeader current="/panel/vergi/kurallar" title={TITLE} description={DESCRIPTION} />
          <PageSkeleton rows={10} />
        </>
      }
    >
      <TaxRulesContent />
    </Suspense>
  );
}

const dmy = (d: string) => d.split("-").reverse().join(".");

/**
 * Vergi › Kurallar (plan docs/planlar/vergi.md §4.4): ayarlar, muhasebeciye sorulacaklar, kural tablosu ve bu kafede
 * hesaplanmayanlar. Yalnız vergi ayarlarını okur (K30): model ve nakit planı yok.
 */
async function TaxRulesContent() {
  await requireAdmin();
  const settings = await loadTaxSettings();
  const today = todayTR();
  const year = Number(today.slice(0, 4));
  const r = rulesFor(year, settings.overrides);
  const checks = checkStatus(settings);
  const banner: BannerData = {
    compiled: rulesCompiledText(r.fromYear),
    stale: rulesStaleNotes(today, [year]),
    scope: null,
    checks: { chip: checksChipText(checks), allDone: checks.allDone },
  };
  const support = r.rules.sgk.asgariUcretDestegi.value;
  const supportTip = `Kişi başına günlük ${money(support)} (30 günde ${money(Math.round(support * 30 * 100) / 100)}); emekli çalışanda yok. Şartları muhasebecinize sorun (Muhasebeciye sorulacaklar › Asgari ücret desteği).`;
  const checkRows = ACCOUNTANT_CHECKS.map((c) => {
    const mark = settings.checks[c.key];
    return { key: c.key, priority: c.priority, title: c.title, assumed: c.assumed, ask: c.ask, done: mark ? checkDoneText(mark) : null, note: mark?.note ?? null };
  });

  return (
    <>
      <VergiHeader current="/panel/vergi/kurallar" title={TITLE} description={DESCRIPTION} />
      <TaxBanner data={banner} />
      <div className="space-y-6">
        <DisclaimerBody data={banner} />
        <Card>
          <CardHeader icon={<Settings2 />} title="Vergi ayarları" description="Hesabın varsayımları; değişince bütün vergi sayfaları ve nakit planı yeniden hesaplanır." />
          <CardContent>
            <SettingsForm
              today={today}
              supportTip={supportTip}
              data={{
                periodStart: settings.periodStart,
                firstActivity: settings.firstActivity,
                quarterDepreciation: settings.quarterDepreciation,
                muhtasarQuarterly: settings.muhtasarQuarterly,
                minWageSupport: settings.minWageSupport,
                includeSeparate: settings.includeSeparate,
              }}
            />
          </CardContent>
        </Card>

        <Card id="sorular" className="scroll-mt-20">
          <CardHeader
            icon={<MessagesSquare />}
            title="Muhasebeciye sorulacaklar"
            description="Bölüme güvenmeden önce muhasebecinizle bir kez gözden geçirin. İşaret sizindir; muhasebecinin tabloyu onayladığı anlamına gelmez."
            meta={checksChipText(checks)}
          />
          <CardContent>
            <ChecksList rows={checkRows} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader icon={<BookOpenCheck />} title={`Kural tablosu (${r.fromYear})`} description={`Derlendi: ${dmy(RULES_COMPILED_AT)}. ${RULES_CHECK_NOTE}`} />
          <CardContent className="space-y-5">
            {r.estimated ? <p className="text-[13px] font-medium text-warn">{year} kuralları tabloda yok; {r.fromYear} değerleri kullanılıyor (tahmini).</p> : null}
            {RULE_GROUPS.map((g) => {
              const rules = allRules(r.rules).filter((x) => x.key === g.key || x.key.startsWith(`${g.key}.`));
              if (!rules.length) return null;
              return (
                <section key={g.key} aria-label={g.title}>
                  <h3 className="mb-2 text-[13px] font-semibold text-ink-soft">{g.title}</h3>
                  <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
                    {rules.map((rule) => {
                      const editable = rule.overridable && typeof rule.value === "number" && overrideAllowed(rule, rule.value, r.estimated);
                      const over = overrideText(rule);
                      const data: OverrideRule | null = editable
                        ? {
                            key: rule.key,
                            title: rule.title,
                            unit: rule.unit === "oran" ? "oran" : "tl",
                            value: rule.value as number,
                            table: (rule.override?.table ?? rule.value) as number,
                            overridden: Boolean(rule.override),
                            note: rule.override?.note ?? null,
                            max: rule.overrideMax ?? null,
                          }
                        : null;
                      return (
                        <li key={rule.key} className="space-y-1 px-4 py-3">
                          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                            <p className="min-w-0 text-sm leading-5 font-medium break-words text-ink">{rule.title}</p>
                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                              {rule.fixedAmount ? <Badge tone="gray">sabit tutar</Badge> : null}
                              <ConfidenceBadge confidence={rule.confidence} />
                              {data ? <OverrideButton rule={data} /> : null}
                            </div>
                          </div>
                          <p className="text-sm leading-5 break-words text-ink tabular">{ruleValueText(rule)}</p>
                          {over ? <p className="text-[13px] leading-5 break-words text-warn">{over}</p> : null}
                          <p className="text-[13px] leading-5 break-words text-ink-mute">{rule.basis}</p>
                          {rule.note ? <p className="text-xs leading-5 break-words text-ink-mute">{rule.note}</p> : null}
                          {rule.confirm ? <p className="text-xs leading-5 text-ink-soft">Muhasebecinize sorun: {accountantCheck(rule.confirm).title}</p> : null}
                          <SourceLinks sources={rule.sources} />
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </CardContent>
        </Card>

        <Card id="bilgi" className="scroll-mt-20">
          <CardHeader icon={<CircleSlash />} title="Bu kafede hesaplanmayanlar" description="Panelin hesaplamadığı vergiler ve kurallar; durumu ve kaynağıyla." />
          <CardContent>
            <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
              {r.rules.bilgi.map((b) => (
                <li key={b.key} className="space-y-1 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <p className="min-w-0 text-sm leading-5 font-medium break-words text-ink">{b.title}</p>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Badge tone={b.status === "sorulacak" ? "amber" : "gray"}>{INFO_STATUS_LABELS[b.status]}</Badge>
                      <ConfidenceBadge confidence={b.confidence} />
                    </div>
                  </div>
                  <p className="text-[13px] leading-5 break-words text-ink-soft">{b.text}</p>
                  <p className="text-xs leading-5 break-words text-ink-mute">
                    {b.basis}
                    {b.confidenceNote ? ` · ${b.confidenceNote}` : ""}
                  </p>
                  {b.confirm ? <p className="text-xs leading-5 text-ink-soft">Muhasebecinize sorun: {accountantCheck(b.confirm).title}</p> : null}
                  <SourceLinks sources={b.sources} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

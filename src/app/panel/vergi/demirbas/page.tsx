import { Boxes, FileWarning, PackageSearch } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { CompanyWideNotice } from "@/components/panel/company-wide-notice";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageSkeleton, Stat } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { ALL_BRANCHES } from "@/lib/branches";
import { dateTR, money } from "@/lib/format";
import { ASSET_KIND_LABELS, ASSET_METHOD_LABELS, assetRows, lifeMissingText, lineAssetCandidates, parseInvoiceLabel, QUARTER_DEPRECIATION_LABELS } from "@/lib/tax/assets";
import { quarterLabel } from "@/lib/tax/calendar";
import { rulesFor } from "@/lib/tax/rules";
import { requireCan } from "@/server/auth/dal";
import { loadModel } from "@/server/data/dataset";
import { withBranchScope } from "@/server/branch-scope";
import { loadTaxView } from "@/server/data/tax";

import { DirectExpenseButton, NotAssetButton } from "../asset-actions";
import { type AssetData, AssetButton } from "../asset-dialog";
import { RelinkButton } from "../relink-button";
import { invoiceChoices } from "../dialog-data";
import { PeriodPicker } from "../period-picker";
import { type BannerData, DetailList, NoteNotice, TaxBanner, VergiHeader } from "../ui";

export const metadata: Metadata = { title: "Demirbaş" };

const TITLE = "Demirbaş";
const DESCRIPTION = "Makine, mobilya gibi yıllarca kullanılan alımlar; gideri yıllara bölünür (amortisman).";
// Eski uzun açıklama: başlıktaki ⓘ "Nasıl çalışır?" (docs/planlar/ux-sade.md §8)
const MORE =
  "Demirbaş listesi ve amortisman (KDV hariç). Bir demirbaşa bağlanan fatura tutarı gider yerine amortismanla düşülür; ömür girilmeyen demirbaşa amortisman ayrılmaz.";

export default function TaxAssetsPage({ searchParams }: PageProps<"/panel/vergi/demirbas">) {
  return (
    <Suspense
      fallback={
        <>
          <VergiHeader current="/panel/vergi/demirbas" title={TITLE} description={DESCRIPTION} more={MORE} />
          <PageSkeleton rows={8} />
        </>
      }
    >
      <TaxAssetsContent searchParams={searchParams} />
    </Suspense>
  );
}

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Vergi, KDV, SGK › Demirbaş (plan docs/planlar/vergi.md §4.3, K14; docs/planlar/ux-sade.md §7.8): demirbaş listesi,
 * listeye eklenmemiş Kuruluş & Demirbaş faturaları, "demirbaş olabilir" faturalar ve faturası Paraşüt'te silinen
 * demirbaşlar. Ekranda "varlık" yerine "demirbaş" (yalnız söz; veri ve dışa aktarım aynı). Nakit planını okumaz (K30).
 */
async function TaxAssetsContent({ searchParams }: { searchParams: PageProps<"/panel/vergi/demirbas">["searchParams"] }) {
  // Yönetici ve muhasebeci (salt okunur; docs/ROLLER.md): muhasebecinin yazma denemesini eylemler reddeder
  await requireCan("muhasebe.oku");
  const sp = await searchParams;
  const rawYear = pick(sp.yil);
  // Vergi şubeye bölünmez (sahibin kararı 27 Kasım 2026; docs/SUBE.md › Şube ayrımı): demirbaşlar, amortisman ve
  // demirbaş adayları şube seçiliyken de bütün şubelerin faturalarıyla (tek vergi numarası)
  // şube-ayrımı: vergi.beyan
  const { model, view, inputs } = await withBranchScope(ALL_BRANCHES, async () => {
    const model = await loadModel();
    return { model, ...(await loadTaxView(model, { year: rawYear && /^\d{4}$/.test(rawYear) ? Number(rawYear) : null, cashPlan: null })) };
  });
  const { settings, assets } = inputs;
  const year = view.year;
  const today = view.today;
  const banner: BannerData = {
    compiled: view.rulesInfo.compiled,
    stale: view.rulesInfo.stale,
    scope: { text: view.scope.text, hint: view.scope.hint },
    checks: { chip: view.checks.chip, allDone: view.checks.allDone },
  };
  const rows = assetRows(assets, year, settings);
  const choices = invoiceChoices(model.ds.invoices, assets, today);
  // "Hammadde değil · Demirbaş" denmiş kalemler (öneri; sahip ekler)
  const lineCandidates = lineAssetCandidates(model.ds.invoices, assets);
  const directLimit = rulesFor(year).rules.vuk.dogrudanGider.value;
  const lifeless = assets.filter((a) => a.method === "amortisman" && !a.lifeYears);
  const missingLife = lifeless.length;
  // Yılın amortismanı yalnız amortismana tabi varlıklardan; doğrudan gider yazılanlar (VUK 313) ayrı yazılır
  const depreciable = (r: (typeof rows)[number]) => r.asset.method === "amortisman";
  const totals = {
    cost: rows.reduce((s, r) => s + r.asset.cost, 0),
    year: rows.filter(depreciable).reduce((s, r) => s + r.thisYear, 0),
    direct: rows.filter((r) => !depreciable(r)).reduce((s, r) => s + r.thisYear, 0),
    net: rows.reduce((s, r) => s + r.netValue, 0),
  };
  const method = QUARTER_DEPRECIATION_LABELS[settings.quarterDepreciation];
  const assetData = (a: (typeof assets)[number]): AssetData => ({
    id: a.id,
    name: a.name,
    invoiceId: a.invoiceId,
    acquiredOn: a.acquiredOn,
    cost: a.cost,
    kind: a.kind,
    method: a.method,
    lifeYears: a.lifeYears,
    note: a.note ?? null,
  });
  const actions =
    view.yearOptions.length >= 2 ? <PeriodPicker param="yil" label="Yıl" value={String(year)} options={view.yearOptions.map((y) => ({ value: String(y), label: String(y) }))} /> : null;

  return (
    <>
      <VergiHeader current="/panel/vergi/demirbas" title={TITLE} description={DESCRIPTION} more={MORE} actions={actions} />
      <TaxBanner data={banner} />
      <div className="space-y-6">
        {/* Şube seçiliyken: vergi firmanın, şubeye bölünmez (sahibin kararı 27 Kasım 2026) */}
        <CompanyWideNotice screen="vergi" />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          <Stat compact label="Demirbaşlar (maliyet)" value={money(totals.cost)} sub={`${assets.length} demirbaş`} />
          <Stat
            compact
            label={`${year} amortismanı`}
            value={money(totals.year)}
            sub={`Çeyreklere: ${method.toLocaleLowerCase("tr-TR")}${totals.direct ? ` · bu yıl gider yazılan ${money(totals.direct)} ayrı` : ""}`}
          />
          <Stat compact className="col-span-2 lg:col-span-1" label={`Net değer (${year} sonu)`} value={money(totals.net)} sub={missingLife ? `${missingLife} demirbaşın ömrü girilmedi` : null} tone={missingLife ? "warn" : "default"} />
        </div>

        {missingLife || view.orphans.length ? (
          <Card className="gap-3 p-5">
            {missingLife ? (
              // Ömür girilmeyen demirbaşa amortisman ayrılmaz, vergi yüksek çıkar: katlanmaz; eylem ilk demirbaşın düzenleme penceresi
              <NoteNotice
                notes={[lifeMissingText(missingLife)]}
                action={lifeless[0] ? <AssetButton label="Ömrü gir" size="xs" invoices={choices} asset={assetData(lifeless[0])} directLimit={directLimit} today={today} /> : undefined}
              />
            ) : null}
            {view.orphans.map((o) => {
              const label = parseInvoiceLabel(o.asset.invoiceLabel);
              return (
                <div key={o.asset.id} className="space-y-2">
                  {/* Faturası silinen demirbaş listede kalırsa yeni faturayla iki kez gider sayılır; bağlama düğmeleri aşağıda */}
                  <Notice tone="warn" size="sm" risk="hukuk" title={`${o.asset.name}: faturası silinmiş demirbaş`} text="Yeni faturaya bağlayın ya da listeden çıkarın; yoksa iki kez gider sayılır." />
                  <p className="pl-3 text-xs text-ink-mute">
                    Silinen fatura: {o.asset.invoiceLabel ?? "bilinmiyor"}
                    {o.doubleCounted ? ` · aday fatura şimdi gider sayılıyor: ${money(o.doubleCounted)} iki kez sayılabilir` : ""}
                  </p>
                  {o.candidates.length ? (
                    <ul className="space-y-2 pl-3">
                      {o.candidates.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-soft">
                          <span className="min-w-0 break-words">
                            {c.supplier} · {dateTR(c.date)} · {money(c.amount - c.discount)}
                          </span>
                          <RelinkButton asset={assetData(o.asset)} invoice={{ id: c.id, label: `${c.supplier} · ${dateTR(c.date)}` }} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="pl-3 text-xs text-ink-mute">{label ? `Aynı tedarikçiden (${label.supplier}) benzer tutarlı fatura yok; Düzenle'den başka bir faturaya bağlayın.` : "Düzenle'den yeni faturaya bağlayın."}</p>
                  )}
                </div>
              );
            })}
          </Card>
        ) : null}

        <Card>
          <CardHeader
            icon={<Boxes />}
            title="Demirbaş listesi"
            description="Satıra dokunun: edinme günü, tür, çeyrek payları ve birikmiş amortisman."
            meta={`${assets.length} demirbaş`}
            actions={<AssetButton label="Demirbaş ekle" variant="primary" invoices={choices} directLimit={directLimit} today={today} />}
          />
          <CardContent>
            {rows.length ? (
              <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
                <li aria-hidden="true" className="hidden grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] gap-3 px-4 py-2 text-xs font-semibold text-ink-soft lg:grid">
                  <span>Demirbaş</span>
                  <span className="text-right">Maliyet</span>
                  <span className="text-right">Ömür / yöntem</span>
                  <span className="text-right">{year} amortismanı</span>
                  <span className="text-right">Net değer</span>
                </li>
                {rows.map((r) => {
                  const a = r.asset;
                  const lifeText = a.method === "dogrudan_gider" ? "Bu yıl gider yazıldı" : a.lifeYears ? `${a.lifeYears} yıl` : "Ömür girilmedi";
                  const quarters = [...r.quarters].filter(([k]) => k.startsWith(`${year}-`));
                  return (
                    <li key={a.id}>
                      <details className="group/asset">
                        <summary className="grid cursor-pointer list-none grid-cols-2 gap-x-3 gap-y-1 px-4 py-3 outline-none select-none hover:bg-panel/40 focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-inset lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] lg:items-center [&::-webkit-details-marker]:hidden">
                          <span className="col-span-2 min-w-0 lg:col-span-1">
                            <span className="block text-sm leading-5 font-medium break-words text-ink">{a.name}</span>
                            <span className="block text-xs leading-4 break-words text-ink-mute">{a.invoiceLabel ?? "Faturasız"}</span>
                          </span>
                          <Cell label="Maliyet" value={money(a.cost)} />
                          <Cell label="Ömür / yöntem" value={lifeText} warn={a.method === "amortisman" && !a.lifeYears} />
                          <Cell label={`${year} amortismanı`} value={money(r.thisYear)} />
                          <Cell label="Net değer" value={money(r.netValue)} />
                        </summary>
                        <div className="space-y-3 border-t border-line px-4 pt-3 pb-4">
                          <DetailList
                            rows={[
                              { label: "Edinme günü", value: dateTR(a.acquiredOn) },
                              { label: "Tür", value: ASSET_KIND_LABELS[a.kind] },
                              { label: "Yöntem", value: a.method === "dogrudan_gider" ? "Bu yıl gider yazıldı" : ASSET_METHOD_LABELS[a.method] },
                              ...quarters.map(([k, v]) => ({ label: `${quarterLabel(k)} payı`, value: money(v) })),
                              { label: `Birikmiş (${year} sonuna)`, value: money(r.accumulated) },
                            ]}
                          />
                          {r.warning ? <NoteNotice notes={[r.warning]} /> : null}
                          {a.note ? <p className="text-xs text-ink-mute">Not: {a.note}</p> : null}
                          <AssetButton label="Düzenle" invoices={choices} asset={assetData(a)} directLimit={directLimit} today={today} />
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="rounded-2xl bg-surface px-4 py-5 text-center text-sm text-ink-mute ring-1 ring-line">Demirbaş listesi boş. Kuruluş &amp; Demirbaş faturalarını aşağıdan ekleyin.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            icon={<FileWarning />}
            title="Listeye eklenmemiş demirbaş faturaları"
            description="Kuruluş & Demirbaş kategorisindeki faturalar: listeye eklenene kadar ne gider ne amortisman sayılır."
            meta={view.classify.unlisted.length ? `${view.classify.unlisted.length} fatura` : undefined}
          />
          <CardContent>
            {view.classify.unlisted.length ? (
              <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
                {view.classify.unlisted.map((u) => (
                  <li key={u.invoiceId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm leading-5 font-medium break-words text-ink">{u.supplier}</p>
                      <p className="text-xs leading-4 text-ink-mute">
                        {dateTR(u.date)} · listede değil: {money(u.remaining)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <AssetButton label="Listeye ekle" invoices={choices} invoiceId={u.invoiceId} directLimit={directLimit} today={today} />
                      {u.remaining <= directLimit + 0.005 ? <DirectExpenseButton invoice={{ id: u.invoiceId, supplier: u.supplier, date: u.date, remaining: u.remaining }} /> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl bg-surface px-4 py-5 text-center text-sm text-ink-mute ring-1 ring-line">Bütün demirbaş faturaları listede.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            icon={<PackageSearch />}
            title="Demirbaş olabilir"
            description={`KDV hariç ${money(directLimit)}'yi aşan ve aynı tedarikçiden 90 günde ilk fatura: karar verilene kadar gider sayılmaz.`}
            meta={view.classify.candidates.length ? `${view.classify.candidates.length} fatura` : undefined}
          />
          <CardContent>
            {view.classify.candidates.length ? (
              <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
                {view.classify.candidates.map((c) => (
                  <li key={c.invoice.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm leading-5 font-medium break-words text-ink">{c.invoice.supplier}</p>
                      <p className="text-xs leading-4 break-words text-ink-mute">
                        {dateTR(c.invoice.date)} · {c.invoice.category} · {money(c.net)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <AssetButton label="Listeye ekle" invoices={choices} invoiceId={c.invoice.id} directLimit={directLimit} today={today} />
                      <NotAssetButton invoice={{ id: c.invoice.id, supplier: c.invoice.supplier }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl bg-surface px-4 py-5 text-center text-sm text-ink-mute ring-1 ring-line">Demirbaş olabilecek fatura yok.</p>
            )}
          </CardContent>
        </Card>

        {lineCandidates.length ? (
          <Card>
            <CardHeader
              icon={<PackageSearch />}
              title="Demirbaş denen kalemler"
              description="Paraşüt'te “Hammadde değil · Demirbaş” denmiş kalemi olan faturalar (ör. hammadde faturasındaki ısıtıcı). Listeye ekleyene kadar gider sayılır."
              meta={`${lineCandidates.length} fatura`}
            />
            <CardContent>
              <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
                {lineCandidates.map((c) => (
                  <li key={c.invoice.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm leading-5 font-medium break-words text-ink">{c.invoice.supplier}</p>
                      <p className="text-xs leading-4 break-words text-ink-mute">
                        {dateTR(c.invoice.date)} · {c.invoice.category} · demirbaş kalemleri {money(c.net)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <AssetButton label="Listeye ekle" invoices={choices} invoiceId={c.invoice.id} directLimit={directLimit} today={today} />
                      <NotAssetButton invoice={{ id: c.invoice.id, supplier: c.invoice.supplier }} />
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <Card className="p-5">
          <ul className="space-y-1.5 text-[13px] leading-5 text-ink-mute">
            <li className="flex flex-wrap items-center gap-2">
              <Badge tone="gray">Özel maliyet</Badge>
              Kiralanan yere yapılan dekorasyon özel maliyettir; ömrü kira süresine bağlıdır. Muhasebecinize sorun.
            </li>
            <li>Yatırımlar listesi (Giderler &amp; maaşlar) bilgi amaçlıdır ve vergiye girmez; vergide bu liste esastır.</li>
            <li>Geçici vergide amortisman: {method.toLocaleLowerCase("tr-TR")} (Muhasebeci › Şirketin vergi ayarları).</li>
          </ul>
        </Card>
      </div>
    </>
  );
}

function Cell({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <span className="min-w-0 lg:text-right">
      <span className="block text-[11px] leading-4 text-ink-mute lg:hidden">{label}</span>
      <span className={warn ? "text-sm font-medium text-warn" : "text-sm text-ink tabular"}>{value}</span>
    </span>
  );
}

"use client";

import {
  Activity,
  ArrowDown,
  ArrowUp,
  Bell,
  ClipboardList,
  Coffee,
  Droplets,
  ExternalLink,
  FileText,
  History,
  Package,
  Percent,
  Plus,
  PlugZap,
  QrCode,
  Receipt,
  Ruler,
  Save,
  Settings as SettingsIcon,
  Tags,
  Trash2,
  Undo2,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useDeferredValue, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { ActivityItem, ActivityList } from "@/components/ui/activity";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink, IconButton } from "@/components/ui/button";
import { CardContent, Well } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { clearQuery, FilterBar, fold, matches, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { FloatingBar } from "@/components/ui/floating-bar";
import { Field, Input, NumberInput, Select } from "@/components/ui/form";
import { type PastelTone } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { Pagination, usePaged } from "@/components/ui/pagination";
import { ToggleRow } from "@/components/ui/toggle-row";
import type { WaterCost } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import type { Settings } from "@/lib/calc/types";
import { monthLabel, num, pct, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteCategory, saveCategories } from "@/server/actions/products";
import { saveSettings } from "@/server/actions/settings";

import { ALL_FIELDS, isClean, MEASURE_FIELDS, parseField, problemOf, RATE_FIELDS, shown, textsOf, toText, waterText, type FieldDef, type NumericKey } from "./fields";
import { changed, impactModel, settingsImpact, type Change, type ImpactData, type SettingsImpact } from "./impact";
import { revealSettingsField, SectionCard } from "./section-card";
import { categoriesSummary, logSummary, measuresSummary, ratesSummary, waterSummary } from "./summaries";
import { waterSource } from "./water-text";

/** Alanın bulunduğu bölüm (telefonda kapalı bölümdeki hatalı alana gitmek için) */
const sectionOf = (key: NumericKey) => (RATE_FIELDS.some((f) => f.key === key) ? "oranlar" : "olculer");


// ---------------------------------------------------------------- Hesap ayarları

type Out = Partial<Record<keyof Settings, number | boolean | null>>;
type SettingsInput = Parameters<typeof saveSettings>[0];

/**
 * Oranlar, reçete ölçüleri, su maliyeti ve QR menü tek bir kayıtla saklanır (saveSettings).
 * Değişiklik olunca altta yüzen çubuk açılır: kaydetmeden önce etkisi (durumu değişen ürünler, maliyet oranı,
 * brüt kâr, başabaş) orada görünür. Yalnızca değişen alanlar gönderilir; kayıttan sonra bildirimdeki "Geri al"
 * önceki değerleri olduğu gibi geri yazar. Bir alandayken Enter da kaydeder.
 */
export function SettingsForm({ settings, water, data }: { settings: Settings; water: WaterCost; data: ImpactData }) {
  const [vals, setVals] = useState<Record<NumericKey, string>>(() => textsOf(settings));
  const [fireEx, setFireEx] = useState(settings.fireExcludesPackaging);
  const [publicMenu, setPublicMenu] = useState(settings.publicMenu);
  const [waterOv, setWaterOv] = useState(waterText(settings.suBirimLTOverride));
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);
  // Kayıt, geri alma ya da başka bir sekmedeki değişiklikten sonra sunucudan yeni ayarlar gelir: el değmemiş alanlar
  // yeni değeri alır, yazılmakta olanlar korunur
  const [synced, setSynced] = useState(settings);
  if (synced !== settings) {
    const old = synced;
    setSynced(settings);
    setVals((v) => {
      const next = { ...v };
      for (const f of ALL_FIELDS) {
        if (isClean(v[f.key], toText(Number(old[f.key]), f.kind), Number(old[f.key]), f.kind)) next[f.key] = toText(Number(settings[f.key]), f.kind);
      }
      return next;
    });
    if (fireEx === old.fireExcludesPackaging) setFireEx(settings.fireExcludesPackaging);
    if (publicMenu === old.publicMenu) setPublicMenu(settings.publicMenu);
    if (isClean(waterOv, waterText(old.suBirimLTOverride), old.suBirimLTOverride)) setWaterOv(waterText(settings.suBirimLTOverride));
  }

  const base = textsOf(settings);
  const changedFields = ALL_FIELDS.filter((f) => !isClean(vals[f.key], base[f.key], Number(settings[f.key]), f.kind));
  const waterChanged = !isClean(waterOv, waterText(settings.suBirimLTOverride), settings.suBirimLTOverride);
  const dirty = changedFields.length > 0 || fireEx !== settings.fireExcludesPackaging || publicMenu !== settings.publicMenu || waterChanged;
  // Okunamayan ya da sınır dışı alan anında işaretlensin (kaydetmeyi beklemeden)
  const problem = (f: FieldDef) => problemOf(f, vals[f.key]);
  const waterValue = waterOv.trim() === "" ? null : parseNumberTR(waterOv);
  const waterInvalid = waterOv.trim() !== "" && (waterValue === null || waterValue < 0);

  // Önizleme: kaydedilmemiş (geçerli) değerlerle hesaplama motoru tarayıcıda yeniden çalışır
  const draft: Settings = { ...settings, fireExcludesPackaging: fireEx };
  for (const f of changedFields) {
    const v = parseField(vals[f.key], f.kind);
    if (v !== null && !problem(f)) draft[f.key] = v;
  }
  if (waterChanged && !waterInvalid) draft.suBirimLTOverride = waterValue;
  const draftKey = JSON.stringify(draft);
  const deferredKey = useDeferredValue(draftKey);
  const baseModel = useMemo(() => impactModel(data), [data]);
  const impact = useMemo(() => {
    const next = JSON.parse(deferredKey) as Settings;
    const calcKeys = (st: Settings) => JSON.stringify({ ...st, publicMenu: false });
    if (calcKeys(next) === calcKeys(data.settings)) return null;
    return settingsImpact(baseModel, impactModel(data, next));
  }, [deferredKey, baseModel, data]);
  const invalidCount = changedFields.filter((f) => problem(f)).length + (waterChanged && waterInvalid ? 1 : 0);

  function reset() {
    setVals(textsOf(settings));
    setFireEx(settings.fireExcludesPackaging);
    setPublicMenu(settings.publicMenu);
    setWaterOv(waterText(settings.suBirimLTOverride));
    setDetails(false);
  }

  /** Yalnızca değişen alanlar gönderilir: dokunulmayan oranlar ekrandaki yuvarlanmış metinden yeniden yazılmaz */
  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!dirty) return void toast("Değişiklik yok", { description: "Kaydedilecek yeni bir değer girilmedi." });
    const out: Out = {};
    for (const f of changedFields) {
      const err = problem(f);
      if (err) {
        revealSettingsField(sectionOf(f.key), `s-${f.key}`);
        return void toast.error(`${f.label}: ${err}`);
      }
      out[f.key] = parseField(vals[f.key], f.kind);
    }
    if (fireEx !== settings.fireExcludesPackaging) out.fireExcludesPackaging = fireEx;
    if (publicMenu !== settings.publicMenu) out.publicMenu = publicMenu;
    if (waterChanged) {
      // Boş = otomatik; yazılmış ama okunamayan değer sessizce "otomatik"e dönmesin
      if (waterInvalid) {
        revealSettingsField("su", "s-water");
        return void toast.error("Elle birim maliyet: geçerli bir sayı girin ya da boş bırakın");
      }
      out.suBirimLTOverride = waterValue;
    }
    // Geri al için kayıtlı (yuvarlanmamış) önceki değerler
    const previous: Out = {};
    for (const k of Object.keys(out) as (keyof Settings)[]) previous[k] = settings[k];
    setBusy(true);
    const res = await saveSettings(out as SettingsInput);
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    setDetails(false);
    if (!res.data.changes.length) return void toast("Değişiklik yok", { description: "Değerler zaten kayıtlıydı." });
    toast.success("Ayarlar kaydedildi; bütün hesaplar güncellendi", {
      description: res.data.changes.join(" · "),
      duration: 15_000,
      action: {
        label: "Geri al",
        onClick: async () => {
          const back = await saveSettings(previous as SettingsInput);
          if (back.ok) toast.success("Önceki değerler geri yüklendi", { description: back.data.changes.join(" · ") || undefined });
          else toast.error(back.error);
        },
      },
    });
  }

  const field = (f: FieldDef) => {
    const err = problem(f);
    const changed = changedFields.includes(f);
    const v = parseField(vals[f.key], f.kind);
    return (
      <Field
        key={f.key}
        label={`${f.label}${f.kind === "pct" ? " (%)" : ""}`}
        tip={f.formula ? `Reçete formüllerinde ${f.formula} adıyla kullanılır; değiştirince ${f.formula} geçen bütün reçeteler güncellenir.` : undefined}
        hint={
          changed && v !== null ? (
            <span className="text-warn">
              Yeni: <strong className="font-semibold tabular">{shown(v, f)}</strong> · kayıtlı {shown(Number(settings[f.key]), f)}
            </span>
          ) : f.assumption ? (
            // Excel'deki sarı "VARSAYIM" hücresi
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <Badge tone="amber" dot title="Excel'de sarı işaretli varsayım: gerçek değeri ölçüp yazın">
                Varsayım
              </Badge>
              {f.hint.replace(/^Varsayım:\s*/, "")}
            </span>
          ) : (
            f.hint
          )
        }
        error={err ?? undefined}
        htmlFor={`s-${f.key}`}
      >
        <div className="relative">
          <NumberInput
            id={`s-${f.key}`}
            // Gün sayısı tam sayı: telefonda ondalık ayırıcısız rakam tuş takımı
            inputMode={f.kind === "int" ? "numeric" : "decimal"}
            value={vals[f.key]}
            onChange={(e) => setVals((x) => ({ ...x, [f.key]: e.target.value }))}
            onKeyDown={(e) => {
              // Esc alanı kayıtlı değere döndürür
              if (e.key === "Escape" && changed) {
                e.preventDefault();
                setVals((x) => ({ ...x, [f.key]: base[f.key] }));
              }
            }}
            aria-invalid={err ? true : undefined}
            data-warn={(changed && !err) || undefined}
            className={cn("cell-input", f.kind === "pct" && "pr-7")}
          />
          {f.kind === "pct" ? (
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-mute" aria-hidden="true">
              %
            </span>
          ) : null}
        </div>
      </Field>
    );
  };

  const summary = impact ? impactSummary(impact) : null;
  const dirtyIn = (fields: FieldDef[]) => fields.some((f) => changedFields.includes(f));

  return (
    <form id="settings-form" onSubmit={save} data-dirty={dirty || undefined} className="space-y-4">
      <SectionCard
        id="oranlar"
        icon={<Percent />}
        title="Oranlar"
        description="Menü fiyatları KDV dahil; maliyetler KDV hariç (alışta ödenen KDV indirilebildiği için). Önerilen fiyat hedef maliyet oranına göre hesaplanır. Yüzdeleri sayı olarak yazın: %10 için 10."
        summary={ratesSummary(settings)}
        dirty={dirtyIn(RATE_FIELDS) || fireEx !== settings.fireExcludesPackaging}
      >
        <CardContent className="space-y-4">
          <div className="grid gap-4 @lg:grid-cols-2 @3xl:grid-cols-3">{RATE_FIELDS.map(field)}</div>
          <ToggleRow
            title="Fireyi ambalaja (bardak, kapak, peçete) uygulama"
            tip="Excel formülü fireyi ambalaj dahil uyguluyordu; notu ise hariç diyordu."
            description={fireEx ? "Fire yalnızca malzemelere eklenir." : "Fire ambalaj dahil bütün reçeteye eklenir."}
            label="Fireyi ambalaja uygulama"
            onText="Ambalaja uygulanmıyor"
            offText="Ambalaja uygulanıyor"
            checked={fireEx}
            onChange={setFireEx}
          />
        </CardContent>
      </SectionCard>

      <SectionCard
        id="olculer"
        icon={<Ruler />}
        title="Reçete ölçüleri"
        description="Reçetelerde formülle bağlı miktarlar (ShotTek, Pompa …) ve ayda açık gün sayısı. Değiştirince bağlı bütün reçeteler ve hesaplar güncellenir. Varsayım işaretli değerleri ölçüp yazın."
        summary={measuresSummary(settings)}
        dirty={dirtyIn(MEASURE_FIELDS)}
      >
        <CardContent className="grid gap-4 @lg:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4">{MEASURE_FIELDS.map(field)}</CardContent>
      </SectionCard>

      <div className="grid gap-4 @3xl:grid-cols-2">
        <SectionCard
          id="su"
          icon={<Droplets />}
          title="Su + buz birim maliyeti"
          description="Reçetelerdeki su ve buzun litre maliyeti."
          summary={waterSummary(water)}
          dirty={waterChanged}
        >
          <CardContent className="space-y-4">
            <Well className="ring-1 ring-line">
              <p className="flex items-center gap-1.5 text-[13px] text-ink-mute">
                Şu an
                <InfoTip text="Gelir-gider tablosunda SU GİDERİ girilmiş ve ürün satış listesi olan en son ayın faturası ÷ o ay reçetelere göre harcanan su + buz litresi. Excel her zaman Eylül'ü kullanır." />
              </p>
              <p className="mt-0.5 text-2xl font-semibold tracking-tight text-ink tabular">
                {tl(water.perLiter, 4)}
                <span className="ml-0.5 text-sm font-medium text-ink-mute">/L</span>
              </p>
              <p className={cn("mt-1 text-xs", water.reason === "no-usage" ? "text-warn" : "text-ink-mute")}>{waterSource(water)}</p>
            </Well>
            <Field
              label="Elle birim maliyet (₺/L)"
              hint={waterChanged && !waterInvalid ? <span className="text-warn">{waterValue === null ? "Kaydedince faturadan otomatik hesaplanır" : `Yeni: ${tl(waterValue, 4)} /L`}</span> : "Boş bırakırsanız su faturasından otomatik hesaplanır"}
              error={waterInvalid ? "Bir sayı girin ya da boş bırakın" : undefined}
              htmlFor="s-water"
            >
              <NumberInput
                id="s-water"
                value={waterOv}
                onChange={(e) => setWaterOv(e.target.value)}
                placeholder="otomatik"
                aria-invalid={waterInvalid || undefined}
                data-warn={(waterChanged && !waterInvalid) || undefined}
                className="cell-input"
              />
            </Field>
          </CardContent>
        </SectionCard>

        <SectionCard
          id="qr-menu"
          icon={<QrCode />}
          title="QR menü"
          description="laffogato.net/menu"
          summary={settings.publicMenu ? "Yayında · laffogato.net/menu" : "Yayında değil"}
          dirty={publicMenu !== settings.publicMenu}
          meta={
            <Badge dot tone={settings.publicMenu ? "green" : "gray"}>
              {settings.publicMenu ? "Yayında" : "Yayında değil"}
            </Badge>
          }
          actionsClassName="max-sm:w-full"
          actions={
            <ButtonLink href="/menu?onizleme=1" variant="secondary" target="_blank" prefetch={false} className="max-sm:w-full">
              <ExternalLink size={16} /> Önizle
            </ButtonLink>
          }
        >
          <CardContent className="space-y-4">
            <p className="text-[13px] leading-5 text-ink-mute">
              Ürün adları, boyları ve satış fiyatları herkese açık bir menü sayfasında yayınlanır. Maliyet ve kâr bilgisi asla gösterilmez. Ürün kartında &quot;QR menüde göster&quot; ile
              ürün bazında gizleyebilirsiniz.
            </p>
            <ToggleRow
              title="Menüyü yayınla"
              description={publicMenu ? "Kaydedince menü herkese açık olur." : "Kaydedince menü sayfası kapanır."}
              label="Menüyü yayınla"
              onText="Yayında"
              offText="Yayında değil"
              checked={publicMenu}
              onChange={setPublicMenu}
            />
          </CardContent>
        </SectionCard>
      </div>

      <FloatingBar open={dirty} className="max-w-3xl gap-y-2">
        {impact && details ? <ImpactDetails impact={impact} invalidCount={invalidCount} /> : null}
        <div className="flex min-w-0 flex-1 basis-56 items-center gap-2 text-[13px] text-ink-mute" aria-live="polite">
          <span className="size-2 shrink-0 rounded-full bg-warn" aria-hidden="true" />
          <span className="min-w-0">
            <span className="font-medium text-ink-soft">Kaydedilmedi</span>
            {invalidCount ? (
              <span className="text-bad max-sm:block">
                <span className="max-sm:hidden"> · </span>
                {num(invalidCount)} alan hatalı
              </span>
            ) : null}
            {summary ? (
              <span className="max-sm:block">
                <span className="max-sm:hidden"> · </span>
                {summary}
              </span>
            ) : null}
          </span>
        </div>
        <div className="flex flex-wrap gap-2 max-sm:w-full max-sm:[&>*]:flex-1">
          {impact ? (
            <Button variant="secondary" onClick={() => setDetails((d) => !d)} aria-expanded={details}>
              <Activity size={16} /> {details ? "Etkiyi gizle" : "Etkisi"}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={reset} disabled={busy}>
            <Undo2 size={16} /> Geri al
          </Button>
          <Button type="submit" form="settings-form" disabled={busy}>
            <Save size={16} /> {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </FloatingBar>
    </form>
  );
}

/** Çubuktaki tek satırlık özet: "3 ürünün durumu değişir · ort. maliyet %27,4 → %28,1" */
function impactSummary(i: SettingsImpact): string {
  if (!i.any) return "hesaplara etkisi yok";
  const parts: string[] = [];
  if (i.statusChanges.length) parts.push(`${num(i.statusChanges.length)} ürünün durumu değişir`);
  else if (i.costChanged) parts.push(`${num(i.costChanged)} ürünün maliyeti değişir`);
  if (changed(i.avgCostRatio)) parts.push(`ort. maliyet ${pct(i.avgCostRatio.before)} → ${pct(i.avgCostRatio.after)}`);
  else if (changed(i.breakEvenDaily, 0.5)) parts.push(`başabaş ${tl(i.breakEvenDaily.before)} → ${tl(i.breakEvenDaily.after)} /gün`);
  else if (!parts.length && i.suggestedChanged) parts.push(`${num(i.suggestedChanged)} ürünün önerilen fiyatı değişir`);
  return parts.join(" · ") || "hesaplar değişir";
}

function Delta({ c, format, goodWhenUp }: { c: Change; format: (v: number) => string; goodWhenUp?: boolean }) {
  const up = c.after > c.before;
  // Ekranda aynı görünen fark (kuruş altı) "değişmez" sayılır
  if (format(c.before) === format(c.after))
    return (
      <span className="tabular whitespace-nowrap text-ink-mute">
        {format(c.before)} <span className="text-ink-quiet">· değişmez</span>
      </span>
    );
  const tone = up === Boolean(goodWhenUp) ? "text-good" : "text-bad";
  return (
    <span className="tabular whitespace-nowrap">
      <span className="text-ink-mute">{format(c.before)}</span>
      <span className="px-1 text-ink-quiet" aria-hidden="true">
        →
      </span>
      <span className="sr-only"> yeni değer </span>
      <span className={cn("font-semibold", tone)}>{format(c.after)}</span>
    </span>
  );
}

const STATUS_CHIPS = 6;

/** Kaydetmeden önceki etki: ürün durumları, maliyet oranı, son ay brüt kâr, başabaş, sabit gider, su */
function ImpactDetails({ impact: i, invalidCount }: { impact: SettingsImpact; invalidCount: number }) {
  const rows: { label: string; tip?: string; value: ReactNode }[] = [
    {
      label: "Durumu değişen ürün",
      value: (
        <span className="tabular">
          <strong className="font-semibold text-ink">{num(i.statusChanges.length)}</strong> / {num(i.products)}
        </span>
      ),
    },
    { label: "Maliyeti değişen ürün", value: num(i.costChanged) },
    { label: "Önerilen fiyatı değişen ürün", value: num(i.suggestedChanged) },
    {
      label: "Ortalama maliyet oranı",
      tip: "Aktif, reçeteli ürünlerin maliyet ÷ KDV hariç fiyat ortalaması (Ürün Kârlılık).",
      value: <Delta c={i.avgCostRatio} format={(v) => pct(v)} />,
    },
  ];
  if (i.grossProfit && i.month)
    rows.push({
      label: `${monthLabel(i.month)} brüt kâr`,
      tip: "O ayın ürün satış listesine göre: KDV hariç ciro − reçete maliyeti − POS komisyonu.",
      value: <Delta c={i.grossProfit} format={(v) => tl(v)} goodWhenUp />,
    });
  if (i.breakEvenDaily)
    rows.push({
      label: "Başabaş günlük ciro (bu ay)",
      tip: "Bu ayın standart sabit giderini karşılamak için gereken günlük KDV dahil ciro (son satış ayının brüt kâr oranıyla).",
      value: <Delta c={i.breakEvenDaily} format={(v) => tl(v)} />,
    });
  if (changed(i.fixedStandard, 0.5))
    rows.push({ label: "Aylık standart sabit gider", tip: "Günlük tanımlı giderler açık gün sayısıyla çarpılır.", value: <Delta c={i.fixedStandard} format={(v) => tl(v)} /> });
  if (changed(i.waterPerLiter)) rows.push({ label: "Su + buz ₺/L", value: <Delta c={i.waterPerLiter} format={(v) => tl(v, 4)} /> });

  return (
    <div className="max-h-[45vh] w-full min-w-0 basis-full overflow-x-hidden overflow-y-auto border-b border-line pr-2 pb-3 scroll-thin" role="region" aria-label="Değişikliğin etkisi">
      <p className="text-sm font-semibold text-ink">Kaydetmeden önce etkisi</p>
      <p className="text-xs text-ink-mute">
        Kaydedince bütün ekranlara (ürün kârlılığı, panel, gelir-gider) yansır.
        {invalidCount ? ` Hatalı ${num(invalidCount)} alan hesaba katılmadı.` : ""}
      </p>
      <dl className="mt-2 grid gap-x-6 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-line/70 py-1.5 text-[13px]">
            <dt className="flex min-w-0 items-center gap-1.5 text-ink-mute">
              {r.label}
              {r.tip ? <InfoTip text={r.tip} /> : null}
            </dt>
            <dd className="shrink-0 text-right text-ink">{r.value}</dd>
          </div>
        ))}
      </dl>
      {i.statusChanges.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Durumu değişen ürünler">
          {i.statusChanges.slice(0, STATUS_CHIPS).map((c) => (
            <li key={c.id} className="inline-flex items-center gap-1.5 rounded-full bg-panel py-1 pr-1.5 pl-2.5 text-xs text-ink-soft" title={`Maliyet oranı ${pct(c.costRatioBefore)} → ${pct(c.costRatioAfter)}`}>
              <span className="font-medium text-ink">{c.label}</span>
              <StatusBadge status={c.before} />
              <span aria-hidden="true">→</span>
              <span className="sr-only">yeni durum</span>
              <StatusBadge status={c.after} />
            </li>
          ))}
          {i.statusChanges.length > STATUS_CHIPS ? (
            <li className="inline-flex items-center px-1 text-xs text-ink-mute">+{num(i.statusChanges.length - STATUS_CHIPS)} ürün daha</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Kategoriler

type Category = { id: number; name: string; count: number };
type CategoryRow = Category & { key: number };

/**
 * Sunucudan yeni liste gelince (kaydet, sil) yerel düzenlemeleri koruyarak eşitler: yeni kaydedilen satırlar
 * gerçek kimliğini alır (bir daha kaydedince ikinci kez eklenmez), silinenler düşer, ürün sayıları güncellenir.
 */
function mergeCategories(rows: CategoryRow[], cats: Category[]): CategoryRow[] {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const taken = new Set(rows.filter((r) => r.id && byId.has(r.id)).map((r) => r.id));
  const out: CategoryRow[] = [];
  for (const r of rows) {
    if (r.id) {
      const c = byId.get(r.id);
      if (c) out.push({ ...r, count: c.count });
      continue;
    }
    const match = cats.find((c) => !taken.has(c.id) && c.name === r.name.trim());
    if (match) {
      taken.add(match.id);
      out.push({ ...r, id: match.id, count: match.count });
    } else out.push(r);
  }
  for (const c of cats) if (!taken.has(c.id)) out.push({ ...c, key: c.id });
  return out;
}

export function CategoriesEditor({ categories }: { categories: Category[] }) {
  const [rows, setRows] = useState<CategoryRow[]>(() => categories.map((c) => ({ ...c, key: c.id })));
  const [synced, setSynced] = useState(categories);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<CategoryRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (synced !== categories) {
    setSynced(categories);
    setRows((r) => mergeCategories(r, categories));
  }

  const dirty = rows.length !== categories.length || rows.some((r, i) => r.id !== categories[i].id || r.name !== categories[i].name);
  const savedName = new Map(categories.map((c) => [c.id, c.name]));

  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const c = [...r];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });

  const focusRow = (key: number) => requestAnimationFrame(() => document.getElementById(`cat-${key}`)?.focus());

  /** Yeni satır boş adla sona eklenir ve odaklanır; yazıp Enter'a basmak kaydeder */
  function add() {
    const key = -Date.now();
    setRows((r) => [...r, { id: 0, key, name: "", count: 0 }]);
    focusRow(key);
  }

  async function save() {
    const empty = rows.find((r) => !r.name.trim());
    if (empty) {
      focusRow(empty.key);
      return void toast.error("Kategori adı boş olamaz", { description: "Adı yazın ya da satırı silin." });
    }
    // Ad veritabanında tekil; "Tatlılar" / "tatlilar" gibi ikinci yazımı kayıttan önce yakala
    const seen = new Set<string>();
    let dup: CategoryRow | undefined;
    for (const r of rows) {
      const k = fold(r.name.trim());
      if (seen.has(k)) {
        dup = r;
        break;
      }
      seen.add(k);
    }
    if (dup) {
      focusRow(dup.key);
      return void toast.error(`"${dup.name.trim()}" iki kez yazılmış`, { description: "Her kategorinin adı farklı olmalı." });
    }
    setBusy(true);
    const res = await saveCategories(rows.map((r) => ({ id: r.id || null, name: r.name })));
    setBusy(false);
    if (res.ok) toast.success("Kategoriler kaydedildi", { description: "Sıra ürün listesinde ve QR menüde de güncellendi." });
    else toast.error(res.error);
  }

  async function remove(r: CategoryRow) {
    if (r.id) {
      setDeleting(true);
      const res = await deleteCategory(r.id);
      setDeleting(false);
      if (!res.ok) return toast.error(res.error);
      toast.success(`"${r.name}" silindi`);
    }
    setConfirmDel(null);
    setRows((x) => x.filter((y) => y.key !== r.key));
  }

  return (
    <SectionCard
      id="kategoriler"
      icon={<Tags />}
      title="Ürün kategorileri"
      description="Sıra; ürün listesi, panel ve QR menüde kullanılır. Adı yazıp Enter'a basınca kaydedilir."
      summary={categoriesSummary(categories)}
      dirty={dirty}
      meta={<span className="tabular">{rows.length} kategori</span>}
      actionsClassName="max-sm:w-full max-sm:[&>*]:flex-1"
      actions={
        <>
          <Button variant="secondary" onClick={add}>
            <Plus size={16} /> Ekle
          </Button>
          <Button variant={dirty ? "primary" : "secondary"} disabled={busy || !dirty} onClick={save}>
            <Save size={16} /> {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <CardContent>
        {rows.length ? (
          <ol className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
            {rows.map((r, i) => {
              const before = r.id ? savedName.get(r.id) : undefined;
              const changed = !r.id || before !== r.name;
              return (
                <li key={r.key} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-2 py-2 sm:flex-nowrap sm:px-3">
                  <span className="w-5 shrink-0 text-right text-xs text-ink-quiet tabular">{i + 1}</span>
                  <Input
                    id={`cat-${r.key}`}
                    aria-label={`${i + 1}. kategorinin adı`}
                    value={r.name}
                    placeholder="Kategori adı"
                    maxLength={60}
                    enterKeyHint="done"
                    data-warn={changed || undefined}
                    onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        if (dirty && !busy) void save();
                      } else if (e.key === "Escape" && before !== undefined && before !== r.name) {
                        // Esc yazılanı geri alır (kayıtlı ada döner)
                        e.preventDefault();
                        setRows((x) => x.map((y, j) => (j === i ? { ...y, name: before } : y)));
                      }
                    }}
                    className="min-w-0 flex-1 basis-[calc(100%-1.75rem)] sm:basis-0"
                  />
                  <span className="ml-7 flex-1 text-xs text-ink-mute tabular sm:ml-0 sm:w-16 sm:flex-none">{r.id ? `${r.count} ürün` : "yeni"}</span>
                  <div className="flex gap-1.5">
                    <IconButton label={`${r.name || "Kategori"}: yukarı taşı`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp size={15} />
                    </IconButton>
                    <IconButton label={`${r.name || "Kategori"}: aşağı taşı`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown size={15} />
                    </IconButton>
                    <span title={r.count > 0 ? `Kategoride ${r.count} ürün var; önce ürünleri başka kategoriye taşıyın` : undefined}>
                      <IconButton
                        label={r.count > 0 ? "Kategoride ürün var, silinemez" : `${r.name || "Yeni kategori"}: sil`}
                        tone="danger"
                        disabled={r.count > 0}
                        onClick={() => (r.id ? setConfirmDel(r) : remove(r))}
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState
            icon={<Tags />}
            title="Kategori yok"
            description="Ürünleri gruplamak için bir kategori ekleyin."
            action={
              <Button onClick={add}>
                <Plus size={16} /> Kategori ekle
              </Button>
            }
          />
        )}
        {dirty ? (
          <p className="mt-3 flex items-center gap-2 text-xs text-warn" role="status">
            <span className="size-1.5 shrink-0 rounded-full bg-warn" aria-hidden="true" />
            Değişiklikler henüz kaydedilmedi. Kaydet&apos;e ya da bir adın içindeyken Enter&apos;a basın.
          </p>
        ) : null}
      </CardContent>
      <ConfirmDialog
        open={confirmDel !== null}
        onClose={() => setConfirmDel(null)}
        onConfirm={() => confirmDel && remove(confirmDel)}
        pending={deleting}
        title={confirmDel ? `"${savedName.get(confirmDel.id) ?? confirmDel.name}" kategorisi silinsin mi?` : ""}
        description="Kategori kalıcı olarak silinir; geri alınamaz. Kategoride ürün olmadığı için hiçbir ürün etkilenmez."
        confirmLabel="Kategoriyi sil"
      />
    </SectionCard>
  );
}

// ---------------------------------------------------------------- İşlem geçmişi

export type LogEntry = {
  id: number;
  /** "19.10.2026 21:56" (ipucu) */
  at: string;
  iso: string;
  /** Gün anahtarı (YYYY-MM-DD) ve başlığı ("Bugün", "Dün", "17 Ekim 2026 Cumartesi") */
  day: string;
  dayLabel: string;
  time: string;
  userName: string | null;
  action: string;
  detail: string | null;
};

type LogKind = { kind: string; label: string; keys: string[]; Icon: LucideIcon; tone: PastelTone };

/** İşlem adına göre tür (ikon, renk, süzgeç); ilk eşleşen kazanır, bu yüzden "silindi" en başta */
const LOG_KINDS: LogKind[] = [
  { kind: "silme", label: "Silinenler", keys: ["silindi"], Icon: Trash2, tone: 3 },
  { kind: "kullanici", label: "Kullanıcı ve parola", keys: ["kullanıcı", "parola", "oturum", "iki adımlı"], Icon: UserRound, tone: 4 },
  { kind: "ayar", label: "Ayarlar", keys: ["ayarlar", "sgk"], Icon: SettingsIcon, tone: 5 },
  { kind: "parasut", label: "Paraşüt", keys: ["paraşüt"], Icon: PlugZap, tone: 2 },
  { kind: "odeme", label: "Ödeme ve hatırlatıcı", keys: ["hatırlatıcı", "ödeme", "bildirim"], Icon: Bell, tone: 1 },
  { kind: "urun", label: "Ürün ve reçete", keys: ["satış fiyatı", "reçete", "ürün", "kategori"], Icon: Coffee, tone: 1 },
  { kind: "fatura", label: "Fatura", keys: ["fatura"], Icon: FileText, tone: 2 },
  { kind: "hammadde", label: "Hammadde", keys: ["hammadde"], Icon: Package, tone: 1 },
  { kind: "satis", label: "Satış", keys: ["satış", "pos", "ciro", "açık gün", "ay bilgisi"], Icon: Receipt, tone: 0 },
  { kind: "sayim", label: "Stok sayımı", keys: ["sayım", "alınan miktar", "bulgu"], Icon: ClipboardList, tone: 2 },
  { kind: "gider", label: "Gider ve personel", keys: ["gelir-gider", "sabit gider", "personel", "yatırım"], Icon: Wallet, tone: 0 },
];
const OTHER_KIND: LogKind = { kind: "diger", label: "Diğer", keys: [], Icon: Activity, tone: 5 };

function kindOf(action: string): LogKind {
  const a = action.toLocaleLowerCase("tr-TR");
  return LOG_KINDS.find((k) => k.keys.some((key) => a.includes(key))) ?? OTHER_KIND;
}

/**
 * Son işlemler gün gün: arama (işlem, ayrıntı, kişi), türe ve kişiye göre süzgeç. Süzgeçler adreste durur
 * (?ara=latte&tur=urun), sayfa yenilenince korunur.
 */
export function ActivityLog({ entries }: { entries: LogEntry[] }) {
  const [q, setQ] = useQueryText("ara");
  const [kindRaw, setKind] = useQueryState<string>("tur", "");
  const [personRaw, setPerson] = useQueryState<string>("kisi", "");

  const withKind = entries.map((l) => ({ ...l, meta: kindOf(l.action), person: l.userName ?? "Sistem" }));
  const kinds = [...LOG_KINDS, OTHER_KIND]
    .map((k) => ({ ...k, count: withKind.filter((l) => l.meta.kind === k.kind).length }))
    .filter((k) => k.count > 0);
  const people = [...new Set(withKind.map((l) => l.person))].sort((a, b) => a.localeCompare(b, "tr"));
  // Adresteki geçersiz değer (silinmiş tür, artık listede olmayan kişi) süzgeci kilitlemesin
  const kind = kinds.some((k) => k.kind === kindRaw) ? kindRaw : "";
  const person = people.includes(personRaw) ? personRaw : "";

  const shown = withKind.filter(
    (l) => (!kind || l.meta.kind === kind) && (!person || l.person === person) && matches(`${l.action} ${l.detail ?? ""} ${l.person}`, q),
  );
  const filterActive = Boolean(q.trim()) || Boolean(kind) || Boolean(person);
  const paged = usePaged(shown, 10, `${q}|${kind}|${person}`);
  const clear = () => {
    setQ("");
    clearQuery(["ara", "tur", "kisi"]);
  };

  // Sayfadaki kayıtlar gün başlıklarıyla gruplanır
  const days: { day: string; label: string; items: typeof shown }[] = [];
  for (const l of paged.slice) {
    const last = days.at(-1);
    if (last?.day === l.day) last.items.push(l);
    else days.push({ day: l.day, label: l.dayLabel, items: [l] });
  }

  return (
    <SectionCard
      id="gecmis"
      icon={<History />}
      title="İşlem geçmişi"
      description="Kim, ne zaman, neyi değiştirdi. Son 60 işlem listelenir; arama ve süzgeçler bunların içinde çalışır."
      summary={logSummary(entries)}
    >
      {entries.length ? (
        <>
          <FilterBar active={filterActive} onClear={clear} shown={shown.length} total={entries.length} unit="işlem" className="px-5 pb-3">
            <SearchField value={q} onChange={setQ} placeholder="İşlem ya da kişi ara" label="İşlem geçmişinde ara" className="w-full @md:w-64" />
            {kinds.length > 1 || people.length > 1 ? (
              <div className="flex w-full min-w-0 gap-2 @md:w-auto">
                {kinds.length > 1 ? (
                  // Telefonda tür adları kişi adından uzun ("Bütün işlemler"): genişlik 3'e 2 paylaşılır, metin oka binmez
                  <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="İşlem türü" className="min-w-0 flex-[3_1_0%] @md:w-auto">
                    <option value="">Bütün işlemler</option>
                    {kinds.map((k) => (
                      <option key={k.kind} value={k.kind}>
                        {k.label} ({k.count})
                      </option>
                    ))}
                  </Select>
                ) : null}
                {people.length > 1 ? (
                  <Select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Kişi" className="min-w-0 flex-[2_1_0%] @md:w-auto">
                    <option value="">Herkes</option>
                    {people.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>
                ) : null}
              </div>
            ) : null}
          </FilterBar>
          {shown.length ? (
            <>
              <CardContent className="space-y-3 pt-0 pb-2">
                {days.map((g) => (
                  <section key={`${g.day}-${g.items[0].id}`} aria-label={g.label}>
                    <h3 className="px-1 pb-0.5 text-[13px] font-medium text-ink-mute">{g.label}</h3>
                    <ActivityList>
                      {g.items.map((l) => (
                        <ActivityItem
                          key={l.id}
                          icon={<l.meta.Icon />}
                          tone={l.meta.tone}
                          title={<span title={l.action}>{l.action}</span>}
                          aside={
                            <time dateTime={l.iso} title={l.at}>
                              {l.time}
                            </time>
                          }
                          description={
                            <span title={l.detail ?? undefined}>
                              <span className="font-medium text-ink-soft">{l.person}</span>
                              {l.detail ? ` · ${l.detail}` : null}
                            </span>
                          }
                        />
                      ))}
                    </ActivityList>
                  </section>
                ))}
              </CardContent>
              <Pagination page={paged.page} pageCount={paged.pageCount} onChange={paged.setPage} total={paged.total} unit="işlem" className="mt-auto border-t border-line" />
            </>
          ) : (
            <EmptyState
              icon={<History />}
              title="Eşleşen işlem yok"
              description="Aramayı ya da süzgeçleri değiştirin. Daha eski işlemler bu listede yer almaz."
              action={
                <Button variant="secondary" onClick={clear}>
                  Süzgeci temizle
                </Button>
              }
            />
          )}
        </>
      ) : (
        <EmptyState icon={<History />} title="Henüz işlem yok" description="Ayar, fiyat ya da reçete değiştikçe burada listelenir." />
      )}
    </SectionCard>
  );
}

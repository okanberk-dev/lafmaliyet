"use client";

import { CheckCircle2, CircleDashed, Link2, ListFilter, Package, Pencil, PlugZap, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2, Unplug, Wand2, X, XCircle } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/panel/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { clearQuery, FilterBar, FilterChip, fold, matches, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { Field, Input, NumberInput, Select } from "@/components/ui/form";
import { IconTile, toneFor } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip, Stat } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { SortButton, Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { parseNumberTR } from "@/lib/calc/expr";
import { dateTimeTR, dateTR, num, tl2 } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  deleteCategoryRule,
  deleteProductLink,
  disconnectParasut,
  runParasutSync,
  saveCategoryRule,
  saveProductLink,
  testParasutConnection,
} from "@/server/actions/parasut";

type MatchType = "supplier" | "parasut_category" | "keyword";
const MATCH_LABEL: Record<MatchType, string> = { supplier: "Tedarikçi adı", parasut_category: "Paraşüt kategorisi", keyword: "Açıklama / kalemde geçen" };
/** Eşleşme türüne göre alanın örneği ve nasıl eşleştiği (mapping.ts pickCategory) */
const MATCH_HELP: Record<MatchType, { placeholder: string; hint: string }> = {
  supplier: { placeholder: "Ör. Metro, Trendyol", hint: "Tedarikçi adında bu metin geçerse." },
  parasut_category: { placeholder: "Ör. Ambalaj", hint: "Paraşüt'teki kategori adı tam olarak buysa." },
  keyword: { placeholder: "Ör. kira, elektrik", hint: "Tedarikçi, açıklama ya da kalem adlarında geçerse." },
};
const UNIT_LABEL: Record<string, string> = { gr: "gr", ml: "ml", adet: "adet", dilim: "dilim" };
const NOT_CONFIGURED = "Önce kurulumdaki ortam değişkenlerini tanımlayın";

/** Telefonda dokunma alanı 40px */
const TOUCH_ICON = "pointer-coarse:size-10";
const TOUCH_BTN = "pointer-coarse:h-10";
const TOUCH_INPUT = "pointer-coarse:h-10";

interface Run {
  id: number;
  trigger: "cron" | "manual";
  status: "running" | "ok" | "error";
  startedAt: string;
  finishedAt: string | null;
  message: string | null;
}
interface Rule {
  id: number;
  matchType: MatchType;
  pattern: string;
  category: string;
  priority: number;
}
interface LinkRow {
  id: number;
  productKey: string;
  productName: string;
  ingredientId: number;
  ingredientName: string;
  unit: string;
  factor: number;
  updatePrice: boolean;
}
interface Ingredient {
  id: number;
  name: string;
  unit: string;
  category: string;
}
interface Unlinked {
  productKey: string;
  productName: string;
  unit: string | null;
  count: number;
  lastDate: string;
  lastUnitPrice: number;
  supplier: string;
}

/** Adresten gelen değer beklenenlerden biri değilse varsayılan kullanılır */
function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function ParasutClient({
  configured,
  env,
  cronSet,
  syncFrom,
  cursor,
  pendingEInvoices,
  stats,
  runs,
  rules,
  links,
  ingredients,
  unlinked,
  categories,
}: {
  configured: boolean;
  env: { name: string; set: boolean }[];
  cronSet: boolean;
  syncFrom: string | null;
  cursor: string | null;
  pendingEInvoices: { count: number; sample: { from: string | null; date: string | null }[]; at: string } | null;
  stats: { invoices: number; lastSyncedAt: string | null };
  runs: Run[];
  rules: Rule[];
  links: LinkRow[];
  ingredients: Ingredient[];
  unlinked: Unlinked[];
  categories: readonly string[];
}) {
  // Her eylemin kendi bekleme durumu: "Bağlantıyı dene" sürerken eşitleme düğmesi dönmez
  const [testing, startTest] = useTransition();
  const [syncing, startSync] = useTransition();
  const [resetting, startReset] = useTransition();
  const busy = testing || syncing || resetting;
  const [from, setFrom] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const lastRun = runs[0];

  const sync = (since: string | null) =>
    startSync(async () => {
      const t = toast.loading(since ? `${dateTR(since)} tarihinden itibaren eşitleniyor…` : "Paraşüt'ten faturalar alınıyor…");
      const r = await runParasutSync(since);
      if (!r.ok) return void toast.error(r.error, { id: t });
      toast.success(r.data.summary, { id: t });
    });

  return (
    <>
      <PageHeader
        eyebrow="Ayarlar"
        title="Paraşüt entegrasyonu"
        description="Paraşüt'teki gider faturaları her sabah panele alınır: tutar, KDV, vade ve ödeme durumu; kalemler hammaddeye bağlanınca alınan miktar ve fiyat da güncellenir."
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!configured || busy}
              title={configured ? undefined : NOT_CONFIGURED}
              className={TOUCH_BTN}
              onClick={() =>
                startTest(async () => {
                  const r = await testParasutConnection();
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(r.data.total !== null ? `Bağlantı tamam · Paraşüt'te ${num(r.data.total)} gider faturası var` : "Bağlantı tamam");
                })
              }
            >
              <ShieldCheck size={16} /> {testing ? "Deneniyor…" : "Bağlantıyı dene"}
            </Button>
            <Button disabled={!configured || busy} title={configured ? undefined : NOT_CONFIGURED} onClick={() => sync(from || null)} className={cn("max-sm:order-first", TOUCH_BTN)}>
              <RefreshCw size={16} className={cn(syncing && "animate-spin")} /> {syncing ? "Eşitleniyor…" : "Şimdi eşitle"}
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat
          icon={<PlugZap />}
          label="Bağlantı"
          value={configured ? "Tanımlı" : "Kurulmadı"}
          tone={configured ? "good" : "warn"}
          sub={configured ? `Her sabah 08:00${cronSet ? "" : " · CRON_SECRET eksik"}` : "Aşağıdaki kurulum adımlarını izleyin"}
        />
        <Stat icon={<CheckCircle2 />} label="Paraşüt'ten gelen fatura" value={num(stats.invoices)} suffix="adet" sub={stats.lastSyncedAt ? `Son: ${dateTimeTR(stats.lastSyncedAt)}` : "Henüz eşitlenmedi"} />
        <Stat
          icon={<Link2 />}
          label="Bağlı ürün"
          info="Hammaddeye bağlanan Paraşüt ürünleri. Bağlı ürünlerin alınan miktarı Tutarlılık'a, son birim fiyatı hammaddeye yazılır."
          value={num(links.length)}
          sub={unlinked.length ? `${num(unlinked.length)} ürün bağlanmayı bekliyor` : "Bekleyen yok"}
          tone={unlinked.length ? "warn" : "default"}
        />
        <Stat
          icon={lastRun?.status === "error" ? <XCircle /> : <CircleDashed />}
          label="Son eşitleme"
          value={lastRun ? (lastRun.status === "ok" ? "Başarılı" : lastRun.status === "error" ? "Hata" : "Sürüyor") : "–"}
          tone={lastRun?.status === "error" ? "bad" : "default"}
          sub={lastRun ? dateTimeTR(lastRun.startedAt) : "Henüz çalışmadı"}
        />
      </div>

      {pendingEInvoices && pendingEInvoices.count > 0 ? (
        <div role="status" className="mb-4 flex items-start gap-3 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
          <CircleDashed size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Paraşüt&apos;te içeri alınmayı bekleyen yaklaşık {num(pendingEInvoices.count)} gelen e-fatura var</p>
            <p className="mt-0.5 break-words text-warn/90">
              Gelen e-faturalar Paraşüt&apos;te <em>Giderler → Gelen e-Faturalar</em> ekranından &quot;içeri al&quot; yapılınca gider faturası olur ve ancak o zaman panele gelir.
              {pendingEInvoices.sample.length ? ` Örnek: ${pendingEInvoices.sample.map((p) => [p.from, p.date ? dateTR(p.date) : null].filter(Boolean).join(" ")).join(", ")}.` : ""}
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader icon={<PlugZap />} title="Kurulum" description="Bir kez yapılır. Değerler Vercel'de saklanır, panelde gösterilmez." />
          <CardContent className="space-y-4">
            <ol className="space-y-3 text-sm text-ink-soft">
              <Step n={1} done={env.slice(0, 2).every((e) => e.set)}>
                Paraşüt&apos;ün geliştirici portalı yok: <a className="font-medium text-ink underline" href="mailto:destek@parasut.com">destek@parasut.com</a> adresine
                yazıp API erişimi isteyin. Size bir <code className="rounded bg-surface px-1">client_id</code> ve{" "}
                <code className="rounded bg-surface px-1">client_secret</code> verilir.
              </Step>
              <Step n={2} done={env.slice(2, 4).every((e) => e.set)}>
                API için Paraşüt&apos;te bir kullanıcı (e-posta + parola) belirleyin; yalnız fatura okuma yetkisi yeterli.
              </Step>
              <Step n={3} done={env[4]?.set}>
                Firma numarasını alın: Paraşüt&apos;e girince adres çubuğundaki <code className="rounded bg-surface px-1 break-words">uygulama.parasut.com/<b>123456</b>/…</code> sayısı.
              </Step>
              <Step n={4} done={configured && cronSet}>
                Vercel → lafmaliyet → Settings → Environment Variables&apos;a ekleyip yeniden deploy edin.
              </Step>
            </ol>
            <ul className="flex flex-wrap gap-1.5" aria-label="Ortam değişkenleri">
              {[...env, { name: "CRON_SECRET", set: cronSet }].map((e) => (
                <li key={e.name}>
                  <Badge tone={e.set ? "green" : "gray"} dot title={e.set ? "Tanımlı" : "Eksik"}>
                    <span className="font-mono">{e.name}</span>
                    <span className="sr-only">{e.set ? " tanımlı" : " eksik"}</span>
                  </Badge>
                </li>
              ))}
            </ul>
            <p className="text-xs leading-5 text-ink-mute">
              İlk eşitleme {syncFrom ? dateTR(syncFrom) : "bu yılın başından"} itibaren alır
              {cursor ? `; sonrakiler son faturadan (${dateTR(cursor)}) 75 gün geriye bakar` : ""}. Panelde elle ya da Excel&apos;den girilmiş aynı fatura bulunursa
              yenisi açılmaz, mevcut kayıt Paraşüt&apos;e bağlanır; kategorisi ve tedarikçi adı korunur.
            </p>
            <form
              className="grid gap-2 border-t border-line-strong pt-4 sm:grid-cols-[minmax(0,15rem)_auto_auto] sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                if (configured && from && !busy) sync(from);
              }}
            >
              <Field
                label="Yeniden eşitleme başlangıcı"
                tip="Seçtiğiniz tarihten bugüne kadarki gider faturaları yeniden okunur. Mevcut faturalar çoğalmaz; tutar, vade ve ödeme durumu güncellenir."
              >
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} max={new Date().toISOString().slice(0, 10)} className={TOUCH_INPUT} />
              </Field>
              <Button type="submit" variant="secondary" disabled={!configured || busy || !from} title={configured ? undefined : NOT_CONFIGURED} className={TOUCH_BTN}>
                <RefreshCw size={16} className={cn(syncing && from && "animate-spin")} /> Tarihten eşitle
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmReset(true)} className={TOUCH_BTN}>
                <Unplug size={16} /> Oturumu sıfırla
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader icon={<RefreshCw />} title="Eşitleme geçmişi" description="Otomatik (her sabah) ve elle yapılan son 8 eşitleme." />
          <CardContent className="flex-1">
            {runs.length === 0 ? (
              <EmptyState
                icon={<RefreshCw />}
                title="Henüz eşitleme yok"
                description={
                  configured
                    ? "Her sabah 08:00'de kendiliğinden çalışır; beklemeden “Şimdi eşitle” ile de başlatabilirsiniz."
                    : "Kurulum tamamlanınca her sabah kendiliğinden çalışır ve sonuçları burada görünür."
                }
              />
            ) : (
              <ul className="space-y-3">
                {runs.map((r) => (
                  <li key={r.id} className="flex items-start gap-2.5 text-[13px]">
                    <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", r.status === "ok" ? "bg-good" : r.status === "error" ? "bg-bad" : "bg-warn")} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="break-words text-ink">{r.message ?? (r.status === "running" ? "Sürüyor…" : "–")}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-mute">
                        <Badge tone={r.status === "ok" ? "green" : r.status === "error" ? "red" : "amber"}>
                          {r.status === "ok" ? "Başarılı" : r.status === "error" ? "Hata" : "Sürüyor"}
                        </Badge>
                        <span className="tabular">{dateTimeTR(r.startedAt)}</span>
                        <span>· {r.trigger === "cron" ? "otomatik" : "elle"}</span>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <ProductLinks links={links} unlinked={unlinked} ingredients={ingredients} />
      <CategoryRules rules={rules} categories={categories} />

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        tone="primary"
        confirmLabel="Oturumu sıfırla"
        title="Paraşüt oturumu sıfırlansın mı?"
        description="Kayıtlı erişim belirteci ve eşitleme imleci silinir. Bir sonraki eşitlemede yeniden giriş yapılır ve başlangıç tarihinden itibaren tekrar okunur; mevcut faturalar çoğalmaz, bağlantılar ve kurallar kalır."
        pending={resetting}
        onConfirm={() =>
          startReset(async () => {
            const r = await disconnectParasut();
            if (!r.ok) return void toast.error(r.error);
            toast.success("Oturum sıfırlandı");
            setConfirmReset(false);
          })
        }
      />
    </>
  );
}

function Step({ n, done, children }: { n: number; done?: boolean; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular", done ? "bg-lime text-good-ink" : "bg-surface text-ink-mute ring-1 ring-line-strong")}
        aria-label={done ? `Adım ${n}: tamam` : `Adım ${n}`}
      >
        {done ? "✓" : n}
      </span>
      <span className="min-w-0 pt-0.5">{children}</span>
    </li>
  );
}

// ---------------------------------------------------------------- ürün → hammadde bağlantıları

type ListView = "tumu" | "bekleyen" | "bagli";
const LIST_VIEWS = ["tumu", "bekleyen", "bagli"] as const;
type LinkSortCol = "urun" | "hammadde";
type LinkSort = LinkSortCol | `-${LinkSortCol}`;
const LINK_SORTS = ["urun", "-urun", "hammadde", "-hammadde"] as const;
type Draft = { ingredientId: string; factor: string; updatePrice: boolean; factorTouched?: boolean };
type LinkPatch = { type: "remove"; id: number } | { type: "update"; id: number; patch: Partial<LinkRow> };

/** Ürün adında hammaddenin anlamlı sözcüklerinin hepsi geçiyorsa öneri (en uzun ad kazanır) */
function suggestIngredient(productName: string, ingredients: Ingredient[]): Ingredient | null {
  const p = fold(productName);
  let best: Ingredient | null = null;
  for (const i of ingredients) {
    const words = fold(i.name.replace(/\(.*?\)/g, " "))
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3);
    if (words.length && words.every((w) => p.includes(w)) && (!best || i.name.length > best.name.length)) best = i;
  }
  return best;
}

/** Faturadaki birimle hammadde birimi arasında bilinen çarpan (kg → gr, L → ml) */
function guessFactor(productUnit: string | null, ingredientUnit: string): string | null {
  const u = fold(productUnit ?? "").replace(/[^a-z]/g, "");
  if (ingredientUnit === "gr" && ["kg", "kilo", "kilogram"].includes(u)) return "1000";
  if (ingredientUnit === "ml" && ["l", "lt", "litre", "liter"].includes(u)) return "1000";
  if (ingredientUnit === "gr" && ["g", "gr", "gram"].includes(u)) return "1";
  if (ingredientUnit === "ml" && ["ml", "mililitre"].includes(u)) return "1";
  if (ingredientUnit === "adet" && ["adet", "ad", "tane"].includes(u)) return "1";
  return null;
}

/** Kategoriye göre gruplanmış hammadde seçenekleri */
function IngredientOptions({ ingredients }: { ingredients: Ingredient[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, Ingredient[]>();
    for (const i of ingredients) m.set(i.category || "Diğer", [...(m.get(i.category || "Diğer") ?? []), i]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "tr"));
  }, [ingredients]);
  return (
    <>
      {groups.map(([cat, list]) => (
        <optgroup key={cat} label={cat}>
          {list.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({UNIT_LABEL[i.unit] ?? i.unit})
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

const FACTOR_TIP =
  "Faturadaki 1 birimin kaç hammadde birimi ettiği. Ör. 1 kg = 1000 gr, 1 L = 1000 ml, 1 koli = 12 adet. Alınan miktar bu çarpanla hesaplanır, birim fiyat da buna bölünür.";

function ProductLinks({ links, unlinked, ingredients }: { links: LinkRow[]; unlinked: Unlinked[]; ingredients: Ingredient[] }) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [removing, setRemoving] = useState<LinkRow | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const get = (k: string): Draft => draft[k] ?? { ingredientId: "", factor: "1", updatePrice: true };
  const set = (k: string, patch: Partial<Draft>) => setDraft((d) => ({ ...d, [k]: { ...get(k), ...patch } }));

  const [q, setQ] = useQueryText("ara");
  const [viewRaw, setView] = useQueryState<ListView>("durum", "tumu");
  const view = oneOf(viewRaw, LIST_VIEWS, "tumu");
  const [sortRaw, setSort] = useQueryState<LinkSort>("sirala", "urun");
  const sort = oneOf(sortRaw, LINK_SORTS, "urun");
  const sortCol = sort.replace("-", "") as LinkSortCol;
  const sortDir = sort.startsWith("-") ? "desc" : "asc";
  const sortBy = (col: LinkSortCol) => setSort(sortCol === col && sortDir === "asc" ? `-${col}` : col);

  // İyimser görünüm: bağlanan kalem listeden hemen düşer, silinen bağlantı hemen kalkar
  const [waiting, hideUnlinked] = useOptimistic(unlinked, (state, key: string) => state.filter((u) => u.productKey !== key));
  const [linked, patchLinks] = useOptimistic(links, (state, p: LinkPatch) =>
    p.type === "remove" ? state.filter((l) => l.id !== p.id) : state.map((l) => (l.id === p.id ? { ...l, ...p.patch } : l)),
  );

  const waitingShown = view === "bagli" ? [] : waiting.filter((u) => matches(`${u.productName} ${u.supplier} ${u.unit ?? ""}`, q));
  const linkedShown = (view === "bekleyen" ? [] : linked.filter((l) => matches(`${l.productName} ${l.ingredientName}`, q))).sort((a, b) => {
    const d = sortCol === "hammadde" ? a.ingredientName.localeCompare(b.ingredientName, "tr") : a.productName.localeCompare(b.productName, "tr");
    return sortDir === "desc" ? -d : d;
  });
  const total = waiting.length + linked.length;
  const filterActive = Boolean(q.trim()) || view !== "tumu";
  const clear = () => {
    setQ("");
    clearQuery(["ara", "durum"]);
  };

  const link = (u: Unlinked) => {
    const d = get(u.productKey);
    const factor = parseNumberTR(d.factor);
    if (!d.ingredientId) return void toast.error("Önce hammadde seçin");
    if (!factor || factor <= 0) return void toast.error("Çarpan sıfırdan büyük olmalı, ör. 1000 ya da 0,5");
    const ing = byId.get(Number(d.ingredientId));
    start(async () => {
      hideUnlinked(u.productKey);
      const r = await saveProductLink({ productKey: u.productKey, productName: u.productName, ingredientId: Number(d.ingredientId), factor, updatePrice: d.updatePrice });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${u.productName} → ${ing?.name ?? "hammadde"} bağlandı · ${r.data.quantities} aylık miktar, ${r.data.prices} fiyat güncellendi`);
    });
  };

  const update = (l: LinkRow, patch: { ingredientId: number; factor: number; updatePrice: boolean }, done?: () => void) => {
    const ing = byId.get(patch.ingredientId);
    start(async () => {
      patchLinks({ type: "update", id: l.id, patch: { ...patch, ingredientName: ing?.name ?? l.ingredientName, unit: ing?.unit ?? l.unit } });
      done?.();
      const r = await saveProductLink({ productKey: l.productKey, productName: l.productName, ...patch });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${l.productName} güncellendi · ${r.data.quantities} aylık miktar, ${r.data.prices} fiyat yeniden hesaplandı`);
    });
  };

  return (
    <Card className="mt-4">
      <CardHeader
        icon={<Link2 />}
        title="Ürün → hammadde bağlantıları"
        description="Faturadaki bir kalemi hammaddeye bağlayın; o kalemden gelen miktar Tutarlılık'taki “alınan” sütununa, son birim fiyat da hammaddenin paket fiyatına yazılır."
        meta={
          <>
            <span>Bağlı</span>
            <span className="text-ink-quiet">·</span>
            <span className="font-semibold text-ink tabular">{linked.length}</span>
            {waiting.length ? (
              <>
                <span className="text-ink-quiet">·</span>
                <span>Bekleyen</span>
                <span className="font-semibold text-warn tabular">{waiting.length}</span>
              </>
            ) : null}
          </>
        }
      />

      {total === 0 ? (
        <CardContent>
          <EmptyState
            title="Henüz bağlanacak kalem yok"
            description="İlk eşitlemeden sonra faturalardaki kalemler burada listelenir; hammaddeye bağladığınız anda miktar ve fiyat güncellenir."
          />
        </CardContent>
      ) : (
        <>
          <div className="px-5 pb-3">
            <FilterBar active={filterActive} onClear={clear} shown={waitingShown.length + linkedShown.length} total={total} unit="ürün">
              <SearchField value={q} onChange={setQ} placeholder="Ürün, tedarikçi ya da hammadde ara" className="w-full sm:w-72" />
              <Segmented<ListView>
                label="Liste"
                value={view}
                onChange={setView}
                options={[
                  { value: "tumu", label: "Tümü", count: total },
                  { value: "bekleyen", label: "Bekleyen", count: waiting.length },
                  { value: "bagli", label: "Bağlı", count: linked.length },
                ]}
              />
            </FilterBar>
          </div>

          {waitingShown.length + linkedShown.length === 0 ? (
            <CardContent>
              <EmptyState
                title="Bu süzgece uyan ürün yok"
                description={q.trim() ? `“${q.trim()}” için sonuç bulunamadı.` : view === "bekleyen" ? "Bağlanmayı bekleyen ürün kalmadı." : "Henüz bağlı ürün yok."}
                action={
                  <Button variant="secondary" onClick={clear} className={TOUCH_BTN}>
                    Süzgeci temizle
                  </Button>
                }
              />
            </CardContent>
          ) : null}

          {waitingShown.length ? (
            <div className="px-5 pb-4">
              <p className="mb-2 flex items-center gap-1.5 text-[0.65rem] font-medium tracking-wide text-ink-mute uppercase">
                <Wand2 size={12} aria-hidden="true" /> Bağlanmayı bekleyenler · {waitingShown.length}
                <InfoTip text="En sık geçen 40 kalem gösterilir; bağladıkça sıradakiler gelir. Hammadde olmayan kalemleri (kargo, hizmet) bağlamanız gerekmez." />
              </p>
              <ul className="space-y-2">
                {waitingShown.map((u) => {
                  const d = get(u.productKey);
                  const ing = byId.get(Number(d.ingredientId));
                  const suggestion = d.ingredientId ? null : suggestIngredient(u.productName, ingredients);
                  const choose = (id: string) => {
                    const next = byId.get(Number(id));
                    const guess = next && !d.factorTouched ? guessFactor(u.unit, next.unit) : null;
                    set(u.productKey, { ingredientId: id, ...(guess ? { factor: guess } : {}) });
                  };
                  return (
                    <li key={u.productKey} className="rounded-2xl bg-surface p-3">
                      <form
                        className="grid gap-2.5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_12.5rem_auto_auto] lg:items-center"
                        onSubmit={(e) => {
                          e.preventDefault();
                          link(u);
                        }}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <IconTile tone={toneFor(u.supplier)} size="sm">
                            <Package />
                          </IconTile>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-ink" title={u.productName}>
                              {u.productName}
                            </p>
                            <p className="truncate text-xs text-ink-mute" title={u.supplier}>
                              {u.supplier} · {num(u.count)} kalem · son {dateTR(u.lastDate)} · <span className="tabular">{tl2(u.lastUnitPrice)}</span>
                              {u.unit ? ` / ${u.unit}` : ""}
                            </p>
                          </div>
                        </div>
                        <div className="min-w-0">
                          <Select value={d.ingredientId} onChange={(e) => choose(e.target.value)} aria-label={`${u.productName} için hammadde`} className={TOUCH_INPUT}>
                            <option value="">Hammadde seçin…</option>
                            <IngredientOptions ingredients={ingredients} />
                          </Select>
                          {suggestion ? (
                            <button
                              type="button"
                              onClick={() => choose(String(suggestion.id))}
                              className="mt-1 inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-md px-1 text-xs text-info hover:underline pointer-coarse:min-h-10"
                            >
                              <Sparkles size={12} aria-hidden="true" /> Öneri: {suggestion.name}
                            </button>
                          ) : null}
                        </div>
                        <label className="flex items-center gap-2 text-xs text-ink-mute">
                          <span className="shrink-0">1 {u.unit ?? "birim"} =</span>
                          <NumberInput
                            value={d.factor}
                            onChange={(e) => set(u.productKey, { factor: e.target.value, factorTouched: true })}
                            aria-label={`${u.productName} çarpanı`}
                            aria-invalid={!(parseNumberTR(d.factor) ?? 0) || undefined}
                            className={cn("min-w-0", TOUCH_INPUT)}
                          />
                          <span className="w-8 shrink-0">{ing ? (UNIT_LABEL[ing.unit] ?? ing.unit) : "…"}</span>
                          <InfoTip text={FACTOR_TIP} />
                        </label>
                        <div className="flex items-center justify-between gap-2 lg:contents">
                          <Switch
                            checked={d.updatePrice}
                            label={`${u.productName} için fiyatı güncelle`}
                            showText
                            onText="Fiyatı güncelle"
                            offText="Fiyat elle"
                            onChange={(v) => set(u.productKey, { updatePrice: v })}
                          />
                          <Button type="submit" size="sm" disabled={pending || !d.ingredientId} className={TOUCH_BTN}>
                            <Link2 size={14} /> Bağla
                          </Button>
                        </div>
                      </form>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {linkedShown.length ? (
            <>
              {waitingShown.length ? <p className="px-5 pb-1 text-[0.65rem] font-medium tracking-wide text-ink-mute uppercase">Bağlı ürünler · {linkedShown.length}</p> : null}
              {/* Telefon: kart listesi */}
              <ul className="mx-2 mb-2 rounded-2xl bg-surface p-1.5 md:hidden">
                {linkedShown.map((l, i) => (
                  <li key={l.id} className={cn("px-2.5 py-3", i > 0 && "border-t border-ink/[0.06]")}>
                    {editing === l.id ? (
                      <LinkEditor link={l} ingredients={ingredients} byId={byId} pending={pending} onCancel={() => setEditing(null)} onSave={(p) => update(l, p, () => setEditing(null))} />
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold break-words text-ink">{l.productName}</p>
                            <p className="mt-0.5 text-xs text-ink-mute">
                              →{" "}
                              <Link href={`/panel/hammaddeler?ara=${encodeURIComponent(l.ingredientName)}`} className="font-medium text-ink-soft hover:underline">
                                {l.ingredientName}
                              </Link>{" "}
                              · <span className="tabular">× {num(l.factor, 0, 3)}</span> {UNIT_LABEL[l.unit] ?? l.unit}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-1.5">
                            <IconButton label={`${l.productName} bağlantısını düzenle`} onClick={() => setEditing(l.id)} className={TOUCH_ICON}>
                              <Pencil size={15} />
                            </IconButton>
                            <IconButton label={`${l.productName} bağlantısını sil`} tone="danger" onClick={() => setRemoving(l)} className={TOUCH_ICON}>
                              <Trash2 size={15} />
                            </IconButton>
                          </div>
                        </div>
                        <Switch
                          className="mt-1"
                          checked={l.updatePrice}
                          showText
                          onText="Fiyat güncellenir"
                          offText="Fiyat elle"
                          label={`${l.productName} fiyatı güncellensin`}
                          disabled={pending}
                          onChange={(v) => update(l, { ingredientId: l.ingredientId, factor: l.factor, updatePrice: v })}
                        />
                      </>
                    )}
                  </li>
                ))}
              </ul>

              {/* Masaüstü: tablo */}
              <TableWrap className="hidden md:block">
                <Table className="min-w-[680px]">
                  <THead>
                    <tr>
                      <TH>
                        <SortButton dir={sortCol === "urun" ? sortDir : null} onClick={() => sortBy("urun")}>
                          Paraşüt ürünü
                        </SortButton>
                      </TH>
                      <TH>
                        <SortButton dir={sortCol === "hammadde" ? sortDir : null} onClick={() => sortBy("hammadde")}>
                          Hammadde
                        </SortButton>
                      </TH>
                      <TH numeric>
                        <span className="inline-flex items-center gap-1.5">
                          Çarpan
                          <InfoTip text={FACTOR_TIP} />
                        </span>
                      </TH>
                      <TH>
                        <span className="inline-flex items-center gap-1.5">
                          Fiyat
                          <InfoTip text="Açıkken yeni faturadaki son birim fiyat hammaddenin paket fiyatına yazılır. Kapalıyken fiyatı Hammaddeler'de elle yönetirsiniz; miktar yine sayılır." />
                        </span>
                      </TH>
                      <TH className="text-right">
                        <span className="sr-only">Eylemler</span>
                      </TH>
                    </tr>
                  </THead>
                  <tbody>
                    {linkedShown.map((l) =>
                      editing === l.id ? (
                        <TR key={l.id} className="hover:bg-transparent">
                          <TD colSpan={5}>
                            <LinkEditor link={l} ingredients={ingredients} byId={byId} pending={pending} onCancel={() => setEditing(null)} onSave={(p) => update(l, p, () => setEditing(null))} />
                          </TD>
                        </TR>
                      ) : (
                        <TR key={l.id}>
                          <TD className="font-medium">
                            <span className="line-clamp-2 break-words" title={l.productName}>
                              {l.productName}
                            </span>
                          </TD>
                          <TD>
                            <Link href={`/panel/hammaddeler?ara=${encodeURIComponent(l.ingredientName)}`} className="hover:underline">
                              {l.ingredientName}
                            </Link>
                          </TD>
                          <TD numeric>
                            × {num(l.factor, 0, 3)} <span className="text-ink-mute">{UNIT_LABEL[l.unit] ?? l.unit}</span>
                          </TD>
                          <TD>
                            <Switch
                              checked={l.updatePrice}
                              showText
                              onText="Güncellenir"
                              offText="Elle"
                              label={`${l.productName} fiyatı güncellensin`}
                              disabled={pending}
                              onChange={(v) => update(l, { ingredientId: l.ingredientId, factor: l.factor, updatePrice: v })}
                            />
                          </TD>
                          <TD>
                            <div className="flex justify-end gap-1.5">
                              <IconButton label={`${l.productName} bağlantısını düzenle`} onClick={() => setEditing(l.id)}>
                                <Pencil size={15} />
                              </IconButton>
                              <IconButton label={`${l.productName} bağlantısını sil`} tone="danger" onClick={() => setRemoving(l)}>
                                <Trash2 size={15} />
                              </IconButton>
                            </div>
                          </TD>
                        </TR>
                      ),
                    )}
                  </tbody>
                </Table>
              </TableWrap>
            </>
          ) : null}
        </>
      )}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Bağlantı silinsin mi?"
        description={
          removing
            ? `${removing.productName} artık ${removing.ingredientName} olarak sayılmayacak; Paraşüt'ten hesaplanan alınan miktarlar yeniden hesaplanır. Hammaddenin fiyatı değişmez. Ürün “Bağlanmayı bekleyenler”e geri döner.`
            : undefined
        }
        confirmLabel="Bağlantıyı sil"
        pending={pending}
        onConfirm={() => {
          const l = removing;
          if (!l) return;
          setRemoving(null);
          start(async () => {
            patchLinks({ type: "remove", id: l.id });
            const r = await deleteProductLink(l.id);
            if (!r.ok) return void toast.error(r.error);
            toast.success(`${l.productName} bağlantısı silindi`);
          });
        }}
      />
    </Card>
  );
}

/** Bağlı ürünü yerinde düzenleme: hammadde, çarpan, fiyat. Enter kaydeder, Esc vazgeçer. */
function LinkEditor({
  link,
  ingredients,
  byId,
  pending,
  onCancel,
  onSave,
}: {
  link: LinkRow;
  ingredients: Ingredient[];
  byId: Map<number, Ingredient>;
  pending: boolean;
  onCancel: () => void;
  onSave: (p: { ingredientId: number; factor: number; updatePrice: boolean }) => void;
}) {
  const id = useId();
  const [ingredientId, setIngredientId] = useState(String(link.ingredientId));
  const [factor, setFactor] = useState(num(link.factor, 0, 3));
  const [updatePrice, setUpdatePrice] = useState(link.updatePrice);
  const f = parseNumberTR(factor);
  const invalid = !ingredientId || !f || f <= 0;
  const ing = byId.get(Number(ingredientId));
  return (
    <form
      className="grid gap-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem_auto_auto] md:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) onSave({ ingredientId: Number(ingredientId), factor: f, updatePrice });
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <p className="min-w-0 text-sm font-semibold break-words text-ink md:self-center">{link.productName}</p>
      <Field label="Hammadde" htmlFor={`${id}-ing`}>
        <Select id={`${id}-ing`} value={ingredientId} onChange={(e) => setIngredientId(e.target.value)} className={TOUCH_INPUT} autoFocus>
          <IngredientOptions ingredients={ingredients} />
        </Select>
      </Field>
      <Field label={`Çarpan (${ing ? (UNIT_LABEL[ing.unit] ?? ing.unit) : "birim"})`} htmlFor={`${id}-factor`} error={factor && invalid && ingredientId ? "Sıfırdan büyük olmalı" : undefined}>
        <NumberInput id={`${id}-factor`} value={factor} onChange={(e) => setFactor(e.target.value)} aria-invalid={(Boolean(ingredientId) && invalid) || undefined} className={TOUCH_INPUT} />
      </Field>
      <Switch checked={updatePrice} showText onText="Fiyat güncellenir" offText="Fiyat elle" label="Fiyatı güncelle" onChange={setUpdatePrice} className="md:mb-0.5" />
      <div className="flex justify-end gap-1.5 md:mb-0.5">
        <Button variant="ghost" size="sm" onClick={onCancel} className={TOUCH_BTN}>
          Vazgeç
        </Button>
        <Button type="submit" size="sm" disabled={pending || invalid} className={TOUCH_BTN}>
          Kaydet
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- kategori kuralları

function CategoryRules({ rules, categories }: { rules: Rule[]; categories: readonly string[] }) {
  const formId = useId();
  const [pending, start] = useTransition();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [matchType, setMatchType] = useState<MatchType>("supplier");
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState(categories[0] ?? "");
  const [removing, setRemoving] = useState<Rule | null>(null);
  const patternRef = useRef<HTMLInputElement>(null);
  const [shown, removeRule] = useOptimistic(rules, (state, id: number) => state.filter((r) => r.id !== id));

  const [q, setQ] = useQueryText("kural");
  const [typeRaw, setType] = useQueryState<string>("eslesme", "");
  const type = (Object.keys(MATCH_LABEL) as MatchType[]).find((k) => k === typeRaw) ?? null;
  const filtered = shown.filter((r) => (!type || r.matchType === type) && matches(`${r.pattern} ${r.category} ${MATCH_LABEL[r.matchType]}`, q));
  const showFilters = shown.length > 5;
  const filterActive = Boolean(q.trim()) || type !== null;
  const clear = () => {
    setQ("");
    clearQuery(["kural", "eslesme"]);
  };

  const editingRule = shown.find((r) => r.id === editingId) ?? null;
  const duplicate = pattern.trim()
    ? shown.find((r) => r.id !== editingId && r.matchType === matchType && fold(r.pattern).trim() === fold(pattern).trim())
    : undefined;

  const reset = () => {
    setEditingId(null);
    setPattern("");
  };
  const edit = (r: Rule) => {
    setEditingId(r.id);
    setMatchType(r.matchType);
    setPattern(r.pattern);
    setCategory(r.category);
    requestAnimationFrame(() => {
      patternRef.current?.focus();
      patternRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  return (
    <Card className="mt-4">
      <CardHeader
        icon={<ListFilter />}
        title="Kategori kuralları"
        description="Yeni gelen faturanın panel kategorisi. Kural yoksa tedarikçinin önceki faturalarına, sonra Paraşüt kategorisine bakılır; bulunamazsa “Diğer”."
        meta={
          shown.length ? (
            <>
              <span>Kural</span>
              <span className="text-ink-quiet">·</span>
              <span className="font-semibold text-ink tabular">{shown.length}</span>
            </>
          ) : undefined
        }
      />
      <CardContent className="space-y-3">
        <form
          id={formId}
          className={cn("grid gap-2 rounded-2xl sm:grid-cols-2 lg:grid-cols-[12rem_minmax(0,1fr)_minmax(0,14rem)_auto] lg:items-start", editingId !== null && "bg-surface p-3 ring-1 ring-ink/20")}
          onSubmit={(e) => {
            e.preventDefault();
            if (!pattern.trim() || duplicate) return;
            start(async () => {
              const r = await saveCategoryRule({ id: editingId, matchType, pattern, category, priority: editingRule?.priority ?? 100 });
              if (!r.ok) return void toast.error(r.error);
              toast.success(editingId !== null ? "Kural güncellendi" : `Kural eklendi · “${pattern.trim()}” → ${category}`);
              reset();
            });
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && editingId !== null) {
              e.preventDefault();
              reset();
            }
          }}
        >
          {editingRule ? (
            <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] font-medium text-ink sm:col-span-2 lg:col-span-4">
              <Pencil size={14} aria-hidden="true" /> <span className="min-w-0 break-words">“{editingRule.pattern}” kuralını düzenliyorsunuz</span>
              <span className="font-normal text-ink-mute">· Enter kaydeder, Esc vazgeçer</span>
            </p>
          ) : null}
          <Field label="Eşleşme" htmlFor={`${formId}-type`}>
            <Select id={`${formId}-type`} value={matchType} onChange={(e) => setMatchType(e.target.value as MatchType)} className={TOUCH_INPUT}>
              {(Object.keys(MATCH_LABEL) as MatchType[]).map((k) => (
                <option key={k} value={k}>
                  {MATCH_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Metin"
            htmlFor={`${formId}-pattern`}
            hint={duplicate ? undefined : MATCH_HELP[matchType].hint + " Büyük/küçük harf ve Türkçe karakter fark etmez."}
            error={duplicate ? `Bu kural zaten var (→ ${duplicate.category})` : undefined}
          >
            <Input
              ref={patternRef}
              id={`${formId}-pattern`}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={MATCH_HELP[matchType].placeholder}
              maxLength={120}
              aria-invalid={Boolean(duplicate) || undefined}
              className={TOUCH_INPUT}
              required
            />
          </Field>
          <Field label="Panel kategorisi" htmlFor={`${formId}-cat`}>
            <Select id={`${formId}-cat`} value={category} onChange={(e) => setCategory(e.target.value)} className={TOUCH_INPUT}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-1 lg:pt-[1.625rem]">
            {editingId !== null ? (
              <Button variant="ghost" onClick={reset} className={TOUCH_BTN}>
                <X size={16} /> Vazgeç
              </Button>
            ) : null}
            <Button type="submit" disabled={pending || !pattern.trim() || Boolean(duplicate)} className={cn("max-lg:flex-1", TOUCH_BTN)}>
              {editingId !== null ? (
                "Kaydet"
              ) : (
                <>
                  <Plus size={16} /> Kural ekle
                </>
              )}
            </Button>
          </div>
        </form>

        {showFilters ? (
          <FilterBar active={filterActive} onClear={clear} shown={filtered.length} total={shown.length} unit="kural">
            <SearchField value={q} onChange={setQ} placeholder="Kural ara" shortcut={false} className="w-full sm:w-56" />
            {(Object.keys(MATCH_LABEL) as MatchType[]).map((k) => (
              <FilterChip key={k} active={type === k} onToggle={() => setType(type === k ? "" : k)} count={shown.filter((r) => r.matchType === k).length}>
                {MATCH_LABEL[k]}
              </FilterChip>
            ))}
          </FilterBar>
        ) : null}

        {shown.length === 0 ? (
          <p className="rounded-2xl bg-surface px-4 py-3 text-[13px] text-ink-mute">
            Henüz kural yok; çoğu fatura tedarikçinin geçmişinden doğru kategoriye düşer. Sık yanlış kategorilenen bir tedarikçi için kural ekleyin.
          </p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface px-4 py-3 text-[13px] text-ink-mute">
            <span>Bu süzgece uyan kural yok.</span>
            <Button variant="secondary" size="sm" onClick={clear} className={TOUCH_BTN}>
              Süzgeci temizle
            </Button>
          </div>
        ) : (
          <>
            <ul className="rounded-2xl bg-surface p-1.5">
              {filtered.map((r, i) => (
                <li
                  key={r.id}
                  className={cn(
                    "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-2.5 py-2 text-sm",
                    i > 0 && "border-t border-ink/[0.06]",
                    editingId === r.id && "rounded-xl bg-panel",
                  )}
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge tone="gray">{MATCH_LABEL[r.matchType]}</Badge>
                    <span className="min-w-0 font-medium break-words text-ink">“{r.pattern}”</span>
                    <span className="text-ink-mute" aria-label="kategori">
                      →
                    </span>
                    <Badge tone="blue">{r.category}</Badge>
                  </div>
                  <div className="flex gap-1.5">
                    <IconButton label={`“${r.pattern}” kuralını düzenle`} onClick={() => edit(r)} className={TOUCH_ICON}>
                      <Pencil size={15} />
                    </IconButton>
                    <IconButton label={`“${r.pattern}” kuralını sil`} tone="danger" disabled={pending} onClick={() => setRemoving(r)} className={TOUCH_ICON}>
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ul>
            <p className="flex items-center gap-1.5 px-1 text-xs text-ink-mute">
              Kurallar yukarıdan aşağı denenir, ilk eşleşen kazanır. Yalnızca yeni gelen faturalara uygulanır; mevcut faturaların kategorisi değişmez.
            </p>
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Kural silinsin mi?"
        description={
          removing
            ? `${MATCH_LABEL[removing.matchType]} “${removing.pattern}” → ${removing.category} kuralı silinir. Bundan sonra gelen faturalar tedarikçi geçmişine göre kategorilenir; mevcut faturalar değişmez.`
            : undefined
        }
        confirmLabel="Kuralı sil"
        pending={pending}
        onConfirm={() => {
          const r = removing;
          if (!r) return;
          setRemoving(null);
          if (editingId === r.id) reset();
          start(async () => {
            removeRule(r.id);
            const res = await deleteCategoryRule(r.id);
            if (!res.ok) return void toast.error(res.error);
            toast.success(`“${r.pattern}” kuralı silindi`);
          });
        }}
      />
    </Card>
  );
}

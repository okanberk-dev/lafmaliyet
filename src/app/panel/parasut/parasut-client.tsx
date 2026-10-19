"use client";

import { CheckCircle2, CircleDashed, Link2, ListFilter, PlugZap, Plus, RefreshCw, ShieldCheck, Trash2, Unplug, Wand2, XCircle } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/panel/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, NumberInput, Select } from "@/components/ui/form";
import { IconTile, toneFor } from "@/components/ui/icon-tile";
import { EmptyState, Stat } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
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
const UNIT_LABEL: Record<string, string> = { gr: "gr", ml: "ml", adet: "adet", dilim: "dilim" };

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
  const [pending, start] = useTransition();
  const [from, setFrom] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const lastRun = runs[0];

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
              disabled={!configured || pending}
              onClick={() =>
                start(async () => {
                  const r = await testParasutConnection();
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(r.data.total !== null ? `Bağlantı tamam · Paraşüt'te ${num(r.data.total)} gider faturası var` : "Bağlantı tamam");
                })
              }
            >
              <ShieldCheck size={16} /> Bağlantıyı dene
            </Button>
            <Button
              disabled={!configured || pending}
              onClick={() =>
                start(async () => {
                  const r = await runParasutSync(from || null);
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(r.data.summary);
                })
              }
            >
              <RefreshCw size={16} className={cn(pending && "animate-spin")} /> Şimdi eşitle
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat icon={<PlugZap />} label="Bağlantı" value={configured ? "Tanımlı" : "Kurulmadı"} tone={configured ? "good" : "warn"} sub={configured ? `Her sabah 08:00${cronSet ? "" : " · CRON_SECRET eksik"}` : "Ortam değişkenlerini girin"} />
        <Stat icon={<CheckCircle2 />} label="Paraşüt'ten gelen fatura" value={num(stats.invoices)} sub={stats.lastSyncedAt ? `Son: ${dateTimeTR(stats.lastSyncedAt)}` : "Henüz eşitlenmedi"} />
        <Stat icon={<Link2 />} label="Bağlı ürün" value={num(links.length)} sub={unlinked.length ? `${num(unlinked.length)} ürün bağlanmayı bekliyor` : "Bekleyen yok"} />
        <Stat
          icon={lastRun?.status === "error" ? <XCircle /> : <CircleDashed />}
          label="Son eşitleme"
          value={lastRun ? (lastRun.status === "ok" ? "Başarılı" : lastRun.status === "error" ? "Hata" : "Sürüyor") : "–"}
          tone={lastRun?.status === "error" ? "bad" : "default"}
          sub={lastRun ? dateTimeTR(lastRun.startedAt) : undefined}
        />
      </div>

      {pendingEInvoices && pendingEInvoices.count > 0 ? (
        <div role="status" className="mb-4 flex flex-wrap items-start gap-3 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
          <CircleDashed size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Paraşüt&apos;te içeri alınmayı bekleyen yaklaşık {num(pendingEInvoices.count)} gelen e-fatura var</p>
            <p className="mt-0.5 text-warn/90">
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
                yazıp API erişimi isteyin. Size bir <code className="rounded bg-panel px-1">client_id</code> ve{" "}
                <code className="rounded bg-panel px-1">client_secret</code> verilir.
              </Step>
              <Step n={2} done={env.slice(2, 4).every((e) => e.set)}>
                API için Paraşüt&apos;te bir kullanıcı (e-posta + parola) belirleyin; yalnız fatura okuma yetkisi yeterli.
              </Step>
              <Step n={3} done={env[4]?.set}>
                Firma numarasını alın: Paraşüt&apos;e girince adres çubuğundaki <code className="rounded bg-panel px-1">uygulama.parasut.com/<b>123456</b>/…</code> sayısı.
              </Step>
              <Step n={4} done={configured && cronSet}>
                Vercel → lafmaliyet → Settings → Environment Variables&apos;a ekleyip yeniden deploy edin.
              </Step>
            </ol>
            <ul className="flex flex-wrap gap-1.5">
              {env.map((e) => (
                <li key={e.name}>
                  <Badge tone={e.set ? "green" : "gray"} dot>
                    <span className="font-mono">{e.name}</span>
                  </Badge>
                </li>
              ))}
              <li>
                <Badge tone={cronSet ? "green" : "gray"} dot>
                  <span className="font-mono">CRON_SECRET</span>
                </Badge>
              </li>
            </ul>
            <p className="text-xs text-ink-mute">
              İlk eşitleme {syncFrom ? dateTR(syncFrom) : "bu yılın başından"} itibaren alır
              {cursor ? `; sonrakiler son faturadan (${dateTR(cursor)}) 75 gün geriye bakar` : ""}. Panelde elle ya da Excel&apos;den girilmiş aynı fatura bulunursa
              yenisi açılmaz, mevcut kayıt Paraşüt&apos;e bağlanır; kategorisi ve tedarikçi adı korunur.
            </p>
            <div className="flex flex-wrap items-end gap-2 border-t border-line-strong pt-4">
              <Field label="Bu tarihten itibaren yeniden eşitle" className="w-48">
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Button
                variant="secondary"
                disabled={!configured || pending || !from}
                onClick={() =>
                  start(async () => {
                    const r = await runParasutSync(from);
                    if (!r.ok) return void toast.error(r.error);
                    toast.success(r.data.summary);
                  })
                }
              >
                <RefreshCw size={16} /> Tarihten eşitle
              </Button>
              <Button variant="ghost" disabled={pending} onClick={() => setConfirmReset(true)}>
                <Unplug size={16} /> Oturumu sıfırla
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader icon={<RefreshCw />} title="Eşitleme geçmişi" description="Otomatik (her sabah) ve elle yapılanlar." />
          <CardContent>
            {runs.length === 0 ? (
              <p className="text-sm text-ink-mute">Henüz eşitleme yapılmadı.</p>
            ) : (
              <ul className="space-y-2.5">
                {runs.map((r) => (
                  <li key={r.id} className="flex items-start gap-2.5 text-[13px]">
                    <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", r.status === "ok" ? "bg-good" : r.status === "error" ? "bg-bad" : "bg-warn")} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="text-ink">{r.message ?? (r.status === "running" ? "Sürüyor…" : "–")}</span>
                      <span className="block text-xs text-ink-mute">
                        {dateTimeTR(r.startedAt)} · {r.trigger === "cron" ? "otomatik" : "elle"}
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
        confirmLabel="Sıfırla"
        title="Paraşüt oturumu sıfırlansın mı?"
        description="Kayıtlı erişim belirteci ve eşitleme imleci silinir. Bir sonraki eşitlemede yeniden giriş yapılır ve başlangıç tarihinden itibaren tekrar okunur; mevcut faturalar çoğalmaz."
        pending={pending}
        onConfirm={() =>
          start(async () => {
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

function Step({ n, done, children }: { n: number; done?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular", done ? "bg-lime text-good-ink" : "bg-surface text-ink-mute ring-1 ring-line-strong")}
        aria-label={done ? "Tamam" : `Adım ${n}`}
      >
        {done ? "✓" : n}
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}

function ProductLinks({ links, unlinked, ingredients }: { links: LinkRow[]; unlinked: Unlinked[]; ingredients: Ingredient[] }) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Record<string, { ingredientId: string; factor: string; updatePrice: boolean }>>({});
  const [removing, setRemoving] = useState<LinkRow | null>(null);
  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const get = (k: string) => draft[k] ?? { ingredientId: "", factor: "1", updatePrice: true };
  const set = (k: string, patch: Partial<{ ingredientId: string; factor: string; updatePrice: boolean }>) => setDraft((d) => ({ ...d, [k]: { ...get(k), ...patch } }));

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
            <span className="font-semibold text-ink tabular">{links.length}</span>
          </>
        }
      />
      {unlinked.length ? (
        <div className="px-5 pb-2">
          <p className="mb-2 flex items-center gap-1.5 text-[0.65rem] font-medium tracking-wide text-ink-mute uppercase">
            <Wand2 size={12} /> Bağlanmayı bekleyenler
          </p>
          <ul className="space-y-2">
            {unlinked.map((u) => {
              const d = get(u.productKey);
              const ing = byId.get(Number(d.ingredientId));
              return (
                <li key={u.productKey} className="grid gap-2 rounded-2xl bg-surface p-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_8rem_auto_auto] md:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <IconTile tone={toneFor(u.supplier)} size="sm">
                      <ListFilter />
                    </IconTile>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{u.productName}</p>
                      <p className="truncate text-xs text-ink-mute">
                        {u.supplier} · {num(u.count)} kalem · son {dateTR(u.lastDate)} · {tl2(u.lastUnitPrice)}
                        {u.unit ? ` / ${u.unit}` : ""}
                      </p>
                    </div>
                  </div>
                  <Select value={d.ingredientId} onChange={(e) => set(u.productKey, { ingredientId: e.target.value })} aria-label={`${u.productName} için hammadde`}>
                    <option value="">Hammadde seçin…</option>
                    {ingredients.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </Select>
                  <label className="flex items-center gap-2 text-xs text-ink-mute">
                    <span className="shrink-0">1 {u.unit ?? "birim"} =</span>
                    <NumberInput value={d.factor} onChange={(e) => set(u.productKey, { factor: e.target.value })} aria-label="Çarpan" />
                    <span className="shrink-0">{ing ? UNIT_LABEL[ing.unit] ?? ing.unit : ""}</span>
                  </label>
                  <Switch checked={d.updatePrice} label="Fiyatı güncelle" showText onText="Fiyat" offText="Fiyat yok" onChange={(v) => set(u.productKey, { updatePrice: v })} />
                  <Button
                    size="sm"
                    disabled={pending || !d.ingredientId}
                    onClick={() =>
                      start(async () => {
                        const factor = parseNumberTR(d.factor);
                        if (!factor || factor <= 0) return void toast.error("Çarpan sıfırdan büyük olmalı");
                        const r = await saveProductLink({ productKey: u.productKey, productName: u.productName, ingredientId: Number(d.ingredientId), factor, updatePrice: d.updatePrice });
                        if (!r.ok) return void toast.error(r.error);
                        toast.success(`Bağlandı · ${r.data.quantities} aylık miktar, ${r.data.prices} fiyat güncellendi`);
                      })
                    }
                  >
                    <Link2 size={14} /> Bağla
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {links.length === 0 ? (
        unlinked.length ? null : (
          <CardContent>
            <EmptyState title="Henüz bağlantı yok" description="İlk eşitlemeden sonra faturalardaki kalemler burada listelenir; hammaddeye bağladığınız anda miktar ve fiyat güncellenir." />
          </CardContent>
        )
      ) : (
        <TableWrap>
          <Table className="min-w-[640px]">
            <THead>
              <tr>
                <TH>Paraşüt ürünü</TH>
                <TH>Hammadde</TH>
                <TH numeric>Çarpan</TH>
                <TH>Fiyat</TH>
                <TH className="text-right">Eylem</TH>
              </tr>
            </THead>
            <tbody>
              {links.map((l) => (
                <TR key={l.id}>
                  <TD className="font-medium">{l.productName}</TD>
                  <TD>
                    <Link href={`/panel/hammaddeler?ara=${encodeURIComponent(l.ingredientName)}`} className="hover:underline">
                      {l.ingredientName}
                    </Link>
                  </TD>
                  <TD numeric>
                    × {num(l.factor, 0, 3)} {UNIT_LABEL[l.unit] ?? l.unit}
                  </TD>
                  <TD>{l.updatePrice ? <Badge tone="green">Güncellenir</Badge> : <Badge tone="gray">Elle</Badge>}</TD>
                  <TD>
                    <div className="flex justify-end">
                      <IconButton label="Bağlantıyı sil" tone="danger" onClick={() => setRemoving(l)}>
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Bağlantı silinsin mi?"
        description={removing ? `${removing.productName} artık ${removing.ingredientName} olarak sayılmayacak; Paraşüt'ten hesaplanan alınan miktarlar yeniden hesaplanır.` : undefined}
        pending={pending}
        onConfirm={() => {
          const l = removing;
          if (!l) return;
          start(async () => {
            const r = await deleteProductLink(l.id);
            if (!r.ok) return void toast.error(r.error);
            setRemoving(null);
          });
        }}
      />
    </Card>
  );
}

function CategoryRules({ rules, categories }: { rules: Rule[]; categories: readonly string[] }) {
  const [pending, start] = useTransition();
  const [matchType, setMatchType] = useState<MatchType>("supplier");
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState(categories[0] ?? "");
  return (
    <Card className="mt-4">
      <CardHeader
        icon={<ListFilter />}
        title="Kategori kuralları"
        description="Yeni gelen faturanın panel kategorisi. Kural yoksa tedarikçinin önceki faturalarına, sonra Paraşüt kategorisine bakılır; bulunamazsa “Diğer”."
      />
      <CardContent className="space-y-3">
        <form
          className="grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)_minmax(0,14rem)_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await saveCategoryRule({ id: null, matchType, pattern, category, priority: 100 });
              if (!r.ok) return void toast.error(r.error);
              setPattern("");
              toast.success("Kural eklendi");
            });
          }}
        >
          <Select value={matchType} onChange={(e) => setMatchType(e.target.value as MatchType)} aria-label="Eşleşme türü">
            {(Object.keys(MATCH_LABEL) as MatchType[]).map((k) => (
              <option key={k} value={k}>
                {MATCH_LABEL[k]}
              </option>
            ))}
          </Select>
          <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="Ör. Trendyol, Ambalaj, kira" aria-label="Eşleşecek metin" required />
          <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Panel kategorisi">
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Button type="submit" disabled={pending || !pattern.trim()}>
            <Plus size={16} /> Kural ekle
          </Button>
        </form>
        {rules.length ? (
          <ul className="rounded-2xl bg-surface p-1.5">
            {rules.map((r, i) => (
              <li key={r.id} className={cn("flex items-center gap-3 px-2.5 py-2 text-sm", i > 0 && "border-t border-ink/[0.06]")}>
                <Badge tone="gray">{MATCH_LABEL[r.matchType]}</Badge>
                <span className="min-w-0 flex-1 truncate font-medium text-ink">“{r.pattern}”</span>
                <span className="text-ink-mute">→</span>
                <Badge tone="blue">{r.category}</Badge>
                <IconButton
                  label="Kuralı sil"
                  tone="danger"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await deleteCategoryRule(r.id);
                      if (!res.ok) toast.error(res.error);
                    })
                  }
                >
                  <Trash2 size={15} />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-mute">Henüz kural yok; çoğu fatura tedarikçinin geçmişinden doğru kategoriye düşer.</p>
        )}
      </CardContent>
    </Card>
  );
}

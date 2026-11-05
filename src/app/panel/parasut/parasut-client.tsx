"use client";

import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  FileText,
  Link2,
  ListFilter,
  Package,
  PackageX,
  Pencil,
  PlugZap,
  Plus,
  RefreshCw,
  RotateCcw,
  ScanText,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unplug,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useOptimistic, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/panel/page-header";
import { tryAction, useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { clearQuery, FilterBar, FilterChip, fold, matches, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { Field, Input, NumberInput, Select } from "@/components/ui/form";
import { IconTile, toneFor } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip, Stat } from "@/components/ui/misc";
import { Notice, NoticeLink } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { StatBreakdown } from "@/components/ui/stat-breakdown";
import { Switch } from "@/components/ui/switch";
import { SortButton, Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import type { BreakdownGroup } from "@/lib/breakdown";
import { parseNumberTR } from "@/lib/calc/expr";
import { dateTimeTR, dateTR, num, tl, tl2 } from "@/lib/format";
import type { ReadingState } from "@/lib/photo-rules";
import { evidenceLead, factorText, HOLDS_HREF } from "@/lib/price-hold";
import { guessLinkFactor, packEvidence, packPairChoices, sameFactor, suggestIngredient, type PackEvidence } from "@/lib/product-match";
import type { IgnoredProduct } from "@/lib/product-ignore";
import { todayTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { readProductInvoice } from "@/server/actions/invoice-readings";
import {
  deleteCategoryRule,
  deleteProductLink,
  disconnectParasut,
  readParasutLines,
  runParasutSync,
  saveCategoryRule,
  saveProductLink,
  saveProductLinks,
  testParasutConnection,
  ignoreProduct,
  unignoreProduct,
} from "@/server/actions/parasut";

import { connectionBreakdown, linkedBreakdown, LINKS_ID, runsBreakdown } from "./breakdowns";

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

/** Eşitleme kaydının kaynağı (listede) */
const TRIGGER_LABEL: Record<Run["trigger"], string> = { cron: "otomatik", manual: "elle", history: "tedarikçi geçmişi" };

interface Run {
  id: number;
  trigger: "cron" | "manual" | "history";
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
  /** Ürünün en yeni kalemi: paket boyunun kanıtı (adı, açıklaması, birimi, miktarı) */
  line?: LinkLine | null;
}
/** Faturadaki kalem: paket boyunun kanıtı için (src/lib/product-match.ts packEvidence) */
interface LinkLine {
  name: string;
  description: string | null;
  unit: string | null;
  quantity: number;
}
/** Kontrol edilecek bağlantı: adında ya da biriminde yazan paket boyu çarpandan farklı (sayfa sunucuda bulur) */
export interface LinkCheck {
  linkId: number;
  /** Faturadaki birim ("Adet") */
  lineUnit: string | null;
  evidence: PackEvidence;
}
interface Ingredient {
  id: number;
  name: string;
  unit: string;
  category: string;
  /** Paket açıklaması ("Ballı cevizli Marlenka, 8 dilim"): benzer adlı ürünleri ayırt etmek için */
  packageDesc?: string | null;
  /** Bugünkü birim maliyet (₺/gr, ₺/ml, ₺/adet) */
  unitCost?: number;
}

/** Birim maliyet okunur birimle: ₺/gr → ₺/kg, ₺/ml → ₺/L */
function unitPriceText(v: number, unit: string): string {
  if (unit === "gr") return `${tl2(v * 1000)}/kg`;
  if (unit === "ml") return `${tl2(v * 1000)}/L`;
  return `${tl2(v)}/${UNIT_LABEL[unit] ?? unit}`;
}
interface Unlinked {
  productKey: string;
  productName: string;
  /** En yeni kalemin açıklaması ve miktarı (paket boyunun kanıtı) */
  description?: string | null;
  unit: string | null;
  count: number;
  lastDate: string;
  lastQuantity?: number;
  lastUnitPrice: number;
  supplier: string;
}

/** Kalemin kanıt için hâli */
const lineOf = (u: Unlinked): LinkLine => ({ name: u.productName, description: u.description ?? null, unit: u.unit, quantity: u.lastQuantity ?? 0 });

/** Formdaki çarpan: binlik ayırıcısız ("12000", "0,5"; formun tahminleri gibi) */
const factorInput = (f: number) => num(f, 3).replace(/\./g, "");

/** Kontrol kutusunda kanıtın yeri: "adında 150 AD." / "açıklamasında …" / "faturadaki birim kg" */
const evidenceWhere = (ev: PackEvidence) => (ev.source === "unit" ? `faturadaki birim ${ev.text}` : `${ev.source === "name" ? "adında" : "açıklamasında"} ${ev.text}`);

/**
 * Bağlama ya da kalem okuma onaya düşen fiyat getirdiyse (%40'tan fazla fark ya da çarpanı kesin olmayan ilk fiyat) ya
 * da bağlanan ürün mal alışı sayılmayan bir faturada çıktıysa (E-07: stoğa giriyor, gelir-gidere girmiyor; fatura
 * kontrole düştü) bildirime eklenen metin ve düğmeler: Hammaddeler'deki "Onay bekleyen fiyatlar", Faturalar'ın kontrol
 * süzgeci
 */
function heldToast(r: { held: number; flagged?: number }, router: { push: (href: string) => void }) {
  const flagged = r.flagged ?? 0;
  const text = `${r.held ? ` · ${num(r.held)} fiyat onay bekliyor` : ""}${flagged ? ` · ${num(flagged)} fatura mal alışı sayılmıyor, kategorisine bakın` : ""}`;
  const toInvoices = { label: "Faturalar", onClick: () => router.push(STOCK_ONLY_HREF) };
  if (!r.held && !flagged) return { text, options: undefined };
  return {
    text,
    options: {
      duration: 10_000,
      action: r.held ? { label: "Bak", onClick: () => router.push(HOLDS_HREF) } : toInvoices,
      ...(r.held && flagged ? { cancel: toInvoices } : {}),
    },
  };
}

/** Faturalar'ın kontrol bekleyenler süzgeci (stoğa girip gelir-gidere girmeyen faturalar orada) */
const STOCK_ONLY_HREF = "/panel/faturalar?durum=kontrol#fatura-listesi";

/** Adresten gelen değer beklenenlerden biri değilse varsayılan kullanılır */
function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function ParasutClient({
  configured,
  connection,
  redirectUri,
  env,
  cronSet,
  syncFrom,
  cursor,
  pendingEInvoices,
  stats,
  invoiceGroups = [],
  runs,
  rules,
  links,
  ingredients,
  unlinked,
  unlinkedTotal,
  ignored = [],
  lineReads,
  categories,
  checks = [],
  readState = "nokey",
  returns = null,
}: {
  configured: boolean;
  /** Paraşüt hesabı tarayıcıdan yetkilendirildi mi; refresh_token'ın yaşı (30 gün geçerli) */
  connection: { connected: boolean; refreshedAt: string | null; stale: boolean };
  /** DevHub'a kaydedilmesi gereken dönüş adresi (PARASUT_REDIRECT_URI yanlışsa null) */
  redirectUri: string | null;
  env: { name: string; set: boolean }[];
  cronSet: boolean;
  syncFrom: string | null;
  cursor: string | null;
  /** Son eşitlemede Paraşüt'te içeri alınmamış gelen e-faturalar (`ingested`: panele doğrudan alındılar) */
  pendingEInvoices: { count: number; total?: number; ingested?: boolean; sample?: { from: string | null; date: string | null }[]; at: string } | null;
  stats: { invoices: number; lastSyncedAt: string | null; fromEInvoices?: number; needsReview?: number };
  /** "Paraşüt'ten gelen fatura" kartının dökümü: türüne göre, ay ay (sunucuda kurulur, breakdowns.ts) */
  invoiceGroups?: BreakdownGroup[];
  runs: Run[];
  rules: Rule[];
  links: LinkRow[];
  ingredients: Ingredient[];
  unlinked: Unlinked[];
  /** Bağlanmayı bekleyen ürünlerin tamamı (listede ilk 40'ı) */
  unlinkedTotal: number;
  /** "Hammadde değil" denen ürünler (en yeni önce) */
  ignored?: IgnoredProduct[];
  /** E-faturaya bağlı, gider faturası olmayan kayıtlar: kalemleri okunan / sırada */
  lineReads: { read: number; pending: number };
  categories: readonly string[];
  /** Kontrol edilecek bağlantılar (adındaki paket boyu çarpandan farklı) */
  checks?: LinkCheck[];
  /** Faturadan okuma (Claude): anahtar, Ayarlar › Fotoğraftan okuma, bugünkü sınır */
  readState?: ReadingState;
  /**
   * Panele girmeyen iadeler (son 4 ay; docs/PARASUT.md §2a): gider sayılmayan satış iadeleri (yalnız sayı ve tutar;
   * müşterinin adı saklanmaz) ve Faturalar'a henüz girilmemiş tedarikçiye iadeler
   */
  returns?: { sales: { count: number; total: number }; supplier: { id: string; date: string; amount: number; invoiceNo: string | null; supplier: string }[] } | null;
}) {
  // Her eylemin kendi bekleme durumu: "Bağlantıyı dene" sürerken eşitleme düğmesi dönmez
  const [testing, startTest] = useActionTransition();
  const [syncing, startSync] = useActionTransition();
  const [resetting, startReset] = useActionTransition();
  const [reading, startRead] = useActionTransition();
  const router = useRouter();
  const [readProgress, setReadProgress] = useState<{ done: number; left: number } | null>(null);
  const busy = testing || syncing || resetting || reading;
  const [from, setFrom] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  // "Paraşüt hesabını bağla" dönüşü (baglan/geri rotası buraya yönlendirir): sonucu bir kez göster, adresi temizle
  const search = useSearchParams();
  const connectResult = search.get("baglanti");
  const connectMessage = search.get("mesaj");
  useEffect(() => {
    if (!connectResult) return;
    if (connectResult === "tamam") toast.success("Paraşüt hesabı bağlandı");
    else toast.error(connectMessage || "Paraşüt hesabı bağlanamadı");
    clearQuery(["baglanti", "mesaj"]);
  }, [connectResult, connectMessage]);
  // Tedarikçi sayfasındaki "Geçmiş faturaları al" listede görünür ama son eşitleme sayılmaz
  const syncRuns = runs.filter((r) => r.trigger !== "history");
  const lastRun = syncRuns[0];
  // Kartların dökümü (karta dokununca açılan pencere): sayfanın zaten aldığı verilerden, breakdowns.ts
  const connectionGroups = connectionBreakdown({
    configured,
    env,
    cronSet,
    syncFrom,
    cursor,
    connected: connection.connected,
    refreshedAt: connection.refreshedAt,
    stale: connection.stale,
    lastOk: syncRuns.find((r) => r.status === "ok") ?? null,
  });
  const linkGroups = linkedBreakdown(links, ingredients, unlinkedTotal, ignored.length);
  const runGroups = runsBreakdown(runs, { lastSyncedAt: stats.lastSyncedAt, lineReads, pendingEInvoices });

  // E-fatura kalemlerini beklemeden oku: her çağrı ~45 sn çalışır, sıradakiler bitene kadar sürdürülür
  const readLines = () =>
    startRead(async () => {
      const t = toast.loading("E-fatura kalemleri okunuyor…");
      let done = 0;
      let lineCount = 0;
      let corrected = 0;
      let held = 0;
      let flagged = 0;
      for (let round = 0; round < 12; round++) {
        const r = await readParasutLines();
        if (!r.ok) {
          setReadProgress(null);
          return void toast.error(r.error, { id: t });
        }
        const step = r.data.read + r.data.failed;
        done += step;
        lineCount += r.data.lines;
        corrected += r.data.corrected;
        held += r.data.held;
        flagged += r.data.flagged;
        setReadProgress({ done, left: r.data.remaining });
        if (!r.data.remaining || !step) {
          if (r.data.stoppedBy && r.data.remaining) toast.warning(`Paraşüt yavaş yanıt verdi; kalan ${num(r.data.remaining)} fatura sonraki eşitlemede okunur.`);
          break;
        }
        toast.loading(`E-fatura kalemleri okunuyor… ${num(done)} fatura okundu, ${num(r.data.remaining)} kaldı`, { id: t });
      }
      setReadProgress(null);
      const h = heldToast({ held, flagged }, router);
      toast.success(
        `${num(done)} faturanın ${num(lineCount)} kalemi okundu${corrected ? ` · ${num(corrected)} tevkifatlı faturanın tutarı belgeden düzeltildi` : ""}${h.text}`,
        { id: t, ...h.options },
      );
    });

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
        path="/panel/parasut"
        title="Paraşüt entegrasyonu"
        description="Paraşüt'teki faturalar her sabah gelir; fatura kalemlerini hammaddeye bağlayın."
        more="Paraşüt'e gelen e-faturalar (içeri alınmasa da) ve gider faturaları her sabah panele alınır: tutar, KDV, kalemler ve e-fatura PDF'i. Yeni fatura “ödenmedi” gelir; ödendiğini Tedarikçiler ya da Faturalar ekranında siz işaretlersiniz."
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!configured || busy}
              title={configured ? undefined : NOT_CONFIGURED}
             
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
            <Button disabled={!configured || busy} title={configured ? undefined : NOT_CONFIGURED} onClick={() => sync(from || null)} className="max-sm:order-first">
              <RefreshCw size={16} className={cn(syncing && "animate-spin")} /> {syncing ? "Eşitleniyor…" : "Şimdi eşitle"}
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatBreakdown
          title="Bağlantı"
          description="Paraşüt bağlantısının ayarları ve eşitlemenin zamanı. Değerler Vercel'de saklanır; burada yalnız tanımlı olup olmadıkları görünür."
          groups={connectionGroups}
          order="given"
          shares={false}
          hideTotal
        >
          <Stat
            compact
            icon={<PlugZap />}
            label="Bağlantı"
            value={!configured ? "Kurulmadı" : !connection.connected ? "Hesap bağlanmadı" : connection.stale ? "Yenilenmeli" : "Bağlı"}
            tone={!configured || !connection.connected ? "warn" : connection.stale ? "warn" : "good"}
            sub={
              !configured
                ? "Aşağıdaki kurulum adımlarını izleyin"
                : !connection.connected
                  ? "“Paraşüt hesabını bağla” ile bir kez yetkilendirin"
                  : `Her sabah 07:00–08:00${cronSet ? "" : " · CRON_SECRET eksik"}`
            }
          />
        </StatBreakdown>
        <StatBreakdown
          title="Paraşüt'ten gelen fatura"
          description="Paraşüt'e bağlı bütün faturalar türüne göre, ay ay (faturanın tarihiyle). Aya dokununca o ayın Paraşüt faturaları Faturalar'da açılır."
          groups={invoiceGroups}
          total={stats.invoices}
          unit="count"
          order="given"
          empty="Henüz Paraşüt'ten fatura gelmedi."
        >
          <Stat
            compact
            icon={<CheckCircle2 />}
            label="Paraşüt'ten gelen fatura"
            value={num(stats.invoices)}
            suffix="adet"
            info="Paraşüt'e bağlı bütün faturalar: gelen e-faturalar (içeri alınmamış olanlar dahil), içeri alınmış gider faturaları ve Paraşüt'teki karşılığıyla eşleşen Excel kayıtları."
            sub={
              stats.lastSyncedAt ? (
                <>
                  Son: {dateTimeTR(stats.lastSyncedAt)}
                  {stats.needsReview ? (
                    <a href="/panel/faturalar?durum=kontrol" className="flex w-fit items-center font-medium text-warn underline-offset-2 hover:underline pointer-coarse:min-h-11">
                      {num(stats.needsReview)} kontrol bekliyor →
                    </a>
                  ) : null}
                </>
              ) : (
                "Henüz eşitlenmedi"
              )
            }
          />
        </StatBreakdown>
        <StatBreakdown
          title="Bağlı ürün"
          description="Hammaddeye bağlanan Paraşüt ürünleri, hammadde kategorisine göre; bir hammaddeye birden çok ürün (ör. farklı paketler) bağlanabilir. Hammaddeye dokununca bağlı ürünleri listede açılır."
          groups={linkGroups}
          total={links.length}
          unit="count"
          empty="Henüz hammaddeye bağlı ürün yok."
        >
          <Stat
            compact
            icon={<Link2 />}
            label="Bağlı ürün"
            info="Hammaddeye bağlanan Paraşüt ürünleri. Bağlı ürünlerin alınan miktarı Tutarlılık'a, son birim fiyatı hammaddeye yazılır."
            value={num(links.length)}
            sub={unlinkedTotal ? `${num(unlinkedTotal)} ürün bağlanmayı bekliyor` : "Bekleyen yok"}
            tone={unlinkedTotal ? "warn" : "default"}
          />
        </StatBreakdown>
        <StatBreakdown
          title="Son eşitleme"
          description="Otomatik (her sabah) ve elle yapılan son eşitlemeler, en yenisi üstte; altında eşitlemenin bıraktığı durum."
          groups={runGroups}
          order="given"
          shares={false}
          hideTotal
          empty="Henüz eşitleme yok."
        >
          <Stat
            compact
            icon={lastRun?.status === "error" ? <XCircle /> : <CircleDashed />}
            label="Son eşitleme"
            value={lastRun ? (lastRun.status === "ok" ? "Başarılı" : lastRun.status === "error" ? "Hata" : "Sürüyor") : "–"}
            tone={lastRun?.status === "error" ? "bad" : "default"}
            sub={lastRun ? dateTimeTR(lastRun.startedAt) : "Henüz çalışmadı"}
          />
        </StatBreakdown>
      </div>

      {pendingEInvoices && pendingEInvoices.count > 0 ? (
        pendingEInvoices.ingested ? (
          <Notice
            tone="neutral"
            live="polite"
            className="mb-4"
            title={`Paraşüt'te içeri alınmamış ${num(pendingEInvoices.count)} gelen e-fatura panele doğrudan alındı${pendingEInvoices.total ? ` (toplam ${tl(pendingEInvoices.total)})` : ""}`}
          >
            <p className="break-words">
              Paraşüt&apos;te &quot;içeri al&quot; yapmanız gerekmez: tutar, KDV, kalemler ve e-fatura PDF&apos;i buradan gelir. İçeri alırsanız fatura yeniden açılmaz,
              aynı kayda bağlanır.{" "}
              <a href="/panel/faturalar?kaynak=parasut" className="font-medium text-ink underline underline-offset-2 pointer-coarse:py-3">
                Faturalarda göster →
              </a>
            </p>
          </Notice>
        ) : (
          // Yapılacak iş yok: sonraki eşitlemede kendiliğinden gelir (uyarı değil, durum)
          <Notice
            tone="neutral"
            live="polite"
            className="mb-4"
            title={`Paraşüt'te içeri alınmamış ≈ ${num(pendingEInvoices.count)} e-fatura: sonraki eşitlemede gelir`}
          >
            Paraşüt&apos;te &quot;içeri al&quot; yapmanız gerekmez.
            {pendingEInvoices.sample?.length ? ` Örnek: ${pendingEInvoices.sample.map((p) => [p.from, p.date ? dateTR(p.date) : null].filter(Boolean).join(" ")).join(", ")}.` : ""}
          </Notice>
        )
      ) : null}

      {configured && !connection.connected ? (
        <Notice
          tone="warn"
          className="mb-4"
          title="Paraşüt hesabı bağlı değil"
          text="Her sabahki eşitleme çalışmaz. Aşağıdaki Kurulum kartından “Paraşüt hesabını bağla”ya basıp Paraşüt'ün onay ekranından geçin."
        />
      ) : connection.connected && connection.stale ? (
        <Notice
          tone="warn"
          className="mb-4"
          title="Paraşüt yetkisi yenilenmeli"
          text="Paraşüt'ün verdiği yenileme hakkı 30 gün geçerli ve son yenileme eskidi. Eşitleme durduysa “Yeniden bağla” ile yetkiyi tazeleyin."
        />
      ) : null}

      {returns ? <ReturnsNotice returns={returns} /> : null}

      {/* Yan yana yalnız geniş ekranda: 1024'te kenar çubuğuyla içerik ~660 px kalır, "Yeniden eşitleme" formu sıkışırdı */}
      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-7">
          <CardHeader icon={<PlugZap />} title="Kurulum" description="Bir kez yapılır. Değerler Vercel'de saklanır, panelde gösterilmez." />
          <CardContent className="space-y-4">
            <ol className="space-y-3 text-sm text-ink-soft">
              <Step n={1} done={env.slice(0, 2).every((e) => e.set)}>
                Paraşüt <b>DevHub</b>&apos;a Paraşüt hesabınızla girip <i>“Paraşüt Kullanıcısıyım”</i> ile başvurun. İstemci hemen oluşur (inceleme beklenmez) ve size bir{" "}
                <code className="rounded bg-surface px-1">client_id</code> ile <code className="rounded bg-surface px-1">client_secret</code> verilir.
              </Step>
              <Step n={2} done={connection.connected}>
                Başvuruda <b>dönüş adresi (redirect URI)</b> olarak tam olarak şunu kaydedin:{" "}
                {redirectUri ? (
                  <code className="rounded bg-surface px-1 break-all">{redirectUri}</code>
                ) : (
                  <span className="text-bad">PARASUT_REDIRECT_URI geçerli bir https adresi değil.</span>
                )}
              </Step>
              <Step n={3} done={env[2]?.set}>
                Firma numarasını alın: Paraşüt&apos;e girince adres çubuğundaki <code className="rounded bg-surface px-1 break-words">uygulama.parasut.com/<b>123456</b>/…</code> sayısı.
              </Step>
              <Step n={4} done={configured && cronSet}>
                Vercel → lafmaliyet → Settings → Environment Variables&apos;a ekleyip yeniden deploy edin.
              </Step>
              <Step n={5} done={connection.connected}>
                Paraşüt&apos;te bağlantıyı kuracak kullanıcıya <b>Uygulama Entegrasyonları</b> yetkisini açın (Paraşüt → Ayarlar › Kullanıcılar › Düzenle), sonra aşağıdaki{" "}
                <b>Paraşüt hesabını bağla</b>&apos;ya basıp onay ekranından geçin. Panel Paraşüt parolanızı hiçbir zaman görmez; yetkiyi Paraşüt&apos;ten dilediğiniz zaman
                durdurabilirsiniz.
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
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line-strong pt-4">
              {configured ? (
                /* Tam sayfa gidiş: rota Paraşüt'ün onay ekranına 302 verir (Next yönlendirmesi değil, önden yüklenmez) */
                <a href="/panel/parasut/baglan" className={buttonClass(connection.connected ? "secondary" : "primary")}>
                  <PlugZap size={16} /> {connection.connected ? "Yeniden bağla" : "Paraşüt hesabını bağla"}
                </a>
              ) : (
                <Button disabled title={NOT_CONFIGURED}>
                  <PlugZap size={16} /> Paraşüt hesabını bağla
                </Button>
              )}
              <span className="min-w-0 flex-1 text-xs leading-5 text-ink-mute">
                {connection.connected
                  ? connection.stale
                    ? "Yetki uzun süre yenilenmedi: refresh_token 30 gün geçerli. Eşitleme bir süre çalışmadıysa yeniden bağlayın."
                    : connection.refreshedAt
                      ? `Bağlı · yetki en son ${dateTimeTR(connection.refreshedAt)} yenilendi (her eşitlemede kendiliğinden yenilenir).`
                      : "Bağlı."
                  : "Paraşüt'ün giriş ve onay ekranına gidilir; dönüşte yetki şifreli olarak burada saklanır."}
              </span>
            </div>
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
                htmlFor="psync-from"
                tip="Seçtiğiniz tarihten bugüne kadarki gider faturaları yeniden okunur. Mevcut faturalar çoğalmaz; tutar ve vade güncellenir. Ödeme durumu değişmez: Paraşüt'teki ödeme yalnız “Paraşüt'te ödendi” ipucu olur (adı okunamadan açılan fatura peşin çalışılan tedarikçiye düşerse ödendi olur)."
              >
                {/* Bugün Türkiye saatiyle (UTC gece 00–03 arasında bugünü seçtirmezdi) */}
                <Input id="psync-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} max={todayTR()} />
              </Field>
              <Button type="submit" variant="secondary" disabled={!configured || busy || !from} title={configured ? undefined : NOT_CONFIGURED}>
                <RefreshCw size={16} className={cn(syncing && from && "animate-spin")} /> Tarihten eşitle
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmReset(true)}>
                <Unplug size={16} /> Oturumu sıfırla
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="xl:col-span-5">
          <CardHeader icon={<RefreshCw />} title="Eşitleme geçmişi" description="Otomatik (her sabah) ve elle yapılan son 8 eşitleme." />
          <CardContent className="flex-1">
            {runs.length === 0 ? (
              <EmptyState
                icon={<RefreshCw />}
                title="Henüz eşitleme yok"
                description={
                  configured
                    ? "Her sabah 07:00–08:00 arasında kendiliğinden çalışır (gelen e-faturalar ve gider faturaları); beklemeden “Şimdi eşitle” ile de başlatabilirsiniz."
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
                        <span>· {TRIGGER_LABEL[r.trigger]}</span>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <ProductLinks
        links={links}
        unlinked={unlinked}
        unlinkedTotal={unlinkedTotal}
        ignored={ignored}
        ingredients={ingredients}
        lineReads={lineReads}
        onReadLines={readLines}
        reading={reading}
        readProgress={readProgress}
        canRead={configured && !busy}
        checks={checks}
        readState={readState}
      />
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

/**
 * Panele girmeyen iadeler. Tedarikçiye iade: Paraşüt satış faturası tutar, panel okumaz; eksi tutarlı fatura girilince
 * listeden düşer. Satış iadesi: bilgi (gider sayılmadı; online satış zaten iadesi düşülmüş gelir).
 */
function ReturnsNotice({ returns }: { returns: NonNullable<Parameters<typeof ParasutClient>[0]["returns"]> }) {
  const shown = returns.supplier.slice(0, 5);
  return (
    <>
      {returns.supplier.length ? (
        <Notice
          tone="warn"
          risk="para"
          live="polite"
          className="mb-4"
          title={`Tedarikçiye ${num(returns.supplier.length)} iade panele girmedi`}
          text="Faturalar'da aynı tedarikçiye eksi tutarlı fatura ekleyin; eklenince buradan kalkar."
          action={<NoticeLink href="/panel/faturalar">Faturalara git</NoticeLink>}
        >
          <ul className="space-y-0.5">
            {shown.map((r) => (
              <li key={r.id} className="break-words">
                {r.supplier} · {dateTR(r.date)} · <span className="font-medium whitespace-nowrap tabular">{tl(r.amount)}</span>
                {r.invoiceNo ? <span className="text-ink-mute"> · {r.invoiceNo}</span> : null}
              </li>
            ))}
            {returns.supplier.length > shown.length ? <li>ve {num(returns.supplier.length - shown.length)} iade daha</li> : null}
          </ul>
          <p className="break-words">Paraşüt tedarikçiye iadeyi satış faturası olarak tutar, panel okumaz; eksi tutarlı fatura maliyet ve KDV tahminini düzeltir.</p>
        </Notice>
      ) : null}
      {returns.sales.count ? (
        <Notice
          tone="neutral"
          live="polite"
          className="mb-4"
          title={`Son 4 ayda ${num(returns.sales.count)} satış iadesi gider sayılmadı (toplam ${tl(returns.sales.total)})`}
        >
          laffogato.net&apos;in ya da kafenin faturaladığı bir satışın iadesi Paraşüt&apos;te gider listesine düşer; panel onu tedarikçi faturası saymaz. Online
          satış zaten iadesi düşülmüş gelir.
        </Notice>
      ) : null}
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

function ProductLinks({
  links,
  unlinked,
  unlinkedTotal,
  ignored,
  ingredients,
  lineReads,
  onReadLines,
  reading,
  readProgress,
  canRead,
  checks,
  readState,
}: {
  links: LinkRow[];
  unlinked: Unlinked[];
  unlinkedTotal: number;
  ignored: IgnoredProduct[];
  ingredients: Ingredient[];
  lineReads: { read: number; pending: number };
  onReadLines: () => void;
  reading: boolean;
  readProgress: { done: number; left: number } | null;
  canRead: boolean;
  checks: LinkCheck[];
  readState: ReadingState;
}) {
  const [pending, start] = useActionTransition();
  const router = useRouter();
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
  const [notIngredients, unhideIgnored] = useOptimistic(ignored, (state, key: string) => state.filter((e) => e.productKey !== key));
  const ignoredShown = view === "bagli" ? [] : notIngredients.filter((e) => matches(e.productName, q));
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
      const h = heldToast(r.data, router);
      toast.success(`${u.productName} → ${ing?.name ?? "hammadde"} bağlandı · ${r.data.quantities} aylık miktar, ${r.data.prices} fiyat güncellendi${h.text}`, h.options);
    });
  };

  // Kargo, hizmet bedeli, ekipman gibi kalemler: bekleyenlerden çıkar (zil sayısına da girmez), geri alınabilir
  const ignore = (u: Unlinked) =>
    start(async () => {
      hideUnlinked(u.productKey);
      const r = await ignoreProduct({ productKey: u.productKey, productName: u.productName });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${u.productName}: hammadde değil`, {
        description: "Bekleyenlerden çıktı; listenin altındaki “Hammadde değil” bölümünden geri alınabilir.",
        action: { label: "Geri al", onClick: () => void tryAction(() => unignoreProduct(u.productKey)).then((x) => (!x || x.ok ? undefined : toast.error(x.error))) },
      });
    });
  const unignore = (e: IgnoredProduct) =>
    start(async () => {
      unhideIgnored(e.productKey);
      const r = await unignoreProduct(e.productKey);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${e.productName} yeniden bağlanmayı bekleyenlerde`);
    });

  // Hazır olanlar: hammaddesi seçilmiş (elle ya da öneriyle) ve çarpanı belli bekleyenler; tek seferde bağlanır
  const [bulkOpen, setBulkOpen] = useState(false);
  /** Toplu bağlamada çıkarılan ürünler (pencere her açılışta hepsi seçili başlar) */
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  // En çok 40 ürün × hammadde listesi: her çizimde hesaplanabilir
  const proposals = waitingShown.flatMap((u) => {
        const d = draft[u.productKey];
        if (d?.ingredientId) {
          const ing = byId.get(Number(d.ingredientId));
          const f = parseNumberTR(d.factor);
          return ing && f && f > 0 ? [{ u, ing, factor: f, updatePrice: d.updatePrice }] : [];
        }
        const sug = suggestIngredient(u.productName, ingredients, linked);
        const ing = sug ? byId.get(sug.ingredientId) : undefined;
        if (!sug || !ing) return [];
        // Bağlantının çarpanı yalnız aynı pakette gelir (suggestIngredient); başka pakette ("SÜT 5 LT") addan tahmin edilir
        const f = sug.factor ?? parseNumberTR(guessLinkFactor(lineOf(u), ing.unit) ?? "");
        return f && f > 0 ? [{ u, ing, factor: f, updatePrice: true }] : [];
  });
  const chosen = proposals.filter((p) => !skipped.has(p.u.productKey));
  const linkAll = () =>
    start(async () => {
      if (!chosen.length) return;
      for (const p of chosen) hideUnlinked(p.u.productKey);
      const r = await saveProductLinks(
        chosen.map((p) => ({ productKey: p.u.productKey, productName: p.u.productName, ingredientId: p.ing.id, factor: p.factor, updatePrice: p.updatePrice })),
      );
      if (!r.ok) return void toast.error(r.error);
      setBulkOpen(false);
      const h = heldToast(r.data, router);
      toast.success(`${num(r.data.linked)} ürün bağlandı · ${num(r.data.quantities)} aylık miktar, ${num(r.data.prices)} fiyat güncellendi${h.text}`, h.options);
    });

  const update = (l: LinkRow, patch: { ingredientId: number; factor: number; updatePrice: boolean }, done?: () => void) => {
    const ing = byId.get(patch.ingredientId);
    start(async () => {
      patchLinks({ type: "update", id: l.id, patch: { ...patch, ingredientName: ing?.name ?? l.ingredientName, unit: ing?.unit ?? l.unit } });
      done?.();
      const r = await saveProductLink({ productKey: l.productKey, productName: l.productName, ...patch });
      if (!r.ok) return void toast.error(r.error);
      const h = heldToast(r.data, router);
      toast.success(`${l.productName} güncellendi · ${r.data.quantities} aylık miktar, ${r.data.prices} fiyat yeniden hesaplandı${h.text}`, h.options);
    });
  };

  // Kontrol edilecek bağlantılar: düzeltilen (çarpanı kanıta eşitlenen) hemen düşer, sayfa yenilenince sunucu yeniden bakar
  const openChecks = checks.flatMap((c) => {
    const l = linked.find((x) => x.id === c.linkId);
    return l && !sameFactor(l.factor, c.evidence.factor) ? [{ ...c, link: l }] : [];
  });
  // "Düzelt": bağlantı listede açılır, düzenleme formu görünür
  const fix = (l: LinkRow) => {
    setQ(l.productName);
    if (view === "bekleyen") setView("bagli");
    setEditing(l.id);
    requestAnimationFrame(() => {
      const el = [...document.querySelectorAll<HTMLElement>(`[data-link-row="${l.id}"]`)].find((x) => x.getClientRects().length > 0);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el?.scrollIntoView({ block: "center", behavior: reduce ? "instant" : "smooth" });
    });
  };

  return (
    // Kart dökümündeki bağlantı (?durum=…&ara=…#urun-baglantilari) buraya kayar; telefonda üstteki sabit çubuğun altında kalmasın
    <Card id={LINKS_ID} className="mt-4 scroll-mt-[calc(var(--mobile-top-h)+1.5rem)]">
      <CardHeader
        icon={<Link2 />}
        title="Ürün → hammadde bağlantıları"
        description="Faturadaki bir kalemi (e-fatura belgesinden ya da gider faturasından) hammaddeye bağlayın; o üründen gelen miktar Tutarlılık'taki “alınan” sütununa, son birim fiyat da hammaddenin paket fiyatına yazılır. Bir kez bağlamak yeter: sonraki faturalar kendiliğinden işlenir."
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

      {lineReads.read + lineReads.pending > 0 ? (
        <div className="mx-5 mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-surface px-3.5 py-2.5 text-sm" role="status">
          <FileText size={16} className="shrink-0 text-ink-mute" aria-hidden="true" />
          <p className="min-w-0 flex-1 break-words text-ink-soft">
            <span className="font-medium text-ink">E-fatura kalemleri:</span>{" "}
            {readProgress
              ? `${num(readProgress.done)} fatura okundu, ${num(readProgress.left)} kaldı…`
              : `${num(lineReads.read)} / ${num(lineReads.read + lineReads.pending)} faturanın kalemleri okundu`}
            {!readProgress && lineReads.pending ? (
              <span className="text-ink-mute"> · {num(lineReads.pending)} sırada; her eşitleme kalan süre kadarını okur</span>
            ) : null}
          </p>
          {lineReads.pending || reading ? (
            <Button size="sm" variant="secondary" disabled={!canRead} onClick={onReadLines}>
              <RefreshCw size={14} className={cn(reading && "animate-spin")} /> {reading ? "Okunuyor…" : "Kalemleri şimdi oku"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {openChecks.length ? (
        // Satır başına eylemli liste: Ayrıntı açık başlar (docs/planlar/ux-sade.md §4.4)
        <Notice
          tone="warn"
          live="polite"
          defaultOpen
          className="mx-5 mb-3"
          title={`Kontrol edilecek bağlantılar · ${num(openChecks.length)}`}
          text="Paket boyu çarpandan farklı; çarpan doğruysa olduğu gibi bırakın."
        >
          <p className="text-pretty">Faturadaki adında ya da biriminde yazan paket boyu bağlantının çarpanından farklı. Hiçbir şey kendiliğinden değişmez.</p>
          <ul className="divide-y divide-line">
            {openChecks.map((c) => (
              <li key={c.linkId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5">
                <span className="min-w-0 text-[13px] text-pretty">
                  <span className="font-medium break-words text-ink">{c.link.productName}</span> → {c.link.ingredientName}:{" "}
                  <span className="whitespace-nowrap tabular">{factorText(c.lineUnit, c.link.factor, UNIT_LABEL[c.link.unit] ?? c.link.unit)}</span>; {evidenceWhere(c.evidence)}
                </span>
                <Button size="xs" variant="secondary" className="shrink-0" onClick={() => fix(c.link)} aria-label={`${c.link.productName} bağlantısını düzelt`}>
                  <Pencil size={13} /> Düzelt
                </Button>
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {total + notIngredients.length === 0 ? (
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

          {waitingShown.length + linkedShown.length + ignoredShown.length === 0 ? (
            <CardContent>
              <EmptyState
                title="Bu süzgece uyan ürün yok"
                description={q.trim() ? `“${q.trim()}” için sonuç bulunamadı.` : view === "bekleyen" ? "Bağlanmayı bekleyen ürün kalmadı." : "Henüz bağlı ürün yok."}
                action={
                  <Button variant="secondary" onClick={clear}>
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
                {unlinkedTotal > waiting.length ? ` / ${num(unlinkedTotal)}` : ""}
                <InfoTip text="En sık geçen 40 ürün gösterilir; bağladıkça sıradakiler gelir. Yalnız mal alışı (Hammadde & İçecek, Tatlı & Hazır Ürün, Ambalaj) ve Diğer kategorisindeki faturaların kalemleri listelenir; komisyon, kira, demirbaş ve hizmet faturaları gelmez. Hammadde olmayan kalemleri (kargo, hizmet, ekipman) bağlamayın: “Hammadde değil” deyin, listeden ve zildeki sayıdan çıkar." />
                {proposals.length ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="ml-auto normal-case tracking-normal"
                    disabled={pending}
                    onClick={() => {
                      setSkipped(new Set());
                      setBulkOpen(true);
                    }}
                  >
                    <Sparkles size={14} /> Hazır olanları bağla ({num(proposals.length)})
                  </Button>
                ) : null}
              </p>
              <ul className="space-y-2">
                {waitingShown.map((u) => {
                  const d = get(u.productKey);
                  const ing = byId.get(Number(d.ingredientId));
                  const suggestion = d.ingredientId ? null : suggestIngredient(u.productName, ingredients, linked);
                  const suggested = suggestion ? byId.get(suggestion.ingredientId) : undefined;
                  // Hammadde seçilince çarpan addaki paket bilgisinden tahmin edilir ("330ML 1X24" → 24 adet); elle yazılmışsa dokunulmaz.
                  // Adında iki sayı varsa ve birimden hangisi olduğu belli değilse ("50'Lİ X 20", 1 Adet) kutu boşalır: "1" kalıp
                  // yanlışlıkla bağlanmasın, sahibi iki olasılıktan birini seçer ya da faturadan okur
                  const choose = (id: string, known?: number | null) => {
                    const next = byId.get(Number(id));
                    const guess = known ? factorInput(known) : next && !d.factorTouched ? guessLinkFactor(lineOf(u), next.unit) : null;
                    const unsure = !known && !guess && next && !d.factorTouched && packPairChoices(lineOf(u), next.unit);
                    set(u.productKey, { ingredientId: id, ...(guess ? { factor: guess } : unsure ? { factor: "" } : {}) });
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
                            {/* Telefonda uzun ürün ve tedarikçi adı alt satıra geçer: son birim fiyat kesilmez */}
                            <p className="text-sm font-semibold break-words text-ink lg:truncate" title={u.productName}>
                              {u.productName}
                            </p>
                            <p className="text-xs break-words text-ink-mute lg:truncate" title={u.supplier}>
                              {u.supplier} · {num(u.count)} kalem · son {dateTR(u.lastDate)} · <span className="tabular">{tl2(u.lastUnitPrice)}</span>
                              {u.unit ? ` / ${u.unit}` : ""}
                            </p>
                          </div>
                        </div>
                        <div className="min-w-0">
                          <Select value={d.ingredientId} onChange={(e) => choose(e.target.value)} aria-label={`${u.productName} için hammadde`}>
                            <option value="">Hammadde seçin…</option>
                            <IngredientOptions ingredients={ingredients} />
                          </Select>
                          {suggestion && suggested ? (
                            <button
                              type="button"
                              onClick={() => choose(String(suggestion.ingredientId), suggestion.factor)}
                              className="mt-1 inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-md px-1 text-left text-xs text-info hover:underline pointer-coarse:min-h-11"
                            >
                              <Sparkles size={12} aria-hidden="true" className="shrink-0" /> Öneri: {suggested.name}
                              {/* Çarpan yalnız aynı paket bağlıysa gelir; başka paketse (1 L bağlı, 5 L geldi) addan tahmin edilir */}
                              {suggestion.reason === "link"
                                ? suggestion.factor
                                  ? ` (aynı ürün bağlı, × ${num(suggestion.factor, 3)})`
                                  : " (aynı ürün başka paketle bağlı, çarpanı kontrol edin)"
                                : ""}
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
                            className="min-w-0"
                          />
                          <span className="w-8 shrink-0">{ing ? (UNIT_LABEL[ing.unit] ?? ing.unit) : "…"}</span>
                          <InfoTip text={FACTOR_TIP} />
                        </label>
                        {/* Telefonda düğmeler sığmazsa anahtarın altına iner */}
                        <div className="flex flex-wrap items-center justify-between gap-2 lg:contents">
                          <Switch
                            checked={d.updatePrice}
                            label={`${u.productName} için fiyatı güncelle`}
                            showText
                            onText="Fiyatı güncelle"
                            offText="Fiyat elle"
                            onChange={(v) => set(u.productKey, { updatePrice: v })}
                          />
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() => ignore(u)}
                              title="Kargo, hizmet bedeli, ekipman gibi hammadde olmayan kalem: bekleyenlerden çıkar"
                              aria-label={`${u.productName}: hammadde değil, bekleyenlerden çıkar`}
                            >
                              <PackageX size={14} /> Hammadde değil
                            </Button>
                            <Button type="submit" size="sm" disabled={pending || !d.ingredientId}>
                              <Link2 size={14} /> Bağla
                            </Button>
                          </div>
                        </div>
                        <FactorHelp
                          className="lg:col-span-5"
                          productKey={u.productKey}
                          line={lineOf(u)}
                          ingredient={ing}
                          factor={d.factor}
                          onFactor={(f) => set(u.productKey, { factor: f, factorTouched: true })}
                          readState={readState}
                        />
                      </form>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {ignoredShown.length ? (
            // Aramada eşleşen varsa açık gelir (Faturalar'daki "Hammaddeye bağla" buraya düşebilir)
            <details className="group/ig mx-5 mb-4 rounded-2xl bg-surface" open={q.trim() ? true : undefined}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-2xl px-3.5 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
                <PackageX size={16} className="shrink-0 text-ink-mute" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">Hammadde değil · {num(ignoredShown.length)}</span>
                  <span className="block text-xs text-ink-mute">Bekleyenlerden çıkarılan kalemler (kargo, hizmet, ekipman). Faturadaki tutarları değişmez.</span>
                </span>
                <ChevronDown size={16} className="shrink-0 text-ink-quiet transition-transform group-open/ig:rotate-180" aria-hidden="true" />
              </summary>
              <ul className="divide-y divide-ink/[0.06] px-3.5 pb-1.5">
                {ignoredShown.map((e) => (
                  <li key={e.productKey} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-words text-ink">{e.productName}</p>
                      <p className="mt-0.5 text-xs text-ink-mute">
                        {dateTimeTR(e.at)}
                        {e.by ? ` · ${e.by}` : ""}
                      </p>
                    </div>
                    <Button size="sm" variant="secondary" className="shrink-0" disabled={pending} onClick={() => unignore(e)} aria-label={`${e.productName}: bekleyenlere geri al`}>
                      <RotateCcw size={14} /> Geri al
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {linkedShown.length ? (
            <>
              {waitingShown.length ? <p className="px-5 pb-1 text-[0.65rem] font-medium tracking-wide text-ink-mute uppercase">Bağlı ürünler · {linkedShown.length}</p> : null}
              {/* Telefon: kart listesi */}
              <ul className="mx-2 mb-2 rounded-2xl bg-surface p-1.5 md:hidden">
                {linkedShown.map((l, i) => (
                  <li key={l.id} data-link-row={l.id} className={cn("px-2.5 py-3", i > 0 && "border-t border-ink/[0.06]")}>
                    {editing === l.id ? (
                      <LinkEditor
                        link={l}
                        ingredients={ingredients}
                        byId={byId}
                        pending={pending}
                        readState={readState}
                        onCancel={() => setEditing(null)}
                        onSave={(p) => update(l, p, () => setEditing(null))}
                      />
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold break-words text-ink">{l.productName}</p>
                            <p className="mt-0.5 text-xs text-ink-mute">
                              →{" "}
                              {/* Dokunmatikte satırı büyütmeden dokunma alanı (dolgu konumlandırılmamış: alttaki anahtarın üstüne binmez) */}
                              <Link
                                href={`/panel/hammaddeler?ara=${encodeURIComponent(l.ingredientName)}`}
                                className="font-medium text-ink-soft hover:underline pointer-coarse:py-2.5"
                              >
                                {l.ingredientName}
                              </Link>{" "}
                              · <span className="tabular">× {num(l.factor, 3)}</span> {UNIT_LABEL[l.unit] ?? l.unit}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-1.5">
                            <IconButton label={`${l.productName} bağlantısını düzenle`} onClick={() => setEditing(l.id)}>
                              <Pencil size={15} />
                            </IconButton>
                            <IconButton label={`${l.productName} bağlantısını sil`} tone="danger" onClick={() => setRemoving(l)}>
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
                        <TR key={l.id} data-link-row={l.id} className="hover:bg-transparent">
                          <TD colSpan={5}>
                            <LinkEditor
                              link={l}
                              ingredients={ingredients}
                              byId={byId}
                              pending={pending}
                              readState={readState}
                              onCancel={() => setEditing(null)}
                              onSave={(p) => update(l, p, () => setEditing(null))}
                            />
                          </TD>
                        </TR>
                      ) : (
                        <TR key={l.id}>
                          <TD className="font-medium">
                            <span className="line-clamp-2 break-words" title={l.productName}>
                              {l.productName}
                            </span>
                          </TD>
                          {/* Hammadde adı sözcük sözcük kırılmasın (1024'te sütun daralıyordu) */}
                          <TD className="min-w-44">
                            <Link href={`/panel/hammaddeler?ara=${encodeURIComponent(l.ingredientName)}`} className="hover:underline">
                              {l.ingredientName}
                            </Link>
                          </TD>
                          <TD numeric>
                            × {num(l.factor, 3)} <span className="text-ink-mute">{UNIT_LABEL[l.unit] ?? l.unit}</span>
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
      <Dialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={`${num(proposals.length)} ürün için bağlantı önerisi`}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBulkOpen(false)} disabled={pending} data-autofocus className="max-sm:bg-panel">
              Vazgeç
            </Button>
            <Button onClick={linkAll} disabled={pending || !chosen.length}>
              {pending ? "Bekleyin…" : `${num(chosen.length)} ürünü bağla`}
            </Button>
          </>
        }
      >
        <p className="text-sm text-pretty text-ink-mute">
          Önerilen ya da sizin seçtiğiniz hammadde ve çarpanla bağlanır; alınan miktarlar ve fiyatlar faturalardan hesaplanır. Emin olmadığınızın işaretini kaldırın;
          fiyatı bugünkünden çok farklı çıkan (turuncu) öneride çarpanı ya da hammaddeyi kontrol edin. Bağlantıyı sonradan düzenleyebilir ya da silebilirsiniz.
        </p>
        <ul className="mt-3 max-h-[50dvh] divide-y divide-ink/[0.06] overflow-y-auto rounded-2xl bg-surface px-3">
          {proposals.map((p) => {
            const checked = !skipped.has(p.u.productKey);
            const newUnit = p.u.lastUnitPrice > 0 ? p.u.lastUnitPrice / p.factor : 0;
            const nowUnit = p.ing.unitCost ?? 0;
            const ratio = newUnit && nowUnit ? newUnit / nowUnit : null;
            const odd = ratio !== null && (ratio > 1.5 || ratio < 0.67);
            // Önerinin çarpanı (aynı ürünün bağlantısından) addaki paket boyundan farklıysa söylenir
            const ev = packEvidence(lineOf(p.u), p.ing.unit);
            const evOff = ev && !sameFactor(ev.factor, p.factor) ? ev : null;
            return (
              <li key={p.u.productKey} className="py-2.5 text-sm">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-ink pointer-coarse:size-5"
                    checked={checked}
                    onChange={() =>
                      setSkipped((cur) => {
                        const next = new Set(cur);
                        if (next.has(p.u.productKey)) next.delete(p.u.productKey);
                        else next.add(p.u.productKey);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0">
                    <span className={cn("block font-medium break-words", checked ? "text-ink" : "text-ink-mute line-through")}>{p.u.productName}</span>
                    <span className="mt-0.5 block text-xs text-ink-mute">
                      → <span className="font-medium text-ink-soft">{p.ing.name}</span>
                      {p.ing.packageDesc ? ` (${p.ing.packageDesc})` : ""} · 1 {p.u.unit ?? "birim"} ={" "}
                      <span className="tabular">
                        {num(p.factor, 3)} {UNIT_LABEL[p.ing.unit] ?? p.ing.unit}
                      </span>
                      {p.updatePrice ? " · fiyat güncellenir" : " · fiyat elle"}
                    </span>
                    {newUnit ? (
                      <span className={cn("mt-0.5 block text-xs tabular", odd ? "font-medium text-warn" : "text-ink-mute")}>
                        Son fatura {unitPriceText(newUnit, p.ing.unit)}
                        {nowUnit ? ` · şimdi ${unitPriceText(nowUnit, p.ing.unit)}` : ""}
                        {odd ? " · çok farklı, kontrol edin" : ""}
                      </span>
                    ) : null}
                    {evOff ? (
                      <span className="mt-0.5 block text-xs font-medium text-warn">
                        {evidenceLead(evOff)}: {factorText(p.u.unit, evOff.factor, UNIT_LABEL[p.ing.unit] ?? p.ing.unit)} olabilir.
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </Dialog>
    </Card>
  );
}

/** Bağlı ürünü yerinde düzenleme: hammadde, çarpan, fiyat. Enter kaydeder, Esc vazgeçer. */
function LinkEditor({
  link,
  ingredients,
  byId,
  pending,
  readState,
  onCancel,
  onSave,
}: {
  link: LinkRow;
  ingredients: Ingredient[];
  byId: Map<number, Ingredient>;
  pending: boolean;
  readState: ReadingState;
  onCancel: () => void;
  onSave: (p: { ingredientId: number; factor: number; updatePrice: boolean }) => void;
}) {
  const id = useId();
  const [ingredientId, setIngredientId] = useState(String(link.ingredientId));
  const [factor, setFactor] = useState(num(link.factor, 3));
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
        <Select id={`${id}-ing`} value={ingredientId} onChange={(e) => setIngredientId(e.target.value)} autoFocus>
          <IngredientOptions ingredients={ingredients} />
        </Select>
      </Field>
      <Field label={`Çarpan (${ing ? (UNIT_LABEL[ing.unit] ?? ing.unit) : "birim"})`} htmlFor={`${id}-factor`} error={factor && invalid && ingredientId ? "Sıfırdan büyük olmalı" : undefined}>
        <NumberInput id={`${id}-factor`} value={factor} onChange={(e) => setFactor(e.target.value)} aria-invalid={(Boolean(ingredientId) && invalid) || undefined} />
      </Field>
      <Switch checked={updatePrice} showText onText="Fiyat güncellenir" offText="Fiyat elle" label="Fiyatı güncelle" onChange={setUpdatePrice} className="md:mb-0.5" />
      <div className="flex justify-end gap-1.5 md:mb-0.5">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Vazgeç
        </Button>
        <Button type="submit" size="sm" disabled={pending || invalid}>
          Kaydet
        </Button>
      </div>
      {link.line ? (
        <FactorHelp className="md:col-span-5" productKey={link.productKey} line={link.line} ingredient={ing} factor={factor} onFactor={setFactor} readState={readState} />
      ) : null}
    </form>
  );
}

/**
 * Bağlama formunun çarpan yardımı (hammadde seçilince): adında ya da biriminde yazan paket boyu yazılan çarpandan
 * farklıysa uyarı ve "{n} yap" (packEvidence; kendiliğinden değişmez) ve "Faturadan oku" (ürünün en yeni faturası,
 * Claude Haiku; emin okunursa çarpanı doldurur, kanıtı gösterir; docs/FATURA-OKUMA.md).
 */
function FactorHelp({
  productKey,
  line,
  ingredient,
  factor,
  onFactor,
  readState,
  className,
}: {
  productKey: string;
  line: LinkLine;
  ingredient: Ingredient | undefined;
  factor: string;
  onFactor: (value: string) => void;
  readState: ReadingState;
  className?: string;
}) {
  const [reading, start] = useActionTransition();
  const [read, setRead] = useState<{ ingredientId: number; text: string } | null>(null);
  if (!ingredient) return null;
  const typed = parseNumberTR(factor);
  const ev = packEvidence(line, ingredient.unit);
  const mismatch = ev && !(typed && sameFactor(typed, ev.factor)) ? ev : null;
  // Adında iki sayı var ama birimden hangisi olduğu belli değil ("50'Lİ X 20", 1 Adet): iki olasılık, karar sahibinin
  const pair = ev ? null : packPairChoices(line, ingredient.unit);
  const unitLabel = UNIT_LABEL[ingredient.unit] ?? ingredient.unit;
  // Okuma seçilen hammaddenin birimine göre: hammadde değişince eski okuma gösterilmez
  const shown = read && read.ingredientId === ingredient.id ? read : null;
  const canRead = readState !== "nokey";
  if (!mismatch && !pair && !shown && !canRead) return null;
  const readNow = () =>
    start(async () => {
      const r = await readProductInvoice({ productKey, ingredientId: ingredient.id, mode: shown ? "force" : "manual" });
      if (!r.ok) return void toast.error(r.error);
      if (r.data.status !== "ok") return void toast.error(r.data.message);
      setRead({ ingredientId: ingredient.id, text: r.data.text });
      if (r.data.factor) {
        onFactor(factorInput(r.data.factor));
        toast.success(`Çarpan faturadan: ${factorText(r.data.lineUnit, r.data.factor, unitLabel)}`);
      }
    });
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs", className)}>
      {mismatch ? (
        <Notice
          tone="warn"
          size="line"
          className="min-w-0"
          title={`${evidenceLead(mismatch)}: ${factorText(line.unit, mismatch.factor, unitLabel)} olabilir.`}
          action={
            <Button size="xs" variant="secondary" onClick={() => onFactor(factorInput(mismatch.factor))}>
              {num(mismatch.factor, 3)} yap
            </Button>
          }
        />
      ) : null}
      {pair ? (
        <Notice
          tone="warn"
          size="line"
          className="min-w-0"
          title={`Adında “${pair.text}” yazıyor: 1 ${line.unit?.trim() || "birim"} = ${pair.choices.map((c) => `${num(c, 3)} ${unitLabel}`).join(" mi, ")} mi? Faturadan okuyun ya da doğrusunu seçin.`}
          action={
            <span className="flex flex-wrap gap-1.5">
              {pair.choices.map((c) => (
                <Button key={c} size="xs" variant={typed && sameFactor(typed, c) ? "primary" : "secondary"} onClick={() => onFactor(factorInput(c))}>
                  {num(c, 3)} yap
                </Button>
              ))}
            </span>
          }
        />
      ) : null}
      {shown ? (
        <p className="min-w-0 text-pretty text-ink-soft">
          <ScanText size={13} className="mr-1 inline-block align-[-2px]" aria-hidden="true" />
          {shown.text}
        </p>
      ) : null}
      {canRead ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={reading || readState === "off"}
          title={readState === "off" ? "Okuma kapalı (Ayarlar › Fotoğraftan okuma)" : "Ürünün en yeni faturasını okur (Claude); çarpanı doldurur, kaydetmez"}
          onClick={readNow}
        >
          <ScanText size={13} aria-hidden="true" /> {reading ? "Fatura okunuyor…" : shown ? "Yeniden oku" : "Faturadan oku"}
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- kategori kuralları

function CategoryRules({ rules, categories }: { rules: Rule[]; categories: readonly string[] }) {
  const formId = useId();
  const [pending, start] = useActionTransition();
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
          className={cn("grid gap-2 rounded-2xl sm:grid-cols-2 xl:grid-cols-[12rem_minmax(0,1fr)_minmax(0,14rem)_auto] xl:items-start", editingId !== null && "bg-surface p-3 ring-1 ring-ink/20")}
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
            <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] font-medium text-ink sm:col-span-2 xl:col-span-4">
              <Pencil size={14} aria-hidden="true" /> <span className="min-w-0 break-words">“{editingRule.pattern}” kuralını düzenliyorsunuz</span>
              <span className="font-normal text-ink-mute">· Enter kaydeder, Esc vazgeçer</span>
            </p>
          ) : null}
          <Field label="Eşleşme" htmlFor={`${formId}-type`}>
            <Select id={`${formId}-type`} value={matchType} onChange={(e) => setMatchType(e.target.value as MatchType)}>
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
             
              required
            />
          </Field>
          <Field label="Panel kategorisi" htmlFor={`${formId}-cat`}>
            <Select id={`${formId}-cat`} value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-2 sm:col-span-2 xl:col-span-1 xl:pt-[1.625rem]">
            {editingId !== null ? (
              <Button variant="ghost" onClick={reset}>
                <X size={16} /> Vazgeç
              </Button>
            ) : null}
            <Button type="submit" disabled={pending || !pattern.trim() || Boolean(duplicate)} className="max-xl:flex-1">
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
            <Button variant="secondary" size="sm" onClick={clear}>
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
                    <IconButton label={`“${r.pattern}” kuralını düzenle`} onClick={() => edit(r)}>
                      <Pencil size={15} />
                    </IconButton>
                    <IconButton label={`“${r.pattern}” kuralını sil`} tone="danger" disabled={pending} onClick={() => setRemoving(r)}>
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

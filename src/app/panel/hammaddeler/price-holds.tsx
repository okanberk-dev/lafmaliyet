"use client";

import { ChevronDown, ScanText, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useOptimistic, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { tryAction, useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input } from "@/components/ui/form";
import type { Unit } from "@/lib/calc/types";
import { dateTimeTR, dateTR, num, pct, tl2 } from "@/lib/format";
import { ESTIMATE_BADGE, ESTIMATE_TEXT, FIRST_PRICE_TEXT, HOLDS_ANCHOR, type HoldImpact } from "@/lib/price-hold";
import { bulkPrice } from "@/lib/supplier-prices";
import { cn } from "@/lib/utils";
import { readHoldInvoice } from "@/server/actions/invoice-readings";
import { saveProductLink } from "@/server/actions/parasut";
import { approvePriceHold, rejectPriceHold, undoPriceHold } from "@/server/actions/price-holds";

import { listHref } from "./breakdowns";

/** Bekleyen öneri (sayfa sunucuda kurar; fiyatlar ₺ / hammadde birimi, yüzde canlı: şimdiki fiyata göre) */
export interface HoldView {
  id: number;
  ingredientId: number;
  name: string;
  unit: Unit;
  current: number;
  proposed: number;
  /** Önerilen ÷ şimdiki − 1; şimdiki fiyat yoksa null */
  pct: number | null;
  repeats: number;
  supplier: string;
  date: string;
  invoiceNo: string | null;
  productKey: string;
  productName: string;
  /** Faturadaki kalem: miktar ve birim ("Koli"), bağlantının çarpanı */
  quantity: number;
  lineUnit: string | null;
  factor: number;
  /** Aynı hammaddenin bir önceki faturası (başka tedarikçi olabilir) */
  last: { unitPrice: number; date: string; supplier: string } | null;
  impact: HoldImpact;
  /** Hammaddenin fiyatı yok (0): faturadan gelen ilk fiyat, çarpanı faturanın biriminden gelmediği için onayda */
  first: boolean;
  /** Hammaddenin şimdiki fiyatı tahmini (varsayım): yüzde ona göre, kart söyler */
  estimate: boolean;
  /**
   * Kanıta dayalı tek öneri (sunucuda kurulur, src/lib/price-hold.ts holdSuggestion): adındaki paket boyu, faturanın
   * okunması ya da (yalnız aynı ürünün geçmişi varsa) çarpan oranı; `factor` varsa "Çarpanı X yap". "conflict": ad ile
   * okuma çelişiyor, iki değer yazar, düğme yok
   */
  suggestion: { kind: "evidence" | "reading" | "ratio" | "conflict"; factor: number | null; text: string } | null;
  /** Faturanın okunması öneri değilse bilgi satırı (aynı çarpanı doğruluyor ya da az emin) */
  reading: { text: string; low: boolean } | null;
  /** Fatura okunamadıysa nedeni */
  readError: string | null;
  /** auto: kendiliğinden bir kez okunur; manual: düğme; running: başka sekmede okunuyor; null: okuma kapalı */
  read: "auto" | "manual" | "running" | null;
  /** Saklanan okuma (ya da hatası) var: düğme "Yeniden oku" */
  hasReading: boolean;
}

/**
 * Kendiliğinden okumalar (öneri → sırada ya da okunuyor / bitti): kart yeniden çizilince, yeniden bağlanınca ya da
 * geliştirmede iki kez bağlanınca yeniden istenmesin. Kartlar useSyncExternalStore ile okur
 */
const autoReads = new Map<number, "reading" | "done">();
const autoListeners = new Set<() => void>();
/** Okumalar sırayla: birkaç kart aynı anda açılınca belge indirmeleri ve Claude istekleri üst üste binmesin */
let autoQueue: Promise<unknown> = Promise.resolve();

function subscribeAutoReads(listener: () => void) {
  autoListeners.add(listener);
  return () => void autoListeners.delete(listener);
}

function setAutoRead(id: number, state: "reading" | "done") {
  autoReads.set(id, state);
  for (const listener of autoListeners) listener();
}

/**
 * Kartın kendiliğinden okuması yol işleyicisiyle (POST /api/fiyat-onerileri/{id}/oku), sunucu eylemiyle değil: Next
 * eylemleri istemci başına tek tek yollar; 55 sn'ye varan okuma sürerken Onayla / Reddet / "Çarpanı X yap" sıraya
 * girerdi. Hata sessiz: sonuç ya da okunamama nedeni sayfa tazelenince kartta (`done`)
 */
function autoReadHold(id: number, done: () => void) {
  setAutoRead(id, "reading");
  const run = autoQueue.then(() => fetch(`/api/fiyat-onerileri/${id}/oku`, { method: "POST" }).catch(() => null));
  autoQueue = run
    .then(() => {
      setAutoRead(id, "done");
      done();
    })
    .catch(() => undefined);
}

/** Son 3 günün kararı ya da geçersiz kalan öneri ("Son kararlar") */
export interface RecentHoldView {
  id: number;
  name: string;
  unit: Unit;
  proposed: number;
  status: "approved" | "rejected" | "superseded";
  note: string | null;
  stoppedUpdates: boolean;
  decidedByName: string | null;
  /** ISO */
  decidedAt: string;
}

const STATUS_LABEL: Record<RecentHoldView["status"], string> = { approved: "Onaylandı", rejected: "Reddedildi", superseded: "Geçersiz" };

/** Kartın görünen kopyasına kaydırır (Next önceki sayfaların gizli kopyalarını tutar) */
export function scrollToHolds(smooth = false) {
  requestAnimationFrame(() => {
    const el = [...document.querySelectorAll<HTMLElement>(`#${HOLDS_ANCHOR}`)].find((x) => x.getClientRects().length > 0);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ block: "start", behavior: smooth && !reduce ? "smooth" : "instant" });
  });
}

/** "Geri al": karar geri alınır, öneri yeniden onay bekler */
async function undo(id: number, name: string) {
  const r = await tryAction(() => undoPriceHold(id));
  if (!r) return;
  if (r.ok) toast.success(`${name}: fiyat yeniden onay bekliyor`);
  else toast.error(r.error);
}

/**
 * Hammaddeler › "Onay bekleyen fiyatlar" (#fiyat-onayi): Paraşüt faturasındaki birim fiyat şimdikinden %40'tan fazla
 * farklı olan hammaddeler (docs/PARASUT.md 5b). Onayla fiyatı yazar, Reddet şimdiki fiyatı bırakır; çarpan yanlışsa
 * kanıtıyla (adındaki paket boyu, faturanın okunması; docs/FATURA-OKUMA.md) tek dokunuşla düzeltilir. Son 3 günün
 * kararları altta, geri alınabilir (bildirim kaybolduktan sonra da). Zil, Genel bakış ve sabah e-postası buraya getirir.
 */
export function PriceHolds({ pending, recent }: { pending: HoldView[]; recent: RecentHoldView[] }) {
  const [busy, start] = useActionTransition();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<HoldView | null>(null);
  const [showRecent, setShowRecent] = useState(false);
  // Onaylanan / reddedilen öneri listeden hemen düşer; sunucu sayfayı yeniden çizer
  const [items, hide] = useOptimistic(pending, (state, id: number) => state.filter((x) => x.id !== id));

  // Sayfa akarak geldiği için tarayıcının (ya da Next'in) çapa kaydırması karta ulaşamayabilir: kart çizilince bir kez
  useEffect(() => {
    if (window.location.hash === `#${HOLDS_ANCHOR}`) scrollToHolds();
  }, []);

  const approve = (x: HoldView) => {
    setBusyId(x.id);
    start(async () => {
      hide(x.id);
      const r = await tryAction(() => approvePriceHold(x.id));
      setBusyId(null);
      if (!r) return;
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${r.data.name}: ${bulkPrice(r.data.before, r.data.unit)} → ${bulkPrice(r.data.after, r.data.unit)} uygulandı`, {
        action: { label: "Geri al", onClick: () => void undo(x.id, r.data.name) },
      });
    });
  };

  const reject = (x: HoldView, stopUpdates: boolean, note: string) => {
    setBusyId(x.id);
    setRejecting(null);
    start(async () => {
      hide(x.id);
      const r = await tryAction(() => rejectPriceHold({ id: x.id, stopUpdates, note }));
      setBusyId(null);
      if (!r) return;
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${r.data.name} fiyatı değişmedi`, {
        description: r.data.stoppedUpdates ? "Bu üründen fiyat güncellemesi kapatıldı" : undefined,
        action: { label: "Geri al", onClick: () => void undo(x.id, r.data.name) },
      });
    });
  };

  // Bağlantının çarpanı düzelir: eşitleme öneriyi geçersiz sayar ve en yeni faturayı yeni çarpanla yeniden değerlendirir
  const fixFactor = (x: HoldView, factor: number) => {
    setBusyId(x.id);
    start(async () => {
      hide(x.id);
      const r = await tryAction(() => saveProductLink({ productKey: x.productKey, productName: x.productName, ingredientId: x.ingredientId, factor, updatePrice: true }));
      setBusyId(null);
      if (!r) return;
      if (!r.ok) return void toast.error(r.error);
      const f = num(factor, 3);
      // İlk fiyat (hammaddenin fiyatı yoktu) çarpan faturanın biriminden gelmedikçe yine onaya düşer (E-06)
      if (r.data.held) toast.warning(`Çarpan ${f} oldu · ${x.first ? "ilk fiyat yine onay bekliyor" : "fiyat hâlâ %40'tan fazla farklı, onay bekliyor"}`);
      else toast.success(`Çarpan ${f} oldu · ${r.data.prices ? "fiyat uygulandı" : "fiyat şimdikiyle aynı"}`);
    });
  };

  return (
    <Card id={HOLDS_ANCHOR} className="mb-6 scroll-mt-[calc(var(--mobile-top-h)+1.5rem)] lg:scroll-mt-4">
      <CardHeader
        icon={<TriangleAlert />}
        title="Onay bekleyen fiyatlar"
        description="Paraşüt faturasındaki birim fiyat şimdikinden %40'tan fazla farklı ya da hammaddenin ilk fiyatı (çarpanı faturanın biriminden gelmiyor). Çoğu zaman çarpan yanlıştır (koli ↔ adet); fiyat doğruysa onaylayın. Onaylanana kadar maliyetler şimdiki fiyatla hesaplanır; ilk fiyatı bekleyen hammadde 0 ₺ sayılır."
        meta={items.length ? <span className="font-medium text-warn tabular">{num(items.length)} hammadde</span> : null}
      />
      <CardContent className="space-y-3">
        {items.length ? (
          <ul className="divide-y divide-ink/[0.06] rounded-2xl bg-surface px-3" aria-label="Onay bekleyen fiyatlar">
            {items.map((x) => (
              <HoldItem
                key={x.id}
                x={x}
                busy={busy && busyId === x.id}
                disabled={busy}
                onApprove={() => approve(x)}
                onReject={() => setRejecting(x)}
                onFactor={(f) => fixFactor(x, f)}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-ink-mute">Onay bekleyen fiyat yok.</p>
        )}

        {recent.length ? (
          <div>
            <button
              type="button"
              onClick={() => setShowRecent((v) => !v)}
              aria-expanded={showRecent}
              className="inline-flex min-h-8 cursor-pointer items-center gap-1 text-xs font-medium text-ink-soft hover:text-ink pointer-coarse:min-h-11"
            >
              <ChevronDown size={14} className={cn("transition-transform", showRecent && "rotate-180")} aria-hidden="true" />
              Son kararlar ({num(recent.length)})
            </button>
            {showRecent ? (
              <ul className="mt-2 divide-y divide-ink/[0.06] rounded-2xl bg-surface px-3 text-xs text-ink-mute">
                {recent.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                    <span className="min-w-0 text-pretty">
                      <span className="font-medium text-ink">{d.name}</span>
                      <span className="tabular"> · {bulkPrice(d.proposed, d.unit)}</span> ·{" "}
                      <span className={cn(d.status === "approved" ? "text-good-ink" : d.status === "rejected" ? "text-bad" : "text-ink-soft")}>
                        {STATUS_LABEL[d.status]}
                        {d.note ? `: ${d.note}` : ""}
                      </span>
                      {d.status === "rejected" && d.stoppedUpdates ? " (fiyat güncellemesi kapatıldı)" : ""}
                      {d.decidedByName ? ` · ${d.decidedByName}` : ""} · <span className="tabular">{dateTimeTR(d.decidedAt)}</span>
                    </span>
                    {d.status !== "superseded" ? (
                      <Button size="xs" variant="ghost" disabled={busy} className="ml-auto" onClick={() => start(() => undo(d.id, d.name))}>
                        Geri al
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </CardContent>
      {rejecting ? <RejectDialog x={rejecting} onClose={() => setRejecting(null)} onReject={(stop, note) => reject(rejecting, stop, note)} /> : null}
    </Card>
  );
}

function HoldItem({
  x,
  busy,
  disabled,
  onApprove,
  onReject,
  onFactor,
}: {
  x: HoldView;
  busy: boolean;
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
  onFactor: (factor: number) => void;
}) {
  const up = x.pct === null || x.pct > 0;
  const unitLabel = x.lineUnit ?? "birim";
  const top = x.impact.top[0];
  const [reading, startReading] = useActionTransition();
  const router = useRouter();
  const auto = useSyncExternalStore(
    subscribeAutoReads,
    () => autoReads.get(x.id),
    () => undefined,
  );
  // Okuma bitince sayfa geçişle tazelenir: yeni kart gelene kadar "Fatura okunuyor…" kalır (düğme bir an görünmesin)
  const [refreshing, startRefresh] = useActionTransition();
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Kanıtı ve okuması olmayan kart açılınca fatura bir kez kendiliğinden okunur (öneri başına bir istek); sonuç sayfa
  // tazelenince kartta. Hata sessiz: kart okunamadı satırını gösterir. Kart artık ekranda değilse (onaylandı, başka
  // sayfaya geçildi) tazelenmez
  useEffect(() => {
    if (x.read !== "auto" || autoReads.has(x.id)) return;
    autoReadHold(x.id, () => {
      if (mounted.current) startRefresh(() => router.refresh());
    });
  }, [x.id, x.read, router, startRefresh]);

  // Başka sekme ya da yönetici okuyorsa (ya da sayfa okuma sürerken yenilendiyse) kart okuma bitene kadar 8 sn'de bir
  // tazelenir; yarıda kalan okuma 90 sn sonra "okunuyor" olmaktan çıkar, tazeleme de durur. Bu sekme okuyorsa gerekmez:
  // okuma bitince kendisi tazeler
  const selfReading = reading || auto === "reading";
  useEffect(() => {
    if (x.read !== "running" || selfReading) return;
    const t = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(t);
  }, [x.read, selfReading, router]);

  const read = () =>
    startReading(async () => {
      const r = await readHoldInvoice({ id: x.id, mode: x.hasReading ? "force" : "manual" });
      if (!r.ok) return void toast.error(r.error);
      if (r.data.status === "error") return void toast.error(r.data.message);
      if (r.data.status === "busy") return void toast.message("Bu fatura şu an okunuyor; bitince kart kendiliğinden yenilenir.");
      toast.success(`${x.name}: fatura okundu`);
    });
  // Kendiliğinden okunacak kart ilk çizimden "okunuyor" der; bu sekmede okuma bittiyse ve kart hâlâ "auto" ise (okuma
  // kapıdan döndü: sınırın fotoğraf payı, kapalı) düğme görünür
  const busyReading = selfReading || refreshing || x.read === "running" || (x.read === "auto" && auto === undefined);

  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <div className="min-w-0 space-y-0.5 text-xs text-ink-mute">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* Aynı sayfa: listede o hammaddeyi gösterir (pencere değil). Dokunmatikte 44px dokunma alanı */}
          <Link href={listHref({ ara: x.name })} className="text-sm font-semibold break-words text-ink hover:underline pointer-coarse:-my-3 pointer-coarse:py-3">
            {x.name}
          </Link>
          {x.pct !== null ? (
            // Tahmini fiyata göre yüzde gerçek bir zam ya da indirim değildir: kırmızı / yeşil değil
            <Badge tone={x.estimate ? "amber" : x.pct > 0 ? "red" : "green"} title={x.estimate ? "Faturadaki birim fiyatın tahmini (varsayım) fiyata göre farkı" : "Faturadaki birim fiyatın şimdikine göre farkı"}>
              {x.pct > 0 ? "↑" : "↓"} {pct(Math.abs(x.pct), 0)}
              {x.estimate ? ` ${ESTIMATE_BADGE}` : ""}
            </Badge>
          ) : null}
          {x.first ? (
            <Badge tone="amber" title="Hammaddenin fiyatı yoktu: faturadan gelen ilk fiyat">
              İlk fiyat
            </Badge>
          ) : null}
          {x.repeats >= 2 ? <Badge tone="gray">Son {num(x.repeats)} faturada da bu fiyat</Badge> : null}
        </p>
        <p className="text-[13px] text-ink-soft tabular">
          {x.first ? "Fiyatı yoktu" : <>Şimdi <span className="font-semibold text-ink">{bulkPrice(x.current, x.unit)}</span></>} → faturada{" "}
          <span className="font-semibold text-ink">{bulkPrice(x.proposed, x.unit)}</span>
        </p>
        {x.first ? (
          <p className="text-pretty text-warn">{FIRST_PRICE_TEXT}</p>
        ) : x.estimate ? (
          <p className="text-pretty text-warn">{ESTIMATE_TEXT}</p>
        ) : null}
        <p>
          {x.supplier} · <span className="tabular">{dateTR(x.date)}</span>
          {x.invoiceNo ? ` · ${x.invoiceNo}` : ""} ·{" "}
          <Link
            href={`/panel/faturalar?ara=${encodeURIComponent(x.invoiceNo ?? x.supplier)}#fatura-listesi`}
            className="font-medium whitespace-nowrap text-info hover:underline pointer-coarse:-my-3 pointer-coarse:py-3"
          >
            Faturayı aç
          </Link>
        </p>
        {/* Telefonda miktar, çarpan ve tutarlar bölünmeden alt satıra geçer */}
        <p className="text-pretty">
          Faturadaki ürün: {x.productName} ·{" "}
          <span className="whitespace-nowrap tabular">
            {num(x.quantity, 3)} {unitLabel} ·
          </span>{" "}
          <span className="whitespace-nowrap tabular">
            1 {unitLabel} = {num(x.factor, 3)} {x.unit}
          </span>
        </p>
        {x.last ? (
          <p>
            Önceki fatura: <span className="whitespace-nowrap tabular">{bulkPrice(x.last.unitPrice, x.unit)}</span> · {x.last.supplier} ·{" "}
            <span className="tabular">{dateTR(x.last.date)}</span>
          </p>
        ) : null}
        <p className="text-pretty">
          {!x.impact.products ? (
            "Hiçbir reçetede yok"
          ) : up ? (
            <>
              {num(x.impact.products)} ürünün maliyeti artar
              {top ? (
                <>
                  {" "}
                  · en çok {top.name} · {top.size}:{" "}
                  <span className="whitespace-nowrap tabular">
                    {tl2(top.costBefore)} → {tl2(top.costAfter)}
                  </span>
                </>
              ) : null}
            </>
          ) : x.impact.products === 1 ? (
            "1 üründe kullanılıyor; maliyeti düşer"
          ) : (
            `${num(x.impact.products)} üründe kullanılıyor; maliyetleri düşer`
          )}
        </p>
        {x.suggestion ? (
          <div className={cn("mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3 py-2", x.suggestion.kind === "reading" ? "bg-info-soft text-info" : "bg-warn-soft text-warn")}>
            <p className="min-w-0 flex-1 basis-60 text-pretty">
              {x.suggestion.kind === "reading" ? <ScanText size={13} className="mr-1 inline-block align-[-2px]" aria-hidden="true" /> : null}
              {x.suggestion.kind === "conflict" ? <TriangleAlert size={13} className="mr-1 inline-block align-[-2px]" aria-hidden="true" /> : null}
              {x.suggestion.text}
            </p>
            {x.suggestion.factor ? (
              <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onFactor(x.suggestion!.factor!)}>
                Çarpanı {num(x.suggestion.factor, 3)} yap
              </Button>
            ) : null}
          </div>
        ) : null}
        {/* Faturanın okunması: bilgi satırı, okunamadıysa nedeni, okunuyor ya da düğme */}
        {x.reading || x.readError || x.read ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {busyReading ? (
              <p className="flex items-center gap-1.5 text-info" role="status">
                <ScanText size={13} className="shrink-0 animate-pulse" aria-hidden="true" /> Fatura okunuyor…
              </p>
            ) : x.reading ? (
              <p className={cn("min-w-0 flex-1 basis-60 text-pretty", x.reading.low ? "text-warn" : "text-ink-soft")}>
                <ScanText size={13} className="mr-1 inline-block align-[-2px]" aria-hidden="true" />
                {x.reading.text}
              </p>
            ) : x.readError ? (
              <p className="min-w-0 flex-1 basis-60 text-pretty text-warn">Fatura okunamadı: {x.readError}</p>
            ) : null}
            {x.read && !busyReading ? (
              <Button size="xs" variant={x.hasReading ? "ghost" : "secondary"} disabled={disabled} onClick={read} className="shrink-0">
                <ScanText size={13} aria-hidden="true" /> {x.hasReading ? "Yeniden oku" : "Faturayı oku"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 sm:items-end">
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button size="sm" disabled={disabled} onClick={onApprove} className="pointer-coarse:min-h-11">
            {busy ? "Kaydediliyor…" : "Onayla"}
          </Button>
          <Button size="sm" variant="secondary" disabled={disabled} onClick={onReject} className="pointer-coarse:min-h-11">
            Reddet
          </Button>
        </div>
        <Link
          href={`/panel/parasut?durum=bagli&ara=${encodeURIComponent(x.productName)}#urun-baglantilari`}
          className="inline-flex min-h-8 items-center text-xs font-medium text-ink-soft hover:text-ink hover:underline max-sm:justify-center pointer-coarse:min-h-11"
        >
          Bağlantıyı düzelt
        </Link>
      </div>
    </li>
  );
}

/**
 * Reddedilen fiyatın faturası alınana ve stok partilerine girmez (çarpanı şüpheli kaldı; suspectFactorLine): karar
 * anında söylenir, Tutarlılık o ayın alımını elle yazdırır
 */
const REJECTED_QTY_TEXT = "Bu faturanın miktarı alınana ve stok değerine girmez; Tutarlılık'ta elle yazabilirsiniz.";

/** "Reddet": şimdiki fiyat kalır; istenirse bu üründen fiyat güncellemesi kapanır */
function RejectDialog({ x, onClose, onReject }: { x: HoldView; onClose: () => void; onReject: (stopUpdates: boolean, note: string) => void }) {
  const [stop, setStop] = useState(false);
  const [note, setNote] = useState("");
  const noteId = useId();
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Bu fiyat uygulanmasın mı?"
      description={
        x.first
          ? `${x.name} fiyatsız kalır. Sonraki faturanın fiyatı yeniden sorulur. ${REJECTED_QTY_TEXT}`
          : `${x.name} şimdiki fiyatında (${bulkPrice(x.current, x.unit)}) kalır. Sonraki faturada fiyat yine %40'tan fazla farklıysa yeniden sorulur. ${REJECTED_QTY_TEXT}`
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="danger" onClick={() => onReject(stop, note.trim())}>
            Reddet
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-3">
        <Checkbox label="Bu üründen fiyat güncellemesini kapat (sonraki faturaların miktarı yine sayılır)" checked={stop} onChange={(e) => setStop(e.target.checked)} />
        <Field label="Not (isteğe bağlı)" htmlFor={noteId}>
          <Input id={noteId} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="ör. Faturada koli yazılmış" />
        </Field>
      </div>
    </Dialog>
  );
}

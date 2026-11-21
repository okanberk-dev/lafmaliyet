"use client";

import {
  Bike,
  BookOpen,
  Check,
  Clock,
  CookingPot,
  ExternalLink,
  HandPlatter,
  LoaderCircle,
  MessageSquareText,
  PackageCheck,
  RefreshCw,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useClock } from "@/components/panel/live/clock";
import { updatePrefs, usePrefs } from "@/components/panel/live/prefs";
import { pushSupport, useDeviceTopics } from "@/components/panel/live/push-client";
import { refreshLive, useLive } from "@/components/panel/live/store";
import { useWakeLock } from "@/components/panel/live/wake-lock";
import { useActionTransition } from "@/components/ui/action-error";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import type { Role } from "@/lib/constants";
import { dateTimeTR, num } from "@/lib/format";
import { trClock } from "@/lib/karaoke/session";
import type { LiveOrders } from "@/lib/live";
import { pushCovers } from "@/lib/live-poll";
import { openCalls } from "@/lib/site-orders/calls";
import { lineLabel, scheduleLabel, siteOrderUrl, sortForScreen, STAGE_LABEL, waitInfo } from "@/lib/site-orders/feed";
import { boardBusy } from "@/lib/site-orders/follow";
import type { OrderStage, SiteOrder } from "@/lib/site-orders/schema";
import { stageButtons, type StageAction, type StageButton } from "@/lib/site-orders/stage";
import { lineSlot } from "@/lib/site-sales/calc";
import { cn } from "@/lib/utils";
import { advanceSiteOrder } from "@/server/actions/site-orders";

import { TableCalls } from "./table-calls";

/** Ekran açılınca ya da öne gelince son çekme bundan eskiyse site sorulur */
const OPEN_STALE_MS = 60_000;
/**
 * Yoğunken (ekranda açık sipariş ya da masa çağrısı var, son iki saatte liste değişti ya da sitede ödemesi beklenen
 * sipariş var; boardBusy) arka planda yeniden çekme
 */
const BUSY_REPULL_MS = 3 * 60_000;
/** Sakinken (gece, kapalı saat) yeniden çekme: sitenin veritabanı (Neon) uyusun diye seyrek */
const QUIET_REPULL_MS = 60 * 60_000;
/** Son çekme başarısızken yeniden deneme: site geri gelince liste bir dakikada düzelir */
const ERROR_REPULL_MS = 60_000;
/**
 * Ekranda açık sipariş varken ya da bu cihazın sipariş zili yeni siparişi bildirimle almıyorken canlı veri bu sıklıkta
 * sorulur (ETag; değişiklik yoksa 304). Bildirim açık ve ekran boşken yeni sipariş bildirimle gelir, ek sorgu yapılmaz
 * (veritabanı uyusun).
 */
const FAST_REFRESH_MS = 20_000;

const STAGE_TONE: Record<OrderStage, Tone> = { new: "amber", preparing: "blue", ready: "green" };

/** Sitenin açık siparişlerini yeniden çektirir (uç sunucu eylemi değil: ekrandaki öteki eylemler sıraya girmez) */
async function pullOrders(maxAgeMs: number): Promise<{ status: string; error?: string } | null> {
  try {
    const res = await fetch("/api/siparisler", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxAgeMs }),
      cache: "no-store",
      credentials: "same-origin",
    });
    return res.ok ? ((await res.json()) as { status: string; error?: string }) : null;
  } catch {
    return null;
  } finally {
    await refreshLive();
  }
}

/**
 * Siparişler ekranının verisi ve siteyi yeniden çektirme (docs/SITE-SIPARIS.md): canlı uçtan açık siparişler (ekranın
 * sırasıyla) ve açık masa çağrıları (15 dakikadan eskisi gösterilmez). Ekran açılınca ve öne gelince (son çekme bir
 * dakikadan eskiyse), yoğunken üç dakikada, sakinken saatte bir siteyi yeniden çektirir (ping kaçtıysa diye). Sitede
 * ödemesi beklenen sipariş varken (kartlı sipariş; en çok 30 dakika, `awaitingUntil`) ya da açık sipariş veya çağrı
 * varken ekran yoğun sayılır: ödeme pingi kaçsa da sipariş birkaç dakikada gelir. Sürekli sorgu yok. Karaoke ekranının
 * özet satırı da aynı kancayı kullanır (bar o ekranda dursa da liste güncel kalsın).
 */
export function useOrdersFeed(role: Role, serverNow: number) {
  const live = useLive();
  const prefs = usePrefs(role);
  const data: LiveOrders | null = live.data?.orders ?? null;
  const list = data ? sortForScreen(data.list) : [];
  const clock = useClock(30_000);
  const now = clock || serverNow;
  // Süresi dolan çağrı sitede pingsiz kalkar: ekran 15 dakikadan eskisini göstermez (src/lib/site-orders/calls.ts)
  const calls = data?.configured ? openCalls(data.calls, now) : [];
  const busy = boardBusy({ open: list.length + calls.length, changeAt: data?.changeAt, awaitingUntil: data?.awaitingUntil }, now);

  // Açılışta ve sekmeye dönünce: son çekme bir dakikadan eskiyse site sorulur
  useEffect(() => {
    void pullOrders(OPEN_STALE_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void pullOrders(OPEN_STALE_MS);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Arka planda yeniden çekme (ping kaçarsa; son çekme başarısızsa dakikada bir): yalnız ekran görünürken
  const failing = Boolean(data?.error);
  useEffect(() => {
    const ms = failing ? ERROR_REPULL_MS : busy ? BUSY_REPULL_MS : QUIET_REPULL_MS;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void pullOrders(ms - 30_000);
    }, ms);
    return () => window.clearInterval(id);
  }, [busy, failing]);

  // Canlı veri: ekranda açık sipariş ya da çağrı varken (aşama değişikliği ve "Gördüm" çabuk görünsün) ya da bu
  // cihazın sipariş zili yeni siparişi bildirimle almıyorken (izin yok, abonelik kaydedilemedi ya da zil açık ama
  // Sipariş bildirimleri kapalı) 20 saniyede bir; yalnız siparişe bakar (karaoke konusu bu döngüyü açmaz). Bildirim
  // açık ve ekran boşken yeni sipariş bildirimle gelir. Sipariş zili kapalı cihazda (yöneticinin dizüstü, ikinci ekran)
  // boş ekrana yeni sipariş kabuğun yedek kontrolüyle (src/lib/live-poll.ts) ya da son iki saatte sipariş olduysa üç
  // dakikalık çekmeyle gelir. Yalnız ekran görünürken: arka plandaki sekmeyi kabuğun yedek kontrolü sorar
  // (alert-center.tsx, bildirim gelmeyen zil cihazında 10 dakikada bir)
  const hasOrders = list.length + calls.length > 0;
  const publicKey = live.data?.push.publicKey ?? null;
  const topics = useDeviceTopics();
  const pushOn = pushCovers({ granted: Boolean(publicKey) && pushSupport() === "granted", topics, orderAlerts: prefs.orderAlerts, karaokeAlarms: false });
  useEffect(() => {
    if (!hasOrders && pushOn) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshLive();
    }, FAST_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [hasOrders, pushOn]);

  return { data, list, calls, now, prefs };
}

/** "Yenile": siteyi hemen yeniden çektirir (art arda basılsa da sunucu en çok on saniyede bir sorar) */
function useManualPull(role: Role) {
  const [pulling, setPulling] = useState(false);
  const manual = useCallback(async () => {
    setPulling(true);
    const r = await pullOrders(0);
    setPulling(false);
    if (r?.status === "error") toast.error("laffogato.net'e ulaşılamadı", { description: role === "admin" ? r.error : "Sorun sürerse yöneticiye haber verin." });
    else if (r?.status === "off") toast.error("laffogato.net bağlantısı kurulmamış; yönetici Ayarlar'dan bakabilir");
  }, [role]);
  return { pulling, manual };
}

/** Başlığın "Yenile" düğmesi (bağlantı kurulu değilse yok) */
export function OrdersRefreshButton({ role, configured }: { role: Role; configured: boolean }) {
  const { pulling, manual } = useManualPull(role);
  if (!configured) return null;
  return (
    <Button variant="secondary" size="sm" onClick={() => void manual()} disabled={pulling} aria-label="Siparişleri siteden yenile">
      <RefreshCw size={14} className={cn(pulling && "animate-spin")} aria-hidden="true" /> {pulling ? "Yenileniyor…" : "Yenile"}
    </Button>
  );
}

/**
 * Siparişler ekranı (docs/SITE-SIPARIS.md): laffogato.net'te (uygulama ve web) ödenmiş, hâlâ açık kafe siparişleri ve
 * masalardan "Garson çağır". Önce durum satırları (son çekme başarısız, liste kısa, okunamayan) ve bu cihazda zil
 * kapalıysa "Zili aç", sonra Masa çağrıları (yalnız varken; "Gördüm" sitenin ucuna gider), en altta siparişler. Kart:
 * nereye ("Masa 4", "Gel-al", "Kurye"), aşama, planlı saat, müşterinin adı, satırlar, ödemeden bu yana geçen süre
 * (planlı siparişte vaktine kalan ya da geciken süre), aşamayı tek dokunuşla ilerleten düğmeler (Hazırlanıyor, Hazır /
 * Masaya götürüldü / Kuryeye verildi, Teslim edildi; sitenin aşama ucuna gider, src/server/actions/site-orders.ts) ve
 * siparişi sitenin panelinde açan "Sitede aç" (iade ve iptal orada). Zil kabuktaki uyarı motorunda çalar
 * (alert-center.tsx; planlı sipariş vaktine 15 dakika kala bir kez daha, masa çağrısı kapı zili).
 */
export function OrdersBoard({ role, siteBase, recipes, serverNow }: { role: Role; siteBase: string; recipes: Record<string, string>; serverNow: number }) {
  const { data, list, calls, now, prefs } = useOrdersFeed(role, serverNow);
  // Bar ekranı: cihazın "Ekran açık kalsın" tercihiyle ekran kararmaz (Karaoke ekranı gibi)
  useWakeLock(prefs.wakeLock);
  const tables = list.filter((o) => o.fulfillment === "table" && o.stage !== "ready").length;
  const fresh = list.filter((o) => o.stage === "new").length;

  return (
    <div className="space-y-6">
      {data?.configured ? (
        <>
          <StatusLines data={data} now={now} role={role} />
          {!prefs.orderAlerts ? (
            <Notice
              tone="neutral"
              size="sm"
              title="Bu cihazda sipariş zili kapalı; sipariş ve çağrıda ses çalmaz"
              action={
                <Button size="xs" variant="secondary" onClick={() => updatePrefs(role, { orderAlerts: true })}>
                  Zili aç
                </Button>
              }
            />
          ) : null}
          {calls.length ? <TableCalls calls={calls} now={now} /> : null}
        </>
      ) : null}
      <Card>
        <CardHeader
          icon={<ShoppingBag />}
          title="Uygulama siparişleri"
          description="Aşamayı buradan tek dokunuşla ilerletin; iade ve iptal sitenin panelinde."
          meta={
            list.length ? (
              <>
                <Badge tone={fresh ? "amber" : "gray"} dot>
                  {num(list.length)} açık{fresh ? ` · ${num(fresh)} yeni` : ""}
                </Badge>
                {tables ? <Badge tone="violet">{num(tables)} masada</Badge> : null}
              </>
            ) : undefined
          }
        />
        {/* Gövde yalnız bağlantı varken: yokken liste boş, kartın altında boş pay kalırdı (sayfanın başındaki tek kutu
            söylüyor) */}
        {data?.configured ? (
          <div className="space-y-3 px-5 pb-5">
            {list.length ? (
              <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3" aria-label="Açık uygulama siparişleri">
                {list.map((o) => (
                  <OrderCard key={o.id} order={o} now={now} siteBase={siteBase} recipes={recipes} />
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-ink-mute ring-1 ring-line">
                Açık uygulama siparişi yok. Sitede bir sipariş ödenince burada görünür ve zil çalar.
              </p>
            )}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

/**
 * Son çekme başarısız, liste kısa ya da okunamayan sipariş: tek uyarı (barın işleyişi, katlanmaz). Bağlantı kapalıyken
 * satır yok: sayfanın başındaki tek kutu söylüyor (docs/planlar/ux-sade.md U6 / U7).
 */
function StatusLines({ data, now, role }: { data: LiveOrders | null; now: number; role: Role }) {
  if (!data || !data.configured) return null;
  const lines: string[] = [];
  if (data.error) {
    const ok = data.okAt ? Date.parse(data.okAt) : NaN;
    const since = Number.isFinite(ok) ? ` (son başarılı çekme ${trClock(ok).date === trClock(now).date ? trClock(ok).time : dateTimeTR(data.okAt)})` : "";
    // Hatanın ayrıntısı (anahtar adı, imza, sitenin sürümü) yalnız yöneticiye; personel yöneticiye haber verir
    lines.push(
      role === "admin"
        ? `Son kontrol başarısız: ${data.error}${since}. Siparişleri sitenin panelinde de kontrol edin.`
        : `Siparişler şu an siteden alınamıyor${since}. Yeni sipariş burada görünmeyebilir; sorun sürerse yöneticiye haber verin.`,
    );
  }
  if (!data.complete) lines.push("Sitede çok açık sipariş var; en yakın 200'ü gösteriliyor.");
  if (data.skipped) lines.push(`${num(data.skipped)} sipariş okunamadı (panel güncel olmayabilir); sitenin panelinde kontrol edin.`);
  if (data.callsSkipped) lines.push(`${num(data.callsSkipped)} masa çağrısı okunamadı (panel güncel olmayabilir).`);
  const [first, ...rest] = lines;
  if (!first) return null;
  return (
    <Notice tone="warn" size="sm" risk="bar" live="polite" title={first}>
      {rest.length
        ? rest.map((l) => (
            <p key={l}>{l}</p>
          ))
        : null}
    </Notice>
  );
}

/** Düğmenin simgesi: hazırlanıyor, gel-al hazır, masaya, kuryeye, teslim */
function stageIcon(b: StageButton, order: Pick<SiteOrder, "fulfillment">): LucideIcon {
  if (b.action === "preparing") return CookingPot;
  if (b.action === "delivered") return PackageCheck;
  return order.fulfillment === "table" ? HandPlatter : order.fulfillment === "delivery" ? Bike : Check;
}

/**
 * Eylemden sonra canlı veri. refreshLive yolda bir istek varsa onu bekler; o istek eylemden önce gönderildiyse eski
 * listeyle dönebilir, ikinci çağrı yeni hâli alır (yolda istek yoksa ikincisi 304).
 */
async function refreshAfterAction(): Promise<void> {
  await refreshLive();
  await refreshLive();
}

/**
 * Kartın aşama düğmeleri: tek dokunuş, onay sorulmaz. İstek sürerken kartın bütün düğmeleri kapalı; çift dokunuş
 * (geçiş başlamadan gelen ikinci dokunuş) gönderilmez. Sonuç bildirimle söylenir, ekran canlı uçtan yenilenir.
 */
function useStageAction(o: SiteOrder) {
  const [pending, start] = useActionTransition();
  const [tapped, setTapped] = useState<StageAction | null>(null);
  const busy = useRef(false);
  const advance = (action: StageAction) => {
    if (busy.current) return;
    busy.current = true;
    setTapped(action);
    start(async () => {
      try {
        const res = await advanceSiteOrder({ id: o.id, action, from: o.stage });
        if (res.ok) toast.success(res.data.message, res.data.note ? { description: res.data.note } : undefined);
        else toast.error(res.error);
      } catch {
        toast.error("Panele ulaşılamadı; bağlantıyı kontrol edip tekrar deneyin.");
      } finally {
        await refreshAfterAction();
        busy.current = false;
        setTapped(null);
      }
    });
  };
  return { pending: pending || tapped !== null, tapped, advance };
}

function OrderCard({ order: o, now, siteBase, recipes }: { order: SiteOrder; now: number; siteBase: string; recipes: Record<string, string> }) {
  const url = siteOrderUrl(siteBase, o.path);
  const planned = scheduleLabel(o.scheduledFor, now);
  // Planlı sipariş vaktinden sayılır (vakti gelmeden "kaldı", geçince "gecikti"); değilse ödemeden bu yana
  const wait = waitInfo(o, now);
  const table = o.fulfillment === "table";
  const isNew = o.stage === "new";
  const buttons = stageButtons(o);
  const { pending, tapped, advance } = useStageAction(o);
  return (
    <li
      className={cn(
        "flex min-w-0 flex-col gap-2.5 rounded-2xl bg-surface p-3.5 ring-1 ring-line",
        isNew && "ring-2 ring-brass-500",
        isNew && table && "bg-warn-soft/60",
      )}
      aria-busy={pending || undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn("text-lg leading-6 font-semibold tracking-tight break-words text-ink", table && "text-xl")}>{o.label}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-mute">
            {o.firstName ? <span className="font-medium text-ink-soft">{o.firstName}</span> : null}
            <span className="tabular">#{o.orderNo}</span>
            {planned ? (
              <span className="inline-flex items-center gap-1 font-medium text-info">
                <Clock size={13} aria-hidden="true" /> {planned}
              </span>
            ) : null}
          </p>
        </div>
        <Badge tone={STAGE_TONE[o.stage]} dot className="text-xs">
          {STAGE_LABEL[o.stage]}
        </Badge>
      </div>
      {o.note ? (
        // Müşterinin siparişe notu (alerji, şurupsuz…): yalnız masa ve gel-al; zile ve bildirime girmez
        <p className="flex items-start gap-1.5 rounded-xl bg-warn-soft px-3 py-2 text-[14px] leading-5 font-medium break-words text-warn">
          <MessageSquareText size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="sr-only">Müşterinin notu: </span>
            {o.note}
          </span>
        </p>
      ) : null}
      <ul className={cn("space-y-1 text-[15px] leading-6", o.stage === "ready" ? "text-ink-mute" : "text-ink")}>
        {o.lines.map((l, i) => {
          const recipe = l.menuItemId ? recipes[`${l.menuItemId}|${lineSlot(l.size)}`] : undefined;
          return (
            <li key={`${l.menuItemId}-${i}`} className="flex items-start justify-between gap-2">
              <span className="min-w-0 break-words">
                <span className="font-semibold tabular">{l.qty}×</span> {lineLabel(l)}
                {/* Müşterinin bu içeceğe notu: hazırlayan görmeli */}
                {l.note ? <span className="mt-0.5 block text-[13px] leading-5 font-medium text-warn">Not: {l.note}</span> : null}
              </span>
              {recipe ? (
                // İstemci geçişi: sayfa yeniden yüklenmez, ses kilidi ve zil kabukta açık kalır
                <Link
                  href={`/panel/receteler?ara=${encodeURIComponent(recipe)}`}
                  prefetch={false}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-quiet hover:bg-panel hover:text-ink pointer-coarse:size-11"
                  aria-label={`${l.name} reçetesi`}
                  title="Reçete defterinde aç"
                >
                  <BookOpen size={14} aria-hidden="true" />
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="mt-auto space-y-2.5 border-t border-line pt-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={cn("text-[13px] tabular", wait.late ? "font-semibold text-warn" : "text-ink-mute")}>{wait.text}</span>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass("secondary", "sm")}
              title="Siparişi sitenin panelinde aç (iade ve iptal orada)"
            >
              Sitede aç <ExternalLink size={13} aria-hidden="true" />
            </a>
          ) : null}
        </div>
        {buttons.length ? (
          // Barın dokunmatik ekranı: büyük düğmeler; dar kartta alt alta, genişte yan yana
          <div className="flex flex-wrap gap-2">
            {buttons.map((b) => {
              const Icon = stageIcon(b, o);
              return (
                <Button
                  key={b.action}
                  variant={b.primary ? "primary" : "secondary"}
                  size="lg"
                  className="h-auto min-h-12 flex-1 basis-40 py-2 text-center text-base leading-tight whitespace-normal"
                  disabled={pending}
                  onClick={() => advance(b.action)}
                  aria-label={`${o.label} #${o.orderNo}: ${b.label}`}
                >
                  {tapped === b.action ? <LoaderCircle size={18} className="shrink-0 animate-spin" aria-hidden="true" /> : <Icon size={18} className="shrink-0" aria-hidden="true" />}
                  {b.label}
                </Button>
              );
            })}
          </div>
        ) : null}
      </div>
    </li>
  );
}

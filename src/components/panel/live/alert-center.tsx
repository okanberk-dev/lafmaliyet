"use client";

import { BellRing, Plus, Volume2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Role } from "@/lib/constants";
import { alarmPlan, eventMessage, isLive, phase, sessionEnd, sessionStart, timeRange, trClock, type KaraokeSessionDTO, type PlannedAlarm } from "@/lib/karaoke/session";
import { ordersToRing, ringMessage } from "@/lib/site-orders/feed";
import { dueInstant } from "@/lib/user-reminders";
import { cn } from "@/lib/utils";
import { endKaraokeSession, extendKaraokeSession } from "@/server/actions/karaoke";
import { completeUserReminder } from "@/server/actions/user-reminders";

import { useClock } from "./clock";
import { applyOutput } from "./output-client";
import { usePrefs } from "./prefs";
import { pushSupport, registerServiceWorker, subscribeDevice } from "./push-client";
import { alarmRinging, audioState, play, scheduleBurst, startAlarm, stopAlarm, unlockAudio, useAudioState } from "./sounds";
import { liveNow, patchLive, refreshLive, useLive } from "./store";

/** Çalan uyarıların anahtarları (sayfa yenilense de aynı uyarı ikinci kez çalmasın) */
const FIRED_KEY = "laf:calan-uyarilar";
/** Duyurulan karaoke olayları (aynı yeni rezervasyon için iki kez zil çalmasın) */
const SEEN_KEY = "laf:duyurulan-olaylar";
/** Bu cihazın gördüğü laffogato.net siparişleri (aynı yeni sipariş için iki kez zil çalmasın) */
const SEEN_ORDERS_KEY = "laf:gorulen-siparisler";

function loadKeys(key: string): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveKeys(key: string, set: Set<string>) {
  try {
    window.localStorage.setItem(key, JSON.stringify([...set].slice(-300)));
  } catch {
    // Saklanamadı: bu sayfada geçerli
  }
}

const sessionName = (s: KaraokeSessionDTO) => s.customerName || (s.source === "panel" ? "Rezervasyonsuz oturum" : "Karaoke");

/**
 * Sekme arka plandayken (ya da küçültülmüşken) sistem bildirimi; izin yoksa bir şey yapmaz. Sesi sayfa kendisi
 * (seçilen hoparlörden) çaldıysa bildirim sessizdir: işletim sisteminin bildirim sesi varsayılan çıkıştan, yani
 * müziğin çaldığı Bluetooth hoparlörden gelirdi.
 */
async function notify(title: string, body: string, tag: string, url: string, opts: { requireInteraction?: boolean; silent?: boolean } = {}) {
  if (typeof document === "undefined" || document.visibilityState === "visible" || pushSupport() !== "granted") return;
  const reg = await registerServiceWorker();
  await reg
    ?.showNotification(title, { body, tag, requireInteraction: opts.requireInteraction ?? false, silent: opts.silent ?? false, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", lang: "tr", data: { url } })
    .catch(() => {});
}

/**
 * Panelin uyarı motoru (kabukta bir kez; hangi ekranda olunursa olsun çalışır): canlı veriyi yönetir, karaoke
 * oturumlarının başlangıç / az kaldı / süre doldu uyarılarını ve saatli kişisel hatırlatmaları zamanında çalar, yeni
 * rezervasyonda ve laffogato.net'ten gelen yeni uygulama siparişinde (bu cihazda sipariş zili açıksa; masa siparişi
 * daha uzun) zil çalar, süre dolunca "Haber verdim" denene kadar alarmı sürdürür ve üstte şerit gösterir.
 *
 * İstek bütçesi: bildirim açıkken yedek kontrol 10 dakikada bir, kapalıyken dakikada bir; alarm çalarken (başka
 * cihazda susturulursa burada da sussun) 15 saniyede bir. Hepsi ETag'li; değişiklik yoksa 304.
 */
export function AlertCenter({ role }: { role: Role }) {
  const live = useLive();
  const prefs = usePrefs(role);
  const router = useRouter();
  const pathname = usePathname();
  const audio = useAudioState();
  const [busy, setBusy] = useState<number | null>(null);
  /** Uzatma sitedeki bir rezervasyonla çakışıyor: personele sorulur */
  const [clash, setClash] = useState<{ s: KaraokeSessionDTO; minutes: number; message: string } | null>(null);
  const fired = useRef<Set<string> | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const seenOrders = useRef<Set<string> | null>(null);
  const bursts = useRef(new Map<string, () => void>());
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  const data = live.data;
  const sessions = useMemo(() => data?.karaoke.sessions ?? [], [data]);
  // Bugün süren ya da sürecek oturum varken saniyede bir, yoksa yarım dakikada bir
  const now = useClock(sessions.some(isLive) ? 1000 : 30_000);
  const overtime = prefs.karaokeAlarms && now ? sessions.filter((s) => phase(s, now) === "overtime") : [];
  const overtimeKey = overtime.map((s) => s.id).join(",");

  /** Karaoke, hatırlatıcı ya da Bugün ekranındaysa sunucu bileşenleri de yenilensin (Bugün ikisini de gösterir) */
  const refreshScreen = useCallback(() => {
    const p = pathRef.current;
    if (p.startsWith("/panel/karaoke") || p.startsWith("/panel/hatirlaticilarim") || p.startsWith("/panel/bugun")) router.refresh();
  }, [router]);

  // Açılışta ve sekmeye dönünce, ağ gelince canlı veri
  useEffect(() => {
    void refreshLive();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshLive();
    };
    const onOnline = () => void refreshLive();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  // Service worker: bildirim gelince canlı veriyi yenile (zil, aşağıdaki olay karşılaştırmasından çalar)
  useEffect(() => {
    if (pushSupport() === "unsupported") return;
    void registerServiceWorker();
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as { type?: string; kind?: string; title?: string; body?: string; ring?: boolean } | null;
      if (msg?.type !== "laf:push") return;
      // Servis çalışanına yanıt: sesi bu sekme (seçilen hoparlörden) çalacaksa sistem bildirimi sessiz gösterilir
      const willRing =
        prefs.sound &&
        audioState() === "ready" &&
        (msg.kind === "test" || (msg.kind === "karaoke" && (prefs.karaokeAlarms || role === "admin")) || (msg.kind === "orders" && prefs.orderAlerts));
      e.ports[0]?.postMessage({ willRing });
      void refreshLive().then(refreshScreen);
      if (msg.kind === "test") {
        if (prefs.sound) play("test");
        toast.success(msg.title ?? "Deneme bildirimi", { description: msg.body });
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [prefs.sound, prefs.karaokeAlarms, prefs.orderAlerts, role, refreshScreen]);

  // Ses çıkışı: bu cihazda seçilen hoparlör (Bluetooth hoparlörde müzik çalarken uyarılar bilgisayardan gelsin);
  // hoparlör takılıp çıkınca yeniden uygulanır
  const { outputId, outputLabel } = prefs;
  useEffect(() => {
    void applyOutput(role, { outputId, outputLabel });
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => void applyOutput(role, { outputId, outputLabel });
    md.addEventListener("devicechange", onChange);
    return () => md.removeEventListener("devicechange", onChange);
  }, [role, outputId, outputLabel]);

  // İzin verilmişse abonelik her açılışta tazelenir (sunucu anahtarı değiştiyse yenisi alınır)
  const publicKey = data?.push.publicKey ?? null;
  useEffect(() => {
    if (publicKey && pushSupport() === "granted") void subscribeDevice(publicKey, false).catch(() => null);
  }, [publicKey]);

  // Yedek kontrol
  const pushOn = Boolean(publicKey) && pushSupport() === "granted";
  const ringing = overtime.length > 0;
  useEffect(() => {
    const ms = ringing ? 15_000 : pushOn ? 10 * 60_000 : 60_000;
    const id = window.setInterval(() => void refreshLive(), ms);
    return () => window.clearInterval(id);
  }, [ringing, pushOn]);

  // Ses: ilk dokunuşta açılır
  useEffect(() => {
    const unlock = () => void unlockAudio();
    document.addEventListener("pointerdown", unlock, { capture: true });
    document.addEventListener("keydown", unlock, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", unlock, { capture: true });
      document.removeEventListener("keydown", unlock, { capture: true });
    };
  }, []);

  // Yeni / iptal / saat değişikliği: verideki olaylar bir kez duyurulur (ilk yüklemede eskiler sessizce işaretlenir)
  useEffect(() => {
    if (!data) return;
    const first = seen.current === null;
    seen.current ??= loadKeys(SEEN_KEY);
    let changed = false;
    for (const s of data.karaoke.sessions) {
      if (!s.lastEvent || !s.lastEventAt) continue;
      const key = `${s.id}:${s.lastEvent}:${s.lastEventAt}`;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      changed = true;
      // İlk yüklemede yalnız son iki dakikanın olayları duyurulur (bildirimden açılan sayfa yeniden çalmasın diye)
      if (first && Date.parse(s.lastEventAt) < liveNow() - 120_000) continue;
      const msg = eventMessage(s.lastEvent, { startsAt: sessionStart(s), endsAt: sessionEnd(s), guests: s.guests, name: s.customerName, status: s.status, paymentStatus: s.paymentStatus }, liveNow());
      if (prefs.sound && (prefs.karaokeAlarms || role === "admin")) play(s.lastEvent === "created" ? "ring" : "warn");
      const show = s.lastEvent === "created" ? toast.success : toast;
      show(msg.title, { description: msg.body, duration: 12_000, action: { label: "Gör", onClick: () => router.push("/panel/karaoke") } });
    }
    if (changed) saveKeys(SEEN_KEY, seen.current);
  }, [data, prefs.sound, prefs.karaokeAlarms, role, router]);

  // laffogato.net'ten yeni uygulama siparişi: bu cihazın görmediği her yeni (`new`) sipariş bir kez çalar; masa siparişi
  // önce ve daha uzun. Zil kapalı cihazda da görülmüş sayılır (sonradan açılınca eskiler için çalmasın).
  useEffect(() => {
    // Yayın sırasında eski sunucudan gelen yanıtta sipariş alanı olmayabilir
    if (!data?.orders) return;
    const first = seenOrders.current === null;
    seenOrders.current ??= loadKeys(SEEN_ORDERS_KEY);
    const { ring, markSeen } = ordersToRing(data.orders.list, seenOrders.current, { first, nowMs: liveNow() });
    if (!markSeen.length) return;
    for (const id of markSeen) seenOrders.current.add(id);
    saveKeys(SEEN_ORDERS_KEY, seenOrders.current);
    if (!ring.length || !prefs.orderAlerts) return;
    const table = ring.some((o) => o.fulfillment === "table");
    if (prefs.sound) play(table ? "table" : "ring");
    const msg = ringMessage(ring);
    (table ? toast.warning : toast.success)(msg.title, {
      description: msg.body,
      duration: table ? 30_000 : 15_000,
      action: { label: "Gör", onClick: () => router.push("/panel/karaoke") },
    });
    void notify(msg.title, msg.body, `siparis-${ring[0].id}`, "/panel/karaoke", { silent: prefs.sound && audioState() === "ready" });
  }, [data, prefs.orderAlerts, prefs.sound, router]);

  const fire = useCallback(
    (a: PlannedAlarm) => {
      fired.current ??= loadKeys(FIRED_KEY);
      if (fired.current.has(a.key)) return;
      fired.current.add(a.key);
      saveKeys(FIRED_KEY, fired.current);
      const s = sessions.find((x) => x.id === a.sessionId);
      if (!s || !isLive(s) || s.endedAt) return;
      const name = sessionName(s);
      const range = timeRange(sessionStart(s), sessionEnd(s));
      const silent = prefs.sound && audioState() === "ready";
      if (a.kind === "start") {
        if (prefs.sound) play("start");
        toast(`Karaoke başladı: ${name}`, { description: `${s.guests ? `${s.guests} kişi · ` : ""}${range}`, duration: 15_000 });
        void notify(`Karaoke başladı: ${name}`, range, `karaoke-start-${s.id}`, "/panel/karaoke", { silent });
      } else if (a.kind === "warn") {
        if (prefs.sound) play("warn");
        toast.warning(`${prefs.warnMinutes} dakika kaldı: ${name}`, { description: `Bitiş ${trClock(sessionEnd(s)).time}`, duration: 20_000 });
        void notify(`${prefs.warnMinutes} dakika kaldı: ${name}`, `Bitiş ${trClock(sessionEnd(s)).time}`, `karaoke-warn-${s.id}`, "/panel/karaoke", { silent });
      } else {
        // Süre doldu: şerit ve alarm döngüsü aşağıdaki evre hesabından; burada saat ilerletilir ve bildirim gider
        bursts.current.get(a.key)?.();
        bursts.current.delete(a.key);
        void notify(`Süre doldu: ${name}`, "Gruba haber verin; panelden “Haber verdim”e basın.", `karaoke-end-${s.id}`, "/panel/karaoke", { requireInteraction: true, silent });
      }
    },
    [sessions, prefs.sound, prefs.warnMinutes],
  );

  // Karaoke uyarılarını ve saatli hatırlatmaları kur
  useEffect(() => {
    if (!data) return;
    fired.current ??= loadKeys(FIRED_KEY);
    const timers: number[] = [];
    const nowMs = liveNow();
    if (prefs.karaokeAlarms) {
      for (const a of alarmPlan(data.karaoke.sessions, nowMs, prefs.warnMinutes)) {
        if (fired.current.has(a.key)) continue;
        const delay = Math.max(0, a.at - liveNow());
        timers.push(window.setTimeout(() => fire(a), delay));
        // Arka planda zamanlayıcı gecikse de bitiş sesi ses saatinden tam zamanında
        if (a.kind === "end" && prefs.sound && delay > 1000) bursts.current.set(a.key, scheduleBurst(Date.now() + delay));
      }
    }
    if (prefs.reminderAlerts) {
      for (const r of data.reminders) {
        const at = dueInstant(r);
        const key = `hatirlatici:${r.id}:${r.dueDate}:${r.dueTime}`;
        if (at === null || !r.active || fired.current.has(key) || at < nowMs - 60_000 || at > nowMs + 24 * 3_600_000) continue;
        timers.push(
          window.setTimeout(
            () => {
              fired.current?.add(key);
              if (fired.current) saveKeys(FIRED_KEY, fired.current);
              if (prefs.sound) play("reminder");
              toast(r.title, {
                description: r.note ?? "Hatırlatıcı",
                duration: 30_000,
                action: {
                  label: "Tamamlandı",
                  onClick: () =>
                    void completeUserReminder(r.id).then((res) => {
                      if (!res.ok) toast.error(res.error);
                      void refreshLive().then(refreshScreen);
                    }),
                },
              });
              void notify(`Hatırlatma: ${r.title}`, r.note ?? `Saat ${r.dueTime}`, `hatirlatici-${r.id}`, "/panel/hatirlaticilarim", {
                requireInteraction: true,
                silent: prefs.sound && audioState() === "ready",
              });
            },
            Math.max(0, at - liveNow()),
          ),
        );
      }
    }
    const map = bursts.current;
    return () => {
      for (const t of timers) window.clearTimeout(t);
      for (const cancel of map.values()) cancel();
      map.clear();
    };
  }, [data, prefs.karaokeAlarms, prefs.reminderAlerts, prefs.warnMinutes, prefs.sound, fire, refreshScreen]);

  // Süresi dolan oturum varken alarm döngüsü (ses açıksa); sekme arkadaysa başlık yanıp söner
  useEffect(() => {
    if (!overtimeKey || !prefs.sound || audio !== "ready") {
      stopAlarm();
      return;
    }
    startAlarm();
    return () => stopAlarm();
  }, [overtimeKey, prefs.sound, audio]);
  useEffect(() => {
    if (!overtimeKey) return;
    const original = document.title;
    let on = false;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        document.title = original;
        return;
      }
      on = !on;
      document.title = on ? "⏰ Süre doldu!" : original;
    }, 1000);
    return () => {
      window.clearInterval(id);
      document.title = original;
    };
  }, [overtimeKey]);

  async function acknowledge(s: KaraokeSessionDTO) {
    setBusy(s.id);
    patchLive((d) => ({ ...d, karaoke: { ...d.karaoke, sessions: d.karaoke.sessions.map((x) => (x.id === s.id ? { ...x, endedAt: new Date(liveNow()).toISOString() } : x)) } }));
    if (alarmRinging() && overtime.length <= 1) stopAlarm();
    const res = await endKaraokeSession(s.id);
    setBusy(null);
    if (!res.ok) toast.error(res.error);
    void refreshLive().then(refreshScreen);
  }

  async function extend(s: KaraokeSessionDTO, minutes: number, force = false) {
    setBusy(s.id);
    const res = await extendKaraokeSession(s.id, minutes, { force });
    setBusy(null);
    if (res.ok && res.data.conflict) {
      // Sitedeki bir rezervasyonla çakışıyor: uzatılmadı, personele sorulur
      setClash({ s, minutes, message: res.data.conflict.message });
      return;
    }
    if (res.ok) {
      patchLive((d) => ({
        ...d,
        karaoke: { ...d.karaoke, sessions: d.karaoke.sessions.map((x) => (x.id === s.id ? { ...x, extraMinutes: x.extraMinutes + minutes, endedAt: null } : x)) },
      }));
      toast.success(`${sessionName(s)}: +${minutes} dk`, { description: `Yeni bitiş ${trClock(sessionEnd(s) + minutes * 60_000).time}` });
    } else toast.error(res.error);
    void refreshLive().then(refreshScreen);
  }

  const timedReminderToday = (data?.reminders ?? []).some((r) => {
    const at = dueInstant(r);
    return at !== null && at > now && at - now < 24 * 3_600_000;
  });
  const needsSound = prefs.sound && audio === "locked" && ((prefs.karaokeAlarms && sessions.some((s) => isLive(s) && sessionEnd(s) > now)) || (prefs.reminderAlerts && timedReminderToday) || overtime.length > 0);

  return (
    <>
      {overtime.length ? (
        <div role="alert" className="no-print fixed inset-x-0 top-0 z-[70] px-3 pt-[max(0.5rem,env(safe-area-inset-top))] lg:left-[17.5rem]">
          <div className="mx-auto max-w-3xl space-y-2">
            {overtime.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-bad px-4 py-3 text-white shadow-[0_12px_40px_rgba(0,0,0,0.25)]">
                <BellRing size={20} className="shrink-0 motion-safe:animate-bounce" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Karaoke süresi doldu: {sessionName(s)}</p>
                  <p className="text-[13px] text-white/85 tabular">
                    {s.guests ? `${s.guests} kişi · ` : ""}
                    Bitiş {trClock(sessionEnd(s)).time} · {Math.max(0, Math.round((now - sessionEnd(s)) / 60_000))} dk geçti. Gruba haber verin.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy === s.id}
                    onClick={() => void extend(s, 15)}
                    className="inline-flex h-11 cursor-pointer items-center gap-1 rounded-xl bg-white/15 px-3 text-sm font-medium hover:bg-white/25 disabled:opacity-60"
                  >
                    <Plus size={15} aria-hidden="true" /> 15 dk
                  </button>
                  <button
                    type="button"
                    disabled={busy === s.id}
                    onClick={() => void acknowledge(s)}
                    className="inline-flex h-11 cursor-pointer items-center rounded-xl bg-white px-4 text-sm font-semibold text-bad hover:bg-white/90 disabled:opacity-60"
                  >
                    Haber verdim
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={clash !== null}
        onClose={() => setClash(null)}
        onConfirm={() => {
          const c = clash;
          setClash(null);
          if (c) void extend(c.s, c.minutes, true);
        }}
        title="Sitede rezervasyon var"
        description={clash?.message}
        confirmLabel="Yine de uzat"
        tone="primary"
      />
      {needsSound ? (
        <button
          type="button"
          onClick={() => void unlockAudio()}
          className={cn(
            "no-print fixed right-4 z-[65] inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-white shadow-[0_8px_28px_rgba(0,0,0,0.25)]",
            "bottom-[calc(var(--mobile-nav-h)+0.75rem)] lg:bottom-6",
          )}
        >
          <Volume2 size={16} aria-hidden="true" /> Sesli uyarılar için dokunun
        </button>
      ) : null}
    </>
  );
}

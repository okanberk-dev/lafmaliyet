"use client";

import { CalendarClock, ExternalLink, Hourglass, MicVocal, Plus, RefreshCw, RotateCcw, Square, Timer, Trash2, Undo2, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { startedOnThisDevice } from "@/components/panel/live/alert-center";
import { useClock } from "@/components/panel/live/clock";
import { DeviceAlerts } from "@/components/panel/live/device-alerts";
import { usePrefs } from "@/components/panel/live/prefs";
import { liveNow, refreshLive, useLive } from "@/components/panel/live/store";
import { useWakeLock } from "@/components/panel/live/wake-lock";
import { useActionTransition } from "@/components/ui/action-error";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import { Notice, NoticeLink } from "@/components/ui/notice";
import type { Role } from "@/lib/constants";
import { karaokeStaleLine } from "@/lib/karaoke/freshness";
import { overlapText, siteOverlaps } from "@/lib/karaoke/overlap";
import {
  cancelledBadgeText,
  countdown,
  dayLabel,
  durationLabel,
  isHold,
  isLive,
  phase,
  sessionEnd,
  sessionStart,
  timeRange,
  trClock,
  type KaraokeSessionDTO,
  type Phase,
} from "@/lib/karaoke/session";
import { KARAOKE_DELETE_FREE_MINUTES, KARAOKE_REQUEST_TEXT, karaokeDeleteMode, reopenRefusal, type KaraokeDeleteAsk } from "@/lib/karaoke/timer-requests";
import { cn } from "@/lib/utils";
import {
  deleteKaraokeTimer,
  endKaraokeSession,
  extendKaraokeSession,
  reopenKaraokeSession,
  requestKaraokeTimerDelete,
  startKaraokeTimer,
  syncKaraokeNow,
} from "@/server/actions/karaoke";
import { withdrawStaffRequest } from "@/server/actions/staff-requests";

const PRESETS = [30, 60, 90, 120] as const;

const nameOf = (s: KaraokeSessionDTO) => s.customerName || (s.source === "panel" ? "Rezervasyonsuz" : "İsimsiz rezervasyon");

/** Rezervasyonun durumu (sitedeki): renk tek başına anlam taşımasın diye metinle */
function statusBadge(s: KaraokeSessionDTO): { tone: Tone; text: string } {
  if (s.source === "panel") return { tone: "gray", text: s.createdBy ? `Panelden · ${s.createdBy}` : "Panelden" };
  if (s.status === "cancelled") return { tone: "red", text: cancelledBadgeText(s.paymentStatus, s.refund) };
  if (isHold(s)) return { tone: "gray", text: "Ödeme bekleniyor" };
  if (s.status === "requested") return { tone: "amber", text: "Onay bekliyor" };
  return s.paymentStatus === "paid" ? { tone: "green", text: "Ödendi" } : { tone: "green", text: "Onaylı · kasada ödenecek" };
}

const PHASE_BADGE: Record<Phase, { tone: Tone; text: string } | null> = {
  upcoming: null,
  active: { tone: "blue", text: "Sürüyor" },
  overtime: { tone: "red", text: "Süre doldu" },
  done: { tone: "gray", text: "Bitti" },
  cancelled: null,
  held: null,
};

/**
 * Karaoke ekranı (personel ve yönetici): şu an süren oturum(lar) büyük geri sayımla, hızlı sayaç, bugünün listesi,
 * yaklaşan rezervasyonlar ve bu cihazın uyarı ayarları. Bugünün verisi canlı uçtan gelir (sayaçlar sunucu saatiyle
 * sayar); yaklaşan liste sayfayla gelir.
 */
export function KaraokeBoard({
  role,
  upcoming,
  siteAdminBase,
  configured,
  serverNow,
}: {
  role: Role;
  upcoming: KaraokeSessionDTO[];
  /** Sayfanın çizildiği an (ilk çizimde sunucu ve tarayıcı aynı saati kullansın) */
  serverNow: number;
  /** Yönetici: rezervasyonu sitenin panelinde açan adres (…/admin/mobil/karaoke) */
  siteAdminBase: string | null;
  configured: boolean;
}) {
  const live = useLive();
  const prefs = usePrefs(role);
  useWakeLock(prefs.wakeLock);

  // Bugünün ve yarının oturumları canlı veriden (sayaçlar onunla güncel), daha ilerisi sayfanın verisinden
  const sessions = useMemo(() => {
    const fresh = live.data?.karaoke.sessions;
    if (!fresh) return upcoming;
    const windowEnd = Date.parse(`${trClock(liveNow()).date}T00:00:00Z`) - 3 * 3_600_000 + 2 * 86_400_000;
    return [...fresh, ...upcoming.filter((s) => sessionStart(s) >= windowEnd)].sort((a, b) => sessionStart(a) - sessionStart(b) || a.id - b.id);
  }, [live.data, upcoming]);
  // Süren ya da sürecek oturum varken saniyede bir (geri sayım), yoksa yarım dakikada bir; ilk çizimde sayfanın saati
  const clock = useClock(sessions.some(isLive) ? 1000 : 30_000);
  const now = clock || serverNow;
  const today = trClock(now).date;

  // Sayfa açılışındaki arka plan eşitlemesi bitince yeni bir şey varsa gelsin
  useEffect(() => {
    const id = window.setTimeout(() => void refreshLive(), 4000);
    return () => window.clearTimeout(id);
  }, []);

  // Son çekme düştüyse (ping kaçmış olabilir) ekran söyler; panel kopyayı kendisi yeniden dener (src/lib/karaoke/freshness.ts)
  const stale = configured ? karaokeStaleLine(live.data?.karaoke.error, live.data?.karaoke.okAt, now, role) : null;
  const running = sessions.filter((s) => ["active", "overtime"].includes(phase(s, now)));
  const todays = sessions.filter((s) => s.date === today || (sessionStart(s) < now && sessionEnd(s) > now - 3_600_000));
  const next = sessions.find((s) => phase(s, now) === "upcoming" && isLive(s));
  const later = sessions.filter((s) => s.date > today);
  // Sayaçların bekleyen silme istekleri (E-15; canlı uçtan): satırda kim istedi, isteyene "İsteği geri çek"
  const rowEnv: RowEnv = { role, meId: live.data?.me.id ?? null, asks: live.data?.karaoke.deleteAsks ?? [] };

  return (
    <div className="space-y-6">
      {/* Tek kutu (docs/planlar/ux-sade.md U6 / U7): siparişler panelindeki ayrı "bağlantı yok" satırı kalktı; kurulum
          talimatı yalnız yöneticide, geliştirici ayrıntısında. Bağlantı sunucunun ayarı, sayfayla gelir: canlı bölge değil */}
      {!configured ? (
        role === "admin" ? (
          <Notice
            tone="neutral"
            title="Site bağlantısı kurulmadı: rezervasyon ve sipariş gelmiyor"
            text="Hızlı sayaç çalışır."
            action={<NoticeLink href="#baglanti">Bağlantı</NoticeLink>}
            tech="İki projeye (laffogato.net ve bu panel) aynı KARAOKE_SYNC_SECRET eklenince rezervasyon ve siparişler buraya kendiliğinden gelir."
          />
        ) : (
          <Notice tone="neutral" title="Site bağlı değil: rezervasyon ve sipariş buraya gelmez" text="Hızlı sayacı kullanın." />
        )
      ) : null}
      {stale ? <Notice tone="warn" risk="bar" live="polite" title={stale} /> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          {running.length ? (
            running.map((s) => <RunningCard key={s.id} session={s} now={now} warnMinutes={prefs.warnMinutes} />)
          ) : (
            <Card>
              <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-surface text-ink-mute ring-1 ring-line">
                  <MicVocal size={22} aria-hidden="true" />
                </span>
                <p className="text-lg font-semibold tracking-tight text-ink">Oda şu an boş</p>
                {next ? (
                  <p className="text-sm text-ink-mute">
                    Sıradaki: <span className="font-medium text-ink">{dayLabel(next.date, now)} {timeRange(sessionStart(next), sessionEnd(next))}</span> · {nameOf(next)}
                    {next.guests ? ` · ${next.guests} kişi` : ""} · <span className="tabular">{durationLabel(Math.round((sessionStart(next) - now) / 60_000))} sonra</span>
                  </p>
                ) : (
                  <p className="text-sm text-ink-mute">Yaklaşan rezervasyon yok. Rezervasyonsuz gelen grup için hızlı sayaç açın.</p>
                )}
              </div>
            </Card>
          )}
          <TodayList sessions={todays} now={now} siteAdminBase={siteAdminBase} configured={configured} env={rowEnv} />
          <UpcomingList sessions={later} now={now} siteAdminBase={siteAdminBase} admin={role === "admin"} env={rowEnv} />
        </div>
        <div className="space-y-4">
          <QuickTimer sessions={sessions} now={now} />
          <DeviceAlerts role={role} karaoke />
        </div>
      </div>
    </div>
  );
}

function useSessionActions() {
  const [pending, start] = useActionTransition();
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success?: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error);
      if (success) toast.success(success);
      await refreshLive();
    });
  return { pending, run };
}

/** Satırların ortak bağlamı: kimin baktığı ve sayaçların bekleyen silme istekleri (canlı uçtan) */
interface RowEnv {
  role: Role;
  meId: number | null;
  asks: KaraokeDeleteAsk[];
}

function RunningCard({ session: s, now, warnMinutes }: { session: KaraokeSessionDTO; now: number; warnMinutes: number }) {
  const { pending, run } = useSessionActions();
  const [confirmEnd, setConfirmEnd] = useState(false);
  /** Uzatma sitedeki bir rezervasyonla çakışıyor: personele sorulur, onaylanınca yine de uzatılır */
  const [clash, setClash] = useState<{ minutes: number; message: string } | null>(null);
  const [extending, startExtend] = useActionTransition();
  const extend = (minutes: number, force = false) =>
    startExtend(async () => {
      const res = await extendKaraokeSession(s.id, minutes, { force });
      if (!res.ok) return void toast.error(res.error);
      if (res.data.conflict) return void setClash({ minutes, message: res.data.conflict.message });
      await refreshLive();
    });
  const start = sessionStart(s);
  const end = sessionEnd(s);
  const p = phase(s, now);
  const left = end - now;
  const progress = Math.min(1, Math.max(0, (now - start) / (end - start)));
  const soon = p === "active" && warnMinutes > 0 && left <= warnMinutes * 60_000;
  return (
    <Card className={cn("overflow-hidden", p === "overtime" && "ring-2 ring-bad")}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-mute">
            <Badge tone={p === "overtime" ? "red" : soon ? "amber" : "blue"} dot>
              {p === "overtime" ? "Süre doldu" : soon ? "Az kaldı" : "Sürüyor"}
            </Badge>
            <span className="tabular">{timeRange(start, end)}</span>
            {s.extraMinutes ? <span>· +{s.extraMinutes} dk uzatıldı</span> : null}
          </p>
          <h2 className="mt-1.5 text-xl font-semibold tracking-tight break-words text-ink">
            {nameOf(s)}
            {s.guests ? (
              <span className="ml-2 inline-flex items-center gap-1 text-base font-normal text-ink-mute">
                <Users size={16} aria-hidden="true" /> {s.guests} kişi
              </span>
            ) : null}
          </h2>
          {s.note ? <p className="mt-1 text-sm break-words text-ink-mute">Not: {s.note}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-[13px] text-ink-mute">{p === "overtime" ? "Bitişten bu yana" : "Kalan süre"}</p>
          <p className={cn("text-5xl leading-none font-semibold tracking-tight tabular sm:text-6xl", p === "overtime" ? "text-bad" : soon ? "text-warn" : "text-ink")} aria-live="off">
            {p === "overtime" ? `+${countdown(now - end)}` : countdown(left)}
          </p>
        </div>
      </div>
      <div className="px-5 pt-4">
        <div className="h-2.5 overflow-hidden rounded-full bg-surface ring-1 ring-line" role="progressbar" aria-label="Geçen süre" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <div className={cn("h-full rounded-full transition-[width] duration-1000 ease-linear", p === "overtime" ? "bg-bad" : soon ? "bg-warn" : "bg-ink")} style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2 px-5 pt-4 pb-5">
        <Button variant="secondary" disabled={pending || extending} onClick={() => extend(15)}>
          <Plus size={15} /> 15 dk
        </Button>
        <Button variant="secondary" disabled={pending || extending} onClick={() => extend(30)}>
          <Plus size={15} /> 30 dk
        </Button>
        {p === "overtime" ? (
          <Button disabled={pending} onClick={() => run(() => endKaraokeSession(s.id), "Alarm susturuldu")} className="ml-auto">
            Haber verdim
          </Button>
        ) : (
          <Button variant="ghost" disabled={pending} onClick={() => setConfirmEnd(true)} className="ml-auto">
            <Square size={14} /> Erken bitir
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        onConfirm={() => {
          setConfirmEnd(false);
          run(() => endKaraokeSession(s.id), `${nameOf(s)} bitirildi`);
        }}
        title={`${nameOf(s)} şimdi bitirilsin mi?`}
        description="Sayaç durur, alarm çalmaz. Yanlışlıkla bitirirseniz bugünün listesinden geri açabilirsiniz."
        confirmLabel="Bitir"
        tone="primary"
      />
      <ConfirmDialog
        open={clash !== null}
        onClose={() => setClash(null)}
        onConfirm={() => {
          const c = clash;
          setClash(null);
          if (c) extend(c.minutes, true);
        }}
        title="Sitede rezervasyon var"
        description={clash?.message}
        confirmLabel="Yine de uzat"
        tone="primary"
      />
    </Card>
  );
}

function QuickTimer({ sessions, now }: { sessions: KaraokeSessionDTO[]; now: number }) {
  const [minutes, setMinutes] = useState<number>(60);
  const [custom, setCustom] = useState("");
  const [label, setLabel] = useState("");
  const [guests, setGuests] = useState("");
  const [pending, start] = useActionTransition();
  /** Sunucunun sorduğu çakışma (sitede o saatte rezervasyon var): onaylanınca yine de başlatılır */
  const [ask, setAsk] = useState<string | null>(null);
  const chosen = custom ? Number(custom.replace(",", ".")) : minutes;
  const valid = Number.isFinite(chosen) && chosen >= 5 && chosen <= 720;
  const endsAt = now + (valid ? chosen : 0) * 60_000;
  // Sunucunun kuralıyla aynı (src/lib/karaoke/overlap.ts): yazarken uyarı, başlatırken sunucu ayrıca sorar
  const clash = valid ? overlapText(siteOverlaps({ start: now, end: endsAt }, sessions), now) : null;

  function submit(force = false) {
    if (!valid) return void toast.error("Süre 5 dakika ile 12 saat arasında olmalı");
    start(async () => {
      const res = await startKaraokeTimer({ minutes: Math.round(chosen), label: label.trim() || null, guests: guests ? Number(guests) : null, force });
      if (!res.ok) return void toast.error(res.error);
      if (res.data.conflict) return void setAsk(res.data.conflict.message);
      startedOnThisDevice(res.data.id);
      toast.success(`Sayaç başladı · ${durationLabel(Math.round(chosen))}`, { description: `Bitiş ${trClock(endsAt).time}; süre dolunca alarm çalar.` });
      setLabel("");
      setGuests("");
      setCustom("");
      await refreshLive();
    });
  }

  return (
    <Card>
      <CardHeader icon={<Timer />} title="Hızlı sayaç" description="Rezervasyonsuz gelen grup için: süreyi seçin, başlatın; süre dolunca alarm çalar." />
      <div className="space-y-3 px-5 pb-5">
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Süre">
          {PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={!custom && minutes === m}
              onClick={() => {
                setMinutes(m);
                setCustom("");
              }}
              className={cn(
                "flex h-12 cursor-pointer flex-col items-center justify-center rounded-xl text-sm font-semibold ring-1 transition-colors ring-inset",
                !custom && minutes === m ? "bg-ink text-white ring-ink" : "bg-surface text-ink ring-line-strong hover:ring-ink/30",
              )}
            >
              {m < 60 ? `${m} dk` : m % 60 ? `${Math.floor(m / 60)},5 sa` : `${m / 60} sa`}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Özel süre (dk)" htmlFor="ks-ozel">
            <Input id="ks-ozel" inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, ""))} placeholder="ör. 45" />
          </Field>
          <Field label="Kişi" htmlFor="ks-kisi">
            <Input id="ks-kisi" inputMode="numeric" value={guests} onChange={(e) => setGuests(e.target.value.replace(/[^\d]/g, "").slice(0, 3))} placeholder="isteğe bağlı" />
          </Field>
        </div>
        <Field label="Ad ya da not" htmlFor="ks-ad">
          <Input id="ks-ad" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="ör. Mehmet, doğum günü" />
        </Field>
        {clash ? (
          <Notice tone="warn" size="sm" title={`${clash} Sayacın bitişi ${trClock(endsAt).time}.`} />
        ) : null}
        <Button onClick={() => submit()} disabled={pending || !valid} className="w-full" size="lg">
          <Hourglass size={16} /> {pending ? "Başlatılıyor…" : valid ? `${durationLabel(Math.round(chosen))} başlat` : "Süre seçin"}
        </Button>
      </div>
      <ConfirmDialog
        open={ask !== null}
        onClose={() => setAsk(null)}
        onConfirm={() => {
          setAsk(null);
          submit(true);
        }}
        title="Sitede rezervasyon var"
        description={ask}
        confirmLabel="Yine de başlat"
        tone="primary"
      />
    </Card>
  );
}

/**
 * Silme (E-15): yönetici panel sayacını doğrudan siler; personel açılışından sonraki ilk 10 dakikada doğrudan, sonra
 * nedenini yazıp silinmesini ister (Onaylar › Karaoke). Kural sunucuyla aynı (src/lib/karaoke/timer-requests.ts); saat
 * sunucunun. Bekleyen istek satırda görünür; isteyen geri çekebilir.
 */
function SessionRow({ s, now, siteAdminBase, showDay = false, env }: { s: KaraokeSessionDTO; now: number; siteAdminBase: string | null; showDay?: boolean; env: RowEnv }) {
  const { pending: rowPending, run } = useSessionActions();
  const [deletePending, startAction] = useActionTransition();
  const pending = rowPending || deletePending;
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Silme isteğinin penceresi: açılınca istemci anahtarı üretilir (çift dokunuş ikinci istek açmaz) */
  const [askKey, setAskKey] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const admin = env.role === "admin";
  const deleteMode = karaokeDeleteMode(s, admin ? "admin" : "staff", now);
  const asks = env.asks.filter((a) => a.sessionId === s.id);
  const mine = asks.find((a) => a.byId !== null && a.byId === env.meId);
  const openAsk = () => {
    setReason("");
    setAskKey(crypto.randomUUID());
  };
  function remove() {
    startAction(async () => {
      const res = await deleteKaraokeTimer(s.id);
      if (!res.ok) return void toast.error(res.error);
      // Pencere açıkken 10 dakika doldu: sayaç silinmedi, neden sorulur
      if (!res.data.deleted) return void (toast.info(KARAOKE_REQUEST_TEXT.askOnly), openAsk());
      toast.success("Sayaç silindi");
      await refreshLive();
    });
  }
  function ask() {
    const key = askKey;
    if (!key) return;
    if (reason.trim().length < 3) return void (toast.error(KARAOKE_REQUEST_TEXT.messageShort), document.getElementById(`ks-sil-neden-${s.id}`)?.focus());
    startAction(async () => {
      const res = await requestKaraokeTimerDelete({ id: s.id, message: reason.trim(), clientKey: key });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Silme isteği yöneticiye gönderildi", { description: "Onaylanana kadar sayaç listede kalır." });
      setAskKey(null);
      setReason("");
      await refreshLive();
    });
  }
  function withdraw(requestId: number) {
    startAction(async () => {
      const res = await withdrawStaffRequest(requestId);
      if (!res.ok) return void toast.error(res.error);
      toast.success("İstek geri çekildi");
      await refreshLive();
    });
  }
  const p = phase(s, now);
  const status = statusBadge(s);
  const phaseBadge = PHASE_BADGE[p];
  const start = sessionStart(s);
  const end = sessionEnd(s);
  return (
    <li className={cn("flex flex-wrap items-start gap-x-3 gap-y-2 px-5 py-3", (p === "cancelled" || p === "held") && "opacity-60")}>
      <div className="w-[7.5rem] shrink-0 pt-0.5 text-sm font-semibold text-ink tabular">
        {showDay ? <span className="block text-xs font-normal text-ink-mute">{dayLabel(s.date, now)}</span> : null}
        {timeRange(start, end)}
      </div>
      {/* Ad en az 7rem: geniş düğme sığmazsa (telefonda "Silinmesini iste", "İsteği geri çek") alt satıra iner, ad harf harf kırılmaz */}
      <div className="min-w-0 grow basis-28">
        <p className={cn("font-medium break-words text-ink", p === "cancelled" && "line-through")}>
          {nameOf(s)}
          {s.guests ? <span className="ml-1.5 text-[13px] font-normal text-ink-mute">· {s.guests} kişi</span> : null}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge tone={status.tone} dot>
            {status.text}
          </Badge>
          {phaseBadge ? <Badge tone={phaseBadge.tone}>{phaseBadge.text}</Badge> : null}
          {p === "upcoming" && isLive(s) && start - now < 6 * 3_600_000 ? <span className="text-xs text-ink-mute tabular">{durationLabel(Math.round((start - now) / 60_000))} sonra</span> : null}
          {s.totalMinor ? <span className="text-xs text-ink-mute tabular">· {(s.totalMinor / 100).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} ₺</span> : null}
          {s.endedBy && p === "done" ? <span className="text-xs text-ink-mute">· {s.endedBy}</span> : null}
          {asks.map((a) =>
            admin ? (
              <Link key={a.requestId} href={`/panel/onaylar#istek-${a.requestId}`} className="rounded-full pointer-coarse:py-2" title="Onaylar'da karar verin">
                <Badge tone="amber">{a.by} silinmesini istedi</Badge>
              </Link>
            ) : (
              <Badge key={a.requestId} tone="amber">
                {a === mine ? KARAOKE_REQUEST_TEXT.pending : `${a.by} silinmesini istedi`}
              </Badge>
            ),
          )}
        </p>
        {s.note ? <p className="mt-1 text-[13px] break-words text-ink-mute">Not: {s.note}</p> : null}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {p === "done" && s.endedAt && !reopenRefusal(s, now) ? (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => reopenKaraokeSession(s.id), "Sayaç yeniden açıldı")}>
            <RotateCcw size={14} /> Geri aç
          </Button>
        ) : null}
        {siteAdminBase && s.externalId ? (
          <a
            href={`${siteAdminBase}/${encodeURIComponent(s.externalId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex size-8 items-center justify-center rounded-lg bg-surface text-ink-mute ring-1 ring-line ring-inset hover:text-ink pointer-coarse:size-11"
            aria-label={`${nameOf(s)} rezervasyonunu sitenin panelinde aç`}
            title="Sitenin panelinde aç (onay, iptal, iade orada)"
          >
            <ExternalLink size={14} />
          </a>
        ) : null}
        {mine ? (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => withdraw(mine.requestId)} className="min-h-11 sm:min-h-8">
            <Undo2 size={14} /> {KARAOKE_REQUEST_TEXT.withdraw}
          </Button>
        ) : deleteMode === "direct" ? (
          <IconButton label={`${nameOf(s)} sayacını sil`} tone="danger" disabled={pending} onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} />
          </IconButton>
        ) : deleteMode === "request" && !asks.length ? (
          <Button variant="secondary" size="sm" disabled={pending} onClick={openAsk} className="min-h-11 sm:min-h-8">
            {KARAOKE_REQUEST_TEXT.deleteAsk}
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          remove();
        }}
        title={`${nameOf(s)} sayacı silinsin mi?`}
        description={
          admin
            ? "Yanlış açılan sayaç için. Karaoke geçmişinden, doluluktan ve aylık özetteki rezervasyonsuz oturum sayısından da düşer."
            : `Yanlış açılan sayaç için. Açılışından ${KARAOKE_DELETE_FREE_MINUTES} dakika sonra silmek yöneticinin onayıyla olur.`
        }
      />
      <Dialog
        open={askKey !== null}
        onClose={() => setAskKey(null)}
        title={`${nameOf(s)} sayacının silinmesini isteyin`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAskKey(null)} disabled={pending} className="max-sm:bg-panel">
              Vazgeç
            </Button>
            <Button variant="danger" onClick={ask} disabled={pending}>
              {pending ? "Gönderiliyor…" : KARAOKE_REQUEST_TEXT.deleteAsk}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-mute">
            Sayacın açılışından {KARAOKE_DELETE_FREE_MINUTES} dakika geçti. Yönetici onaylarsa sayaç silinir; o zamana kadar listede kalır ve sayar.
          </p>
          <Field label={KARAOKE_REQUEST_TEXT.reasonLabel} htmlFor={`ks-sil-neden-${s.id}`} hint="zorunlu">
            <Textarea id={`ks-sil-neden-${s.id}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} placeholder="ör. yanlışlıkla iki kez açıldı" />
          </Field>
        </div>
      </Dialog>
    </li>
  );
}

function TodayList({ sessions, now, siteAdminBase, configured, env }: { sessions: KaraokeSessionDTO[]; now: number; siteAdminBase: string | null; configured: boolean; env: RowEnv }) {
  const [pending, start] = useActionTransition();
  function sync() {
    start(async () => {
      const res = await syncKaraokeNow();
      if (!res.ok) return void toast.error(res.error);
      const r = res.data;
      toast.success("laffogato.net ile eşitlendi", { description: r.status === "ok" ? `${r.created} yeni, ${r.updated} güncellenen, ${r.removed} kaldırılan${r.skipped ? `, ${r.skipped} okunamayan satır atlandı (silinmedi)` : ""}` : "Değişiklik yok" });
      await refreshLive();
    });
  }
  return (
    <Card>
      <CardHeader
        icon={<CalendarClock />}
        title="Bugün"
        description={sessions.length ? `${sessions.filter(isLive).length} oturum` : undefined}
        actions={
          configured ? (
            <Button variant="secondary" size="sm" onClick={sync} disabled={pending}>
              <RefreshCw size={14} className={cn(pending && "animate-spin")} /> {pending ? "Eşitleniyor…" : "Eşitle"}
            </Button>
          ) : undefined
        }
      />
      {sessions.length ? (
        <ul className="divide-y divide-line border-t border-line">
          {sessions.map((s) => (
            <SessionRow key={s.id} s={s} now={now} siteAdminBase={siteAdminBase} env={env} />
          ))}
        </ul>
      ) : (
        <EmptyState icon={<MicVocal />} title="Bugün karaoke yok" description="Sitede rezervasyon yapılınca burada görünür ve zil çalar." />
      )}
    </Card>
  );
}

function UpcomingList({ sessions, now, siteAdminBase, admin, env }: { sessions: KaraokeSessionDTO[]; now: number; siteAdminBase: string | null; admin: boolean; env: RowEnv }) {
  if (!sessions.length) return null;
  const live = sessions.filter((s) => s.status !== "cancelled" && !isHold(s));
  return (
    <Card>
      <CardHeader
        icon={<CalendarClock />}
        title="Yaklaşan rezervasyonlar"
        description={`${admin ? "Önümüzdeki 45 gün" : "Önümüzdeki 7 gün"} · ${live.length} rezervasyon`}
      />
      <ul className="divide-y divide-line border-t border-line">
        {sessions.map((s) => (
          <SessionRow key={s.id} s={s} now={now} siteAdminBase={siteAdminBase} showDay env={env} />
        ))}
      </ul>
    </Card>
  );
}

"use client";

import { BellOff, BellRing, ChevronDown, MonitorSmartphone, Send, Volume2 } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { SEND_OFFLINE_TEXT, tryAction } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { ToggleRow } from "@/components/ui/toggle-row";
import type { Role } from "@/lib/constants";
import { hiddenTabNote } from "@/lib/live-poll";
import { sendTestPush, setPushTopics } from "@/server/actions/push";

import { OUTPUT_TIPS, OutputPicker } from "./output-picker";
import { updatePrefs, usePrefs, WARN_CHOICES } from "./prefs";
import { currentEndpoint, noteDeviceTopics, pushSupport, subscribeDevice, unsubscribeDevice, type PushSupport } from "./push-client";
import { play, unlockAudio, useAudioState } from "./sounds";
import { useLive } from "./store";

const noopSubscribe = () => () => {};

/**
 * "Bu cihazda uyarılar": bildirim izni ve aboneliği (sekme kapalıyken bile yeni rezervasyon, yeni uygulama siparişi ve
 * sabah hatırlatma bildirimi), ses ve sesin çalacağı hoparlör, sipariş zili, karaoke alarmları, kaç dakika kala
 * uyarılacağı ve ekranın açık kalması. Tercihler cihaza özeldir: bardaki tablet çalar, yöneticinin telefonu yalnız
 * bildirim alabilir.
 */
export function DeviceAlerts({ role, karaoke = false }: { role: Role; karaoke?: boolean }) {
  const prefs = usePrefs(role);
  const live = useLive();
  const publicKey = live.data?.push.publicKey ?? null;
  // İzin durumu tarayıcıdan okunur (sunucuda "desteklenmiyor"); izin değişince `rev` yeniden okutur
  const [rev, setRev] = useState(0);
  const support = useSyncExternalStore<PushSupport>(noopSubscribe, pushSupport, () => "unsupported");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [topics, setTopics] = useState<{ karaoke: boolean; reminders: boolean; orders: boolean; approvals: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const audio = useAudioState();

  useEffect(() => {
    void currentEndpoint().then(setEndpoint);
  }, [rev]);
  // İzin verilmişse kayıt tazelenir ve bu cihazın tercihleri (karaoke / sabah özeti) sunucudan gelir
  useEffect(() => {
    if (!publicKey || pushSupport() !== "granted") return;
    void subscribeDevice(publicKey, false).then(async (res) => {
      if (!res.ok) return;
      setTopics({ karaoke: res.karaoke, reminders: res.reminders, orders: res.orders, approvals: res.approvals });
      setEndpoint(await currentEndpoint());
    });
  }, [publicKey]);

  async function enable() {
    if (!publicKey) return void toast.error("Bildirim anahtarı hazır değil; sayfayı yenileyin");
    setBusy(true);
    const res = await subscribeDevice(publicKey, true);
    setBusy(false);
    setRev((r) => r + 1);
    if (!res.ok) return void toast.error(res.error);
    setTopics({ karaoke: res.karaoke, reminders: res.reminders, orders: res.orders, approvals: res.approvals });
    setEndpoint(await currentEndpoint());
    toast.success("Bildirimler bu cihazda açık", { description: "Sekme kapalıyken de yeni rezervasyon, sipariş ve hatırlatmalar gelir." });
  }

  async function disable() {
    setBusy(true);
    await unsubscribeDevice();
    setBusy(false);
    setEndpoint(null);
    setTopics(null);
    toast.success("Bu cihazda bildirimler kapatıldı");
  }

  async function changeTopic(key: "karaoke" | "reminders" | "orders", value: boolean) {
    if (!endpoint) return;
    const next = { karaoke: topics?.karaoke ?? true, reminders: topics?.reminders ?? true, orders: topics?.orders ?? role === "staff", approvals: topics?.approvals ?? true, [key]: value };
    const prev = topics;
    setTopics(next);
    const res = await tryAction(() => setPushTopics(endpoint, next));
    // Kaydedilemeyen seçim anahtarda kalmaz (E-51: atılan eylemin bildirimi tryAction'dan)
    if (!res?.ok) {
      setTopics(prev);
      if (res) toast.error(res.error);
      return;
    }
    noteDeviceTopics(next);
  }

  async function test() {
    setBusy(true);
    // Bağlantı yoksa "Gönderilemedi" (kaydedilen bir şey yok; "Kaydedilemedi" kasa raporu kayboldu sandırır)
    const res = await tryAction(() => sendTestPush(), { offline: SEND_OFFLINE_TEXT });
    setBusy(false);
    if (!res) return;
    if (res.ok) toast.success("Deneme bildirimi gönderildi", { description: `${res.data.sent} cihaz` });
    else toast.error(res.error);
  }

  const subscribed = support === "granted" && Boolean(endpoint);
  const tips = [
    karaoke
      ? "Sekmeyi Chrome'da açık bırakın: yeni sipariş ve rezervasyonda zil, bitime az kala uyarı, süre dolunca alarm çalar."
      : "Saatli hatırlatmalar panel açıkken saatinde çalar; bildirim açıksa sekme kapalıyken de gelir.",
    "Tarayıcı sesi ancak sayfaya bir kez dokununca açar; açılış sonrası ilk dokunuş yeter.",
    OUTPUT_TIPS.bluetooth,
    OUTPUT_TIPS.permission,
  ];
  // Bildirim yokken arka plandaki sekmenin ne yaptığı (karaoke sayfasında; bu cihazın zil tercihlerine göre)
  const note = karaoke ? hiddenTabNote(prefs) : null;
  const status =
    support === "unsupported"
      ? { tone: "gray" as const, text: "Desteklenmiyor" }
      : support === "denied"
        ? { tone: "red" as const, text: "İzin kapalı" }
        : subscribed
          ? { tone: "green" as const, text: "Bildirimler açık" }
          : { tone: "amber" as const, text: "Bildirimler kapalı" };

  return (
    <Card>
      <CardHeader
        icon={<MonitorSmartphone />}
        title="Bu cihazda uyarılar"
        meta={
          <Badge tone={status.tone} dot>
            {status.text}
          </Badge>
        }
      />
      <div className="space-y-2.5 px-5 pb-5">
        {support === "unsupported" ? (
          <p className="rounded-2xl bg-surface px-4 py-3 text-[13px] leading-5 text-ink-mute ring-1 ring-line">
            Bu tarayıcı bildirim desteklemiyor. Bilgisayarda Chrome ya da Edge kullanın; iPhone&apos;da paneli Paylaş › Ana Ekrana Ekle ile uygulama gibi açınca
            bildirim gelir. Sekme açıkken sesli uyarılar yine çalışır.{note ? ` ${note}` : null}
          </p>
        ) : support === "denied" ? (
          <Notice tone="bad" size="sm" title="Bu cihazda bildirim izni kapalı: uyarılar gelmez">
            Adres çubuğundaki site ayarları simgesinden (kilit) Bildirimler&apos;i “İzin ver” yapın, sonra sayfayı yenileyin.
            {note ? ` ${note}` : null}
          </Notice>
        ) : !subscribed ? (
          // Metin dar sütuna sıkışmasın: kart darsa (telefon, karaoke ekranının yan sütunu) düğme alt satıra iner, not ayrı
          <div className="rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
            <div className="flex flex-wrap items-center gap-3">
              <BellRing size={18} className="shrink-0 text-ink-mute" aria-hidden="true" />
              <p className="min-w-0 flex-1 basis-40 text-[13px] leading-5 text-ink-soft">
                Sekme kapalı ya da küçültülmüşken de bildirim gelsin; yeni rezervasyon bildirimi siz kapatana kadar ekranda kalır.
              </p>
              <Button onClick={() => void enable()} disabled={busy || !publicKey}>
                {busy ? "Açılıyor…" : "Bildirimleri aç"}
              </Button>
            </div>
            {note ? <p className="mt-2 text-[13px] leading-5 text-ink-mute">{note}</p> : null}
          </div>
        ) : (
          <>
            {karaoke || role === "admin" ? (
              <ToggleRow
                title="Karaoke bildirimleri"
                description="Yeni rezervasyon (ekranda kalır), iptal ve saat değişikliği"
                label="Karaoke bildirimleri"
                checked={topics?.karaoke ?? true}
                onChange={(v) => void changeTopic("karaoke", v)}
              />
            ) : null}
            {karaoke ? (
              <ToggleRow
                title="Sipariş bildirimleri"
                description="laffogato.net'ten yeni uygulama siparişi (masa, gel-al, kurye)"
                label="Sipariş bildirimleri"
                checked={topics?.orders ?? role === "staff"}
                onChange={(v) => void changeTopic("orders", v)}
              />
            ) : null}
            {/* Onay bildirimlerinin anahtarı yok: tek gönderen mal siparişi taslağıydı (26 Eki 2026'da kaldırıldı). Tesisat
                (konu, cihaz tercihi) kalır; yeniden bir gönderen olunca anahtar buraya döner (tests/onay-kuyrugu.test.ts) */}
            <ToggleRow
              title="Sabah hatırlatma özeti"
              description="Bugün yapılacak kişisel hatırlatıcılarınız, her sabah"
              label="Sabah hatırlatma özeti"
              checked={topics?.reminders ?? true}
              onChange={(v) => void changeTopic("reminders", v)}
            />
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => void test()} disabled={busy}>
                <Send size={14} /> Deneme bildirimi
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void disable()} disabled={busy}>
                <BellOff size={14} /> Bu cihazda kapat
              </Button>
            </div>
          </>
        )}

        <ToggleRow
          title="Sesli uyarı"
          description={audio === "ready" ? "Ses açık." : undefined}
          label="Sesli uyarı"
          checked={prefs.sound}
          onChange={(v) => updatePrefs(role, { sound: v })}
        />
        {prefs.sound ? <OutputPicker role={role} /> : null}
        {karaoke ? (
          <>
            <ToggleRow
              title="Sipariş zili bu cihazda"
              description="Yeni uygulama siparişinde zil (masa siparişi daha uzun çalar)"
              label="Sipariş zili bu cihazda"
              checked={prefs.orderAlerts}
              onChange={(v) => updatePrefs(role, { orderAlerts: v })}
            />
            <ToggleRow
              title="Karaoke alarmları bu cihazda"
              description="Başlarken kısa ses, bitime az kala uyarı, süre dolunca “Haber verdim” denene kadar alarm"
              label="Karaoke alarmları bu cihazda"
              checked={prefs.karaokeAlarms}
              onChange={(v) => updatePrefs(role, { karaokeAlarms: v })}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
              <p className="text-sm font-medium text-ink">Bitime kala uyar</p>
              <Segmented<string>
                label="Bitime kaç dakika kala uyarılsın"
                value={String(prefs.warnMinutes)}
                onChange={(v) => updatePrefs(role, { warnMinutes: Number(v) })}
                options={WARN_CHOICES.map((m) => ({ value: String(m), label: m ? `${m} dk` : "Kapalı" }))}
              />
            </div>
            <ToggleRow
              title="Ekran açık kalsın"
              description="Karaoke ekranı açıkken tablet / bilgisayar ekranı kararmaz"
              label="Ekran açık kalsın"
              checked={prefs.wakeLock}
              onChange={(v) => updatePrefs(role, { wakeLock: v })}
            />
          </>
        ) : (
          <ToggleRow
            title="Saatli hatırlatmalar bu cihazda"
            description="Panel açıkken saatinde ses ve ekranda kart"
            label="Saatli hatırlatmalar bu cihazda"
            checked={prefs.reminderAlerts}
            onChange={(v) => updatePrefs(role, { reminderAlerts: v })}
          />
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void unlockAudio().then((ok) => {
              if (ok) play(karaoke ? "ring" : "reminder");
              else toast.error("Ses açılamadı; cihazın sesini kontrol edin");
            })
          }
        >
          <Volume2 size={14} /> Sesi dene
        </Button>
        {/* Dört ipucu tek açılırda, metinler aynen (docs/planlar/ux-sade.md H5, §9 #25): dört gri kutu yerine */}
        <details className="group/tips">
          <summary className="relative inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-[13px] font-medium text-ink-soft underline decoration-current/40 underline-offset-2 outline-none select-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
            Ses ve bildirim ipuçları ({tips.length})
            <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" className="size-3.5 motion-safe:transition-transform group-open/tips:rotate-180" />
          </summary>
          <ul className="list-disc space-y-1 pl-5 text-[13px] leading-5 text-ink-mute">
            {tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </details>
      </div>
    </Card>
  );
}

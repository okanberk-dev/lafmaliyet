"use client";

import { Speaker } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { looksWireless, suggestedOutput, type OutputDevice } from "@/lib/audio-output";
import type { Role } from "@/lib/constants";

import { listOutputs, revealOutputs } from "./output-client";
import { updatePrefs, usePrefs } from "./prefs";
import { outputSelectable, play, setOutput, unlockAudio, useOutputStatus } from "./sounds";

const noopSubscribe = () => () => {};

/**
 * "Uyarıların çalacağı hoparlör": barda müzik Bluetooth hoparlörden çalarken zil ve alarm bilgisayarın kendi
 * hoparlöründen gelsin. Seçim bu cihazda saklanır; Chrome ve Edge'de çalışır (Safari / iPhone'da seçilemez, ses
 * sistemin çıkışından gelir). Chrome hoparlör adlarını yalnız mikrofon izniyle gösterir; mikrofon kullanılmaz.
 */
/**
 * Hoparlör ipuçları: cihaz kartının tek "Ses ve bildirim ipuçları" açılırında, metinler aynen (docs/planlar/ux-sade.md
 * H5, §9 #25); seçicinin yanında tekrar yazılmaz
 */
export const OUTPUT_TIPS = {
  bluetooth: "Müzik Bluetooth hoparlörden çalıyorsa bilgisayarın kendi hoparlörünü seçin: zil ve alarm müziğe karışmaz. Bilgisayarın ses düzeyini yüksek tutun.",
  permission: "Chrome hoparlörlerin adını göstermek için bir kez mikrofon izni ister; mikrofon kullanılmaz, hemen kapatılır. İzin penceresinde “Her ziyarette izin ver”i seçin.",
} as const;

export function OutputPicker({ role }: { role: Role }) {
  const prefs = usePrefs(role);
  const selectable = useSyncExternalStore(noopSubscribe, outputSelectable, () => false);
  const status = useOutputStatus();
  const [devices, setDevices] = useState<OutputDevice[] | "permission" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selectable) return;
    let alive = true;
    const load = () =>
      void listOutputs()
        .then((d) => alive && setDevices(d))
        .catch(() => alive && setDevices([]));
    load();
    navigator.mediaDevices?.addEventListener?.("devicechange", load);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", load);
    };
  }, [selectable]);

  async function choose(device: OutputDevice | null) {
    updatePrefs(role, { outputId: device?.id ?? "", outputLabel: device?.label ?? "" });
    const result = await setOutput(device?.id ?? "");
    if (result === "missing" || result === "permission") return void toast.error("Bu hoparlöre çalınamadı; ses varsayılan çıkıştan gelecek");
    // Seçim bir dokunuş: ses açılır ve hangi hoparlörden çaldığı hemen duyulur
    if (await unlockAudio()) play("test");
  }

  async function reveal() {
    setBusy(true);
    const res = await revealOutputs();
    setBusy(false);
    if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
    setDevices(res.devices);
    const pick = res.picked ?? (prefs.outputId ? null : suggestedOutput(res.devices));
    if (pick) await choose(pick);
  }

  if (!selectable) {
    return (
      <p className="rounded-2xl bg-surface px-4 py-3 text-[13px] leading-5 text-ink-mute ring-1 ring-line">
        Bu tarayıcıda uyarıların hoparlörü seçilemiyor; sesler sistemin varsayılan çıkışından gelir. Bilgisayarda Chrome ya da Edge&apos;de bilgisayarın
        kendi hoparlörü seçilebilir.
      </p>
    );
  }

  const list = Array.isArray(devices) ? devices : [];
  const suggested = suggestedOutput(list);
  const savedMissing = Boolean(prefs.outputId) && Array.isArray(devices) && !list.some((d) => d.id === prefs.outputId);
  const warning =
    status === "permission"
      ? "Hoparlör izni yenilenmeli: “Hoparlörleri göster”e basıp “Her ziyarette izin ver”i seçin. Şimdilik ses varsayılan çıkıştan geliyor."
      : status === "missing" || savedMissing
        ? `Seçilen hoparlör (${prefs.outputLabel || "bilinmeyen"}) şu an bağlı değil; ses varsayılan çıkıştan geliyor.`
        : null;

  return (
    <div className="space-y-2.5 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
      <div className="flex items-start gap-3">
        <Speaker size={18} className="mt-0.5 shrink-0 text-ink-mute" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <label htmlFor="cikis-hoparlor" className="text-sm font-medium text-ink">
            Uyarıların çalacağı hoparlör
          </label>
        </div>
      </div>
      {devices === "permission" ? (
        <div className="space-y-2">
          {prefs.outputLabel ? <p className="text-[13px] leading-5 text-ink-soft">Seçili: {prefs.outputLabel}.</p> : null}
          <Button variant="secondary" size="sm" onClick={() => void reveal()} disabled={busy}>
            <Speaker size={14} /> {busy ? "Bekleniyor…" : "Hoparlörleri göster"}
          </Button>
        </div>
      ) : (
        <Select
          id="cikis-hoparlor"
          value={list.some((d) => d.id === prefs.outputId) ? prefs.outputId : ""}
          onChange={(e) => void choose(list.find((d) => d.id === e.target.value) ?? null)}
          disabled={devices === null}
          className="w-full"
        >
          <option value="">Sistemin varsayılanı</option>
          {list.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
              {d.id === suggested?.id ? " · bilgisayarın hoparlörü" : looksWireless(d.label) ? " · Bluetooth" : ""}
            </option>
          ))}
        </Select>
      )}
      {warning ? <Notice tone="warn" size="sm" title={warning} /> : null}
    </div>
  );
}

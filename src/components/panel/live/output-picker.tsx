"use client";

import { Speaker } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { ToggleRow } from "@/components/ui/toggle-row";
import { looksBuiltIn, looksWireless, suggestedOutput, type OutputDevice } from "@/lib/audio-output";
import type { Role } from "@/lib/constants";

import { listOutputs, revealOutputs, systemDefaultOutput } from "./output-client";
import { onlyComputerOn, updatePrefs, usePrefs } from "./prefs";
import { alertsAudible, computerOutputs, outputSelectable, play, setOutput, unlockAudio, useAlertsAudible, useOutputStatus } from "./sounds";

const noopSubscribe = () => () => {};

/**
 * "Uyarı sesleri": zil, alarm ve hatırlatma sesinin çalacağı hoparlör. Barda müzik Bluetooth hoparlörden ya da kafenin
 * genel hoparlöründen çalarken uyarılar bilgisayarın kendi hoparlöründen gelsin. Seçim bu cihazda saklanır; Chrome ve
 * Edge'de çalışır (Safari / iPhone'da seçilemez, ses sistemin çıkışından gelir). Chrome hoparlör adlarını yalnız
 * mikrofon izniyle gösterir; mikrofon kullanılmaz.
 *
 * "Yalnız bu bilgisayardan" (Tuzla Köyiçi'nde varsayılan açık): seçilen hoparlör yoksa ses genel hoparlöre düşmez,
 * susar ve burada uyarı çıkar.
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
  const computer = useSyncExternalStore(noopSubscribe, computerOutputs, () => false);
  const strict = computer && onlyComputerOn(prefs);
  const status = useOutputStatus();
  const audible = useAlertsAudible();
  const [devices, setDevices] = useState<OutputDevice[] | "permission" | null>(null);
  const [systemDefault, setSystemDefault] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selectable) return;
    let alive = true;
    const load = () => {
      void listOutputs()
        .then((d) => alive && setDevices(d))
        .catch(() => alive && setDevices([]));
      void systemDefaultOutput().then((l) => alive && setSystemDefault(l));
    };
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
    if (result === "missing" || result === "permission") {
      return void toast.error(strict ? "Bu hoparlöre çalınamadı; uyarı sesleri susturuldu" : "Bu hoparlöre çalınamadı; ses varsayılan çıkıştan gelecek");
    }
    // Seçim bir dokunuş: ses açılır ve hangi hoparlörden çaldığı hemen duyulur
    if ((await unlockAudio()) && alertsAudible()) play("test");
  }

  async function reveal() {
    setBusy(true);
    const res = await revealOutputs();
    setBusy(false);
    if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
    setDevices(res.devices);
    void systemDefaultOutput().then(setSystemDefault);
    const pick = res.picked ?? (prefs.outputId ? null : suggestedOutput(res.devices));
    if (pick) await choose(pick);
  }

  if (!selectable) {
    return (
      <p className="rounded-2xl bg-surface px-4 py-3 text-[13px] leading-5 text-ink-mute ring-1 ring-line">
        Bu tarayıcıda (Safari, iPhone, iPad) uyarı seslerinin hoparlörü seçilemiyor; sesler cihazın kendi ses çıkışından gelir. Bilgisayarda Chrome ya da
        Edge&apos;de sesler yalnız bilgisayarın hoparlöründen çalacak şekilde ayarlanabilir.
      </p>
    );
  }

  const list = Array.isArray(devices) ? devices : [];
  const suggested = suggestedOutput(list);
  const savedMissing = Boolean(prefs.outputId) && Array.isArray(devices) && list.length > 0 && !list.some((d) => d.id === prefs.outputId);
  const lost = strict ? "uyarı sesleri genel hoparlöre gitmesin diye susturuldu" : "ses varsayılan çıkıştan geliyor";
  const warning =
    status === "permission"
      ? `Hoparlör izni yenilenmeli: “Hoparlörleri göster”e basıp “Her ziyarette izin ver”i seçin. Şimdilik ${lost}.`
      : status === "missing" || savedMissing
        ? `Seçilen hoparlör (${prefs.outputLabel || "bilinmeyen"}) şu an bağlı değil; ${lost}.${suggested && suggested.id !== prefs.outputId ? ` Öneri: ${suggested.label}.` : ""}`
        : strict && !prefs.outputId
          ? "Bu bilgisayarın hoparlörü henüz seçilmedi; uyarı sesleri genel hoparlöre gitmesin diye susturuldu. Aşağıdan seçin."
          : null;
  // Varsayılan çıkış bilgisayarın kendi hoparlörü değilse (genel hoparlör, müzik sistemi olabilir) uyar
  const defaultRisk = systemDefault && !looksBuiltIn(systemDefault) && (!prefs.outputId || !audible) ? systemDefault : null;

  return (
    <div id="uyari-sesleri" className="scroll-mt-20 space-y-2.5 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
      <div className="flex items-start gap-3">
        <Speaker size={18} className="mt-0.5 shrink-0 text-ink-mute" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <label htmlFor="cikis-hoparlor" className="text-sm font-medium text-ink">
            Uyarı sesleri
          </label>
          <p className="text-[13px] leading-5 text-ink-mute">Zil, alarm ve hatırlatma sesinin çalacağı hoparlör</p>
        </div>
      </div>
      {computer ? (
        <ToggleRow
          title="Yalnız bu bilgisayardan çalsın"
          description="Açıkken sesler yalnız seçilen hoparlörden çıkar; o hoparlör yoksa kafenin genel hoparlörüne geçmez, susar ve burada uyarı çıkar."
          label="Uyarı sesleri yalnız bu bilgisayardan çalsın"
          checked={strict}
          onChange={(v) => updatePrefs(role, { onlyComputer: v })}
        />
      ) : null}
      {devices === "permission" ? (
        <div className="space-y-2">
          {prefs.outputLabel ? <p className="text-[13px] leading-5 text-ink-soft">Seçili: {prefs.outputLabel}.</p> : null}
          <p className="text-[13px] leading-5 text-ink-mute">
            Hoparlörlerin adını görmek için Chrome bir kez mikrofon izni ister. Mikrofon kullanılmaz, hemen kapatılır; izin penceresinde “Her ziyarette izin
            ver”i seçin.
          </p>
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
          <option value="">{strict ? "Hoparlör seçin" : "Sistemin varsayılanı"}</option>
          {list.map((d) => (
            <option key={d.id} value={d.id}>
              {d.id === suggested?.id ? `Bu bilgisayarın hoparlörü · ${d.label}` : looksWireless(d.label) ? `${d.label} · Bluetooth` : d.label}
            </option>
          ))}
        </Select>
      )}
      {warning ? <Notice tone="warn" size="sm" title={warning} /> : null}
      {defaultRisk ? (
        <p className="text-[13px] leading-5 text-ink-mute">
          Bilgisayarın varsayılan ses çıkışı: {defaultRisk}. Bu kafenin genel hoparlörüyse uyarılar için listeden bilgisayarın kendi hoparlörünü seçin.
        </p>
      ) : null}
    </div>
  );
}

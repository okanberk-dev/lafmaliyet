"use client";

import { needsLabelPermission, resolveOutput, selectableOutputs, suggestedOutput, systemDefaultLabel, type OutputDevice } from "@/lib/audio-output";
import type { Role } from "@/lib/constants";

import { updatePrefs } from "./prefs";
import { markOutputMissing, setOutput, type OutputStatus } from "./sounds";

type SelectableMediaDevices = MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };

/** Hoparlörler; tarayıcı adlarını göstermiyorsa (izin yok) "permission" */
export async function listOutputs(): Promise<OutputDevice[] | "permission"> {
  const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!md?.enumerateDevices) return [];
  const devices = await md.enumerateDevices();
  return needsLabelPermission(devices) ? "permission" : selectableOutputs(devices);
}

/** Sistemin varsayılan çıkışının adı (izin yoksa null): "varsayılan çıkış genel hoparlör olabilir" uyarısı için */
export async function systemDefaultOutput(): Promise<string | null> {
  const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!md?.enumerateDevices) return null;
  return systemDefaultLabel(await md.enumerateDevices().catch(() => []));
}

/**
 * Servis çalışanına (public/sw.js) "sistem bildirimi sessiz olsun" işareti: işletim sisteminin bildirim sesi her zaman
 * varsayılan çıkıştan (genel hoparlörden) çalar. İşaret tarayıcının Cache deposunda tek kayıt (servis çalışanı
 * localStorage'ı okuyamaz); panel hiç açık değilken gelen bildirim de sessiz gelir.
 */
export const QUIET_CACHE = "laf-ayar";
export const QUIET_KEY = "/panel/__sessiz-bildirim";

export async function syncQuietFlag(on: boolean): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const store = await caches.open(QUIET_CACHE);
    if (on) await store.put(QUIET_KEY, new Response("1"));
    else await store.delete(QUIET_KEY);
  } catch {
    // Depo kapalı (gizli pencere): sekme açıkken bildirimler yine sessiz
  }
}

/**
 * Hoparlörlerin adlarını açar (bir dokunuşun içinde çağrılır). Tarayıcının kendi hoparlör seçicisi varsa (Firefox)
 * o açılır ve seçilen döner. Chrome adları yalnız mikrofon izniyle gösterir: izin istenir, açılan mikrofon hemen
 * kapatılır, hiçbir şey kaydedilmez.
 */
export async function revealOutputs(): Promise<{ ok: true; picked: OutputDevice | null; devices: OutputDevice[] } | { ok: false; error: string }> {
  const md = typeof navigator === "undefined" ? undefined : (navigator.mediaDevices as SelectableMediaDevices | undefined);
  if (!md?.enumerateDevices) return { ok: false, error: "Bu tarayıcı hoparlör seçimini desteklemiyor" };
  try {
    if (md.selectAudioOutput) {
      const d = await md.selectAudioOutput();
      return { ok: true, picked: { id: d.deviceId, label: d.label }, devices: selectableOutputs(await md.enumerateDevices()) };
    }
    const stream = await md.getUserMedia({ audio: true });
    for (const t of stream.getTracks()) t.stop();
    const list = await listOutputs();
    return { ok: true, picked: null, devices: list === "permission" ? [] : list };
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return { ok: false, error: "İzin verilmedi. Adres çubuğundaki site ayarlarından (kilit) Mikrofon'u “İzin ver” yapıp yeniden deneyin; mikrofon kullanılmaz, yalnız hoparlör adları için gerekir." };
    }
    if (name === "NotFoundError") {
      return { ok: false, error: "Bu bilgisayarda mikrofon olmadığı için Chrome hoparlör adlarını göstermiyor. Windows'ta Ayarlar › Sistem › Ses › Ses karıştırıcı'dan Chrome'un çıkışını bilgisayar hoparlörü yapın." };
    }
    return { ok: false, error: "Hoparlörler listelenemedi" };
  }
}

/**
 * Bu cihazda kayıtlı hoparlörü uygular (açılışta ve bir cihaz takılıp çıkınca). Kimlik değişmişse (tarayıcı verisi
 * silindi) hoparlör adıyla bulunur ve kayıt güncellenir; bulunamazsa ses varsayılan çıkıştan gelir, "yalnız bu
 * bilgisayar" açıksa susar (sounds.ts). "Yalnız bu bilgisayar" açık ama hoparlör hiç seçilmemişse ve adlar görünüyorsa
 * bilgisayarın kendi hoparlörü (Realtek, dahili…) kendiliğinden seçilir.
 */
export async function applyOutput(role: Role, saved: { outputId: string; outputLabel: string }, onlyComputer = false): Promise<OutputStatus> {
  if (!saved.outputId) {
    if (onlyComputer) {
      const list = await listOutputs().catch(() => "permission" as const);
      const builtIn = list === "permission" ? null : suggestedOutput(list);
      if (builtIn) {
        updatePrefs(role, { outputId: builtIn.id, outputLabel: builtIn.label });
        return setOutput(builtIn.id);
      }
    }
    return setOutput("");
  }
  const status = await setOutput(saved.outputId);
  if (status === "permission" || status === "unsupported" || status === "default") return status;
  const list = await listOutputs().catch(() => "permission" as const);
  if (list === "permission") return status;
  // Hoparlör listede: tamam. Yoksa (çıkarıldı) tarayıcı sesi kendiliğinden varsayılana geçirebilir: önce adla aranır
  if (list.some((d) => d.id === saved.outputId)) return status;
  const found = resolveOutput({ id: saved.outputId, label: saved.outputLabel }, list);
  if (found && found.id !== saved.outputId) {
    updatePrefs(role, { outputId: found.id, outputLabel: found.label });
    return setOutput(found.id);
  }
  markOutputMissing();
  return "missing";
}

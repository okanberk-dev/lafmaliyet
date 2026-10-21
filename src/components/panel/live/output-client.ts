"use client";

import { needsLabelPermission, resolveOutput, selectableOutputs, type OutputDevice } from "@/lib/audio-output";
import type { Role } from "@/lib/constants";

import { updatePrefs } from "./prefs";
import { setOutput, type OutputStatus } from "./sounds";

type SelectableMediaDevices = MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };

/** Hoparlörler; tarayıcı adlarını göstermiyorsa (izin yok) "permission" */
export async function listOutputs(): Promise<OutputDevice[] | "permission"> {
  const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!md?.enumerateDevices) return [];
  const devices = await md.enumerateDevices();
  return needsLabelPermission(devices) ? "permission" : selectableOutputs(devices);
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
 * silindi) hoparlör adıyla bulunur ve kayıt güncellenir; bulunamazsa ses varsayılan çıkıştan gelir.
 */
export async function applyOutput(role: Role, saved: { outputId: string; outputLabel: string }): Promise<OutputStatus> {
  const status = await setOutput(saved.outputId);
  if (status !== "missing" || !saved.outputLabel) return status;
  const list = await listOutputs().catch(() => "permission" as const);
  if (list === "permission") return status;
  const found = resolveOutput({ id: saved.outputId, label: saved.outputLabel }, list);
  if (!found || found.id === saved.outputId) return status;
  updatePrefs(role, { outputId: found.id, outputLabel: found.label });
  return setOutput(found.id);
}

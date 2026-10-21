/**
 * Uyarı seslerinin çalacağı hoparlörün seçimi (tarayıcının cihaz listesi üzerinde saf yardımcılar; testli).
 * Barda müzik Bluetooth hoparlörden çalarken uyarılar bilgisayarın kendi hoparlöründen gelsin diye: seçim cihazda
 * saklanır (src/components/panel/live/prefs.ts), ses motoru o çıkışa çalar (sounds.ts, AudioContext.setSinkId).
 */

export interface OutputDevice {
  id: string;
  label: string;
}

/** Tarayıcının takma adları: "varsayılan" ve Windows'un "iletişim" cihazı gerçek bir hoparlör değil */
const ALIASES = new Set(["", "default", "communications"]);

/** Seçilebilir hoparlörler: takma adlar ve adı görünmeyenler (izin yokken) hariç, her cihaz bir kez */
export function selectableOutputs(devices: readonly { kind: string; deviceId: string; label: string }[]): OutputDevice[] {
  const seen = new Set<string>();
  const out: OutputDevice[] = [];
  for (const d of devices) {
    if (d.kind !== "audiooutput" || ALIASES.has(d.deviceId) || !d.label.trim() || seen.has(d.deviceId)) continue;
    seen.add(d.deviceId);
    out.push({ id: d.deviceId, label: d.label.trim() });
  }
  return out;
}

/** Tarayıcı hoparlörleri listeledi ama adlarını göstermedi: önce izin gerekir */
export function needsLabelPermission(devices: readonly { kind: string; label: string }[]): boolean {
  const outputs = devices.filter((d) => d.kind === "audiooutput");
  return outputs.length === 0 || outputs.every((d) => !d.label.trim());
}

const norm = (label: string) => label.trim().toLocaleLowerCase("tr").replace(/\s+/g, " ");

/**
 * Kayıtlı seçimi bugünkü listede bulur: önce kimlikle, bulunamazsa adla (tarayıcı verisi silinince kimlik değişir,
 * ad aynı kalır). Seçim yoksa (sistemin varsayılanı) null.
 */
export function resolveOutput(saved: { id: string; label: string }, devices: readonly OutputDevice[]): OutputDevice | null {
  if (!saved.id) return null;
  return devices.find((d) => d.id === saved.id) ?? (saved.label ? (devices.find((d) => norm(d.label) === norm(saved.label)) ?? null) : null);
}

/** Bluetooth / kablosuz hoparlör ya da kulaklık gibi görünen ad */
export function looksWireless(label: string): boolean {
  return /bluetooth|airpods|hands-?free|headset|kulaklık|kablosuz|wireless|\bjbl\b|\bbose\b|marshall|\bbeats\b|soundlink|boom|\bbt\b/i.test(label);
}

/** Bilgisayarın kendi hoparlörü gibi görünen ad (Windows'ta çoğunlukla Realtek, Mac'te "MacBook … Speakers") */
export function looksBuiltIn(label: string): boolean {
  return !looksWireless(label) && /realtek|built-?in|internal|dahili|macbook|imac|mac mini|conexant|cirrus|smart sound|yerleşik/i.test(label);
}

/** Listede bilgisayarın kendi hoparlörü gibi görünen ilk cihaz (öneri olarak işaretlenir) */
export function suggestedOutput(devices: readonly OutputDevice[]): OutputDevice | null {
  return devices.find((d) => looksBuiltIn(d.label)) ?? null;
}

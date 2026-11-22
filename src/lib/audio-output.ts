/**
 * Uyarı seslerinin çalacağı hoparlörün seçimi (tarayıcının cihaz listesi üzerinde saf yardımcılar; testli).
 * Barda müzik Bluetooth hoparlörden çalarken uyarılar bilgisayarın kendi hoparlöründen gelsin diye: seçim cihazda
 * saklanır (src/components/panel/live/prefs.ts), ses motoru o çıkışa çalar (sounds.ts, AudioContext.setSinkId).
 *
 * "Yalnız bu bilgisayar" (aşağıda): açıkken uyarılar yalnız seçilen hoparlörden çalar, o hoparlör yoksa genel
 * hoparlöre düşmez, susar. Tuzla Köyiçi'nde (Tuzla seçiliyken) varsayılan açık (docs/BILDIRIMLER.md › Uyarı sesleri).
 */

import { ALL_BRANCHES, DEFAULT_BRANCH_ID } from "./branches";

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

// ─── "Yalnız bu bilgisayar" ──────────────────────────────────────────────────

/**
 * Uyarı seslerinin hoparlör durumu (sounds.ts): "default" sistemin varsayılan çıkışı, "active" seçilen hoparlör,
 * "missing" seçilen hoparlör bağlı değil, "permission" hoparlör izni düştü, "unsupported" tarayıcı seçtirmiyor.
 */
export type OutputStatus = "default" | "active" | "missing" | "permission" | "unsupported";

/**
 * Uyarıların varsayılan olarak yalnız bilgisayarın hoparlöründen çaldığı şubeler. Tuzla Köyiçi'nde Windows'un
 * varsayılan çıkışı kafenin genel hoparlörü (müzik sistemi): zil, alarm ve hatırlatma sesi oradan bütün kafeye
 * çalıyordu (sahibin isteği, 22 Kasım 2026). Marina'nın varsayılanı değişmez; orada da aynı anahtar elle açılabilir.
 */
export const ONLY_COMPUTER_BRANCHES: readonly string[] = [DEFAULT_BRANCH_ID];

/**
 * Bu cihazın şubesi, panelin şube seçiminden: personelde kilitli şubesi, yöneticide soldan açıkça seçtiği şube.
 * "Tümü" seçiliyken cihazın şubesi yok (null): bilgisayar hangi şubede bilinmez. Önceden "Tümü" Tuzla sayılıyordu;
 * Marina'daki bilgisayarda "Tümü" seçiliyken Tuzla'nın varsayılanı açılıyor, hoparlör seçilmeden sipariş zili ve
 * alarm susuyordu (sahibin kuralı, 22 Kasım 2026: yalnız açıkça Tuzla seçiliyken Tuzla'nın varsayılanı).
 */
export function deviceBranch(scope: string | null | undefined): string | null {
  if (!scope || scope === ALL_BRANCHES) return null;
  return scope;
}

/**
 * "Yalnız bu bilgisayar" açık mı: cihazda elle seçildiyse o (Bu cihazda uyarılar › Uyarı sesleri; her şubede ve
 * "Tümü"de geçerli), seçilmediyse şubenin varsayılanı. Varsayılan yalnız açıkça Tuzla seçiliyken açık; "Tümü"de, Marina'da
 * ve online kanalda kapalı
 */
export function onlyComputerFor(saved: boolean | null | undefined, scope: string | null | undefined): boolean {
  if (typeof saved === "boolean") return saved;
  const branch = deviceBranch(scope);
  return branch !== null && ONLY_COMPUTER_BRANCHES.includes(branch);
}

/** Telefon ya da tablet: hoparlörü zaten kendinde, "yalnız bu bilgisayar" yalnız masaüstü tarayıcıda anlamlı */
export function isMobileAgent(userAgent: string): boolean {
  return /android|iphone|ipad|ipod|mobile/i.test(userAgent);
}

/**
 * Uyarı sesi çalınabilir mi. "Yalnız bu bilgisayar" kapalıysa ya da tarayıcı hoparlör seçtirmiyorsa her zaman evet.
 * Açıksa ses ancak seçilen hoparlör gerçekten etkinken çalar: hoparlör seçilmemişse, çıkarıldıysa ya da izni düştüyse
 * ses SUSAR, genel hoparlöre (sistemin varsayılan çıkışına) düşmez; ekranda uyarı çıkar.
 */
export function alertAudible(onlyComputer: boolean, status: OutputStatus): boolean {
  if (!onlyComputer || status === "unsupported") return true;
  return status === "active";
}

/**
 * İşletim sisteminin bildirim sesi her zaman varsayılan çıkıştan (genel hoparlörden) çalar, yönlendirilemez: "yalnız bu
 * bilgisayar" açıkken sistem bildirimi hep sessiz, kapalıyken sesi sekme kendisi çalıyorsa sessiz.
 */
export function osNotificationSilent(onlyComputer: boolean, pageRings: boolean): boolean {
  return onlyComputer || pageRings;
}

/**
 * Sistemin varsayılan çıkışının adı ("Varsayılan - Hoparlör (JBL Charge 5)" → "Hoparlör (JBL Charge 5)"); adlar
 * görünmüyorsa (izin yok) null. Ekranda "varsayılan çıkış genel hoparlör olabilir" uyarısı için.
 */
export function systemDefaultLabel(devices: readonly { kind: string; deviceId: string; label: string }[]): string | null {
  const d = devices.find((x) => x.kind === "audiooutput" && x.deviceId === "default" && x.label.trim());
  if (!d) return null;
  return d.label.replace(/^\s*(varsayılan|default)\s*[-–:]\s*/i, "").trim() || null;
}

/**
 * Uyarı sesi saatleri (İstanbul, UTC+3): sabah 10:00'dan gece 01:00'a kadar. Bu saatlerin dışında (01:00–10:00) hiçbir
 * uyarı ve hatırlatma sesi çalmaz, sistem bildirimi de sessiz gelir; ekrandaki pencere ve kartlar aynen çıkar. Deneme
 * sesi (test) bu kurala bakmaz. public/sw.js aynı kuralın kopyasını taşır (tests/ses-cikisi.test.ts ikisini denetler).
 */
export const ALERT_SOUND_FROM_MIN = 10 * 60;
export const ALERT_SOUND_UNTIL_MIN = 60;

export function alertHoursOpen(atMs: number): boolean {
  const minutes = Math.floor((((atMs + 3 * 3600_000) % 86_400_000) + 86_400_000) % 86_400_000 / 60_000);
  return minutes >= ALERT_SOUND_FROM_MIN || minutes <= ALERT_SOUND_UNTIL_MIN;
}

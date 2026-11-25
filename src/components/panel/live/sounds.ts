"use client";

import { useSyncExternalStore } from "react";

import { alertAudible, alertHoursOpen, isMobileAgent, type OutputStatus } from "@/lib/audio-output";

export type { OutputStatus };

/**
 * Uyarı sesleri, ses dosyası olmadan (Web Audio ile üretilir; indirilecek bir şey yok, çevrimdışı da çalar).
 * Tarayıcılar sesi ancak sayfada bir dokunuştan sonra açar: ilk dokunuşta unlockAudio() çağrılır (alert-center.tsx);
 * o zamana kadar "Sesli uyarılar için dokunun" düğmesi görünür.
 *
 * Gürültülü barda duyulsun diye sesler parlak ve yüksektir; çıkıştaki sınırlayıcı üst üste binen notaların
 * cızırdamasını önler. Ses, cihazda seçilen hoparlöre çalar (setOutput; Bluetooth hoparlörde müzik çalarken
 * bilgisayarın kendi hoparlörü), seçilmemişse sistemin varsayılan çıkışına.
 *
 * Paneldeki BÜTÜN uyarı ve hatırlatma sesleri buradan geçer (zil, masa çağrısı, karaoke, hatırlatma, deneme sesi;
 * tests/ses-cikisi.test.ts başka yerde ses çalınmadığını denetler). "Yalnız bu bilgisayar" açıkken (setOnlyComputer)
 * ses ancak seçilen hoparlör etkinse çıkar; hoparlör seçilmemiş, çıkarılmış ya da izni düşmüşse ses kısılır, genel
 * hoparlöre (sistemin varsayılan çıkışına) düşmez (src/lib/audio-output.ts › alertAudible).
 *
 * Sesler sürekli çalmaz: her uyarı en çok 3 kez çalar (alarm döngüsü dahil, ALARM_RINGS) ve yalnız 09:00–01:00 arasında
 * (alertHoursOpen); deneme sesi hariç, bu saatlerin dışında ses çalınmaz.
 *
 * Arka plandaki sekmede zamanlayıcılar geç kalabilir; sürenin bittiği an ayrıca ses saatine kurulur (scheduleBurst):
 * ses saati kısılmaz, alarm tam zamanında başlar.
 */

export type SoundKind = "ring" | "table" | "call" | "start" | "warn" | "reminder" | "alarm" | "test";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const audioListeners = new Set<() => void>();
const notifyAudio = () => {
  for (const fn of audioListeners) fn();
};
let alarmTimer: ReturnType<typeof setInterval> | null = null;
/** Alarm kaç kez çalar (sürekli çalmaz): süresi dolan karaoke oturumu ve "sürekli sesli" hatırlatma */
export const ALARM_RINGS = 3;
let alarmRingsLeft = 0;
let volume = 1;

type AudioCtor = typeof AudioContext;
/** Chrome / Edge 110+: AudioContext'in çıkış cihazı seçilebilir */
type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void>; sinkId?: string | object };

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor: AudioCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  ctx.onstatechange = notifyAudio;
  master = ctx.createGain();
  master.gain.value = alertsAudible() ? volume : 0;
  // Sınırlayıcı: sesler tavana yakın ve yüksek çıkar, üst üste binen notalar kırpılıp cızırdamaz
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 3;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.15;
  master.connect(limiter).connect(ctx.destination);
  if (output.id) void applySink(output.id);
  return ctx;
}

// ─── Çıkış cihazı ─────────────────────────────────────────────────────────

let output: { id: string; status: OutputStatus } = { id: "", status: "default" };
let sinkChange: Promise<unknown> = Promise.resolve();

/** Bu tarayıcıda uyarıların hoparlörü seçilebilir mi (Chrome / Edge; Safari ve iPhone'da hayır) */
export function outputSelectable(): boolean {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") return false;
  return "setSinkId" in window.AudioContext.prototype;
}

/** "Yalnız bu bilgisayar" bu cihazda anlamlı mı: hoparlör seçilebilen masaüstü tarayıcı (telefon ve tablet değil) */
export function computerOutputs(): boolean {
  return outputSelectable() && !isMobileAgent(navigator.userAgent);
}

let onlyComputer = false;

/** Uyarı sesi şu an çalınabilir mi ("yalnız bu bilgisayar" açıkken yalnız seçilen hoparlör etkinse) */
export function alertsAudible(): boolean {
  return alertAudible(onlyComputer, output.status);
}

/** Sesin kapısı: çalınamıyorsa ana ses sıfır (önceden kurulmuş alarm notaları da susar) */
function syncGate() {
  if (master) master.gain.value = alertsAudible() ? volume : 0;
}

/** "Yalnız bu bilgisayar": açıkken ses seçilen hoparlör yoksa susar (AlertCenter cihaz tercihinden kurar) */
export function setOnlyComputer(on: boolean) {
  const next = on && computerOutputs();
  if (next === onlyComputer) return;
  onlyComputer = next;
  syncGate();
  notifyAudio();
}

export const onlyComputerActive = () => onlyComputer;

/** Seçilen hoparlör listede yok (çıkarıldı): tarayıcı sesi kendiliğinden varsayılana geçirebilir, burada susturulur */
export function markOutputMissing() {
  if (!output.id || output.status === "missing") return;
  output = { id: output.id, status: "missing" };
  syncGate();
  notifyAudio();
  // Tarayıcı kayıtlı çıkışı unutsun: hoparlör geri takılınca setOutput yeniden bağlar (aynı kimlik "zaten bağlı" sanılmaz)
  const c = ctx as SinkContext | null;
  if (c?.setSinkId) sinkChange = sinkChange.then(() => c.setSinkId!("")).catch(() => null);
}

async function applySink(id: string): Promise<OutputStatus> {
  const c = ctx as SinkContext | null;
  if (!c) return output.status;
  if (!c.setSinkId) return "unsupported";
  // Zaten o çıkışta: tarayıcıya yeniden sorulmaz
  if (c.sinkId === id) return id ? "active" : "default";
  try {
    await c.setSinkId(id);
    return id ? "active" : "default";
  } catch (e) {
    // Seçilen hoparlör yok ya da izin düştü: ses varsayılan çıkıştan gelsin, sessiz kalmasın
    await c.setSinkId("").catch(() => {});
    return e instanceof DOMException && e.name === "NotAllowedError" ? "permission" : "missing";
  }
}

/**
 * Uyarıların çalacağı hoparlörü seçer ("" = sistemin varsayılanı). Hoparlör bulunamazsa ya da izin yoksa ses
 * varsayılan çıkışa döner; sonuç durum olarak döner (ekranda uyarı için).
 */
export async function setOutput(id: string): Promise<OutputStatus> {
  if (!outputSelectable()) {
    output = { id: "", status: "unsupported" };
    notifyAudio();
    return output.status;
  }
  output = { id, status: output.status };
  const c = context();
  const run = sinkChange.then(() => (c ? applySink(id) : Promise.resolve<OutputStatus>(id ? "active" : "default")));
  sinkChange = run.catch(() => null);
  const status = await run;
  if (output.id === id) {
    output = { id, status };
    syncGate();
    notifyAudio();
  }
  return status;
}

const outputSnapshot = () => output.status;
const audibleSnapshot = () => alertsAudible();

/** Bileşende: uyarı sesi şu an çalınabilir mi (sunucuda evet) */
export function useAlertsAudible(): boolean {
  return useSyncExternalStore(subscribeAudio, audibleSnapshot, () => true);
}

/** Bileşende çıkışın durumu (sunucuda "default") */
export function useOutputStatus(): OutputStatus {
  return useSyncExternalStore(subscribeAudio, outputSnapshot, () => "default");
}

export type AudioState = "unsupported" | "locked" | "ready";

export function audioState(): AudioState {
  if (typeof window === "undefined") return "locked";
  const c = context();
  if (!c) return "unsupported";
  return c.state === "running" ? "ready" : "locked";
}

/** Sesin durumu değişince haber verir (açıldı, tarayıcı askıya aldı) */
export function subscribeAudio(fn: () => void) {
  audioListeners.add(fn);
  return () => {
    audioListeners.delete(fn);
  };
}

/** Bileşende sesin durumu (sunucuda "locked") */
export function useAudioState(): AudioState {
  return useSyncExternalStore(subscribeAudio, audioState, () => "locked");
}

/** Bir kullanıcı hareketinin içinde çağrılır; ses açıldıysa true */
export async function unlockAudio(): Promise<boolean> {
  const c = context();
  if (!c) return false;
  try {
    // İlk ses yanlış hoparlörden çıkmasın: çıkış seçimi bitmeden çalınmaz
    await sinkChange;
    if (c.state !== "running") await c.resume();
    // Sessiz kısa bir ses: bazı tarayıcılar ancak gerçekten bir ses çalınınca açar
    const o = c.createOscillator();
    const g = c.createGain();
    g.gain.value = 0.0001;
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + 0.02);
  } catch {
    return false;
  }
  notifyAudio();
  return c.state === "running";
}

export function setVolume(v: number) {
  volume = Math.min(1, Math.max(0, v));
  syncGate();
}

/** Tek bir nota: hızlı başlayıp sönen */
function tone(c: AudioContext, out: AudioNode, freq: number, at: number, duration: number, type: OscillatorType = "sine", peak = 0.55): OscillatorNode {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + duration + 0.05);
  return o;
}

/** Seslerin notaları: [frekans, başlangıç (sn), süre (sn), dalga, şiddet] */
type Note = [number, number, number, OscillatorType?, number?];

/** Çan: temel nota ve bir oktav üstü birlikte; dizüstü hoparlörünün en iyi verdiği 1–3 kHz bandında, müzikte duyulur */
const bell = (freq: number, at: number, duration: number): Note[] => [
  [freq, at, duration, "triangle", 0.6],
  [freq * 2, at, duration * 0.8, "sine", 0.22],
];

const PATTERNS: Record<SoundKind, Note[]> = {
  // Yeni rezervasyon ve yeni uygulama siparişi: yükselen üçlü çan, üç kez (sipariş zili gibi)
  ring: [0, 0.85, 1.7].flatMap((t) => [...bell(1047, t, 0.22), ...bell(1319, t + 0.16, 0.22), ...bell(1568, t + 0.32, 0.45)]),
  // Masaya sipariş: aynı çan üç kez ve bir oktav üstü vurguyla (masada oturan bekler; sitenin zil kuralı: masa önce ve
  // daha yüksek sesle)
  table: [0, 0.75, 1.5].flatMap((t) => [...bell(1047, t, 0.22), ...bell(1319, t + 0.14, 0.22), ...bell(1568, t + 0.28, 0.3), ...bell(2093, t + 0.42, 0.3)]),
  // Masa çağrısı ("Garson çağır"): inen iki notalı kapı zili (ding-dong), üç kez; sipariş zilinin yükselen çanından
  // ayrı duyulsun (masada biri bekliyor ama sipariş yok)
  call: [0, 0.9, 1.8].flatMap((t) => [...bell(1568, t, 0.3), ...bell(1175, t + 0.3, 0.5)]),
  // Oturum başladı: iki nota
  start: [...bell(784, 0, 0.3), ...bell(1175, 0.22, 0.45)],
  // Bitime az kaldı: üç kısa bip
  warn: [0, 0.24, 0.48].map((t): Note => [1568, t, 0.14, "square", 0.32]),
  // Kişisel hatırlatma: üçlü çan
  reminder: [...bell(988, 0, 0.25), ...bell(1175, 0.18, 0.25), ...bell(1397, 0.36, 0.45)],
  // Süre doldu: dikkat çeken iki tonlu alarm (döngüde tekrar eder)
  alarm: [0, 0.2, 0.4, 0.6, 0.8, 1.0].map((t, i): Note => [i % 2 ? 1175 : 1568, t, i === 5 ? 0.3 : 0.18, "square", 0.34]),
  test: [...bell(1047, 0, 0.22), ...bell(1568, 0.18, 0.4)],
};

function schedule(kind: SoundKind, at: number, wallMs: number = Date.now()): OscillatorNode[] {
  const c = context();
  // Çalınamıyorsa ("yalnız bu bilgisayar" açık, hoparlör yok) hiç kurulmaz: genel hoparlöre ses gitmez
  if (!c || !master || c.state !== "running" || !alertsAudible()) return [];
  // 09:00–01:00 dışında ses yok (deneme sesi hariç)
  if (kind !== "test" && !alertHoursOpen(wallMs)) return [];
  return PATTERNS[kind].map(([f, t, d, type, peak]) => tone(c, master!, f, at + t, d, type, peak));
}

/** Sesi hemen çalar (ses kapalıysa bir şey yapmaz) */
export function play(kind: SoundKind) {
  const c = context();
  if (!c) return;
  schedule(kind, c.currentTime + 0.02);
}

/**
 * Alarmı isteyenler ("karaoke": süresi dolan oturum, "hatirlatici:12": sürekli sesli hatırlatma). Alarm tektir; her
 * sahip yalnız kendini susturur (hatırlatmada "Yaptım" karaoke alarmını kesmez, ses açılınca karaoke etkisinin
 * temizliği hatırlatmanın alarmını kesmez), son sahip susunca alarm durur.
 */
const alarmOwners = new Set<string>();
let ownersSnapshot = "";

function ownersChanged() {
  const next = [...alarmOwners].sort().join(",");
  if (next === ownersSnapshot) return;
  ownersSnapshot = next;
  notifyAudio();
}

/**
 * Alarm döngüsü: her 2,2 saniyede bir, toplam ALARM_RINGS (3) kez çalar ve kendiliğinden susar (sürekli çalmaz). Yeni bir
 * sahip alarmı başlatırsa 3 çalış yeniden başlar; 09:00–01:00 dışında hiç çalmaz.
 */
export function startAlarm(owner: string) {
  alarmOwners.add(owner);
  ownersChanged();
  alarmRingsLeft = ALARM_RINGS;
  if (alarmTimer) return;
  play("alarm");
  alarmRingsLeft--;
  alarmTimer = setInterval(() => {
    if (alarmRingsLeft <= 0) return stopAlarm();
    play("alarm");
    alarmRingsLeft--;
  }, 2200);
}

/** Sahibin alarmını susturur (başka sahip çalıyorsa alarm sürer); sahipsiz çağrı (3 çalış doldu) hepsini susturur */
export function stopAlarm(owner?: string) {
  if (owner === undefined) alarmOwners.clear();
  else alarmOwners.delete(owner);
  ownersChanged();
  if (alarmOwners.size) return;
  if (alarmTimer) clearInterval(alarmTimer);
  alarmTimer = null;
}

export const alarmRinging = () => alarmTimer !== null;

/** Şu an alarmı çalan sahipler (useAlarmOwners'ın anlık hâli; bileşen dışından, ör. temizlikte okumak için) */
export const alarmOwnersNow = () => ownersSnapshot;

/** Alarmı çalan sahipler, virgülle ve sıralı ("hatirlatici:12,karaoke"); sunucuda boş */
export function useAlarmOwners(): string {
  return useSyncExternalStore(
    subscribeAudio,
    () => ownersSnapshot,
    () => "",
  );
}

/**
 * Sürenin bittiği ana ses saatinden alarm kurar (sekme arka planda olsa da tam zamanında, 3 kez çalar); dönen
 * işlev kurulan sesleri iptal eder. Ses kapalıysa hiçbir şey kurulmaz.
 */
export function scheduleBurst(atMs: number): () => void {
  const c = context();
  if (!c || c.state !== "running" || !alertsAudible()) return () => {};
  const delay = (atMs - Date.now()) / 1000;
  if (delay < 0.05 || delay > 12 * 3600) return () => {};
  const nodes: OscillatorNode[] = [];
  for (let i = 0; i < ALARM_RINGS; i++) nodes.push(...schedule("alarm", c.currentTime + delay + i * 2.2, atMs + i * 2200));
  return () => {
    for (const n of nodes) {
      try {
        n.stop();
        n.disconnect();
      } catch {
        // Zaten çalıp bitmiş
      }
    }
  };
}

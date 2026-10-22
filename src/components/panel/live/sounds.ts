"use client";

import { useSyncExternalStore } from "react";

/**
 * Uyarı sesleri, ses dosyası olmadan (Web Audio ile üretilir; indirilecek bir şey yok, çevrimdışı da çalar).
 * Tarayıcılar sesi ancak sayfada bir dokunuştan sonra açar: ilk dokunuşta unlockAudio() çağrılır (alert-center.tsx);
 * o zamana kadar "Sesli uyarılar için dokunun" düğmesi görünür.
 *
 * Gürültülü barda duyulsun diye sesler parlak ve yüksektir; çıkıştaki sınırlayıcı üst üste binen notaların
 * cızırdamasını önler. Ses, cihazda seçilen hoparlöre çalar (setOutput; Bluetooth hoparlörde müzik çalarken
 * bilgisayarın kendi hoparlörü), seçilmemişse sistemin varsayılan çıkışına.
 *
 * Arka plandaki sekmede zamanlayıcılar geç kalabilir; sürenin bittiği an ayrıca ses saatine kurulur (scheduleBurst):
 * ses saati kısılmaz, alarm tam zamanında başlar.
 */

export type SoundKind = "ring" | "table" | "start" | "warn" | "reminder" | "alarm" | "test";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const audioListeners = new Set<() => void>();
const notifyAudio = () => {
  for (const fn of audioListeners) fn();
};
let alarmTimer: ReturnType<typeof setInterval> | null = null;
let alarmUntil = 0;
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
  master.gain.value = volume;
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

export type OutputStatus = "default" | "active" | "missing" | "permission" | "unsupported";

let output: { id: string; status: OutputStatus } = { id: "", status: "default" };
let sinkChange: Promise<unknown> = Promise.resolve();

/** Bu tarayıcıda uyarıların hoparlörü seçilebilir mi (Chrome / Edge; Safari ve iPhone'da hayır) */
export function outputSelectable(): boolean {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") return false;
  return "setSinkId" in window.AudioContext.prototype;
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
    notifyAudio();
  }
  return status;
}

const outputSnapshot = () => output.status;

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
  if (master) master.gain.value = volume;
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
  // Masaya sipariş: aynı çan beş kez ve bir oktav üstü vurguyla (masada oturan bekler; sitenin zil kuralı: masa önce ve
  // daha yüksek sesle)
  table: [0, 0.75, 1.5, 2.25, 3].flatMap((t) => [...bell(1047, t, 0.22), ...bell(1319, t + 0.14, 0.22), ...bell(1568, t + 0.28, 0.3), ...bell(2093, t + 0.42, 0.3)]),
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

function schedule(kind: SoundKind, at: number): OscillatorNode[] {
  const c = context();
  if (!c || !master || c.state !== "running") return [];
  return PATTERNS[kind].map(([f, t, d, type, peak]) => tone(c, master!, f, at + t, d, type, peak));
}

/** Sesi hemen çalar (ses kapalıysa bir şey yapmaz) */
export function play(kind: SoundKind) {
  const c = context();
  if (!c) return;
  schedule(kind, c.currentTime + 0.02);
}

/** Alarm döngüsü: susturulana kadar (en çok 30 dakika) her 2,2 saniyede bir */
export function startAlarm() {
  alarmUntil = Date.now() + 30 * 60_000;
  if (alarmTimer) return;
  play("alarm");
  alarmTimer = setInterval(() => {
    if (Date.now() > alarmUntil) return stopAlarm();
    play("alarm");
  }, 2200);
}

export function stopAlarm() {
  if (alarmTimer) clearInterval(alarmTimer);
  alarmTimer = null;
}

export const alarmRinging = () => alarmTimer !== null;

/**
 * Sürenin bittiği ana ses saatinden alarm kurar (sekme arka planda olsa da tam zamanında, 12 saniye çalar); dönen
 * işlev kurulan sesleri iptal eder. Ses kapalıysa hiçbir şey kurulmaz.
 */
export function scheduleBurst(atMs: number): () => void {
  const c = context();
  if (!c || c.state !== "running") return () => {};
  const delay = (atMs - Date.now()) / 1000;
  if (delay < 0.05 || delay > 12 * 3600) return () => {};
  const nodes: OscillatorNode[] = [];
  for (let i = 0; i < 6; i++) nodes.push(...schedule("alarm", c.currentTime + delay + i * 2.2));
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

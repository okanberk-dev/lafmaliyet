"use client";

import { Flashlight, FlashlightOff, ImagePlus, LoaderCircle, ScanLine, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent } from "react";
import { createRoot } from "react-dom/client";

import { fitSize, type Quad } from "@/lib/scan/image";
import { AutoCapture, LIVE_EDGE, LIVE_HINT_TEXT, LIVE_MIN_INTERVAL, nextLiveEdge, QuadSmoother, type LiveHint } from "@/lib/scan/live";
import { cn } from "@/lib/utils";

import type { LiveResult } from "./scan/live.worker";

/*
 * Canlı vizör (docs/FOTOGRAF.md › Canlı vizör): belge fotoğrafı telefonun kendi kamera uygulaması yerine panelin içinde
 * çekilir. Arka kamera (getUserMedia, en çok 2560 × 1440 istenir); kameranın küçültülmüş karesinde (192–384 px,
 * süreye göre) kâğıt bir Web Worker'da aranır (scan/live.worker.ts, saniyede ~8–12 kare), kenarları vizörde canlı
 * çizilir. Dörtgen yumuşatılır (src/lib/scan/live.ts: titremez, tek karelik yanlış dörtgen atlanır) ve ekranda her
 * karede ona doğru kayar (ana iş parçacığı yalnız kareyi küçültür ve çizer). Kâğıt sabit, yeterince büyük, kareden
 * taşmıyor, ışık ve netlik yeterliyse kısa geri sayımla kendiliğinden çekilir (destekleyen telefonda kısa titreşim);
 * deklanşör her zaman elle de çalışır. Fener (destekleyen telefonda), "Galeriden" ve otomatik çekimi kapatma
 * düğmesi. Çekilen kare tam çözünürlükte (ImageCapture.takePhoto varsa, yoksa videonun karesi) dosya olarak döner;
 * tarama ekranı (scan-editor.tsx) onu tarar. İzin verilmezse ya da kamera açılamazsa eski yol (camera-shot.ts).
 * Pil: sekme gizlenince kamera kapanır (dönünce yeniden açılır), ekran kapanınca akış durur.
 */

export interface LiveCameraOptions {
  /** Başlık; varsayılan "Belgeyi çek" */
  title?: string;
  /** Başlığın altında kısa not (ör. uzun fişin sonraki parçası) */
  note?: string;
}

/** Çekilen (ya da galeriden seçilen) dosya; "fallback": vizör açılamadı, eski yol (`remember`: bu tarayıcıda hatırla) */
export type LiveCameraResult = { kind: "photo"; file: File } | { kind: "fallback"; remember: boolean } | null;

const AUTO_KEY = "laf:canli-kamera:otomatik";
/** Kamera bu sürede görüntü vermezse eski yol (ms) */
const START_TIMEOUT = 10_000;
/** takePhoto en çok bu kadar beklenir; sonra videonun karesi (ms) */
const PHOTO_TIMEOUT = 3_500;
const RING_R = 40;
const RING_C = 2 * Math.PI * RING_R;

function readAuto(): boolean {
  try {
    return window.localStorage.getItem(AUTO_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeAuto(on: boolean) {
  try {
    window.localStorage.setItem(AUTO_KEY, on ? "1" : "0");
  } catch {
    // gizli sekme: yalnız bu açılışta
  }
}

/** Alanda videonun kutusu (oran korunur, ortada: çekilecek karenin tamamı görünür) */
function containBox(sw: number, sh: number, vw: number, vh: number) {
  const scale = Math.max(0.0001, Math.min(sw / vw, sh / vh));
  return { left: (sw - vw * scale) / 2, top: (sh - vh * scale) / 2, width: vw * scale, height: vh * scale, scale };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("zaman aşımı")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Videonun o anki karesi, tam çözünürlükte JPEG */
function videoFrame(video: HTMLVideoElement): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  const ctx = c.getContext("2d");
  if (!ctx) return Promise.reject(new Error("tuval"));
  ctx.drawImage(video, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("kodlama"))), "image/jpeg", 0.92));
}

/**
 * Tam çözünürlüklü fotoğraf: ImageCapture.takePhoto (kameranın fotoğraf çözünürlüğü, çoğu telefonda videodan büyük;
 * flaş kapalı: fişte parlama yapmasın). Fener açıkken, takePhoto yoksa, hata verirse, geç kalırsa ya da fotoğrafın yönü
 * videonunkini tutmazsa (bazı telefonlar algılayıcının yönünde verir) videonun karesi
 */
async function grabPhoto(video: HTMLVideoElement, track: MediaStreamTrack | null, torch: boolean): Promise<Blob> {
  if (track && !torch && typeof window.ImageCapture === "function") {
    try {
      const ic = new window.ImageCapture(track);
      const settings: PhotoSettings = {};
      try {
        const caps = await withTimeout(ic.getPhotoCapabilities(), 1500);
        if (caps.fillLightMode?.includes("off")) settings.fillLightMode = "off";
      } catch {
        // yetenek okunamadı: varsayılan ayarla
      }
      const blob = await withTimeout(ic.takePhoto(settings), PHOTO_TIMEOUT);
      const bmp = await createImageBitmap(blob);
      const same = bmp.width >= bmp.height === video.videoWidth >= video.videoHeight;
      bmp.close();
      if (same) return blob;
    } catch {
      // videonun karesine düşülür
    }
  }
  return videoFrame(video);
}

type Phase = "aciliyor" | "canli" | "cekiliyor" | "duraklatildi";

export function LiveCamera({ opts, onDone }: { opts: LiveCameraOptions; onDone: (r: LiveCameraResult) => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const polyRef = useRef<SVGPolygonElement>(null);
  const shadeRef = useRef<SVGPathElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const doneRef = useRef(false);
  const capturingRef = useRef(false);
  const autoRef = useRef(true);
  const torchRef = useRef(false);
  // Gösterilen dörtgen her ekran karesinde hedefe (yumuşatılmış algılama) doğru kayar; videonun pikselinde
  const targetRef = useRef<Quad | null>(null);
  const shownRef = useRef<Quad | null>(null);

  const [phase, setPhase] = useState<Phase>("aciliyor");
  const [video, setVideo] = useState<{ width: number; height: number } | null>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [hint, setHint] = useState<LiveHint>("ara");
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [detecting, setDetecting] = useState(true);
  const [auto, setAuto] = useState(true);
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false });
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = (r: LiveCameraResult) => {
    if (doneRef.current) return;
    doneRef.current = true;
    stopStream();
    onDone(r);
  };

  function stopStream() {
    for (const t of streamRef.current?.getTracks() ?? []) t.stop();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  // Pencere: yerel <dialog> üst katmanda (tarama ekranının da üstünde); Esc kapatır
  useLayoutEffect(() => {
    const el = dialogRef.current;
    if (!el || el.open) return;
    el.showModal();
    el.focus({ preventScroll: true });
    const a = readAuto();
    autoRef.current = a;
    setAuto(a);
  }, []);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStage({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Kamera, algılama döngüsü ve çizim: açılışta; sekme gizlenince kamera kapanır, dönünce yeniden açılır
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let raf = 0;
    let worker: Worker | null = null;
    let busy = false;
    let seq = 0;
    let edge: number = LIVE_EDGE.start;
    const sent = new Map<number, { t: number; k: number }>();
    const smoother = new QuadSmoother();
    const decide = new AutoCapture();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    try {
      worker = new Worker(new URL("./scan/live.worker.ts", import.meta.url), { type: "module", name: "canli-vizor" });
    } catch {
      worker = null;
    }

    const noDetection = () => {
      worker?.terminate();
      worker = null;
      targetRef.current = null;
      if (!alive) return;
      setDetecting(false);
      setReady(false);
      setProgress(0);
    };

    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, ms);
    };

    // Kareyi küçültüp Worker'a gönderir (yanıt gelmeden yenisi gitmez)
    function tick() {
      timer = null;
      const v = videoRef.current;
      if (!alive || !worker || !ctx || busy || capturingRef.current) return;
      if (!v || !streamRef.current || v.readyState < 2 || !v.videoWidth) return schedule(100);
      const s = fitSize(v.videoWidth, v.videoHeight, edge);
      if (canvas.width !== s.width || canvas.height !== s.height) {
        canvas.width = s.width;
        canvas.height = s.height;
      }
      ctx.drawImage(v, 0, 0, s.width, s.height);
      const data = ctx.getImageData(0, 0, s.width, s.height).data;
      const id = ++seq;
      sent.set(id, { t: performance.now(), k: s.width / v.videoWidth });
      busy = true;
      worker.postMessage({ id, frame: { width: s.width, height: s.height, data } }, [data.buffer]);
    }

    if (worker) {
      worker.onmessage = (e: MessageEvent<{ id: number; res?: LiveResult; error?: string }>) => {
        busy = false;
        const meta = sent.get(e.data.id);
        sent.delete(e.data.id);
        const v = videoRef.current;
        const res = e.data.res;
        if (!alive || !meta || !v || !v.videoWidth) return schedule(LIVE_MIN_INTERVAL);
        if (res) {
          edge = nextLiveEdge(edge, res.ms);
          const vw = v.videoWidth;
          const vh = v.videoHeight;
          const quad = res.quad ? (res.quad.map((p) => ({ x: (p.x + 0.5) / meta.k - 0.5, y: (p.y + 0.5) / meta.k - 0.5 })) as Quad) : null;
          const t = performance.now();
          targetRef.current = smoother.push(quad, t, vw, vh);
          const st = decide.push({ t, width: vw, height: vh, quad, confidence: res.confidence, fillsFrame: res.fillsFrame, luma: res.luma, sharpness: res.sharpness }, autoRef.current);
          setHint(st.hint);
          setReady(st.ready);
          setProgress(st.progress);
          if (st.fire) {
            void capture("auto");
            return;
          }
        }
        schedule(Math.max(0, LIVE_MIN_INTERVAL - (performance.now() - meta.t)));
      };
      worker.onerror = (e) => {
        e.preventDefault();
        noDetection();
      };
    } else noDetection();

    // Dörtgen her ekran karesinde hedefe doğru kayar (algılama ~10 kare/sn, çizim akıcı)
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const poly = polyRef.current;
      const shade = shadeRef.current;
      const v = videoRef.current;
      if (!poly || !shade || !v) return;
      const target = targetRef.current;
      if (!target) {
        shownRef.current = null;
        poly.style.opacity = "0";
        shade.style.opacity = "0";
        return;
      }
      const prev = shownRef.current;
      const q = prev ? (prev.map((p, i) => ({ x: p.x + 0.35 * (target[i].x - p.x), y: p.y + 0.35 * (target[i].y - p.y) })) as Quad) : target;
      shownRef.current = q;
      const pts = q.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
      poly.setAttribute("points", pts);
      shade.setAttribute("d", `M0 0H${v.videoWidth}V${v.videoHeight}H0Z M${q.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L")}Z`);
      poly.style.opacity = "1";
      shade.style.opacity = "1";
    };

    async function start() {
      if (!alive || streamRef.current) return;
      setPhase("aciliyor");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1440 } },
        });
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        // İzin reddedildi ya da kamera yok: bu tarayıcıda hatırlanır; kamera meşgul (başka uygulama): yalnız bu sefer
        finish({ kind: "fallback", remember: name === "NotAllowedError" || name === "SecurityError" || name === "NotFoundError" || name === "OverconstrainedError" });
        return;
      }
      if (!alive || document.hidden) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0] ?? null;
      const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
      torchRef.current = false;
      setTorch({ supported: Boolean(caps.torch), on: false });
      if (caps.focusMode?.includes("continuous")) {
        track?.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
      }
      const v = videoRef.current;
      if (!v) return;
      v.srcObject = stream;
      v.play().catch(() => {});
      const began = performance.now();
      const ready = () => {
        if (!alive || streamRef.current !== stream) return;
        if (v.videoWidth && v.readyState >= 2) {
          setVideo({ width: v.videoWidth, height: v.videoHeight });
          setPhase("canli");
          smoother.reset();
          decide.reset();
          schedule(0);
          return;
        }
        if (performance.now() - began > START_TIMEOUT) return finish({ kind: "fallback", remember: false });
        setTimeout(ready, 100);
      };
      ready();
    }

    const onVisibility = () => {
      if (document.hidden) {
        if (timer) clearTimeout(timer);
        timer = null;
        stopStream();
        targetRef.current = null;
        if (!capturingRef.current) setPhase("duraklatildi");
      } else if (!capturingRef.current) void start();
    };

    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(draw);
    void start();
    // Videonun ölçüsü dönünce değişir (telefon yan çevrildi)
    const v = videoRef.current;
    const onResize = () => v?.videoWidth && setVideo({ width: v.videoWidth, height: v.videoHeight });
    v?.addEventListener("resize", onResize);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisibility);
      v?.removeEventListener("resize", onResize);
      if (timer) clearTimeout(timer);
      cancelAnimationFrame(raf);
      worker?.terminate();
      stopStream();
    };
    // Açılışta bir kez; `capture` ve `finish` ref'lerle çalışır
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function capture(why: "auto" | "elle") {
    const v = videoRef.current;
    if (capturingRef.current || !v || !streamRef.current || !v.videoWidth) return;
    capturingRef.current = true;
    setPhase("cekiliyor");
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    try {
      navigator.vibrate?.(why === "auto" ? [30, 40, 30] : 25);
    } catch {
      // titreşim yok
    }
    try {
      const track = streamRef.current.getVideoTracks()[0] ?? null;
      const blob = await grabPhoto(v, track, torchRef.current);
      finish({ kind: "photo", file: new File([blob], "kamera.jpg", { type: blob.type || "image/jpeg" }) });
    } catch {
      capturingRef.current = false;
      setError("Çekilemedi; yeniden deneyin.");
      setPhase("canli");
    }
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const on = !torchRef.current;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      torchRef.current = on;
      setTorch((t) => ({ ...t, on }));
    } catch {
      setTorch({ supported: false, on: false });
    }
  }

  function toggleAuto() {
    const on = !autoRef.current;
    autoRef.current = on;
    setAuto(on);
    writeAuto(on);
  }

  function onGallery(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) finish({ kind: "photo", file });
  }

  const box = video && stage.width > 0 ? containBox(stage.width, stage.height, video.width, video.height) : null;
  const live = phase === "canli";
  const text = error
    ? error
    : phase === "aciliyor"
      ? "Kamera açılıyor…"
      : phase === "duraklatildi"
        ? "Kamera duraklatıldı"
        : phase === "cekiliyor"
          ? LIVE_HINT_TEXT.cekiliyor
          : !detecting
            ? "Kâğıdı çerçeveye alıp deklanşöre basın"
            : hint === "karanlik" && torch.supported && !torch.on
              ? "Işık az; feneri açın ya da ışıklı bir yere geçin"
              : hint === "hazir" || (ready && !auto)
                ? LIVE_HINT_TEXT.hazir
                : LIVE_HINT_TEXT[hint];

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!capturingRef.current) finish(null);
      }}
      className="fixed inset-0 m-0 hidden h-dvh max-h-none w-screen max-w-none flex-col overflow-hidden bg-black p-0 text-white outline-none backdrop:bg-black open:flex"
    >
      <header className="flex items-center gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        <button type="button" onClick={() => finish(null)} aria-label="Kapat (fotoğraf çekilmez)" className="grid size-11 shrink-0 place-items-center rounded-full text-white/90 hover:bg-white/10">
          <X size={22} aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <h2 id={titleId} className="truncate text-[15px] font-semibold tracking-tight">
            {opts.title ?? "Belgeyi çek"}
          </h2>
          {opts.note ? <p className="truncate text-[12px] leading-4 text-white/70">{opts.note}</p> : null}
        </div>
        {torch.supported ? (
          <button
            type="button"
            onClick={() => void toggleTorch()}
            aria-pressed={torch.on}
            aria-label={torch.on ? "Feneri kapat" : "Feneri aç"}
            className={cn("grid size-11 shrink-0 place-items-center rounded-full", torch.on ? "bg-[#c0f21e] text-black" : "text-white/90 hover:bg-white/10")}
          >
            {torch.on ? <Flashlight size={20} aria-hidden="true" /> : <FlashlightOff size={20} aria-hidden="true" />}
          </button>
        ) : (
          <span className="size-11 shrink-0" aria-hidden="true" />
        )}
      </header>

      <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted autoPlay aria-label="Kameranın görüntüsü" className="absolute inset-0 size-full object-contain" />
        {box && video ? (
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute overflow-visible"
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            viewBox={`0 0 ${video.width} ${video.height}`}
            preserveAspectRatio="none"
          >
            <path ref={shadeRef} fillRule="evenodd" className="fill-black/35 transition-opacity duration-200" style={{ opacity: 0 }} />
            <polygon
              ref={polyRef}
              className={cn("transition-[opacity,fill] duration-200", ready ? "fill-[#c0f21e]/20 stroke-[#c0f21e]" : "fill-[#c0f21e]/10 stroke-[#c0f21e]/90")}
              strokeWidth={ready ? 4 : 3}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{ opacity: 0 }}
            />
          </svg>
        ) : null}
        {phase === "aciliyor" || phase === "duraklatildi" ? (
          <div className="absolute inset-0 grid place-items-center text-sm text-white/75">
            <span className="flex items-center gap-2">
              {phase === "aciliyor" ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : null}
              {phase === "aciliyor" ? "Kamera açılıyor…" : "Kamera duraklatıldı"}
            </span>
          </div>
        ) : null}
        <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0 bg-white transition-opacity duration-150", flash ? "opacity-80" : "opacity-0")} />
        <p
          aria-live="polite"
          className={cn(
            "absolute inset-x-4 bottom-3 mx-auto w-fit max-w-full rounded-full px-3.5 py-1.5 text-center text-[13px] leading-5 font-medium shadow-[0_2px_10px_rgb(0_0_0/0.4)] backdrop-blur",
            error ? "bg-[#ff5a4f]/90 text-white" : ready || phase === "cekiliyor" ? "bg-[#c0f21e] text-black" : "bg-black/60 text-white",
          )}
        >
          {text}
        </p>
      </div>

      <footer className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button type="button" onClick={() => galleryRef.current?.click()} disabled={phase === "cekiliyor"} className="flex min-h-12 flex-col items-center justify-center gap-0.5 justify-self-start rounded-xl px-2 text-[12px] text-white/85 hover:bg-white/10 disabled:opacity-40">
          <ImagePlus size={22} aria-hidden="true" /> Galeriden
        </button>
        <button
          type="button"
          onClick={() => void capture("elle")}
          disabled={!live}
          aria-label="Çek"
          className="relative grid size-[84px] place-items-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-white/50 disabled:opacity-50"
        >
          <svg aria-hidden="true" viewBox="0 0 92 92" className="absolute inset-0 size-full -rotate-90">
            <circle cx="46" cy="46" r={RING_R} className="fill-none stroke-white/35" strokeWidth={4} />
            <circle
              cx="46"
              cy="46"
              r={RING_R}
              className="fill-none stroke-[#c0f21e] transition-[stroke-dashoffset] duration-100 ease-linear"
              strokeWidth={4}
              strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - progress)}
            />
          </svg>
          <span className={cn("size-[64px] rounded-full bg-white transition-transform active:scale-90", phase === "cekiliyor" && "scale-90 bg-white/70")} />
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={auto}
          aria-label="Otomatik çekim"
          onClick={toggleAuto}
          disabled={!detecting}
          className={cn("flex min-h-12 flex-col items-center justify-center gap-0.5 justify-self-end rounded-xl px-2 text-[12px] hover:bg-white/10 disabled:opacity-40", auto ? "text-[#c0f21e]" : "text-white/70")}
        >
          <ScanLine size={22} aria-hidden="true" /> {auto ? "Otomatik" : "Otomatik kapalı"}
        </button>
      </footer>
      <input ref={galleryRef} type="file" accept="image/*" hidden onChange={onGallery} />
    </dialog>
  );
}

/**
 * Canlı vizörü açar ve sonucu bekler (kendi köküne çizilir; tarama ekranının üstünde de açılabilir). `close` vizörü
 * kapatır (sayfa değişti), sonuç null olur.
 */
export function openLiveCamera(opts: LiveCameraOptions = {}): { result: Promise<LiveCameraResult>; close: () => void } {
  const host = document.createElement("div");
  host.dataset.liveCamera = "";
  document.body.append(host);
  const root = createRoot(host);
  let resolve!: (r: LiveCameraResult) => void;
  const result = new Promise<LiveCameraResult>((r) => (resolve = r));
  let done = false;
  const end = (r: LiveCameraResult) => {
    if (done) return;
    done = true;
    resolve(r);
    // Kök, seçim bildirildikten sonra kaldırılır (React kendi olayının içinde kaldırılmasın); akış zaten durdu
    setTimeout(() => {
      root.unmount();
      host.remove();
    }, 0);
  };
  root.render(<LiveCamera opts={opts} onDone={end} />);
  return { result, close: () => end(null) };
}

"use client";

import { Camera, Expand, LoaderCircle, RotateCw, ScrollText, Wand2, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createRoot } from "react-dom/client";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { needsAiHint, SCAN_MODE_LABEL, SCAN_MODE_LIST, scanMaxEdge, scanStatusText, type ScanInfo, type ScanInfoMethod } from "@/lib/photo-scan";
import { cornersFromHint, cornersToHint, estimateSize, fullFrame, orderCorners, quadIsValid, rotationForTop, type DocumentTop, type QuarterTurn, type Quad, type RgbaImage, type ScanMode } from "@/lib/scan";
import type { DocNoun, QualityIssue } from "@/lib/scan/quality";
import { cn } from "@/lib/utils";

import { decodePhoto, encodeScan, hintJpeg, previewUrl, ScanClient } from "./scan/client";

/*
 * Belge tarama ekranı (docs/FOTOGRAF.md › Belge tarama): Z raporu, banka gün sonu fişi, alışveriş fişi ve fatura
 * fotoğrafı seçilince açılır (telefonda tam ekran, masaüstünde pencere). Kâğıt telefonda bulunur (src/lib/scan, Web
 * Worker'da), kenarları belirgin çizilir (dörtgen, dışı karartılmış); dört köşe sürüklenir (dokunmatik ve fare, geniş
 * dokunma alanı, sürüklerken büyüteç; klavyede ok tuşları). Kod emin değilse ve okuma açıksa yapay zekâya köşe sorulur
 * (POST /api/foto/kenar), dönen köşeler gerçek kenara oturtulur; yapay zekâ yoksa sessizce kodun sonucu. "Kullan"
 * taranmış görüntüyü, "Taramadan kullan" fotoğrafı olduğu gibi yükletir; kapatmak yüklemeyi bırakır.
 *
 * Çekim sorunu (bulanık, parlama, karanlık, kesik, küçük yazı) tek satır uyarıyla "Yeniden çek" önerir: kamera ekranın
 * içinden açılır, yeni fotoğraf aynı ekranda taranır ("Kullan" yine serbest). Uzun fişte "Devamını çek": o anki parça
 * açılıp saklanır, sonraki parça çekilir (en çok `parts.max`); "Kullan" parçaları kodla hizalayıp tek uzun görüntüde
 * birleştirir (src/lib/scan/stitch.ts). Emin değilse parçalar ayrı fotoğraf olarak döner (çağıran alabiliyorsa).
 */

/** Taranmış bir görüntü: yüklenecek dosya, tarama bilgisi ve asıl fotoğraf (yeniden çekildiyse yenisi) */
export interface ScannedPart {
  scanned: Blob;
  info: ScanInfo;
  original: Blob;
}

/**
 * Kullanıcının seçimi: taranmış görüntü (uzun fiş birleştirilemediyse sonraki parçalar `more`'da) ya da taramasız
 * yükleme (`file`: yeniden çekildiyse son çekilen)
 */
export type ScanChoice = ({ kind: "scan" } & ScannedPart & { more?: ScannedPart[] }) | { kind: "skip"; file: Blob };

/** Uzun fiş: en çok kaç parça çekilir; birleştirilemezse kaç fotoğrafa kadar ayrı yüklenebilir (1: ayrı yüklenemez) */
export interface PartsOption {
  max: number;
  room: number;
}

const CORNER_LABEL = ["Sol üst köşe", "Sağ üst köşe", "Sağ alt köşe", "Sol alt köşe"] as const;
/** Fotoğrafın sahnedeki payı (köşe tutamakları kenarda da tutulabilsin) */
const STAGE_PAD = 22;
/** Köşe görüntünün en çok bu oranında dışına sürüklenir (kâğıdın köşesi kareden çıkmış olabilir) */
const DRAG_OUTSIDE = 0.08;
const LOUPE = 120;
const LOUPE_ZOOM = 2.5;
const PREVIEW_EDGE = 900;
const HINT_TIMEOUT_MS = 25_000;

interface Photo {
  width: number;
  height: number;
  url: string;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
}

/** Alanda görüntünün kutusu (oran korunur, ortada, kenarlarda `pad` boşluk) */
function fitBox(stageW: number, stageH: number, w: number, h: number, pad = STAGE_PAD): Box {
  const scale = Math.max(0.01, Math.min((stageW - 2 * pad) / w, (stageH - 2 * pad) / h));
  const width = w * scale;
  const height = h * scale;
  return { left: (stageW - width) / 2, top: (stageH - height) / 2, width, height, scale };
}

/** Kodun algılamasının yöntemi tarama bilgisine (kırpılmadıysa "tam-kare" ya da "yok") */
function methodOf(d: { corners: Quad | null; method: string | null; fillsFrame: boolean }): ScanInfoMethod {
  if (d.fillsFrame) return "tam-kare";
  if (!d.corners) return "yok";
  return d.method === "kagit" || d.method === "kenar" || d.method === "yazi" ? d.method : "yok";
}

/** Taranıyor hissi: fotoğrafın üstünde yukarı aşağı kayan ince ışık çizgisi (hareket azaltılmışsa durgun bir şerit) */
function ScanBeam({ on }: { on: boolean }) {
  const reduce = useReducedMotion();
  if (!on) return null;
  if (reduce) return <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#c0f21e]/10" />;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.div
        className="absolute inset-x-0 h-16 -translate-y-1/2 bg-gradient-to-b from-transparent via-[#c0f21e]/35 to-transparent"
        initial={{ top: "0%" }}
        animate={{ top: ["0%", "100%"] }}
        transition={{ duration: 1.7, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" }}
      >
        <div className="absolute inset-x-0 top-1/2 h-0.5 bg-[#c0f21e] shadow-[0_0_12px_2px_rgb(192_242_30/0.7)]" />
      </motion.div>
    </div>
  );
}

/** Parçalar birleştirilemedi, ayrı da yüklenemiyor */
const STITCH_FAILED_TEXT = "Parçalar birleştirilemedi; alt parçayı üsttekiyle birkaç satır örtüşerek yeniden çekin.";

export function ScanEditor({
  file,
  hint,
  noun = "belge",
  parts,
  onDone,
}: {
  file: Blob;
  hint: boolean;
  noun?: DocNoun;
  parts?: PartsOption;
  onDone: (choice: ScanChoice | null) => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  // Kamera neden açıldı: aynı parçayı yeniden çekmek ya da uzun fişin sonraki parçası
  const cameraFor = useRef<"again" | "next">("again");
  // Uzun fişin saklanan parçalarının bilgisi ve asıl fotoğrafı (görüntüleri motorda)
  const partsRef = useRef<{ info: ScanInfo; original: Blob }[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<ScanClient | null>(null);
  const imageRef = useRef<RgbaImage | null>(null);
  const autoRef = useRef<{ corners: Quad; method: ScanInfoMethod } | null>(null);
  const touchedRef = useRef(false);
  const rotatedRef = useRef(false);
  const aiTopRef = useRef(false);
  const previewSeq = useRef(0);
  const grab = useRef<{ index: number; dx: number; dy: number } | null>(null);
  const doneRef = useRef(false);

  const [src, setSrc] = useState<Blob>(file);
  const [partCount, setPartCount] = useState(0);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [stage, setStage] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const resultRef = useRef<HTMLDivElement>(null);
  const [resultBox, setResultBox] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [corners, setCorners] = useState<Quad | null>(null);
  const [method, setMethod] = useState<ScanInfoMethod | null>(null);
  const [confidence, setConfidence] = useState(0);
  const [hasAuto, setHasAuto] = useState(false);
  const [detecting, setDetecting] = useState(true);
  const [aiPending, setAiPending] = useState(false);
  const [aiAsked, setAiAsked] = useState(false);
  const [mode, setMode] = useState<ScanMode>("belge");
  const [rotate, setRotate] = useState<QuarterTurn>(0);
  const [preview, setPreview] = useState<{ url: string; width: number; height: number } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [view, setView] = useState<"kenar" | "sonuc">("kenar");
  const [dragging, setDragging] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<QualityIssue[]>([]);

  const finish =(choice: ScanChoice | null) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(choice);
  };

  // Pencere: yerel <dialog> üst katmanda (telefonda tam ekran); Esc yüklemeyi bırakır. Odak pencerenin kendisinde
  // (dokunmatikte Kapat düğmesi odak halkasıyla açılmasın; ekran okuyucu başlığı okur)
  useLayoutEffect(() => {
    const el = dialogRef.current;
    if (!el || el.open) return;
    el.showModal();
    el.focus({ preventScroll: true });
  }, []);

  // Sahnenin ve sonuç alanının ölçüsü (fotoğrafın ve önizlemenin kutusu bundan)
  useLayoutEffect(() => {
    const watch = (el: HTMLElement | null, set: (v: { width: number; height: number }) => void) => {
      if (!el) return null;
      const ro = new ResizeObserver(([entry]) => set({ width: entry.contentRect.width, height: entry.contentRect.height }));
      ro.observe(el);
      return ro;
    };
    const same = (a: { width: number; height: number }, b: { width: number; height: number }) => Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
    const a = watch(stageRef.current, (v) => setStage((s) => (same(s, v) ? s : v)));
    const b = watch(resultRef.current, (v) => setResultBox((s) => (same(s, v) ? s : v)));
    return () => {
      a?.disconnect();
      b?.disconnect();
    };
  }, []);

  // Motor (Web Worker) ekran açıkken bir tane: uzun fişin parçaları onda saklanır
  useEffect(() => {
    const client = new ScanClient();
    clientRef.current = client;
    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, []);

  // Fotoğrafı çöz, Worker'a yükle, kâğıdı bul; kod emin değilse ve okuma açıksa yapay zekâya sor. Yeniden çekilince
  // (ya da uzun fişin sonraki parçası) yeni fotoğrafla baştan
  useEffect(() => {
    let cancelled = false;
    let displayUrl: string | null = null;
    const ac = new AbortController();
    const client = clientRef.current;
    if (!client) return;
    (async () => {
      let decoded: Awaited<ReturnType<typeof decodePhoto>>;
      try {
        decoded = await decodePhoto(src);
      } catch {
        // Tarayıcı fotoğrafı açamadı (HEIC): yükleme taramasız sürer, hata metnini küçültme verir. Uzun fişin sonraki
        // parçası açılamadıysa önceki parçalar kalır, uyarı görünür
        if (cancelled) return;
        if (partsRef.current.length) {
          setError("Fotoğraf açılamadı; yeniden çekin.");
          setDetecting(false);
          return;
        }
        finish({ kind: "skip", file: src });
        return;
      }
      displayUrl = decoded.displayUrl;
      if (cancelled) return URL.revokeObjectURL(displayUrl);
      const img = decoded.image;
      imageRef.current = img;
      setPhoto({ width: img.width, height: img.height, url: decoded.displayUrl });
      try {
        await client.call({ type: "load", image: img });
        const res = await client.call({ type: "detect" });
        if (cancelled || res.type !== "detected") return;
        const d = res.detection;
        const m = methodOf(d);
        const q = d.corners && !d.fillsFrame ? d.corners : fullFrame(img.width, img.height);
        if (d.corners && !d.fillsFrame) {
          autoRef.current = { corners: q, method: m };
          setHasAuto(true);
        }
        setCorners(q);
        setMethod(m);
        setConfidence(d.confidence);
        setDetecting(false);
        // Sayfa yönü ve çekim kalitesi kâğıdın içinden (arka planda; köşeler beklemeden görünür)
        const analyze = async (quad: Quad) => {
          try {
            const a = await client.call({ type: "analyze", corners: quad, noun });
            if (cancelled || a.type !== "analyzed") return;
            setIssues(a.issues);
            if (a.rotate !== null && !rotatedRef.current && !aiTopRef.current) setRotate(a.rotate);
          } catch {
            // çözümleme çöktü: uyarısız, döndürmeden sürer
          }
        };
        void analyze(q);
        if (!hint || !needsAiHint(d)) return;
        setAiAsked(true);
        setAiPending(true);
        const timer = setTimeout(() => ac.abort(), HINT_TIMEOUT_MS);
        try {
          const small = await hintJpeg(img);
          const form = new FormData();
          form.append("dosya", small.blob, "kenar.jpg");
          const r = await fetch("/api/foto/kenar", { method: "POST", body: form, signal: ac.signal });
          const body = (await r.json().catch(() => null)) as { ok?: boolean; hint?: { document: boolean; top: DocumentTop; corners: [number, number][] | null } } | null;
          if (cancelled || !r.ok || !body?.ok || !body.hint) return;
          const h = body.hint;
          const given = h.document && h.corners ? cornersFromHint(h.corners, img.width, img.height) : null;
          if (given && quadIsValid(given, img.width, img.height)) {
            const ref = await client.call({ type: "refine", corners: given });
            if (cancelled) return;
            const refined = ref.type === "refined" ? ref.corners : given;
            autoRef.current = { corners: refined, method: "yapay-zeka" };
            setHasAuto(true);
            if (!touchedRef.current) {
              setCorners(refined);
              setMethod("yapay-zeka");
              void analyze(refined);
            }
          }
          // Belgenin üstü: yapay zekâ söylediyse kodun yön tahmininin önüne geçer (kullanıcı döndürmediyse)
          if (h.document) {
            aiTopRef.current = true;
            if (!rotatedRef.current) setRotate(rotationForTop(h.top));
          }
        } catch {
          // Yapay zekâ yok, yanıt vermedi ya da bağlantı koptu: kodun sonucu kalır
        } finally {
          clearTimeout(timer);
          if (!cancelled) setAiPending(false);
        }
      } catch {
        if (cancelled) return;
        // Algılama çöktü: fotoğrafın tamamı, köşeler elle
        setCorners(fullFrame(img.width, img.height));
        setMethod("yok");
        setDetecting(false);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
      imageRef.current = null;
      if (displayUrl) URL.revokeObjectURL(displayUrl);
    };
    // Fotoğraf değişince baştan; `hint` ve `noun` ekran açıkken değişmez
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Taranmış sonucun önizlemesi (çalışma kopyasında, ~900 px): köşe bırakılınca, mod ya da dönüş değişince
  useEffect(() => {
    if (!corners || dragging !== null || detecting) return;
    const client = clientRef.current;
    if (!client) return;
    const seq = ++previewSeq.current;
    const t = setTimeout(async () => {
      setPreviewBusy(true);
      try {
        const r = await client.call({ type: "scan", corners, mode, rotate, maxEdge: PREVIEW_EDGE, preview: true });
        if (seq !== previewSeq.current || r.type !== "scanned") return;
        const url = await previewUrl(r.image);
        if (seq !== previewSeq.current) return URL.revokeObjectURL(url);
        setPreview({ url, width: r.image.width, height: r.image.height });
      } catch {
        // kapandı ya da çöktü: önizleme eski hâliyle kalır
      } finally {
        if (seq === previewSeq.current) setPreviewBusy(false);
      }
    }, 120);
    return () => clearTimeout(t);
  }, [corners, mode, rotate, dragging, detecting]);

  // Önizlemenin adresi yenisi gelince ve ekran kapanınca bırakılır
  useEffect(() => {
    const url = preview?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [preview]);

  const box = photo && stage.width > 0 ? fitBox(stage.width, stage.height, photo.width, photo.height) : null;
  const valid = Boolean(photo && corners && quadIsValid(corners, photo.width, photo.height));
  const busy = detecting || finishing;
  // Uzun fişin sonraki parçası çekilebilir mi (parça sınırı dolmadıysa)
  const canContinue = Boolean(parts && parts.max >= 2 && partCount + 1 < parts.max);

  function setCorner(i: number, x: number, y: number) {
    if (!photo) return;
    const ox = DRAG_OUTSIDE * photo.width;
    const oy = DRAG_OUTSIDE * photo.height;
    const p = { x: Math.max(-ox, Math.min(photo.width - 1 + ox, x)), y: Math.max(-oy, Math.min(photo.height - 1 + oy, y)) };
    touchedRef.current = true;
    setCorners((c) => (c ? (c.map((q, k) => (k === i ? p : q)) as Quad) : c));
    setMethod("elle");
  }

  function onHandleDown(i: number, e: ReactPointerEvent<HTMLButtonElement>) {
    if (!box || !corners || finishing) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = stageRef.current!.getBoundingClientRect();
    const hx = rect.left + box.left + corners[i].x * box.scale;
    const hy = rect.top + box.top + corners[i].y * box.scale;
    grab.current = { index: i, dx: e.clientX - hx, dy: e.clientY - hy };
    setDragging(i);
  }

  function onHandleMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const g = grab.current;
    if (!g || !box || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    setCorner(g.index, (e.clientX - g.dx - rect.left - box.left) / box.scale, (e.clientY - g.dy - rect.top - box.top) / box.scale);
  }

  function onHandleUp() {
    grab.current = null;
    setDragging(null);
    // Sürüklenen köşeler çaprazlandıysa sıralanır (dörtgen yine sol üst, sağ üst, sağ alt, sol alt)
    setCorners((c) => (c ? orderCorners(c) : c));
  }

  function onHandleKey(i: number, e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!photo || !corners) return;
    const step = (e.shiftKey ? 0.02 : 0.004) * Math.max(photo.width, photo.height);
    const d = e.key === "ArrowLeft" ? [-step, 0] : e.key === "ArrowRight" ? [step, 0] : e.key === "ArrowUp" ? [0, -step] : e.key === "ArrowDown" ? [0, step] : null;
    if (!d) return;
    e.preventDefault();
    setCorner(i, corners[i].x + d[0], corners[i].y + d[1]);
  }

  function applyAuto() {
    const a = autoRef.current;
    if (!a) return;
    touchedRef.current = false;
    setCorners(a.corners);
    setMethod(a.method);
    setView("kenar");
  }

  function applyWhole() {
    if (!photo) return;
    touchedRef.current = true;
    setCorners(fullFrame(photo.width, photo.height));
    setMethod("tum-fotograf");
    setView("kenar");
  }

  function turn() {
    rotatedRef.current = true;
    setRotate((r) => ((r + 90) % 360) as QuarterTurn);
    setView("sonuc");
  }

  /** Yeni fotoğrafla baştan (yeniden çekildi ya da sonraki parça): ekranın fotoğrafa bağlı her şeyi sıfırlanır */
  function startPhoto(next: Blob) {
    autoRef.current = null;
    touchedRef.current = false;
    rotatedRef.current = false;
    aiTopRef.current = false;
    previewSeq.current++;
    setPhoto(null);
    setCorners(null);
    setMethod(null);
    setConfidence(0);
    setHasAuto(false);
    setDetecting(true);
    setAiPending(false);
    setAiAsked(false);
    setRotate(0);
    setPreview(null);
    setPreviewBusy(false);
    setIssues([]);
    setError(null);
    setView("kenar");
    setSrc(next);
  }

  /** Kamerayı ekranın içinden açar (dokunuşun kendisinde; tarayıcı başka türlü açtırmaz) */
  function openCamera(why: "again" | "next") {
    cameraFor.current = why;
    cameraRef.current?.click();
  }

  /** O anki köşelerle tarama bilgisi */
  function infoOf(q: Quad): ScanInfo {
    return { corners: cornersToHint(q, photo!.width, photo!.height), mode, method: method ?? "yok", confidence: Math.round(confidence * 100) / 100, rotate, ai: aiAsked };
  }

  async function onCamera(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.files?.[0];
    e.target.value = "";
    if (!next || finishing) return;
    if (cameraFor.current === "again") return startPhoto(next);
    // Sonraki parça: o anki parça (köşeleri, dönüşü) motorda açılıp saklanır, sonra yeni fotoğraf
    const client = clientRef.current;
    if (!client || !photo || !corners || !valid) return;
    setFinishing(true);
    try {
      const q = orderCorners(corners);
      const r = await client.call({ type: "part-add", corners: q, rotate });
      if (r.type !== "parts") throw new Error("parca");
      partsRef.current.push({ info: infoOf(q), original: src });
      setPartCount(partsRef.current.length);
      setFinishing(false);
      startPhoto(next);
    } catch {
      setError("Parça saklanamadı; yeniden deneyin.");
      setFinishing(false);
    }
  }

  async function accept() {
    const client = clientRef.current;
    if (!photo || !corners || !valid || !client || finishing) return;
    setFinishing(true);
    setError(null);
    try {
      const q = orderCorners(corners);
      if (partsRef.current.length) return await acceptParts(client, q);
      const size = estimateSize(q, photo.width, photo.height, 4096);
      const aspect = Math.max(size.width, size.height) / Math.max(1, Math.min(size.width, size.height));
      const r = await client.call({ type: "scan", corners: q, mode, rotate, maxEdge: scanMaxEdge(aspect), preview: false });
      if (r.type !== "scanned") throw new Error("tarama");
      const scanned = await encodeScan(r.image);
      finish({ kind: "scan", scanned, info: infoOf(q), original: src });
    } catch {
      setError("Taranamadı; yeniden deneyin ya da taramadan kullanın.");
      setFinishing(false);
    }
  }

  /**
   * Uzun fiş: son parça da saklanır, parçalar birleştirilir. Birleşirse tek görüntü (bilgisi ilk parçanınki, parça
   * sayısıyla); emin değilse parçalar ayrı fotoğraf (çağıranın yeri yetiyorsa), yetmiyorsa uyarı ve parçalar bırakılır
   * (ekrandaki son fotoğraf tek başına kullanılabilir)
   */
  async function acceptParts(client: ScanClient, q: Quad) {
    const added = await client.call({ type: "part-add", corners: q, rotate });
    if (added.type !== "parts") throw new Error("parca");
    const all = [...partsRef.current, { info: infoOf(q), original: src }];
    const r = await client.call({ type: "stitch", mode });
    if (r.type !== "stitched") throw new Error("birlestirme");
    if (r.image) {
      const scanned = await encodeScan(r.image);
      return finish({ kind: "scan", scanned, info: { ...all[0].info, parts: all.length }, original: all[0].original });
    }
    if (r.parts.length === all.length && all.length <= (parts?.room ?? 1)) {
      const blobs: Blob[] = [];
      for (const img of r.parts) blobs.push(await encodeScan(img));
      const each = all.map((p, i) => ({ scanned: blobs[i], info: p.info, original: p.original }));
      return finish({ kind: "scan", ...each[0], more: each.slice(1) });
    }
    await client.call({ type: "parts-reset" });
    partsRef.current = [];
    setPartCount(0);
    setError(STITCH_FAILED_TEXT);
    setFinishing(false);
  }

  const status = error
    ? error
    : !photo
      ? "Fotoğraf hazırlanıyor…"
      : detecting
        ? "Kâğıt aranıyor…"
        : finishing
          ? "Taranıyor…"
          : !valid
            ? "Köşeler bir dörtgen oluşturmuyor; düzeltin."
            : scanStatusText({ method, confidence, aiPending });

  const loupe =
    dragging !== null && box && corners && photo ? (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute z-20 overflow-hidden rounded-full bg-neutral-900 shadow-[0_6px_24px_rgb(0_0_0/0.45)] ring-2 ring-white"
        style={{
          width: LOUPE,
          height: LOUPE,
          // Büyüteç parmağın altında kalmasın: sahnenin köşeye çapraz karşı köşesinde
          top: box.top + corners[dragging].y * box.scale < stage.height / 2 ? stage.height - LOUPE - 10 : 10,
          left: box.left + corners[dragging].x * box.scale < stage.width / 2 ? stage.width - LOUPE - 10 : 10,
          backgroundImage: `url(${photo.url})`,
          backgroundRepeat: "no-repeat",
          backgroundSize: `${box.width * LOUPE_ZOOM}px ${box.height * LOUPE_ZOOM}px`,
          backgroundPosition: `${LOUPE / 2 - corners[dragging].x * box.scale * LOUPE_ZOOM}px ${LOUPE / 2 - corners[dragging].y * box.scale * LOUPE_ZOOM}px`,
        }}
      >
        <div className="absolute top-1/2 left-0 h-px w-full bg-[#c0f21e]/80" />
        <div className="absolute top-0 left-1/2 h-full w-px bg-[#c0f21e]/80" />
      </div>
    ) : null;

  const editor = (
    <div ref={stageRef} className="relative min-h-0 flex-1 touch-none overflow-hidden bg-neutral-950 select-none">
      {photo && box ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- tarayıcıda çözülmüş yerel kopya (nesne adresi) */}
          <img src={photo.url} alt="Çekilen fotoğraf" draggable={false} className="absolute max-w-none" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />
          {corners ? (
            <svg
              aria-hidden="true"
              className="absolute overflow-visible"
              style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
              viewBox={`0 0 ${photo.width} ${photo.height}`}
              preserveAspectRatio="none"
            >
              <path
                fillRule="evenodd"
                className="fill-black/55"
                d={`M0 0H${photo.width}V${photo.height}H0Z M${corners.map((p) => `${p.x} ${p.y}`).join(" L")}Z`}
              />
              <polygon
                points={corners.map((p) => `${p.x},${p.y}`).join(" ")}
                className={cn("fill-none", valid ? "stroke-[#c0f21e]" : "stroke-[#ff5a4f]")}
                strokeWidth={2.5}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          ) : null}
          <div className="absolute" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
            <ScanBeam on={busy || aiPending} />
          </div>
          {corners && !detecting
            ? corners.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`${CORNER_LABEL[i]}: ok tuşlarıyla taşıyın`}
                  disabled={finishing}
                  onPointerDown={(e) => onHandleDown(i, e)}
                  onPointerMove={onHandleMove}
                  onPointerUp={onHandleUp}
                  onPointerCancel={onHandleUp}
                  onKeyDown={(e) => onHandleKey(i, e)}
                  className="group absolute z-10 grid size-12 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none place-items-center rounded-full outline-none active:cursor-grabbing"
                  style={{ left: box.left + p.x * box.scale, top: box.top + p.y * box.scale }}
                >
                  <span
                    className={cn(
                      "size-5 rounded-full border-[3px] bg-white/25 shadow-[0_1px_6px_rgb(0_0_0/0.5)] transition-transform group-focus-visible:ring-4 group-focus-visible:ring-white/60",
                      valid ? "border-[#c0f21e]" : "border-[#ff5a4f]",
                      dragging === i && "scale-125",
                    )}
                  />
                </button>
              ))
            : null}
          {loupe}
        </>
      ) : (
        <div className="absolute inset-0 grid place-items-center text-sm text-white/70">
          <span className="flex items-center gap-2">
            <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> Fotoğraf hazırlanıyor…
          </span>
        </div>
      )}
    </div>
  );

  // Önizlemenin kutusu (sonuç alanına sığar, oran korunur)
  const shown = preview && resultBox.width > 0 ? fitBox(resultBox.width, resultBox.height, preview.width, preview.height, 12) : null;
  const result = (
    <div ref={resultRef} className="relative min-h-0 flex-1 overflow-hidden bg-panel dark:bg-panel-deep">
      {preview && shown ? (
        <div className="absolute overflow-hidden rounded-md bg-white shadow-[0_2px_12px_rgb(0_0_0/0.12)]" style={{ left: shown.left, top: shown.top, width: shown.width, height: shown.height }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- yerel önizleme */}
          <img src={preview.url} alt="Taranmış sonucun önizlemesi" className={cn("block size-full transition-opacity", previewBusy && "opacity-70")} />
          <ScanBeam on={finishing} />
        </div>
      ) : (
        <p className="absolute inset-0 flex items-center justify-center gap-2 text-[13px] text-ink-mute">
          <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> Önizleme hazırlanıyor…
        </p>
      )}
    </div>
  );

  const tools = (
    <div className="flex gap-2">
      <Button size="sm" variant="secondary" onClick={applyAuto} disabled={!hasAuto || busy} className="flex-1 text-ink">
        <Wand2 size={15} aria-hidden="true" /> Otomatik
      </Button>
      <Button size="sm" variant="secondary" onClick={applyWhole} disabled={!photo || busy} className="flex-1 text-ink">
        <Expand size={15} aria-hidden="true" /> Tüm fotoğraf
      </Button>
      <Button size="sm" variant="secondary" onClick={turn} disabled={!photo || busy} className="flex-1 text-ink" aria-label="90° döndür">
        <RotateCw size={15} aria-hidden="true" /> Döndür
      </Button>
    </div>
  );

  const modes = (
    <Segmented
      label="Görünüm"
      stretch
      value={mode}
      onChange={(m) => {
        setMode(m);
        setView("sonuc");
      }}
      options={SCAN_MODE_LIST.map((m) => ({ value: m, label: SCAN_MODE_LABEL[m] }))}
    />
  );

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!finishing) finish(null);
      }}
      className={cn(
        "fixed inset-0 m-0 hidden h-dvh max-h-none w-screen max-w-none flex-col overflow-hidden bg-canvas p-0 text-ink outline-none backdrop:bg-black/60 open:flex",
        "sm:m-auto sm:h-[min(92dvh,860px)] sm:w-[min(96vw,1120px)] sm:rounded-3xl sm:shadow-[0_12px_40px_rgba(0,0,0,.14)]",
      )}
    >
      <header className="flex items-start gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 sm:px-5 sm:pt-4">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-base font-semibold tracking-tight">
            Belgeyi tara
          </h2>
          <p aria-live="polite" className={cn("mt-0.5 text-[13px] leading-5", error || (!valid && photo && !detecting) ? "text-bad" : "text-ink-mute")}>
            {status}
          </p>
          {/* Çekim kalitesi (src/lib/scan/quality.ts): ilk sorun yeter; yeniden çekmek önerilir, "Kullan" yine serbest */}
          {issues.length && !error ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <Notice tone={issues[0].severity === "ciddi" ? "bad" : "warn"} size="line" live="polite" title={issues[0].text} className="min-w-0 flex-1 text-[13px]" />
              <Button size="xs" variant="secondary" onClick={() => openCamera("again")} disabled={busy} className="shrink-0 text-ink">
                <Camera size={13} aria-hidden="true" /> Yeniden çek
              </Button>
            </div>
          ) : null}
          {partCount ? (
            <p className="mt-1 text-[13px] leading-5 text-ink-mute">
              {partCount + 1}. parça · önceki {partCount === 1 ? "parça saklandı" : `${partCount} parça saklandı`}; &quot;Kullan&quot; parçaları birleştirir.
            </p>
          ) : null}
        </div>
        {/* Yeniden çek ve Devamını çek: arka kamera (dokunmatikte), masaüstünde dosya seçimi */}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onCamera(e)} />
        <Button size="icon" variant="ghost" onClick={() => finish(null)} disabled={finishing} aria-label="Kapat (fotoğraf eklenmez)" className="-mr-1">
          <X size={18} aria-hidden="true" />
        </Button>
      </header>

      {/* Telefonda kenarlar ve sonuç ayrı görünüm; masaüstünde yan yana */}
      <div className="px-4 pb-2 sm:hidden">
        <Segmented
          label="Görünüm"
          stretch
          value={view}
          onChange={setView}
          options={[
            { value: "kenar", label: "Kenarlar" },
            {
              value: "sonuc",
              // Taranmış sonucun küçük önizlemesi sekmenin içinde (fotoğrafın üstünde köşe tutamağını örtmesin)
              label: (
                <>
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element -- yerel önizleme
                    <img src={preview.url} alt="" className="h-7 w-auto max-w-6 rounded-[3px] bg-white object-contain ring-1 ring-line-strong" />
                  ) : null}
                  Sonuç
                </>
              ),
            },
          ]}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col sm:grid sm:grid-cols-[minmax(0,1fr)_340px] sm:gap-4 sm:px-5">
        <div className={cn("min-h-0 flex-1 flex-col sm:flex sm:overflow-hidden sm:rounded-2xl", view === "kenar" ? "flex" : "hidden")}>{editor}</div>
        <div className={cn("min-h-0 flex-1 flex-col gap-3 sm:flex", view === "sonuc" ? "flex" : "hidden")}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:rounded-2xl">{result}</div>
          <div className="hidden flex-col gap-3 sm:flex">
            {modes}
            {tools}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-4 pt-3 sm:hidden">
        {modes}
        {tools}
      </div>

      <footer className="flex flex-wrap gap-2 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:justify-end sm:px-5 sm:pb-4">
        {canContinue ? (
          // Uzun fiş kareye sığmadı: alt kısmı ayrıca çekilir, "Kullan" birleştirir
          <Button variant="secondary" onClick={() => openCamera("next")} disabled={!valid || busy} className="text-ink max-sm:min-h-12 max-sm:basis-full sm:mr-auto">
            <ScrollText size={16} aria-hidden="true" /> Devamını çek
          </Button>
        ) : null}
        {partCount ? null : (
          <Button variant="secondary" onClick={() => finish({ kind: "skip", file: src })} disabled={finishing} className="flex-1 text-ink max-sm:min-h-12 sm:flex-none">
            Taramadan kullan
          </Button>
        )}
        <Button onClick={() => void accept()} disabled={!valid || busy} className="flex-1 max-sm:min-h-12 sm:flex-none sm:px-6">
          {finishing ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : null} Kullan
        </Button>
      </footer>
    </dialog>
  );
}

/**
 * Tarama ekranını açar ve kullanıcının seçimini bekler: taranmış görüntü, "Taramadan kullan" ya da kapatıldı (null).
 * Ekran kendi köküne çizilir (çağıran bileşen yalnız sonucu bekler; usePhotoUpload, faturanın belgesi). `close` ekranı
 * kapatır (sayfa değişti), sonuç null olur.
 */
export function openScanEditor(file: Blob, opts: { hint: boolean; noun?: DocNoun; parts?: PartsOption }): { result: Promise<ScanChoice | null>; close: () => void } {
  const host = document.createElement("div");
  host.dataset.scanEditor = "";
  document.body.append(host);
  const root = createRoot(host);
  let resolve!: (c: ScanChoice | null) => void;
  const result = new Promise<ScanChoice | null>((r) => (resolve = r));
  let done = false;
  const end = (choice: ScanChoice | null) => {
    if (done) return;
    done = true;
    resolve(choice);
    // Seçim bildirildikten sonra kök kaldırılır (React kendi olayının içinde kaldırılmasın)
    setTimeout(() => {
      root.unmount();
      host.remove();
    }, 0);
  };
  root.render(<ScanEditor file={file} hint={opts.hint} noun={opts.noun} parts={opts.parts} onDone={end} />);
  return { result, close: () => end(null) };
}

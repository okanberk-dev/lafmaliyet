/**
 * Tarama ekranının ağır işleri (DOM yok): Web Worker'da çalışır (scan.worker.ts), Worker açılamazsa ana iş
 * parçacığında (client.ts). Fotoğraf bir kez yüklenir; algılama ve önizleme 1000 px'lik çalışma kopyasında, son tarama
 * asıl çözünürlükte. Köşeler her zaman yüklenen fotoğrafın pikselinde. Çekirdek: src/lib/scan.
 */

import { detectDocument, refineCorners, scanDocument, scaleQuad, thumbnail, unscaleQuad, type QuarterTurn, type Quad, type RgbaImage, type ScanMode } from "@/lib/scan";
import { clampQuad, MAX_OUTSIDE } from "@/lib/scan/detect";

/** Algılama, köşe oturtma ve önizlemenin çalışma kopyası (uzun kenar; çekirdeğin WORK_EDGE'i) */
const WORK_EDGE = 1000;

export type EngineRequest =
  | { type: "load"; image: RgbaImage }
  | { type: "detect" }
  | { type: "refine"; corners: Quad }
  | { type: "scan"; corners: Quad; mode: ScanMode; rotate: QuarterTurn; maxEdge: number; preview: boolean };

export interface EngineDetection {
  corners: Quad | null;
  confidence: number;
  method: string | null;
  fillsFrame: boolean;
  reasons: string[];
  ms: number;
}

export type EngineResponse =
  | { type: "loaded" }
  | { type: "detected"; detection: EngineDetection }
  | { type: "refined"; corners: Quad; snapped: number }
  | { type: "scanned"; image: RgbaImage; rotation: number; ms: number };

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function createEngine(): (req: EngineRequest) => EngineResponse {
  let src: RgbaImage | null = null;
  let work: RgbaImage | null = null;
  const loaded = () => {
    if (!src || !work) throw new Error("Fotoğraf yüklenmedi");
    return { src, work };
  };
  return (req) => {
    if (req.type === "load") {
      src = req.image;
      work = thumbnail(req.image, WORK_EDGE);
      return { type: "loaded" };
    }
    const { src: s, work: w } = loaded();
    if (req.type === "detect") {
      const t0 = now();
      const d = detectDocument(w);
      const corners = d.corners ? clampQuad(unscaleQuad(d.corners, s.width, s.height, w.width, w.height), s.width, s.height, MAX_OUTSIDE) : null;
      return { type: "detected", detection: { corners, confidence: d.confidence, method: d.method, fillsFrame: d.fillsFrame, reasons: d.reasons, ms: now() - t0 } };
    }
    if (req.type === "refine") {
      const r = refineCorners(s, req.corners, { workEdge: WORK_EDGE });
      return { type: "refined", corners: r.corners, snapped: r.snapped };
    }
    // Önizleme çalışma kopyasında (hızlı), son tarama asıl çözünürlükte
    const img = req.preview ? w : s;
    const corners = req.preview ? scaleQuad(req.corners, s.width, s.height, w.width, w.height) : req.corners;
    const r = scanDocument(img, { corners, mode: req.mode, rotate: req.rotate, maxEdge: req.maxEdge });
    return { type: "scanned", image: r.image, rotation: r.rotation, ms: r.timings.total };
  };
}

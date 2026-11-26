/**
 * Tarama ekranının ağır işleri (DOM yok): Web Worker'da çalışır (scan.worker.ts), Worker açılamazsa ana iş
 * parçacığında (client.ts). Fotoğraf bir kez yüklenir; algılama ve önizleme 1000 px'lik çalışma kopyasında, son tarama
 * asıl çözünürlükte. Köşeler her zaman yüklenen fotoğrafın pikselinde. Çekirdek: src/lib/scan.
 */

import { detectDocument, refineCorners, scanDocument, scaleQuad, thumbnail, unscaleQuad, type QuarterTurn, type Quad, type RgbaImage, type ScanMode } from "@/lib/scan";
import { clampQuad, MAX_OUTSIDE } from "@/lib/scan/detect";
import { detectOrientation } from "@/lib/scan/orientation";
import { assessQuality, type DocNoun, type QualityIssue } from "@/lib/scan/quality";

/** Algılama, köşe oturtma ve önizlemenin çalışma kopyası (uzun kenar; çekirdeğin WORK_EDGE'i) */
const WORK_EDGE = 1000;

export type EngineRequest =
  | { type: "load"; image: RgbaImage }
  | { type: "detect" }
  | { type: "refine"; corners: Quad }
  /** Kâğıdın içine bakarak sayfa yönü ve çekim kalitesi (src/lib/scan orientation.ts, quality.ts; docs/FOTOGRAF.md § 12) */
  | { type: "analyze"; corners: Quad; noun: DocNoun }
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
  /** `rotate`: belgeyi dik yapan dönüş (emin değilse null); `issues`: ciddi önce, ilk metni göstermek yeter */
  | { type: "analyzed"; rotate: QuarterTurn | null; issues: QualityIssue[]; ms: number }
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
    if (req.type === "analyze") {
      // Asıl çözünürlükte (yazı boyu okuyucunun ölçeğinde ölçülsün); iki modül de kendi küçük kopyasında çalışır
      const t0 = now();
      const o = detectOrientation(s, { corners: req.corners });
      const rotate = o.rotation === "bilinmiyor" ? null : o.rotation;
      const q = assessQuality(s, { corners: req.corners, noun: req.noun, rotation: rotate ?? 0 });
      return { type: "analyzed", rotate, issues: q.issues, ms: now() - t0 };
    }
    // Önizleme çalışma kopyasında (hızlı), son tarama asıl çözünürlükte
    const img = req.preview ? w : s;
    const corners = req.preview ? scaleQuad(req.corners, s.width, s.height, w.width, w.height) : req.corners;
    const r = scanDocument(img, { corners, mode: req.mode, rotate: req.rotate, maxEdge: req.maxEdge });
    return { type: "scanned", image: r.image, rotation: r.rotation, ms: r.timings.total };
  };
}

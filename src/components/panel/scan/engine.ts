/**
 * Tarama ekranının ağır işleri (DOM yok): Web Worker'da çalışır (scan.worker.ts), Worker açılamazsa ana iş
 * parçacığında (client.ts). Fotoğraf bir kez yüklenir; algılama ve önizleme 1000 px'lik çalışma kopyasında, son tarama
 * asıl çözünürlükte. Köşeler her zaman yüklenen fotoğrafın pikselinde. Çekirdek: src/lib/scan.
 */

import { scanMaxEdge } from "@/lib/photo-scan";
import { detectDocument, enhance, estimateSize, refineCorners, scanDocument, scaleQuad, thumbnail, unscaleQuad, type QuarterTurn, type Quad, type RgbaImage, type ScanMode } from "@/lib/scan";
import { clampQuad, MAX_OUTSIDE } from "@/lib/scan/detect";
import { detectOrientation } from "@/lib/scan/orientation";
import { assessQuality, type DocNoun, type QualityIssue } from "@/lib/scan/quality";
import { stitchParts } from "@/lib/scan/stitch";

/** Algılama, köşe oturtma ve önizlemenin çalışma kopyası (uzun kenar; çekirdeğin WORK_EDGE'i) */
const WORK_EDGE = 1000;

export type EngineRequest =
  | { type: "load"; image: RgbaImage }
  | { type: "detect" }
  | { type: "refine"; corners: Quad }
  /** Kâğıdın içine bakarak sayfa yönü ve çekim kalitesi (src/lib/scan orientation.ts, quality.ts; docs/FOTOGRAF.md § 12) */
  | { type: "analyze"; corners: Quad; noun: DocNoun }
  | { type: "scan"; corners: Quad; mode: ScanMode; rotate: QuarterTurn; maxEdge: number; preview: boolean }
  /**
   * Uzun fiş: yüklü fotoğraf açılıp (görünümsüz, dik) parça olarak saklanır; sonraki parça yeni "load" ile gelir.
   * Parçalar yeni fotoğrafla silinmez, yalnız "parts-reset" ile
   */
  | { type: "part-add"; corners: Quad; rotate: QuarterTurn }
  | { type: "parts-reset" }
  /**
   * Saklanan parçaları birleştirir (src/lib/scan/stitch.ts); emin değilse her parça ayrı görüntü olarak döner. `last`:
   * yüklü fotoğraf son parça olarak bu birleştirmeye katılır ama saklanmaz (birleştirme çökerse "Kullan" yeniden
   * basıldığında son parça iki kez girmesin)
   */
  | { type: "stitch"; mode: ScanMode; last?: { corners: Quad; rotate: QuarterTurn } };

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
  | { type: "scanned"; image: RgbaImage; rotation: number; ms: number }
  | { type: "parts"; count: number }
  /**
   * `image`: birleşmiş görüntü (dikişler `seams`); null ise `parts` her parçanın taranmış hâli (sırayla). `count`:
   * birleştirmeye giren parça sayısı (Worker çöküp ana iş parçacığına geçildiyse saklanan parçalar yoktur; ekran
   * beklediğiyle karşılaştırır, eksik fiş yüklenmez)
   */
  | { type: "stitched"; image: RgbaImage | null; parts: RgbaImage[]; seams: number[]; confidence: number; count: number; ms: number };

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Tek parçanın açılmış hâlinin uzun kenarı: yüklemenin ölçüsü (dar fişte 4096'ya kadar; scanMaxEdge) */
function partEdge(corners: Quad, width: number, height: number): number {
  const size = estimateSize(corners, width, height, 4096);
  return scanMaxEdge(Math.max(size.width, size.height) / Math.max(1, Math.min(size.width, size.height)));
}

export function createEngine(): (req: EngineRequest) => EngineResponse {
  let src: RgbaImage | null = null;
  let work: RgbaImage | null = null;
  // uzun fişin önceki parçaları (açılmış, dik, görünümsüz)
  let parts: RgbaImage[] = [];
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
    if (req.type === "parts-reset") {
      parts = [];
      return { type: "parts", count: 0 };
    }
    /** Yüklü fotoğrafın parçası: açılmış, dik, görünümsüz */
    const openPart = (corners: Quad, rotate: QuarterTurn) => {
      const { src: s } = loaded();
      return scanDocument(s, { corners, mode: "orijinal", rotate, maxEdge: partEdge(corners, s.width, s.height) }).image;
    };
    if (req.type === "stitch") {
      // Görünüm birleşmiş görüntüye bir kez uygulanır (parçaların ışığı dikişte eşitlenir, eşik tek)
      const t0 = now();
      const all = req.last ? [...parts, openPart(req.last.corners, req.last.rotate)] : parts;
      const st = all.length >= 2 ? stitchParts(all) : null;
      const image = st ? enhance(st.image, req.mode) : null;
      const each = st ? [] : all.map((p) => enhance(p, req.mode));
      return { type: "stitched", image, parts: each, seams: st?.seams ?? [], confidence: st?.confidence ?? 0, count: all.length, ms: now() - t0 };
    }
    if (req.type === "part-add") {
      parts.push(openPart(req.corners, req.rotate));
      return { type: "parts", count: parts.length };
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

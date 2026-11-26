/**
 * Canlı vizörün Web Worker'ı (src/components/panel/live-camera.tsx): kameranın küçültülmüş karesinde (192–384 px)
 * kâğıdı arar ve kâğıdın içinin ışık / netlik ölçüsünü çıkarır; ana iş parçacığı yalnız kareyi küçültüp gönderir ve
 * kenarları çizer. Turbopack `new Worker(new URL("./live.worker.ts", import.meta.url))` kalıbını ayrı paket olarak
 * derler (tarama motorunun Worker'ı gibi: scan.worker.ts). İleti: { id, frame } (baytlar aktarılır) → { id, res } ya
 * da { id, error }. Köşeler karenin pikselinde.
 */

import { detectDocument } from "@/lib/scan";
import type { Quad, RgbaImage } from "@/lib/scan/image";
import { frameMetrics } from "@/lib/scan/live";

export interface LiveRequest {
  id: number;
  frame: RgbaImage;
}

export interface LiveResult {
  quad: Quad | null;
  confidence: number;
  fillsFrame: boolean;
  luma: number;
  sharpness: number;
  /** Algılamanın süresi (ms): bir sonraki karenin ölçüsü buna göre */
  ms: number;
}

interface WorkerScope {
  onmessage: ((e: MessageEvent<LiveRequest>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const { id, frame } = e.data;
  try {
    const t0 = performance.now();
    const d = detectDocument(frame, { maxEdge: Math.max(frame.width, frame.height) });
    const quad = d.corners && !d.fillsFrame ? d.corners : null;
    const m = frameMetrics(frame, quad);
    const res: LiveResult = { quad, confidence: d.confidence, fillsFrame: d.fillsFrame, luma: m.luma, sharpness: m.sharpness, ms: performance.now() - t0 };
    scope.postMessage({ id, res });
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};

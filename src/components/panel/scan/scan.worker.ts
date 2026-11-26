/**
 * Tarama ekranının Web Worker'ı: ağır işler (algılama, köşe oturtma, açma, taranmış görünüm) arayüzü dondurmasın.
 * Turbopack `new Worker(new URL("./scan.worker.ts", import.meta.url))` kalıbını ayrı bir paket olarak derler
 * (node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md › Magic Comments ve turbopackWorkerAssetPrefix).
 * İleti: { id, req } → { id, res } ya da { id, error }; taranmış görüntünün baytları aktarılır (kopyalanmaz).
 */

import { createEngine, type EngineRequest, type EngineResponse } from "./engine";

interface WorkerScope {
  onmessage: ((e: MessageEvent<{ id: number; req: EngineRequest }>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
const run = createEngine();

scope.onmessage = (e) => {
  const { id, req } = e.data;
  let res: EngineResponse;
  try {
    res = run(req);
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    return;
  }
  const images = res.type === "scanned" ? [res.image] : res.type === "stitched" ? [...(res.image ? [res.image] : []), ...res.parts] : [];
  scope.postMessage({ id, res }, images.map((i) => i.data.buffer as ArrayBuffer));
};

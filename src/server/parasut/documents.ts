import "server-only";

import { MAX_REMOTE_BYTES, parasutPhotoUrl, sniffMime, type DocumentMime } from "@/lib/documents";

import { ParasutClient, ParasutError } from "./client";
import type { ResourceIdentifier, ShowResponse } from "./jsonapi";

/**
 * Paraşüt'teki fatura belgeleri. Canlı denemeyle doğrulandı (20 Eki 2026):
 * - Gider faturasının `active_e_document` bağı e-faturayı gösterir; `GET /{firma}/e_invoices/{id}/pdf` 200 ile
 *   `{url, expires_at}` döner (adres 1 saat geçerli), adres doğrudan `application/pdf` indirir. Paraşüt PDF'i
 *   hazırlarken 204 dönebilir.
 * - İçeri alınmamış gelen e-faturaların da PDF'i aynı uçtan alınır.
 * - Elle girilmiş faturada e-belge yoksa `photo` alanında Paraşüt'e eklenmiş görsel olabilir.
 */

export type EDocumentRef = { type: string; id: string };

export interface BillDocumentSource {
  eDocument: EDocumentRef | null;
  photoUrl: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Gider faturasının belgesi nereden alınır: e-fatura (PDF) ya da Paraşüt'teki görsel */
export async function billDocumentSource(client: ParasutClient, externalId: string): Promise<BillDocumentSource> {
  const res = await client.show<{ photo?: unknown }>(`purchase_bills/${encodeURIComponent(externalId)}`, { include: "active_e_document" });
  const rel = res.data.relationships?.active_e_document?.data;
  const ref = rel && !Array.isArray(rel) ? (rel as ResourceIdentifier) : null;
  return {
    eDocument: ref ? { type: ref.type, id: ref.id } : null,
    photoUrl: parasutPhotoUrl(res.data.attributes?.photo),
  };
}

/** E-belgenin PDF'i için geçici indirme adresi; Paraşüt hazırlarken kısa aralıklarla yeniden sorulur */
export async function eDocumentPdfUrl(client: ParasutClient, ref: EDocumentRef, tries = 4): Promise<string | null> {
  for (let i = 0; i < tries; i++) {
    const res = await client.get<ShowResponse<{ url?: string; expires_at?: string }> | null>(`${encodeURIComponent(ref.type)}/${encodeURIComponent(ref.id)}/pdf`);
    const url = res?.data?.attributes?.url;
    if (typeof url === "string" && /^https:\/\//i.test(url)) return url;
    if (i < tries - 1) await sleep(1500);
  }
  return null;
}

/** Belgeyi indirir; yalnız https, boyut ve tür içerikten denetlenir */
export async function downloadDocument(url: string): Promise<{ bytes: Buffer; mime: DocumentMime }> {
  if (!/^https:\/\//i.test(url)) throw new ParasutError("Belge adresi güvenli değil (https değil).", 0);
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
  } catch (e) {
    const name = (e as Error)?.name;
    throw new ParasutError(name === "TimeoutError" || name === "AbortError" ? "Belge 20 saniyede inmedi; biraz sonra yeniden deneyin." : "Belge indirilemedi.", 0);
  }
  if (!res.ok) throw new ParasutError(`Belge indirilemedi (HTTP ${res.status}).`, res.status);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_REMOTE_BYTES) throw new ParasutError("Belge çok büyük (10 MB üstü).", 0);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_REMOTE_BYTES) throw new ParasutError("Belge çok büyük (10 MB üstü).", 0);
  const mime = sniffMime(bytes);
  if (!mime) throw new ParasutError("Belge PDF ya da görsel değil; Paraşüt'te açıp bakın.", 0);
  return { bytes, mime };
}

/** Bir gider faturasının belgesini Paraşüt'ten indirir (e-fatura PDF'i, yoksa görsel); belge yoksa null */
export async function fetchBillDocument(client: ParasutClient, externalId: string, known?: EDocumentRef | null): Promise<{ bytes: Buffer; mime: DocumentMime } | null> {
  const source = known ? { eDocument: known, photoUrl: null } : await billDocumentSource(client, externalId);
  if (source.eDocument) {
    const url = await eDocumentPdfUrl(client, source.eDocument);
    if (url) return downloadDocument(url);
  }
  if (source.photoUrl) return downloadDocument(source.photoUrl);
  // Bilinen e-belge PDF vermediyse faturanın kendisinden bir kez daha bakılır (fotoğraf olabilir)
  if (known) {
    const fresh = await billDocumentSource(client, externalId);
    if (fresh.photoUrl) return downloadDocument(fresh.photoUrl);
  }
  return null;
}

/** İçeri alınmamış gelen e-faturanın PDF'i (önbelleğe alınmaz) */
export async function fetchEInvoicePdf(client: ParasutClient, eInvoiceId: string): Promise<{ bytes: Buffer; mime: DocumentMime } | null> {
  const url = await eDocumentPdfUrl(client, { type: "e_invoices", id: eInvoiceId });
  return url ? downloadDocument(url) : null;
}

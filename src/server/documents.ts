import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { documentFileName, type DocumentMime } from "@/lib/documents";
import { getDb, schema as s } from "@/server/db";
import { ParasutClient } from "@/server/parasut/client";
import { isParasutConfigured, readParasutConfig } from "@/server/parasut/config";
import { fetchBillDocument, fetchEInvoicePdf } from "@/server/parasut/documents";

/** Ekranda gösterilen belge bilgisi (dosyanın kendisi değil) */
export interface DocumentMeta {
  id: number;
  invoiceId: number;
  source: "parasut" | "upload";
  fileName: string;
  mime: string;
  size: number;
  uploadedBy: string | null;
  createdAt: string;
}

const metaColumns = {
  id: s.invoiceDocuments.id,
  invoiceId: s.invoiceDocuments.invoiceId,
  source: s.invoiceDocuments.source,
  fileName: s.invoiceDocuments.fileName,
  mime: s.invoiceDocuments.mime,
  size: s.invoiceDocuments.size,
  uploadedBy: s.invoiceDocuments.uploadedBy,
  createdAt: s.invoiceDocuments.createdAt,
};

/** Faturaların belgeleri (yeni önce); dosya içeriği okunmaz */
export async function listInvoiceDocuments(invoiceIds?: number[]): Promise<DocumentMeta[]> {
  const db = getDb();
  const q = db.select(metaColumns).from(s.invoiceDocuments);
  const rows = await (invoiceIds ? (invoiceIds.length ? q.where(inArray(s.invoiceDocuments.invoiceId, invoiceIds)) : Promise.resolve([])) : q).then((r) =>
    [...r].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  );
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export type ServedDocument = { bytes: Buffer; mime: string; fileName: string; source: "parasut" | "upload" };

export class DocumentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Bir faturanın belgesi. `documentId` verilirse o dosya; verilmezse önce Paraşüt önbelleği, yoksa Paraşüt'ten
 * indirilip önbelleğe yazılır (e-fatura PDF'i ya da Paraşüt'teki fotoğraf), o da yoksa son yüklenen dosya.
 */
export async function getInvoiceDocument(invoiceId: number, documentId?: number | null): Promise<ServedDocument> {
  const db = getDb();
  if (documentId) {
    const [doc] = await db
      .select()
      .from(s.invoiceDocuments)
      .where(and(eq(s.invoiceDocuments.id, documentId), eq(s.invoiceDocuments.invoiceId, invoiceId)))
      .limit(1);
    if (!doc) throw new DocumentError("Belge bulunamadı; silinmiş olabilir.", 404);
    return { bytes: doc.data, mime: doc.mime, fileName: doc.fileName, source: doc.source };
  }
  const [inv] = await db
    .select({ id: s.invoices.id, supplier: s.invoices.supplier, date: s.invoices.date, invoiceNo: s.invoices.invoiceNo, externalId: s.invoices.externalId, eInvoiceId: s.invoices.eInvoiceId })
    .from(s.invoices)
    .where(eq(s.invoices.id, invoiceId))
    .limit(1);
  if (!inv) throw new DocumentError("Fatura bulunamadı.", 404);
  const docs = await db.select().from(s.invoiceDocuments).where(eq(s.invoiceDocuments.invoiceId, invoiceId)).orderBy(desc(s.invoiceDocuments.createdAt));
  const cached = docs.find((d) => d.source === "parasut");
  if (cached) return { bytes: cached.data, mime: cached.mime, fileName: cached.fileName, source: "parasut" };

  if ((inv.eInvoiceId || inv.externalId) && (await isParasutConfigured())) {
    const client = new ParasutClient(await readParasutConfig());
    const file = inv.eInvoiceId ? await fetchEInvoicePdf(client, inv.eInvoiceId) : await fetchBillDocument(client, inv.externalId!);
    if (file) {
      const fileName = documentFileName({ supplier: inv.supplier, date: inv.date, invoiceNo: inv.invoiceNo, mime: file.mime });
      // Aynı anda iki istek gelirse ikinci kopya yazılmaz
      const again = await db
        .select({ id: s.invoiceDocuments.id })
        .from(s.invoiceDocuments)
        .where(and(eq(s.invoiceDocuments.invoiceId, invoiceId), eq(s.invoiceDocuments.source, "parasut")))
        .limit(1);
      if (!again.length) {
        await db.insert(s.invoiceDocuments).values({ invoiceId, source: "parasut", fileName, mime: file.mime, size: file.bytes.length, data: file.bytes, uploadedBy: "Paraşüt" });
      }
      return { bytes: file.bytes, mime: file.mime, fileName, source: "parasut" };
    }
  }
  const upload = docs.find((d) => d.source === "upload");
  if (upload) return { bytes: upload.data, mime: upload.mime, fileName: upload.fileName, source: "upload" };
  if (inv.eInvoiceId || inv.externalId) throw new DocumentError("Paraşüt bu fatura için belge vermedi (elle girilmiş fiş olabilir). Fotoğrafını ya da PDF'ini ekleyebilirsiniz.", 404);
  throw new DocumentError("Bu faturanın belgesi yok. Fotoğrafını ya da PDF'ini ekleyebilirsiniz.", 404);
}

/** Panelden yüklenen dosyayı saklar */
export async function storeUpload(invoiceId: number, file: { bytes: Buffer; mime: DocumentMime; originalName: string | null }, uploadedBy: string): Promise<DocumentMeta> {
  const db = getDb();
  const [inv] = await db.select({ supplier: s.invoices.supplier, date: s.invoices.date, invoiceNo: s.invoices.invoiceNo }).from(s.invoices).where(eq(s.invoices.id, invoiceId)).limit(1);
  if (!inv) throw new DocumentError("Fatura bulunamadı.", 404);
  const fileName = documentFileName({ supplier: inv.supplier, date: inv.date, invoiceNo: inv.invoiceNo, mime: file.mime });
  const [row] = await db
    .insert(s.invoiceDocuments)
    .values({ invoiceId, source: "upload", fileName, mime: file.mime, size: file.bytes.length, data: file.bytes, uploadedBy })
    .returning(metaColumns);
  return { ...row, createdAt: row.createdAt.toISOString() };
}

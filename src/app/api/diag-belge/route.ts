import { connection } from "next/server";

import { getCurrentUser } from "@/server/auth/dal";
import { ParasutClient } from "@/server/parasut/client";
import { readParasutConfig } from "@/server/parasut/config";

// GEÇİCİ teşhis: Paraşüt'te faturaların belge/PDF imkânları. Yalnız yönetici; yalnız yapı ve durum kodları döner.
type Res = { id: string; type: string; attributes?: Record<string, unknown>; relationships?: Record<string, { data?: unknown }> };

export async function GET() {
  await connection();
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return Response.json({ error: "Yalnız yönetici" }, { status: 403 });
  const cfg = readParasutConfig();
  const client = new ParasutClient(cfg);
  const token: string = await (client as unknown as { accessToken: () => Promise<string> }).accessToken();
  const base = `${cfg.baseUrl}/v4/${cfg.companyId}`;
  const raw = async (path: string) => {
    const t0 = Date.now();
    const r = await fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
    const text = r.status === 204 ? "" : await r.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    return { status: r.status, ms: Date.now() - t0, json, text: json ? undefined : text.slice(0, 200) };
  };
  const out: Record<string, unknown> = {};

  // 1) Gider faturaları: e-belge bağı var mı, hangi alanlar var
  const bills = await raw("purchase_bills?sort=-issue_date&include=active_e_document&page[size]=5&page[number]=1");
  const billData = ((bills.json as { data?: Res[] })?.data ?? []) as Res[];
  out.bills = {
    status: bills.status,
    count: billData.length,
    attributeKeys: billData[0] ? Object.keys(billData[0].attributes ?? {}) : [],
    relationshipKeys: billData[0] ? Object.keys(billData[0].relationships ?? {}) : [],
    eDocs: billData.map((b) => ({ id: b.id, invoiceType: b.attributes?.invoice_type, eDoc: b.relationships?.active_e_document?.data ?? null })),
  };
  const withDoc = billData.find((b) => b.relationships?.active_e_document?.data);
  if (withDoc) {
    const ref = withDoc.relationships!.active_e_document!.data as { id: string; type: string };
    const show = await raw(`${ref.type}/${ref.id}`);
    const doc = (show.json as { data?: Res })?.data;
    out.billEDoc = { status: show.status, type: ref.type, attributeKeys: Object.keys(doc?.attributes ?? {}), hasPdfUrlAttr: Boolean(doc?.attributes?.pdf_url) };
    const pdf = await raw(`${ref.type}/${ref.id}/pdf`);
    out.billEDocPdf = { status: pdf.status, ms: pdf.ms, keys: pdf.json ? Object.keys(((pdf.json as { data?: Res }).data?.attributes ?? {}) as object) : [], text: pdf.text };
    const url = ((pdf.json as { data?: Res })?.data?.attributes?.url as string | undefined) ?? (doc?.attributes?.pdf_url as string | undefined);
    if (url) {
      const head = await fetch(url, { method: "GET", signal: AbortSignal.timeout(20000) });
      const buf = await head.arrayBuffer();
      out.billEDocPdfFile = { status: head.status, type: head.headers.get("content-type"), bytes: buf.byteLength };
    }
  }

  // 2) Gelen e-faturalar (içeri alınmamış olanlar dahil): alanlar ve PDF
  const einv = await raw("e_invoices?include=invoice&sort=-issue_date&page[size]=5&page[number]=1");
  const eData = ((einv.json as { data?: Res[] })?.data ?? []) as Res[];
  const pending = eData.find((e) => e.attributes?.direction === "inbound" && !(e.relationships?.invoice?.data as unknown));
  out.eInvoices = {
    status: einv.status,
    count: eData.length,
    attributeKeys: eData[0] ? Object.keys(eData[0].attributes ?? {}) : [],
    sampleNumbers: eData.slice(0, 5).map((e) => ({
      direction: e.attributes?.direction,
      imported: Boolean(e.relationships?.invoice?.data),
      net_total: e.attributes?.net_total ?? null,
      total_vat: e.attributes?.total_vat ?? null,
      currency: e.attributes?.currency ?? null,
      hasPdfUrl: Boolean(e.attributes?.pdf_url),
      hasHtmlUrl: Boolean(e.attributes?.html_url),
    })),
  };
  if (pending) {
    const pdf = await raw(`e_invoices/${pending.id}/pdf`);
    out.pendingPdf = { status: pdf.status, ms: pdf.ms, keys: pdf.json ? Object.keys(((pdf.json as { data?: Res }).data?.attributes ?? {}) as object) : [], text: pdf.text };
    const url = ((pdf.json as { data?: Res })?.data?.attributes?.url as string | undefined) ?? (pending.attributes?.pdf_url as string | undefined);
    if (url) {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const buf = await r.arrayBuffer();
      out.pendingPdfFile = { status: r.status, type: r.headers.get("content-type"), bytes: buf.byteLength };
    }
  }
  return Response.json(out);
}

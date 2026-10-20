import { connection } from "next/server";
import { getDocumentProxy } from "unpdf";

import { getCurrentUser } from "@/server/auth/dal";
import { ParasutClient } from "@/server/parasut/client";
import { readParasutConfig } from "@/server/parasut/config";

// GEÇİCİ teşhis: e-fatura UBL uçları ve PDF metin düzeni (satırlar, x konumları). Yalnız yönetici.
type Res = { id: string; attributes?: Record<string, unknown>; relationships?: Record<string, { data?: unknown }> };

export const maxDuration = 60;

export async function GET(request: Request) {
  await connection();
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return Response.json({ error: "Yalnız yönetici" }, { status: 403 });
  const want = Number(new URL(request.url).searchParams.get("n") ?? 4);
  const cfg = readParasutConfig();
  const client = new ParasutClient(cfg);
  const token: string = await (client as unknown as { accessToken: () => Promise<string> }).accessToken();
  const base = `${cfg.baseUrl}/v4/${cfg.companyId}`;
  const api = async (path: string) => {
    try {
      const r = await fetch(path.startsWith("http") ? path : `${base}/${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
      const ct = r.headers.get("content-type") ?? "";
      const body = r.status === 204 ? "" : await r.text();
      return { status: r.status, ct, body };
    } catch (e) {
      return { status: 0, ct: "", body: `HATA ${(e as Error).name}` };
    }
  };
  const strip = (s: string) => s.replace(/https?:\/\/\S+/g, "[adres]").replace(/[?&][a-z_]+=\S+/gi, "");

  const list = await api("e_invoices?include=invoice&sort=-issue_date&page[size]=25&page[number]=1");
  const rows = ((JSON.parse(list.body || "{}") as { data?: Res[] }).data ?? []).filter((e) => e.attributes?.direction === "inbound");
  const out: Record<string, unknown> = { listStatus: list.status, inbound: rows.length };

  // UBL için olası uçlar
  const first = rows[0];
  if (first) {
    const probes: Record<string, unknown> = {};
    for (const p of [`e_invoices/${first.id}/ubl`, `e_invoices/${first.id}/xml`, `e_invoices/${first.id}/signed_ubl`, `e_invoices/${first.id}/html`, `e_invoices/${first.id}?include=details`]) {
      const r = await api(p);
      probes[p.replace(first.id, "{id}")] = { status: r.status, ct: r.ct, xml: r.body.trimStart().startsWith("<?xml") || r.body.includes("<Invoice"), lines: (r.body.match(/InvoiceLine/g) ?? []).length, head: strip(r.body.slice(0, 120)) };
    }
    const signed = String(first.attributes?.signed_ubl_url ?? "");
    if (signed) {
      let path = signed;
      try {
        path = new URL(signed).pathname;
      } catch {}
      for (const [label, url] of [
        ["api+path", `${cfg.baseUrl}${path}`],
        ["api/v4+path", `${cfg.baseUrl}/v4${path}`],
      ] as const) {
        const r = await api(url);
        probes[label] = { status: r.status, ct: r.ct, xml: r.body.includes("<Invoice") || r.body.includes("InvoiceLine"), lines: (r.body.match(/InvoiceLine/g) ?? []).length };
      }
      probes.signedPathShape = path.replace(/\d+/g, "9");
    }
    out.ubl = probes;
  }

  // PDF metin düzeni: farklı tedarikçilerden `want` fatura
  const seen = new Set<string>();
  const pdfs: unknown[] = [];
  for (const e of rows) {
    if (pdfs.length >= want) break;
    const sup = String(e.attributes?.contact_name ?? "");
    if (seen.has(sup)) continue;
    seen.add(sup);
    const link = await api(`e_invoices/${e.id}/pdf`);
    let url = "";
    try {
      url = (JSON.parse(link.body) as { data?: { attributes?: { url?: string } } }).data?.attributes?.url ?? "";
    } catch {}
    if (!url) {
      pdfs.push({ supplier: sup, error: `pdf ${link.status}` });
      continue;
    }
    const bytes = new Uint8Array(await (await fetch(url, { signal: AbortSignal.timeout(20000) })).arrayBuffer());
    const doc = await getDocumentProxy(bytes);
    const lines: string[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, 2); p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const items = (tc.items as { str: string; transform: number[]; width: number }[]).filter((i) => i.str.trim());
      const byY = new Map<number, { x: number; s: string }[]>();
      for (const it of items) {
        const y = Math.round(it.transform[5] / 2) * 2;
        byY.set(y, [...(byY.get(y) ?? []), { x: Math.round(it.transform[4]), s: it.str.trim() }]);
      }
      for (const [y, cells] of [...byY.entries()].sort((a, b) => b[0] - a[0])) {
        lines.push(`p${p} y${y}: ${cells.sort((a, b) => a.x - b.x).map((c) => `${c.x}:${strip(c.s)}`).join(" | ")}`);
      }
    }
    pdfs.push({ supplier: sup, net: e.attributes?.net_total, vat: e.attributes?.total_vat, pages: doc.numPages, lines: lines.slice(0, 120) });
  }
  out.pdfs = pdfs;
  return Response.json(out);
}

import { connection } from "next/server";

import { getCurrentUser } from "@/server/auth/dal";
import { ParasutClient } from "@/server/parasut/client";
import { readParasutConfig } from "@/server/parasut/config";

// GEÇİCİ teşhis: gelen e-faturaların alanları, liste süzgeçleri ve UBL (XML) erişimi. Yalnız yönetici.
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
    const r = await fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(25000) });
    const text = r.status === 204 ? "" : await r.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    return { status: r.status, ms: Date.now() - t0, json, text: json ? undefined : text.slice(0, 200) };
  };
  const out: Record<string, unknown> = {};

  // Süzgeç denemeleri ve toplam sayılar
  for (const q of ["e_invoices?page[size]=1", "e_invoices?filter[direction]=inbound&page[size]=1", "e_invoices?sort=-issue_date&page[size]=1"]) {
    const r = await raw(q);
    out[q] = { status: r.status, ms: r.ms, meta: (r.json as { meta?: unknown })?.meta ?? null, err: r.text };
  }

  // İlk 2 sayfa (50 kayıt): alan örnekleri (kişisel veri değil: biçimler)
  const rows: Res[] = [];
  for (const p of [1, 2]) {
    const r = await raw(`e_invoices?include=invoice&sort=-issue_date&page[size]=25&page[number]=${p}`);
    rows.push(...(((r.json as { data?: Res[] })?.data ?? []) as Res[]));
  }
  const count = (f: (e: Res) => unknown) => {
    const m: Record<string, number> = {};
    for (const e of rows) {
      const k = String(f(e));
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  };
  out.sample = {
    rows: rows.length,
    direction: count((e) => e.attributes?.direction),
    imported: count((e) => Boolean(e.relationships?.invoice?.data)),
    archived: count((e) => e.attributes?.archived),
    response_type: count((e) => e.attributes?.response_type),
    status: count((e) => e.attributes?.status),
    invoice_type_code: count((e) => e.attributes?.invoice_type_code),
    scenario: count((e) => e.attributes?.scenario),
    currency: count((e) => e.attributes?.currency),
    item_type: count((e) => e.attributes?.item_type),
    external_id_shape: count((e) => String(e.attributes?.external_id ?? "").replace(/[A-Z]/g, "A").replace(/\d/g, "9")),
    issue_date_shape: count((e) => String(e.attributes?.issue_date ?? "").replace(/\d/g, "9")),
    dateRange: [rows.at(-1)?.attributes?.issue_date, rows[0]?.attributes?.issue_date],
    note_present: count((e) => Boolean(e.attributes?.note)),
    signed_ubl_url_shape: count((e) => {
      const u = String(e.attributes?.signed_ubl_url ?? "");
      try {
        return u ? new URL(u).host : "yok";
      } catch {
        return u ? `göreli:${u.slice(0, 12)}` : "yok";
      }
    }),
    pdf_url_shape: count((e) => {
      const u = String(e.attributes?.pdf_url ?? "");
      try {
        return u ? new URL(u).host : "yok";
      } catch {
        return u ? `göreli:${u.slice(0, 12)}` : "yok";
      }
    }),
  };

  // UBL (XML) erişimi: bir kayıtta dene
  const one = rows.find((e) => e.attributes?.direction === "inbound" && e.attributes?.signed_ubl_url);
  if (one) {
    const u = String(one.attributes!.signed_ubl_url);
    const tries: Record<string, unknown> = {};
    for (const [label, url, auth] of [
      ["direct", u, false],
      ["direct-auth", u, true],
      ["api-relative", u.startsWith("http") ? null : `${cfg.baseUrl}${u.startsWith("/") ? "" : "/"}${u}`, true],
    ] as const) {
      if (!url) continue;
      try {
        const r = await fetch(url, { headers: auth ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(20000), redirect: "follow" });
        const body = await r.text();
        tries[label] = {
          status: r.status,
          type: r.headers.get("content-type"),
          bytes: body.length,
          isXml: body.trimStart().startsWith("<"),
          invoiceLines: (body.match(/<cac:InvoiceLine[\s>]/g) ?? []).length,
          hasPaymentDue: /PaymentDueDate/.test(body),
          tags: [...new Set((body.match(/<cbc:[A-Za-z]+/g) ?? []).slice(0, 400))].slice(0, 60),
          // İlk kalemin yapısı (değerler maskeli)
          firstLine: (body.match(/<cac:InvoiceLine[\s\S]*?<\/cac:InvoiceLine>/)?.[0] ?? "").replace(/>[^<]{1,200}</g, ">…<").slice(0, 1500),
        };
      } catch (e) {
        tries[label] = { error: (e as Error).message };
      }
    }
    out.ubl = { externalIdShape: String(one.attributes?.external_id ?? "").replace(/[A-Z]/g, "A").replace(/\d/g, "9"), tries };
  }
  return Response.json(out);
}

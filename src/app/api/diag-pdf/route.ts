import { connection } from "next/server";

import { getCurrentUser } from "@/server/auth/dal";
import { ParasutClient } from "@/server/parasut/client";
import { readParasutConfig } from "@/server/parasut/config";

import { extractUblXml, parseUbl, ublLinesMatchTotal, ublLinesToDrafts } from "./ubl";

// GEÇİCİ teşhis: gelen e-faturaların UBL kalemleri doğru okunuyor mu (yalnız okur, hiçbir şey yazmaz). Yalnız yönetici.
type Res = { id: string; attributes?: Record<string, unknown> };

export const maxDuration = 60;

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function GET(request: Request) {
  await connection();
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return Response.json({ error: "Yalnız yönetici" }, { status: 403 });
  const sp = new URL(request.url).searchParams;
  const want = Math.min(25, Number(sp.get("n") ?? 25));
  const pageNo = Number(sp.get("s") ?? 1);
  const cfg = readParasutConfig();
  const client = new ParasutClient(cfg);
  const token: string = await (client as unknown as { accessToken: () => Promise<string> }).accessToken();
  const base = `${cfg.baseUrl}/v4/${cfg.companyId}`;
  const started = Date.now();

  const listRes = await fetch(`${base}/e_invoices?sort=-issue_date&page[size]=25&page[number]=${pageNo}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  const rows = ((await listRes.json()) as { data?: Res[] }).data?.filter((e) => e.attributes?.direction === "inbound") ?? [];

  // ?ham=<tedarikçi adından parça>: o tedarikçinin ilk e-faturasının UBL'si (imza, ekler ve alıcı bilgisi çıkarılmış)
  const raw = sp.get("ham");
  if (raw) {
    const e = rows.find((r) => String(r.attributes?.contact_name ?? "").toLocaleLowerCase("tr-TR").includes(raw.toLocaleLowerCase("tr-TR")));
    if (!e) return new Response("bulunamadı", { status: 404 });
    const r = await fetch(`${base}/e_invoices/${e.id}/signed_ubl`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    const xml = extractUblXml(Buffer.from(await r.arrayBuffer()))
      .replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/g, "[imza]")
      .replace(/<cac:Signature>[\s\S]*?<\/cac:Signature>/g, "[imza]")
      .replace(/<cac:AdditionalDocumentReference>[\s\S]*?<\/cac:AdditionalDocumentReference>/g, "[ek]")
      .replace(/<cac:AccountingCustomerParty>[\s\S]*?<\/cac:AccountingCustomerParty>/g, "[alıcı]")
      .replace(/<cac:(PostalAddress|Contact|PartyTaxScheme)>[\s\S]*?<\/cac:\1>/g, "")
      .replace(/\n\s*\n/g, "\n");
    const a = e.attributes ?? {};
    const headInfo = `e-fatura: net_total=${a.net_total} total_vat=${a.total_vat} tip=${a.invoice_type_code}\n\n`;
    return new Response(`<!doctype html><meta charset="utf-8"><title>UBL ham</title><pre style="white-space:pre-wrap;font:11px monospace">${esc(headInfo + xml.slice(0, 30000))}</pre>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }

  const out: string[] = [];
  const units = new Map<string, number>();
  let ok = 0;
  let bad = 0;
  for (const e of rows) {
    if (out.length >= want || Date.now() - started > 45_000) break;
    const a = e.attributes ?? {};
    const expected = Math.round((Number(a.net_total ?? 0) - Number(a.total_vat ?? 0)) * 100) / 100;
    try {
      await new Promise((r) => setTimeout(r, 1100));
      const r = await fetch(`${base}/e_invoices/${e.id}/signed_ubl`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
      const ct = r.headers.get("content-type") ?? "";
      const bytes = Buffer.from(await r.arrayBuffer());
      if (!r.ok) throw new Error(`HTTP ${r.status} ${ct}`);
      const xml = extractUblXml(bytes);
      const inv = parseUbl(xml);
      const drafts = ublLinesToDrafts(inv, e.id, String(a.contact_name ?? ""));
      for (const l of inv.lines) units.set(l.unitCode ?? "-", (units.get(l.unitCode ?? "-") ?? 0) + 1);
      const sum = Math.round(drafts.reduce((s, l) => s + l.netTotal, 0) * 100) / 100;
      // Adı harf içermeyen kalemlerin Item bloğu (düz metin)
      const coded = [...xml.matchAll(/<cac:Item>([\s\S]*?)<\/cac:Item>/g)]
        .map((m) => m[1])
        .filter((b) => !/\p{L}{2,}/u.test(/<cbc:Name>([\s\S]*?)<\/cbc:Name>/.exec(b)?.[1] ?? "x"))
        .map((b) => b.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160));
      const k = `${Math.round(inv.lineScale * 10000) / 10000} ${inv.lineMode}${inv.withholding ? ` · tevkifat ${inv.withholding} · KDV ${inv.vat}` : ""}`;
      const match = ublLinesMatchTotal(inv);
      // Maliyet = belgedeki KDV hariç toplam (tevkifatlıda e-fatura listesindeki "ödenecek − KDV" değil)
      if (match && Math.abs(Math.abs(sum) - inv.taxExclusive) <= 1) ok++;
      else bad++;
      out.push(
        `<tr><td>${esc(a.issue_date)}</td><td>${esc(String(a.contact_name ?? "").slice(0, 28))}</td><td>${esc(inv.typeCode)} ${esc(inv.profileId)}</td><td>${bytes.length} B ${esc(ct.split(";")[0])}</td>` +
          `<td>${inv.lines.length}</td><td>${esc(inv.taxExclusive)} / e-fatura ${esc(expected)} / kalem ${esc(sum)} ${match ? "✓" : "✗"}</td><td>${esc(inv.dueDate ?? "-")} · VKN ${inv.supplierTaxId ? "var" : "yok"} · iskonto ${esc(inv.invoiceDiscount)} · k ${k}${coded.length ? `<br>KOD ADLI: ${coded.map(esc).join(" ¦ ")}` : ""}</td>` +
          `<td>${drafts
            .slice(0, 3)
            .map((l) => `${esc(l.productName.slice(0, 40))} | ${esc(l.quantity)} ${esc(l.unit)} × ${esc(l.unitPrice)} − ${esc(l.discount)} = ${esc(l.netTotal)} | %${esc(l.vatRate)} | ${esc(l.productKey.replace(/^e:\d+:/, "e:VKN:").slice(0, 36))}`)
            .join("<br>")}${drafts.length > 3 ? `<br>… +${drafts.length - 3}` : ""}</td></tr>`,
      );
    } catch (err) {
      bad++;
      out.push(`<tr><td>${esc(a.issue_date)}</td><td>${esc(String(a.contact_name ?? "").slice(0, 28))}</td><td colspan="6">HATA: ${esc((err as Error).message)}</td></tr>`);
    }
  }
  const html = `<!doctype html><meta charset="utf-8"><title>UBL teshis</title><style>body{font:12px system-ui;margin:12px}td{border:1px solid #ccc;padding:3px;vertical-align:top}</style>
<p>Gelen: ${rows.length} · okunan: ${out.length} · tutan: ${ok} · tutmayan/hata: ${bad} · birimler: ${esc([...units].map(([k, v]) => `${k}=${v}`).join(", "))} · ${Date.now() - started} ms</p>
<table><tr><td>Tarih</td><td>Tedarikçi</td><td>Tür</td><td>Dosya</td><td>Kalem</td><td>KDV hariç</td><td>Vade/VKN</td><td>Örnek kalemler</td></tr>${out.join("")}</table>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

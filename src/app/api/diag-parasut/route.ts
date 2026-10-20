import { lookup } from "node:dns/promises";
import https from "node:https";
import { sql } from "drizzle-orm";
import { connection } from "next/server";

import { getCurrentUser } from "@/server/auth/dal";
import { getDb } from "@/server/db";

// GEÇİCİ teşhis: Vercel'den api.parasut.com'a erişim. Gerçek kimlik bilgisi kullanmaz.
const BODY = new URLSearchParams({ grant_type: "password", client_id: "x", client_secret: "y", username: "a@b.c", password: "z", redirect_uri: "urn:ietf:wg:oauth:2.0:oob" }).toString();

async function timed<T>(label: string, fn: () => Promise<T>) {
  const t0 = Date.now();
  try {
    const v = await fn();
    return { label, ok: true, ms: Date.now() - t0, v };
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    return { label, ok: false, ms: Date.now() - t0, err: `${err.name}: ${err.message} ${err.cause?.code ?? ""} ${err.cause?.message ?? ""}` };
  }
}

function httpsPost(family: 4 | 6, ua?: string) {
  return new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        host: "api.parasut.com",
        path: "/oauth/token",
        method: "POST",
        family,
        timeout: 12000,
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "Content-Length": Buffer.byteLength(BODY), ...(ua ? { "User-Agent": ua } : {}) },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(`${res.statusCode} ${d.slice(0, 80)}`));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(BODY);
  });
}

export async function GET() {
  await connection();
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return Response.json({ error: "Yalnız yönetici" }, { status: 403 });
  const post = (ua?: string) => async () => {
    const r = await fetch("https://api.parasut.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", ...(ua ? { "User-Agent": ua } : {}) },
      body: BODY,
      signal: AbortSignal.timeout(12000),
    });
    return `${r.status} ${(await r.text()).slice(0, 80)}`;
  };
  const results = [];
  results.push(await timed("dns-all", () => lookup("api.parasut.com", { all: true })));
  results.push(await timed("fetch-default", post()));
  results.push(await timed("fetch-ua", post("LAffogatoPanel/1.0 (+https://ladmin.laffogato.net)")));
  results.push(await timed("https-ipv4", () => httpsPost(4)));
  results.push(await timed("https-ipv4-ua", () => httpsPost(4, "LAffogatoPanel/1.0")));
  results.push(await timed("https-ipv6", () => httpsPost(6)));
  results.push(
    await timed("fetch-get-root", async () => {
      const r = await fetch("https://api.parasut.com/", { redirect: "manual", signal: AbortSignal.timeout(12000) });
      return `${r.status}`;
    }),
  );
  // Gerçek akış: kilit + gerçek kimlikle belirteç + /v4/me (yalnız durum kodu ve süre; belirteç dönmez)
  results.push(
    await timed("db-advisory-lock", () =>
      getDb().transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${7_311_201})`);
        return "ok";
      }),
    ),
  );
  let access = "";
  results.push(
    await timed("real-token", async () => {
      const r = await fetch("https://api.parasut.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "password",
          client_id: process.env.PARASUT_CLIENT_ID?.trim() ?? "",
          client_secret: process.env.PARASUT_CLIENT_SECRET?.trim() ?? "",
          username: process.env.PARASUT_USERNAME?.trim() ?? "",
          password: process.env.PARASUT_PASSWORD ?? "",
          redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
        }),
        signal: AbortSignal.timeout(20000),
      });
      const text = await r.text();
      try {
        access = (JSON.parse(text) as { access_token?: string }).access_token ?? "";
      } catch {}
      return `${r.status} ${access ? "token alındı" : text.slice(0, 120)}`;
    }),
  );
  if (access) {
    results.push(
      await timed("real-me", async () => {
        const r = await fetch("https://api.parasut.com/v4/me?include=companies", { headers: { Authorization: `Bearer ${access}`, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
        return `${r.status}`;
      }),
    );
  }
  const envCheck = Object.fromEntries(
    ["PARASUT_CLIENT_ID", "PARASUT_CLIENT_SECRET", "PARASUT_USERNAME", "PARASUT_PASSWORD", "PARASUT_COMPANY_ID", "PARASUT_BASE_URL"].map((k) => {
      const v = process.env[k];
      return [k, v === undefined ? "yok" : { length: v.length, trimmedDiffers: v.trim() !== v }];
    }),
  );
  results.push({ label: "env", ok: true, ms: 0, v: envCheck });
  results.push(await timed("egress-ip", async () => (await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(8000) })).text()));
  return Response.json({ node: process.version, region: process.env.VERCEL_REGION ?? null, results });
}

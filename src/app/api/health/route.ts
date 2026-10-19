import { sql } from "drizzle-orm";
import { connection } from "next/server";

import { getDb } from "@/server/db";

/** Vercel / izleme için basit sağlık kontrolü */
export async function GET() {
  await connection();
  const started = Date.now();
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true, db: "up", ms: Date.now() - started });
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503 });
  }
}

import { connection } from "next/server";

import { loadPublicMenu } from "@/server/data/menu";

/** Herkese açık menü (JSON). Menü yayında değilse 404. Maliyet bilgisi içermez. */
export async function GET() {
  await connection();
  const menu = await loadPublicMenu();
  if (!menu.published) return Response.json({ error: "Menü yayında değil" }, { status: 404 });
  return Response.json(
    { categories: menu.categories },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}

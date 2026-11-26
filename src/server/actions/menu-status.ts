"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { SITE_MENU_ID } from "@/lib/site-menu/schema";
import { adminActor } from "@/lib/roles";
import { requireAdmin, requireCan } from "@/server/auth/dal";
import { holdSoldOutCore, setSoldOutCore } from "@/server/site-menu/sold-out-core";

import { attempt } from "./util";

/*
 * Siparişler ekranının Tükenenler kartı (dalga 10 §2.1; docs/SITE-MENU.md › Personel: Tükendi / Satışa aç). Kurallar
 * çekirdekte (src/server/site-menu/sold-out-core.ts). Dönüşte yalnız değişti mi, metin ve ürünün adı: fiyat yok.
 */

const zSiteMenuId = z.string().regex(SITE_MENU_ID, "Geçersiz ürün");
const zSet = z.object({ siteMenuId: zSiteMenuId, soldOut: z.boolean() });
const zHold = z.object({ siteMenuId: zSiteMenuId });

/** Biten ürünü sitede, uygulamada ve QR menüde "Tükendi" yapar ya da satışa açar (personel ve yönetici; onaysız) */
export async function setSoldOut(input: z.input<typeof zSet>) {
  return attempt(async () => {
    const me = adminActor(await requireCan("kayit.yaz"));
    const data = zSet.parse(input);
    const r = await setSoldOutCore({ id: me.id, name: me.name, role: me.role }, data);
    refresh();
    return { changed: r.changed, message: r.message, name: r.name };
  });
}

/** Yönetici: "Kapalı tut". Ürün kapalı kalır, kartın kaydı düşer; satışa artık yalnız yönetici açar */
export async function holdSoldOut(input: z.input<typeof zHold>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = zHold.parse(input);
    const r = await holdSoldOutCore({ id: me.id, name: me.name, role: me.role }, data);
    refresh();
    return { changed: r.changed, message: r.message, name: r.name };
  });
}

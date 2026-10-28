"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { cleanName } from "@/lib/count-item";
import { rowLabel } from "@/lib/site-menu/plan";
import { SITE_MENU_ID, type SiteMenuItem } from "@/lib/site-menu/schema";
import type { SiteMenuSlot } from "@/lib/site-menu/slot";
import { requireAdmin } from "@/server/auth/dal";
import { getDb } from "@/server/db";
import { siteLinkSecret } from "@/server/site-link";
import { createLinkedProducts, LINK_OFF_ERROR, linkProducts, unlinkProduct } from "@/server/site-menu/link";
import { fetchSiteMenu, loadLinkedRows, SiteRequestError, syncSiteMenu } from "@/server/site-menu/sync";

import { attempt, UserError } from "./util";

// laffogato.net menü bağlantısı (docs/SITE-MENU.md): elle eşitleme, bağlama ve bağlantıyı kaldırma. Hepsi
// yöneticinin; fiyat ve menü durumunun siteye yazılması ürün eylemlerinde (products.ts).

const zLink = z.object({
  productId: z.number().int().positive(),
  siteMenuId: z.string().regex(SITE_MENU_ID, "Geçersiz kalem"),
  slot: z.enum(["M", "L"], { message: "Fiyat seçin (M ya da L)" }),
});

/** "Siteyle eşitle": sitenin menüsünü hemen çeker ve bağlı ürünlere uygular */
export async function syncSiteMenuNow() {
  return attempt(async () => {
    await requireAdmin();
    const r = await syncSiteMenu("manual");
    if (r.status === "off") throw new UserError(LINK_OFF_ERROR);
    if (r.status === "error") throw new UserError(r.error);
    refresh();
    return r;
  });
}

export interface SiteMenuChoices {
  items: SiteMenuItem[];
  /** Bağlı yuvalar: kalem + yuva → panel ürünü */
  links: { siteMenuId: string; slot: SiteMenuSlot; productId: number; label: string }[];
}

/** Bağlama penceresinin listesi: sitenin bütün kalemleri (imzalı, o an) ve hangi yuvaların bağlı olduğu */
export async function loadSiteMenuChoices() {
  return attempt<SiteMenuChoices>(async () => {
    await requireAdmin();
    const secret = siteLinkSecret();
    if (!secret) throw new UserError(LINK_OFF_ERROR);
    let items: SiteMenuItem[];
    try {
      items = (await fetchSiteMenu(secret)).items;
    } catch (e) {
      if (e instanceof SiteRequestError) throw new UserError(e.message);
      throw e;
    }
    const links = (await loadLinkedRows(getDb())).map((r) => ({ siteMenuId: r.siteMenuId, slot: r.siteMenuSlot, productId: r.id, label: rowLabel(r) }));
    return { items, links };
  });
}

/** Ürünü sitedeki kalemin bir fiyatına bağlar; ürün sitenin fiyatını ve menü durumunu alır */
export async function linkProductToSite(input: z.input<typeof zLink>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = zLink.parse(input);
    const r = await linkProducts(me, [data]);
    const linked = r.linked[0];
    if (!linked) throw new UserError(r.skipped[0]?.reason ?? "Bağlantı kurulamadı");
    refresh();
    return linked;
  });
}

/** Eşleştirme ekranında seçilen önerileri bağlar (her ürün sitenin değerini alır); bağlanamayanlar nedeniyle döner */
export async function linkSuggestedProducts(input: z.input<typeof zLink>[]) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = z.array(zLink).min(1, "Öneri seçin").max(300).parse(input);
    const r = await linkProducts(me, data);
    if (r.linked.length) refresh();
    return { linked: r.linked.length, skipped: r.skipped };
  });
}

const zNewFromSite = z.object({
  siteMenuId: z.string().regex(SITE_MENU_ID, "Geçersiz kalem"),
  name: z
    .string({ message: "Ürün adını yazın" })
    .transform(cleanName)
    .pipe(z.string().min(2, "Ürün adı en az 2 harf olmalı").max(120, "Ürün adı çok uzun")),
  categoryId: z.number({ message: "Kategori seçin" }).int().positive("Kategori seçin"),
  rows: z
    .array(z.object({ slot: z.enum(["M", "L"], { message: "Fiyat seçin (M ya da L)" }), size: z.enum(["M", "L", "Tek"], { message: "Boy seçin" }) }))
    .min(1, "En az bir boy seçin")
    .max(2, "Bir kalemin en çok iki fiyatı var")
    .refine((rows) => new Set(rows.map((r) => r.slot)).size === rows.length, "Aynı fiyat iki kez seçildi")
    .refine((rows) => new Set(rows.map((r) => r.size)).size === rows.length, "İki fiyata aynı boy seçildi"),
});

/**
 * "Yalnız sitede" kalemden panel ürünü açar ve bağlar (denetim E-48): seçilen her fiyat (M / L / tek) bir boy olarak
 * sitenin adı (değiştirilebilir), fiyatı ve menü durumuyla açılır ve aynı işlemde o yuvaya bağlanır. Reçete sonra
 * ürün kartında girilir.
 */
export async function createProductsFromSite(input: z.input<typeof zNewFromSite>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = zNewFromSite.parse(input);
    const r = await createLinkedProducts(me, data);
    refresh();
    return r;
  });
}

/** Bağlantıyı kaldırır; ürünün fiyatı ve menü durumu kalır, bundan sonra yalnız panelde değişir */
export async function unlinkProductFromSite(productId: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    await unlinkProduct(me, z.number().int().positive().parse(productId));
    refresh();
    return null;
  });
}

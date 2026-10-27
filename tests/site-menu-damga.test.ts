// laffogato.net menüsü: panelin kendi yazımından önce okunmuş liste o kalemi geri almaz. Site listenin zamanını
// kalemleri okuduktan sonra aldığı için yalnız site saatine bakmak yetmiyordu (toplu fiyat değişikliğinde bir ürün
// birkaç saniye eski fiyatına dönüp fiyat geçmişine "site" değişikliği olarak düşüyordu). Panel her yazımın sitedeki
// zamanını kalem kalem saklar (bir saat), daha eski liste kaleminin satırlarına dokunulmaz.
// Çalıştırma: npx tsx --test tests/site-menu-damga.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { freshStamps, planMenuSync, PUSHED_KEEP_MS, staleItemIds, type LinkedRow, type PushedStamps } from "../src/lib/site-menu/plan";
import type { SiteMenuItem } from "../src/lib/site-menu/schema";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

const item = (id: string, priceMinor: number, updatedAt: string): SiteMenuItem => ({
  id,
  name: id,
  categoryKey: "kahve",
  categoryLabel: "Kahve",
  priceMinor,
  priceMinorL: 0,
  isActive: true,
  sortOrder: 0,
  updatedAt,
});

const NOW = Date.parse("2026-10-23T12:00:00Z");

test("damgalar: bir saat tutulur; bozuk ya da eski olan atılır", () => {
  const stamps: PushedStamps = {
    "mnu-0001": { updatedAt: "2026-10-23T11:59:58.120Z", at: "2026-10-23T11:59:58.300Z" },
    "mnu-0002": { updatedAt: "2026-10-23T10:00:00.000Z", at: new Date(NOW - PUSHED_KEEP_MS).toISOString() },
    "mnu-0003": { updatedAt: "bozuk", at: "2026-10-23T11:59:00.000Z" },
  };
  assert.deepEqual(Object.keys(freshStamps(stamps, NOW)), ["mnu-0001"]);
  assert.deepEqual(freshStamps(undefined, NOW), {});
  assert.deepEqual(freshStamps(null, NOW), {});
});

test("eski kalem: listedeki zaman panelin yazımından önceyse o kalemin satırlarına dokunulmaz, kalem listede kalır", () => {
  const stamps: PushedStamps = { "mnu-0001": { updatedAt: "2026-10-23T11:59:58.120Z", at: "2026-10-23T11:59:58.300Z" } };
  // Yazımdan hemen önce okunmuş liste: kalem eski fiyatla ve eski zamanla, listenin `now`u yazımdan sonra
  const listed = [item("mnu-0001", 19500, "2026-10-23T09:00:00.000Z"), item("mnu-0002", 15000, "2026-10-23T11:00:00.000Z")];
  const stale = staleItemIds(listed, stamps);
  assert.deepEqual([...stale], ["mnu-0001"]);
  const rows: LinkedRow[] = [
    { id: 1, name: "Latte", size: "M", price: 205, active: true, showOnMenu: true, siteMenuId: "mnu-0001", siteMenuSlot: "M" },
    { id: 2, name: "Americano", size: "M", price: 140, active: true, showOnMenu: true, siteMenuId: "mnu-0002", siteMenuSlot: "M" },
  ];
  const plan = planMenuSync(listed, rows.filter((r) => !stale.has(r.siteMenuId)));
  assert.deepEqual(
    plan.changes.map((c) => [c.productId, c.set.price]),
    [[2, 150]],
    "panelin az önce yazdığı 205 ₺ 195'e dönmez; öteki kalem uygulanır",
  );
  assert.deepEqual(plan.unlinked, [], "eski kalem listede durduğu için bağlantı kaldırılmaz");
  // Sitenin sonraki (yazımdan yeni ya da aynı) zamanı uygulanır; zamanı okunamayan kalem eski sayılmaz
  assert.equal(staleItemIds([item("mnu-0001", 20500, "2026-10-23T11:59:58.120Z")], stamps).size, 0);
  assert.equal(staleItemIds([item("mnu-0001", 21000, "2026-10-23T12:05:00.000Z")], stamps).size, 0);
  assert.equal(staleItemIds([item("mnu-0001", 19500, "")], stamps).size, 0);
});

test("sunucu: yazım kalemin zamanını saklar; çekme eski kalemleri ayırır, kopyada yazımın hâlini korur", () => {
  const push = read("src/server/site-menu/push.ts");
  assert.match(push, /pushed: \{ \.\.\.freshStamps\(cur\.pushed, Date\.now\(\)\), \[item\.id\]: \{ updatedAt: item\.updatedAt, at: new Date\(\)\.toISOString\(\) \} \},/);
  const sync = read("src/server/site-menu/sync.ts");
  const apply = sync.slice(sync.indexOf("export async function applySiteList"), sync.indexOf("export async function logApplied"));
  assert.ok(apply.indexOf("await lockMenu(tx)") < apply.indexOf("staleItemIds("), "damgalar kilit altında okunur");
  assert.match(apply, /planMenuSync\(list\.items, \(await loadLinkedRows\(tx\)\)\.filter\(\(r\) => !stale\.has\(r\.siteMenuId\)\)\)/);
  assert.match(apply, /stale\.has\(i\.id\) \? \(kept\.get\(i\.id\) \?\? i\) : i/);
  assert.match(apply, /pushed,\n/);
  // Boş durum: damga yok, site expect duyurmamış sayılır (denetim E-11)
  assert.match(sync, /pushed: \{\},\n  writesExpect: false,\n\};/);
});

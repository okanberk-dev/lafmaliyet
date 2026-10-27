// laffogato.net menü bağlantısı (docs/SITE-MENU.md): sitenin yanıtının doğrulanması, panel satırı ↔ site fiyatı
// (M / L yuvası), çekme planı (fiyat, kopuk L, silinen kalem, menü durumu kuralları), ad önerileri, panel → site
// yazımının gövdesi ve hata metinleri, pingin imza denetimi; sunucu kodunun kuralları kaynaktan.
// Çalıştırma: npx tsx --test tests/site-menusu.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { sign, signedHeaders, signedRequest, verifySignature } from "../src/lib/karaoke/signature";
import { CONFIDENCE_LABEL, menuNameKey, SITE_OLD_NAMES, siteGaps, similarNames, suggestLinks } from "../src/lib/site-menu/names";
import { checkMenuPing } from "../src/lib/site-menu/ping";
import { changeText, planMenuSync, planSummary, type LinkedRow } from "../src/lib/site-menu/plan";
import {
  BROKEN_LINK_ERROR,
  buildPushBody,
  isStaleFailure,
  planPush,
  PRICE_PUSH_REMINDER,
  pullFailureMessage,
  pushActor,
  pushFailureMessage,
  staleMessage,
  withoutExpect,
} from "../src/lib/site-menu/push";
import { errorCode, errorField, parseSiteMenuAnswer, parseSiteMenuList, SiteMenuFormatError, type SiteMenuItem } from "../src/lib/site-menu/schema";
import {
  defaultSlot,
  fromMinor,
  linkStatus,
  panelIsActive,
  slotField,
  slotLabel,
  slotPriceMinor,
  toMinor,
  visibilityFromSite,
} from "../src/lib/site-menu/slot";
import { siteMarker } from "../src/lib/site-menu/view";
import type { ExcelData } from "../src/server/db/seed/excel";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const T = 1760000000;

/** Sitenin gönderdiği kalem (bozuk değer denemeleri için `over` serbest) */
const site = (over: Record<string, unknown> = {}): SiteMenuItem =>
  ({
    id: "mnu-0007",
    name: "Latte",
    categoryKey: "espresso",
    categoryLabel: "Espresso",
    priceMinor: 19500,
    priceMinorL: 21000,
    isActive: true,
    sortOrder: 3,
    updatedAt: "2026-10-20T08:00:00.000Z",
    ...over,
  }) as SiteMenuItem;

const list = (items: unknown[], over: Record<string, unknown> = {}) => ({ version: 1, now: "2026-10-21T10:00:00.000Z", items, ...over });

// ---------------------------------------------------------------- Sitenin yanıtı

test("liste: sözleşmedeki örnek okunur; ad ve sıra gevşek, fiyat ve durum katı; bilinmeyen alan atılır", () => {
  const r = parseSiteMenuList(
    list([
      { id: "mnu-0011", name: "Espresso Macchiato", categoryKey: "espresso", categoryLabel: "Espresso", priceMinor: 14000, priceMinorL: 0, isActive: true, sortOrder: 6, updatedAt: "2026-10-20T08:00:00.000Z" },
      site({ name: `  ${"x".repeat(200)} `, sortOrder: "bozuk", categoryLabel: null, cost: 999 }),
    ]),
  );
  assert.equal(r.now, "2026-10-21T10:00:00.000Z");
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items[0], {
    id: "mnu-0011",
    name: "Espresso Macchiato",
    categoryKey: "espresso",
    categoryLabel: "Espresso",
    priceMinor: 14000,
    priceMinorL: 0,
    isActive: true,
    sortOrder: 6,
    updatedAt: "2026-10-20T08:00:00.000Z",
  });
  assert.equal(r.items[1].name.length, 120);
  assert.equal(r.items[1].sortOrder, 0);
  assert.equal(r.items[1].categoryLabel, "");
  assert.equal("cost" in r.items[1], false, "beyaz liste: bilinmeyen alan panele girmez");
  // Satışta olmayan da listede (panel bağlıyı gizlemek için onu da görmeli)
  assert.equal(parseSiteMenuList(list([site({ isActive: false })])).items[0].isActive, false);
});

test("liste: tanınmayan sürüm, bozuk fiyat / durum ve iki kez geçen kimlik bütün listeyi reddeder (yanlış bağlantı kaldırılmasın)", () => {
  assert.throws(() => parseSiteMenuList(list([site()], { version: 2 })), /tanınmayan sürümde \(2\)/);
  assert.throws(() => parseSiteMenuList({ items: [] }), SiteMenuFormatError);
  assert.throws(() => parseSiteMenuList(list([site({ priceMinor: "195" })])), /items\.0\.priceMinor/);
  assert.throws(() => parseSiteMenuList(list([site({ priceMinor: 195.5 })])), SiteMenuFormatError, "kuruş tamsayı");
  assert.throws(() => parseSiteMenuList(list([site({ priceMinorL: -1 })])), SiteMenuFormatError);
  assert.throws(() => parseSiteMenuList(list([site({ isActive: "evet" })])), SiteMenuFormatError);
  assert.throws(() => parseSiteMenuList(list([site({ id: "MNU 7" })])), SiteMenuFormatError);
  assert.throws(() => parseSiteMenuList(list([site(), site()])), /iki kez/);
  assert.throws(() => parseSiteMenuList(list([site()], { now: "dün" })), SiteMenuFormatError);
});

test("liste: sitenin yetenek bayrağı writes.expect; yoksa, bozuksa ya da false ise expect gönderilmez", () => {
  assert.equal(parseSiteMenuList(list([site()])).writesExpect, false, "bugünkü site bayrak göndermez");
  assert.equal(parseSiteMenuList(list([site()], { writes: { expect: true } })).writesExpect, true);
  assert.equal(parseSiteMenuList(list([site()], { writes: { expect: false } })).writesExpect, false);
  assert.equal(parseSiteMenuList(list([site()], { writes: { expect: "evet" } })).writesExpect, false, "bozuk bayrak listeyi reddetmez");
  assert.equal(parseSiteMenuList(list([site()], { writes: "hepsi" })).writesExpect, false);
  assert.equal(parseSiteMenuList(list([site()], { writes: { expect: true, other: 1 } })).writesExpect, true, "bilinmeyen yeni bayrak atılır");
});

test("yazma yanıtı: { item } okunur, okunamazsa null; hata gövdesinin alanı", () => {
  assert.equal(parseSiteMenuAnswer({ item: site({ priceMinor: 14500 }) })?.priceMinor, 14500);
  assert.equal(parseSiteMenuAnswer({ ok: true }), null);
  assert.equal(parseSiteMenuAnswer(null), null);
  assert.equal(errorField({ error: "invalid", field: "priceMinor" }), "priceMinor");
  assert.equal(errorField({ error: "not_found" }), null);
  // Hata kodu: 409 stale / single_size, 404 not_found; JSON değilse (uç yok, HTML 404) null
  assert.equal(errorCode({ error: "stale", item: site() }), "stale");
  assert.equal(errorCode({ error: "not_found" }), "not_found");
  assert.equal(errorCode(null), null);
  assert.equal(errorCode({ field: "x" }), null);
  // 409 stale yanıtı güncel kalemi taşır
  assert.equal(parseSiteMenuAnswer({ error: "stale", item: site({ priceMinor: 19_000 }) })?.priceMinor, 19_000);
});

// ---------------------------------------------------------------- Yuva ve değerler

test("yuva ↔ fiyat: M priceMinor, L priceMinorL, tek boyda L yok; TL ↔ kuruş Math.round", () => {
  const twoSizes = site();
  const single = site({ priceMinorL: 0 });
  assert.equal(slotPriceMinor(twoSizes, "M"), 19500);
  assert.equal(slotPriceMinor(twoSizes, "L"), 21000);
  assert.equal(slotPriceMinor(single, "M"), 19500);
  assert.equal(slotPriceMinor(single, "L"), null, "L silinmiş: bağlantı kopuk");
  assert.equal(slotField("M"), "priceMinor");
  assert.equal(slotField("L"), "priceMinorL");
  assert.equal(slotLabel("M", single), "tek fiyat");
  assert.equal(slotLabel("M", twoSizes), "M fiyatı");
  assert.equal(slotLabel("L", twoSizes), "L fiyatı");
  assert.equal(toMinor(185.5), 18550);
  assert.equal(toMinor(19.99), 1999);
  assert.equal(toMinor(0.1 + 0.2), 30);
  assert.equal(toMinor(145), 14500);
  assert.equal(fromMinor(14550), 145.5);
  assert.equal(linkStatus(twoSizes, "L"), "ok");
  assert.equal(linkStatus(single, "L"), "broken");
  assert.equal(linkStatus(null, "M"), "missing");
  // Panel ürününün boyuna göre önerilen yuva: L boy iki boylu kalemin L'sine, tek boylu kalemin tek fiyatına
  assert.equal(defaultSlot("L", twoSizes), "L");
  assert.equal(defaultSlot("L", single), "M");
  assert.equal(defaultSlot("M", twoSizes), "M");
  assert.equal(defaultSlot("Tek", twoSizes), "M");
});

test("menü durumu: panel → site active && showOnMenu; site → panel Tükendi active'e dokunmaz, Satışta ikisini açar", () => {
  assert.equal(panelIsActive({ active: true, showOnMenu: true }), true);
  assert.equal(panelIsActive({ active: false, showOnMenu: true }), false, "pasif ürün sitede Tükendi");
  assert.equal(panelIsActive({ active: true, showOnMenu: false }), false, "QR menüden kaldırılan da Tükendi");
  assert.deepEqual(visibilityFromSite(false, { active: true, showOnMenu: true }), { active: true, showOnMenu: false });
  assert.deepEqual(visibilityFromSite(false, { active: false, showOnMenu: true }), { active: false, showOnMenu: false });
  assert.deepEqual(visibilityFromSite(true, { active: false, showOnMenu: false }), { active: true, showOnMenu: true });
});

// ---------------------------------------------------------------- Çekme planı

const row = (over: Partial<LinkedRow> = {}): LinkedRow => ({
  id: 1,
  name: "Latte",
  size: "M",
  price: 195,
  active: true,
  showOnMenu: true,
  siteMenuId: "mnu-0007",
  siteMenuSlot: "M",
  ...over,
});

test("çekme: fiyat yuvasından kuruş / 100; aynı kuruşa dokunulmaz", () => {
  const plan = planMenuSync([site({ priceMinor: 20000, priceMinorL: 21500 })], [row(), row({ id: 2, size: "L", price: 210, siteMenuSlot: "L" })]);
  assert.deepEqual(
    plan.changes.map((c) => [c.productId, c.set]),
    [
      [1, { price: 200 }],
      [2, { price: 215 }],
    ],
  );
  assert.equal(plan.changes[0].label, "Latte M");
  assert.deepEqual(plan.broken, []);
  assert.deepEqual(plan.unlinked, []);
  // Panelde 195,004 ₺ yazılı, sitede 19500 kuruş: aynı fiyat
  assert.deepEqual(planMenuSync([site()], [row({ price: 195.004 })]).changes, []);
  // Kuruşlu fiyat
  assert.deepEqual(planMenuSync([site({ priceMinor: 19550 })], [row()]).changes[0].set, { price: 195.5 });
  assert.equal(changeText(plan.changes[0]), "195 ₺ → 200 ₺".replace(/ ₺/g, " ₺"));
});

test("çekme: L fiyatı silinince L'ye bağlı satır kopuk; ne fiyatına ne durumuna dokunulur, M satırı işler", () => {
  const plan = planMenuSync(
    [site({ priceMinorL: 0, isActive: false })],
    [row(), row({ id: 2, size: "L", price: 210, siteMenuSlot: "L" })],
  );
  assert.deepEqual(plan.broken, [{ productId: 2, label: "Latte L", siteMenuId: "mnu-0007", slot: "L", siteName: "Latte" }]);
  assert.deepEqual(
    plan.changes.map((c) => [c.productId, c.set]),
    [[1, { showOnMenu: false }]],
  );
});

test("çekme: kalem listede yoksa bağlantı kaldırılır (fiyat ve durum kalır); tek kalemlik yanıtta (partial) dokunulmaz", () => {
  const rows = [row(), row({ id: 3, name: "Kuzu Kulağı", siteMenuId: "mnu-0099" })];
  const plan = planMenuSync([site()], rows);
  assert.deepEqual(plan.unlinked, [{ productId: 3, label: "Kuzu Kulağı M", siteMenuId: "mnu-0099", slot: "M" }]);
  assert.deepEqual(plan.changes, []);
  assert.deepEqual(planMenuSync([site()], rows, { partial: true }).unlinked, []);
});

test("çekme: Tükendi QR menüden kaldırır ve active'e dokunmaz; Satışta active ve QR menüyü açar; M ve L aynı durumu paylaşır", () => {
  const sold = planMenuSync([site({ isActive: false })], [row(), row({ id: 2, size: "L", price: 210, siteMenuSlot: "L", active: false })]);
  assert.deepEqual(
    sold.changes.map((c) => [c.productId, c.set]),
    [
      [1, { showOnMenu: false }],
      [2, { showOnMenu: false }],
    ],
  );
  assert.ok(sold.changes.every((c) => !("active" in c.set)), "Tükendi active'i değiştirmez");
  // Zaten gizliyse değişiklik yok
  assert.deepEqual(planMenuSync([site({ isActive: false })], [row({ showOnMenu: false })]).changes, []);
  const back = planMenuSync([site()], [row({ active: false, showOnMenu: false }), row({ id: 2, size: "L", price: 210, siteMenuSlot: "L", showOnMenu: false })]);
  assert.deepEqual(
    back.changes.map((c) => [c.productId, c.set]),
    [
      [1, { active: true, showOnMenu: true }],
      [2, { showOnMenu: true }],
    ],
  );
  assert.match(planSummary(sold.changes), /^Latte M: QR menüden kaldırıldı \(sitede Tükendi\); Latte L: QR menüden kaldırıldı/);
  assert.match(changeText(back.changes[0]), /menüye açıldı \(sitede Satışta\)/);
});

// ---------------------------------------------------------------- Panel → site yazımı

test("yazma gövdesi: sözleşmedeki sıra ve alanlar; yuvaya göre priceMinor ya da priceMinorL", () => {
  assert.equal(
    JSON.stringify(buildPushBody({ id: "mnu-0011", slot: "M", priceMinor: 14500, actor: "Selin" })),
    '{"id":"mnu-0011","priceMinor":14500,"actor":"Selin"}',
  );
  assert.equal(
    JSON.stringify(buildPushBody({ id: "mnu-0007", slot: "L", priceMinor: 21500, isActive: false, actor: "Okan" })),
    '{"id":"mnu-0007","priceMinorL":21500,"isActive":false,"actor":"Okan"}',
  );
  assert.equal(JSON.stringify(buildPushBody({ id: "mnu-0007", slot: "M", isActive: true, actor: "Okan" })), '{"id":"mnu-0007","isActive":true,"actor":"Okan"}');
  assert.equal(pushActor("  Selin   Yılmaz "), "Selin Yılmaz");
  assert.equal(pushActor("x".repeat(100)).length, 80);
  assert.equal(pushActor(""), "Panel");
  assert.equal(pushActor(null), "Panel");
});

const sale = (over: Partial<{ price: number; active: boolean; showOnMenu: boolean }> = {}) => ({ price: 195, active: true, showOnMenu: true, ...over });
const linkM = { siteMenuId: "mnu-0007", slot: "M" as const };

test("yazma planı: bağlı değilse ya da sitedeki değer değişmiyorsa gönderilmez", () => {
  assert.deepEqual(planPush({ link: null, before: sale(), after: sale({ price: 200 }), actor: "Selin" }), { kind: "none" });
  assert.deepEqual(planPush({ link: linkM, before: sale(), after: sale(), actor: "Selin" }), { kind: "none" });
  // Kuruşu aynı
  assert.deepEqual(planPush({ link: linkM, before: sale(), after: sale({ price: 195.001 }), actor: "Selin" }), { kind: "none" });
  // QR menüde gizliyken "Menüde aktif" açılıyor: sitede yine Tükendi, gönderilecek bir şey yok
  assert.deepEqual(planPush({ link: linkM, before: sale({ active: false, showOnMenu: false }), after: sale({ showOnMenu: false }), actor: "Selin" }), { kind: "none" });
});

test("yazma planı: fiyat yuvasına (Math.round(TL * 100)), durum active && showOnMenu", () => {
  const price = planPush({ link: linkM, before: sale(), after: sale({ price: 199.9 }), actor: "Selin" });
  assert.equal(price.kind, "push");
  assert.deepEqual(price.kind === "push" ? price.body : null, { id: "mnu-0007", priceMinor: 19990, actor: "Selin" });
  const l = planPush({ link: { siteMenuId: "mnu-0007", slot: "L" }, before: sale({ price: 210 }), after: sale({ price: 215 }), actor: "Selin", siteItem: site() });
  assert.deepEqual(l.kind === "push" ? l.body : null, { id: "mnu-0007", priceMinorL: 21500, actor: "Selin" });
  // Pasif yapmak da QR menüden kaldırmak da sitede Tükendi
  const off = planPush({ link: linkM, before: sale(), after: sale({ active: false }), actor: "Selin" });
  assert.deepEqual(off.kind === "push" ? [off.body, off.price, off.visibility] : null, [{ id: "mnu-0007", isActive: false, actor: "Selin" }, false, true]);
  const hide = planPush({ link: linkM, before: sale(), after: sale({ showOnMenu: false, price: 210 }), actor: "Selin" });
  assert.deepEqual(hide.kind === "push" ? hide.body : null, { id: "mnu-0007", priceMinor: 21000, isActive: false, actor: "Selin" });
  const on = planPush({ link: linkM, before: sale({ showOnMenu: false }), after: sale(), actor: "Selin" });
  assert.deepEqual(on.kind === "push" ? on.body : null, { id: "mnu-0007", isActive: true, actor: "Selin" });
});

test("yazma planı: expect yalnız site duyurduysa, yalnız yazılan alanlar için, panelin site kopyasındaki değerle", () => {
  const item = site({ priceMinor: 19_500, priceMinorL: 21_000, isActive: true });
  // Bayrak yok (bugünkü site): gövde bugünkü gibi
  const off = planPush({ link: linkM, before: sale(), after: sale({ price: 200 }), actor: "Selin", siteItem: item });
  assert.deepEqual(off.kind === "push" ? off.body : null, { id: "mnu-0007", priceMinor: 20000, actor: "Selin" });
  // Bayrak var: fiyat yazımı yuvanın kopyadaki fiyatını bekler; durum yazılmıyorsa isActive beklenmez
  const price = planPush({ link: linkM, before: sale(), after: sale({ price: 200 }), actor: "Selin", siteItem: item, expect: true });
  assert.equal(JSON.stringify(price.kind === "push" ? price.body : null), '{"id":"mnu-0007","priceMinor":20000,"actor":"Selin","expect":{"priceMinor":19500}}');
  // L yuvası priceMinorL'yi bekler
  const l = planPush({ link: { siteMenuId: "mnu-0007", slot: "L" }, before: sale({ price: 210 }), after: sale({ price: 215 }), actor: "Selin", siteItem: item, expect: true });
  assert.deepEqual(l.kind === "push" ? l.body : null, { id: "mnu-0007", priceMinorL: 21500, actor: "Selin", expect: { priceMinorL: 21000 } });
  // Yalnız durum: isActive beklenir, fiyat beklenmez
  const off2 = planPush({ link: linkM, before: sale(), after: sale({ showOnMenu: false }), actor: "Selin", siteItem: item, expect: true });
  assert.deepEqual(off2.kind === "push" ? off2.body : null, { id: "mnu-0007", isActive: false, actor: "Selin", expect: { isActive: true } });
  // İkisi birden
  const both = planPush({ link: linkM, before: sale({ showOnMenu: false }), after: sale({ price: 210 }), actor: "Selin", siteItem: site({ isActive: false }), expect: true });
  assert.deepEqual(both.kind === "push" ? both.body : null, { id: "mnu-0007", priceMinor: 21000, isActive: true, actor: "Selin", expect: { priceMinor: 19500, isActive: false } });
  // Kalem kopyada yoksa expect yok (site yazmadan önce bakacak değeri bilmiyoruz)
  const none = planPush({ link: linkM, before: sale(), after: sale({ price: 200 }), actor: "Selin", siteItem: null, expect: true });
  assert.deepEqual(none.kind === "push" ? none.body : null, { id: "mnu-0007", priceMinor: 20000, actor: "Selin" });
  // Gönderilecek değişiklik yoksa bayrak bir şey değiştirmez
  assert.deepEqual(planPush({ link: linkM, before: sale(), after: sale(), actor: "Selin", siteItem: item, expect: true }), { kind: "none" });
  // 400 field:"expect" sonrası yeniden deneme expect'siz aynı gövde
  assert.deepEqual(withoutExpect(price.kind === "push" ? price.body : buildPushBody({ id: "x", slot: "M", actor: "a" })), { id: "mnu-0007", priceMinor: 20000, actor: "Selin" });
  // Boş expect gövdeye girmez
  assert.equal(JSON.stringify(buildPushBody({ id: "mnu-0011", slot: "M", priceMinor: 14500, actor: "Selin", expect: {} })), '{"id":"mnu-0011","priceMinor":14500,"actor":"Selin"}');
});

test("yazma planı: 0 fiyat, tavanın üstü ve kopuk L bağlantısı gönderilmeden reddedilir", () => {
  const zero = planPush({ link: linkM, before: sale(), after: sale({ price: 0 }), actor: "Selin" });
  assert.equal(zero.kind, "refuse");
  assert.match(zero.kind === "refuse" ? zero.error : "", /0 olamaz/);
  assert.equal(planPush({ link: linkM, before: sale(), after: sale({ price: 1_000_001 }), actor: "Selin" }).kind, "refuse");
  assert.equal(planPush({ link: linkM, before: sale(), after: sale({ price: 1_000_000 }), actor: "Selin" }).kind, "push");
  const broken = planPush({ link: { siteMenuId: "mnu-0007", slot: "L" }, before: sale(), after: sale({ active: false }), actor: "Selin", siteItem: site({ priceMinorL: 0 }) });
  assert.deepEqual(broken, { kind: "refuse", error: BROKEN_LINK_ERROR });
  // Kopuk ama sitede değişen bir şey yoksa (yalnız reçete) kayıt engellenmez
  assert.deepEqual(planPush({ link: { siteMenuId: "mnu-0007", slot: "L" }, before: sale(), after: sale(), actor: "Selin", siteItem: site({ priceMinorL: 0 }) }), { kind: "none" });
});

test("hata metinleri: ağ / zaman aşımı, 404, 400 alanı, imza, kapalı bağlantı; çekme hataları", () => {
  assert.equal(pushFailureMessage({ kind: "network" }), "Siteye ulaşılamadı; fiyat değişmedi. Tekrar dene.");
  // Zaman aşımında istek siteye varmış olabilir: "Tekrar dene" değil, kontrol et (panel yanıttan sonra siteyi okur)
  assert.equal(
    pushFailureMessage({ kind: "timeout" }),
    "Siteye ulaşılamadı; değişiklik sitede yapılmış olabilir, panelde fiyat değişmedi. Site menüsünde kontrol et; panel siteyi hemen yeniden okuyor.",
  );
  assert.equal(pushFailureMessage({ kind: "http", status: 502 }), "Siteye ulaşılamadı (HTTP 502); fiyat değişmedi. Tekrar dene.");
  // Kopya eskiyken L'ye bağlı ürün tek boy kaleme gitti: site 409 single_size verir; "ulaşılamadı" ve "Tekrar dene" değil
  const single = pushFailureMessage({ kind: "http", status: 409, field: errorField({ error: "single_size" }) });
  assert.equal(single, "Bu ürünün site bağlantısı kopuk: kalemin sitede L fiyatı yok; fiyat değişmedi. Bağlantıyı kaldır ya da ürünü kalemin M (tek) fiyatına bağla.");
  assert.doesNotMatch(single, /ulaşılamadı|Tekrar dene/);
  assert.match(pushFailureMessage({ kind: "http", status: 409 }, "değişiklikler kaydedilmedi"), /L fiyatı yok; değişiklikler kaydedilmedi\./);
  assert.equal(pushFailureMessage({ kind: "network" }, "değişiklikler kaydedilmedi"), "Siteye ulaşılamadı; değişiklikler kaydedilmedi. Tekrar dene.");
  assert.equal(pushFailureMessage({ kind: "http", status: 404 }), "Bu ürünün bağlı olduğu kalem sitede yok; bağlantıyı kaldır ya da yeniden bağla.");
  // Sitenin kendi 404'ü JSON `not_found`; gövdesi JSON olmayan 404 uç yok demek (site güncel değil)
  assert.equal(pushFailureMessage({ kind: "http", status: 404, error: errorCode({ error: "not_found" }) }), "Bu ürünün bağlı olduğu kalem sitede yok; bağlantıyı kaldır ya da yeniden bağla.");
  assert.equal(pushFailureMessage({ kind: "http", status: 404, error: errorCode(null) }), "Sitede panel menü ucu yok (laffogato.net güncel değil); fiyat değişmedi.");
  // 409 stale: sitede bu arada değişti (single_size'ın metninden ayrı)
  assert.equal(
    pushFailureMessage({ kind: "http", status: 409, error: "stale" }, "değişiklikler kaydedilmedi"),
    "Bu ürün sitede bu arada değişti; değişiklikler kaydedilmedi. Panel siteyi yeniden okuyor: birazdan bakıp yeniden dene.",
  );
  assert.equal(
    staleMessage("fiyat değişmedi", { reloaded: true, sitePrice: 19_050 }),
    "Bu ürün sitede bu arada değişti (sitede şimdi 190,50\u00a0₺); fiyat değişmedi. Sitenin güncel değeri panele yüklendi: bakıp yeniden dene.",
  );
  assert.ok(isStaleFailure(new Error("x", { cause: { kind: "http", status: 409, error: "stale" } })));
  assert.equal(isStaleFailure(new Error("x", { cause: { kind: "http", status: 409, error: "single_size" } })), false);
  assert.equal(isStaleFailure(new Error("x")), false);
  assert.match(pushFailureMessage({ kind: "http", status: 400, field: "priceMinor" }), /M fiyatı 0'dan büyük/);
  assert.match(pushFailureMessage({ kind: "http", status: 401 }), /KARAOKE_SYNC_SECRET aynı mı/);
  assert.match(pushFailureMessage({ kind: "http", status: 503 }), /fiyat değişmedi\. Tekrar dene\.$/);
  assert.match(pushFailureMessage({ kind: "off" }), /kurulmamış/);
  assert.equal(pullFailureMessage({ kind: "timeout" }), "Site 8 saniyede yanıt vermedi");
  assert.match(pullFailureMessage({ kind: "http", status: 404 }), /güncel değil/);
  assert.equal(
    PRICE_PUSH_REMINDER,
    "Fiyat sitede de değişti. Fiyat listesinin tarihini sitede (Ayarlar → Vergi) güncellemeyi unutma; kasadaki (ModPOS) fiyat Fiyatlar › Kasaya işle listesinde.",
  );
});

// ---------------------------------------------------------------- İmza ve ping

test("imza: menü uçlarının sabit vektörleri (sitedeki testler aynı değerleri sabitleyebilir)", () => {
  const ping = new URL("https://ladmin.laffogato.net/api/menu/ping");
  const body = JSON.stringify({ event: "menu.changed", at: "2026-10-21T10:00:00.000Z" });
  assert.equal(sign(SECRET, { timestamp: T, method: "POST", url: ping, body }), "42befa28874811a2862675ebb3a0950867b1542efe400fdea0cf2875b57c234f");
  const get = new URL("https://laffogato.net/api/panel/menu");
  assert.equal(sign(SECRET, { timestamp: T, method: "GET", url: get, body: "" }), "68f8ceecb77b7f07754d5fa3ee46340cd3e19b3db03e61b0ea97c55479fa7737");
  const write = JSON.stringify({ id: "mnu-0011", priceMinor: 14500, actor: "Selin" });
  assert.equal(sign(SECRET, { timestamp: T, method: "POST", url: get, body: write }), "41bf0fb6897f703c2364405b7afac695fa55c5ac736d955683fc42f74470e610");
});

test("imzalı istek: GET gövdesiz, POST JSON; imzalanan metin gönderilen metin", () => {
  const url = new URL("https://laffogato.net/api/panel/menu");
  const get = signedRequest(SECRET, "GET", url, "ignored", T * 1000);
  assert.equal(get.body, undefined);
  assert.equal(get.headers["content-type"], undefined);
  assert.deepEqual(get.headers, signedHeaders(SECRET, "GET", url, "", T * 1000));
  const body = '{"id":"mnu-0011","isActive":false,"actor":"Selin"}';
  const post = signedRequest(SECRET, "POST", url, body, T * 1000);
  assert.equal(post.body, body);
  assert.equal(post.headers["content-type"], "application/json");
  assert.equal(
    verifySignature(SECRET, { method: "POST", url, body: post.body!, timestamp: post.headers["x-laf-timestamp"], signature: post.headers["x-laf-signature"], now: T * 1000 }),
    true,
  );
});

test("ping: anahtar yoksa 503, 4 KB üstü 413, imzasız / yanlış / eski 401; doğru imza geçer", () => {
  const url = new URL("https://ladmin.laffogato.net/api/menu/ping");
  const body = JSON.stringify({ event: "menu.changed", at: "2026-10-21T10:00:00.000Z" });
  const now = T * 1000;
  const h = signedHeaders(SECRET, "POST", url, body, now);
  const check = (over: Partial<Parameters<typeof checkMenuPing>[0]> = {}) =>
    checkMenuPing({ secret: SECRET, url, body, timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"], now, ...over });
  assert.deepEqual(check(), { ok: true });
  assert.deepEqual(check({ secret: null }), { ok: false, status: 503, error: "not_configured" });
  assert.deepEqual(check({ body: "x".repeat(4097) }), { ok: false, status: 413, error: "too_large" });
  assert.deepEqual(check({ signature: null }), { ok: false, status: 401, error: "unauthorized" });
  assert.deepEqual(check({ secret: `${SECRET}x` }), { ok: false, status: 401, error: "unauthorized" });
  assert.deepEqual(check({ body: body.replace("menu", "karaoke") }), { ok: false, status: 401, error: "unauthorized" });
  assert.deepEqual(check({ now: now + 301_000 }), { ok: false, status: 401, error: "unauthorized" }, "5 dakikadan eski");
  // Karaoke pingi (başka yol) menü ucunda geçmez
  const karaoke = signedHeaders(SECRET, "POST", new URL("https://ladmin.laffogato.net/api/karaoke/ping"), body, now);
  assert.equal(check({ timestamp: karaoke["x-laf-timestamp"], signature: karaoke["x-laf-signature"] }).ok, false);
  // Alan adı imzaya girmez (lafmaliyet.vercel.app'e gelen ping de geçer)
  assert.deepEqual(check({ url: new URL("https://lafmaliyet.vercel.app/api/menu/ping") }), { ok: true });
});

test("ping ucu: önce anahtar, sonra boyut ve imza; eşitleme yanıttan sonra", () => {
  const route = read("src/app/api/menu/ping/route.ts");
  assert.match(route, /if \(!secret\) return Response\.json\(\{ error: "not_configured" \}, \{ status: 503 \}\)/);
  assert.match(route, /if \(!check\.ok\) return Response\.json\(\{ error: check\.error \}, \{ status: check\.status \}\)/);
  assert.match(route, /after\(async \(\) =>/);
  assert.match(route, /syncSiteMenu\("ping"\)/);
  assert.ok(route.indexOf("checkMenuPing(") < route.indexOf("after("), "202'den önce imza");
  // Ping oturum çerezi taşımaz: proxy /api/menu'yu engellememeli
  assert.doesNotMatch(read("src/proxy.ts"), /\/api\/menu/);
});

// ---------------------------------------------------------------- Öneriler

test("ad anahtarı Türkçe duyarlı: büyük/küçük harf, ı/İ, aksan ve noktalama sayılmaz", () => {
  assert.equal(menuNameKey("ÇAY"), menuNameKey("Çay"));
  assert.equal(menuNameKey("Çay"), "cay");
  assert.equal(menuNameKey("İSPANYOL Latte"), "ispanyol latte");
  assert.equal(menuNameKey("Buzlu Caffè Latte"), "buzlu caffe latte");
  assert.equal(menuNameKey("L'Af Coffee"), "l af coffee");
  assert.equal(menuNameKey("Donostia (L'Af Special)"), "donostia l af special");
  assert.ok(similarNames(menuNameKey("Tiramusu"), menuNameKey("Tiramisu")), "tek harf yazım farkı");
  assert.ok(similarNames(menuNameKey("Çilekli Magnolia"), menuNameKey("Çilek Magnolia")), "ek almış sözcük");
  assert.ok(similarNames(menuNameKey("Kruvasanlı Hindi Füme Sandviç"), menuNameKey("Hindi Fümeli Sandviç")), "bir sözcük fazla");
  assert.equal(similarNames(menuNameKey("Ice Caramel Latte"), menuNameKey("Latte")), false, "tek sözcüklük ad her uzun ada benzemez");
  assert.equal(similarNames(menuNameKey("Fıstıklı Magnolia"), menuNameKey("Muz Magnolia")), false);
});

/** Sitenin tohum menüsü (laffogato src/components/laffogato/data.ts, MENU_CATEGORY_KEYS sırasıyla mnu-0001…) */
const SITE_SEED: [string, string, string, number, number][] = [
  ["mnu-0001", "Matcha Latte", "matcha", 21500, 0],
  ["mnu-0002", "Çilekli Matcha", "matcha", 24500, 0],
  ["mnu-0003", "Matcha Affogato", "matcha", 24500, 0],
  ["mnu-0004", "L'Affogato", "espresso", 28000, 0],
  ["mnu-0005", "Espresso", "espresso", 11000, 14000],
  ["mnu-0006", "Americano", "espresso", 16500, 18500],
  ["mnu-0007", "Latte", "espresso", 19500, 21000],
  ["mnu-0008", "Flat White", "espresso", 19000, 20000],
  ["mnu-0009", "Mocha", "espresso", 24500, 26500],
  ["mnu-0010", "Cappuccino", "espresso", 19500, 21000],
  ["mnu-0011", "Espresso Macchiato", "espresso", 11500, 0],
  ["mnu-0012", "İspanyol Latte", "espresso", 25000, 27000],
  ["mnu-0013", "Cortado", "espresso", 20000, 0],
  ["mnu-0014", "Beyaz Çikolatalı Mocha", "espresso", 24500, 26500],
  ["mnu-0015", "Karamel Latte", "espresso", 24500, 26500],
  ["mnu-0016", "Tuzlu Karamel Latte", "espresso", 24500, 26500],
  ["mnu-0017", "Toffeenut Latte", "espresso", 25000, 27000],
  ["mnu-0018", "Balkabağı Latte", "espresso", 25000, 27000],
  ["mnu-0019", "Türk Kahvesi", "espresso", 13000, 15000],
  ["mnu-0020", "Filtre Kahve", "espresso", 16500, 18500],
  ["mnu-0021", "Buzlu Chai", "ice-coffee", 21000, 22500],
  ["mnu-0022", "Buzlu Americano", "ice-coffee", 16500, 18500],
  ["mnu-0023", "Buzlu Caffè Latte", "ice-coffee", 19500, 21000],
  ["mnu-0024", "Buzlu Caffè Mocha", "ice-coffee", 24500, 26500],
  ["mnu-0025", "Buzlu Beyaz Çikolatalı Mocha", "ice-coffee", 24500, 26500],
  ["mnu-0026", "Buzlu Tuzlu Karamel Latte", "ice-coffee", 25000, 27000],
  ["mnu-0027", "Buzlu Toffeenut Latte", "ice-coffee", 25000, 27000],
  ["mnu-0028", "Buzlu Balkabağı Latte", "ice-coffee", 25000, 27000],
  ["mnu-0029", "Buzlu İspanyol Latte", "ice-coffee", 25000, 27000],
  ["mnu-0030", "Cold Brew", "ice-coffee", 20000, 22000],
  ["mnu-0031", "Çıtır Latte", "ice-coffee", 25000, 0],
  ["mnu-0032", "Sürpriz İçecek", "cold", 25000, 27000],
  ["mnu-0033", "Cool Lime", "cold", 20000, 22000],
  ["mnu-0034", "L'Af Limon", "cold", 18000, 0],
  ["mnu-0035", "Soda", "cold", 8000, 0],
  ["mnu-0036", "Su", "cold", 6000, 0],
  ["mnu-0037", "Chai Latte", "hot", 23500, 25000],
  ["mnu-0038", "Sıcak Çikolata", "hot", 23000, 25000],
  ["mnu-0039", "Beyaz Sıcak Çikolata", "hot", 24500, 26500],
  ["mnu-0040", "Karamelli Sıcak Çikolata", "hot", 24500, 26500],
  ["mnu-0041", "Salep", "hot", 24500, 26500],
  ["mnu-0042", "Çay", "hot", 6000, 9000],
  ["mnu-0043", "Frappe", "frappe", 25000, 27000],
  ["mnu-0044", "Espresso Frappe", "frappe", 25000, 27000],
  ["mnu-0045", "Mocha Frappe", "frappe", 25000, 27000],
  ["mnu-0046", "Karamel Frappe", "frappe", 25000, 27000],
  ["mnu-0047", "Yaban Mersini", "smoothie", 25000, 27000],
  ["mnu-0048", "Mango", "smoothie", 25000, 27000],
  ["mnu-0049", "Elma", "smoothie", 25000, 27000],
  ["mnu-0050", "Protein Shake", "smoothie", 27000, 0],
  ["mnu-0051", "Çilek", "frozen", 25000, 27000],
  ["mnu-0052", "Frambuaz", "frozen", 25000, 27000],
  ["mnu-0053", "Çarkıfelek", "frozen", 25000, 27000],
  ["mnu-0054", "Ananas", "frozen", 25000, 27000],
  ["mnu-0055", "Limonlu Soğuk Çay", "ice-tea", 24500, 26500],
  ["mnu-0056", "Şeftalili Soğuk Çay", "ice-tea", 24500, 26500],
  ["mnu-0057", "Donostia (L'Af Özel)", "dessert", 16000, 0],
  ["mnu-0058", "San Sebastian", "dessert", 29000, 0],
  ["mnu-0059", "Yaban Mersinli San Sebastian", "dessert", 29500, 0],
  ["mnu-0060", "L'Af Mango", "dessert", 27000, 0],
  ["mnu-0061", "L'Af Kahve", "dessert", 29000, 0],
  ["mnu-0062", "L'Af Antep Fıstığı", "dessert", 30000, 0],
  ["mnu-0063", "Çilek Magnolia", "dessert", 24000, 0],
  ["mnu-0064", "Muz Magnolia", "dessert", 24000, 0],
  ["mnu-0065", "Lotus Magnolia", "dessert", 25000, 0],
  ["mnu-0066", "Marlenka", "dessert", 27000, 0],
  ["mnu-0067", "Klasik Spoonful", "dessert", 22000, 0],
  ["mnu-0068", "Frambuazlı Cheesecake", "dessert", 26000, 0],
  ["mnu-0069", "Limonlu Cheesecake", "dessert", 26000, 0],
  ["mnu-0070", "Brownie", "dessert", 28000, 0],
  ["mnu-0071", "Cookie Aşkı (Dondurmalı)", "dessert", 29000, 0],
  ["mnu-0072", "Tiramisu", "dessert", 28000, 0],
  ["mnu-0073", "Karabuğday Simit", "snack", 9000, 0],
  ["mnu-0074", "Rosbeef Sandviç", "snack", 39000, 0],
  ["mnu-0075", "Hindi Fümeli Sandviç", "snack", 35000, 0],
  ["mnu-0076", "Çıtır Granola Bar (Kenya)", "snack", 15000, 0],
  ["mnu-0077", "Hindistan Cevizli Bar", "snack", 9000, 0],
  ["mnu-0078", "Kakao Protein Bar", "snack", 9000, 0],
  ["mnu-0079", "Koska Fındık", "snack", 9000, 0],
  ["mnu-0080", "Şurup", "extras", 5000, 0],
  ["mnu-0081", "Ekstra Shot", "extras", 5000, 0],
  ["mnu-0082", "Alternatif Süt", "extras", 2500, 0],
];
const SITE_ITEMS: SiteMenuItem[] = SITE_SEED.map(([id, name, categoryKey, priceMinor, priceMinorL], i) =>
  site({ id, name, categoryKey, categoryLabel: categoryKey, priceMinor, priceMinorL, sortOrder: i }),
);

test("eski adlar: her kimlik sitenin tohumunda var ve Türkçeleştirme migration'larındaki eski adı taşır", () => {
  const ids = new Set(SITE_SEED.map(([id]) => id));
  for (const id of Object.keys(SITE_OLD_NAMES)) assert.ok(ids.has(id), id);
  assert.deepEqual(SITE_OLD_NAMES["mnu-0022"], ["Iced Americano", "Ice Americano"]);
  assert.deepEqual(SITE_OLD_NAMES["mnu-0081"], ["Extra Shot"]);
  assert.deepEqual(SITE_OLD_NAMES["mnu-0011"], ["Esp. Macchiato"]);
});

test("öneri: aynı ad, sonra eski İngilizce ad, sonra benzer ad; yuva boya ve kalemin boylarına göre", () => {
  const products = [
    { id: 1, name: "ÇAY", size: "M", price: 60 },
    { id: 2, name: "Çay", size: "L", price: 90 },
    { id: 3, name: "Ice Americano", size: "L", price: 190 },
    { id: 4, name: "Esp. Macchiato", size: "L", price: 115 },
    { id: 5, name: "Tiramusu", size: "Tek", price: 280 },
    { id: 6, name: "Kuzu Kulağı", size: "M", price: 250 },
  ];
  const s = suggestLinks(products, SITE_ITEMS);
  assert.deepEqual(
    s.map((x) => [x.productId, x.siteMenuId, x.slot, x.confidence]),
    [
      [1, "mnu-0042", "M", "exact"],
      [2, "mnu-0042", "L", "exact"],
      [3, "mnu-0022", "L", "known"],
      [4, "mnu-0011", "M", "known"],
      [5, "mnu-0072", "M", "similar"],
    ],
  );
  assert.equal(s[2].siteName, "Buzlu Americano");
  assert.equal(s[2].sitePriceMinor, 18500);
  assert.equal(CONFIDENCE_LABEL.known, "Eski adı");
});

test("öneri: tek boy kalemin tek fiyatı fiyatı tutan satıra; bağlı yuva önerilmez; kalem kimliği ve yuva bir kez", () => {
  const shake = [
    { id: 10, name: "Protein Shake", size: "M", price: 250 },
    { id: 11, name: "Protein Shake", size: "L", price: 270 },
  ];
  assert.deepEqual(
    suggestLinks(shake, SITE_ITEMS).map((x) => [x.productId, x.siteMenuId, x.slot]),
    [[11, "mnu-0050", "M"]],
  );
  // Latte M zaten başka satıra bağlı: yalnız L önerilir
  const latte = [
    { id: 20, name: "Latte", size: "M", price: 195 },
    { id: 21, name: "Latte", size: "L", price: 210 },
  ];
  assert.deepEqual(
    suggestLinks(latte, SITE_ITEMS, [{ siteMenuId: "mnu-0007", slot: "M" }]).map((x) => [x.productId, x.slot]),
    [[21, "L"]],
  );
});

test("öneri: Excel'in 129 ürünü sitenin tohum menüsüne; yanlış eşleşme yok, her yuva bir kez", () => {
  const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
  const products = data.products.map((p, i) => ({ id: i + 1, name: p.name, size: p.size, price: p.price }));
  const s = suggestLinks(products, SITE_ITEMS);
  const keys = s.map((x) => `${x.siteMenuId}:${x.slot}`);
  assert.equal(new Set(keys).size, keys.length, "bir yuvaya bir ürün");
  const of = (name: string, size: string) => {
    const p = products.find((x) => x.name === name && x.size === size)!;
    const hit = s.find((x) => x.productId === p.id);
    return hit ? `${hit.siteMenuId} ${hit.slot} ${hit.confidence}` : null;
  };
  assert.equal(of("Ice Latte", "M"), "mnu-0023 M known");
  assert.equal(of("Ice White Choc. Mocha", "L"), "mnu-0025 L known");
  assert.equal(of("Hot Chocolate", "L"), "mnu-0038 L known");
  assert.equal(of("L'Affogato", "L"), "mnu-0004 M exact", "panelde L, sitede tek boy");
  assert.equal(of("Cortado", "L"), "mnu-0013 M exact");
  assert.equal(of("Syrup", "Tek"), "mnu-0080 M known");
  assert.equal(of("Yaban Mersinli San Sebastian", "Tek"), "mnu-0059 M exact");
  assert.equal(of("Kruvasanlı Hindi Füme Sandviç", "Tek"), "mnu-0075 M similar");
  // Sitede karşılığı olmayanlar önerilmez
  for (const [name, size] of [["Su (cam)", "Tek"], ["Damla Soda", "Tek"], ["Ice Caramel Latte", "M"], ["Kuzu Kulağı", "L"], ["Protein Shake", "M"]] as const) {
    assert.equal(of(name, size), null, `${name} ${size}`);
  }
  assert.ok(s.length >= 110, `öneri sayısı ${s.length}`);
  // Panelde bağlısı olmayan site kalemleri
  const gaps = siteGaps(SITE_ITEMS, s).map((g) => `${g.item.id}:${g.slots.join("")}`);
  assert.ok(gaps.includes("mnu-0036:M"), "Su");
  assert.ok(gaps.includes("mnu-0039:ML"), "Beyaz Sıcak Çikolata");
  assert.ok(!gaps.some((g) => g.startsWith("mnu-0007:")), "Latte'nin iki boyu da önerili");
});

test("liste işareti: bağlı değil, sitede, kopuk, sitede yok, liste henüz alınmadı", () => {
  assert.equal(siteMarker(null, SITE_ITEMS).text, "Bağlı değil");
  const ok = siteMarker({ siteMenuId: "mnu-0007", slot: "L" }, SITE_ITEMS);
  assert.equal(ok.kind, "linked");
  assert.match(ok.title, /Latte · L fiyatı 210 ₺ · Satışta/);
  assert.equal(siteMarker({ siteMenuId: "mnu-0011", slot: "L" }, SITE_ITEMS).kind, "broken");
  assert.equal(siteMarker({ siteMenuId: "mnu-0999", slot: "M" }, SITE_ITEMS).kind, "missing");
  assert.equal(siteMarker({ siteMenuId: "mnu-0007", slot: "M" }, null).kind, "pending");
});

// ---------------------------------------------------------------- Sunucu kuralları (kaynaktan)

test("panel → site: bağlı ürünün fiyatı ve durumu önce siteye, yerel yazım sitenin yanıtından sonra", () => {
  const src = read("src/server/actions/products.ts");
  const price = src.slice(src.indexOf("export async function updateProductPrice"), src.indexOf("async function updatePriceAck"));
  // Tek fiyat yazımı writeSalePrice'tan (önce site; tests/fiyatlar.test.ts sırayı da sınar)
  assert.match(price, /await writeSalePrice\(me, before, p, \{[^}]*consequence: "fiyat değişmedi"/);
  const save = src.slice(src.indexOf("export async function saveRecipe"), src.indexOf("export async function deleteProduct"));
  assert.ok(save.indexOf("checkRecipe(db, data)") < save.indexOf("pushSaleChange("), "panelin denetimleri siteden önce");
  assert.ok(save.indexOf("pushSaleChange(") < save.indexOf("db.transaction("), "saveRecipe: önce site");
  assert.match(save, /applyPushed\(tx, push, before, desired, now\)/);
  // Ürün tablosuna fiyat / active / showOnMenu yazan başka eylem yok (saveRecipe; tek fiyat writeSalePrice'ta, yeni ürün
  // insertProduct'ta)
  const writers = [...src.matchAll(/\.update\(s\.products\)/g)].length;
  assert.equal(writers, 1, "saveRecipe");
  const push = read("src/server/site-menu/push.ts");
  assert.match(push, /if \(!res\.ok\) \{/);
  assert.match(push, /callSite\(secret, "\/api\/panel\/menu", \{ method: "POST", body: JSON\.stringify\(body\) \}\)/);
  assert.match(push, /let body = plan\.body;\s+let res = await post\(body\);/);
});

test("çekme: tek işlemde ve danışma kilidiyle; eski yanıt yenisinin üstüne yazılmaz; durum menu_sync'te", () => {
  const sync = read("src/server/site-menu/sync.ts");
  assert.match(sync, /pg_advisory_xact_lock\(hashtext\('menu-sync'\)\)/);
  // Eski yanıt atlanır; ama panelin saatinden çok ileri (bozuk) bir kayıt çekmeleri durdurmaz
  assert.match(sync, /if \(last > Date\.parse\(list\.now\) && last < Date\.now\(\) \+ 10 \* 60_000\) return null/);
  assert.match(read("src/server/site-menu/push.ts"), /Math\.min\(Date\.parse\(item\.updatedAt\), Date\.now\(\) \+ 60_000\)/);
  assert.match(sync, /const STATE_KEY = "menu_sync"/);
  assert.match(sync, /PAGE_SYNC_INTERVAL_MS = 5 \* 60_000/);
  assert.match(read("src/server/site-link.ts"), /SITE_TIMEOUT_MS = 8000/);
  // Tetikleyiciler: ping, Ürünler sayfası, günlük iş, "Siteyle eşitle"
  assert.match(read("src/app/panel/urunler/page.tsx"), /syncSiteMenu\("page"\)/);
  assert.match(read("src/app/api/cron/gunluk/route.ts"), /syncSiteMenu\("cron"\)/);
  assert.match(read("src/server/actions/site-menu.ts"), /syncSiteMenu\("manual"\)/);
});

test("çekme: boş liste bağlantıları kaldırmaz; bağlantı kapalıyken bağlı ürün değiştirilemez", () => {
  const sync = read("src/server/site-menu/sync.ts");
  const guard = sync.indexOf("if (!list.items.length)");
  assert.ok(guard > 0 && guard < sync.indexOf("applySiteList(tx, list, at, tryAt)"), "boş liste uygulanmadan önce durur");
  assert.match(sync, /Sitenin menüsü boş geldi; bağlantılar korunuyor/);
  const push = read("src/server/site-menu/push.ts");
  assert.ok(push.indexOf('if (plan.kind === "none") return { kind: "local" }') < push.indexOf("if (!secret) throw new UserError(pushFailureMessage({ kind: \"off\" }"), "değişiklik yoksa anahtar sorulmaz");
  // Anahtar yoksa bütün uçlar ve eylemler kapalı (karaoke ile aynı anahtar ve kural)
  assert.match(read("src/server/site-link.ts"), /return v && v\.length >= 32 \? v : null/);
});

test("eylemler yöneticinin; karaoke aynı imzalı istek yardımcısını kullanır", () => {
  const actions = read("src/server/actions/site-menu.ts");
  const exported = [...actions.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
  assert.ok(exported.length >= 5);
  for (const name of exported) {
    const body = actions.slice(actions.indexOf(`export async function ${name}`));
    assert.match(body.slice(0, 400), /await requireAdmin\(\)/, name);
  }
  const karaoke = read("src/server/karaoke/sync.ts");
  assert.match(karaoke, /signedSiteFetch\(secret, url\)/);
  assert.doesNotMatch(karaoke, /AbortSignal\.timeout/);
});

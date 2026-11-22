// Tükendi / Satışa aç (dalga 10 §2.1; docs/SITE-MENU.md › Personel: Tükendi / Satışa aç): Siparişler ekranının Tükenenler
// kartı. Saf kurallar (src/lib/site-menu/sold-out.ts): M ve L tek kalemde birleşir, kopuk / sitede olmayan / bağsız /
// emekli kalem tahtada yok, dört durum (satışta, kartta, kapalı, sonra sitede değişmiş); kaydın geçerliliği sitedeki
// damgaya bağlı; personel yalnız kartın kapattığını açar; ortak tavan ve hız sınırı; Bugün satırı, zil ve sabah
// e-postası (yalnız ad ve süre). Kaynak denetimleri: eylem dosyasının iki exportu ve rolleri, fiyat ve active
// yazılmaz, kayıt damga koşuluna bağlı, açma sitenin canlı listesine bakar, okuyucu ve kart fiyatsız.
// Çalıştırma: npx tsx --test tests/tukendi.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// logic.ts önce: rows-ops.ts onu döngüsel içe aktarır (satır listeleri logic.ts'te kurulur)
import { cafeLines, type DayFacts } from "../src/app/panel/bugun/logic";
import { soldOutLine } from "../src/app/panel/bugun/rows-ops";
import { siteNameDiffers, soldOutHits } from "../src/app/panel/siparisler/sold-out-search";
import {
  capRefusal,
  keepSeen,
  markerValid,
  parseSoldOut,
  pickRow,
  reopenRefusal,
  siteFailureText,
  SOLD_OUT_TEXT,
  soldOutAge,
  soldOutBell,
  soldOutBoard,
  soldOutDigestLine,
  soldOutWhen,
  staffSoldOutCount,
  STAFF_SOLD_OUT_MAX,
  STAFF_TOGGLE_LIMIT,
  toggleRefusal,
  type SoldOutItem,
  type SoldOutMarker,
  type SoldOutRow,
} from "../src/lib/site-menu/sold-out";

import { assertNoCostKeys, assertNoLira, stripComments } from "./helpers/leak-scan";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);
const NOW = tr("2026-10-24T22:30");

const item = (id: string, o: Partial<SoldOutItem> = {}): SoldOutItem => ({
  id,
  name: o.name ?? id,
  categoryLabel: o.categoryLabel ?? "Tatlılar",
  isActive: o.isActive ?? true,
  updatedAt: o.updatedAt ?? "2026-10-24T18:00:00.000Z",
});
let rid = 0;
const row = (siteMenuId: string, o: Partial<SoldOutRow> = {}): SoldOutRow => ({
  id: o.id ?? ++rid,
  name: o.name ?? siteMenuId,
  size: o.size ?? "M",
  siteMenuId,
  siteMenuSlot: o.siteMenuSlot ?? "M",
  link: o.link ?? "ok",
  active: o.active ?? true,
});
const marker = (o: Partial<SoldOutMarker> = {}): SoldOutMarker => ({
  byId: o.byId ?? 7,
  by: o.by ?? "Selin",
  byRole: o.byRole ?? "staff",
  at: o.at ?? tr("2026-10-24T21:40").toISOString(),
  siteUpdatedAt: o.siteUpdatedAt ?? "2026-10-24T18:40:00.000Z",
});

test("soldOutBoard: M ve L tek kalemde; kopuk, sitede olmayan, bağsız ve bütün boyları emekli kalem tahtada yok", () => {
  const items = [
    item("mnu-latte", { name: "Buzlu Caffè Latte", categoryLabel: "Kahveler" }),
    item("mnu-tira"),
    item("mnu-broken"),
    item("mnu-old"),
    item("mnu-free"),
  ];
  const rows = [
    row("mnu-latte", { name: "Ice Latte", size: "M", siteMenuSlot: "M" }),
    row("mnu-latte", { name: "Ice Latte", size: "L", siteMenuSlot: "L" }),
    row("mnu-tira", { name: "Tiramisu", size: "Tek" }),
    row("mnu-broken", { siteMenuSlot: "L", link: "broken" }),
    row("mnu-gone", { link: "missing" }),
    row("mnu-old", { active: false }),
  ];
  const board = soldOutBoard(rows, items, {});
  assert.deepEqual(
    board.map((e) => e.id),
    ["mnu-latte", "mnu-tira"],
  );
  const latte = board[0];
  assert.equal(latte.name, "Ice Latte");
  assert.equal(latte.siteName, "Buzlu Caffè Latte");
  assert.equal(latte.category, "Kahveler");
  assert.deepEqual(latte.sizes, ["M", "L"]);
  assert.equal(latte.state, "on");
  assert.equal(latte.reopenable, true);
  // Tek boy "Tek" yazılmaz
  assert.deepEqual(board[1].sizes, []);
  // Fiyat alanı yok
  assertNoCostKeys(JSON.stringify(board), "tahta");
});

test("soldOutBoard: dört durum (satışta, kartta, kapalı, sonra sitede değişmiş)", () => {
  const items = [
    item("a", { isActive: true }),
    item("b", { isActive: false, updatedAt: "2026-10-24T18:40:00.000Z" }),
    item("c", { isActive: false }),
    item("d", { isActive: false, updatedAt: "2026-10-24T19:30:00.000Z" }),
  ];
  const rows = ["a", "b", "c", "d"].map((id) => row(id));
  const markers = { b: marker(), d: marker() };
  const board = soldOutBoard(rows, items, markers);
  assert.deepEqual(
    board.map((e) => [e.id, e.state]),
    [
      ["a", "on"],
      ["b", "card"],
      ["c", "closed"],
      ["d", "drifted"],
    ],
  );
  assert.deepEqual(board[1].marker, { by: "Selin", at: marker().at, staff: true });
  assert.equal(board[2].marker, null);
  // Sonra sitede değişende kimin kapattığı yazılır (rozet), ama kayıt geçersiz
  assert.equal(board[3].marker?.by, "Selin");
  // Bir boyu pasif kalem açılamaz (açmak emekli boyu da açardı)
  const half = soldOutBoard([row("e", { size: "M" }), row("e", { size: "L", siteMenuSlot: "L", active: false })], [item("e", { isActive: false })], {});
  assert.equal(half[0].state, "closed");
  assert.equal(half[0].reopenable, false);
  assert.deepEqual(half[0].sizes, ["M"]);
});

test("markerValid: kalem kapalı ve sitedeki damga kaydınkiyle aynı", () => {
  const m = marker();
  assert.equal(markerValid(m, item("x", { isActive: false, updatedAt: m.siteUpdatedAt })), true);
  assert.equal(markerValid(m, item("x", { isActive: true, updatedAt: m.siteUpdatedAt })), false);
  assert.equal(markerValid(m, item("x", { isActive: false, updatedAt: "2026-10-24T19:00:00.000Z" })), false);
  assert.equal(markerValid(m, null), false);
  assert.equal(markerValid(null, item("x", { isActive: false })), false);
  assert.equal(markerValid(marker({ siteUpdatedAt: "" }), item("x", { isActive: false, updatedAt: "" })), false);
});

test("pickRow: bağlı, bağlantısı sağlam ve etkin ilk satır; M önce", () => {
  const it = item("x");
  const l = row("x", { siteMenuSlot: "L", size: "L" });
  const m = row("x", { siteMenuSlot: "M", size: "M" });
  assert.equal(pickRow([l, m], it), m);
  assert.equal(pickRow([l, { ...m, active: false }], it), l);
  assert.equal(pickRow([{ ...l, link: "broken" }, { ...m, active: false }], it), null);
  assert.equal(pickRow([row("y")], it), null);
});

test("reopenRefusal: kayıt yok, damga farklı, kardeş satır pasif, yönetici", () => {
  const rows = [row("x"), row("x", { siteMenuSlot: "L", size: "L" })];
  const m = marker();
  const live = item("x", { isActive: false, updatedAt: m.siteUpdatedAt });
  assert.equal(reopenRefusal({ role: "staff", rows, marker: m, live }), null);
  assert.equal(reopenRefusal({ role: "staff", rows, marker: null, live }), SOLD_OUT_TEXT.adminClosed);
  assert.equal(reopenRefusal({ role: "staff", rows, marker: m, live: { ...live, updatedAt: "2026-10-24T19:00:00.000Z" } }), SOLD_OUT_TEXT.adminClosed);
  const half = [rows[0], { ...rows[1], active: false }];
  assert.match(reopenRefusal({ role: "staff", rows: half, marker: m, live }) ?? "", /pasif/);
  assert.match(reopenRefusal({ role: "admin", rows: half, marker: null, live }) ?? "", /pasif/);
  // Yönetici kayıtsız ve damgası farklı kalemi açar
  assert.equal(reopenRefusal({ role: "admin", rows, marker: null, live }), null);
  assert.equal(reopenRefusal({ role: "admin", rows, marker: m, live: { ...live, updatedAt: "2026-10-24T19:00:00.000Z" } }), null);
  // Sitede olmayan kalem
  assert.equal(reopenRefusal({ role: "admin", rows, marker: null, live: null }), SOLD_OUT_TEXT.missing);
});

test("tavan: personelin geçerli kayıtları birlikte sayılır; 10. kabul, 11. ret; yöneticininkiler ve geçersizler sayılmaz", () => {
  const items: SoldOutItem[] = [];
  const markers: Record<string, SoldOutMarker> = {};
  for (let i = 0; i < 9; i++) {
    items.push(item(`s${i}`, { isActive: false, updatedAt: marker().siteUpdatedAt }));
    markers[`s${i}`] = marker({ by: i % 2 ? "Ali" : "Selin" });
  }
  // Yöneticinin kaydı ve sitede sonra açılmış kalemin kaydı sayılmaz
  items.push(item("adm", { isActive: false, updatedAt: marker().siteUpdatedAt }));
  markers.adm = marker({ byRole: "admin", by: "Yönetici" });
  items.push(item("open", { isActive: true, updatedAt: marker().siteUpdatedAt }));
  markers.open = marker();
  assert.equal(staffSoldOutCount(markers, items), 9);
  assert.equal(capRefusal("staff", 9), null, "10. kayıt kabul");
  assert.equal(capRefusal("staff", STAFF_SOLD_OUT_MAX), SOLD_OUT_TEXT.cap, "11. kayıt ret");
  assert.equal(capRefusal("admin", 40), null, "yönetici serbest");
});

test("hız sınırı: kişi başına 10 dakikada 20 işlem, aynı kalemde 3 saniye", () => {
  assert.deepEqual(STAFF_TOGGLE_LIMIT, { calls: 20, windowMs: 600_000, perItemMs: 3_000 });
  const now = NOW.getTime();
  assert.equal(toggleRefusal({ calls: 19, lastAt: null, now }), null);
  assert.equal(toggleRefusal({ calls: 20, lastAt: null, now }), SOLD_OUT_TEXT.tooMany);
  assert.equal(toggleRefusal({ calls: 0, lastAt: new Date(now - 2_000).toISOString(), now }), SOLD_OUT_TEXT.tooSoon);
  assert.equal(toggleRefusal({ calls: 0, lastAt: new Date(now - 3_000).toISOString(), now }), null);
  assert.equal(toggleRefusal({ calls: 0, lastAt: "bozuk", now }), null);
});

test("parseSoldOut: bozuk kayıt boş sayılır, bozuk satır atılır", () => {
  assert.deepEqual(parseSoldOut(null), { items: {}, toggles: {} });
  assert.deepEqual(parseSoldOut({ items: "x" }), { items: {}, toggles: {} });
  const m = marker();
  const got = parseSoldOut({ items: { a: m, b: { by: 3 } }, toggles: { a: m.at, b: 5 } });
  assert.deepEqual(got, { items: { a: m }, toggles: { a: m.at } });
});

test("zaman ve süre: bugün saat, dün 'dün 21:40', daha eskisi gün ve saat; 'saattir' / 'gündür'", () => {
  assert.equal(soldOutWhen(tr("2026-10-24T21:40").toISOString(), NOW), "21:40");
  assert.equal(soldOutWhen(tr("2026-10-23T21:40").toISOString(), NOW), "dün 21:40");
  assert.equal(soldOutWhen(tr("2026-10-20T09:05").toISOString(), NOW), "20 Eki 09:05");
  assert.equal(soldOutAge(tr("2026-10-24T21:40").toISOString(), NOW), "50 dakikadır");
  assert.equal(soldOutAge(tr("2026-10-24T05:30").toISOString(), NOW), "17 saattir");
  assert.equal(soldOutAge(tr("2026-10-22T20:00").toISOString(), NOW), "2 gündür");
});

const facts = (items: { id: string; name: string; by: string; at: string; staff: boolean }[]): DayFacts =>
  ({ now: NOW, role: "staff", ops: { soldOut: { names: items.map((i) => i.name), items } } }) as unknown as DayFacts;

test("Bugün kafede: Tükendi satırı; personelin kaydı 16 saatten eskiyse uyarı rengi ve 'geldiyse satışa açın'", () => {
  const fresh = { id: "a", name: "Tiramisu", by: "Selin", at: tr("2026-10-24T21:40").toISOString(), staff: true };
  const cake = { id: "b", name: "Cheesecake", by: "Ali", at: tr("2026-10-24T22:05").toISOString(), staff: true };
  const line = soldOutLine(facts([fresh, cake]));
  assert.deepEqual(line, { key: "tukendi", text: "Tükendi: Tiramisu, Cheesecake", tone: "info", href: "/panel/siparisler#tukenenler" });
  // "Bugün kafede" kartının sonunda
  const cafe = cafeLines({ karaoke: null, orders: null, configured: true }, NOW.getTime(), [line!]);
  assert.deepEqual(cafe.at(-1), line);
  const old = { ...fresh, at: tr("2026-10-22T20:00").toISOString() };
  assert.deepEqual(soldOutLine(facts([old, cake])), {
    key: "tukendi",
    text: "Tiramisu 2 gündür tükendi: geldiyse satışa açın",
    tone: "warn",
    href: "/panel/siparisler#tukenenler",
  });
  // Yöneticinin kaydı eskise uyarı değil
  assert.equal(soldOutLine(facts([{ ...old, staff: false }]))?.tone, "info");
  assert.equal(soldOutLine(facts([])), null);
});

test("zil (yönetici): en çok 3 ad, kim ve saat; 24 saatten eski kayıt ya da saatte 3 ürün uyarı; yalnız personelin kayıtları", () => {
  const at = (h: string) => tr(`2026-10-24T${h}`).toISOString();
  const items = [
    { id: "mnu-2", name: "Cheesecake", by: "Ali", at: at("22:05"), staff: true },
    { id: "mnu-1", name: "Tiramisu", by: "Selin", at: at("21:40"), staff: true },
  ];
  const bell = soldOutBell(items, NOW);
  assert.deepEqual(bell, {
    id: `tukendi-mnu-1,mnu-2-${at("22:05")}`,
    kind: "info",
    title: "Tükendi: Tiramisu, Cheesecake",
    body: "Personel kapattı: Selin 21:40 · Ali 22:05. Sitede, uygulamada ve QR menüde satışta değil.",
    href: "/panel/siparisler#tukenenler",
  });
  const many = [...items, { id: "mnu-3", name: "Brownie", by: "Ali", at: at("22:10"), staff: true }, { id: "mnu-4", name: "Kurabiye", by: "Ali", at: at("22:12"), staff: true }];
  const b2 = soldOutBell(many, NOW)!;
  assert.equal(b2.kind, "warning", "saatte 3 ürün");
  assert.equal(b2.title, "Tükendi: Tiramisu, Cheesecake, Brownie…");
  const old = soldOutBell([{ ...items[1], at: tr("2026-10-23T20:00").toISOString() }], NOW)!;
  assert.equal(old.kind, "warning", "24 saatten eski");
  assert.equal(soldOutBell([{ ...items[0], staff: false }], NOW), null, "yöneticinin kaydı zil değil");
  assert.equal(soldOutBell([], NOW), null);
  assertNoLira(JSON.stringify(b2), "zil");
});

test("sabah e-postası: yalnız ad, kişi ve süre", () => {
  const items = [
    { id: "a", name: "Tiramisu", by: "Selin", at: tr("2026-10-22T20:00").toISOString(), staff: true },
    { id: "b", name: "Cheesecake", by: "Ali", at: tr("2026-10-24T17:30").toISOString(), staff: true },
    { id: "c", name: "Kurabiye", by: "Yönetici", at: tr("2026-10-24T17:30").toISOString(), staff: false },
  ];
  assert.equal(soldOutDigestLine(items, NOW), "Personelin tükendi yaptığı ürünler: Tiramisu (Selin, 2 gündür), Cheesecake (Ali, 5 saattir)");
  assert.equal(soldOutDigestLine([items[2]], NOW), null);
});

test("site hatası: bağlantıyla ilgili nedenlerde metnin sonuna 'Yöneticiye haber verin.'", () => {
  for (const cause of [{ kind: "off" }, { kind: "http", status: 400 }, { kind: "http", status: 401 }, { kind: "http", status: 404 }, { kind: "http", status: 409 }] as const) {
    assert.equal(siteFailureText("Site isteği reddetti.", cause), "Site isteği reddetti. Yöneticiye haber verin.");
  }
  assert.equal(siteFailureText("Siteye ulaşılamadı; ürün tükendi yapılmadı. Tekrar dene.", { kind: "network" }), "Siteye ulaşılamadı; ürün tükendi yapılmadı. Tekrar dene.");
  assert.equal(siteFailureText("x", { kind: "http", status: 503 }), "x");
  assert.equal(siteFailureText("x", undefined), "x");
  // 409 stale: site bu arada değişti, panel yeniden okuyor; bağlantı hatası değil, yeniden denenir
  assert.equal(siteFailureText("Bu ürün sitede bu arada değişti; ürün tükendi yapılmadı. Panel siteyi yeniden okuyor: birazdan bakıp yeniden dene.", { kind: "http", status: 409, error: "stale" }, "staff"), "Bu ürün sitede bu arada değişti; ürün tükendi yapılmadı. Panel siteyi yeniden okuyor: birazdan bakıp yeniden dene.");
  // Personel bağlantının kurulumuyla ilgili her nedende sabit metni görür (E-64): anahtar adı, imza, sitenin sürümü yok
  assert.equal(siteFailureText("x", { kind: "http", status: 409, error: "single_size" }, "staff"), "Site bağlantısında sorun var; yöneticiye haber verin.");
  // Yazımın zaman aşımı: personel Site menüsüne gönderilmez (o ekran ona kapalı), ne yapacağını görür; yönetici aynı metni
  const slow = "Siteye ulaşılamadı; değişiklik sitede yapılmış olabilir, panelde ürün tükendi yapılmadı. Site menüsünde kontrol et; panel siteyi hemen yeniden okuyor.";
  assert.equal(siteFailureText(slow, { kind: "timeout" }, "staff"), SOLD_OUT_TEXT.siteSlow);
  assert.doesNotMatch(SOLD_OUT_TEXT.siteSlow, /Site menüsü/);
  assert.match(SOLD_OUT_TEXT.siteSlow, /yeniden deneyin\.$/);
  assert.equal(siteFailureText(slow, { kind: "timeout" }, "admin"), slow);
  assert.equal(siteFailureText(slow, { kind: "timeout" }), slow);
});

test("keepSeen: açık kalmış kartın değişmeyen anahtarı veritabanındaki güncel değeri yazar", () => {
  // Kart açılırken QR menüde açıktı, kullanıcı dokunmadı; bu arada personel kapattı: kapalı kalır
  assert.equal(keepSeen(true, true, false), false);
  // Kullanıcı anahtarı değiştirdiyse onun değeri
  assert.equal(keepSeen(false, true, true), false);
  assert.equal(keepSeen(true, false, false), true);
  // Eski istemci (seen yok): gönderilen
  assert.equal(keepSeen(true, undefined, false), true);
});

// ---------------------------------------------------------------- Kaynak denetimleri

test("eylem dosyası: yalnız setSoldOut (requireUser) ve holdSoldOut (requireAdmin); refresh yalnız orada", () => {
  const src = read("src/server/actions/menu-status.ts");
  assert.match(src, /^"use server";/);
  const exports = [...src.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exports, ["setSoldOut", "holdSoldOut"]);
  assert.doesNotMatch(src, /^export (type|interface|\{)/m);
  const set = src.slice(src.indexOf("export async function setSoldOut"), src.indexOf("export async function holdSoldOut"));
  assert.match(set, /await requireUser\(\)/);
  const hold = src.slice(src.indexOf("export async function holdSoldOut"));
  assert.match(hold, /await requireAdmin\(\)/);
  assert.match(src, /SITE_MENU_ID/);
  assert.match(src, /refresh\(\)/);
  // Dönüşte yalnız değişti mi, metin ve ad
  assert.match(src, /return \{ changed: r\.changed, message: r\.message, name: r\.name \};/);
});

test("çekirdek: fiyat ve active yazılmaz; kayıt damga koşuluna bağlı; açma canlı listeye bakar; tavan kilit altında", () => {
  const core = stripComments(read("src/server/site-menu/sold-out-core.ts"));
  assert.match(core, /^import "server-only";/);
  for (const m of core.matchAll(/\.set\(\{([^}]*)\}/g)) {
    assert.doesNotMatch(m[1], /\bprice\b|\bactive\b/, `.set({${m[1]}}) fiyat ya da active yazıyor`);
  }
  assert.match(core, /push\.kind === "pushed" && push\.visibility && push\.item && !push\.item\.isActive && Date\.parse\(push\.item\.updatedAt\) >= startedAt - 5000/);
  assert.match(core, /fetchSiteMenu\(/);
  assert.match(core, /pushSaleChange\(/);
  assert.match(core, /applyPushed\(/);
  // Tavan aynı kilit altında yeniden
  const tx = core.slice(core.indexOf("lockSoldOut(tx)"));
  assert.match(tx, /capRefusal\(/);
  // Hız sınırı İşlem geçmişinden, yalnız personel
  assert.match(core, /SOLD_OUT_ACTIONS\.close, SOLD_OUT_ACTIONS\.open/);
  // Kayıt yalnız canlı listede az önce satıştaysa ve yanıtın damgası o andakinden farklıysa
  assert.match(core, /opts\.liveBefore\?\.isActive && push\.kind === "pushed" && push\.item\?\.updatedAt !== opts\.liveBefore\.updatedAt/);
  // Aynı kalemde Tükendi, Satışa aç ve Kapalı tut sırayla (kalemin danışma kilidi; okuma kilit altında)
  assert.match(core, /pg_advisory_xact_lock\(hashtext\(\$\{`tukendi:\$\{id\}`\}\)\)/);
  for (const fn of ["export async function setSoldOutCore", "export async function holdSoldOutCore"]) {
    const body = core.slice(core.indexOf(fn), core.indexOf("\n}\n", core.indexOf(fn)));
    assert.match(body, /withItemLock\(input\.siteMenuId/, `${fn} kilitsiz`);
  }
});

test("okuyucu ve kart: fiyat alanı yok; kart yalnız okuyucunun tipini alır", () => {
  const reader = read("src/server/data/menu-status.ts");
  assert.match(reader, /^import "server-only";/);
  assertNoCostKeys(reader, "menu-status okuyucusu");
  for (const col of ["price", "cost", "unitCost", "packagePrice", "posStalePrice", "posStaleSince"]) {
    assert.doesNotMatch(reader, new RegExp(`s\\.products\\.${col}\\b`), `okuyucu ${col} seçiyor`);
  }
  // Sitenin kalemi fiyatsız kopyaya indirilir
  assert.match(reader, /toSoldOutItem\(/);
  const card = read("src/app/panel/siparisler/sold-out-card.tsx");
  assert.match(card, /^"use client";/);
  assert.doesNotMatch(stripComments(card), /\bprice|\btl\(/);
  assertNoLira(stripComments(card), "Tükenenler kartı");
  assertNoCostKeys(card, "Tükenenler kartı");
  assert.match(card, /useActionTransition\(\)/);
  assert.match(card, /id="tukenenler"/);
  const lib = read("src/lib/site-menu/sold-out.ts");
  assertNoCostKeys(lib, "sold-out.ts");
});

test("Tükendi işaretle araması: Türkçe harf ve aksan duyarsız, panel ve sitedeki adda (ortak fold)", () => {
  const list = [
    { name: "Ice Latte", siteName: "Iced Caffè Latte" },
    { name: "Sütlü Tatlı", siteName: "Sütlü Tatlı" },
    { name: "Tiramisu", siteName: "Tiramisù" },
    { name: "Çay", siteName: "Çay" },
  ];
  const names = (q: string) => soldOutHits(list, q).map((e) => e.name);
  // Türkçe küçültme "I"yı "ı" yapardı: "ice" Ice Latte'yi bulmazdı
  assert.deepEqual(names("ice"), ["Ice Latte"]);
  assert.deepEqual(names("İce"), ["Ice Latte"]);
  assert.deepEqual(names("ICED"), ["Ice Latte"]);
  assert.deepEqual(names("caffe"), ["Ice Latte"]);
  assert.deepEqual(names("sut"), ["Sütlü Tatlı"]);
  assert.deepEqual(names("sutlu tatli"), ["Sütlü Tatlı"]);
  assert.deepEqual(names("TİRAMİSU"), ["Tiramisu"]);
  assert.deepEqual(names("cay"), ["Çay"]);
  assert.deepEqual(names("  "), list.map((e) => e.name));
  assert.deepEqual(names("kahve"), []);
  // Sitedeki ad yalnız harf ya da aksanla ayrılıyorsa ikinci satır yok
  assert.equal(siteNameDiffers(list[2]), false);
  assert.equal(siteNameDiffers(list[0]), true);
  const card = read("src/app/panel/siparisler/sold-out-card.tsx");
  assert.doesNotMatch(card, /toLocaleLowerCase/);
  assert.match(card, /soldOutHits\(entries, query\)/);
});

test("zil satırı yalnız yönetici dalında; Bugün olgusu iki rolde; sabah e-postası opsDigestLines'tan", () => {
  const bell = read("src/server/bell/ops.ts");
  const fn = bell.slice(bell.indexOf("async function soldOutNotifications"));
  assert.match(fn.slice(0, 400), /if \(user\.role !== "admin"\) return \[\];/);
  assert.match(bell, /soldOutDigestLine\(/);
  const ops = read("src/server/data/today-ops.ts");
  assert.match(ops, /soldOutFacts\(/);
});

test("applyPushed kaydı taşır; saveRecipe gördüğü değerleri kullanır", () => {
  const push = read("src/server/site-menu/push.ts");
  assert.match(push, /carrySoldOutMarker\(tx, prev, item\)/);
  assert.ok(push.indexOf("carrySoldOutMarker(") < push.indexOf("await replaceSnapshotItem(tx, item)"), "kayıt kopya yenilenmeden önce taşınır");
  const products = read("src/server/actions/products.ts");
  assert.match(products, /seenShowOnMenu/);
  assert.match(products, /keepSeen\(data\.showOnMenu, data\.seenShowOnMenu, before\.showOnMenu\)/);
  assert.match(products, /keepSeen\(data\.active, data\.seenActive, before\.active\)/);
  const editor = read("src/app/panel/urunler/[id]/recipe-editor.tsx");
  // Kartın gördükleri (kayıttan, site bağlantısından ve sayfa yenilenince güncellenir; denetim E-11)
  assert.match(editor, /seenShowOnMenu: seen\.showOnMenu/);
  assert.match(editor, /seenActive: seen\.active/);
  assert.match(editor, /seenPrice: seen\.price/);
});

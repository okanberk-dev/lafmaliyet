// Son denetimin (24 Kasım 2026) LafPOS günü boşlukları, saf kurallar ve metinler: personel gün sonundan önce formu
// görmez (rapor LafPOS'tan gelir), Bugün ve zil aynı işi söyler, Pavo'nun alınamadığı günde LafPOS'un kart toplamı
// bilinir, kapanmış adisyondan iade "hazırlanmamış iptal"le karışmaz, otomatik LafPOS gününde personelin "Kaldırılmasını
// iste" düğmesi fotoğraf ↔ LafPOS farkını ele vermez. Veritabanında: tests/lafpos-gun-sonu-tam-db.test.ts (personelin
// yazımı) ve tests/gun-sonu-foto-db.test.ts (güçlü modelin ikinci bakışı).
// Çalıştırma: npx tsx --test tests/son-kontrol.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { dayTasks, eveningCashText, type DayFacts, type DayTask } from "../src/app/panel/bugun/logic";
import { readingBlocksRemoval } from "../src/lib/cash-out-requests";
import { pavoView } from "../src/lib/lafpos/bank-pos";
import { lafposDayDetail } from "../src/lib/lafpos/gun-ayrinti";
import { LAFPOS_CASH_OUT_TEXT, LAFPOS_STAFF_ENTRY_LINE, staffLafposEntryClosed } from "../src/lib/lafpos/cash-moves";
import { LAFPOS_STAFF_BEFORE_DAY_END_TEXT, LAFPOS_STAFF_WRITE_TEXT, staffBeforeLafposDayEnd } from "../src/lib/lafpos/foto";
import type { BankPos, PosDayPush } from "../src/lib/lafpos/day";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const plain = (s: string) => s.replace(/[  ]/g, " ").replace(/⁠/g, "");
const tr = (local: string) => new Date(`${local}:00+03:00`);
const STOCK = { month: "2026-11", counted: 0, total: 40, prevMonth: "2026-10", prevHasData: true, prevCounted: 40, prevTotal: 40 };
const byKey = (tasks: DayTask[]) => Object.fromEntries(tasks.map((t) => [t.key, t])) as Record<string, DayTask>;
const staff = (now: Date, o: Partial<DayFacts> = {}): DayFacts => ({ role: "staff", now, cash: { today: null, yesterday: null, firstDate: null }, waste: { count: 0, zayi: null, ikram: null }, stock: STOCK, ...o });

// ---------------------------------------------------------------- Gün sonundan önce personel

test("personel: LafPOS'un şubesinde, LafPOS gününde, gün sonu gelmeden ve rapor yokken form yerine bilgi", () => {
  const base = { admin: false, branchId: "marina", lafposDay: true, dayEnd: false, hasReport: false };
  assert.equal(staffBeforeLafposDayEnd(base), true);
  assert.equal(staffBeforeLafposDayEnd({ ...base, admin: true }), false, "yönetici formu görür (LafPOS göndermezse yedek)");
  assert.equal(staffBeforeLafposDayEnd({ ...base, branchId: "tuzla" }), false, "ModPOS'ta kalan şube");
  assert.equal(staffBeforeLafposDayEnd({ ...base, lafposDay: false }), false, "geçiş gününden önce");
  assert.equal(staffBeforeLafposDayEnd({ ...base, dayEnd: true }), false, "gün sonu geldi: fotoğraf yolu");
  assert.equal(staffBeforeLafposDayEnd({ ...base, hasReport: true }), false, "elle girilmiş rapor eski yolla");
  assert.match(LAFPOS_STAFF_BEFORE_DAY_END_TEXT, /Günü kapat'a basın; rapor LafPOS'tan gelir, sonra Pavo'nun gün sonu fişinin \(detaylı Z\) fotoğrafını eklersiniz/);
  assert.doesNotMatch(LAFPOS_STAFF_BEFORE_DAY_END_TEXT, /sayıp girin|Z raporundan yazın/);
});

test("Kasa sayfası: personelin bugünü / dünü gün sonundan önce form değil bilgi; alt başlık da aynı işi söyler", () => {
  const page = read("src/app/panel/kasa/page.tsx");
  assert.match(page, /staffBeforeLafposDayEnd\(\{/);
  assert.match(page, /\) : beforeDayEnd \? \(\n\s+<Notice tone="neutral" title="Kasa raporu LafPOS'tan gelecek" text=\{LAFPOS_STAFF_BEFORE_DAY_END_TEXT\} \/>\n\s+\) : \(\n\s+form\n/);
  // LafPOS gününde personelin tek işi en üstte: gün sonu fotoğrafı kartı, sonra bilgi ya da rapor (inceleme: aynı mesaj dört kez)
  assert.match(page, /\{lafposState\.lafpos \? \(\n\s+<>\n\s+\{photoCard\}\n\s+\{waitingLafpos \? \(\n\s+<Notice tone="warn" title=\{LAFPOS_STAFF_NO_COUNT\.title\} text=\{LAFPOS_STAFF_NO_COUNT\.text\} \/>/);
  assert.match(page, /LAFPOS_STAFF_BEFORE_DAY_END_DESCRIPTION/);
  assert.doesNotMatch(page, /form ondan dolar\. Kasadaki nakdi sayıp girin/, "yöneticinin Nasıl çalışır?'ı da otomatik raporu anlatır");
});

test("sunucu: personel LafPOS gününde raporu formdan yazmaz (saveCashReport); metinler", () => {
  const store = read("src/server/cash/report-store.ts");
  assert.match(store, /const lafpos = await staffLafposRefusal\(tx, data\.date, branchId, prev\);\n\s+if \(lafpos\) throw new UserError\(lafpos\);/);
  assert.match(LAFPOS_STAFF_WRITE_TEXT.fresh, /LafPOS'tan gelir/);
  assert.match(LAFPOS_STAFF_WRITE_TEXT.auto, /yalnız yönetici/);
});

test("Bugün: LafPOS gününde akşam satırı Günü kapat'ı ve fotoğrafı söyler, 'kasayı sayıp girin' demez", () => {
  const S = "2026-11-10";
  assert.equal(eveningCashText("LafPOS"), LAFPOS_STAFF_BEFORE_DAY_END_TEXT);
  assert.equal(eveningCashText("ModPOS"), "Kapanışta ModPOS'tan Z raporunu alın, kasadaki nakdi sayıp girin.", "ModPOS değişmez");
  const evening = byKey(dayTasks(staff(tr("2026-11-12T21:00"), { lafposSwitch: S }))).kasa;
  assert.deepEqual([evening.detail, evening.action], [LAFPOS_STAFF_BEFORE_DAY_END_TEXT, "Kasa raporu"]);
  const noon = byKey(dayTasks(staff(tr("2026-11-12T14:00"), { lafposSwitch: S }))).kasa;
  assert.equal(noon.detail, "Kapanışta LafPOS'ta Günü kapat'a basılır; rapor LafPOS'tan gelir.");
  const modpos = byKey(dayTasks(staff(tr("2026-11-12T14:00")))).kasa;
  assert.deepEqual([modpos.detail, modpos.action], ["Kapanışta girilir: Z raporu ve kasa sayımı.", "Kasa raporu"]);
  assert.equal(byKey(dayTasks(staff(tr("2026-11-12T21:00")))).kasa.action, "Raporu gir");
});

test("zil: LafPOS gününde personelin akşam hatırlatması 'kasayı girin' demez", () => {
  const bell = read("src/server/bell/kasa.ts");
  assert.match(bell, /lafpos \? "Kapanışta LafPOS'ta Günü kapat'a basın; rapor LafPOS'tan gelir, sonra Pavo'nun gün sonu fişinin fotoğrafını ekleyin"/);
  assert.doesNotMatch(bell, /Günü kapat'a basın, kasayı girin/);
});

// ---------------------------------------------------------------- Pavo alınamadı

test("Pavo: gün sonu alınamadığı günde LafPOS'un kart toplamı bütün gün kartından (dayCard) görünür", () => {
  const failed: BankPos = {
    status: "failed",
    batchNo: null,
    at: "2026-11-22T21:26:00.000Z",
    pavoCard: null,
    lafposCard: null,
    diff: null,
    acquirers: [],
    message: "Günsonu alınamadı",
    errorCode: "5085",
    batches: [],
    dayCard: 995,
  } as BankPos;
  const rows = Object.fromEntries(pavoView(failed).rows);
  assert.equal(plain(rows["LafPOS kart toplamı"]), "995 ₺");
  assert.equal(rows["Pavo kart toplamı"], "yok");
  assert.equal(pavoView(failed).state, "yok", "karşılaştırma yine yapılamadı");
  // dayCard da yoksa eskisi gibi "yok"
  assert.equal(Object.fromEntries(pavoView({ ...failed, dayCard: null }).rows)["LafPOS kart toplamı"], "yok");
  // Başarılı günde son batch'in LafPOS tutarı (dayCard'a dönmez)
  const ok = { ...failed, status: "ok", lafposCard: 755, pavoCard: 755, diff: 0, batchNo: "279" } as BankPos;
  assert.equal(plain(Object.fromEntries(pavoView(ok).rows)["LafPOS kart toplamı"]), "755 ₺");
});

// ---------------------------------------------------------------- İptal ve iade

test("iptal edilen kalemler: kapanmış adisyondan iade ayrı satırda ('İade'), hazırlanmamış iptalle karışmaz", () => {
  const z = { zNo: 1 } as unknown as PosDayPush["z"];
  const iptal = [
    { posName: "ESPRESSO MEDIUM", siteMenuId: null, slot: "M", qty: 1, listValue: 110, prepared: false, reason: "İade: Soğuk geldi", refund: true },
    { posName: "TÜRK KAHVESİ", siteMenuId: null, slot: "M", qty: 1, listValue: 130, prepared: false, reason: "Vazgeçti", refund: false },
    { posName: "BROWNİE", siteMenuId: null, slot: "M", qty: 1, listValue: 280, prepared: true, reason: "Yanlış ürün", refund: false },
  ] as NonNullable<PosDayPush["iptal"]>;
  const rows = Object.fromEntries(lafposDayDetail({ z, iptal } as Parameters<typeof lafposDayDetail>[0]).sections.find((x) => x.title === "İptal edilen kalemler")!.rows);
  assert.equal(plain(rows["İptal, hazırlanmıştı (zayi)"]), "1 kalem · 280 ₺");
  assert.equal(plain(rows["İptal, hazırlanmamıştı"]), "1 kalem · 130 ₺ · tüketim değil");
  assert.equal(plain(rows["İade (kapanmış adisyondan)"]), "1 kalem · 110 ₺");
  // İade yoksa satır yok (eski gövde, iadesiz gün)
  const none = Object.fromEntries(lafposDayDetail({ z, iptal: iptal.slice(1) } as Parameters<typeof lafposDayDetail>[0]).sections.find((x) => x.title === "İptal edilen kalemler")!.rows);
  assert.equal(none["İade (kapanmış adisyondan)"], undefined);
});

// ---------------------------------------------------------------- Fotoğraf kaldırma

test("fotoğraf kaldırma: otomatik LafPOS gününde personelin düğmesi ve isteği okuma farkına bakmaz (fark yöneticinin)", () => {
  assert.equal(readingBlocksRemoval({ suspicious: 1, staff: true, lafposAuto: true }), false);
  assert.equal(readingBlocksRemoval({ suspicious: 1, staff: true, lafposAuto: false }), true, "elle girilen rapor: eski kural");
  assert.equal(readingBlocksRemoval({ suspicious: 1, staff: false, lafposAuto: true }), true, "yöneticinin onayı farkı görür");
  assert.equal(readingBlocksRemoval({ suspicious: 0, staff: true, lafposAuto: false }), false);
  assert.match(read("src/server/data/cash-out-requests.ts"), /readingBlocksRemoval\(\{ suspicious: suspiciousDiffs\(\[reading\], saved\)\.length, staff: true, lafposAuto \}\)/);
  assert.match(read("src/server/cash-outs/requests.ts"), /readingBlocksRemoval\(\{ suspicious: suspiciousDiffs\(\[reading\], saved\)\.length, staff: o\.staff, lafposAuto: await lafposAutoReportOf\(tx, report\.id\) \}\)/);
});

// ---------------------------------------------------------------- LafPOS günü: harcama ve ikram/zayi LafPOS'tan

test("personel: LafPOS'un şubesinde LafPOS gününde Kasa sayfasından kasadan çıkan ve ikram/zayi eklemez", () => {
  const base = { admin: false, branchId: "marina", lafposDay: true };
  assert.equal(staffLafposEntryClosed(base), true);
  assert.equal(staffLafposEntryClosed({ ...base, admin: true }), false, "yönetici her zaman ekler");
  assert.equal(staffLafposEntryClosed({ ...base, branchId: "tuzla" }), false, "ModPOS'ta kalan şube");
  assert.equal(staffLafposEntryClosed({ ...base, branchId: null }), false, "şubesiz (Tuzla)");
  assert.equal(staffLafposEntryClosed({ ...base, lafposDay: false }), false, "geçiş gününden önce");
  assert.equal(LAFPOS_STAFF_ENTRY_LINE, "LafPOS günü: harcama ve ikram/zayi LafPOS'tan girilir");
  assert.match(LAFPOS_CASH_OUT_TEXT.staffAdd, /LafPOS/);
  assert.match(LAFPOS_CASH_OUT_TEXT.staffAdd, /fiş fotoğraf/i, "gelen satıra fiş eklenebildiğini söyler");
});

test("Kasa sayfası: LafPOS gününde personel ekle düğmeleri yerine kısa satırı görür; fiş fotoğrafı ekle kalır", () => {
  const page = read("src/app/panel/kasa/page.tsx");
  assert.match(page, /const entryClosed = staffLafposEntryClosed\(\{ admin, branchId: view\.till, lafposDay: lafposState\.lafpos, lafposBranch \}\);/);
  assert.match(page, /lafposEntryClosed=\{entryClosed\}/, "kasadan çıkanlar kartı");
  // Zayi / ikram satırı: LafPOS gününde personelde Ekle yok (kısa satır Kasadan çıkanlar kartında, iki kez yazılmaz)
  assert.match(page, /\{entryClosed \? null : \(\n\s+<ButtonLink href=\{`\/panel\/zayi\?gun=\$\{date\}`\}/, "zayi / ikram kartı");
  // Geç rapor görünümü de aynı kuralla
  assert.match(page, /staffLafposEntryClosed\(\{ admin: false, branchId: view\.till, lafposDay: lafposState\.lafpos, lafposBranch \}\)/);
  const outs = read("src/app/panel/kasa/cash-outs.tsx");
  assert.match(outs, /\{lafposEntryClosed \? \(\n\s+<p[^>]*>\n\s+<Info[^>]*\/>\n\s+\{LAFPOS_STAFF_ENTRY_LINE\}\n\s+<\/p>\n\s+\) : canEdit \|\| \(staffActs && locked\) \? \(/);
  // Fiş fotoğrafı ekle (LafPOS satırına da) ekleme kuralından bağımsız
  assert.match(outs, /staffActs && storage && !o\.locked && o\.kind === "harcama" && o\.photoId === null/);
});

test("sunucu: personelin LafPOS gününe ekleme yolu (doğrudan, istek, taşıma) kapıda reddedilir; geri alma ve eski gün listesi", () => {
  const guard = read("src/server/cash-outs/guard.ts");
  assert.match(guard, /if \(target\.op === "ekle" && !target\.restore\) \{/);
  assert.match(guard, /throw new UserError\(LAFPOS_CASH_OUT_TEXT\.staffAdd\)/);
  assert.match(read("src/server/actions/cash-outs.ts"), /\{ op: "ekle", date: d\.date, restore: opts\.restore \}/);
  assert.match(read("src/server/data/cash-out-requests.ts"), /isLafposDay\(d, switchDay\)/, "Eski bir güne ekle LafPOS günlerini göstermez");
});

test("Yardım: personelin kasadan çıkan sorusu LafPOS gününü anlatır", () => {
  const help = plain(read("src/app/panel/yardim/personel/content.tsx"));
  assert.match(help, /LafPOS\s+kullanılmaya\s+başlandıysa\s+kasadan\s+çıkan\s+para\s+LafPOS&apos;ta\s+girilir/);
  assert.match(help, /Kasadan\s+çıkan\s+para\s+da\s+LafPOS&apos;ta\s+girilir/, "Gün içinde: LafPOS günü ayrı");
});

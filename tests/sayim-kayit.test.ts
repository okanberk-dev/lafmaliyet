// Stok sayımında girilen hiçbir sayı sessizce kaybolmasın (denetim 26 Eki 2026 B01): ek kalemlerin imzası, yöneticinin
// kimliğe göre kaydı, formdaki ek kalemlerin tazelenmesi, taslağın "doldurulmuş" işareti, ek kalemleri ve yazarı,
// panel güncellemesinin "Yenile" diye bildirilmesi ve listede de olan ek kalem.
// Çalıştırma: npx tsx --test tests/sayim-kayit.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  countDraftJson,
  countPushReaches,
  draftConflicts,
  extrasBase,
  mergeExtras,
  monthEndCountPush,
  monthEndCountPushes,
  parseCountDraft,
  pastCountReminder,
  pastCountReminders,
  planAdminExtras,
  planStaffExtras,
  restoreDraftExtras,
  restoredPrefilled,
  type SavedExtra,
} from "../src/app/panel/sayim/logic";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const ex = (id: number, name: string, unit: string, qty: number, unitPrice = 0, month = "2026-10"): SavedExtra => ({ id, month, name, unit, qty, unitPrice });

test("ek kalem imzası: ad + birim + miktar, sırasız; fiyat girmez (personel görmez)", () => {
  const a = extrasBase([ex(1, "Peçete", "PAKET", 3, 12.5), ex(2, "Sünger", "ADET", 2)]);
  assert.equal(a, extrasBase([ex(9, " sünger ", "adet", 2, 0), ex(8, "PEÇETE", "paket", 3, 99)]));
  assert.notEqual(a, extrasBase([ex(1, "Peçete", "PAKET", 3, 12.5)]), "başkasının eklediği kalem imzayı değiştirir");
  assert.notEqual(a, extrasBase([ex(1, "Peçete", "PAKET", 4, 12.5), ex(2, "Sünger", "ADET", 2)]));
  assert.equal(extrasBase([]), "");
});

test("yönetici kaydı ayı silmez: kalemler ad + birimle eşlenir, yalnız kaldırılan silinir", () => {
  const existing = [ex(1, "DENETIM yulaf sütü", "LT", 2), ex(2, "Peçete", "PAKET", 3, 12.5)];
  const res = planAdminExtras(existing, [
    { name: "peçete", unit: "paket", qty: 3, unitPrice: 14 },
    { name: "Klips kapak", unit: "KOLİ", qty: 2, unitPrice: 0 },
  ]);
  assert.ok(res.ok);
  assert.deepEqual(res.plan.updates, [{ id: 2, name: "peçete", unit: "PAKET", qty: 3, unitPrice: 14 }]);
  assert.deepEqual(res.plan.inserts, [{ name: "Klips kapak", unit: "KOLİ", qty: 2, unitPrice: 0 }]);
  assert.deepEqual(res.plan.deletes, [1]);
  // Değişmeyen satıra dokunulmaz
  const same = planAdminExtras(existing, [
    { name: "DENETIM yulaf sütü", unit: "LT", qty: 2, unitPrice: 0 },
    { name: "Peçete", unit: "PAKET", qty: 3, unitPrice: 12.5 },
  ]);
  assert.deepEqual(same, { ok: true, plan: { updates: [], deletes: [], inserts: [] } });
  assert.deepEqual(planAdminExtras([], [{ name: "A", unit: "ADET", qty: 1, unitPrice: 0 }, { name: "a ", unit: "adet", qty: 2, unitPrice: 0 }]), {
    ok: false,
    error: '"a" iki kez yazılmış; miktarları tek satırda toplayın.',
  });
});

test("personelin eski listeyle planı başkasının kalemini siler: imza denetimi bu yüzden sunucuda", () => {
  // Denetimdeki gözlem: personel eski listeyi (yalnız Peçete) gönderir, yönetici arada Kağıt havlu eklemiş
  const plan = planStaffExtras([ex(1, "Peçete", "PAKET", 3), ex(2, "Kağıt havlu", "PAKET", 1)], [{ name: "Peçete", unit: "PAKET", qty: 3 }], []);
  assert.ok(plan.ok && plan.plan.deletes.includes(2));
  // Formun gördüğü liste (base) kayıtlıdan farklı: sunucu yazmaz (src/server/data/stock-extras.ts lockExtras)
  assert.notEqual(extrasBase([ex(1, "Peçete", "PAKET", 3)]), extrasBase([ex(1, "Peçete", "PAKET", 3), ex(2, "Kağıt havlu", "PAKET", 1)]));
  const core = read("src/server/data/stock-extras.ts");
  assert.match(core, /pg_advisory_xact_lock\(hashtext\(\$\{`sayim-ek-\$\{month\}-\$\{branch\}`\}\)\)/);
  assert.match(core, /if \(base !== undefined && extrasBase\(existing\) !== base\) \{\s+refresh\(\);\s+throw new UserError\(EXTRAS_CHANGED_MESSAGE\);/);
  assert.match(read("src/server/actions/stock.ts"), /const existing = await lockExtras\(tx, m, sube, b\);\s+const res = planAdminExtras\(existing, data\);/);
  assert.doesNotMatch(read("src/server/actions/stock.ts"), /tx\.delete\(s\.stockExtras\)\.where\(eq\(s\.stockExtras\.month, m\)\)/, "ay toptan silinmez");
  assert.match(read("src/app/panel/sayim/actions.ts"), /const existing = await lockExtras\(tx, m, sube, b\);/);
  assert.doesNotMatch(read("src/server/actions/stock.ts"), /export async function lockExtras|export const EXTRAS/, "use server dosyasında yardımcı yok");
});

type E = { name: string; unit: string; qty: string; unitPrice: string };
const e = (name: string, unit: string, qty: string, unitPrice = ""): E => ({ name, unit, qty, unitPrice });
const same = (a: E, b: E) => a.name.toLocaleUpperCase("tr-TR") === b.name.toLocaleUpperCase("tr-TR") && a.unit === b.unit && a.qty === b.qty && a.unitPrice === b.unitPrice;

test("formdaki ek kalemler tazelenir: başkasının eklediği gelir, dokunulmayan güncellenir, çakışan söylenir", () => {
  const before = [e("Peçete", "PAKET", "3"), e("Sünger", "ADET", "2")];
  // Başkası: Peçete fiyatlandı, Sünger silindi, Yulaf eklendi
  const after = [e("Peçete", "PAKET", "3", "12,5"), e("Yulaf sütü", "LT", "2")];
  const untouched = mergeExtras(before, before, after, same);
  assert.deepEqual(untouched, { extras: [e("Peçete", "PAKET", "3", "12,5"), e("Yulaf sütü", "LT", "2")], conflicts: [] });
  // Ben Peçete'yi 4 yaptım, Sünger'i 5 yaptım, yeni bir satır ekledim
  const mine = [e("Peçete", "PAKET", "4"), e("Sünger", "ADET", "5"), e("Klips", "KOLİ", "1"), e("", "ADET", "")];
  const r = mergeExtras(mine, before, after, same);
  assert.deepEqual(r.extras, [e("Peçete", "PAKET", "4"), e("Sünger", "ADET", "5"), e("Klips", "KOLİ", "1"), e("", "ADET", ""), e("Yulaf sütü", "LT", "2")]);
  assert.deepEqual(r.conflicts, ["Peçete", "Sünger"]);
  // Ben sildim, başkası değiştirdi: silinmiş kalır, söylenir
  const del = mergeExtras([e("Sünger", "ADET", "2")], before, [e("Peçete", "PAKET", "9"), e("Sünger", "ADET", "2")], same);
  assert.deepEqual(del, { extras: [e("Sünger", "ADET", "2")], conflicts: ["Peçete"] });
  // Form tarafı: yeni props gelince birleştirir, kart çakışmayı söyler; kayıt gördüğü listenin imzasını gönderir
  const form = read("src/app/panel/sayim/stock-form.tsx");
  assert.match(form, /if \(syncedExtras !== initialExtras\) \{/);
  assert.match(form, /const merged = mergeExtras\(extras, before, savedExtras, sameExtra\);/);
  assert.match(form, /const base = extrasBase\(initialExtras\);/);
  assert.match(form, /saveStaffStockExtras\(month, clean, base\)/);
});

test("taslak: doldurulmuş işaret, ek kalemler ve yazar; eski düz biçim okunur", () => {
  const json = countDraftJson({ values: { "12": "3,5", "13": "2" }, prefilled: [13], extras: [{ name: "Peçete", unit: "PAKET", qty: "3", unitPrice: "" }], by: "Ayşe" });
  const d = parseCountDraft(json);
  assert.deepEqual(d, {
    values: { "12": "3,5", "13": "2" },
    prefilled: [13],
    extras: [{ name: "Peçete", unit: "PAKET", qty: "3", unitPrice: "" }],
    by: "Ayşe",
    base: null,
    extrasBase: null,
    branch: null,
  });
  assert.deepEqual(parseCountDraft('{"12":"3,5","x":"1","14":5}'), { values: { "12": "3,5" }, prefilled: null, extras: null, by: null });
  assert.deepEqual(parseCountDraft("bozuk"), { values: {}, prefilled: null, extras: null, by: null });
  assert.deepEqual(parseCountDraft(null).values, {});
  // Geri yüklemede doldurulmuş satırlar yeniden işaretlenir (kayıt öncesi denetim sorar)
  const rows = [
    { id: 12, qty: 3.5, prevQty: 3.5, sameUnit: true },
    { id: 13, qty: 2, prevQty: 2, sameUnit: true },
  ];
  assert.deepEqual(restoredPrefilled(d, rows), [13]);
  // Eski düz taslak: geçen ayın miktarına eşit değer doldurulmuş sayılır
  assert.deepEqual(restoredPrefilled(parseCountDraft('{"12":"3,5","13":"2"}'), [...rows, { id: 14, qty: 1, prevQty: 1, sameUnit: false }, { id: 15, qty: 4, prevQty: 3, sameUnit: true }]), [12, 13]);
  const form = read("src/app/panel/sayim/stock-form.tsx");
  assert.match(form, /const filled = restoredPrefilled\(draft, restored\);\s+if \(filled\.length\) setPrefilled/);
  assert.match(form, /prefilled: changedLines\.filter\(\(l\) => prefilled\.has\(l\.id\)\)\.map\(\(l\) => l\.id\),/);
});

test("taslak: temizlenen form bu açılışta yazılan taslağı siler; bant yalnız açılıştaki taslak için, yazanın adıyla", () => {
  const form = read("src/app/panel/sayim/stock-form.tsx");
  assert.match(form, /\} else if \(wroteDraft\.current\) \{\s+window\.localStorage\.removeItem\(draftKey\);/);
  assert.match(form, /if \(openingDraft\.current\?\.key !== draftKey\) openingDraft\.current = \{ key: draftKey, json: readDraft\(draftKey\) \};/);
  assert.match(form, /\{draft\.by && draft\.by !== me \? `\$\{draft\.by\} bu cihazda` : "Bu cihazda"\}/);
  assert.match(read("src/app/panel/sayim/page.tsx"), /me=\{user\.name\}/);
});

test("panel güncellemesi 'bağlantı yok' değil 'Yenile' diye bildirilir; yarım kayıtta sayımın kaydedildiği söylenir", () => {
  const form = read("src/app/panel/sayim/stock-form.tsx");
  assert.match(form, /\} catch \(e\) \{\s+unstable_rethrow\(e\);[\s\S]{0,200}if \(unstable_isUnrecognizedActionError\(e\)\) \{\s+\/\/[^\n]*\n\s+toast\.error\(STALE_TEXT,/);
  assert.match(form, /step\.counts \? "Sayım kaydedildi; ek kalemler kaydedilemedi" : "Kaydedilemedi: bağlantı yok gibi"/);
  assert.match(form, /if \(!res\.ok\) return void toast\.error\(res\.error, \{ duration: 12_000 \}\);\s+step\.counts = true;/);
  for (const f of ["src/app/panel/sayim/add-item.tsx", "src/app/panel/receteler/ingredient-picker.tsx"]) {
    assert.match(read(f), /unstable_isUnrecognizedActionError|toastUnreachable/, f);
  }
});

test("listede de olan ek kalem: uyarılır, geçen aydan taşınmaz", () => {
  const form = read("src/app/panel/sayim/stock-form.tsx");
  assert.match(form, /const carriedExtras = \(\) => prevExtras\.filter\(\(e\) => !listNames\.has\(nameKey\(e\.name\)\)\)/);
  // ux-sade Ek A 190: sonuç başlıkta, ne yapılacağı ikinci satırda
  assert.match(form, /sayım listesinde de var: stok iki kez sayılabilir`\}\s+text="Aynı kalemse miktarı listedeki satıra yazın ve buradan kaldırın\."/);
});

test("Stok sayımı: çıkış uyarısı ortak kancadan (Hızlı sayım 26 Eki 2026'da kaldırıldı)", () => {
  assert.match(read("src/app/panel/sayim/stock-form.tsx"), /const \[leaveHref, setLeaveHref\] = useLeaveGuard\(dirty, MONTH_LEAVE\);/);
  const guard = read("src/components/ui/leave-guard.ts");
  assert.match(guard, /window\.addEventListener\("beforeunload", warn\);/);
  assert.match(guard, /document\.addEventListener\("click", onClick, true\);/);
});

test("ay sonu sayımı hatırlatması: ayın son günü, liste doluysa ve tamamlanmadıysa; adres o ayın sayımı", () => {
  assert.deepEqual(monthEndCountPush("2026-11-30", { counted: 0, total: 72 }), {
    title: "Bugün ay sonu stok sayımı",
    body: "Kapanıştan sonra 72 kalem; sayılmayanın stoğu 0 sayılır",
    url: "/panel/sayim?ay=2026-11",
    tag: "sayim-son-2026-11",
  });
  assert.equal(monthEndCountPush("2026-11-29", { counted: 0, total: 72 }), null, "son gün değil");
  assert.equal(monthEndCountPush("2026-11-30", { counted: 72, total: 72 }), null, "tamam");
  assert.equal(monthEndCountPush("2026-11-30", { counted: 0, total: 0 }), null, "liste boş");
  assert.match(monthEndCountPush("2026-10-31", { counted: 30, total: 72 })!.body, /^Kapanıştan sonra kalan 42 kalemi sayın \(30 \/ 72 sayıldı\)/);
  const push = read("src/server/notify/count-push.ts");
  // Şube şube (denetim 21 Kasım #16): her açık şubenin sayımı, bildirim şubenin alıcılarına
  assert.match(push, /if \(!isLastDayOfMonth\(day\)\) return \{ status: "skip", sent: 0, failed: 0 \};\s+const \{ named, open, counts \} = await countProgressByBranch\(day\.slice\(0, 7\)\);\s+const pushes = monthEndCountPushes\(day, counts, named\);/);
  assert.match(push, /const userIds = branchId \? users\.filter\(\(u\) => countPushReaches\(u\.branchId, branchId, open\)\)\.map\(\(u\) => u\.id\) : undefined;/);
  assert.doesNotMatch(push, /countProgress\(/, "seçimin şubesiyle (günlük işte Tuzla) okunmaz");
});

// Denetim 21 Kasım #16: sayım şube başına; günlük işte şube seçimi yok, Tuzla'ya düşen tek okuma Marina'yı hiç görmüyordu
const tuzla = (counted: number, total = 72) => ({ id: "tuzla", name: "Tuzla", progress: { counted, total } });
const marina = (counted: number, total = 72) => ({ id: "marina", name: "Marina", progress: { counted, total } });

test("ay sonu bildirimi şube şube: yarım şubeye adıyla, adresinde şubesi; tek şubede bugünkü gibi herkese", () => {
  // Tuzla tamam, Marina yarım: yalnız Marina'nın bildirimi (önceden hiç bildirim gitmiyordu)
  assert.deepEqual(monthEndCountPushes("2026-11-30", [tuzla(72), marina(10)], true), [
    {
      branchId: "marina",
      push: {
        title: "Bugün ay sonu stok sayımı · Marina",
        body: "Kapanıştan sonra kalan 62 kalemi sayın (10 / 72 sayıldı); sayılmayanın stoğu 0 sayılır",
        url: "/panel/sayim?ay=2026-11&sube=marina",
        tag: "sayim-son-2026-11-marina",
      },
    },
  ]);
  // İkisi de yarım: iki ayrı bildirim, etiketleri ayrı (biri öbürünün yerine geçmez)
  const both = monthEndCountPushes("2026-11-30", [tuzla(30), marina(0)], true);
  assert.deepEqual(
    both.map((p) => [p.branchId, p.push.title, p.push.tag]),
    [
      ["tuzla", "Bugün ay sonu stok sayımı · Tuzla", "sayim-son-2026-11-tuzla"],
      ["marina", "Bugün ay sonu stok sayımı · Marina", "sayim-son-2026-11-marina"],
    ],
  );
  // Tek şube: şubesiz, herkese, metin ve adres bugünkü gibi
  assert.deepEqual(monthEndCountPushes("2026-11-30", [tuzla(0)], false), [{ branchId: null, push: monthEndCountPush("2026-11-30", { counted: 0, total: 72 })! }]);
  assert.deepEqual(monthEndCountPushes("2026-11-29", [tuzla(0), marina(0)], true), [], "son gün değil");
  assert.deepEqual(monthEndCountPushes("2026-11-30", [tuzla(72), marina(72)], true), [], "ikisi de tamam");
  // Alıcılar: şubesiz (yönetici, bütün şubeler) herkes; şubeli personel yalnız kendi şubesininkini; şubesi kapanmış
  // personelin kilidi kalkmıştır, her şubeninkini alır
  const open = ["tuzla", "marina"];
  assert.equal(countPushReaches(null, "marina", open), true);
  assert.equal(countPushReaches("marina", "marina", open), true);
  assert.equal(countPushReaches("tuzla", "marina", open), false);
  assert.equal(countPushReaches("kapali-sube", "marina", open), true);
});

test("geçen ayın sayımı sabah e-postasında şube şube: yarım her şubenin satırı adıyla", () => {
  // Tuzla tamam, Marina yarım (önceden e-posta hiçbir şey demiyordu)
  assert.deepEqual(pastCountReminders("2026-12-01", [tuzla(72), marina(10)], true), [
    {
      id: "sayim-gecen-2026-11-marina",
      title: "Marina: Kasım 2026 sayımı yarım: 10 / 72",
      body: "Kalanların stoğu 0 sayılır; Kasım 2026 mal maliyeti yüksek çıkar. Ayın 10'una kadar personel de girebilir.",
      href: "/panel/sayim?ay=2026-11&sube=marina",
    },
  ]);
  // İkisi yarım: iki satır; Tuzla'nın kimliği bugünkü gibi
  assert.deepEqual(
    pastCountReminders("2026-12-01", [tuzla(30), marina(0)], true).map((r) => [r.id, r.title]),
    [
      ["sayim-gecen-2026-11", "Tuzla: Kasım 2026 sayımı yarım: 30 / 72"],
      ["sayim-gecen-2026-11-marina", "Marina: Kasım 2026 sayımı girilmedi"],
    ],
  );
  // Tek şube: bugünkü satır
  assert.deepEqual(pastCountReminders("2026-12-01", [tuzla(30)], false), [pastCountReminder("2026-12-01", { counted: 30, total: 72 })!]);
  assert.deepEqual(pastCountReminders("2026-12-11", [tuzla(30), marina(0)], true), [], "pencere geçti");

  // Sunucu: e-posta ve bildirim seçiciden bağımsız, her açık şube kendi kapsamında; açılışı aydan sonra olan şube sayılmaz
  const progress = read("src/server/data/count-progress.ts");
  const byBranch = progress.slice(progress.indexOf("export async function countProgressByBranch"));
  assert.match(byBranch, /const tills = tillBranches\(await listBranches\(\)\);/);
  assert.match(byBranch, /tills\.filter\(\(b\) => !b\.openedOn \|\| b\.openedOn\.slice\(0, 7\) <= month\)/);
  assert.match(byBranch, /withBranchScope\(b\.id, \(\) => countProgress\(month\)\)/);
  assert.match(byBranch, /return \{ named: tills\.length > 1, open: tills\.map\(\(b\) => b\.id\), counts \};/);
  const ops = read("src/server/bell/ops.ts");
  const lines = ops.slice(ops.indexOf("export async function pastCountDigestLines"));
  assert.match(lines, /const prev = await countProgressByBranch\(month\)\.catch\(\(\) => null\);/);
  assert.match(lines, /const counts = prev \? pastCountReminders\(day, prev\.counts, prev\.named\) : \[\];/);
  // Tek yarım şubede o şubenin sayımı, birden çoğunda ayın sayımı
  assert.match(lines, /href: counts\.length === 1 \? counts\[0\]\.href : `\/panel\/sayim\?ay=\$\{month\}`/);
});

test("geçen ayın sayımı yarım: yöneticinin zil ve sabah e-postası satırı ilk 10 günde", () => {
  assert.deepEqual(pastCountReminder("2026-11-03", { counted: 30, total: 72 }), {
    id: "sayim-gecen-2026-10",
    title: "Ekim 2026 sayımı yarım: 30 / 72",
    body: "Kalanların stoğu 0 sayılır; Ekim 2026 mal maliyeti yüksek çıkar. Ayın 10'una kadar personel de girebilir.",
    href: "/panel/sayim?ay=2026-10",
  });
  assert.equal(pastCountReminder("2026-11-03", { counted: 0, total: 72 })!.title, "Ekim 2026 sayımı girilmedi");
  assert.equal(pastCountReminder("2026-11-03", { counted: 72, total: 72 }), null, "tamam");
  assert.equal(pastCountReminder("2026-11-11", { counted: 30, total: 72 }), null, "pencere geçti");
  assert.equal(pastCountReminder("2027-01-02", { counted: 1, total: 5 })!.href, "/panel/sayim?ay=2026-12");
  const ops = read("src/server/bell/ops.ts");
  assert.match(ops, /if \(user\.role !== "admin"\) return \[\];\s+const day = businessDate\(now\);/);
  assert.match(ops, /pastCountNotifications\(user, now\)\.catch\(\(\) => \[\]\),/);
  // Zil Stok sayımı ekranının şubesine bakar (seçili fiziksel şube, "Tümü"de Tuzla); e-posta şube şube (aşağıda)
  assert.match(ops, /const prev = pastCountReminder\(day, await countProgress\(shiftMonth\(day\.slice\(0, 7\), -1\)\)\);/);
  // Sabah e-postası: personelden gelmeyen satır "Personelden" başlığıyla açılmaz (inceleme notu)
  const digest = read("src/server/staff-requests/digest.ts");
  assert.match(digest, /pastCountDigestLines\(now\)/);
  assert.match(digest, /\{ title: "Stok sayımı", lines, href: count\.href \?\? "\/panel\/sayim", link: "Sayımı aç"/);
  // ModPOS kasa föyünün satırları da personelden değil (src/server/bell/modpos.ts modposDigestLines)
  assert.match(digest, /title: count\.lines\.length \|\| modpos\.lines\.length \? "Operasyon" : "Personelden"/);
  // Bugün, zil ve bildirim aynı sayım ilerlemesini okur
  assert.match(read("src/server/data/today.ts"), /import \{ countProgress \} from "@\/server\/data\/count-progress";/);
});

// İnceleme (B01-D1, D4): geri yüklenen taslak, taslaktan sonra başkasının kaydettiğini silmez ya da sessizce ezmez
const de = (name: string, unit: string, qty: string, unitPrice = "") => ({ name, unit, qty, unitPrice });

test("taslağın ek kalemleri listeyi değiştirmez, tabanına göre birleşir: arada kaydedilen kalem kalır", () => {
  // 31 Eki: Ayşe tablette Yulaf sütü yazdı (liste boşken), kaydetmeden sekme düştü; Mehmet telefondan Peçete kaydetti
  const draft = parseCountDraft(countDraftJson({ values: {}, prefilled: [], extras: [de("Yulaf sütü", "LT", "2")], by: "Ayşe", extrasBase: [] }));
  assert.deepEqual(draft.extrasBase, []);
  const r = restoreDraftExtras(draft, [de("Peçete", "ADET", "3")], false);
  assert.deepEqual(r, { extras: [de("Yulaf sütü", "LT", "2"), de("Peçete", "ADET", "3")], conflicts: [], changed: 1 });
  // Tabanı olmayan eski taslak boş listeye dayanmış sayılır: yalnız ekler, kayıtlı kalemi kaldırmaz
  const old = parseCountDraft(JSON.stringify({ v: {}, p: [], e: [de("Yulaf sütü", "LT", "2")], by: "Ayşe" }));
  assert.equal(old.extrasBase, null);
  assert.deepEqual(restoreDraftExtras(old, [de("Peçete", "ADET", "3")], false)?.extras, [de("Yulaf sütü", "LT", "2"), de("Peçete", "ADET", "3")]);
  // Taslağın kendi sildiği kalem silinmiş kalır (başkası değiştirmediyse)
  const removed = parseCountDraft(countDraftJson({ values: {}, prefilled: [], extras: [], by: null, extrasBase: [de("Peçete", "ADET", "3")] }));
  assert.deepEqual(restoreDraftExtras(removed, [de("Peçete", "ADET", "3")], false), { extras: [], conflicts: [], changed: 1 });
  // İki tarafın değiştirdiği kalem: taslaktaki kalır, çakışma olarak söylenir
  const both = parseCountDraft(countDraftJson({ values: {}, prefilled: [], extras: [de("Peçete", "ADET", "5")], by: null, extrasBase: [de("Peçete", "ADET", "3")] }));
  assert.deepEqual(restoreDraftExtras(both, [de("Peçete", "ADET", "4")], false), { extras: [de("Peçete", "ADET", "5")], conflicts: ["Peçete"], changed: 1 });
  // Taslak kayıtlı listeye bir şey katmıyorsa geri yüklenecek ek kalem yok
  assert.equal(restoreDraftExtras(both, [de("Peçete", "ADET", "5")], false), null);
  assert.equal(restoreDraftExtras(parseCountDraft(countDraftJson({ values: {}, prefilled: [], extras: null, by: null })), [de("Peçete", "ADET", "3")], false), null);
});

test("taslağın ek kalem fiyatı: personelde düşer; yöneticide boş fiyat kayıtlı fiyatı alır, yazılan fiyat kalır", () => {
  // Yöneticinin ortak tabletteki taslağını personel açarsa fiyat forma gelmez
  const adminDraft = parseCountDraft(countDraftJson({ values: {}, prefilled: [], extras: [de("Peçete", "ADET", "3", "14,00"), de("Sünger", "ADET", "2", "9,00")], by: "Yönetici", extrasBase: [de("Peçete", "ADET", "3", "12,50")] }));
  const staff = restoreDraftExtras(adminDraft, [de("Peçete", "ADET", "3")], false);
  assert.ok(staff);
  assert.ok(staff.extras.every((e) => e.unitPrice === ""));
  assert.deepEqual(staff.extras.map((e) => e.name), ["Peçete", "Sünger"]);
  // Yönetici: taslakta değişen fiyat kalır
  const admin = restoreDraftExtras(adminDraft, [de("Peçete", "ADET", "3", "12,50")], true);
  assert.deepEqual(admin?.extras, [de("Peçete", "ADET", "3", "14,00"), de("Sünger", "ADET", "2", "9,00")]);
  assert.deepEqual(admin?.conflicts, []);
  // Personelin taslağını (fiyatsız) yönetici açarsa kayıtlı fiyat silinmez, çakışma da sayılmaz
  const staffDraft = parseCountDraft(countDraftJson({ values: {}, prefilled: [], extras: [de("Peçete", "ADET", "4")], by: "Ayşe", extrasBase: [de("Peçete", "ADET", "3")] }));
  assert.deepEqual(restoreDraftExtras(staffDraft, [de("Peçete", "ADET", "3", "12,50")], true), { extras: [de("Peçete", "ADET", "4", "12,50")], conflicts: [], changed: 1 });
});

test("taslağın satırları: taslaktan sonra başkasının kaydettiği satır çakışma olarak işaretlenir", () => {
  const draft = parseCountDraft(countDraftJson({ values: { "7": "6", "8": "2", "9": "1" }, prefilled: [], extras: null, by: "Ayşe", base: { "7": null, "8": 3, "9": 5 } }));
  assert.deepEqual(draft.base, { "7": null, "8": 3, "9": 5 });
  // 7: arada Mehmet 4 kaydetti; 8: kimse dokunmadı; 9: arada silindi
  const saved = new Map<number, number | null>([
    [7, 4],
    [8, 3],
    [9, null],
  ]);
  assert.deepEqual(draftConflicts(draft, [7, 8, 9], (id) => saved.get(id) ?? null), [7, 9]);
  // Tabanı olmayan eski taslak: kayıtlı değeri olan satır çakışma sayılır
  assert.deepEqual(draftConflicts(parseCountDraft('{"7":"6","8":"2"}'), [7, 8], (id) => (id === 7 ? 4 : null)), [7]);
  assert.deepEqual(parseCountDraft('{"v":{},"b":{"1":"x","2":2,"a":1,"3":null}}').base, { "2": 2, "3": null });
});

test("form taslağın tabanını yazar ve geri yüklerken birleştirir (Stok sayımı)", () => {
  const form = read("src/app/panel/sayim/stock-form.tsx");
  assert.match(form, /base: Object\.fromEntries\(changedLines\.map\(\(l\) => \[String\(l\.id\), l\.qty\]\)\),/);
  assert.match(form, /extrasBase: extrasDirty \? savedExtras\.map\(\(e\) => draftRow\(e, isAdmin\)\) : null,/);
  assert.match(form, /const draftExtras = restoreDraftExtras\(/);
  assert.match(form, /if \(stale\.length\) setConflicts\(\(x\) => new Set\(\[\.\.\.x, \.\.\.stale\]\)\);/);
  assert.match(form, /setExtraConflicts\(draftExtras\.conflicts\);/);
  assert.doesNotMatch(form, /setExtras\(draftExtras\.map/, "taslak listeyi topluca değiştirmez");
});

test("ay değişince ?izinsiz= notu düşer (B01-K3)", () => {
  const form = read("src/app/panel/sayim/stock-form.tsx");
  assert.match(form, /const MONTH_OMIT = \["izinsiz"\];/);
  assert.match(form, /sp\.set\("ay", to\);\s+for \(const k of MONTH_OMIT\) sp\.delete\(k\);/);
  assert.match(form, /<MonthPicker months=\{months\} value=\{value\} omit=\{MONTH_OMIT\} \/>/);
  assert.match(read("src/components/panel/month-picker.tsx"), /sp\.set\(param, m\);\s+for \(const k of omit \?\? \[\]\) sp\.delete\(k\);/);
});

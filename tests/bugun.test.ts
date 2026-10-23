// Bugün ekranı: günün işleri rol rol (src/app/panel/bugun/logic.ts), satırların durumu, metni ve adresi, Şimdi / Sonra /
// Tamam bölümleri, başlık, "Bugün kafede", kendiliğinden yenileme ve kasa raporunun "akşam" kuralı (src/lib/cash-report.ts);
// kaynak denetimi: personel yönetici olgularını hiç yüklemez (src/server/data/today.ts).
// Saatler sabit: new Date("2026-10-22T11:00:00Z") Türkiye'de 14:00 (UTC+3).
// Çalıştırma: npx tsx --test tests/bugun.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  businessDayRange,
  cafeLines,
  CASH_FLAGS,
  clip,
  dayContext,
  daySummary,
  dayTasks,
  karaokeToday,
  nextRefreshAt,
  splitTasks,
  WASTE_SUMMARY_MAX,
  type CashLite,
  type DayFacts,
  type DayTask,
} from "../src/app/panel/bugun/logic";
import { businessDate, isCashEvening, trHour } from "../src/lib/cash-report";
import type { KaraokeSessionDTO } from "../src/lib/karaoke/session";
import { HOLDS_HREF } from "../src/lib/price-hold";
import type { UpcomingItem, UpcomingStatus } from "../src/lib/reminders";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** Türkiye saatiyle an: "2026-10-22T14:00" */
const tr = (local: string) => new Date(`${local}:00+03:00`);

const NOON = tr("2026-10-22T14:00");
const EVENING = tr("2026-10-22T21:00");

function report(date: string, o: Partial<CashLite> = {}): CashLite {
  return { date, cashDiff: 0, zTotal: 12400, cash: 3100, card: 9300, submittedByName: "Mehmet", revision: 1, note: null, ...o };
}

/** Sayım: bu ay sayılmadı, geçen ay sayıldı (sayım satırları çıkmasın) */
const STOCK = { month: "2026-10", counted: 0, total: 40, prevMonth: "2026-09", prevHasData: true };

function staff(now: Date, o: Partial<DayFacts> = {}): DayFacts {
  return { role: "staff", now, cash: { today: null, yesterday: null, firstDate: null }, waste: { count: 0, zayi: null, ikram: null }, stock: STOCK, ...o };
}

/** Yönetici: ödeme ve kontrol bekleyen fatura yok, diğer kaynaklar boş */
function admin(now: Date, o: Partial<DayFacts> = {}): DayFacts {
  return { role: "admin", now, cash: { today: null, yesterday: null, firstDate: null }, stock: STOCK, system: [], payments: [], invoices: { review: 0 }, ...o };
}

const keys = (tasks: DayTask[]) => tasks.map((t) => t.key);
const byKey = (tasks: DayTask[]) => Object.fromEntries(tasks.map((t) => [t.key, t])) as Record<string, DayTask>;

function pay(title: string, status: UpcomingStatus, amount: number | null, daysLeft: number): UpcomingItem {
  return { ref: `reminder:${title}`, source: "reminder", sourceId: 1, kind: "odeme", title, detail: null, amount, dueDate: "2026-10-22", daysLeft, status, remindDaysBefore: 3, repeat: "none" };
}

// ---------------------------------------------------------------- Personel

test("1. personel gündüz, hiç rapor yok: zayi ve kasa 'sonra', sıradaki yok, başlık 'Şimdilik iş yok · 2 iş sonra'", () => {
  const tasks = dayTasks(staff(NOON));
  assert.deepEqual(keys(tasks), ["zayi", "kasa"]);
  assert.deepEqual(
    tasks.map((t) => [t.status, t.badge]),
    [
      ["later", "Gün içinde"],
      ["later", "Akşam"],
    ],
  );
  assert.equal(splitTasks(tasks).next, null);
  assert.equal(daySummary(tasks, 0).headline, "Şimdilik iş yok · 2 iş sonra");
  assert.equal(byKey(tasks).kasa.href, "/panel/kasa");
  assert.equal(byKey(tasks).zayi.href, "/panel/zayi");
});

test("2. dünün raporu yok: kasa kullanılmaya başladıysa 'Dünkü kasa raporu' yapılacak ve sıradaki; ilk rapor dünden sonraysa satır yok", () => {
  const tasks = dayTasks(staff(NOON, { cash: { today: null, yesterday: null, firstDate: "2026-10-01" } }));
  const t = byKey(tasks)["kasa-dun"];
  assert.equal(t.status, "todo");
  assert.equal(t.href, "/panel/kasa?gun=2026-10-21");
  assert.equal(t.action, "Dünü gir");
  assert.match(t.detail, /^21 Ekim Çarşamba raporu girilmedi\. Kafe açıktıysa bugün girin; yarın yalnız yönetici girebilir\.$/);
  assert.equal(splitTasks(tasks).next?.key, "kasa-dun");
  // İlk rapor bugün (ya da hiç yok): dün beklenmez
  for (const firstDate of ["2026-10-22", null]) {
    assert.ok(!keys(dayTasks(staff(NOON, { cash: { today: null, yesterday: null, firstDate } }))).includes("kasa-dun"), String(firstDate));
  }
  // Personel dünün gönderilmiş raporunu Bugün'de görmez (yöneticinin satırı)
  assert.ok(!keys(dayTasks(staff(NOON, { cash: { today: null, yesterday: report("2026-10-21"), firstDate: "2026-10-01" } }))).includes("kasa-dun"));
  // Yönetici: daha sonra yalnız yönetici girer
  const a = byKey(dayTasks(admin(NOON, { cash: { today: null, yesterday: null, firstDate: "2026-10-01" } })))["kasa-dun"];
  assert.equal(a.status, "todo");
  assert.equal(a.badge, "Girilmedi");
  assert.equal(a.action, "Raporu gir");
  assert.match(a.detail, /personel bugün de girebilir; daha sonra yalnız siz girersiniz/);
});

test("3. personel 21:00: zayi 'Rapordan önce' ve kasa yapılacak, sıradaki zayi; rapor gönderilince ikisi de tamam", () => {
  const tasks = dayTasks(staff(EVENING, { waste: { count: 2, zayi: "Süt 1 LT", ikram: "2× Latte M" } }));
  const t = byKey(tasks);
  assert.equal(t.zayi.status, "todo");
  assert.equal(t.zayi.badge, "Rapordan önce");
  assert.equal(t.zayi.detail, "2 kayıt · İkram: 2× Latte M · Zayi: Süt 1 LT. Eksik varsa kasa raporundan önce ekleyin.");
  assert.equal(t.kasa.status, "todo");
  assert.equal(t.kasa.detail, "Kapanışta ModPOS'tan Z raporunu alın, kasadaki nakdi sayıp girin.");
  assert.equal(splitTasks(tasks).next?.key, "zayi");
  // Kayıt yoksa
  assert.match(byKey(dayTasks(staff(EVENING))).zayi.detail, /^Bugün kayıt yok\. Atılan ya da ikram edilen olduysa kasa raporundan önce girin\.$/);

  const sent = byKey(dayTasks(staff(EVENING, { cash: { today: report("2026-10-22", { cashDiff: -120 }), yesterday: null, firstDate: "2026-10-01" } })));
  assert.equal(sent.zayi.status, "done");
  assert.equal(sent.zayi.detail, "Bugün kayıt yok.");
  assert.equal(sent.kasa.status, "done");
  assert.equal(sent.kasa.badge, "Gönderildi");
  assert.match(sent.kasa.detail, /^Mehmet gönderdi · 120\s₺ eksik$/);
  assert.equal(sent.kasa.href, "/panel/kasa?gun=2026-10-22");
});

test("4. 01:30 (iş günü dün): kasa satırı iş gününe gider, açıklama tarihle başlar, akşam sayılır", () => {
  const night = tr("2026-10-23T01:30");
  const c = dayContext(night);
  assert.equal(c.today, "2026-10-23");
  assert.equal(c.day, "2026-10-22");
  assert.equal(c.yesterday, "2026-10-21");
  assert.equal(c.evening, true);
  const t = byKey(dayTasks(staff(night)));
  assert.equal(t.kasa.status, "todo");
  assert.match(t.kasa.detail, /^22 Ekim Perşembe · Kapanışta ModPOS'tan/);
  assert.match(t.zayi.detail, /^22 Ekim Perşembe · Bugün kayıt yok/);
  const sent = byKey(dayTasks(staff(night, { cash: { today: report("2026-10-22"), yesterday: null, firstDate: "2026-10-01" } })));
  assert.equal(sent.kasa.href, "/panel/kasa?gun=2026-10-22");
  assert.match(sent.kasa.detail, /^22 Ekim Perşembe · Mehmet gönderdi · Kasa tutuyor$/);
  // Gündüz tarih yazılmaz
  assert.doesNotMatch(byKey(dayTasks(staff(EVENING))).kasa.detail, /Ekim/);
});

// ---------------------------------------------------------------- Yönetici: kasa

test("5. yönetici dünkü rapor: eksik sorun, fazla yapılacak, tutuyorsa tamam; güncellendi ve not açıklamada", () => {
  const row = (o: Partial<CashLite>) => byKey(dayTasks(admin(NOON, { cash: { today: null, yesterday: report("2026-10-21", o), firstDate: "2026-10-01" } })))["kasa-dun"];
  const short = row({ cashDiff: -120 });
  assert.equal(short.status, "warn");
  assert.match(short.badge!, /^120\s₺ eksik$/);
  assert.equal(short.href, "/panel/kasa?gun=2026-10-21");
  assert.equal(short.action, "Rapora bak");
  assert.match(short.detail, /^Mehmet · Z 12\.400\s₺ · nakit 3\.100\s₺ · kart 9\.300\s₺$/);
  const over = row({ cashDiff: 30 });
  assert.equal(over.status, "todo");
  assert.match(over.badge!, /^30\s₺ fazla$/);
  const even = row({ cashDiff: 0.5 });
  assert.equal(even.status, "done");
  assert.equal(even.badge, "Kasa tutuyor");
  const updated = row({ revision: 2, note: "Bozuk para eksik" });
  assert.match(updated.detail, / · güncellendi · Not: Bozuk para eksik$/);
});

test("kasa bütünlüğü (yönetici): açılış devirle tutmuyor ya da ertesi gün düzeltildi satırı 'sorun' yapar ve açıklamaya yazılır", () => {
  const facts = (o: Partial<CashLite>, today: CashLite | null = null) =>
    admin(EVENING, { cash: { today, yesterday: report("2026-10-21", o), firstDate: "2026-10-01" } });
  const carry = byKey(dayTasks(facts({ flags: [CASH_FLAGS.carry] })))["kasa-dun"];
  assert.equal(carry.status, "warn");
  // Kasa tutuyor ama açılış tutmuyor: rozet uyarıyı söyler, fark açıklamada
  assert.equal(carry.badge, "Açılış devirle tutmuyor");
  assert.match(carry.detail, / · Kasa tutuyor · Açılış devirle tutmuyor$/);
  // Ertesi gün düzeltilen rapor: "güncellendi" ayrıca yazılmaz
  const late = byKey(dayTasks(facts({ revision: 3, cashDiff: -50, flags: [CASH_FLAGS.late] })))["kasa-dun"];
  assert.equal(late.status, "warn");
  assert.match(late.badge!, /^50\s₺ eksik$/);
  assert.match(late.detail, / · Ertesi gün düzeltildi$/);
  assert.doesNotMatch(late.detail, /güncellendi/);
  // Bugünün raporu da aynı kuralla
  const today = byKey(dayTasks(facts({}, report("2026-10-22", { flags: [CASH_FLAGS.carry] })))).kasa;
  assert.equal(today.title, "Bugünkü kasa raporu");
  assert.equal(today.status, "warn");
  assert.match(today.detail, /^Mehmet · Z 12\.400\s₺ · Kasa tutuyor · Açılış devirle tutmuyor$/);
  // Uyarı yoksa eskisi gibi
  assert.equal(byKey(dayTasks(facts({})))["kasa-dun"].status, "done");
});

test("yönetici bugünkü kasa: gündüz 'Akşam', 20:00'den sonra girilmedi; okunamazsa dün satırı söyler, bugünkü çıkmaz", () => {
  const day = byKey(dayTasks(admin(NOON))).kasa;
  assert.equal(day.status, "later");
  assert.equal(day.badge, "Akşam");
  assert.equal(day.detail, "Personel kapanışta girer.");
  const evening = byKey(dayTasks(admin(EVENING))).kasa;
  assert.equal(evening.status, "todo");
  assert.equal(evening.badge, "Girilmedi");
  assert.equal(evening.href, "/panel/kasa?gun=2026-10-22");
  const unread = dayTasks(admin(NOON, { cash: null }));
  assert.equal(byKey(unread)["kasa-dun"].status, "later");
  assert.equal(byKey(unread)["kasa-dun"].badge, "Okunamadı");
  assert.equal(byKey(unread)["kasa-dun"].detail, "Kasa raporları şu an okunamadı.");
  assert.ok(!keys(unread).includes("kasa"));
  // Personelde dün satırı "okunamadı" demez; bugünkü der
  const staffUnread = dayTasks(staff(NOON, { cash: null }));
  assert.deepEqual(keys(staffUnread), ["zayi", "kasa"]);
  assert.equal(byKey(staffUnread).kasa.badge, "Okunamadı");
});

// ---------------------------------------------------------------- Sayım

test("6. ay sonu sayımı: son gün başlamadıysa, yarıdaysa, bittiyse; ayın ilk 10 gününde geçen ay; gece yarısından sonra", () => {
  const lastDay = tr("2026-10-31T15:00");
  const end = (counted: number) => byKey(dayTasks(staff(lastDay, { stock: { ...STOCK, counted } })))["sayim-son"];
  assert.equal(end(0).status, "todo");
  assert.equal(end(0).action, "Sayıma başla");
  assert.equal(end(0).href, "/panel/sayim?ay=2026-10");
  assert.equal(end(12).badge, "12 / 40");
  assert.equal(end(12).detail, "12 / 40 kalem sayıldı; kalanları da girin.");
  assert.equal(end(40).status, "done");
  assert.equal(end(40).detail, "40 kalemin hepsi sayıldı.");
  // Ayın öteki günlerinde yok
  assert.ok(!keys(dayTasks(staff(NOON))).includes("sayim-son"));

  const nov = (local: string, prevHasData: boolean, role: "staff" | "admin" = "staff") => {
    const now = tr(local);
    const stock = { month: "2026-11", counted: 0, total: 40, prevMonth: "2026-10", prevHasData };
    return dayTasks(role === "staff" ? staff(now, { stock }) : admin(now, { stock }));
  };
  const prev = byKey(nov("2026-11-03T10:00", false))["sayim-gecen"];
  assert.equal(prev.status, "todo");
  assert.equal(prev.href, "/panel/sayim?ay=2026-10");
  assert.match(prev.detail, /^Ekim 2026 ay sonu sayımı girilmedi/);
  assert.match(byKey(nov("2026-11-03T10:00", false, "admin"))["sayim-gecen"].detail, /^Ekim 2026 sayımı yok: devreden stok 0 sayılır/);
  assert.ok(!keys(nov("2026-11-03T10:00", true)).includes("sayim-gecen"), "geçen ay sayıldı");
  assert.ok(!keys(nov("2026-11-11T10:00", false)).includes("sayim-gecen"), "11. gün");
  // 1 Kasım 00:30: takvim günü ayın son günü değil, geçen ay (Ekim) sayılmadıysa satırı var
  const midnight = keys(nov("2026-11-01T00:30", false));
  assert.ok(!midnight.includes("sayim-son"));
  assert.ok(midnight.includes("sayim-gecen"));
});

// ---------------------------------------------------------------- Yönetici: öteki satırlar

test("7. ödemeler: geciken sorun (bugünkü de anılır), yalnız bugün yapılacak, hiçbiri yoksa tamam (yaklaşan bilgi), okunamadı", () => {
  const row = (payments: UpcomingItem[] | null) => byKey(dayTasks(admin(NOON, { payments }))).odeme;
  const late = row([pay("Kira", "overdue", 30000, -2), pay("SGK", "today", 12000.5, 0)]);
  assert.equal(late.status, "warn");
  assert.equal(late.badge, "1 gecikti");
  assert.match(late.detail, /^1 ödeme gecikti \(30\.000\s₺\)\. Ödendiyse işaretleyin\. Bugün: 1 ödeme \(12\.000,50\s₺\)\.$/);
  const today = row([pay("Elektrik", "today", 800, 0), pay("Su", "today", null, 0), pay("Doğalgaz", "today", 200, 0)]);
  assert.equal(today.status, "todo");
  assert.equal(today.badge, "Bugün");
  assert.match(today.detail, /^3 ödeme bugün \(1\.000\s₺\): Elektrik, Su…$/);
  const none = row([pay("Kira", "soon", 30000, 4), pay("Not", "later", 10, 40)]);
  assert.equal(none.status, "done");
  assert.match(none.detail, /^Bugün ödenecek yok\. Yaklaşan 1 ödeme \(30\.000\s₺\)\.$/);
  assert.equal(row([]).detail, "Bugün ödenecek yok.");
  const unread = row(null);
  assert.equal(unread.status, "later");
  assert.equal(unread.badge, "Okunamadı");
  for (const t of [late, today, none, unread]) assert.equal(t.href, "/panel/hatirlaticilar");
});

test("8. faturalar: kontrol bekleyen yapılacak, yoksa tamam; okunamazsa satır yok; eşitleme hatası bu satırda değil", () => {
  const review = byKey(dayTasks(admin(NOON, { invoices: { review: 3 } }))).fatura;
  assert.equal(review.status, "todo");
  assert.equal(review.badge, "3 kontrol");
  assert.equal(review.href, "/panel/faturalar?durum=kontrol");
  assert.match(review.detail, /^3 fatura kontrol bekliyor: kategorisi tahminle yazıldı/);
  const none = byKey(dayTasks(admin(NOON))).fatura;
  assert.equal(none.status, "done");
  assert.equal(none.detail, "Kontrol bekleyen fatura yok.");
  assert.ok(!keys(dayTasks(admin(NOON, { invoices: null }))).includes("fatura"));
  // Paraşüt'ün hatası "isler" satırında (ops'un sistem uyarıları); fatura satırı eşitlemeyi sormaz
  assert.doesNotMatch(read("src/app/panel/bugun/logic.ts"), /lastStatus|lastOkAt|Eşitleme hatası/);
});

test("isler: günlük işlerin sorunları en üstte 'sorun var', Ayarlar › Günlük işler'e götürür; birden çoksa rozet sayar", () => {
  const one = dayTasks(admin(NOON, { system: [{ title: "Sabah işi çalışmadı", body: "22 Ekim Çarşamba 08:00–09:00 arasında çalışması gerekiyordu" }] }));
  assert.equal(one[0].key, "isler");
  assert.equal(one[0].status, "warn");
  assert.equal(one[0].href, "/panel/ayarlar#isler");
  assert.equal(one[0].badge, undefined);
  assert.equal(one[0].detail, "Sabah işi çalışmadı: 22 Ekim Çarşamba 08:00–09:00 arasında çalışması gerekiyordu.");
  assert.equal(splitTasks(one).next?.key, "isler");
  const two = byKey(
    dayTasks(
      admin(NOON, {
        system: [
          { title: "Sabah işi hata verdi", body: "Veritabanı yanıt vermedi" },
          { title: "Paraşüt işi hata verdi", body: "401" },
        ],
      }),
    ),
  ).isler;
  assert.equal(two.badge, "2 sorun");
  assert.equal(two.detail, "Sabah işi hata verdi: Veritabanı yanıt vermedi. Ayrıca: Paraşüt işi hata verdi.");
  for (const system of [[], null, undefined]) assert.ok(!keys(dayTasks(admin(NOON, { system }))).includes("isler"));
});

test("9. ürün bağlantısı, fiyatı girilmemiş hammadde, reçete onayı, fiyat onayı, zam ve kasa fiyatları yalnız sayı > 0 iken", () => {
  const empty = keys(dayTasks(admin(NOON, { unlinked: 0, unpriced: { count: 0, names: [] }, approvals: { changes: 0, newProducts: 0, names: [] }, holds: { count: 0, items: [] }, prices: null, pos: { count: 0, oldest: null } })));
  for (const k of ["urun", "fiyat-yok", "onay", "fiyat-onay", "zam", "modpos"] as const) assert.ok(!empty.includes(k), k);

  const t = byKey(
    dayTasks(
      admin(NOON, {
        unlinked: 4,
        unpriced: { count: 5, names: ["Çilek şurubu", "Böğürtlen püre", "Klips kapak"] },
        approvals: { changes: 2, newProducts: 1, names: ["Latte", "Mocha", "Çilekli Latte", "Americano"] },
        holds: { count: 2, items: [{ name: "Süt", pct: 0.52 }, { name: "Un", pct: null }] },
        prices: { detail: "Süt +%12. Latte M: maliyet oranı hedefin üstünde, önerilen fiyat hazır. Bu zamlar ayda ≈ 1.200 ₺ kâr götürüyor.", href: "/panel/urunler#zamlar", count: 3 },
        pos: { count: 3, oldest: "2026-10-19T09:00:00.000Z" },
      }),
    ),
  );
  assert.equal(t.urun.badge, "4 bekliyor");
  assert.equal(t.urun.href, "/panel/parasut?durum=bekleyen");
  assert.equal(t["fiyat-yok"].status, "todo");
  assert.equal(t["fiyat-yok"].badge, "5 hammadde");
  assert.equal(t["fiyat-yok"].detail, "Çilek şurubu, Böğürtlen püre, Klips kapak ve 2 hammadde daha · Hammaddeler'den paket fiyatını girin.");
  assert.equal(t["fiyat-yok"].href, "/panel/hammaddeler?durum=fiyatsiz");
  assert.equal(t.onay.badge, "3 bekliyor");
  assert.equal(t.onay.detail, "Personelin önerdiği 2 reçete değişikliği ve 1 yeni ürün önerisi onay bekliyor: Latte, Mocha, Çilekli Latte…");
  assert.equal(t.onay.href, "/panel/onaylar");
  // Fiyat onayı: Genel bakış'taki uyarıyla aynı metin
  assert.equal(t["fiyat-onay"].status, "todo");
  assert.equal(t["fiyat-onay"].href, HOLDS_HREF);
  assert.equal(HOLDS_HREF, "/panel/hammaddeler#fiyat-onayi");
  assert.match(t["fiyat-onay"].detail, /^Faturadaki fiyat şimdikinden %40'tan fazla farklı: Süt \+\u2060?%52, Un\. Onaylanana kadar/u);
  // Zam: priceAlert'in metni olduğu gibi (ayda TL etkisi dahil)
  assert.equal(t.zam.badge, "3 ürün");
  assert.match(t.zam.detail, /ayda ≈ 1\.200 ₺ kâr götürüyor\.$/);
  assert.equal(t.zam.href, "/panel/urunler#zamlar");
  // Kasada değişecek fiyatlar (ModPOS)
  assert.equal(t.modpos.status, "todo");
  assert.equal(t.modpos.badge, "3 fiyat");
  assert.equal(t.modpos.href, "/panel/urunler/fiyatlar?sekme=kasa");
  assert.equal(t.modpos.detail, "Kasada değişecek 3 fiyat: ModPOS'ta elle değiştirip Fiyatlar › Kasaya işle'de işaretleyin. En eskisi 3 gündür bekliyor.");
});

test("yönetici satır sırası: isler, kasa-dun, odeme, fatura, urun, fiyat-yok, onay, fiyat-onay, zam, modpos, sayim-gecen, kasa", () => {
  const now = tr("2026-11-03T21:00");
  const tasks = dayTasks(
    admin(now, {
      system: [{ title: "Sabah işi çalışmadı", body: "…" }],
      cash: { today: null, yesterday: null, firstDate: "2026-10-01" },
      stock: { month: "2026-11", counted: 0, total: 40, prevMonth: "2026-10", prevHasData: false },
      unlinked: 1,
      unpriced: { count: 1, names: ["Klips kapak"] },
      approvals: { changes: 1, newProducts: 0, names: ["Latte"] },
      holds: { count: 1, items: [{ name: "Süt", pct: 0.5 }] },
      prices: { detail: "…", href: "/panel/urunler#zamlar", count: 1 },
      pos: { count: 1, oldest: null },
    }),
  );
  assert.deepEqual(keys(tasks), ["isler", "kasa-dun", "odeme", "fatura", "urun", "fiyat-yok", "onay", "fiyat-onay", "zam", "modpos", "sayim-gecen", "kasa"]);
  // Bölümler sırayı korur: tamamlanan ödeme ve fatura Şimdi'de değil
  const split = splitTasks(tasks);
  assert.deepEqual(keys(split.now), ["isler", "kasa-dun", "urun", "fiyat-yok", "onay", "fiyat-onay", "zam", "modpos", "sayim-gecen", "kasa"]);
  assert.deepEqual(keys(split.done), ["odeme", "fatura"]);
  // Personel sırası
  const staffTasks = dayTasks(
    staff(now, { cash: { today: null, yesterday: null, firstDate: "2026-10-01" }, stock: { month: "2026-11", counted: 0, total: 40, prevMonth: "2026-10", prevHasData: false } }),
  );
  assert.deepEqual(keys(staffTasks), ["kasa-dun", "sayim-gecen", "zayi", "kasa"]);
});

test("personelin olgusuna yönetici bilgisi yanlışlıkla gelse de hiçbir yönetici satırı çıkmaz; tutar ve fiyat yazılmaz", () => {
  const facts = staff(EVENING, {
    system: [{ title: "Sabah işi çalışmadı", body: "…" }],
    payments: [pay("Kira", "overdue", 30000, -2)],
    invoices: { review: 3 },
    unlinked: 4,
    unpriced: { count: 2, names: ["Süt"] },
    approvals: { changes: 2, newProducts: 0, names: ["Latte"] },
    holds: { count: 1, items: [{ name: "Süt", pct: 0.5 }] },
    prices: { detail: "…", href: "/panel/urunler#zamlar", count: 3 },
    pos: { count: 2, oldest: null },
    cash: { today: null, yesterday: report("2026-10-21", { flags: [CASH_FLAGS.carry] }), firstDate: "2026-10-01" },
  });
  const tasks = dayTasks(facts);
  assert.deepEqual(keys(tasks), ["zayi", "kasa"]);
  // Kasa bütünlüğü personelde satırı değiştirmez
  const sent = dayTasks({ ...facts, cash: { today: report("2026-10-22", { flags: [CASH_FLAGS.carry] }), yesterday: null, firstDate: "2026-10-01" } });
  assert.equal(byKey(sent).kasa.status, "done");
  assert.doesNotMatch(byKey(sent).kasa.detail, /devir/);
});

// ---------------------------------------------------------------- Bölümler ve başlık

test("10. bölümler ve başlık: sorun sayısı, hatırlatıcı eki, hepsi tamam", () => {
  const t = (key: DayTask["key"], status: DayTask["status"]): DayTask => ({ key, status, title: key, detail: "", href: "/", action: "" });
  const tasks = [t("kasa-dun", "todo"), t("odeme", "warn"), t("fatura", "done"), t("zayi", "later"), t("kasa", "todo")];
  const s = splitTasks(tasks);
  assert.deepEqual(keys(s.now), ["kasa-dun", "odeme", "kasa"]);
  assert.deepEqual(keys(s.later), ["zayi"]);
  assert.deepEqual(keys(s.done), ["fatura"]);
  // Sıradaki: ilk sorunlu, yoksa ilk yapılacak (sıra değişmez)
  assert.equal(s.next?.key, "odeme");
  assert.equal(splitTasks([t("kasa-dun", "todo"), t("kasa", "todo")]).next?.key, "kasa-dun");
  const sum = daySummary(tasks, 2);
  assert.equal(sum.open, 3);
  assert.equal(sum.warn, 1);
  assert.equal(sum.done, 1);
  assert.equal(sum.total, 5);
  assert.equal(sum.headline, "3 iş bekliyor (1 sorun) · 2 hatırlatıcı");
  assert.equal(daySummary([t("kasa", "todo")], 0).headline, "1 iş bekliyor");
  assert.equal(daySummary([t("kasa", "done"), t("zayi", "done")], 0).headline, "Bugünün işleri tamam");
  assert.equal(daySummary([t("kasa", "done")], 1).headline, "Bugünün işleri tamam · 1 hatırlatıcı");
});

// ---------------------------------------------------------------- Bugün kafede

function session(id: number, local: string, hours: number, o: Partial<KaraokeSessionDTO> = {}): KaraokeSessionDTO {
  const start = tr(local).getTime();
  return {
    id,
    source: "site",
    externalId: `r-${id}`,
    date: local.slice(0, 10),
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + hours * 3_600_000).toISOString(),
    extraMinutes: 0,
    endedAt: null,
    endedBy: null,
    guests: 4,
    customerName: "Ayşe",
    note: null,
    status: "confirmed",
    paymentStatus: "paid",
    totalMinor: 150_000,
    lastEvent: null,
    lastEventAt: null,
    createdBy: null,
    ...o,
  };
}

test("11. karaoke: iş günü aralığı, tutma ve iptal sayılmaz, süren oturum, sıradaki, rezervasyonsuz ayrı", () => {
  const { from, to } = businessDayRange("2026-10-22");
  assert.equal(from.toISOString(), "2026-10-22T02:00:00.000Z");
  assert.equal(to.toISOString(), "2026-10-23T02:00:00.000Z");
  const now = tr("2026-10-22T20:30").getTime();
  const sessions = [
    session(1, "2026-10-22T04:30", 1), // dünkü iş günü
    session(2, "2026-10-22T05:30", 1, { customerName: "Erken" }), // bugünkü, bitti
    session(3, "2026-10-22T20:00", 2, { extraMinutes: 15 }), // süren: bitiş 22:15
    session(4, "2026-10-22T22:30", 1, { guests: 6, customerName: "Mert" }), // sıradaki
    session(5, "2026-10-22T23:30", 1, { status: "requested", paymentStatus: "pending" }), // ödenmemiş tutma
    session(6, "2026-10-22T18:00", 1, { status: "cancelled" }), // iptal
    session(7, "2026-10-22T16:00", 1, { source: "panel", externalId: null, customerName: null, endedAt: tr("2026-10-22T17:05").toISOString() }), // rezervasyonsuz, bitti
    session(8, "2026-10-23T06:00", 1), // yarının iş günü
  ];
  const k = karaokeToday(sessions, "2026-10-22", now);
  assert.equal(k.reservations, 3);
  assert.equal(k.walkIns, 1);
  assert.deepEqual(k.active, { until: "22:15", overtime: false });
  assert.deepEqual(k.next, { time: "22:30", guests: 6, name: "Mert" });
  // Sıradaki değişiklik: süren oturumun bitişi
  assert.equal(k.changeAt, tr("2026-10-22T22:15").getTime());
  // Süresi doldu
  const late = karaokeToday(sessions, "2026-10-22", tr("2026-10-22T22:20").getTime());
  assert.deepEqual(late.active, { until: "22:15", overtime: true });
  // Bitirilmemiş, süresi dolmuş oturum süren oturumdan önce söylenir (bar ekranında alarmı çalıyor)
  const forgotten = karaokeToday([...sessions, session(10, "2026-10-22T18:30", 1)], "2026-10-22", now);
  assert.deepEqual(forgotten.active, { until: "19:30", overtime: true });
  // 01:30'da iş günü hâlâ 22 Ekim: gece yarısından sonra başlayan oturum da o güne sayılır
  const night = karaokeToday([session(9, "2026-10-23T01:00", 1)], "2026-10-22", tr("2026-10-23T01:30").getTime());
  assert.equal(night.reservations, 1);
});

test("11b. kafe satırları: oda, günün sayısı, sıradaki, siparişler; eski sipariş listesi ve bağlantısız kurulum; tutar yok", () => {
  const now = tr("2026-10-22T20:30").getTime();
  const k = karaokeToday([session(3, "2026-10-22T20:00", 2, { extraMinutes: 15 }), session(4, "2026-10-22T22:30", 1, { guests: 6, customerName: "Mert" })], "2026-10-22", now);
  const fresh = { at: new Date(now - 5 * 60_000).toISOString(), open: 2, ready: 1 };
  const lines = cafeLines({ karaoke: k, orders: fresh, configured: true }, now);
  assert.deepEqual(
    lines.map((l) => l.text),
    ["Oda dolu · bitiş 22:15", "Bugün 2 rezervasyon", "Sıradaki 22:30 · 6 kişi · Mert", "2 açık uygulama siparişi · 1 teslime hazır"],
  );
  for (const l of lines) assert.doesNotMatch(l.text, /₺/);
  // 30 dakikadan eski liste: sipariş satırı yok
  const stale = cafeLines({ karaoke: k, orders: { ...fresh, at: new Date(now - 31 * 60_000).toISOString() }, configured: true }, now);
  assert.ok(!stale.some((l) => l.key === "siparis"));
  // Yalnız teslime hazır
  assert.equal(cafeLines({ karaoke: null, orders: { ...fresh, open: 0 }, configured: true }, now)[0].text, "1 uygulama siparişi teslime hazır");
  // Süresi doldu: uyarı tonu
  const over = cafeLines({ karaoke: { ...k, active: { until: "22:15", overtime: true } }, orders: null, configured: true }, now);
  assert.deepEqual(over[0], { key: "oda", text: "Süre doldu: odaya haber verin", tone: "warn" });
  // Bağlantı kurulu, bugün oturum yok
  const empty = karaokeToday([], "2026-10-22", now);
  assert.deepEqual(
    cafeLines({ karaoke: empty, orders: null, configured: true }, now).map((l) => l.text),
    ["Bugün karaoke rezervasyonu yok"],
  );
  // Bağlantı yok ve oturum yok: kart çizilmez
  assert.deepEqual(cafeLines({ karaoke: empty, orders: null, configured: false }, now), []);
  // Bağlantı yok ama bar ekranından açılmış oturum var
  const walkIn = karaokeToday([session(7, "2026-10-22T16:00", 1, { source: "panel", endedAt: tr("2026-10-22T17:00").toISOString() })], "2026-10-22", now);
  assert.deepEqual(
    cafeLines({ karaoke: walkIn, orders: null, configured: false }, now).map((l) => l.text),
    ["Bugün rezervasyon yok · 1 rezervasyonsuz"],
  );
});

// ---------------------------------------------------------------- Saatler

test("12. kendiliğinden yenileme: 14:00 → 20:00, 20:30 → 00:00, 00:30 → 05:00 (Türkiye); daha yakın ek an önce", () => {
  assert.equal(nextRefreshAt(tr("2026-10-22T14:00")), tr("2026-10-22T20:00").getTime());
  assert.equal(nextRefreshAt(tr("2026-10-22T20:30")), tr("2026-10-23T00:00").getTime());
  assert.equal(nextRefreshAt(tr("2026-10-23T00:30")), tr("2026-10-23T05:00").getTime());
  assert.equal(nextRefreshAt(tr("2026-10-22T04:59")), tr("2026-10-22T05:00").getTime());
  // Tam sınırda bir sonraki sınır
  assert.equal(nextRefreshAt(tr("2026-10-22T20:00")), tr("2026-10-23T00:00").getTime());
  const karaokeEnd = tr("2026-10-22T16:15").getTime();
  assert.equal(nextRefreshAt(tr("2026-10-22T14:00"), [karaokeEnd]), karaokeEnd);
  // Geçmiş ya da geçersiz ek an sayılmaz
  assert.equal(nextRefreshAt(tr("2026-10-22T14:00"), [tr("2026-10-22T13:00").getTime(), Number.NaN]), tr("2026-10-22T20:00").getTime());
});

test("13. kasa akşamı ve iş günü: 19:59 değil, 20:00 evet, 04:59 evet, 05:00 değil; businessDate aynı kalır", () => {
  assert.equal(trHour(tr("2026-10-22T19:59")), 19);
  assert.equal(isCashEvening(tr("2026-10-22T19:59")), false);
  assert.equal(isCashEvening(tr("2026-10-22T20:00")), true);
  assert.equal(isCashEvening(tr("2026-10-23T04:59")), true);
  assert.equal(isCashEvening(tr("2026-10-23T05:00")), false);
  assert.equal(businessDate(tr("2026-10-23T04:59")), "2026-10-22");
  assert.equal(businessDate(tr("2026-10-23T05:00")), "2026-10-23");
  assert.equal(businessDate(tr("2026-10-22T00:00")), "2026-10-21");
});

test("14. kısaltma: en çok 140 karakter, kısalınca '…'; zayi özeti de kısalır", () => {
  assert.equal(clip("kısa", 140), "kısa");
  const long = "a".repeat(200);
  assert.equal(clip(long, 140).length, 140);
  assert.ok(clip(long, 140).endsWith("…"));
  assert.equal(clip("x".repeat(140), 140), "x".repeat(140));
  const t = byKey(dayTasks(staff(NOON, { waste: { count: 30, zayi: "Süt 1 LT, ".repeat(30), ikram: null } }))).zayi;
  const summary = t.detail.replace(/^30 kayıt · /, "");
  assert.ok(summary.length <= WASTE_SUMMARY_MAX, String(summary.length));
  assert.ok(summary.endsWith("…"));
  // Kısalmış özetten sonra nokta eklenmez
  const evening = byKey(dayTasks(staff(EVENING, { waste: { count: 30, zayi: "Süt 1 LT, ".repeat(30), ikram: null } }))).zayi;
  assert.match(evening.detail, /… Eksik varsa kasa raporundan önce ekleyin\.$/);
});

// ---------------------------------------------------------------- Kaynak denetimi

/** Kaynakta bir fonksiyonun gövdesi (sonraki üst düzey tanıma kadar) */
function bodyOf(src: string, name: string): string {
  const start = src.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} yok`);
  const rest = src.slice(start + 1);
  const end = rest.search(/\n(export )?(async )?function |\n(export )?(const|interface|type) /);
  return end < 0 ? rest : rest.slice(0, end);
}

test("kaynak: sayfa iki role açık (requireUser); yönetici olguları yalnız adminFacts'te, zayi yalnız staffFacts'te", () => {
  const page = read("src/app/panel/bugun/page.tsx");
  assert.match(page, /await requireUser\(\)/);
  assert.doesNotMatch(page, /requireAdmin/);

  const src = read("src/server/data/today.ts");
  assert.match(src, /^import "server-only";/);
  const admin = bodyOf(src, "adminFacts");
  const staffBody = bodyOf(src, "staffFacts");
  const outside = src.replace(admin, "");
  const ADMIN_ONLY = [
    "loadUpcoming(",
    "loadModel(",
    "loadPriceAlerts(",
    "countUnlinkedProducts(",
    "countPendingRequests(",
    "loadReviewQueue(",
    "pendingHoldSummary(",
    "posPendingSummary(",
    "loadUnpricedIngredients(",
    "loadJobsOverview(",
    "previousCarryOver(",
    "cashRevisionsFor(",
    "needsReview",
  ];
  for (const name of ADMIN_ONLY) {
    assert.ok(admin.includes(name), `${name} adminFacts'te değil`);
    assert.ok(!outside.replace(/^import .*$/gm, "").includes(name), `${name} adminFacts dışında`);
  }
  assert.ok(staffBody.includes("dayWaste("));
  assert.ok(!src.replace(staffBody, "").replace(/^import .*$/gm, "").includes("dayWaste("), "dayWaste staffFacts dışında");
  // Rol seçimi: personel yalnız staffFacts'i çağırır
  assert.match(src, /admin \? adminFacts\(now, user\.id, cashP\) : staffFacts\(c\)/);
  // Zam metni Genel bakış ve zil ile aynı (ayda TL etkisiyle)
  assert.match(admin, /priceAlert\(pa\.changes, pa\.actionable, pa\.loss\.totalLoss\)/);
  // Bugün parasut_sync_runs'ı kendisi sormaz (R4: günlük işlerin sağlığı ops'un modülünden)
  assert.doesNotMatch(src, /parasutSyncRuns/);
});

test("kaynak: her yükleyici safe() ile; bir kaynak düşerse sayfa açılır", () => {
  const src = read("src/server/data/today.ts");
  for (const call of [
    "cashReportsBetween(",
    "firstCashReportDate(",
    "stockProgress(",
    "loadDueReminders(",
    "loadSessions(",
    "dayWaste(",
    "loadUpcoming(",
    "countUnlinkedProducts(",
    "loadUnpricedIngredients(",
  ]) {
    assert.ok(src.includes(`safe(${call}`), `${call} safe() ile değil`);
  }
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const call of ["pendingHoldSummary(", "posPendingSummary(", "loadJobsOverview(", "cash.then(", "Promise.all([readOrdersSnapshot(), readOrdersState()])"]) {
    assert.match(src, new RegExp(`safe\\(\\s*${escape(call)}`), call);
  }
});

test("kaynak: uygulama siparişlerinin tazeliği son başarılı çekmeden (kopya yalnız liste değişince yazılır)", () => {
  const src = read("src/server/data/today.ts");
  assert.match(src, /at: state\.lastOkAt \?\? snapshot\.at/);
  // Yalnız sayılar: ad ve tutar ekrana taşınmaz
  const lite = src.slice(src.indexOf("function ordersLite("), src.indexOf("const toLite"));
  assert.doesNotMatch(lite, /firstName|customer|total|amount/i);
});

test("kaynak: zil Bugün ile aynı akşam kuralına bakar; Bugün canlı veride ve çıkınca yenilenir", () => {
  const bell = read("src/server/actions/notifications.ts");
  assert.match(bell, /if \(!isCashEvening\(now\) \|\| reports\.some\(\(r\) => r\.date === day\)\) return \[\];/);
  assert.doesNotMatch(bell, /hour < 20/);
  assert.match(read("src/components/panel/live/alert-center.tsx"), /p\.startsWith\("\/panel\/bugun"\)\) router\.refresh\(\)/);
  assert.match(read("src/components/panel/sidebar.tsx"), /prev\.startsWith\("\/panel\/bugun"\)/);
  // Ekran kendisi de yenilenir: saat sınırında, sekme uzun gizli kalınca ve geri tuşuyla dönülünce (Activity korunan
  // eski çizimi gösterir)
  const refresh = read("src/app/panel/bugun/today-refresh.tsx");
  for (const re of [/at - liveNow\(\)/, /visibilitychange/, /shownAgain/]) assert.match(refresh, re);
});

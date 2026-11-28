// Personele kör sayımlı WhatsApp metni (sahibin isteği, 28 Kasım 2026: "WhatsApp kopyala gitmiş ladmin'de, o olsun";
// docs/ASILPOS.md › Kör kasa): personelin AsilPOS gününde Kasa raporu kartı "WhatsApp ile gönder" ve "Metni kopyala"yı
// yine verir, metin sayımsızdır (whatsappText `blind`): açılış, sayılan nakit, teslim, olması gereken, kasa farkı ve
// ertesi güne devir yok. Yöneticinin ve ModPOS gününün metni bayt bayt eskisi gibi (altın dosya
// tests/fixtures/whatsapp-metni.golden.json değişiklikten önceki koddan yazıldı). Sunucu eylemi (cashReportWhatsapp)
// tests/roller-db.test.ts'te.
// Çalıştırma: npx tsx --test tests/whatsapp-kor.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { cashReportText, carryCheck, revisionChanges, whatsappText, type CarryCheck, type CashReportFields } from "../src/lib/cash-report";
import type { AsilposDiff } from "../src/lib/asilpos/diffs";
import { staffAutoNote } from "../src/lib/asilpos/foto";
import { asilposOpeningNote, autoNote } from "../src/lib/asilpos/gun-sonu";
import { BLIND_TEXT, blindReport } from "../src/lib/asilpos/kor-kasa";
import type { PhotoDiff } from "../src/lib/photo-read/kasa";

const plain = (t: string) => t.replace(/ /g, " ");

const DATE = "2026-11-27";
/** Otomatik raporun notu gerçek üreticiden: AsilPOS'un beklediği açılış, kapanış notu ve yöneticinin eksik yönergesi */
const NOTE = autoNote({
  gaps: ["Banka POS: AsilPOS'tan Pavo gün sonu gelmedi"],
  carry: null,
  opening: asilposOpeningNote({ expectedOpening: 1_199, openingDiff: 35, openingReason: "bozuk para" }, false),
  closeNote: "sakin geçti",
});
/**
 * Ayırt edilen tutarlar: açılış 1.234, sayılan 5.678, teslim 4.321; olması gereken 1.234 + 6.010 + 55 − 420 = 6.879,
 * fark 5.678 − 6.879 = 1.201 eksik, devir 5.678 − 4.321 = 1.357
 */
const report: CashReportFields & { cashDiff: number; handedToName: string | null } = {
  date: DATE,
  zNo: "4242",
  receipts: 57,
  zTotal: 9_870,
  cash: 6_010,
  card: 3_860,
  mealCard: 0,
  online: 0,
  other: 0,
  openingCash: 1_234,
  cashIn: 55,
  cashOut: 420,
  cashOutNote: null,
  countedCash: 5_678,
  handedOver: 4_321,
  handedToName: "Ali",
  bankPos: null,
  offRevenue: null,
  discounts: 30,
  note: NOTE,
  cashDiff: -1_201,
};
const carry = carryCheck(DATE, report.openingCash, { date: "2026-11-26", amount: 1_199 })!;
const next: CarryCheck = { date: "2026-11-28", prevDate: DATE, carry: 1_357, opening: 1_300, diff: -57, gapDays: 0 };
const changes = revisionChanges({ ...report, countedCash: 5_600, countedByName: "Ayşe" }, { ...report, countedByName: "Ayşe" });
const asilposDiffs: AsilposDiff[] = [
  { field: "countedCash", label: "Sayılan nakit", saved: 5_678, asilpos: 5_600 },
  { field: "cashOut", label: "Gün içinde çıkan", saved: 420, asilpos: 440 },
];
const photoDiffs: PhotoDiff[] = [{ field: "zTotal", label: "Toplam satış", photo: 9_880, saved: 9_870, confidence: "high", excused: false }];
const meta = {
  by: "Ali",
  countedBy: "Ayşe",
  revision: 2,
  branchName: "Marina",
  waste: { ikram: "2× Latte", zayi: "Süt 1 LT" },
  photos: { z: false, okc: true, pos: false },
  photoDiffs,
  cashOuts: [
    { kind: "harcama" as const, amount: 150, store: "Bim", description: "süt", photo: true },
    { kind: "teslim" as const, amount: 270, store: null, description: null, photo: false },
  ],
  unreceipted: 100,
  carry,
  next,
  changes,
};
const asilposMeta = { ...meta, kasa: "AsilPOS" as const, asilposDiffs };

/** Sayımı ele veren rakamlar (metindeki biçimiyle ve çıplak): açılış, sayılan, teslim, olması gereken, fark, devir, önceki devir, ertesi günün açılışı, eski sayılan */
const SECRETS = ["1.234", "5.678", "4.321", "6.879", "1.201", "1.357", "1.199", "1.300", "5.600", "1234", "5678", "4321", "6879", "1201", "1357"];
/** Sayımın sözcükleri */
const WORDS = ["Kasa farkı", "Açılış", "Sayılan", "olması gereken", "Olması gereken", "Ertesi güne devir", "Teslim edilen", "Kasa tutuyor", "EKSİK", "FAZLA", "Önceki devir", "Değişen", "Fişsiz", "beklenen"];

test("kör metin: açılış, sayılan, teslim, olması gereken, fark ve devir yok; satış, Z no ve kör sayım cümlesi var", () => {
  const t = plain(whatsappText(report, asilposMeta, { blind: true }));
  for (const v of SECRETS) assert.ok(!t.includes(v), `kör metinde ${v} var:\n${t}`);
  for (const w of WORDS) assert.ok(!t.includes(w), `kör metinde "${w}" var:\n${t}`);
  // Personelin dökümünde görünenler kalır (CashBreakdown blind ve kayıtlı rapor kartı)
  for (const s of [
    "*L'Affogato · Gün sonu kasa raporu KR-20261127 · Marina* (güncellendi)",
    "27 Kasım Cuma · Ali · sayan Ayşe",
    "Z no: 4242 · 57 fiş",
    "📷 banka POS Z fotoğrafı panelde",
    "*AsilPOS gün sonu (Z)*",
    "Toplam satış: 9.870 ₺",
    "• Nakit: 6.010 ₺",
    "• Kredi / banka kartı: 3.860 ₺",
    "• İndirim: 30 ₺",
    "*Kasa (nakit)*\nNakit satış: 6.010 ₺\n+ Gün içinde giren: 55 ₺\n− Gün içinde çıkan: 420 ₺\n  · Bim (süt) 150 ₺ 📷\n  · Teslim 270 ₺\n" + BLIND_TEXT.breakdown,
    "*Zayi & ikram*\nİkram: 2× Latte\nZayi: Süt 1 LT",
  ]) {
    assert.ok(t.includes(s), `kör metinde "${s}" yok:\n${t}`);
  }
  // AsilPOS'tan farklı yazılanlardan yalnız sayıma ait olmayan kalır (kartta da personel yalnız onu görür)
  assert.ok(t.includes("⚠️ AsilPOS'tan farklı yazılan: Gün içinde çıkan 420 ₺ (AsilPOS'ta 440 ₺)\n"), `AsilPOS'tan farklı satırı:\n${t}`);
  // Fotoğraf farkı çağıranın süzdüğü gibi geçer (otomatik raporda sayfa ve eylem staffPhotoDiffs ile boşaltır)
  assert.ok(t.includes("⚠️ Fotoğraftan farklı yazılan: Toplam satış (fotoğrafta 9.880 ₺)"), `fotoğraf farkı:\n${t}`);
});

test("kör metin: not personelin gördüğü gibi (açılış cümleleri çıkar, yönetici yönergesi kısa satır)", () => {
  const t = plain(whatsappText(report, asilposMeta, { blind: true }));
  const expected = "Not: AsilPOS gün sonundan otomatik yazıldı. Kapanış notu (AsilPOS): sakin geçti. Banka POS henüz gelmedi; yönetici ilgileniyor.";
  assert.ok(t.endsWith(expected), `notun satırı:\n${t}`);
  // Kayıtlı rapor kartının dökümü aynı notu gösterir (sayfa sayımsız raporu verir, kart staffAutoNote uygular)
  assert.equal(`Not: ${staffAutoNote(blindReport(report).note, report)}`, expected, "kartın notuyla aynı");
  // Not yalnız açılış cümlesiyse satır hiç yok; Banka POS geldiyse "henüz gelmedi" yok
  const onlyOpening = plain(whatsappText({ ...report, note: "Açılış notu (AsilPOS): bozuk para." }, asilposMeta, { blind: true }));
  assert.ok(!onlyOpening.includes("Not:"), `yalnız açılış cümlesi kalmamalı:\n${onlyOpening}`);
  const bank = plain(whatsappText({ ...report, bankPos: 3_860 }, asilposMeta, { blind: true }));
  assert.ok(!bank.includes("henüz gelmedi") && !bank.includes("Eksik:"), `Banka POS gelince yönerge satırı yok:\n${bank}`);
  // Kart bölümü kalır (kart farkı sayıma ait değil)
  assert.ok(bank.includes("*Kart*\nBanka POS: 3.860 ₺ ✅ AsilPOS ile aynı"), `kart bölümü:\n${bank}`);
});

test("kör metin: sayfanın sayımsız raporuyla da aynı (blindReport iki kez süzmez)", () => {
  assert.equal(whatsappText(blindReport(report), asilposMeta, { blind: true }), whatsappText(report, asilposMeta, { blind: true }), "sayımsız rapor ve tam rapor aynı metni verir");
  // Kör metin yönetici okuruyla istense de sayımsız ve fişsiz çıkışsız
  const admin = plain(cashReportText(report, asilposMeta, "admin", { blind: true }));
  for (const v of [...SECRETS, "Fişsiz"]) assert.ok(!admin.includes(v), `kör metinde ${v} var:\n${admin}`);
});

test("yöneticinin ve ModPOS gününün metni eskisi gibi (değişiklikten önceki altın metin)", () => {
  const golden = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/whatsapp-metni.golden.json"), "utf8")) as Record<string, string>;
  assert.equal(whatsappText(report, meta), golden.modposStaff, "ModPOS günü, WhatsApp");
  assert.equal(cashReportText(report, meta, "admin"), golden.modposAdmin, "ModPOS günü, e-postanın metni");
  assert.equal(cashReportText(report, asilposMeta, "admin"), golden.asilposAdmin, "AsilPOS günü, yöneticinin metni");
  assert.equal(whatsappText(report, asilposMeta), golden.asilposStaff, "AsilPOS günü, kör olmayan okur (yönetici WhatsApp'ı)");
  assert.equal(whatsappText(report, meta, { blind: false }), golden.modposStaff, "blind: false eskisi gibi");
  // Altın metin sayımı taşır (sınama boş geçmesin)
  assert.match(plain(golden.asilposAdmin), /Açılış \(devir\): 1\.234 ₺[\s\S]*Sayılan: 5\.678 ₺\n🔴 \*1\.201 ₺ EKSİK\*/);
});

test("Kasa raporu kartı: personelin AsilPOS gününde WhatsApp ile gönder ve Metni kopyala var, Düzenle ve silme isteği yok; yönetici eskisi gibi", async () => {
  // Formun dosyası sunucu eylemlerini ve yönlendiriciyi içe aktarır ("server-only" Next dışında hata fırlatır)
  const require = createRequire(import.meta.url);
  const stub = (id: string, exports: unknown) => {
    const p = require.resolve(id);
    require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
  };
  stub("server-only", {});
  stub("next/navigation", { ...require("next/navigation"), useRouter: () => ({ refresh() {}, push() {}, replace() {} }) });
  const { CashForm } = await import("../src/app/panel/kasa/cash-form");
  const dto = {
    ...report,
    id: 1,
    branchId: "marina",
    okcZNo: null,
    okcReceipts: null,
    okcTotal: null,
    okcVatTotal: null,
    okcVat: null,
    okcCash: null,
    okcCard: null,
    okcMealCard: null,
    okcOther: null,
    discounts: 30,
    revision: 1,
    submittedBy: 1,
    submittedByName: "AsilPOS (otomatik)",
    countedBy: null,
    countedByName: null,
    handedToUserId: null,
    emailStatus: "sent",
    emailError: null,
    createdAt: "2026-11-27T20:00:00.000Z",
    updatedAt: "2026-11-27T20:00:00.000Z",
  };
  const whatsapp = { text: "metin", link: "https://wa.me/?text=metin" };
  // HTML'in kaçışı (kesme işareti) metinle karşılaştırmak için geri çevrilir
  const render = (o: Record<string, unknown>) =>
    plain(
      renderToStaticMarkup(
        createElement(CashForm, {
          date: DATE,
          report: dto,
          carry: null,
          whatsapp,
          recipients: 1,
          canEdit: false,
          photoUi: { storage: true, reading: "on", admin: false, me: "Ayşe" },
          saved: null,
          cashOuts: [],
          asilposMode: true,
          ...o,
        } as never),
      ),
    ).replace(/&#x27;/g, "'");
  const staff = render({ report: blindReport(dto), asilposAuto: true });
  assert.ok(staff.includes("WhatsApp ile gönder") && staff.includes('href="https://wa.me/?text=metin"'), "personelde WhatsApp ile gönder var");
  assert.ok(staff.includes("Metni kopyala"), "personelde Metni kopyala var");
  assert.ok(staff.includes(BLIND_TEXT.line), "açıklama cümlesi kalır");
  assert.ok(!staff.includes("Düzenle") && !staff.includes("Silinmesini iste"), "Düzenle ve silme isteği yok");
  // Elle girilmiş kör rapor: aynı düğmeler, kendi cümlesi; düzenleme izni ve istekler gelse de Düzenle ve silme isteği yok
  const manual = render({ report: blindReport(dto), asilposAuto: false, canEdit: true, requests: { own: [], others: [] } });
  assert.ok(manual.includes("WhatsApp ile gönder") && manual.includes("Metni kopyala") && manual.includes(BLIND_TEXT.manualLine), "elle girilmiş kör rapor");
  assert.ok(!manual.includes("Düzenle") && !manual.includes("Silinmesini iste"), "elle girilmiş kör raporda da Düzenle ve silme isteği yok");
  // Metin yoksa düğme de yok
  const none = render({ report: blindReport(dto), asilposAuto: true, whatsapp: null });
  assert.ok(!none.includes("WhatsApp ile gönder") && !none.includes("Metni kopyala"), "metin yoksa düğme yok");
  // Yönetici: kart eskisi gibi (WhatsApp, Metni kopyala, Düzenle)
  const admin = render({ asilposAuto: true, canEdit: true, photoUi: { storage: true, reading: "on", admin: true, me: "Ali" } });
  assert.ok(admin.includes("WhatsApp ile gönder") && admin.includes("Metni kopyala") && admin.includes("Düzenle"), "yöneticide üçü de var");
  assert.ok(!admin.includes(BLIND_TEXT.line), "yöneticide personelin cümlesi yok");
});

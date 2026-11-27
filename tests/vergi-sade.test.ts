// Vergi sadeleştirme (docs/planlar/ux-sade.md §7, §12): sade sözlük (glossary.ts: takvim satırının sade adı, döküm
// etiketleri, rozetler, Vergi kârı'nın esas rozeti), günü geçmiş vergi / SGK hatırlatıcıları (overdue.ts), view.ts'in
// yalnız eklemeli alanları (carryOut, reminderDue, unknownWithholding, NOTE_VAT_NONE) ve ekran kaynağının bekçileri
// (Özet'te Hazırlık karosu ve tam feragat yok, Muhasebeci'nin sonunda feragat, kutusuz bant, tek kâr vergisi kartı).
// Çalıştırma: npx tsx --test tests/vergi-sade.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { buildCashPlan, planInputFromModel } from "../src/lib/cash-plan";
import { createModel, shiftMonth } from "../src/lib/calc/engine";
import type { Dataset } from "../src/lib/calc/types";
import type { ReminderRow } from "../src/lib/reminders";
import { badgeLabel, badgeNote, calendarTitle, plainBadge, plainBadgeTone, plainLabel, TERMS } from "../src/lib/tax/glossary";
import { type MuhtasarItem, muhtasarItemsFromModel } from "../src/lib/tax/muhtasar";
import { overdueTaxNotice, overdueTaxReminders, taxReminderKind } from "../src/lib/tax/overdue";
import { managementBadge, type TaxPnlInput, taxPnlInputFromModel } from "../src/lib/tax/pnl";
import { DEFAULT_TAX_SETTINGS } from "../src/lib/tax/settings";
import { buildTaxView, laterOnCard, NOTE_VAT_NONE, profitTaxTitle, type TaxCalendarRow, type TaxView } from "../src/lib/tax/view";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const nb = (s: string | null | undefined) => (s ?? "").replace(/\u00a0/g, " ");

// ---------------------------------------------------------------- Sözlük (§7.11)

test("calendarTitle: sekiz türün sade adı, resmî ad parantezde; KDV-2 aynı", () => {
  const row = (kind: TaxCalendarRow["kind"], period: string, title = "") => calendarTitle({ kind, period, title });
  assert.equal(row("kdv1", "2026-10"), "KDV (Ekim satışları)");
  assert.equal(row("kdv2", "2026-09", "KDV-2 (Eylül)"), "KDV-2 (Eylül)");
  assert.equal(row("mphb", "2026-10"), "Maaş vergileri ve stopaj (muhtasar, Ekim)");
  assert.equal(row("sgk", "2026-09"), "SGK primi (Eylül maaşları)");
  assert.equal(row("gecici", "2026-Q3"), "Kâr vergisi peşinatı: 3. çeyrek 2026 (geçici vergi)");
  assert.equal(row("kv", "2026"), "Yıllık kâr vergisi 2026 (kurumlar vergisi)");
  assert.equal(row("ctv", "2026-2", "ÇTV 2026 2. taksit"), "Çevre temizlik vergisi (ÇTV) 2026, 2. taksit");
  assert.equal(row("yerel", "2026", "İlan ve reklam vergisi"), "Tabela vergisi (ilan ve reklam vergisi)");
});

test("plainLabel: döküm etiketleri sade söz (resmî terim); bilinmeyen etiket aynen", () => {
  const map: [string, string][] = [
    ["Kümülatif kurum kazancı", "Yılbaşından beri kâr (kurum kazancı)"],
    ["Önceki dönemler", "Önceki peşinatlar"],
    ["Kafenin katkısı", "Kafenin payı"],
    ["Beyanname damgası", "Beyanname ücreti (damga vergisi)"],
    ["Matrah", "Vergi hesabındaki kâr (matrah)"],
    ["Hesaplanan", "Hesaplanan vergi"],
    ["Mahsup edilecek geçici vergi (yalnız ödendi işaretli)", "Düşülecek peşinat (mahsup; yalnız ödendi işaretli)"],
    ["İade / mahsup alacağı", "Fazla ödenen (iade ya da mahsup)"],
    ["KDV (nakit planı)", "Bu ayın KDV'si (tahmin)"],
    ["Dönemin sonucu (amortisman öncesi)", "Kâr (demirbaş payı düşülmeden)"],
    ["Amortisman", "Demirbaş payı (amortisman)"],
    ["Dönem kazancı", "Bu çeyreğin kârı (dönem kazancı)"],
  ];
  for (const [from, to] of map) assert.equal(plainLabel(from), to, from);
  for (const same of ["Ödenecek (Ödemeler'deki tutar, damga dahil)", "Oluşan zarar (sonraki 5 yılın kazancından düşülür)", "× %25", "Bilinmeyen satır"]) assert.equal(plainLabel(same), same);
  // Tablonun terimleri tek kaynakta; "Taslak" ekranda "Eksik bilgi"
  assert.equal(TERMS.Taslak.screen, "Eksik bilgi");
  assert.equal(TERMS.Muhtasar.screen, "Maaş vergileri ve stopaj (muhtasar)");
});

test("badgeLabel (K16): Muhasebeciden, Eksik bilgi, yalnız damga; Ödemeler'de ve 2026 kuralları rozet değil, alt satırda söz", () => {
  assert.deepEqual(badgeLabel("Muhasebeci"), { label: "Muhasebeciden", tone: "green" });
  assert.deepEqual(badgeLabel("Taslak"), { label: "Eksik bilgi", tone: "amber" });
  assert.deepEqual(badgeLabel("sabit tutar"), { label: "yalnız damga", tone: "gray" });
  assert.equal(badgeLabel("Ödemeler'de"), null);
  assert.equal(badgeLabel("2026 kuralları"), null);
  assert.equal(badgeLabel(null), null);
  assert.equal(badgeNote("Ödemeler'de"), "Ödemeler'deki tutar");
  assert.equal(badgeNote("2026 kuralları", "mphb"), "geçen yılın damga tutarıyla");
  assert.equal(badgeNote("2026 kuralları", "sgk"), "geçen yılın kurallarıyla");
  assert.equal(badgeNote("Muhasebeci"), null);
});

test("U17: Vergi kârı tablosunun yönetim verisi rozeti gri kaynak sözü, uyarı değil", () => {
  assert.equal(plainBadge(managementBadge("2026-09", null)), "Kasa programının rakamı (ModPOS), resmî belge değil");
  assert.equal(plainBadge(managementBadge("2026-11", "2026-11-10")), "Kasa programının rakamı (ModPOS ve LafPOS), resmî belge değil");
  assert.equal(plainBadge("mali belge · Z"), "mali belge · Z");
  assert.equal(plainBadgeTone(managementBadge("2026-09", null)), "gray");
  assert.equal(plainBadgeTone("mali belge · beyanname"), "green");
});

// ---------------------------------------------------------------- Günü geçmiş vergi / SGK (§7.2)

const reminder = (over: Partial<ReminderRow>): ReminderRow => ({
  id: 1,
  title: "SGK prim ödemesi",
  kind: "vergi",
  amount: null,
  dueDate: "2026-10-26",
  anchorDate: "2026-10-26",
  repeat: "monthly",
  remindDaysBefore: 3,
  note: null,
  active: true,
  ...over,
});

test("overdueTaxReminders: etkin ve günü geçmiş vergi / SGK hatırlatıcıları, güne göre; pasif, gelecek ve vergi dışı yok", () => {
  const list = [
    reminder({ id: 1, title: "SGK prim ödemesi", dueDate: "2026-10-26" }),
    reminder({ id: 2, title: "KDV beyannamesi", dueDate: "2026-10-20" }),
    reminder({ id: 3, title: "Muhtasar", dueDate: "2026-10-27", active: false }),
    reminder({ id: 4, title: "Kira", kind: "kira", dueDate: "2026-10-01" }),
    reminder({ id: 5, title: "Geçici vergi", dueDate: "2026-11-17" }),
    reminder({ id: 6, title: "Elektrik", kind: "fatura", dueDate: "2026-10-10" }),
    reminder({ id: 7, title: "Damga vergisi", kind: "vergi", dueDate: "2026-10-27" }),
  ];
  assert.deepEqual(
    overdueTaxReminders(list, "2026-10-28").map((r) => r.id),
    [2, 1, 7],
  );
  // Bugün günü olan gecikmiş değil (Ödemeler'in "Gecikti" grubu: günü bugünden önce)
  assert.deepEqual(overdueTaxReminders([reminder({ dueDate: "2026-10-28" })], "2026-10-28"), []);
  assert.equal(taxReminderKind({ kind: "vergi", title: "SGK prim ödemesi" }), "sgk");
  assert.equal(taxReminderKind({ kind: "odeme", title: "KDV" }), "kdv1");
  assert.equal(taxReminderKind({ kind: "vergi", title: "Kurumlar vergisi" }), "kv");
  assert.equal(taxReminderKind({ kind: "kira", title: "Kira" }), null);
});

test("overdueTaxNotice: tek ödemede başlık adıyla, çoğunda sayıyla; en çok 3 ad + kalan; yasal gün takvimdeki satırdan", () => {
  const cal: Pick<TaxCalendarRow, "kind" | "due" | "reminderDue">[] = [{ kind: "sgk", due: "2026-11-02", reminderDue: "2026-10-26" }];
  const one = overdueTaxNotice([reminder({})], "2026-10-28", cal)!;
  assert.equal(one.title, "Ödemeler'de günü geçmiş vergi ödemesi: SGK prim ödemesi");
  assert.equal(nb(one.text), "SGK prim ödemesi 26 Ekim");
  assert.deepEqual(one.details.map(nb), ["SGK prim ödemesi: Ödemeler'deki gün 26 Ekim, yasal son gün 2 Kasım."]);
  const many = overdueTaxNotice(
    [1, 2, 3, 4].map((id) => reminder({ id, title: `Vergi ${id}`, dueDate: `2026-10-2${id}` })),
    "2026-10-28",
    [],
  )!;
  assert.equal(many.title, "Ödemeler'de günü geçmiş 4 vergi ödemesi");
  assert.equal(nb(many.text), "Vergi 1 21 Ekim, Vergi 2 22 Ekim, Vergi 3 23 Ekim +1");
  assert.deepEqual(many.details, [], "takvimde satırı yok: cümle yazılmaz");
  assert.equal(overdueTaxNotice([reminder({ dueDate: "2026-11-26" })], "2026-10-28", cal), null);
});

// ---------------------------------------------------------------- view.ts'in eklemeli alanları (§7.5)

const data: SeedData = JSON.parse(read("tests/fixtures/baslangic/veri.json"));
const excel = datasetFromSeed(data);
const base: Dataset = { ...excel, currentMonth: "2026-10", invoices: excel.invoices.map((i) => (i.supplier === "Berna Kalaycı" ? { ...i, vat: 6000 } : i)) };

function view(today: string, reminders: ReminderRow[] = [], tweak?: (pnl: TaxPnlInput) => TaxPnlInput): TaxView {
  const settings = DEFAULT_TAX_SETTINGS;
  const model = createModel(base);
  const plan = buildCashPlan({
    ...planInputFromModel(model, today),
    today,
    opening: null,
    excluded: [],
    invoiceTermDays: 30,
    cashReports: [],
    invoices: [],
    reminders: [],
    goods: [],
    goodsSpanDays: 0,
    vatAnchor: { month: "2026-09", amount: 121204.69 },
  });
  const raw = taxPnlInputFromModel(model, { settings, today, adjustments: [], assets: [], filings: [] });
  const pnl = tweak ? tweak(raw) : raw;
  const items = new Map<string, MuhtasarItem[]>();
  for (let m = "2026-06"; m <= "2027-05"; m = shiftMonth(m, 1)) items.set(m, muhtasarItemsFromModel(model, m));
  return buildTaxView({ today, settings, pnl, muhtasarItems: items, filings: [], reminders, vat: plan.vat, settingsEmployerRate: model.settings.isverenSgk });
}

test("Excel verisinde 24.10.2026: KDV satırı ödeme yok (carryOut, not null), SGK'da Ödemeler'deki gün, muhtasarda seçilmemiş kesinti", () => {
  const sgk = reminder({ id: 9, title: "SGK prim ödemesi", dueDate: "2026-10-26", anchorDate: "2026-10-26" });
  const v = view("2026-10-24", [sgk]);
  const by = (k: string) => v.calendar.find((r) => r.key === k)!;
  const kdv = by("kdv1:2026-09");
  assert.equal(kdv.source, "sabit tutar");
  assert.equal(kdv.carryOut, 0);
  assert.equal(kdv.note, null);
  // Not verisi aynı (Excel ve eski test); ekranda kapalı satır "Ödeme yok" yazar, not çizilmez
  assert.ok(kdv.notes.includes(NOTE_VAT_NONE));
  assert.equal(NOTE_VAT_NONE, "Ödeme beklenmez (devreden); yalnız damga.");
  assert.equal(by("sgk:2026-09").reminderDue, "2026-10-26");
  assert.equal(by("sgk:2026-09").due, "2026-11-02");
  assert.equal(by("mphb:2026-09").unknownWithholding, 4);
  assert.equal(by("mphb:2026-09").atLeast, true);
  // "Tahmin; kesin tutar tahakkuk fişindedir." satır notu silindi (≈ ve bant söylüyor); nakit planının dökümünde kalır
  assert.ok(!v.calendar.some((r) => r.notes.includes("Tahmin; kesin tutar tahakkuk fişindedir.")));
  // Hatırlatıcısı olmayan satırda Ödemeler günü yok
  assert.equal(by("kdv1:2026-09").reminderDue, undefined);
  // 28 Ekim: Ekim KDV'sinde sonraki aya geçen tutar (satır kapalıyken "≈ … sonraki aya geçer")
  const late = view("2026-10-28", [sgk]);
  const oct = late.calendar.find((r) => r.key === "kdv1:2026-10")!;
  assert.equal(oct.source, "sabit tutar");
  assert.ok(oct.carryOut !== null && oct.carryOut !== undefined && oct.carryOut > 0, String(oct.carryOut));
  // Özet'in satırı: günü geçmiş SGK hatırlatıcısı, yasal günü takvimden
  const notice = overdueTaxNotice([sgk], "2026-10-28", late.calendar)!;
  assert.deepEqual(notice.details.map(nb), ["SGK prim ödemesi: Ödemeler'deki gün 26 Ekim, yasal son gün 2 Kasım."]);
  // Başlarken'in demirbaş adımı "demirbaş" der (K17)
  assert.equal(v.gettingStarted.steps.find((s) => s.key === "demirbas")!.detail, "4 fatura demirbaş listesinde değil");
});

// ---------------------------------------------------------------- Ekranın bekçileri (§7.1-§7.9)

test("Kâr vergisi kartı ve takvimin \"Sonra\"sı: kartın yılı peşinatın ve Sonra'daki kurumlar vergisinin yılından ayrılınca", () => {
  // 30 Ekim 2026: kart 2026, peşinat 2026/4, Sonra'daki kurumlar vergisi 2026 → başlık yıllı, "tahmin kartta"
  const oct = view("2026-10-30");
  const kvOct = oct.later.find((l) => l.kind === "kv")!;
  assert.equal(oct.kvCard.year, 2026);
  assert.equal(kvOct.period, "2026");
  assert.equal(laterOnCard(kvOct, oct.kvCard.year), true);
  assert.equal(profitTaxTitle(oct.geciciCard?.key ?? null, oct.kvCard.year), "Şirketin kâr vergisi (2026)");
  // 20 Şubat 2027: kart 2026 yılını kapatır (beyanname Nisan'da), peşinat 2027/1, Sonra'daki kurumlar vergisi 2027 →
  // kartta 2027'nin tahmini yok ("Tutarı bilinmiyor"), başlık yılsız (iki bölüm kendi yılını taşır)
  const feb = view("2027-02-20");
  const kvFeb = feb.later.find((l) => l.kind === "kv")!;
  assert.equal(feb.kvCard.year, 2026);
  assert.equal(kvFeb.period, "2027");
  assert.equal(laterOnCard(kvFeb, feb.kvCard.year), false);
  assert.equal(feb.geciciCard!.key, "2027-Q1");
  assert.equal(profitTaxTitle(feb.geciciCard!.key, feb.kvCard.year), "Şirketin kâr vergisi");
  assert.equal(profitTaxTitle(null, 2026), "Şirketin kâr vergisi (2026)");
  assert.equal(laterOnCard({ kind: "gecici", period: "2026" }, 2026), false);
});

test("\"Eksik belgeler var\" yalnız gider belgesi eksikken: eksik bilginin öteki sebeplerinde uyarı ve \"0 ₺ … (0 kalem)\" yok", () => {
  // Excel verisi: belgesi seçilmemiş gider ve demirbaş adayı var → uyarı, alt satır iki parça
  const g = view("2026-10-30").geciciCard!;
  assert.equal(g.state, "taslak");
  assert.equal(g.missingDocs, true);
  assert.match(nb(g.subline ?? ""), /gider henüz hesaba girmedi \(\d+ kalem\)/);
  // Bütün giderlerin belgesi seçili, adaylar "demirbaş değil": çeyrek yine eksik bilgide (gelir belgesi, kafe dışı
  // işler) ama uyarı yok, alt satır yok
  const docs = view("2026-10-30", [], (p) => ({
    ...p,
    fixed: p.fixed.map((f) => ({ ...f, taxDoc: "belgeli" as const })),
    expenseCategories: p.expenseCategories.map((c) => ({ ...c, taxDoc: "belgeli" as const })),
    settings: { ...p.settings, manualRows: Object.fromEntries(Object.keys(p.settings.manualRows).map((k) => [k, "belgeli" as const])) },
    invoices: p.invoices.map((i) => ({ ...i, taxNotAsset: true })),
  }));
  const d = docs.geciciCard!;
  const q = docs.quarters.find((x) => x.key === d.key)!;
  assert.equal(d.state, "taslak");
  assert.deepEqual(q.stateReasons, ["Gelir mali belgeden girilmedi", "Kafe dışı işler muhasebeciyle konuşulmadı"]);
  assert.deepEqual(q.unclassified, { total: 0, count: 0 });
  assert.equal(d.missingDocs, false);
  assert.equal(d.subline, null);
  assert.equal(d.badge, "Taslak", "Eksik bilgi rozeti kalır");
});

const DIR = "src/app/panel/vergi";

test("Özet: Hazırlık karosu ve tam feragat yok, iki rakam yan yana; tek kâr vergisi kartı; gecikmiş satır bandın grubunda", () => {
  const page = read(`${DIR}/page.tsx`);
  assert.doesNotMatch(page, /readiness/);
  assert.doesNotMatch(page, /DisclaimerBody/);
  assert.match(page, /<div className="grid grid-cols-2 gap-2">/);
  assert.match(page, /<ProfitTaxCard\b/);
  assert.match(page, /overdueTaxNotice\(reminders, view\.today, view\.calendar\)/);
  assert.match(page, /<NoticeLink href="\/panel\/hatirlaticilar">Ödemeler&apos;de aç<\/NoticeLink>/);
  const cards = read(`${DIR}/tax-cards.tsx`);
  assert.doesNotMatch(cards, /GeciciCardView|KvCardView/);
  assert.match(cards, /export function ProfitTaxCard\(/);
  assert.match(cards, /<Card id="kar-vergisi"/);
  assert.match(cards, /title="Eksik belgeler var: rakam yüksek çıkabilir"/);
  assert.match(cards, /const missingDocs = gecici !== null && gecici\.missingDocs && !gecici\.calc\.filing;/);
  assert.match(cards, /title=\{profitTaxTitle\(gecici\?\.key \?\? null, kv\.year\)\}/);
  // Başlarken tek satır: "Başlarken: 2 / 4"
  assert.match(cards, /Başlarken: \{data\.done\} \/ \{data\.total\}/);
});

test("Bant (§7.4): kutusuz tek satır, her sekmede aynı; bayat kurallar ayrı uyarı; tam feragat Muhasebeci'nin sonunda bir kez", () => {
  const ui = read(`${DIR}/ui.tsx`);
  const banner = ui.slice(ui.indexOf("export function TaxBanner"), ui.indexOf("export function DisclaimerBody"));
  // Kutu yok; telefon ve masaüstü tek dal (eski sm:hidden kopyası yok). Muhasebeci çipi yalnız telefonda gizli
  assert.doesNotMatch(banner, /bg-panel/);
  assert.doesNotMatch(banner, /[\s"]sm:hidden/);
  assert.match(banner, /max-sm:hidden/);
  assert.match(banner, /role="note" aria-label="Vergi tahmini hakkında"/);
  assert.match(banner, /\{TAX_DISCLAIMER_SHORT\}/);
  assert.match(ui, /title: "Vergi kuralları güncel olmayabilir"/);
  assert.match(ui, /<NoticeLink href="\/panel\/vergi\/kurallar#kurallar">Kural tablosu<\/NoticeLink>/);
  const disclaimer = ui.slice(ui.indexOf("export function DisclaimerBody"));
  assert.doesNotMatch(disclaimer.slice(0, disclaimer.indexOf("\n}\n")), /sm:hidden/);
  assert.match(disclaimer, /id="feragat"/);
  const rules = read(`${DIR}/kurallar/page.tsx`);
  // Sıra: sorular, şirketin vergi ayarları, kural tablosu (kapalı), hesaplanmayanlar (açık), feragat
  const order = ['id="sorular"', 'title="Şirketin vergi ayarları"', 'id="kurallar"', "<RulesDetails", 'id="bilgi"', "<DisclaimerBody"].map((s) => rules.indexOf(s));
  assert.ok(order.every((i) => i > 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  const details = read(`${DIR}/kurallar/rules-details.tsx`);
  assert.match(details, /window\.location\.hash === "#kurallar"/);
  // Muhasebeci'nin kendisinde Next'in bağlantısı hashchange göndermez: tıklama da açar
  assert.match(details, /closest\?\.\('a\[href\$="#kurallar"\]'\)/);
  assert.match(details, /document\.addEventListener\("click", onClick\)/);
});

test("Takvim (§7.5): sade ad, rozetler, KDV satırında tek düğme, muhtasarda kesinti, Sonra tek satır", () => {
  const cal = read(`${DIR}/tax-calendar.tsx`);
  assert.doesNotMatch(cal, /Devreden KDV&apos;yi gir/);
  assert.match(cal, /Döküm ve devreden KDV/);
  assert.match(cal, /\{calendarTitle\(row\)\}/);
  assert.match(cal, /title="Vergi ve SGK ödemeleri"/);
  assert.match(cal, /Kesintiyi seç/);
  assert.match(cal, /tahmin kartta/);
  // Bağlantı yalnız kartın yılındaki kurumlar vergisinde (Ocak–Nisan'da Sonra'daki yıl kartınkinden sonra)
  assert.match(cal, /\{laterOnCard\(l, view\.kvCard\.year\) \? \(/);
  assert.match(cal, /Pick<TaxView, "calendar" \| "later" \| "kvCard">/);
  assert.match(cal, /`Ödeme yok\$\{/);
  assert.match(cal, /Ödemeler'de \$\{dayMonthTR\(row\.reminderDue\)\}/);
});

test("Demirbaş ve Vergi kârı: ekranda 'varlık' yok, köprü ve tablo sade sözle", () => {
  for (const f of [`${DIR}/demirbas/page.tsx`, `${DIR}/asset-dialog.tsx`, `${DIR}/asset-actions.tsx`]) {
    const src = read(f).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");
    assert.doesNotMatch(src, /"Varlık|Varlık ekle|varlık listesinde|"Doğrudan gider"/, f);
  }
  const bridge = read(`${DIR}/gelir-gider/bridge-card.tsx`);
  assert.match(bridge, /title="Gelir-gider'den neden farklı\?"/);
  assert.match(read("src/lib/tax/pnl.ts"), /label: "Vergi hesabındaki gider"/);
  const list = read(`${DIR}/gelir-gider/classify-list.tsx`);
  assert.match(list, /Vergi kesintisi \(stopaj\)/);
});

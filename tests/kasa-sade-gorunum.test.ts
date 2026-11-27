// Kasa raporu girişinin sade ve telefona uygun düzeni (ekran incelemesi, 24 Kasım 2026; docs/KASA-RAPORU.md › Ekranın
// düzeni): personelin boş formu iPhone'da 6,7, yöneticinin AsilPOS'tan dolu formu 12,6 ekrandı. Kurallar aynı kaldı;
// burada düzenin ve metnin sözleşmesi denetlenir (iş kurallarının kendi testleri ayrı: son-kontrol, asilpos-kasa, …).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Fold } from "../src/app/panel/kasa/fold";
import { toastLayout } from "../src/components/ui/toast-layout";
import { cardDiffLabel, reportAttention, reportFlags } from "../src/lib/cash-attention";
import { cashOutNoteVisible } from "../src/lib/cash-outs";
import { dayDetailNotes } from "../src/lib/asilpos/gun-ayrinti";
import { ASILPOS_STAFF_NO_COUNT } from "../src/lib/asilpos/foto";
import { OKC_PHOTOS_TEXT, PHOTO_KIND_LABEL } from "../src/lib/photo-rules";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const form = read("src/app/panel/kasa/cash-form.tsx");
const page = read("src/app/panel/kasa/page.tsx");
const okc = read("src/app/panel/kasa/okc-card.tsx");

test("Fold: kapalıyken başlıkta dolu değerlerin özeti; turuncu / hata varsa açık gelir", () => {
  const closed = renderToStaticMarkup(createElement(Fold, { label: "Diğer ödemeler ve Z ayrıntısı", summary: "Z no 11 · İndirim 90 ₺", attention: 0 }, "alanlar"));
  assert.match(closed, /aria-expanded="false"/);
  assert.match(closed, /hidden=""/);
  assert.match(closed, /Diğer ödemeler ve Z ayrıntısı[\s\S]*Z no 11 · İndirim 90 ₺/, "hiçbir değer gizli kalmaz");
  const open = renderToStaticMarkup(createElement(Fold, { label: "Diğer ödemeler ve Z ayrıntısı", summary: "", attention: 2 }, "alanlar"));
  assert.match(open, /aria-expanded="true"/);
  assert.doesNotMatch(open, /hidden=""/);
  assert.match(open, /bg-warn-soft/, "dikkat isteyen kat turuncu");
  // Dokunmatikte 44 px
  assert.match(read("src/app/panel/kasa/fold.tsx"), /pointer-coarse:min-h-11/);
});

test("ModPOS Z: üç alan açık, seyrek alanlar katlı; geç raporda Z no zorunlu ve katın dışında", () => {
  assert.match(form, /const Z_EXTRA = \["zNo", "mealCard", "online", "other", "offRevenue", "discounts", "receipts"\] as const/);
  assert.match(form, /const zExtra = Z_EXTRA\.filter\(\(k\) => !\(isLate && k === "zNo"\)\);/);
  // Ödeme türleri Z'yi tutmuyorsa (hata katın içinde olabilir) kat açılır
  assert.match(form, /const zAttention = zExtra\.filter\(\(k\) => Boolean\(errors\[k\]\) \|\| warnOf\(k\)\)\.length \+ \(paymentsOff \? 1 : 0\);/);
  assert.match(form, /\{isLate \? zNoField : null\}/);
  assert.match(form, /<Fold label="Diğer ödemeler ve Z ayrıntısı"[^>]*>\n\s+\{isLate \? null : zNoField\}/);
  // Alanların altında ayrı ipucu satırı yok: "isteğe bağlı" yer tutucuda
  assert.doesNotMatch(form, /hint: "Multinet, Pluxee|hint: "Yemeksepeti, Getir|hintOf\("receipts", "isteğe bağlı"\)/);
});

test("Fiş fotoğrafları tek kartta; AsilPOS gününde gün sonu geldiyse yazarkasa seçicisi formda yok (Gün sonu fotoğrafı kartında)", () => {
  assert.match(form, /\{photosCard\}\n\s+<Card>\n\s+<CardHeader\n\s+icon=\{<ReceiptText \/>\}/, "fotoğraflar Z kartından önce");
  assert.equal(form.match(/<PhotoPicker\b/g)?.length, 1, "tek seçici yeri (bölüm başına çizilir)");
  assert.doesNotMatch(okc, /photoBlock/, "yazarkasa kartında seçici yok");
  assert.match(page, /dayPhotoCard=\{photoCard !== null\}/);
  // Bölüm kimlikleri kaldı: geç rapor eksik fotoğrafta oraya kaydırır
  assert.match(form, /id=\{fid\(k === "kasa-z" \? "z-photos" : "okc-photos"\)\}/);
  assert.match(form, /document\.getElementById\(fid\("z-photos"\)\)/);
});

test("Yazarkasa: tek ad, Ayrıntılar yöneticide de kapalı (turuncuda açılır), satır adları yer tutucuda", () => {
  assert.match(okc, /title="Yazarkasa Z raporu"/);
  assert.doesNotMatch(okc, /forceDetails/);
  assert.match(okc, /const open = Boolean\(posPrompt\) \|\| \(chosen \?\? \(orange > 0 \|\| legacy\)\);/);
  assert.match(okc, /"NET SATIŞ \/ TOPLAM satırı"/);
  // Doğruluk ipucu yer tutucuda kalmaz (alan dolunca kaybolur): alanın altında kısa satır
  assert.match(okc, /opts\("okcTotal", "İsteğe bağlı; en büyük rakam \(KÜMÜLATİF\) değil"/);
  assert.match(okc, /opts\("okcCard", "İsteğe bağlı; altındaki banka satırları değil"/);
  assert.doesNotMatch(form + okc, /title="Banka POS Z raporu \(yazarkasa\)"/);
  assert.equal(PHOTO_KIND_LABEL["kasa-okc"], "Yazarkasa Z");
  assert.match(OKC_PHOTOS_TEXT, /^Yazarkasa Z bölümüne/);
});

test("Kasa (nakit): sayan tek satır, 'Neye çıktı' yalnız elle yazılan çıkışta, teslim tek anlamda", () => {
  assert.match(form, /const meCounts = me !== null && counter === me\.id && !counterOpen;/);
  assert.match(form, /Kasayı sayan: <span className="font-medium text-ink">\{me\.name\} \(siz\)<\/span>/);
  assert.match(form, /const showOutNote = cashOutNoteVisible\(/);
  // Davranış: fişlerden gelen toplam ve adlar aynıysa gizli; elle yazılan çıkış, değişen adlar ya da fişlerin üstüne
  // eklenen tutar varsa görünür
  const outs = [{ amount: 500 }, { amount: 300 }];
  const v = (cashOut: number | null, note = "Migros, buz", list = outs) => cashOutNoteVisible({ cashOut, outs: list, note, outsNote: "Migros, buz" });
  assert.equal(v(0), false);
  assert.equal(v(null), false);
  assert.equal(v(800), false, "fişlerin toplamı, kendiliğinden yazılan adlar");
  assert.equal(v(1_000), true, "fişlerin üstüne 200 ₺ elle eklendi: ne için çıktığı yazılabilsin");
  assert.equal(v(800, "Migros, buz, tamirci"), true);
  assert.equal(v(250, "", []), true, "fiş yok, elle yazılan çıkış");
  assert.match(form, /field\("handedOver", "Sayımdan sonra teslim"/);
  assert.doesNotMatch(form, /"Kasadan ödenen harcama, gün içinde teslim edilen"/);
});

test("Sonuç: telefonda alt menünün üstünde çubuk (klavyede gizli), fark varken not bir kez istenir", () => {
  assert.match(form, /const bar = mode === "report" && resultBelow;/);
  assert.match(form, /bottom-\[calc\(var\(--mobile-nav-h,0px\)\+0\.5rem\)\][^"]*in-data-\[keyboard=open\]:hidden[^"]*xl:hidden/);
  assert.match(form, /setResultBelow\(!e\.isIntersecting && e\.boundingClientRect\.top > 0\)/);
  // Not zorunlu değil: ikinci basış gönderir; açılış devirle tutmuyorsa zorunluluk eskisi gibi (önce o denetim)
  const submit = form.slice(form.indexOf("function submit()"), form.indexOf("async function resend()"));
  assert.ok(submit.indexOf("openingNeedsNote") < submit.indexOf("noteAsked"), "devir denetimi önce");
  assert.match(submit, /if \(diffKind\(diff\) !== "even" && !fields\.note && !noteAsked\) \{\n\s+setNoteAsked\(true\);/);
  assert.match(read("src/app/panel/kasa/cash-summary.tsx"), /aria-live=\{live \? "polite" : undefined\}/);
});

test("Gönderilmiş rapor: fark bir kez, döküm katlı (devir tutmuyorsa açık)", () => {
  const saved = form.slice(form.indexOf("if (report && !editing) {"), form.indexOf("const kind = diffLive ? diffLive.kind : null;"));
  assert.doesNotMatch(saved, /meta=\{/, "başlıkta ikinci fark rozeti yok");
  assert.equal(saved.match(/<DiffHeadline\b/g)?.length, 1);
  assert.match(saved, /<details open=\{Boolean\(savedCarry \|\| savedNext \|\| attention\.length\)\}/);
  assert.match(saved, /\{attention\.length \? <span className="font-medium text-warn"> · \{attention\.join\(" · "\)\}<\/span> : null\}/);
  assert.match(saved, /Rapor dökümü<\/span> · Z \{money\(report\.zTotal\)\}/);
});

test("Sayfa: personelin AsilPOS gününde fotoğraf kartı en üstte, sayımsız günde tek uyarı; ModPOS'ta zayi formdan önce", () => {
  assert.match(page, /\{asilposState\.asilpos \? \(\n\s+<>\n\s+\{photoCard\}/);
  assert.match(page, /\{report \? form : null\}\n\s+\{outsCard\}\n\s+\{wasteCard\}\n\s+\{report \? null : form\}/);
  assert.doesNotMatch(page, /title="Kasa raporu AsilPOS'tan gelecek" text=\{ASILPOS_NO_COUNT_TEXT\}/, "alt başlığı tekrarlamaz");
  assert.doesNotMatch(ASILPOS_STAFF_NO_COUNT.title, /gelecek/);
  // Personelin fotoğraf kartında açıklama yok (alt başlık ve kartın satırı söyler)
  assert.match(read("src/app/panel/kasa/asilpos-photo.tsx"), /description=\{admin \? \(/);
  // Son 7 gün: iki satır, kısa tarih (dar sütunda dört satıra kırılıyordu)
  assert.match(page, /<span className="font-medium text-ink">\{shortDayTR\(r\.date\)\}<\/span>/);
  assert.doesNotMatch(page, /w-\[8\.5rem\]/);
});

test("Sayfa: yöneticinin gün görünümünde ay listesi ve ayarlar yok; Pavo ve AsilPOS dökümü katlı, fark varsa açık", () => {
  const admin = page.slice(page.indexOf("const ay = pick(sp.ay);"));
  assert.match(admin, /\{showForm \? \(\n\s+<>[\s\S]*?<\/>\n\s+\) : \(\n[^\n]*\n\s+<div className="grid gap-4 xl:grid-cols-\[minmax\(0,1fr\)_360px\]">\n\s+<div className="min-w-0">\n\s+<CashHistory/);
  assert.match(page, /<details open=\{\(pavo !== null && pavo !== "uyumlu"\) \|\| notes\.length > 0\}/);
  assert.match(admin, /<DayDetails pavo=\{bankPos \? pavoView\(bankPos\)\.state : null\} asilpos=\{asilposDetail !== null\} notes=\{dayDetailNotes\(asilposDetail\)\}>/);
  // Hassas işlem (AsilPOS'un düzeltmesi, ödeme iptali) Pavo uyumluyken de katı açar ve özette görünür
  assert.deepEqual(dayDetailNotes(null), []);
  assert.deepEqual(dayDetailNotes({ correction: null, refunds: [] }), []);
  assert.deepEqual(dayDetailNotes({ correction: "Gün yeniden açıldı", refunds: [{ name: "Kart", amount: "120 ₺", reason: null }, { name: "Nakit", amount: "40 ₺", reason: "yanlış" }] }), ["AsilPOS düzeltti", "2 ödeme iptali"]);
  // Yöneticide gün sonu fotoğrafı formdan önce (Yazarkasa kartı fotoğrafın o karttan eklendiğini söyler); arada yalnız
  // kör sayımın kutusu (docs/KASA-RAPORU.md › Kör sayım)
  assert.match(admin, /\{outsCard\}\n(\s+\{\/\*[^\n]*\*\/\}\n)?\s+\{photoCard\}\n(\s+\{countCard\}\n)?\s+\{form\}/);
});

test("Gönderilmiş rapor: yöneticinin dikkat etmesi gerekenler (ay listesinin rozetleri) döküm özetinde; ikisi aynı kuraldan", () => {
  const report = {
    zTotal: 18_450,
    cash: 6_200,
    card: 11_450,
    mealCard: 0,
    online: 0,
    other: 0,
    openingCash: 1_500,
    cashIn: 0,
    cashOut: 650,
    countedCash: 7_050,
    handedOver: 5_500,
    bankPos: 11_450,
    okcTotal: 18_450,
    okcCash: 6_200,
    okcCard: 11_450,
  };
  const flags = reportFlags(report);
  // İnceleme örneği (21 Kasım, Tuzla): ödemeler 17.650, Z 18.450; yazarkasanın nakit + kartı da günlük toplamını tutmuyor
  assert.deepEqual(flags, { paymentsOff: true, cardDiff: null, okcOff: true });
  assert.deepEqual(reportAttention(flags), ["Z tutmuyor", "Yazarkasa tutmuyor"]);
  assert.deepEqual(reportAttention(reportFlags({ ...report, card: 12_250, okcCard: 12_250, bankPos: 12_250 })), []);
  const cardOff = reportFlags({ ...report, card: 12_250, bankPos: 12_000, okcCard: 12_000, okcTotal: null, okcCash: null });
  assert.equal(Math.abs(cardOff.cardDiff ?? 0), 250, JSON.stringify(cardOff));
  assert.deepEqual(reportAttention(cardOff), [cardDiffLabel(cardOff.cardDiff!)]);
  assert.match(cardDiffLabel(-250), /^Kart −250/);
  assert.deepEqual(reportAttention({ paymentsOff: false, cardDiff: null, okcOff: true }, { photoDiffs: 1, asilposDiffs: 2 }), ["Fotoğraftan farklı", "AsilPOS'tan farklı", "Yazarkasa tutmuyor"]);
  // Ay listesi aynı işlevden okur (iki yerde ayrı kural kalmadı)
  assert.match(read("src/app/panel/kasa/cash-history.tsx"), /reportFlags\(report, photos\[report\.id\]\?\.extras \?\? \{\}\)/);
});

test("Gönderimde hata katlı alandaysa: hatalar hemen çizilir, kat açılır, alana gidilir; bildirim alanın adını söyler; çubuk işlemi söyler", () => {
  const submit = form.slice(form.indexOf("function submit()"), form.indexOf("async function resend()"));
  assert.match(submit, /flushSync\(\(\) => setErrors\(errs\)\);/);
  assert.match(submit, /goToField\(first \? document\.getElementById\(fid\(first\)\) : null\);/);
  assert.match(submit, /description: name && message && !message\.startsWith\(name\) \? `\$\{name\}: \$\{message\}` : message/);
  // Kapalı katın içindeki alan: katın düğmesi (aria-controls) eşzamanlı açılır, sonra kaydırılır ve odaklanır
  const go = form.slice(form.indexOf("function goToField("));
  assert.match(go, /el\.closest<HTMLElement>\("\[hidden\]"\)/);
  assert.match(go, /flushSync\(\(\) => toggle\.click\(\)\)/);
  assert.match(read("src/app/panel/kasa/fold.tsx"), /aria-controls=\{`\$\{uid\}fold`\}[\s\S]*id=\{`\$\{uid\}fold`\} hidden=\{!open\}/);
  // Çubuk: bildirim çubuğun üstüne binmez (data-bottom-bar → bildirim üstte); düğme işlemi söyler
  assert.match(form, /data-bottom-bar\n\s+className="no-print pointer-events-none fixed/);
  assert.match(form, /const barLabel = pending \|\| busy \|\| reviewPending \? submitLabel : proposal \|\| isLate \? "Onaya gönder" : report \? "Güncelle" : "Gönder";/);
  assert.equal(toastLayout({ phone: true, belowLg: true, shell: true, modal: false, keyboard: false, bottomBar: true }).position, "top-center");
});

test("Dil: ok ve eşit değil işareti yerine düz Türkçe", () => {
  const photo = read("src/app/panel/kasa/asilpos-photo.tsx");
  const history = read("src/app/panel/kasa/cash-history.tsx");
  for (const [name, src] of [["asilpos-photo", photo], ["cash-history", history]] as const) {
    const ui = src.replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, "");
    assert.doesNotMatch(ui, /↔|≠/, name);
  }
  assert.match(photo, /"Fiş AsilPOS'la aynı"/);
  assert.match(history, /Açılış devirden farklı/);
});

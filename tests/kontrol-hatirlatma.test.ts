// Kontrol listesi e-posta hatırlatmaları (src/lib/checklist-alerts.ts, src/server/notify/checklist-alert-template.ts):
// saatlik bölümün "zamanı geldi" ve "gecikti" anları, düz listenin aralığı, biten saat, eski gecikme, kime gider,
// e-postanın metni ve tetikleyicinin kaynak denetimleri. Saatler Türkiye (UTC+3).
// Çalıştırma: npx tsx --test tests/kontrol-hatirlatma.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { withoutLogo } from "./helpers/html-metin";

import {
  ALERT_FIRST_MIN,
  ALERT_LAST_MIN,
  ALERT_POLL_GAP_MS,
  ALERT_SEND_GRACE_MIN,
  ALERT_SEND_MINUTES,
  alertPollDue,
  alertReaches,
  alertRecipients,
  alertSendInstant,
  checklistAlerts,
  LATE_ALERT_MIN,
  remindableLists,
  type AlertList,
} from "../src/lib/checklist-alerts";
import { DEFAULT_CHECKLISTS, TUZLA_HOURLY_CHECKLISTS } from "../src/lib/checklist-seed";
import type { ChecklistItemSnap } from "../src/lib/checklists";
import { renderChecklistAlert } from "../src/server/notify/checklist-alert-template";

const tr = (local: string) => new Date(`${local}:00+03:00`);
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const DAY = "2026-11-18";

function listOf(seed: (typeof DEFAULT_CHECKLISTS)[number], id: number, answered: number[] = []): AlertList {
  const items: ChecklistItemSnap[] = seed.items.map((i, n) => ({
    id: n + 1,
    label: i.label,
    type: i.type,
    section: i.section ?? null,
    hint: i.hint ?? null,
    required: i.required ?? true,
    unit: i.unit ?? null,
    min: i.min ?? null,
    max: i.max ?? null,
  }));
  return {
    templateId: id,
    name: seed.name,
    branchId: seed.branchId ?? null,
    opensAt: seed.opensAt,
    dueAt: seed.dueAt,
    items,
    answers: answered.map((itemId) => ({ itemId, photoAt: items[itemId - 1].type === "photo" ? "2026-11-18T07:00:00Z" : null })),
    // Kayıt ilk yanıtla açılır
    hasRun: answered.length > 0,
  };
}

const toilet = (answered: number[] = []) => listOf(TUZLA_HOURLY_CHECKLISTS[0], 5, answered);

test("saatlik bölüm: 09:50'den önce yok, 10:00 saati açılınca 'zamanı geldi', 11:00'de 'gecikti' ve 11:00 'zamanı geldi'", () => {
  assert.deepEqual(checklistAlerts(DAY, tr(`${DAY}T09:49`), [toilet()]), []);
  const at10 = checklistAlerts(DAY, tr(`${DAY}T10:07`), [toilet()]);
  assert.deepEqual(
    at10.map((a) => [a.key, a.kind, a.slot, a.until, a.missing.length]),
    [["kontrol-eposta:5:2026-11-18:10:00:due", "due", "10:00", "11:00", 3]],
  );
  // İsteğe bağlı bahçe fotoğrafı eksik sayılmaz
  assert.ok(!at10[0].missing.some((m) => /Bahçe ve odalar fotoğrafı/.test(m)));
  const at11 = checklistAlerts(DAY, tr(`${DAY}T11:07`), [toilet()]);
  assert.deepEqual(
    at11.map((a) => [a.slot, a.kind]),
    [
      ["10:00", "late"],
      ["11:00", "due"],
    ],
  );
});

test("biten saat için e-posta yok; zorunlular yeterli (isteğe bağlı fotoğraf beklenmez)", () => {
  // 10:00'ın zorunlu üç maddesi (1, 2, 3) yapıldı
  assert.deepEqual(checklistAlerts(DAY, tr(`${DAY}T10:30`), [toilet([1, 2, 3])]), []);
  assert.deepEqual(
    checklistAlerts(DAY, tr(`${DAY}T11:07`), [toilet([1, 2, 3])]).map((a) => [a.slot, a.kind]),
    [["11:00", "due"]],
  );
  // Fotoğrafsız fotoğraf maddesi yapılmamış sayılır
  const l = toilet([1, 3]);
  l.answers.push({ itemId: 2, photoAt: null });
  assert.equal(checklistAlerts(DAY, tr(`${DAY}T10:30`), [l])[0].missing.length, 1);
});

test("gecikme iki saatten eskiyse gitmez; gece yarısını geçen saatler ve son saat 01:30", () => {
  const at13 = checklistAlerts(DAY, tr(`${DAY}T13:07`), [toilet()]);
  // 10:00 13:00'te bitişinden (11:00) iki saat geçti: yok. 11:00 ve 12:00 gecikti, 13:00 zamanı geldi
  assert.deepEqual(
    at13.map((a) => [a.slot, a.kind]),
    [
      ["11:00", "late"],
      ["12:00", "late"],
      ["13:00", "due"],
    ],
  );
  assert.equal(LATE_ALERT_MIN, 120);
  const night = checklistAlerts(DAY, tr("2026-11-19T01:07"), [toilet()]).map((a) => [a.slot, a.kind, a.until]);
  assert.ok(night.some(([s, k, u]) => s === "00:00" && k === "late" && u === "01:00"));
  assert.ok(night.some(([s, k, u]) => s === "01:00" && k === "due" && u === "01:30"));
  const after = checklistAlerts(DAY, tr("2026-11-19T02:07"), [toilet()]).map((a) => [a.slot, a.kind]);
  assert.deepEqual(after.at(-1), ["01:00", "late"]);
});

test("düz liste: aralık açılınca 'zamanı geldi', son saat geçince 'gecikti'; gecikmeler önce", () => {
  const acilis = listOf(DEFAULT_CHECKLISTS[0], 1);
  assert.deepEqual(checklistAlerts(DAY, tr(`${DAY}T07:59`), [acilis]), []);
  assert.deepEqual(
    checklistAlerts(DAY, tr(`${DAY}T08:07`), [acilis]).map((a) => [a.key, a.kind, a.until]),
    [["kontrol-eposta:1:2026-11-18:liste:due", "due", "11:00"]],
  );
  const at11 = checklistAlerts(DAY, tr(`${DAY}T11:07`), [toilet(), acilis]);
  assert.deepEqual(
    at11.map((a) => [a.templateId, a.slot, a.kind]),
    [
      [5, "10:00", "late"],
      [1, null, "late"],
      [5, "11:00", "due"],
    ],
  );
  const kapanis = listOf(DEFAULT_CHECKLISTS[1], 2);
  assert.deepEqual(
    checklistAlerts(DAY, tr("2026-11-19T02:07"), [kapanis]).map((a) => [a.kind, a.until]),
    [["late", "02:00"]],
  );
});

test("kapalı işaretli gün (denetim #25): hiç açılmamış listeye hatırlatma yok; açılmış liste yine hatırlatılır", () => {
  const acilis = listOf(DEFAULT_CHECKLISTS[0], 1);
  const started = toilet([1]);
  // Açık gün: ikisi de hatırlatılır
  assert.deepEqual(remindableLists([acilis, started], false), [acilis, started]);
  // Kafe kapalı: yalnız açılmış (kaydı olan) liste; zilin dünkü listeler kuralı (`!closed || l.run`)
  assert.deepEqual(remindableLists([acilis, started], true), [started]);
  assert.deepEqual(checklistAlerts(DAY, tr(`${DAY}T11:07`), remindableLists([acilis, toilet()], true)), []);
  const kept = checklistAlerts(DAY, tr(`${DAY}T11:07`), remindableLists([acilis, started], true));
  assert.ok(kept.length > 0 && kept.every((a) => a.templateId === 5));
  // Kaydı açılıp yanıtı geri alınmış liste de açılmış sayılır
  assert.equal(remindableLists([{ ...acilis, hasRun: true }], true).length, 1);
  // İş kapalı günü okur ve listeleri süzgeçten geçirir
  const run = read("src/server/notify/checklist-alerts.ts");
  assert.match(run, /import \{ closedMarksOn, isClosedDay \} from "@\/server\/closed-days";/);
  assert.match(run, /isClosedDay\(day, db\), closedMarksOn\(day, db\)/);
  // Kapalı gün şubenin olabilir (denetim 13 Kasım KP-05): işaretin kapsamadığı şubenin listeleri yine hatırlatılır
  assert.match(run, /checklistAlerts\(day, now, remindableLists\(all, closed\)\), \.\.\.\(closed \? checklistAlerts\(day, now, loaded\.filter\(\(l\) => !shut\(l\)\)\) : \[\]\)/);
  assert.match(read("src/server/checklists/store.ts"), /hasRun: Boolean\(run\),/);
});

test("kime gider: şubeli listede o şubenin ve şubesiz personel; şubesiz listede herkes", () => {
  assert.equal(alertReaches("tuzla", { branchId: "tuzla" }), true);
  assert.equal(alertReaches("tuzla", { branchId: null }), true);
  assert.equal(alertReaches("tuzla", { branchId: "marina" }), false);
  assert.equal(alertReaches(null, { branchId: "marina" }), true);
});

test("kime gider (vardiya planıyla): o an vardiyada olana; kimse yoksa o gün çalışacaklara; plan yoksa bütün personele", () => {
  const users = [
    { id: 1, role: "admin" as const, branchId: null },
    { id: 2, role: "staff" as const, branchId: "tuzla" },
    { id: 3, role: "staff" as const, branchId: "tuzla" },
    { id: 4, role: "staff" as const, branchId: "marina" },
    { id: 5, role: "staff" as const, branchId: null },
  ];
  const ids = (branch: string | null, shifts: Parameters<typeof alertRecipients>[2], date: string, minute: number) => alertRecipients(branch, users, shifts, { date, minute }).map((u) => u.id);
  const plan = [
    // Tuzla: 2 sabahçı (09:00–18:00), 3 akşamcı (16:00–01:00); Marina: 4 sabahçı (09:30–18:30)
    { branchId: "tuzla", userId: 2, date: "2026-11-24", startMin: 540, endMin: 1080 },
    { branchId: "tuzla", userId: 3, date: "2026-11-24", startMin: 960, endMin: 1500 },
    { branchId: "marina", userId: 4, date: "2026-11-24", startMin: 570, endMin: 1110 },
  ];
  // 10:00 ve 14:00: Tuzla'nın listesi sabahçıya; 18:00: sabahçı çıktı (bitiş dahil değil), akşamcıya; 22:00: akşamcıya
  assert.deepEqual(ids("tuzla", plan, "2026-11-24", 600), [2]);
  assert.deepEqual(ids("tuzla", plan, "2026-11-24", 840), [2]);
  assert.deepEqual(ids("tuzla", plan, "2026-11-24", 1080), [3]);
  assert.deepEqual(ids("tuzla", plan, "2026-11-24", 1320), [3]);
  // İki vardiyanın kesiştiği saatte ikisine de
  assert.deepEqual(ids("tuzla", plan, "2026-11-24", 1000), [2, 3]);
  // Gece yarısını geçen vardiya ertesi günün ilk saatinde de vardiyadadır (dün başladı)
  assert.deepEqual(ids("tuzla", plan, "2026-11-25", 30), [3]);
  // 01:00'de vardiya bitti: az önce çıkana (son 2 saatte biten); 03:30'da yakın vardiya da yok, yeni gün için plan yok:
  // bütün personele düşer
  assert.deepEqual(ids("tuzla", plan, "2026-11-25", 60), [3]);
  assert.deepEqual(ids("tuzla", plan, "2026-11-25", 210), [2, 3, 5]);
  // 22:00 kapanış hatırlatması, akşamcı 14–22: vardiyası tam 22:00'de bitti; sabahçıya değil ona gider
  const closing = [
    { branchId: "tuzla", userId: 2, date: "2026-11-24", startMin: 480, endMin: 960 },
    { branchId: "tuzla", userId: 3, date: "2026-11-24", startMin: 840, endMin: 1320 },
  ];
  assert.deepEqual(ids("tuzla", closing, "2026-11-24", 1320), [3]);
  // Marina'nın listesi Marina'nın vardiyasına; şubesiz liste bütün şubelerde o an vardiyada olanlara
  assert.deepEqual(ids("marina", plan, "2026-11-24", 600), [4]);
  assert.deepEqual(ids(null, plan, "2026-11-24", 600), [2, 4]);
  // O an kimse vardiyada değil (08:00): 2 saat içinde başlayana (09:00 sabahçı); yakında kimse yoksa (06:00) o gün o
  // şubede çalışacak herkese
  assert.deepEqual(ids("tuzla", plan, "2026-11-24", 480), [2]);
  assert.deepEqual(ids("tuzla", plan, "2026-11-24", 360), [2, 3]);
  // Vardiyaya yazılan yönetici de alır
  assert.deepEqual(ids("tuzla", [{ branchId: "tuzla", userId: 1, date: "2026-11-24", startMin: 540, endMin: 1080 }], "2026-11-24", 600), [1]);
  // O gün için plan yok (ya da plandaki hesap pasif: listede yok): eskisi gibi şubenin personeli ve şubesiz personel
  assert.deepEqual(ids("tuzla", [], "2026-11-24", 600), [2, 3, 5]);
  assert.deepEqual(ids("tuzla", [{ branchId: "tuzla", userId: 99, date: "2026-11-24", startMin: 540, endMin: 1080 }], "2026-11-24", 600), [2, 3, 5]);
  assert.deepEqual(ids("tuzla", plan, "2026-11-26", 600), [2, 3, 5]);
  assert.deepEqual(ids(null, [], "2026-11-24", 600), [2, 3, 4, 5]);
});

test("e-posta: konu, gecikme önce, eksik maddeler, listeyi aç bağlantısı; ödeme yok", () => {
  const alerts = checklistAlerts(DAY, tr(`${DAY}T11:07`), [toilet()]);
  const m = renderChecklistAlert(alerts, DAY);
  assert.equal(m.subject, "Tuvalet çizelgesi · 10:00 gecikti (+1)");
  assert.match(m.text, /GECİKTİ: Tuvalet çizelgesi · 10:00 gecikti/);
  assert.match(m.text, /ZAMANI GELDİ: Tuvalet çizelgesi · 11:00 zamanı geldi/);
  assert.match(m.text, /Son saat 11:00 geçti; 3 madde yapılmadı/);
  assert.match(m.text, /- 10:00 Tuvalet fotoğrafı/);
  assert.match(m.text, /\/panel\/kontrol\/5/);
  assert.match(m.html, /Listeyi aç/);
  assert.doesNotMatch(m.html, /₺|TL\b/);
  // HTML: her uyarının rozeti (kelimeyle), başlığı, açıklaması, eksik maddeleri ve kendi "Listeyi aç" bağlantısı; tek h1
  assert.equal(m.html.split(">Listeyi aç</a>").length - 1, 2);
  assert.equal(m.html.split(/href="[^"]*\/panel\/kontrol\/5"/).length - 1, 2);
  assert.match(m.html, />Gecikti<\/span>/);
  assert.match(m.html, />Zamanı geldi<\/span>/);
  assert.match(m.html, /<h1[^>]*>Tuvalet çizelgesi · 10:00 gecikti<\/h1>/);
  assert.match(m.html, /<h2[^>]*>Tuvalet çizelgesi · 11:00 zamanı geldi<\/h2>/);
  assert.equal(m.html.split("<h1").length - 1, 1);
  assert.match(m.html, /Son saat 11:00 geçti; 3 madde yapılmadı/);
  assert.match(m.html, />10:00 Tuvalet fotoğrafı</);
  const one = renderChecklistAlert(checklistAlerts(DAY, tr(`${DAY}T08:07`), [listOf(DEFAULT_CHECKLISTS[0], 1)]), DAY);
  assert.equal(one.subject, "Açılış listesi zamanı geldi");
  // En çok ALERT_MISSING_MAX madde, fazlası "ve N madde daha"; madde adı HTML'e kaçışla girer
  const many = renderChecklistAlert(
    [{ key: "k", kind: "late", templateId: 2, listName: "Kapanış", branchId: null, slot: null, until: "23:30", missing: ["<b>Kasa</b> sayıldı", "a", "b", "c", "d", "e", "f", "g"] }],
    DAY,
  );
  assert.match(many.html, /&lt;b&gt;Kasa&lt;\/b&gt; sayıldı/);
  assert.doesNotMatch(many.html, /<b>Kasa<\/b>/);
  assert.match(many.html, />e</);
  assert.doesNotMatch(many.html, />f</);
  assert.match(many.html, />ve 2 madde daha</);
  assert.match(many.text, /\nve 2 madde daha\nListeyi aç: .*\/panel\/kontrol\/2\n/);
  // Outlook masaüstü: düzen tablo; ölçülü div (onay kutusu tablo hücresi), flex/grid ve resim yok (kabuğun logosu dışında)
  for (const h of [m.html, many.html]) assert.doesNotMatch(withoutLogo(h), /display:\s*(?:flex|grid)|<img\b|<div[^>]*style="(?:[^"]*;)?\s*(?:width|height):/i);
});

test("kaynak: saatlik tetikleyici, yetki, tek tek gönderim ve sahiplenme", () => {
  const wf = read(".github/workflows/kontrol-hatirlatma.yml");
  // Günde 4 bildirim saati (UTC 07, 11, 15, 19 = Türkiye 10, 14, 18, 22); 10:00'dan önce ve 01:00'dan sonra çağrı yok
  assert.match(wf, /cron: "7,37 7,11,15,19 \* \* \*"/);
  assert.match(wf, /secrets\.CRON_SECRET/);
  assert.match(wf, /\/api\/cron\/kontrol/);
  // Sır yoksa iş kırmızı biter (yeşil bitip hatırlatmaların gitmediğini saklamaz)
  assert.match(wf, /if \[ -z "\$CRON_SECRET" \]; then\n\s+echo "::error::[^"]+"\n\s+exit 1/);
  const route = read("src/app/api/cron/kontrol/route.ts");
  assert.match(route, /rejectUnlessCron\(request\)/);
  // Her çalışma job_runs'a; gidemeyen e-posta 500 (GitHub işi kırmızı)
  assert.match(route, /startJobRun\("kontrol"\)/);
  assert.match(route, /finishJobRun\(runId, outcome\)/);
  assert.match(route, /status: ok \? 200 : 500/);
  const run = read("src/server/notify/checklist-alerts.ts");
  // Her kişiye kendi adresine (adresler birbirine görünmez); etkin hesap, alıcılar vardiya planından (alertRecipients)
  assert.match(run, /to: \[u\.email\]/);
  assert.match(run, /\.where\(eq\(s\.users\.active, true\)\)/);
  assert.match(run, /alertRecipients\(a\.branchId, people, shifts, at\)/);
  assert.match(run, /inArray\(s\.shifts\.date, \[at\.date, yesterday\]\), eq\(s\.shifts\.kind, "work"\), isNotNull\(s\.shifts\.userId\)/);
  assert.match(run, /emailEnabled/);
  // Gönderimden önce sahiplenme (aynı uyarı iki kez gitmez)
  assert.ok(run.indexOf("onConflictDoNothing") < run.indexOf("sendEmail("));
});

test("canlı yoklama tetiklemesi: sunucu örneği başına en çok 5 dakikada bir; saat geri giderse yeniden", () => {
  assert.equal(ALERT_POLL_GAP_MS, 5 * 60_000);
  const t = Date.parse("2026-11-20T10:00:00Z");
  assert.equal(alertPollDue(t, 0), true);
  assert.equal(alertPollDue(t + 4 * 60_000, t), false);
  assert.equal(alertPollDue(t + 5 * 60_000, t), true);
  assert.equal(alertPollDue(t - 60_000, t), true);
});

test("kaynak: /api/canli hatırlatma işini yanıttan sonra, 304'ten önce, girişli istekte tetikler", () => {
  const route = read("src/app/api/canli/route.ts");
  const auth = route.indexOf('status: 401');
  const claim = route.indexOf("claimChecklistAlertPoll()");
  const notModified = route.indexOf("status: 304");
  assert.ok(auth > 0 && claim > auth, "girişsiz istek tetiklemez");
  assert.ok(notModified > claim, "değişiklik yoksa (304) da tetikler");
  // after() içinde: yanıt beklemez; hata yanıtı bozmaz
  assert.match(route.slice(claim, notModified), /after\(async \(\) => \{\s*const startedAt = new Date\(\);\s*try \{\s*const r = await runChecklistAlerts\(/);
  // Bir şey gönderdiyse ya da gidemediyse job_runs'a (izleme); hata da
  assert.match(route.slice(claim, notModified), /if \(r\.sent \|\| r\.failed\) await recordJobRun\("kontrol"/);
  const run = read("src/server/notify/checklist-alerts.ts");
  assert.match(run, /export function claimChecklistAlertPoll[\s\S]*isEmailConfigured\(\)[\s\S]*alertPollDue\(/);
});

test("bildirim saatleri: günde 4 kez, 4 saat arayla; ilk 10:00'dan önce değil, son 01:00'dan sonra değil", () => {
  assert.deepEqual(ALERT_SEND_MINUTES, [600, 840, 1080, 1320]);
  assert.ok(ALERT_SEND_MINUTES.length >= 3 && ALERT_SEND_MINUTES.length <= 4);
  assert.ok(Math.min(...ALERT_SEND_MINUTES) >= ALERT_FIRST_MIN && ALERT_FIRST_MIN === 10 * 60);
  // Son saat ve bekleme payı ertesi gün 01:00'ı (25 * 60) geçmez
  assert.ok(Math.max(...ALERT_SEND_MINUTES) + ALERT_SEND_GRACE_MIN <= ALERT_LAST_MIN && ALERT_LAST_MIN === 25 * 60);
  // Hiçbir saat gece yarısından sonra değil (sabah 01:00 sonrası dahil)
  assert.ok(ALERT_SEND_MINUTES.every((m) => m < 24 * 60));
});

test("alertSendInstant: yalnız bildirim saatini izleyen ilk saatte o saatin anını verir; öteki zaman null", () => {
  const at = (local: string) => alertSendInstant(tr(`${DAY}T${local}`))?.toISOString() ?? null;
  const slot = (h: string) => tr(`${DAY}T${h}`).toISOString();
  // 10:00'dan önce hiç (önceden 08:07'de ilk e-posta giderdi)
  for (const early of ["00:00", "05:00", "07:07", "08:07", "09:07", "09:59"]) assert.equal(at(early), null, early);
  // Saat başını izleyen ilk saat: o saatin anı (geç çalışan iş de aynı anı bulur)
  assert.equal(at("10:00"), slot("10:00"));
  assert.equal(at("10:07"), slot("10:00"));
  assert.equal(at("10:59"), slot("10:00"));
  assert.equal(at("14:37"), slot("14:00"));
  assert.equal(at("18:20"), slot("18:00"));
  assert.equal(at("22:59"), slot("22:00"));
  // Saatler arası ve gece: hiç (önceden 02:07'ye kadar saat başı giderdi)
  for (const quiet of ["11:00", "11:07", "12:07", "13:59", "15:07", "17:59", "19:07", "21:59", "23:00", "23:30"]) assert.equal(at(quiet), null, quiet);
  for (const night of ["2026-11-19T00:07", "2026-11-19T01:00", "2026-11-19T01:07", "2026-11-19T02:07", "2026-11-19T03:07"]) assert.equal(alertSendInstant(tr(night)), null, night);
  // Yılın her gününde tek bir 24 saatlik taramada en çok 4 saat dilimi ve hepsi 10:00–23:00 arası
  const hours = new Set<string>();
  for (let m = 0; m < 24 * 60; m += 5) {
    const instant = alertSendInstant(new Date(tr("2026-11-18T00:00").getTime() + m * 60_000));
    if (instant) hours.add(new Date(instant.getTime() + 3 * 3600_000).toISOString().slice(11, 16));
  }
  assert.deepEqual([...hours].sort(), ["10:00", "14:00", "18:00", "22:00"]);
});

test("bildirim saatinde hatırlatma o saatin anına göre: 10:00'da Açılış ve 10:00 saati, 10:50'de gelen 11:00 saati beklemez", () => {
  const acilis = listOf(DEFAULT_CHECKLISTS[0], 1);
  // Geç çalışan iş (10:55) 11:00 saatinin penceresini (10:50) görür ama 10:00 anına göre hesaplar: yeni e-posta çıkmaz
  const now = tr(`${DAY}T10:55`);
  const at = alertSendInstant(now)!;
  const alerts = checklistAlerts(DAY, at, [toilet(), acilis]);
  assert.deepEqual(
    alerts.map((a) => [a.templateId, a.slot, a.kind]),
    [
      [5, "10:00", "due"],
      [1, null, "due"],
    ],
  );
  // 14:00 anında: gecikenler ve 14:00 saati bir e-postada (11:00'ınki 2 saati geçti, düşer)
  const at14 = checklistAlerts(DAY, alertSendInstant(tr(`${DAY}T14:07`))!, [toilet()]);
  assert.deepEqual(
    at14.map((a) => [a.slot, a.kind]),
    [
      ["12:00", "late"],
      ["13:00", "late"],
      ["14:00", "due"],
    ],
  );
});

test("kaynak: iş bildirim saati dışında hiçbir şey göndermez; yoklama da başlamaz", () => {
  const run = read("src/server/notify/checklist-alerts.ts");
  // Saat kapısı e-posta ayarından ve veritabanından önce
  assert.match(run, /const now = alertSendInstant\(clock\);\s*if \(!now\) return \{ skipped: "bildirim saati değil/);
  assert.ok(run.indexOf("alertSendInstant(clock)") < run.indexOf("isEmailConfigured()"));
  assert.ok(run.indexOf("alertSendInstant(clock)") < run.indexOf("loadNotifySettings()"));
  assert.match(run, /claimChecklistAlertPoll[\s\S]*alertSendInstant\(new Date\(nowMs\)\)/);
});

// Vardiya bildirimleri (Dalga 2; docs/VARDIYA.md › Bildirimler): vardiyası değişen kişiye "Vardiyanız değişti" (push,
// yoksa e-posta) ve gelecek haftanın planı Perşembe akşamına kadar yazılmadıysa yöneticiye hatırlatma (zil + günlük iş).
// Saf kurallar src/lib/vardiya-bildirim.ts, e-posta src/server/notify/vardiya-template.ts; kayıt yolu yalnız değişiklikleri
// döndürür (PR #120'nin kayıt mantığına dokunulmadı), gönderim kayıttan sonra.
// Çalıştırma: npx tsx --test tests/vardiya-bildirim.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { dailyOutcome, stepTexts, vardiyaStep } from "../src/lib/job-health";
import type { ShiftCell, ShiftEntry } from "../src/lib/vardiya";
import {
  missingPlans,
  planReminderText,
  planReminderWeek,
  shiftChangeLine,
  shiftChangeNotice,
  shiftChanges,
  SHIFT_NOTICE_LINES,
} from "../src/lib/vardiya-bildirim";
import { renderShiftChange } from "../src/server/notify/vardiya-template";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const work = (start: number, end: number, note: string | null = null): ShiftCell => ({ kind: "work", startMin: start * 60, endMin: end * 60, note });
const off: ShiftCell = { kind: "off", note: null };
const entry = (date: string, ref: string, cell: ShiftCell, name = "Ayşe"): ShiftEntry => ({ date, ref, userId: ref.startsWith("u:") ? Number(ref.slice(2)) : null, name, cell });
/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);

// Hafta: 30 Kasım (Pzt) – 6 Aralık 2026; bugün 1 Aralık Salı
const TODAY = "2026-12-01";

test("değişen ve silinen kayıtlı kutu kişiye bildirilir; geçmiş gün, hesapsız çalışan ve kaydı yapan bildirilmez", () => {
  const before = [
    entry("2026-11-30", "u:7", work(10, 18)), // geçmiş gün (Pazartesi)
    entry("2026-12-01", "u:7", work(10, 18)),
    entry("2026-12-03", "u:7", off),
    entry("2026-12-02", "n:ali", work(10, 18), "Ali"),
    entry("2026-12-02", "u:1", work(10, 18), "Yönetici"),
  ];
  const upserts = [
    entry("2026-11-30", "u:7", work(12, 20)),
    entry("2026-12-01", "u:7", work(12, 20)),
    entry("2026-12-02", "n:ali", work(12, 20), "Ali"),
    entry("2026-12-02", "u:1", work(12, 20), "Yönetici"),
  ];
  const deletes = [{ date: "2026-12-03", ref: "u:7" }];
  const out = shiftChanges({ before, upserts, deletes, today: TODAY, by: 1 });
  assert.deepEqual(out, [
    { userId: 7, date: "2026-12-01", before: work(10, 18), after: work(12, 20) },
    { userId: 7, date: "2026-12-03", before: off, after: null },
  ]);
});

test("haftanın ilk yazımı bildirim değil; kişinin o haftada kaydı varken eklenen gün bildirilir; yalnız ad değişikliği değil", () => {
  const before = [entry("2026-12-01", "u:7", work(10, 18))];
  const upserts = [
    entry("2026-12-02", "u:7", work(10, 18)), // Ayşe'nin haftası yazılı: yeni gün bildirilir
    entry("2026-12-02", "u:8", work(10, 18), "Zeynep"), // Zeynep'in haftası ilk kez yazılıyor: bildirim yok
    entry("2026-12-01", "u:7", work(10, 18), "Ayşe Yılmaz"), // aynı hücre, yalnız ad
  ];
  const out = shiftChanges({ before, upserts, deletes: [], today: TODAY });
  assert.deepEqual(out, [{ userId: 7, date: "2026-12-02", before: null, after: work(10, 18) }]);
  assert.deepEqual(shiftChanges({ before: [], upserts, deletes: [], today: TODAY }), [], "plan baştan yazılırken kimseye ileti gitmez");
});

test("satırlar: eski → yeni, yeni gün, kaldırılan; bildirim en çok üç gün, adres haftayı ve şubeyi açar", () => {
  assert.equal(shiftChangeLine({ date: "2026-12-01", before: work(10, 18), after: work(12, 20) }), "1 Aralık Salı: 10:00–18:00 → 12:00–20:00");
  assert.equal(shiftChangeLine({ date: "2026-12-02", before: null, after: work(10, 18, "kasa") }), "2 Aralık Çarşamba: 10:00–18:00 · kasa (yeni)");
  assert.equal(shiftChangeLine({ date: "2026-12-03", before: off, after: null }), "3 Aralık Perşembe: İzin kaldırıldı");
  assert.equal(shiftChangeLine({ date: "2026-12-04", before: off, after: work(18, 26) }), "4 Aralık Cuma: İzin → 18:00–02:00");
  const changes = ["2026-12-01", "2026-12-02", "2026-12-04", "2026-12-05", "2026-12-06"].map((date) => ({ date, before: work(10, 18), after: work(12, 20) }));
  const n = shiftChangeNotice(changes, { id: "marina", name: "Marina" }, { manyBranches: true });
  assert.equal(n.title, "Vardiyanız değişti · Marina");
  assert.equal(n.body.split(" · ").length, SHIFT_NOTICE_LINES + 1);
  assert.match(n.body, /ve 2 gün daha$/);
  assert.equal(n.lines.length, 5, "e-posta bütün günleri yazar");
  assert.equal(n.url, "/panel/vardiya?hafta=2026-11-30&sube=marina");
  assert.equal(n.tag, "vardiya-marina-2026-11-30");
  assert.equal(n.week, "30 Kasım – 6 Aralık 2026");
  assert.equal(shiftChangeNotice(changes.slice(0, 1), { id: "tuzla", name: "Tuzla" }, { manyBranches: false }).title, "Vardiyanız değişti");
  assert.ok(!/₺|maaş/i.test(n.body), "tutar yok");
});

test("e-posta: konu, günler, Vardiyayı aç bağlantısı; tutar yok", () => {
  const n = shiftChangeNotice([{ date: "2026-12-01", before: work(10, 18), after: work(12, 20) }], { id: "tuzla", name: "Tuzla" }, { manyBranches: false });
  const m = renderShiftChange({ name: "Ayşe Yılmaz", title: n.title, branchName: "Tuzla", week: n.week, lines: n.lines, url: n.url }, TODAY);
  assert.equal(m.subject, "Vardiyanız değişti");
  assert.match(m.text, /Ayşe, planınızda şu günler değişti:/);
  assert.match(m.text, /- 1 Aralık Salı: 10:00–18:00 → 12:00–20:00/);
  assert.match(m.text, /Vardiyayı aç: https:\/\/[^/]+\/panel\/vardiya\?hafta=2026-11-30&sube=tuzla/);
  assert.match(m.html, /Vardiyayı aç<\/a>/);
  assert.match(m.html, /hafta=2026-11-30&amp;sube=tuzla/, "bağlantı HTML'de kaçışlı");
  assert.ok(!/₺/.test(m.html + m.text), "tutar yok");
});

test("hatırlatma zamanı: Perşembe 18:00'den Pazar sonuna (Türkiye); gelecek haftanın Pazartesi'si", () => {
  assert.equal(planReminderWeek(tr("2026-11-25T23:00")), null, "Çarşamba");
  assert.equal(planReminderWeek(tr("2026-11-26T17:59")), null, "Perşembe akşamdan önce");
  assert.equal(planReminderWeek(tr("2026-11-26T18:00")), "2026-11-30");
  assert.equal(planReminderWeek(tr("2026-11-27T08:30")), "2026-11-30", "Cuma sabahı günlük iş");
  assert.equal(planReminderWeek(tr("2026-11-29T23:59")), "2026-11-30", "Pazar gece");
  assert.equal(planReminderWeek(tr("2026-11-30T00:01")), null, "Pazartesi: hafta başladı");
  assert.deepEqual(missingPlans([{ id: "tuzla" }, { id: "marina" }], new Map([["tuzla", 12]])), [{ id: "marina" }]);
  const t = planReminderText({ id: "marina", name: "Marina" }, "2026-11-30", { manyBranches: true });
  assert.equal(t.title, "Marina: gelecek haftanın vardiyası yazılmadı");
  assert.equal(t.href, "/panel/vardiya?hafta=2026-11-30&sube=marina");
  assert.equal(t.id, "vardiya-plan-marina-2026-11-30");
  assert.equal(planReminderText({ id: "tuzla", name: "Tuzla" }, "2026-11-30", { manyBranches: false }).title, "Gelecek haftanın vardiyası yazılmadı");
});

test("günlük işin adımı: yalnız bildirim denenince yazılır; cihaz yoksa sorun değil, hiçbirine gidemediyse hata", () => {
  assert.equal(vardiyaStep({ status: "skip", tried: 0, sent: 0, failed: 0 }), undefined);
  assert.equal(vardiyaStep({ status: "sent", tried: 0, sent: 0, failed: 0 }), undefined, "bugün zaten gönderildi");
  assert.deepEqual(vardiyaStep({ status: "sent", tried: 1, sent: 2, failed: 0 }), { code: "sent" });
  assert.deepEqual(vardiyaStep({ status: "sent", tried: 1, sent: 0, failed: 0 }), { code: "nodevice" });
  assert.equal(vardiyaStep({ status: "sent", tried: 1, sent: 0, failed: 2 })?.code, "error");
  assert.equal(vardiyaStep({ error: "süre doldu" })?.code, "error");
  const base = { sync: { code: "ok" }, digest: { code: "sent" }, reminders: { code: "ok" }, karaoke: { code: "ok" }, menu: { code: "ok" }, sales: { code: "ok" } };
  const o = dailyOutcome({ ...base, vardiya: { code: "nodevice" } });
  assert.equal(o.status, "ok");
  assert.equal(o.steps.vardiya, "nodevice");
  assert.ok(stepTexts(o.steps).some((t) => t.startsWith("Gelecek haftanın vardiyası yazılmadı")), "Ayarlar › Günlük işler sözcüğü");
  assert.equal(dailyOutcome({ ...base, vardiya: { code: "error", error: "x" } }).status, "partial");
});

test("kaynak: kayıt yolu değişiklikleri kayıttan önceki hâlle karşılaştırır; eylem kayıttan sonra bildirir; push kişiye özel", () => {
  const store = read("src/server/vardiya/store.ts");
  assert.match(store, /const changes = shiftChanges\(\{ before: entries, upserts: diff\.upserts, deletes: diff\.deletes, today: todayTR\(now\) \}\);/);
  const action = read("src/server/actions/vardiya.ts");
  assert.match(action, /notifyShiftChanges\(r\.changes\.filter\(\(c\) => c\.userId !== me\.id\), r\.branch\);/, "kaydı yapan kendine bildirim almaz");
  const notify = read("src/server/vardiya/notify.ts");
  assert.match(notify, /^import "server-only";/);
  assert.match(notify, /after\(\(\) =>/, "bildirim yanıttan sonra");
  assert.match(notify, /if \(push\.sent\) \{\s+run\.pushed\+\+;\s+continue;\s+\}/, "push gittiyse e-posta yok");
  assert.match(notify, /mail = settings\?\.emailEnabled \?/, "e-posta 'Hatırlatma e-postaları' anahtarına uyar");
  assert.match(notify, /key: `vardiya-plan:\$\{b\.id\}:\$\{monday\}:\$\{today\}`/, "günlük işin bildirimi şube, hafta ve gün başına bir kez");
  const send = read("src/server/push/send.ts");
  assert.match(send, /if \(topic === "shifts" && !opts\.userIds\) return result;/, "alıcısız vardiya bildirimi herkese gitmez");
  assert.match(read("src/server/actions/notifications.ts"), /safe\("vardiya", currentBranchScope\(\)\.then\(\(scope\) => vardiyaBell\(scope\)\)\)/);
  assert.match(read("src/app/api/cron/gunluk/route.ts"), /pushPlanReminders\(getDb\(\), new Date\(\)\)/);
  assert.match(read("src/lib/live-poll.ts"), /if \(kind === "shifts"\) return path\.startsWith\("\/panel\/vardiya"\);/);
});

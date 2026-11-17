// Kontrol listesi e-posta hatırlatmaları (src/lib/checklist-alerts.ts, src/server/notify/checklist-alert-template.ts):
// saatlik bölümün "zamanı geldi" ve "gecikti" anları, düz listenin aralığı, biten saat, eski gecikme, kime gider,
// e-postanın metni ve tetikleyicinin kaynak denetimleri. Saatler Türkiye (UTC+3).
// Çalıştırma: npx tsx --test tests/kontrol-hatirlatma.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { alertReaches, checklistAlerts, LATE_ALERT_MIN, type AlertList } from "../src/lib/checklist-alerts";
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

test("kime gider: şubeli listede o şubenin ve şubesiz personel; şubesiz listede herkes", () => {
  assert.equal(alertReaches("tuzla", { branchId: "tuzla" }), true);
  assert.equal(alertReaches("tuzla", { branchId: null }), true);
  assert.equal(alertReaches("tuzla", { branchId: "marina" }), false);
  assert.equal(alertReaches(null, { branchId: "marina" }), true);
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
  const one = renderChecklistAlert(checklistAlerts(DAY, tr(`${DAY}T08:07`), [listOf(DEFAULT_CHECKLISTS[0], 1)]), DAY);
  assert.equal(one.subject, "Açılış listesi zamanı geldi");
});

test("kaynak: saatlik tetikleyici, yetki, tek tek gönderim ve sahiplenme", () => {
  const wf = read(".github/workflows/kontrol-hatirlatma.yml");
  assert.match(wf, /cron: "7 5-23 \* \* \*"/);
  assert.match(wf, /secrets\.CRON_SECRET/);
  assert.match(wf, /\/api\/cron\/kontrol/);
  const route = read("src/app/api/cron/kontrol/route.ts");
  assert.match(route, /rejectUnlessCron\(request\)/);
  const run = read("src/server/notify/checklist-alerts.ts");
  // Her personele kendi adresine (adresler birbirine görünmez); personel rolü, etkin hesap
  assert.match(run, /to: \[u\.email\]/);
  assert.match(run, /eq\(s\.users\.role, "staff"\)/);
  assert.match(run, /emailEnabled/);
  // Gönderimden önce sahiplenme (aynı uyarı iki kez gitmez)
  assert.ok(run.indexOf("onConflictDoNothing") < run.indexOf("sendEmail("));
});

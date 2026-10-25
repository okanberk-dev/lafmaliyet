// Personelin kontrol geçmişi Bugün'de (dalga 10 §2.5; src/app/panel/bugun/rows-ops.ts checklistYesterday): dünün
// kontrol listeleri satırı personelde yapılacaktır (sorun değil), yalnız açık sorunları ve başlamış listelerin eksik
// maddelerini yazar, dünün kasa raporu yoksa hiç açılmamış listeleri yazmaz, "Geçmişe bak" ile son 7 günün geçmişine
// götürür ve başka yapılacak satır varken sıradaki iş olmaz (dünün kasası önce gelir).
// Saatler sabit: tr("2026-10-22T09:00") Türkiye'de 22 Ekim Perşembe 09:00 (UTC+3).
// Çalıştırma: npx tsx --test tests/kontrol-gecmis.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { dayTasks, splitTasks, type CashLite, type DayFacts, type DayTask } from "../src/app/panel/bugun/logic";
import type { ChecklistLite, IssueLite, RunLite } from "../src/lib/checklists";

const tr = (local: string) => new Date(`${local}:00+03:00`);
const STOCK = { month: "2026-10", counted: 0, total: 40, prevMonth: "2026-09", prevHasData: true, prevCounted: 40, prevTotal: 40 };
const YESTERDAY = "2026-10-21";

function report(date: string): CashLite {
  return { date, cashDiff: 0, zTotal: 12400, cash: 3100, card: 9300, submittedByName: "Mehmet", revision: 1, note: null };
}

function checklist(templateId: number, name: string, opensAt: string, dueAt: string, run: Partial<RunLite> | null = null): ChecklistLite {
  return {
    templateId,
    name,
    opensAt,
    dueAt,
    required: run?.required ?? 11,
    photos: 2,
    staffAllowed: true,
    run: run
      ? {
          required: 11,
          done: 0,
          complete: false,
          photosLeft: 0,
          photos: 0,
          missing: [],
          issues: [],
          contributors: ["Ayşe"],
          firstAt: tr("2026-10-21T22:10").toISOString(),
          lastAt: tr("2026-10-21T23:40").toISOString(),
          completedAt: null,
          ...run,
        }
      : null,
  };
}

const RANGE: IssueLite = {
  answerId: 41,
  itemId: 2,
  label: "Bar buzdolabı sıcaklığı",
  text: "Bar buzdolabı sıcaklığı: 6 °C (0–4 °C)",
  note: "kapı açık kalmış",
  by: "Ayşe",
  at: tr("2026-10-21T22:12").toISOString(),
  open: true,
  versions: 0,
  kind: "range",
};
const FIXED: IssueLite = { ...RANGE, answerId: 42, open: false, text: "Bar buzdolabı sıcaklığı: 6 °C → 3,5 °C" };

/** Personel; dünün kasa raporu var (kafe açıktı), bugünün listesi yok */
function staff(now: Date, o: Partial<DayFacts> = {}): DayFacts {
  return { role: "staff", now, cash: { today: null, yesterday: report(YESTERDAY), firstDate: "2026-10-01" }, waste: { count: 0, zayi: null, ikram: null }, stock: STOCK, checklists: { day: "2026-10-22", lists: [] }, ...o };
}

const yesterday = (...lists: ChecklistLite[]) => ({ day: YESTERDAY, lists });
const row = (tasks: DayTask[]) => tasks.find((t) => t.key === "liste-dun");

test("1. personel: dünün başlamış listesinin eksiği yapılacak satırı; Geçmişe bak; son 7 günün geçmişine", () => {
  const r = row(dayTasks(staff(tr("2026-10-22T14:00"), { checklistsYesterday: yesterday(checklist(2, "Kapanış", "22:00", "02:00", { done: 13, required: 16, missing: ["A", "B", "C"] })) })));
  assert.ok(r);
  assert.equal(r.status, "todo");
  assert.equal(r.title, "Dünkü kontrol listeleri");
  assert.equal(r.badge, "1 eksik");
  assert.equal(r.detail, "Kapanış: 3 madde yapılmadı");
  assert.equal(r.href, "/panel/kontrol/gecmis?gun=2026-10-21");
  assert.equal(r.action, "Geçmişe bak");
});

test("2. personel 09:00: Açılış açık + dünün listesi: sıradaki Açılış (liste-1), dünün satırı değil", () => {
  const f = staff(tr("2026-10-22T09:00"), {
    checklists: { day: "2026-10-22", lists: [checklist(1, "Açılış", "08:00", "11:00")] },
    checklistsYesterday: yesterday(checklist(2, "Kapanış", "22:00", "02:00", { done: 13, required: 16 })),
  });
  const tasks = dayTasks(f);
  assert.ok(row(tasks));
  assert.equal(splitTasks(tasks).next?.key, "liste-1");
});

test("3. personel 10:30: dünün kasası girilmedi + dünün listesi: sıradaki dünün kasası; sıra kasa-dun → liste-dun", () => {
  const f = staff(tr("2026-10-22T10:30"), {
    cash: { today: null, yesterday: null, firstDate: "2026-10-01" },
    checklistsYesterday: yesterday(checklist(2, "Kapanış", "22:00", "02:00", { done: 13, required: 16 })),
  });
  const tasks = dayTasks(f);
  const order = tasks.map((t) => t.key);
  assert.ok(order.indexOf("kasa-dun") >= 0 && order.indexOf("kasa-dun") < order.indexOf("liste-dun"), order.join());
  assert.equal(order.indexOf("liste-dun"), order.indexOf("kasa-dun") + 1);
  assert.equal(splitTasks(tasks).next?.key, "kasa-dun");
  // Yalnız dünün listesi açıksa o sıradaki olur
  const alone = dayTasks(staff(tr("2026-10-22T10:30"), { checklistsYesterday: yesterday(checklist(2, "Kapanış", "22:00", "02:00", { done: 13, required: 16 })) }));
  assert.equal(splitTasks(alone).next?.key, "liste-dun");
});

test("4. personel: düzeltilmiş sorun (open: false) sayılmaz; açık sorun sayılır", () => {
  const done = { complete: true, done: 11 };
  assert.equal(row(dayTasks(staff(tr("2026-10-22T14:00"), { checklistsYesterday: yesterday(checklist(1, "Açılış", "08:00", "11:00", { ...done, issues: [FIXED] })) }))), undefined);
  const r = row(dayTasks(staff(tr("2026-10-22T14:00"), { checklistsYesterday: yesterday(checklist(1, "Açılış", "08:00", "11:00", { ...done, issues: [FIXED, RANGE] })) })));
  assert.ok(r);
  assert.equal(r.badge, "1 sorun");
  assert.equal(r.detail, "Bar buzdolabı sıcaklığı: 6 °C (0–4 °C)");
  assert.equal(r.status, "todo");
});

test("5. personel: hiç açılmamış liste yalnız dünün kasa raporu varken yazılır", () => {
  const lists = yesterday(checklist(1, "Açılış", "08:00", "11:00", { complete: true, done: 11 }), checklist(2, "Kapanış", "22:00", "02:00"));
  const open = row(dayTasks(staff(tr("2026-10-22T14:00"), { checklistsYesterday: lists })));
  assert.equal(open?.detail, "Kapanış: hiç açılmadı");
  assert.equal(open?.badge, "1 eksik");
  // Kasa raporu yok (ya da kasa hiç kullanılmadı): açılmamış liste yazılmaz, başka bir şey yoksa satır yok
  assert.equal(row(dayTasks(staff(tr("2026-10-22T14:00"), { checklistsYesterday: lists, cash: { today: null, yesterday: null, firstDate: "2026-10-01" } }))), undefined);
  assert.equal(row(dayTasks(staff(tr("2026-10-22T14:00"), { checklistsYesterday: lists, cash: { today: null, yesterday: null, firstDate: null } }))), undefined);
  // Başlamış listenin eksiği kasa yokken de yazılır, açılmamışı yazılmaz
  const mixed = row(
    dayTasks(
      staff(tr("2026-10-22T14:00"), {
        checklistsYesterday: yesterday(checklist(1, "Açılış", "08:00", "11:00", { done: 9 }), checklist(2, "Kapanış", "22:00", "02:00")),
        cash: { today: null, yesterday: null, firstDate: "2026-10-01" },
      }),
    ),
  );
  assert.equal(mixed?.detail, "Açılış: 2 madde yapılmadı");
});

test("6. kapalı gün (§2.9): onaylıysa ve liste açılmadıysa satır yok; bekliyorsa sonuna not; personel Onaylar'a gitmez", () => {
  const lists = yesterday(checklist(2, "Kapanış", "22:00", "02:00", { done: 13, required: 16 }));
  const closedFacts = (state: "approved" | "pending") => ({ yesterday: { state, by: "Ali", requestId: 7 } });
  const unopened = yesterday(checklist(2, "Kapanış", "22:00", "02:00"));
  assert.equal(row(dayTasks(staff(tr("2026-10-22T14:00"), { checklistsYesterday: unopened, closed: closedFacts("approved") }))), undefined);
  const pending = row(dayTasks(staff(tr("2026-10-22T14:00"), { checklistsYesterday: lists, closed: closedFacts("pending") })));
  assert.equal(pending?.detail, "Kapanış: 3 madde yapılmadı · Personel kapalıydık dedi (onay bekliyor)");
  assert.equal(pending?.href, "/panel/kontrol/gecmis?gun=2026-10-21");
  assert.equal(pending?.action, "Geçmişe bak");
});

test("7. yönetici değişmedi: sorun var, hiç açılmayan liste yazılır", () => {
  const f: DayFacts = {
    role: "admin",
    now: tr("2026-10-22T14:00"),
    cash: { today: null, yesterday: report(YESTERDAY), firstDate: "2026-10-01" },
    stock: STOCK,
    system: [],
    payments: [],
    invoices: { review: 0 },
    checklistsYesterday: yesterday(checklist(2, "Kapanış", "22:00", "02:00")),
  };
  const r = row(dayTasks(f));
  assert.equal(r?.status, "warn");
  assert.equal(r?.detail, "Kapanış: hiç açılmadı");
});

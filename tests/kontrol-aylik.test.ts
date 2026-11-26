// Kontrol listelerinin aylık PDF'i (docs/KONTROL-LISTELERI.md › Aylık PDF): madde madde yanıt, durum, eksik günler, kapalı
// gün; PDF çizilir ve sayfaları okunur. Veritabanı yok.
// Çalıştırma: npx tsx --test tests/kontrol-aylik.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { PDFDocument } from "pdf-lib";

import { buildMonthReport, listBlock, monthPdfName, type MonthListInput } from "../src/lib/checklist-month";
import type { AnswerLite, ChecklistItemSnap, RunLite } from "../src/lib/checklists";
import { renderChecklistMonthPdf } from "../src/server/checklists/month-pdf";

const item = (id: number, label: string, over: Partial<ChecklistItemSnap> = {}): ChecklistItemSnap => ({ id, label, type: "check", section: null, hint: null, required: true, unit: null, min: null, max: null, ...over });
const ITEMS = [item(1, "Kahve makinesi açıldı"), item(2, "Bar buzdolabı", { type: "number", unit: "°C", min: 0, max: 4 }), item(3, "Tezgâh fotoğrafı", { type: "photo", section: "Fotoğraf" })];

const answer = (itemId: number, over: Partial<AnswerLite> = {}): AnswerLite => ({
  id: itemId,
  itemId,
  status: "ok",
  value: null,
  textValue: null,
  note: null,
  photoId: null,
  photoAt: null,
  by: "Selin",
  at: "2026-10-01T06:12:00.000Z",
  history: [],
  ...over,
});

const run = (over: Partial<RunLite> = {}): RunLite => ({
  required: 3,
  done: 3,
  complete: true,
  photosLeft: 0,
  photos: 1,
  missing: [],
  issues: [],
  contributors: ["Selin"],
  firstAt: "2026-10-01T06:00:00.000Z",
  lastAt: "2026-10-01T06:20:00.000Z",
  completedAt: "2026-10-01T06:20:00.000Z",
  ...over,
});

const list = (name: string, r: RunLite | null, answers: AnswerLite[]): MonthListInput => ({
  lite: { name, opensAt: "08:00", dueAt: "10:30", run: r },
  run: r ? { completedAt: r.completedAt, completedByName: r.complete ? "Selin" : null } : null,
  items: ITEMS,
  answers,
});

const FULL = list("Açılış", run(), [answer(1), answer(2, { value: 6, status: "issue", note: "kapı açık kalmış" }), answer(3, { photoId: 9, photoAt: "2026-10-01T06:15:00.000Z" })]);
const PARTIAL = list("Kapanış", run({ complete: false, done: 1, missing: ["Bar buzdolabı", "Tezgâh fotoğrafı"] }), [answer(1, { by: "Ali" })]);
const NONE = list("Açılış", null, []);

test("madde madde: yanıt, aralık dışı değer, fotoğraf ve işaretleyen", () => {
  const b = listBlock(FULL);
  assert.equal(b.state, "complete", "tamamlanan liste");
  assert.equal(b.stateText, "Tamamlandı · 09:20 · Selin", "tamamlanma saati Türkiye saatiyle ve tamamlayan");
  assert.equal(b.items[0].answer, "Tamam", "işaret maddesi");
  assert.equal(b.items[0].time, "09:12", "yanıt saati Türkiye saatiyle");
  assert.equal(b.items[1].answer, "6 °C (0–4 °C) · aralık dışı: kapı açık kalmış", "aralık dışı değer notuyla");
  assert.equal(b.items[1].issue, true, "aralık dışı sorun sayılmalı");
  assert.equal(b.items[2].photo, "Var", "çekilen fotoğraf");
  assert.equal(b.items[0].photo, null, "fotoğrafsız maddede fotoğraf sütunu boş");
});

test("eksik ve doldurulmamış liste", () => {
  const p = listBlock(PARTIAL);
  assert.equal(p.state, "partial", "yarım liste");
  assert.equal(p.stateText, "Eksik: 2 madde", "eksik madde sayısı");
  assert.equal(p.items[1].answer, "Yanıtsız", "yanıtsız madde");
  assert.equal(p.items[2].photo, "Yok", "çekilmemiş fotoğraf");
  const n = listBlock(NONE);
  assert.equal(n.state, "missing", "hiç doldurulmamış liste");
  assert.equal(n.stateText, "Doldurulmadı", "durum metni");
});

test("ayın raporu: toplamlar, eksik günler, kapalı gün eksik sayılmaz, başka ayın günü atlanır", () => {
  const r = buildMonthReport({
    month: "2026-10",
    branch: "Tuzla",
    days: [
      { day: "2026-10-02", lists: [PARTIAL] },
      { day: "2026-10-01", lists: [FULL] },
      { day: "2026-10-03", lists: [NONE] },
      { day: "2026-10-04", lists: [NONE] },
      { day: "2026-09-30", lists: [NONE] },
    ],
    closedDays: ["2026-10-04"],
  });
  assert.deepEqual(r.days.map((d) => d.day), ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"], "eskiden yeniye, yalnız ayın günleri");
  assert.deepEqual(r.totals, { expected: 3, complete: 1, partial: 1, missing: 1, closedDays: 1, issues: 1, photos: 1 }, "toplamlar");
  assert.deepEqual(
    r.gaps.map((g) => g.day),
    ["2026-10-02", "2026-10-03"],
    "eksik günler (kapalı gün hariç)",
  );
  assert.equal(r.days[3].closed, true, "kapalı gün işaretli");
  assert.equal(r.days[3].lists.length, 0, "kapalı günde doldurulmamış liste yazılmaz");
  assert.equal(r.title, "Ekim 2026", "ay adı");
  assert.equal(monthPdfName("2026-10", "tuzla"), "kontrol-listeleri-2026-10-tuzla.pdf", "dosya adı");
});

test("PDF çizilir: Türkçe harfler, uzun ay birden çok sayfa", async () => {
  const days = Array.from({ length: 31 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, lists: [FULL, PARTIAL] }));
  const r = buildMonthReport({ month: "2026-10", branch: "Marina Şubesi", days, closedDays: [] });
  const bytes = await renderChecklistMonthPdf(r, new Date("2026-11-01T09:00:00.000Z"));
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() > 3, `31 günün iki listesi birden çok sayfa tutmalı (${doc.getPageCount()})`);
  assert.equal(doc.getTitle(), "Kontrol listeleri · Ekim 2026 · Marina Şubesi", "belgenin başlığı");
  const empty = await renderChecklistMonthPdf(buildMonthReport({ month: "2026-10", branch: "Tuzla", days: [], closedDays: [] }), new Date());
  assert.equal((await PDFDocument.load(empty)).getPageCount(), 1, "kayıtsız ay tek sayfa");
});

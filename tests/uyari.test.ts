// Ortak uyarı bileşeni (docs/planlar/ux-sade.md §4, §12): katlama planı, tek ikon ve kuyu tablosu, ekran okuyucu
// önekleri ve rol kuralı, uyarı kutusunun mürekkebi, ayın uyarılarının görünen önemi (alertTone) ve Genel bakış'ın
// başındaki ödeme satırı (overdueNotice).
// Çalıştırma: npx tsx --test tests/uyari.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { alertTone } from "../src/app/panel/alert-tone";
import { overdueNotice } from "../src/app/panel/dashboard-tasks";
import { foldPlan, TONE_ICON, TONE_LABEL, TONE_TILE } from "../src/components/ui/notice";
import { money } from "../src/lib/format";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// ---------------------------------------------------------------- foldPlan

test("foldPlan: bad ve riskli warn hiç katlanmaz; ötekilerden ilk 2 görünür, kalanı katlanır", () => {
  const plan = foldPlan([
    { key: "n1", tone: "neutral" },
    { key: "w1", tone: "warn" },
    { key: "b1", tone: "bad" },
    { key: "w2", tone: "warn", risk: "para" },
    { key: "g1", tone: "good" },
    { key: "w3", tone: "warn" },
    { key: "b2", tone: "bad", risk: "veri" },
  ]);
  // Sıra bad > warn > neutral > good, aynı tonda yazıldığı sıra; bad ve riskli warn sayılmadan görünür
  assert.deepEqual(plan.shown, ["b1", "b2", "w1", "w2", "w3"]);
  assert.deepEqual(plan.folded, ["n1", "g1"]);
});

test("foldPlan: max değişince sınır değişir; riskli uyarı max'a sayılmaz; boş liste", () => {
  const items = [
    { key: "w1", tone: "warn" as const, risk: "hukuk" as const },
    { key: "w2", tone: "warn" as const },
    { key: "n1", tone: "neutral" as const },
    { key: "n2", tone: "neutral" as const },
  ];
  assert.deepEqual(foldPlan(items), { shown: ["w1", "w2", "n1"], folded: ["n2"] });
  assert.deepEqual(foldPlan(items, 1), { shown: ["w1", "w2"], folded: ["n1", "n2"] });
  assert.deepEqual(foldPlan(items, 0), { shown: ["w1"], folded: ["w2", "n1", "n2"] });
  // Hepsi bad: hiçbiri katlanmaz
  assert.deepEqual(foldPlan([{ key: "a", tone: "bad" }, { key: "b", tone: "bad" }, { key: "c", tone: "bad" }], 1), { shown: ["a", "b", "c"], folded: [] });
  assert.deepEqual(foldPlan([]), { shown: [], folded: [] });
});

// ---------------------------------------------------------------- Tek kaynak

test("TONE_ICON / TONE_TILE tek kaynak: zil, Dikkat kartı ve iş listesi onu içe aktarır, kendi uyarı ikonu eşlemesi yok", () => {
  assert.deepEqual(Object.keys(TONE_ICON).sort(), ["bad", "good", "neutral", "warn"]);
  assert.deepEqual(TONE_LABEL, { bad: "Önemli", warn: "Dikkat", neutral: "Bilgi", good: "Tamam" });
  assert.equal(TONE_TILE.bad, "bg-bad-soft text-bad-ink");
  assert.equal(TONE_TILE.warn, "bg-warn-soft text-warn-ink");
  assert.equal(TONE_TILE.neutral, "bg-note text-ink-mute");
  for (const f of ["src/components/panel/notifications.tsx", "src/app/panel/dashboard-alerts.tsx", "src/app/panel/task-style.tsx"]) {
    const src = read(f);
    assert.match(src, /import \{[^}]*\bTONE_ICON\b[^}]*\} from "@\/components\/ui\/notice";/, f);
    // Uyarı ikonu (üçgen / daire ünlem) bu dosyalarda adıyla geçmez: ikon tablodan gelir
    assert.doesNotMatch(src, /\b(TriangleAlert|AlertTriangle|CircleAlert|AlertCircle)\b/, f);
  }
  // "Dikkat edilmesi gerekenler" kartının ikonu uyarı ikonu değil (uyarı ikonu yalnız uyarıda)
  assert.match(read("src/app/panel/dashboard-alerts.tsx"), /icon=\{<ListChecks \/>\}/);
  // İş listesi: "Yapılacak" gri, sorunun ikonu uyarılarınki
  const task = read("src/app/panel/task-style.tsx");
  assert.match(task, /well: "bg-note text-ink-soft"/);
  assert.match(task, /TASK_BAR[\s\S]*todo: "bg-ink\/40"/);
});

test("notice.tsx: ekran okuyucu öneki, rol kuralı, kutunun mürekkebi bad-ink / warn-ink", () => {
  const src = read("src/components/ui/notice.tsx");
  assert.doesNotMatch(src, /^"use client"/m);
  // Renk tek başına anlam taşımaz: başlığın başında sr-only önek
  assert.match(src, /<span className="sr-only">\{TONE_LABEL\[tone\]\}: <\/span>/);
  // live yoksa note, polite → status, assertive → alert
  assert.match(src, /const role = live === "assertive" \? "alert" : live === "polite" \? "status" : "note";/);
  assert.match(src, /text-bad-ink/);
  assert.match(src, /text-warn-ink/);
  // Açık zeminde AA'nın altında kalan text-bad / text-warn metin rengi yok
  assert.doesNotMatch(src, /(?<![\w:-])text-(bad|warn)(?![\w-])/);
  // Yeni jetonlar tanımlı
  const css = read("src/app/globals.css");
  assert.match(css, /--color-bad-ink: #b91c1c;/);
  assert.match(css, /--color-warn-ink: #9a3412;/);
  assert.match(css, /--color-note: rgb\(23 23 23 \/ 0\.045\);/);
  // Ölçüm ve bekçi için kökte veri öznitelikleri
  assert.match(src, /data-notice=\{tone\} data-risk=\{risk\}/);
});

// ---------------------------------------------------------------- alertTone

test("alertTone: üç doğrudan eşleme ve üç düzeltme (hesap değişmez, görünüm katmanı)", () => {
  assert.equal(alertTone({ level: "danger", title: "Kasa eksiği" }), "bad");
  assert.equal(alertTone({ level: "warning", title: "Fatura gecikti" }), "warn");
  assert.equal(alertTone({ level: "info", title: "Yeni ay başladı" }), "neutral");
  // Süresi olmayan öneri kırmızı değil
  assert.equal(alertTone({ level: "danger", title: "3 ürünün kârı düşük" }), "warn");
  // Ay sonu rakamını bozan eksik veri bilgi değil
  assert.equal(alertTone({ level: "info", title: "Su ve buz maliyeti hesaplanmadı" }), "warn");
  assert.equal(alertTone({ level: "info", title: "Geçen ayın stok sayımı yok" }), "warn");
  // Benzeri ama aynı olmayan başlık düzeltilmez
  assert.equal(alertTone({ level: "info", title: "Bu ayın stok sayımı yok" }), "neutral");
  // insights.ts'in başlıkları bu düzeltmelerle eşleşir (metin değişirse düzeltme sessizce düşmesin)
  const insights = read("src/lib/calc/insights.ts");
  assert.match(insights, /ürünün kârı düşük`/);
  assert.match(insights, /"Su ve buz maliyeti/);
  assert.match(insights, /"Geçen ayın stok sayımı yok"/);
});

// ---------------------------------------------------------------- overdueNotice

test("overdueNotice: gecikme kırmızı tek satır (para), okunamayan liste nötr, yalnız yaklaşan ödeme satırsız", () => {
  const base = { overdue: 0, overdueTotal: 0, soon: 0, soonTotal: 0, unpaidInvoices: 0, unpaidTotal: 0 };
  assert.deepEqual(overdueNotice({ ...base, overdue: 2, overdueTotal: 11_517, soon: 1, soonTotal: 2_000 }), {
    tone: "bad",
    risk: "para",
    title: `2 ödeme gecikti · ${money(11_517)}`,
  });
  assert.deepEqual(overdueNotice(null), { tone: "neutral", title: "Ödeme listesi şu an okunamadı" });
  assert.equal(overdueNotice({ ...base, soon: 3, soonTotal: 4_500 }), null);
  assert.equal(overdueNotice(base), null);
  // Genel bakış ay listesinden ödeme işini çıkarır, satırı sayfanın başına koyar (K22)
  const page = read("src/app/panel/page.tsx");
  assert.match(page, /overdueNotice\(/);
  assert.match(page, /<NoticeLink href="\/panel\/hatirlaticilar">Ödemelere bak<\/NoticeLink>/);
});

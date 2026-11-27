// Şube ayrımı parça 2 (docs/SUBE.md › Şube ayrımı › Ayarsız sızıntılar): saf kurallar ve kaynağın biçimi. Online kanal
// seçiliyken kasa ve stok satırları yerine tek satır; onay bekleyen geç raporun günü yalnız kendi şubesinin ayında;
// sayılar ve listeler seçimle okunur. Veritabanındaki sınama: tests/sube-ayrimi-sizinti-db.test.ts.
// Çalıştırma: npx tsx --test tests/sube-ayrimi-sizinti.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { dayTasks, type DayFacts } from "../src/app/panel/bugun/logic";
import { ALL_BRANCHES, CHANNEL_NO_TILL, DEFAULT_BRANCHES, selectedChannel } from "../src/lib/branches";
import { pendingLateDays } from "../src/lib/cash-month";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const BRANCHES = DEFAULT_BRANCHES.map((b) => ({ ...b, active: true }));

test("selectedChannel: yalnız online kanal seçiliyken kanalın satırı", () => {
  assert.equal(selectedChannel("online", BRANCHES)?.name, "laffogato.net");
  assert.equal(selectedChannel("marina", BRANCHES), null);
  assert.equal(selectedChannel(ALL_BRANCHES, BRANCHES), null);
  assert.equal(selectedChannel("bilinmeyen", BRANCHES), null);
  assert.equal(CHANNEL_NO_TILL, "Bu kanalın kasası ve stoğu yok");
});

test("pendingLateDays: şubenin kendi bekleyen günleri; null'da hepsi, sıralı ve tekrarsız", () => {
  const rows = [
    { day: "2026-11-19", branchId: "marina" },
    { day: "2026-11-18", branchId: "tuzla" },
    { day: "2026-11-18", branchId: "marina" },
    { day: null, branchId: "marina" },
  ];
  assert.deepEqual(pendingLateDays(rows, "marina"), ["2026-11-18", "2026-11-19"]);
  assert.deepEqual(pendingLateDays(rows, "tuzla"), ["2026-11-18"]);
  assert.deepEqual(pendingLateDays(rows, "online"), []);
  assert.deepEqual(pendingLateDays(rows, null), ["2026-11-18", "2026-11-19"]);
});

const NOW = new Date("2026-11-30T19:00:00Z"); // 22:00 İstanbul, ayın son günü: kasa ve sayım satırları beklenir
const facts = (role: "admin" | "staff", channel: string | null): DayFacts => ({
  role,
  now: NOW,
  channel,
  cash: channel ? null : { today: null, yesterday: null, firstDate: "2026-10-01" },
  stock: channel ? null : { month: "2026-11", counted: 0, total: 40, prevMonth: "2026-10", prevHasData: true, prevCounted: 40, prevTotal: 40 },
  ...(role === "staff" ? { waste: channel ? null : { count: 0, zayi: null, ikram: null } } : {}),
});

test("Bugün: online kanal seçiliyken kasa ve sayım satırları yerine 'Bu kanalın kasası ve stoğu yok' (iki rolde)", () => {
  for (const role of ["admin", "staff"] as const) {
    const plain = dayTasks(facts(role, null)).map((t) => t.key);
    assert.ok(plain.includes("kasa") && plain.includes("kasa-dun") && plain.includes("sayim-son"), `${role}: ${plain.join(",")}`);
    assert.equal(plain.includes("kanal"), false);
    const tasks = dayTasks(facts(role, "laffogato.net"));
    const keys = tasks.map((t) => t.key);
    assert.equal(keys.some((k) => k.startsWith("kasa") || k.startsWith("sayim") || k === "zayi"), false, `${role}: ${keys.join(",")}`);
    const row = tasks.find((t) => t.key === "kanal")!;
    assert.equal(row.title, "laffogato.net: kasa ve stok");
    assert.match(row.detail, /^Bu kanalın kasası ve stoğu yok: /);
    assert.equal(row.href, "/panel/bugun?sube=hepsi");
    assert.equal(row.status, "done");
  }
});

test("kaynak: Bugün ve zilin sayıları seçimle okunur", () => {
  const today = read("src/server/data/today.ts");
  assert.match(today, /\.where\(and\(eq\(s\.invoices\.needsReview, true\), invoiceScopeWhere\(scope\)\)\)/);
  assert.match(today, /countStockOnlyReview\(db, scope\)/);
  assert.match(today, /countUnlinkedProducts\(scope\)/);
  assert.match(today, /pendingByKindInScope\(db, scope, now\)/);
  assert.match(today, /countPendingRequests\(scope\)/);
  assert.match(today, /loadReviewQueue\(0, scope\)/);
  // Online kanal: kasa, ilk rapor, sayım ve zayi okunmaz
  assert.match(today, /const channel = selectedChannel\(karaokeScope, featureRows\);/);
  assert.match(today, /channel \? null : safe\(stockProgress\(c\.month, c\.prevMonth\)\)/);
  const bell = read("src/server/actions/notifications.ts");
  assert.match(bell, /\.where\(and\(eq\(s\.invoices\.needsReview, true\), invoiceScopeWhere\(scope\)\)\)/);
  assert.match(bell, /gt\(s\.invoices\.createdAt, dayAgo\), invoiceScopeWhere\(scope\)/);
  assert.match(bell, /latestParasutRun\(db, account \? \[account\.id\] : undefined\)/);
  assert.match(bell, /"Paraşüt eşitlemesi başarısız \(hesap geneli\)"/);
  assert.match(bell, /loadReviewQueue\(0, scope\)/);
  // Kasa zili: kanalda satır yok; "Tümü"nün okuması işaretsiz (süzgeç yok)
  const kasa = read("src/server/bell/kasa.ts");
  assert.match(kasa, /if \(selectedChannel\(selected, known\)\) return \[\];/);
  assert.doesNotMatch(kasa, /withBranchScope\(ALL_BRANCHES/);
  assert.match(read("src/server/bell/vardiya.ts"), /scope === ALL_BRANCHES \? branches : branches\.filter\(\(b\) => b\.id === scope\)/);
  assert.match(read("src/server/data/till-scope.ts"), /if \(selectedChannel\(scope, branches\)\) return \[\];/);
});

test("kaynak: onaylar, kişi seçicileri, Paraşüt, asistan ve raporlar seçimle", () => {
  assert.match(read("src/app/panel/onaylar/recent-decisions.tsx"), /requestsInScope\(db, read, scope\)/);
  assert.match(read("src/app/panel/onaylar/kasa-section.tsx"), /cashCounters\(b \|\| undefined\)/);
  assert.match(read("src/app/panel/onaylar/page.tsx"), /loadReviewQueue\(30, scope\)/);
  assert.match(read("src/app/panel/receteler/page.tsx"), /countPendingByKind\(scope\)/);
  assert.match(read("src/app/panel/kontrol/duzenle/page.tsx"), /loadChecklistTemplates\(\{ scoped: true \}\)/);
  assert.match(read("src/server/data/recipe-requests.ts"), /export function proposerScopeWhere\(scope: BranchScope\)/);
  const parasut = read("src/app/panel/parasut/page.tsx");
  assert.match(parasut, /isNull\(s\.invoices\.externalId\), mine, invoiceScopeWhere\(scope\)\)/);
  assert.match(parasut, /lt\(s\.invoices\.payable, 0\), invoiceScopeWhere\(scope\)/);
  assert.match(read("src/server/ai/assistant/tools.ts"), /unlinkedProducts\(limit, await currentBranchScope\(\)\)/);
  assert.match(read("src/server/parasut/ai-match.ts"), /unlinkedProducts\(40, scope\)/);
  // Kayıp önleme: "Tümü" modeli ve firma geneli notu kalktı
  const loss = read("src/server/data/kayip-onleme.ts");
  assert.doesNotMatch(loss, /scope: ALL_BRANCHES/);
  assert.doesNotMatch(read("src/app/panel/raporlar/kayip/page.tsx"), /CompanyWideNotice/);
  assert.match(read("src/server/data/kacak.ts"), /state: "baska-sube"/);
  // Gelir-gider: şube seçiliyken faturası beklenen cari alım satırı yok; Giderler: yatırımlar "Firma geneli"
  assert.match(read("src/app/panel/gelir-gider/page.tsx"), /const expected = model\.ds\.branchView\s*\? \{\}/);
  assert.match(read("src/app/panel/giderler/page.tsx"), /companyWide=\{model\.ds\.branchView\?\.name \?\? null\}/);
});

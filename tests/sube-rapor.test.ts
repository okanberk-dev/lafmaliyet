// Şube seçimi ve raporlar (denetim 21 Kasım 2026, "rapor" grubu; docs/SUBE.md):
// - #6: Gelir-gider'in ciro, açık gün ve ay notu hücreleri seçili şubenin ay satırına yazar ("Tümü"nde birden çok kasa
//   açıkken ciro ve açık gün kilitli, not Tuzla'ya; denetim 13 Kasım HM-02);
// - #7: Satışlar › Ayı temizle yalnız gösterilen şubenin listesini ve ay bilgisini siler;
// - #26: Bugün'ün kasa satırları online kanal seçiliyken de Kasa sayfası ve zil gibi Tuzla'nın kasasını okur;
// - #27: Genel bakış'ın "Yaklaşan ödemeler" kartı Bugün'deki gibi şube seçimine uyar.
// (#11 tests/nakit-plani.test.ts, #21 tests/kasa-ay-bilgisi.test.ts.)
// Çalıştırma: npx tsx --test tests/sube-rapor.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ALL_BRANCHES, DEFAULT_BRANCHES, MONTH_TOTALS_LOCKED_TEXT, monthWriteBranch, monthWriteLock, monthWriteNote, type BranchRow } from "../src/lib/branches";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
/** Bir işlevin gövdesi: adından sonraki ilk `\n}\n`e kadar */
const body = (src: string, name: string) => {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} bulunamadı`);
  return src.slice(at, src.indexOf("\n}\n", at));
};

const branches: BranchRow[] = DEFAULT_BRANCHES.map((b) => ({ ...b, active: true }));

// ---------------------------------------------------------------- #6 Gelir-gider ay satırı

test("#6 Gelir-gider: ciro, açık gün ve ay notu formun şubesinin ay satırına yazılır (Satışlar'daki ay bilgisiyle aynı kural)", () => {
  const src = read("src/server/actions/pnl.ts");
  // Formun şubesi (24 Kasım şube kapsamı): gönderim anındaki seçim değil; göndermeyen eski sekmede seçim, Tümü'de red
  assert.doesNotMatch(src, /currentWriteBranch/);
  const gate = body(src, "monthCellBranch");
  assert.match(gate, /if \(!branchId\) \{\s*const lock = monthWriteLock\(await currentBranchScope\(\), await listBranches\(\)\);\s*if \(lock\) throw new UserError\(lock\);/);
  assert.match(gate, /return formBranch\(branchId, "sales", \{ requireExplicit: true \}\);/);
  const note = body(src, "setMonthNote");
  assert.match(note, /const sube = await monthCellBranch\(branchId\);/);
  assert.match(note, /\.values\(\{ month: m, branchId: sube, note: n \}\)/);
  assert.match(note, /onConflictDoUpdate\(\{ target: \[s\.months\.month, s\.months\.branchId\]/);
  const field = body(src, "setMonthField");
  assert.match(field, /const sube = await monthCellBranch\(branchId\);/);
  assert.match(field, /\.values\(\{ month: m, branchId: sube, \[field\]: v \}\)/);
  assert.match(field, /onConflictDoUpdate\(\{ target: \[s\.months\.month, s\.months\.branchId\]/);
  // Ay satırına şubesiz (sütunun varsayılanı Tuzla) yazan kalmadı
  assert.doesNotMatch(src, /insert\(s\.months\)\s*\.values\(\{ month: m, (?!branchId)/);
  // Satışlar'ın ay bilgisi de aynı şubeye yazar
  assert.match(read("src/server/actions/sales.ts"), /\.values\(\{ \.\.\.data, branchId: sube, updatedAt: new Date\(\) \}\)/);
});

test("#6 Gelir-gider: 'Tümü'de birden çok kasa açıkken ciro, açık gün ve ay notu yazılmaz; online kanalda da", () => {
  // Denetim 13 Kasım HM-02: "Tümü" şubelerin toplamı; ciro ve açık gün hücresi kilitli (monthTotalsLocked). 24 Kasım şube
  // kapsamı: ay notu da artık sessizce Tuzla'ya inmez; online kanalın kasa satışı yok
  const text = monthWriteNote(ALL_BRANCHES, branches);
  assert.equal(text, "Tümü seçili: aylık ciro, açık gün ve ay notu şubelerin toplamıdır, burada yazılmaz; yazmak için soldan şubeyi seçin.");
  assert.equal(monthWriteLock(ALL_BRANCHES, branches), MONTH_TOTALS_LOCKED_TEXT);
  assert.equal(monthWriteLock("online", branches), "laffogato.net kanalının kasa satışı yok: ciro, açık gün ve ay notu şubelerde yazılır; soldan şubeyi seçin.");
  assert.equal(monthWriteLock("marina", branches), null);
  assert.equal(monthWriteBranch("marina", branches), "marina");
  assert.equal(monthWriteBranch(ALL_BRANCHES, branches), null);
  assert.equal(monthWriteBranch("online", branches), null);
  assert.equal(monthWriteBranch(ALL_BRANCHES, branches.map((b) => (b.id === "marina" ? { ...b, active: false } : b))), "tuzla", "tek kasada Tümü o kasa");
  // Tek şube seçiliyken ya da tek kasa varken (Marina kapalı) not yok: yazılan gösterilen satırdır
  assert.equal(monthWriteNote("marina", branches), null);
  assert.equal(monthWriteNote("online", branches), null);
  assert.equal(monthWriteNote(ALL_BRANCHES, branches.map((b) => (b.id === "marina" ? { ...b, active: false } : b))), null);
  const page = read("src/app/panel/gelir-gider/page.tsx");
  assert.match(page, /\.then\(\(\[scope, branches\]\) => \(\{ note: monthWriteNote\(scope, branches\), lock: monthWriteLock\(scope, branches\), branch: monthWriteBranch\(scope, branches\) \}\)\)/);
  assert.match(page, /\{monthWrite\.note \? <Notice tone="neutral" size="line" className="-mt-2 mb-4" title=\{monthWrite\.note\} \/> : null\}/);
  assert.match(page, /openDaysLocked=\{monthWrite\.lock\}\s+writeBranch=\{monthWrite\.branch\}/);
  // Hücreler ve ay notu sayfanın şubesini gönderir
  const grid = read("src/app/panel/gelir-gider/pnl-grid.tsx");
  assert.equal(grid.match(/setMonthField\(month, "(?:posRevenue|openDays)", (?:amount|v), writeBranch\)/g)?.length, 4);
  assert.match(grid, /setMonthNote\(month, next, branchId\)/);
});

// ---------------------------------------------------------------- #7 Satışlar › Ayı temizle

test("#7 Ayı temizle: yalnız gösterilen şubenin satırları ve ay bilgisi; kapsam kaydı ayda liste kalmadıysa silinir", () => {
  const fn = body(read("src/server/actions/sales.ts"), "clearMonthSales");
  // Kapsam pencerenin gösterdiğinden (assertShownScope), çerezden değil (24 Kasım şube kapsamı)
  assert.match(fn, /const scope = await assertShownScope\(opts\?\.scope\);/);
  assert.match(fn, /const lines = branchWhere\(s\.salesLines\.branchId, scope\);\s*const info = branchWhere\(s\.months\.branchId, scope\);/);
  assert.match(fn, /\.delete\(s\.salesLines\)\s*\.where\(andWhere\(eq\(s\.salesLines\.month, m\), lines\)\)/);
  assert.match(fn, /\.where\(andWhere\(eq\(s\.months\.month, m\), info\)\)/);
  // Kapsam (listenin son günü) ayın tek kaydı: başka şubenin listesi kaldıysa silinmez
  assert.match(fn, /const \[left\] = await tx\.select\(\{ n: sql<number>`count\(\*\)::int` \}\)\.from\(s\.salesLines\)\.where\(eq\(s\.salesLines\.month, m\)\);\s*if \(!left\?\.n\) await setCoverage\(tx, m, null\);/);
  // Şubesiz silme ve güncelleme kalmadı
  assert.doesNotMatch(fn, /\.where\(eq\(s\.salesLines\.month, m\)\)\.returning/);
  assert.doesNotMatch(fn, /\.update\(s\.months\)[\s\S]*?\.where\(eq\(s\.months\.month, m\)\)/);
  // Tek işlem: satırlar, kapsam ve ay bilgisi birlikte
  assert.match(fn, /await db\.transaction\(async \(tx\) => \{/);
  assert.match(fn, /for \(const r of rows\) if \(await dropEmptyMonth\(tx, m, r\.branchId\)\) monthRemoved = true;/);
});

// ---------------------------------------------------------------- #26 Bugün'ün kasası

test("#26 Bugün: yönetici 'Tümü'de birden çok kasa açık değilse tek kasayı okur (online kanalda Tuzla; zil ve Kasa gibi)", () => {
  const src = read("src/server/data/today.ts");
  const fn = body(src, "cashView");
  assert.match(fn, /const \[scope, branches, till\] = await Promise\.all\(\[currentBranchScope\(\), listBranches\(\), currentTillBranch\(\)\]\);/);
  assert.match(fn, /const many = scope === ALL_BRANCHES && tills\.length > 1;/);
  assert.match(fn, /return \{ till: many \? null : till, tills: many \? tills\.map\(\(\{ id, name \}\) => \(\{ id, name \}\)\) : null \};/);
  // Yöneticide de kasa okumaları bu kasanın kapsamında (tillScoped), devir ve föy de
  assert.match(src, /const tillScoped = <T>\(fn: \(\) => Promise<T>\) => viewP\.then\(\(v\) => \(v\?\.till \? withBranchScope\(v\.till, fn\) : fn\(\)\)\);/);
  assert.match(src, /tills \? null : previousCarryOver\(oldest, v\?\.till \?\? undefined\)/);
  assert.match(src, /loadModposSheets\(oldest, businessDate\(now\), undefined, v\?\.till \? \{ branchId: v\.till \} : \{\}\)/);
  // Zil aynı kuralı kullanır
  const bell = read("src/server/bell/kasa.ts");
  assert.match(bell, /const till = tills \? \(tills\.many \? null : tills\.till\) : await currentTillBranch\(\);/);
});

// ---------------------------------------------------------------- #27 Genel bakış'ın ödemeleri

test("#27 Genel bakış: 'Yaklaşan ödemeler' ve gecikme satırı şube seçimine uyar; nakit planı ve cari işletmenin", () => {
  const src = read("src/app/panel/page.tsx");
  assert.match(src, /return await loadUpcoming\(undefined, \{ branch \}\);/);
  assert.match(src, /scope === ALL_BRANCHES \? Promise\.resolve\(null\) : loadPayments\(scope\),/);
  assert.match(src, /const shownPayments = scope === ALL_BRANCHES \? upcoming : branchPayments;/);
  assert.match(src, /<DashboardPayments items=\{shownPayments\.items\} \/>/);
  assert.match(src, /paymentFacts\(shownPayments\.items, unpaidSummary\(model\.ds\.invoices\), debtFacts\(\[\.\.\.shownPayments\.items, \.\.\.shownPayments\.laterInvoices\]\)\)/);
  assert.doesNotMatch(src, /<DashboardPayments items=\{upcoming\.items\} \/>/);
  // Nakit planı ve cari uyarıları şubesiz okumayla (işletmenin parası)
  assert.match(src, /withBranchScope\(ALL_BRANCHES, \(\) => loadCashPlan\(m, upcoming\)\)/);
  assert.match(src, /const cari = upcoming \? cariAlerts\(upcoming\.cari\) : \[\];/);
  // Bugün'ün kartı da şubeyle
  assert.match(read("src/server/data/today.ts"), /loadUpcoming\(undefined, \{ branch: await currentBranchScope\(\) \}\)/);
});

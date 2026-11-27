// Şube ayrımı (D, 27 Kasım 2026; docs/SUBE.md › Şube ayrımı): şube seçiliyken ekranlarda yalnız o şubenin bilgisi.
// Kaynak taraması: seçimi bilerek aşan her okuma kayıtlı ve işaretli (a), şubesi olan tablolar kapsamla okunur (b),
// alan ekranı çipini çizer ve "firma geneli" notu yalnız hep firma geneli ekranda kalır (c), saf kurallar (d).
//
// (b) ve (c) bugün cırcır gibi ilerler: kalan okumalar ve ekranlar `BEKLEYEN_*` listelerinde, şube ayrımının sonraki
// parçaları (2–6) listeyi boşaltır. Listeye satır eklenmez; sayı yalnız azalır (artarsa yeni sızıntıdır).
// Veritabanındaki sınama: tests/sube-gorunumu-db.test.ts.
// Çalıştırma: npx tsx --test tests/sube-ayrimi.test.ts

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import * as schema from "../src/server/db/schema";
import { COMPANY_WIDE_READS, effectiveView, parseBranchView, READ_MARKER, VIEW_AREA_KEYS, VIEW_AREAS, type ViewArea } from "../src/lib/branch-view";

const ROOT = process.cwd();
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

function walk(dir: string): string[] {
  if (!existsSync(join(ROOT, dir))) return [];
  return readdirSync(join(ROOT, dir)).flatMap((n) => {
    const p = `${dir}/${n}`;
    return statSync(join(ROOT, p)).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

const isComment = (line: string) => /^\s*(\/\/|\/\*|\*|\{\/\*)/.test(line);
const MARK = new RegExp(`${READ_MARKER}\\s*([A-Za-z0-9._-]+)`);

// ---------------------------------------------------------------- (a) seçimi aşan okumalar

/** Seçimi aşan okuma: "Tümü"yle sarmak, "Tümü"yle model, kapsamsız yükleyiciler, alanın kapsamı */
const COMPANY_READ = /withBranchScope\(ALL_BRANCHES|scope: ALL_BRANCHES|\bloadUpcoming\(\)|\bunlinkedProducts\([^,()]*\)|\bcountUnlinkedProducts\(\)|\bareaScope\(/;
/** Bildirimler (işlevin kendisi), saf dosyalar (okuma yapmaz) ve bu kural sayılmaz */
const DEFINITION = /\bfunction (areaScope|countUnlinkedProducts|unlinkedProducts|loadUpcoming)\b/;

interface Site {
  file: string;
  line: number;
  text: string;
  id: string | null;
}

/**
 * Okumanın işareti: aynı satırın sonunda ya da hemen üstündeki yorum satırlarında (aradaki satır da seçimi aşan bir
 * okumaysa onun üstünde; en çok 6 satır yukarı)
 */
function markerFor(lines: string[], i: number): string | null {
  const same = new RegExp(`(//|/\\*).*${MARK.source}`).exec(lines[i]);
  if (same) return same[2];
  for (let j = i - 1; j >= 0 && i - j <= 6; j--) {
    if (isComment(lines[j])) {
      const m = MARK.exec(lines[j]);
      if (m) return m[1];
      continue;
    }
    if (COMPANY_READ.test(lines[j])) continue;
    break;
  }
  return null;
}

function companyReadSites(): Site[] {
  const out: Site[] = [];
  for (const file of walk("src")) {
    if (file.startsWith("src/lib/")) continue;
    const lines = read(file).split("\n");
    lines.forEach((text, i) => {
      if (isComment(text) || !COMPANY_READ.test(text) || DEFINITION.test(text)) return;
      out.push({ file, line: i + 1, text: text.trim(), id: markerFor(lines, i) });
    });
  }
  return out;
}

const REGISTRY = new Map(COMPANY_WIDE_READS.map((r) => [r.id, r]));

test("(a) tarama sağlam: bugünkü firma geneli okumalar bulunuyor", () => {
  const sites = companyReadSites();
  assert.ok(sites.length >= 30, `${sites.length} yer`);
  assert.ok(sites.some((s) => s.file === "src/server/actions/costs.ts" && /withBranchScope\(ALL_BRANCHES/.test(s.text)));
  assert.ok(sites.some((s) => s.file === "src/server/data/cash-plan.ts" && /loadUpcoming\(\)/.test(s.text)));
});

test("(a) seçimi aşan her okumanın üstünde kayıtlı bir işaret var", () => {
  const missing: string[] = [];
  for (const s of companyReadSites()) {
    if (!s.id) missing.push(`${s.file}:${s.line} işaretsiz: ${s.text}`);
    else if (!REGISTRY.has(s.id)) missing.push(`${s.file}:${s.line} kayıtta olmayan işaret "${s.id}"`);
  }
  assert.deepEqual(missing, []);
});

test("(a) areaScope çağrısının işareti alanın kendi `alan` kaydı; öteki okumalarda `alan` işareti yok", () => {
  const wrong: string[] = [];
  for (const s of companyReadSites()) {
    const r = s.id ? REGISTRY.get(s.id) : undefined;
    if (!r) continue;
    const area = /\bareaScope\(\s*"([a-z_]+)"/.exec(s.text)?.[1];
    if (/\bareaScope\(/.test(s.text)) {
      if (r.kind !== "alan" || !area || r.area !== area) wrong.push(`${s.file}:${s.line}: areaScope(${area ?? "?"}) işareti ${r.id} (${r.kind}, ${r.area ?? "-"})`);
    } else if (r.kind === "alan") wrong.push(`${s.file}:${s.line}: ${r.id} yalnız areaScope çağrısında`);
  }
  assert.deepEqual(wrong, []);
});

test("(a) kayıt: kimlikler tek, her kimlik kullanılıyor, `where` dosyaları işaretiyle var", () => {
  const ids = COMPANY_WIDE_READS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "kimlik iki kez");
  const used = new Set(companyReadSites().map((s) => s.id));
  assert.deepEqual(
    ids.filter((id) => !used.has(id)),
    [],
    "eskimiş kayıt: hiçbir okumanın üstünde yok",
  );
  for (const r of COMPANY_WIDE_READS) {
    assert.ok(r.reason.length > 10, `${r.id}: gerekçe`);
    for (const part of r.where.split(";").map((x) => x.trim())) {
      const [file, symbol] = part.split("#");
      assert.ok(existsSync(join(ROOT, file)), `${r.id}: ${file} yok`);
      const src = read(file);
      assert.ok(symbol && src.includes(symbol), `${r.id}: ${file} içinde ${symbol} yok`);
      assert.ok(src.includes(`${READ_MARKER} ${r.id}`), `${r.id}: ${file} içinde işareti yok`);
    }
    if (r.kind === "alan") assert.ok(r.area && VIEW_AREA_KEYS.includes(r.area), `${r.id}: alan`);
    if (r.area) assert.ok(VIEW_AREA_KEYS.includes(r.area), `${r.id}: bilinmeyen alan ${r.area}`);
    if (r.kind === "bekliyor") assert.ok(r.part && r.part >= 2 && r.part <= 6, `${r.id}: hangi parça kapatır`);
    else assert.equal(r.part, undefined, `${r.id}: parça yalnız bekleyende`);
  }
});

// ---------------------------------------------------------------- (b) şubesi olan tablolar

/** Satırı şubeye bağlı tablolar (doğrudan ya da işletme geneli boşuyla) */
const BRANCH_TABLES = [
  "cashReports",
  "posDayReports",
  "modposCashSheets",
  "salesLines",
  "months",
  "stockCounts",
  "wasteEntries",
  "cashOuts",
  "expenseEntries",
  "fixedExpenses",
  "staff",
  "shifts",
  "staffRequests",
  "invoices",
  "checklistRuns",
  "activityLog",
  "notificationLog",
  "reminders",
  "investments",
  "notificationRecipients",
] as const;

const SCOPED = /branchWhere|currentBranchWhere|branchWhereWithShared|invoiceScopeWhere|requestInScope|requestsInScope/;
const READ_DIRS = ["src/server/data", "src/server/bell", "src/server/notify", "src/server/ai", "src/server/mcp", "src/server/assistant-reads"];

/** `.from(s.X)` ifadesi: önceki `;`'den sonrası (en çok 10 satır yukarı) ile sonraki `;`'ye kadar (en çok 20 satır) */
function unscopedReads(): Map<string, string[]> {
  const files = [...READ_DIRS.flatMap(walk), ...walk("src/app/panel").filter((f) => f.endsWith("/page.tsx"))];
  const out = new Map<string, string[]>();
  for (const file of files) {
    const lines = read(file).split("\n");
    lines.forEach((text, i) => {
      const table = /\.from\(s\.(\w+)\)/.exec(text)?.[1];
      if (!table || !(BRANCH_TABLES as readonly string[]).includes(table) || isComment(text)) return;
      let start = i;
      while (start > 0 && i - start < 10 && !/;\s*$/.test(lines[start - 1])) start--;
      let end = i;
      while (end < lines.length - 1 && end - i < 20 && !lines[end].includes(";")) end++;
      const st = lines.slice(start, end + 1).join("\n");
      if (SCOPED.test(st) || MARK.test(st) || new RegExp(`(eq|inArray)\\(s\\.${table}\\.branchId`).test(st)) return;
      out.set(file, [...(out.get(file) ?? []), `${i + 1}: ${table}`]);
    });
  }
  return out;
}

/**
 * Bugün kapsamsız okunanlar (dosya → ifade sayısı): şube ayrımının 2–6. parçaları ya kapsamla okur ya da üstüne kayıtlı
 * işaret koyar ve sayıyı düşürür. Yeni dosya eklenmez, sayı artmaz
 */
const BEKLEYEN_B: Record<string, number> = {
  "src/app/panel/faturalar/page.tsx": 2,
  "src/app/panel/hammaddeler/page.tsx": 1,
  "src/app/panel/hatirlaticilar/page.tsx": 2,
  "src/server/data/asilpos-day-end.ts": 1,
  "src/server/data/asilpos-day.ts": 2,
  "src/server/data/asilpos-ikram.ts": 1,
  "src/server/data/branch-day.ts": 2,
  "src/server/data/cari.ts": 6,
  "src/server/data/cash-late.ts": 4,
  "src/server/data/cash-out-invoices.ts": 5,
  "src/server/data/cash-out-requests.ts": 3,
  "src/server/data/cash-outs.ts": 2,
  "src/server/data/cash-reports.ts": 15,
  "src/server/data/cash-requests.ts": 6,
  "src/server/data/checklists.ts": 1,
  "src/server/data/commission.ts": 2,
  "src/server/data/expense-extras.ts": 1,
  "src/server/data/fixed-follow.ts": 1,
  "src/server/data/fixed-reminders.ts": 1,
  "src/server/data/invoice-branch.ts": 4,
  "src/server/data/karaoke-requests.ts": 3,
  "src/server/data/pos-staff.ts": 1,
  "src/server/data/product-history.ts": 4,
  "src/server/data/staff-links.ts": 2,
  "src/server/data/stock-only-invoices.ts": 1,
  "src/server/data/suppliers.ts": 2,
  "src/server/data/waste-requests.ts": 7,
  "src/server/data/waste.ts": 1,
  "src/server/notify/checklist-alerts.ts": 1,
  "src/server/notify/digest.ts": 7,
  "src/server/notify/recipients.ts": 2,
};

/** Şubesi sütundan değil kayıttan okunan tablo: personel isteği (konu, yük ya da kayıt; `requestBranches`) */
const BRANCH_DERIVED = ["staffRequests"];
/** Şube sütunu sırada olan tablolar (parça 3 dördünü getirdi: drizzle/0101_sube_ayrimi_kolonlar.sql; boş) */
const BEKLEYEN_KOLON: string[] = [];

test("(b) tablo listesi şemayla aynı: tablonun şube sütunu var (ya da şubesi kayıttan, ya da sütunu sırada)", () => {
  for (const t of BRANCH_TABLES) {
    const table = (schema as Record<string, unknown>)[t] as Record<string, unknown> | undefined;
    assert.ok(table, `${t}: şemada yok`);
    const has = "branchId" in table || "branchIds" in table;
    if (BRANCH_DERIVED.includes(t)) assert.equal(has, false, `${t}: şube sütunu geldi, BRANCH_DERIVED'dan düşürün`);
    else if (BEKLEYEN_KOLON.includes(t)) assert.equal(has, false, `${t}: şube sütunu geldi, BEKLEYEN_KOLON'dan düşürün`);
    else assert.ok(has, `${t}: şube sütunu yok`);
  }
});

test("(b) şubesi olan tablo kapsamla okunur ya da işaretli (kalanlar BEKLEYEN_B'de, sayı yalnız azalır)", () => {
  const found = unscopedReads();
  assert.ok([...found.values()].flat().length > 0 || Object.keys(BEKLEYEN_B).length === 0);
  const grew: string[] = [];
  for (const [file, rows] of found) {
    const allowed = BEKLEYEN_B[file] ?? 0;
    if (rows.length > allowed) grew.push(`${file}: ${rows.length} kapsamsız okuma (izin ${allowed}): ${rows.join(", ")}`);
  }
  assert.deepEqual(grew, []);
  // Düzelen dosyanın satırı listeden düşer (liste eskimesin)
  const stale = Object.entries(BEKLEYEN_B)
    .filter(([file, n]) => (found.get(file)?.length ?? 0) < n)
    .map(([file, n]) => `${file}: izin ${n}, bugün ${found.get(file)?.length ?? 0} (BEKLEYEN_B'yi düşürün)`);
  assert.deepEqual(stale, []);
});

// ---------------------------------------------------------------- (c) çip ve firma geneli notu

/** Ekranlarına çipi henüz konmamış alanlar: parça 4 (odemeler, nakit, tedarikciler, komisyon), 5, 6 boşaltır */
const BEKLEYEN_ALANLAR: readonly ViewArea[] = ["odemeler", "nakit", "vergi", "tutarlilik", "mutabakat", "tedarikciler", "stok_degeri", "komisyon", "karsilastirma", "ortak_gider"];
/** Hep firma geneli kalan ekranlar: "bu ekran firma geneli" notu (CompanyWideNotice) yalnız bunlarda kalır */
const YALNIZ_FIRMA_SAYFALARI: readonly string[] = [];
/** Notu bir alanın ekranı olmadığı hâlde bugün taşıyan sayfalar (Kayıp önleme parça 2'de kapsamla okumaya geçti; boş) */
const BEKLEYEN_NOT: string[] = [];

const pageOf = (path: string) => `src/app${path}/page.tsx`;

test("(c) alanın ekranı çipini çizer; çip yalnız kendi alanının ekranında", () => {
  const missing: string[] = [];
  for (const area of VIEW_AREA_KEYS) {
    if (BEKLEYEN_ALANLAR.includes(area)) continue;
    for (const p of VIEW_AREAS[area].screens) if (!read(pageOf(p)).includes(`<BranchViewChip area="${area}"`)) missing.push(`${pageOf(p)}: <BranchViewChip area="${area}"> yok`);
  }
  assert.deepEqual(missing, []);
  const wrong: string[] = [];
  for (const file of walk("src/app")) {
    for (const m of read(file).matchAll(/<BranchViewChip area="([a-z_]+)"/g)) {
      const area = m[1] as ViewArea;
      if (!VIEW_AREA_KEYS.includes(area)) wrong.push(`${file}: bilinmeyen alan ${area}`);
      else if (!VIEW_AREAS[area].screens.some((p) => pageOf(p) === file)) wrong.push(`${file}: ${area} alanının ekranı değil (VIEW_AREAS.${area}.screens)`);
    }
  }
  assert.deepEqual(wrong, []);
});

test("(c) “bu ekran firma geneli” notu yalnız hep firma geneli ve henüz çipi gelmemiş ekranlarda", () => {
  const allowed = new Set([
    ...YALNIZ_FIRMA_SAYFALARI,
    ...BEKLEYEN_NOT,
    ...BEKLEYEN_ALANLAR.flatMap((a) => VIEW_AREAS[a].screens.map(pageOf)),
    // Bileşenin kendisi ve sayfanın istemci parçası (notu sayfadan alır)
    "src/components/panel/company-wide-notice.tsx",
    "src/app/panel/hatirlaticilar/nakit/cash-plan-client.tsx",
  ]);
  const wrong = walk("src")
    .filter((f) => !f.startsWith("src/lib/"))
    .filter((f) => read(f).split("\n").some((l) => !isComment(l) && /<CompanyWideNotice\b|\bcompanyWideNote\(/.test(l)))
    .filter((f) => !allowed.has(f));
  assert.deepEqual(wrong, []);
  for (const f of BEKLEYEN_NOT) assert.match(read(f), /<CompanyWideNotice\b/, `${f}: not kalktıysa BEKLEYEN_NOT'tan düşürün`);
});

// ---------------------------------------------------------------- (d) saf kurallar

test("(d) yöneticinin varsayılanı her alanda şube; kilitli hesap her alanda şube; tanınmayan tercih düşer", () => {
  for (const a of VIEW_AREA_KEYS) {
    assert.equal(effectiveView(a, "admin", false, {}), "sube", a);
    for (const role of ["admin", "manager", "staff", "accountant"] as const) assert.equal(effectiveView(a, role, true, { [a]: "firma" }), "sube", `${role} ${a}`);
  }
  assert.deepEqual(parseBranchView({ vergi: "firma", bilinmeyen: "firma", nakit: "tumu" }), { vergi: "firma" });
});

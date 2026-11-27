// Şube ve kanal kurallarının tamamı (src/lib/branches.ts; docs/SUBE.md): kimlik, tür ↔ kasa kaynağı uyumu, sabit
// kayıtların korunması, silme, süzgeç ve sıralama. Şema ve tohum da buraya bağlıdır: 0053_subeler.sql'deki CHECK
// kuralları saf işlevlerle aynı şeyi söylemeli, yoksa ekran "olur" deyip veritabanı reddeder.
// Çalıştırma: npx tsx --test tests/subeler.test.ts

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ESKI_KASA_KAYNAGI } from "../src/lib/asilpos/eski-adlar";

import {
  ALL_BRANCHES,
  BRANCH_EMAIL_TAKEN,
  BRANCH_KINDS,
  BRANCH_POS_SOURCES,
  branchChangeError,
  branchDeleteError,
  branchEmailTaken,
  branchIdError,
  branchScopeIds,
  branchScopeLabel,
  branchSourceError,
  DEFAULT_BRANCH_ID,
  DEFAULT_BRANCHES,
  FIXED_BRANCH_IDS,
  ONLINE_BRANCH_ID,
  parseBranchScope,
  sortBranches,
  suggestBranchId,
  type BranchRow,
} from "../src/lib/branches";

const row = (p: Partial<BranchRow> & { id: string }): BranchRow => ({
  name: p.id,
  kind: "fiziksel",
  posSource: "modpos",
  active: true,
  openedOn: null,
  sortOrder: 1,
  ...p,
});

const TUZLA = row({ id: DEFAULT_BRANCH_ID, name: "Tuzla", sortOrder: 1 });
const MARINA = row({ id: "marina", name: "Marina", sortOrder: 2 });
const ONLINE = row({ id: ONLINE_BRANCH_ID, name: "laffogato.net", kind: "online", posSource: "yok", sortOrder: 3 });
const HEPSI = [TUZLA, MARINA, ONLINE];

test("tohum: Tuzla, Marina ve laffogato.net; sabitler listede", () => {
  assert.deepEqual(
    DEFAULT_BRANCHES.map((b) => b.id),
    [DEFAULT_BRANCH_ID, "marina", ONLINE_BRANCH_ID],
  );
  const online = DEFAULT_BRANCHES.find((b) => b.id === ONLINE_BRANCH_ID)!;
  assert.equal(online.kind, "online");
  assert.equal(online.posSource, "yok");
  // Marina ModPOS kullanır (sahibin kararı, 4 Kasım 2026)
  assert.equal(DEFAULT_BRANCHES.find((b) => b.id === "marina")!.posSource, "modpos");
  // Her tohum kaydı kendi kurallarını geçmeli
  for (const b of DEFAULT_BRANCHES) {
    assert.equal(branchIdError(b.id), null, b.id);
    assert.equal(branchSourceError(b.kind, b.posSource), null, b.id);
  }
  assert.deepEqual([...FIXED_BRANCH_IDS], [DEFAULT_BRANCH_ID, ONLINE_BRANCH_ID]);
});

test("kimlik: harfle başlar, küçük harf / rakam / tire; ayrılmış değer alınmaz", () => {
  assert.equal(branchIdError("marina"), null);
  assert.equal(branchIdError("marina-2"), null);
  assert.equal(branchIdError("ma"), null); // iki harf yeter
  for (const kotu of ["", "  ", "m", "M", "Marina", "1marina", "-marina", "mar na", "marina!", ALL_BRANCHES]) {
    assert.notEqual(branchIdError(kotu), null, JSON.stringify(kotu));
  }
  assert.notEqual(branchIdError("m".repeat(25)), null);
  assert.equal(branchIdError("m".repeat(24)), null);
  assert.notEqual(branchIdError(42), null);
});

test("kimlik önerisi: Türkçe harfler sadeleşir, boşluk tireye döner", () => {
  assert.equal(suggestBranchId("Laffogato Marina"), "laffogato-marina");
  assert.equal(suggestBranchId("Şişli Çarşı"), "sisli-carsi");
  assert.equal(suggestBranchId("  İstanbul  Göztepe "), "istanbul-goztepe");
  // Rakamla başlayan ad harfe çekilir (kimlik harfle başlamalı)
  assert.equal(branchIdError(suggestBranchId("34 Kadıköy")), null);
});

test("tür ↔ kasa kaynağı: online kanalın kasası olmaz, şube kasasız kalmaz", () => {
  assert.equal(branchSourceError("fiziksel", "modpos"), null);
  assert.equal(branchSourceError("fiziksel", "asilpos"), null);
  assert.equal(branchSourceError("online", "yok"), null);
  assert.notEqual(branchSourceError("online", "modpos"), null);
  assert.notEqual(branchSourceError("fiziksel", "yok"), null);
});

test("0053_subeler.sql CHECK kuralları saf işlevlerle aynı şeyi söyler", () => {
  const sql = readFileSync(join(process.cwd(), "drizzle/0053_subeler.sql"), "utf8");
  for (const k of BRANCH_KINDS) assert.ok(sql.includes(`'${k}'`), k);
  // Kasa kaynağının değeri veritabanında eski adla (ESKI_KASA_KAYNAGI; şemanın sütunu çevirir), yeni ad 0098'de eklendi
  for (const p of BRANCH_POS_SOURCES) assert.ok(sql.includes(`'${p === "asilpos" ? ESKI_KASA_KAYNAGI : p}'`), p);
  assert.ok(readFileSync(join(process.cwd(), "drizzle/0098_asilpos_adi.sql"), "utf8").includes(`'${ESKI_KASA_KAYNAGI}','asilpos'`));
  assert.ok(sql.includes("branches_source_kind_ck"), "tür ↔ kaynak kuralı şemada da olmalı");
});

test("sabit kayıtlar: Tuzla ve laffogato.net kapatılamaz, türü değişmez, silinemez", () => {
  const kapat = { kind: TUZLA.kind, posSource: TUZLA.posSource, active: false };
  assert.notEqual(branchChangeError(TUZLA, kapat, [MARINA, ONLINE]), null);
  assert.notEqual(branchChangeError(ONLINE, { kind: "online", posSource: "yok", active: false }, [TUZLA, MARINA]), null);
  assert.notEqual(branchChangeError(ONLINE, { kind: "fiziksel", posSource: "modpos", active: true }, [TUZLA, MARINA]), null);
  assert.notEqual(branchDeleteError(TUZLA, 0), null);
  assert.notEqual(branchDeleteError(ONLINE, 0), null);
});

test("sıradan şube: kapatılabilir, güncellenebilir; son açık şube kapatılamaz", () => {
  assert.equal(branchChangeError(MARINA, { kind: "fiziksel", posSource: "asilpos", active: true }, [TUZLA, ONLINE]), null);
  assert.equal(branchChangeError(MARINA, { kind: "fiziksel", posSource: "modpos", active: false }, [TUZLA, ONLINE]), null);
  // Tuzla da kapalıysa Marina son açık şubedir: kapatılamaz
  const tuzlaKapali = { ...TUZLA, active: false };
  assert.notEqual(
    branchChangeError(MARINA, { kind: "fiziksel", posSource: "modpos", active: false }, [tuzlaKapali, ONLINE]),
    null,
  );
  // Online kanal "açık şube" sayılmaz: tek başına kalması Marina'yı kurtarmaz
  assert.notEqual(branchChangeError(MARINA, { kind: "fiziksel", posSource: "modpos", active: false }, [ONLINE]), null);
  // Zaten kapalı bir şubeyi yeniden kaydetmek engellenmez
  const kapaliMarina = { ...MARINA, active: false };
  assert.equal(branchChangeError(kapaliMarina, { kind: "fiziksel", posSource: "modpos", active: false }, [ONLINE]), null);
});

test("silme: yalnız kaydı olmayan sıradan şube silinir", () => {
  assert.equal(branchDeleteError(MARINA, 0), null);
  assert.notEqual(branchDeleteError(MARINA, 1), null);
  assert.match(branchDeleteError(MARINA, 12) ?? "", /12/);
});

test("şube kurulumu e-postası: yalnız şubesiz ya da bu şubedeki personel hesabı kabul edilir", () => {
  // Kurulum bağlantısı adresin hesabına gider ve kasanın eşitleme anahtarını verir (docs/ASILPOS.md › Şube kurulumu)
  const hesap = (role: string, branchId: string | null) => ({ role, branchId });
  assert.equal(branchEmailTaken(null, "marina"), false, "adres boşta");
  assert.equal(branchEmailTaken(undefined, "marina"), false, "adres boşta");
  assert.equal(branchEmailTaken(hesap("staff", null), "marina"), false, "şubesiz personel");
  assert.equal(branchEmailTaken(hesap("staff", "marina"), "marina"), false, "bu şubenin personeli");
  assert.equal(branchEmailTaken(hesap("staff", "tuzla"), "marina"), true, "öteki şubenin personeli");
  assert.equal(branchEmailTaken(hesap("admin", null), "marina"), true, "yönetici");
  assert.equal(branchEmailTaken(hesap("admin", "marina"), "marina"), true, "şubeli yönetici");
  // Eski denetim (yalnız yönetici ve öteki şube) bunları geçiriyordu
  assert.equal(branchEmailTaken(hesap("manager", "marina"), "marina"), true, "bu şubenin müdürü");
  assert.equal(branchEmailTaken(hesap("manager", "tuzla"), "marina"), true, "öteki şubenin müdürü");
  assert.equal(branchEmailTaken(hesap("manager", null), "marina"), true, "şubesiz müdür");
  assert.equal(branchEmailTaken(hesap("accountant", null), "marina"), true, "muhasebeci");
  assert.equal(branchEmailTaken(hesap("accountant", "marina"), "marina"), true, "şube yazılmış muhasebeci");
  // Varsayılan kapalı: tanınmayan rol de reddedilir
  assert.equal(branchEmailTaken(hesap("patron", null), "marina"), true, "tanınmayan rol");
  assert.match(BRANCH_EMAIL_TAKEN, /başka bir hesapta/);
});

test("süzgeç: tanınmayan, kapalı ve boş değer “hepsi”ye düşer", () => {
  assert.equal(parseBranchScope("marina", HEPSI), "marina");
  assert.equal(parseBranchScope(ALL_BRANCHES, HEPSI), ALL_BRANCHES);
  assert.equal(parseBranchScope("", HEPSI), ALL_BRANCHES);
  assert.equal(parseBranchScope(null, HEPSI), ALL_BRANCHES);
  assert.equal(parseBranchScope("yok-boyle", HEPSI), ALL_BRANCHES);
  assert.equal(parseBranchScope("marina", [TUZLA, { ...MARINA, active: false }, ONLINE]), ALL_BRANCHES);
});

test("süzgecin kapsamı ve adı", () => {
  assert.deepEqual(branchScopeIds(ALL_BRANCHES, HEPSI), ["tuzla", "marina", "online"]);
  assert.deepEqual(branchScopeIds("marina", HEPSI), ["marina"]);
  assert.deepEqual(branchScopeIds("yok-boyle", HEPSI), []);
  // Kapalı şube "hepsi"ye girmez (ciro toplamı kapanmış şubeyi saymaz)
  assert.deepEqual(branchScopeIds(ALL_BRANCHES, [TUZLA, { ...MARINA, active: false }]), ["tuzla"]);
  assert.equal(branchScopeLabel(ALL_BRANCHES, HEPSI), "Tümü");
  assert.equal(branchScopeLabel("marina", HEPSI), "Marina");
  assert.equal(branchScopeLabel("yok-boyle", HEPSI), "Tümü");
});

test("sıralama: önce sıra, sonra Türkçe ada göre; girdi değişmez", () => {
  const girdi = [row({ id: "c", name: "Çamlıca", sortOrder: 5 }), row({ id: "a", name: "Ataşehir", sortOrder: 5 }), MARINA];
  assert.deepEqual(
    sortBranches(girdi).map((b) => b.id),
    ["marina", "a", "c"],
  );
  assert.equal(girdi[0]!.id, "c");
});

// ---------------------------------------------------------------------------
// Dalga 2: şube kırılımı (migration 0056). Buradan sonrası şemanın ve sorguların
// kurallarını denetler: saf işlev yoksa kaynak metni okunur (docs/SUBE.md).
// ---------------------------------------------------------------------------

const oku = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("şube sütunu taşıyan her tablo silme denetimine girer: yeni para tablosu sessizce kaçamaz", () => {
  const sema = oku("src/server/db/schema.ts");
  // Şemada branchId()/branchIdNullable() çağıran tabloların adları
  const tablolar = new Set<string>();
  const parcalar = sema.split(/\nexport const /).slice(1);
  for (const parca of parcalar) {
    const ad = parca.match(/^(\w+) = pgTable\(/)?.[1];
    if (ad && /branchId(Nullable)?\(\)/.test(parca)) tablolar.add(ad);
  }
  assert.ok(tablolar.size >= 11, `şube sütunlu tablo sayısı beklenenden az: ${tablolar.size}`);

  const sayim = oku("src/server/branches.ts");
  const govde = sayim.slice(sayim.indexOf("export async function branchUsageCount"));
  for (const t of tablolar) {
    assert.ok(govde.includes(`s.${t},`), `branchUsageCount ${t} tablosunu saymıyor: şube silinince ${t} kayıtları öksüz kalır`);
  }
});

test("çakışma hedefi şubeyi içerir: (ay|gün, şube) birincil anahtarına tek sütunla ON CONFLICT düşer", () => {
  // Postgres: "there is no unique or exclusion constraint matching the ON CONFLICT specification".
  // Anahtarı şubeyi içeren tabloya tek sütunlu hedefle yazan kod çalışma anında patlar.
  // Sabit dosya listesi KULLANILMAZ: stock.ts'teki aynı hata listede olmadığı için bir dalga boyunca kaçmıştı.
  const dosyalar = execSync("grep -rl 'onConflictDoUpdate' src --include=*.ts || true", {
    cwd: process.cwd(),
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  assert.ok(dosyalar.length >= 3, "onConflictDoUpdate kullanan dosya bulunamadı: grep bozulmuş olabilir");
  for (const d of dosyalar) {
    const kaynak = oku(d);
    for (const m of kaynak.matchAll(/onConflictDoUpdate\(\{\s*target: (\[[^\]]*\]|[^,\n]+),/g)) {
      const hedef = m[1]!.trim();
      if (!/months|posDayReports|modposCashSheets|cashReports|posDailySales|stockCounts/.test(hedef)) continue;
      assert.match(hedef, /^\[/, `${d}: ${hedef} dizi olmalı (tek sütunlu hedef bileşik anahtarla eşleşmez)`);
      assert.match(hedef, /branchId/, `${d}: ${hedef} şubeyi içermeli`);
    }
  }
});

test("bütünlük denetimi şubeye göre süzülmez: silme güvenliği bütün işletmeye bakar", () => {
  // Marina'ya bakarken Tuzla'da satılmış ürün silinebilir olmamalı (tests/urunler.test.ts bekçisiyle aynı kural)
  const gecmis = oku("src/server/data/product-history.ts");
  assert.ok(!gecmis.includes("currentBranchWhere"), "salesLinesCount şubeye göre süzülmemeli: bu bir görünüm değil");
  const pos = oku("src/server/data/pos-staff.ts");
  assert.ok(!pos.includes("currentBranchWhere"), "modposNameFilter şubeye göre süzülmemeli: ad hangi dönemden, işletme geneli bir soru");
});

test("gider şubesi boş kalabilir: işletme geneli gider tek şube seçiliyken de görünür", () => {
  const sema = oku("src/server/db/schema.ts");
  const gider = sema.slice(sema.indexOf("export const expenseEntries"));
  assert.match(gider.slice(0, 2000), /branchIdNullable\(\)/, "gider şubesi zorunlu olmamalı (işletme geneli: kira, muhasebe, abonelik)");
  const kapsam = oku("src/server/branch-scope.ts");
  // Boş şubeli gideri de getiren koşul var ve isNull kullanıyor
  assert.match(kapsam, /branchWhereWithShared[\s\S]*?or\(eq\(col, scope\), isNull\(col\)\)/);
});

test("seçim yetki vermez: şube çerezi yalnız görünümü süzer", () => {
  const eylem = oku("src/server/actions/branches.ts");
  const govde = eylem.slice(eylem.indexOf("export async function chooseBranchScope"));
  assert.match(govde, /requireUser\(\)/, "seçim ucu oturum ister");
  // Çerezdeki değer kütüğe karşı doğrulanır: tanınmayan ya da pasif kimlik "hepsi"ye düşer
  assert.match(govde, /parseBranchScope\(scope, await listBranches\(\)\)/);
  assert.match(govde, /httpOnly: true/);
});

test("istek dışında süzme yok: betik ve arka plan işi bütün şubeleri görür", () => {
  const kapsam = oku("src/server/branch-scope.ts");
  const govde = kapsam.slice(kapsam.indexOf("const requestBranchScope"));
  // cookies() istek dışında fırlar; yakalanmazsa göç betiği ve zil düşerdi
  assert.match(govde.slice(0, 500), /catch\s*\{\s*return ALL_BRANCHES;/);
});

test("gider süzgeci işletme genelini düşürmez: expenseEntries'te currentBranchWhere değil branchWhereWithShared", () => {
  // Tek şube seçiliyken şubesi boş gider ("işletme geneli": kira, muhasebe, abonelik) de görünmeli.
  // currentBranchWhere kullanılsaydı eq(branch_id, 'tuzla') olur, null satırlar düşer ve her şubenin kârı
  // olduğundan yüksek çıkardı (sahibin kararı, docs/SUBE.md › Dalga 2'nin kararları).
  const hits = execSync(
    "grep -rn 'currentBranchWhere(s.expenseEntries.branchId)' src --include=*.ts --include=*.tsx || true",
    { cwd: process.cwd(), encoding: "utf8" },
  ).trim();
  assert.equal(hits, "", `Gider süzgecinde currentBranchWhere kullanılmış; branchWhereWithShared olmalı:\n${hits}`);
});

test("silme engelinin ay listesi şube seçiminden bağımsız okunur (dataMonths)", () => {
  // tests/sube-silme-engeli-db.test.ts bunu davranışla da denetliyor ama o test veritabanı adresi yoksa atlanır;
  // bu bekçi her koşuda çalışır. dataMonths'un çıktısı yalnız silme / değiştirme engellerine ve ay seçicisine
  // gider: şubeye göre süzülürse Marina seçiliyken Tuzla'da maaş hesabına girmiş kişi silinebilir hale gelir.
  const src = oku("src/server/actions/costs.ts");
  const govde = src.slice(src.indexOf("async function dataMonths"), src.indexOf("async function dataMonths") + 1400);
  assert.match(govde, /withBranchScope\(ALL_BRANCHES/, "dataMonths bütün şubeleri okumalı");
  assert.doesNotMatch(govde, /currentBranchWhere/, "dataMonths şube seçimine göre süzülmemeli");
});

test("silme engelleri şubesiz kalır: çürütme turunda elenen yerler yeniden süzülmesin", () => {
  for (const [yol, gerekce] of [
    ["src/server/data/product-history.ts", "ürün silme güvenliği"],
    ["src/server/data/pos-staff.ts", "POS adı hangi dönemden"],
    ["src/server/cash-outs/guard.ts", "personelin kasa satırı kilidi"],
    ["src/server/cari/kasa.ts", "cari mutabakatı"],
  ] as const) {
    const kaynak = oku(yol);
    assert.ok(
      !kaynak.includes("currentBranchWhere") && !kaynak.includes("branchWhereWithShared"),
      `${yol} şubeye göre süzülmüş (${gerekce}): bu bir görünüm değil, bütünlük denetimi`,
    );
  }
});

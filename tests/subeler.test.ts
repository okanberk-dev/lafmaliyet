// Şube ve kanal kurallarının tamamı (src/lib/branches.ts; docs/SUBE.md): kimlik, tür ↔ kasa kaynağı uyumu, sabit
// kayıtların korunması, silme, süzgeç ve sıralama. Şema ve tohum da buraya bağlıdır: 0053_subeler.sql'deki CHECK
// kuralları saf işlevlerle aynı şeyi söylemeli, yoksa ekran "olur" deyip veritabanı reddeder.
// Çalıştırma: npx tsx --test tests/subeler.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  ALL_BRANCHES,
  BRANCH_KINDS,
  BRANCH_POS_SOURCES,
  branchChangeError,
  branchDeleteError,
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
  assert.equal(branchSourceError("fiziksel", "lafpos"), null);
  assert.equal(branchSourceError("online", "yok"), null);
  assert.notEqual(branchSourceError("online", "modpos"), null);
  assert.notEqual(branchSourceError("fiziksel", "yok"), null);
});

test("0053_subeler.sql CHECK kuralları saf işlevlerle aynı şeyi söyler", () => {
  const sql = readFileSync(join(process.cwd(), "drizzle/0053_subeler.sql"), "utf8");
  for (const k of BRANCH_KINDS) assert.ok(sql.includes(`'${k}'`), k);
  for (const p of BRANCH_POS_SOURCES) assert.ok(sql.includes(`'${p}'`), p);
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
  assert.equal(branchChangeError(MARINA, { kind: "fiziksel", posSource: "lafpos", active: true }, [TUZLA, ONLINE]), null);
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

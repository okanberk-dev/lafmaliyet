// Şube seçicisinin derin bağlantısı (docs/SUBE.md › Seçici; denetim 21 Kasım #22): paylaşılan bağlantıdaki `?sube=`
// her bağlantıda bir kez çereze benimsetilir ve adresten düşer. Anahtar bağlantının kendisidir, değer değil:
// aynı bağlantı sonradan yeniden açılınca yine benimsenir, adreste kalmış eski `?sube=` seçiciden yapılan seçimi geri
// almaz.
// Çalıştırma: npx tsx --test tests/sube-secici.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ALL_BRANCHES, branchLinkStep, type BranchRow, type BranchScope } from "../src/lib/branches";

const row = (id: string, active = true): BranchRow => ({ id, name: id, kind: "fiziksel", posSource: "modpos", active, openedOn: null, sortOrder: 1 });
const SUBELER = [row("tuzla"), row("marina"), { ...row("online"), kind: "online", posSource: "yok" } satisfies BranchRow];

/**
 * Seçicinin etkisini adım adım oynatır: her çağrı bir render (adres + çerezdeki seçim), dönen iş seçicinin yapacağı
 * (çereze yazma + adresi temizleme). Ref gibi anahtarı çağrılar arasında saklar.
 */
function secici(locked = false) {
  let ref: string | null = null;
  return (adres: string, scope: BranchScope) => {
    const [pathname, search = ""] = adres.split("?");
    const adim = branchLinkStep({ pathname, search, scope, branches: SUBELER, locked, adopted: ref });
    ref = adim.key;
    return adim.adopt;
  };
}

test("bağlantı: farklı şube çereze yazılır, ?sube= düşer, öteki sorgu alanları sırasıyla kalır", () => {
  const gor = secici();
  assert.deepEqual(gor("/panel/kasa?gun=2026-11-20&sube=marina&x=1", ALL_BRANCHES), { scope: "marina", href: "/panel/kasa?gun=2026-11-20&x=1" });
  assert.deepEqual(secici()("/panel/kasa?sube=marina", "tuzla"), { scope: "marina", href: "/panel/kasa" });
});

test("bağlantı bir kez benimsenir: çerez yenilenip sayfa yeniden çizilince iş tekrarlanmaz", () => {
  const gor = secici();
  assert.ok(gor("/panel/kasa?gun=D&sube=marina", ALL_BRANCHES));
  // chooseBranchScope → refresh(): çerez marina, adres henüz temizlenmedi
  assert.equal(gor("/panel/kasa?gun=D&sube=marina", "marina"), null);
  // router.replace sonrası
  assert.equal(gor("/panel/kasa?gun=D", "marina"), null);
});

test("#22 (a): aynı bağlantı, arada seçiciden Tümü seçilince yeniden benimsenir (anahtar değer değil bağlantı)", () => {
  const gor = secici();
  // Bugün (Tümü) → Marina satırı
  assert.deepEqual(gor("/panel/kasa?gun=D&sube=marina", ALL_BRANCHES), { scope: "marina", href: "/panel/kasa?gun=D" });
  assert.equal(gor("/panel/kasa?gun=D&sube=marina", "marina"), null);
  assert.equal(gor("/panel/kasa?gun=D", "marina"), null);
  // Bugün'e dönüp seçiciden Tümü
  assert.equal(gor("/panel/bugun", "marina"), null);
  assert.equal(gor("/panel/bugun", ALL_BRANCHES), null);
  // Marina satırına yeniden: eski kod (ref === "marina") burada hiçbir şey yapmıyor, kasa Tuzla'nın formunu açıyordu
  assert.deepEqual(gor("/panel/kasa?gun=D&sube=marina", ALL_BRANCHES), { scope: "marina", href: "/panel/kasa?gun=D" });
});

test("#22 (b): çerez zaten bağlantının şubesindeyse yalnız adres temizlenir; sonraki seçim geri alınmaz", () => {
  const gor = secici();
  // Çerez marina, bağlantı &sube=marina: çereze yazılmaz ama ?sube= yine düşer
  assert.deepEqual(gor("/panel/kasa?gun=D&sube=marina", "marina"), { scope: null, href: "/panel/kasa?gun=D" });
  // Adres temizlenmeden (ya da temizleme düşmeden) seçiciden Tuzla seçilir: eski ?sube= seçimi geri almaz
  assert.equal(gor("/panel/kasa?gun=D&sube=marina", "tuzla"), null);
  assert.equal(gor("/panel/kasa?gun=D&sube=marina", ALL_BRANCHES), null);
});

test("adreste ?sube= kalmışken başka bir bağlantı açılırsa o da benimsenir", () => {
  const gor = secici();
  assert.ok(gor("/panel/kasa?gun=D&sube=marina", ALL_BRANCHES));
  // Adres temizlenemedi (ağ hatası); kullanıcı başka günün Marina bağlantısını açar
  assert.deepEqual(gor("/panel/kasa?gun=E&sube=marina", ALL_BRANCHES), { scope: "marina", href: "/panel/kasa?gun=E" });
  // Aynı sorgu başka sayfada da ayrı bağlantıdır
  assert.ok(gor("/panel/kasa/gecmis?gun=E&sube=marina", ALL_BRANCHES));
});

test("baştaki ? zarar vermez; tanınmayan ya da kapalı şube Tümü'ye düşer", () => {
  assert.deepEqual(branchLinkStep({ pathname: "/panel", search: "?sube=marina", scope: "tuzla", branches: SUBELER, locked: false, adopted: null }), {
    key: "/panel?sube=marina",
    adopt: { scope: "marina", href: "/panel" },
  });
  assert.deepEqual(secici()("/panel/kasa?sube=yok-boyle", "tuzla"), { scope: ALL_BRANCHES, href: "/panel/kasa" });
  const kapali = branchLinkStep({ pathname: "/panel", search: "sube=marina", scope: ALL_BRANCHES, branches: [row("tuzla"), row("marina", false)], locked: false, adopted: null });
  assert.deepEqual(kapali.adopt, { scope: null, href: "/panel" });
});

test("?sube= yoksa ya da şube kilitliyse iş yok ve anahtar sıfırlanır", () => {
  assert.deepEqual(branchLinkStep({ pathname: "/panel/kasa", search: "gun=D", scope: "tuzla", branches: SUBELER, locked: false, adopted: "/panel/kasa?gun=D&sube=marina" }), { key: null, adopt: null });
  const kilitli = secici(true);
  assert.equal(kilitli("/panel/kasa?gun=D&sube=marina", "tuzla"), null);
  assert.equal(kilitli("/panel/kasa?gun=D&sube=marina", "tuzla"), null);
});

test("seçici branchLinkStep'i kullanır: anahtar bağlantı, ?sube= aynı şubede de düşer", () => {
  const src = readFileSync(join(process.cwd(), "src/components/panel/branch-picker.tsx"), "utf8");
  assert.match(src, /branchLinkStep\(\{ pathname, search, scope, branches, locked, adopted: benimsenen\.current \}\)/);
  assert.match(src, /benimsenen\.current = adim\.key;/);
  assert.match(src, /if \(secim !== null\) await chooseBranchScope\(\{ scope: secim \}\);\s*router\.replace\(href\);/);
  // Eski değer anahtarı geri gelmesin
  assert.doesNotMatch(src, /benimsenen\.current === istenen|benimsenen\.current = istenen/);
});

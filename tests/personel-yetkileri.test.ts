// Personel rolünün metinleri bugünkü ekranlarla aynı: Kullanıcılar & roller'deki yetki tablosu personelin her ekranını
// bir satırda sayar, rol seçicinin açıklaması ve Yardım'daki "Personele hesap açmak" da (Bugün, kasa raporu, kontrol
// listeleri, zayi, stok sayımı ve Listeye ekle, reçete defteri ve öneri, karaoke ve bar ekranı).
// Çalıştırma: npx tsx --test tests/personel-yetkileri.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ADMIN_ONLY_PATHS, ROLE_PERMISSIONS, STAFF_PATHS, STAFF_ROLE_HINT } from "../src/lib/roles";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

test("yetki tablosu: personelin her ekranı personele açık bir satırda; satırların ekranları gerçekten personelin", () => {
  const covered = new Set(ROLE_PERMISSIONS.filter((p) => p.staff).flatMap((p) => p.paths ?? []));
  for (const path of STAFF_PATHS) assert.ok(covered.has(path), `${path} yetki tablosunda yok`);
  for (const p of ROLE_PERMISSIONS) {
    assert.ok(p.admin, `${p.label}: yönetici her şeyi yapar`);
    for (const path of p.paths ?? []) assert.ok((STAFF_PATHS as readonly string[]).includes(path), `${p.label}: ${path} personel ekranı değil`);
    if (!p.staff) assert.equal(p.paths, undefined, `${p.label}: yalnız yöneticinin satırı personel ekranı göstermez`);
  }
  // Personel yolunun altındaki yönetici ekranı (Karaoke doluluğu) yönetici satırında
  assert.ok(ADMIN_ONLY_PATHS.includes("/panel/karaoke/doluluk"));
  assert.ok(ROLE_PERMISSIONS.some((p) => !p.staff && /karaoke doluluğu/i.test(p.label)));
  // Bugünkü işler: kasa raporu ve fotoğraf, kontrol listeleri, zayi, Listeye ekle, öneri ve satış fiyatı, bar ekranı
  const staffText = ROLE_PERMISSIONS.filter((p) => p.staff)
    .map((p) => p.label)
    .join(" | ");
  for (const word of ["kasa raporu", "fotoğraf", "kontrol listeleri", "Zayi", "Listeye ekle", "yeni ürün önerisi", "satış fiyatı", "bar ekranı", "Bugün"]) {
    assert.ok(staffText.toLocaleLowerCase("tr-TR").includes(word.toLocaleLowerCase("tr-TR")), word);
  }
  // "tutarsız" Türkçede "çelişkili" diye okunur: rezervasyonların tutarını personelin görmediği açıkça yazılır
  assert.doesNotMatch(staffText, /tutarsız/);
  assert.match(staffText, /rezervasyonlar, tükenen ürünü işaretleme \(personel tutarları görmez\)/);
  // Dalga 10: onaya giden işler ve yeni ekranlar (docs/ONAYLAR.md)
  for (const word of ["yönetici onaylar", "Kasadaki fiyatlar", "son 7 gün", "Özel günler", "Yardım"]) {
    assert.ok(`${staffText} | ${STAFF_ROLE_HINT}`.toLocaleLowerCase("tr-TR").includes(word.toLocaleLowerCase("tr-TR")), word);
  }
  assert.ok(ROLE_PERMISSIONS.some((p) => !p.staff && /Onaylar/.test(p.label)));
  // Vergi (dalga 12): yalnız yönetici
  assert.ok(ROLE_PERMISSIONS.some((p) => p.admin && !p.staff && /^Vergi: tahmini vergi takvimi/.test(p.label) && !p.paths));
  // Hızlı sayım ve mal siparişi 26 Eki 2026'da kaldırıldı: tabloda ve rol açıklamasında yok
  assert.doesNotMatch(`${ROLE_PERMISSIONS.map((p) => p.label).join(" | ")} | ${STAFF_ROLE_HINT}`, /hızlı sayım|mal siparişi|sipariş taslağı/i);
  // Personel maliyet, maaş ve kâr görmez: yalnız yöneticinin satırlarında
  assert.doesNotMatch(staffText, /maliyet|maaş|kâr|komisyon/i);
});

test("rol seçicinin açıklaması ve tablo tek kaynaktan; eski 'yalnız sayım ve reçete' metni kalmadı", () => {
  const users = read("src/app/panel/kullanicilar/users-client.tsx");
  assert.match(users, /\{ value: "staff", label: ROLES\.staff, hint: STAFF_ROLE_HINT \}/);
  assert.match(users, /\{ROLE_PERMISSIONS\.map\(\(p\) => \(/);
  assert.doesNotMatch(users, /const PERMISSIONS:/);
  for (const word of ["Bugün", "kasa raporu", "listeleri", "zayi", "stok sayımı", "reçete defteri", "karaoke"]) {
    assert.ok(STAFF_ROLE_HINT.toLocaleLowerCase("tr-TR").includes(word.toLocaleLowerCase("tr-TR")), word);
  }
  const yardim = read("src/app/panel/yardim/page.tsx");
  assert.doesNotMatch(yardim, /Personel\s+yalnızca stok sayımını ve reçete defterini görür/);
  const faq = yardim.slice(yardim.indexOf('q: "Personele hesap açmak"'), yardim.indexOf("icon: UserPlus"));
  for (const word of ["Bugün", "Karaoke", "Kasa raporu", "Kontrol listeleri", "Zayi &amp; ikram", "Reçete", "satış fiyatı", "Stok sayımı", "Listeye ekle", "Hatırlatıcılarım", "Hesabım", "görmez"]) {
    assert.ok(faq.includes(word), `Yardım: ${word}`);
  }
});

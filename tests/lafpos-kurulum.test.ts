// Şube kurulumu (docs/LAFPOS.md › Şube kurulumu; src/lib/lafpos/kurulum.ts, kurulum-mail.ts): şubeyi yalnız ana
// yönetici ekler; şubeye özel kurucu genel kurucunun iki boş satırına panelin adresini ve tek kullanımlık kodu yazar;
// kasa kodu verince bağlantılar (yalnız tanımlı ve yeterince uzun olanlar) döner. Uçlar ve eylem de burada bağlı mı
// diye okunur.
// Çalıştırma: npx tsx --test tests/lafpos-kurulum.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  ANA_ADMIN_EMAIL,
  isAnaAdmin,
  KOD_RE,
  kurucuDosyaAdi,
  kurucuWithCode,
  kurulumBaglantilari,
  kurulumDurumu,
  kurulumLink,
} from "../src/lib/lafpos/kurulum";
import { kurulumMail } from "../src/lib/lafpos/kurulum-mail";

const KOD = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde";
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

test("şubeyi yalnız ana yönetici ekler: yönetici rolü ve info@nextgenlab.com.tr (harf büyüklüğü fark etmez)", () => {
  assert.equal(ANA_ADMIN_EMAIL, "info@nextgenlab.com.tr");
  assert.equal(isAnaAdmin({ role: "admin", email: "Info@NextGenLab.com.tr" }, {}), true);
  assert.equal(isAnaAdmin({ role: "admin", email: "patron@laffogato.net" }, {}), false);
  assert.equal(isAnaAdmin({ role: "staff", email: "info@nextgenlab.com.tr" }, {}), false);
  assert.equal(isAnaAdmin(null, {}), false);
  // Ortamla değişir
  assert.equal(isAnaAdmin({ role: "admin", email: "a@b.co" }, { LADMIN_ANA_ADMIN: "a@b.co" }), true);
});

test("kurucuya adres ve kod yazılır; satırlar yoksa (eski kurucu) ya da kod bozuksa hata", () => {
  const cmd = "<# : x\r\n#>\r\n$Gomulu = 1\r\n$KurulumAdresi = ''\r\n$KurulumKodu = ''\r\nWrite-Host 'ok'\r\n";
  const out = kurucuWithCode(cmd, "https://ladmin.laffogato.net/panel", KOD);
  assert.match(out, /\$KurulumAdresi = 'https:\/\/ladmin\.laffogato\.net'\r\n/);
  assert.ok(out.includes(`$KurulumKodu = '${KOD}'\r\n`));
  assert.ok(out.endsWith("Write-Host 'ok'\r\n"));
  assert.throws(() => kurucuWithCode("Write-Host 'eski'", "https://ladmin.laffogato.net", KOD), /güncel değil/);
  assert.throws(() => kurucuWithCode(cmd, "https://ladmin.laffogato.net", "kisa"), /geçersiz/);
  assert.throws(() => kurucuWithCode(cmd, "http://ladmin.laffogato.net", KOD), /https/);
  assert.equal(kurucuDosyaAdi("kadikoy"), "LafPOS-Kur-kadikoy.cmd");
  assert.equal(kurulumLink("https://ladmin.laffogato.net/x", KOD), `https://ladmin.laffogato.net/lafpos/indir/${KOD}`);
  assert.ok(KOD_RE.test(KOD));
});

test("LafPOS'un genel kurucusu iki boş satırı taşır (lafpos web-kurucu.ps1 ile aynı yazım)", () => {
  // Sözleşme: lafpos deposunda scripts/kasa/windows/kurulum/web-kurucu.ps1 bu iki satırı birebir yazar
  const cmd = "$KurulumAdresi = ''\n$KurulumKodu = ''\n";
  assert.doesNotThrow(() => kurucuWithCode(cmd, "https://ladmin.laffogato.net", KOD));
});

test("kodun durumu: kullanıldı, iptal, süresi doldu, bekliyor", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  const later = new Date("2026-12-01T00:00:00Z");
  assert.equal(kurulumDurumu({ usedAt: now, revokedAt: null, expiresAt: later }, now), "kuruldu");
  assert.equal(kurulumDurumu({ usedAt: null, revokedAt: now, expiresAt: later }, now), "iptal");
  assert.equal(kurulumDurumu({ usedAt: null, revokedAt: null, expiresAt: now }, now), "suresi-doldu");
  assert.equal(kurulumDurumu({ usedAt: null, revokedAt: null, expiresAt: later }, now), "bekliyor");
});

test("kasaya giden bağlantılar: panel adresi her zaman; anahtar 32 karakterden kısaysa yok; Uzaktan ve site ortamda tanımlıysa", () => {
  const secret = "s".repeat(40);
  assert.deepEqual(kurulumBaglantilari({ panelUrl: "https://ladmin.laffogato.net/panel", syncSecret: secret, env: {} }), {
    LAFMALIYET_URL: "https://ladmin.laffogato.net",
    LAFMALIYET_SYNC_SECRET: secret,
  });
  assert.deepEqual(kurulumBaglantilari({ panelUrl: "https://ladmin.laffogato.net", syncSecret: "kisa", env: {} }), { LAFMALIYET_URL: "https://ladmin.laffogato.net" });
  const full = kurulumBaglantilari({
    panelUrl: "https://ladmin.laffogato.net",
    syncSecret: secret,
    env: { LAFPOS_CLOUD_URL: "https://lafpos.laffogato.net", LAFPOS_CLOUD_SECRET: "c".repeat(40), LAFPOS_SITE_URL: "https://laffogato.net", LAFPOS_SITE_SECRET: "kisa" },
  });
  assert.equal(full.LAFPOS_CLOUD_URL, "https://lafpos.laffogato.net");
  assert.equal(full.LAFPOS_CLOUD_SECRET, "c".repeat(40));
  assert.equal(full.LAFFOGATO_URL, undefined);
});

test("kurulum e-postası: indirme düğmesi, davet bağlantısı (hesap açıldıysa), şube adı kaçışlı", () => {
  const m = kurulumMail({ branchName: "Kadıköy <Moda>", downloadUrl: `https://ladmin.laffogato.net/lafpos/indir/${KOD}`, inviteUrl: "https://ladmin.laffogato.net/davet?t=x", loginUrl: "https://ladmin.laffogato.net/giris", until: "10 Aralık 2026" });
  assert.equal(m.subject, "Kadıköy <Moda> şubesi: LafPOS kurulumu");
  assert.ok(m.html.includes("Kadıköy &lt;Moda&gt; şubesi"));
  assert.ok(!m.html.includes("<Moda>"));
  assert.ok(m.html.includes(`/lafpos/indir/${KOD}`));
  assert.ok(m.html.includes("davet?t=x"));
  assert.ok(m.text.includes("Parolamı") || m.text.includes("parolasını"));
  const noInvite = kurulumMail({ branchName: "Moda", downloadUrl: "https://x.test/lafpos/indir/k", inviteUrl: null, loginUrl: "https://x.test/giris", until: "x" });
  assert.ok(!noInvite.html.includes("davet?t="));
});

test("bağlantılar kurulu: şube eklemek ana yöneticide, uçlar herkese açık (oturumsuz), şema ve göç var", () => {
  const actions = read("src/server/actions/branches.ts");
  assert.match(actions, /export async function createBranch[\s\S]*?requireAnaAdmin\(\)/);
  assert.match(actions, /export async function sendBranchInstall[\s\S]*?requireAnaAdmin\(\)/);
  assert.ok(read("src/app/api/lafpos/kurulum/route.ts").includes("redeemInstallCode"));
  assert.ok(read("src/app/lafpos/indir/[kod]/route.ts").includes("kurucuWithCode"));
  // Oturum kalkanı (proxy) yalnız paneli ve dışa aktarmayı kapsar: kasa ve indirme oturumsuz çalışır
  const proxy = read("src/proxy.ts");
  assert.ok(!proxy.includes("/lafpos/") && !proxy.includes("/api/lafpos"));
  assert.ok(read("drizzle/0095_lafpos_kurulum.sql").includes('CREATE TABLE "lafpos_installs"'));
});

test("LafPOS kasası kur: şube listeden seçilir ya da aynı pencerede yeni şube eklenir; kart yalnız ana yöneticiye", () => {
  const page = read("src/app/panel/subeler/page.tsx");
  assert.match(page, /canCreate \? <LafposInstallCard/);
  const card = read("src/app/panel/subeler/lafpos-install.tsx");
  assert.ok(card.includes("Kasa hangi şubeye bağlanacak"));
  assert.ok(card.includes("+ Yeni şube ekle"));
  // Var olan şubeye bağlantı, yeni şubede ekleme ve bağlantı tek eylemle
  assert.ok(card.includes("installAction({ id: t.branch"));
  assert.match(card, /createAction\(\{[^}]*email: t\.email\.trim\(\)/);
});


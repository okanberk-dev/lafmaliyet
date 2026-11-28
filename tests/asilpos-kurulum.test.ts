// Şube kurulumu (docs/ASILPOS.md › Şube kurulumu; src/lib/asilpos/kurulum.ts, kurulum-mail.ts): şubeyi yalnız ana
// yönetici ekler; şubeye özel kurucu genel kurucunun iki boş satırına panelin adresini ve tek kullanımlık kodu yazar;
// kasa kodu verince bağlantılar (yalnız tanımlı ve yeterince uzun olanlar) döner; Hesabım'daki kurulum kartını yalnız
// şubenin kendi hesabı görür (isBranchAccount). Uçlar, eylem ve Hesabım da burada bağlı mı diye okunur.
// Çalıştırma: npx tsx --test tests/asilpos-kurulum.test.ts

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { posEnv, posEnvName } from "../src/lib/asilpos/env";
import { ESKI_ENV_ONEKI, ESKI_INDIR_YOLU, ESKI_KURULUM_YOLU, ESKI_WEB_KURUCU, KANAL_ALANI, TEL_UZAK_ADRES_ENV, TEL_UZAK_ANAHTAR_ENV } from "../src/lib/asilpos/eski-adlar";
import {
  ANA_ADMIN_EMAIL,
  fetchKurucu,
  isAnaAdmin,
  isBranchAccount,
  KOD_RE,
  kurucuAdresleri,
  KURUCU_URLLERI,
  kurucuDosyaAdi,
  kurucuWithCode,
  kurulumBaglantilari,
  kurulumDurumu,
  kurulumLink,
} from "../src/lib/asilpos/kurulum";
import { kurulumMail } from "../src/lib/asilpos/kurulum-mail";

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

test("Hesabım'daki kurulum kartı yalnız şubenin kendi hesabına", () => {
  // Bağlantıdaki kod kasanın eşitleme anahtarını verir (POST /api/asilpos/kurulum): şubenin öbür personeli, müdürü,
  // muhasebeci ve yönetici görmez (veritabanında: tests/asilpos-kurulum-db.test.ts)
  const install = { branchId: "marina", email: "marina@ornek.com" };
  const hesap = (role: string, email: string, branchId: string | null) => ({ role, email, branchId });
  assert.equal(isBranchAccount(hesap("staff", "marina@ornek.com", "marina"), install), true, "şubenin hesabı");
  assert.equal(isBranchAccount(hesap("staff", " Marina@Ornek.COM ", "marina"), install), true, "harf büyüklüğü ve boşluk fark etmez");
  assert.equal(isBranchAccount(hesap("staff", "barista@ornek.com", "marina"), install), false, "şubenin öbür personeli");
  assert.equal(isBranchAccount(hesap("staff", "marina@ornek.com", "tuzla"), install), false, "öteki şubeye kilitli aynı adres");
  assert.equal(isBranchAccount(hesap("staff", "marina@ornek.com", null), install), false, "şubesiz personel");
  assert.equal(isBranchAccount({ role: "staff", email: "marina@ornek.com" }, install), false, "şubesi verilmemiş");
  assert.equal(isBranchAccount(hesap("manager", "mudur@ornek.com", "marina"), install), false, "şubenin müdürü");
  // Şube hesabı yalnız personel olabilir (branchEmailTaken): adres bir müdürde olsa da kart ona gitmez
  assert.equal(isBranchAccount(hesap("manager", "marina@ornek.com", "marina"), install), false, "aynı adresteki müdür");
  assert.equal(isBranchAccount(hesap("accountant", "marina@ornek.com", null), install), false, "muhasebeci");
  assert.equal(isBranchAccount(hesap("admin", "marina@ornek.com", null), install), false, "yönetici");
  assert.equal(isBranchAccount(hesap("admin", ANA_ADMIN_EMAIL, null), install), false, "ana yönetici");
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
  assert.equal(kurucuDosyaAdi("kadikoy"), "AsilPOS-Kur-kadikoy.cmd");
  assert.equal(kurulumLink("https://ladmin.laffogato.net/x", KOD), `https://ladmin.laffogato.net/asilpos/indir/${KOD}`);
  assert.ok(KOD_RE.test(KOD));
});

test("AsilPOS'un genel kurucusu iki boş satırı taşır (asilpos web-kurucu.ps1 ile aynı yazım)", () => {
  // Sözleşme: AsilPOS deposunda scripts/kasa/windows/kurulum/web-kurucu.ps1 bu iki satırı birebir yazar
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
  // Panelin ortamı: yeni ad (ASILPOS_*) ya da eski adı; kasaya giden Uzaktan anahtarları eski adla (kurulu kasanın beyaz listesi)
  const E = ESKI_ENV_ONEKI;
  const yeni = { ASILPOS_CLOUD_URL: `https://${KANAL_ALANI}`, ASILPOS_CLOUD_SECRET: "c".repeat(40), ASILPOS_SITE_URL: "https://laffogato.net", ASILPOS_SITE_SECRET: "kisa" };
  const eski = { [`${E}CLOUD_URL`]: `https://${KANAL_ALANI}`, [`${E}CLOUD_SECRET`]: "c".repeat(40), [`${E}SITE_URL`]: "https://laffogato.net", [`${E}SITE_SECRET`]: "kisa" };
  for (const env of [yeni, eski]) {
    const full = kurulumBaglantilari({ panelUrl: "https://ladmin.laffogato.net", syncSecret: secret, env });
    assert.equal(full[TEL_UZAK_ADRES_ENV], `https://${KANAL_ALANI}`);
    assert.equal(full[TEL_UZAK_ANAHTAR_ENV], "c".repeat(40));
    assert.equal(full.ASILPOS_CLOUD_URL, undefined, "yeni ad kasaya gitmez (kurulu kasa tanımaz)");
    assert.equal(full.LAFFOGATO_URL, undefined);
  }
});

test("ortam değişkenleri: önce ASILPOS_X, boşsa eski adı; durum metni tanımlı olanın adını söyler", () => {
  const E = ESKI_ENV_ONEKI;
  assert.equal(posEnv("SYNC_SECRET", { ASILPOS_SYNC_SECRET: "yeni", [`${E}SYNC_SECRET`]: "eski" }), "yeni");
  assert.equal(posEnv("SYNC_SECRET", { ASILPOS_SYNC_SECRET: " ", [`${E}SYNC_SECRET`]: "eski" }), "eski", "boş yeni ad eskisine düşer");
  assert.equal(posEnv("SYNC_SECRET", {}), undefined);
  assert.equal(posEnvName("SYNC_SECRET", { [`${E}SYNC_SECRET`]: "eski" }), `${E}SYNC_SECRET`);
  assert.equal(posEnvName("SYNC_SECRET", { ASILPOS_SYNC_SECRET: "yeni", [`${E}SYNC_SECRET`]: "eski" }), "ASILPOS_SYNC_SECRET");
  assert.equal(posEnvName("KURUCU_URL", {}), "ASILPOS_KURUCU_URL", "ikisi de yoksa eklenecek yeni ad");
});

test("genel kurucu: önce yeni adlı, kanal yayımlamıyorsa (404) eski adlı; ortamdaki adres tek aday", async () => {
  assert.deepEqual(KURUCU_URLLERI, [`https://${KANAL_ALANI}/guncelleme/AsilPOS-Kur.cmd`, `https://${KANAL_ALANI}/guncelleme/${ESKI_WEB_KURUCU}`]);
  assert.deepEqual(kurucuAdresleri({}), [...KURUCU_URLLERI]);
  assert.deepEqual(kurucuAdresleri({ [`${ESKI_ENV_ONEKI}KURUCU_URL`]: "https://x.test/k.cmd" }), ["https://x.test/k.cmd"]);
  assert.deepEqual(kurucuAdresleri({ ASILPOS_KURUCU_URL: "https://y.test/k.cmd", [`${ESKI_ENV_ONEKI}KURUCU_URL`]: "https://x.test/k.cmd" }), ["https://y.test/k.cmd"]);
  const istenen: string[] = [];
  const sahte = (cevap: Record<string, number>) =>
    (async (url: string | URL | Request) => {
      istenen.push(String(url));
      const status = cevap[String(url)] ?? 404;
      return new Response(status === 200 ? "kurucu" : "yok", { status });
    }) as typeof fetch;
  assert.equal(await fetchKurucu(KURUCU_URLLERI, sahte({ [KURUCU_URLLERI[1]]: 200 })), "kurucu");
  assert.deepEqual(istenen, [...KURUCU_URLLERI], "404'te sonraki aday");
  istenen.length = 0;
  assert.equal(await fetchKurucu(KURUCU_URLLERI, sahte({ [KURUCU_URLLERI[0]]: 200 })), "kurucu");
  assert.deepEqual(istenen, [KURUCU_URLLERI[0]], "yeni ad varsa eskisi istenmez");
  await assert.rejects(fetchKurucu(KURUCU_URLLERI, sahte({ [KURUCU_URLLERI[0]]: 500, [KURUCU_URLLERI[1]]: 200 })), /HTTP 500/, "404 dışı hata durdurur");
  await assert.rejects(fetchKurucu(KURUCU_URLLERI, sahte({})), /HTTP 404/);
});

test("kurulum e-postası: indirme düğmesi, davet bağlantısı (hesap açıldıysa), şube adı kaçışlı", () => {
  const m = kurulumMail({ branchName: "Kadıköy <Moda>", downloadUrl: `https://ladmin.laffogato.net/asilpos/indir/${KOD}`, inviteUrl: "https://ladmin.laffogato.net/davet?t=x", loginUrl: "https://ladmin.laffogato.net/giris", until: "10 Aralık 2026" });
  assert.equal(m.subject, "Kadıköy <Moda> şubesi: AsilPOS kurulumu");
  assert.ok(m.html.includes("Kadıköy &lt;Moda&gt; şubesi"));
  assert.ok(!m.html.includes("<Moda>"));
  assert.ok(m.html.includes(`/asilpos/indir/${KOD}`));
  assert.ok(m.html.includes("davet?t=x"));
  assert.ok(m.text.includes("Parolamı") || m.text.includes("parolasını"));
  const noInvite = kurulumMail({ branchName: "Moda", downloadUrl: "https://x.test/asilpos/indir/k", inviteUrl: null, loginUrl: "https://x.test/giris", until: "x" });
  assert.ok(!noInvite.html.includes("davet?t="));
});

test("bağlantılar kurulu: şube eklemek asıl yöneticide, uçlar herkese açık (oturumsuz), şema ve göç var", () => {
  const actions = read("src/server/actions/branches.ts");
  assert.match(actions, /export async function createBranch[\s\S]*?requireAnaAdmin\("subeAcma"\)/);
  assert.match(actions, /export async function sendBranchInstall[\s\S]*?requireAnaAdmin\("kasaKurma"\)/);
  // Yeni ve eski yol aynı işleyiciyi (ve aynı IP sınırını) dışa verir: kurulu kasa eski yolu, yeni kasa yenisini çağırır
  assert.ok(read("src/server/asilpos/kurulum-route.ts").includes("redeemInstallCode"));
  assert.ok(read("src/server/asilpos/indir-route.ts").includes("kurucuWithCode"));
  for (const yol of ["src/app/api/asilpos/kurulum/route.ts", `src/app${ESKI_KURULUM_YOLU}/route.ts`]) {
    assert.match(read(yol), /^export \{ POST \} from "@\/server\/asilpos\/kurulum-route";$/m, yol);
  }
  for (const yol of ["src/app/asilpos/indir/[kod]/route.ts", `src/app${ESKI_INDIR_YOLU}/[kod]/route.ts`]) {
    assert.match(read(yol), /^export \{ GET \} from "@\/server\/asilpos\/indir-route";$/m, yol);
  }
  // Oturum kalkanı (proxy) yalnız paneli ve dışa aktarmayı kapsar: kasa ve indirme oturumsuz çalışır (iki yol da)
  const proxy = read("src/proxy.ts");
  assert.ok(!proxy.includes("/asilpos/") && !proxy.includes("/api/asilpos") && !proxy.includes(ESKI_INDIR_YOLU) && !proxy.includes(ESKI_KURULUM_YOLU));
  const goc = readdirSync(join(__dirname, "..", "drizzle")).find((f) => f.startsWith("0095_"))!;
  assert.ok(read(`drizzle/${goc}`).includes("CREATE TABLE"));
  assert.ok(read("drizzle/0098_asilpos_adi.sql").includes('RENAME TO "asilpos_installs"'));
  // Hesabım bağlantıyı yalnız şubenin kendi hesabına okur (listInstalls şubenin bütün bağlantılarını açar)
  const hesap = read("src/app/panel/hesap/page.tsx");
  assert.ok(hesap.includes("installForAccount("), "Hesabım installForAccount'tan okur");
  assert.ok(!hesap.includes("listInstalls("), "Hesabım listInstalls'u çağırmaz");
});

test("Bilgisayara kur Yönetim konsolunda (yalnız asıl yönetici); ladmin'de kurulum düğmesi yok, yerinde tek cümle", () => {
  // Şubeler: "AsilPOS kasası kur" kartı, "Şube ekle" düğmesi ve Şube ekleme bağlantısı yok; yerinde "Bu iş Yönetim
  // konsolunda yapılır", asıl yöneticiye konsolun Şubeler ve kasalar sayfasına bağlantı (K-C)
  const page = read("src/app/panel/subeler/page.tsx");
  assert.ok(!page.includes("AsilposInstallCard") && !page.includes("createBranch") && !page.includes("sendBranchInstall"));
  assert.ok(!existsSync(join(__dirname, "..", "src/app/panel/subeler/asilpos-install.tsx")), "eski kart dosyası silindi");
  const admin = read("src/app/panel/subeler/branches-admin.tsx");
  assert.ok(!admin.includes("/panel/sube-ekleme"), "Şube ekleme bağlantısı kalktı");
  assert.ok(admin.includes('konu="Şube açmak ve kasa kurmak"'));
  // Konsol › Şubeler ve kasalar: yeni şube (e-postayla kurulum da gider) ve var olan şubeye bağlantı; ladmin'de çizilmez
  assert.ok(read("src/app/yonetim/(konsol)/page.tsx").includes("installAction={sendBranchInstall}"));
  assert.ok(!read("src/app/panel/sube-ekleme/page.tsx").includes("sendBranchInstall"));
  const client = read("src/components/sube-ekleme/sube-ekleme-client.tsx");
  assert.match(client, /createAction\(\{[\s\S]*?\.\.\.\(email \? \{ email \} : \{\}\)/);
  assert.match(client, /installAction\(\{ id: b\.id, \.\.\.\(email\.trim\(\) \? \{ email: email\.trim\(\) \} : \{\}\)/);
  assert.ok(client.includes("Bilgisayara kur"));
  // Bayat ipucu ("AsilPOS bugün yalnız bir şubenin gün sonunu alır") hiçbir ekranda kalmadı
  for (const f of ["src/components/sube-ekleme/sube-ekleme-client.tsx", "src/app/panel/subeler/branches-admin.tsx"]) assert.ok(!read(f).includes("yalnız bir şubenin gün sonunu"), f);
});

test("var olan kasalara giden bağlantılar: Uzaktan ve site (lafmaliyet hariç), sürüm değerlerin özeti", async () => {
  const { dagitilanBaglantilar } = await import("../src/lib/asilpos/baglanti-dagitim");
  assert.deepEqual(dagitilanBaglantilar({}), { surum: "", baglanti: {} });
  const env = { ASILPOS_CLOUD_URL: `https://${KANAL_ALANI}`, ASILPOS_CLOUD_SECRET: "c".repeat(40), ASILPOS_SITE_URL: "https://laffogato.net", ASILPOS_SITE_SECRET: "s".repeat(40) };
  const a = dagitilanBaglantilar(env);
  // Anahtar adları kasanınkiler (Uzaktan eski adla): ad değişirse `surum` değişir, her kasa ayarını yeniden yazar
  assert.deepEqual(Object.keys(a.baglanti), ["LAFFOGATO_SYNC_SECRET", "LAFFOGATO_URL", TEL_UZAK_ANAHTAR_ENV, TEL_UZAK_ADRES_ENV]);
  assert.equal(a.surum.length, 16);
  assert.notEqual(dagitilanBaglantilar({ ...env, ASILPOS_CLOUD_SECRET: "d".repeat(40) }).surum, a.surum);
  // Eski adlı ortam aynı bağlantıyı ve aynı sürümü verir (ad değişikliği kasaları yeniden başlatmaz)
  const E = ESKI_ENV_ONEKI;
  const eski = { [`${E}CLOUD_URL`]: env.ASILPOS_CLOUD_URL, [`${E}CLOUD_SECRET`]: env.ASILPOS_CLOUD_SECRET, [`${E}SITE_URL`]: env.ASILPOS_SITE_URL, [`${E}SITE_SECRET`]: env.ASILPOS_SITE_SECRET };
  assert.deepEqual(dagitilanBaglantilar(eski), a);
  assert.ok(read("src/app/api/panel/pos/baglanti/route.ts").includes("checkAsilposRequest"));
});


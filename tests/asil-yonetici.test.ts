// Asıl yönetici (docs/ROLLER.md › Asıl yönetici; sahibin kararı, 28 Kasım 2026): saf kurallar (src/lib/asil-yonetici.ts),
// kasa durumu (src/lib/asilpos/kasa-durumu.ts) ve kaynak taraması: korunan her eylem aynı kapıyı (requireAnaAdmin) ve
// aynı ret metnini kullanır, hesap korumasının her eylemi aynı denetimi çağırır, ekranlar bayrağı sunucuda hesaplar.
// Veritabanında davranış: tests/asil-yonetici-db.test.ts.
// Çalıştırma: npx tsx --test tests/asil-yonetici.test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  ASIL_ADRES_ALINAMAZ,
  ASIL_YONETICI,
  ASIL_YONETICI_ISLERI,
  asilAdresRet,
  asilHesapRet,
  asilYoneticiNotu,
  isAnaAdmin,
  isAnaAdminEmail,
  yalnizAsilYonetici,
} from "../src/lib/asil-yonetici";
import { ANA_ADMIN_ONLY } from "../src/lib/asilpos/kurulum";
import { KASA_KURULU_GUN, kasaDurumMetni, kasaDurumu, YENI_KURULUM_ONEKI, yeniKurulumOnayi, type KasaKaniti } from "../src/lib/asilpos/kasa-durumu";
import { actionGatesOf } from "./helpers/action-gates";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Dışa açık eylemin gövdesi (bir sonraki `export ` bildirimine kadar) */
const body = (file: string, name: string) => {
  const src = read(file);
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${file} › ${name} yok`);
  const end = src.indexOf("\nexport ", start + 10);
  return src.slice(start, end < 0 ? undefined : end);
};
const ENV = { LADMIN_ANA_ADMIN: "Asil@Ornek.com" };
const ana = { role: "admin", email: "asil@ornek.com" };
const ali = { role: "admin", email: "ali@ornek.com" };

test("asıl yönetici: yönetici rolü ve ortamdaki adres (harf büyüklüğü ve boşluk fark etmez); arayüzde tek ad", () => {
  assert.equal(isAnaAdmin(ana, ENV), true);
  assert.equal(isAnaAdmin({ role: "admin", email: " ASIL@ornek.com " }, ENV), true);
  assert.equal(isAnaAdmin(ali, ENV), false);
  assert.equal(isAnaAdmin({ role: "manager", email: "asil@ornek.com" }, ENV), false, "adres aynı, rol yönetici değil");
  assert.equal(isAnaAdmin(null, ENV), false);
  // Ortamda yoksa koddaki adres
  assert.equal(isAnaAdmin({ role: "admin", email: "info@nextgenlab.com.tr" }, {}), true);
  assert.equal(isAnaAdminEmail("INFO@nextgenlab.com.tr", {}), true);
  assert.equal(isAnaAdminEmail("asil@ornek.com", ENV), true);
  assert.equal(isAnaAdminEmail(null, ENV), false);
  assert.equal(ASIL_YONETICI, "Asıl yönetici");
  // Ret cümlesi tek biçim; şube ekleme sabiti de aynı cümle
  assert.equal(yalnizAsilYonetici("subeAcma"), "Bu işlemi yalnız asıl yönetici yapar: şube açmak");
  assert.equal(ANA_ADMIN_ONLY, yalnizAsilYonetici("subeAcma"));
  assert.equal(asilYoneticiNotu("subeKapatma"), "Şubeyi kapatmak ya da yeniden açmak yalnız asıl yöneticinin işidir.");
  for (const metin of Object.values(ASIL_YONETICI_ISLERI)) assert.doesNotMatch(metin, /[–—]/, metin);
});

test("hesap koruması: asıl yöneticinin hesabında başka yönetici reddedilir, asıl yönetici geçer; başka hesaba karışmaz", () => {
  const target = { email: "asil@ornek.com" };
  assert.equal(asilHesapRet(ali, target, "hesapSilme", ENV), "Bu işlemi yalnız asıl yönetici yapar: asıl yöneticinin hesabını silmek");
  assert.equal(asilHesapRet(ana, target, "hesapSilme", ENV), null);
  assert.equal(asilHesapRet(ali, { email: "ayse@ornek.com" }, "hesapSilme", ENV), null, "başka hesap");
  // Hesabı asıl yönetici adresli ama rolü düşürülmüş biri işlemi yapıyorsa asıl yönetici sayılmaz
  assert.ok(asilHesapRet({ role: "manager", email: "asil@ornek.com" }, { email: "ASIL@ornek.com" }, "hesapKilidi", ENV));
});

test("adres: hiçbir hesap asıl yöneticinin adresine çevrilemez; yeni hesap yalnız o hesap yokken açılabilir", () => {
  // Ad değişikliği (adres aynı) serbest; başka adres serbest
  assert.equal(asilAdresRet({ next: "asil@ornek.com", before: "asil@ornek.com", accountExists: true }, ENV), null);
  assert.equal(asilAdresRet({ next: "yeni@ornek.com", before: "ali@ornek.com", accountExists: true }, ENV), null);
  // Var olan hesabın adresi asıl yöneticinin adresine çevrilemez (hesap var da yok da)
  assert.equal(asilAdresRet({ next: "ASIL@ornek.com", before: "ali@ornek.com", accountExists: true }, ENV), ASIL_ADRES_ALINAMAZ);
  assert.equal(asilAdresRet({ next: "asil@ornek.com", before: "ali@ornek.com", accountExists: false }, ENV), ASIL_ADRES_ALINAMAZ);
  // Yeni hesap: asıl yönetici hesabı varken reddedilir, yokken bugünkü gibi açılır (kilitlenme olmasın)
  assert.equal(asilAdresRet({ next: "asil@ornek.com", before: null, accountExists: true }, ENV), ASIL_ADRES_ALINAMAZ);
  assert.equal(asilAdresRet({ next: "asil@ornek.com", before: null, accountExists: false }, ENV), null);
});

const NOW = new Date("2026-11-28T12:00:00+03:00");
const gunOnce = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const kanit = (o: Partial<KasaKaniti>): KasaKaniti => ({ anahtar: false, kodKullanildi: false, bekleyen: null, sonGun: null, ...o });

test("kasa durumu: kurulu = anahtar VE (kullanılmış kod ya da son 45 günde gün); tek eski deneme günü yetmez", () => {
  // Marina: ortamdaki anahtar, dün gün sonu geldi (kod hiç kullanılmadı)
  const marina = kasaDurumu(kanit({ anahtar: true, sonGun: { date: "2026-11-27", receivedAt: gunOnce(1) } }), NOW);
  assert.deepEqual(marina, { durum: "kurulu", sonGun: "2026-11-27", bekleyen: null });
  // Gün ile ay arasında bölünmez boşluk (dayMonthTR)
  assert.equal(kasaDurumMetni(marina), "Kasa kurulu · son gün 27\u00a0Kasım 2026");
  assert.equal(yeniKurulumOnayi(marina), "Bu şubede kurulu bir kasa var (son gün 27\u00a0Kasım 2026). Yeni kurulum eski kasanın yerine geçer.");
  // Tuzla: eski bir deneme günü (45 günden eski) ve anahtar: kurulu değil
  const tuzla = kasaDurumu(kanit({ anahtar: true, sonGun: { date: "2026-09-01", receivedAt: gunOnce(KASA_KURULU_GUN + 1) } }), NOW);
  assert.deepEqual(tuzla, { durum: "yok" });
  assert.equal(kasaDurumMetni(tuzla), "Kasa kurulu değil");
  assert.equal(yeniKurulumOnayi(tuzla), null);
  // Yakın gün var ama anahtar yok (silinmiş): kurulu değil
  assert.equal(kasaDurumu(kanit({ sonGun: { date: "2026-11-27", receivedAt: gunOnce(1) } }), NOW).durum, "yok");
  // Kod kullanıldı, henüz gün sonu yok
  const yeni = kasaDurumu(kanit({ anahtar: true, kodKullanildi: true }), NOW);
  assert.equal(kasaDurumMetni(yeni), "Kasa kurulu · henüz gün sonu gelmedi");
  assert.match(yeniKurulumOnayi(yeni)!, /henüz gün sonu gelmedi/);
  // Bekleyen kod: kurulum bekliyor (son geçerlilik İstanbul saatiyle)
  const bekleyen = kasaDurumu(kanit({ anahtar: true, bekleyen: "2026-12-12T08:00:00.000Z" }), NOW);
  assert.deepEqual(bekleyen, { durum: "bekliyor", sonGecerlilik: "2026-12-12T08:00:00.000Z" });
  assert.equal(kasaDurumMetni(bekleyen), "Kurulum bekliyor · son geçerlilik 12 Aralık 2026");
  // Kurulu kasaya yeni bağlantı gönderildi: kurulu kalır, bekleyen ayrıca
  assert.deepEqual(kasaDurumu(kanit({ anahtar: true, kodKullanildi: true, bekleyen: "2026-12-12T08:00:00.000Z" }), NOW), { durum: "kurulu", sonGun: null, bekleyen: "2026-12-12T08:00:00.000Z" });
  assert.ok(YENI_KURULUM_ONEKI.endsWith(":"));
});

/** Korunan eylemler ve işleri: tek liste (docs/ROLLER.md › Asıl yönetici tablosu) */
const KORUNAN: [file: string, name: string, is: keyof typeof ASIL_YONETICI_ISLERI][] = [
  ["src/server/actions/branches.ts", "createBranch", "subeAcma"],
  ["src/server/actions/branches.ts", "sendBranchInstall", "kasaKurma"],
  ["src/server/actions/branches.ts", "deleteBranch", "subeSilme"],
  ["src/server/actions/branch-settings.ts", "saveAsilposSecret", "kasaAnahtari"],
  ["src/server/actions/asilpos.ts", "saveAsilposSwitchDay", "gecisGunu"],
  // Kasa açılışı (docs/ASILPOS.md › Kasa açılışı)
  ["src/server/actions/branches.ts", "saveBranchStaff", "ilkPersonel"],
  ["src/server/actions/branches.ts", "releaseBranchTill", "kasaSerbest"],
];

test("korunan eylemler requireAnaAdmin(iş) ile; updateBranch yalnız açık / kapalı ve kasa programı değişince", () => {
  for (const [file, name, is] of KORUNAN) assert.match(body(file, name), new RegExp(`requireAnaAdmin\\("${is}"\\)`), `${name}: ${is}`);
  const update = body("src/server/actions/branches.ts", "updateBranch");
  assert.match(update, /const me = await requireAdmin\(\);/, "öteki alanlar her yöneticide");
  assert.match(update, /if \(mevcut\.active !== d\.active\) await requireAnaAdmin\("subeKapatma"\);/);
  assert.match(update, /if \(mevcut\.posSource !== d\.posSource\) await requireAnaAdmin\("kasaProgrami"\);/);
  // Kapanan şubenin bekleyen kodları aynı işlemde iptal
  assert.match(update, /return closing \? revokePendingInstalls\(tx, d\.id\) : 0;/);
  // Kapı tek tanımdan: dal.ts isAnaAdmin + yalnizAsilYonetici
  const dal = read("src/server/auth/dal.ts");
  // Yönetim konsolunun oturumu (yalnız asıl yönetici, getYonetimUser) da geçer; yoksa panelin bugünkü yolu
  assert.match(dal, /export async function requireAnaAdmin\(is: AsilYoneticiIsi = "subeAcma"\): Promise<CurrentUser> \{(?:\s*\/\/[^\n]*)*\s*const konsol = await getYonetimUser\(\);\s*if \(konsol\) return konsol;\s*const user = await requireAdmin\(\);\s*if \(!isAnaAdmin\(user\)\) throw new UserError\(yalnizAsilYonetici\(is\)\);/);
  // Eylem kapısı taraması requireAnaAdmin'i yönetici kapısı sayar (muhasebeci "salt okunur", tests/roller.test.ts)
  for (const [file, name] of KORUNAN) assert.ok(actionGatesOf(ROOT, file).find((g) => g.name === name)?.gates.some((g) => g.kind === "requireAdmin"), name);
});

test("hesap koruması her eylemde: asilHesapRet hedefi okuduktan sonra, yazımdan ve parola sorusundan önce", () => {
  const HESAP: [file: string, name: string, is: keyof typeof ASIL_YONETICI_ISLERI][] = [
    ["src/server/actions/settings.ts", "saveUser", "hesapDuzenleme"],
    ["src/server/actions/settings.ts", "setUserActive", "hesapErisimi"],
    ["src/server/actions/settings.ts", "deleteUser", "hesapSilme"],
    ["src/server/actions/settings.ts", "resetUserTwoFactor", "hesapIkiAdim"],
    ["src/server/actions/settings.ts", "unlockUser", "hesapKilidi"],
    ["src/server/actions/settings.ts", "signOutUserEverywhere", "hesapOturumlari"],
    ["src/server/actions/invites.ts", "createAccessLink", "hesapBaglantisi"],
  ];
  for (const [file, name, is] of HESAP) {
    const b = body(file, name);
    const guard = b.indexOf(`"${is}")`);
    assert.ok(guard > 0 && b.slice(0, guard).includes("asilHesapRet("), `${name}: ${is}`);
    for (const later of ["requireStepUp(", ".update(s.users)", ".delete(s.users)", "issueUserToken("]) {
      const at = b.indexOf(later);
      if (at >= 0) assert.ok(at > guard, `${name}: ${later} denetimden sonra`);
    }
  }
  // Adres: saveUser (çevirme), createUser (hesap varken), updateProfile (çevirme ve asıl yöneticinin kendi adresi)
  assert.match(body("src/server/actions/settings.ts", "saveUser"), /asilAdresRet\(\{ next: data\.email, before: current\.email, accountExists: true \}\)/);
  assert.match(body("src/server/actions/settings.ts", "createUser"), /asilAdresRet\(\{ next: data\.email, before: null, accountExists: dup > 0 \}\)/);
  const profile = body("src/server/actions/auth.ts", "updateProfile");
  assert.match(profile, /if \(data\.email !== u\.email && isAnaAdminEmail\(u\.email\)\) throw new UserError\(ASIL_EPOSTA_SABIT\);/);
  assert.match(profile, /asilAdresRet\(\{ next: data\.email, before: u\.email, accountExists: true \}\)/);
});

test("kapalı şubenin kurulum kodu: koşullu güncellemede şube açık olmalı, yanıt aynı 410 biçimiyle", () => {
  const src = read("src/server/asilpos/kurulum.ts");
  const redeem = src.slice(src.indexOf("export async function redeemInstallCode("));
  assert.match(redeem, /inArray\(s\.asilposInstalls\.branchId, openBranches\)/);
  assert.match(redeem, /return \{ status: 410, body: \{ ok: false, error: KURULUM_SUBE_KAPALI \} \};/);
  // Yanıtın türü değişmedi: 200, 404, 410 (kasa 404 ve 410'u kalıcı sayar)
  assert.match(src, /\| \{ status: 404 \| 410; body: \{ ok: false; error: string \} \};/);
  // Anahtar üretimine ve kasanın imza çözümüne dokunulmadı
  const branch = read("src/server/asilpos/branch.ts");
  assert.ok(!branch.includes("anaAdmin") && !branch.includes("asil-yonetici"));
});

test("ekranlar: Şube ekleme yalnız asıl yöneticiye, korunan alanlar öteki yöneticiye kapalı ve nedeni yazılı", () => {
  const page = read("src/app/panel/sube-ekleme/page.tsx");
  assert.match(page, /const me = await requireAdmin\(\);\s*if \(!isAnaAdmin\(me\)\) \{\s*return <Notice tone="neutral" title="Şube ekleme ve kasa kurulumu yalnız asıl yöneticinin hesabında açılır\." \/>;/);
  assert.ok(existsSync(join(ROOT, "src/components/sube-ekleme/sube-ekleme-client.tsx")));
  const client = read("src/components/sube-ekleme/sube-ekleme-client.tsx");
  // Kurulu kasada önce onay (ekranın ve sunucunun sorusu), sonuç penceresi istenen bilgilerle
  assert.match(client, /yeniKurulumOnayi\(d\)/);
  assert.match(client, /r\.error\.startsWith\(YENI_KURULUM_ONEKI\)/);
  for (const s of ["Şubenin e-postası", "Kasada giriş hesabı", "Son geçerlilik", "Bağlantıyı kopyala", "E-posta gitmedi"]) assert.ok(client.includes(s), s);
  assert.equal((client.match(/<li>/g) ?? []).length, 4, "dört adım");
  // Şubeler: düzenleme penceresinin e-postası şubenin kendi kaydından; korunan alanlar kapalı
  const admin = read("src/app/panel/subeler/branches-admin.tsx");
  assert.match(admin, /email: emails\[b\.id\] \?\? ""/);
  assert.ok(!admin.includes("installs["), "son kurulumdan dolmaz");
  assert.match(admin, /disabled=\{sabit \|\| !anaAdmin\}/);
  assert.match(admin, /onDelete=\{anaAdmin \?/);
  assert.match(read("src/app/panel/subeler/page.tsx"), /anaAdmin=\{isAnaAdmin\(me\)\}/);
  // Kasa anahtarı ve geçiş günü
  assert.match(read("src/app/panel/subeler/[id]/pos-card.tsx"), /disabled=\{!anaAdmin \|\| !secret\.trim\(\) \|\| short\}/);
  assert.match(read("src/app/panel/ayarlar/asilpos-card.tsx"), /locked=\{anaAdmin \? null : asilYoneticiNotu\("gecisGunu"\)\}/);
  // Kullanıcılar & roller: etiket ve satır anahtarı; Hesabım: asıl yöneticinin e-postası sabit
  const users = read("src/app/panel/kullanicilar/users-client.tsx");
  assert.equal((users.match(/\{u\.anaAdmin \? <Badge tone="violet">\{ASIL_YONETICI\}<\/Badge> : null\}/g) ?? []).length, 2, "telefon ve masaüstü satırı");
  assert.match(users, /disabled=\{me \|\| guarded \|\| pending\}/);
  assert.match(read("src/app/panel/kullanicilar/page.tsx"), /anaAdmin: isAnaAdminEmail\(u\.email\)/);
  assert.match(read("src/app/panel/hesap/page.tsx"), /emailLocked=\{isAnaAdminEmail\(user\.email\) \? ASIL_EPOSTA_SABIT : null\}/);
});

test("yeni metinde uzun tire yok; Şube ekleme sayfa, uç değil; kasa açılışının üç ucu (P-B2)", () => {
  for (const f of [
    "src/lib/asil-yonetici.ts",
    "src/lib/asilpos/kasa-durumu.ts",
    "src/lib/asilpos/kasa-acilis.ts",
    "src/lib/asilpos/kasa-acilis-mail.ts",
    "src/server/asilpos/kasa-durumu.ts",
    "src/server/asilpos/acilis.ts",
    "src/server/asilpos/acilis-route.ts",
    "src/server/asilpos/ilk-personel.ts",
    "src/server/auth/giris-korumalari.ts",
    "src/app/panel/sube-ekleme/page.tsx",
    "src/components/sube-ekleme/sube-ekleme-client.tsx",
  ]) {
    assert.doesNotMatch(read(f), /[–—]/, f);
  }
  assert.ok(!existsSync(join(ROOT, "src/app/panel/sube-ekleme/route.ts")));
  // Kasa açılışı (docs/ASILPOS.md › Kasa açılışı): giriş, bağla, teslim; veri integration_state'te (göç yok)
  for (const uc of ["giris", "bagla", "teslim"]) assert.ok(existsSync(join(ROOT, `src/app/api/asilpos/acilis/${uc}/route.ts`)), uc);
});

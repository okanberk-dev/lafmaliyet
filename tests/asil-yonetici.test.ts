// Asıl yönetici (docs/ROLLER.md › Asıl yönetici; sahibin kararı, 28 Kasım 2026): saf kurallar (src/lib/asil-yonetici.ts),
// kasa durumu (src/lib/asilpos/kasa-durumu.ts) ve kaynak taraması: korunan her eylem aynı kapıyı (requireAnaAdmin) ve
// aynı ret metnini kullanır, hesap korumasının her eylemi aynı denetimi çağırır, yönetici hesabına dokunan her kullanıcı
// eylemi parola sorusundan önce requireAnaAdmin(yonetici…) ister, requireAnaAdmin yalnız Yönetim konsolunun oturumunu
// kabul eder (K-C), ladmin'deki ekranlar bu işleri salt okunur gösterir ve konsol bağlantısını sunucuda kurar.
// Veritabanında davranış: tests/asil-yonetici-db.test.ts ve tests/yonetici-hesaplari-db.test.ts.
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
  isAnaAdmin,
  isAnaAdminEmail,
  KONSOLDA_YAPILIR,
  yalnizAsilYonetici,
  YONETICI_KONSOLDA,
  YONETICI_ROLU_KAPALI,
  yoneticiDuzenlemeIsi,
  yoneticiHesabi,
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
  // Asıl yönetici ladmin'den (panel oturumuyla) gelirse: tek cümle, uzun tire yok
  assert.equal(KONSOLDA_YAPILIR, "Bu iş Yönetim konsolunda yapılır");
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

test("adres: hiçbir hesap asıl yöneticinin adresine çevrilemez; o adresle yeni hesap hiçbir koşulda açılamaz", () => {
  // Ad değişikliği (adres aynı) serbest; başka adres serbest
  assert.equal(asilAdresRet({ next: "asil@ornek.com", before: "asil@ornek.com" }, ENV), null);
  assert.equal(asilAdresRet({ next: "yeni@ornek.com", before: "ali@ornek.com" }, ENV), null);
  assert.equal(asilAdresRet({ next: "yeni@ornek.com", before: null }, ENV), null);
  // Var olan hesabın adresi asıl yöneticinin adresine çevrilemez
  assert.equal(asilAdresRet({ next: "ASIL@ornek.com", before: "ali@ornek.com" }, ENV), ASIL_ADRES_ALINAMAZ);
  // Yeni hesap: "asıl yönetici hesabı yoksa bir yönetici açabilir" istisnası kapandı (28 Kasım 2026): hesap yokken de
  assert.equal(asilAdresRet({ next: " asil@ORNEK.com ", before: null }, ENV), ASIL_ADRES_ALINAMAZ);
  assert.equal(asilAdresRet.length, 1, "hesabın var olup olmadığı artık sorulmaz (env varsayılanlı)");
});

test("yönetici hesapları: önceki ya da sonraki rol yöneticiyse iş asıl yöneticinin; ret cümleleri tek biçim", () => {
  assert.equal(yoneticiHesabi("admin"), true);
  assert.equal(yoneticiHesabi("staff", "admin"), true);
  assert.equal(yoneticiHesabi("admin", "manager"), true);
  assert.equal(yoneticiHesabi("staff", "manager"), false);
  assert.equal(yoneticiHesabi("accountant"), false);
  assert.equal(yoneticiHesabi(null, undefined), false);
  // Düzenleme: hangi iş (yalnız ad değişikliğinde eylem bunu hiç sormaz)
  assert.equal(yoneticiDuzenlemeIsi("staff", "admin"), "yoneticilikVerme");
  assert.equal(yoneticiDuzenlemeIsi("manager", "admin"), "yoneticilikVerme");
  assert.equal(yoneticiDuzenlemeIsi("admin", "staff"), "yoneticilikAlma");
  assert.equal(yoneticiDuzenlemeIsi("admin", "accountant"), "yoneticilikAlma");
  assert.equal(yoneticiDuzenlemeIsi("admin", "admin"), "yoneticiDuzenleme");
  assert.equal(yoneticiDuzenlemeIsi("staff", "manager"), null, "müdür, muhasebeci, personel: bugünkü gibi");
  assert.equal(yoneticiDuzenlemeIsi("accountant", "accountant"), null);
  assert.equal(yalnizAsilYonetici("yoneticiAcma"), "Bu işlemi yalnız asıl yönetici yapar: yönetici hesabı açmak");
  assert.equal(yalnizAsilYonetici("yoneticilikVerme"), "Bu işlemi yalnız asıl yönetici yapar: bir hesaba yöneticilik vermek");
  assert.equal(yalnizAsilYonetici("yoneticilikAlma"), "Bu işlemi yalnız asıl yönetici yapar: bir yöneticinin yöneticiliğini almak");
  assert.equal(YONETICI_KONSOLDA, "Yönetici hesapları Yönetim konsolunda yönetilir");
  assert.ok(YONETICI_ROLU_KAPALI.includes("Yönetim konsolunda"));
  for (const t of [YONETICI_KONSOLDA, YONETICI_ROLU_KAPALI]) assert.doesNotMatch(t, /[–—]/);
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

test("korunan eylemler requireAnaAdmin(iş) ile; updateBranch yalnız açık / kapalı ve kasa programı değişince; kapı yalnız konsol oturumu", () => {
  for (const [file, name, is] of KORUNAN) assert.match(body(file, name), new RegExp(`requireAnaAdmin\\("${is}"\\)`), `${name}: ${is}`);
  const update = body("src/server/actions/branches.ts", "updateBranch");
  // Öteki alanlar her yöneticide; konsolun oturumu (asıl yönetici) da geçer
  assert.match(update, /const me = \(await getYonetimUser\(\)\) \?\? \(await requireAdmin\(\)\);/, "öteki alanlar her yöneticide");
  // Verilmeyen alanın eskisi kalır: değişmeyen alan asıl yönetici sormaz
  assert.match(update, /active: d\.active \?\? mevcut\.active,/);
  assert.match(update, /posSource: d\.posSource \?\? mevcut\.posSource,/);
  assert.match(update, /kind: d\.kind \?\? mevcut\.kind,/);
  assert.match(update, /if \(mevcut\.active !== yeni\.active\) await requireAnaAdmin\("subeKapatma"\);/);
  assert.match(update, /if \(mevcut\.posSource !== yeni\.posSource \|\| mevcut\.kind !== yeni\.kind\) await requireAnaAdmin\("kasaProgrami"\);/);
  // Kapanan şubenin bekleyen kodları aynı işlemde iptal
  assert.match(update, /return closing \? revokePendingInstalls\(tx, d\.id\) : 0;/);
  // Kapı tek tanımdan: dal.ts. Yalnız Yönetim konsolunun oturumu (getYonetimUser) geçer (K-C); panel oturumu hiçbir zaman:
  // asıl yönetici KONSOLDA_YAPILIR, öteki yönetici yalnizAsilYonetici alır (önce yönetici kapısı: başka rol ana ekranına)
  const dal = read("src/server/auth/dal.ts");
  const kapi = dal.slice(dal.indexOf("export async function requireAnaAdmin("), dal.indexOf("\n}\n", dal.indexOf("export async function requireAnaAdmin(")) + 3);
  assert.match(
    kapi,
    /^export async function requireAnaAdmin\(is: AsilYoneticiIsi = "subeAcma"\): Promise<CurrentUser> \{\s*const konsol = await getYonetimUser\(\);\s*if \(konsol\) return konsol;\s*const user = await requireAdmin\(\);\s*throw new UserError\(isAnaAdmin\(user\) \? KONSOLDA_YAPILIR : yalnizAsilYonetici\(is\)\);\s*\}\n$/,
  );
  assert.equal((kapi.match(/return /g) ?? []).length, 1, "tek dönüş: konsol oturumu");
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
  assert.match(body("src/server/actions/settings.ts", "saveUser"), /asilAdresRet\(\{ next: data\.email, before: current\.email \}\)/);
  assert.match(body("src/server/actions/settings.ts", "createUser"), /asilAdresRet\(\{ next: data\.email, before: null \}\)/);
  const profile = body("src/server/actions/auth.ts", "updateProfile");
  assert.match(profile, /if \(data\.email !== u\.email && isAnaAdminEmail\(u\.email\)\) throw new UserError\(ASIL_EPOSTA_SABIT\);/);
  assert.match(profile, /asilAdresRet\(\{ next: data\.email, before: u\.email \}\)/);
  // İstisna kapandı: hesabın var olup olmadığı hiçbir yerde sorulmaz
  for (const f of ["src/server/actions/settings.ts", "src/server/actions/auth.ts", "src/lib/asil-yonetici.ts"]) assert.ok(!read(f).includes("accountExists"), f);
});

/** Yönetici hesabına dokunan kullanıcı eylemleri ve işleri (docs/ROLLER.md › Yönetici hesapları) */
const YONETICI: [file: string, name: string, guard: RegExp][] = [
  ["src/server/actions/settings.ts", "createUser", /if \(yoneticiHesabi\(data\.role\)\) await requireAnaAdmin\("yoneticiAcma"\);/],
  ["src/server/actions/settings.ts", "saveUser", /const is = touches \? yoneticiDuzenlemeIsi\(current\.role, data\.role\) : null;\s*if \(is\) await requireAnaAdmin\(is\);/],
  ["src/server/actions/settings.ts", "setUserActive", /if \(yoneticiHesabi\(before\.role\)\) await requireAnaAdmin\("yoneticiErisimi"\);/],
  ["src/server/actions/settings.ts", "deleteUser", /if \(yoneticiHesabi\(u\.role\)\) await requireAnaAdmin\("yoneticiSilme"\);/],
  ["src/server/actions/settings.ts", "resetUserTwoFactor", /if \(yoneticiHesabi\(target\.role\)\) await requireAnaAdmin\("yoneticiIkiAdim"\);/],
  ["src/server/actions/settings.ts", "unlockUser", /if \(yoneticiHesabi\(target\.role\)\) await requireAnaAdmin\("yoneticiKilidi"\);/],
  ["src/server/actions/settings.ts", "signOutUserEverywhere", /if \(yoneticiHesabi\(target\.role\)\) await requireAnaAdmin\("yoneticiOturumlari"\);/],
  ["src/server/actions/invites.ts", "createAccessLink", /if \(yoneticiHesabi\(u\.role\)\) await requireAnaAdmin\("yoneticiBaglantisi"\);/],
];

test("yönetici hesabı: her kullanıcı eylemi requireAnaAdmin'i parola sorusundan ve ilk yazımdan önce ister; konsol oturumu da geçer", () => {
  for (const [file, name, guard] of YONETICI) {
    const b = body(file, name);
    const m = guard.exec(b);
    assert.ok(m, `${name}: yönetici hesabı kapısı yok`);
    // Konsolun oturumu (asıl yönetici) varsa onunla, yoksa panelin yönetici kapısı
    assert.match(b, /(?:const konsol = await getYonetimUser\(\);\s*const me = konsol \?\? \(await requireAdmin\(\)\);|const me = \(await getYonetimUser\(\)\) \?\? \(await requireAdmin\(\)\);)/, `${name}: konsol oturumu`);
    for (const later of ["requireStepUp(", ".update(s.users)", ".delete(s.users)", ".insert(s.users)", "issueUserToken(", "expireUserTokens("]) {
      const at = b.indexOf(later);
      if (at >= 0) assert.ok(at > m.index, `${name}: ${later} kapıdan sonra`);
    }
  }
  // Kendi hesabı (Hesabım, auth.ts) bu kurala girmez
  assert.ok(!read("src/server/actions/auth.ts").includes("requireAnaAdmin"), "Hesabım asıl yönetici istemez");
  // Konsoldan gelen kendi ad değişikliği panel oturumu açmaz
  assert.match(body("src/server/actions/settings.ts", "saveUser"), /if \(after && after\.id === me\.id && !konsol\) await startSession\(after\);/);
  // Son yönetici kuralı aynen (saveUser, setUserActive, deleteUser)
  for (const name of ["saveUser", "setUserActive", "deleteUser"]) assert.ok(body("src/server/actions/settings.ts", name).includes('throw new UserError("En az bir aktif yönetici kalmalı")'), name);
  // emailAccess konsoldan da (Giriş bilgileri penceresi): mühürlü kopya ya da bağlantı anahtarı ister, yönetici kapısı aynı
  assert.match(body("src/server/actions/invites.ts", "emailAccess"), /const me = \(await getYonetimUser\(\)\) \?\? \(await requireAdmin\(\)\);/);
  // Eylem kapısı taraması: yönetici kapısı (requireAdmin) ve asıl yönetici kapısı (requireAnaAdmin, yönetici sayılır)
  for (const [file, name] of YONETICI) {
    const gates = actionGatesOf(ROOT, file).find((g) => g.name === name)?.gates ?? [];
    assert.ok(gates.some((g) => g.kind === "requireAdmin" && g.args.length === 0), `${name}: requireAdmin()`);
    assert.ok(gates.some((g) => g.kind === "requireAdmin" && g.args.length === 1), `${name}: requireAnaAdmin(iş)`);
  }
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

test("ekranlar (K-C): ladmin'de asıl yönetici işleri salt okunur, yerinde tek cümle; konsol bağlantısı yalnız asıl yöneticiye", () => {
  // /panel/sube-ekleme: eski adres; asıl yönetici konsolun Şubeler ve kasalar sayfasına (kurucu panelden), öteki yönetici tek cümle
  const page = read("src/app/panel/sube-ekleme/page.tsx");
  assert.match(page, /<SubeEklemeIcerik \/>/);
  assert.doesNotMatch(page, /SubeEkleme\b(?!Icerik)|createBranch|sendBranchInstall/, "eylemler ladmin'de çizilmez");
  const icerik = read("src/app/panel/sube-ekleme/icerik.tsx");
  assert.match(icerik, /const me = await requireAdmin\(\);\s*if \(isAnaAdmin\(me\)\) redirect\(panelden\(YONETIM_YOLU\)\);\s*return <Notice tone="neutral" title=\{KONSOLDA_YAPILIR\} \/>;/);
  // Ortak not: tek cümle, bağlantı yalnız verilirse (sunucu yalnız asıl yöneticiye verir)
  const not = read("src/components/panel/konsol-notu.tsx");
  assert.match(not, /\{KONSOLDA_YAPILIR\}/);
  assert.match(not, /\{href \? \(/);
  assert.doesNotMatch(not, /^"use client";|onClick=/m, "sunucu ve istemci bileşenleri birlikte kullanır");
  assert.ok(existsSync(join(ROOT, "src/components/sube-ekleme/sube-ekleme-client.tsx")));
  const client = read("src/components/sube-ekleme/sube-ekleme-client.tsx");
  // Kurulu kasada önce onay (ekranın ve sunucunun sorusu), sonuç penceresi istenen bilgilerle
  assert.match(client, /yeniKurulumOnayi\(d\)/);
  assert.match(client, /r\.error\.startsWith\(YENI_KURULUM_ONEKI\)/);
  for (const s of ["Şubenin e-postası", "Kasada giriş hesabı", "Son geçerlilik", "Bağlantıyı kopyala", "E-posta gitmedi"]) assert.ok(client.includes(s), s);
  assert.equal((client.match(/<li>/g) ?? []).length, 4, "dört adım");
  // Şubeler: düzenleme penceresinin e-postası şubenin kendi kaydından; tür, kasa programı ve açık / kapalı salt okunur,
  // silme yok; başlıkta ve pencerede tek cümle, konsol bağlantıları yalnız asıl yöneticiye (sunucuda, kurucudan)
  const admin = read("src/app/panel/subeler/branches-admin.tsx");
  assert.match(admin, /email: emails\[b\.id\] \?\? ""/);
  assert.ok(!admin.includes("installs["), "son kurulumdan dolmaz");
  assert.doesNotMatch(admin, /anaAdmin|href="\/panel\/sube-ekleme"|deleteAction|<Select|<Checkbox/);
  assert.match(admin, /meta=\{<KonsolNotu href=\{konsol\?\.subeler \?\? null\} konu="Şube açmak ve kasa kurmak" \/>\}/);
  assert.match(admin, /<KonsolNotu href=\{konsolUrl\} konu=/);
  assert.match(
    read("src/app/panel/subeler/page.tsx"),
    /konsol=\{isAnaAdmin\(me\) \? \{ subeler: panelden\(YONETIM_YOLU\), sube: Object\.fromEntries\(rows\.map\(\(b\) => \[b\.id, panelden\(konsolSubeYolu\(b\.id\)\)\]\)\) \} : null\}/,
  );
  // Kasa anahtarı: alan ve düğmeler yalnız konsolda; ladmin'de cümle (eski anahtar da)
  const anahtar = read("src/components/sube-islemleri/kasa-anahtari.tsx");
  assert.doesNotMatch(anahtar, /anaAdmin/);
  assert.match(anahtar, /\) : \(\s*<KonsolNotu href=\{konsolUrl\} konu="Anahtarı değiştirmek ya da silmek" \/>\s*\)\}/);
  assert.match(anahtar, /\) : \(\s*<KonsolNotu href=\{konsolUrl\} konu="Eski anahtarı silmek" \/>\s*\)\}/);
  assert.match(read("src/app/panel/subeler/[id]/page.tsx"), /const konsolUrl = isAnaAdmin\(me\) \? panelden\(`\$\{konsolSubeYolu\(branch\.id\)\}#asilpos`\) : null;/);
  // Geçiş günü: ladmin'de salt okunur; form yalnız konsolda (kilit seçeneği kalktı)
  const kart = read("src/app/panel/ayarlar/asilpos-card.tsx");
  assert.doesNotMatch(kart, /AsilposSwitchDayForm/);
  assert.match(kart, /<KonsolNotu href=\{anaAdmin \? panelden\(`\$\{konsolSubeYolu\(data\.branchId\)\}#gecis-gunu`\) : null\} konu="Geçiş gününü değiştirmek" \/>/);
  assert.doesNotMatch(read("src/components/sube-islemleri/gecis-gunu.tsx"), /locked/);
  // Kullanıcılar & roller: etiket ve satır anahtarı; yönetici satırları herkese salt okunur, satırda ve pencerede tek
  // cümle; Yönetici rolü eklemede ve düzenlemede kapalı. Hesabım: asıl yöneticinin e-postası sabit
  const users = read("src/app/panel/kullanicilar/users-client.tsx");
  assert.equal((users.match(/\{u\.anaAdmin \? <Badge tone="violet">\{ASIL_YONETICI\}<\/Badge> : null\}/g) ?? []).length, 2, "telefon ve masaüstü satırı");
  assert.match(users, /disabled=\{me \|\| guarded \|\| pending\}/);
  assert.match(users, /const guardedRow = \(u: UserRow\) => u\.role === "admin";/, "asıl yönetici dahil herkese");
  assert.equal((users.match(/\{guardedRow\(u\) \? \(\s*<p[^>]*>\s*<KonsolNotu konsolUrl=\{konsolUrl\} \/>/g) ?? []).length, 2, "telefon ve masaüstü satırında cümle");
  assert.match(users, /if \(guarded\) return <AdminAccountDialog user=\{user\} self=\{self\} konsolUrl=\{konsolUrl\} onClose=\{onClose\} \/>;/, "pencere salt okunur");
  assert.equal((users.match(/options=\{ROLE_OPTIONS\} disabled=\{\(v\) => v === "admin"\} \/>/g) ?? []).length, 2, "ekleme ve düzenlemede Yönetici rolü kapalı");
  assert.equal((users.match(/<KonsolNotu konsolUrl=\{konsolUrl\} text=\{YONETICI_ROLU_KAPALI\} \/>/g) ?? []).length, 2, "nedeni yazılı");
  const usersPage = read("src/app/panel/kullanicilar/page.tsx");
  assert.match(usersPage, /anaAdmin: isAnaAdminEmail\(u\.email\)/);
  assert.match(usersPage, /konsolUrl=\{isAnaAdmin\(me\) \? panelden\(KONSOL_YONETICILER_YOLU\) : null\}/, "konsol bağlantısı yalnız asıl yöneticiye");
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
    "src/app/panel/sube-ekleme/icerik.tsx",
    "src/components/panel/konsol-notu.tsx",
    "src/app/panel/subeler/branches-admin.tsx",
    "src/app/panel/subeler/page.tsx",
    "src/app/panel/ayarlar/asilpos-card.tsx",
    "src/components/sube-ekleme/sube-ekleme-client.tsx",
    "src/server/yonetici-hesaplari.ts",
    "src/app/yonetim/(konsol)/yoneticiler/page.tsx",
    "src/app/yonetim/(konsol)/yoneticiler/yoneticiler-client.tsx",
    "scripts/asil-yonetici-kurtar.ts",
  ]) {
    assert.doesNotMatch(read(f), /[–—]/, f);
  }
  assert.ok(!existsSync(join(ROOT, "src/app/panel/sube-ekleme/route.ts")));
  // Kasa açılışı (docs/ASILPOS.md › Kasa açılışı): giriş, bağla, teslim; veri integration_state'te (göç yok)
  for (const uc of ["giris", "bagla", "teslim"]) assert.ok(existsSync(join(ROOT, `src/app/api/asilpos/acilis/${uc}/route.ts`)), uc);
});

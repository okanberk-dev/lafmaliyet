// Yönetici hesaplarının güvenliği (Dalga 2; docs/DEPLOY.md › 6a): sahibin isteği "Yönetici hesaplarında iki adımlı
// doğrulama zorunlu olsun; yeni cihazdan girişte uyarı." Saf kurallar (src/lib/admin-security.ts), uyarı e-postasının
// şablonu (src/server/auth/new-device-notice.ts), cihaz çerezinin "daha önce görüldü mü" kuralı (src/server/auth/session.ts)
// ve kaynak denetimleri: zorunluluk her ekran, eylem ve veri ucunda; kurulum ekranına giden kapı (requireSignedIn) yalnız
// kurulumda; KVKK: tam IP ve tarayıcı kimliği saklanmaz. Veritabanında akış: tests/hesap-yetki-db.test.ts.
// Çalıştırma: npx tsx --test tests/yonetici-guvenlik.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  ADMIN_2FA_OPTIONAL_ENV,
  adminTwoFactorRequired,
  alertsNewDevice,
  maskIp,
  NEW_DEVICE_ADVICE,
  newDeviceBell,
  newDeviceDetail,
  needsTwoFactorSetup,
  setupContinueHref,
  TWO_FACTOR_SETUP_PATH,
  twoFactorRequiredFor,
  twoFactorResetText,
  twoFactorSetupHref,
  userAgentLabel,
} from "../src/lib/admin-security";
import { renderNewDeviceNotice, SESSIONS_HREF } from "../src/server/auth/new-device-notice";
import { deviceSeenBefore } from "../src/server/auth/session";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []));
/** `fn` adlı dışa açık işlevin gövdesi (bir sonrakine kadar) */
const body = (src: string, fn: string) => {
  const at = src.indexOf(`function ${fn}(`);
  assert.ok(at >= 0, `${fn} bulunamadı`);
  const next = src.indexOf("\nexport ", at + 1);
  return src.slice(at, next < 0 ? undefined : next);
};

const UA = {
  chromeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  edgeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
};

// ---------------------------------------------------------------- Zorunluluk

test("zorunluluk: varsayılan açık; yalnız ADMIN_2FA_OPTIONAL=1 kapatır", () => {
  assert.equal(ADMIN_2FA_OPTIONAL_ENV, "ADMIN_2FA_OPTIONAL");
  assert.equal(adminTwoFactorRequired({}), true, "değişken yoksa zorunlu");
  assert.equal(adminTwoFactorRequired({ ADMIN_2FA_OPTIONAL: "1" }), false);
  assert.equal(adminTwoFactorRequired({ ADMIN_2FA_OPTIONAL: " 1\n" }), false, "panoya yapıştırılan boşluk sayılmaz");
  for (const v of ["0", "", "true", "evet", "yes"]) assert.equal(adminTwoFactorRequired({ ADMIN_2FA_OPTIONAL: v }), true, `"${v}" zorunluluğu kapatmaz (yalnız 1)`);
});

test("kurulum gereken hesap: iki adımlısı kapalı yönetici, zorunluluk açıkken; personel hiç", () => {
  assert.equal(needsTwoFactorSetup({ role: "admin", totpEnabled: false }, true), true);
  assert.equal(needsTwoFactorSetup({ role: "admin", totpEnabled: true }, true), false, "kurmuş yönetici geçer");
  assert.equal(needsTwoFactorSetup({ role: "staff", totpEnabled: false }, true), false, "personelde isteğe bağlı");
  assert.equal(needsTwoFactorSetup({ role: "admin", totpEnabled: false }, false), false, "acil durum: ADMIN_2FA_OPTIONAL=1");
  assert.equal(twoFactorRequiredFor("admin", true), true);
  assert.equal(twoFactorRequiredFor("staff", true), false);
  assert.equal(twoFactorRequiredFor("admin", false), false);
});

test("kurulumdan sonra dönülecek yer: yalnız panel içi ya da Claude onay ekranı; başka her şey rolün ana sayfası", () => {
  assert.equal(setupContinueHref("/panel/kasa?ay=2026-11", "/panel"), "/panel/kasa?ay=2026-11");
  assert.equal(setupContinueHref("/baglan?istek=abc", "/panel"), "/baglan?istek=abc");
  for (const bad of ["//evil.example/panel", "https://evil.example/panel", "/panel\\..\\x", "/baglan", "/giris", "javascript:alert(1)", "", undefined, null, ["/panel/kasa"], 42]) {
    assert.equal(setupContinueHref(bad, "/panel"), "/panel", `${JSON.stringify(bad)} ana sayfaya`);
  }
  assert.equal(twoFactorSetupHref(null), TWO_FACTOR_SETUP_PATH);
  assert.equal(twoFactorSetupHref("/panel/kasa?ay=2026-11"), "/giris/iki-adim?next=%2Fpanel%2Fkasa%3Fay%3D2026-11");
});

test("metinler: sıfırlama penceresi zorunluyken kurulum ekranını söyler, değilken eskisi gibi", () => {
  assert.match(twoFactorResetText(true), /kurulum ekranı açılır/);
  assert.match(twoFactorResetText(true), /kurana kadar paneli kullanamaz/);
  assert.equal(twoFactorResetText(false), "Telefonunu kaybeden kullanıcı için. Girişte yalnızca parola istenir; kişi Hesabım'dan yeniden kurabilir.");
});

// ---------------------------------------------------------------- Yeni cihaz

test("yeni cihaz uyarısı yalnız yönetici hesaplarına (personel ortak tablette sırayla girer)", () => {
  assert.equal(alertsNewDevice({ role: "admin" }), true);
  assert.equal(alertsNewDevice({ role: "staff" }), false);
});

test("cihaz çerezi: kişi bu tarayıcıdan daha önce girdiyse (oturum sürümü ne olursa olsun; eski biçim de) yeni değil", () => {
  assert.equal(deviceSeenBefore(null, 7), false, "çerezsiz tarayıcı yeni");
  assert.equal(deviceSeenBefore({ did: "d", users: [{ id: 3, sv: 1 }] }, 7), false, "başkasının tarayıcısı bu kişi için yeni");
  assert.equal(deviceSeenBefore({ did: "d", users: [{ id: 7, sv: 1 }] }, 7), true);
  assert.equal(deviceSeenBefore({ did: "d", users: [{ id: 7, sv: 1 }] }, 7), true, "parola değişince (sürüm 2) uyarı gelmez: tarayıcı aynı");
  assert.equal(deviceSeenBefore({ did: "d", users: [], legacyIds: [7] }, 7), true, "önceki biçimin kişisi de görülmüş");
});

test("tarayıcı etiketi: yalnız tarayıcı ve işletim sisteminin adı (tarayıcı kimliğinin kendisi saklanmaz)", () => {
  assert.equal(userAgentLabel(UA.chromeWin), "Chrome · Windows");
  assert.equal(userAgentLabel(UA.safariIphone), "Safari · iPhone");
  assert.equal(userAgentLabel(UA.edgeWin), "Edge · Windows", "Edge Chrome'u taklit eder: önce Edge");
  assert.equal(userAgentLabel(UA.firefoxLinux), "Firefox · Linux");
  assert.equal(userAgentLabel(UA.chromeAndroid), "Chrome · Android", "Android Linux'tan önce");
  assert.equal(userAgentLabel(UA.safariMac), "Safari · Mac");
  assert.equal(userAgentLabel(null), "Tarayıcı");
  assert.equal(userAgentLabel("curl/8.5.0"), "Tarayıcı");
  for (const ua of Object.values(UA)) assert.ok(userAgentLabel(ua).length <= 20, `etiket kısa: ${userAgentLabel(ua)}`);
});

test("KVKK: IP kısaltılır (IPv4 son hane, IPv6 ilk üç blok); okunamayan IP yazılmaz", () => {
  assert.equal(maskIp("85.105.12.34"), "85.105.12.x");
  assert.equal(maskIp(" 85.105.12.34 "), "85.105.12.x");
  assert.equal(maskIp("::ffff:85.105.12.34"), "85.105.12.x", "IPv4'ün IPv6 yazımı");
  assert.equal(maskIp("2a02:4e0:2d1:abcd:1234:5678:9abc:def0"), "2a02:4e0:2d1::/48");
  assert.equal(maskIp("2a02:4e0:2d1:abcd::1"), "2a02:4e0:2d1::/48");
  for (const bad of ["?", "", null, undefined, "::1", "localhost", "1.2.3.4:5678", "<script>"]) assert.equal(maskIp(bad), null, `${JSON.stringify(bad)} yazılmaz`);
  // Kısaltılmış biçimden tam IP geri çıkmaz
  assert.doesNotMatch(maskIp("85.105.12.34")!, /34/);
});

test("ayrıntı, zil satırı ve e-posta aynı metinden; zil Hesabım › Oturumlar'a götürür", () => {
  const detail = newDeviceDetail({ device: "Chrome · Windows", ip: "85.105.12.x" });
  assert.equal(detail, "Chrome · Windows · IP 85.105.12.x");
  assert.equal(newDeviceDetail({ device: "Safari · iPhone", ip: null }), "Safari · iPhone", "IP okunamadıysa yalnız cihaz");
  const bell = newDeviceBell({ id: 12, detail, at: "26 Kas 2026 09:14" });
  assert.deepEqual(bell, { id: "yeni-cihaz-12", title: "Yeni cihazdan giriş: Chrome · Windows · IP 85.105.12.x", body: `26 Kas 2026 09:14. ${NEW_DEVICE_ADVICE}` });
  assert.equal(newDeviceBell({ id: 1, detail: null, at: "x" }).title, "Yeni cihazdan giriş");
  assert.equal(SESSIONS_HREF, "/panel/hesap#oturumlar");
  assert.match(read("src/app/panel/hesap/page.tsx"), /<Card id="oturumlar" className="scroll-mt-/, "zil ve e-postanın bağlantısı Oturumlar kartına iner");
});

test("uyarı e-postası: konu, cihaz ve kısaltılmış IP, ne yapılacağı ve Oturumlarım bağlantısı; tam IP yok, ad kaçışlı", () => {
  const at = new Date("2026-11-26T06:14:00Z");
  const mail = renderNewDeviceNotice({ name: "Okan <b>Berk</b>", detail: "Chrome · Windows · IP 85.105.12.x", at, base: "https://ladmin.laffogato.net" });
  assert.equal(mail.subject, "Hesabınıza yeni bir cihazdan giriş yapıldı");
  assert.match(mail.text, /Chrome · Windows · IP 85\.105\.12\.x/);
  assert.match(mail.text, /Giriş sizinse bir şey yapmanız gerekmez\./);
  assert.ok(mail.text.includes(NEW_DEVICE_ADVICE), "ne yapılacağı metinde");
  assert.match(mail.text, /Oturumlarım: https:\/\/ladmin\.laffogato\.net\/panel\/hesap#oturumlar/);
  assert.match(mail.html, /href="https:\/\/ladmin\.laffogato\.net\/panel\/hesap#oturumlar"/);
  assert.doesNotMatch(mail.html, /<b>Berk<\/b>/, "ad HTML'e kaçışsız girmez");
  assert.doesNotMatch(mail.html + mail.text, /85\.105\.12\.\d/, "tam IP yok");
});

// ---------------------------------------------------------------- Kaynak denetimleri

test("oturum: kurmamış yönetici veri uçlarında oturumsuz, sayfa ve eylemlerde kurulum ekranına; kapı yalnız kurulumda", () => {
  const dal = read("src/server/auth/dal.ts");
  assert.match(body(dal, "getCurrentUser"), /return u && !u\.needsTwoFactor \? toCurrent\(u\) : null;/, "canlı veri, dışa aktarma, fotoğraf… kurmamış yöneticiye bir şey vermez");
  assert.match(body(dal, "requireUser"), /if \(user\.needsTwoFactor\) redirect\(TWO_FACTOR_SETUP_PATH\);/, "her ekran ve eylem kurulum ekranına gönderir");
  assert.match(body(dal, "requireAdmin"), /const user = await requireUser\(\);/, "yönetici ekranları requireUser'dan geçer");
  // requireSignedIn (kurulum gerekse de geçer) yalnız kurulum ekranında ve kurulum eylemlerinde
  const users = walk("src")
    .filter((f) => f !== "src/server/auth/dal.ts")
    .flatMap((f) => (read(f).match(/requireSignedIn\(\)/g) ?? []).map(() => f))
    .sort();
  assert.deepEqual(users, ["src/app/giris/iki-adim/page.tsx", "src/server/actions/auth.ts", "src/server/actions/auth.ts", "src/server/actions/auth.ts"]);
  const auth = read("src/server/actions/auth.ts");
  for (const fn of ["beginTotpSetup", "confirmTotpSetup", "cancelTotpSetup"]) assert.match(body(auth, fn), /const me = await requireSignedIn\(\);/, `${fn}: kurulum ekranından çağrılır`);
  for (const fn of ["disableTotp", "regenerateRecoveryCodes", "signOutOtherSessions", "updateProfile", "changePasswordAction"]) {
    assert.doesNotMatch(body(auth, fn), /requireSignedIn/, `${fn}: kurulumdan önce kullanılamaz`);
  }
  // Oturum geçerli ama kurulum bekleyen kişiyi ayıran tek yer Claude bağlantısının onay ekranı
  const awaiting = walk("src").filter((f) => f !== "src/server/auth/dal.ts" && read(f).includes("awaitingTwoFactorSetup("));
  assert.deepEqual(awaiting, ["src/app/baglan/page.tsx"]);
  assert.match(read("src/app/baglan/page.tsx"), /if \(await awaitingTwoFactorSetup\(\)\) redirect\(twoFactorSetupHref\(`\/baglan\?istek=\$\{encodeURIComponent\(raw\)\}`\)\);/);
});

test("giriş: kurmamış yönetici kurulum ekranına (dönülecek yerle); yeni cihaz cihaz çerezi yenilenmeden önce anlaşılır", () => {
  const login = body(read("src/server/actions/auth.ts"), "completeLogin");
  assert.match(login, /redirect\(needsTwoFactorSetup\(user\) \? twoFactorSetupHref\(target\) : target\);/);
  const fresh = login.indexOf("const fresh = user.lastLoginAt !== null && !deviceSeenBefore(await readDevice(), user.id);");
  assert.ok(fresh >= 0, "hesabın ilk girişi uyarı değil; görülmüş tarayıcı uyarı değil");
  assert.ok(fresh < login.indexOf("await rememberDevice(user)"), "cihaz çerezi bu kişiyi yazmadan önce bakılır");
  assert.match(login, /if \(fresh\) await noteNewDevice\(user, await headers\(\)\)\.catch\(/, "uyarı girişi bozmaz");
  // Kod adımı ve kurtarma kodu da completeLogin'den geçer: uyarı ve zorunluluk iki adımlı girişte de işler
  assert.equal(read("src/server/actions/auth.ts").match(/await completeLogin\(user, /g)?.length, 3);
});

test("kurulum ekranı panelin dışında: proxy eşleştirmez, istek verisi Suspense içinde, eylem bekçisine uyar", () => {
  const proxy = read("src/proxy.ts");
  assert.match(proxy, /matcher: \["\/panel\/:path\*", "\/giris", "\/api\/export\/:path\*"\]/, "\"/giris\" yalnız giriş sayfasını eşler; /giris/iki-adim proxy'ye girmez");
  const page = read("src/app/giris/iki-adim/page.tsx");
  assert.match(page, /<Suspense fallback=\{/);
  assert.match(page, /const me = await requireSignedIn\(\);/);
  assert.match(page, /if \(!me\.needsTwoFactor && !me\.totpEnabled\) redirect\(next\);/, "işi olmayan kendi sayfasına");
  const setup = read("src/app/giris/iki-adim/setup.tsx");
  assert.match(setup, /useActionTransition\(\)/);
  assert.match(setup, /window\.location\.assign\(next\)/, "panele tam sayfa geçiş (yenilenen oturum çereziyle)");
  assert.match(setup, /forgetDeviceOnSignOut\(\)\.finally\(\(\) =>\s+logoutAction\(\)/, "çıkış panelin çıkışı gibi");
  assert.match(setup, /disabled=\{!saved\}/, "kodlar saklanmadan panele geçilmez");
});

test("yeni cihaz: işlem geçmişine yalnız etiket ve kısaltılmış IP; e-posta yanıttan sonra; zil kişinin kendi satırları", () => {
  const src = read("src/server/auth/new-device.ts");
  assert.match(src, /^import "server-only";/);
  assert.match(src, /const detail = newDeviceDetail\(\{ device: userAgentLabel\(h\.get\("user-agent"\)\), ip: maskIp\(clientIp\(h\)\) \}\);/);
  assert.match(src, /await logActivity\(\{ id: user\.id, name: user\.name \}, NEW_DEVICE_ACTION, detail\);/);
  assert.doesNotMatch(src.replace(/h\.get\("user-agent"\)/, ""), /user-agent|x-forwarded-for/i, "ham başlık başka yere yazılmaz");
  assert.match(src, /if \(!alertsNewDevice\(user\)\) return;/);
  assert.match(src, /after\(\(\) => sendNewDeviceEmail\(user, detail, at\)\)/);
  assert.match(src, /eq\(s\.activityLog\.userId, user\.id\), eq\(s\.activityLog\.action, NEW_DEVICE_ACTION\)/, "zil yalnız kişinin kendi hesabının girişleri");
  const bell = read("src/server/actions/notifications.ts");
  assert.match(bell, /safe\("guvenlik", newDeviceBellRows\(user\)\)/);
  assert.match(read("src/lib/bell-failed.ts"), /guvenlik: \{ group: "sistem", what: "yeni cihazdan girişler", href: "\/panel\/hesap" \}/);
});

test("belgeler: acil durum değişkeni ve yeni cihaz uyarısı yazılı", () => {
  const env = read(".env.example");
  assert.match(env, /^# ADMIN_2FA_OPTIONAL=1/m, "örnek dosyada kapalı (yorumlu) durur");
  const deploy = read("docs/DEPLOY.md");
  assert.match(deploy, /ADMIN_2FA_OPTIONAL=1/);
  assert.match(deploy, /Yeni cihazdan giriş/);
  assert.match(deploy, /\/giris\/iki-adim/);
});

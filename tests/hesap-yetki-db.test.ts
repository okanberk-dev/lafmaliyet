// Yetki ve hesap ekranlarının küçükleri, gerçek Postgres'te (denetim 13 Kasım 2026, P06): listedeki aktif / pasif
// anahtarı yalnız erişimi yazar, eski düzenleme penceresi bu arada yapılan değişikliği geri yazamaz (YO-01); bilinen
// cihazın kilidini Kilidi aç da açar (YO-03); iki adımlı kurulumun onayı sınırlı, süresi geçen ya da durdurulan anahtar
// silinir (YO-05); davet sayfasında parola kuralı ve tekrar alanı bağlantının hakkından düşmez (YO-06); kurtarma kodu
// kipinde yanlış kodun metni kurtarma koduna göre (YO-07). Oturum gerçek src/server/auth/dal.ts'le, çerezler taklit
// edilerek (her tarayıcı ayrı çerez kutusu). Yöneticide zorunlu iki adımlı kurulum ve yeni cihaz uyarısı da burada
// (src/lib/admin-security.ts); öteki testler zorunluluk kapalıyken (ADMIN_2FA_OPTIONAL=1) koşar.
//
// HESAP_TEST_DATABASE_URL (yoksa BAGLANTI_TEST_DATABASE_URL) verilmezse atlanır. Bir Postgres sunucusunun adresi
// (veritabanı oluşturabilen kullanıcı): test kendi geçici veritabanını açar, migration'ları uygular, sonunda siler.
// Çalıştırma: HESAP_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/hesap-yetki-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { STEP_UP_REQUIRED } from "../src/lib/step-up";
import { openPendingSecret, pendingSecret, SETUP_EXPIRED, SETUP_MAX, SETUP_STOPPED } from "../src/lib/two-factor-setup";
import * as s from "../src/server/db/schema";

const SERVER_URL = process.env.HESAP_TEST_DATABASE_URL ?? process.env.BAGLANTI_TEST_DATABASE_URL;
const DB_NAME = `laffogato_hesap_${process.pid}`;
const SECRET = "hesap-yetki-testi-icin-en-az-otuz-iki-karakterlik-anahtar";
const PASSWORD = "Hesap-Deneme-2026";

/** Tarayıcının çerez kutusu: dal.ts cookies() ile bunu okur ve yazar */
class Jar {
  values = new Map<string, string>();
  get(name: string) {
    const value = this.values.get(name);
    return value === undefined ? undefined : { name, value };
  }
  set(name: string, value: string, opts: { maxAge?: number } = {}) {
    if (opts.maxAge === 0 || value === "") this.values.delete(name);
    else this.values.set(name, value);
  }
}

type User = typeof s.users.$inferSelect;
type Key = "ali" | "veli" | "ayse" | "kemal";
const BASE: Record<Key, { name: string; email: string; role: "admin" | "staff" }> = {
  ali: { name: "Ali", email: "ali@laffogato.net", role: "admin" },
  veli: { name: "Veli", email: "veli@laffogato.net", role: "admin" },
  ayse: { name: "Ayşe", email: "ayse@laffogato.net", role: "staff" },
  kemal: { name: "Kemal", email: "kemal@laffogato.net", role: "staff" },
};

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe("yetki ve hesap ekranları: veritabanında", { skip: !SERVER_URL && "HESAP_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let dal: typeof import("../src/server/auth/dal");
  let settings: typeof import("../src/server/actions/settings");
  let auth: typeof import("../src/server/actions/auth");
  let invites: typeof import("../src/server/actions/invites");
  let tokens: typeof import("../src/server/auth/user-tokens");
  let locks: typeof import("../src/server/auth/login-locks");
  let totp: typeof import("../src/server/auth/totp");
  let box: typeof import("../src/server/secret-box");
  let newDevice: typeof import("../src/server/auth/new-device");
  let jar = new Jar();
  /** İsteğin başlıkları (tarayıcı kimliği, IP) */
  let reqHeaders = new Headers();
  const ids = {} as Record<Key, number>;

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: SECRET });
    delete process.env.RESEND_API_KEY;
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır; çerezler, yönlendirme ve sayfa yenileme taklit edilir
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/headers", { cookies: async () => jar, headers: async () => reqHeaders });
    stub("next/navigation", {
      redirect: (to: string) => {
        throw Object.assign(new Error("NEXT_REDIRECT"), { to });
      },
      unstable_rethrow: (e: unknown) => {
        if ((e as Error)?.message === "NEXT_REDIRECT") throw e;
      },
    });
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    const { hashPassword } = await import("../src/server/auth/password");
    const hash = await hashPassword(PASSWORD);
    for (const k of Object.keys(BASE) as Key[]) {
      const [row] = await db.insert(s.users).values({ ...BASE[k], passwordHash: hash }).returning({ id: s.users.id });
      ids[k] = row.id;
    }
    dal = await import("../src/server/auth/dal");
    settings = await import("../src/server/actions/settings");
    auth = await import("../src/server/actions/auth");
    invites = await import("../src/server/actions/invites");
    tokens = await import("../src/server/auth/user-tokens");
    locks = await import("../src/server/auth/login-locks");
    totp = await import("../src/server/auth/totp");
    box = await import("../src/server/secret-box");
    newDevice = await import("../src/server/auth/new-device");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    // Öteki testler iki adımlısız yöneticiyle çalışır: zorunluluk kapalı (zorunluluğun kendi testi açar)
    process.env.ADMIN_2FA_OPTIONAL = "1";
    reqHeaders = new Headers();
    await db.execute(sql`TRUNCATE activity_log, login_device_locks, user_tokens, revoked_sessions RESTART IDENTITY CASCADE`);
    for (const k of Object.keys(BASE) as Key[]) {
      await db
        .update(s.users)
        .set({ ...BASE[k], active: true, failedLogins: 0, lockedUntil: null, lastLoginAt: null, totpEnabled: false, totpSecret: null, totpLastStep: null, recoveryCodes: null })
        .where(eq(s.users.id, ids[k]));
    }
  });

  const row = async (k: Key): Promise<User> => (await db.select().from(s.users).where(eq(s.users.id, ids[k])))[0];
  const seenOf = (u: User) => ({ name: u.name, email: u.email, role: u.role, active: u.active, branchId: u.branchId ?? null });
  /** Bu tarayıcıda (yeni çerez kutusu) oturum */
  const signIn = async (k: Key) => {
    jar = new Jar();
    await dal.startSession(await row(k));
  };
  const actions = async () => (await db.select({ action: s.activityLog.action, detail: s.activityLog.detail }).from(s.activityLog)).map((r) => r.action);

  test("listedeki anahtar yalnız erişimi yazar: bu arada değişen ad, e-posta ve rol geri dönmez (YO-01)", async () => {
    await signIn("ali");
    // Liste açıkken başka bir yönetici Kemal'in e-postasını ve adını düzeltti
    await db.update(s.users).set({ email: "kemal.yeni@laffogato.net", name: "Kemal Yeni" }).where(eq(s.users.id, ids.kemal));
    const sv = (await row("kemal")).sessionVersion;
    assert.deepEqual(await settings.setUserActive(ids.kemal, false), { ok: true, data: { notice: null } });
    let k = await row("kemal");
    assert.deepEqual(seenOf(k), { name: "Kemal Yeni", email: "kemal.yeni@laffogato.net", role: "staff", active: false, branchId: null });
    assert.equal(k.sessionVersion, sv + 1, "açık oturumları kapanır");
    assert.deepEqual(await actions(), ["Kullanıcı pasif yapıldı"]);

    // Bu arada yönetici yapılan kişi: kural veritabanındaki role bakar, parola ister; onaylanınca rolü yönetici kalır
    await db.update(s.users).set({ role: "admin", active: true }).where(eq(s.users.id, ids.kemal));
    assert.deepEqual(await settings.setUserActive(ids.kemal, false), { ok: false, error: STEP_UP_REQUIRED });
    assert.equal((await row("kemal")).active, true, "parolasız yazılmadı");
    assert.equal((await settings.setUserActive(ids.kemal, false, { password: PASSWORD })).ok, true);
    k = await row("kemal");
    assert.deepEqual([k.role, k.active], ["admin", false], "personele düşmedi");

    // Ters yön: pasif yönetici başka sekmede personele indirildi; eski listede "Aktif yap" onu yeniden yönetici yapmaz
    await db.update(s.users).set({ role: "staff" }).where(eq(s.users.id, ids.kemal));
    assert.equal((await settings.setUserActive(ids.kemal, true, { password: PASSWORD })).ok, true);
    k = await row("kemal");
    assert.deepEqual([k.role, k.active], ["staff", true]);

    // Zaten öyleyse (başka sekmede yapıldı) yazılmaz, işlem geçmişine satır düşmez
    const before = (await actions()).length;
    assert.deepEqual(await settings.setUserActive(ids.kemal, true), { ok: true, data: { notice: null } });
    assert.equal((await actions()).length, before);
    assert.equal((await row("kemal")).sessionVersion, k.sessionVersion);

    // Kendi hesabınız ve personelin eylemi
    assert.deepEqual(await settings.setUserActive(ids.ali, false), { ok: false, error: "Kendi hesabınızı pasif yapamazsınız" });
    await signIn("ayse");
    await assert.rejects(settings.setUserActive(ids.kemal, false), (e: { to?: string }) => e.to === "/panel/bugun");
  });

  test("pasif yapılan hesabın bekleyen bağlantısı iptal; yöneticiyi pasif yapmak parolayla, işlem geçmişine adıyla (YO-01)", async () => {
    await signIn("ali");
    await tokens.issueUserToken(ids.kemal, "reset", 24);
    assert.equal((await settings.setUserActive(ids.kemal, false)).ok, true);
    const live = await db.select().from(s.userTokens).where(and(eq(s.userTokens.userId, ids.kemal), sql`${s.userTokens.expiresAt} > now()`));
    assert.equal(live.length, 0, "bağlantı yeniden aktif yapılınca canlanmaz");
    assert.deepEqual(await settings.setUserActive(ids.veli, false), { ok: false, error: STEP_UP_REQUIRED });
    assert.equal((await settings.setUserActive(ids.veli, false, { password: PASSWORD })).ok, true);
    const log = await db.select({ action: s.activityLog.action, detail: s.activityLog.detail }).from(s.activityLog);
    assert.deepEqual(log.at(-1), { action: "Kullanıcı pasif yapıldı", detail: "Veli (yönetici)" });
  });

  test("düzenleme penceresi açıldığından beri değişen kişiyi kaydetmez; parola sormadan, hiçbir şey yazmadan reddeder (YO-01)", async () => {
    await signIn("ali");
    const seen = seenOf(await row("kemal"));
    // Pencere açıkken başka sekmede e-posta değişti: eski formun Kaydet'i geri yazmaz
    await db.update(s.users).set({ email: "kemal.yeni@laffogato.net" }).where(eq(s.users.id, ids.kemal));
    const stale = await settings.saveUser({ id: ids.kemal, name: "Kemal K.", email: seen.email, role: "staff", active: true, seen });
    assert.equal(stale.ok, false);
    assert.match(stale.ok ? "" : stale.error, /bu arada değişti/);
    assert.deepEqual(seenOf(await row("kemal")), { ...seen, email: "kemal.yeni@laffogato.net" });
    // Rol değişti (bu arada yönetici yapıldı): eski form onu personele indiremez; parola da sorulmaz
    await db.update(s.users).set({ role: "admin" }).where(eq(s.users.id, ids.kemal));
    const demote = await settings.saveUser({ id: ids.kemal, name: seen.name, email: "kemal.yeni@laffogato.net", role: "staff", active: true, seen: { ...seen, email: "kemal.yeni@laffogato.net" } });
    assert.match(demote.ok ? "" : demote.error, /bu arada değişti/);
    assert.equal((await row("kemal")).role, "admin");
    // Pencerenin gördüğü hâl güncelse kaydeder
    const fresh = seenOf(await row("kemal"));
    const ok = await settings.saveUser({ id: ids.kemal, name: "Kemal K.", email: fresh.email, role: "admin", active: true, seen: fresh });
    assert.equal(ok.ok, true, ok.ok ? "" : ok.error);
    assert.equal((await row("kemal")).name, "Kemal K.");
  });

  test("bilinen cihazın kilidi: o tarayıcı giremez, hesap kilitli görünmez; Kilidi aç cihazın kilidini de açar (YO-03)", async () => {
    // Ayşe kendi tabletinden bir kez girer: tablet bilinen cihaz olur
    jar = new Jar();
    const tablet = jar;
    await assert.rejects(auth.loginAction({}, form({ email: BASE.ayse.email, password: PASSWORD })), (e: { to?: string }) => e.to === "/panel/bugun");
    const device = await dal.readDevice();
    assert.ok(device?.did, "cihaz çerezi yazıldı");
    // Aynı tabletten 10 hatalı deneme (sayaç tek yazımda: tests/baglanti-db.test.ts)
    for (let i = 0; i < locks.DEVICE_MAX_FAILED; i++) await locks.reserveDeviceAttempt(db, ids.ayse, device.did);
    const lockedOut = await auth.loginAction({}, form({ email: BASE.ayse.email, password: PASSWORD }));
    assert.match(lockedOut.error ?? "", /^Çok fazla hatalı deneme\./, "doğru parola da geçmez");
    const a = await row("ayse");
    assert.equal(a.lockedUntil, null, "hesabın kendisi kilitli değil (ekranın yalnız buna bakması kilidi gizliyordu)");
    const [lock] = await db.select().from(s.loginDeviceLocks).where(eq(s.loginDeviceLocks.userId, ids.ayse));
    assert.ok(lock?.lockedUntil && lock.lockedUntil > new Date());

    // Yönetici Kilidi aç'a basar: cihazın satırı da silinir
    await signIn("ali");
    assert.deepEqual(await settings.unlockUser(ids.ayse), { ok: true, data: null });
    assert.equal((await db.select().from(s.loginDeviceLocks).where(eq(s.loginDeviceLocks.userId, ids.ayse))).length, 0);
    assert.ok((await actions()).includes("Hesap kilidi açıldı"));
    jar = tablet;
    await assert.rejects(auth.loginAction({}, form({ email: BASE.ayse.email, password: PASSWORD })), (e: { to?: string }) => e.to === "/panel/bugun");
  });

  /** Uygulamanın şu anki kodu ve hiçbir yakın adımda geçmeyen yanlış bir kod */
  const codes = (secret: string) => {
    const step = totp.totpStep();
    const valid = new Set([step - 1, step, step + 1].map((x) => totp.totpCode(secret, x)));
    const wrong = ["000000", "111111", "222222", "333333"].find((c) => !valid.has(c))!;
    return { right: totp.totpCode(secret, step), wrong };
  };
  const begin = async () => {
    const res = await auth.beginTotpSetup(PASSWORD);
    assert.ok(res.ok, res.ok ? "" : res.error);
    return res.data.secret.replace(/\s/g, "");
  };
  const WRONG_SETUP = "Kod tutmadı. Telefonun saati doğru mu? Uygulamadaki güncel kodu girin.";

  test("iki adımlı kurulum: 5. hatalı kod anahtarı siler, işlem geçmişine yazılır; yeniden başlatılan kurulum açılır (YO-05)", async () => {
    await signIn("ali");
    const secret = await begin();
    const stored = (await row("ali")).totpSecret!;
    assert.equal(openPendingSecret(box.open(stored, "totp")), secret, "bekleyen biçimde, başlangıç anıyla");
    const { right, wrong } = codes(secret);
    for (let i = 1; i < SETUP_MAX; i++) assert.deepEqual(await auth.confirmTotpSetup(wrong), { ok: false, error: WRONG_SETUP }, `${i}. deneme`);
    assert.deepEqual(await auth.confirmTotpSetup(wrong), { ok: false, error: SETUP_STOPPED });
    let a = await row("ali");
    assert.deepEqual([a.totpSecret, a.totpEnabled], [null, false], "bekleyen anahtar silindi");
    assert.ok((await actions()).includes("İki adımlı kurulum durduruldu"));
    // Durdurulan kurulumun doğru kodu da artık geçmez
    assert.deepEqual(await auth.confirmTotpSetup(right), { ok: false, error: "Önce kurulumu başlatın" });

    // Parolayla yeniden başlatılan kurulumun sayacı yeni; doğru kodla açılır, anahtar onaylanmış biçimde yazılır
    const again = await begin();
    const next = codes(again);
    assert.deepEqual(await auth.confirmTotpSetup(next.wrong), { ok: false, error: WRONG_SETUP });
    const done = await auth.confirmTotpSetup(next.right);
    assert.ok(done.ok, done.ok ? "" : done.error);
    a = await row("ali");
    assert.equal(a.totpEnabled, true);
    assert.equal(box.open(a.totpSecret!, "totp"), again, "giriş adımı anahtarı düz okur");
    assert.ok((await actions()).includes("İki adımlı doğrulama açıldı"));
  });

  test("iki adımlı kurulum: aynı anda gönderilen 20 kodun en çok 5'i değerlendirilir (YO-05)", async () => {
    await signIn("veli");
    const secret = await begin();
    const { wrong } = codes(secret);
    const results = await Promise.all(Array.from({ length: 20 }, () => auth.confirmTotpSetup(wrong)));
    const evaluated = results.filter((r) => !r.ok && r.error === WRONG_SETUP).length;
    assert.ok(evaluated <= SETUP_MAX - 1, `${evaluated} kod değerlendirildi`);
    // Ötekiler durduruldu ya da anahtar silindikten sonra okundu ("Önce kurulumu başlatın"); hiçbiri açmadı
    const other = results.filter((r) => !r.ok && r.error !== WRONG_SETUP).map((r) => (r.ok ? "açıldı" : r.error));
    assert.ok(other.includes(SETUP_STOPPED));
    assert.deepEqual([...new Set(other)].filter((e) => e !== SETUP_STOPPED && e !== "Önce kurulumu başlatın"), []);
    assert.equal((await row("veli")).totpSecret, null);
  });

  test("iki adımlı kurulum: süresi geçen ve önceki biçimdeki bekleyen anahtar onaylanmaz, silinir; Vazgeç anahtarı siler (YO-05)", async () => {
    await signIn("ali");
    const secret = await begin();
    const { right } = codes(secret);
    // 16 dakika önce başlamış kurulum
    await db.update(s.users).set({ totpSecret: box.seal(pendingSecret(secret, Date.now() - 16 * 60_000), "totp") }).where(eq(s.users.id, ids.ali));
    assert.deepEqual(await auth.confirmTotpSetup(right), { ok: false, error: SETUP_EXPIRED });
    assert.equal((await row("ali")).totpSecret, null);
    // Bu sürümden önce başlamış (başlangıç anı yok) yarım kurulum
    await db.update(s.users).set({ totpSecret: box.seal(secret, "totp") }).where(eq(s.users.id, ids.ali));
    assert.deepEqual(await auth.confirmTotpSetup(right), { ok: false, error: SETUP_EXPIRED });
    assert.equal((await row("ali")).totpSecret, null);
    // Vazgeç: bekleyen anahtar silinir; açık iki adımlıya dokunmaz
    await begin();
    assert.deepEqual(await auth.cancelTotpSetup(), { ok: true, data: null });
    assert.equal((await row("ali")).totpSecret, null);
    await db.update(s.users).set({ totpSecret: box.seal(secret, "totp"), totpEnabled: true }).where(eq(s.users.id, ids.ali));
    await auth.cancelTotpSetup();
    const a = await row("ali");
    assert.deepEqual([a.totpEnabled, a.totpSecret !== null], [true, true]);
  });

  test("davet: parola kuralı ve tekrar alanı bağlantının hakkından düşmez; kullanılamayan bağlantı önce söylenir (YO-06)", async () => {
    const { raw } = await tokens.issueUserToken(ids.kemal, "invite", 72);
    const attempts = async () => (await db.select({ n: s.userTokens.attempts }).from(s.userTokens).where(eq(s.userTokens.userId, ids.kemal)))[0].n;
    // E-postayı içeren parola: 10 kez denense de bağlantı kapanmaz (hak 10)
    for (let i = 0; i < 10; i++) {
      assert.deepEqual(await invites.setPasswordWithToken({}, form({ t: raw, password: "Kemal-Kahvalti-77", repeat: "Kemal-Kahvalti-77" })), { error: "Parola e-posta adresinizi içermesin" });
    }
    assert.deepEqual(await invites.setPasswordWithToken({}, form({ t: raw, password: "Sabah-Simidi-77", repeat: "Sabah-Simidi-78" })), { error: "İki parola aynı değil" });
    assert.equal(await attempts(), 0);
    assert.deepEqual(await invites.setPasswordWithToken({}, form({ t: raw, password: "Sabah-Simidi-77", repeat: "Sabah-Simidi-77" })), { done: true });
    assert.equal(await attempts(), 1, "yazmaya giden deneme sayılır");
    // Süresi dolmuş bağlantı: parola hatası değil, bağlantının durumu
    const old = await tokens.issueUserToken(ids.ayse, "reset", 24);
    await db.update(s.userTokens).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(s.userTokens.userId, ids.ayse));
    assert.deepEqual(await invites.setPasswordWithToken({}, form({ t: old.raw, password: "ayse", repeat: "x" })), { status: "expired" });
  });

  test("giriş kodu: kurtarma kodu kipinde yanlış ya da kullanılmış kod uygulamanın kodunu istemez (YO-07)", async () => {
    const secret = totp.generateTotpSecret();
    const recovery = totp.generateRecoveryCodes(2);
    const hashes = await Promise.all(recovery.map((c) => totp.hashRecoveryCode(ids.veli, c)));
    await db.update(s.users).set({ totpEnabled: true, totpSecret: box.seal(secret, "totp"), recoveryCodes: hashes }).where(eq(s.users.id, ids.veli));
    jar = new Jar();
    await dal.startPending(await row("veli"), "");
    const { wrong } = codes(secret);
    assert.deepEqual(await auth.verifyLoginCodeAction({}, form({ code: "abcde-fghjk", mode: "recovery" })), { error: totp.WRONG_RECOVERY_CODE });
    assert.deepEqual(await auth.verifyLoginCodeAction({}, form({ code: wrong, mode: "app" })), { error: totp.WRONG_APP_CODE });
    // Kip gelmese de 6 haneli olmayan kod kurtarma kodudur
    assert.deepEqual(await auth.verifyLoginCodeAction({}, form({ code: "abcde-fghjk" })), { error: totp.WRONG_RECOVERY_CODE });
    // Doğru kurtarma kodu girer (bir kez)
    await assert.rejects(auth.verifyLoginCodeAction({}, form({ code: recovery[0], mode: "recovery" })), (e: { to?: string }) => e.to === "/panel");
  });

  // ---------------------------------------------------------------- Yönetici güvenliği (src/lib/admin-security.ts)

  /** Yönlendirmenin hedefi (taklit redirect hatası) */
  const to = (target: string) => (e: { to?: string }) => {
    assert.equal(e.to, target);
    return true;
  };
  const SETUP = "/giris/iki-adim";
  const login = (k: Key, next?: string) => auth.loginAction({}, form({ email: BASE[k].email, password: PASSWORD, ...(next ? { next } : {}) }));

  test("zorunlu iki adımlı: kurmamış yönetici girişten sonra kurulum ekranına; kurana kadar ekran ve eylem yok, kurunca panel", async () => {
    delete process.env.ADMIN_2FA_OPTIONAL;
    jar = new Jar();
    await assert.rejects(login("ali", "/panel/kasa"), to(`${SETUP}?next=%2Fpanel%2Fkasa`), "panel yerine kurulum ekranı, dönülecek yerle");
    // Oturum açıldı ama panel kapalı: veri uçları oturumsuz sayar, sayfa ve eylemler kurulum ekranına gönderir
    assert.equal(await dal.getCurrentUser(), null, "canlı veri, dışa aktarma, fotoğraf… kurmamış yöneticiye bir şey vermez");
    await assert.rejects(dal.requireUser(), to(SETUP));
    await assert.rejects(dal.requireAdmin(), to(SETUP));
    await assert.rejects(settings.unlockUser(ids.ayse), to(SETUP), "yönetici eylemi de çalışmaz (attempt yönlendirmeyi geri atar)");
    await assert.rejects(auth.disableTotp(PASSWORD), to(SETUP), "Hesabım'ın öbür eylemleri de");
    assert.equal(await dal.awaitingTwoFactorSetup(), true, "Claude onay ekranı girişe değil kuruluma gönderir");
    const me = await dal.requireSignedIn();
    assert.deepEqual([me.id, me.needsTwoFactor, me.totpEnabled], [ids.ali, true, false]);

    // Kurulum hemen o ekranda: parola → kod → açılır; oturum yenilenir, panel açılır
    const secret = await begin();
    const done = await auth.confirmTotpSetup(codes(secret).right);
    assert.ok(done.ok, done.ok ? "" : done.error);
    assert.equal(done.data.codes.length, 8, "kurtarma kodları verilir");
    assert.equal((await dal.requireUser()).id, ids.ali);
    assert.equal((await dal.getCurrentUser())?.id, ids.ali);
    assert.equal(await dal.awaitingTwoFactorSetup(), false);
    assert.ok((await actions()).includes("İki adımlı doğrulama açıldı"));

    // Kapatınca yeniden kurulum ekranı (telefon değiştirirken böyle yapılır); oturum düşmez
    assert.deepEqual(await auth.disableTotp(PASSWORD), { ok: true, data: null });
    await assert.rejects(dal.requireUser(), to(SETUP));
    assert.equal((await dal.requireSignedIn()).id, ids.ali);
  });

  test("zorunlu iki adımlı: personel etkilenmez, kurmuş yönetici kod adımından panele, açık oturum düşmez, ADMIN_2FA_OPTIONAL=1 kapatır", async () => {
    delete process.env.ADMIN_2FA_OPTIONAL;
    jar = new Jar();
    await assert.rejects(login("ayse"), to("/panel/bugun"), "personelde isteğe bağlı");
    assert.equal((await dal.requireUser()).id, ids.ayse);

    // Kurmuş yönetici: parola → kod → panel (kurulum ekranı yok)
    const secret = totp.generateTotpSecret();
    await db.update(s.users).set({ totpEnabled: true, totpSecret: box.seal(secret, "totp") }).where(eq(s.users.id, ids.veli));
    jar = new Jar();
    assert.deepEqual(await login("veli", "/panel/kasa"), { step: "totp", email: BASE.veli.email });
    await assert.rejects(auth.verifyLoginCodeAction({}, form({ code: codes(secret).right })), to("/panel/kasa"));
    assert.equal((await dal.requireAdmin()).id, ids.veli);

    // Yayından önce açılmış oturum kapanmaz: kurulum ekranına gider, zorunluluk kalkınca aynı oturumla panel
    await signIn("ali");
    await assert.rejects(dal.requireUser(), to(SETUP));
    process.env.ADMIN_2FA_OPTIONAL = "1";
    assert.equal((await dal.requireAdmin()).id, ids.ali, "acil durum: zorunluluk kapalı, aynı oturum geçer");
    jar = new Jar();
    await assert.rejects(login("ali"), to("/panel"), "acil durumda giriş doğrudan panele");
  });

  const UA_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
  const deviceRows = async (k?: Key) =>
    (await db.select({ userId: s.activityLog.userId, detail: s.activityLog.detail }).from(s.activityLog).where(eq(s.activityLog.action, "Yeni cihazdan giriş")))
      .filter((r) => !k || r.userId === ids[k])
      .map((r) => r.detail);

  test("yeni cihaz: görülmemiş tarayıcıdan başarılı girişte işlem geçmişi ve zil; ilk giriş, aynı tarayıcı ve parola değişikliği uyarı değil", async () => {
    reqHeaders = new Headers({ "user-agent": UA_CHROME, "x-forwarded-for": "85.105.12.34, 10.0.0.1" });
    jar = new Jar();
    const laptop = jar;
    await assert.rejects(login("ali"), to("/panel"));
    assert.deepEqual(await deviceRows(), [], "hesabın ilk girişi (davetten sonra) uyarı değil");
    await assert.rejects(login("ali"), to("/panel"));
    assert.deepEqual(await deviceRows(), [], "aynı tarayıcı");

    // Telefon: yeni tarayıcı
    reqHeaders = new Headers({ "user-agent": UA_IPHONE, "x-forwarded-for": "2a02:4e0:2d1:abcd::1" });
    jar = new Jar();
    await assert.rejects(login("ali"), to("/panel"));
    assert.deepEqual(await deviceRows("ali"), ["Safari · iPhone · IP 2a02:4e0:2d1::/48"]);
    // KVKK: tam IP ve tarayıcı kimliği hiçbir satırda yok
    const log = JSON.stringify(await db.select().from(s.activityLog));
    assert.doesNotMatch(log, /85\.105\.12\.34|abcd|Mozilla|AppleWebKit/);

    // Zil: kişinin kendisinde, Hesabım › Oturumlar'a götürür; öteki yöneticide yok
    const bell = await newDevice.newDeviceBellRows({ id: ids.ali, role: "admin" });
    assert.equal(bell.length, 1);
    assert.equal(bell[0].title, "Yeni cihazdan giriş: Safari · iPhone · IP 2a02:4e0:2d1::/48");
    assert.deepEqual([bell[0].href, bell[0].group, bell[0].kind], ["/panel/hesap#oturumlar", "sistem", "warning"]);
    assert.deepEqual(await newDevice.newDeviceBellRows({ id: ids.veli, role: "admin" }), []);

    // Parola değişince (oturum sürümü artar) aynı dizüstü yeni sayılmaz; hesap kilidi için bilinmez olsa da
    await db.update(s.users).set({ sessionVersion: sql`${s.users.sessionVersion} + 1` }).where(eq(s.users.id, ids.ali));
    jar = laptop;
    reqHeaders = new Headers({ "user-agent": UA_CHROME, "x-forwarded-for": "85.105.12.34" });
    await assert.rejects(login("ali"), to("/panel"));
    assert.equal((await deviceRows("ali")).length, 1, "parola değişikliğinden sonra her tarayıcıda uyarı gelmez");

    // Zil 7 gün gösterir
    await db.update(s.activityLog).set({ at: new Date(Date.now() - 8 * 86_400_000) }).where(eq(s.activityLog.action, "Yeni cihazdan giriş"));
    assert.deepEqual(await newDevice.newDeviceBellRows({ id: ids.ali, role: "admin" }), []);
  });

  test("yeni cihaz: kod adımıyla girişte de; personele uyarı yok; ortak tablette sıradaki yönetici için tablet yeni", async () => {
    // Ayşe'nin tableti: ilk giriş ve başka bir tarayıcı, personelde uyarı değil
    reqHeaders = new Headers({ "user-agent": UA_CHROME, "x-forwarded-for": "85.105.12.34" });
    jar = new Jar();
    const tablet = jar;
    await assert.rejects(login("ayse"), to("/panel/bugun"));
    jar = new Jar();
    await assert.rejects(login("ayse"), to("/panel/bugun"));
    assert.deepEqual(await deviceRows("ayse"), [], "personel uyarı almaz");
    assert.deepEqual(await newDevice.newDeviceBellRows({ id: ids.ayse, role: "staff" }), []);

    // Veli (iki adımlı) daha önce başka yerden girmişti; Ayşe'nin tabletinden kodla girer: tablet Veli için yeni
    const secret = totp.generateTotpSecret();
    await db.update(s.users).set({ totpEnabled: true, totpSecret: box.seal(secret, "totp"), lastLoginAt: new Date(Date.now() - 86_400_000) }).where(eq(s.users.id, ids.veli));
    jar = tablet;
    assert.deepEqual(await login("veli"), { step: "totp", email: BASE.veli.email });
    assert.deepEqual(await deviceRows("veli"), [], "parola doğru ama giriş henüz bitmedi");
    await assert.rejects(auth.verifyLoginCodeAction({}, form({ code: codes(secret).right })), to("/panel"));
    assert.deepEqual(await deviceRows("veli"), ["Chrome · Windows · IP 85.105.12.x"]);
    // Ayşe aynı tablete yeniden girer: tablet onun için yeni değil (Veli'nin girişi cihaz kaydını silmez)
    jar = tablet;
    await assert.rejects(login("ayse"), to("/panel/bugun"));
    assert.equal((await dal.requireUser()).id, ids.ayse);
  });
});

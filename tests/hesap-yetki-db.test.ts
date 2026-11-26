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
});

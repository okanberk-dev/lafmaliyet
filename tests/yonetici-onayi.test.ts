// Yönetici işlemlerinde parolayla onay: hangi kullanıcı işlemi işlemi yapanın kendi parolasını ister (src/lib/step-up.ts),
// penceredeki metinler (src/app/panel/kullanicilar/step-up-text.ts) ve sunucunun her eylemde parolayı ilk yazımdan önce
// yeniden denetlemesi. Parola denetimi "use server" dosyasından dışa açılmaz (istemciden çağrılabilir parola kapısı olurdu).
// Çalıştırma: npx tsx --test tests/yonetici-onayi.test.ts

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { relinkText } from "../src/app/panel/kullanicilar/access";
import { STEP_UP_CLOSING, stepUpText, type StepUpTextCase } from "../src/app/panel/kullanicilar/step-up-text";
import {
  isStepUpError,
  needsStepUp,
  PASSWORD_MISSING,
  STEP_UP_REQUIRED,
  stepUpChanges,
  stepUpWhat,
  TOO_MANY_REAUTH,
  WRONG_PASSWORD,
  type StepUpCase,
  type StepUpChange,
} from "../src/lib/step-up";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

type Save = Extract<StepUpCase, { kind: "save" }>;
const admin = { role: "admin" as const, active: true, email: "ali@laffogato.net" };
const staff = { role: "staff" as const, active: true, email: "ayse@laffogato.net" };
const save = (before: Save["before"], after: Partial<Save["after"]> = {}): Save => ({ kind: "save", before, after: { ...before, password: false, ...after } });

test("kural: yönetici ekleme ve yönetici hesabına dokunan her değişiklik parola ister; personel işleri istemez", () => {
  assert.equal(needsStepUp({ kind: "create", role: "admin" }), true);
  assert.equal(needsStepUp({ kind: "create", role: "staff" }), false);

  // Yönetici yapmak ve yöneticilikten almak
  assert.equal(needsStepUp(save(staff, { role: "admin" })), true);
  assert.equal(needsStepUp(save(admin, { role: "staff" })), true);
  // Yöneticinin parolası, e-postası, erişimi (iki yönde)
  assert.equal(needsStepUp(save(admin, { password: true })), true);
  assert.equal(needsStepUp(save(admin, { email: "veli@laffogato.net" })), true);
  assert.equal(needsStepUp(save(admin, { active: false })), true);
  assert.equal(needsStepUp(save({ ...admin, active: false }, { active: true })), true, "pasif yöneticiyi yeniden aktif yapmak");
  // Yalnız büyük harf / boşluk farkı e-posta değişikliği sayılmaz (formlar ve zod e-postayı küçük harfe çevirir)
  assert.equal(needsStepUp(save(admin, { email: "  ALI@Laffogato.net " })), false);
  // Yöneticide yalnız ad değişikliği (ad bu kuralın girdisi bile değil) ve hiç değişiklik yok
  assert.equal(needsStepUp(save(admin)), false);
  assert.equal(needsStepUp(save({ ...admin, active: false })), false);
  // Personel: parola, e-posta, erişim tek dokunuş
  assert.equal(needsStepUp(save(staff, { password: true })), false);
  assert.equal(needsStepUp(save(staff, { email: "fatma@laffogato.net" })), false);
  assert.equal(needsStepUp(save(staff, { active: false })), false);
  assert.equal(needsStepUp(save({ ...staff, active: false }, { active: true })), false);

  for (const kind of ["link", "2fa", "delete"] as const) {
    assert.equal(needsStepUp({ kind, targetRole: "admin" }), true, kind);
    assert.equal(needsStepUp({ kind, targetRole: "staff" }), false, kind);
  }
});

test("değişiklik listesi pencerede yazılacağı sırayla; personelde boş", () => {
  assert.deepEqual(stepUpChanges(save(staff, { role: "admin", password: true })), ["promote", "password"]);
  assert.deepEqual(stepUpChanges(save(admin, { role: "staff", active: false })), ["demote", "deactivate"]);
  assert.deepEqual(stepUpChanges(save({ ...admin, active: false }, { active: true, email: "yeni@laffogato.net", password: true })), ["activate", "email", "password"]);
  assert.deepEqual(stepUpChanges(save(staff, { password: true, email: "x@laffogato.net", active: false })), []);
  assert.deepEqual(stepUpChanges(save(admin)), []);
});

test("işlem geçmişi metni her işlem için ayrı", () => {
  const cases: StepUpCase[] = [{ kind: "create", role: "admin" }, save(admin, { password: true }), { kind: "link", targetRole: "admin" }, { kind: "2fa", targetRole: "admin" }, { kind: "delete", targetRole: "admin" }];
  const texts = cases.map(stepUpWhat);
  assert.equal(new Set(texts).size, texts.length);
  assert.equal(stepUpWhat({ kind: "create", role: "admin" }), "yönetici ekleme");
});

const target = { name: "Ali Kaya", email: "ali@laffogato.net", invite: "none" as const, liveLink: null };
// "pending": geçerli davet bağlantısı var (sayfa öyle hesaplar); "expired": yok (süresi doldu ya da pasif yapılınca iptal oldu)
const invitee = { ...target, invite: "pending" as const, liveLink: { kind: "invite" as const, until: "25.10.2026 14:30" } };
const expiredInvitee = { ...target, invite: "expired" as const };
const live = { ...target, liveLink: { kind: "reset" as const, until: "23.10.2026 14:30" } };

test("pencere metinleri: her açıklama aynı cümleyle biter, kişinin adı yazar, başlıklar ayrı", () => {
  const named: StepUpTextCase[] = [
    { kind: "create", name: "Ali Kaya", mode: "password" },
    { kind: "save", user: target, changes: ["password"], name: "Ali Kaya", email: target.email },
    { kind: "toggle", name: "Ali Kaya", active: false, invite: "none" },
    { kind: "toggle", name: "Ali Kaya", active: true, invite: "none" },
    { kind: "link", user: target },
    { kind: "delete", name: "Ali Kaya" },
  ];
  const unnamed: StepUpTextCase[] = [{ kind: "2fa" }, { kind: "fallback" }];
  for (const c of [...named, ...unnamed]) {
    const t = stepUpText(c);
    assert.ok(t.description.endsWith(STEP_UP_CLOSING), c.kind);
    assert.equal(t.description.split(STEP_UP_CLOSING).length, 2, `${c.kind}: kapanış cümlesi bir kez`);
    assert.ok(t.title && t.confirmLabel, c.kind);
  }
  for (const c of named) {
    const t = stepUpText(c);
    assert.ok(`${t.title} ${t.description}`.includes("Ali Kaya"), c.kind);
  }
  const titles = [...named, ...unnamed].map((c) => stepUpText(c).title);
  assert.equal(new Set(titles).size, titles.length, "başlıklar birbirinden farklı");
});

test("pencere metinleri: değişiklikler sırayla, e-posta eski ve yeniyle, davetliye parola, tehlikeli olanlar kırmızı", () => {
  const t = stepUpText({ kind: "save", user: target, changes: ["promote", "email", "password"], name: " Ali Kaya ", email: " ALI.K@laffogato.net" });
  assert.equal(
    t.description,
    "Ali Kaya yönetici olacak: maliyet, kâr, ayarlar ve kullanıcılar dahil her şeyi görür. Giriş e-postası ali@laffogato.net yerine ali.k@laffogato.net olacak. Ali Kaya kullanıcısının parolası değişecek; açık oturumları kapanır. " +
      STEP_UP_CLOSING,
  );
  assert.equal(t.danger, false);
  assert.equal(t.confirmLabel, "Kaydet");
  assert.match(stepUpText({ kind: "save", user: invitee, changes: ["password"], name: "Ali Kaya", email: invitee.email }).description, /davet bağlantısı çalışmaz olur/);

  assert.equal(stepUpText({ kind: "save", user: target, changes: ["deactivate"], name: "Ali", email: target.email }).danger, true);
  assert.equal(stepUpText({ kind: "save", user: target, changes: ["demote"], name: "Ali", email: target.email }).danger, true);
  assert.equal(stepUpText({ kind: "save", user: target, changes: ["activate", "email"], name: "Ali", email: "x@y.z" }).danger, false);
  assert.equal(stepUpText({ kind: "2fa" }).danger, true);
  assert.equal(stepUpText({ kind: "delete", name: "Ali" }).danger, true);
  assert.equal(stepUpText({ kind: "toggle", name: "Ali", active: false, invite: "none" }).danger, true);
  assert.equal(stepUpText({ kind: "toggle", name: "Ali", active: true, invite: "none" }).danger, false);

  // Listedeki anahtar: tek değişiklik, özel başlık ve düğme
  assert.equal(stepUpText({ kind: "toggle", name: "Ali", active: false, invite: "none" }).title, "Ali pasif yapılsın mı?");
  assert.equal(stepUpText({ kind: "toggle", name: "Ali", active: false, invite: "none" }).confirmLabel, "Pasif yap");
  assert.equal(stepUpText({ kind: "toggle", name: "Ali", active: true, invite: "none" }).title, "Ali yeniden aktif yapılsın mı?");
  assert.equal(stepUpText({ kind: "toggle", name: "Ali", active: true, invite: "none" }).confirmLabel, "Aktif yap");

  // Ekle: düğme parola adımına göre
  assert.equal(stepUpText({ kind: "create", name: "Ali", mode: "password" }).confirmLabel, "Yöneticiyi ekle");
  assert.equal(stepUpText({ kind: "create", name: "Ali", mode: "invite" }).confirmLabel, "Ekle ve bağlantı oluştur");
});

test("pencere metinleri: davetli ve geçerli bağlantı, yalnızca gerçekten olanı söyler", () => {
  const say = (user: Extract<StepUpTextCase, { kind: "save" }>["user"], changes: StepUpChange[]) =>
    stepUpText({ kind: "save", user, changes, name: "Ali Kaya", email: user.email }).description;

  // Yönetici yapmak geçerli bağlantıyı iptal eder (sunucu expireUserTokens); pencere bunu söyler
  assert.match(say(live, ["promote"]), /Geçerli parola sıfırlama bağlantısı iptal olur\./);
  assert.match(say(invitee, ["promote"]), /Gönderilen davet bağlantısı iptal olur; yenisini oluşturmanız gerekir\./);
  assert.doesNotMatch(say(target, ["promote"]), /bağlantı/);
  // Parola da belirleniyorsa bağlantı bir kez anılır (parola cümlesinde)
  assert.equal(say(invitee, ["promote", "password"]).match(/bağlantı/g)?.length, 1);
  assert.doesNotMatch(say(live, ["promote", "password"]), /bağlantı/);

  // Davetliye parola: bağlantı yalnızca varsa "çalışmaz olur"
  assert.match(say(invitee, ["password"]), /Ali Kaya için parola belirlenecek; davet bağlantısı çalışmaz olur\./);
  assert.equal(say(expiredInvitee, ["password"]), `Ali Kaya için parola belirlenecek. ${STEP_UP_CLOSING}`);

  // Pasif davetliyi aktif yapıp aynı kayıtta parola vermek: kişi o parolayla girer, davet bağlantısı gerekmez
  const passiveInvitee = { ...expiredInvitee, name: "Pasif Davetli" };
  assert.equal(
    stepUpText({ kind: "save", user: passiveInvitee, changes: ["activate", "password"], name: "Pasif Davetli", email: passiveInvitee.email }).description,
    `Pasif Davetli yeniden giriş yapabilecek. Pasif Davetli için parola belirlenecek. ${STEP_UP_CLOSING}`,
  );
  assert.match(say(expiredInvitee, ["activate"]), /yeniden aktif olacak; giriş için yeni davet bağlantısı gerekir/);
  assert.match(say(target, ["activate"]), /Ali Kaya yeniden giriş yapabilecek\./);

  // Listedeki anahtar: pasif davetli yeniden aktif olunca da giriş yapamaz (bağlantı iptal olmuştu, parola yok)
  const on = stepUpText({ kind: "toggle", name: "Pasif Davetli", active: true, invite: "expired" });
  assert.equal(on.title, "Pasif Davetli yeniden aktif yapılsın mı?");
  assert.equal(on.description, `Hesap yeniden aktif olur; giriş için yeni davet bağlantısı oluşturmanız gerekir. ${STEP_UP_CLOSING}`);
  assert.doesNotMatch(on.description, /giriş yapılabilir/);
  assert.match(stepUpText({ kind: "toggle", name: "Ali", active: true, invite: "none" }).description, /yeniden giriş yapılabilir/);
});

test("yöneticiye bağlantı: geçerli bağlantı varsa 'eskisi çalışmaz olur' sorusu aynı pencerede", () => {
  const withLive = stepUpText({ kind: "link", user: live });
  assert.equal(withLive.title, relinkText(live).title);
  assert.ok(withLive.description.startsWith(relinkText(live).description));
  assert.match(withLive.description, /hemen çalışmaz olur/);
  assert.match(withLive.description, /yeni parola belirleyebilir/);

  assert.equal(stepUpText({ kind: "link", user: target }).title, "Ali Kaya için parola sıfırlama bağlantısı oluşturulsun mu?");
  const invite = stepUpText({ kind: "link", user: expiredInvitee });
  assert.equal(invite.title, "Ali Kaya için yeni davet bağlantısı oluşturulsun mu?");
  assert.match(invite.description, /yönetici olarak giriş yapabilir/);
  assert.equal(invite.confirmLabel, "Bağlantı oluştur");
});

test("pencerede kalan hatalar yalnızca parolayla ilgili olanlar", () => {
  for (const m of [STEP_UP_REQUIRED, WRONG_PASSWORD, TOO_MANY_REAUTH, PASSWORD_MISSING, "Parolanızı girin"]) assert.equal(isStepUpError(m), true, m);
  for (const m of ["Bu e-posta başka bir kullanıcıda kayıtlı", "En az bir aktif yönetici kalmalı", "Kullanıcı bulunamadı", "Mevcut parola hatalı"]) {
    assert.equal(isStepUpError(m), false, m);
  }
  // Hesabım'daki metinler aynı kaldı
  assert.equal(WRONG_PASSWORD, "Parola hatalı");
  assert.equal(TOO_MANY_REAUTH, "Çok fazla hatalı parola. 15 dakika sonra yeniden deneyin.");
});

// ---------------------------------------------------------------- Sunucu: kaynak denetimleri

/** `export async function NAME`'den bir sonraki dışa açılan işleve kadar */
function body(src: string, name: string) {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} yok`);
  const next = src.indexOf("export async function ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

test("parola denetimi server-only modülde; 'use server' dosyalarından dışa açılmaz", () => {
  const stepUp = read("src/server/auth/step-up.ts");
  assert.ok(stepUp.startsWith('import "server-only";'));
  assert.doesNotMatch(stepUp, /^\s*["']use server["'];?\s*$/m, "yönerge satırı yok");

  const auth = read("src/server/actions/auth.ts");
  assert.doesNotMatch(auth, /const reauthFails/);
  assert.match(auth, /from "@\/server\/auth\/step-up"/);
  // Hesabım'ın her onayı kendi adıyla yazılır (işlem geçmişindeki satır değişmez)
  const calls = [...auth.matchAll(/(?:requirePassword|confirmPassword)\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(calls.length >= 6);
  for (const args of calls) assert.match(args, /, "Hesabım"$/, args);

  // Hiçbir eylem dosyası parola denetimini dışa açmaz ya da yeniden dışa vermez
  const dir = join(process.cwd(), "src/server/actions");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
    const src = readFileSync(join(dir, f), "utf8");
    assert.doesNotMatch(src, /export (?:async )?function (?:confirmPassword|requirePassword|requireStepUp)\b/, f);
    assert.doesNotMatch(src, /export\s*\{[^}]*\b(?:confirmPassword|requirePassword|requireStepUp)\b/, f);
  }
});

test("her yönetici işlemi parolayı ilk yazımdan önce yeniden denetler", () => {
  const settings = read("src/server/actions/settings.ts");
  const invites = read("src/server/actions/invites.ts");
  const bodies = [
    ["createUser", body(settings, "createUser")],
    ["saveUser", body(settings, "saveUser")],
    ["deleteUser", body(settings, "deleteUser")],
    ["resetUserTwoFactor", body(settings, "resetUserTwoFactor")],
    ["createAccessLink", body(invites, "createAccessLink")],
  ] as const;
  for (const [name, src] of bodies) {
    const guard = src.indexOf("requireStepUp(");
    assert.ok(guard > 0, `${name}: requireStepUp yok`);
    const writes = [".insert(", ".update(", ".delete(", "issueUserToken("].map((w) => src.indexOf(w)).filter((i) => i >= 0);
    assert.ok(writes.length > 0, `${name}: yazım bulunamadı`);
    assert.ok(guard < Math.min(...writes), `${name}: parola denetimi yazımdan sonra`);
    // Kural tek yerde: eylem kararı needsStepUp'tan alır
    assert.match(src, /needsStepUp\(/, name);
  }
  // Eski "ekle" dalı kapandı: saveUser parolayla yönetici ekleyemez (createUser'ın onayı atlanamaz)
  const saveUser = body(settings, "saveUser");
  assert.doesNotMatch(saveUser, /\.insert\(s\.users\)/);
  assert.match(settings, /const userSchema = z\.object\(\{\n {2}id: z\.number\(\)\.int\(\)\.positive\(\),/);
  // Personelken parola sorulmadan oluşturulan davet / sıfırlama bağlantısı yönetici yapılınca iptal olur (yoksa
  // bağlantıyı alan kişi yönetici hesabına parola belirler); güncellemeden sonra
  const promoteExpire = saveUser.search(/if \(before\.role !== "admin" && data\.role === "admin"\) await expireUserTokens\(data\.id\);/);
  assert.ok(promoteExpire > saveUser.indexOf(".update(s.users)"), "saveUser: yönetici yapınca bağlantılar iptal olmuyor");
  // Savunma araçları parola istemez: kilit açma ve oturumları kapatma hızlı kalır
  assert.doesNotMatch(body(settings, "unlockUser"), /requireStepUp/);
  assert.doesNotMatch(body(settings, "signOutUserEverywhere"), /requireStepUp/);
});

test("parola penceresi tek yerde: Hesabım'daki eski dosya yok, kimse onu içe aktarmıyor", () => {
  assert.equal(existsSync(join(process.cwd(), "src/app/panel/hesap/confirm-password.tsx")), false);
  const files = readdirSync(join(process.cwd(), "src"), { recursive: true, encoding: "utf8" }).filter((f) => /\.(ts|tsx)$/.test(f));
  for (const f of files) {
    const src = readFileSync(join(process.cwd(), "src", f), "utf8");
    assert.doesNotMatch(src, /from\s+["'][^"']*\/confirm-password["']/, f);
  }
  const users = read("src/app/panel/kullanicilar/users-client.tsx");
  assert.match(users, /from "@\/components\/panel\/confirm-password-dialog"/);
});

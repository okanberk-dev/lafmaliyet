// Paraşüt bağlantı ayarları (src/lib/parasut/settings.ts, docs/PARASUT.md § 1): alan alan önce panel, yoksa ortam
// değişkeni; formun denetimi; kaydın sonuçları (istemci değişince oturum silinir, firma değişince imleç sıfırlanır,
// Paraşüt'ten fatura gelmişse firma değiştirilemez); ekrana ve işlem geçmişine client_secret'ın değeri gitmez.
// Veritabanında kayıt eylemi: tests/parasut-esitleme-db.test.ts › "Bağlantı ayarları".
// Çalıştırma: npx tsx --test tests/parasut-ayarlar.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  COMPANY_LOCKED_TEXT,
  missingSettings,
  parasutSettingsInput,
  planParasutSettings,
  resolveParasutSettings,
  settingsLogText,
  settingsView,
  type ParasutSettingsInput,
} from "../src/lib/parasut/settings";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const ENV = { PARASUT_CLIENT_ID: "vercel-istemci", PARASUT_CLIENT_SECRET: "vercel-sir", PARASUT_COMPANY_ID: "424242", PARASUT_SYNC_FROM: "2026-01-15" };
/** Formun ekranda gelen hâli: kullanılan değerlerle dolu, secret boş */
const form = (r: ReturnType<typeof resolveParasutSettings>, over: Partial<ParasutSettingsInput> = {}): ParasutSettingsInput => ({
  clientId: r.clientId.value ?? "",
  clientSecret: "",
  companyId: r.companyId.value ?? "",
  syncFrom: r.syncFrom.value ?? "",
  ...over,
});

test("öncelik: alan alan paneldeki değer, yoksa ortam değişkeni; ikisi de yoksa eksik", () => {
  // Yalnız ortam: bugünkü canlı kurulum hiçbir şey yapmadan çalışır
  const env = resolveParasutSettings({}, ENV);
  assert.deepEqual(env.clientId, { value: "vercel-istemci", source: "env" });
  assert.deepEqual(env.clientSecret, { value: "vercel-sir", source: "env" });
  assert.deepEqual(env.companyId, { value: "424242", source: "env" });
  assert.deepEqual(env.syncFrom, { value: "2026-01-15", source: "env" });
  assert.deepEqual(missingSettings(env), []);

  // Panel kazanır, alan alan (öteki alanlar ortamdan sürer)
  const mixed = resolveParasutSettings({ clientId: "panel-istemci", clientSecret: "panel-sir" }, ENV);
  assert.deepEqual(mixed.clientId, { value: "panel-istemci", source: "panel" });
  assert.deepEqual(mixed.clientSecret, { value: "panel-sir", source: "panel" });
  assert.deepEqual(mixed.companyId, { value: "424242", source: "env" });

  // Boşluklar kırpılır; boş panel değeri ortama düşer; takvimde olmayan tarih yok sayılır
  const trimmed = resolveParasutSettings({ clientId: "  ", companyId: " 777 " }, { ...ENV, PARASUT_CLIENT_SECRET: " s \n", PARASUT_SYNC_FROM: "2026-02-30" });
  assert.equal(trimmed.clientId.source, "env");
  assert.deepEqual(trimmed.companyId, { value: "777", source: "panel" });
  assert.equal(trimmed.clientSecret.value, "s");
  assert.deepEqual(trimmed.syncFrom, { value: null, source: null });

  const none = resolveParasutSettings({}, {});
  assert.deepEqual(missingSettings(none), ["clientId", "clientSecret", "companyId"]);
  assert.deepEqual(none.syncFrom, { value: null, source: null }, "ilk eşitleme başlangıcı zorunlu değil");
});

test("form denetimi: boşluksuz istemci bilgileri, yalnız rakam firma, geçerli ve ileri olmayan tarih", () => {
  const ok = parasutSettingsInput.parse({ clientId: " abc-123 ", clientSecret: "", companyId: " 424242 ", syncFrom: "2026-01-01" });
  assert.deepEqual(ok, { clientId: "abc-123", clientSecret: "", companyId: "424242", syncFrom: "2026-01-01" });
  const bad = (over: Partial<ParasutSettingsInput>) => parasutSettingsInput.safeParse({ clientId: "a", clientSecret: "", companyId: "1", syncFrom: "", ...over });
  assert.match(bad({ companyId: "12a45" }).error?.issues[0]?.message ?? "", /yalnız rakam/);
  assert.match(bad({ clientId: "iki parça" }).error?.issues[0]?.message ?? "", /boşluk içeremez/);
  assert.match(bad({ clientSecret: "s ir" }).error?.issues[0]?.message ?? "", /Client Secret boşluk içeremez/);
  assert.match(bad({ syncFrom: "2026-02-30" }).error?.issues[0]?.message ?? "", /geçerli bir tarih/);
  assert.match(bad({ syncFrom: "2999-01-01" }).error?.issues[0]?.message ?? "", /ileri bir tarih/);
  assert.equal(bad({}).success, true);
});

test("kayıt: dokunulmayan alan kaynağını korur, boşaltılan panelden silinir, boş secret kayıtlı olanı korur", () => {
  const panel = { companyId: "999" };
  const before = resolveParasutSettings(panel, ENV);
  // Hiçbir şey değişmedi: ortamdan gelenler panele kopyalanmaz
  const same = planParasutSettings(panel, ENV, form(before), { hasParasutInvoices: true });
  assert.ok(same.ok);
  assert.deepEqual(same.next, panel);
  assert.deepEqual(same.changed, []);
  assert.equal(same.forgetSession || same.resetCursor, false);

  // İlk eşitleme başlangıcı değişir: yalnız o panele yazılır, oturum ve imleç kalır
  const from = planParasutSettings(panel, ENV, form(before, { syncFrom: "2026-03-01" }), { hasParasutInvoices: true });
  assert.ok(from.ok);
  assert.deepEqual(from.next, { companyId: "999", syncFrom: "2026-03-01" });
  assert.deepEqual(from.changed, ["syncFrom"]);
  assert.equal(from.forgetSession || from.resetCursor, false);

  // Panel değerini boşaltmak ortama döndürür (fatura olmayan kurulumda firma değişir: imleç sıfırlanır)
  const cleared = planParasutSettings(panel, ENV, form(before, { companyId: "" }), { hasParasutInvoices: false });
  assert.ok(cleared.ok);
  assert.deepEqual(cleared.next, {});
  assert.deepEqual(cleared.after.companyId, { value: "424242", source: "env" });
  assert.equal(cleared.resetCursor, true);

  // Panelde kayıtlı secret, boş bırakılınca kalır
  const keep = planParasutSettings({ clientSecret: "panel-sir" }, ENV, form(resolveParasutSettings({ clientSecret: "panel-sir" }, ENV)), { hasParasutInvoices: true });
  assert.ok(keep.ok);
  assert.equal(keep.next.clientSecret, "panel-sir");
  assert.equal(keep.forgetSession, false);
});

test("kayıt: client_id ya da client_secret değişince oturum silinir; client_id yeni secret'sız değişmez", () => {
  const before = resolveParasutSettings({}, ENV);
  const both = planParasutSettings({}, ENV, form(before, { clientId: "yeni-istemci", clientSecret: "yeni-sir" }), { hasParasutInvoices: true });
  assert.ok(both.ok);
  assert.deepEqual(both.next, { clientId: "yeni-istemci", clientSecret: "yeni-sir" });
  assert.deepEqual(both.changed, ["clientId", "clientSecret"]);
  assert.equal(both.forgetSession, true);
  assert.equal(both.resetCursor, false);

  // Yalnız secret yenilendi (DevHub'da yeniden üretildi): eski oturum da düşer
  const secret = planParasutSettings({}, ENV, form(before, { clientSecret: "yeni-sir" }), { hasParasutInvoices: true });
  assert.ok(secret.ok);
  assert.equal(secret.forgetSession, true);

  // Aynı secret yeniden yazıldı: değer değişmedi, oturum kalır; yalnız kaynağı panele geçer
  const sameSecret = planParasutSettings({}, ENV, form(before, { clientSecret: "vercel-sir" }), { hasParasutInvoices: true });
  assert.ok(sameSecret.ok);
  assert.equal(sameSecret.forgetSession, false);
  assert.deepEqual(sameSecret.moved, ["clientSecret"]);

  // client_id değişti, secret girilmedi: kalan secret önceki istemcinin, reddedilir
  const noSecret = planParasutSettings({}, ENV, form(before, { clientId: "yeni-istemci" }), { hasParasutInvoices: false });
  assert.equal(noSecret.ok, false);
  assert.match(!noSecret.ok ? noSecret.error : "", /Client Secret'ını da girin/);
  // Hiç secret yokken (yeni kurulum) client_id tek başına girilebilir
  assert.equal(planParasutSettings({}, {}, form(resolveParasutSettings({}, {}), { clientId: "ilk" }), { hasParasutInvoices: false }).ok, true);
});

test("kayıt: Paraşüt'ten fatura gelmişse firma numarası değişmez; gelmemişse değişir ve imleç sıfırlanır", () => {
  const before = resolveParasutSettings({}, ENV);
  const blocked = planParasutSettings({}, ENV, form(before, { companyId: "111111" }), { hasParasutInvoices: true });
  assert.deepEqual(blocked, { ok: false, error: COMPANY_LOCKED_TEXT });
  assert.match(COMPANY_LOCKED_TEXT, /eski firmanın faturalarını Paraşüt'te silinmiş sayıp panelden kaldırır/);
  // Boşaltmak da değişikliktir
  assert.equal(planParasutSettings({ companyId: "111111" }, ENV, form(resolveParasutSettings({ companyId: "111111" }, ENV), { companyId: "" }), { hasParasutInvoices: true }).ok, false);

  // Yeni kurulum (Paraşüt faturası yok): değişir, imleç sıfırlanır, oturum kalır
  const fresh = planParasutSettings({}, ENV, form(before, { companyId: "111111" }), { hasParasutInvoices: false });
  assert.ok(fresh.ok);
  assert.equal(fresh.resetCursor, true);
  assert.equal(fresh.forgetSession, false);
  assert.match(settingsLogText(fresh), /Firma numarası 424242 → 111111 · eşitleme imleci sıfırlandı/);

  // Firma hiç yoksa ilk kez yazılması serbest (yedekten dönen kurulumda ayar panelde değil, yeniden girilir)
  const none = resolveParasutSettings({}, { PARASUT_CLIENT_ID: "a", PARASUT_CLIENT_SECRET: "b" });
  const first = planParasutSettings({}, { PARASUT_CLIENT_ID: "a", PARASUT_CLIENT_SECRET: "b" }, form(none, { companyId: "424242" }), { hasParasutInvoices: true });
  assert.ok(first.ok);
});

test("client_secret ekrana ve işlem geçmişine gitmez: görünümde yalnız kaynağı, özette yalnız değiştiği", () => {
  const panelSecret = "panel-COK-GIZLI-sir";
  const r = resolveParasutSettings({ clientSecret: panelSecret }, ENV);
  const view = settingsView(r, { secretUnreadable: false, hasParasutInvoices: true });
  const json = JSON.stringify(view);
  assert.equal(json.includes(panelSecret), false);
  assert.equal(json.includes(ENV.PARASUT_CLIENT_SECRET), false);
  assert.deepEqual(view.clientSecret, { source: "panel" });
  assert.equal(view.companyLocked, true);
  assert.equal(settingsView(resolveParasutSettings({}, {}), { secretUnreadable: false, hasParasutInvoices: true }).companyLocked, false, "firma yokken kilit yok");
  // Ortamdaki secret da görünmez
  assert.equal(JSON.stringify(settingsView(resolveParasutSettings({}, ENV), { secretUnreadable: false, hasParasutInvoices: false })).includes("vercel-sir"), false);

  const plan = planParasutSettings({}, ENV, form(resolveParasutSettings({}, ENV), { clientId: "yeni", clientSecret: panelSecret }), { hasParasutInvoices: true });
  assert.ok(plan.ok);
  const log = settingsLogText(plan);
  assert.equal(log, "Client ID değişti · Client Secret değişti · kayıtlı Paraşüt oturumu silindi, hesap yeniden bağlanmalı");
  assert.equal(log.includes(panelSecret), false);
});

test("kaynak: ekran secret'ın değerini almaz; eylem yönetici ister; ayarlar şifreli ve yedeğe girmez", () => {
  const page = read("src/app/panel/parasut/page.tsx");
  // Sayfa istemci bileşenine yalnız görünümü verir (settingsView), çözülmüş ayarları değil
  assert.match(page, /settings=\{settingsView\(settings\.resolved, \{/);
  assert.doesNotMatch(page, /settings=\{settings\.resolved\}|clientSecret\.value/);
  for (const f of ["src/app/panel/parasut/parasut-client.tsx", "src/app/panel/parasut/connection-card.tsx"]) {
    assert.doesNotMatch(read(f), /clientSecret\.value/, f);
  }
  // Secret alanı parola türünde, tarayıcı doldurmaz; ekranda dönüş adresi https:// olmadan kopyalanır
  const card = read("src/app/panel/parasut/connection-card.tsx");
  // Parola kutusu (ui/password-input): gizliyken type="password", değeri DOM'a yazmaz
  assert.match(card, /<PasswordInput\s+id="ps-client-secret"[\s\S]{0,300}autoComplete="new-password"/);
  assert.match(card, /redirectUri\.replace\(\/\^https:\\\/\\\/\/, ""\)/);

  const actions = read("src/server/actions/parasut.ts");
  const save = actions.slice(actions.indexOf("export async function saveParasutSettings"), actions.indexOf("// ---------------------------------------------------------------- kategori kuralları"));
  assert.match(save, /const me = await requireAdmin\(\);/);
  assert.match(save, /parasutSettingsInput\.parse\(input\)/);
  assert.match(save, /await parasutSyncRunning\(\)/, "istemci ya da firma eşitleme sürerken değişmez");
  // Şube başına Paraşüt hesabı: oturum, bağlanma isteği ve eşitleme durumu yalnız bu hesabınki
  assert.match(save, /forgetParasutToken\(account, tx\);\s*await forgetParasutConnect\(account, tx\);/);
  assert.match(save, /inArray\(s\.integrationState\.key, parasutStateKeys\(account\)\)/);
  assert.match(save, /logActivity\(me, "Paraşüt bağlantı ayarları", `\$\{await accountLabel\(account\)\}\$\{detail/);

  const cfg = read("src/server/parasut/config.ts");
  assert.match(cfg, /const SETTINGS_KEY = "parasut\.settings";/);
  assert.match(cfg, /seal\(v, "parasut-settings"\)/);
  assert.match(cfg, /open\(v\.clientSecret, "parasut-settings"\)/);
  assert.match(read("src/server/secret-box.ts"), /"parasut-settings"/);
  assert.match(read("src/lib/backup/format.ts"), /"parasut\.settings": "Paraşüt bağlantı ayarları/);
});

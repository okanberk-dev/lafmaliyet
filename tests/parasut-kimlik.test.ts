// Paraşüt kimlik doğrulaması (docs/PARASUT.md): Authorization Code + PKCE kuralları — doğrulayıcı ve S256 sınaması
// RFC 7636'ya uyar, keşif belgesi yalnız https ve aynı alan adındaki uçları kabul eder, yetki adresi state ve PKCE
// taşır. Ayrıca kaynak taraması: grant_type=password yeni yolun dosyalarında yok (yalnız geçici yedekte), parola ortam
// değişkeni zorunlu değil, dönüşte state karşılaştırılıyor ve bekleyen istek tek kullanımlık.
// Geçici yedek (10 Aralık 2026'ya kadar eski parola yöntemi, src/lib/parasut/legacy.ts): yol seçimi, son tarih, eski
// ucun retlerinin Türkçe metni ve gövdesi. Veritabanında iki yol ve geçiş: tests/parasut-esitleme-db.test.ts.
// Çalıştırma: npx tsx --test tests/parasut-kimlik.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  chooseParasutAuth,
  LEGACY_CLOSED_TEXT,
  LEGACY_DEADLINE_DAY,
  legacyGrantBody,
  legacyRejectionText,
  legacyStatus,
  legacyTokenUrl,
  PARASUT_LEGACY,
} from "../src/lib/parasut/legacy";
import { authorizeRequestUrl, challengeOf, createState, createVerifier, endpointUrl, readDiscovery, sameSite, sameToken } from "../src/lib/parasut/oidc";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const ISSUER = "https://id.parasut.com";

// ---------------------------------------------------------------- PKCE

test("PKCE: doğrulayıcı 43 karakter ve base64url; S256 sınaması RFC 7636 örneğiyle aynı", () => {
  const v = createVerifier();
  assert.equal(v.length, 43);
  assert.match(v, /^[A-Za-z0-9_-]{43}$/, "dolgu (=) ve base64url dışı karakter yok");
  assert.notEqual(createVerifier(), createVerifier(), "her çağrı yeni doğrulayıcı");
  assert.match(createState(), /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(createState(), createState());
  // RFC 7636 Appendix B'deki örnek
  assert.equal(challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  // Sınama doğrulayıcıyı sızdırmaz ve kararlıdır
  assert.equal(challengeOf(v), challengeOf(v));
  assert.notEqual(challengeOf(v), v);
});

test("state karşılaştırması: eşit olanı kabul eder, uzunluğu farklı olanda patlamaz", () => {
  const s = createState();
  assert.equal(sameToken(s, s), true);
  assert.equal(sameToken(s, createState()), false);
  assert.equal(sameToken(s, ""), false);
  assert.equal(sameToken("", ""), true);
  assert.equal(sameToken(s, s.slice(0, 10)), false);
});

// ---------------------------------------------------------------- Keşif belgesi

test("aynı alan adı: id/api.parasut.com aynı yer, başkası değil", () => {
  assert.equal(sameSite("id.parasut.com", "id.parasut.com"), true);
  assert.equal(sameSite("api.parasut.com", "id.parasut.com"), true);
  assert.equal(sameSite("ID.Parasut.COM", "id.parasut.com"), true);
  assert.equal(sameSite("parasut.com.saldirgan.net", "id.parasut.com"), false);
  assert.equal(sameSite("parasut.evil.com", "id.parasut.com"), false);
});

test("keşif belgesi: uçlar okunur; https olmayan, başka alan adındaki ve eksik uç reddedilir", () => {
  const ok = readDiscovery(
    { issuer: ISSUER, authorization_endpoint: `${ISSUER}/oauth/authorize`, token_endpoint: `${ISSUER}/oauth/token` },
    ISSUER,
  );
  assert.equal(ok.issuer, ISSUER);
  assert.equal(ok.authorizeUrl, `${ISSUER}/oauth/authorize`);
  assert.equal(ok.tokenUrl, `${ISSUER}/oauth/token`);

  // Belirteç ucu api.parasut.com'da olabilir (aynı alan adı)
  const split = readDiscovery({ authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: "https://api.parasut.com/oauth/token" }, ISSUER);
  assert.equal(split.tokenUrl, "https://api.parasut.com/oauth/token");
  // issuer belgede yoksa sorduğumuz adres kalır
  assert.equal(split.issuer, ISSUER);

  assert.throws(() => readDiscovery({ authorization_endpoint: `${ISSUER}/authorize` }, ISSUER), /token_endpoint yok/);
  assert.throws(() => readDiscovery({ token_endpoint: `${ISSUER}/token` }, ISSUER), /authorization_endpoint yok/);
  assert.throws(() => readDiscovery({ authorization_endpoint: "http://id.parasut.com/a", token_endpoint: `${ISSUER}/t` }, ISSUER), /https değil/);
  assert.throws(() => readDiscovery({ authorization_endpoint: "https://kotu.example/a", token_endpoint: `${ISSUER}/t` }, ISSUER), /başka bir alan adına/);
  assert.throws(() => readDiscovery({}, ISSUER), /yok/);
  assert.throws(() => readDiscovery(null, ISSUER), /yok/);
  assert.throws(() => endpointUrl("token_endpoint", "https://kullanici:parola@id.parasut.com/t", "id.parasut.com"), /kullanıcı bilgisi/);
  assert.throws(() => endpointUrl("token_endpoint", "bu bir adres değil", "id.parasut.com"), /okunamadı/);
});

// ---------------------------------------------------------------- Yetki adresi

test("yetki adresi: response_type=code, PKCE S256, state ve scope taşır; adresin kendi sorgusu korunur", () => {
  const verifier = createVerifier();
  const state = createState();
  const url = new URL(
    authorizeRequestUrl({
      authorizeUrl: `${ISSUER}/oauth/authorize?kiracı=laf`,
      clientId: "istemci-1",
      redirectUri: "https://ladmin.laffogato.net/panel/parasut/baglan/geri",
      scope: "openid",
      state,
      challenge: challengeOf(verifier),
    }),
  );
  assert.equal(url.origin + url.pathname, `${ISSUER}/oauth/authorize`);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "istemci-1");
  assert.equal(url.searchParams.get("redirect_uri"), "https://ladmin.laffogato.net/panel/parasut/baglan/geri");
  assert.equal(url.searchParams.get("scope"), "openid");
  assert.equal(url.searchParams.get("state"), state);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), challengeOf(verifier));
  // Doğrulayıcının kendisi tarayıcıya hiç gitmez
  assert.equal(url.href.includes(verifier), false);
  assert.equal(url.searchParams.get("kiracı"), "laf");
});

// ---------------------------------------------------------------- Kaynak taraması

test("grant_type=password ve parola ortam değişkeni kodda kalmadı", () => {
  for (const f of ["src/server/parasut/client.ts", "src/server/parasut/config.ts", "src/server/parasut/connect.ts"]) {
    const text = read(f);
    assert.doesNotMatch(text, /grant_type: "password"/, f);
    assert.doesNotMatch(text, /PARASUT_PASSWORD|PARASUT_USERNAME/, f);
  }
  const cfg = read("src/server/parasut/config.ts");
  // Kurulumun zorunlu değişkenleri: istemci bilgileri ve firma; kullanıcı/parola değil
  assert.match(cfg, /export const PARASUT_ENV = \["PARASUT_CLIENT_ID", "PARASUT_CLIENT_SECRET", "PARASUT_COMPANY_ID"\] as const;/);
  assert.match(read("src/server/parasut/client.ts"), /grant_type: "refresh_token"/);
  assert.match(read("src/server/parasut/connect.ts"), /grant_type: "authorization_code"/);
  // Örnek ortam dosyası ve belge de parolayı istemiyor
  assert.doesNotMatch(read(".env.example"), /PARASUT_PASSWORD|PARASUT_USERNAME/);
});

test("bağlanma akışı: state doğrulanır, bekleyen istek tek kullanımlık, sunucu modülleri server-only", () => {
  const connect = read("src/server/parasut/connect.ts");
  assert.match(connect, /sameToken\(input\.state, pending\.state\)/, "state karşılaştırılıyor");
  assert.match(connect, /code_verifier: pending\.verifier/, "PKCE doğrulayıcısı kod değişiminde gidiyor");
  // Bekleyen istek okunurken siliniyor: aynı state ile ikinci dönüş kabul edilmez
  assert.match(connect, /delete\(s\.integrationState\)[\s\S]{0,120}PENDING_KEY/);
  for (const f of ["src/server/parasut/oidc.ts", "src/server/parasut/connect.ts", "src/server/parasut/config.ts", "src/server/parasut/client.ts"]) {
    assert.match(read(f), /^import "server-only";/, f);
  }
  // Saf kurallar server-only değil: testten doğrudan çağrılıyor
  assert.doesNotMatch(read("src/lib/parasut/oidc.ts"), /import "server-only"/);
});

test("dönüş adresi DevHub'a kaydedilen yolla aynı ve rota o yolda duruyor", () => {
  assert.match(read("src/server/parasut/config.ts"), /PARASUT_CALLBACK_PATH = "\/panel\/parasut\/baglan\/geri"/);
  const back = read("src/app/panel/parasut/baglan/geri/route.ts");
  assert.match(back, /finishParasutConnect/);
  // Yalnız yönetici: personel ve oturumsuz istek kod değişimine giremez
  assert.match(back, /user\.role !== "admin"/);
  assert.match(read("src/app/panel/parasut/baglan/route.ts"), /user\.role !== "admin"/);
});

// ---------------------------------------------------------------- Geçici yedek: eski parola yöntemi

test("yol seçimi: kayıtlı yeni oturum her zaman önce; yoksa son tarihe kadar eski yöntem, sonra açık hata", () => {
  const before = Date.parse("2026-11-21T09:00:00+03:00");
  // Yeni oturum varsa eski ayarlar dururken de, son tarihten sonra da yalnız yeni yöntem
  assert.equal(chooseParasutAuth({ oidcSession: true, legacyConfigured: true, now: before }), "oidc");
  assert.equal(chooseParasutAuth({ oidcSession: true, legacyConfigured: true, now: PARASUT_LEGACY.endsAt + 1 }), "oidc");
  assert.equal(chooseParasutAuth({ oidcSession: true, legacyConfigured: false, now: before }), "oidc");
  // Yeni oturum yok: eski kullanıcı adı/parola varsa geçici yedek, yoksa bağlanmalı
  assert.equal(chooseParasutAuth({ oidcSession: false, legacyConfigured: true, now: before }), "legacy");
  assert.equal(chooseParasutAuth({ oidcSession: false, legacyConfigured: false, now: before }), "none");
  assert.equal(chooseParasutAuth({ oidcSession: false, legacyConfigured: false, now: PARASUT_LEGACY.endsAt + 1 }), "none");
});

test("son tarih: 10 Aralık 2026 00:00 İstanbul; o andan itibaren eski yöntem denenmez", () => {
  assert.equal(LEGACY_DEADLINE_DAY, "2026-12-10");
  assert.equal(new Date(PARASUT_LEGACY.endsAt).toISOString(), "2026-12-09T21:00:00.000Z");
  const at = (iso: string) => chooseParasutAuth({ oidcSession: false, legacyConfigured: true, now: Date.parse(iso) });
  assert.equal(at("2026-12-09T23:59:59+03:00"), "legacy", "9 Aralık gece yarısına kadar çalışır");
  assert.equal(at("2026-12-10T00:00:00+03:00"), "legacy-closed");
  assert.equal(at("2027-01-05T08:00:00+03:00"), "legacy-closed");
  // Panelin uyarısı aynı kuraldan
  assert.equal(legacyStatus({ connected: false, legacyConfigured: true, now: Date.parse("2026-12-01T07:30:00+03:00") }), "active");
  assert.equal(legacyStatus({ connected: false, legacyConfigured: true, now: Date.parse("2026-12-10T07:30:00+03:00") }), "closed");
  assert.equal(legacyStatus({ connected: true, legacyConfigured: true, now: Date.parse("2026-12-01T07:30:00+03:00") }), null, "bağlıyken eski yöntem uyarısı yok");
  assert.equal(legacyStatus({ connected: false, legacyConfigured: false, now: Date.parse("2026-12-01T07:30:00+03:00") }), null);
  assert.match(LEGACY_CLOSED_TEXT, /10 Aralık 2026'da kapattı/);
  assert.match(LEGACY_CLOSED_TEXT, /“Paraşüt hesabını bağla” ile yeniden bağlayın\.$/);
});

test("eski ucun retleri: yöntem kapandı, istemci ya da parola reddedildi — hepsinde Türkçe “yeniden bağlayın”", () => {
  const closed = legacyRejectionText(400, JSON.stringify({ error: "unsupported_grant_type" }));
  assert.match(closed, /^Paraşüt eski kullanıcı adı ve parola yöntemini artık kabul etmiyor \(unsupported_grant_type\)\./);
  assert.match(closed, /yeniden bağlayın\.$/);
  // 401: istemci reddedildi (Vercel'de artık DevHub'ın client_id'si var ya da eski istemci kapandı)
  const unauthorized = legacyRejectionText(401, JSON.stringify({ error: "invalid_client", error_description: "Client authentication failed" }));
  assert.match(unauthorized, /artık kabul etmiyor \(Client authentication failed\)/);
  assert.match(legacyRejectionText(401, "<html>kapalı</html>"), /^Paraşüt eski kullanıcı adı ve parola yöntemini artık kabul etmiyor\. /);
  assert.match(legacyRejectionText(400, JSON.stringify({ error: "unauthorized_client" })), /artık kabul etmiyor/);
  // Parola kabul edilmedi
  const grant = legacyRejectionText(400, JSON.stringify({ error: "invalid_grant" }));
  assert.match(grant, /parola değişmiş olabilir/);
  assert.match(grant, /10 Aralık 2026'da zaten kapanıyor/);
  // Bilinmeyen ret: HTTP kodu söylenir
  assert.match(legacyRejectionText(403, JSON.stringify({ error: "access_denied" })), /\(HTTP 403, access_denied\)/);
  for (const text of [closed, unauthorized, grant, legacyRejectionText(400, "")]) assert.match(text, /“Paraşüt hesabını bağla” ile yeniden bağlayın\.$/);
});

test("eski uca giden gövde: refresh_token varsa parola gitmez; yoksa kullanıcı adı ve parolayla giriş", () => {
  const c = { clientId: "eski-istemci", clientSecret: "sir", username: "api@kafe.test", password: "p@rola&=", baseUrl: "https://api.parasut.com/" };
  assert.equal(legacyTokenUrl(c.baseUrl), "https://api.parasut.com/oauth/token");
  const refresh = legacyGrantBody(c, "r-1");
  assert.equal(refresh.get("grant_type"), "refresh_token");
  assert.equal(refresh.get("refresh_token"), "r-1");
  assert.equal(refresh.has("password"), false, "yenilemede parola gönderilmez");
  assert.equal(refresh.get("client_id"), "eski-istemci");
  const login = legacyGrantBody(c, null);
  assert.equal(login.get("grant_type"), "password");
  assert.equal(login.get("username"), "api@kafe.test");
  assert.equal(login.get("password"), "p@rola&=", "özel karakterli parola bozulmaz");
  assert.equal(login.get("redirect_uri"), "urn:ietf:wg:oauth:2.0:oob");
});

test("geçici yedek kaynakta yalıtık: parola akışı yalnız iki legacy dosyasında, yeni oturumdan ayrı anahtarda", () => {
  // Parola ile giriş yalnız saf kurallarda; ortam değişkenleri yalnız sunucu tarafındaki legacy.ts'te
  assert.match(read("src/lib/parasut/legacy.ts"), /grant_type: "password"/);
  assert.doesNotMatch(read("src/lib/parasut/legacy.ts"), /process\.env/);
  assert.match(read("src/server/parasut/legacy.ts"), /PARASUT_USERNAME/);
  assert.match(read("src/server/parasut/legacy.ts"), /^import "server-only";/);
  const client = read("src/server/parasut/client.ts");
  // Yol, kayıtlı yeni oturum (refresh_token) varlığına ve son tarihe bakan tek kuraldan seçilir
  assert.match(client, /chooseParasutAuth\(\{ oidcSession: Boolean\(stored\?\.refresh\)/);
  assert.match(client, /LEGACY_CLOSED_TEXT/);
  // Eski belirteç yeni oturumun anahtarına yazılmaz (bağlanınca ezilmesin, ezmesin)
  assert.match(client, /const LEGACY_TOKEN_KEY = "parasut\.legacyToken";/);
  assert.match(client, /writeToken\(t, db, LEGACY_TOKEN_KEY\)/);
  // Hesap bağlanınca eski belirteç silinir
  assert.match(read("src/server/parasut/connect.ts"), /await forgetLegacyParasutToken\(\);/);
});

// ---------------------------------------------------------------- varsayılan ayarlar (config.ts "server-only" olduğu için kaynaktan)

test("varsayılan yayıncı Paraşüt'ün Keycloak alanı; kök adreste keşif belgesi yok (404)", () => {
  const cfg = read("src/server/parasut/config.ts");
  assert.match(cfg, /DEFAULT_ISSUER = "https:\/\/id\.parasut\.com\/realms\/parasut";/);
  assert.match(cfg, /issuer: https\("PARASUT_ISSUER"\) \?\? DEFAULT_ISSUER/);
  // 22 Kasım 2026'da canlı keşif belgesinden alınan uçlar: aynı alan adında, kabul edilir
  const realm = "https://id.parasut.com/realms/parasut";
  const live = readDiscovery(
    {
      issuer: realm,
      authorization_endpoint: `${realm}/protocol/openid-connect/auth`,
      token_endpoint: `${realm}/protocol/openid-connect/token`,
    },
    realm,
  );
  assert.equal(live.issuer, realm);
  assert.equal(live.tokenUrl, `${realm}/protocol/openid-connect/token`);
});

test("varsayılan izinler offline_access içerir; client_secret iki yöntemde de kırpılır", () => {
  const cfg = read("src/server/parasut/config.ts");
  assert.match(cfg, /DEFAULT_SCOPE = "openid offline_access";/);
  assert.match(cfg, /PARASUT_SCOPE\?\.trim\(\) \|\| DEFAULT_SCOPE/);
  assert.match(cfg, /clientSecret: process\.env\.PARASUT_CLIENT_SECRET!\.trim\(\)/);
  assert.match(read("src/server/parasut/legacy.ts"), /clientSecret: cfg\.clientSecret\.trim\(\)/);
});

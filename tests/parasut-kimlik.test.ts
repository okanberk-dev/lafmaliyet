// Paraşüt kimlik doğrulaması (docs/PARASUT.md): Authorization Code + PKCE kuralları — doğrulayıcı ve S256 sınaması
// RFC 7636'ya uyar, keşif belgesi yalnız https ve aynı alan adındaki uçları kabul eder, yetki adresi state ve PKCE
// taşır. Ayrıca kaynak taraması: eski parola yönteminden (grant_type=password, PARASUT_USERNAME / PARASUT_PASSWORD,
// geçici yedek ve 10 Aralık uyarıları) hiçbir şey kalmadı, dönüşte state karşılaştırılıyor ve bekleyen istek tek
// kullanımlık. Veritabanında oturum yolları: tests/parasut-esitleme-db.test.ts.
// Çalıştırma: npx tsx --test tests/parasut-kimlik.test.ts

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  authorizeRequestUrl,
  challengeOf,
  createState,
  createVerifier,
  endpointUrl,
  keycloakEndpoints,
  readDiscovery,
  sameSite,
  sameToken,
} from "../src/lib/parasut/oidc";

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

/** Paraşüt'e dokunan kaynak dosyaları: sunucu, saf kurallar, ekran, işler, zil, yedek ve örnek ortam dosyası */
function parasutSources(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(join(root, dir)).flatMap((n) => {
      const p = `${dir}/${n}`;
      return statSync(join(root, p)).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
    });
  return [
    ...walk("src/server/parasut"),
    ...walk("src/lib/parasut"),
    ...walk("src/app/panel/parasut"),
    "src/server/actions/parasut.ts",
    "src/server/jobs/alerts.ts",
    "src/lib/job-health.ts",
    "src/lib/backup/format.ts",
    "src/app/panel/system-banner.tsx",
    ".env.example",
  ];
}

test("eski parola yönteminden iz kalmadı: geçici yedek, 10 Aralık uyarıları ve PARASUT_USERNAME / PARASUT_PASSWORD", () => {
  assert.equal(existsSync(join(root, "src/lib/parasut/legacy.ts")), false);
  assert.equal(existsSync(join(root, "src/server/parasut/legacy.ts")), false);
  const files = parasutSources();
  assert.ok(files.length > 20, "tarama dosya bulamadı");
  const bad: string[] = [];
  for (const f of files) {
    const text = read(f);
    for (const re of [/legacy/i, /PARASUT_USERNAME|PARASUT_PASSWORD/, /10 Aralık/, /parasutMigrationAlert/, /grant_type: "password"/, /Eski yöntem/, /artık gerekmiyor/]) {
      if (re.test(text)) bad.push(`${f}: ${re}`);
    }
  }
  assert.deepEqual(bad, []);
  const cfg = read("src/server/parasut/config.ts");
  // Kurulumun zorunlu değişkenleri: istemci bilgileri ve firma; kullanıcı/parola değil
  assert.match(cfg, /export const PARASUT_ENV = \["PARASUT_CLIENT_ID", "PARASUT_CLIENT_SECRET", "PARASUT_COMPANY_ID"\] as const;/);
  assert.match(read("src/server/parasut/client.ts"), /grant_type: "refresh_token"/);
  assert.match(read("src/server/parasut/connect.ts"), /grant_type: "authorization_code"/);
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
  // Keşif belgesi okunamazsa dönülen standart uçlar canlı belgedekilerle birebir aynı
  assert.deepEqual(keycloakEndpoints(realm), live);
});

test("keşif belgesi engellenirse Keycloak'ın standart uçları; yalnız https Keycloak alanında", () => {
  const realm = "https://id.parasut.com/realms/parasut";
  const std = keycloakEndpoints(realm);
  assert.equal(std?.authorizeUrl, `${realm}/protocol/openid-connect/auth`);
  assert.equal(std?.tokenUrl, `${realm}/protocol/openid-connect/token`);
  // Sondaki eğik çizgi çift yazılmaz
  assert.deepEqual(keycloakEndpoints(`${realm}/`), std);
  // Keycloak alanı olmayan, https olmayan ya da süslü adreste tahmin yürütülmez: keşif hatası gösterilir
  assert.equal(keycloakEndpoints("https://id.parasut.com"), null);
  assert.equal(keycloakEndpoints("https://id.parasut.com/realms/parasut/protocol"), null);
  assert.equal(keycloakEndpoints("http://id.parasut.com/realms/parasut"), null);
  assert.equal(keycloakEndpoints("https://k:p@id.parasut.com/realms/parasut"), null);
  assert.equal(keycloakEndpoints("https://id.parasut.com/realms/parasut?x=1"), null);
  assert.equal(keycloakEndpoints("adres değil"), null);
  // Sunucu tarafı: keşif hatasında standart uçlara döner; elle verilen iki adres varsa keşif hiç denenmez
  const server = read("src/server/parasut/oidc.ts");
  assert.match(server, /catch \(e\) \{\s*const standard = keycloakEndpoints\(cfg\.issuer\);\s*if \(!standard\) throw e;/);
  assert.match(server, /if \(cfg\.authorizeUrl && cfg\.tokenUrl\) return/);
});

test("varsayılan izinler offline_access içerir; client_secret kırpılır", () => {
  const cfg = read("src/server/parasut/config.ts");
  assert.match(cfg, /DEFAULT_SCOPE = "openid offline_access";/);
  assert.match(cfg, /PARASUT_SCOPE\?\.trim\(\) \|\| DEFAULT_SCOPE/);
  assert.match(cfg, /clientSecret: process\.env\.PARASUT_CLIENT_SECRET!\.trim\(\)/);
});

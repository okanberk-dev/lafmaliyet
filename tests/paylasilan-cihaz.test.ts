// Paylaşılan cihazda oturum ve canlı veri (denetim 13 Kasım 2026, P01): oturum düşünce canlı veri silinir, depo
// kullanıcıya bağlıdır ve yeni oturumda yeniden ister (KA-01); `/giris?oturum=bitti` yalnız sunucunun reddettiği çerezi
// siler, yeni ya da geçerli oturumu silemez (KA-02, YO-04); oturum çerezi çıkışta kapatılabilsin diye kimlik taşır
// (YO-02; veritabanı tarafı tests/oturum-kapatma-db.test.ts).
// Çalıştırma: npx tsx --test tests/paylasilan-cihaz.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, test } from "node:test";

import { decodeJwt, SignJWT } from "jose";
import { NextRequest } from "next/server";

import { bindLive, getLive, refreshLive, resetLive } from "../src/components/panel/live/store";
import type { LiveResponse } from "../src/lib/live";
import { proxy } from "../src/proxy";
import { expiredLoginQuery, SESSION_COOKIE, sessionMark, signSession, verifySession } from "../src/server/auth/session";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
/** session.ts'nin geliştirme anahtarı (AUTH_SECRET yokken) */
const DEV_KEY = new TextEncoder().encode(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32 ? process.env.AUTH_SECRET : "gelistirme-icin-guvensiz-anahtar-degistirin-lutfen");

const staffToken = () => signSession({ sub: "7", name: "Ayşe", role: "staff", sv: 1 });
const login = (query: string, token?: string) =>
  new NextRequest(`http://localhost:3000/giris${query}`, { headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {} });
/** Yanıt oturum çerezini siliyor mu */
const deletes = (res: Response) => (res.headers.get("set-cookie") ?? "").includes(`${SESSION_COOKIE}=;`);

describe("oturum bitti: proxy yalnız reddedilen çerezi siler", () => {
  test("geçerli oturum + özetsiz ?oturum=bitti (başka siteden bağlantı): çerez silinmez, ana sayfaya", async () => {
    const res = await proxy(login("?oturum=bitti", await staffToken()));
    assert.equal(deletes(res), false, "dışarıdan çıkış yaptırılamaz (YO-04)");
    assert.equal(res.status, 307);
    assert.equal(new URL(res.headers.get("location")!).pathname, "/panel/bugun");
  });

  test("yeniden girişten sonra eski yönlendirme (Geri, önbellek): eski çerezin özeti yeni oturumu silmez", async () => {
    const old = await staffToken();
    const fresh = await staffToken();
    assert.notEqual(old, fresh);
    const res = await proxy(login(`?${await expiredLoginQuery(old)}`, fresh));
    assert.equal(deletes(res), false, "yeni oturum kalır (KA-02)");
    assert.equal(res.status, 307);
    assert.equal(new URL(res.headers.get("location")!).pathname, "/panel/bugun");
  });

  test("sunucunun reddettiği çerez (özet tutuyor): silinir, giriş sayfası açılır", async () => {
    const stale = await staffToken();
    const res = await proxy(login(`?${await expiredLoginQuery(stale)}`, stale));
    assert.equal(res.status, 200);
    assert.ok(deletes(res), "bayat çerez silinir; yoksa /giris ↔ /panel döngüsü");
    assert.match(res.headers.get("set-cookie")!, /Max-Age=0/);
    // Girişten sonra dönülecek adres (Claude bağlantısı) özetle birlikte durur
    const withNext = await proxy(login(`?${await expiredLoginQuery(stale)}&next=%2Fbaglan%3Fistek%3Dx`, stale));
    assert.ok(deletes(withNext));
  });

  test("imzası bozuk çerez de özetiyle silinir; çerez yoksa ya da özet yanlışsa giriş sayfası bir şey silmeden açılır", async () => {
    const broken = `${await staffToken()}x`;
    assert.equal(await verifySession(broken), null);
    assert.ok(deletes(await proxy(login(`?${await expiredLoginQuery(broken)}`, broken))));
    const none = await proxy(login("?oturum=bitti"));
    assert.equal(none.status, 200);
    assert.equal(deletes(none), false);
    const wrong = await proxy(login("?oturum=bitti&s=0000000000000000", broken));
    assert.equal(wrong.status, 200);
    assert.equal(deletes(wrong), false);
  });

  test("özet: çerezden kısa, sabit, çereze göre değişir; sunucu yönlendirmesi ve Claude onay ekranı özetle gider", async () => {
    const t = await staffToken();
    const mark = await sessionMark(t);
    assert.match(mark, /^[0-9a-f]{16}$/);
    assert.equal(await sessionMark(t), mark);
    assert.notEqual(await sessionMark(await staffToken()), mark);
    assert.equal(await expiredLoginQuery(t), `oturum=bitti&s=${mark}`);
    const dal = read("src/server/auth/dal.ts");
    assert.match(dal, /redirect\(token \? `\/giris\?\$\{await expiredLoginQuery\(token\)\}` : "\/giris"\)/);
    assert.doesNotMatch(dal, /"\/giris\?oturum=bitti"/);
    const baglan = read("src/app/baglan/page.tsx");
    assert.match(baglan, /await expiredLoginQuery\(stale\)/);
    assert.doesNotMatch(baglan, /"oturum=bitti&"/);
  });
});

test("oturum çerezi her girişte rastgele bir kimlik taşır (çıkışta yalnız o oturum kapanır); kimliksiz eski çerez hâlâ okunur", async () => {
  const a = decodeJwt(await staffToken());
  const b = decodeJwt(await staffToken());
  assert.equal(typeof a.jti, "string");
  assert.notEqual(a.jti, b.jti);
  const legacy = await new SignJWT({ name: "Ayşe", role: "staff", sv: 1, typ: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("7")
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(DEV_KEY);
  const v = await verifySession(legacy);
  assert.equal(v?.sub, "7");
  assert.equal(v?.jti, undefined);
});

// ---------------------------------------------------------------- Canlı veri deposu (KA-01)

type Reply = { status: number; body?: unknown; etag?: string };
const calls: { ifNoneMatch: string | null }[] = [];
let replies: (Reply | Promise<Reply>)[] = [];

globalThis.fetch = (async (_url: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  calls.push({ ifNoneMatch: headers.get("if-none-match") });
  const r = await (replies.shift() ?? { status: 500 });
  return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: r.etag ? { ETag: r.etag } : {} });
}) as typeof fetch;

const reminder = (title: string): LiveResponse["reminders"][number] => ({
  id: 1,
  title,
  note: "Maaş avansı 12.500 ₺ öde",
  dueDate: "2026-11-13",
  dueTime: "10:00",
  anchorDate: "2026-11-13",
  repeat: "none",
  sound: "tek",
  createdByName: null,
  active: true,
  doneAt: null,
});
const live = (id: number, role: "admin" | "staff", title = "Yöneticinin notu") =>
  ({
    serverNow: new Date().toISOString(),
    me: { id, role },
    karaoke: { configured: false, sessions: [] },
    orders: { configured: false, list: [], complete: true, skipped: 0, at: null, pulledAt: null, okAt: null, error: null, pingAt: null, changeAt: null },
    reminders: [reminder(title)],
    push: { publicKey: null },
  }) as unknown as LiveResponse;

describe("canlı veri deposu: paylaşılan tablette önceki kişinin verisi kalmaz", () => {
  beforeEach(() => {
    resetLive();
    calls.length = 0;
    replies = [];
  });

  test("401: veri ve ETag silinir, istek durur; sıradaki kişi bağlanınca depo boş başlar ve ETag'siz ister", async () => {
    bindLive(10);
    replies.push({ status: 200, body: live(10, "admin"), etag: 'W/"a"' });
    await refreshLive();
    assert.equal(getLive().data?.reminders[0].title, "Yöneticinin notu");
    replies.push({ status: 401 });
    await refreshLive();
    assert.equal(getLive().data, null, "yöneticinin hatırlatıcısı bellekte kalmaz");
    assert.equal(getLive().signedOut, true);
    await refreshLive();
    assert.equal(calls.length, 2, "oturum düşükken istek atılmaz");
    // Aynı sekmede personel girer: kabuk depoyu yeni kullanıcıya bağlar
    bindLive(18);
    assert.equal(getLive().signedOut, false);
    assert.equal(getLive().data, null);
    replies.push({ status: 200, body: live(18, "staff", "Personelin notu"), etag: 'W/"b"' });
    await refreshLive();
    assert.equal(calls[2].ifNoneMatch, null, "önceki kişinin ETag'i gönderilmez (304 eski veriyi onaylamasın)");
    assert.equal(getLive().data?.me.id, 18);
    assert.equal(getLive().data?.reminders[0].title, "Personelin notu");
  });

  test("aynı kişi yeniden girince canlı veri yeniden istenir (F5'e kadar donmaz)", async () => {
    bindLive(10);
    replies.push({ status: 401 });
    await refreshLive();
    assert.equal(getLive().signedOut, true);
    bindLive(10);
    replies.push({ status: 200, body: live(10, "admin"), etag: 'W/"a"' });
    await refreshLive();
    assert.equal(calls.length, 2);
    assert.equal(getLive().data?.me.id, 10);
    // Aynı kişi, oturum düşmeden yeniden bağlanırsa (kabuk yenilendi) veri korunur, ETag'le sorulur
    bindLive(10);
    replies.push({ status: 304 });
    await refreshLive();
    assert.equal(calls[2].ifNoneMatch, 'W/"a"');
    assert.equal(getLive().data?.me.id, 10);
  });

  test("yanıt kabuğun kullanıcısının değilse (başka sekmede başka hesapla girildi) yazılmaz", async () => {
    bindLive(18);
    replies.push({ status: 200, body: live(10, "admin"), etag: 'W/"a"' });
    await refreshLive();
    assert.equal(getLive().data, null);
    assert.equal(getLive().signedOut, true, "kabuk sunucudan yeniden istenir (uyarı motoru)");
  });

  test("depo boşaltılınca yolda kalan önceki oturumun yanıtı yazılmaz", async () => {
    bindLive(10);
    let answer!: (r: Reply) => void;
    replies.push(new Promise<Reply>((r) => (answer = r)));
    const pending = refreshLive();
    // Kabuk kapandı (çıkış), personel girdi
    resetLive();
    bindLive(18);
    answer({ status: 200, body: live(10, "admin"), etag: 'W/"a"' });
    await pending;
    assert.equal(getLive().data, null);
    replies.push({ status: 200, body: live(18, "staff", "Personelin notu"), etag: 'W/"b"' });
    await refreshLive();
    assert.equal(getLive().data?.me.id, 18, "yeni istek eskisini beklemez");
  });
});

test("uyarı motoru ve karaoke panosu: depo kabuğun kullanıcısına bağlı, hatırlatıcı yalnız onun, tutar yalnız yöneticiye", () => {
  const center = read("src/components/panel/live/alert-center.tsx");
  assert.match(center, /export function AlertCenter\(\{ role, userId \}: \{ role: Role; userId: number \}\)/);
  assert.match(center, /bindLive\(userId\);\s*void refreshLive\(\);/);
  assert.match(center, /resetLive\(\);\s*\};\s*\}, \[userId\]\);/, "kabuk kapanınca depo boşalır");
  assert.match(center, /data && data\.me\.id === userId \? data\.reminders : \[\]/);
  assert.doesNotMatch(center, /data\??\.reminders\b(?! :)/, "hatırlatıcılar yalnız süzülmüş listeden");
  assert.match(center, /if \(signedOut\) router\.refresh\(\);/, "oturum düşünce sunucu giriş sayfasına gönderir");
  assert.match(read("src/components/panel/sidebar.tsx"), /<AlertCenter role=\{user\.role\} userId=\{user\.id\} \/>/);
  assert.match(read("src/app/panel/layout.tsx"), /user=\{\{ id: user\.id,/);
  assert.match(read("src/app/panel/karaoke/karaoke-board.tsx"), /\{admin && s\.totalMinor \?/);
  // Canlı ucun ETag'i kişiyi de taşır: başka hesabın yanıtı 304 ile onaylanmaz
  assert.match(read("src/app/api/canli/route.ts"), /\$\{today\}\.u\$\{me\.id\}\.\$\{me\.role\}"`;/);
});

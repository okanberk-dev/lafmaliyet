// Yetki ve hesap ekranlarının küçükleri (denetim 13 Kasım 2026, P06), veritabanısız: iki adımlı kurulumun bekleyen
// anahtarı ve sınırı (YO-05), girişte yanlış kurtarma kodunun metni (YO-07), Hesabım pencerelerinin oturum ve Claude
// uyarısı (YO-08), davet ve Hesabım formlarının e-posta kuralı (YO-06), Kullanıcılar'ın anahtarı ve düzenleme penceresi
// (YO-01), bilinen cihazın kilidi (YO-03) ve personel sızıntı betiği (KA-03: akış içindeki yönlendirmeyi izler, ekranları
// sayfa dosyalarından ve roles.ts'ten üretir, canlı ucu tarar; sahte bir HTTP sunucusuna karşı).
// Veritabanıyla: tests/hesap-yetki-db.test.ts.
// Çalıştırma: npx tsx --test tests/hesap-yetki.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";

import { CLAUDE_NOTE, sessionsNote } from "../src/app/panel/hesap/session-note";
import { passwordProblem } from "../src/lib/password-rules";
import { ADMIN_ONLY_PATHS, STAFF_PATHS } from "../src/lib/roles";
import { isSetupEnded, openPendingSecret, pendingSecret, SETUP_EXPIRED, SETUP_MAX, SETUP_MINUTES, SETUP_STOPPED } from "../src/lib/two-factor-setup";
import { WRONG_APP_CODE, WRONG_RECOVERY_CODE, wrongLoginCodeMessage } from "../src/server/auth/totp";
import { adminPages, linkFor, liveLeaks, panelRoutes, scanStaffLeaks, staffPages, streamRedirect } from "../scripts/personel-sizinti";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

// ---------------------------------------------------------------- İki adımlı doğrulama

test("kurulum: bekleyen anahtar başlangıç anıyla saklanır, 15 dakika geçerli; önceki biçim ve bozuk metin geçmez (YO-05)", () => {
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  const at = Date.parse("2026-11-14T10:00:00Z");
  const plain = pendingSecret(secret, at);
  assert.equal(plain, `kurulum:${at}:${secret}`);
  assert.equal(openPendingSecret(plain, at), secret);
  assert.equal(openPendingSecret(plain, at + SETUP_MINUTES * 60_000 - 1), secret);
  assert.equal(openPendingSecret(plain, at + SETUP_MINUTES * 60_000), null, "süresi doldu");
  assert.equal(openPendingSecret(plain, at - 1), null, "gelecekten gelen başlangıç");
  assert.equal(openPendingSecret(secret, at), null, "bu sürümden önce başlamış kurulum (düz anahtar)");
  assert.equal(openPendingSecret(null, at), null, "okunamayan şifreli metin");
  assert.equal(openPendingSecret(`kurulum:${at}:abc`, at), null);
  assert.equal(SETUP_MAX, 5);
  assert.ok(isSetupEnded(SETUP_EXPIRED) && isSetupEnded(SETUP_STOPPED));
  assert.equal(isSetupEnded("Kod tutmadı. Telefonun saati doğru mu? Uygulamadaki güncel kodu girin."), false);
  assert.match(SETUP_STOPPED, /^Kod 5 kez tutmadı; güvenlik için kurulum durduruldu\./);
});

test("kurulum eylemi: deneme doğrulamadan önce sayılır, sınırda ve süre dolunca anahtar silinir, işlem geçmişine yazılır (YO-05)", () => {
  const auth = read("src/server/actions/auth.ts");
  const confirm = auth.slice(auth.indexOf("export async function confirmTotpSetup"), auth.indexOf("export async function cancelTotpSetup"));
  assert.ok(confirm.indexOf("setupFails.hit(key)") < confirm.indexOf("verifyTotp(secret"), "sayım doğrulamadan önce");
  assert.match(confirm, /const key = `\$\{me\.id\}:\$\{sealed\}`;/, "sayaç bekleyen anahtar başına: yeni kurulum yeni sayaç");
  assert.match(confirm, /await logActivity\(me, "İki adımlı kurulum durduruldu"/);
  assert.match(confirm, /eq\(s\.users\.totpSecret, sealed\), eq\(s\.users\.totpEnabled, false\)/, "okunan bekleyen anahtar değiştiyse açılmaz");
  assert.match(auth, /totpSecret: seal\(pendingSecret\(secret\), "totp"\)/);
  // Pencere: süresi dolan ya da durdurulan kurulumda kapanır; Vazgeç anahtarı siler
  const ui = read("src/app/panel/hesap/two-factor.tsx");
  assert.match(ui, /if \(!isSetupEnded\(res\.error\)\) return setError\(res\.error\);/);
  assert.match(ui, /void cancelTotpSetup\(\)/);
});

test("giriş kodu: kurtarma kodu kipinde ya da 6 haneli olmayan kodda metin kurtarma koduna göre (YO-07)", () => {
  assert.equal(wrongLoginCodeMessage("123 456", false), WRONG_APP_CODE);
  assert.equal(wrongLoginCodeMessage("123456", true), WRONG_RECOVERY_CODE, "form kurtarma kipinde");
  assert.equal(wrongLoginCodeMessage("k7m2p-9xq4t", false), WRONG_RECOVERY_CODE, "kip gelmese de biçiminden");
  assert.doesNotMatch(WRONG_RECOVERY_CODE, /uygulama/i);
  assert.match(WRONG_RECOVERY_CODE, /Her kod bir kez çalışır/);
  assert.match(read("src/app/giris/login-form.tsx"), /<input type="hidden" name="mode" value=\{mode\} \/>/);
  assert.match(read("src/server/actions/auth.ts"), /wrongLoginCodeMessage\(code, formData\.get\("mode"\) === "recovery"\)/);
});

test("Hesabım: iki adımlıyı açmak, kapatmak, parola ve oturumları kapatmak oturumları ve Claude bağlantısını kapattığını söyler (YO-08)", () => {
  assert.equal(sessionsNote(false), "Diğer cihazlardaki oturumlarınız kapanır.");
  assert.equal(sessionsNote(false, "Açılınca"), "Açılınca diğer cihazlardaki oturumlarınız kapanır.");
  assert.equal(sessionsNote(true, "Değişince"), `Değişince diğer cihazlardaki oturumlarınız kapanır. ${CLAUDE_NOTE}`);
  assert.match(CLAUDE_NOTE, /Claude'da yeniden bağlanmanız gerekir/);
  const ui = read("src/app/panel/hesap/two-factor.tsx");
  // Açma penceresi (parola) ve kurulum penceresi (QR) ikisi de söyler; kapatma Claude'u da söyler
  assert.equal(ui.match(/sessionsNote\(claude, "Açılınca"\)/g)?.length, 2);
  // Yöneticide iki adımlı zorunluyken kapatma penceresi kurulum ekranını da söyler (src/lib/admin-security.ts)
  assert.match(ui, /description=\{required \? `\$\{ADMIN_2FA_DISABLE_NOTE\} \$\{sessionsNote\(claude\)\}` : `Girişte yalnızca parola istenir\. \$\{sessionsNote\(claude\)\}`\}/);
  const page = read("src/app/panel/hesap/page.tsx");
  assert.match(page, /const claude = Boolean\(connections\?\.rows\.length\);/);
  assert.match(page, /sessionsNote\(claude, "Değişince"\)/);
  assert.match(page, /<TwoFactorCard [^>]*claude=\{claude\} required=\{twoFactorRequiredFor\(user\.role\)\} \/>/);
  assert.match(page, /<SessionsCard claude=\{claude\} \/>/);
  assert.match(read("src/app/panel/hesap/sessions.tsx"), /\$\{claude \? ` \$\{CLAUDE_NOTE\}` : ""\}/);
  assert.match(read("src/app/panel/hesap/connections.tsx"), /iki adımlı doğrulamayı açıp kapatınca/);
});

test("davet ve Hesabım: e-postayı içeren parola yazarken söylenir, düğme kapanır (YO-06)", () => {
  assert.equal(passwordProblem("YoDavet-Kahvaltı-77", "yo-davet@denetim.test"), "Parola e-posta adresinizi içermesin");
  assert.equal(passwordProblem("YoDavet-Kahvaltı-77"), null, "e-postasız çağrı kuralı kaçırıyordu");
  assert.match(read("src/app/davet/set-password-form.tsx"), /passwordProblem\(password, email\)/);
  assert.match(read("src/app/panel/hesap/password-form.tsx"), /passwordProblem\(next, email\)/);
  assert.match(read("src/app/panel/hesap/page.tsx"), /<PasswordForm email=\{user\.email\} \/>/);
  // Sunucu: kural ve tekrar alanı denemeyi saymadan önce
  const inv = read("src/server/actions/invites.ts");
  const fn = inv.slice(inv.indexOf("export async function setPasswordWithToken"), inv.indexOf("export async function requestPasswordReset"));
  assert.ok(fn.indexOf("passwordProblem(password") < fn.indexOf("countTokenAttempt("));
  assert.ok(fn.indexOf("password !== repeat") < fn.indexOf("countTokenAttempt("));
});

// ---------------------------------------------------------------- Kullanıcılar

test("Kullanıcılar: anahtar yalnız erişimi gönderir; düzenleme penceresi açıldığı andaki hâli gönderir (YO-01)", () => {
  const ui = read("src/app/panel/kullanicilar/users-client.tsx");
  assert.match(ui, /const saveActive = \(u: UserRow, active: boolean, confirm\?: StepUpConfirm\) => setUserActive\(u\.id, active, confirm\);/);
  assert.doesNotMatch(ui, /saveUser\(\{ id: u\.id, name: u\.name/, "satırın eski adı, e-postası ve rolü gönderilmez");
  assert.match(ui, /const \[seen\] = useState\(\(\) => \(\{ name: user\.name, email: user\.email, role: user\.role, active: user\.active, branchId: user\.branchId \?\? null \}\)\);/);
  assert.match(ui, /password: password \|\| undefined, seen \}, confirm\)/);
  const settings = read("src/server/actions/settings.ts");
  assert.match(settings, /seen: z\.object\(\{ name: z\.string\(\), email: z\.string\(\), role: z\.enum\(\["admin", "staff"\]\), active: z\.boolean\(\), branchId: z\.string\(\)\.nullable\(\) \}\),/, "zorunlu");
  assert.match(settings, /\(before\.branchId \?\? null\) !== seen\.branchId/, "şube de (main'in personel şubesi)");
  // Reddetme parola sorulmadan önce
  const save = settings.slice(settings.indexOf("export async function saveUser"), settings.indexOf("export async function setUserActive"));
  assert.ok(save.indexOf("throw new UserError(STALE_USER)") < save.indexOf("requireStepUp("));
});

test("Kullanıcılar: bilinen cihazın süren kilidi 'Bir cihazda kilitli' görünür, Kilidi aç cihaz kilitlerini de siler (YO-03)", () => {
  const page = read("src/app/panel/kullanicilar/page.tsx");
  assert.match(page, /\.from\(s\.loginDeviceLocks\)\s*\.where\(gt\(s\.loginDeviceLocks\.lockedUntil, now\)\)/);
  assert.match(page, /locked: u\.lockedUntil && u\.lockedUntil > now \? "account" : deviceLocked\.has\(u\.id\) \? "device" : null,/);
  const ui = read("src/app/panel/kullanicilar/users-client.tsx");
  assert.match(ui, /\{user\.locked === "device" \? "Bir cihazda kilitli" : "Kilitli"\}/);
  assert.match(read("src/server/actions/settings.ts"), /await db\.delete\(s\.loginDeviceLocks\)\.where\(eq\(s\.loginDeviceLocks\.userId, userId\)\);/);
});

// ---------------------------------------------------------------- Personel sızıntı betiği

test("sızıntı betiği: akış içindeki yönlendirmenin hedefi okunur; başka siteye ya da bozuk hedefe gidilmez (KA-03)", () => {
  assert.equal(streamRedirect('…\\"digest\\":\\"NEXT_REDIRECT;replace;/panel/sayim?ay=2026-11;307;\\"…'), "/panel/sayim?ay=2026-11");
  assert.equal(streamRedirect("NEXT_REDIRECT;push;/panel/kasa?gun=2026-11-13\\u0026sube=tuzla;307;"), "/panel/kasa?gun=2026-11-13&sube=tuzla");
  assert.equal(streamRedirect("NEXT_REDIRECT;replace;//kotu.example/x;307;"), null);
  assert.equal(streamRedirect("NEXT_REDIRECT;replace;https://kotu.example/x;307;"), null);
  assert.equal(streamRedirect("NEXT_REDIRECT\\n    at StockContent"), null, "yığın izindeki ad yönlendirme değil");
  assert.equal(streamRedirect("<html>Stok sayımı</html>"), null);
});

test("sızıntı betiği: ekranlar sayfa dosyalarından ve roles.ts'ten; kaldırılan Tahmin yok, personel yolunun altındaki yönetici ekranları Bugün'e dönmeli (KA-03)", () => {
  const routes = panelRoutes();
  const staff = staffPages(routes, "2026-11-14").map((p) => p.path);
  for (const p of STAFF_PATHS) assert.ok(staff.includes(p), `personel ekranı taranmıyor: ${p}`);
  assert.ok(staff.includes("/panel/zayi") && staff.includes("/panel/zayi?gun=2026-11-09"), "bugünün ve geçmiş günün zayisi");
  assert.ok(staff.includes("/panel/kasa?gun=2026-11-13"));
  const admin = adminPages(routes);
  for (const p of ADMIN_ONLY_PATHS) assert.ok(admin.includes(p), `yönetici ekranı denenmiyor: ${p}`);
  assert.ok(admin.includes("/panel/kontrol/duzenle/1"));
  assert.ok(!admin.includes("/panel/tahmin") && !staff.includes("/panel/tahmin"), "kaldırılan ekran listede kalmaz");
  assert.ok(!staff.some((p) => admin.includes(p)));
  // ₺: kasa, Bugün, reçete defteri ve hatırlatıcılarım gösterebilir; Stok sayımı ve karaoke gösteremez
  const lira = Object.fromEntries(staffPages(routes, "2026-11-14").map((p) => [p.path, p.lira]));
  assert.equal(lira["/panel/sayim"], false);
  assert.equal(lira["/panel/karaoke"], false);
  assert.equal(lira["/panel/kasa?gun=2026-11-13"], true);
  // Dinamik personel ekranı taranan sayfadaki bağlantıdan; yönetici ekranı ve sabit sayfa atlanır
  const kontrol = routes.find((r) => r.pattern === "/panel/kontrol/[id]")!;
  assert.equal(linkFor(kontrol, '<a href="/panel/kontrol/gecmis"></a><a href="/panel/kontrol/duzenle"></a><a href="/panel/kontrol/12">', routes), "/panel/kontrol/12");
  assert.equal(linkFor(kontrol, "<a href=\"/panel/kontrol/duzenle\">", routes), null);
});

test("sızıntı betiği: canlı uçta maliyet anahtarı ve null olmayan karaoke tutarı yakalanır (KA-03)", () => {
  assert.deepEqual(liveLeaks('{"me":{"role":"staff"},"karaoke":{"sessions":[{"totalMinor":null,"refundMinor":null}]}}'), []);
  assert.deepEqual(liveLeaks('{"karaoke":{"sessions":[{"totalMinor":45000,"refundMinor":null}]}}'), ["totalMinor"]);
  assert.deepEqual(liveLeaks('{"x":[{"refundMinor": 100}],"y":{"unitCost":3}}'), ["unitCost", "refundMinor"]);
});

/** Panelin taklidi: personel çereziyle yönetici ekranları Bugün'e döner, RSC isteği `_rsc` ile yeniden istenir */
function fakePanel(o: { leak: boolean }) {
  const seen: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://x");
    const rsc = req.headers.rsc === "1";
    seen.push(`${rsc ? "RSC " : ""}${url.pathname}${url.search.replace(/[?&]_rsc=[^&]*/, "")}`);
    const redirect = (to: string) => res.writeHead(307, { location: to }).end();
    if (req.headers.cookie !== "laf_session=personel") return res.writeHead(401).end();
    if (url.pathname === "/api/canli") {
      const amount = o.leak ? 45000 : null;
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ me: { id: 2, role: "staff" }, karaoke: { sessions: [{ totalMinor: amount, refundMinor: null }] } }));
    }
    const path = url.pathname;
    const staffPath = (STAFF_PATHS as readonly string[]).some((p) => path === p || path.startsWith(`${p}/`)) && !ADMIN_ONLY_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
    if (!staffPath) return redirect("/panel/bugun");
    if (rsc && !url.searchParams.has("_rsc")) return redirect(`${path}${url.search ? `${url.search}&` : "?"}_rsc=abc`);
    let body = `<html><body>${path}</body></html>`;
    // Stok sayımı ay seçilmeden: akış içinde yönlendirme kabuğu (HTTP 200)
    if (path === "/panel/sayim" && !url.searchParams.has("ay")) body = '<html>…\\"digest\\":\\"NEXT_REDIRECT;replace;/panel/sayim?ay=2026-11;307;\\"…</html>';
    else if (path === "/panel/sayim") body = o.leak ? '<script>self.__next_f.push([1,"{\\"unitCost\\":12.5,\\"pool\\":[]}"])</script>' : "<html>sayım satırları</html>";
    if (path === "/panel/kontrol") body = '<a href="/panel/kontrol/duzenle">Düzenle</a><a href="/panel/kontrol/7">Açılış</a>';
    res.writeHead(200, { "content-type": "text/html" }).end(body);
  });
  return { server, seen };
}

async function withPanel<T>(o: { leak: boolean }, run: (base: string, seen: string[]) => Promise<T>): Promise<T> {
  const { server, seen } = fakePanel(o);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("sızıntı betiği, sahte panele karşı: Stok sayımı'nın yönlendirme kabuğu değil asıl sayfası taranır; canlı uç ve dinamik ekran da (KA-03)", async () => {
  const lines: string[] = [];
  const dirty = await withPanel({ leak: true }, (base, seen) =>
    scanStaffLeaks({ base, cookie: "laf_session=personel", today: "2026-11-14", log: (l) => lines.push(l) }).then((r) => ({ ...r, seen })),
  );
  assert.equal(dirty.cookie, undefined);
  assert.ok(dirty.seen.includes("/panel/sayim?ay=2026-11") && dirty.seen.includes("RSC /panel/sayim?ay=2026-11"), "hedef HTML ve RSC olarak çekildi");
  assert.ok(dirty.failures.some((f) => f.startsWith("/panel/sayim → /panel/sayim?ay=2026-11 (HTML): yasak anahtar unitCost")), dirty.failures.join("\n"));
  assert.ok(dirty.failures.some((f) => f.startsWith("/api/canli: yasak anahtar ya da tutar totalMinor")));
  assert.ok(dirty.seen.includes("/panel/kontrol/7"), "kontrol listesinin bağlantısı");
  assert.ok(!dirty.seen.includes("/panel/tahmin"));
  assert.ok(dirty.seen.includes("/panel/karaoke/doluluk") && dirty.seen.includes("RSC /panel/karaoke/doluluk"));

  const clean = await withPanel({ leak: false }, (base) => scanStaffLeaks({ base, cookie: "laf_session=personel", today: "2026-11-14", log: () => {} }));
  assert.deepEqual(clean.failures, []);
  assert.equal(clean.admin, adminPages(panelRoutes()).length);
  // Personel olmayan çerez: hiçbir şey taranmaz
  const wrong = await withPanel({ leak: false }, (base) => scanStaffLeaks({ base, cookie: "laf_session=yonetici", log: () => {} }));
  assert.match(wrong.cookie ?? "", /^Çerez personelin değil ya da geçersiz/);
  assert.equal(wrong.checked, 0);
});

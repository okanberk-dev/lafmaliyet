// Bildirim alıcıları ve personele sabit hata metni (denetim B19: E-52, E-53, E-64; docs/BILDIRIMLER.md › Alıcılar ve
// hesaplar): kasa raporu, sabah e-postası, bekçi uyarısı ve deneme e-postaları personel ya da pasif hesabın adresine
// gitmez (gönderim anında süzülür, kaydederken reddedilir, yönetici zilde ve listede görür); personel Hesabım'da giriş
// e-postasını bir listedeki adrese çeviremez; personel site bağlantısının ve e-postanın kurulum ayrıntısını (anahtar adı,
// imza, sitenin sürümü, Resend anahtarı) görmez. Saf kurallar ve kaynak denetimleri; veritabanında olanlar
// tests/bildirim-alicilari-db.test.ts.
// Çalıştırma: npx tsx --test tests/bildirim-alicilari.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { karaokePullError } from "../src/lib/karaoke/sync-text";
import {
  blockedBell,
  blockReasonOf,
  droppedListText,
  droppedLogSuffix,
  emailKey,
  allDroppedSentence,
  oldAddressNotice,
  PROFILE_LIST_REFUSAL,
  PROFILE_OWN_LIST_REFUSAL,
  recipientRefusal,
  splitByBlocked,
  userListNotice,
  type BlockReason,
} from "../src/lib/notify-recipients";
import { pullFailureMessage, pushFailureMessage, type PushFailure } from "../src/lib/site-menu/push";
import { siteFailureText, SOLD_OUT_TEXT } from "../src/lib/site-menu/sold-out";
import { isStageSetupFailure, STAGE_OFF_ERROR, STAGE_STAFF_ERROR, stageFailureMessage, type StageFailure } from "../src/lib/site-orders/stage";
import { emailErrorFor, emailFailedLine, siteErrorFor, STAFF_EMAIL_ERROR, STAFF_SITE_ERROR, staffSiteText } from "../src/lib/staff-errors";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, name);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

/** Personelin görmemesi gereken kurulum ayrıntısı */
const SETUP_DETAIL = /KARAOKE_SYNC_SECRET|RESEND_API_KEY|Resend|imza|İmza|güncel değil|HTTP \d|panel ucu|uç yok|ucu yok/;

// ---------------------------------------------------------------- E-53: hesap ve alıcı

test("hesabın e-posta alması: yalnız etkin yönetici alır; personel ve pasif hesap düşer, hesabı olmayan adres alır", () => {
  assert.equal(blockReasonOf({ role: "admin", active: true }), null);
  assert.equal(blockReasonOf({ role: "admin", active: false }), "inactive");
  assert.equal(blockReasonOf({ role: "staff", active: true }), "staff");
  // Pasif personel: personel sayılır (iki neden de geçerli; metin personel hesabını söyler)
  assert.equal(blockReasonOf({ role: "staff", active: false }), "staff");
  assert.equal(blockReasonOf(null), null);
  assert.equal(blockReasonOf(undefined), null);
});

test("liste gidecek ve düşen adreslere ayrılır: sıra korunur, büyük-küçük harf fark etmez", () => {
  const blocked = new Map<string, BlockReason>([
    ["ayse@laffogato.net", "staff"],
    ["eski@laffogato.net", "inactive"],
  ]);
  const out = splitByBlocked(["sahip@gmail.com", "Ayse@Laffogato.net", "muhasebe@ornek.com", "eski@laffogato.net"], blocked);
  assert.deepEqual(out.to, ["sahip@gmail.com", "muhasebe@ornek.com"]);
  assert.deepEqual(out.dropped, [
    { email: "Ayse@Laffogato.net", reason: "staff" },
    { email: "eski@laffogato.net", reason: "inactive" },
  ]);
  assert.deepEqual(splitByBlocked([], blocked), { to: [], dropped: [] });
  assert.equal(emailKey("  Ali@Ornek.COM "), "ali@ornek.com");
  assert.equal(droppedListText(out.dropped), "Ayse@Laffogato.net (personel hesabı), eski@laffogato.net (pasif hesap)");
  assert.equal(droppedLogSuffix(out.dropped), " · 2 adres atlandı (personel ya da pasif hesap)");
  assert.equal(droppedLogSuffix([]), "");
});

test("kaydederken ret metni: adresi adıyla söyler; personelde nedeni listeye göre, pasifte ne yapılacağını", () => {
  assert.equal(
    recipientRefusal("cash", { email: "ayse@laffogato.net", reason: "staff" }),
    "ayse@laffogato.net bir personel hesabının adresi; kasa e-postasında karaoke ön ödemesi var. Yöneticinin ya da muhasebecinin adresini girin.",
  );
  assert.match(recipientRefusal("digest", { email: "ayse@laffogato.net", reason: "staff" }), /sabah e-postasında ödemeler, fatura tutarları ve maliyet rakamları var/);
  assert.equal(
    recipientRefusal("digest", { email: "eski@laffogato.net", reason: "inactive" }),
    "eski@laffogato.net pasif bir hesabın adresi; pasif hesaba e-posta gitmez. Hesabı Kullanıcılar'dan silerseniz adres alıcı olabilir.",
  );
  assert.equal(PROFILE_LIST_REFUSAL, "Bu adres giriş e-postanız olamaz; başka bir adres yazın ya da yöneticiye sorun.");
});

test("Kullanıcılar uyarısı: personele indirilen ya da pasif yapılan hesabın adresi listede", () => {
  assert.equal(
    userListNotice({ name: "Mehmet", email: "mehmet@laffogato.net" }, "inactive", ["cash", "digest"]),
    "Mehmet (mehmet@laffogato.net) kasa raporu alıcıları ve sabah e-postasının bildirim adresleri arasında; pasif hesaba bu e-posta gitmez. Gerekmiyorsa listeden kaldırın.",
  );
  assert.match(userListNotice({ name: "Ayşe", email: "a@b.co" }, "staff", ["digest"]), /^Ayşe \(a@b\.co\) sabah e-postasının bildirim adresleri arasında; personel hesabına bu e-posta gitmez\./);
});

test("eski adres listede kaldı (yeni giriş e-postası, silinen hesap): artık hesabı yok, e-posta gider; personelin ret metni", () => {
  assert.equal(
    oldAddressNotice({ name: "Mehmet", email: "mehmet@laffogato.net" }, ["cash"], "rename"),
    "Mehmet hesabının eski adresi mehmet@laffogato.net kasa raporu alıcıları arasında; adres artık hiçbir hesaba ait değil, bu adrese e-posta gider. Gerekmiyorsa listeden kaldırın.",
  );
  assert.equal(
    oldAddressNotice({ name: "Ayşe", email: "a@b.co" }, ["cash", "digest"], "delete"),
    "Ayşe (a@b.co) kasa raporu alıcıları ve sabah e-postasının bildirim adresleri arasında; hesap silindiği için adres hiçbir hesaba ait değil, bu adrese e-posta gider. Gerekmiyorsa listeden kaldırın.",
  );
  assert.equal(PROFILE_OWN_LIST_REFUSAL, "Giriş e-postanız bildirim listesinde; değiştirmek için yöneticiye yazın.");
});

test("bütün adresler düştü: tek cümle, iç içe parantez yok", () => {
  const dropped = [{ email: "ayse@laffogato.net", reason: "staff" as const }];
  assert.equal(allDroppedSentence("Alıcıların", dropped), "Alıcıların hepsi personel ya da pasif hesaba ait: ayse@laffogato.net (personel hesabı).");
  assert.equal(
    allDroppedSentence("Etkin bildirim adreslerinin", [...dropped, { email: "eski@laffogato.net", reason: "inactive" }]),
    "Etkin bildirim adreslerinin hepsi personel ya da pasif hesaba ait: ayse@laffogato.net (personel hesabı), eski@laffogato.net (pasif hesap).",
  );
});

test("zil satırı: listeye göre başlık, adresler ve nedenleri, ayarın adresi; kimlik adreslerden", () => {
  const one = blockedBell("cash", [{ email: "Ayse@Laffogato.net", reason: "staff" }]);
  assert.equal(one.title, "Kasa raporu e-postası bir adrese gitmiyor");
  assert.equal(one.body, "Ayse@Laffogato.net (personel hesabı): bu hesaplara ödeme ve maliyet e-postası gitmez. Adresi Kasa › Rapor alıcıları'ndan kaldırın ya da doğru adresi yazın.");
  assert.equal(one.href, "/panel/kasa#rapor-alicilari");
  assert.equal(one.id, "alici-cash-ayse@laffogato.net:staff");
  const two = blockedBell("digest", [
    { email: "a@b.co", reason: "staff" },
    { email: "c@d.co", reason: "inactive" },
  ]);
  assert.equal(two.title, "Sabah e-postası 2 adrese gitmiyor");
  assert.equal(two.href, "/panel/hatirlaticilar#e-posta-bildirimleri");
  assert.match(two.body, /Hatırlatıcılar › E-posta bildirimleri'nden kaldırın/);
  // Neden değişince (personel → pasif) yeniden okunmamış olur
  assert.notEqual(blockedBell("cash", [{ email: "a@b.co", reason: "inactive" }]).id, blockedBell("cash", [{ email: "a@b.co", reason: "staff" }]).id);
});

test("gönderim yolları ortak süzgeçten: kasa e-postası ve denemesi, sabah e-postası ve denemesi, bekçi uyarısı", () => {
  const email = fnBody(read("src/server/cash/report-email.ts"), "emailReport");
  assert.match(email, /sendableRecipients\(getDb\(\), settings\.recipients\)/);
  const cash = read("src/server/actions/cash-report.ts");
  assert.match(fnBody(cash, "sendCashTestEmail"), /sendableRecipients\(getDb\(\), settings\.recipients\)/);
  const digest = read("src/server/notify/digest.ts");
  const run = fnBody(digest, "runReminderDigest");
  // Alıcı grupları (şube kapsamı C P1-11): her grubun adresleri ortak süzgeçten
  assert.match(run, /const \[recipientRows, branchRows\] = await Promise\.all\(\[activeDigestRecipients\(db\), listBranches\(db\)\]\);/);
  assert.match(run, /const \{ to, dropped \} = await sendableRecipients\(db, g\.emails\);/);
  assert.ok(run.indexOf("sendableRecipients(") < run.indexOf("await sendEmail("), "süzgeç gönderimden önce");
  assert.match(run, /off: "norecipient"/);
  assert.match(run, /\$\{droppedLogSuffix\(dropped\)\}/, "işlem geçmişinde atlanan sayısı");
  assert.match(fnBody(digest, "sendTestEmail"), /const \{ to, dropped \} = await sendableRecipients\(db, await activeDigestEmails\(db\)\);/);
  const alerts = fnBody(read("src/server/jobs/alerts.ts"), "sendWatchdogAlert");
  assert.match(alerts, /activeDigestEmails\(db\)\.then\(\(emails\) => sendableRecipients\(db, emails\)\)/);
  assert.match(alerts, /if \(!items\.length \|\| !to\.length\) return "none";/);
  // Bildirim adreslerini doğrudan okuyan başka gönderim kalmadı (yalnız ortak modül ve ekranlar)
  for (const f of ["src/server/notify/digest.ts", "src/server/jobs/alerts.ts"]) assert.doesNotMatch(read(f), /from\(s\.notificationRecipients\)/, f);
});

test("kaydederken: bildirim adresi ve kasa alıcısı personel ya da pasif hesabın olamaz; yardımcı dışa açılmaz", () => {
  const reminders = read("src/server/actions/reminders.ts");
  const add = fnBody(reminders, "addRecipient");
  assert.ok(add.indexOf("await refuseBlocked(e);") > add.indexOf("zaten listede"), "önce yinelenen, sonra hesap");
  assert.ok(add.indexOf("await refuseBlocked(e);") < add.indexOf(".insert("), "yazmadan önce");
  // Duraklatılan adres yeniden açılırken de
  assert.match(fnBody(reminders, "setRecipientActive"), /if \(on\) \{[\s\S]*await refuseBlocked\(r\.email\);/);
  assert.match(reminders, /^async function refuseBlocked\(email: string\)/m, "\"use server\" dosyasında dışa açılmaz");
  const settings = fnBody(read("src/server/actions/cash-report.ts"), "updateCashSettings");
  assert.ok(settings.indexOf("blockedAccounts(") < settings.indexOf("saveCashSettings("));
});

test("Kullanıcılar: kaydedilen ve eklenen hesap için liste uyarısı; yardımcı dışa açılmaz", () => {
  const src = read("src/server/actions/settings.ts");
  assert.match(src, /^async function listNotice\(/m);
  const save = fnBody(src, "saveUser");
  assert.match(save, /const notice = \[await listNotice\(data\), renamed\]\.filter\(Boolean\)\.join\(" "\) \|\| null;/);
  // Eski adres: yalnız e-posta değişince ve hesap önce ya da sonra e-posta almıyorsa
  assert.match(save, /before\.email !== data\.email \? await oldAddressListNotice\(\{ name: data\.name, email: before\.email \}, Boolean\(blockReasonOf\(before\) \|\| blockReasonOf\(data\)\), "rename"\) : null/);
  assert.match(fnBody(src, "deleteUser"), /return \{ notice: await oldAddressListNotice\(u, Boolean\(blockReasonOf\(u\)\), "delete"\) \};/);
  assert.match(src, /^async function oldAddressListNotice\(/m);
  assert.match(fnBody(src, "createUser"), /const notice = \(await listNotice\(data\)\) \?\? undefined;/);
  const client = read("src/app/panel/kullanicilar/users-client.tsx");
  assert.equal([...client.matchAll(/toast\.warning\(res\.data(?:\?)?\.notice, \{ duration: 12_000 \}\)/g)].length, 4, "pasif yapma, düzenleme, ekleme, silme");
});

// ---------------------------------------------------------------- E-52: Hesabım

test("Hesabım: personel giriş e-postasını bir listedeki adrese çeviremez, kendi adresi listedeyken değiştiremez; parola önce, yazımdan önce", () => {
  const body = fnBody(read("src/server/actions/auth.ts"), "updateProfile");
  const guard = body.indexOf('if (me.role !== "admin" && data.email !== u.email) {');
  assert.ok(guard > 0);
  // Kendi adresi listedeyken hiç (eski adres hesapsız kalıp yeniden e-posta alırdı), yeni adres listedeyse de
  const own = body.indexOf("if ((await listsWithEmail(u.email)).length) throw new UserError(PROFILE_OWN_LIST_REFUSAL);");
  const target = body.indexOf("if ((await listsWithEmail(data.email)).length) throw new UserError(PROFILE_LIST_REFUSAL);");
  assert.ok(guard < own && own < target, "ikisi de aynı koşulun içinde");
  assert.ok(body.indexOf("requirePassword(") < guard, "parola doğrulanmadan liste sorulmaz");
  assert.ok(guard < body.indexOf(".update(s.users)"));
  // Listeler: kasa alıcıları (kapalıyken de) ve bütün bildirim adresleri (duraklatılmış da)
  const lists = read("src/server/notify/recipients.ts");
  const fn = lists.slice(lists.indexOf("export async function listsWithEmail"), lists.indexOf("export async function blockedRecipientsNow"));
  // Kasa alıcıları şube başına (docs/SUBE.md › Şube başına ayarlar): bütün açık şubelerin listeleri, kapalıyken de
  assert.match(fn, /cashRecipientLists\(db, \{ all: true \}\)/);
  assert.match(fn, /cash\.some\(\(e\) => emailKey\(e\) === key\)/);
  assert.doesNotMatch(fn, /emailEnabled|active/);
});

test("zil: yalnız yöneticiye, sistem başlığında; durum okunamazsa zil yine açılır", () => {
  const src = read("src/server/actions/notifications.ts");
  const load = src.slice(src.indexOf("export async function loadPanelNotifications"));
  assert.ok(load.indexOf('safe("alici", recipientNotifications())') > load.indexOf('if (user.role !== "admin") return'), "personel dalında yok");
  assert.match(load, /return \[\.\.\.lost, \.\.\.system, \.\.\.recipients, /);
  assert.match(src, /group: "sistem" as const \}\]/);
});

// ---------------------------------------------------------------- E-64: personele sabit metin

test("canlı uçlar: hatanın ayrıntısı yöneticiye, personele sabit metin; hata yoksa null", () => {
  const err = karaokePullError({ kind: "http", status: 401 });
  assert.match(err, /KARAOKE_SYNC_SECRET/);
  assert.equal(siteErrorFor("admin", err), err);
  assert.equal(siteErrorFor("staff", err), STAFF_SITE_ERROR);
  assert.equal(siteErrorFor("staff", null), null);
  assert.equal(siteErrorFor("admin", ""), null);
  assert.equal(STAFF_SITE_ERROR, "Site bağlantısında sorun var; yöneticiye haber verin.");
  const siparis = read("src/app/api/siparisler/route.ts");
  assert.match(siparis, /error: siteErrorFor\(me\.role, r\.error\)/);
  assert.doesNotMatch(siparis, /error: r\.error/);
  const canli = read("src/app/api/canli/route.ts");
  assert.doesNotMatch(canli, /error: (?:linked \? )?(?:karaoke\.sync|ordersState)\.lastError/);
  // ETag rolü taşır: personelin önbelleği yöneticinin yanıtını (ya da tersini) almaz
  assert.match(canli, /\.\$\{me\.role\}"`;/);
});

test("sipariş aşaması: personel kurulum hatasında sabit metin; yeniden denenecek durumlar kendi metniyle", () => {
  const http = (status: number, error: string | null = null): StageFailure => ({ kind: "http", status, error, field: null });
  const setup: StageFailure[] = [{ kind: "off" }, http(401, "unauthorized"), http(400, "invalid"), http(404), http(413, "too_large"), http(503, "not_configured"), http(503), http(500)];
  for (const f of setup) {
    assert.ok(isStageSetupFailure(f), JSON.stringify(f));
    assert.equal(stageFailureMessage(f, "staff"), STAGE_STAFF_ERROR, JSON.stringify(f));
    assert.doesNotMatch(stageFailureMessage(f, "staff"), SETUP_DETAIL);
  }
  assert.equal(STAGE_STAFF_ERROR, "Site bağlantısında sorun var; sipariş ilerletilmedi. Yöneticiye haber verin.");
  // Yönetici ayrıntıyı görür (varsayılan rol yönetici: eski çağrılar aynı)
  assert.equal(stageFailureMessage({ kind: "off" }), STAGE_OFF_ERROR);
  assert.match(stageFailureMessage(http(401), "admin"), /KARAOKE_SYNC_SECRET/);
  const transient: StageFailure[] = [{ kind: "network" }, { kind: "timeout" }, http(409, "stale"), http(404, "not_found"), http(503, "unavailable")];
  for (const f of transient) {
    assert.ok(!isStageSetupFailure(f), JSON.stringify(f));
    assert.equal(stageFailureMessage(f, "staff"), stageFailureMessage(f, "admin"), JSON.stringify(f));
    assert.doesNotMatch(stageFailureMessage(f, "staff"), SETUP_DETAIL);
  }
});

test("Tükendi: personel okuma ve yazımın kurulum hatasında sabit metin (sonucuyla); ağ, zaman aşımı ve stale kendi metniyle", () => {
  const consequence = "ürün tükendi yapılmadı";
  const causes: PushFailure[] = [
    { kind: "off" },
    { kind: "http", status: 401 },
    { kind: "http", status: 400, field: "isActive" },
    { kind: "http", status: 404, error: "not_found" },
    { kind: "http", status: 404, error: null },
    { kind: "http", status: 409, error: "single_size" },
    { kind: "http", status: 413 },
    { kind: "http", status: 503 },
    { kind: "http", status: 500 },
  ];
  for (const cause of causes) {
    const write = pushFailureMessage(cause, consequence);
    const pull = `${pullFailureMessage(cause)}; ${consequence}.`;
    for (const [msg, read] of [
      [write, false],
      [pull, true],
    ] as const) {
      const staff = siteFailureText(msg, cause, "staff", { consequence, read });
      assert.equal(staff, "Site bağlantısında sorun var; ürün tükendi yapılmadı. Yöneticiye haber verin.", JSON.stringify(cause));
      assert.doesNotMatch(staff, SETUP_DETAIL);
    }
  }
  // 401 ve 503'ün ham metni anahtar adını taşır: yönetici görür
  assert.match(siteFailureText(pushFailureMessage({ kind: "http", status: 401 }, consequence), { kind: "http", status: 401 }, "admin", { consequence }), /KARAOKE_SYNC_SECRET/);
  assert.match(pullFailureMessage({ kind: "http", status: 503 }), /KARAOKE_SYNC_SECRET/);
  // Ağ: iki rolde aynı metin; okumanın zaman aşımı olduğu gibi, yazımınki personelin metni
  const net = pushFailureMessage({ kind: "network" }, consequence);
  assert.equal(siteFailureText(net, { kind: "network" }, "staff", { consequence }), net);
  const readSlow = `${pullFailureMessage({ kind: "timeout" })}; ${consequence}.`;
  assert.equal(siteFailureText(readSlow, { kind: "timeout" }, "staff", { consequence, read: true }), readSlow);
  assert.equal(siteFailureText(pushFailureMessage({ kind: "timeout" }, consequence), { kind: "timeout" }, "staff", { consequence }), SOLD_OUT_TEXT.siteSlow);
  const stale = { kind: "http", status: 409, error: "stale" } as const;
  assert.equal(siteFailureText("Bu ürün sitede bu arada değişti.", stale, "staff", { consequence }), "Bu ürün sitede bu arada değişti.");
  assert.equal(staffSiteText(), STAFF_SITE_ERROR);
  // Çekirdek iki yolda da rolü ve sonucu verir (okuma da: önceden yöneticinin metniyle dönüyordu)
  const core = read("src/server/site-menu/sold-out-core.ts");
  assert.match(core, /siteFailureText\(e\.message, e\.cause as PushFailure \| undefined, me\.role, \{ consequence \}\)/);
  assert.match(core, /siteFailureText\(`\$\{e\.message\}; \$\{consequence\}\.`, e\.failure, me\.role, \{ consequence, read: true \}\)/);
  assert.equal([...core.matchAll(/await liveItem\(me, secret, c\.id, /g)].length, 2);
});

test("kasa e-postası: personel nedenini (Resend anahtarı, alıcılar) görmez; kayıtlı satır, gönderim ve yeniden deneme", () => {
  const raw = "E-posta kurulmamış (RESEND_API_KEY); rapor kaydedildi, WhatsApp ile gönderebilirsiniz.";
  assert.equal(emailErrorFor("admin", raw), raw);
  assert.equal(emailErrorFor("staff", raw), STAFF_EMAIL_ERROR);
  assert.equal(emailErrorFor("staff", null), null);
  assert.doesNotMatch(STAFF_EMAIL_ERROR, SETUP_DETAIL);
  assert.equal(emailFailedLine(STAFF_EMAIL_ERROR), STAFF_EMAIL_ERROR, "personelin satırı tekrar etmez");
  assert.equal(emailFailedLine(raw), `E-posta gitmedi: ${raw}`);
  assert.equal(emailFailedLine(null), "E-posta gitmedi: bilinmeyen hata");
  const actions = read("src/server/actions/cash-report.ts");
  assert.match(fnBody(actions, "submitCashReport"), /email: outcomeFor\(me\.role, email\),/);
  assert.match(fnBody(actions, "resendCashReportEmail"), /return outcomeFor\(me\.role, email\);/);
  assert.match(actions, /^const outcomeFor = /m, "dışa açılmaz");
  // Kayıtlı raporun DTO'su: personelinki sabit metin (sayfa, son 7 gün)
  assert.match(read("src/server/data/cash-reports.ts"), /emailError: emailErrorFor\(audience, r\.emailError\),/);
  assert.match(read("src/app/panel/kasa/cash-form.tsx"), /text: emailFailedLine\(error\)/);
});

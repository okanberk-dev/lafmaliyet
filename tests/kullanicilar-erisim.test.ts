// "Giriş bilgileri" penceresi ve mesajı: yeni kullanıcı, davetliye parola, parola değişikliği ve yenilenen bağlantı
// için ayrı metin; geçerli bağlantı varken yenisinden önce sorulan soru; e-postanın ortak tasarımı (email-kit).
// Çalıştırma: npm test

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ACCESS_REASONS,
  accessEmail,
  accessSheetText,
  accessSubject,
  credentialsText,
  linkAccessInfo,
  linkReason,
  relinkText,
  type AccessInfo,
} from "../src/app/panel/kullanicilar/access";

const URL_BASE = "https://ladmin.laffogato.net";
const RAW = "a".repeat(43);
const pw: AccessInfo = { kind: "password", userId: 7, name: "Ayşe Yılmaz", email: "ayse@laffogato.net", loginUrl: `${URL_BASE}/giris`, password: "hT7a-Ln3e-R4dy" };
const invite = linkAccessInfo(URL_BASE, { id: 7, name: "Ayşe Yılmaz", email: "ayse@laffogato.net" }, "invite", RAW, new Date("2026-10-23T11:30:00Z"));
const reset: AccessInfo = { ...invite, kind: "reset" };

test("pencere başlığı ve açıklaması: her durumun kendi metni", () => {
  const texts = [
    accessSheetText({ ...pw, reason: "new" }),
    accessSheetText({ ...pw, reason: "set" }),
    accessSheetText({ ...pw, reason: "changed" }),
    accessSheetText({ ...invite, reason: "new" }),
    accessSheetText({ ...invite, reason: "renewed" }),
    accessSheetText({ ...reset, reason: "new" }),
    accessSheetText({ ...reset, reason: "renewed" }),
  ];
  assert.equal(new Set(texts.map((t) => t.description)).size, texts.length, "açıklamalar birbirinden farklı");

  // Yalnızca gerçekten yeni eklenen kişide "eklendi" yazar
  assert.match(texts[0].description, /^Ayşe Yılmaz eklendi\./);
  assert.match(texts[3].description, /^Ayşe Yılmaz eklendi\./);
  for (const i of [1, 2, 4, 5, 6]) assert.doesNotMatch(texts[i].description, /eklendi/, texts[i].description);

  assert.equal(texts[2].title, "Yeni giriş bilgileri");
  assert.match(texts[1].description, /parola belirlendi; davet bağlantısı artık çalışmaz/);
  assert.equal(texts[4].title, "Yeni davet bağlantısı");
  assert.match(texts[4].description, /önceki bağlantı artık çalışmaz/);
  assert.equal(texts[6].title, "Yeni sıfırlama bağlantısı");
  assert.match(texts[6].description, /önceki bağlantı artık çalışmaz/);
  // Gerekçesi yazılmamış eski çağrı "yeni kullanıcı" gibi davranır
  assert.deepEqual(accessSheetText(pw), texts[0]);
});

test("kopyalanan / WhatsApp mesajı: var olan kişiye 'hesabınız açıldı' denmez", () => {
  const first = (info: AccessInfo) => credentialsText(info).split("\n")[0];
  assert.equal(first({ ...pw, reason: "new" }), "Merhaba Ayşe, L'Affogato yönetim paneline hesabınız açıldı.");
  // Davetli ilk kez parola alıyor: hesabı şimdi açılıyor
  assert.equal(first({ ...pw, reason: "set" }), "Merhaba Ayşe, L'Affogato yönetim paneline hesabınız açıldı.");
  assert.equal(first({ ...pw, reason: "changed" }), "Merhaba Ayşe, L'Affogato yönetim paneli parolanız değiştirildi. Yeni giriş bilgileriniz:");

  assert.equal(first({ ...invite, reason: "new" }), "Merhaba Ayşe, L'Affogato yönetim paneline davet edildiniz.");
  const renewedInvite = credentialsText({ ...invite, reason: "renewed" });
  assert.doesNotMatch(renewedInvite, /davet edildiniz/);
  assert.match(renewedInvite.split("\n")[0], /yeni davet bağlantınız.*Daha önce gönderilen bağlantı artık çalışmaz/);
  assert.ok(renewedInvite.includes(`${URL_BASE}/davet?t=${RAW}`));

  assert.equal(first({ ...reset, reason: "new" }), "Merhaba Ayşe, L'Affogato yönetim paneli için parola sıfırlama bağlantınız:");
  assert.match(first({ ...reset, reason: "renewed" }), /yeni parola sıfırlama bağlantınız \(daha önce gönderilen bağlantı artık çalışmaz\)/);

  // Her mesajda adres ve e-posta durur
  for (const info of [pw, invite, reset]) {
    for (const reason of ACCESS_REASONS) {
      const text = credentialsText({ ...info, reason });
      assert.ok(text.includes(`Panel: ${URL_BASE}/giris`), `${info.kind}/${reason}`);
      assert.ok(text.includes("E-posta: ayse@laffogato.net"), `${info.kind}/${reason}`);
    }
  }
});

test("e-posta konusu ve girişi gerekçeye uyar", () => {
  assert.equal(accessSubject({ kind: "password", reason: "changed" }), "L'Affogato paneli: yeni parolanız");
  assert.equal(accessSubject({ kind: "password", reason: "set" }), "L'Affogato paneline hoş geldiniz");
  assert.equal(accessSubject({ kind: "password" }), "L'Affogato paneline hoş geldiniz");
  const renewed = accessEmail({ ...invite, reason: "renewed" });
  assert.ok(renewed.html.includes("yeni davet bağlantınız hazır"));
  assert.ok(renewed.html.includes("Daha önce gönderilen bağlantı artık çalışmaz"));
  assert.equal(renewed.text, credentialsText({ ...invite, reason: "renewed" }));
  assert.ok(!accessEmail(invite).html.includes("artık çalışmaz"));
  assert.ok(accessEmail({ ...reset, reason: "renewed" }).html.includes("Daha önce gönderilen bağlantı artık çalışmaz"));
});

test("bağlantının gerekçesi: davetliye her zaman yenisi, sıfırlamada yalnızca geçerli bağlantı varken", () => {
  assert.equal(linkReason("invite", true), "renewed");
  assert.equal(linkReason("invite", false), "renewed");
  assert.equal(linkReason("reset", true), "renewed");
  assert.equal(linkReason("reset", false), "new");
});

test("yeni bağlantıdan önceki soru: eskisinin son geçerliliği ve hemen çalışmaz olacağı yazar", () => {
  const until = "23.10.2026 14:30";
  const inv = relinkText({ name: "TEST Davetli", invite: "pending", liveLink: { kind: "invite", until } });
  assert.equal(inv.title, "TEST Davetli için yeni davet bağlantısı oluşturulsun mu?");
  assert.ok(inv.description.includes(`(son geçerlilik ${until}) hemen çalışmaz olur`));
  assert.match(inv.description, /hatırlatmak istiyorsanız daha önce gönderdiğiniz mesajı yeniden iletin/);

  const rs = relinkText({ name: "TEST Personel", invite: "none", liveLink: { kind: "reset", until } });
  assert.equal(rs.title, "TEST Personel için yeni sıfırlama bağlantısı oluşturulsun mu?");
  assert.ok(rs.description.includes(`(son geçerlilik ${until}) hemen çalışmaz olur`));
  assert.match(rs.description, /mevcut parolası değişmez/);

  // Davetli "Parolamı unuttum"dan sıfırlama bağlantısı almış olsa da yenisi davet bağlantısıdır
  assert.match(relinkText({ name: "X", invite: "pending", liveLink: { kind: "reset", until } }).title, /davet bağlantısı/);
});

test("davet, sıfırlama ve hoş geldin e-postası ortak tasarımda (email-kit): kabuk, kitin h1'i, ana eylem düğmesi, içerik korunur", () => {
  const src = readFileSync("src/app/panel/kullanicilar/access.ts", "utf8");
  assert.match(src, /from "@\/lib\/email-kit"/);
  assert.doesNotMatch(src, /#[0-9a-fA-F]{3,6}\b/, "renk yalnız kitten (C)");
  assert.doesNotMatch(src, /const esc = |<!doctype/i, "kaçış ve kabuk kitten (esc, emailShell)");

  const attr = (v: string) => v.replace(/'/g, "&#39;");
  const reRaw = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const base of [pw, invite, reset]) {
    for (const reason of ACCESS_REASONS) {
      const info: AccessInfo = { ...base, reason };
      const tag = `${info.kind}/${reason}`;
      const { subject, html, text } = accessEmail(info);
      assert.equal(subject, accessSubject(info), tag);
      assert.equal(text, credentialsText(info), tag);
      assert.ok(html.includes(`<title>${attr(subject)}</title>`), tag);
      assert.match(html, /<h1 class="em-h1"[^>]*>Merhaba Ayşe<\/h1>/, tag);
      // Kabuğun telefon ayarı ve 600 px'lik kart
      assert.ok(html.includes("@media only screen and (max-width:620px)") && html.includes("max-width:600px"), tag);
      // Giriş bilgileri: panel adresi bağlantı, e-posta açık
      assert.ok(html.includes(`<a href="${URL_BASE}/giris" `) && html.includes(`>${URL_BASE}/giris</a>`), tag);
      assert.ok(html.includes(">ayse@laffogato.net</div>"), tag);
      assert.ok(html.includes("Bu e-posta L&#39;Affogato yönetim panelinden gönderildi. Bilgileri kimseyle paylaşmayın."), tag);
      // Ana eylem kitin tam genişlik düğmesi
      const [href, label] =
        info.kind === "password"
          ? [`${URL_BASE}/giris`, "Panele giriş yap"]
          : [`${URL_BASE}/davet?t=${RAW}`, info.kind === "invite" ? "Parolamı belirle" : "Yeni parola belirle"];
      assert.match(html, new RegExp(`<a href="${reRaw(href)}" style="display:block;[^"]*">${label}</a>`), tag);
      // E-posta istemcisi: tablo düzeni, satır içi stil; Outlook'ta bozulan flex / grid / konumlama ve görsel yok
      assert.doesNotMatch(html, /display:\s*(flex|grid)|position:|float:|<img|<svg/i, tag);
    }
  }

  // Parola: kendi alanında, ön izleme satırında ve başlıkta yok (kilit ekranında görünmesin)
  const p = accessEmail(pw).html;
  assert.ok(p.includes(">hT7a-Ln3e-R4dy</div>"));
  const preheader = p.match(/<div style="display:none;max-height:0;max-width:0[^>]*>([^<]*)/)?.[1] ?? "";
  assert.ok(preheader.startsWith("L&#39;Affogato yönetim paneline hesabınız açıldı. Giriş bilgileriniz:"), preheader);
  assert.ok(!preheader.includes("hT7a") && !p.slice(0, p.indexOf("<body")).includes("hT7a"));
  assert.ok(p.includes("Giriş yaptıktan sonra Hesabım&#39;dan parolanızı değiştirebilir, iki adımlı doğrulamayı açabilirsiniz."));
  assert.ok(accessEmail({ ...pw, reason: "changed" }).html.includes("L&#39;Affogato yönetim paneli parolanız değiştirildi. Yeni giriş bilgileriniz:"));

  // Bağlantılı e-posta: tek kullanımlık notu, son geçerlilik, kopyalanacak adres; parola alanı yok
  for (const info of [invite, reset]) {
    const h = accessEmail(info).html;
    assert.match(h, /Bağlantı tek kullanımlıktır; son geçerlilik: <strong[^>]*>23 Ekim 2026 Cuma 14:30<\/strong>\./, info.kind);
    assert.ok(h.includes("Düğme çalışmazsa bu adresi tarayıcıya yapıştırın:"), info.kind);
    assert.ok(h.includes(`>${URL_BASE}/davet?t=${RAW}</td>`), info.kind);
    assert.ok(!h.includes(">Parola</div>"), info.kind);
  }
  assert.ok(accessEmail(invite).html.includes("L&#39;Affogato yönetim paneline davet edildiniz. Aşağıdaki düğmeyle parolanızı kendiniz belirleyin."));
  assert.ok(accessEmail(reset).html.includes("Panel parolanızı sıfırlamak için bir bağlantı istendi. Aşağıdaki düğmeyle yeni parolanızı belirleyin."));
  assert.ok(
    accessEmail({ ...invite, reason: "renewed" }).html.includes(
      "L&#39;Affogato yönetim paneli için yeni davet bağlantınız hazır. Daha önce gönderilen bağlantı artık çalışmaz. Aşağıdaki düğmeyle parolanızı kendiniz belirleyin.",
    ),
  );
  assert.ok(
    accessEmail({ ...reset, reason: "renewed" }).html.includes(
      "Panel parolanızı sıfırlamak için bir bağlantı istendi. Daha önce gönderilen bağlantı artık çalışmaz. Aşağıdaki düğmeyle yeni parolanızı belirleyin.",
    ),
  );
  assert.ok(accessEmail(reset).html.includes("Bu isteği siz yapmadıysanız e-postayı yok sayın; parolanız değişmez."));
  assert.ok(!accessEmail(invite).html.includes("yok sayın"));
  // Son geçerliliği bilinmeyen bağlantı: yalnız "tek kullanımlık"
  assert.ok(accessEmail({ ...invite, expiresAt: undefined }).html.includes("Bağlantı tek kullanımlıktır.</p>"));

  // Kullanıcı metni her yerde kaçışlı: ad (başlık), e-posta, parola, adres
  const evil = accessEmail({ ...pw, name: `<img src=x onerror=alert(1)>`, email: `"a"@x.com`, password: "<b>p</b>", loginUrl: `${URL_BASE}/giris?a="b"` }).html;
  assert.ok(!evil.includes("<img") && !evil.includes("<b>p"));
  assert.ok(evil.includes("Merhaba &lt;img"));
  assert.ok(evil.includes("&quot;a&quot;@x.com") && evil.includes("&lt;b&gt;p&lt;/b&gt;"));
  assert.ok(evil.includes(`href="${URL_BASE}/giris?a=&quot;b&quot;"`));
  // Tek kullanımlık bağlantı da: düğmenin href'i ve kopyalanacak adres kutusu
  const evilLink = accessEmail({ ...invite, link: `${URL_BASE}/davet?t=a"b<i>c` }).html;
  assert.ok(!evilLink.includes("<i>c"));
  assert.ok(evilLink.includes(`<a href="${URL_BASE}/davet?t=a&quot;b&lt;i&gt;c" `));
  assert.ok(evilLink.includes(`>${URL_BASE}/davet?t=a&quot;b&lt;i&gt;c</td>`));
});

// "Giriş bilgileri" penceresi ve mesajı: yeni kullanıcı, davetliye parola, parola değişikliği ve yenilenen bağlantı
// için ayrı metin; geçerli bağlantı varken yenisinden önce sorulan soru.
// Çalıştırma: npm test

import assert from "node:assert/strict";
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

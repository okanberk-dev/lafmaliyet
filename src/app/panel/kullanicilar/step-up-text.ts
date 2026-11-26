/*
 * Kullanıcılar'daki parola onayı penceresinin metinleri (kural src/lib/step-up.ts'te). Saf modül: testler doğrudan
 * çalıştırır. Her açıklama aynı cümleyle biter; neyin onaylandığı başlıkta ya da açıklamada adıyla yazar.
 */

import { twoFactorResetText } from "@/lib/admin-security";
import type { StepUpChange } from "@/lib/step-up";

import { relinkText } from "./access";

export const STEP_UP_CLOSING = "Onaylamak için kendi parolanızı girin.";
/** Silme sorusunun açıklaması (personelde onay penceresi de aynısını yazar) */
export const DELETE_TEXT = "Hesap kalıcı olarak silinir, geri alınamaz; işlem geçmişindeki kayıtları durur. Yalnızca girişini durdurmak istiyorsanız Pasif yapın.";

export type StepUpText = { title: string; description: string; confirmLabel: string; danger: boolean };

type Target = {
  name: string;
  email: string;
  invite: "none" | "pending" | "expired";
  liveLink: { kind: "invite" | "reset"; until: string } | null;
};

export type StepUpTextCase =
  /** Kullanıcı ekle, rol Yönetici */
  | { kind: "create"; name: string; mode: "password" | "invite" }
  /** Düzenleme penceresinde Kaydet: `name` ve `email` formdaki yeni değerler */
  | { kind: "save"; user: Target; changes: StepUpChange[]; name: string; email: string }
  /** Listedeki aktif / pasif anahtarı (yönetici satırı) */
  | { kind: "toggle"; name: string; active: boolean; invite: Target["invite"] }
  | { kind: "link"; user: Target }
  /** `required`: yöneticide iki adımlı zorunlu (src/lib/admin-security.ts); kişi girişte kurulum ekranına gider */
  | { kind: "2fa"; required?: boolean }
  | { kind: "delete"; name: string }
  /** Sunucu parola istedi ama istemcinin kuralı beklemiyordu (eski satır, rol başka sekmede değişmiş) */
  | { kind: "fallback" };

const close = (...sentences: string[]) => [...sentences, STEP_UP_CLOSING].join(" ");

function changeSentence(change: StepUpChange, changes: StepUpChange[], name: string, user: Target, email: string): string {
  const password = changes.includes("password");
  switch (change) {
    case "promote": {
      const promote = `${name} yönetici olacak: maliyet, kâr, ayarlar ve kullanıcılar dahil her şeyi görür.`;
      // Sunucu yönetici yapınca geçerli bağlantıyı iptal eder; parola da belirleniyorsa bağlantı zaten anlamsız
      if (!user.liveLink || password) return promote;
      return user.liveLink.kind === "invite"
        ? `${promote} Gönderilen davet bağlantısı iptal olur; yenisini oluşturmanız gerekir.`
        : `${promote} Geçerli parola sıfırlama bağlantısı iptal olur.`;
    }
    case "demote":
      return `${name} artık yönetici olmayacak (personel).`;
    case "deactivate":
      return `${name} pasif olacak: giriş yapamaz, açık oturumları kapanır.`;
    case "activate":
      // Pasif yapılınca davet bağlantısı da iptal olmuştu; davetliye aynı kayıtta parola verilirse bağlantı gerekmez
      return user.invite === "none" || password ? `${name} yeniden giriş yapabilecek.` : `${name} yeniden aktif olacak; giriş için yeni davet bağlantısı gerekir.`;
    case "email":
      return `Giriş e-postası ${user.email} yerine ${email.trim().toLowerCase()} olacak.`;
    case "password":
      if (user.invite === "none") return `${name} kullanıcısının parolası değişecek; açık oturumları kapanır.`;
      return user.liveLink ? `${name} için parola belirlenecek; davet bağlantısı çalışmaz olur.` : `${name} için parola belirlenecek.`;
  }
}

export function stepUpText(c: StepUpTextCase): StepUpText {
  switch (c.kind) {
    case "create":
      return {
        title: `${c.name.trim()} yönetici olarak eklensin mi?`,
        description: close("Yönetici maliyet, kâr, ayarlar ve kullanıcılar dahil her şeyi görür ve değiştirir."),
        confirmLabel: c.mode === "password" ? "Yöneticiyi ekle" : "Ekle ve bağlantı oluştur",
        danger: false,
      };
    case "save": {
      const name = c.name.trim() || c.user.name;
      return {
        title: "Değişiklikleri onaylayın",
        description: close(...c.changes.map((ch) => changeSentence(ch, c.changes, name, c.user, c.email))),
        confirmLabel: "Kaydet",
        danger: c.changes.includes("deactivate") || c.changes.includes("demote"),
      };
    }
    case "toggle":
      return c.active
        ? {
            title: `${c.name} yeniden aktif yapılsın mı?`,
            // Davetlinin bağlantısı pasif yapılınca iptal olmuştu, parolası da yok
            description: close(
              c.invite === "none" ? "Bu yönetici hesabıyla yeniden giriş yapılabilir." : "Hesap yeniden aktif olur; giriş için yeni davet bağlantısı oluşturmanız gerekir.",
            ),
            confirmLabel: "Aktif yap",
            danger: false,
          }
        : {
            title: `${c.name} pasif yapılsın mı?`,
            description: close("Bu kullanıcı bir daha giriş yapamaz, açık oturumları kapanır. Bilgileri silinmez; istediğiniz zaman yeniden aktif yapabilirsiniz."),
            confirmLabel: "Pasif yap",
            danger: true,
          };
    case "link": {
      const invite = c.user.invite !== "none";
      const risk = invite ? "Bağlantıyı alan kişi yönetici olarak giriş yapabilir." : "Bağlantıyı alan kişi bu yönetici hesabına yeni parola belirleyebilir.";
      // Geçerli bağlantı varken "eskisi çalışmaz olur" sorusu da burada: ayrıca bir onay penceresi açılmaz
      if (c.user.liveLink) {
        const relink = relinkText(c.user);
        return { title: relink.title, description: close(relink.description, risk), confirmLabel: "Bağlantı oluştur", danger: false };
      }
      return {
        title: invite ? `${c.user.name} için yeni davet bağlantısı oluşturulsun mu?` : `${c.user.name} için parola sıfırlama bağlantısı oluşturulsun mu?`,
        description: close(risk),
        confirmLabel: "Bağlantı oluştur",
        danger: false,
      };
    }
    case "2fa":
      return {
        title: "İki adımlı doğrulama sıfırlansın mı?",
        description: close(twoFactorResetText(c.required === true)),
        confirmLabel: "Sıfırla",
        danger: true,
      };
    case "delete":
      return {
        title: `${c.name} silinsin mi?`,
        description: close(DELETE_TEXT),
        confirmLabel: "Kalıcı olarak sil",
        danger: true,
      };
    case "fallback":
      return {
        title: "Parolanızla onaylayın",
        description: close("Bu işlem bir yönetici hesabını etkiliyor."),
        confirmLabel: "Onayla",
        danger: false,
      };
  }
}

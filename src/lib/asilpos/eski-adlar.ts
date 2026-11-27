/**
 * Eski adlar. Kafenin kasa programının adı 26 Kasım 2026'da LafPOS'tan AsilPOS'a döndü (sahibin kararı). Buradaki
 * değerler eski adla durur, çünkü kurulu kasada (kurulum kodunun ucu, telin alanları), veritabanında (eski satırlar,
 * kilitler, gönderim kayıtları), Vercel'in ortam değişkenlerinde, Resend'in yinelenme anahtarlarında ya da kâğıt
 * fotoğraflarında yazılıdır: biri değişirse kurulu kasa, canlıdaki eski sürüm, geri dönüş ya da geçmiş kayıtlar bozulur.
 * Kural (plan A1): eski ve yeni ad birlikte okunur, yazılan eski addır; yeni ada yazmak sonraki temizlik PR'ının (A3)
 * işi.
 *
 * Eski ad TypeScript dosyalarında yalnız burada yazılır; öbürleri değeri buradan alır. Belgeler eski adı yalnız
 * `ESKI_AD_METINLERI` ve `BELGE_ALINTILARI`'ndaki metinlerle yazar. tests/asilpos-adi.test.ts bunu denetler; ad
 * değişikliği betiği de bu metinleri maskeleyip korur. Kasa tarafının listesi: AsilPOS deposunda shared/eski-adlar.ts.
 */

/** Ürünün eski görünen adı ("eski adı" açıklamaları, eski kâğıt ve eski satırlar için) */
export const ESKI_URUN_ADI = "LafPOS";

/** README ve docs/ASILPOS.md'nin ilk satırı */
export const AD_DEGISIKLIGI_NOTU = `AsilPOS (26 Kasım 2026'ya kadar adı ${ESKI_URUN_ADI})`;

// ─── Ortam değişkenleri ──────────────────────────────────────────────────────

/**
 * Vercel'deki değişkenlerin eski öneki: sahip yeni adları ekleyene kadar `LAFPOS_SYNC_SECRET` ve isteğe bağlı CLOUD /
 * SITE / KURUCU değişkenleri bu adla durur. Okuma `ASILPOS_X ?? LAFPOS_X` (src/lib/asilpos/env.ts posEnv)
 */
export const ESKI_ENV_ONEKI = "LAFPOS_";

// ─── Uçlar (kurulu kasa ve e-postadaki bağlantılar) ──────────────────────────

/** Kurulum kodunun eski ucu: kurulu ve eski kasalar bunu çağırır (yenisi /api/asilpos/kurulum, aynı işleyici) */
export const ESKI_KURULUM_YOLU = "/api/lafpos/kurulum";
/** Kurucu indirme bağlantısının eski yolu: gönderilmiş e-postalar ve Hesabım'daki eski bağlantılar (14 gün) */
export const ESKI_INDIR_YOLU = "/lafpos/indir";
/** Kasanın güncelleme kanalının alan adı (kanal yeniden adlandırılmadı) */
export const KANAL_ALANI = "lafpos.laffogato.net";
/** Kanaldaki genel kurucunun eski adı: kanal yeni adı yayımlamadıysa bu indirilir */
export const ESKI_WEB_KURUCU = "LafPOS-Kur.cmd";

// ─── Tel (POST /api/pos/gun, devir, bağlantılar) ─────────────────────────────

/**
 * Gün sonu gövdesinin `source`'u ve devrin `nextOpening.source`'u. Panel ikisini de kabul eder, devirde eskisini
 * gönderir: eski kasa bilinmeyen değerde devri bütünüyle reddeder
 */
export const TEL_KAYNAK = "lafpos" as const;
/** `bankPos` içindeki kasa kartı toplamının alanı (gövde ve pos_day_reports.bank_pos satırları) */
export const TEL_KART_ALANI = "lafposCard" as const;
/**
 * Kasaya gönderilen Uzaktan bağlantısının anahtarları (`baglanti{}`): kurulu kasanın beyaz listesi bu adları tanır,
 * `surum` özeti de adları kapsar; değişirse her kasa ayarını yeniden yazıp yeniden başlar
 */
export const TEL_UZAK_ADRES_ENV = "LAFPOS_CLOUD_URL";
export const TEL_UZAK_ANAHTAR_ENV = "LAFPOS_CLOUD_SECRET";

// ─── Öbür projelerdeki anahtarlar (anahtar uyumu; docs/ASILPOS.md › Anahtar değişimi) ──

/**
 * AsilPOS Uzaktan'ın Vercel projesi (lafpos.laffogato.net; proje yeniden adlandırılmadı). Kasanın Uzaktan anahtarı
 * orada `TEL_UZAK_ANAHTAR_ENV` adıyla durur (Uzaktan önce yeni adı, yoksa bunu okur)
 */
export const UZAKTAN_PROJESI = "lafpos";
/** Anahtar değişiminde Uzaktan'ın bir önceki kasa anahtarı (geçişte ikisi de kabul edilir) */
export const UZAK_ONCEKI_ENV = `${TEL_UZAK_ANAHTAR_ENV}_ONCEKI`;
/**
 * Sitenin (laffogato) kasa anahtarı: sitede bu adla durur (kasada `LAFFOGATO_SYNC_SECRET`, panelde ASILPOS_SITE_SECRET);
 * panelin kendi eşitleme anahtarının eski adıyla aynı ad, değeri ayrı
 */
export const SITE_KASA_ANAHTAR_ENV = `${ESKI_ENV_ONEKI}SYNC_SECRET`;
/** Anahtar değişiminde sitenin bir önceki kasa anahtarı */
export const SITE_KASA_ONCEKI_ENV = `${SITE_KASA_ANAHTAR_ENV}_ONCEKI`;

// ─── Veritabanında duran değerler ────────────────────────────────────────────

/** branches.pos_source ve pos_day_reports.source: yazılan eski değer, okunurken yenisine çevrilir */
export const ESKI_KASA_KAYNAGI = "lafpos" as const;
/** integration_state anahtarı (bağlantının durumu) */
export const DURUM_ANAHTARI = "lafpos";
/** settings tablosundaki eski genel geçiş günü kaydı (migration 0079 da okur) */
export const GECIS_GUNU_AYARI = "lafposGecisGunu";
/** branch_settings.grp: geçiş günü ve panelde saklanan anahtar; grubun yazım kilidi `branch_settings:<bu>` */
export const SUBE_AYAR_GRUBU = "pos.lafpos";
/** Kurulum kodunun şifreleme amacı (lafpos_installs.token_sealed; değişirse bekleyen bağlantılar açılmaz) */
export const KURULUM_SIFRE_AMACI = "lafpos-kurulum";
/** Gün sonunun danışma kilidi (`<önek><şube>:<gün>`): eski ve yeni sunucu örnekleri aynı kilidi almalı */
export const GUN_KILIDI_ONEKI = "lafpos-gun:";
/**
 * notification_log anahtarlarının önekleri (e-postanın bir kez gitmesi; gece işi son 7 günü yeniden dener). Resend'in
 * yinelenme anahtarı da bunlardan türer (`:` yerine `-`): 24 saat içinde aynı e-posta ikinci kez gitmez
 */
export const BILDIRIM_ONEKI = {
  gun: "lafpos-gun:",
  pavo: "lafpos-pavo:",
  foto: "lafpos-foto:",
  calisan: "lafpos-gun-calisan:",
} as const;
/** Gün sonu ve Pavo e-postalarının Resend yinelenme anahtarlarının önekleri */
export const RESEND_ONEKI = { gun: "lafpos-gun-", pavo: "lafpos-pavo-" } as const;
/** Otomatik kasa raporunun yazarı (cash_reports.submitted_by_name, activity_log.user_name) */
export const OTOMATIK_YAZAR = `${ESKI_URUN_ADI} (otomatik)`;
/** Kasadan çıkanlar'a kasadan gelen satırın yazarı (cash_outs.created_by_name) */
export const KASA_YAZARI = ESKI_URUN_ADI;
/**
 * Gün sonu fotoğrafının karşılaştırmasında (asilpos_day_ends.photo_check, `rows[]`) AsilPOS'taki değerin alanı: 24
 * Kasım 2026'dan beri saklanan satırlar ve canlıdaki eski sürüm bu adı okur. Şema okurken yeni alana (`asilpos`)
 * çevirir, yazarken buna (src/lib/asilpos/foto-kayit.ts)
 */
export const FOTO_SATIR_ALANI = "lafpos";
/** Eski tablolar: migration 0098'de yeni ada taşındı, eski adla görünüm (view) kaldı (canlıdaki eski sürüm için) */
export const ESKI_TABLOLAR = { kurulum: "lafpos_installs", gunSonu: "lafpos_day_ends" } as const;
/** Eski sütunlar: yeni sütunla tetikleyiciyle eşit tutulur (eski sürüm yazar) */
export const ESKI_SUTUNLAR = { kasaHareketi: "lafpos_id", hizmet: "lafpos_service" } as const;

// ─── Asistan ve panel ────────────────────────────────────────────────────────

/** Onay kartının etkisi (assistant_ops.preview ve cihazdaki sohbetler): eski kartlar da adla görünür */
export const ESKI_ETKI = "lafpos" as const;
/** Asistanın okuma aracının eski adı (cihazdaki sohbetler, tekrar oynatma) */
export const ESKI_ARAC_ADI = "lafpos_durumu" as const;
/**
 * Zil bildirimlerinin kimliğindeki eski ad (`<bu>-ret-…`, `<bu>-foto-…`, `kasa-<bu>-…`): cihazda okundu sayılanlar
 * (tarayıcıda saklanan kimlikler) ad değişikliğinden sonra yeniden okunmamış görünmesin
 */
export const ZIL_ONEKI = "lafpos";
/** Ayarlar'daki bölümün eski çapası (yer imleri, eski bağlantılar): `#lafpos` */
export const ESKI_BOLUM_CAPASI = "lafpos" as const;

// ─── Kâğıt (fotoğraf okuması) ────────────────────────────────────────────────

/**
 * Kasanın kâğıdında basılı eski ad (büyük harf, katlanmış metin): eski kasalar ve eski fotoğraflar. Banka kısmının
 * kıyas başlığı AsilPOS #189'a kadar eski adla basılır ("PAVO - LAFPOS KARŞILAŞTIRMA"), sonra yeni adla ("PAVO - ASILPOS
 * KARŞILAŞTIRMA"); okuma ikisini de tanır
 */
export const ESKI_KAGIT_ADI = "LAFPOS";

// ─── Denetim (tests/asilpos-adi.test.ts) ─────────────────────────────────────

/** İki depoda bayt bayt aynı hesap sözleşmesi: dosyanın tamamı eski adla kalır (SHA-256 iki depoda sabit) */
export const HESAP_SOZLESMESI = "docs/hesap-sozlesmesi.md";
/** Gönderilmiş migration'ların etiketleri (`0095_lafpos_kurulum`): dosya adları, günlük ve yedeğin geri yüklemesi */
export const ESKI_GOC_ETIKETI = /\d{4}_lafpos_[a-z_]+/g;
/**
 * Belgelerdeki eski git dalları (`<önek>/denetim-b07-lafpos-durum`, `<önek>/lafpos-baglantisi`): dallar ve geçmiş
 * değişmez, adları eski adla kalır. Yalnız ters tırnak içinde, öneki tek parça (dosya yolu eşleşmez)
 */
export const ESKI_DAL_ADI = /`[a-z]+\/(?:denetim-b\d+-)?lafpos-[a-z-]+`/g;

/**
 * TypeScript dışındaki dosyalarda (belgeler, betikler, örnek ortam dosyası) eski adın geçebildiği metinler. Satırdan
 * bunlar (ve migration etiketleri) çıkarılınca eski ad kalmamalı. Eski adlı ortam değişkeni ayrıca: aynı satırda yeni
 * adıyla (`ASILPOS_X`) birlikte yazılır ya da `ESKI_ENV_ADLARI`'ndadır
 */
export const ESKI_AD_METINLERI: readonly string[] = [
  ESKI_KURULUM_YOLU,
  ESKI_INDIR_YOLU,
  KANAL_ALANI,
  ESKI_WEB_KURUCU,
  TEL_KART_ALANI,
  SUBE_AYAR_GRUBU,
  KURULUM_SIFRE_AMACI,
  ...Object.values(BILDIRIM_ONEKI),
  ...Object.values(ESKI_TABLOLAR),
  ...Object.values(ESKI_SUTUNLAR),
  GECIS_GUNU_AYARI,
  ESKI_ARAC_ADI,
  OTOMATIK_YAZAR,
  "PAVO - LAFPOS KARŞILAŞTIRMA",
  HESAP_SOZLESMESI,
];

/**
 * Eski adla kalan tam ortam değişkeni adları: kasaya telde bu adla gider ya da öbür projelerde (Uzaktan, site) anahtar
 * değişiminin önceki değeri bu adla durur. Sitenin kasa anahtarı (`SITE_KASA_ANAHTAR_ENV`) burada değil: panelin kendi
 * değişkeninin eski adıyla aynı, belgede yeni adıyla aynı satırda yazılır
 */
export const ESKI_ENV_ADLARI: readonly string[] = [TEL_UZAK_ADRES_ENV, TEL_UZAK_ANAHTAR_ENV, UZAK_ONCEKI_ENV, SITE_KASA_ONCEKI_ENV];

/**
 * Yalnız belgelerde: tırnaktaki tel ve veritabanı değeri, AsilPOS deposunun adı (depo eski adla kaldı), ad değişikliği
 * notu, zil bildiriminin kimliği
 */
export const BELGE_ALINTILARI: readonly string[] = [
  `\`${ZIL_ONEKI}-ret-`,
  `\`${TEL_KAYNAK}\``,
  `"${TEL_KAYNAK}"`,
  `'${TEL_KAYNAK}'`,
  `\`#${ESKI_BOLUM_CAPASI}\``,
  `\`'${KASA_YAZARI}'\``,
  `"${KASA_YAZARI}"`,
  `RiosenBeq/${TEL_KAYNAK}`,
  `okanberk-dev/${TEL_KAYNAK}`,
  `26 Kasım 2026'ya kadar adı ${ESKI_URUN_ADI}`,
  `${ESKI_KAGIT_ADI}|ASILPOS`,
];

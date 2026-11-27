# Hata kaydı (27 Kasım 2026)

Canlıdaki hatalar önceden yalnız Vercel'in çalışma günlüğüne düşüyordu; Hobby planında günlük **bir saat** tutulur
([DEPLOY.md](DEPLOY.md) § 8). "Dün akşam kasa raporu kaydedilmedi" gibi bir sorunun izi ertesi gün yoktu. Artık panel
hataları kendi veritabanında, kısa ömürlü bir tabloda (`error_log`) tutar ve yöneticiye gösterir.

Ekran: **Ayarlar › Hata kaydı** (`/panel/ayarlar#hatalar`; yalnız yönetici). Plan belgesinde "Ayarlar › Sistem" diye
geçen bölüm budur: ayrı bir "Sistem" bölümü yerine adı ne gösterdiğini söylüyor; Günlük işler'in hemen altında.

## 1. Ne kaydedilir

| Kaynak (ekranda) | Nereden | Ne zaman |
|------------------|---------|----------|
| **Sunucu** | Next'in hata kancası (`src/instrumentation.ts` › `onRequestError`) | sayfa, API yolu, sunucu eylemi ya da ara katmanda yakalanmayan her hata. Next'in kendi sinyalleri (yönlendirme, 404, dinamik oluşturma) ve kullanıcının sayfadan çıkmasıyla kesilen bağlantı yazılmaz |
| **İşlem** | `attempt()` (`src/server/actions/util.ts`) | kaydet gibi bir düğmenin "İşlem tamamlanamadı" dediği beklenmeyen hata. Doğrulama hatası, `UserError` ve bilinen veritabanı kısıtları (aynı ad, kullanılan kayıt) yazılmaz: bunlar kullanıcıya zaten okunur bir ileti verir. Sayfa, eylemin çağrıldığı ekranın yolu (Referer) |
| **Tarayıcı** | `src/instrumentation-client.ts` (yakalanmayan hata ve söz) ve hata ekranı (`src/components/panel/error-view.tsx`) → `/api/hata` | yalnız `/panel`'de (oturum açık). Bağlantı kopması ("Failed to fetch", "Load failed"), tarayıcı eklentisinin hatası ve çapraz köken "Script error." gönderilmez. Sunucuda oluşup hata ekranına kodla gelen hata yinelenmez (sunucu kancası yazdı) |
| **CSP** | ihlal raporları (`/api/csp-rapor`) | güvenlik politikasının engellediği (Report-Only'de engelleyeceği) kaynak; § 6 |

Aynı hata **tek satırdır**: kaynak, hatanın adı, iletinin sayıları atılmış hâli ve yolun kalıbı (Next'in `routePath`'i,
ör. `/panel/faturalar/[id]`; yoksa sayısal kesimleri atılmış adres) özetlenir (`fingerprint`). Satır sayısını, ilk ve
son görülüşünü, son iletisini, yolunu ve Next'in hata kodunu taşır. Yığın özete girmez: her yayında satır numaraları
değişir, aynı hata yeni satır açmasın.

## 2. Ekran

- Üstte güvenlik politikasının (CSP) kararı (§ 6), altında **açık satırlar** son görülüşe göre (en çok 50): kaynak
  rozeti (Sunucu ve İşlem kırmızı, Tarayıcı turuncu, CSP gri), kaç kez, son ve ilk görülüş, yol; **Ayrıntı**'da adı,
  yeri (Sayfa / API yolu / Sunucu eylemi, tarayıcı ailesi, CSP kaynağı), **hata kodu** ve yığının ilk satırları.
- **Hata kodu**, kullanıcının "Bir şeyler ters gitti" ekranında gördüğü koddur (Next'in `digest`'i): biri kodu
  söyleyince satır sayfada aranarak bulunur.
- **Çözüldü** satırı açık listeden çıkarır; **Hepsi çözüldü** bütün açık satırları. Hata yeniden görülürse satır
  kendiliğinden yeniden açılır, sayısı sürer. İşlem geçmişine "Hata kaydı" olarak düşer.
- Telefonda kapalı satırın özeti: "Açık hata yok", "Son 24 saatte N sunucu hatası" (kırmızı), "N açık hata"
  (turuncu) ya da "N açık uyarı (CSP)".

## 3. Kişisel veri ve güvenlik

Kayda **giden:** hatanın adı, iletisi, yığının ilk 12 satırı, Next'in hata kodu, yol, bağlam (sayfa / eylem / API yolu
ve istek yöntemi; tarayıcıda yalnız ailesi ve işletim sistemi, ör. "Safari · iOS").

Kayda **gitmeyen:** istek gövdesi, çerezler, başlıklar (oturum, yetki, IP), sorgu dizgesi, kullanıcının kimliği, tam
kullanıcı aracısı. Kanca isteğin başlıklarını hiç okumaz (`requestErrorEntry`).

Her metin yazılmadan önce temizlenir ve kısaltılır (`src/lib/error-log.ts` › `redactText`, `sanitizeEntry`):

- veritabanı hatasının parametre satırı (drizzle'ın `params: …`: kayda gidecek ad, tutar, e-posta) → `[gizli]`;
  postgres'in kendi nedeni ayrı satırda kalır ("relation … does not exist");
- bağlantı adresindeki kullanıcı ve parola, `Bearer` / `Basic`, JWT, `sk-…` / `re_…` gibi API anahtarları,
  `parola=` / `token=` / `secret:` gibi çiftler, 32+ karakterlik harf-rakam karışık dizgiler → `[gizli]` / `[anahtar]`;
- adreslerin sorgu dizgesi ve parçası; yoldaki davet / sıfırlama anahtarı ve UUID → `:anahtar`;
- e-posta → `[e-posta]`, IBAN → `[IBAN]`, 10+ haneli sayılar (telefon, kimlik, kart) → `[sayı]`;
- sunucudaki mutlak dosya yolları `src/`, `.next/`, `node_modules/`'tan başlar; tarayıcıdaki betik adresleri yola iner.

Sınırlar: ileti 500, yol 200, bağlam 200 karakter; yığın 12 satır, satır başına 200, toplam 1.500 karakter.

Tablo yalnız yöneticiye görünür (Ayarlar sayfası ve eylemler `requireAdmin`). **Yedeğe girmez** (`TABLE_RULES.error_log`:
tanı için geçici satırlar).

## 4. Kayıt isteği bozmaz, veritabanını boğmaz

- **Beklenmez:** kayıt yanıtı geciktirmez. Vercel'de işlev, yazım bitene kadar Next'in `waitUntil`'iyle açık kalır;
  yazım en çok 3 saniye beklenir (`WRITE_TIMEOUT_MS`), sonra bırakılır.
- **Kendi hatasını yutar:** kayıt hiçbir zaman fırlatmaz; yazılamazsa günlüğe tek satır (`[hata kaydı] yazılamadı …`,
  yalnız iletinin ilk satırı, parametresiz) düşer. Kayıt kendini kaydetmez (döngü yok).
- **Sunucu örneği başına kapı** (`createWriteGate`): aynı hata 10 saniyede bir yazılır, aradakiler sayılır ve sonraki
  yazıma eklenir; örnek başına dakikada en çok 30 yazım; yazım düşünce (veritabanı yok) bir dakika hiç denenmez. Bu
  yüzden sayı yaklaşıktır: yazılmadan kapanan örneğin bekleyen sayısı kaybolur.
- **Günlük yeni satır sınırı** (İstanbul günü, kaynak başına; `DAILY_NEW_CAP`): sunucu 50, işlem 50, tarayıcı 30, CSP 30
  farklı hata. Aşılınca o günün tek **"Günlük sınır doldu"** satırı sayılır; var olan satırlar artmaya devam eder.
- **Saklama:** sabah işi (`/api/cron/gunluk`, en çok 3 sn, iş adımı değil, sonucu yanıtta `hatalar`) 30 gündür
  görülmeyen satırları siler; tablo 2.000 satırı aşarsa en eski son görülüşten fazlası gider. En kötü durumda tablo
  birkaç MB'tır.
- **Tarayıcı:** sayfa yüklemesi başına en çok 5 gönderim, aynı ileti bir kez. Uç (`/api/hata`) yalnız panelin kendi
  sayfasından (Origin = Host) ve oturumu açık kullanıcıdan kabul eder; gövde en çok 8 KB; kişi başına 10 dakikada en çok
  20 (örnek başına). Yanıt her durumda gövdesiz.
- **CSP ucu** oturum istemez (tarayıcı raporu çerezsiz gönderebilir): gövde en çok 16 KB, örnek başına dakikada en çok
  30 satır, günde en çok 30 yeni CSP satırı. Sahte raporla en çok bu kadar satır açılabilir; panelin işleyişine
  dokunmaz.
- **Neon kotası:** yazım yalnız hata olunca yapılır; hata çoğu zaman zaten açık bir sayfanın isteğinde olduğu için
  veritabanı uyanıktır. Kayıt kapatılmak istenirse (acil durum) Vercel'de `ERROR_LOG_DISABLED=1`: hatalar yalnız
  günlüğe düşer, e-posta gitmez.

## 5. E-posta (günde en çok bir)

**Kritik hata:** Sunucu ya da İşlem kaynağından yazılan hata. Tarayıcı ve CSP satırları e-posta göndermez.

Günün ilk kritik hatasında yöneticilere **sistem uyarısı e-postası** gider (mevcut altyapı:
`src/server/jobs/alerts.ts` › `sendSystemEmail`): yalnız canlıda (`VERCEL_ENV=production`), e-posta açık ve Resend
kuruluysa, sabah e-postasının etkin alıcılarına (personel ve pasif hesap düşer). Konu "L'Affogato · Panelde hata:
<iletinin ilk satırı>"; gövdede kaynak, yer, saat ve hata kodu, ne yapılacağı ve "Hata kaydını aç" düğmesi.

- **Günde bir:** önce `notification_log` anahtarı (`hata-kaydi:<gün>`) alınır; aynı gün ikinci hata, başka bir sunucu
  örneğinde de olsa, e-posta göndermez. Gönderilemezse (Resend hatası) anahtar bırakılır, 10 dakika sonra sonraki
  hatayla yeniden denenir. Gönderilecek adres yoksa ya da e-posta kapalıysa o sunucu örneği o gün yeniden denemez.
- E-posta yalnız haber verir; ayrıntı ve öteki hatalar ekranda.

## 6. CSP_ENFORCE kararı

Güvenlik politikası (CSP, `src/lib/csp.ts`) `CSP_ENFORCE=1` verilene dek Report-Only: tarayıcı engellemez, yalnız
bildirir ([DEPLOY.md](DEPLOY.md) › Güvenlik başlıkları). Raporlar artık kayda da yazıldığı için karar bir saatlik
günlüğe değil kanıta dayanır. Kartın üstündeki satır (`cspVerdict`):

| Durum | Karar |
|-------|-------|
| Son 7 günde panelin kendi kodundan çözülmemiş ihlal var | "henüz uygulanmasın" (turuncu): önce düzeltilir, satırlar Çözüldü işaretlenir |
| İhlal yok ama kayıt 7 günden yeni | "kanıt toplanıyor (N/7 gün)" |
| Kayıt en az 7 gündür tutuluyor, son 7 günde ihlal yok | "uygulanabilir" (yeşil): Vercel'de `CSP_ENFORCE=1`, yeniden yayın |
| Uygulanıyor | son 7 günün engellemeleri, varsa turuncu |

Tarayıcı eklentilerinin ihlali (`chrome-extension://` …) "eklenti" diye işaretlenir ve sayılmaz. Kaydın başlangıcı
`integration_state` › `errors.since`: canlı derleme (`scripts/predeploy.ts`) ve sabah işi yalnız yoksa yazar.

## 7. Sentry (isteğe bağlı; yapılmadı)

Sentry bu PR'da eklenmedi: `@sentry/nextjs` yeni bağımlılık, `next.config.ts` sarmalayıcısı, kaynak haritası yüklemesi
ve CSP'de dış köken (`connect-src`) ister; "DSN verilirse açılır" kadar küçük değil. Sahip Sentry hesabı açarsa ayrı bir
iş: `SENTRY_DSN` ortam değişkeniyle, yalnız DSN varken yüklenen istemci ve sunucu kurulumu, CSP'ye Sentry'nin alım
kökeni, kişisel veri için aynı temizlik (`beforeSend` içinde `redactText`). Panelin kendi kaydı Sentry'den bağımsız
çalışmaya devam eder.

## 8. Dosyalar ve testler

- Kurallar (saf): `src/lib/error-log.ts`; tarayıcı: `src/lib/client-error-report.ts`.
- Veritabanı: `src/server/errors/store.ts` (yazma, okuma, Çözüldü, saklama), `src/server/errors/alert.ts` (e-posta),
  `src/server/errors/action.ts` (`attempt()`); tablo `error_log` (migration `hata_kaydi`).
- Uçlar: `src/instrumentation.ts`, `src/app/api/hata/route.ts`, `src/app/api/csp-rapor/route.ts`.
- Ekran: `src/app/panel/ayarlar/errors-card.tsx`, `errors-client.tsx`; eylemler `src/server/actions/error-log.ts`.
- Testler: `tests/hata-kaydi.test.ts` (temizlik, özet, kanca girdisi, tarayıcı, kapı, CSP kararı, kaydın isteği
  bozmaması), `tests/hata-kaydi-db.test.ts` (gruplama, Çözüldü, günlük sınır, saklama, günde bir e-posta, uçların
  kapıları, `attempt()`, yönetici eylemleri).

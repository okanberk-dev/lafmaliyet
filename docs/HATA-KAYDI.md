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
| **CSP** | ihlal raporları (`/api/csp-rapor`) | güvenlik politikasının engellediği (Report-Only'de engelleyeceği) kaynak; § 6. Tarayıcı eklentisinin ihlali (`chrome-extension://` …) yalnız günlüğe düşer, kayda girmez |

Aynı hata **tek satırdır**: kaynak, hatanın adı, iletinin sayıları atılmış hâli ve yolun kalıbı (Next'in `routePath`'i,
ör. `/panel/faturalar/[id]`; yoksa sayısal kesimleri atılmış adres) özetlenir (`fingerprint`). CSP'de yol özete girmez:
aynı ihlal (yönerge + engellenen kaynak) hangi ekranda olursa olsun tek satırdır, yol son görüldüğü ekrandır. Satır
sayısını, ilk ve son görülüşünü, son iletisini, yolunu ve son beş hata kodunu taşır. Yığın özete girmez: her yayında
satır numaraları değişir, aynı hata yeni satır açmasın.

Veritabanı hatasında ileti **önce asıl nedeni**, sonra sorguyu taşır: `relation "x" does not exist` /
`canceling statement due to statement timeout`, alt satırda `Failed query: select …`. Uzun SQL kısaltmada nedeni
kesmez; e-postanın konusu nedendir; aynı sorgunun farklı nedenleri ayrı satırdır.

## 2. Ekran

- Üstte güvenlik politikasının (CSP) kararı (§ 6), altında **açık satırlar** son görülüşe göre (en çok 50): kaynak
  rozeti (Sunucu ve İşlem kırmızı, Tarayıcı turuncu, CSP gri), kaç kez, son ve ilk görülüş, yol, **hata kodu**;
  **Ayrıntı**'da uzun iletinin tamamı (listede üç satıra kısalır), adı, yeri (Sayfa / API yolu / Sunucu eylemi,
  tarayıcı ailesi, CSP kaynağı) ve yığının ilk satırları.
- **Hata kodu**, kullanıcının "Bir şeyler ters gitti" ekranında gördüğü koddur (Next'in `digest`'i). Next kodu
  iletiden ve yığından üretir: aynı satırın kodu her yayında ve iletideki sayı değişince değişir. Bu yüzden satır
  **son beş görülüşün kodunu** tutar (yeni önce) ve açıkta gösterir: biri yakın zamanda gördüğü kodu söyleyince satır
  sayfada aranarak bulunur. Daha eski bir kod bulunmazsa satır ileti ve saatle aranır.
- **Çözüldü** satırı açık listeden çıkarır; **Hepsi çözüldü** bütün açık satırları. Hata yeniden görülürse satır
  kendiliğinden yeniden açılır, sayısı sürer. İşlem geçmişine "Hata kaydı" olarak düşer.
- Telefonda kapalı satırın özeti: "Açık hata yok", "Son 24 saatte N farklı sunucu / işlem hatası" (kırmızı; satır
  sayısı, kaç kez olduğu değil), "N açık hata" (turuncu) ya da "N açık uyarı (CSP)".

## 3. Kişisel veri ve güvenlik

Kayda **giden:** hatanın adı, iletisi, yığının ilk 12 satırı, Next'in hata kodu, yol, bağlam (sayfa / eylem / API yolu
ve istek yöntemi; tarayıcıda yalnız ailesi ve işletim sistemi, ör. "Safari · iOS").

Kayda **gitmeyen:** istek gövdesi, çerezler, başlıklar (oturum, yetki, IP), sorgu dizgesi, kullanıcının kimliği, tam
kullanıcı aracısı. Kanca isteğin başlıklarını hiç okumaz (`requestErrorEntry`).

Her metin yazılmadan önce temizlenir ve kısaltılır (`src/lib/error-log.ts` › `redactText`, `sanitizeEntry`):

- veritabanı hatasının parametreleri (drizzle'ın `params: …`: kayda gidecek ad, adres, tutar, e-posta) **hiç
  alınmaz**: sorgu hatasının iletisi sorgunun kendisinden (`Failed query: <sql>`) kurulur, değerler drizzle'ın
  iletisinden okunmaz. Değer çok satırlı olabildiği için (not, adres) yalnız `params:` satırını silmek yetmezdi. Yedek
  olarak başka bir iletide geçen `params:`'tan sonrası da sonuna kadar `[gizli]` olur. Yığının başı iletiyi yinelediği
  için oradan da çıkarılır; V8 yığınında yalnız `at …` satırları alınır;
- bağlantı adresindeki kullanıcı ve parola, `Bearer` / `Basic`, JWT, `sk-…` / `re_…` gibi API anahtarları,
  `parola=` / `token=` / `secret:` gibi çiftler, 32+ karakterlik harf-rakam karışık dizgiler → `[gizli]` / `[anahtar]`;
- adreslerin sorgu dizgesi ve parçası; yoldaki davet / sıfırlama anahtarı ve UUID → `:anahtar`;
- e-posta → `[e-posta]`, IBAN → `[IBAN]`, 10+ haneli sayılar (telefon, kimlik, kart) → `[sayı]`;
- sunucudaki mutlak dosya yolları `src/`, `.next/`, `node_modules/`'tan başlar; tarayıcıdaki betik adresleri yola iner;
- denetim karakterleri (NUL …) atılır: Postgres metinde NUL'u reddeder, tek bir bozuk girdi yazılamaz olurdu
  (`JSON.parse`'ın iletisi ham girdiyi aktarabilir).

Sınırlar: ileti 500, yol 200, bağlam 200 karakter; yığın 12 satır, satır başına 200, toplam 1.500 karakter. Ham metin
temizlikten **önce** de kısaltılır (alanın sınırının dört katı; yığın 16.000 karakter, satırı 500): temizlik düzenli
ifadelerle yapılır, 64 KB'lık bir iletide saniyelerce işlemci tutardı. Uzun girdide temizlik birkaç milisaniyedir.

Tablo yalnız yöneticiye görünür (Ayarlar sayfası ve eylemler `requireAdmin`). **Yedeğe girmez** (`TABLE_RULES.error_log`:
tanı için geçici satırlar).

## 4. Kayıt isteği bozmaz, veritabanını boğmaz

- **Beklenmez:** kayıt yanıtı geciktirmez. Vercel'de işlev, yazım bitene kadar Next'in `waitUntil`'iyle açık kalır;
  yazım en çok 3 saniye beklenir (`WRITE_TIMEOUT_MS`), sonra bırakılır. Kritik hatanın e-postası ayrıca en çok 10
  saniye açık tutulur (`ALERT_TIMEOUT_MS`; § 5).
- **Kendi hatasını yutar:** kayıt hiçbir zaman fırlatmaz; yazılamazsa günlüğe tek satır (`[hata kaydı] yazılamadı …`,
  yalnız iletinin ilk satırı, parametresiz) düşer. Kayıt kendini kaydetmez (döngü yok).
- **Sunucu örneği başına kapı, kaynak başına** (`createWriteGate`, `GATE_PER_MINUTE`): aynı hata 10 saniyede bir
  yazılır, aradakiler sayılır ve sonraki yazıma eklenir; örnek başına dakikada en çok 30 sunucu, 30 işlem, 10 tarayıcı
  ve 10 CSP yazımı. Kapılar ayrı olduğu için oturumsuz CSP raporları ya da tarayıcı hataları sunucu ve işlem
  hatalarının payını tüketemez: bir CSP yağmurunda da gerçek sunucu hatası yazılır ve e-postası gider. Bağlantı düşünce
  (veritabanı yok, zaman aşımı) o kaynağın kapısı bir dakika hiç denemez; satırın kendisi yazılamıyorsa (Postgres veri
  ya da kısıt hatası, SQLSTATE 22xxx / 23xxx) kapı açık kalır, öteki hatalar yazılmaya devam eder. Sayı yaklaşıktır:
  yazılmadan kapanan örneğin bekleyen sayısı kaybolur.
- **Günlük yeni satır sınırı** (İstanbul günü, kaynak başına; `DAILY_NEW_CAP`): sunucu 50, işlem 50, tarayıcı 30, CSP 30
  farklı hata. Aşılınca o günün tek **"Günlük sınır doldu (27 Kas): o gün 30 farklı CSP ihlalinden sonrakiler ayrı
  satır açmadı, yalnız sayıldı"** satırı sayılır (gün yazılır: satır 30 gün durur); var olan satırlar artmaya devam
  eder.
- **Saklama:** sabah işi (`/api/cron/gunluk`, en çok 3 sn, iş adımı değil, sonucu yanıtta `hatalar`) 30 gündür
  görülmeyen satırları siler; tablo 2.000 satırı aşarsa en eski son görülüşten fazlası gider. En kötü durumda tablo
  birkaç MB'tır.
- **Tarayıcı:** sayfa yüklemesi başına en çok 5 gönderim, aynı ileti bir kez. Uç (`/api/hata`) yalnız panelin kendi
  sayfasından (Origin = Host) ve oturumu açık kullanıcıdan kabul eder; gövde en çok 8 KB; kişi başına 10 dakikada en çok
  20 (örnek başına). Yanıt her durumda gövdesiz.
- **CSP ucu** oturum istemez (tarayıcı raporu çerezsiz gönderebilir): gövde en çok 16 KB, örnek başına dakikada en çok
  30, **IP başına dakikada en çok 20** günlük satırı, örnek başına dakikada en çok 10 kayıt yazımı, günde en çok 30 yeni
  CSP satırı. Raporun alanlarındaki denetim karakterleri (satır sonu dahil) boşluk olur: günlüğe sahte satır yazılamaz.
  Sahte raporla en çok bu kadar satır açılabilir; panelin işleyişine ve öteki kaynakların kaydına dokunmaz.
- **Neon kotası:** yazım yalnız hata olunca yapılır; hata çoğu zaman zaten açık bir sayfanın isteğinde olduğu için
  veritabanı uyanıktır. Kayıt kapatılmak istenirse (acil durum) Vercel'de `ERROR_LOG_DISABLED=1`: hatalar yalnız
  günlüğe düşer, e-posta gitmez.

## 5. E-posta (günde en çok bir)

**Kritik hata:** Sunucu ya da İşlem kaynağından yazılan hata. Tarayıcı ve CSP satırları e-posta göndermez.

Günün ilk kritik hatasında yöneticilere **sistem uyarısı e-postası** gider (mevcut altyapı:
`src/server/jobs/alerts.ts` › `sendSystemEmail`): yalnız canlıda (`VERCEL_ENV=production`), e-posta açık ve Resend
kuruluysa, sabah e-postasının etkin alıcılarına (personel ve pasif hesap düşer). Konu "L'Affogato · Panelde hata:
<iletinin ilk satırı>"; gövdede kaynak, yer, saat ve hata kodu, ne yapılacağı ve "Hata kaydını aç" düğmesi.

- **Günde bir:** önce `notification_log` anahtarı (`hata-kaydi:<gün>`) **"gönderiliyor"** diye alınır (`ok` false,
  `error` "gönderiliyor"); aynı gün ikinci hata, başka bir sunucu örneğinde de olsa, e-posta göndermez. Gidince anahtar
  "gönderildi" olur (`ok` true). Gönderilemezse (Resend hatası) anahtar bırakılır, 10 dakika sonra sonraki hatayla
  yeniden denenir. Gönderilecek adres yoksa ya da e-posta kapalıysa o sunucu örneği o gün yeniden denemez.
- **Takılan gönderim:** işlev e-posta sürerken durdurulursa (Vercel yanıttan sonra işlevi dondurabilir) anahtar
  "gönderiliyor"da kalır; **5 dakika** sonra sonraki kritik hata onu yeniden alır ve gönderir. Resend'in gün anahtarı
  (`system-<gün>-…`) aynı e-postanın iki kez gitmesini önler. E-posta yazımın 3 saniyelik sınırına bağlı değildir:
  ayrıca en çok 10 saniye açık tutulur. Hatırlatıcılar'ın e-posta günlüğünde bu satır gönderim sürerken birkaç saniye
  "gönderiliyor" görünür.
- E-posta yalnız haber verir; ayrıntı ve öteki hatalar ekranda.

## 6. CSP_ENFORCE kararı

Güvenlik politikası (CSP, `src/lib/csp.ts`) `CSP_ENFORCE=1` verilene dek Report-Only: tarayıcı engellemez, yalnız
bildirir ([DEPLOY.md](DEPLOY.md) › Güvenlik başlıkları). Raporlar artık kayda da yazıldığı için karar bir saatlik
günlüğe değil kanıta dayanır. Kartın üstündeki satır (`cspVerdict`):

| Durum | Karar |
|-------|-------|
| Son 7 günde panelin kendi kodundan çözülmemiş ihlal var | "henüz uygulanmasın" (turuncu): önce düzeltilir, satırlar Çözüldü işaretlenir |
| Açık ihlal yok; ama kayıt 7 günden yeni, ya da son 7 günde Çözüldü işaretlenen bir ihlal görülmüş, ya da bir günün CSP sınırı dolmuş | "kanıt toplanıyor (N/7 gün)": temiz günler kaydın başlangıcından, son ihlalin ya da sınır satırının son görülüşünden sayılır |
| Kayıt en az 7 gündür tutuluyor, son 7 günde hiç ihlal görülmemiş | "uygulanabilir" (yeşil): Vercel'de `CSP_ENFORCE=1`, yeniden yayın |
| Uygulanıyor | açık engellemeler ya da dolan sınır turuncu, yoksa yeşil |

**Çözüldü bekleme süresini atlatmaz:** dün görülen ihlali bugün Çözüldü işaretlemek kararı "uygulanabilir"e çevirmez;
satır son görülüşünden 7 gün pencerede kalır ("kanıt toplanıyor (1/7 gün)"). Temiz günler son görülüşten sayılır,
işaretleme anından değil: eski bir satırı işaretlemek süreyi yeniden başlatmaz.

**Günün "sınır doldu" satırı** (bir günde 30'dan fazla farklı ihlal) ihlal sayısına girmez, ama içinde ne olduğu
bilinmediği (ayrıntısı yalnız bir saatlik Vercel günlüğündeydi) için "uygulanabilir" de dedirtmez: temiz günler o
günden sayılır.

Tarayıcı eklentilerinin ihlali (engellenen kaynak ya da betik dosyası `chrome-extension://`, `moz-extension://`,
`safari-web-extension://` …) **kayda hiç girmez**, yalnız günlüğe düşer: panelin kodu değildir. Aynı satırı paylaşsaydı
(ör. eklentinin ve panelin satır içi betiği aynı yönerge ve sayfada) son gelen rapor panelin gerçek ihlalini karardan
silebilirdi; her ekranda ayrı ihlal üretip günlük sınırı da doldururdu. Kaydın başlangıcı `integration_state` ›
`errors.since`: canlı derleme (`scripts/predeploy.ts`) ve sabah işi yalnız yoksa yazar.

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
- Testler: `tests/hata-kaydi.test.ts` (temizlik, çok satırlı sorgu parametresi, denetim karakterleri, uzun girdinin
  süresi, özet, kanca girdisi, tarayıcı, kaynak başına kapı, bozuk satırın kapıyı kapatmaması, CSP kararı ve Çözüldü,
  sınır satırı, e-postanın süresi, kaydın isteği bozmaması), `tests/hata-kaydi-db.test.ts` (gruplama, son beş hata
  kodu, Çözüldü, günlük sınır, saklama, NUL'lu satır, günde bir e-posta ve takılan gönderimin yeniden alınması, uçların
  kapıları, CSP'nin IP sınırı ve eklentisi, `attempt()` ve sorgu parametresi, yönetici eylemleri).

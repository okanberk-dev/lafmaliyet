# Tam yedek ve geri yükleme

Ekran: **Ayarlar › Yedek** (`/panel/ayarlar#yedek`, yalnız yönetici). **Yedeği indir** parolanızı ister, paneldeki
bütün veriyi tek bir `.json.gz` dosyası olarak indirir. Dosya bilgisayardan bir komutla (`npm run db:restore`) boş bir
veritabanına ya da var olan bir veritabanının yerine yüklenir. Geri yükleme panelden yapılmaz: tek dokunuşla bütün
veri değişmesin (Vercel 4,5 MB'tan büyük dosya yüklemesini zaten almaz).

Neon da veritabanını kendiliğinden yedekler (nokta-zaman geri yükleme), ama küçük planlarda yalnız birkaç saat ya da gün
geriye gidilir. Bu dosya sizde kalan uzun süreli kopyadır. Aynı karttaki **Dışa aktar (.xlsx)** çalışma kitabı
(`/api/export`) okumak ve muhasebeciye vermek içindir, geri yüklenmez (§ 12).

Panel ayrıca her pazartesi sabahı aynı yedeği kendiliğinden alır ve özel dosya deposunda son 8 haftayı saklar
(**otomatik haftalık yedek**, § 13); Ayarlar › Yedek'te listelenir, parolayla iner. Veritabanının boyutu da her sabah
ölçülür: Neon kotasının %70'i ve %90'ı geçilince zil ve e-postayla uyarılır (**Ayarlar › Veritabanı**, § 14).

## 1. Yedek almak

1. Ayarlar › Yedek › **Yedeği indir**.
2. Parolanızı girin. Panelden yüklenmiş fatura belgeleri varsa isteğe bağlı **Yüklenen fatura belgelerini de ekle**
   (dosya büyür; belgelerle dosya 4 MB'ı aşacaksa panelden seçilemez, bkz. § 7).
3. Dosya tarayıcının indirdiklerine iner: `laffogato-yedek-2026-10-22-0915.json.gz` (İstanbul saati).
4. Ayda bir alın; bilgisayarınızda ya da Google Drive'da (yalnız size açık bir klasörde) saklayın.

- İndirme bağlantısı parolayı onayladıktan sonra iki dakika, yalnız sizin oturumunuzla geçerlidir; bağlantı başkasının
  eline geçse de işe yaramaz. Yanlış parola işlem geçmişine "Hatalı parola onayı (Yedek)" olarak yazılır; 15 dakikada 5
  hatadan sonra beklenir (Hesabım ve Kullanıcılar'la aynı pay).
- Dosya tamamen inince kartta **Son yedek** (tarih, kim, boyut, belgeler dahil mi) ve işlem geçmişinde **Yedek
  indirildi** satırı görünür. Yarıda kesilen indirme kayda geçmez.
- Son yedek 30 günden eskiyse ya da hiç yedek yoksa kartta turuncu rozet çıkar, canlıda zilde **Sistem** başlığı
  altında "Yedek almayalı 34 gün oldu" / "Henüz yedek indirilmedi" yazar (bilgi; Genel bakış'taki kırmızı şeride ve
  `/api/health?isler=1`'in 503'üne girmez).
- `npm run db:backup` ile bilgisayardan alınan yedek kartta "Son yedek" sayılmaz (komut veritabanına yazmaz).
- Otomatik haftalık yedek de "Son yedek" sayılmaz ve 30 günlük hatırlatmayı susturmaz: o dosyalar panelin özel
  deposunda (Vercel) durur, sizde kalan kopyanın yerini tutmaz (§ 13).

**Dosyada ciro, maaş ve IBAN'lar var; kimseyle paylaşmayın, e-postayla göndermeyin.** Dosya şifreli değildir (parola
unutulursa yedek de kaybolurdu). Parolalar dosyaya yazılmaz.

## 2. Dosyada ne var, ne yok

Veritabanındaki **bütün tablolar** yazılır; tablolar çalışırken bulunur, yeni bir tablo kod değişmeden yedeğe girer.
Yalnız şunlar dosyaya girmez (`src/lib/backup/format.ts` › `TABLE_RULES`, `EXCLUDED_STATE_KEYS`):

| Yazılmayan | Neden | Geri yüklemeden sonra |
|------------|-------|------------------------|
| Kullanıcıların parola özeti, iki adımlı doğrulama anahtarı, kurtarma kodları, hatalı giriş sayısı, kilit, oturum sürümü | dosya Drive'da ya da indirilenlerde durur | aynı e-posta hedefte varsa onun parolası kalır; yoksa "davet bekliyor" (§ 5) |
| Davet ve parola sıfırlama bağlantıları (`user_tokens`) | tek kullanımlık | yenisi gönderilir |
| Çıkışta kapatılan oturumlar (`revoked_sessions`) | geçici; çerezin süresiyle gereksizleşir | geri yükleme herkesin oturum sürümünü artırır, eski oturumların hepsi zaten düşer |
| Bildirim abonelikleri (`push_subscriptions`) | cihaz anahtarları | cihazlar panel açılınca yeniden abone olur |
| Paraşüt oturumu (`integration_state` › `parasut.token`) | şifreli belirteç, her yenilemede değişir | geri yüklemeden sonra panelden **“Paraşüt hesabını bağla”** ile yeniden bağlanır |
| Paraşüt bağlantı ayarları (`parasut.settings`: client_id, şifreli client_secret, firma numarası, ilk eşitleme başlangıcı) | şifreli değer başka `AUTH_SECRET`'la açılmaz | Paraşüt ekranındaki **Bağlantı** kartından yeniden girilir (Vercel'de tanımlıysa onlar kullanılır), sonra hesap bağlanır |
| Öbür şubelerin Paraşüt oturumu ve ayarları (`parasut.token:<şube>`, `parasut.settings:<şube>`; önekiyle) ve yarım bağlanma isteği (`parasut.connect`) | şifreli; şube başına Paraşüt hesabı ([PARASUT.md](PARASUT.md#şube-başına-paraşüt-hesabı)) | Paraşüt ekranında o şube seçiliyken bilgiler yeniden girilir ve hesap bağlanır |
| Bildirim (VAPID) anahtarı (`webpush_vapid`) | şifreli anahtar | yenisi üretilir |
| Şube başına ayarların şifreli alanları (`branch_settings.secrets`) | şifreli değer başka `AUTH_SECRET`'la açılmaz. Ayarların kendisi ve "Diğer şubeyle aynı" bağı dosyaya girer | Şube ayarları'ndan yeniden girilir (bugün yalnız AsilPOS'un panelde saklanan anahtarı; girilene dek ortamdaki `ASILPOS_SYNC_SECRET` kullanılır; [SUBE.md](SUBE.md) › Şube başına ayarlar) |
| Bar ekranındaki uygulama siparişlerinin kopyası (`site_orders`) | müşteri adları (KVKK); site bu listeyi bilerek geçmişsiz tutar | bar ekranı açılınca siteden yeniden çekilir |
| Paraşüt'ten alınan e-fatura PDF'leri | önbellek | ilk açılışta Paraşüt'ten yeniden indirilir |
| Panelden yüklenen fatura belgeleri | yalnız "belgeleri de ekle" seçilmediyse | seçilmediyse belgesiz gelir |
| Kasa ve fiş fotoğraflarının dosyaları (kayıtları `photos` tablosunda yazılır) | dosyalar veritabanında değil, özel Vercel Blob deposunda ([FOTOGRAF.md](FOTOGRAF.md)) | aynı depo bağlıysa fotoğraflar açılır; değilse "Fotoğraf bulunamadı" |
| Personel belgelerinin dosyaları (kayıtları `staff_documents` tablosunda yazılır) | fotoğraflarla aynı özel depoda ([PERSONEL-BELGE.md](PERSONEL-BELGE.md)) | aynı depo bağlıysa açılır; değilse "Belge bulunamadı", dosya yeniden eklenir |
| Claude bağlantıları (`mcp_clients`, `mcp_codes`, `mcp_grants`, `mcp_tokens`, `mcp_calls`) | anahtar özetleri ve verilmiş erişim; eski bir yedekten bağlantı geri gelmesin | Claude'da bağlayıcıya yeniden "Connect" denir ([CLAUDE-BAGLANTISI.md](CLAUDE-BAGLANTISI.md)) |
| Panel asistanının bekleyen onay kartları (`assistant_ops`, durumu `pending` ya da `running`) | geçici (10 dakika); eski bir yedekten onaylanabilir kart dönmesin. Sonuçlanmış kartlar (yapıldı, vazgeçildi, geri alındı…) denetim kaydı olarak dosyaya girer | asistandan yeniden istenir ([ASISTAN-ISLEMLER.md](ASISTAN-ISLEMLER.md)) |

Karaoke rezervasyonlarındaki müşteri adı (`karaoke_sessions.customer_name`; yalnız ad, soyadı ve iletişim panele hiç
gelmez) ve müşterinin sitede yazdığı not (`karaoke_sessions.note`, en çok 300 karakter; müşteri içine telefonunu ya da
soyadını yazmış olabilir) dosyada **kalır**: panelin kendi kaydıdır, geçmiş ayların karaoke özeti ona dayanır.
Tedarikçilerin IBAN ve vergi numaraları, personelin maaşları, ciro ve kasa raporları da dosyadadır; bu yüzden dosya
paylaşılmaz.

Adı parola, anahtar, belirteç, özet gibi görünen yeni bir sütun ya da durum anahtarı eklenirse `tests/yedek.test.ts`
düşer: ya `TABLE_RULES` / `EXCLUDED_STATE_KEYS`'e eklenir ya da testte gizli olmadığı nedeniyle yazılır.

## 3. Dosya biçimi (sürüm 1)

UTF-8 JSON satırlarının (her satır bir JSON değeri, `\n` ile biter) gzip'i:

```
{"format":"laffogato-yedek","version":1,"createdAt":"2026-10-22T06:15:03.120Z","createdBy":"Okan","app":"981692e",
 "documents":false,"migrations":[{"hash":"…","createdAt":1792413340966},…],
 "excluded":{"tables":["invoice_documents","push_subscriptions","user_tokens"],"columns":{"users":[…]},
             "stateKeys":["parasut.token","parasut.settings","webpush_vapid","site_orders","parasut.token:*","parasut.settings:*","parasut.connect*"],"documents":"hepsi"}}
{"table":"activity_log","columns":["id","at","user_name","action","detail"]}
{"r":{"id":1,"at":"2026-10-17T09:00:00+00:00","user_name":"Sistem","action":"İlk veri aktarımı","detail":"…"}}
…
{"table":"categories","columns":[…]}
{"r":{…}}
…
{"end":{"tables":{"activity_log":13,"categories":12,…},"rows":4312,"sha256":"<hex>"}}
```

(Başlık dosyada tek satırdır; burada okunsun diye bölündü.)

- İlk satır başlık: biçim ve sürüm, kim ve ne zaman aldı, kodun sürümü (`app`: Vercel'de commit'in ilk 7 karakteri,
  yerelde `yerel`), şema sürümü (`migrations`: kaynağın `drizzle.__drizzle_migrations` kayıtları) ve neyin yazılmadığı.
- Tablolar alfabe sırasıyla; her tablonun satırı `columns` (veritabanındaki sırayla, yazılmayan sütunlar hariç), ardından
  kayıt başına bir `{"r":…}` satırı. Kayıtlar Postgres'in `row_to_json` çıktısıdır: tarih-saat ISO, `bytea` `"\\x…"`,
  `jsonb` iç içe JSON, `NaN` / `Infinity` metin.
- Bütün tablolar tek bir `REPEATABLE READ READ ONLY` işlemden okunur: indirme sürerken yapılan değişiklik dosyayı yarım
  bırakmaz. Dosya akarak üretilir (sunucu bütün dosyayı bellekte tutmaz).
- Son satırdaki `sha256`, son satırdan önceki bütün satırların (`\n` dahil) UTF-8 baytlarını kapsar. Son satır yoksa,
  gzip bozuksa, özet ya da tablo başına satır sayısı tutmuyorsa dosya **"eksik ya da bozuk"** sayılır ve yüklenmez.

## 4. Geri yükleme (bilgisayardan)

Gerekenler: deponun güncel hâli (`git pull`; kod yedeği alan sürümden eski olmamalı), `npm install`, hedef
veritabanının adresi. Hedef, komut satırında verilen `DATABASE_URL_UNPOOLED` / `DATABASE_URL`'dir; verilmezse
`.env.local`'daki. Komut satırında verilen her zaman önce gelir: `.env.local`'da canlının adresi dursa da elle verilen
yerel adres kullanılır. Neon'da havuzsuz (unpooled, adında `-pooler` olmayan) adresi verin.

Safari indirilen `.gz` dosyasını kendiliğinden açıp yalnız `laffogato-yedek-….json` bırakabilir: o dosya da aynı komutla
yüklenir, aynı özet ve son satırla denetlenir.

### Boş bir veritabanına (prova, yeni veritabanı)

```bash
createdb laffogato_prova
DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_prova npm run db:restore -- ~/Downloads/laffogato-yedek-2026-10-22-0915.json.gz
```

### Dolu bir veritabanının yerine (`--sil`)

```bash
DATABASE_URL="<neon unpooled adresi>" npm run db:restore -- <dosya.json.gz> --sil --onay=<sunucu>
```

- `--sil` olmadan dolu bir hedefe yazılmaz: `Hedefte tablolar var (…). Boş bir veritabanı verin ya da üzerine yazmak
  için --sil ekleyin; önce hedefin yedeği alınır.`
- Hedef bu bilgisayarda değilse (Neon) sunucu adıyla onay gerekir: `--onay=ep-….neon.tech` ya da terminalde sorulunca
  sunucu adını yazmak.
- Yedekte belge yoksa ve hedefte yüklenmiş belge varsa uyarılır: `Bu yedekte belge yok: hedefteki 18 yüklenen belge
  silinecek.`
- **Hiçbir şey değişmeden önce** hedefin kendi yedeği dosyanın yanına yazılır (belgeler dahil):
  `laffogato-yedek-once-<sunucu>-2026-10-22-0915.json.gz`. Yanlış dosya verildiyse bununla geri dönülür.

### Komut ne yapar

1. Dosyayı baştan sona okur ve doğrular (özet, son satır, sürüm). Bozuksa hedefe bağlanmadan durur:
   `Dosya eksik ya da bozuk (indirme yarıda kesilmiş olabilir): …`
2. Şema sürümüne bakar. Yedek bu koddan yeni bir sürümle alınmışsa yüklemez (`önce kodu güncelleyin (git pull)`).
   Eski bir sürümle alınmışsa veri o sürümde yüklenir, sonraki migration'lar veriden sonra uygulanır. Boş veritabanında
   geçip dolu tabloda takılan bir migration'dan hemen önce ek bir adım çalışır (`src/lib/backup/format.ts` ›
   `BEFORE_MIGRATION_SQL`; uygulanmış migration dosyası değiştirilmez): şubelerden (0053, 4 Kasım 2026) önce alınmış
   bir yedekte `0056_sube_kirilimi` eski ay, satış, personel ve kasa satırlarını Tuzla'ya yazıp şube kütüğüne bağlar;
   Tuzla kaydı ondan önce yazılır (0057'deki kaydın aynısı). Kütük geri yüklemeden sonra yalnız Tuzla'dır; Marina ve
   laffogato.net sonraki tohumda gelir (`npm run db:seed`; canlıda her yayında kendiliğinden).
3. **Tek bir işlemde:** (`--sil` ise) hedefteki tabloları ve `drizzle` şemasını siler, şemayı yedeğin sürümüne kurar,
   tabloları yabancı anahtar sırasıyla yükler, satır sayılarını dosyayla karşılaştırır, sayaçları (kimlik dizileri)
   ilerletir (hedefteki eski yerlerinin gerisine düşmez, § 5), kalan migration'ları uygular, günlük işlerin izlenmesini
   o andan başlatır, işlem geçmişine **Yedekten geri yüklendi** yazar. Herhangi bir adım hata verirse ya da bir sayı
   tutmazsa her şey geri alınır, hedef olduğu gibi kalır (`Geri yükleme geri alındı, hedef değişmedi: …`; ardından
   Postgres'in kendi iletisi).
4. Özeti yazar:

```
Yedek: 22.10.2026 14:56 · Okan · 40 tablo · 4.312 satır · belgeler hariç (sürüm 981692e)
Şema: 0020_gunluk_isler (bu kodla aynı)
Hedef: localhost/laffogato_prova (bu bilgisayar)
✓ Geri yükleme tamam. 40 tablo, 4.312 satır. Şema: 0020_gunluk_isler.
✓ Yönetici parolası ADMIN_PASSWORD ile ayarlandı (admin@laffogato.net; yönetici olarak eklendi).
! Parolası olmayan kullanıcılar (Kullanıcılar & roller › Düzenle › Güvenlik › Davet bağlantısını yeniden oluştur): Okan, Ayşe
! Paraşüt hesabını yeniden bağlayın: Ayarlar › Paraşüt entegrasyonu › “Paraşüt hesabını bağla”. Bildirim izinli cihazlar panel açılınca yeniden abone olur.
```

## 5. Kullanıcılar ve parolalar

- Hedefte aynı e-postası (büyük/küçük harf fark etmez) olan kişi **bugünkü parolasıyla** (ve iki adımlı doğrulamasıyla)
  girer.
- E-postası hedefte olmayan kişi **"davet bekliyor"** olur: Kullanıcılar & roller › Düzenle › Güvenlik › Davet
  bağlantısını yeniden oluştur.
- `ADMIN_EMAIL` + `ADMIN_PASSWORD`: o kişi yönetici olur ve parolası budur; yedekte yoksa yönetici olarak eklenir.
  - Bu bilgisayardaki bir hedefte (prova) `.env.local`'daki değerler de kullanılır; prova bununla girilir.
  - Bu bilgisayarda olmayan bir hedefte (Neon) yalnız komut satırında verilirse kullanılır (`.env.local`'daki yerel
    yönetici hesabı canlıya geçmesin) ve hedef doluysa yalnız hiçbir yönetici bugünkü parolasıyla giremeyecekse
    (sahibin parolası değişmesin).
- Hiçbir yönetici parolasıyla giremeyecekse (ör. yeni ve boş bir veritabanına `ADMIN_*` olmadan) komut bunu yazar:
  `ADMIN_EMAIL` ve `ADMIN_PASSWORD` verip `--sil` ile yeniden yükleyin ya da giriş ekranında "Parolamı unuttum" ile
  bağlantı isteyin (e-posta kuruluysa).
- Hedef doluysa oradaki **bütün oturumlar kapanır**: herkes yeniden giriş yapar. Kimlik sayaçları hedefteki eski
  yerlerinin gerisine düşmez: geri yüklemeden sonra eklenen kişi, yedekten sonra eklenmiş ya da silinmiş birinin
  kimliğini almaz (oturum çerezi kimlik ve oturum sürümüyle eşleşir; eski bir çerez yeni kişinin hesabını açmasın).
- Hedef boşsa (yeni bir canlı veritabanı) eski veritabanında açılmış oturumlar bilinmez: aynı `AUTH_SECRET`'la imzalı
  eski bir çerez burada da geçebilir. Bu yüzden canlıya yeni veritabanı kurulunca `AUTH_SECRET` da yenilenir (§ 8);
  komut bu bilgisayarda olmayan boş bir hedefte bunu hatırlatır.

## 6. Geri yüklemeden sonra

- **Paraşüt:** oturum yedeğe girmez; panelde **Ayarlar › Paraşüt entegrasyonu → “Paraşüt hesabını bağla”** ile bir kez
  yeniden bağlayın. İmleç yedeğin hâline döner. Sonraki eşitleme 75 gün geriye bakar ve yedekten sonra gelen faturaları
  yeniden alır. Yedekten sonra panelde yapılan her şey kaybolur: faturalara verilen "ödendi" / "talep edildi"
  işaretleri, kategori düzeltmeleri, ürün → hammadde bağlantıları; elle girilen fatura, harcama, kasa raporu, sayım,
  fiyat.
- **E-posta:** yedekten sonra gönderilmiş hatırlatmaların kaydı (`notification_log`) da yedeğin hâlindedir; bir
  hatırlatma bir kez daha gidebilir.
- **Bildirimler:** VAPID anahtarı yenilenir; bildirim izni verilmiş cihazlar panel açılınca yeniden abone olur.
- **laffogato.net:** bar ekranındaki açık siparişler siteden yeniden çekilir; karaoke, menü ve online satışlar sonraki
  eşitlemede sitenin bugünkü hâline gelir.
- **Günlük işler:** izleme geri yükleme anından yeniden başlar (dosyadaki çalışma kayıtları yedeğin gününde kalır); o
  gün için "Sabah işi çalışmadı" uyarısı çıkmaz, ertesi sabahtan itibaren her şey eskisi gibi denetlenir.
- **Fotoğraflar:** kayıtlar yedeğin hâline döner, dosyalar Blob deposunda olduğu gibi kalır. Yedekten sonra silinen
  fotoğrafın satırı geri gelir ama dosyası yoktur ("Fotoğraf bulunamadı"); sabah işi süresi gelince satırı da siler.
- **Son yedek:** Ayarlar › Yedek'teki "Son yedek" dosyadaki hâline döner (dosyayı alan indirme kendisinden öncekini
  gösterir); yeni bir yedek alınca düzelir.
- `npm run db:reset` (ilk aktarımın tohum verisini yeniden yükleme) bununla ilgisizdir. Tek farkı cari hareketleridir (Tedarikçiler'de
  elle girilen borç ve ödeme, `supplier_entries` / `supplier_allocations`): varsa db:reset tam yedeği aldıktan sonra
  durur ("Cari hareketleri var (N kayıt) … Yedek alındı: <dosya>"). TRUNCATE … CASCADE onları da silerdi; Kasa
  satırları kalır, faturalar ödenmemiş geri gelir ve iki kez ödenir. Yine de silmek için
  `npm run db:reset -- --cari-sil` (cari tabloları ve "Ayrı tut" listesi `cari.kasa-ayri` de silinir). Yedek ve geri
  yükleme yeni tabloları kendiliğinden taşır; `invoices.allocated` sütun değeriyle gelir.

## 7. Belgeler (büyük belgeli yedek)

Belgelerle dosya 4 MB'ı aşacaksa panel belgeli yedek vermez (Vercel'in 4,5 MB'lık yanıt sınırı akan yanıtta
doğrulanana kadar). Tahmin: belgeler dosyada yaklaşık %10 büyür (fotoğraf ve PDF neredeyse sıkışmaz), üstüne verinin
kendisi eklenir (panelden alınan son belgesiz yedeğin boyutu; henüz yoksa 1 MB). Kart ve parola penceresi aynı hesabı
yapar. Belgeli yedek bilgisayardan alınır:

```bash
DATABASE_URL="<neon unpooled adresi>" npm run db:backup -- --belgeler
```

Dosya ev klasörüne yazılır (`~/laffogato-yedek-….json.gz`; başka bir yer için `--cikti <dosya>`) ve aynı komutla geri
yüklenir. Komut veritabanına yazmaz. Depo klasörüne yazılan yedek git'e giremez (`.gitignore`).

## 8. Gerçek bir geri yüklemede sıra

1. **Neon geri yüklemesi**, hata Neon planının geri gidebildiği süre içindeyse: Neon konsolu › Branches › Restore. Dosya
   gerekmez, aradaki her şey korunur.
2. **Dosya**, `--sil` ile canlıya; 07:00–09:30 (günlük işler) dışında ve kafe kapalıyken (işlem sürerken panel bekler):
   ```bash
   DATABASE_URL="<neon unpooled adresi>" npm run db:restore -- <dosya.json.gz> --sil --onay=<sunucu>
   ```
   Komut önce canlının o anki yedeğini dosyanın yanına alır. Sonra § 5 ve § 6'daki adımlar (davet bağlantıları).
   Yeni, boş bir canlı veritabanına yüklerken `ADMIN_EMAIL=<sahibin e-postası> ADMIN_PASSWORD=<geçici parola>`'yı da
   komut satırında verin: kimsenin parolası korunmaz, sahip bu geçici parolayla girip Hesabım'dan değiştirir
   (`.env.local`'daki değerler canlı bir hedefte kullanılmaz).
3. **Yeni, boş bir canlı veritabanına** yüklendiyse Vercel'de `AUTH_SECRET`'ı da yenileyin (`openssl rand -base64 48`)
   ve yeniden yayınlayın: eski veritabanında açılmış oturum ve cihaz çerezleri yenisinde geçmesin (kimlikler yeniden
   verilebilir, § 5). Dosyada bu anahtarla şifrelenmiş bir değer yok: Paraşüt hesabı panelden yeniden bağlanır, bildirim
   anahtarı yeniden kurulur, iki adımlı doğrulama yedekle gelmez (isteyen Hesabım'dan yeniden açar).

## 9. Prova (her 3 ayda bir)

1. Ayarlar › Yedek › **Yedeği indir** (parola).
2. Bilgisayarda:
   ```bash
   createdb laffogato_prova
   DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_prova npm run db:restore -- ~/Downloads/laffogato-yedek-….json.gz
   ```
3. Yazılan satır sayıları dosyayla aynı mı (komut bunu kendisi de denetler, tutmazsa geri alır).
4. `DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_prova npm run dev` ile paneli açın, `.env.local`'daki
   `ADMIN_EMAIL` / `ADMIN_PASSWORD` ile girin. Kapanmış bir ayın Genel bakış'ını, Faturalar'ın sayısını ve geçmiş bir
   günün kasa raporunu canlıdakiyle karşılaştırın.
5. `dropdb laffogato_prova`. Tarihi aşağıdaki tabloya yazın.

### Prova geçmişi

| Tarih | Yedek | Kim | Sonuç |
|-------|-------|-----|-------|
| 22.10.2026 | Yerel deneme veritabanı (tohum verisi), panelden belgeli indirme · 40 tablo · 1.405 satır · 30 KB | Claude (geliştirme) | `npm run db:restore` boş veritabanına; ADMIN_PASSWORD ile girildi; Eylül Genel bakış (brüt kâr 290.257 ₺, net −98.462 ₺) kaynakla aynı; işlem geçmişinde "Yedekten geri yüklendi". Canlı yedekle ilk prova birleştirmeden sonra yapılmalı. |

## 10. Otomatik prova

`tests/yedek-geri-yukleme.test.ts` aynı yolu gerçek bir Postgres'te sınar; `YEDEK_TEST_DATABASE_URL` verilmezse
atlanır:

```bash
YEDEK_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/postgres npm test
```

Verilen sunucuda geçici veritabanları açıp sonunda siler. Sınadıkları: tohum verisi ve uç durumlar (bayt dizisi, JSON
`null`, `NaN` / `Infinity`, satır sonu ve emoji içeren metin) yedeklenip boş veritabanına yüklenir, her tablo aynıdır,
yazılmayanlar hedefte yoktur, sayaçlar ileridedir, şema günceldir; yarım, değişmiş ya da yedek olmayan dosya reddedilir,
tarayıcının açtığı düz `.json` okunur; `--sil` olmadan dolu hedefe yazılmaz; sayı tutmazsa hedef olduğu gibi kalır;
`--sil` önce hedefin yedeğini alır, parolaları korur, oturumları kapatır, sayaçları hedefteki yerlerinin gerisine
düşürmez (sonra eklenen kişi eski bir kimliği almaz); belgesiz yedek hedefteki belgeyi silip söyler; eski bir şema
sürümünde (şubelerden önce, ay, satış, personel ve kasa satırlarıyla) alınmış yedek yüklenip son sürüme taşınır, eski
satırlar Tuzla'ya düşer; Postgres hatası Türkçe iletiyle döner; `db:migrate` ve `db:seed` komut satırında verilen
adrese yazar (`.env.local`'daki havuzsuz adres öne geçmez), boş `DATABASE_URL_UNPOOLED` yok sayılır. **Her migration birleştirmesinden sonra** bir kez çalıştırın
(yeni tablolar ve sütunlar kod değişmeden yedeğe girer; bu test onları da gidip getirir).

## 11. Kod

| Yer | Ne |
|-----|----|
| `src/lib/backup/format.ts` | Biçim, yazılmayanlar, şema sürümü, migration öncesi ek adımlar (`BEFORE_MIGRATION_SQL`), yükleme sırası, kullanıcıların giriş bilgileri, hatırlatma (saf; `tests/yedek.test.ts`) |
| `src/server/backup/core.ts` | Dışa aktarım (`backupLines`, `writeBackupFile`) |
| `src/server/backup/restore.ts` | Dosyayı okuma ve doğrulama, geri yükleme |
| `src/server/backup/state.ts` | İndirme bağlantısı, son yedek kaydı (`integration_state` › `backup.last`), yüklenen belgelerin toplamı |
| `src/server/actions/backup.ts` | Parola onayı ve indirme bağlantısı (`prepareBackupDownload`; otomatik yedek için `prepareStoredBackupDownload`) |
| `src/app/api/yedek/route.ts` | Akan indirme (`GET /api/yedek?t=…`) |
| `src/app/panel/ayarlar/backup-client.tsx` | Yedeği indir düğmesi, parola penceresi, otomatik yedeklerin listesi ve İndir'i |
| `scripts/backup.ts`, `scripts/restore.ts` | `npm run db:backup`, `npm run db:restore` |
| `src/lib/backup/auto.ts` | Otomatik haftalık yedeğin kuralları: dosya adı, hafta, saklama, Ayarlar'daki durum satırı (saf; `tests/yedek-oto.test.ts`) |
| `src/server/backup/auto.ts` | Otomatik yedeği alma (`runAutoBackup`, sabah işi çağırır), Ayarlar'daki liste ve durum, indirme bağlantısı |
| `src/server/backup/store.ts` | Otomatik yedeklerin deposu: özel Vercel Blob (`yedek/haftalik/`), yerelde `.data/backups`, testte bellek |
| `src/app/api/yedek/kayitli/route.ts` | Saklanan otomatik yedeğin indirilmesi (`GET /api/yedek/kayitli?t=…`) |
| `src/lib/db-quota.ts` | Veritabanı kotası: kota, yüzde, eşik geçişi, metinler, zil uyarısı (saf; `tests/db-kota.test.ts`) |
| `src/server/db-quota/state.ts`, `check.ts` | Boyut ölçümü (`pg_database_size`), durum kaydı, sabah işinin denetimi ve e-postası |
| `src/app/panel/ayarlar/database-card.tsx` | Ayarlar › Veritabanı: kullanım çubuğu |
| `tests/yedek-kota-db.test.ts` | Otomatik yedek ve kota gerçek Postgres'te (`YEDEK_KOTA_TEST_DATABASE_URL`; `npm run test:db`) |

## 12. Dışa aktarım (.xlsx) ve CSV (okumak için)

Yedekten ayrı, okunabilir kopyalar. Panele geri yüklenmez; rakamlar paneldeki hesapla aynıdır.

**Çalışma kitabı** (`/api/export`, `src/app/api/export/workbook.ts`): Genel bakış'taki **Dışa aktar** düğmesi
(telefonda **Aktar**) ekranın ayını ve şubesini gönderir (`?ay=`, `?sube=`; [SUBE.md](SUBE.md)); Ayarlar › Yedek'teki
**Dışa aktar (.xlsx)** seçicisiz, Tümü. Dosya adı `laffogato-2026-09.xlsx` (şube dosyasında `-marina`).

- **Kapak** (ilk sayfa, "Nasıl Okunur"): rapor adı, **dönem** (seçili ay; Gelir-Gider o yılın 12 ayı), **kapsam**
  (şube ya da Tümü), **oluşturulma** zamanı, kaynak, sayfa sayısı ve başlıklı sayfa listesi (adına tıklayınca açılır);
  altında okuma notları. Dosya özelliklerinde başlık, konu (dönem · kapsam) ve şirket yazar. Dosya Özet'te açılır.
- **Her sayfa:** tablo başlığı koyu zeminde beyaz kalın yazı (sayı sütununun başlığı sağa yaslı), başlık satırı
  dondurulmuş, liste sayfalarında otomatik süzgeç (başlıktan son veri satırına; toplam satırı süzgecin dışında), sütun
  genişliği içeriğe göre (rakam "####" olmaz). Para `#.##0,00 ₺` (eksi kırmızı), yüzde `%0,0`, tarih `gg.aa.yyyy`, ay
  adları Türkçe. Yazdırma: A4, sayfa genişliğine sığar, üst bilgide rapor · sayfa adı · dönem ve kapsam, alt bilgide
  oluşturulma ve "Sayfa n / N"; tablo başlığı her basılı sayfada tekrar eder.
- **Toplam satırları** tek görünümde (kalın, açık zemin, üst çizgi): Satış, Personel, Sabit Giderler, Aylık Alımlar,
  Sayım, Tutarlılık ve Gelir-gider'in toplam satırları. **Faturalar** (tutar, iskonto, net, KDV, ödenecek, kalan borç,
  panelde ödenen, tevkifat, tedarikçiye ödenen KDV), **Ürün Kârlılık** (satış adedi, brüt kâr, net ciro) ve **Cari
  hareketleri** (borç, ödeme) bir boş satır altta `SUBTOTAL` ile toplar: süzgeçte görünen satırları sayar. Aylık
  Alımlar'ın formülleri faturaların toplam satırını saymaz.
- Gri sekmeler bütün ayların ham kayıtlarıdır (yedek için okunur kopya); satır sayıları kayıt sayısıyla aynı, toplam
  satırı yok.
- Faturanın **Kaynak** sütunu "Elle", "Paraşüt" ya da ilk kurulumda içe aktarılan kayıt için **"İçe aktarılmış (eski)"**
  (`src/lib/import-labels.ts`; veritabanındaki değer `excel` olarak kalır, göç yok).
- Testler: rakamlar `tests/export-workbook.test.ts`, biçim `tests/export-bicim.test.ts`, eski adların kalmadığı
  `tests/eski-veri-adlari.test.ts`.

**CSV** (Ürünler ve Hammaddeler › CSV; `src/lib/csv.ts`, `src/app/panel/urunler/csv.ts`,
`src/app/panel/hammaddeler/csv.ts`): görünen satırlar, birimi adında Türkçe sütun adlarıyla ("Satış fiyatı (KDV dahil,
₺)", "Kâr marjı (%)", "Alış KDV (%)"). Noktalı virgül ayraç, UTF-8 BOM (Türkçe harfler bozulmaz), satır sonu CRLF. Sayılar
tek biçimde: binlik ayraç yok, virgüllü ondalık, sabit ondalık sayısı ("1234,50"); değer yoksa boş hücre. Reçetesi boş
üründe birim kâr, marj, maliyet oranı, önerilen fiyat ve aylık brüt kâr boştur (listedeki tire gibi). "=", "+", "-", "@"
ile başlayan metnin başına tek tırnak eklenir: tablo programında formül diye çalışmaz. Testler `tests/csv.test.ts`.

## 13. Otomatik haftalık yedek

Sabah işi (`/api/cron/gunluk`, 08:00–09:00, [BILDIRIMLER.md](BILDIRIMLER.md) › Sistem uyarıları) her gün bakar:
içinde bulunulan haftanın (pazartesi başlar, İstanbul günü) yedeği depoda yoksa tam yedeği alır. Yani yedek pazartesi
sabahı alınır; o gün alınamazsa salı, çarşamba… yeniden denenir.

- **Ne:** panelden indirilenle aynı dosya (§ 3), yüklenen fatura belgeleri hariç. Yazılmayanlar § 2'dekiyle aynı
  (parola özetleri, iki adımlı doğrulama anahtarları, Paraşüt oturumu ve şifreli ayarlar, bildirim anahtarları…).
  Başlıkta alan kişi "Otomatik (sabah işi)" yazar. `npm run db:restore` ile aynı yoldan yüklenir (§ 4).
- **Nerede:** canlıda özel Vercel Blob deposu: fotoğraflarla aynı depo, `yedek/haftalik/` klasörü, dosya adı
  `laffogato-yedek-oto-2026-11-23-0812-<8 rastgele karakter>.json.gz` (İstanbul saati). Erişim Private: adresi tek
  başına işe yaramaz; dosya panelde yalnız aşağıdaki **İndir**'le, panel dışında yalnız Vercel hesabından (Storage ›
  Blob) iner. Yerelde `.data/backups` (`BACKUP_DIR` ile değişir; git'e girmez). Vercel'de depo bağlı değilse otomatik
  yedek kapalıdır, kart "Depo yok" der ([DEPLOY.md](DEPLOY.md) › `BLOB_READ_WRITE_TOKEN`).
- **Ne kadar:** en yeni 8 dosya (son 8 hafta). Yeni dosya yazılınca daha eskisi silinir. Silme aksarsa yedek yine
  alınmış sayılır, fazlası sonraki hafta silinir. Klasördeki başka adlı dosyalara dokunulmaz.
- **Süre:** sabah işinin öteki adımlarıyla aynı anda çalışır, onları bekletmez. Veritabanı en geç işin 40. saniyesine
  kadar okunur (yetmezse bırakılır, okuma işlemi kapanır, dosya yazılmaz, ertesi sabah yeniden denenir); adım en geç
  50. saniyede kapanır. Belgesiz yedek bugün ~1 MB, birkaç saniye sürer.
- **Ekran:** Ayarlar › Yedek › **Otomatik haftalık yedek**: durum rozeti ve açıklaması (Çalışıyor: son yedeğin günü ve
  boyutu; Alınamadı: son denemenin günü ve hatası; Gecikti: en yeni dosya 10 günden eski; Bekliyor: henüz dosya yok;
  Depo yok) ve depodaki dosyalar, yeni önce (tarih, gün, saat, boyut). **İndir** parolanızı ister, elle yedekle aynı
  kalıp: bağlantı iki dakika ve yalnız sizin oturumunuzla geçerli, dosya adı bağlantının içinde mühürlü; yanlış parola
  işlem geçmişine "Hatalı parola onayı (Yedek)" olarak yazılır. Dosya `/api/yedek/kayitli` üzerinden iner; deponun
  adresi tarayıcıya hiç çıkmaz. Yalnız yönetici.
- **İşlem geçmişi:** "Otomatik yedek alındı" (Sistem; tablo, satır, boyut, silinen eski yedek sayısı) ve "Otomatik
  yedek indirildi" (kim, hangi hafta, boyut).
- **Alınamazsa:** sabah işinin **Otomatik yedek** adımı hata verir, iş "Kısmen" olur: zilde turuncu "Sabah işinde bir
  adım hata verdi" (metinde "Otomatik yedek: <hata>"), ertesi sabahın e-postasında "Dünkü sabah işinde bir adım hata
  verdi". Ayarlar › Yedek'te rozet kırmızı "Alınamadı", telefonda kartın kapalı satırı "Otomatik yedek alınamadı".
  Ertesi sabah yeniden denenir; alınınca hepsi kalkar. Günlük işler'de adım yalnız yedeğin alındığı ("Haftalık yedek
  alındı"), alınamadığı ya da depo olmadığı gün yazılır.
- **Durum kaydı:** `integration_state` › `backup.auto` (son deneme, son hata, son başarılı yedek). Hangi dosyaların
  durduğunu depo söyler, veritabanı değil: geri yüklemeden sonra da liste doğrudur.
- **Elle yedek sürer:** kartın "Son yedek"i ve 30 günlük hatırlatma yalnız elle indirilen yedeğe bakar (§ 1).
- **Büyürse:** panelden indirme dosyayı bellekten verir; Vercel'in yanıt sınırı (4,5 MB) yüzünden 4 MB'ı aşan bir
  otomatik yedek panelden inmeyebilir. O durumda dosya Vercel › Storage › Blob › `yedek/haftalik/`'tan indirilir.

## 14. Veritabanı kotası

Panelin veritabanı Neon'un ücretsiz planında: kota 0,5 GB; dolunca yazma durur (laffogato.net'in veritabanı 24 Kasım
2026'da böyle doldu). Ücretli plana geçilene kadar panel uyarır.

- **Ölçüm:** sabah işi her gün `pg_database_size(current_database())` ile boyuta bakar (tablolar, dizinler ve boş alan).
  Kota `DB_QUOTA_MB` ortam değişkeninden (MB; yoksa ya da geçersizse 512, Neon ücretsiz planı).
- **Uyarı:** %70 ve %90 eşiği **ilk geçildiğinde** yöneticiye zil ve e-posta. Eşik başına bir kez; kullanım eşiğin
  altına inip yeniden geçerse yine. Seviye eşiğin 2 puan altına inmeden düşmez (%70 çevresinde gidip gelen boyut her gün
  e-posta atmasın). Bir günde %65'ten %93'e sıçrarsa yalnız "%90" gider.
- **Zil (Sistem, yalnız yönetici, yalnız canlıda):** turuncu "Veritabanı kotasının %70'i doldu" / "…%90'ı doldu",
  kullanım ve ne yapılacağıyla; Ayarlar › Veritabanı'na götürür. Uyarı seviye düşene kadar durur. %90 Genel bakış'ın
  kırmızı şeridinde de ("Veritabanı" bağlantısıyla) görünür; `/api/health`'in 503'üne girmez. Zil boyutu yeniden
  sormaz, sabah işinin son ölçümünü okur.
- **E-posta:** sabah e-postasının alıcılarına (personel ya da pasif hesabın adresi düşer, E-53), sistem uyarısı
  e-postasının kabuğuyla: konu "L'Affogato · Veritabanı kotasının %90'ı doldu", üstte "Veritabanı", ne yapılacağı ve
  **Veritabanı kullanımını aç** düğmesi. `notification_log` anahtarı `db-kota:<eşik>:<geçiş günü>`. Gidemezse (Resend
  hatası) ertesi sabah yeniden denenir. E-posta kapalıysa, Resend kurulu değilse ya da alıcı yoksa yalnız zil.
- **Ekran:** Ayarlar › **Veritabanı** (`/panel/ayarlar#veritabani`, yalnız yönetici): o anki boyut / kota, yüzde ve
  çubuk (%70 ve %90 işaretli; %70'te turuncu, %90'da kırmızı), sabah işinin son ölçümü; eşik geçilmişse uyarı kutusu.
  Telefonda kapalı satır "%41 dolu · 210 MB / 512 MB".
- **İşlem geçmişi:** "Veritabanı kotası uyarısı" (yüzde, kullanım, geçilen eşik). **Günlük işler:** eşik geçildiği gün
  adım "Veritabanı kotası %70'i geçti" (iş "Çalıştı" kalır); ölçüm hata verirse "Veritabanı kotası ölçülemedi" (iş
  "Kısmen").
- **Plan değişince:** Vercel'de `DB_QUOTA_MB`'yi yeni kotaya göre yazın (ör. 10 GB için `10240`) ve yeniden
  yayınlayın. Yer açmak için eski kayıtların temizliği geliştiricinin işidir; önce yedek alınır (§ 1).
- **Durum kaydı:** `integration_state` › `db.quota` (bildirilmiş seviye, geçiş anı, e-postası gitti mi, son ölçüm).

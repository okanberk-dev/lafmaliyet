# Haftalık yönetici özeti (pazartesi e-postası)

Her pazartesi sabahı panel yöneticilerine kısa bir e-posta gider: **"Neye bakarsam en çok para kurtarırım?"** Geçen
haftanın ve bekleyen işlerin en çok 5 maddesi, kasanıza etkisine göre sıralı; her madde tek satır başlık, bir satır
ayrıntı ve ilgili panel ekranını açan bağlantı. Sabah e-postası "bugünün haberi"dir (ödemeler, yeni faturalar, fiyat
onayları, sistem sorunları); haftalık özet ödeme ya da fatura listelemez, konu başına tek satırla parayı ve ekranı
söyler.

Kod: saf modüller `src/lib/weekly/core.ts` (hafta, seçim, gönderim kaydı, karar, adım), `items.ts` (maddelerin
yapıcıları), `text.ts` (metinler); e-posta `src/server/notify/weekly-template.ts` (sabah e-postasının kabuğu
`emailLayout`); kaynaklar `src/server/weekly/collect.ts`, gönderim `src/server/weekly/send.ts`, eylemler
`src/server/actions/weekly.ts`, ekran `src/app/panel/hatirlaticilar/weekly-row.tsx`. Testler
`tests/haftalik-ozet.test.ts`. Plan ve kararlar: `docs/planlar/haftalik.md` (CRITIQUE2 §6 düzeltmeleriyle).

## 1. Ne zaman, kime

- **Pazartesi 08:00–09:00** (İstanbul), sabah işinin içinde (`/api/cron/gunluk`; Vercel Hobby'de günlük iş, yeni iş
  eklenmedi). Sabah e-postasından sonra, kuyruktaki öteki adımlarla (hatırlatıcı bildirimi, karaoke, menü, online satış,
  fotoğraf temizliği…) aynı anda çalışır.
- Pazartesi gönderilemezse (süre yetmedi, Resend reddetti, iş çalışmadı) **salı**, sonra **çarşamba** yeniden denenir;
  perşembeden sonra o haftanın özeti atlanır.
- **Alıcılar:** etkin yönetici hesaplarının giriş e-postaları (daveti kabul edilmemiş hesap hariç). Bildirim adresleri
  (muhasebeci olabilir) almaz: e-posta kâr ve kasa rakamları taşır, personel maliyet görmez. İki yönetici varsa tek
  e-posta ikisine gider. Gönderen sabah e-postasınınki (Gönderim ayarları › Gönderen).
- **Yalnız canlıda** (`VERCEL_ENV=production`): önizlemeler aynı veritabanını kullanır, haftayı kapatmasın.
- Sessiz hafta da gider: "Bu hafta dikkat isteyen bir şey yok · Paneldeki kontrollerde bu hafta öne çıkan bir şey
  yok." Hiçbir kaynak okunamadıysa gitmez (boş özet "her şey yolunda" demesin), adım hata olur, ertesi gün yeniden.

## 2. Maddeler

Her kaynaktan en çok bir madde (en büyüğü). Tutarlar tam lira; "≈" tahmin demek. Lira değeri olan maddeler **bu ayın
parası**: süren kayıp ayda tutarıyla (₺/ay), tek seferlik olgu kendi tutarıyla. Taban 100 ₺ (stok farkında 500 ₺).

| Kaynak | Ne zaman | Başlık | Bağlantı |
|---|---|---|---|
| Nakit planı ([NAKIT-PLANI.md](NAKIT-PLANI.md)) | Bakiye son 7 günde girildi, ilk eksi gün 14 gün içinde | `1 Kasım Pazar para yetmeyebilir: tahmini −12.400 ₺` · ayrıntıda o günün en büyük iki gideri, bakiye 3 günden eskiyse yaşı. Dalga 12'den beri planın vergi satırlarını da sayar ([VERGI.md](VERGI.md) § 8): muhtasar tahmini, yasal oranlı SGK, beyanname damgaları, stopajlı sabit giderin net ödemesi ve **hazır** çeyreğin (ya da tutarı girilmiş) geçici vergisi. Taslak çeyreğin geçici vergisi planda tutarsızdır (“Tutarı girilmemiş ödemeler”), sayılmaz | Nakit planı |
| Zam etkisi (Ürünler › Hammadde zamları) | Fiyatına bakılacak (böyle kalsın denmemiş) ürünlerde en büyük (ürün, hammadde) çifti, boylar toplanır | `Latte: Süt %2,5 zammı ayda ≈ 4.800 ₺ kâr kaybı` · toplam, ürün sayısı, satış ayı. Satış listesi yoksa değersiz `Hammadde zammı: 3 ürünün fiyatına bakın` | `/panel/urunler#zamlar` |
| Kasa raporları ([KASA-RAPORU.md](KASA-RAPORU.md)) | Geçen haftanın eksikleri toplam ≥ 100 ₺ | `Kasa geçen hafta 2 gün eksik: toplam 640 ₺` (tek gün: `20 Ekim Salı kasası 640 ₺ eksik`) · en çok eksik gün, fazla günler, açılışı devirle tutmayan gün, ertesi gün düzeltilen rapor, fotoğraftan farklı yazılan rapor. Eksik yoksa ama bu işaretler varsa değersiz `Geçen hafta kasa: 2 gün açılış devirle tutmuyor`. Bütün şubelerin raporları okunur; "gün" gündür, rapor değil: iki şubenin aynı günkü eksiği tek gün, tutarı ikisinin toplamı (Tuzla 300 ₺ + Marina 340 ₺ → `20 Ekim Salı kasası 640 ₺ eksik`; "en çok" gün şubelerin toplamıyla). Fazla günler ve devirle tutmayan günler de tekil sayılır; bir şubenin fazlası öbürünün eksiğini kapatmaz (denetim 21 Kasım #30). Birden çok kasa açıkken eksik tek şubedeyse başlık şubeyi yazar (`Marina · 20 Ekim Salı kasası 640 ₺ eksik`), iki şubedeyse ayrıntı şube şube toplar (`Tuzla 400 ₺, Marina 340 ₺`) | Kasa raporları (en çok eksik günün ayı; birden çok kasa açıkken o günün en çok eksik şubesi, `&sube=`) |
| Komisyon ve hakediş ([KOMISYON.md](KOMISYON.md)) | Geciken hakediş (beklenen − gelen), yemek kartında %6'nın üstü (fazla kesilen), komisyon dışı ücret | `Hakediş gecikti: Pluxee (Ekim) · ≈ 8.605 ₺` · son gün; öteki uyarılar "· 2 konu daha". Beklenen bilinmiyorsa değersiz | Komisyon & hakediş, kanalın kartı |
| ModPOS fiyatları ([FIYATLAR.md](FIYATLAR.md)) | Panelde zamlanıp kasada eski fiyatla satılan ürünler: (fiyat − kasadaki) ÷ (1 + KDV) × ayda ModPOS adedi | `ModPOS'ta 5 ürün eski fiyatla: ayda ≈ 1.900 ₺ kâr kaybı` · en çok olan ve kaç gündür beklediği. Tutar yoksa, en eskisi 3 gündür bekliyorsa değersiz `ModPOS'ta 5 fiyat değişecek` | Fiyatlar › Kasaya işle |
| Zayi ve ikram ([ZAYI-IKRAM.md](ZAYI-IKRAM.md)) | Geçen haftanın malzeme maliyeti en az 300 ₺ ve önceki 4 haftanın ortalamasının 1,5 katı | `Geçen hafta zayi ve ikram 900 ₺` · ortalama, en çok olan | Zayi & ikram (ay) |
| Stok sayımı (Tutarlılık) | Geçen ayın sayımında açıklanamayan fark ≥ 500 ₺ (kayıtlı zayi ve ikram düşülmüş) | `Ekim sayımında 6.200 ₺ açıklanamayan stok farkı` · en çok olan hammadde; **bir kez** | Tutarlılık (ay) |
| Karaoke doluluğu ([KARAOKE.md](KARAOKE.md)) | Son 4 haftanın en boş bloğu %25'ten az dolu (en az 2 hafta ve 8 oturum) | `Salı–Perşembe 14–17 karaoke %12 dolu` · genel doluluk | Karaoke doluluğu |
| Kontrol listeleri ([KONTROL-LISTELERI.md](KONTROL-LISTELERI.md)) | Geçen hafta tamamlanmayan liste ya da sorun; kasa raporu olmayan gün sayılmaz (kafe kapalı olabilir; kasa raporu henüz kullanılmıyorsa her gün sayılır) | `Geçen hafta 2 kapanış listesi yapılmadı` / `Geçen hafta kontrol listelerinde 2 sorun` · örnek sorun | Kontrol geçmişi |

**Sıra ve sınır:** lira değeri olanlar büyükten küçüğe (eşitlikte nakit, zam, kasa, komisyon, ModPOS, stok, zayi);
değeri olmayanlar sonda (kasa, karaoke, kontrol, zam, ModPOS, komisyon). En çok 5 madde, değersiz en çok 2; değersiz
varsa biri için yer kalır (4 + 1). Az madde doldurulmaz.

**Tekrar:** lira değeri olan madde çözülene kadar her hafta yinelenir; değersiz madde iki hafta üst üste aynı anahtarla
gelmez (aynı boş karaoke saatleri iki haftada bir); stok farkı bir kez. Anahtarlar ad taşımaz (`zam:12:4`,
`stok:2026-10`, `karaoke:bos:1-3:14-17`) ve `integration_state` › `haftalik.gecmis`'te 8 hafta tutulur.

**Sabah e-postasıyla aynı olgu yinelenmez:** pazartesi sabah e-postası bir komisyon uyarısını ya da dünkü kontrol
listesini ilk kez bildirdiyse (aynı gün `notification_log`'da `komisyon:<uyarı>`, `kontrol:<gün>`), haftalık özet o
maddeyi düşer (komisyonda sıradaki uyarı geçer). Ertesi pazartesi hâlâ açıksa özette.

**Bağlam satırları** (madde değil, sıralanmaz):

- `Geçen hafta kasa cirosu 68.900 ₺ · önceki 4 haftaya göre %12 az` (KDV dahil, Z toplamının içindeki ödenmez /
  ikram düşülür: Genel bakış ve Bugün'ün cirosuyla aynı kural, denetim 13 Kasım HM-08; laffogato.net online kasadan
  geçmez). Kaynak Genel bakış'ın ay rakamıyla aynı kasa satırları (`tillRows`): kasa raporu, raporu olmayan LafPOS
  gününde gün sonu (geçiş gününden önceki deneme günü sayılmaz). Karşılaştırma **aynı şube ve günlerle** (25 Kasım 2026,
  denetim bulgusu 65; `salesLine`, Kıyas kartının `comparePairs`'ı): geçen haftanın her günü önceki dört haftanın aynı
  günüyle şube şube eşlenir, iki günü de bilinen şube-gün iki tarafa girer. Geçen hafta en az 6 gün raporlu ve önceki dört
  haftanın en az ikisinde en az 6 gün eşleştiyse karşılaştırılır, %2'den az farkta "önceki 4 haftayla aynı"; değilse
  `(5 gün raporlu)`; satır yoksa satır yok. Geçen hafta satan ama kıyaslanan bir haftada hiç günü olmayan şube (yeni
  açılan Marina) büyüme sayılmaz, satır söyler: `… · önceki 4 haftayla aynı (aynı şubelerle: Marina önceki haftalarda
  yoktu)`. Önceden yalnız kasa raporları okunuyor, haftaların toplamları şube ayrımı yapmadan kıyaslanıyordu.

Kişi adı yazılmaz: kasa raporunu giren ya da sayan, kontrol listesini dolduran, "Sorun var" notu (serbest metin)
e-postaya girmez; yalnız ürün, hammadde, kanal, liste ve madde adları.

## 3. Ekran: Ödemeler & hatırlatıcılar › E-posta bildirimleri › Haftalık özet

"Hatırlatma e-postaları" satırının altında; ayrı anahtar (`haftalik.settings`, varsayılan açık; hatırlatma e-postalarını
kapatmak bunu kapatmaz). Ayar `notify.settings`'e yazılmaz: `saveNotificationSettings`
(`src/server/actions/reminders.ts:454`) o değeri dört alanıyla baştan yazar, ek bir alan ilk kayıtta düşerdi. Satırda kime gittiği ("Yöneticilere gider: Okan, Ayşe.") ve bu haftanın durumu:

| Durum | Metin |
|---|---|
| Kapalı | Kapalı: pazartesi e-postası gitmez. |
| Bu hafta gitti | Bu hafta gönderildi · 26.10.2026 08:04 |
| Resend reddetti ya da gün kayıt yazmadan bitti | Pazartesi gönderilemedi (süre yetmedi); salı sabahı yeniden denenecek. / … bu sabah yeniden denenecek. (deneme kalmadıysa: Bu hafta gönderilemedi.) |
| Belirsiz ya da yarıda kaldı | Bu haftaki gönderim yarıda kaldı; e-posta gelmediyse “Örneği bana gönder” ile alabilirsiniz. |
| Bu hafta henüz yok | Son gönderim 19.10.2026 08:03 · bu haftanın özeti salı sabahı gider / Henüz gönderilmedi · ilk özet salı sabahı gider (bu haftanın sıradaki sabahı; çarşambadan sonra "· sıradaki pazartesi sabahı" ve "ilk özet pazartesi sabahı gider") |

Gönderilemeyen haftada başarısız günün ve sıradaki denemenin adı yazılır: Resend'in reddinde kaydın günü, süre yetmeyen,
Resend'i olmayan ya da hiçbir bilgiyi okuyamayan günde (kayıt yazılmaz) o haftanın sabah işindeki `weekly` adımı
(`job_runs`); reddedilen kayıttan sonraki bir gün kayıt yazmadan bittiyse o gün ve nedeni. İş günü 05:00'te döner;
05:00–09:00 arası günün denemesi henüz yapılmamış sayılır ("bu sabah"), sonrası yarına kalır, çarşambadan sonra deneme
yoktur (`nextWeeklyTry`). Aynı kural hafta içinde açılan özete de uygulanır: pazartesi kapalıydı, salı öğlen açıldıysa
bu haftanın özeti çarşamba sabahı gider ve satır bunu söyler (anahtar açılırken, sunucunun yanıtından önce de);
çarşamba sabahından sonra açılan özet gelecek pazartesi gider.

- **Haftalık özeti önizle:** bu haftanın özeti bugünkü verilerle (gönderilmez, hiçbir şey yazılmaz); okunamayan kaynak
  açıklamada. Önizleme ve örnek pazartesi giden e-posta gibi **işletmenin tamamıyla** okur, soldaki şube seçimiyle
  değil (`collectWeekly` kaynakları `withBranchScope(ALL_BRANCHES, …)` içinde çalıştırır; denetim 21 Kasım #18).
  Önceden Marina seçiliyken önizleme nakit planını Marina'nın cirosuyla kuruyor, kasa maddesi yalnız Marina'yı sayıyordu.
- **Örneği bana gönder:** yalnız tıklayan yöneticinin adresine, konu "Örnek · …"; haftanın asıl gönderimini etkilemez.
  Resend anahtarı yoksa kapalı (önizleme her zaman çalışır).
- Gönderimler ve örnekler "Son gönderimler"de görünür; gidemeyen haftalık kayıt "Haftalık özet gönderilemedi" (örnek:
  "Haftalık özet örneği gönderilemedi") başlığıyla ve kaydın iç işareti olmadan (`weeklyLogText`). Ayarlar › Günlük
  işler'de adım `Haftalık özet gönderildi`, `Haftalık özet kapalı` / `Resend kurulmadı` (yalnız pazartesi), `süre
  yetmedi, yarın denenecek`, `gönderilemedi` (iş "Kısmen" olur; zil ve ertesi sabahın e-postası söyler). Hatanın
  iletisi sıradaki denemeyi günün adıyla söyler ("Haftalık özet: Resend şu an yanıt vermiyor; salı sabahı yeniden
  denenecek"; ileti ertesi sabahın e-postasında da okunur, "yarın" kayardı).

## 4. Haftada en çok bir kez

- Gönderimden hemen önce `notification_log`'a `haftalik:<ISO hafta>` satırı yazılır (`Gönderiliyor`); tekil anahtar
  yarışı tek çalışmaya verir (iki tetikleme, elle çalıştırma).
- Başarılı gönderim satırı tamamlar ve haftayı `haftalik.gecmis`'e yazar: `db:reset` bildirim günlüğünü siler ama bu
  anahtarı silmez, aynı hafta ikinci kez gitmez.
- Resend açıkça reddederse (`Yeniden denenecek: …`) ertesi uygun gün aynı satır yeniden alınır. Gönderim belirsizse
  (zaman aşımı, ağ hatası, 409: ileti gitmiş olabilir; `Gönderim belirsiz: …`) ya da işlev gönderirken kesildiyse
  (`Gönderiliyor` 5 dakikadan eski) **yeniden gönderilmez**; ekran ve Günlük işler bunu söyler, yönetici örneği
  kendine gönderebilir.
- Resend'in tekil anahtarı `haftalik-<hafta>-<gün>`: anahtar Resend'de 24 saat yaşar ve aynı anahtarla farklı içerik
  409 alır; ertesi günün denemesi bir saatlik pencerede 24 saatten önce gelebilir ve e-postanın tarihi değişir.
  Haftada tek gönderimi yukarıdaki satır sağlar.

## 5. Zaman bütçesi (işlev 60 sn)

Haftalık adımın kendi son anı `jobStart + 52 sn`; başlamak için en az 9 sn kalmalı (yoksa "süre yetmedi", yarın).
Kaynaklar aynı anda okunur, her biri en çok 4 sn (modeli okuyan beşi tek `loadModel()`'i paylaşır); gönderim tek
deneme, en çok 4 sn. Normal pazartesi kuyruğa ~0 sn ekler (öteki adımlar 8 sn'ye kadar sürer); Paraşüt'ün 35 sn'lik
yeniden denemesinden sonra da sığar, sığmazsa salıya kalır. Kuyruğun sınırı 55 sn (`src/server/jobs/capped.ts`).

## 6. Önizleme ortamı, yerel, KVKK

- Vercel önizlemelerinde iş çalışmaz ve giriş yapılamaz; adım ayrıca yalnız canlıda gönderir.
- Yerelde otomatik adım atlanır. Önizleme Resend'siz çalışır; örnek gönderimi yerel `RESEND_API_KEY` ister ve yalnız
  giriş yapan yöneticiye gider. Sabah işini denemek için: pazartesi, `VERCEL_ENV=production CRON_SECRET=… npx next dev`
  ve `curl -H "Authorization: Bearer …" localhost:3000/api/cron/gunluk` (çalışma kopyasının kendi veritabanında).
- KVKK: müşteri verisi yok (karaoke toplam doluluk; site siparişleri okunmaz), personel adı yok, ek yok, fotoğraf ya da
  depo adresi yok. Resend zaten sabah ve kasa e-postalarını gönderiyor: yeni bir işleyici yok.

## 7. Yeni kaynak eklemek

Bir yapıcı (`src/lib/weekly/items.ts`: dar girdi → `WeeklyItem | null`, metin ve anahtar adsız) + bir kaynak
(`collect.ts` › `COLLECTORS`: öteki ekranın dışa açık yükleyicisini okur, girdiye çevirir, sınırı en çok 4 sn) +
testler (`tests/haftalik-ozet.test.ts`). Yeni kaynak `WeeklySource`'a, `SOURCE_LABELS`'a ve sıralardan birine
(`VALUED_ORDER` / `PLAIN_ORDER`) eklenir.

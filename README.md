# L'Affogato — Maliyet & Kârlılık Paneli

`L'Affogato – Maliyet & Kârlılık.xlsx` dosyasının web uygulaması. Excel'deki 13 sayfanın her biri burada bir ekrana
karşılık geliyor. Hesaplama motoru Excel formüllerini birebir uyguluyor ve bunu otomatik testler kanıtlıyor. Excel'de
olmayan araçlar da eklendi: ay bazlı çalışma, POS eşleştirme hafızası, fiyat geçmişi, uyarılar, menü mühendisliği,
senaryo simülatörü, Excel'e aktarım, QR menü, aylık harcamalar, Paraşüt'ten her sabah otomatik fatura eşitlemesi
([docs/PARASUT.md](docs/PARASUT.md)), tedarikçilerin bilgileri (unvan, IBAN, iletişim), borç ve ödeme takibi, Paraşüt'ten geçmiş faturaları, ödeme talebi
([docs/TEDARIKCILER.md](docs/TEDARIKCILER.md)), ödemeler ve hatırlatıcılar ile sabah e-postası
([docs/BILDIRIMLER.md](docs/BILDIRIMLER.md)), yöneticilere pazartesi haftalık özet ([docs/HAFTALIK-OZET.md](docs/HAFTALIK-OZET.md)), 6 haftalık nakit planı ve KDV tahmini ([docs/NAKIT-PLANI.md](docs/NAKIT-PLANI.md)),
hammadde zamlarının ayda kaç lira kâr götürdüğü, laffogato.net'e bağlı karaoke sayacı ve rezervasyon zili
([docs/KARAOKE.md](docs/KARAOKE.md)), laffogato.net menüsüne bağlı ürünlerde iki yönlü fiyat ve Satışta / Tükendi
eşitlemesi ([docs/SITE-MENU.md](docs/SITE-MENU.md); siteyle bütün bağlantıların kısa haritası ve çakışma kuralları
[docs/SENKRON.md](docs/SENKRON.md)), menü fiyatlarının toplu değişikliği, kasada (ModPOS; LafPOS'a geçiş gününden
itibaren yalnız siteye bağlı olmayan ürünler) elle değişecek fiyatların listesi ve satış fiyatı geçmişi
([docs/FIYATLAR.md](docs/FIYATLAR.md)), kendi Siparişler ekranına düşen
uygulama siparişleri ve masa çağrıları ("Garson çağır"), sipariş zili ve
tek dokunuşla aşama: Hazır, Masaya götürüldü, Teslim edildi ([docs/SITE-SIPARIS.md](docs/SITE-SIPARIS.md)), sitenin
online satışlarının kâr-zarara, tüketime ve kasa raporuna girmesi ([docs/SITE-SATIS.md](docs/SITE-SATIS.md)),
personelin reçete değişikliği önerip yöneticinin önce / sonra farkıyla onayladığı akış, herkesin kendi
hatırlatıcıları, e-posta ve WhatsApp'la giden gün sonu kasa raporu ([docs/KASA-RAPORU.md](docs/KASA-RAPORU.md)),
stok farkını açıklayan zayi / ikram kaydı ([docs/ZAYI-IKRAM.md](docs/ZAYI-IKRAM.md)), günün işlerini rol rol tek
ekranda toplayan Bugün ([docs/BUGUN.md](docs/BUGUN.md)) ve Claude uygulamasından panele salt okunur soru
([docs/CLAUDE-BAGLANTISI.md](docs/CLAUDE-BAGLANTISI.md)).

- **Adres:** https://ladmin.laffogato.net (kafenin sitesi laffogato.net ayrı projede kalır)
- **Frontend:** Next.js 16 (App Router, Cache Components), React 19, Tailwind CSS 4, Recharts, Motion
- **Arayüz:** [AkmanOS](https://akmanos.com) bileşen kütüphanesinin açık teması (`src/components/akmanos/`), L'Af logosu
  laffogato deposundan. Tasarım kuralları [docs/TASARIM.md](docs/TASARIM.md)
- **Backend:** Next.js Server Actions + Route Handlers (Vercel Functions), Postgres (Neon), Drizzle ORM
- **Oturum:** imzalı JWT çerezi (jose) ve scrypt parola özeti. Roller: yönetici ve personel (**Ayarlar › Kullanıcılar &
  roller**). İsteğe bağlı iki adımlı doğrulama (TOTP, Google/Microsoft Authenticator) ve kurtarma kodları
  (**Hesabım**); 5 hatalı denemede 15 dakika kilit; parola, rol ya da erişim değişince eski oturumlar kapanır;
  yönetici hesaplarını etkileyen işlemler (yönetici ekleme ya da yapma, bir yöneticinin parolası, e-postası, iki
  adımlısı, bağlantısı, pasif yapma, silme) işlemi yapanın kendi parolasıyla onaylanır
- **Gizlilik:** arama motorlarında görünmez (her yanıtta `X-Robots-Tag: noindex`, sayfalarda `noindex`; `robots.txt` taramayı açık bırakır ki Google noindex'i görsün), güvenlik
  başlıkları `next.config.ts`'te; `lafmaliyet.vercel.app` panelin tek adresine (`ladmin.laffogato.net`) yönlenir

Geliştirilmiş prompt, görev planı, Excel analizi ve bulunan tutarsızlıklar [docs/PROMPT-VE-PLAN.md](docs/PROMPT-VE-PLAN.md)
dosyasında. Vercel kurulumu için [docs/DEPLOY.md](docs/DEPLOY.md).

## Ekranlar

| Ekran | Adres | Excel karşılığı |
|-------|-------|-----------------|
| Genel bakış (reçeteye göre net satış, brüt kâr ve net kâr ModPOS + laffogato.net online; başabaş online brüt kârı düşer; süren ayda kısa satış listesi kendi günleriyle) | `/panel` | Panel |
| Bugün: günün işleri ve durumu (dünkü / bugünkü kasa raporu, açılış ve kapanış listeleri, zayi / ikram, ay sonu sayımı; yöneticiye günlük işlerin sorunları, dünkü eksik ya da sorunlu kontrol listeleri, ödemeler, geciken hakedişler, fatura kontrolü, ürün bağlantıları, fiyatı girilmemiş hammaddeler, onaylar (reçete önerileri ve personel istekleri), fiyat onayları, hammadde zammı, kasada değişecek fiyatlar; kasa farkı, açılış ↔ devir ve ertesi gün düzeltme), Hatırlatıcılarım (tamamlandı), Yaklaşan ödemeler (yönetici), Satış tahmini (yönetici: bugünün tahmini, kaç kişi, kaç tatlı, 7 gün), Bugün kafede (personelde önce bugünün yoğunluğu ve tatlı sayısı; karaoke, uygulama siparişleri (Siparişler'e götürür); tutar yok). Personel girişte burada açılır ([docs/BUGUN.md](docs/BUGUN.md)) | `/panel/bugun` | — (yeni) |
| Ürünler, reçete kartı (Hammadde zamları: önerilen fiyat ve zammın ayda kaç lira kâr götürdüğü) | `/panel/urunler`, `/panel/urunler/[id]` | Ürün Kârlılık, Reçete Kartları |
| Site menüsü: ürünleri laffogato.net menüsündeki kalemlere bağlama (öneriler), bağlantının durumu, Siteyle eşitle ([docs/SITE-MENU.md](docs/SITE-MENU.md)) | `/panel/urunler/site` | — (yeni) |
| Fiyatlar: toplu değiştir (yüzde, tutar ya da önerilen fiyat; önizleme ve aylık etki), kasaya (ModPOS) işle (LafPOS'a geçiş gününden itibaren siteye bağlı ürünlerin fiyatını LafPOS siteden alır, liste yalnız bağlı olmayanlar için), fiyat geçmişi ve toplu değişikliği geri alma ([docs/FIYATLAR.md](docs/FIYATLAR.md)) | `/panel/urunler/fiyatlar` | — (yeni) |
| Hammaddeler: onay bekleyen fiyatlar (Paraşüt faturasında %40'tan büyük değişim onaylanınca uygulanır; çarpan önerisi kanıttan: kalemin adındaki paket boyu ya da Claude Haiku'nun okuduğu fatura, [docs/FATURA-OKUMA.md](docs/FATURA-OKUMA.md)), tedarikçilere göre fiyat ([docs/PARASUT.md](docs/PARASUT.md) 5b, 5c) | `/panel/hammaddeler` | Hammaddeler |
| Reçete defteri (barista; personel değişiklik ya da reçetesiyle yeni ürün önerir, yönetici onaylayınca uygulanır; yeni üründe boy başına satış fiyatı yazabilir, listede olmayan malzemeyi formdan çıkmadan ekler) | `/panel/receteler` | — |
| Onaylar (yönetici; menüde Bugün'ün altında): personelin onaya giden istekleri bölüm bölüm (kasa: düzeltme ve silme, geç rapor, kasadan çıkan, fotoğraf kaldırma, kapalı gün; geç zayi / ikram ve zayi silme), yönetici yalnız ekranda gördüğü sürümü onaylar, kimse kendi isteğini onaylayamaz, son 30 günün kararları ([docs/ONAYLAR.md](docs/ONAYLAR.md)); reçete önerileri: önce / sonra farkı, maliyet etkisi, onayla ya da gerekçeyle reddet; yeni ürün önerisinde satır maliyeti, tahmini fiyatlı malzeme işareti (değişiklik önerisinde de not), personelin önerdiği fiyatla dolu gelen satış fiyatı ve canlı kâr marjı, "Onayla ve ürünü ekle" | `/panel/onaylar` | — (yeni) |
| Siparişler (barın ekranı): laffogato.net'ten ödenmiş uygulama siparişleri (masa ve gel-al'da müşterinin notu), sipariş zili ve tek dokunuşla aşama (sitenin aşama ucuna gider; iade ve iptal sitede, başlıkta "laffogato.net'te aç"), masa çağrıları ("Garson çağır": garson, su, peçete; ayrı zil, tek dokunuşla Gördüm), menüde açık sayısı ([docs/SITE-SIPARIS.md](docs/SITE-SIPARIS.md)) | `/panel/siparisler` | - (yeni) |
| Karaoke (barın ekranı): açık uygulama siparişlerinin tek satırı (Siparişler'e git), oda sayacı, yeni rezervasyon zili, süre dolunca alarm, sitedeki rezervasyonla çakışma uyarısı, Tükenenler (biten ürünü Tükendi yapmak ve Satışa aç; yönetici "Kapalı tut"); yöneticiye ay özeti, doluluk haritası ve bağlantı durumu ([docs/KARAOKE.md](docs/KARAOKE.md)) | `/panel/karaoke` | — (yeni) |
| Karaoke doluluğu (yönetici): gün × saat ısı haritası, doluluk %, saat başına gelir, uzatma oranı, son dakika iptal, kaç gün önceden; son 4 / 12 hafta ya da ay; ay ay karşılaştırma; oda saatleri ve geçmişi siteden alma (ad ve not olmadan) ([docs/KARAOKE.md](docs/KARAOKE.md)) | `/panel/karaoke/doluluk` | — (yeni) |
| Hatırlatıcılarım (herkesin kendi hatırlatıcıları; saatinde uyarı, tekrar, erteleme) | `/panel/hatirlaticilarim` | — (yeni) |
| Personele açılanlar (dalga 10, [docs/planlar/personel-yetki.md](docs/planlar/personel-yetki.md)): Kasadaki fiyatlar (ModPOS'ta değişecek satış fiyatları, tek tek işaret, 30 dakika geri alma), Özel günler (maç, AVM etkinliği, kampanya; yarından 60 güne), personelin Yardım'ı; bar ekranında biten ürünü sitede, uygulamada ve QR menüde onaysız "Tükendi" yapmak ve "Satışa aç" (M ve L birlikte, yöneticinin kapattığını açamaz; [docs/SITE-MENU.md](docs/SITE-MENU.md) › Personel: Tükendi / Satışa aç); önemli düzeltmeler isteğe döner ve Onaylar'a düşer ([docs/ONAYLAR.md](docs/ONAYLAR.md)) | `/panel/kasa/fiyatlar`, `/panel/ozel-gunler`, `/panel/yardim/personel`, `/panel/karaoke#tukenenler` | — (yeni) |
| Kasa raporu: her akşam Z raporu ve kasa, eksik / fazla, e-posta ve WhatsApp, günün online satışı (bilgi, kasadan geçmez); ModPOS ve banka POS (yazarkasa, mali) Z raporu ayrı; banka POS Z'si oran oran KDV ile, kendi içinde ve ModPOS'la karşılaştırılır (toplam ve nakit farkı, kümülatif yalnız yöneticide; [docs/YAZARKASA-Z.md](docs/YAZARKASA-Z.md)); ModPOS Z'si, banka POS Z'si ve kasadan çıkan fişler fotoğraftan okunur (onaylayınca kaydedilir; banka POS Z'sinin rakamları canlı değerlendirmeye kadar yalnız öneri, [docs/FOTOGRAF.md](docs/FOTOGRAF.md)); açılış ↔ önceki devir denetimi, kasayı sayan, düzeltme geçmişi; yöneticiye günden güne; ayın açık günü, POS cirosu, indirimi, ödenmezi ve kartlı oranı (boş bırakılırsa) kasa raporlarından; **ödenmez / ikram ciroya girmez** (Z toplamının içindeyse düşülür, ciro ModPOS'un Patron › Ciro rakamıyla aynı kalır) ([docs/KASA-RAPORU.md](docs/KASA-RAPORU.md)) | `/panel/kasa` | — (yeni) |
| Satış tahmini (yönetici): önümüzdeki 7 gün beklenen satış (Z), kaç kişi, kaç tatlı; bayram, tatil, Ramazan, okul tatili, hava durumu (MET Norway, Tuzla) ve özel günler (derbi, AVM etkinliği, kampanya, kapalı gün); her sabahki tahmin gerçekleşenle karşılaştırılır; Bugün'de kart, personele yalnız yoğunluk ve tatlı sayısı, sabah e-postasında kutu ([docs/SATIS-TAHMINI.md](docs/SATIS-TAHMINI.md)) | `/panel/tahmin` | — (yeni) |
| Kontrol listeleri: fotoğraflı açılış ve kapanış listeleri (tamam / sorun var, fotoğraf, sıcaklık aralığı, kısa not; gün 05:00'te döner, sonradan doldurulmaz), Bugün'de satır, zilde ve sabah e-postasında; yöneticiye geçmiş (kim, ne zaman, eksik, aralık dışı, fotoğraf; fotoğraflar 60 gün) ve liste düzenleme ([docs/KONTROL-LISTELERI.md](docs/KONTROL-LISTELERI.md)) | `/panel/kontrol`, `/panel/kontrol/[id]`, `/panel/kontrol/gecmis`, `/panel/kontrol/duzenle`, `/api/kontrol/foto` (fotoğraflı madde) | — (yeni) |
| Zayi & ikram: atılan ve ödenmeden verilen ürün / malzeme; tutarlılık ve kasa raporuna bağlı ([docs/ZAYI-IKRAM.md](docs/ZAYI-IKRAM.md)) | `/panel/zayi` | — (yeni) |
| Satışlar (süren ayda yüklenen listenin son günü: "Liste hangi güne kadar?"; LafPOS'a geçiş gününden itibaren LafPOS'un ürün satışları ay toplamı olarak, salt okunur, eşleşmeyen adlar buradan bağlanır; geçiş ayında ModPOS listesi geçiş gününden önceki günler için, [docs/LAFPOS.md](docs/LAFPOS.md) › Günlük satış) | `/panel/satislar` | Satış Raporu |
| Faturalar (Paraşüt'ten her sabah gelir; karaoke box ve Alp Koç kafe dışı, toplama girmez) | `/panel/faturalar` | Faturalar |
| Tedarikçiler: bilgiler (unvan, vergi no, IBAN, iletişim, vade), kalan borç, ödendi / talep edildi işareti, ödeme talebi, düzenle / sil (faturalıysa listeden kaldır), Paraşüt'ten geçmiş faturalar, vergi noyla eşleşme (farklı adla gelen aynı firma tek tedarikçi) ([docs/TEDARIKCILER.md](docs/TEDARIKCILER.md)) | `/panel/tedarikciler`, `/panel/tedarikciler/[cari]` | — (yeni) |
| Komisyon & hakediş (yönetici): yemek kartı ve platformların ay ay gerçek oranı, faturadaki ücretler kalem kalem (%6 sınırı, komisyon dışı ücret, erken ödeme; platformda sipariş / ödeme altyapısı ücreti, reklam), satış Z'den (ayda tek kanal) ya da kanalın ekstresinden (elle), hakediş beklenen / son gün / geldi işareti (banka bağlı değil); zil, Bugün ve sabah e-postası ([docs/KOMISYON.md](docs/KOMISYON.md)) | `/panel/komisyonlar` | — (yeni) |
| Gelir-gider (laffogato.net online satışları: ayrı, KDV hariç gelir satırları ve toplam ciro; her gün bu ay ve önceki iki ay çekilir (geç iadeler), Siteden yenile; kasada ödenen uygulama siparişi ve iadesi bekleyen karaoke bilgi olarak, [docs/SITE-SATIS.md](docs/SITE-SATIS.md)) | `/panel/gelir-gider` | Genel Maliyet |
| Vergi: tahmini vergi takvimi, vergiye göre gelir-gider, muhtasar, SGK, damga ve kafenin geçici ve kurumlar vergisine katkısı; dört sekme (Özet, Vergiye göre, Demirbaş, Kurallar), yalnız yönetici, tahmin, beyanname değil ([docs/VERGI.md](docs/VERGI.md)) | `/panel/vergi`, `/panel/vergi/gelir-gider`, `/panel/vergi/demirbas`, `/panel/vergi/kurallar` | — (yeni; Excel'de "Vergi" sekmesi) |
| Giderler & personel (üç sekme: Sabit giderler, Aylık harcamalar, Personel); kasadan çıkan fişler Aylık harcamalar'a fotoğrafıyla yazılır | `/panel/giderler`, `/panel/harcamalar`, `/panel/personel` | Sabit Giderler, — (yeni), Personel |
| Ödemeler & hatırlatıcılar (Son ödenenler: 30 gün içinde geri alma; e-posta bildirimleri ve pazartesi haftalık özet) | `/panel/hatirlaticilar` | — (yeni) |
| Nakit planı: önümüzdeki 6 hafta gelen, ödenecek, kalan; en sıkışık gün · KDV tahmini (önceki ayın satış KDV'si − alış KDV'si, ayın 28'inde) ([docs/NAKIT-PLANI.md](docs/NAKIT-PLANI.md)) | `/panel/hatirlaticilar/nakit` | — (yeni) |
| Stok sayımı, tutarlılık (iki sekme; beklenen kullanım ModPOS + online kafe siparişleri). Sayım Ayarlar › Stok değerleme'deki başlangıç ayından (Ekim 2026) itibaren ilk giren ilk çıkar (FIFO) ile değerlenir: sayılan miktar en yeni Paraşüt faturalarından geriye, her parça kendi faturasının fiyatıyla, faturası bulunamayan kısım ay sonu fiyatıyla; önceki aylar ay sonunda geçerli hammadde fiyatıyla (fiyat geçmişinden), sonraki zam kapanmış ayın devreden malını ve kârını değiştirmez. Reçete maliyeti son alış fiyatıyla kalır ([docs/STOK-DEGERLEME.md](docs/STOK-DEGERLEME.md)). "Listeye ekle": yönetici ve personel sayım listesine kalem ekler (paket fiyatı isteğe bağlı: yazılırsa o fiyatla, yazılmazsa 0 ile Tahmini açılır, yönetici Hammaddeler'den doğrular; fiyatsızlar zilde "Fiyatı girilmemiş N hammadde") | `/panel/sayim`, `/panel/tutarlilik` | Sayım, Tutarlılık Kontrolü |
| Analiz & senaryo | `/panel/analiz` | — (yeni) |
| Ayarlar, işlem geçmişi, günlük işlerin son çalışması, laffogato.net bağlantılarının durumu (karaoke, menü, siparişler, online satışlar), fotoğraftan okuma (aç / kapat, günlük sınır, aylık tutar), yedek: paneldeki bütün verinin tek dosyası (parolayla iner; geri yükleme bilgisayardan, [docs/YEDEK.md](docs/YEDEK.md)) ve Excel kopyası | `/panel/ayarlar` | Ayarlar |
| Kullanıcılar & roller | `/panel/kullanicilar` | — (yeni) |
| Paraşüt entegrasyonu (eşitleme, ürün → hammadde bağlantıları ve kontrol edilecekleri, faturadan çarpan okuma, kategori kuralları) | `/panel/parasut` | — (yeni) |
| Hesabım (profil menüsü; yöneticide Bağlı uygulamalar) | `/panel/hesap` | — (yeni) |
| Claude bağlantısı: Claude uygulamalarından panele soru (salt okunur, yalnız yönetici; onay ekranı, Hesabım › Bağlı uygulamalar) ([docs/CLAUDE-BAGLANTISI.md](docs/CLAUDE-BAGLANTISI.md)) | `/api/mcp`, `/baglan`, `/oauth/*`, `/.well-known/*` | — (yeni) |
| Yardım | `/panel/yardim` | Nasıl Kullanılır |
| Giriş, davetle parola belirleme, QR menü (`/` panele yönlendirir) | `/giris`, `/davet`, `/menu` | — (yeni) |
| Excel'e aktar / tam yedek / sağlık / menü JSON / fatura belgesi ve kalemleri / fotoğraflar / fatura okuma | `/api/export`, `/api/yedek` (parola onayından sonra verilen iki dakikalık bağlantıyla, yalnız yönetici), `/api/health` (`?isler=1`: günlük işlerin durumu, sorun varsa 503; yanıtlar 5–10 dakika önbellekte, docs/BILDIRIMLER.md), `/api/menu`, `/api/faturalar/[id]/belge`, `/api/faturalar/[id]/kalemler`, `/api/hammaddeler/[id]/fiyatlar` (tedarikçilere göre fiyat), `/api/foto` (fotoğraf yükleme), `/api/foto/[id]` (fotoğrafın kendisi; her açılışta yetki denetlenir), `/api/foto/[id]/oku` (fotoğraftan okuma, [docs/FOTOGRAF.md](docs/FOTOGRAF.md)), `/api/fiyat-onerileri/[id]/oku` (onay bekleyen fiyatın faturasını Claude Haiku ile okuma, yalnız yönetici; [docs/FATURA-OKUMA.md](docs/FATURA-OKUMA.md)) | — |
| Günlük işler (Vercel Cron): Paraşüt eşitlemesi, sabah e-postası, hatırlatıcı özeti, karaoke (3 × 366 günden eski oturum kayıtlarındaki misafir adı ve notu silinir; işlem geçmişi hariç) ve site menüsü eşitlemesi, online satışlar, ayın son günü ay sonu sayım bildirimi (sayım tamamlanmadıysa), satış tahmini (hava durumu ve günün tahmin kaydı), pazartesi yöneticilere haftalık özet (docs/HAFTALIK-OZET.md), süresi dolan personel isteklerinin kapanması (docs/ONAYLAR.md); her çalışma `job_runs`'a yazılır, çalışmayan ya da hata veren iş zil, Genel bakış, Bugün ve e-postayla bildirilir (docs/BILDIRIMLER.md › Sistem uyarıları) | `/api/cron/parasut`, `/api/cron/gunluk` | — |
| Kontrol listesi hatırlatmaları: saat başını 7 geçe (08:07 – 02:07) personele "zamanı geldi" ve "gecikti" e-postası (Tuvalet çizelgesinin her saati, açılış ve kapanış); tetikleyici GitHub Actions, depo sırrı `CRON_SECRET` (docs/KONTROL-LISTELERI.md § 6) | `/api/cron/kontrol` | — |
| Açık sekmenin canlı verisi (ETag / 304; siparişler ve masa çağrıları dahil), laffogato.net'in karaoke, menü ve sipariş pingleri, Siparişler ekranının yeniden çekme isteği | `/api/canli`, `/api/karaoke/ping`, `/api/menu/ping`, `/api/orders/ping`, `/api/siparisler` | — |
| LafPOS bağlantısı (kafenin kasası): gün sonunda günün ürün satışı ve Z özeti imzalı gelir (aynı gün yeniden gelirse öncekinin yerine geçer); "LafPOS'a geçiş günü"nden itibaren Kasa raporunda "LafPOS'tan doldur" ve ürün satışları aylık modelde (her gün tek kaynak; boşken hiçbir hesaba girmez); LafPOS'a siteye bağlı ürünlerin reçete maliyeti (yalnız imzayla) ([docs/LAFPOS.md](docs/LAFPOS.md)) | `/api/pos/gun`, `/api/panel/pos/urunler` | — (yeni) |
| ModPOS kasa föyü (Gafdigi API; günde 2 istek): her sabah dünün föyü çekilir (ciro, ödeme yöntemleri ve banka kırılımı, açılış ve sayım, giderler, cari tahsilat, ara kasa, ModPOS'un uyarıları, ödenmez / ikram dökümü, kişi adları yalnız yöneticiye, ham XML), geçmiş ModPOS'un ilk ciro gününden ileriye tamamlanır; yönetici Kasa'da raporla yan yana görür, farklı yazılan Z zilde ve Bugün'de; isteğe bağlı olarak raporsuz günün ay rakamına yedek ([docs/MODPOS-API.md](docs/MODPOS-API.md)) | `/panel/ayarlar#modpos`, `/panel/kasa?gun=` | — (yeni) |

Kenar çubuğunda en sık açılan dört ekran tek tıkla üst düzeyde, gerisi konu başlıkları altında (yöneticide; [docs/TASARIM.md](docs/TASARIM.md) "Menü ağacı"):
Genel bakış · Bugün · Onaylar · Kasa raporu · Kafe (Karaoke, Kontrol listeleri, Satış tahmini, Hatırlatıcılarım) · Menü (Ürünler, Hammaddeler, Reçete defteri)
· Stok (Stok sayımı, Zayi & ikram, Tutarlılık) · Satış (Satışlar, Komisyon & hakediş, Analiz & senaryo) · Alış & gider (Faturalar,
Tedarikçiler, Giderler & personel) · Finans (Gelir-gider, Vergi, Ödemeler & hatırlatıcılar) · Ayarlar (Genel ayarlar, Kullanıcılar & roller, Paraşüt entegrasyonu)
· Yardım. Başlığa dokununca altı açılır; açık olan sayfanın başlığı kendiliğinden açık durur. Telefonda altta Genel bakış · Bugün · Kasa · Ödemeler · Menü çubuğu var (Satışlar ve
Faturalar Menü'de). ⌘K
(Ctrl+K) ile ekran, ürün, hammadde ve tedarikçi aranır; zil ödemeleri (gecikmiş, bugün, yakında), fatura bildirimlerini (Paraşüt
eşitlemesi, yeni ve kontrol bekleyen faturalar, bağlanmayı bekleyen ürünler, geciken hakedişler, komisyon uyarıları), onay bekleyen reçete önerilerini ve fiyat onaylarını, geciken ve eksik kontrol listelerini ve aralık dışı değerleri, kişisel
hatırlatıcıları ve uyarıları (kasada değişecek fiyatlar, zammın aylık kâr etkisiyle hammadde zammı, fiyatı girilmemiş hammaddeler, son satış ayının uyarıları) gösterir; profil menüsünde Hesabım ve çıkış
var.

Personel rolü yalnızca **Bugün** (günün işleri: kasa raporu, açılış / kapanış listeleri, zayi / ikram, ay sonu sayımı; yönetici bilgisi yüklenmez),
**Karaoke**, **Kasa raporu**, **Kontrol listeleri** (açılış ve kapanış; yalnız yöneticinin doldurduğu listeler hariç), **Zayi & ikram**, **Reçete defteri** (değişiklik ya da yeni ürün
önerir; yönetici onaylayınca uygulanır), **Stok sayımı** (yalnız bu ay ve geçen ay; listeye kalem de ekler), **Hatırlatıcılarım** ve **Hesabım**
ekranlarını görür; girişte Bugün açılır. Telefonda altta Bugün · Karaoke · Kasa · Zayi · Reçeteler çubuğu var (Kontrol listeleri, Stok sayımı
ve Hatırlatıcılarım üst çubuktaki menüde; açılış / kapanış listesi ve ay sonu sayımı gerektiği gün Bugün'de satır olarak çıkar). Personelin zili yalnız kendi hatırlatıcılarını, önerilerinin sonucunu, akşam bekleyen kasa raporunu ve bekleyen ya da geciken kontrol listesini gösterir.
Maliyet, maaş, kâr ve karaoke tutarları personele gösterilmez. Hangi rolün hangi ekranı açtığı tek yerde:
`src/lib/roles.ts` (proxy, giriş sonrası yönlendirme ve menü bunu kullanır).

## Yerelde çalıştırma

Gerekenler: Node.js 24.x (Vercel'deki sürüm, `package.json` › `engines`; 20.19+ ve 22 de çalışır ama npm
`EBADENGINE` uyarısı verir) ve PostgreSQL 14+.

```bash
npm install
```

`.env.example` dosyasını `.env.local` adıyla kopyalayıp değerleri doldurun (`DATABASE_URL`, `AUTH_SECRET`,
`ADMIN_EMAIL`, `ADMIN_PASSWORD`; laffogato.net bağlantısı (karaoke, menü, siparişler ve online satışlar) için isteğe
bağlı `KARAOKE_SYNC_SECRET`). Sonra:

```bash
createdb laffogato
```

```bash
npm run db:migrate && npm run db:seed
```

```bash
npm run dev
```

Uygulama http://localhost:3000 adresinde açılır. Panel girişi `/giris` sayfasında; ilk yönetici hesabı
`.env.local` dosyasındaki `ADMIN_EMAIL` ve `ADMIN_PASSWORD` ile oluşturulur.

## Komutlar

| Komut | Ne yapar |
|-------|----------|
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` | Migration'ları uygular, veritabanı boşsa Excel verisini yükler, ardından production build alır (Vercel önizlemesinde bu hazırlık atlanır: önizleme canlının veritabanını kullanır, [DEPLOY.md](docs/DEPLOY.md) § 3; bekçiyi içeren commit'lerde `main` dışındaki bir dalın Production derlemesi veritabanına dokunmadan durur; ondan önce açılmış eski dallar durmaz, onların dağıtımları yeniden derlenmez, § 7) |
| `npm test` | Bütün testleri çalıştırır (`tests/*.test.ts`): hesaplama motorunu Excel'in değerlerine karşı (129 ürün, 125 satış satırı, panel, gelir-gider, tutarlılık) ve ekran kurallarını. `YEDEK_TEST_DATABASE_URL=postgres://…/postgres` verilirse yedeğin gerçek bir veritabanında alınıp geri yüklenmesi de sınanır ([docs/YEDEK.md](docs/YEDEK.md) § 10); `MCP_TEST_DATABASE_URL=postgres://…/laffogato_…` verilirse Claude bağlantısının veritabanındaki akışı ([docs/CLAUDE-BAGLANTISI.md](docs/CLAUDE-BAGLANTISI.md) § 8); `KONTROL_TEST_DATABASE_URL=postgres://…/laffogato_…` verilirse kontrol listelerinin yanıt yazımı ([docs/KONTROL-LISTELERI.md](docs/KONTROL-LISTELERI.md) § 8); `BAGLANTI_TEST_DATABASE_URL=postgres://…/laffogato_…` verilirse eşzamanlı yazımlar (bilinen cihazın giriş kilidi, iki adımlı kodun ve kurtarma kodunun tek kullanımı, karaoke uzatması, kasadan çıkanın tek geri alınışı); `ONAY_TEST_DATABASE_URL=postgres://…/laffogato_…` verilirse ortak onay kuyruğu (kişi başına tek bekleyen istek, istemci anahtarı, sürüm, kendi isteğini onaylama, geri çekme ile onay yarışı, sınırlar, süre dolması; [docs/ONAYLAR.md](docs/ONAYLAR.md)); `KASA_OKC_TEST_DATABASE_URL=postgres://…/laffogato_…` (yoksa `KASA_GEC_TEST_DATABASE_URL`) verilirse banka POS Z'sinin sunucu sütunları, kümülatifin temizlenmesi, geç rapor onayı ve fotoğraf kaldırma ([docs/KASA-RAPORU.md](docs/KASA-RAPORU.md)) |
| `npm run lint` | ESLint |
| `npm run db:generate` | Şema değişince yeni migration üretir (`drizzle/`) |
| `npm run db:migrate` | Migration'ları uygular ve hepsinin uygulandığını doğrular (atlanan varsa hata; docs/DEPLOY.md § 7) |
| `npm run db:seed` | Veritabanı boşsa Excel verisini ve sayıma sonradan eklenen sekiz kalemi (`sayim_yeni_kalemler`; reçetelere bağlı değil) yükler; hazır kontrol listelerini (Açılış, Kapanış) bir kez ekler (dolu veritabanında da) |
| `npm run db:reset` | Excel verisini yeniden yükler. Bu bilgisayarda olmayan veritabanında sunucu adıyla onay ister (`-- --onay=<sunucu>` ya da terminalde sorar) ve silmeden önce bütün verinin yedeğini ev klasörüne yazar (`laffogato-yedek-once-<sunucu>-….json.gz`). Ürünler zayi oranlarını kategorilerinden alır. Önce ürünleri (laffogato.net menü bağlantıları, reçete önerileri, fiyat geçmişi ve kasaya işlenecek fiyatlarla), hammaddeleri (sayımda “Listeye ekle” ile eklenenler dahil: Excel'dekiler ve `sayim_yeni_kalemler` migration'ının sekiz kalemi geri gelir), satışları, faturaları (belge, kalem ve fatura okumalarıyla), sabit giderleri, personeli, gelir-gider düzeltmelerini, sayımları, ay bilgilerini, ayarları, POS eşleştirmelerini, işlem geçmişini, Paraşüt eşitleme geçmişini ve ürün bağlantılarını, fiyat onaylarını, aylık harcama kayıtlarını, bildirim günlüğünü, nakit planının bakiyesini, tahmin ayarlarını (devreden KDV dahil), kaldırılan hızlı sayım ve mal siparişinin eski kayıtlarını, kasaya işle işaretlerini, LafPOS'un günlük ürün satışlarını ve faturalara bağlı vergi demirbaş listesini (silmeden önce kaç varlık olduğunu yazar; sabit giderlerin vergi sınıflandırması da sabit giderlerle gider) siler; personelin bekleyen isteklerini geri çeker ("Veritabanı sıfırlandı"; kaldırılan mal siparişi taslağının onaylanmış eski satırı süresi dolmuş sayılır, istekler kaydıyla kalır). **Silmedikleri:** kullanıcılar, aylık harcama kategorileri, hatırlatıcılar, bildirim alıcıları ve e-posta ayarları, Paraşüt kategori kuralları, laffogato.net'ten çekilen online satış ayları ve açık sipariş listesinin kopyası (sitenin verisi), tedarikçi cari kartları (faturaların ödendi / talep edildi işaretleri faturalarla birlikte silinir); fotoğraflar, kasadan çıkanlar ve okuma kayıtları; zayi ve ikram kayıtları (Excel'de aynı kimlik ve adla geri gelen ürüne ya da hammaddeye bağlı kalır); Claude bağlantıları; kontrol listeleri ve kayıtları; karaoke oturumları, oda saatleri ve siteden alınan geçmişin durumu; komisyon hakediş işaretleri ve kanal ayarları; kaldırılan mal siparişinin eski ayarı; satış tahmini (özel günler, kayıtlı tahminler, hava durumu, ayarlar); haftalık özetin ayarı ve geçmişi; LafPOS'un gün sonu özetleri; Vergi'nin muhasebeci rakamları, düzeltmeleri ve ayarları (aylık harcama kategorilerinin vergi belgesi dahil). **Cari hareketleri** (Tedarikçiler'de elle girilen borç ve ödeme) varsa yedeği aldıktan sonra durur: silmek onları da silerdi, Kasa satırları kalır ve faturalar ödenmemiş geri gelir; yine de silmek için `-- --cari-sil` |
| `npm run db:backup` | Tam yedeği bilgisayara alır (`~/laffogato-yedek-….json.gz`; `--belgeler` panelden yüklenen belgelerle, `--cikti <dosya>` başka bir yere). Panelin Ayarlar › Yedek dosyasıyla aynı biçim ([docs/YEDEK.md](docs/YEDEK.md)) |
| `npm run db:restore -- <dosya>` | Yedeği boş bir veritabanına yükler; `--sil` ile dolu bir veritabanının yerine (önce onun yedeğini dosyanın yanına alır; Neon'da `--onay=<sunucu>`). Parolalar dosyada yok: aynı e-postalı kişi hedefteki parolasını korur, ötekiler davet bekler ([docs/YEDEK.md](docs/YEDEK.md)) |
| `npm run modpos:foy -- <gün>` | ModPOS'un kasa föyünü çekip özetini yazar (günün 2 hakkından birini kullanır, veritabanına yazmaz; anahtar ortamda `MODPOS_API_KEY`, ekrana yazılmaz); `--dosya yanit.xml` yalnız dosyayı okur (istek yok), `--kaydet` veritabanına da yazar ([docs/MODPOS-API.md](docs/MODPOS-API.md) § 8) |
| `npm run excel:extract -- "<excel yolu>"` | Excel'den `excel-data.json` ve `tests/golden.json` dosyalarını yeniden üretir (Python 3 + openpyxl gerekir) |

## Klasör yapısı

```
src/
  app/                 sayfalar (panel/*, giris, menu) ve API uçları (api/*)
  components/          arayüz bileşenleri: ui/* (paylaşılan), panel/* (kabuk), akmanos/* (AkmanOS kaynağı), grafikler;
                       panel/live/* uyarı motoru (canlı veri, sesler, cihaz tercihleri, bildirim aboneliği)
  lib/roles.ts         personelin açabildiği ekranlar (tek kaynak)
  lib/karaoke/         karaoke: imza, oturum evreleri, uyarı planı, sitenin yanıtı (saf, testli)
  lib/site-menu/       laffogato.net menü bağlantısı: yanıt şeması, yuva ↔ fiyat, çekme planı, öneriler (saf, testli)
  lib/site-orders/     laffogato.net siparişleri ve masa çağrıları: yanıt şeması, yeni sipariş, sıralama, kart metinleri, zil kuralı, aşama düğmeleri, Gördüm (saf)
  lib/site-sales/      laffogato.net online satışları: yanıt şeması, KDV hariç gelir, ürün eşlemesi, kasa satırı (saf)
  lib/prices/          menü fiyatları: toplu kural ve yuvarlama, önizleme, kasanın (ModPOS) durumu, fiyat geçmişi ve geri alma planı (saf, testli; docs/FIYATLAR.md)
  lib/backup/          tam yedek: dosya biçimi, yazılmayanlar, şema sürümü, yükleme sırası, giriş bilgileri (saf, testli)
  lib/cash-plan.ts     nakit planı: 6 haftanın gelen, ödenecek ve kalan parası, hatırlatıcı eşleşmesi (saf, testli; docs/NAKIT-PLANI.md)
  lib/cash-month.ts    kasa raporlarından ay bilgisi: açık gün, POS cirosu, indirim, ödenmez, kartlı oran, eksik günler (saf, testli)
  lib/kdv.ts           KDV tahmini: satışların ve alışların KDV'si, devreden zinciri (saf, testli)
  lib/photo-read/      fotoğraftan okunanın kontrolü: şemalar, istemler, Z / POS / fiş okumasının forma gidecek hâli (saf, testli)
  lib/photo-rules.ts   fotoğraf türleri, boyut ve ölçü sınırları, saklama süreleri, kim görür (saf, testli)
  lib/photo-compress.ts  fotoğrafı telefonda JPEG'e küçültme (en çok 2576 px / ~3,7 MP, 1,8 MB)
  lib/mcp/             Claude bağlantısı: OAuth kuralları, araç girdileri, araç cevapları (saf, testli; docs/CLAUDE-BAGLANTISI.md)
  lib/checklists.ts    kontrol listeleri: gün ve saat aralığı, durum, yanıt özeti, kim doldurur ve kim görür, zil ve e-posta kutusu (saf, testli; docs/KONTROL-LISTELERI.md)
  lib/checklist-seed.ts  hazır açılış ve kapanış listeleri
  lib/commission/      komisyon ve hakediş: kanallar, kalemin sınıfı, satış, gerçek oran, uyarılar, hakediş, zil ve e-posta kutusu (saf, testli; docs/KOMISYON.md)
  lib/forecast/        satış tahmini: Türkiye takvimi, model, MET Norway yanıtı, kişi ve tatlı önerisi, tutturma, metinler (saf, testli; docs/SATIS-TAHMINI.md)
  lib/weekly/          haftalık özet: hafta, sıralama, maddeler, metinler (saf, testli; docs/HAFTALIK-OZET.md)
  lib/calc/            hesaplama motoru: Excel formüllerinin saf TypeScript karşılığı
    engine.ts          hammadde → reçete → ürün → satış → gelir-gider → stok
    insights.ts        panel, uyarılar, tutarlılık, menü mühendisliği, senaryo
    expr.ts            reçete miktar formülleri (2*ShotCift …) ve Türkçe sayı çözümleme
  server/
    db/                Drizzle şeması, bağlantı ve Excel seed verisi
    auth/              oturum (JWT), parola (scrypt), yetki kontrolü
    actions/           sunucu eylemleri (her biri yetki kontrolü yapar)
    data/              veritabanından hesaplama modelini yükleyen katman
    parasut/           Paraşüt API istemcisi, eşitleme, e-fatura kalemleri (docs/PARASUT.md)
    notify/            sabah e-postası, haftalık özet ve Resend gönderimi (docs/BILDIRIMLER.md)
    weekly/            haftalık özet: kaynaklar ve gönderim (docs/HAFTALIK-OZET.md)
    jobs/              günlük işler: anahtar denetimi, çalışma kayıtları (job_runs), sistem uyarıları ve bekçi e-postası
    backup/            tam yedek: dışa aktarım, geri yükleme, indirme bağlantısı ve son yedek kaydı (docs/YEDEK.md)
    karaoke/           laffogato.net ile eşitleme ve karaoke panosu (docs/KARAOKE.md)
    site-menu/         laffogato.net menüsü: çekme, panel → site yazımı, bağlama (docs/SITE-MENU.md); site-link.ts ortak imzalı istek
    site-orders/       laffogato.net'in açık siparişleri: çekme, son listenin kopyası, bildirim (docs/SITE-SIPARIS.md)
    site-sales/        laffogato.net'in online satışları: ay ay çekme ve saklama, kasa satırı (docs/SITE-SATIS.md)
    prices/            satış fiyatı yazımı: geçmiş ve kasa durumu, tek fiyat (önce site), toplu değişiklik ve geri alması (docs/FIYATLAR.md)
    push/              Web Push: VAPID, içerik şifrelemesi (RFC 8291), aboneliklere gönderim
    storage/           fotoğraf deposu: özel Vercel Blob (yerelde .data/photos), erişim kuralları (docs/FOTOGRAF.md)
    ai/                Claude istemcisi: fotoğraftan okuma, günlük sınır, maliyet günlüğü (ai_calls)
    photo-read/        fotoğrafı okuyup forma hazırlama, kimin hangi güne fotoğraf ekleyebileceği
    mcp/               Claude bağlantısı: istemciler, kodlar, anahtarlar (yalnız özet), MCP sunucusu ve salt okunur araçlar
    checklists/        kontrol listelerinin veritabanı tarafı: günün listeleri, doldurma, geçmiş, yanıt yazımı
  proxy.ts             panel sayfaları için oturum kontrolü (Next 16'da middleware'in yeni adı)
scripts/               migrate (ve migration doğrulaması), seed, predeploy, tam yedek ve geri yükleme, Excel çıkarma betikleri
tests/                 Excel karşılaştırma testleri ve ekran kuralları
drizzle/               SQL migration'ları
```

## Hesaplamaların doğruluğu

`tests/golden.json`, Excel'in kendi hesapladığı değerlerden üretilir. `npm test` şunları karşılaştırır: 129 ürün
kartının maliyet, kâr, marj, önerilen fiyat ve durumu; 125 satış satırının maliyeti ve brüt kârı; Panel'deki Eylül
kâr/zararı, başabaş ve kategori ortalamaları; Temmuz–Ekim gelir-gider tablosu; personel ve sabit gider toplamları;
tutarlılık kontrolündeki kullanım ve fark tutarları. Hepsi Excel ile aynıdır.

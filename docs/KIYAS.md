# Kıyas

Kart: **Kıyas** (Genel bakış'ın üstünde, Bugün'de yöneticinin sağ sütununda). "Dün ne kadar sattık, geçen haftaya,
geçen aya göre nasıl?" sorusunun cevabı: son kapanmış iş gününün cirosu ve önceki gün, geçen hafta aynı gün, geçen ay
aynı tarih ile kıyası; altında dönem kıyasları. Her kıyas: tutar, ₺ fark ve yüzde hapı ("↑ +%12,4" / "↓ %8,1" /
"→ %0,0"); fiş (adisyon) sayısı ve ortalama fiş, veri varsa.

Dosyalar: `src/lib/kiyas.ts` (saf hesap), `src/server/data/kiyas.ts` (yükleyici), `src/app/panel/kiyas-card.tsx`
(kart). Test: `tests/kiyas.test.ts` (hesap ve kartın sunucuda çizilen metni).

## Kural

- **Ciro** ay rakamınınki (`src/lib/cash-revenue.ts` `dayRevenue`): KDV dahil, ödenmez / ikram hariç; TL, kuruşa
  yuvarlanır. Bir günün rakamı Genel bakış'ın günlük ciro kartındakiyle aynıdır (test denetler).
- **"Veri yok" asla sıfır değildir.** Gün sonu gelmeyen gün kıyasa girmez, toplamda 0 ₺ sayılmaz, kartta "0 ₺" yazılmaz.
- **"Satış yok" da sıfır gibi yazılmaz.** Kart satışsız tarafın yerine "satış yok" yazar ve bunu doğru güne bağlar.
- **Benzerle benzer.** Yüzde ve ₺ fark şube şube, gün gün eşlenerek hesaplanır: bir şubenin bir günü ancak eşi olan
  gün de biliniyorsa (satış ya da satış yok) kıyasa girer. Satırda yazan tutar ise günün ya da dönemin bilinen bütün
  cirosudur; ikisi ayrıldığında (bir şube ya da gün kıyas dışı kaldıysa) kart yüzdenin dayandığı tutarları ayrıca
  yazar: "Kıyaslanan (iki günü de bilinenler): 6.000 ₺ ↔ 3.000 ₺ · +3.000 ₺".

## Kaynak

Ay bilgisinin okuduğu kasa satırları (`src/server/data/cash-reports.ts` `tillRows`), şube başına günde bir satır:
**kasa raporu > LafPOS gün sonu > ModPOS föyü** (föy yalnız Ayarlar › ModPOS › Ay rakamına yedek açıkken). Fiş sayısı
kasa raporundan (rapor satırı), LafPOS gün sonundan ya da föyden. Satış varken fiş sayısı 0 ise "bilinmiyor" sayılır
(girilmemiştir): "Fiş 40 → 0" ve şişkin ortalama yazılmaz. Genel bakış zaten okuduğu satırları verir (yeniden
okunmaz); Bugün'de yükleyici kendisi okur (`tillRows`'un tarih aralığı yok, geçmişin tamamı gelir) ve son 70 güne
bakar. Kapalı günler Özel günler'in `kapali` satırlarından
(şubenin kendi ve işletme geneli işareti; `closedDaysBetween`).

## Durumlar

Şube-gün: Z'si sıfırdan büyükse **satış**; satırı var ama Z'si sıfırsa ya da satırı yok ama kapalı işaretliyse
**satış yok**; ikisi de değilse **veri yok**; şubenin açılış gününden (`opened_on`) önceyse **açılmamış** (beklenmez,
veri yok sayılmaz).

Bir taraf (gösterilen ya da kıyaslanan gün / dönem):

| Taraf | Kural |
|---|---|
| Satış var | En az bir şube-günde satış |
| Satış yok | Beklenen **bütün** şube-günler biliniyor ve hiçbirinde satış yok |
| Bilinmiyor | Satış yok, ama verisi gelmeyen beklenen şube-gün var ("Tümü"de Tuzla kapalıyken Marina'nın gün sonu gelmediyse o gün satışsız denemez) |

Satırın durumu:

| Durum | Ne zaman | Kartta |
|---|---|---|
| `ok` | İki taraf da satışlı, kıyaslananların iki tarafında da satış var | Tutar, hap, ₺ fark |
| `satis-yok` | Gösterilen gün / dönem satışsız | Gün satırında sağda kıyaslanan günün cirosu ve notta "21 Kasım'da satış yok"; dönemde "satış yok" ve altta kıyaslanan dönemin tutarı |
| `onceki-satis-yok` | Kıyaslanan gün / dönem satışsız | Gün satırında "o gün satış yok" (satır o günündür, tarihi alt yazıda); dönemde tutar ve "geçen hafta satış yok" |
| `veri-yok` | Kıyaslanacak bilinen şube-gün yok, bir taraf bilinmiyor ya da kıyaslananların bir tarafı satışsız kalıyor | "veri yok" (dönemde tutar biliniyorsa "kıyas için veri yok") |
| `acilmamis` | Kıyaslanan tarafta şube henüz açılmamıştı (ve verisi olmayan yok) | "o gün açılmamıştı" / "geçen hafta açılmamıştı" |
| `tarih-yok` | Geçen ayda o tarih yok (31 → 30) | "bu tarih yok", alt yazıda "Kasım'da 30 gün var" |

Gösterilen günün kutusu: satışta tutar, fiş ve ortalama ("3.150 fiş · ortalama 128 ₺"); bir şubenin gün sonu yoksa
"Marina: gün sonu yok, toplama girmedi". Satış yok yalnız beklenen bütün şubeler biliniyorsa; bir şubenin verisi
yokken öteki kapalıysa "Veri yok · Marina: gün sonu yok · Tuzla: satış yok".

## Şube eşleme

Kart seçili şubeye uyar (`currentBranchScope`): tek şube seçiliyse o şube, "Tümü"de etkin fiziksel şubelerin toplamı.
Online kanal seçiliyken kasa satırı olmadığından kart çizilmez. "Tümü"de her şube kendi eşiyle eşlenir: önceki gün
Marina'nın verisi yoksa kıyas yalnız Tuzla'yla yapılır, not "Marina: 20 Kasım veri yok, kıyas dışı" der; dönemde
"Marina: veri yok (bu hafta 1 gün, geçen hafta 2 gün), kıyas dışı". Açık gün (en az bir şubede satış olan gün)
"Tümü"de bir kez sayılır.

Kıyaslanan tarafta henüz açılmamış şube veri yok sayılmaz: kıyas yine öteki şubelerle yapılır ve not "Marina 14
Kasım'da henüz açılmamıştı, kıyas dışı" (dönemde "Marina geçen hafta 4 gün henüz açılmamıştı, kıyas dışı") der.
Gösterilen günde açılmamış şube kıyasın konusu değildir (notta yok).

## Geçiş günü

Marina'nın kasası LafPOS'a geçiş gününden (Ayarlar › LafPOS › LafPOS'a geçiş günü; canlıda 22 Kasım 2026) itibaren
LafPOS'tur ([LAFPOS.md › Geçiş günü](LAFPOS.md#geçiş-günü)). Geçiş gününden önceki LafPOS gün sonları deneme günüdür,
hiç sayılmaz (`tillRows` zaten süzer; kart da ayrıca süzer); o günler Marina'nın ModPOS föyüyle sayılır. Geçiş günü
boşken LafPOS günleri hiç sayılmaz. Geçiş günü yalnız Marina'nın kasasınındır: Tuzla'nın raporları her gün sayılır.

## Gösterilen gün

İş günü 05:00'te döner (`businessDate`): gece 00:00–05:00 arası hâlâ önceki takvim günüdür. Kapsamdaki bütün açık
şubeler bugünün gün sonunu verdiyse (ya da kapalı işaretliyse, en az birinin satırı varken) gösterilen gün **bugün**,
yoksa **dün**. Akşam bir şube kapattı diye yarım günün toplamı gösterilmez (Bugün'ün şube kartıyla aynı kural).
Önceden işaretlenmiş kapalı gün tek başına gün sonu sayılmaz.

## Dönemler

| Satır | Gösterilen | Kıyaslanan |
|---|---|---|
| Hafta | Gösterilen günün haftasının pazartesisinden o güne | Bir önceki haftanın aynı günleri |
| Ay | Gösterilen günün ayının 1'inden o güne | Geçen ayın aynı tarihleri; geçen ayda olmayan gün (31 Aralık ↔ Kasım) eşsiz kalır: ayın tutarına girer, kıyasa girmez, notta "Kasım'da olmayan 1 gün kıyas dışı" |
| Son 7 gün | Gösterilen gün ve önceki 6 gün | Ondan önceki 7 gün |

Üçü de **ciro toplamıdır**: satırın tutarı dönemin bilinen cirosu, yüzde ve ₺ fark kıyaslananlarla. Altında
kıyaslanan dönemin tutarı ve tarihleri ("Geçen hafta: 199.000 ₺ (9 Kasım – 14 Kasım)"). Son 7 gün satırının altında
açık gün başına ortalama: "Açık gün başına: günde 30.714 ₺ (7 gün) ↔ 34.071 ₺ (7 gün)" (kapalı gün ortalamayı
düşürmez).

## Etiketler

Etiketler gösterilen güne göre kurulur (`src/lib/kiyas.ts`):

- Gün satırları: gösterilen gün bugünse "Dün", "Geçen hafta bugün", "Geçen ay bugün"; dünse "Önceki gün", "Geçen
  hafta aynı gün", "Geçen ay aynı gün". Kutunun başlığı "Bugün · 22 Kasım Pazar" ya da "Dün · …".
- Hafta: gösterilen günün haftası bugünün haftasıysa "Bu hafta" ↔ "Geçen hafta"; değilse (pazartesi, gösterilen gün
  pazar) "Geçen hafta" ↔ "Önceki hafta".
- Ay: gösterilen günün ayı bugünün ayıysa "Bu ay" ↔ "Geçen ay"; değilse (ayın 1'inde) ayın adı: "Kasım" ↔ "Ekim".
- Son 7 gün: "Son 7 gün" ↔ "Önceki 7 gün".

Hap ok, işaret ve yüzdeyle yazar (renk tek başına anlam taşımaz); ekran okuyucuya "Geçen hafta ile kıyasla artış
%12,4" der. %0,05'ten küçük değişim hapta "→ %0,0", ekran okuyucuda "değişim yok" (aynı eşik, `changeSpeech`). Fiş
sayıları Türkçe biçimde: "Fiş 2.800 → 3.150 (↑ +%12,5)".

## Kart nerede

- **Genel bakış** (`/panel`): şeritlerden (sistem, şube notu, ödemeler) sonra, "Bu ayın işleri"nin üstünde; geniş
  ekranda iki sütun (solda gün, sağda dönem). Okunamazsa kart çizilmez, sayfa açılır (`[kiyas]` sunucu günlüğüne).
- **Bugün** (`/panel/bugun`): yöneticinin sağ sütununda "Şubelerde dün / bugün"ün altında, tek sütun (`narrow`).
  Okunamazsa çizilmez ([BUGUN.md](BUGUN.md)).
- Kasa raporu hiç kullanılmadıysa (gösterilen gün ve bütün kıyaslar veri yok) kart çizilmez. "Kasa" düğmesi
  gösterilen günün Kasa'sına götürür.

## Yetki

**Yalnız yönetici.** Kart tutar taşır; personelin ciroyu gördüğü bir ekran yok. Yükleyici `requireAdmin()` ile
başlar; Bugün sayfası personelde yükleyiciyi hiç çağırmaz (`user.role === "admin" ? safe(loadKiyas()) : …`; test
kaynaktan denetler).

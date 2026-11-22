# Kişisel hatırlatıcılar

**Kafe → Hatırlatıcılarım** (`/panel/hatirlaticilarim`), iki role de açık. İşletmenin ödeme hatırlatıcılarından
(`reminders`, Ödemeler ekranı) ayrıdır: sabah e-postasına ve Ödemeler'e girmez.

Her hatırlatıcıyı **yalnız sahibi** görür, erteler, tamamlar ve siler.

## Tekrar

Bir kez · Her gün · Her hafta · Her ay. "Tamamlandı" işaretlenince tekrar eden bir sonraki döneme ilerler
(bugünü geçene kadar), tek seferlik kapanır. Haftalıkta çapanın haftanın günü, aylıkta ayın günü korunur
(31 Ocak → 28 Şubat → 31 Mart).

Ertelemek (**1 saat sonra hatırlat**, **ertesi gün**) yalnız o dönemi kaydırır; serinin günü ve saati
(`anchor_date`, `anchor_time`) değişmez. 09:00'daki günlük hatırlatma 09:02'de bir saat ertelenip 10:06'da
"Yaptım" denince ertesi gün yine 09:00'da çalar (`completeTarget`). Önceden erteleme saati serinin saati oluyordu ve
her ertelemeyle seri bir saat daha kayıyordu (denetim 21 Kasım #15). Saati formdan değiştirmek serinin saatini de
değiştirir; ertelenmiş dönemin formunu yalnız başlığı ya da notu için kaydetmek değiştirmez (`anchorTimeOnEdit`).
Ay sonundaki aylık hatırlatıcı ertesi aya ertelenip orada tamamlanırsa sıradaki dönem yine ertelemeden
öncekinden sayılır: 30 Kasım → 1 Aralık'a ertelendi → tamamlandı → sıradaki 30 Aralık, bir ay atlanmaz (denetim
13 Kasım SB-01).

## Bilgisayarda ses (4 Kasım 2026)

Saatli hatırlatıcı, panel açıkken o saatte uyarır. Ses hatırlatıcı başına seçilir:

| Seçenek | Ne olur |
|---|---|
| **Tek ses** (varsayılan) | Bir kez zil çalar — bugünkü davranış |
| **Sürekli** | Durdurulana kadar çalar (karaoke alarmı gibi, en çok 30 dk). "Yaptım", "1 saat sonra hatırlat" ya da "Sesi kes" durdurur; pencereyi kapatmak durdurmaz (köşedeki kartta da "Sesi kes" var). Başka cihazda tamamlanınca ya da cihazın **Sesli uyarı** anahtarı kapanınca burada da susar |
| **Sessiz** | Hiç çalmaz; bildirim yine çıkar |

Saat verilmemişse hiçbiri çalmaz (hatırlatıcı gün boyu listede durur). Cihazın kendi **Sesli uyarı** anahtarı
kapalıysa da çalmaz; hangi hoparlörden çalacağı Bu cihazda uyarılar › **Uyarı sesleri**'nden seçilir. "Yalnız bu
bilgisayardan çalsın" açıkken (Tuzla Köyiçi'nde varsayılan) hatırlatma sesi ve açılır pencerenin sistem bildirimi
kafenin genel hoparlöründen çalmaz (docs/BILDIRIMLER.md › Uyarı sesleri yalnız bu bilgisayardan).

Listede "Sürekli ses" ve "Sessiz" rozetle görünür.

## Başkasına kurma (4 Kasım 2026)

**Yönetici** yeni bir hatırlatıcıyı başka bir kullanıcıya kurabilir ("Kime": Kendime · İbrahim · Damla …).

- Kayıt **o kişinindir**: yalnız o görür, erteler, tamamlar ve siler. Kuran sonradan göremez ve değiştiremez.
- Hatırlatıcıda "… kurdu" rozeti çıkar.
- Atama yalnız **eklemede** olur; sahibi sonradan devredilmez.
- Personel yalnız kendine kurar.
- Kişi başına 200 açık hatırlatıcı sınırı hedefe göre sayılır.
- "Kime" yeni hatırlatıcı penceresinin başında (başlığın hemen altında). Başkasına saatsiz kuruluyorsa pencere saat
  vermeyi hatırlatır: saat yoksa ne açılır pencere ne ses olur.

## Açılır pencere ve köşe kartı (16 Kasım 2026)

Sahibin isteği: hatırlatma saatinde kasa bilgisayarında çalsın, kişinin önüne hemen çıksın ve "Yaptım" denene kadar
köşede rahatsız edici biçimde dursun. Kimin hatırlatmasıysa (yönetici "Kime" ile kurduysa o kişinin) panelinin açık
olduğu **her cihazda** olur; cihazın **Saatli hatırlatmalar bu cihazda** anahtarı kapalıysa o cihazda hiçbiri olmaz.

**Açılır pencere.** Saat gelince ekranın ortasında (telefonda alttan açılan sayfa) pencere: başlık, not, "… kurdu",
tekrar, saat ve ne kadar geçtiği. Düğmeler:

- **Yaptım**: tamamlar (tekrar eden sıradaki döneme ilerler, tek seferlik kapanır); bildirimde "Geri al".
- **1 saat sonra hatırlat**: listedeki "1 saat ertele" ile aynı kural (bir saat sonrası, 5 dakikaya yuvarlı); o saat
  gelince pencere ve ses yeniden. Bildirimde "Geri al".
- **Sesi kes** (yalnız sürekli ses çalarken): sesi keser, pencere açık kalır.
- **Kapat** (✕, Esc, dışarı dokunmak): pencereyi köşeye küçültür; sesi kesmez.

Aynı anda birden çok hatırlatma gelirse pencereler sırayla açılır ("Sırada 2 hatırlatma daha var"). Odak düğmede değil
içerikte başlar: kasada yazarken açılan pencerede Enter yanlışlıkla "Yaptım" demez.

Ne zaman açılır (`planReminderAlerts`):

| Durum | Ne olur |
|---|---|
| Panel açıkken saat geldi (ya da en çok 5 dk geç: sekme arka plandaydı, bilgisayar uykudan uyandı) | Pencere + hatırlatmanın sesi + sekme arkadaysa sistem bildirimi |
| Panel kapalıydı, bu cihazda hiç açılmamış, 12 saatten yeni | Panel açılınca sessiz pencere |
| Daha eski | Yalnız köşedeki kart |

Aynı dönem (tarih + saat) bir cihazda bir kez açılır; sayfa yenilenince yeniden açılmaz, köşede kalır.

**Köşe kartı.** Saati gelmiş, yapılmamış her saatli hatırlatma sağ altta (telefon ve tablette alt menünün hemen üstünde)
koyu bir kartta durur: en son geleni üstte, birden çoksa "3 hatırlatma bekliyor" başlığıyla alt alta; her satırda
**Yaptım**, başlığa dokununca pencere (erteleme orada). Kapatma düğmesi yok; zil karosunun halkası yayılır, kart ara ara
hafifçe sallanır (hareket azaltılmışsa ikisi de durur). Ekran okuyucuya özet duyurulur.

- Liste sunucunun verisinden türer (canlı uç, `pendingReminders`): başka ekrana geçince ve sayfa yenilenince yerinde,
  başka cihazda "Yaptım" denince ya da ertelenince en geç canlı verinin sonraki yenilenişinde kalkar.
- Kart açıkken telefondaki yüzen düğme (Yeni) ve kaydetme çubuğu kartın üstüne çıkar; ekran klavyesi açıkken kart gizlenir.

## Kod

| Ne | Nerede |
|---|---|
| Saf hesaplar (tekrar, erteleme, grup, ses seçenekleri, uyarı planı, köşe listesi) | `src/lib/user-reminders.ts` |
| Okuma ve atanabilecek kişiler | `src/server/data/user-reminders.ts` |
| Eylemler (atama kuralı dahil) | `src/server/actions/user-reminders.ts` |
| Ekran | `src/app/panel/hatirlaticilarim/` |
| Saatinde uyarı ve ses (zamanlayıcı) | `src/components/panel/live/alert-center.tsx`, `sounds.ts` (alarmın sahipleri) |
| Açılır pencere ve köşe kartı | `src/components/panel/live/reminder-alerts.tsx`, `src/app/globals.css` (`[data-reminder-dock]`) |
| Testler | `tests/hatirlaticilarim.test.ts` |

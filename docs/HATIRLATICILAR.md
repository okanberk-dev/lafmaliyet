# Kişisel hatırlatıcılar

**Kafe → Hatırlatıcılarım** (`/panel/hatirlaticilarim`), iki role de açık. İşletmenin ödeme hatırlatıcılarından
(`reminders`, Ödemeler ekranı) ayrıdır: sabah e-postasına ve Ödemeler'e girmez.

Her hatırlatıcıyı **yalnız sahibi** görür, erteler, tamamlar ve siler.

## Tekrar

Bir kez · Her gün · Her hafta · Her ay. "Tamamlandı" işaretlenince tekrar eden bir sonraki döneme ilerler
(bugünü geçene kadar), tek seferlik kapanır. Haftalıkta çapanın haftanın günü, aylıkta ayın günü korunur
(31 Ocak → 28 Şubat → 31 Mart).

"Ertele" (bir saat ya da ertesi gün) tekrarın gününü değiştirmez. Ay sonundaki aylık hatırlatıcı ertesi aya
ertelenip orada tamamlanırsa sıradaki dönem yine ertelemeden öncekinden sayılır: 30 Kasım → 1 Aralık'a ertelendi →
tamamlandı → sıradaki 30 Aralık (bir ay atlanmaz).

## Bilgisayarda ses (4 Kasım 2026)

Saatli hatırlatıcı, panel açıkken o saatte uyarır. Ses hatırlatıcı başına seçilir:

| Seçenek | Ne olur |
|---|---|
| **Tek ses** (varsayılan) | Bir kez zil çalar — bugünkü davranış |
| **Sürekli** | Durdurulana kadar çalar (karaoke alarmı gibi, en çok 30 dk). Uyarı kendiliğinden kapanmaz; "Sesi kes" ya da "Durdur ve tamamla" durdurur. Yalnız kendi sesini keser: aynı anda çalan karaoke "süre doldu" alarmı "Haber verdim"e kadar sürer, karaokenin "Haber verdim"i de hatırlatıcının sesini kesmez |
| **Sessiz** | Hiç çalmaz; bildirim yine çıkar |

Saat verilmemişse hiçbiri çalmaz (hatırlatıcı gün boyu listede durur). Cihazın kendi **Sesli uyarı** anahtarı
kapalıysa da çalmaz; hangi hoparlörden çalacağı Bu cihazda uyarılar kartından seçilir.

Listede "Sürekli ses" ve "Sessiz" rozetle görünür.

## Başkasına kurma (4 Kasım 2026)

**Yönetici** yeni bir hatırlatıcıyı başka bir kullanıcıya kurabilir ("Kime": Kendime · İbrahim · Damla …).

- Kayıt **o kişinindir**: yalnız o görür, erteler, tamamlar ve siler. Kuran sonradan göremez ve değiştiremez.
- Hatırlatıcıda "… kurdu" rozeti çıkar.
- Atama yalnız **eklemede** olur; sahibi sonradan devredilmez.
- Personel yalnız kendine kurar.
- Kişi başına 200 açık hatırlatıcı sınırı hedefe göre sayılır.

## Kod

| Ne | Nerede |
|---|---|
| Saf hesaplar (tekrar, erteleme, grup, ses seçenekleri) | `src/lib/user-reminders.ts` |
| Okuma ve atanabilecek kişiler | `src/server/data/user-reminders.ts` |
| Eylemler (atama kuralı dahil) | `src/server/actions/user-reminders.ts` |
| Ekran | `src/app/panel/hatirlaticilarim/` |
| Saatinde uyarı ve ses | `src/components/panel/live/alert-center.tsx`, `sounds.ts` |

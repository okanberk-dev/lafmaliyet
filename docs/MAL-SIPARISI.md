# Mal siparişi ve hızlı sayım (kaldırıldı)

**26 Ekim 2026'da panelden kaldırıldı** (denetimin B21 partisi). Sahibin isteği: "Hızlı sayım ile mal siparişi
kısmını kaldır, gereksiz çünkü normal sayım olsun". Stok, ayda bir yapılan **Stok sayımı**yla tutulur
(`/panel/sayim`; değerleme `docs/STOK-DEGERLEME.md`).

## Ne kalktı

- Ekranlar: Hızlı sayım (`/panel/hizli-sayim`), personelin sipariş taslağı (`/panel/hizli-sayim/siparis`), Mal
  siparişi (`/panel/mal-siparisi`), Gönderilenler ve Kalemler. Kenar çubuğunda, komut paletinde, sekmelerde ve iki
  rolün Yardım'ında artık yoklar.
- Eylemler ve işler: hızlı sayım kaydı, gelen mal ("Geldi"), sipariş önerisi ve WhatsApp ile gönderme, teslim
  kontrolü (Paraşüt eşitlemesindeki fatura karşılaştırması), personelin taslağı ve yöneticinin onayı.
- Bugün satırları (`hizli-sayim`, `mal-siparisi`, `mal-taslak`), zil satırları (taslak onayı, teslim farkı, gelmeyen
  sipariş), sabah bildirimi "Bugün hızlı sayım günü" ve onay push'u. Onaylar'daki "Mal siparişi" kartları.
- Cihaz ayarlarındaki "Onay bildirimleri" anahtarı (tek gönderen taslaktı; tesisat kaldı). 25 Kasım 2026'da yeniden
  bir gönderen geldi: personelin yeni onay isteği yöneticinin telefonuna ([ONAYLAR.md](ONAYLAR.md) › Bildirimler);
  anahtar yönetici cihazında döndü.

## Ne kaldı

- **Eski adresler** 404 vermez: `/panel/hizli-sayim/**` ve `/panel/mal-siparisi/**` geçici (307) olarak Stok
  sayımı'na gider (`src/lib/roles.ts` `retiredRedirect`, `src/proxy.ts`; sorgu ve çapa düşer).
- **Ay sonu sayım bildirimi:** ayın son günü, sayım tamamlanmadıysa sabah bildirimi gider
  (`src/server/notify/count-push.ts`; Günlük işler'deki adımın adı "Sayım bildirimi").
- **Veritabanı:** `reorder_items`, `quick_counts`, `supplier_orders` tabloları ve `integration_state`'teki
  `reorder.settings` silinmedi (migration yok; Instant Rollback eski sürümü açabilsin, veri geçmiş için dursun).
  Drizzle şemasında tanımları "kaldırıldı" notuyla duruyor; hiçbir ekran ya da iş onları okumaz, yazmaz. `db:reset`
  ürün ve hammaddeyle birlikte onları da boşaltır.
- **Personel istekleri:** `staff_requests` türü `mal-taslak` eski satırlar için enumda kalır
  (`src/lib/staff-requests.ts` `RETIRED_REQUEST_KINDS`). Yeni istek açılamaz; Onaylar, Bugün, zil, sabah e-postası ve
  Son kararlar bu türü okumaz; sabah işi bekleyen ya da onaylanmış (gönderilmemiş) eski taslakları "Süresi doldu"
  yapar.

Özelliğin eski anlatımı (hedef stok formülü, sayım günleri, teslim kontrolü, personelin taslağı) git geçmişinde:
bu dosyanın 26 Ekim 2026'dan önceki sürümü ve plan `docs/planlar/siparis.md`.

# Dalga 10: Personele açılan yetkiler (onaylı ve onaysız)

Grup: `personel-yetki`. Tarih: 24 Ekim 2026. Durum: plan, henüz uygulanmadı.

Sahibin isteği (olduğu gibi): *"Personele de verilmesini önerdiğin yerleri ver ama yöneticiden onay illa geçsin; bence bazıları geçmesine gerek yok, onların kararını da sen ver."*

**Taban:** Dalga 9 PR'ı (tahmin ∥ haftalık, `0036_satis_tahmini`) ve dalga 8 düzeltme PR'ı (`claude/dalga8-duzeltmeleri`) birleştikten sonraki `main`. Gerekçesi §4.4'te.

**Önce okunacaklar:**
- `AGENTS.md`. Bu Next.js 16.4 (cacheComponents) eğitim verisindekinden farklıdır.
- `node_modules/next/dist/docs/01-app/` altında:
  - `03-api-reference/04-functions/refresh.md`: `refresh()` yalnız Server Action içinde çağrılır.
  - `03-api-reference/04-functions/after.md`: push ve e-posta yanıttan sonra gider.
  - `02-guides/server-actions.md`
  - `02-guides/migrating-to-cache-components.md` §"Fix synchronous IO": saat, yalnız `requireUser()` / `requireAdmin()` çağrısından sonra, Suspense çocuğunda okunur.
  - `02-guides/authentication-with-cache-components.md`
  - `02-guides/preserving-ui-state.md`: dialoglar sayfadan çıkmadan önce kapanır.

**Kurallar:** `CRITIQUE.md` R1–R7 ve `KALAN-ISLER.md` §3 geçerlidir. Bu dalga:
- **tek migration** getirir: `0037_personel_yetki`. Bütün şema değişiklikleri buradadır, elle yazılmış SQL yoktur.
- yeni bağımlılık ve yeni cron getirmez. Günlük işe yalnız bir adım eklenir.
- yeni bir Claude bağlantısı aracı eklemez.

---

## 0. İlkeler

1. **KVKK / sahibin kuralı (pazarlıksız).** Personel şunları hiçbir yerde görmez:
   - hammadde maliyeti, alış fiyatı, fatura tutarı, maaş, kâr, marj, komisyon tutarı, karaoke parası.
   - Bu yasak ekran, sayfa verisi (RSC yükü), eylem yanıtı, zil, push ve e-posta için ayrı ayrı geçerlidir.
   - Menünün satış fiyatı herkese açıktır ve gösterilebilir.
   - Bu dalgada eklenen her personel yükleyicisi **sabit bir sütun beyaz listesiyle** yazılır ve kaynak testiyle sabitlenir (§6.2).
2. **Ne zaman onay istenir:** sonuç geçmiş bir kasa, stok farkı ya da gider kaydını değiştiriyorsa, bir kanıtı siliyorsa, para harcama sözü veriyorsa ya da bir uyarıyı susturuyorsa.
3. **Ne zaman onay istenmez:** işlem anında yapılmalıysa, para taşımıyorsa, geri alınabiliyorsa ve kimin yaptığı görünüyorsa. Salt okunur ekranlar da onaysızdır. Onaysız her yetkinin üç koruması vardır:
   - **görünürlük:** İşlem geçmişine kişinin hesabıyla düşer, yöneticiye bir satır gider;
   - **sınır:** sayı ve zaman penceresi;
   - **geri alma:** yönetici her zaman geri alabilir.
4. **Onaylı işlerin ortak kuralları:**
   - Kayıt onaya kadar hiç değişmez. İstek ayrı bir tabloda bekler (§3).
   - Onay, yöneticinin kendi yazım yolundan aynı denetimlerle geçer.
   - Yönetici yalnız ekranda gördüğü sürümü onaylayabilir (`version` denetimi).
   - Kimse kendi isteğini onaylayamaz.
   - Onayla / Reddet parola sormaz. `adminstepup` yalnız hesap işlemlerini kapsar.
5. **Bu dalgada daralan üç kural.** Sahibin "önemli olan onaydan geçsin" kuralı gereği bugün personelin onaysız yaptığı üç şey onaya bağlanır:
   - **(a)** İş günü kapandıktan sonra dünün raporunda kasa alanı (açılış, nakit satış, gün içinde çıkan, sayılan, teslim) ya da Sayan değişikliği (§2.3).
   - **(b)** Açık günde, yöneticinin kategorisine bağlı kasadan çıkan satırında tutar ya da metin düzeltme ve silme (§2.7).
   - **(c)** Bugünün kasa raporu girildikten sonra düne zayi / ikram girme ve silme (§2.8).

   Üçü de "Sahibe notlar"da (§4.6) ayrıca söylenir.

---

## 1. Karar tablosu

| # | Yetki | Personele açık mı | Onay gerekir mi | Neden (tek satır) |
|---|---|---|---|---|
| 1 | Biten ürünü sitede, uygulamada ve QR menüde "Tükendi" yapmak, sonra "Satışa aç" (`urun-tukendi`) | Evet, bar ekranında | Hayır | Anında yapılmalı. Para ya da fiyat taşımaz, geri alınabilir, sınırlıdır ve yöneticiye görünür. |
| 2 | "Kasaya işle" listesini görmek ve ModPOS'ta değiştirilen fiyatı işaretlemek (`kasaya-isle`) | Evet, `/panel/kasa/fiyatlar` | Hayır | Fiyatı ModPOS'ta zaten personel değiştirir. Onay ModPOS'u denetleyemez, yalnız listeyi bekletir. Her işaret ad ile kayıtlıdır ve geri alınabilir. |
| 3a | Kasa raporunu aynı gece (iş günü kapanmadan) düzeltmek | Evet (bugünkü gibi) | Hayır | Değişmedi. |
| 3b | Dünün kilitsiz raporunda, ertesi gün kasa alanı ya da Sayan değişikliği | Evet | **Evet (yeni)** | Sayılan / teslim / çıkan sonradan değişirse açık kapanır. Bugün onaysız, artık onaylı. |
| 3c | Dünün kilitsiz raporunda, ertesi gün yalnız Z / kart / metin alanları | Evet | Hayır | Nakit zincirine dokunmaz. Sürüm ve İşlem geçmişi kalır, ertesi gün düzeltme uyarısı da sürer. |
| 3d | Kilitli güne (ertesi günün raporu girilmiş) her düzeltme | Evet | Evet | Ertesi günün açılışı bu raporun devrine dayanır. |
| 3e | Kasa raporunun silinmesini istemek | Evet | Evet | Silme raporu ve devir zincirini yok eder. |
| 4a | Hızlı sayımdan sonra fiyatsız mal siparişi taslağı hazırlamak | Evet | Evet | Harcama sözüdür. |
| 4b | Onaylanmış taslağı WhatsApp'tan göndermek | Evet | Hayır (onay verildi) | Satırlar, tedarikçi ve numara sunucuda sabittir; personel değiştiremez. |
| 5 | Kontrol listelerinin son 7 günlük geçmişi ve dünün sorunları (salt okunur) | Evet | Hayır | Salt okunurdur; geçmiş gün doldurulamaz. |
| 6 | Dünden eski, hiç girilmemiş bir günün kasa raporu (14 gün) | Evet | Evet | Günler sonra yazılan Z ve nakit uydurulabilir; ay bilgisini ve devir zincirini değiştirir. |
| 7a | Kilitli ya da eski güne (7 gün) kasadan çıkan eklemek, düzeltmek, silmek | Evet | Evet | Beklenen nakdi düşürür, açığı örtebilir. |
| 7b | Açık günde yöneticinin kategorisindeki satırı düzeltmek ya da silmek | Evet | **Evet (yeni)** | Maaş / avans satırı kârı ve bordroyu değiştirir. |
| 7c | Dünün kilitli kaydında, fotoğrafsız satıra fiş fotoğrafı eklemek | Evet | Hayır | Yalnız kanıt ekler; tutar, tür ve kategori değişmez. |
| 7d | Yanlış Z / POS fotoğrafının kaldırılmasını istemek | Evet (sınırlı) | Evet | Fotoğraf kanıttır. Okuma farkı varken hiç istenemez. |
| 8a | Zayi / ikram: bugün ve dün (bugünün kasa raporu girilene kadar), kendi kaydını silmek | Evet (bugünkü gibi) | Hayır | Değişmedi; yalnız dünün penceresi kasa kilidine bağlandı. |
| 8b | 14 güne kadar geç zayi / ikram kaydı | Evet | Evet | Geçmiş güne yazılan kayıt stok açığını "açıklanmış" gösterir. |
| 8c | Başkasının kaydını ya da kilitli günün kaydını silmek | Evet | Evet | İz siler. |
| 9a | İleri tarihli özel gün (derbi, AVM, kampanya, diğer; yarından 60 güne kadar) | Evet, `/panel/ozel-gunler` | Hayır | Yalnız tahmini ve tatlı sayısını etkiler; sınırlıdır, yönetici bilgi alır, kilitleyebilir. |
| 9b | Dün için "Kafe kapalıydı" demek | Evet | Evet | Eksik kasa raporu ve kontrol listesi uyarısını susturur; kayıtsız satışı gizlemenin en kolay yolu budur. |
| 10 | Personelin kendi ekranlarını anlatan Yardım | Evet, `/panel/yardim/personel` | Hayır | Salt okunurdur; yönetici içeriği personele hiç gönderilmez. |

Açılmayanlar ve gerekçeleri §5'te.

---

## 2. Açılan yetkiler

Her maddenin hangi grupta olduğu başlıkta yazar (A: Kasa, B: Operasyon; §4). "İtirazlar" listesi, inceleme turundaki her itirazın kabul edilip edilmediğini söyler. Ortak kuyruğun adları (`staff_requests`, `createOrUpdateRequest`, `lockForReview`, …) §3'te tanımlıdır.

### 2.1 Tükendi / Satışa aç (`urun-tukendi`): Grup B, onaysız, efor L

**Karar.** Biten ürünü anında "Tükendi" yapmak gerekir: onay beklenirse uygulamadan ödenmiş sipariş gelmeye devam eder ve iade gerekir. İşlem para taşımaz, fiyata, stoğa ve kasaya dokunmaz. Personel yalnız sitedeki "Satışta / Tükendi" durumunu (paneldeki `showOnMenu`) değiştirir. Fiyata ve "Menüde aktif"e dokunamaz. Yöneticinin kapattığını açamaz.

**Personel ekranı** (`/panel/karaoke`, bar ekranı)
- "Uygulama siparişleri" kartının hemen altında yeni bir kart: **"Tükenenler"** (`id="tukenenler"`).
  - Site bağlantısı (`KARAOKE_SYNC_SECRET`) yoksa kart çizilmez.
- Kart gövdesi:
  - **Boşken:** tek satır, "Biten ürün yok." ve aynı satırda "Tükendi işaretle" düğmesi (secondary, `size="sm"`, `pointer-coarse:h-11`). Karaoke tahtası aşağı itilmez.
  - **Doluyken:** yalnız personelin bu kartla kapattığı ve hâlâ geçerli kaydı olan kalemler listelenir. Her satır:
    - ad (truncate);
    - altında soluk satır: "M · L · Selin, 21:40" (dünden kalanda "dün 21:40");
    - sağda "Satışa aç" (secondary, `min-h-11`).
  - Başarılı bir dokunuştan sonra o satırın düğmesi 1,5 sn kapalı kalır; çift dokunuş açıp kapatmasın.
- **"Tükendi işaretle" penceresi** (mevcut Dialog; telefonda alttan açılır). **Yalnız kapatır.**
  - Açıklama: "Sitede boy boy durum yok: M ve L birlikte kapanır."
  - "Ürün ara" kutusu hem panel adında hem sitedeki adda arar; ad farklıysa satırda "sitede: Buzlu Caffè Latte" yazar.
  - Satırlar site kategorisine göre gruplanır. Rozetler:
    - "Satışta" (yeşil): "Tükendi" düğmesi var.
    - "Tükendi · Selin 21:40": düğme yok; açma kart gövdesinden yapılır.
    - "Kapalı · yönetici açar": düğme yok.
    - "Selin tükendi yaptı; sonra sitede değişti · yönetici açar": düğme yok.
  - Bağlantısı kopuk, sitede olmayan ya da hiç bağlanmamış ürün listede görünmez.
- Dokunuşlar onay sormaz ve `useActionTransition` ile gider; düğme dönerken kilitlenir.
- Bildirimler (toast):
  - Tükendi: `toast.success("Tiramisu tükendi", { description: "laffogato.net, uygulama ve QR menüde satışta değil", action: { label: "Geri al", … } })`.
  - Satışa aç: "Tiramisu satışta".
  - Zaten kapalı: "Tiramisu zaten tükendi (sitede kapatılmış; yönetici açar)".
  - Hata: sunucunun Türkçe metni olduğu gibi gösterilir (bkz. Korumalar).
- Bugün'den `/panel/karaoke#tukenenler` ile gelinirse kart, Suspense içeriği yerleştikten sonra `useEffect` ile görünür alana kaydırılır.
- **Bugün › "Bugün kafede" kartı** (iki rolde de): "Tükendi: Tiramisu, Cheesecake" satırı, bağlantısı `/panel/karaoke#tukenenler`.
  - Personel kaydı 16 saatten eskiyse satır uyarı rengine (`tone: "warn"`) geçer: "Tiramisu 2 gündür tükendi: geldiyse satışa açın".

**Yönetici ekranı**
- `/panel/onaylar`'a kart eklenmez; onay yoktur.
- **Zil** (yalnız yönetici, grup `uyari`):
  - başlık: "Tükendi: Tiramisu, Cheesecake" (en çok 3 ad, fazlası "…");
  - gövde: "Personel kapattı: Selin 21:40 · Ali 22:05. Sitede, uygulamada ve QR menüde satışta değil.";
  - bağlantı: `/panel/karaoke#tukenenler`;
  - id: `tukendi-${sıralı kalem kimlikleri}-${en yeni at}`;
  - tür: normalde `info`; bir kayıt 24 saatten eskiyse ya da son bir saatte personel 3 ya da daha fazla ürün kapattıysa `warning`.
  - Ürün satışa açılınca satır kendiliğinden kalkar. Push yok.
- **Sabah e-postası** (`opsDigestLines`): "Personelin tükendi yaptığı ürünler: Tiramisu (Selin, 2 gündür)". Yalnız ad ve süre yazar.
- **Bugün:** "Bugün kafede"de aynı satır.
- **Bar ekranı:** yönetici aynı kartı görür, sınır uygulanmaz.
  - "Satışa aç": personelin kapattığını açar.
  - "Kapalı tut": site yazımı yapmaz, personel kaydını düşürür; artık yalnız yönetici açar.
  - Pencerede "Kapalı · yönetici açar" satırında yöneticiye "Satışa aç" düğmesi görünür.
- **Ürün kartı** (`/panel/urunler/[id]`): kaydı olan ürünün "QR menüde göster" anahtarının altında "Personel tükendi yaptı · Selin 21:40" yazar.
- **İşlem geçmişi:**
  - `logActivity(me, "Tükendi", "Tiramisu (M, L) · laffogato.net, uygulama ve QR menü")`
  - `"Satışa açıldı"`
  - `"Tükendi: kapalı tutuldu"` (yönetici)
  - Sitenin olay kaydına "Panel · Selin" düşer (actor = `me.name`).

**Veri ve eylemler**
- **Migration yok.** Kayıt `integration_state` tablosunda, anahtar `"menu_sold_out"`:
  ```
  { items: { [siteMenuId]: { byId, by, byRole: "staff" | "admin", at, siteUpdatedAt } },
    toggles: { [siteMenuId]: lastToggleAtISO } }
  ```
- **Saf mantık:** `src/lib/site-menu/sold-out.ts`
  - `markerValid(marker, item)`: kalem `isActive === false` ve `item.updatedAt === marker.siteUpdatedAt`.
  - `soldOutBoard(rows, items, markers)`: sonuç `"on" | "card" | "closed" | "drifted"`. M ve L tek kalemde birleşir. `linkStatus !== "ok"` olan, sitede olmayan, bağlı olmayan ve bütün satırları `active=false` olan kalem atılır.
  - `pickRow(rows, item)`: bağlı, `ok` ve `active=true` ilk satır; M önce gelir.
  - `reopenRefusal({ role, rows, marker, live })`
  - `STAFF_SOLD_OUT_MAX = 10` (bütün personel kayıtları birlikte sayılır; yöneticininkiler sayılmaz)
  - `STAFF_TOGGLE_LIMIT = { calls: 20, windowMs: 10 * 60_000, perItemMs: 3_000 }`
  - `SOLD_OUT_WARN_MS = 16h`, `SOLD_OUT_ALERT_MS = 24h`
  - Türkçe metinler.
- **Kayıt deposu:** `src/server/site-menu/sold-out-store.ts` (`server-only`; `"use server"` değil)
  - `readMarkers(db)`
  - `writeMarker(tx, …)`
  - `dropMarker(tx, id)`
  - `carrySoldOutMarker(tx, prevItemUpdatedAt, item)`
- **Okuyucu:** `src/server/data/menu-status.ts` (`server-only`), `loadSoldOut()`. Okuduğu alanlar:
  - `products` tablosundan yalnız `id, name, size, siteMenuId, siteMenuSlot, active, showOnMenu`;
  - `readSiteSnapshot()` kopyasından kalemi `{ id, name, categoryLabel, isActive, updatedAt }`'e indirir. `priceMinor` ve `priceMinorL` sunucuda atılır.
- **Eylem dosyası:** `src/server/actions/menu-status.ts` (`"use server"`). Yalnız iki export var.
  - **`setSoldOut({ siteMenuId, soldOut })`**
    1. `requireUser()`.
    2. Zod: `siteMenuId` için `SITE_MENU_ID` regex'i.
    3. `siteLinkSecret()` yoksa UserError.
    4. Personel için hız sınırı: son 10 dakikadaki `activity_log` satırları (`userId = me.id`, `action in ("Tükendi","Satışa açıldı")`) 20'den az olmalı; kalem başına 3 sn sınırı `toggles` haritasından okunur.
    5. Kapatma (`soldOut = true`):
       - `startedAt = Date.now()`;
       - `desired = { price: row.price, active: row.active, showOnMenu: false }`;
       - `push = pushSaleChange(me, row, desired, "ürün tükendi yapılmadı")`.
    6. Tek işlemde:
       - `applyPushed` çalışır;
       - `products` tablosunda yalnız `showOnMenu` ve `updatedAt` yazılır;
       - `integration_state` satırı FOR UPDATE ile kilitlenir;
       - kayıt **yalnız** şu koşulların hepsi tutarsa yazılır: `push.kind === "pushed" && push.visibility && push.item && Date.parse(push.item.updatedAt) >= startedAt - 5000`. Sitenin "değişmedi" yanıtı eski damgayla döner, o durumda kayıt yazılmaz ve eylem "… zaten tükendi (sitede kapatılmış; yönetici açar)" der;
       - personel sayısı tavanı (10) aynı kilit altında yeniden denetlenir.
    7. Açma (`soldOut = false`): önce `fetchSiteMenu(secret)` ile sitenin **canlı** listesi okunur. Gerekenler:
       - canlı kalem `isActive === false`;
       - kalemin bağlı bütün satırları `active = true` (bu yönetici için de geçerlidir);
       - personel için ayrıca: `marker` var ve `live.updatedAt === marker.siteUpdatedAt`.
       - Tutmazsa: "Bu ürünü yönetici kapattı; satışa yönetici açar."
       - Tutarsa `desired = { price: row.price, active: true, showOnMenu: true }`, aynı yoldan yazılır ve kayıt silinir.
    8. Eylem fiyatı ve `active` alanını **hiç yazmaz**.
    9. `logActivity`, sonra `refresh()`.
    10. Dönüş: `{ changed, message, name }`. Tutar dönmez.
  - **`holdSoldOut({ siteMenuId })`:** `requireAdmin()`. Kalem satıştaysa önce kapatır; ardından kaydı düşürür. Log: "Tükendi: kapalı tutuldu".
- **`applyPushed` değişikliği** (`src/server/site-menu/push.ts`): `lockMenu` altında, `replaceSnapshotItem`'dan **önce** kopyadaki eski `updatedAt` okunur ve `carrySoldOutMarker(tx, prevUpdatedAt, item)` çağrılır. Kural:
  - `outcome.visibility === false` (yalnız fiyat),
  - `item.isActive === false`,
  - kayıt var,
  - `marker.siteUpdatedAt === prevUpdatedAt`

  ise `marker.siteUpdatedAt = item.updatedAt` yapılır. Böylece panelin kendi fiyat yazımları (`updateProductPrice`, `saveRecipe`, toplu Fiyatlar) kaydı geçersiz kılmaz.
- **`saveRecipe` eski kart düzeltmesi:**
  - `src/app/panel/urunler/[id]/recipe-editor.tsx`, kart açıldığında yüklenen değerleri `seenActive` ve `seenShowOnMenu` olarak gönderir.
  - `products.ts` şemasına bu iki alan eklenir.
  - Sunucu, gönderilen değer gördüğüyle aynıysa veritabanındaki **güncel** değeri kullanır. Önceden açık kalmış bir kart böylece personelin kapattığı ürünü sessizce yeniden açmaz.
- **İstemci:** `src/app/panel/karaoke/sold-out-card.tsx` (`"use client"`). Prop'larda fiyat alanı yoktur.
- **Bugün ve zil:** `today-ops.ts` → `soldOut: { names, items: { name, by, at, staff }[] }`. Satırı ve zili B'nin `rows-ops.ts` ve `bell/ops.ts` dosyaları üretir (§4.3).
- **Belgeler:**
  - `docs/SITE-MENU.md`: yeni bölüm "Personel: Tükendi / Satışa aç";
  - `docs/SITE-SIPARIS.md`: tek satır.

**Korumalar**
- **KVKK:**
  - okuyucu `price`, `cost`, `unitCost`, `packagePrice`, `posStale*` ve `priceMinor` seçmez;
  - eylem yalnız ad ve mesaj döner;
  - zil yalnız yöneticiye gider;
  - sabah e-postasında yalnız ad ve süre vardır.
- **Kim açar:**
  - Kapatma kaydı geçerli olduğu sürece her personel açabilir: kapatan kişi olmak gerekmez, sabah vardiyası gecenin kapattığını açabilir.
  - Geçerlilik canlı site durumuna göre ölçülür.
  - Yöneticinin ürün kartından, sitenin panelinden ya da "Kapalı tut" ile kapattığı ürün personele kilitlidir.
- **Sınırlar:**
  - personel kayıtlarının toplamı en çok 10;
  - kişi başına 10 dakikada en çok 20 işlem;
  - aynı kalemde iki işlem arasında en az 3 sn;
  - emekli bir boy (`active=false`) hiç açılmaz.
- **Hata metinleri sunucuda kurulur:**
  - bağlantıyla ilgili `PushFailure` nedenlerinde (`http` 400/401/404/409, `off`) metnin sonuna "Yöneticiye haber verin." eklenir;
  - site yazdı ama panel işlemi düştüyse: "Sitede tükendi oldu ama panele yazılamadı; yöneticiye haber verin."
- **Eşzamanlılık:**
  - `applyPushed` `lockMenu` alır, kayıt satırı FOR UPDATE ile kilitlenir;
  - ikinci barista güncel durumu okur ve plan "none" çıkar ("zaten").

**İtirazlar**
- *Bayat kopya ile sahibin kapattığını açma:* **kabul.** Damga karşılaştırmasıyla "değişmedi" yanıtına kayıt yazılmaz.
- *Açarken bayat kopya:* **kabul.** Açma sitenin canlı listesine bakar.
- *`siteUpdatedAt = null` fallback'i:* **kabul.** Bu fallback kaldırıldı; okunamayan yanıta kayıt yazılmaz.
- *Fiyat yazımının kaydı düşürmesi:* **kabul.** `carrySoldOutMarker` eklendi. Sitede başka bir alan değişirse satır "sonra sitede değişti · yönetici açar" der.
- *`saveRecipe` eski kart:* **kabul.** `seen*` alanları eklendi.
- *Yöneticinin kapalı tutma yolu yok:* **kabul,** "Kapalı tut" eklendi. Önerilen "Geri al'ın örtük olarak kapalı tutma anlamına gelmesi" ise **ret:** örtük anlam kafa karıştırır; açık bir düğme yeter.
- *Kim açar belirsiz, tavan kişi başı mı:* **kabul.** Her personel açabilir; tavan bütün personel için ortaktır.
- *Hız sınırı:* **kabul.**
- *Yönetici uzaktayken toplu kapatma:* **kabul,** üç önlemle: 16 saat sonra uyarı rengi, 24 saat sonra ya da saatte 3 kalemde zil uyarısı, sabah e-postası. **Push ret:** push konusu (`approvals`) yalnız yöneticiden eylem bekleyen onaylar için ayrılır; zil ve sabah e-postası yeterli.
- *390 px'te çift dokunuş:* **kabul.** Pencere yalnız kapatır, karttaki düğme 1,5 sn kilitlenir.
- *Boş durumun karaoke tahtasını itmesi, Suspense içindeki çapa:* **kabul.**
- *Hata metinleri istemcide kuruluyor:* **kabul;** sunucuya taşındı.
- *KVKK:* **kabul.** RSC yükü denetimi §6'da.

**Testler**
- `tests/tukendi.test.ts` (saf + kaynak denetimi):
  - `soldOutBoard`: M+L birleşir; kopuk / eksik / bağsız / emekli kalem dışarıda; dört durum (`on`, `card`, `closed`, `drifted`).
  - `markerValid`.
  - `reopenRefusal`: kayıt yok, damga farklı, kardeş satır pasif, yönetici.
  - Tavan: 10. kayıt kabul, 11. ret; yönetici serbest.
  - Hız sınırı hesabı.
- Kaynak denetimleri:
  - `menu-status.ts` dışa yalnız `[setSoldOut, holdSoldOut]` verir; ilki `requireUser`, ikincisi `requireAdmin` çağırır;
  - eylemdeki `.set({` içinde `price` ve `active` geçmez;
  - kayıt yazımı damga koşuluna bağlıdır;
  - açma yolu `fetchSiteMenu(` çağırır;
  - okuyucu fiyat alanı seçmez;
  - `sold-out-card.tsx` içinde `price` ya da `tl(` geçmez;
  - zil satırı yalnız yönetici dalında çağrılır;
  - `applyPushed` `carrySoldOutMarker(` çağırır;
  - `saveRecipe` `seenShowOnMenu` alanını kullanır.
- `tests/tukendi-db.test.ts` (`TUKENDI_TEST_DATABASE_URL`; site sahte bir `callSite` ile taklit edilir):
  - "değişmedi" yanıtı kayıt bırakmaz;
  - bayat kopya + sahibin kapatması kayıt bırakmaz;
  - canlı damga farklıysa açma reddedilir;
  - yalnız fiyat yazımı kaydı taşır;
  - `saveRecipe` değişmeyen `showOnMenu` ile ürünü açmaz;
  - hız sınırı ve ortak tavan çalışır;
  - "Kapalı tut" sonrası personel açamaz.

---

### 2.2 Kasadaki fiyatlar (`kasaya-isle`): Grup B, onaysız, efor M

**Karar.** Sunulan tasarım, aşağıdaki düzeltmelerle uygulanır. Personel `/panel/kasa/fiyatlar`'da ModPOS'ta değişecek satış fiyatlarını görür ve tek tek işaretler. `/panel/urunler` personele kapalı kalır.

**Personel ekranı**
- Ekrana girişler:
  - Bugün'de personel satırı "Kasadaki fiyatlar", rozet "3 fiyat". Açıklama: "ModPOS'ta değişecek 3 fiyat; değiştirdikçe işaretleyin. En eskisi 2 gündür bekliyor." Eylem: "Listeyi aç".
  - Zil (grup `kasa`): "Kasada değişecek 3 fiyat", gövde "ModPOS'ta değiştirip Kasadaki fiyatlar'da işaretleyin".
- `/panel/kasa/fiyatlar` sayfası:
  - **PageHeader:** eyebrow "Günlük", başlık "Kasadaki fiyatlar", açıklama "Bu fiyatlar panelde değişti, ModPOS'ta hâlâ eski. ModPOS'ta değiştirdikçe işaretleyin."
  - **"Son işaretledikleriniz"** kartı (son 30 dakikanın işaretleri) doluysa listenin **üstünde** durur. Satır: "Latte · Medium → 205 ₺ · 14:32" ve "Geri al". Altında: "30 dakika içinde geri alabilirsiniz; sonrası için yöneticiye yazın."
  - **Liste:** kategori başına bir bölüm. Her satır:
    - en az 56 px yüksek, tamamı dokunma alanı, solda 20 px onay kutusu;
    - 1. satır: "Latte · Medium", sağda "~~195 ₺~~ → 205 ₺";
    - 2. satır: "Kasada: LATTE MEDİUM · 2 gündür" ya da "Kasada adı bilinmiyor".
    - Kaynak, değiştiren kişi ve not gösterilmez.
  - **İşaretleme:** dokununca satır gizlenir. Toast: "Latte Medium kasada 205 ₺ olarak işaretlendi", süresi 10 sn, "Geri al" düğmesiyle.
  - Fiyat bu arada değiştiyse `posChangedText` gösterilir; zaten işaretlenmişse "… zaten işaretlenmiş".
  - "Metni kopyala" düğmesi vardır; "Hepsini işaretle" yoktur.
  - **Boşken:** "Kasa güncel" / "Panelde değişen bütün fiyatlar kasada da değişti."
- Yönetici bu adresi açarsa `/panel/urunler/fiyatlar?sekme=kasa` sayfasına yönlenir.

**Yönetici ekranı**
- `/panel/onaylar`'a kart eklenmez.
- **Ürünler › Fiyatlar › Kasaya işle:**
  - Açıklamaya şu cümle eklenir: "Personel de Bugün'den işaretler; yanlış işareti aşağıdan geri alın."
  - Yeni **"Son işaretlenenler"** kartı (`id="son-isaretlenenler"`, son 14 gün): kişi ve gün başına gruplanır ("Ayşe · dün · 34 fiyat", açılır), telefonda kapalı gelir.
  - Satır: "Latte · Medium 195 → 205 ₺", altında `logPerson` ile hesabın güncel adı ve "Geri al". Geri alınamıyorsa nedeni yazar. Geri alınmış satır soluk görünür: "Geri alındı · Ali".
  - Yöneticinin kendi işaretleri de bu karta kaydedilir.
- **Bugün:**
  - Bekleyen fiyat varsa satırın metni bugünkü gibidir; son 48 saatte personel işareti varsa sonuna "Ayşe dün 3 fiyatı kasada işaretledi." eklenir.
  - Bekleyen fiyat yok ama son 48 saatte personel işareti varsa satır `done` durumunda Tamamlananlar'a düşer: "Kasadaki fiyatlar · Ayşe dün 3 fiyatı kasada işaretledi", bağlantı `/panel/urunler/fiyatlar?sekme=kasa#son-isaretlenenler`.
- **Zil:** id iki rolde de `kasa-fiyat-${en yeni since}` olur. İşaret zili yeniden okunmamış yapmaz; yalnız yeni bir fiyat yapar. E-posta yok (D2 geçerli).
- **İşlem geçmişi:** "Kasaya işlendi" · Ayşe · "Latte M 205 ₺"; "Kasaya işlendi geri alındı" · Ali · "Latte M 205 ₺ (Ayşe'nin işareti)".

**Veri ve eylemler**
- **Migration** (`0037` içinde): `pos_marks` tablosu.

  | Sütun | Tür |
  |---|---|
  | `id` | serial pk |
  | `product_id` | int not null → products, cascade |
  | `price` | double not null |
  | `stale_price` | double not null |
  | `stale_since` | timestamptz not null |
  | `marked_by` | int → users, set null |
  | `marked_by_name` | text not null |
  | `marked_at` | timestamptz not null default now() |
  | `undone_at` | timestamptz |
  | `undone_by_name` | text |

  Dizinler: `(marked_at)`, `(marked_by, marked_at)`, `(product_id, marked_at)`.
- **Saf yardımcılar** (`src/lib/prices/pos.ts`):
  - `POS_UNDO_WINDOW_MS = 30 dk`;
  - `posMarkMax(role)`: personel 1, yönetici 500;
  - `posUndoRefusal({ role, meId, now }, mark, product, latestMarkId)`. Reddettiği durumlar:
    - personel, işaret başkasının;
    - personel, 30 dakika geçti;
    - işaret zaten geri alındı;
    - ürün listeye yeniden girdi;
    - fiyat kasadakine döndü;
    - **işaret ürünün son işareti değil ya da güncel fiyat `mark.price`'tan farklı** → "Bu ürün sonra yeniden işaretlendi; son işareti geri alın".
- **Çekirdek:** `src/server/prices/pos-marks.ts` (`db` alır).
  - `markPos(db, user, items, now)`:
    - ürünler `orderBy(products.id)` ile FOR UPDATE kilitlenir;
    - personelde `products.active = true` şartı aranır, personel listesinde olmayan kimlik reddedilir;
    - `splitPosDone` uygulanır;
    - `already` ve `changed` yalnız çağıranın gönderdiği kimliklerden oluşur; `already` yalnız kimlik taşır.
  - `undoPosMarks(db, user, ids, now)`:
    - önce işaretler, sonra ürünler, ikisi de kimlik sırasıyla kilitlenir;
    - ürün başına en son işaret aynı kilit altında okunur;
    - saklanmış `stale_price` ve `since` geri yazılır. İstemciden fiyat alınmaz.
- **Eylem dosyası:** `src/server/actions/pos-marks.ts` (`"use server"`). Dışa yalnız `markPosDone` ve `undoPosMarks` verir; ikisi de `requireUser()` ile başlar.
- `src/server/actions/prices.ts` dışa yalnız `[applyBulkPrices, undoPriceBatch]` verir. `markPosDone` ve `restorePosPending` buradan çıkar.
- **Yükleyiciler:**
  - `src/server/data/pos-staff.ts` (`server-only`). Beyaz liste: `products.id, name, size, price, pos_stale_price, pos_stale_since, sort_order, active`; `categories.name, sort_order`; `pos_mappings.pos_name`. Yalnız `active = true` ürünler.
    - `loadStaffPosList()`
    - `loadMyPosMarks(userId, now)`
    - `staffPosSummary()`: yalnız aktif ürünler, sayı ve iki zaman.
  - `src/server/data/prices.ts` içinde yönetici için `loadRecentPosMarks({ days: 14 })`.
- **Bileşen:** `PosChecklist` `src/components/panel/pos-checklist.tsx`'e taşınır. Ayrı bir `StaffPosItem` tipi vardır (`source`, `changedBy`, `changedAt` anahtarları yok). Bileşen `staff` prop'uyla daraltılan bir birleşim tipi alır. `@/server/data/prices`'tan yalnız `import type` yapılır.
- **Bugün ve zil:**
  - `posRow` ve `posNotifications` Adım 0'da `rows-ops.ts` ve `bell/ops.ts`'e taşınır. B onları rol farkındalıklı yapar: personelde bağlantı `/panel/kasa/fiyatlar`, eylem "Listeyi aç".
  - `STAFF_ROWS` içinde `hizli-sayim`'dan sonra gelir.
- **Belgeler:**
  - `docs/FIYATLAR.md`: "Yalnız yönetici" ibaresi kalkar; `pos_marks` ve geri alma kuralları yazılır; "tek tek işaretleme bir sürtünmedir, denetim değildir; denetim satır satır kayıt ve yöneticinin Tamamlananlar satırıdır".
  - `docs/planlar/menu.md` D1'e not: "24 Ekim 2026: personel işaretler, onaysız".

**Korumalar**
- Personel yükleyicisi `product_prices`, kaynak, not, site alanları, reçete ve maliyet okumaz.
- Personel sayfası `@/server/data/prices`'tan ya da `/panel/urunler` altından değer import etmez.
- Kalan risk: personel ModPOS'ta değiştirmeden işaretleyebilir. Bu görünürdür (yöneticinin Tamamlananlar satırı, "Son işaretlenenler", İşlem geçmişi) ve geri alınabilir. Onay bunu yakalayamazdı, çünkü panelden ModPOS görünmez.

**İtirazlar**
- *Eski işaretin geri alınması:* **kabul,** "son işaret" kuralı eklendi. İsteğe bağlı "yöneticinin `pos_stale_price` düzeltmesi" ise **ret:** gereksiz karmaşa; listeye yeniden giren ürün zaten yeni fiyatla işaretlenir.
- *Yönetici sinyal almıyor:* **kabul.** Bugün'deki `done` satırı ve gruplu kart eklendi.
- *Zil sürekli yeniden yanıyor:* **kabul.**
- *Pasif ürünler personel listesine düşüyor:* **kabul.**
- *`already` kimlikleri ad döndürüyor:* **kabul.**
- *Ad anlık görüntüsü:* **kabul,** `logPerson` kullanılır.
- *Tek tek işaretlemenin "denetim" diye anlatılması:* **kabul,** belgede düzeltildi.
- *390 px'te kazara işaret:* **kabul.** Toast 10 sn, son işaretler listenin üstünde.
- *Kilit sırası:* **kabul.**
- *Ortak bileşenin tipi:* **kabul.**

**Testler**
- `tests/fiyatlar.test.ts`:
  - `posUndoRefusal` matrisi (son işaret durumu dahil);
  - `posMarkMax`;
  - kaynak denetimleri: `pos-staff.ts` seçtiği anahtarlar tam olarak beyaz liste, `active` süzgeci var; `pos-marks.ts` dışa iki eylem verir, ikisi de `requireUser` ile başlar; geri alma şemasında `stalePrice` yok; `prices.ts` dışa iki eylem verir ve ikisi de `requireAdmin` ile başlar.
  - 751. satırdaki "personel dalı kasa fiyatlarını görmez" denetimi tersine çevrilir: personel dalı `staffPosSummary` kullanır.
- `tests/kasaya-isle.test.ts` (B):
  - personel Bugün satırı (bağlantı, metin, sıra);
  - yöneticinin `done` satırı;
  - zil id'si `kasa-fiyat-${newest}`.
- `tests/kasaya-isle-db.test.ts` (`POS_TEST_DATABASE_URL`):
  - personel işareti tek satır yazar;
  - eşzamanlı iki işaretten biri `already` olur;
  - bayat fiyat işaretlenmez;
  - başkasının işaretini geri alma reddedilir;
  - yöneticinin geri alması saklanan değerleri yazar;
  - M1 → fiyat değişikliği → M2 → M1'i geri alma reddedilir;
  - pasif ürün kimliği reddedilir.
- `tests/roller.test.ts` (Adım 0): `canOpen("staff", "/panel/kasa/fiyatlar")` true, `"/panel/urunler/fiyatlar"` false.

---

### 2.3 Kasa raporunu sonradan düzeltme ve silme isteği (`kasa-kilitli-gun-duzeltme`): Grup A, onaylı, efor L

**Karar.** Personel, açabildiği raporlarda (bugün ve dün; `staffCanReport`) üç tür değişiklik için doğrudan kaydetmek yerine "Onaya gönder" kullanır:
- ertesi gün yapılan kasa alanı ya da Sayan değişikliği;
- kilitli güne yapılan her değişiklik;
- silme isteği.

Rapor onaya kadar değişmez. Onaylanan düzeltme, yöneticinin kendi düzeltmesi gibi yeni bir sürüm olur.

**Kapı kuralı.** Saf fonksiyon, `src/lib/cash-report.ts` içinde:
```ts
staffCashGate({ date, now, hasReport, laterReport, changes }): "direct" | "request" | "closed"
// !staffCanReport → "closed"; !hasReport → "direct"; laterReport → (changes.length ? "request" : "direct");
// isLateEdit(date, now) && changes.some(c => c.sensitive) → "request"; değilse "direct"
```
- `SENSITIVE` listesine `"countedByName"` (Sayan) eklenir. Bu, yöneticinin "ertesi gün düzeltildi" uyarısını Sayan değişikliğine de genişletir.
- Örnek: 22 Ekim'in raporu, 23 Ekim'in raporu girilince kilitlenir. Personelin penceresi 23 Ekim iş günü boyunca açıktır, 24 Ekim 05:00'te kapanır. 23 Ekim 10:00'da 22 Ekim'in "Teslim edilen" alanını değiştirmek 3b'dir: istek olur. Aynı saatte yalnız notu değiştirmek doğrudan kaydedilir.

**Personel ekranı** (`/panel/kasa`, 390 px'te tek sütun, düğme satırları sarar)
1. **Kilitli gün:**
   - Gri satır: "Ertesi günün raporu girildi; bu raporu yönetici onayıyla düzeltirsiniz."
   - Yanında secondary "Düzeltme öner" (Pencil).
   - Düğme aynı `CashForm`'u yeni `mode="proposal"` ile açar:
     - başlık: "22 Ekim kasa raporu · düzeltme önerisi";
     - mavi şerit: "Yönetici onaylayınca rapora işlenir; o zamana kadar rapor değişmez.";
     - bütün alanlar kayıtlı rapordan dolu gelir; canlı Sonuç kartı çalışır;
     - fotoğraf düğmeleri gizlidir;
     - en altta zorunlu "Neden düzeltiyorsunuz?" alanı (5–500 karakter);
     - açılış devirle tutmadığı için not gerektiğinde (`openingNeedsNote`) bu "Neden" metni rapor notuna da kopyalanır, iki kez yazılmaz;
     - düğmeler: "Onaya gönder" ve "Vazgeç".
2. **Kilitsiz dün:** kullanıcı normal "Düzenle" ile başlar. Sunucu kapıdan `"request"` dönerse (3b) form yazılanları **korur**, şu şerit çıkar ve birincil düğme "Onaya gönder" olur: "Kasa alanlarını ertesi gün değiştirmek yöneticinin onayıyla olur; nedenini yazıp onaya gönderin."
   - Aynı yol, 05:00 dönüşünde ya da bu arada ertesi günün raporu girildiğinde de çalışır; personel yazdıklarını kaybetmez.
3. **Bekleyen istek:**
   - Düğmelerin altında amber şerit: "Düzeltme öneriniz onay bekliyor · 23 Ekim 10:05". Değişen satırlar ("Teslim edilen: 2.400 ₺ → 2.040 ₺") ve sonuç ("Kasa farkı: 120 ₺ eksik → Kasa tutuyor") listelenir.
   - Düğmeler: "Öneriyi düzenle" (aynı satırı günceller, `version` artar) ve "Geri çek".
   - Başkasının isteği bekliyorsa yalnız "Mehmet'in düzeltme önerisi onay bekliyor" yazar. Kendi düğmeleri **gizlenmez**: istek kişi başınadır, kimse kimseyi engellemez.
4. **Silme isteği:**
   - Açılabilen her raporda küçük ghost bir "Silinmesini iste" düğmesi (Trash2) vardır.
   - Dialog:
     - başlık: "Bu rapor silinsin mi?";
     - metin: "Yanlış güne ya da iki kez girildiyse yönetici siler. Silinene kadar rapor yerinde kalır.";
     - zorunlu "Neden?" alanı ve "Silme isteği gönder" düğmesi.
   - Kendi silme isteği bekleyen raporda "Düzenle" kilitlidir: "Silme isteğiniz bekliyor; önce geri çekin."
5. **İsteklerim** (`#isteklerim`, kasa sayfasının altında, son 7 gün): kasa türlerinin hepsi (2.3, 2.6, 2.7, 2.9) burada listelenir. Satırda başlık, durum rozeti ve "Yönetici: <not>" yazar. Bekleyenlerde "Geri çek" düğmesi vardır.
6. **Zil** (personel, grup `onay`, etiketi "İsteklerim"):
   - "22 Ekim kasa düzeltmeniz onaylandı" / "… reddedildi";
   - gövde: "Yönetici: <not>" ya da "Rapor güncellendi" / "Rapor değişmedi";
   - bağlantı: gün hâlâ personele açıksa `/panel/kasa?gun=…`, değilse `/panel/kasa#isteklerim`.
   - Sonuç çoğu zaman sabah gelir ve gün o saatte artık personele açık olmayabilir. Bu bilerek kabul edildi: sonucu zil söyler.

**Yönetici ekranı**
- **`/panel/onaylar` › "Kasa" bölümü**, her istek ayrı kart (`#istek-<id>`).
  - **Düzeltme kartı:**
    - başlık "Kasa düzeltmesi · 22 Ekim Çarşamba", alt satır "Mehmet · 23 Ekim 10:05 · 2 gündür bekliyor", "Neden: …";
    - "Değişecek" listesi: `revisionChanges(current, merged)`; `SENSITIVE` alanlar kalın ve uyarı renginde;
    - rapor istekten sonra değiştiyse (`report.revision ≠ baseRevision`) üç sütun gösterilir: öneri anı / şimdi / onaydan sonra;
    - sonuç satırları: "Kasa farkı: 120 ₺ eksik → Kasa tutuyor", "Ertesi güne devir: 480 ₺ → 840 ₺";
    - sonraki rapor varsa: "23 Ekim açılışı (840 ₺) bu devirle tutacak / tutmayacak";
    - "Gün içinde çıkan" değişiyorsa: "Fişlerden: 3 kalem · 412,50 ₺". Öneri fişlerin toplamını 1 ₺'den fazla aşıyorsa kırmızı satır: "Fişsiz çıkış: 120 ₺";
    - raporun ayı geçmiş bir aysa: "Ekim ayı geçti: Satışlar cirosu ve kart payı / POS komisyonu değişir";
    - "Raporu aç" bağlantısı;
    - "Not (isteğe bağlı; personele görünür, tutar yazmayın)" alanı;
    - düğmeler: "Onayla" ve "Reddet". Vurgulu bir alan değişiyorsa "Onayla" mevcut `ConfirmDialog`'u açar; yalnız metin değişiyorsa tek dokunuştur.
    - Birleşim sonucunda değişen bir şey kalmıyorsa (`mergeProposal` boş): "Rapor zaten bu hâlde; isteği kapatın" ve "Kapat" düğmesi (`superseded`).
  - **Silme kartı:**
    - raporun özeti ("Z 12.450 ₺ · sayılan 2.880 ₺ · 120 ₺ eksik · sayan Ayşe · 2 fotoğraf");
    - uyarı: "Silinince rapor ve önceki sürümleri gider; değerleri işlem geçmişinde kalır, fotoğraflar 30 gün saklanır." Sonraki rapor varsa ek olarak: "23 Ekim açılışı bu raporun devrine dayanıyor";
    - "Onayla ve sil" `ConfirmDialog` açar; yanında "Reddet".
- **Yöneticinin kendi Düzenle formu:** raporda bekleyen istek varsa formun başında bant: "Mehmet'in düzeltme önerisi bekliyor · Onaylar'da bakın".
- **Zil** (yönetici, grup `onay`), istek başına bir satır:
  - düzeltme: "22 Ekim kasa raporu: düzeltme önerisi", gövde "Mehmet · Teslim edilen 2.400 ₺ → 2.040 ₺ · kasa farkı 120 ₺ eksik → tutuyor";
  - silme: "22 Ekim kasa raporunun silinmesi istendi", gövde "Mehmet: <neden, ilk 80 karakter>";
  - bağlantı `/panel/onaylar#istek-<id>`, id `istek-<id>-<bumped_at>`.
  - "Kasa: X eksik" zili istek beklerken de **susturulmaz**.
- **Ertesi gün düzeltme zili** (`cashIntegrityNotifications`): onaylanan düzeltmede gövde "Mehmet önerdi · Ayşe onayladı" olur. Bu `proposedByForReports` haritasından okunur.
- **Bugün:** genel "Onaylar" satırında sayılır (§3.6).
- **E-posta:** onaylanınca rapor her güncellemedeki gibi gider. Başlığa tek satır eklenir: "Yönetici onayıyla düzeltildi: Mehmet önerdi, Ayşe onayladı."
- **İşlem geçmişi:**
  - personel: "Kasa düzeltmesi önerildi" (değişiklikler · neden, ilk 200 karakter), "Kasa raporunun silinmesi istendi", "… geri çekildi";
  - yönetici: "Kasa düzeltmesi onaylandı" ("22 Ekim (Mehmet önerdi): … · not: …"), "Kasa düzeltmesi reddedildi", "Kasa raporu silindi … · Mehmet istedi".
- **"Değişiklikler" geçmişi:** onaylanan sürüm "23 Ekim 10:05 · Ayşe · Mehmet'in önerisi" diye görünür.

**Veri ve eylemler**
- **Ortak tablo:** `staff_requests` (§3). Türler `kasa-duzeltme` ve `kasa-silme`. `subject = "gun:<YYYY-MM-DD>"`, `day` = rapor günü.
- **Payload** (`src/lib/cash-requests.ts`, zod):
  - `kasa-duzeltme`: `{ date, reportId, baseRevision, base: CashRevisionData, baseCountedBy: number | null, proposed: Omit<CashReportFields,"date"> & { countedBy: number; countedByName: string }, gate: "kilitli" | "gec" }`
  - `kasa-silme`: `{ date, reportId, baseRevision, snapshot: CashRevisionData, photos: number }`
  - Payload'da karaoke, site satırı, maliyet ve fiyat yoktur.
- **Saf yardımcılar:**
  - `mergeProposal(current, base, proposed)`: yalnız `base ≠ proposed` olan alanları uygular. `countedBy` da bu kurala bağlıdır (`baseCountedBy` ile); `proposed.countedBy` hiçbir zaman olduğu gibi alınmaz.
  - `proposalChanges`
  - `staffCashGate`
  - metin kurucuları.
- **Yeniden düzenleme, davranış değişmeden:**
  - `src/server/cash/report-store.ts` (`server-only`, `"use server"` **değil**): `reportSchema`, `writeCashReport(tx, actor, data, { revision, countedBy, photos, submittedBy? })`, `removeCashReport(tx, id, { exceptRequestId? })`. `removeCashReport` aynı günün öteki bekleyen isteklerini `superseded` yapar, not "Rapor silindi".
  - `src/server/cash/report-email.ts`: `emailReport(reportId, { site?, approval?, idempotencyKey? })`.
  - `submitCashReport` ve `deleteCashReport` bunları çağırır.
  - `submitCashReport` personel için işlem içinde kapıyı hesaplar. Sonuç `"request"` ise hata fırlatmaz; `{ needsApproval: true, gate }` döner ve hiçbir şey yazmaz.
  - Kendi silme isteği bekleyen raporu düzenlemek reddedilir.
- **Eylem dosyası:** `src/server/actions/cash-requests.ts` (`"use server"`). Her export kendi rolünü denetler.
  - `requestCashCorrection({ date, baseRevision, fields, countedBy, message, clientKey })`:
    - `requireUser()`; yönetici "Yönetici raporu doğrudan düzeltir" ile reddedilir;
    - kapı `"request"` olmalı, değilse "Bu değişikliği doğrudan kaydedebilirsiniz";
    - `baseRevision` güncel sürüme eşit olmalı;
    - normal kayıttaki bütün denetimler çalışır (teslim ≤ sayılan, açılış notu, Sayan etkin kullanıcı);
    - öneri bir şey değiştirmeli;
    - `createOrUpdateRequest` çağrılır.
  - `requestCashDelete({ date, baseRevision, message, clientKey })`: aynı rol denetimi.
  - `reviewCashRequest({ id, seenVersion, seenRevision, decision, note, fields?, handoverSeen? })`:
    - `requireAdmin()`.
    - Tek işlemde: `lockForReview` (FOR UPDATE, `pending`, `version` eşit, isteyen ≠ ben) → rapor FOR UPDATE, `revision === seenRevision`.
    - **Düzeltme onayı:** `writeCashReport(tx, admin, mergeProposal(...), …)`. Bu sürüm kopyasını yazar ve devir, açılış notu, teslim ve Sayan denetimlerini yeniden çalıştırır. Aynı günün öteki bekleyen düzeltmeleri `superseded` olur ("Rapor başka bir istekle düzeltildi").
    - **Silme onayı:** `removeCashReport(tx, id, { exceptRequestId })`; istek `approved` olur.
    - **Ret:** yalnız durum ve not yazılır.
    - İşlemden sonra: e-posta (yalnız düzeltmede), `logActivity`, `refresh()`.
    - Dönüş: `{ revision, next, nextBroken, email }`.
- **Yükleyiciler** (`src/server/data/cash-requests.ts`, `server-only`):
  - `pendingCashForDay(day, me)`: kendi satırı tam; başkalarınınki yalnız `{ kind, requestedByName, createdAt }`.
  - `loadCashRequestQueue()`: yalnız yönetici.
  - `proposedByForReports(reportIds)`: `Map<reportId, Map<revision, requesterName>>`.
  - `historyOf` ve `CashRevisions` isteğe bağlı `proposedBy` alır.
- **Kasa e-postasının alıcıları:** `updateCashSettings` bir personel hesabının e-posta adresini reddeder: "Bu adres bir personel hesabının; kasa e-postasında karaoke ön ödemesi var."
- **Belgeler:** `docs/KASA-RAPORU.md`'ye yeni bölüm "Sonradan düzeltme ve silme isteği" (kapı kuralı tablosuyla).

**Korumalar**
- Personelin isteği yalnız kendi açabildiği raporu ve kendi yazdığı sayıları taşır.
- Onay kartı yalnız yöneticide (`requireAdmin`; `/panel/onaylar` `STAFF_PATHS` içinde değil).
- Sürüm ve versiyon denetimi sayesinde yönetici yalnız gördüğü farkı onaylar.
- İstek kişi başına tektir (§3). İsteyen başına rapor başına günde en çok 3 istek açılabilir.
- Geri çekme koşullu bir UPDATE'tir.

**İtirazlar**
- *Erişim dar ve sabah düzeltmesi açık kalıyor:* **kabul.** Kapı kuralı eklendi; örnek tarihler düzeltildi.
- *İstek yarışı (yönetici eski sürümü onaylıyor):* **kabul,** `version` eklendi. Aynı koruma `reviewRecipeChange`'e de eklenir: `recipe_change_requests`'e `version int not null default 1` sütunu (aynı migration), "Öneriyi düzenle" sayıyı artırır, onay `seenVersion` ister. Bu A'nın işidir; `onaylar/` A'dadır.
- *Fişsiz çıkış ile açık örtme:* **kabul.**
- *Sayan:* **kabul.**
- *Silme kendi isteğini kapatıyor:* **kabul,** `exceptRequestId` ve `superseded` eklendi.
- *Kilitsiz raporda silme isteğiyle aynı anda düzenleme:* **kabul.**
- *Çift düzeltme:* **kabul,** üç sütun ve "Rapor zaten bu hâlde". Yöneticinin doğrudan düzenlemesinin istekleri otomatik kapatması ise **ret:** yönetici yalnız bir kısmını düzeltmiş olabilir; kart farkı gösterir.
- *Başkasını engelleme:* **kabul.**
- *Kendini onaylama:* **kabul.**
- *İstek yağmuru:* **kabul.**
- *Sahibin ne gördüğü:* **kabul.**
- *Yönetici uzaktayken:* **kabul.** Yaş, sabah e-postası ve ay uyarısı eklendi.
- *390 px:* **kabul.**
- *Yalnız metin değişiklikleri:* **kabul.**
- *İsteğe bağlı "Not ekle" (12):* **ret.** Kilitli günde metin düzeltmesi seyrektir ve "Neden" alanı aynı işi görür.
- *KVKK e-posta:* **kabul.** Personel adresi alıcı yazılamaz.

**Testler**
- `tests/kasa-duzeltme-istegi.test.ts`:
  - `staffCashGate` matrisi (bugün / dün / kilitli × metin / kasa alanı / Sayan × 04:59 / 05:00);
  - `mergeProposal`: arada yapılan yönetici düzenlemesi korunur, Sayan da;
  - değişiklik yoksa ret;
  - zil ve log metinleri;
  - `historyOf` + `proposedBy`;
  - payload'da karaoke ya da site anahtarı yok.
- Kaynak denetimleri:
  - `cash-requests.ts` exportları `requireUser` / `requireAdmin` ile başlar; istek eylemleri yönetici rolünü reddeder;
  - `report-store.ts` `"use server"` değildir ve `server-only` import eder;
  - `submitCashReport` `needsApproval` döner.
- `tests/kasa-istek-db.test.ts` (`KASA_ISTEK_TEST_DATABASE_URL`):
  - kilitli gün → istek bekler, rapor değişmez;
  - dünün geç SENSITIVE değişikliği → `needsApproval`;
  - aynı gece değişiklik → doğrudan kaydedilir;
  - iki personelin isteği birbirini engellemez; biri onaylanınca öteki `superseded` olur;
  - bayat `seenVersion` ve bayat `seenRevision` reddedilir;
  - kendi isteğini onaylama reddedilir;
  - silme onayında kendi istek `approved`, öteki istekler `superseded`;
  - yöneticinin doğrudan silmesi bekleyen istekleri `superseded` yapar ("reddedildi" değil);
  - eşzamanlı iki onaydan tek biri kazanır;
  - kasa e-postasına personel adresi yazılamaz.
- Mevcut `kasa-raporu`, `kasa-ay-bilgisi` ve `recete-onay` testleri yeniden düzenlemeden sonra değişmeden geçer. `SENSITIVE` değişikliği için `kasa-raporu.test.ts` güncellenir.

---

### 2.4 Mal siparişi taslağı (`mal-siparisi-taslak`): Grup B, taslak onaylı, gönderme onaysız, efor L

> **Kaldırıldı (26 Ekim 2026, B21):** hızlı sayım ve mal siparişiyle birlikte. `mal-taslak` türü eski satırlar için
> enumda kalır, kuyruklar okumaz (`docs/MAL-SIPARISI.md`, `docs/ONAYLAR.md`). Aşağısı tarihçedir.

**Karar.** Personel hızlı sayımdan sonra fiyatsız bir taslak hazırlar ve onaya gönderir. Yönetici tahmini tutarı görür, gerekirse düzeltir ve onaylar. Onaylanan taslağı personel tek dokunuşla gönderir. Önce kayıt yazılır, WhatsApp ondan sonra açılır.

**Personel ekranı:** `/panel/hizli-sayim/siparis` (`/panel/hizli-sayim` altında; `STAFF_PATHS` değişmez)
- **Girişler:**
  - Hızlı sayım üst bilgisinde "Sipariş taslağı" düğmesi;
  - sayım kaydedilince toast "{n} kalem kaydedildi", eylemi "Sipariş taslağı";
  - Bugün'de personel satırı (aşağıda).
- **Sayfa:**
  - PageHeader: eyebrow "Stok", başlık "Sipariş taslağı", açıklama "Sayıma göre önerilen miktarlar. Gerekirse değiştirip onaya gönderin; yönetici onaylayınca WhatsApp'tan gönderirsiniz."
  - Her tedarikçi için bir kart, başlıkta ad ve "Teslim 2 gün".
  - Satır: sipariş adı, "Eldeki 3 LT", varsa "Az kaldı"; − / + adımlayıcı (44 px); sipariş biriminde miktar.
  - Önerisi 0 olan kalemler kapalı "Yeterli olanlar (n)" bölümünde durur.
  - "Tedarikçiye not (isteğe bağlı)" alanı.
  - "Onaya gönder" düğmesi.
  - Hiçbir yerde ₺, tutar, hedef ya da günlük kullanım yok.
- **Kart durumları:**
  - **Kartta cep numarası yok:** "Bu tedarikçiye yönetici gönderir"; form gösterilmez.
  - **Sayım eski** (miktarı 0'dan büyük herhangi bir satırın son sayımı dünden eski): "Önce hızlı sayım yapın" ve "Sayıma git".
  - **Son sayımdan sonra sipariş gitmiş** (o tedarikçinin kalemlerinin en yeni sayımına göre): "Bu tedarikçiye bugün 09:15'te sipariş gönderildi".
  - **Onay bekliyor:** "Ayşe · 09:42".
    - Gönderen kişi "Geri çek" görür; başkası salt okur.
    - 30 dakika geçtiyse ya da gönderimde hiç yönetici cihazına ulaşılamadıysa ek bir düğme çıkar: "Yöneticiye WhatsApp'tan haber ver". Bu, kasa raporu WhatsApp numarasına tutarsız bir metin açar: "Mal siparişi taslağı onay bekliyor: Kaldi (5 kalem). ladmin.laffogato.net/panel/onaylar#istek-{id}".
  - **Onaylandı:**
    - "Ali onayladı · 10:05"; miktar değiştiyse "Yönetici miktarları değiştirdi"; not varsa "Yönetici: …"; satırlar salt okunur.
    - Birincil düğme "WhatsApp'ta aç".
    - "Metni kopyala" **yok**.
  - **Gönderildi:** "Ayşe · 10:12". 10 dakika boyunca "WhatsApp'ta yeniden aç" (aynı sipariş, yeni kayıt açmaz) ve "Geri al".
  - **Geri alındı:** "Geri alındı: tedarikçiye iptal yazın". Yeniden sipariş için yeni taslak ve yeni onay gerekir.
  - **Reddedildi:** "Yönetici: …" ve "Yeniden hazırla".
  - **Süresi doldu:** "Süresi doldu; yeniden hazırlayın".
  - **Yönetici kendisi gönderdi:** "Yönetici kendisi gönderdi · Ali 10:20".
- **Bugün** (personel, yeni anahtar `mal-taslak`): "Onaylanan sipariş bekliyor: Kaldi", eylemi "Gönder". Hafif ve modelsiz bir sorguyla dolar.
- **Zil** (personel, grup `onay`): "Kaldi siparişi onaylandı; WhatsApp'tan gönderin" ya da "… reddedildi". Push da gider (`approvals` konusu, tag `istek-<id>`). Tutar yok.

**Yönetici ekranı**
- **`/panel/onaylar` › "Mal siparişi" bölümü**, taslak başına bir kart (`#istek-<id>`), kartlar kapalı gelir.
  - **Başlık:** "Kaldi · 5 kalem", alt satır "Ayşe hazırladı · 09:42 · Sayım bugün 09:30 (Ayşe)".
  - **Satır** (390 px'te üç satır):
    1. ad ve işaretler: "Öneriden fazla", "Öneri yoktu", "Sayım beklenenden düşük" (eldeki, beklenenin %50'sinden azsa), "Sayım taslaktan 4 dk önce değişti";
    2. "Öneri 2 koli · Eldeki 3 LT · Geçen 12 LT · 3 gün önce · beklenen ≈ 6";
    3. adımlayıcı ve "≈ 850 ₺" (tahmini fiyatlıysa "tahmini").
  - "Yolda: 26.10 siparişi, 2 koli" (açık sipariş varsa).
  - "Tahmini tutar ≈ 4.250 ₺ (KDV hariç, son fatura fiyatıyla)".
  - Taslaktan sonra yeni sayım varsa şerit.
  - **"Tedarikçiye gidecek mesaj"** tam metniyle gösterilir; yönetici tedarikçiye notu düzenleyebilir ya da silebilir.
  - "Not (personele görünür; tutar yazmayın)" alanı. **Retle zorunludur.**
  - Düğmeler: "Reddet" ve "Onayla".
  - Bölüm başında **"İşaretsizleri onayla"**: yalnız hiç işareti olmayan ve önerinin aynısı olan taslakları onaylar. Hepsi tek tek kaydedilir.
- **Zil** (grup `onay`, `warning`): "Mal siparişi onay bekliyor: Kaldi", gövde "5 kalem · Ayşe hazırladı", bağlantı `#istek-<id>`, en çok 5 satır.
- **Push:** taslak gelince etkin yöneticilere gider (`approvals`, tag `istek-<id>`). Taslak güncellenirse en çok 15 dakikada bir yeniden gider.
- **Bugün:** genel "Onaylar" satırında sayılır.
- **Sabah e-postası:** genel onay kutusunda görünür.
- **Mal siparişi listesi:**
  - o tedarikçinin kartında "Taslak onayda · Ayşe" rozeti;
  - Gönderilenler'de "· onaylayan Ali · personel gönderdi";
  - teslim kontrolünde "personel gönderdi" rozeti.
- **İşlem geçmişi:**
  - "Mal siparişi taslağı" (Kaldi: 5 kalem · onaya gönderildi)
  - "Mal siparişi taslağı geri çekildi"
  - "… onaylandı" / "… reddedildi" (miktar değişti · not)
  - "Mal siparişi gönderildi" (Kaldi: 5 kalem · WhatsApp · Ali onayladı)
  - "Mal siparişi geri alındı"

**Veri ve eylemler**
- **Ortak tablo:** tür `mal-taslak`; ayrı tablo yok (§3).
  - `subject = "tedarikci:<supplierKey>"`
  - `payload = { supplierKey, supplierCardId, supplier, lines: DraftLine[], supplierNote }`
    - `DraftLine` fiyatsızdır: `{ ingredientId, name, orderName, qty, unit, unitSize, countUnit, suggested, onHand, prevCount, prevCountDay, expectedOnHand, countedAt }`.
  - `result = { approvedLines, supplierNote, message }`
  - `result_id` = `supplier_orders.id`
  - `expires_at` = hazırlanma ya da onay iş günü D ise D+2 günü 05:00 TR. Onayda yeniden hesaplanır.
  - Durum akışı: `pending → approved → done` (gönderildi) / `cancelled` (gönderim geri alındı) / `expired` / `rejected` / `withdrawn` / `superseded` (yönetici listeden gönderdi).
  - Kısmi benzersiz dizin `staff_requests_live_draft_uq` tedarikçi başına tek canlı taslak bırakır.
- **Saf modül:** `src/lib/reorder/draft.ts`
  - `draftDeadline`, `isDraftExpired`
  - `staffDraftView(data)`: beyaz liste
  - `draftFlags` (fazla, öneri yoktu, düşük sayım, geç sayım)
  - `draftEdited`
  - `src/lib/reorder/message.ts` içinde `orderMessage`'a isteğe bağlı `ref` eklenir: "Onay no: #{id}". Yalnız ekleme; mevcut test değişmez.
- **Yükleyiciler:** `src/server/data/order-drafts.ts` (`server-only`)
  - `loadDraftSheet(user)`: sayfa verisinde **href ve mesaj yok**.
  - `loadDraftQueue(model)`: yönetici.
  - `staffApprovedDrafts()`: Bugün için hafif, modelsiz sorgu.
- **Eylem dosyası:** `src/server/actions/order-drafts.ts` (`"use server"`)
  - `submitOrderDraft({ clientKey, supplierKey, lines: [{ ingredientId, qty }], supplierNote })`:
    - `requireUser()`; yönetici reddedilir;
    - zod: 1–40 satır, miktar 0–9999, en az biri 0'dan büyük, not ≤ 300;
    - satırlar sunucuda `loadReorderData` ile planın o tedarikçisinden kurulur;
    - kartta cep numarası zorunlu;
    - tazelik ve "sayımdan sonra gönderildi" denetimleri satır ve tedarikçi bazında yapılır;
    - `pg_advisory_xact_lock(hashtext('mal-taslak:'||key))` altında `createOrUpdateRequest` çağrılır;
    - push `after()` ile gider;
    - dönüş: `{ id, notified }`.
  - `reviewOrderDraft({ id, seenVersion, decision, lines, supplierNote, note })`:
    - `requireAdmin()`;
    - onayda `lines` zorunludur ve taslağın kalemlerinin alt kümesi olmalıdır;
    - aynı danışma kilidi alınır;
    - kalem hâlâ o tedarikçinin planında olmalı;
    - `result.message = orderMessage({ signature, lines, note: supplierNote, ref: id })`;
    - personelin notu tedarikçiye yalnız yöneticinin onayladığı "Tedarikçiye not" olarak gider. Yöneticinin personele yazdığı not mesaja asla girmez.
  - `approveCleanDrafts({ ids, seenVersions })`: `requireAdmin()`; her taslağı ayrı işlemde, aynı kurallarla onaylar.
  - `sendApprovedDraft({ id })`:
    - `requireUser()`;
    - kilit ve FOR UPDATE alınır; durum `approved` olmalı ve süresi geçmemiş olmalı;
    - taslaktan sonra o tedarikçiye sipariş gitmemiş olmalı;
    - tedarikçi kartı çözümlenmeli, çözümlenmezse taslak `expired` olur ("Tedarikçi değişti; yeniden hazırlayın");
    - `orderSnapshot` ile `supplier_orders` satırı `requestId = "taslak:" + id` ve `onConflictDoNothing` ile yazılır; zaten varsa var olan sipariş döner;
    - istek `done`, `result_id` yazılır;
    - dönüş yalnız `{ orderId, href }`; `href`, `orderLink(phone, message).href` ve yalnız `target === "numara"`;
    - istemci `location.assign(href)` yapar.
  - `undoDraftSend({ id })`:
    - `requireUser()`;
    - yalnız siparişi gönderen kişi, 10 dakika içinde, sipariş açıkken, `receivedAt` ve `invoiceId` boşken;
    - sipariş `cancelled`, istek `cancelled` olur;
    - yöneticilere zil ve push gider.
- **`recordOrderSent`** (yönetici, `src/server/actions/reorder.ts`): tek işlemde aynı danışma kilidini alır, aynı tedarikçinin canlı taslağını `superseded` yapar, 23505 hatasını kullanıcı mesajına çevirir. Export listesi değişmez.
- **Günlük iş:** `expireStaffRequests` (§3) süresi geçenleri `expired` yapar. Bütün yükleyiciler `isDraftExpired` uygular.
- **Belgeler:** `docs/MAL-SIPARISI.md`'ye bölüm "Personelin sipariş taslağı".

**Korumalar**
- Personel tedarikçiyi, sipariş birimini, mesajı ve numarayı değiştiremez.
- Tedarikçi başına tek canlı taslak; danışma kilidi beş eylemin hepsinde ortaktır.
- İsteyen başına tedarikçi başına günde en çok 3 taslak (§3 sınırı).
- Tutar ve fiyat yalnız `/panel/onaylar`'da görünür.

**İtirazlar**
- *Çift ya da kayıtsız sipariş:* **kabul,** önce kayıt sonra yönlendirme.
- *Geri al taslağı yeniden canlandırıyor:* **kabul,** `cancelled` son durumdur.
- *Metin başkasına gidebiliyor:* **kabul.** Yalnız numarası olan tedarikçi, "Onay no" ve rozet. "Siparişsiz fatura" denetimi **bu dalgada değil** (§5).
- *Not:* **kabul.**
- *Sayım şişirme:* **kabul.**
- *Süre kuralı:* **kabul,** D+2 05:00.
- *Yönetici uzakta:* **kabul.** `approvals` konusu, 15 dakika eşiği, sabah e-postası ve WhatsApp düğmesi eklendi. "2 saat sonra yeniden push" **ret:** dalga yeni zamanlayıcı eklemez (Vercel'de yalnız günlük cron var); yerine 30 dakikadan sonra personelin "Yöneticiye haber ver" düğmesi.
- *Tazelik satır bazında:* **kabul.**
- *Tek kilit:* **kabul.**
- *Eski hâli onaylama:* **kabul,** `version` eklendi ve onayda `lines` zorunlu.
- *`replaced` durumu:* **kabul,** `superseded` olarak.
- *Tedarikçi anahtarı:* **kabul,** `supplierCardId` eklendi.
- *Push yağmuru:* **kabul.**
- *390 px ve toplu onay:* **kabul.**
- *KVKK, numara:* **kısmen.** Personel numarayı ancak onaylı gönderimde, WhatsApp'ın kendisinde görür. Bu bir iş iletişim numarasıdır ve gönderim için gereklidir. Ret notunda tutar yazılmaması ipucuyla sağlanır.
- *Testlerdeki 641, 649 ve 656 kilitleri:* **kabul.** Personel satırı ayrı anahtardır (`mal-taslak`) ve modelsizdir.

**Testler**
- `tests/mal-siparisi-taslak.test.ts`:
  - `staffDraftView` beyaz listesi; fiyatlı kurgunun JSON çıktısında `/price|cost|estimate|payable|tutar|₺/i` yok;
  - `isDraftExpired`: 2026-10-26 23:00 TR'de onaylanan taslak 2026-10-28T02:00Z'ye kadar canlı kalır;
  - `draftFlags` (dört işaret);
  - `orderMessage` + `ref` (fiyatsız).
- Kaynak denetimleri:
  - exportların rolleri;
  - sayfa verisinde `href` ve `message` yok;
  - `sendApprovedDraft` `orderSnapshot(` kullanır ve şemasında `message` yok;
  - `recordOrderSent` işlem ve kilit kullanır;
  - `mal-siparisi.test.ts` 641, 649, 656 kilitleri korunur ve yeni anahtar `mal-taslak` olarak eklenir.
- `tests/mal-siparisi-taslak-db.test.ts` (`TASLAK_TEST_DATABASE_URL`):
  - gönder → miktar değiştirerek onayla → gönder akışı;
  - aynı `clientKey` ikinci taslak açmaz;
  - `taslak:<id>` ikinci sipariş açmaz;
  - tedarikçi başına ikinci canlı taslak reddedilir;
  - geri çekme ile onay yarışında tek sonuç kalır;
  - süresi geçmiş taslak gönderilmez;
  - `recordOrderSent` taslağı `superseded` yapar;
  - geri alma, gelmiş ya da faturalı siparişte reddedilir;
  - bayat `seenVersion` reddedilir;
  - kendi taslağını onaylama reddedilir.

---

### 2.5 Kontrol listesi geçmişi, salt okunur (`kontrol-gecmis-salt-okunur`): Grup B, onaysız, efor M

**Karar.** Personel, doldurabildiği listelerin son **7** gününü görür. 14 gün değil 7: amaç "dün gece ne oldu"dur ve KVKK veri azaltımı kısa pencereyi gerektirir. Geçmiş gün doldurulamaz.

**Personel ekranı**
- **Kontrol listeleri sekmeleri:** personelde "Bugün · Geçmiş", yöneticide "Bugün · Geçmiş · Listeler".
- **`/panel/kontrol/gecmis`** (personel):
  - açıklama: "Son 7 gün: hangi listeyi kim, ne zaman doldurdu; eksik maddeler ve sorunlar. Geçmiş gün doldurulamaz.";
  - 7 gün satırı, yöneticideki rozetlerle; "Daha eski günler" düğmesi yok;
  - gün ayrıntısı: salt okunur `RunView`, **`audit={false}`** ("Erken dolduruldu" rozeti gizli);
  - bugünün ayrıntısında, başlamış ya da açık her listenin yanında "Listeyi aç" (`/panel/kontrol/[id]`);
  - `?gun=` 7 günden eskiyse ve `?bitis=` verilmişse yok sayılır; 7 günlük liste gösterilir.
- **Bugün, personelin `liste-dun` satırı:**
  - `status: "todo"` (`warn` değil);
  - yalnız açık sorunlar (`x.open`) ve **başlamış** listelerin eksik maddeleri;
  - dünün kasa raporu da yoksa, hiç açılmamış listeler yazılmaz;
  - rozet: "1 eksik" / "2 sorun"; eylem "Geçmişe bak"; `kasa-dun`'dan hemen sonra gelir.
  - `splitTasks` başka bir `todo` ya da `warn` satır varken `liste-dun`'ı hiçbir zaman "sıradaki" seçmez. Bu iki rolde de geçerlidir; yöneticide sıra zaten öndedir.
  - Kapalı gün etkisi (§2.9): dün onaylı kapalıysa ve hiç liste açılmadıysa satır çıkmaz; bekleyen kapalı bildirimi varsa detayın sonuna "Personel kapalıydık dedi (onay bekliyor)" eklenir.
- **Zil:** değişmez.

**Yönetici ekranı**
- Onay kartı yok, İşlem geçmişi kaydı yok (bakmak bir yazım değildir).
- **Liste düzenleme** (`template-fields.tsx`), "Personel doldurabilir" açıklaması: "Açıksa personel bu listeyi doldurur ve açtığınız andan sonraki kayıtların son 7 gününü (notlar, değerler, fotoğraflar) görür."
- Kullanıcılar & roller satırları Adım 0'da yazılır (§4.2).
- Yardım'daki "Açılış ve kapanış listeleri" maddesine bir cümle eklenir: "Personel de son 7 günü Geçmiş'ten görür; geçmiş gün doldurulamaz."

**Veri ve eylemler**
- **Migration** (`0037`): `checklist_templates.staff_since timestamptz null`.
  - `createChecklistTemplate` ve `updateChecklistTemplate`, `staffAllowed` false → true geçtiğinde `staff_since = now()` yazar.
  - Boş değer "baştan beri" demektir; mevcut personel listeleri zaten açıktı. Geri doldurma yok.
- **`src/lib/checklists.ts`:**
  - `STAFF_HISTORY_DAYS = 7`
  - `staffHistoryFloor(today)`
  - `historyRange({ role, today, first, gun, bitis })`
  - `staffSeesRun({ staffAllowed, staffSince }, runDate)`
  - `photoAccess` personel dalı: `run.staffAllowed && run.date >= floor && (!run.staffSince || run.date >= businessDate(run.staffSince))`
- **`src/server/checklists/store.ts`:** `loadHistory(db, from, to, role, ctx)`. Şablonlar `role === "admin" || t.staffAllowed` ile süzülür; kayıtlar SQL'de `inArray(templateId, visibleIds)` ile ve `staffSince` şartıyla süzülür. `photoRun` `staffSince` döner.
- **`gecmis/page.tsx`:** `requireAdmin` yerine `requireUser`; `historyRange` kullanılır; `KontrolTabs` `role` alır; Listeler sayfaları `requireAdmin` olarak kalır.
- **`run-view.tsx`:** `audit` prop'u.
- **`/panel/kontrol/duzenle`** `ADMIN_ONLY_PATHS`'e girer (Adım 0).
- **Bugün:** `today.ts` iki rolde `loadChecklistDays([c.day, c.yesterday], user.role, now)` okur (Adım 0). Satır mantığı `rows-ops.ts` `checklistYesterday` (B).
- **Bayat yorumlar ve belgeler:**
  - `api/foto/[id]/route.ts`, `photo-access.ts` ve `kontrolPhotoRules` yorumları;
  - `docs/KONTROL-LISTELERI.md` §4, §5, §6;
  - `docs/planlar/kontrol.md` karar 13'e not;
  - `docs/BUGUN.md` (Adım 0).

**Korumalar**
- Okunan tablolarda tutar sütunu yok; yönetici listeleri SQL'de süzülür.
- Pencere sunucuda uygulanır; fotoğraf yolu aynı sabiti kullanır.
- `writeAnswer` ve `canAnswerDay` değişmez.

**İtirazlar**
- *Bugün'de sıra:* **kabul.**
- *Personeli açınca eski kayıtlar görünüyor:* **kabul,** `staff_since` tercih edildi.
- *Serbest metin:* **kabul,** pencere 7 gün ve uyarı metni.
- *Pencere uzun:* **kabul,** 7 gün.
- *"Erken dolduruldu" eşiği öğreniliyor:* **kabul,** `audit`.
- *Gürültü:* **kabul.**
- *Bugünün çıkmaz sokağı:* **kabul.**
- *Bayat belgeler:* **kabul.**
- *Ad soyadı görünür:* **ret.** Aynı adlar bugünkü formda ve kasada (Kasayı sayan) zaten görünür; pencere 7 güne indi.

**Testler**
- `tests/kontrol-listeleri.test.ts`:
  - `photoAccess` (bugün 2026-10-22: 10-16 izinli, 10-15 yasak; 05:00 sınırında 04:59 izinli, 05:00 yasak; `staffSince`);
  - `historyRange`.
- Kaynak denetimleri:
  - `gecmis` `requireUser` çağırır;
  - `duzenle` `requireAdmin` çağırır;
  - personel sekmelerinde Listeler yok;
  - `historyRange` personelde `bitis`'i yok sayar;
  - `RunView` `audit` prop'u erken rozetini gizler.
- `tests/kontrol-listeleri-db.test.ts`:
  - A (personel) ve B (yönetici) şablonları; personel yalnız A'yı görür;
  - bugün personele açılan şablonun eski kaydı görünmez;
  - pasif personel listesinin geçmişi görünür.
- `tests/kontrol-gecmis.test.ts` (B), Bugün:
  - personel 09:00, Açılış açık + `liste-dun` → sıradaki `liste-1`;
  - personel 10:30, `kasa-dun` Girilmedi + `liste-dun` → sıradaki `kasa-dun`;
  - `open: false` sorunlar sayılmaz;
  - sıra: `kasa-dun` → `liste-dun`.

---

### 2.6 Geç kasa raporu (`kasa-gec-rapor`): Grup A, onaylı, efor L

**Karar.** Personel, dünden eski ve son 14 **takvim** gününe düşen, raporu hiç girilmemiş bir günü Z fotoğrafı ve Z numarasıyla girer. Rapor ayrı tabloda "onay bekliyor" olarak durur ve onaya kadar hiçbir hesaba, e-postaya ya da devir zincirine girmez.

**Personel ekranı**
- **`/panel/kasa`, "Girilmemiş günler" kartı.** Gösterildiği günler: dünden eski, son 14 gün içinde, ilk raporun gününden sonra, raporu olmayan ve kapalı işaretli olmayan (`closedDaysIn` dışında kalan).
  - Metin: "Kafe açıktıysa Z raporunun fotoğrafıyla girin; yöneticinin onayıyla kayda geçer."
  - Gün çipleri: "14 Eki Sal", "· onay bekliyor", "· reddedildi". 4'ten fazla gün varsa 390 px'te "5 gün" diye tek çipe toplanır, dokununca açılır.
- **Fotoğraf deposu yoksa** (`photoStorage().available === false`): kart "Fotoğraf eklenemiyor; bu günü yöneticiye yazın" der, form açılmaz.
- **`/panel/kasa?gun=D`** (geç gün): bilgi notu "14 Ekim Salı · Geç rapor: yöneticinin onayıyla kayda geçer. Z raporunun fotoğrafı ve Z no zorunlu." `CashForm` `mode="late"` ile açılır:
  - Z no zorunlu; en az bir `kasa-z` fotoğrafı zorunlu;
  - zorunlu "Neden geç giriliyor?" alanı;
  - "Kasayı sayan" seçicisi gizli (sayan isteyendir; başka biri saydıysa "Neden" alanına yazılır);
  - "Teslim edilen" 0'dan büyükse zorunlu "Teslim alan" seçimi (etkin kullanıcı ya da "Banka");
  - `CashOutsCard` çizilmez; "Gün içinde kasadan çıkan" elle yazılır ve **önceden doldurulmaz** (istemciye `CashOutDTO` gitmez);
  - zayi kartı salt okunurdur: "Bu günün zayi / ikramı için Zayi & ikram › Önceki gün'den istek gönderin" (bağlantı `/panel/zayi?gun=D`);
  - e-posta satırı, WhatsApp ve karaoke yok;
  - düğme "Onaya gönder"; toast "Onaya gönderildi · 120 ₺ eksik" / "Yönetici onaylayınca kayda geçer; sonucu zilde görürsünüz."
  - Açılış önerisi, zincirde bir önceki **halkadan** gelir: önceki rapor ya da önceki bekleyen geç rapor (§Veri).
- **Gönderdikten sonra** "14 Ekim Salı kasa raporu" kartı: rozet "Onay bekliyor", özet satırlar, "Neden: …", "2 fotoğraf eklendi", "Düzenle" ("Güncelle ve gönder"; tutulan fotoğraflar yalnız önceki isteğin fotoğraflarından seçilir) ve "Geri çek".
- Başka bir personelin isteği beklerken: "Mehmet bu günü 21 Ekim'de gönderdi; yöneticinin onayını bekliyor." Kendi formu yine açılır; istek kişi başınadır.
- **Reddedilmiş istek:** uyarı bandı "Reddedildi · Mehmet: …" ve önceki isteğin değerleriyle dolu form. Fotoğraflar serbest bırakıldıktan sonra yine kişinin kendi küçük resimleridir. Aynı gün için iki ret ya da geri çekmeden sonra form yerine "Bu günü yöneticiye yazın" yazar.
- **05:00 dönüşü:** normal formdaki gönderim sunucuda `staffCanReport` dışında kalırsa sunucu `{ needsApproval: true, gate: "gec" }` döner ve form geç kipe değerleriyle geçer. Fotoğraf ve neden yine zorunludur.
- **Bugün**, personelin `kasa-dun` metni: "{dün} raporu girilmedi. Kafe açıktıysa bugün girin; kapalıysa raporun sayfasında “Kafe kapalıydı” deyin. Yarından itibaren yöneticinin onayıyla girilir."
- **Zil** (personel): "14 Ekim kasa raporu onaylandı" / "… reddedildi".

**Yönetici ekranı**
- **`/panel/onaylar` › "Kasa"**, en eski gün önce. Kart `#istek-<id>`:
  - başlık "14 Ekim Salı kasa raporu" + "Geç rapor" rozeti, alt satır "Ayşe gönderdi · 21 Ekim 10:05 · 7 gün sonra";
  - "Neden geç: …";
  - fotoğraflar; okumalar `ai_calls.result`'tan **gün = D** ile yeniden kurulur (`readingOf` deseni). Okuma yoksa: "Fotoğraf okunmadı: tarihi ve rakamları fotoğraftan kontrol edin";
  - Z no sırası, `zNoOrder`'a göre: önceki ve sonraki **halka** ile karşılaştırılır (rapor ya da bekleyen geç rapor; "onay bekliyor" etiketli);
  - `CashBreakdown`; "Teslim edilen 3.000 ₺ · Ayşe'ye göre: Mehmet'e";
  - devir zinciri iki yönde;
  - ay satırı ("Ekim'in açık gün ve POS cirosuna girer" / "… elle yazılmış; değiştirmez" / "Kapanmış ay: …");
  - "Gün içinde çıkan 400 ₺; o güne kayıtlı kasadan çıkan 0 ₺ (fişsiz)" uyarısı;
  - açık not: "Devir zincirinin tutması kanıt değildir: teslim ve çıkan bellekten yazılabilir.";
  - gün artık raporluysa: "Bu günün raporu artık var; isteği reddedin". Onay düğmeleri gizlenir.
- **Düğmeler:**
  - "Onayla ve kaydet". Teslim varsa "Bu teslimi aldım / bankada gördüm" kutusu işaretlenene kadar kapalıdır.
  - "Düzeltip onayla": kartta yönetici `CashForm`'u payload değerleriyle açılır.
  - "Reddet".
  - Aynı aralıkta daha eski bir bekleyen gün varsa onay kapalıdır: "Önce 13 Ekim'i karara bağlayın".
- **Zil:** "Geç kasa raporu onay bekliyor", gövde "14 Ekim Salı · Ayşe · Z 12.400 ₺ · 120 ₺ eksik".
- **Kasa › Günden güne:**
  - bekleyen gün: "Onay bekliyor · Ayşe girdi · İncele";
  - onaylanan geç rapor: gri "Geç girildi" rozeti ve "Ayşe 21 Ekim'de girdi · Mehmet 22 Ekim'de onayladı". Eşleşme `result_id = cash_reports.id` iledir, tarihle değil.
- **Yönetici `?gun=D` açarsa:** bant "Ayşe bu günün raporunu 21 Ekim'de onaya gönderdi. Onaylar'da bakın; burada girerseniz onun isteği kapanır."
- **"Kafe kapalıydı" düğmesi** (yönetici, raporsuz gün): §2.9. Gün personelin listesinden düşer.
- **Ay bilgisi ve `dashboard-tasks`:** gün eksik sayılmaya devam eder, yanına "(onay bekliyor)" yazar.
- **Sabah e-postası:** genel kutu (§3.7).
- **E-posta** yalnız onayda gider. Başlığa satır eklenir: "Geç rapor · Ayşe 21 Ekim'de girdi, Mehmet onayladı". Idempotency anahtarı `cash-{date}-r{rev}-gec{requestId}`.
- **İşlem geçmişi:** "Geç kasa raporu onaya gönderildi", "… geri çekildi", "… onaylandı", "… düzeltilip onaylandı", "… reddedildi".

**Veri ve eylemler**
- **Ortak tablo:** tür `kasa-gec`, `subject = "gun:<D>"`, `day = D`, `photo_ids` = istekteki fotoğraflar.
  - Payload (`LateCashPayload`, `src/lib/cash-report.ts`): `CashReportFields` (zNo zorunlu) + `{ handedTo: { kind: "user"; id; name } | { kind: "banka" } | null; photos: { id, kind }[]; cashDiff }`. Sayan isteyendir.
- **Saf yardımcılar:**
  - `LATE_REPORT_DAYS = 14`
  - `staffLateDay(date, now)`: `date <= businessDate − 2` ve `date >= businessDate − 14`
  - `zNoOrder(prev, zNo, next)`
  - `lateMissingDays(reportDates, firstDate, closedDays, pendingByDate, now)`
- **Zincir:** `src/server/cash/late-chain.ts` → `chainNeighbours(db, date)`. En yakın önceki ve sonraki halkayı döner: rapor ya da bekleyen `kasa-gec` payload'ı.
- **Fotoğraf kuralı** (`src/server/photo-read/rules.ts`):
  - `staffLateDayOpen(day, me)`: `staffLateDay` tutar, daha önce rapor var, o gün rapor yok, gün kapalı işaretli değil.
  - `canUploadPhoto`: personel, `kasa-z` ve `kasa-pos` türlerini `staffDayOpen || staffLateDayOpen` olan güne yükleyebilir.
- **Fotoğraf tutma:** `holdPhoto(tx, id)` (`src/server/storage/photos.ts`) istek beklerken `expires_at = NULL` yazar; fotoğraf bağlanmamış kalır. Her bağlama yolu `assertNotHeld(tx, photoId)` çağırır (§3).
- **Eylem dosyası** `cash-requests.ts`:
  - `requestLateCashReport(input)`:
    - `requireUser()`; personel;
    - zod (rapor girdisi + `reason` 3..300 + `zNo` + `requestVersion` + `photoIds` + `handedTo`);
    - `staffLateDay` tutmalı; teslim ≤ sayılan olmalı;
    - `pg_advisory_xact_lock(hashtext('kasa-gec:'||date))` altında: rapor varsa ret; zincir halkasına göre açılış notu kuralı (`carryCheck`, `openingNeedsNote`);
    - yeni her fotoğraf kişinin kendisinin, `kasa-z` ya da `kasa-pos` türünde ve bağlanabilir olmalı; tutulanlar önceki payload'ın alt kümesi olmalı; en az bir `kasa-z`; en çok `MAX_REPORT_PHOTOS`;
    - `holdPhoto`; düşürülen fotoğraflar `releasePhoto(RELEASED_DAYS)`;
    - `createOrUpdateRequest`.
  - `reviewCashRequest` içinde `kasa-gec` dalı:
    - `lockForReview`;
    - aralıktaki eski bekleyen gün denetimi;
    - `cash_reports` gün kilidi;
    - zincir işlem içinde yeniden hesaplanır;
    - **Onay:** payload zod ile yeniden çözülür; `cash_reports` satırı eklenir (`revision 1`, `submittedBy` = isteyen, `cashDiff` = `computeCash`);
    - **Düzeltip onayla:** isteyenin r1 kopyası `cash_report_revisions`'a yazılır, yöneticinin değerleri r2 olur;
    - fotoğraflar bağlanır (zaten bağlı olan atlanır ve kartta söylenir);
    - istek `approved`, `result_id` yazılır.
    - **Ret:** fotoğraflar `releasePhoto(DELETED_REPORT_DAYS)`.
- **Yöneticinin doğrudan `submitCashReport`'u** aynı günün bekleyen `kasa-gec` isteklerini aynı işlemde `superseded` yapar ("Yönetici günü kendisi girdi") ve fotoğrafları 30 gün tutar.
- **Yükleyiciler:**
  - `pendingLateCash()`
  - `lateRequestFor(date, me)`
  - `lateRequestsByReport(reportIds)` (`result_id` ile)
- **Belgeler:** `docs/KASA-RAPORU.md`'ye "Geç rapor (onaylı)" bölümü; `docs/FOTOGRAF.md`.

**Korumalar**
- Onaya kadar hiçbir şey değişmez: ay bilgisi, sabit gider gün sayısı, komisyon, nakit planı, zincir, Bugün, MCP, e-posta.
- İstek kişi başına gün başınadır. Aynı gün için iki ret ya da geri çekmeden sonra yeni istek açılmaz. Kişi başına en çok 5 açık `kasa-gec`.
- Yönetici kartı yalnız yöneticiye görünür. Personel başkasının sayılarını görmez.

**İtirazlar**
- (1) teslim ve çıkan bellekten yazılabilir: **kabul.**
- (2) zincir bekleyenleri bilmiyor: **kabul.**
- (3) tutulan fotoğraf kimlikleri denetlenmiyor: **kabul.**
- (4) çıkış satırı DTO sızıntısı: **kabul.**
- (5) zayi kartı: **kabul.** Bağlantı §2.8'in istek yoluna gider.
- (6) "sayan" ile suç atma: **kabul.**
- (7) asılı kalan istek: **kabul,** `superseded` (ret değil).
- (8) "Geç girildi" rozeti tarihe bağlı: **kabul.**
- (9) e-posta anahtarı çakışması: **kabul.**
- (10) "Düzeltip onayla" yok: **kabul.**
- (11) uzaktaki yönetici: **kabul.**
- (12) döngüler: **kabul.**
- (13) depo yok: **kabul.**
- (14) okuma günü: **kabul.**
- (15) kapalı günlerin gürültüsü: **kabul.** Yöneticinin "Kafe kapalıydı" düğmesi; Dalga 9'a bağlı.
- (16) takvim günü: **kabul.**
- (17) kendini onaylama: **kabul.**
- (18) 05:00: **kabul.**

**Testler**
- `tests/kasa-raporu.test.ts`:
  - `staffLateDay` (dün false, 2 gün true, 14 true, 15 false, bugün ve ileri false, 04:59 dönüşü);
  - `zNoOrder`;
  - `lateMissingDays` (kapalı gün atlanır).
- `tests/kasa-gec-rapor-db.test.ts` (`KASA_GEC_TEST_DATABASE_URL`):
  - D−5 isteği yalnız istek satırı yazar; `cash_reports` ve `tillRows` değişmez;
  - reddedilenler: Z fotoğrafı yok, Z no yok, başkasının fotoğrafı, D−15, ilk rapordan önceki gün, raporu olan gün, bayat versiyon;
  - tutulan fotoğraf alt küme değilse ret;
  - D−5 ve D−4 zinciri bekleyen halkayı kullanır;
  - D−4'ü D−5'ten önce onaylamak reddedilir;
  - onay doğru satırı yazar;
  - "Düzeltip onayla" r1 ve r2 yazar, tek e-posta gider;
  - ikinci onay reddedilir;
  - yöneticinin doğrudan girişi isteği `superseded` yapar;
  - ret fotoğrafları 30 gün tutar;
  - personel `reviewCashRequest` çağırırsa hata;
  - tutulan fotoğraf kasadan çıkan satırına bağlanamaz.
- `tests/foto-altyapi.test.ts`: geç gün için `canUploadPhoto` matrisi.
- Kaynak denetimleri:
  - geç kipte `CashOutsCard` ve `CashOutDTO` yok;
  - `emailReport` yalnız onay yolunda çağrılır;
  - `reportSchema` ve `emailReport` artık `"use server"` dosyasında değil.

---

### 2.7 Kasadan çıkan: kilitli ve eski gün, yönetici satırı, fotoğraf (`kasadan-cikan-kilitli-gun`): Grup A, onaylı, efor L

**Karar.** Kapanmış ya da eski bir güne yazılan "kasadan çıkan" kaydı beklenen nakdi düşürür ve açığı örtebilir. Yöneticinin kategorisindeki bir satır (maaş, avans) kârı değiştirir. Fotoğraf da kanıttır. Bu yüzden ekleme, düzeltme, silme ve fotoğraf kaldırma onaya bağlıdır. Fotoğrafsız bir satıra fiş eklemek yalnız kanıt eklediği için onaysızdır.

**Personel ekranı** (`/panel/kasa`, 390 px)
1. **Kilitli dün:**
   - Bilgi satırı: "Bu gün kapandı; ekleme ve düzeltme yönetici onayıyla."
   - Düğmeler "Fiş ekle" ve "Fişsiz ekle" (kısa etiketler), alt alta, tam genişlik.
   - Satırlara dokunulabilir; aynı `CashOutDialog` istek kipinde açılır: "Ekleme iste" / "Düzeltme iste", ek alan "Yöneticiye not" (200 karakter), alt bölümde "Silinmesini iste" (`footerStartOnPhone="body"`), "Vazgeç" ve "Onaya gönder".
   - Satırın fotoğrafı gizli kalır.
   - Fotoğrafsız bir `harcama` satırında ayrıca **"Fiş fotoğrafı ekle"** vardır: onaysızdır, tutar, tür ve kategori değişmez, log "Kasadan çıkan: fiş eklendi".
2. **Eski günler (D−2 … D−7):** kartın altında ghost "Eski bir güne ekle".
   - Önce 6 gün çipi seçilir, **sonra** kamera ya da form açılır; yükleme o güne yapılır.
   - Yalnız ekleme yapılır; o günün satırları gösterilmez.
3. **Açık günde yöneticinin kategorisine bağlı satır:** **her** değişiklik (tutar, metin, tür) ve silme isteğe döner.
   - Birincil düğme "Onaya gönder" olur; bilgi satırı: "Bu satır yöneticinin harcama kaydına bağlı; değişiklik ve silme yönetici onayıyla."
   - Kategori değiştirme isteği hiç açılmaz.
4. **Fotoğraf kaldırma:** yalnız kayıtlı raporun "Fotoğraflar" bölümündeki `kasa-z` ve `kasa-pos` fotoğraflarında, personelin açabildiği günlerde, ikon düğmesi "Kaldırılmasını iste".
   - `ConfirmDialog`: "Fotoğraf kaldırılsın mı?" / "Yönetici onaylarsa rapordan çıkar; fotoğraf 30 gün saklanır."
   - Okuma farkı olan fotoğrafta ya da raporun tek Z fotoğrafında düğme yoktur.
   - İstek bekleyen fotoğrafta "Kaldırma istendi" rozeti görünür.
5. **İsteklerim** kartında görünür. Zil: "Kasa isteğin onaylandı: 21 Ekim · ekleme".

**Yönetici ekranı**
- **`/panel/onaylar` › "Kasa".** Kart başlıkları: "Kasadan çıkan ekleme · 21 Ekim Salı", "… düzeltme", "… silme", "Fotoğraf kaldırma · Z raporu · 21 Ekim Salı".
  - **Ekleme:** satır ve fotoğraf; "Aylık harcamalar'a da yaz" anahtarı (`staffToExpenses` varsayılanı); kategori seçici (bütün etkin kategoriler).
  - **Düzeltme:** alan farkı ve bağlı gider kaydı. İstekten sonra satır, bağlı gider (kimlik, kategori, `updatedAt`) ya da fotoğraf değiştiyse amber "İstekten sonra değişti" uyarısı ve "Yine de uygula".
  - **Bağlam** (bütün kasa kartlarında):
    - günün kasa farkı;
    - o günün bütün satırları;
    - fiş tekrar eşleşmeleri;
    - kırmızı işaret: tutar |açık| ± 1 ₺ ise, ya da kapanmış güne `teslim` / fişsiz satır ekleniyorsa;
    - gider ayı bu ay değilse uyarı;
    - "Rapor: Gün içinde kasadan çıkan 600 ₺ · satırlar onaydan sonra 1.012,50 ₺" ve "Günü aç".
  - Onay raporu **asla** değiştirmez. Rapordaki fark kartta görünür; yönetici raporu normal yoldan düzeltir.
  - **Fotoğraf kartı:** küçük resim, okuma farkları ve neden.
- **Zil:** "{n} kasa isteği onay bekliyor".
- **İşlem geçmişi:** mevcut "Kasadan çıkan …" kayıtlarına "· Ayşe'nin isteği" eki; "Kasa isteği reddedildi"; "Fotoğraf rapordan çıkarıldı" (okuma farkıyla birlikte).

**Veri ve eylemler**
- **Ortak tablo:**
  - tür `kasa-cikan`: `subject` `cikan:<id>` ya da `cikan-yeni:<clientKey>`;
  - tür `foto-kaldir`: `subject` `foto:<photoId>`;
  - `photo_ids` istekteki fiş;
  - `expires_at` = 14 gün (süresi dolunca `expired`, personelin zilinde görünür).
- **Payload** (`src/lib/cash-out-requests.ts`):
  - `kasa-cikan`: `{ op, day, line?, cashOutId?, before? }`. `before` yalnız yöneticinin kartında okunur. Personel DTO'su yalnız `line`'dan kurulur; `before`, `categoryId`, `hadExpense` ve onayda seçilen kategori personele gitmez.
  - `foto-kaldir`: `{ photoId, photoKind, reportId, day }`.
- **Saf yardımcılar:**
  - `REQUEST_DAYS = 7`
  - `requestDayAllowed`
  - `cashOutNeedsApproval({ admin, dayOpen, rowLocked, op, adminCategory })`
  - metinler.
- **Yeniden düzenleme:** `src/server/cash-outs/write.ts` (`server-only`): `writeCashOut(tx, me, d, { author?, restoreId? })`, `removeCashOut(tx, id)`. `saveCashOut`, `deleteCashOut` ve `restoreCashOut` bugünkü gibi davranır. Personelin kilitli gündeki doğrudan çağrısı yine reddedilir; açık gündeki yönetici kategorisi kuralı yeni.
- **`persist`** (her bağlama yolu) `assertNotHeld` çağırır.
- **`src/server/photo-read/read.ts` `recentReceipts`:** yükleyen personelse `expense_entries` okunmaz; tekrar uyarısı genel olur ("Bu fiş zaten eklenmiş olabilir; yönetici bakacak"). Ayrıntılı eşleşme yönetici kartındadır.
- **`canUploadPhoto`:** personel `fis` yükleyebilir, gün `requestDayAllowed` içindeyse.
- **Eylem dosyası:** `src/server/actions/cash-out-requests.ts` (`"use server"`)
  - `requestCashOutChange` (`requireUser`, personel):
    - düzeltme ve silme yalnız `staffCanReport(row.date)` olan satırda (bugün ve dün);
    - eski günlerde yalnız ekleme;
    - kategori personel kategorisi olmalı ya da değişmemeli;
    - fotoğraf kişinin kendi `fis` fotoğrafı, bağlanmamış ve tutulmamış olmalı;
    - satır FOR UPDATE.
  - `attachCashOutReceipt({ cashOutId, photoId })` (`requireUser`):
    - satır `harcama`, fotoğrafsız ve personelin görebildiği günde olmalı;
    - `photoId` ve gerekirse `docType: "fis"` yazılır;
    - tutar, tür ve kategori değişmez.
  - `requestPhotoRemoval({ photoId, message })` (`requireUser`):
    - yalnız rapora bağlı `kasa-z` / `kasa-pos`;
    - `suspiciousDiffs` varsa ya da raporun tek Z fotoğrafıysa ret.
  - `reviewCashOutRequest({ id, seenVersion, decision, note, toExpenses?, categoryId?, force? })` (`requireAdmin`):
    - genişletilmiş çakışma denetimi;
    - `docType === "fis"` ve fotoğraf yoksa ret;
    - `writeCashOut` / `removeCashOut`, `author` = isteyen.
  - `reviewPhotoRemoval({ id, seenVersion, decision, note })` (`requireAdmin`): onayda önce okuma farkı İşlem geçmişine yazılır, sonra `cash_report_photos` bağı silinir ve `releasePhoto(DELETED_REPORT_DAYS)`. `ai_calls.result` silinmez.
- **Belgeler:** `docs/KASA-RAPORU.md`, `docs/FOTOGRAF.md`.

**Korumalar**
- Doğrudan yol değişmez; istek onaya kadar hiçbir yere yazmaz.
- Kategori listesi genişlemez.
- Pencere: bugün ile D−7 arası.
- Fiş başına tek tutma.
- Kişi başına 10 açık istek ve günde 30 oluşturma (geri çekilenler dahil; §3).

**İtirazlar**
- (1) onay anında güncellenmiş isteği görmeme: **kabul,** `version`.
- (2) düzeltme ve silme kapsamı: **kabul.**
- (3) tekrar uyarısının sızdırması: **kabul.**
- (4) tutulan fiş: **kabul.**
- (5) uzakta kaybolan kanıt: **kabul,** `NULL` tutma ve 14 günlük süre.
- (6) Z/POS kaldırma: **kabul,** daraltıldı.
- (7) onayın gerektiği yer: **kabul,** yönetici satırı.
- (8) gereksiz onay (1), kategori isteği: **kabul,** kaldırıldı.
- (9) gereksiz onay (2), fiş kaldırma: **kabul,** kaldırıldı.
- (10) fiş ekleme onaysız: **kabul.**
- (11) kendini onaylama: **kabul.**
- (12) yan değişiklikler: **kabul.**
- (13) kart bağlamı: **kabul.**
- (14) spam: **kabul.**
- (15) yarışlar: **kabul.**
- (16) 390 px: **kabul.**
- (17) "Ne için" segmenti gizli: **kabul.** Fişli yönetici satırında tür segmenti salt okunur görünür.
- (18) KVKK: **kabul.**

**Testler**
- `tests/kasa-istek.test.ts`: `cashOutNeedsApproval` matrisi, `requestDayAllowed`, metinler, payload ayıklama, personel metninde yönetici kategorisi yok.
- `tests/kasa-istek-db.test.ts`:
  - kilitli gün ekleme yalnız istek yazar;
  - fiş ikinci istekte ve `saveCashOut`'ta reddedilir;
  - onay doğru satır, gider ve bağı yazar;
  - ret fişi 7 gün tutar;
  - çakışma ve `force`;
  - fotoğrafsız fiş onayı reddedilir;
  - fotoğraf kaldırma raporu bırakır ve okuma farkını loglar;
  - okuma farkı varken istek reddedilir;
  - açık günde yönetici satırının tutarı → istek;
  - fiş ekleme onaysızdır;
  - 11. açık istek reddedilir;
  - kendini onaylama reddedilir;
  - personelin `recentReceipts` sonucunda gider satırı yok.

---

### 2.8 Geç zayi / ikram ve silme isteği (`zayi-gec-kayit`): Grup B, onaylı, efor M

**Karar.** Personel 14 güne kadar geriye zayi / ikram kaydı isteyebilir. Başkasının kaydının ya da kilitli bir günün kaydının silinmesini de isteyebilir. İkisi de onaya bağlıdır. Doğrudan yol şudur: bugün; ve dün, ancak bugünün kasa raporu girilene kadar (`staffDayEditable`). Personel hiçbir tutar görmez.

**Personel ekranı** (`/panel/zayi`)
- **Gün şeridi:** "Bugün · 24 Eki", "Dün · 23 Eki" ve "Önceki gün" seçici.
  - Seçici yerel tarih alanı **değildir**; izin verilen 13 günü listeleyen bir `select`'tir ("22 Eki Çar" … "10 Eki Cum"), 44 px yükseklikte.
  - Tek `change` olayında `router.push`.
- **Pencere dışı `?gun=`:** sessizce bugüne düşmez. "Bu gün 14 günden eski; yalnız yönetici girer" ve "Bugüne dön" bağlantısı gösterilir; form yok.
- **İstek kipi** (kilitli dün ve önceki günler):
  - kart başlığı "Geç kayıt isteği";
  - zorunlu "Yöneticiye açıklama" (3–300);
  - "Onaya gönder";
  - toast: "Onaya gönderildi: Latte M 2 adet".
- **Silme düğmesinin kipi** her satır için sunucuda hesaplanır ve prop olarak gelir; istemcide `canDelete` ya da `staffDeleteMode` çağrısı yoktur:
  - `direct` → çöp kutusu;
  - `request` → "Silinmesini iste" (44 px), zorunlu "Neden?";
  - `none` → düğme yok.
- **Silme isteği bekleyen satır:** herkese "Ayşe silinmesini istedi" rozeti görünür (yalnız ad).
- **Bekleyen kendi isteği:** listenin başında soluk satır, "Onay bekliyor" ve "Geri çek".
- **Onaylanan geç kayıt:** satırda "Geç kayıt · Mehmet onayladı 24 Eki" rozeti (`result_id` ile).
- **Zil** (personel): "Geç kayıt onaylandı: 2× Latte M (15 Eki)" ve benzerleri. Kaydın sahibine ayrıca: "Kaydın silindi: Süt 1,5 LT (15 Eki) · Ayşe istedi".
- Hiçbir yerde ₺ yok.

**Yönetici ekranı**
- **`/panel/onaylar` › "Zayi ve ikram"**, istek başına kart `#istek-<id>`.
  - **Geç kayıt:** "2× Latte M · 15 Ekim Çarşamba", neden, not, "Ayşe istedi · N gündür bekliyor"; "Malzeme maliyeti 38 ₺ (KDV hariç, bugünkü fiyatlarla)", ikramda "· menü değeri 170 ₺". Ek bilgiler:
    - "O gün aynı kalemden 1 kayıt var: 2× Latte M (Mehmet 21:40)";
    - "Aynı gün ve kalem için başka bekleyen istek var (Mehmet)";
    - ikramda "Z ödenmez X ₺ · kayıtlı ikram menü değeri Y ₺ → bu kayıtla Z ₺";
    - "O günün kasa raporu yok" / "… gönderilmiş; özetinde bu kayıt yok";
    - "Ekim sayımı girilmiş: onaylanırsa tutarlılık değişir".
  - **Silme isteği:** önce ve belirgin "Mehmet girdi · 15 Eki 21:40", sonra isteyen ve neden. Kayıt o günün kasa e-postasına girdiyse uyarı. Kayıt yoksa "Kayıt zaten silinmiş" ve tek düğme "Kapat".
  - Düğmeler: "Onayla ve ekle" / "Onayla ve sil" ve "Reddet".
- **Zil:** "3 zayi / ikram isteği onay bekliyor".
- **Zayi sayfası** (yönetici): "Bu gün için 1 istek onay bekliyor · Onaylar".
- **`/panel/tutarlilik?ay=M`:** "Bu ay için onay bekleyen N zayi / ikram isteği · Onaylar".
- **İşlem geçmişi:**
  - "Geç zayi / ikram kaydı istendi", "Zayi kaydının silinmesi istendi", "İstek geri çekildi";
  - "Geç kayıt onaylandı / reddedildi", "Silme onaylandı / reddedildi" (Ayşe istedi · not).

**Veri ve eylemler**
- **Ortak tablo:**
  - tür `zayi-gec`: `subject` `zayi-yeni:<clientKey>`, `day` = kayıt günü;
  - tür `zayi-sil`: `subject` `zayi:<entryId>`.
- **Payload** (`src/lib/waste-requests.ts`):
  - geç kayıt: `{ date, kind, productId | null, ingredientId | null, name, unit, factor, qty, reason, note }`;
  - silme: `{ entryId, entry: { date, kind, name, qty, unit, reason, note, createdBy, createdByName, createdAt } }`.
- **Saf yardımcılar:**
  - `LATE_WINDOW_DAYS = 14`
  - `staffWasteMode(date, now, lock)`: `direct` (`staffDayEditable`) | `request` (D−14 … ve kilitli dün) | `closed`
  - `staffDeleteMode(entry, me, now, lock)`
  - metinler.
- **Sunucu tarafı:** `resolveWasteTarget(db, data)` `src/server/data/waste.ts`'e taşınır.
  - `addWasteEntry` ve `deleteWasteEntry` personelde `staffWasteMode` ve `staffDeleteMode` kullanır. "o gün" hata metni "bugün ya da dün (kasa raporu girilene kadar)" olur.
  - Personelin yazımı kapalı işaretli güne düşerse `closedDayRefusal(date, role)` (A'nın modülü, §2.9) reddeder.
- **Eylem dosyası:** `src/server/actions/waste-requests.ts` (`"use server"`)
  - `requestLateWaste` (`requireUser`):
    - yönetici reddedilir;
    - mod `request` olmalı;
    - kalem aktif olmalı;
    - kişinin aynı gün + tür + kalem + miktarda bekleyen isteği varsa ret: "Aynı istek bekliyor; miktarı birleştirmek için geri çekip yeniden gönderin".
  - `requestWasteDelete({ id, message })` (`requireUser`): mod `request` olmalı.
  - `reviewWasteRequest({ id, seenVersion, decision, note })` (`requireAdmin`):
    - geç kayıt onayı: kalem kimliği var ve adı aynı olmalı; `active` aranmaz (yalnız istek anında aktif olmalıdır); kayıt `createdBy` = isteyen ile yazılır, `result_id`.
    - silme onayı: satır FOR UPDATE ile okunur ve `payload.entry` ile karşılaştırılır (`date, kind, name, qty, unit, createdBy, createdAt`). Tutmazsa ya da satır yoksa istek "Kayıt zaten silinmişti" diye kapanır, hiçbir şey silinmez.
    - **Her silmeden sonra** (doğrudan ya da onaylı) aynı `zayi:<id>` konusundaki öteki bekleyen istekler `superseded` olur ("Kayıt silindi").
- **Maliyet:** `engine.ts`'ten `model.wasteCost(w)` dışa açılır; ay özeti ve onay kartı aynı fonksiyonu kullanır.
- **Yükleyici:** `src/server/data/waste-requests.ts`. Personel yükleyicisi türleri `zayi-gec` ve `zayi-sil` ile süzer, payload'ı beyaz listeyle döner (`name, unit, qty, date, kind, reason`).
- **Belgeler:** `docs/ZAYI-IKRAM.md`'ye "Geç kayıt ve silme isteği" bölümü; dünün penceresi kuralı.

**İtirazlar**
- 1–15'in hepsi **kabul.**
- `db:reset` için bekleyen isteklerin geri çekilmesi genel olarak Adım 0'da yapılır (bütün türler).
- Günlük oluşturma tavanı §3'tür (30).

**Testler**
- `tests/zayi-istek.test.ts`:
  - `staffWasteMode` (05:00, ay sınırı, dünün kasa kilidi);
  - `staffDeleteMode`;
  - metinlerde ₺ yok;
  - kaynak: eylemlerin rolleri, personel yükleyicisinde fiyat yok ve ham payload dönmüyor.
- `tests/zayi-istek-db.test.ts` (`ZAYI_ISTEK_TEST_DATABASE_URL`):
  - istek yazmaz; onay tek kayıt yazar;
  - aynı kimliğe sonradan gelen farklı kayıt silinmez;
  - kendini onaylama reddedilir;
  - doğrudan silme isteği kapatır;
  - eşzamanlı iki onaydan tek sonuç;
  - 10 gün bekleyen istek yine onaylanır;
  - kapalı güne personel yazımı reddedilir.

---

### 2.9 Özel günler ve "Kafe kapalıydı" (`ozel-gun-ve-kapali-gun`): Grup A, karma, efor L. **Dalga 9'a bağlı.**

**Karar.** İleri tarihli özel gün onaysızdır: yalnız tahmini ve tatlı sayısını etkiler, sınırlıdır ve yönetici bilgi alır. "Kafe kapalıydı" onaylıdır, yalnız dün için verilir ve kanıta karşı denetlenir. Tek kavram vardır: Dalga 9'un `special_days` tablosunda `kind = 'kapali'` satırı.

**Personel ekranı**
- **`/panel/ozel-gunler`** ("Günlük" altında, ikon `CalendarHeart`; Bugün'ün "yoğunluk" satırı buraya bağlanır).
  - "Yaklaşan" listesi (bugün ile +60 gün). 390 px'te iki satırlı: 1. satır başlık; 2. satır "25 Eki Cmt · Derbi / maç · +%15 · Ahmet ekledi" (`min-w-0`, `break-words`). Başkasının notu görünmez.
  - Dokunulabilen satırlar: kişinin kendi girdiği, başlamamış ve yöneticinin dokunmadığı (`updated_by` boş ya da kendisi).
  - Pencere: Dalga 9'un `SpecialDayDialog`'u `mode="staff"` ile açılır; eylemler bileşene **enjekte edilir** (`saveAction`, `deleteAction` prop'ları). `kindHistory` ve gerçekleşen etki prop olarak verilmez.
  - Türler: Derbi / maç, AVM etkinliği, Kampanya, Diğer.
  - Etki: +%15 · Bilmiyorum (yalnız not) · −%15. Yönetici ±%30 yaptıysa alan salt okunur.
  - Başlangıç **yarından** itibaren, en geç +60 gün. Süre en çok **3 gün**. Kişinin gelecekte kapsadığı günler toplamı en çok **14**. Günde en çok **20** personel yazımı.
  - Hatalar: "Ad gerekli", "Bitiş başlangıçtan önce olamaz", "En çok 3 gün seçilebilir", "En çok 60 gün ileriye girilebilir", "Bu günlerde zaten bir özel gün var: {ad}", "Gelecekte en çok 14 gün işaretleyebilirsiniz", "Başlamış ya da yöneticinin düzenlediği özel gün değiştirilemez".
  - "Kapalı gün bildirimlerim" (`#bildirimlerim`, son 30 gün).
- **Kasa raporu › Dün (rapor yokken):** formun üstünde "Dün kafe kapalı mıydı?" ve ghost "Kafe kapalıydı" düğmesi.
  - Düğme görünür: personel o güne girebiliyorsa, gün dünse, o gün için bekleyen ya da reddedilmiş bildirim yoksa ve kişinin son 30 günde 3'ten az bildirimi varsa.
  - Pencere:
    - açıklama: "Yönetici onaylayınca 23 Ekim Perşembe için eksik kasa raporu ve kontrol listesi uyarıları kalkar. Kafe açıktıysa bunun yerine raporu girin.";
    - "Neden? (isteğe bağlı)" (60 karakter);
    - "Yöneticiye gönder".
  - Kanıt bulunursa hata: "O gün panelde kayıt var; kafe açık görünüyor. Raporu girin ya da yöneticiye söyleyin." (yalnız tür, tutar yok).
  - Bekleyen durumda: "Kapalıydı dediniz · onay bekliyor" ve "Geri çek". Form yerinde kalır.
- **Bugün, personelin `kasa-dun` satırı:**
  - Bekliyorsa: `todo`, rozet "Onayda", "Ahmet kapalıydı dedi (onay bekliyor). Kafe açıktıysa raporu bugün girin; yarından itibaren yöneticinin onayıyla girilir."
  - Onaylandıysa: satır yok.
  - Reddedildiyse ve gün hâlâ personele açıksa: "Yönetici bildirimi reddetti{: not}. Raporu bugün girin."
  - Pencere geçtiyse (zil): geç rapor penceresindeyse "Kafe açıktıysa raporu Z fotoğrafıyla geç rapor olarak girin; yönetici onaylar." (o güne götürür, §2.6), o da geçtiyse "Raporu yönetici girecek; Z raporunu yöneticiye iletin."
- **Zil** (personel, grup `onay`): "23 Eki Per: kapalı gün onaylandı / reddedildi / geri alındı".

**Yönetici ekranı**
- **`/panel/onaylar` › "Kasa" bölümünde "Kapalı gün" kartı.** Üst üste günler gruplanır: "3 gün üst üste kapalı bildirimi".
  - Kanıt listesi canlı hesaplanır:
    - kasa raporu; kasadan çıkan; zayi / ikram; kontrol listesi (açıldı mı);
    - karaoke (`starts_at`, iş günü penceresinde: [D 05:00, D+1 05:00));
    - **personelin İşlem geçmişi** aynı pencerede: hesap ve hatırlatıcı işlemleri hariç her yazım; silme kayıtları dahil;
    - **site:** `fetchSales` aralık çağrısından kafe, `manual` ve `counter` sipariş **sayıları** tek sorguyla, ayrı bir Suspense içinde; mağaza kolisi yalnız bilgi olarak;
    - **Z no sürekliliği** (önceki ve varsa sonraki rapor);
    - **açılış sürekliliği** ("25 Eki açılışı 23 Eki devriyle tutuyor / 600 ₺ az").
  - **Kırmızı ve onay kapalı:** kafe / manual / counter sipariş > 0, Z no arasında boşluk, ya da İşlem geçmişinde personel yazımı. Açılış farkı yalnız uyarıdır.
  - İpucu: "Onaylamadan önce o günün ModPOS / banka POS'una bakın; satış varsa reddedin."
  - Not alanı: "Not (bütün personele görünür; tutar yazmayın)".
- **Zil:** "Kapalı gün onayı bekliyor". "Dünkü kasa raporu girilmedi" zili silinmez; gövdesine "· Personel: kapalıydık dedi (onay bekliyor)" eklenir.
- **Bugün, yöneticinin `kasa-dun` ve `liste-dun` satırları:** "Onay bekliyor", eylem "Onaya bak".
- **Kasa (yönetici, raporsuz gün `?gun=`):** "Kafe kapalıydı" düğmesi, onaysız. Kanıtları pencerede uyarı olarak gösterir. Aynı gün için bekleyen istek varsa `approved` olur.
- **Satış tahmini › Özel günler:**
  - personel satırları "Ahmet ekledi" olarak işaretli;
  - yöneticinin 7 günlük nedenlerinde de "(Ahmet ekledi)";
  - onaylı kapalı gün satırı `createdBy` = **onaylayan yönetici** ile yazılır;
  - satır silinirse istek `revoked` olur ve uyarılar geri gelir.
- **Yöneticinin özel gün penceresi** ipucu: "Ad personele görünür; müşteri adı ya da tutar yazmayın."
- **Personel özel gün ekleyince ya da değiştirince** yöneticiye bilgi zili (grup `uyari`, `info`): "Ahmet özel gün ekledi: 25 Eki · Derbi · +%15".
- **Satışlar › Ay bilgisi, MCP ay cevabı, komisyon:** kapalı günler ayrı bir cümle olarak yazılır: "2 gün kapalı işaretli: 3, 4 Kasım". Komisyonun `till.missing` alanı (`src/lib/commission/report.ts`, `komisyonlar/texts.ts`) da `closedDaysIn`'den geçer; günler sessizce düşmez.
- **Sabah e-postası:** onaylı kapalı gün kontrol kutusuna girmez; bekleyen her bildirim karar verilene kadar listelenir.
- **İşlem geçmişi:** "Özel gün", "… güncellendi", "… silindi", "Kapalı gün bildirildi", "… geri çekildi", "… onaylandı", "… reddedildi", "Kapalı gün işareti kaldırıldı (kanıt geldi)".

**Veri ve eylemler**
- **Migration** (`0037`): `special_days` tablosuna `by_staff boolean not null default false`, `updated_by int → users set null`, `updated_by_name text`.
  - Dalga 9'un `saveSpecialDay`'i güncellemede `updated_by` alanını yazar.
  - Dalga 9 modeli (`src/lib/forecast/model.ts`): `coveredBy` taban hesabında `by_staff && effect === 0` satırlarını saymaz; bu satırlar yalnız nottur.
- **Ortak tablo:** tür `kapali-gun`, `subject = "gun:<D>"`, payload `{ date, reason }`, `result_id` = `special_days.id`.
- **Saf modül:** `src/lib/closed-days.ts`
  - `closedDaysIn(special, from, to, reported)`: raporu olan gün kapalı sayılmaz.
  - `staffSpecialCheck(input, ctx)`
  - `EVIDENCE_IGNORED_ACTIONS` (hesap, parola, iki adımlı, kurtarma, diğer cihazlar, hatırlatıcı, özel gün, kapalı gün).
  - `closedEvidenceText(counts)`
- **Sunucu modülü:** `src/server/closed-days.ts` (`server-only`; Adım 0'da taslak olarak açılır, B çağırır)
  - `closedDayEvidence(db, date)`
  - `closedDayRefusal(date, role)`: personel, onaylı kapalı güne kasadan çıkan ya da zayi yazamaz.
  - `onReportSaved(tx, date)`: o günü kapsayan tek günlük kapalı satırı silinir, istek `revoked` olur, yöneticiye zil gider. Çok günlük aralıkta yalnız zil: "Kapalı aralığın içindeki 3 Kas'a rapor girildi; Satış tahmini › Özel günler'den aralığı düzeltin".
  - `onNextReport(tx, report)`: D+1 raporu gelince Z boşluğu varsa D'nin kapalı işareti kaldırılır ve zil gider; açılış farkı varsa yalnız zil.
- **Eylemler:**
  - `src/server/actions/special-days-staff.ts`: `saveStaffSpecialDay` ve `deleteStaffSpecialDay`. `requireUser()`; yönetici reddedilir; sahiplik `createdBy = me`, `updated_by` boş ya da `me`, `kind ≠ 'kapali'`, gün başlamamış olmalı; `pg_advisory_xact_lock(hashtext('ozel-gun'))`. Dalga 9'un `saveSpecialDay` ve `deleteSpecialDay`'i de aynı kilidi alır.
  - `src/server/actions/closed-days.ts`:
    - `requestClosedDay({ date, reason })` (`requireUser`, personel): yalnız `addDays(businessDate(), -1)`; kanıt sıfır olmalı; aynı gün için geri çekilmemiş istek yoksa açılır.
    - `reviewClosedDay({ id, seenVersion, decision, note })` (`requireAdmin`): kanıt yeniden sayılır, kırmızı varsa ret; `special_days` satırı danışma kilidi altında yazılır.
    - `markClosedDay({ date, note })` (`requireAdmin`).
  - Geri çekme, genel `withdrawStaffRequest` ile yapılır. Kapalı gün bildirimi için kişi başına günde 1 geri çekme sınırı vardır.
- **Kasa raporu kaydı** (`writeCashReport`) `onReportSaved` ve `onNextReport` çağırır; aynı günün bekleyen `kapali-gun` isteği `superseded` olur ("Kasa raporu girildi").
- **Rotalar:** `/panel/ozel-gunler` (yönetici açarsa `/panel/tahmin#ozel-gunler`'e yönlenir).
- **Belgeler:** `docs/SATIS-TAHMINI.md`, `docs/KASA-RAPORU.md`, `docs/KOMISYON.md`.

**Korumalar**
- Personel okuyucuları yalnız `special_days` ve `staff_requests` tablolarını okur. Tahmin tutarı ve gerçekleşen etki yüklenmez.
- Personelin `/panel/ozel-gunler` prop'ları bir kaynak testiyle sabitlenir.
- Kapalı gün için kanıt silmek işe yaramaz: silme kayıtları İşlem geçmişinde kalır.

**İtirazlar**
- 1–10'un hepsi **kabul,** iki istisnayla:
  - İşlem geçmişi silme kayıtlarının tarihini yapılandırılmış yazmak yerine **pencere yaklaşımı** seçildi (D 05:00 sonrası personel yazımı). Daha basittir ve aynı işi görür.
  - "Etkisi 0 not" kuralı yalnız **personelin** girdilerine uygulanır (`by_staff`). Yöneticinin "Bilmiyorum" girdisi Dalga 9'un kararıyla günü tabandan çıkarmaya devam eder; o karar bu dalgada değişmez.

**Testler**
- `tests/kapali-gun.test.ts`: `closedDaysIn`; `tillMonths`; `cashYesterday` ve `checklistYesterday` dört durum; `staffSpecialCheck`; `EVIDENCE_IGNORED_ACTIONS`; model `by_staff && effect 0` günü tabanda tutar.
- `tests/kapali-gun-db.test.ts` (`KAPALI_TEST_DATABASE_URL`):
  - her kanıt türü (silme kaydı ve karaoke `starts_at` dahil) isteği reddeder;
  - dün dışı gün reddedilir;
  - çift istek reddedilir;
  - onay yöneticinin adıyla satır yazar;
  - kanıt sonradan gelirse onay reddedilir;
  - rapor gelince işaret kalkar;
  - Z boşluğu işareti kaldırır;
  - personel kapalı güne çıkan / zayi yazamaz;
  - yönetici düzenleyince personel kilitlenir;
  - 14 gün ve 3 gün sınırları;
  - personel kapalı satırını silemez.
- Kaynak: `/panel/ozel-gunler` prop'larında `kindHistory`, `amount` ve `realised` yok.

---

### 2.10 Personel Yardım'ı (`personel-yardim`): Grup B, onaysız, efor M

**Karar.** Ayrı bir sayfa açılır, `/panel/yardim/personel`. Yöneticinin Yardım'ının süzülmüş bir kopyası değildir; yönetici bölümleri personele hiç gönderilmez.

**Personel ekranı**
- **Girişler:** çekmece ağacının en altında "Yardım"; profil menüsünde "Yardım" (iki rolde, rolün sayfasına gider). Personelde ⌘K **yok**.
- **İçerik bir Suspense çocuğunda** çizilir; çocuk `await requireUser()` ile başlar. Yedek görünüm içeriksiz bir iskelettir. Pasif hesap içeriği göremez.
- **PageHeader:** eyebrow "Personel", başlık "Yardım", açıklama "Ekranlarınızda ne yapılır, adım adım. Soruya dokunun ya da arayın."
- **"Ne zaman ne yapılır?":** 6 adımlı `RoutineSteps`.
- **"Nasıl yapılır?":** `HelpFaq`, yalnız personel grupları. Tasarımdaki konular ve şu düzeltmeler:
  - Zayi: "kendi kaydınızı bugün ve dün (kasa raporu girilene kadar) silebilirsiniz";
  - Kasa: "Düzeltme yöneticiye eski hâliyle görünür"; "Rapor kilitliyse Düzeltme öner; yönetici yoksa ertesi günün raporunun notuna yazın";
  - Reçete: "Onaylanana kadar eski reçeteyle yapın; ürün başına bir bekleyen öneri; değiştirmek için geri çekin";
  - "Yöneticinin onayına gidenler" yanıtı `STAFF_APPROVAL_KINDS`'tan kurulur;
  - sayılar koddan gelir: `DAY_TURN_HOUR`, `CASH_EVENING_HOUR`, yeni `CASH_OUT_UNDO_MS` (`cash-out-dialog` da bunu kullanır), `STAFF_HISTORY_DAYS`, `LATE_REPORT_DAYS`.

**Yönetici ekranı**
- Yardım başlığında secondary "Personelin Yardım'ı" düğmesi.
- "Personele hesap açmak" maddesine Yardım eklenir.
- Kullanıcılar & roller satırı Adım 0'da yazılır.
- Onay, zil ve İşlem geçmişi yok.

**Veri ve eylemler**
- Migration ve eylem yok.
- Yeni dosyalar:
  - `src/app/panel/yardim/personel/page.tsx`
  - `content.tsx` (`STAFF_ROUTINE`, `STAFF_FAQ_GROUPS`, `StaffPath`)
  - `yardim/faq-build.tsx` (`textOf`, `GoLinks`, yol metni çözücüsü alan `FaqGroup` kurucusu)
- `nav-paths.ts` → `staffPathOf(href)`.
- **Yöneticinin Yardım'ı:** gövde, `await requireAdmin()` ile başlayan async bir iç bileşene taşınır. Dış Suspense yedek görünümü yalnız `PageHeader` ve iskelettir. `FAQ`, `FAQ_GROUPS`, `ROUTINE`, `FORMULAS` ve `MENU_LAYOUT` yalnız bu iç bileşende kullanılır.
- `src/app/panel/yardim` altında `layout.tsx`, `template.tsx`, `loading.tsx` ya da `error.tsx` yoktur; bir test bunu tutar.

**İtirazlar**
- 1–8 **kabul:**
  - ⌘K çıkarıldı;
  - bağlantı denetimi `?query` / `#hash` atar, `staffPathOf` boş olamaz, sayfa `requireAdmin` içermez;
  - `/panel/kontrol/duzenle` `ADMIN_ONLY_PATHS`'e girdi (Geçmiş artık personele açık);
  - metin denetimi `toLocaleLowerCase('tr-TR')` ve genişletilmiş yasak listesiyle;
  - yönetici etiketleri `NAV_GROUPS`, `NAV_FOOTER`, `NAV_TREE`, `SECTION_TABS` ve `SHORT_TITLES`'tan, büyük-küçük harfe duyarlı, tam ifadeyle; genel tek kelimeler hariç;
  - sarmalayıcı dosya testi.
- 9 **kabul.**
- Personel Yardım'ının her personel akışını belgelemesi `STAFF_APPROVAL_KINDS` ile zorlanır.

**Testler**
- `tests/yardim-personel.test.ts`:
  - erişim (`canOpen` üç durum);
  - `staffPathOf`;
  - kaynak yalıtımı;
  - bağlantılar;
  - kapsam: her `STAFF_PATHS` öğesi ve her `STAFF_APPROVAL_KINDS` etiketi geçer;
  - yasak sözcükler (tr-TR katlamalı: `maliyet|maaş|komisyon|hakediş|kâr|kârlılık|marj|ciro|kira|sgk|fatura|₺|\btl\b|lira|kuruş|\$|gelir|gider|zarar|borç|alış|birim fiyat|iban|ödeme talebi`);
  - "fiyat" yalnız "satış fiyatı" ve "paket fiyatı" olarak;
  - karaoke cevaplarında tutar yok;
  - yönetici etiketleri ve href'leri yok;
  - FAQ kimlikleri benzersiz;
  - yöneticinin sayfasında `requireAdmin` iç bileşende;
  - sarmalayıcı dosyası yok.
- `roller`, `mobile-nav`, `personel-yetkileri` ve `yardim` testlerinin güncellemeleri Adım 0'dadır (§4).

---

## 3. Ortak onay kuyruğu (bir kez kurulur; Adım 0)

### 3.1 Seçim: tek genel tablo

`recipe_change_requests` olduğu gibi kalır. Tek eklentisi `version` sütunudur (§2.3). Taşıması riskli, kazancı yok.

Bu dalganın dokuz onay türü tek bir genel tablo kullanır: `staff_requests`. Nedenleri:
- `/panel/onaylar`, zil, Bugün sayacı, sabah e-postası, "Son kararlar", sınırlar, sürüm, kendini onaylama yasağı ve süre dolması bir kez yazılır.
- Türe özel alanlar `payload` ve `result` içinde, zod ile her okumada çözülür.
- Mal siparişi taslağı da buradadır: canlılık kuralını kısmi bir dizin tutar.

`pos_marks` onay değil işaret kaydıdır, ayrı tablodur. Tükendi kaydı `integration_state`'tedir.

### 3.2 Migration `0037_personel_yetki`

`npm run db:generate -- --name personel_yetki`. Elle SQL yoktur; R2'ye göre birleştirmede yeniden üretilir.

**`staff_requests`** (Drizzle adı `staffRequests`):

| Sütun | Tür | Açıklama |
|---|---|---|
| `id` | serial pk | |
| `kind` | text not null | Drizzle enum: `kasa-duzeltme`, `kasa-silme`, `kasa-gec`, `kasa-cikan`, `foto-kaldir`, `kapali-gun`, `zayi-gec`, `zayi-sil`, `mal-taslak` |
| `subject` | text not null | `gun:<D>`, `cikan:<id>`, `cikan-yeni:<key>`, `foto:<id>`, `zayi:<id>`, `zayi-yeni:<key>`, `tedarikci:<key>` |
| `day` | text | etkilenen iş günü |
| `title` | text not null | **tutarsız**, kişisel veri taşımayan tek satır ("22 Ekim kasa düzeltmesi", "Kaldi · 5 kalem", "Latte M ×2 · 15 Eki"); zil, log, sabah e-postası ve Son kararlar bunu kullanır |
| `payload` | jsonb not null | türe göre zod |
| `message` | text | isteyenin nedeni (≤ 500) |
| `status` | text not null default `'pending'` | `pending`, `approved`, `rejected`, `withdrawn`, `superseded`, `expired`, `done`, `cancelled`, `revoked` |
| `version` | int not null default 1 | isteyen her düzenlemede artırır |
| `client_key` | text | çift dokunuşa karşı |
| `photo_ids` | integer[] not null default `'{}'` | istek beklerken tutulan fotoğraflar |
| `requested_by` | int → users, set null | |
| `requested_by_name` | text not null | |
| `review_note`, `reviewed_by` (→ users, set null), `reviewed_by_name`, `reviewed_at` | | |
| `result_id` | int | ürettiği satır (rapor, gider, zayi, sipariş, özel gün); FK yok |
| `result` | jsonb | |
| `expires_at` | timestamptz | `mal-taslak` D+2 05:00, `kasa-cikan` 14 gün; ötekiler boş |
| `bumped_at` | timestamptz not null default now() | zil kimliği; 10 dakikadan sık değişmez |
| `created_at`, `updated_at` | | |

**Dizinler:**
- `staff_requests_status_idx` (`status`, `created_at`)
- `staff_requests_requester_idx` (`requested_by`, `status`, `updated_at`)
- `staff_requests_day_idx` (`kind`, `day`)
- `staff_requests_result_idx` (`kind`, `result_id`)
- uniqueIndex `staff_requests_pending_uq` (`kind`, `subject`, `requested_by`) WHERE `status = 'pending'`
- uniqueIndex `staff_requests_live_draft_uq` (`subject`) WHERE `kind = 'mal-taslak' AND status IN ('pending','approved')`
- uniqueIndex `staff_requests_client_key_uq` (`client_key`)

**Aynı migration'da:**
- `recipe_change_requests.version int not null default 1`
- `pos_marks` (§2.2)
- `checklist_templates.staff_since` (§2.5)
- `push_subscriptions.approvals boolean not null default true`
- `special_days.by_staff`, `updated_by`, `updated_by_name` (§2.9; Dalga 9'un tablosu)

Yedek, tabloları `information_schema` üzerinden kendiliğinden alır. `migrations.test.ts` 0037'yi görür.

### 3.3 Saf kurallar: `src/lib/staff-requests.ts`

- `STAFF_REQUEST_KINDS` ve `KIND_LABEL` (yönetici: "Kasa düzeltmesi", "Kasa raporu silme", "Geç kasa raporu", "Kasadan çıkan", "Fotoğraf kaldırma", "Kapalı gün", "Geç zayi / ikram", "Zayi silme", "Mal siparişi taslağı").
- `STATUS_LABEL`.
- **`STAFF_APPROVAL_KINDS`:** personel Yardım'ının satırları, tür başına bir cümle:
  - "Kasa raporunu ertesi gün ya da kilitlendikten sonra düzeltmek"
  - "Kasa raporunu sildirmek"
  - "Unutulan eski günün kasa raporu (14 gün)"
  - "Kapanmış güne kasadan çıkan"
  - "Yanlış Z / POS fotoğrafını kaldırtmak"
  - "Dün kafe kapalıydı"
  - "Geç zayi / ikram (14 gün)"
  - "Başkasının zayi kaydını sildirmek"
  - "Mal siparişi taslağı"
  - Reçete değişikliği ve yeni ürün de listede yer alır.
- **`LIMITS`:**
  - açık istek: kişi başına tür grubu başına 10 (zayi için 20; `kasa-gec` için 5);
  - oluşturma: kişi başına iş günü başına 30, konu başına günde 3 (geri çekilen ve reddedilen dahil);
  - zil yenileme: 10 dakika.
- `reviewRefusal(row, me, seenVersion, now)`: durum, versiyon, süre, kendini onaylama.
- `nextBump(prev, now)`.
- `isExpired(row, now)`.

### 3.4 Çekirdek: `src/server/staff-requests/core.ts`

`server-only`; `"use server"` **değildir**. Fonksiyonlar `db` ya da `tx` alır, DB testleriyle sınanabilir.

- **`createOrUpdateRequest(tx, me, input)`:**
  - yönetici "Yönetici doğrudan yapar" ile reddedilir;
  - `pg_advisory_xact_lock(hashtext('personel-istek:'||me.id))`;
  - `client_key` tekrarsa var olan satırı döner;
  - kişinin aynı konudaki bekleyen satırı FOR UPDATE ile okunur ve güncellenir (`version + 1`, `bumped_at` yalnız 10 dakikadan sonra yenilenir);
  - yoksa sınırlar denetlenip yeni satır eklenir.
- **`lockForReview(tx, me, { id, seenVersion })`:** FOR UPDATE ve `reviewRefusal`. Mesajlar:
  - "Bu istek zaten karara bağlanmış; sayfayı yenileyin"
  - "İstek siz bakarken değişti; yeniden bakın"
  - "Kendi isteğinizi onaylayamazsınız"
  - "Süresi doldu"
- **`decide(tx, row, me, status, { note, resultId, result })`**
- **`withdrawOwn(db, me, id)`:** koşullu UPDATE (`status = 'pending' AND requested_by = me`) ve RETURNING. Tutulan fotoğraflar `releasePhoto(RELEASED_DAYS)` ile bırakılır.
- **`supersede(tx, { kinds, subject?, day?, exceptId? }, note)`**
- **`assertNotHeld(tx, photoId)`:** fotoğraf bekleyen bir isteğin `photo_ids` içindeyse UserError ("Bu fotoğraf onay bekleyen bir istekte").
- **`countPendingByKind(db)`**, **`recentDecisions(db, days)`**, **`ownRequests(db, userId, kinds, days)`**
- **`expireStaffRequests(db, now)`:** günlük işin yeni adımı "Personel istekleri". `expires_at` geçen `pending` ve `approved` satırları `expired` yapar ve fotoğrafları bırakır.

**Genel eylem:** `src/server/actions/staff-requests.ts` (`"use server"`), tek export `withdrawStaffRequest(id)` (`requireUser`). İstek ve karar eylemleri her alanın kendi dosyasındadır (§2).

### 3.5 `/panel/onaylar`

- **Yeniden adlandırma:** "Onaylar". Nav'da üst düzeye, "Bugün"ün altına taşınır (yalnız yönetici). `NAV_GROUPS`'ta "Günlük" grubuna geçer, anahtar kelimelerine "kasa düzeltme geç rapor zayi mal siparişi kapalı gün" eklenir. `SHORT_TITLES` "Onaylar" olur.
- **Açıklama:** "Personelin onay isteyen önerileri ve istekleri: kasa, mal siparişi, zayi ve ikram, reçete. Reddederseniz notunuz personele görünür; tutar yazmayın."
- **Sayfa:** sırasıyla, her biri kendi Suspense'i içinde, her biri `requireAdmin` ile:
  1. `<KasaRequests/>` (`onaylar/kasa-section.tsx`, A)
  2. `<OpsRequests/>` (`onaylar/ops-section.tsx`, B: mal siparişi, zayi)
  3. var olan reçete içeriği `ApprovalsContent` (`page.tsx` içinde kalır; mevcut kaynak testleri bozulmaz). Son kararlar başlığı "Reçete: son kararlar" olur.
  4. `<RecentDecisions/>` (Adım 0; `staff_requests`'in son 30 günü: tür etiketi, `title`, isteyen, karar veren, not, durum).
- **Model yükleme:** bölümler maliyet modelini `loadModelOnce` (`src/server/data/model-once.ts`, React `cache(loadModel)`) ile alır; istek başına bir kez yüklenir.
- **Çapa:** kartlar `#istek-<id>`. Reçete kartları `#oneri-` olarak kalır.

### 3.6 Bugün, zil, push

- **Bugün `onay` satırı** (Adım 0, genel):
  - başlık "Onaylar", rozet "N bekliyor";
  - açıklama "1 kasa düzeltmesi · 2 reçete değişikliği · 1 mal siparişi taslağı · en eskisi 2 gündür";
  - bağlantı `/panel/onaylar`.
  - Olgusu `approvals` genişler: `{ changes, newProducts, names, requests: { kind, count }[], oldestAt }`.
- **Zil:**
  - Yöneticide grup etiketi "Onaylar" kalır.
  - Personelde etiket "İsteklerim" olur (`notifications.tsx`). Recete sonuçları da bu grupta durur.
  - Satırları alan modülleri üretir (`bell/kasa.ts`, `bell/ops.ts`).
- **Push:**
  - yeni konu `approvals` (`sendPush` ve `PushMessage.kind`'e eklenir);
  - `setPushTopics` ve `device-alerts.tsx`'e "Onay bildirimleri" anahtarı;
  - bu dalgada yalnız mal siparişi taslağı kullanır;
  - tag `istek-<id>`.

### 3.7 Sabah e-postası, db:reset, İşlem geçmişi

- **`digest-extras.ts`:** yeni kaynak "Onay bekleyenler": "N istek onay bekliyor (en eskisi X gün): 22 Ekim kasa düzeltmesi (Mehmet), Kaldi · 5 kalem (Ayşe)…". Yalnız `title` ve ad yazar. Ayrıca `opsDigestLines` (Tükendi satırı) eklenir.
- **`scripts/seed.ts --reset`:** bekleyen bütün istekleri `withdrawn` yapar, not "Veritabanı sıfırlandı".
- **İşlem geçmişi:** eylem adları her maddede yazılıdır. Ayrıntı alanında nedenin yalnız ilk 200 karakteri tutulur (değişiklikler kesilmez).

---

## 4. Uygulama grupları

### 4.1 Düzen

1. **Adım 0, "Ortak zemin"** (A grubunun ilk işi, efor M). Wave dalına girmeden B başlamaz. Paylaşılan her dosyaya bu dalganın bütün değişikliği bir kez yazılır; B'nin katkı vereceği yerlere taslak modüller açılır.
2. Ardından **A (Kasa)** ve **B (Operasyon)** paralel çalışır; ikisi aynı dosyaya dokunmaz.
3. Birleştirme: önce A, sonra B (çakışma beklenmez), sonra doğrulama (§6) ve tek PR.

| Grup | Maddeler | İç sıra |
|---|---|---|
| A, Kasa | Adım 0, 2.3, 2.6, 2.7, 2.9 | Adım 0 → 2.3 (`report-store` yeniden düzenlemesi önce) → 2.6 → 2.7 → 2.9 |
| B, Operasyon | 2.1, 2.2, 2.4, 2.5, 2.8, 2.10 | 2.5 → 2.2 → 2.8 → 2.1 → 2.4 → 2.10 (son: bütün akışları belgeler) |

### 4.2 Adım 0'ın yazdıkları (bir kez; sonra sahibi A, B dokunmaz)

- **Şema ve migration:** §3.2.
- **Kuyruk:** `src/lib/staff-requests.ts`, `src/server/staff-requests/core.ts`, `src/server/actions/staff-requests.ts`, `src/server/data/model-once.ts`.
- **`/panel/onaylar`:** yeni ad, `RecentDecisions`, bölüm yerleri, `review-list.tsx` başlığı, `reviewRecipeChange`'e `seenVersion`.
- **`src/lib/roles.ts`, son metinler:**
  - `STAFF_PATHS`'e `/panel/ozel-gunler` ve `/panel/yardim/personel` eklenir.
  - `ADMIN_ONLY_PATHS` = `["/panel/karaoke/doluluk", "/panel/kontrol/duzenle"]`.
  - `STAFF_PATHS` yorumu düzeltilir (yalnız Listeler personeli geri gönderir).
  - `STAFF_ROLE_HINT`: "Bugün, kasa raporu ve kasadaki fiyatlar, açılış / kapanış listeleri ve son 7 günü, zayi ve ikram, stok sayımı, hızlı sayım ve sipariş taslağı, reçete defteri (öneri), karaoke, bar ekranı ve tükenen ürün, özel günler, yardım; önemli düzeltmeler yöneticinin onayıyla; maliyet, maaş ve kâr görmez".
  - `ROLE_PERMISSIONS` personel satırları:
    - "Karaoke ve bar ekranı: uygulama siparişleri, oda sayacı, rezervasyonlar, tükenen ürünü işaretleme (personel tutarları görmez)"
    - "Gün sonu kasa raporu; Z raporu ve fişler fotoğraftan, kasadan çıkanlar; ModPOS'ta değişecek satış fiyatları; ertesi gün kasa düzeltmesi, kilitli ve eski güne ekleme, 14 güne kadar geç rapor, silme ve fotoğraf kaldırma isteği (yönetici onaylar)"
    - "Açılış ve kapanış kontrol listeleri; son 7 günün geçmişi (salt okunur)"
    - "Zayi ve ikram kaydı; 14 güne kadar geç kayıt ve başkasının kaydını silme isteği (yönetici onaylar)"
    - "Haftalık hızlı sayım, gelen mal işareti ve sipariş taslağı (yönetici onaylar; fiyat yok)"
    - "Özel günler: maç, AVM etkinliği, kampanya; dünü “kafe kapalıydı” diye bildirme (yönetici onaylar)" (`paths: ["/panel/ozel-gunler"]`)
    - "Yardım: kendi ekranlarının anlatımı (yönetici bölümleri gönderilmez)" (`paths: ["/panel/yardim/personel"]`)
  - `ROLE_PERMISSIONS` yönetici satırları:
    - "Reçeteyi doğrudan düzenleme; personelin önerilerini ve isteklerini onaylama (Onaylar)"
    - "Ürün maliyeti, fiyat değiştirme ve kârlılık"
    - "Mal siparişi: fiyatlı liste, doğrudan gönderme, taslak onayı, teslim kontrolü"
    - "Kontrol listelerini düzenleme, 7 günden eski geçmiş, karaoke doluluğu"
- **`nav.ts`:**
  - Onaylar (§3.5);
  - personel öğeleri "Özel günler" (`CalendarHeart`, Günlük) ve "Yardım" (`yardim-personel`, `HelpCircle`, `roles: ["staff"]`; `NAV_FOOTER`'a girmez);
  - `SHORT_TITLES`.
- **`sidebar.tsx`:** profil menüsünde Yardım iki rolde de görünür.
- **`notifications.ts`:** aggregator olur.
  - `cashNotifications` ve `cashIntegrityNotifications` olduğu gibi `src/server/bell/kasa.ts`'e taşınır (A).
  - `posNotifications` olduğu gibi `src/server/bell/ops.ts`'e taşınır (B).
  - İki modülün `kasaBell(user)` ve `opsBell(user)` fonksiyonları iki rol dalında çağrılır. Personel dalı yalnız bugünkü kalemleri döndürür: taslaklar bugünkü davranışı korur.
- **`notifications.tsx`:** "İsteklerim" etiketi.
- **Bugün:**
  - `logic.ts`: genel `approvalsRow`; `splitTasks` kuralı (§2.5); `DayTaskKey`'e `"mal-taslak"`; `DayFacts`'e `ops?: OpsDayFacts | null` (tip `rows-ops.ts`'ten `import type`) ve `closed?: { yesterday: { state: "approved" | "pending"; by: string; requestId: number | null } | null } | null`; `CafeLine`'a `key: "tukendi"` ve isteğe bağlı `href`; `cafeLines(..., extra: CafeLine[] = [])`.
  - `posRow` ve `checklistYesterday` olduğu gibi `rows-ops.ts`'e taşınır; `draftRow` ve `soldOutLine` taslak olarak eklenir.
  - `ADMIN_ROWS` ve `STAFF_ROWS`'un son sırası: `STAFF_ROWS` = `kasa-dun`, `liste-dun`, `sayim-gecen`, `liste-*`, `hizli-sayim`, `modpos`, `mal-taslak`, `zayi`, `kasa`, `sayim-son`.
- **`today.ts`:**
  - iki rolde `loadChecklistDays([c.day, c.yesterday], …)`;
  - pos yüklemesi `opsFacts`'e taşınır;
  - `opsFacts(user, now)` (`src/server/data/today-ops.ts`, B) iki rolde çağrılır;
  - `closed` olguları A'nın `closed-days.ts` taslağından gelir.
  - `today-cafe.tsx` `href`'li satırı bağlantı olarak çizer.
- **Push:** `send.ts` `approvals` konusu; `actions/push.ts`; `device-alerts.tsx`.
- **Sabah e-postası:** `digest-extras.ts` (§3.7).
- **`scripts/seed.ts`:** §3.7.
- **Günlük iş:** `expireStaffRequests` adımı.
- **Taslak modüller (B'ye bırakılır):** `src/server/bell/ops.ts`, `src/server/data/today-ops.ts`, `src/app/panel/bugun/rows-ops.ts`, `src/app/panel/onaylar/ops-section.tsx`. B'nin çağırdığı A taslağı: `src/server/closed-days.ts` (`closedDayRefusal` taslağı `null` döner).
- **Test yardımcısı:** `tests/helpers/leak-scan.ts` (§6.2).
- **Test güncellemeleri (Adım 0'da yapılır):**
  - `bugun.test.ts`: `posPendingSummary(` `ADMIN_ONLY` listelerinden çıkar; dünün listeleri iki rolde; `onay` başlığı.
  - `roller.test.ts`: `ADMIN_ONLY_PATHS`; gecmis artık `requireAdmin` döngüsünde değil.
  - `personel-yetkileri.test.ts`, `mobile-nav.test.ts` (Onaylar; `STAFF_PATHS`'ten alt menüde olmayanlara iki yol).
  - `migrations.test.ts`.
  - `recete-onay.test.ts` / `yeni-urun-onerisi.test.ts`: başlık ve `seenVersion`.
  - `fiyatlar.test.ts` 751–755: `posNotifications` artık `bell/ops.ts` içinde; denetim taşınır, personel dalı ifadesi B'ye bırakılır.
- **Belgeler:**
  - yeni `docs/ONAYLAR.md` (kuyruk, türler, durumlar, sınırlar);
  - `docs/BUGUN.md` ve `docs/BILDIRIMLER.md`'nin bu dalga için son hâli (B'nin satırları dahil);
  - `README.md` ekran tablosu.

### 4.3 Paylaşılan dosyalar ve sahipleri

| Dosya | Sahibi (Adım 0'dan sonra) | Öteki grup nasıl katkı verir |
|---|---|---|
| `src/server/db/schema.ts`, `drizzle/*` | Adım 0; sonra kimse | Ek gerekirse A'ya söylenir (beklenmiyor) |
| `src/lib/roles.ts`, `nav.ts`, `sidebar.tsx`, `notifications.tsx` | Adım 0; sonra A | Metinler bu planda sabit |
| `src/server/actions/notifications.ts` | A | B: `src/server/bell/ops.ts` |
| `src/server/data/today.ts`, `src/app/panel/bugun/logic.ts`, `today-cafe.tsx` | A | B: `today-ops.ts`, `rows-ops.ts` |
| `src/app/panel/onaylar/page.tsx`, `review-list.tsx`, `kasa-section.tsx` | A | B: `onaylar/ops-section.tsx` |
| `src/lib/staff-requests.ts`, `src/server/staff-requests/*`, `actions/staff-requests.ts` | A | B yalnız import eder |
| `src/server/closed-days.ts` | A | B: `closedDayRefusal` çağırır (`waste.ts`) |
| `src/server/push/send.ts`, `actions/push.ts`, `device-alerts.tsx`, `digest-extras.ts`, `scripts/seed.ts`, günlük iş | A | B: `sendPush("approvals", …)` ve `opsDigestLines` |
| `src/lib/cash-report.ts`, `src/server/cash/*`, `actions/cash-report.ts`, `cash-outs.ts`, `src/server/cash-outs/*`, `src/app/panel/kasa/**` (`kasa/fiyatlar` hariç) | A | — |
| `src/server/photo-read/*`, `src/lib/photo-read/*`, `src/server/storage/photos.ts` | A | — |
| `src/lib/forecast/*`, `src/server/actions/forecast.ts`, `src/app/panel/tahmin/*` (Dalga 9), `src/lib/commission/report.ts`, `komisyonlar/texts.ts`, `src/lib/cash-month.ts`, `dataset.ts` | A | — |
| `src/app/panel/kasa/fiyatlar/**`, `src/server/actions/prices.ts`, `pos-marks.ts`, `src/server/prices/*`, `src/server/data/prices.ts`, `pos-staff.ts`, `src/lib/prices/*`, `src/app/panel/urunler/**`, `src/components/panel/pos-checklist.tsx` | B | — |
| `src/server/site-menu/*`, `src/lib/site-menu/*`, `src/server/actions/products.ts`, `src/app/panel/karaoke/**` | B | — |
| `src/server/actions/reorder.ts`, `order-drafts.ts`, `src/lib/reorder/*`, `src/server/data/reorder.ts`, `order-drafts.ts`, `src/app/panel/hizli-sayim/**`, `src/app/panel/mal-siparisi/**` | B | — |
| `src/server/actions/waste.ts`, `waste-requests.ts`, `src/server/data/waste.ts`, `src/lib/waste-requests.ts`, `src/app/panel/zayi/**`, `src/app/panel/tutarlilik/**`, `src/lib/calc/engine.ts` | B | — |
| `src/lib/checklists.ts`, `src/server/checklists/*`, `src/server/data/checklists.ts`, `src/server/storage/photo-access.ts`, `src/app/panel/kontrol/**`, `src/server/actions/checklists.ts`, `src/app/api/foto/[id]/route.ts` | B | — |
| `src/app/panel/yardim/**`, `src/components/panel/nav-paths.ts` | B | — |
| Testler | Adım 0 ve A: `bugun`, `roller`, `personel-yetkileri`, `mobile-nav`, `migrations`, `recete-onay`, `yeni-urun-onerisi`, `kasa-*`, `kapali-gun*`, `foto-altyapi`, `onay-kuyrugu*`. B: `fiyatlar`, `kasaya-isle*`, `tukendi*`, `mal-siparisi*`, `zayi-*`, `kontrol-*`, `yardim*`, `site-menu*` | |
| Belgeler | A: `ONAYLAR`, `BUGUN`, `BILDIRIMLER`, `README`, `KASA-RAPORU`, `FOTOGRAF`, `KOMISYON`, `SATIS-TAHMINI`, `planlar/KALAN-ISLER`. B: `SITE-MENU`, `SITE-SIPARIS`, `FIYATLAR`, `MAL-SIPARISI`, `ZAYI-IKRAM`, `KONTROL-LISTELERI`, `TASARIM`, `planlar/menu.md`, `planlar/kontrol.md` | |

`src/server/photo-read/rules.ts` yalnız A'dadır. 2.6 ve 2.7 `canUploadPhoto`'yu birlikte değiştirir; ikisi de A'dadır.

### 4.4 Dalga 9'a bağlılık

- **Doğrudan:** 2.9'un tamamı (`special_days`, Dalga 9'un `SpecialDayDialog`, model ve eylemleri). 2.6'nın yöneticinin "Kafe kapalıydı" ile günü listeden düşürmesi (itiraz 15).
- **Dolaylı, bütün dalga:**
  - migration numarası 0037'dir ve `special_days` sütunları aynı migration'dadır;
  - Dalga 9 ve dalga 8 düzeltme PR'ı ortak dosyalara dokunur: `logic.ts`, `today.ts`, `nav.ts`, `yardim/page.tsx`, `digest-extras.ts`, `notifications.ts`, `bugun.test.ts`.
  - Bu yüzden Adım 0 ancak iki PR `main`'e birleştikten sonra başlar.
- **Dalga 9 gecikirse:** 2.9 ve 2.6/15 ayrı bir "Dalga 10b" PR'ına ayrılır (kendi migration'ı `0038`, `special_days` sütunları orada). Öteki her şey, Adım 0 ve tek migration (`special_days` satırları olmadan) dahil, `main` üzerinde ilerler.

### 4.5 Efor

| Madde | Efor |
|---|---|
| Adım 0 | M |
| 2.3 | L |
| 2.6 | L |
| 2.7 | L |
| 2.9 | L |
| 2.1 | L |
| 2.2 | M |
| 2.4 | L |
| 2.5 | M |
| 2.8 | M |
| 2.10 | M |

### 4.6 Sahibe notlar (PR metnine ve KALAN-ISLER'e)

- **Daralan üç kural** (§0.5): sabah vardiyası dünün kasa alanlarını artık onayla değiştirir; açık günde yöneticinin kategorisindeki satır onayla değişir; düne zayi, bugünün kasa raporu girilince onaya düşer.
- **Telefonda bildirim:** "Onay bildirimleri"ni açık tutun (mal siparişi taslağı bununla gelir).
- **Tedarikçiler:** "personelden gelen siparişte onay numarası yazar" diye haber verin. Personelin gönderebilmesi için tedarikçi kartında cep numarası gerekir.
- **Kasa e-postası:** alıcılarına personel adresi yazılamaz; e-postada karaoke ön ödemesi var.
- **Açık soru, bu dalgada değil:** fişli harcamanın Aylık harcamalar'a doğrudan yazılması (§5).

---

## 5. Açılmayanlar ve nedenleri

### 5.1 Birleştirmede düşenler

| Aday | Neden açılmadı |
|---|---|
| `karaoke-gelmedi` | Yeni bir özellik; "Gelmedi" işareti yönetici dahil kimsede yok, `no_show_at` sütunu yok. Yapılırsa kararı hazır: onaysız, başlangıçtan sonraki 30 dakikada, kim ve ne zaman kaydedilir, yöneticiye bildirim gider (`doluluk.md` 1079–1081'de ayrı takip). |
| `ekip-hatirlaticilari` | Yeni bir özellik. Ortak, parasız hatırlatıcı yok; yöneticinin ortak hatırlatıcıları ödeme, vergi ve maaş taşıyor. |
| `mal-kapida-sayim` | Yeni bir özellik; kalem kalem teslim alma kimsede yok, "Geldi" siparişin tamamı için. |
| `bar-siparis-iptal-istegi` | Bu panelde açılacak bir yetki değil. İptal ve iade yalnız sitenin panelinde; buradaki onay hiçbir şey yürütemez. Asıl sorunu 2.1 çözer. |
| `parola-sifirlama-istegi` | Kullanıcı yönetimi. E-posta açıkken kendi kendine sıfırlama zaten var; onaydan sonra bağlantıyı yine yönetici iletir, yani akış aynı kalır. |
| `tahmin-personel-sayisi` | Personele açılamaz: sayı tahmini cironun kişi başı 10.000 ₺'ye bölünmesinden çıkar, ciro bandını sızdırır ve bir kadro kararıdır. Personel "Yoğun" seviyesini zaten görüyor. |
| `fis-harcama-onayi` | Açma değil daraltma ve sahibin açık kararını (CRITIQUE2 soru 5) tersine çevirir. Sahibe ayrı soru olarak sorulmalı. |
| `karaoke-sayac-silme-daralt` | Açma değil daraltma, bu dalganın konusu değil. **Ama gerçek bir açık:** personel panelden açılan sayacı onaysız siler. Önerilen sertleştirme: ilk 10 dakika serbest, sonrası silme isteği (`staff_requests`'e yeni tür). Dalga 10'dan sonra ayrı PR. 2.9'un kanıt denetimi silme kaydını İşlem geçmişinden zaten görür. |
| `adminstepup-q1-aday-degil` | Aday değil. Tek sonucu: Onayla / Reddet parola sormaz (§0.4). |

### 5.2 Sıralamada kalanlar (10 sınırı; kararı hazır, sonra açılabilir)

| Aday | Hazır karar | Neden şimdi değil |
|---|---|---|
| `tedarikci-rehberi` | Onaysız, salt okunur; yalnız ad, yetkili, telefon. IBAN, VKN, bakiye, vade ve fatura asla. | Mal gündüz gelir, akşam vardiyasına az yarar. |
| `sayima-ac-kalem` / `sayim-pasif-sayilmayan-kalem` | Sayılmayan etkin kalem onaysız (Listeye ekle kuralı); pasif kalemi açmak onaylı. | Sınır. |
| `sayim-eski-ay` / `sayim-eski-ay-duzeltme` | Onaylı, fiyatsız miktar farkı. | Seyrek gerekir. |
| `kontrol-madde-onerisi` | Onaylı; HACCP aralığı onaysız gevşetilemez. | Sınır. |
| `karaoke-ufuk` | Onaysız, 7 → 14 gün. | Müşteri adları daha uzun pencerede görünür; fayda düşük. |
| `geldi-geri-al` / `mal-geldi-geri-al` | Onaylı, kartta tutar yok. | Sınır. |
| `kasa-eposta-yeniden-gonder` | Onaysız, yalnız personelin düzeltebildiği günlere. | Sınır. |
| `mal-kalem-hedef-onerisi` | Onaylı; tedarikçi ve fiyat alanı gösterilmez. | Sınır. |
| `karaoke-doluluk-tutarsiz` | Onaysız, ayrı yükleyiciyle; gelir ve ₺ sütunları gitmez. | Fayda sınırlı. |

### 5.3 Maddelerin içinden bilerek açılmayanlar

- **Personel için:**
  - bugünün ya da ileri bir günün "Kafe kapalı" işareti (yöneticinin kararı);
  - 2 günden uzun özel gün;
  - yöneticinin özel gününü düzenlemek.
- **Kasa ve fotoğraf:**
  - fiş fotoğrafının kaldırılması (açık günde satır silinip yeniden eklenir);
  - kategori değiştirme isteği;
  - personelin kategori listesinin genişlemesi;
  - eski günün çıkış satırlarını görmek;
  - 14 günden eski kasa raporu ve zayi;
  - 7 günden eski kontrol geçmişi;
  - kilitli günde onaysız "Not ekle".
- **Mal siparişi:** taslakta "Metni kopyala"; siparişsiz fatura denetimi (sonraki iş).
- **Tükendi ve Kasaya işle:**
  - Tükendi'de push;
  - kasaya işlemede "Hepsini işaretle";
  - yöneticinin `pos_stale_price` düzeltmesi.

---

## 6. Doğrulama

### 6.1 Komutlar (her birleştirmeden önce, KALAN-ISLER §3)

- `npx next typegen && npx tsc --noEmit`
- `npx eslint . --ignore-pattern '.claude/**'`
- `npm test`
- DB testleri, her biri kendi değişkeniyle (her dosya kendi kullanıcılarını ve satırlarını açar, sonunda siler):
  - `ONAY_TEST_DATABASE_URL`: `tests/onay-kuyrugu-db.test.ts` (Adım 0)
  - `KASA_ISTEK_TEST_DATABASE_URL`
  - `KASA_GEC_TEST_DATABASE_URL`
  - `KAPALI_TEST_DATABASE_URL`
  - `POS_TEST_DATABASE_URL`
  - `TUKENDI_TEST_DATABASE_URL`
  - `TASLAK_TEST_DATABASE_URL`
  - `ZAYI_ISTEK_TEST_DATABASE_URL`
  - `KONTROL_TEST_DATABASE_URL`
- Boş veritabanında `npm run db:migrate && npm run db:seed`, ardından `npm run db:reset` (bekleyen istekler `withdrawn` olur).
- **Adım 0'ın kendi testleri:**
  - `tests/onay-kuyrugu.test.ts`: `reviewRefusal`, `nextBump`, `isExpired`, `LIMITS`; kaynak denetimleri (`core.ts` `"use server"` değil; `staff-requests.ts` actions tek export, `requireUser`; `onaylar` bölümleri `requireAdmin`).
  - `tests/onay-kuyrugu-db.test.ts`:
    - kişi başı bekleyen tekliği;
    - `client_key` tekrarı;
    - `version` yarışı;
    - kendini onaylama;
    - koşullu geri çekme ile onay yarışı;
    - sınırlar (11. açık, 31. günlük, konu başı 4.);
    - `supersede`;
    - `assertNotHeld`;
    - `expireStaffRequests`.

### 6.2 Personel sızıntı denetimi

- **Kaynak testi** `tests/helpers/leak-scan.ts`: `assertNoCostKeys(sourceOrJson)`. Yasak anahtarlar:
  `/"?(cost|unitCost|packagePrice|packPrice|expectedUnitPrice|estimate|payable|priceMinor|priceMinorL|margin|costRatio|commission|salary|maas|prepaid|karaokeAmount|invoiceAmount)"?\s*:/`.
  Her grubun personel yükleyicisi ve istemci bileşeni bu yardımcıyla taranır:
  - `tests/personel-sizinti-kasa.test.ts` (A)
  - `tests/personel-sizinti-ops.test.ts` (B)
- **Çalışan sunucuya karşı betik** `scripts/personel-sizinti.ts` (B yazar, commit edilir, CI'da koşmaz):
  - Yerel `next dev` ve bir personel hesabının çerezi verilir. Betik şu adreslerin hem HTML'ini hem `RSC: 1` yanıtını çeker: `/panel/bugun`, `/panel/karaoke`, `/panel/kasa`, `/panel/kasa?gun=<dün>`, `/panel/kasa?gun=<5 gün önce>`, `/panel/kasa/fiyatlar`, `/panel/kontrol/gecmis`, `/panel/zayi?gun=<5 gün önce>`, `/panel/hizli-sayim`, `/panel/hizli-sayim/siparis`, `/panel/ozel-gunler`, `/panel/yardim/personel`, `/panel/receteler`, `/panel/hatirlaticilarim`.
  - Her yanıtta yasak anahtarlar aranır.
  - **₺ yasağı** sayfaya göre uygulanır. Yasak olduğu yerler: karaoke, zayi, kontrol geçmişi, hızlı sayım ve taslak, özel günler, yardım.
  - **₺ serbest:** kasa sayfaları (personelin kendi yazdığı sayılar ve herkese açık satış fiyatı), Bugün (kasa farkı), reçete defteri (satış fiyatı).
  - Yönetici adresleri personel çereziyle `/panel/bugun`'a dönmelidir: `/panel/onaylar`, `/panel/urunler/fiyatlar`, `/panel/mal-siparisi`, `/panel/kontrol/duzenle`, `/panel/tahmin`, `/panel/yardim`.
  - *13 Kasım 2026 denetimi (KA-03) sonrası:* adres listeleri elle tutulmaz; `src/app/panel` altındaki sayfalar
    `src/lib/roles.ts`'in kuralıyla (canOpen) personel ve yönetici adreslerine ayrılır (kaldırılan ekran listede
    kalmaz, personel yolunun altındaki yönetici ekranları da denenir). Akış içindeki yönlendirme (HTTP 200 +
    `NEXT_REDIRECT`, ör. ay seçilmeden açılan Stok sayımı) izlenir, asıl sayfa taranır; `/api/canli` da taranır
    (COST_KEYS hiç, karaoke tutarı yalnız null). Betiğin başındaki açıklama günceldir.
- **Eylem yanıtları:** kaynak testleri her yeni personel eyleminin dönüş tipinde fiyat ya da maliyet alanı olmadığını denetler (`setSoldOut`, `markPosDone`, `undoPosMarks`, `submitOrderDraft`, `sendApprovedDraft`, `undoDraftSend`, `request*`, `withdrawStaffRequest`, `attachCashOutReceipt`, `saveStaffSpecialDay`).
- **E-posta ve push:** personele e-posta gitmez. Push metinlerinde (`approvals`) ₺ yok (kaynak testi). Kasa e-postasına personel adresi yazılamaz (DB testi).

### 6.3 Tarayıcı turları (1440 ve 390 px; yerel veritabanı ve sitenin sahte ucu)

**Personel turu:**
1. Bugün: sıra (`kasa-dun` → `liste-dun`; liste "sıradaki" değil), "Kasadaki fiyatlar", "Tükendi" satırı, "Onaylanan sipariş bekliyor".
2. Karaoke: Tükenenler (boş tek satır), pencere (yalnız kapatır), Tükendi → toast "Geri al", kartta "Satışa aç", çift dokunuş kilidi, `#tukenenler` kaydırması.
3. Kasa / fiyatlar: işaretle, toast 10 sn, "Son işaretledikleriniz" üstte, geri al.
4. Kasa: dün kilitliyken "Düzeltme öner" → "Onaya gönder" → şerit → "Öneriyi düzenle" → "Geri çek"; kilitsiz dünde Teslim değişikliği yazılanları koruyarak istek kipine geçer; "Silinmesini iste"; "Girilmemiş günler" çipleri → geç form (Z fotoğrafı yoksa gönderilemez); "Kafe kapalıydı"; kasadan çıkan istek kipi; "Eski bir güne ekle" gün çipi → kamera; "Fiş fotoğrafı ekle"; İsteklerim.
5. Zayi: "Önceki gün" seçici, istek, "Silinmesini iste", pencere dışı gün mesajı.
6. Hızlı sayım → taslak (sayfada ₺ yok) → onaya gönder → (yönetici onayı) → "WhatsApp'ta aç" (önce kayıt) → "Geri al".
7. Kontrol › Geçmiş: 7 gün, Erken rozeti yok, bugün "Listeyi aç".
8. Özel günler: ekle / düzenle / sil, sınır mesajları.
9. Yardım: çekmece ve profil menüsü, arama, yatay kaydırma yok.
10. Zil: "İsteklerim" sonuçları.

**Yönetici turu:**
1. Onaylar: bölüm sırası; her kart türü onay, ret ve çakışma.
   - kasa düzeltmesi üç sütun;
   - geç rapor "Düzeltip onayla" ve teslim kutusu;
   - kasadan çıkan bağlamı;
   - fotoğraf kaldırma;
   - kapalı gün kanıtları ve gruplanması;
   - mal siparişi satırının üç satırı, "İşaretsizleri onayla";
   - zayi maliyet satırı;
   - Son kararlar.
2. Kendi isteğini onaylama denemesi (ayrı bir test hesabıyla) reddedilir.
3. Bugün "Onaylar" satırı; kasaya işlemenin `done` satırı; zil satırları; push (`approvals`).
4. Ürün kartında "Personel tükendi yaptı"; "Kapalı tut".
5. Fiyatlar › "Son işaretlenenler" geri alma.
6. Kasa › Günden güne'de "Onay bekliyor" ve "Geç girildi".
7. Mal siparişi'nde "Taslak onayda" ve "onaylayan".
8. Satış tahmini'nde personel satırları ve kilit.
9. Sabah e-postası önizlemesi ("Onay bekleyenler", "Tükendi").
10. İşlem geçmişinde her kayıt.

Her ekranda 390 px'te çakışma ya da taşma olmadığı, alttan açılan pencerelerin klavyeyle örtülmediği gözle denetlenir. Görsel hatalar testle değil gözle yakalanır.

### 6.4 Birleştirmeden sonra

- Vercel canlı derleme günlüğünde `✓ Veritabanı şeması güncel (38 migration)` aranır (0000–0037) ve çalışma zamanı hataları kontrol edilir.
- Canlıda personel hesabıyla `/panel/kasa/fiyatlar` ve `/panel/ozel-gunler` açılır; yönetici hesabıyla `/panel/onaylar` boş durumu açılır.
- `KALAN-ISLER.md`'ye dalga 10 satırı ve "Sahibe notlar (dalga 10)" eklenir.
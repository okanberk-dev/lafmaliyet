# Fotoğraftan okuma (Z raporu, banka POS fişi, kasadan çıkan fişler)

Kasa raporunda personel Z raporunun, banka POS gün sonu fişinin ve gün içinde kasadan ödenen fişlerin fotoğrafını
çeker; Claude okur, rakamlar forma dolar. **Hiçbir şey kendiliğinden kaydedilmez:** personel bakar, gerekirse
düzeltir, **Raporu gönder** ya da **Kaydet**'e basar. Fotoğraf kanıt olarak raporla saklanır. Ekranların kullanımı
[KASA-RAPORU.md](KASA-RAPORU.md)'de; burada nasıl çalıştığı, nerede durduğu ve ne tuttuğu.

## 1. Ne okunur, nereye dolar

| Nerede | Fotoğraf | Dolan alanlar |
|--------|----------|---------------|
| Kasa raporu › Z raporu (ModPOS) | ModPOS gün sonu Z raporu | Toplam satış, nakit, kredi / banka kartı, yemek kartı, online, diğer, ödenmez / ikram, Z no, fiş sayısı |
| Kasa raporu › Kart | Banka POS cihazının gün sonu fişi | Banka POS gün sonu (net toplam; iki cihazda "Toplama ekle") |
| Kasa raporu › Gün içinde kasadan çıkanlar › Fiş ekle | Alışveriş fişi, e-Arşiv ya da fatura | Tutar (verilen nakit ya da para üstü değil, fişin toplamı), yer, ne alındığı, fiş tarihi, KDV, kategori |

Kasadan çıkan alışveriş satırı **Aylık harcamalar**'a da yazılır (kurallar KASA-RAPORU.md › Gün içinde kasadan
çıkanlar); orada fotoğraf simgesi ve **Kasadan** rozetiyle görünür, tutarı ve tarihi Kasa raporu'nda düzeltilir.

## 2. Okunan nasıl denetlenir

Model her tutarı fişte yazıldığı gibi (`text`), okuduğu sayı (`value`) ve güveniyle (`high` / `medium` / `low`) döner.
Toplamlar, denetimler ve forma eşleme bizim saf kodumuzda (`src/lib/photo-read/`):

- Yazılı metin yeniden ayrıştırılır; sayıyla tutmazsa alan güvenilmez sayılır ("Okuma tutarsız").
- **Mavi "Fotoğraftan":** net okunup dolan alan. **Turuncu:** `medium` güvenle okunan ya da bir denetime takılan
  alan (altında nedeni). `low` (tahmin) forma hiç yazılmaz: "Fotoğrafta net okunamadı (…); fişten yazın." ve
  **Fotoğraftakini yaz**. Fotoğrafta bulunamayan temel alan da turuncu: "Fotoğrafta okunamadı; fişten yazın."
- Elle yazılmış alan değişmez; farklıysa "Fotoğrafta …" ve **Fotoğraftakini yaz** önerilir.
- Z raporu: tarih raporun günü mü (gece 05:00'e kadar basılan bir önceki güne sayılır), Z no önceki rapordakinden
  büyük mü / arada atlama var mı, ödeme türlerinin toplamı Z toplamını tutuyor mu, tanınmayan ödeme satırı, ikram ve
  iade satırları, indirim.
- Banka POS: net toplam = satış − iade mi, birden çok cihaz ya da gün.
- Fiş: kartla ödenmiş mi (para kasadan çıkmamıştır), fatura / e-Arşiv mi (Aylık harcamalar'a yazılmaz), aynı fiş daha
  önce girildi mi, tarih (ileri gün ya da 7 günden eski), kalemlerin ve KDV satırlarının toplamı, KDV oranı, alışılmadık
  büyük tutar, kategori listede mi.
- **Yanlış belge:** Z bölümüne POS fişi çekilirse hiçbir alan dolmaz; **Kart bölümüne okut** aynı fotoğrafı yeniden
  okur (tersi **Z bölümüne okut**). Fiş yerine Z raporu çekilirse söylenir.
- Fotoğraftaki yazılar veridir: fişe basılmış "talimatlar" yok sayılır ve "Fişte alışılmadık yazılar var" uyarısı çıkar.

Rapor gönderilince karşılaştırma **sunucunun okuduğuna** bakar (`ai_calls.result`), formun gönderdiğine değil: net
(`high`) okunmuş ve uyarısız bir okumadaki rakamdan farklı yazılan alan **Fotoğraftan farklı** sayılır (yönetici
geçmişinde rozet, e-posta ve WhatsApp'ta satır). Soluk okumanın düzeltilmesi alarm değildir; kayıtlı raporda bütün
farklar ayrıca listelenir.

## 3. Depo ve erişim

- **Canlıda:** özel (private) Vercel Blob deposu, bölge Frankfurt (fra1). Okumak için anahtar gerekir; Blob adresi
  hiçbir yere çıkmaz. Anahtar `kasa-z/2026/10/<rastgele>.jpg` biçiminde, bir kez yazılır, üzerine yazılmaz.
- **Önizlemede** (depo bağlı değilse) fotoğraf düğmeleri hiç görünmez; her şey elle yazılır.
- **Yerelde:** `.data/photos` (`.gitignore`'da; `PHOTO_DIR` ile değişir).
- Fotoğrafın paneldeki tek adresi `/api/foto/{id}`: giriş, sonra kural, sonra baytlar (Blob'a yönlendirme yok).
  Yanıt `Cache-Control: private, max-age=3600`, `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`.
- **Kim görür:** yönetici hepsini; yükleyen kişi henüz kayda bağlanmamış kendi fotoğrafını (formdaki küçük resim);
  personel, hâlâ düzenleyebildiği günlerin (bugün ve dün) kasa raporu ve kasadan çıkan fotoğraflarını. Kalanı 403
  "Bu fotoğrafı görme yetkiniz yok."
- **Sınırlar:** en çok 2 MB; JPG, PNG ya da WebP (tür içerikten denetlenir; PDF ve HEIC değil); kenarlar 200–4096 px;
  kişi başına saatte 30 yükleme; bir fotoğraf en çok 3 kez okunur; bir rapora en çok 6 fotoğraf.
- Telefonda fotoğraf 1600 px JPEG'e (kalite 0,7) küçültülür: ~150–450 KB, EXIF (konum dahil) düşer. Soluk fişler
  okunmuyorsa önce `src/lib/photo-compress.ts` › `PHOTO_COMPRESS` (2000 / 0,8) büyütülür.

## 4. Saklama ve temizlik

| Fotoğraf | Silinir |
|----------|---------|
| Yüklenip bir kayda bağlanmayan (form bırakıldı, Kaldır) | 2 gün sonra |
| Kasa raporunun (Z, POS) | raporun gününden 180 gün (6 ay) sonra |
| Kasadan çıkan fişin | satırın gününden 400 gün (13 ay) sonra |
| Bağı kalkan (satır silindi, fotoğraf değişti) | 7 gün sonra (Geri al payı) |
| Silinen kasa raporunun | 30 gün sonra |

Geçmiş bir güne sonradan girilen rapor ya da satırın fotoğrafında süre eklendiği günden sayılır.

Süresi dolanları **sabah işi** (`/api/cron/gunluk`) siler: önce depodan, sonra kaydı; sabah başına en çok 100,
işin zaman bütçesi içinde (en çok 8 sn). **Ayarlar › Günlük işler**'de adımı "Fotoğraf temizliği": "Eski fotoğraflar
silindi", "Silinecek fotoğraf yok", "Fotoğraf deposu yok", "Fotoğraf temizliği hata" (yalnız hata işi "kısmen" yapar;
silinemeyen ertesi sabah yeniden denenir). Yönetici kayıtlı rapordaki bir fotoğrafı hemen silebilir (rapor kalır).

Tam yedek fotoğraf **dosyalarını** içermez, yalnız kayıtlarını ([YEDEK.md](YEDEK.md)).

## 5. Claude

- Model `claude-opus-5-5`, efor `low`, JSON şemalı çıktı (`output_config.format`), base64 görsel. Reddedilen okuma
  Anthropic'in önerdiği yedek modelle sunucuda yeniden denenir (`server-side-fallback-2026-07-01`,
  `fallbacks: "default"`). Deneme başına 20 sn, bir yeniden deneme, toplam en çok 45 sn; `max_tokens` 6000.
- İstemler `src/lib/photo-read/prompts.ts`, şemalar `schemas.ts` (açıklamalar modele gider, İngilizce). Yanıt zod ile
  doğrulanır; tutmazsa "Fotoğraftaki rakamlar güvenilir okunamadı. Elle yazın."
- **Kapılar:** anahtar (`ANTHROPIC_API_KEY`), Ayarlar › Fotoğraftan okuma'daki anahtar, günlük sınır (varsayılan 40;
  dolunca fotoğraf yine eklenir), fotoğraf başına 3 okuma.
- **Günlük:** her okuma `ai_calls`'a yazılır: zaman, tür, kişi, fotoğraf, durum ve hata kodu, token sayıları, tutar
  (dolar), süre, çalışan model, Anthropic'in istek kimliği ve doğrulanmış sonuç (sayılar, mağaza adı ve vergi no,
  tarih, kalemler). **Görsel ve istem hiçbir yere yazılmaz.** Anahtar hatası, kredi bitmesi ve reddedilen istek sunucu
  günlüğüne de düşer.
- **Tutar:** denemelerde okuma başına 0,017–0,031 $ (çoğu ~0,03 $); ayda ~60 kasa + ~60 fiş okuması ≈ 3–4 $.
  Ayarlar kartı bu ayın okumasını ve tutarını, bugünkü okuma / sınırı gösterir. Anthropic Console'da aylık harcama
  sınırı koymak önerilir.
- Hata metinleri (`src/server/ai/run.ts` › `aiErrorText`): zaman aşımı, bağlantı, yoğunluk ve yarım kalan okumada
  **Yeniden dene**; anahtar ve kredi hatası "yöneticiye haber verin".

## 6. Gizlilik (KVKK)

| Veri | Nereye gider | Ne kadar kalır |
|------|--------------|----------------|
| Fotoğrafın kendisi | Vercel Blob (özel depo, Frankfurt) | § 4 |
| Okuma için fotoğraf | Anthropic API (ABD), yalnız o okuma için; Anthropic'in ticari API koşulları geçerli | Anthropic'in politikasına göre |
| Okunan sonuç (rakamlar, mağaza adı ve vergi no, tarih, kalemler) | Panelin veritabanı (Neon), `ai_calls` | silinmez (maliyet ve karşılaştırma kaydı) |
| E-posta ve WhatsApp | yalnız "📷 … fotoğrafı panelde" satırı ve farklı yazılan rakam | fotoğraf ya da adresi hiç gitmez |

Fotoğrafta kasiyerin adı (Z raporu, fiş), satıcının vergi numarası (şahıs şirketinde TC kimlik no olabilir) ya da
müşteri kartı kullanıldıysa maskeli ad / telefon görünebilir. Okuma, fotoğrafın yurt dışına (Anthropic, ABD)
gönderilmesi demektir: personele söyleyin; istenmezse **Ayarlar › Fotoğraftan okuma** kapatılır (fotoğraf yine kanıt
olarak eklenir, yalnız Frankfurt'ta saklanır).

## 7. Ortam değişkenleri

| Değişken | Nerede | Ne |
|----------|--------|----|
| `ANTHROPIC_API_KEY` | Vercel, yalnız Production | Okuma. Yoksa durum "nokey": fotoğraf eklenir, okunmaz |
| `BLOB_READ_WRITE_TOKEN` | Vercel, yalnız Production | Özel Blob deposu (Storage › Blob › Private, fra1; projeye bağlayınca eklenir). Yeni bağlantı anahtar yerine `BLOB_STORE_ID` verirse o da yeter (OIDC). Vercel'de ikisi de yoksa fotoğraf düğmeleri görünmez |
| `PHOTO_DIR` | yalnız yerel | Fotoğraf klasörü (varsayılan `.data/photos`) |
| `AI_REPLAY` | yalnız `next dev` | `1`: kayıtlı yanıtlar (§ 8); canlıda hiçbir koşulda çalışmaz |

## 8. Yerel geliştirme ve deneme

- Anahtarsız: fotoğraflar `.data/photos`'a yazılır, okuma "bu ortamda kapalı".
- **Kayıtlı yanıtlarla:** `AI_REPLAY=1 npx next dev`. Okuma, canlıda alınmış beş yanıttan birini döner
  (`tests/fixtures/foto/`): tür ve fotoğrafın ölçüsüne göre seçilir; `docs/planlar/ekler/fotograf-eval/img/`'deki
  deneme görselleri (Z raporu, POS fişi, soluk market fişi, talimatlı fiş) gerçek bir okuma gibi davranır (POS fişini
  Z bölümüne çekmek yanlış belgeyi gösterir). Başka bir fotoğrafa türün olağan yanıtı döner.
- Gerçek okuma için anahtarı yalnız kabukta verin: `export ANTHROPIC_API_KEY=$(cat <anahtar dosyanız>)`. Depoya ya
  da `.env` dosyasına yazmayın, ekrana basmayın.
- **Testler** (`npm test`, ağ ve anahtar gerekmez): `tests/fotograf-okuma.test.ts` (okumaların forma gidecek hâli ve
  denetimleri, kayıtlı yanıtlarla), `tests/foto-altyapi.test.ts` (ölçü, depo sürücüleri, erişim, saklama, kaynak
  denetimleri), `tests/ai-istemci.test.ts` (isteğin biçimi, yanıt denetimi, hata kodları, tutar).
- **Canlı değerlendirme** (para harcar, isteğe bağlı): istem, şema, küçültme ayarı ya da model değişince.

```bash
python3 -m pip install pillow numpy           # bir kez
python3 scripts/foto-eval/make-images.py      # deneme görselleri → .data/foto-eval/
FOTO_EVAL=1 ANTHROPIC_API_KEY=… npx tsx scripts/foto-eval/run.ts --max 4
npx tsx scripts/foto-eval/run.ts --kayitli    # ağsız, parasız: betiğin kendisini kayıtlı yanıtlarla sınar
```

`scripts/foto-eval/cases.json` dokuz durumu ve beklenen değerlerini tutar: canlıda denenen dört görsel, POS fişinin Z
bölümüne okutulması, ödeme satırı yanlış basılmış Z, çok bulanık Z, kartla ödenmiş market fişi, e-Arşiv fatura. Betik
her durum için belge türünü, doğru / yanlış alanları, işaretleri ve uyarıları, süreyi ve tutarı, sonunda toplamı
yazar (veritabanı kullanmaz; tam çalışma ≈ 0,27 $). Lansmandan önce bir kez tam çalıştırın; yeni durum: görseli
`make-images.py`'ye, beklentiyi `cases.json`'a ekleyin.

## 9. Yeni bir fotoğraf türü

1. `src/lib/photo-rules.ts`: `PhotoKind`, `PHOTO_KINDS`, `KEEP_DAYS`, `PHOTO_KIND_LABEL`.
2. `src/server/storage/photo-access.ts` › `PHOTO_RULES`: personelin görme kuralı (`canView`) ve saklama (`keepDays`).
3. Yükleme kuralı (`src/server/photo-read/rules.ts` › `canUploadPhoto`) ya da türün kendi yolu.
4. Fotoğrafı kullanan kayıt kendi işleminde `keepPhoto(id, keepUntil(kind, gün), tx)` ile bağlar; kayıt silinince
   `releasePhoto`. Bağlanmayan fotoğraf 2 günde kendiliğinden silinir.

## 10. Dosyalar

| Dosya | İçerik |
|-------|--------|
| `src/lib/photo-rules.ts` | türler, sınırlar, ölçü (yalnız başlıktan), saklama, kim görür (ilk adımlar), yükleme hata metinleri |
| `src/lib/photo-compress.ts` | telefonda küçültme |
| `src/lib/photo-read/` | şemalar, istemler, API şeması, Z / POS / fiş okumasının kontrolü ve forma planı, "fotoğraftan farklı" |
| `src/lib/cash-outs.ts` | kasadan çıkanların adları, raporun notu, uyarı, personelin kuralları |
| `src/server/storage/` | depo sürücüleri (Blob, dosya, bellek), kayıtlar, erişim kayıt defteri |
| `src/server/ai/` | Claude: istek ve hata kodları (`run.ts`), kapılar ve günlük (`claude.ts`), tutar (`pricing.ts`), kayıtlı yanıtlar (`replay.ts`) |
| `src/server/photo-read/` | fotoğrafı okuyup forma hazırlama, ekleme kuralları |
| `src/app/api/foto/` | yükleme + okuma (`POST /api/foto`), fotoğraf (`GET /api/foto/{id}`), yeniden okuma (`POST /api/foto/{id}/oku`) |
| `src/components/panel/photo-picker.tsx`, `photo-viewer.tsx` | fotoğraf düğmeleri, durum satırı, küçük resim, büyütme |
| `src/app/panel/kasa/cash-form.tsx`, `cash-photos.tsx`, `cash-outs.tsx`, `cash-out-dialog.tsx` | ekranlar |
| `src/app/panel/ayarlar/photo-card.tsx` | Ayarlar › Fotoğraftan okuma |
| `scripts/foto-eval/` | canlı değerlendirme |

# Belge tarayıcı (`src/lib/scan/`)

Telefonda, tarayıcıda çalışan saf TypeScript belge tarayıcı: DOM'a dokunmaz, dış bağımlılığı yok, Node'da test edilir.
Görüntü `{ width, height, data: Uint8ClampedArray }` (RGBA, canvas `ImageData` ile aynı). Hepsi eşzamanlı: büyük
fotoğrafta arayüz donmasın diye bir Web Worker'da çağrılması önerilir (`ImageData.data.buffer` aktarılır).
Genel anlatım: [docs/FOTOGRAF.md](../../../docs/FOTOGRAF.md) § 11 (çekirdek) ve § 12 (kalite, yön, birleştirme).

| Dosya | Ne yapar |
| --- | --- |
| `index.ts` | çekirdeğin girişi: `scanDocument`, `detectDocument`, `refineCorners`, `cornersFromHint` … (§ 11) |
| `image.ts`, `geom.ts`, `detect.ts`, `refine.ts`, `warp.ts`, `enhance.ts` | çekirdek (algılama, köşe oturtma, açma, taranmış görünüm) |
| `metin.ts` | yazı çözümlemesi: mürekkep haritası, harf boyu, satır yönü ve ölçüleri (aşağıdaki üçü kullanır) |
| `quality.ts` | çekim kalitesi: bulanık, parlama, karanlık / soluk, kesik, küçük yazı, birden çok belge |
| `orientation.ts` | sayfa yönü: 90° / 180° / 270° döndürülmüş belge, emin değilse "bilinmiyor" |
| `stitch.ts` | uzun fiş birleştirme: ardışık parçaların örtüşmesi; emin değilse null |
| `live.ts` | canlı vizör: dörtgen yumuşatma (`QuadSmoother`), karenin ışık / netlik ölçüsü (`frameMetrics`), otomatik çekim kararı (`AutoCapture`), algılama ölçüsünün süreye göre ayarı (`nextLiveEdge`); docs/FOTOGRAF.md § 1 › Canlı vizör |

## Önerilen akış (arayüz için)

```ts
import { scanDocument, rotateQuarter, type RgbaImage } from "@/lib/scan";
import { assessQuality } from "@/lib/scan/quality";
import { detectOrientation } from "@/lib/scan/orientation";
import { stitchParts } from "@/lib/scan/stitch";

// 1. Fotoğraf çekildi: kâğıdı bul (ya da kullanıcının sürüklediği köşeler)
const first = scanDocument(img); // köşeler: first.corners (asıl pikselde)

// 2. Yön: kâğıdın içine bakarak; emin değilse döndürme (yapay zekâ okurken yönü kendisi bulur)
const o = detectOrientation(img, { corners: first.corners });
const rotate = o.rotation === "bilinmiyor" ? 0 : o.rotation;

// 3. Kalite: kâğıdın içinde; `rotation` verilince kesik kenarın adı belgeye göre ("Fişin altı kesilmiş")
const q = assessQuality(img, { corners: first.corners, noun: "rapor", rotation: rotate });
if (!q.ok) {
  // ciddi sorun: q.issues[0].text'i göster, "Yeniden çek" öner (yine de "Böyle yükle" seçeneği kalsın)
} else if (q.issues.length) {
  // hafif uyarı: metni küçük gösterip devam et
}

// 4. Taranmış görüntü (dik): döndürme açmayla birlikte yapılır
const scan = rotate ? scanDocument(img, { corners: first.corners, rotate }) : first;
// yalnız taranmış görüntü varsa: rotateQuarter(scan.image, rotate / 90)
```

Uzun Z rulosu (`kasa-okc`, en çok `MAX_OKC_PHOTOS` = 3 fotoğraf) parça parça çekildiyse, her parça 1–4. adımlardan
geçtikten sonra:

```ts
// scans: her parçanın scanDocument sonucu (taranmış ve dik), yukarıdan aşağı sırayla
const parts: RgbaImage[] = scans.map((s) => s.image);
const st = stitchParts(parts); // { image, order, matches, seams, scale, confidence, timing } | null
if (st) {
  // tek fotoğraf olarak yükle (st.seams: dikişlerin satırı; önizlemede ince çizgiyle gösterilebilir)
  // uzun çıktı yüklemede 2576 px'e küçülür: yazı küçük kalıyorsa (aşağıda) parçaları ayrı yükle
  const k = assessQuality(st.image, { noun: "rapor" });
  const tooSmall = k.issues.some((i) => i.kind === "kucuk-yazi");
} else {
  // örtüşme bulunamadı ya da emin olunamadı: parçaları ayrı fotoğraf olarak yükle
}
```

## Çekim kalitesi (`quality.ts`)

```ts
assessQuality(img: RgbaImage, opts?: {
  corners?: Quad | null;      // kâğıdın köşeleri (asıl pikselde); verilmezse bütün kare kâğıt sayılır
  noun?: "fis" | "fatura" | "rapor" | "belge"; // uyarı metnindeki ad; varsayılan "fis"
  rotation?: 0 | 90 | 180 | 270; // belgeyi dik yapan dönüş (kesik kenarın adı için)
  readEdge?: number;          // okuyucunun göreceği uzun kenar; varsayılan PHOTO_COMPRESS.maxEdge (2576)
  workEdge?: number;          // çalışma kopyası; varsayılan 1400
}): {
  ok: boolean;                // ciddi sorun yok (hafif uyarı olabilir)
  issues: { kind: QualityKind; severity: "hafif" | "ciddi"; text: string; side?: "ust" | "sag" | "alt" | "sol" }[];
  metrics: QualityMetrics;    // ölçümler (tanı için)
  timing: number;             // ms
}
// QualityKind: "bulanik" | "parlama" | "karanlik" | "dusuk-karsitlik" | "kesik" | "kucuk-yazi" | "coklu-belge"
```

Sorunlar ağırlığa (ciddi önce), sonra türe göre sıralı gelir; arayüz ilk metni göstermesi yeterli. Örnek metinler:
"Fotoğraf bulanık; telefonu sabit tutup yeniden çekin.", "Fişte parlama var; ışığı yandan alın.", "Raporun altı
kesilmiş; tamamını çekin.", "Yazı çok küçük; yaklaşıp çekin.", "Fotoğraf karanlık; ışıklı bir yerde çekin.", "Yazı
soluk seçiliyor; ışıklı bir yerde, gölgesiz çekin.", "Fotoğrafta birden çok belge var; her raporu ayrı çekin."; uzun
fişte yaklaşmak sığmıyorsa "Yazı çok küçük kalıyor; raporu üst ve alt yarı olarak iki parçada çekin."

Eşikler (dışa açık sabitler; `tests/tarama-kalite.test.ts` ile seçildi, net çekimlerde hiç uyarı çıkmaz):

| Sorun | Ölçü | hafif | ciddi |
| --- | --- | --- | --- |
| bulanık | yazı kenarı bulanıklığının (σ) harf boyuna oranı; yatay ve dikey ayrı (hareket) | > 0,15 | > 0,21 |
| karanlık | kâğıdın parlaklığı (0–255, yazının çevresinde) | < 95 | < 65 |
| soluk | yazının kâğıda karşıtlığı / gürültüye oranı | < 28 / < 5 | < 16 / < 3 |
| küçük yazı | harf boyu, okuyucunun göreceği ölçekte (px) | < 10 | < 7 |
| parlama | doymuş (≥ 249) ve çevresinden parlak leke | kâğıdın ≥ %3'ü | yazının üstünde |
| kesik | kadraj dışındaki kenara dayanan satırlar / kenarca kesilmiş harfler | — | her zaman |
| birden çok belge | dörtgenin dışında yazılı başka kâğıt | dörtgen verildiyse | dörtgen yoksa |

## Sayfa yönü (`orientation.ts`)

```ts
detectOrientation(img: RgbaImage | GrayImage, opts?: {
  corners?: Quad | null;   // verilirse yalnız kâğıda bakılır (açılmış)
  minConfidence?: number;  // altında "bilinmiyor"; varsayılan 0,5
  workEdge?: number;       // varsayılan 1400
}): {
  rotation: 0 | 90 | 180 | 270 | "bilinmiyor"; // dik yapmak için saat yönünde dönüş (rotateQuarter(img, rotation / 90))
  lineRotation: 0 | 90 | null; // satırları yataya getiren dönüş (düz / ters bilinmese de)
  guess: 0 | 90 | 180 | 270 | null; // emin olunmasa da en olası
  confidence: number;      // 0–1
  axisConfidence: number;
  flipConfidence: number;
  cues: { marks: number; markCount: number; align: number; header: number; segments: number };
  reasons: string[];
}
```

Önce satırların yönü (yatay / dikey: harf maskesinin yönlülüğü, üç ölçekte), sonra düz / ters üç ipucuyla: küçük
işaretler (taban çizgisindeki nokta ve virgül, gövdenin üstündeki İ Ö Ü Ğ noktaları), kısa satırların yaslanması
(soldan sağa yazıda sola yaslı) ve fişin ortalı başlığı (ters çevrilince sona geçer). Yazısız, simetrik ya da çok az
yazılı kâğıtta ve ipuçları çeliştiğinde "bilinmiyor": çağıran döndürmez. Testler (`tests/tarama-yon.test.ts`): fiş,
Z ve A4 her dört yönde düz taramada ve fotoğrafta (perspektif, ±3° eğiklik, bulanıklık, gölge, ~9 px harf).

## Uzun fiş birleştirme (`stitch.ts`)

```ts
stitchParts(parts: RgbaImage[], opts?: {
  minConfidence?: number; // varsayılan STITCH_MIN_CONFIDENCE (0,5)
  maxEdge?: number;       // çıktının uzun kenarı en çok; varsayılan MAX_PHOTO_EDGE (4096, photo-rules.ts)
  anyOrder?: boolean;     // verilen sıra tutmazsa öteki sıralar (en çok 3 parça); varsayılan açık
}): {
  image: RgbaImage;
  order: number[];        // birleştirilen sıra (verilen dizideki sıra numaraları)
  matches: OverlapMatch[];
  seams: number[];        // dikişlerin çıktıdaki satırları
  scale: number;          // uzun kenar sınırı aşılınca < 1
  confidence: number;
  timing: number;
} | null

findOverlap(top: RgbaImage, bottom: RgbaImage, opts?: { minConfidence?: number }): OverlapMatch | null
probeOverlap(top: RgbaImage, bottom: RgbaImage): { best: OverlapMatch | null; reasons: string[] } // tanı için
// OverlapMatch: alt parçanın (x, y) pikseli üst parçada (offsetX + scaleX·x, offsetY + scaleY·y);
// overlap, score, bandScore, margin, lines, blocks, badBlocks, blockLow, confidence, seam
```

Parçalar taranmış (açılmış), dik ve kâğıdın tam eniyle olmalı; aynı kâğıdın eni varsayıldığı için genişlikler
eşitlenir, kalan ±%6 yatay ve ±%10 dikey ölçek farkı ile genişliğin ±%8'i kadar yatay kayma tolere edilir. Örtüşme en az
genişliğin %4'ü (pratikte 3–4 satır) olmalı. Yöntem: satır profilinde dikey ölçekle birlikte normalize çapraz ilinti →
adaylar sütun profiliyle yatay kayma, koyuluk haritasında iki boyutlu ilinti ve inceltme → ince doğrulama: örtüşen bölge
satır boyunda, genişliğin sekizde biri eninde bloklara bölünür, çizgi haritası blok blok (±2 px yerel kaymayla)
karşılaştırılır. Güven = şerit ilintisi × √(başka yerle fark) × örtüşmedeki satır sayısı × tutan blok oranı.
`null` nedenleri (`probeOverlap().reasons`): `ortusme-adayi-yok`, `icerik-tutmuyor`, `baska-yer-de-tutuyor` (tekrarlayan
satırlar), `ortusmede-yazi-az`, `ayrintida-tutmuyor` (aynı şablonlu başka rapor: etiketler tutar, tutarlar tutmaz).
Testler (`tests/tarama-birlestirme.test.ts`): gölge, ışık, bulanıklık, %5–7 ölçek ve 14 px kayma farkıyla iki parça
(yer ±1,5 px), karışık sırayla üç parça, başka günün Z'si, market fişi, aradaki boşluk, yazısız örtüşme ve
tekrarlayan satırlar.

## Çekirdeğe taşınabilecek yardımcılar

`metin.ts` (mürekkep haritası, harf boyu, satır yönü) çekirdeğin `enhance.ts` eğiklik ölçümüyle ortak iş yapar;
`quality.ts` › `cropRgba`, `orientation.ts` › `rotateMask` / `dilateRect`, `stitch.ts` › `cropRows` küçük görüntü
yardımcılarıdır (`image.ts`'e taşınabilir). `orientation.ts`'teki `QuarterTurn` `index.ts`'tekiyle aynıdır.

# AkmanOS bileşenleri

Bu klasördeki dosyalar [AkmanOS](https://akmanos.com) (GFA Studio, https://gkhn.dev) kütüphanesinin
"Copy markdown" dışa aktarımından (`https://akmanos.com/api/markdown/<id>`) alındı. Kaynak kod olduğu gibi
duruyor; yalnızca içe aktarma yolları `@/components/akmanos/...` altına taşındı, `branding/` ve `lib/brand.ts`
L'Affogato için yazıldı. Panel bu bileşenleri `src/components/panel/*` ve `src/components/ui/*` üzerinden kullanır.

Uyarlama: AkmanOS'un `--surface` (#f4f4f5) belirteci paneldeki `surface` (beyaz) ile çakıştığı için bu klasörde `bg-surface` → `bg-chart-bg` yapıldı (aynı renk).
- `notification-dropdown` ve `profile-dropdown` içindeki metinler Türkçeleştirildi; bildirimlere `danger`, `warning`, `info` türleri eklendi. `empty-state` içindeki `RecordsStackIllustration` dışa açıldı.
- `charts/animated-number.tsx`: sayaç 0 yerine gerçek değerle başlar (sunucu HTML'i ve ilk kare doğru rakamı gösterir); yalnızca değer değişince sayar.

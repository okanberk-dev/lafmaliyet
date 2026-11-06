# Arc bileşenleri

Bu klasördeki grafikler [Arc UI](https://uiarc.dev) kütüphanesinin **ücretsiz** kayıtlarından
(`https://uiarc.dev/r/<ad>.json`, belirteçsiz) elle kuruldu; `shadcn init` çalıştırılmadı, `components.json` yok.
Kurulan kayıtlar: `arc-motion-tokens`, `line-chart`, `bar-chart`, `sparkline`. Pro kayıt yok.

Kaynak olduğu gibi duruyor (CSS modülleri, `motion/react`; yeni npm paketi gerekmedi). Uyarlamalar:

- `foundation.css` Arc'ın `arc-foundation` dosyası değil, onun panele yazılmış hâli: belirteçler `:root` yerine `.arc`
  sınıfında ve AkmanOS açık temasının değerleriyle (docs/TASARIM.md §1). Panel düzeni (`src/app/panel/layout.tsx`)
  içe aktarır.
- Ekranda görünen ve ekran okuyucunun okuduğu İngilizce metinler Türkçeleştirildi, sayı biçimi `tr-TR`.
- `bar-chart.module.css`: eksen etiketlerinin sütunu 52 → 76 px ("Ort. 15.873" gibi Türkçe tutar sığsın).
- Sayfalar bu dosyaları doğrudan değil `src/components/panel/arc-charts.tsx` (istemci sarmalayıcıları: biçimleyici,
  renk, `.arc` kabı) üzerinden kullanır.

Klasör ESLint dışında (olduğu gibi alınmış kaynak), TypeScript denetiminden geçer.

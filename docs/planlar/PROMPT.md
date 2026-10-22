L'Affogato maliyet paneli (GitHub: RiosenBeq/lafmaliyet; canlı: ladmin.laffogato.net; Next.js 16 + Drizzle/Postgres
+ Vercel) üzerinde kalan işleri tamamlamanı istiyorum. İş başka bir hesapta başladı; tüm planlar ve durum depoda.

0. Erişim: Bu hesabın GitHub'da RiosenBeq/lafmaliyet deposuna okuma-yazma erişimi olmalı (yoksa bana söyle, GitHub
   bağlantısını ekleyeyim). Vercel bağlayıcın varsa (proje: lafmaliyet) derleme günlüklerini ve çalışma zamanı
   hatalarını oradan kontrol et; yoksa bana sor. Depoya erişemezsen bu mesaja eklediğim LAFFOGATO-DEVIR.md dosyası
   aynı içeriği taşır, ama kodu ancak depodan yazabilirsin.

1. `claude/kalan-isler` dalından başla (main'e birleştiyse main'den). Sırayla oku:
   `AGENTS.md` → `docs/planlar/KALAN-ISLER.md` (durum, sıra, kurallar, altyapı, açık sorular) →
   `docs/planlar/DIGER-OTURUM.md` (bu depoda paralel çalışan başka bir oturum var; sahiplik ve çakışma kuralları) →
   ilgili planlar (`docs/planlar/*.md`; birinci paketin kuralları ve sırası `CRITIQUE.md`, ikinci paketin ortak bilgisi
   `BRIEF2.md`).

2. Yarım kalan iki iş `docs/planlar/wip/` altında yama olarak duruyor (opsbackup, vkn). `git am` ile uygula,
   gözden geçir, tamamla.

3. Sırayla yap:
   - Birinci paketin kalanı: ops-backup, vkn (çekirdek), pricing, kasa, insight + kdv eki, menu, today.
   - İkinci paketten önce `haftalik.md` planını, sonra ikinci paketin tamamı için `CRITIQUE2.md` çapraz
     eleştirisini yaz (KALAN-ISLER.md §2 ve DIGER-OTURUM.md'deki çakışma noktalarını dahil et; kafe Tuzla'da,
     Opera AVM'de, MaviBahçe/İzmir değil).
   - İkinci paket: kontrol, komisyon, fotograf, siparis (Mal siparişi), mcp, tahmin, doluluk, en son haftalik.
   - ModPOS günlük dökümünü şimdi yazma; örnek dosya gelince yapılacak.

4. Çalışma şekli:
   - Her grubu ayrı git worktree'de, kendi yerel veritabanı (laffogato_<grup>) ve dev sunucusuyla uygula; sonra
     bağımsız inceleme yaptır, bulguları düzelt, entegrasyon dalına birleştir. Paralel ajan / workflow kullanabilirsin
     (izin veriyorum); aynı anda en çok 2 uygulayıcı.
   - Her dalgadan ve her PR'dan önce `git fetch` + `origin/main`'i birleştir (diğer oturum sık birleştiriyor).
     Migration'ları birleştirme anında yeniden üret (R2), bir seferde bir migration birleştir.
   - Diğer oturumun alanındaki dosyalara (site-* modülleri, bar ekranı siparişleri, SITE-*.md) yalnız küçük ve
     eklemeli değişiklik yap, PR'da listele; laffogato deposuna ve `claude/brave-cannon-ctlv3a` dalına dokunma.
     Site tarafında gereken değişikliği bana yaz.
   - Her dalgadan sonra: `npx next typegen && npx tsc --noEmit`, `npx eslint . --ignore-pattern '.claude/**'`,
     `npm test`, boş veritabanında `npm run db:migrate && npm run db:seed`, dokunulan ekranlarda tarayıcıda 1440 ve
     390 px. Sonra main'e PR aç. **main'e doğrudan push etme; PR'ı ben birleştiririm.** Birleşince canlı derleme
     günlüğünde "✓ Veritabanı şeması güncel (N migration)" satırını ve çalışma zamanı hatalarını kontrol et.
   - Arayüz Türkçe, sade ve kısa. Depo prettier ile biçimlenmez; var olan dosyalarda prettier çalıştırma.
   - `ANTHROPIC_API_KEY` Vercel'de (yalnız Production) var; yerel deneme için gerekirse benden iste, asla commit etme.
     fotograf ve kontrol yayına girmeden önce Vercel'de private bir Blob store oluşturup projeye bağla (ya da bana
     adımları söyle).
   - Açık sorularda KALAN-ISLER.md §5'teki varsayılanları uygula. Her dalga sonunda bana kısa bir Türkçe özet ver.

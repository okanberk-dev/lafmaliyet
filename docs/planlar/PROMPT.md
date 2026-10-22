L'Affogato maliyet paneli (depo: RiosenBeq/lafmaliyet) üzerinde kalan işleri tamamlamanı istiyorum.

Başlangıç:
1. `claude/kalan-isler` dalını al (bu dal main'e birleştiyse main'den başla). Önce `AGENTS.md`'yi, sonra
   `docs/planlar/KALAN-ISLER.md`'yi baştan sona oku; durum, sıra, kurallar, altyapı ve açık sorular orada.
   Planlar `docs/planlar/` içinde; birinci paketin kuralları ve birleştirme sırası `CRITIQUE.md`'de, ikinci paketin
   ortak bilgisi `BRIEF2.md`'de.
2. Yarım kalan iki iş `docs/planlar/wip/` altında yama olarak duruyor (opsbackup, vkn). Kaldığı yerden devam et:
   yamaları `git am` ile uygula, gözden geçir, tamamla.

Yapılacaklar (sırayla):
- Birinci paketin kalanı: ops-backup, vkn (çekirdek), pricing, kasa, insight + kdv eki, menu, today.
- İkinci paketten önce: `haftalik.md` planını yaz, sonra tüm ikinci paket planları için `CRITIQUE2.md`
  çapraz eleştirisini yaz (KALAN-ISLER.md §2'deki maddeler ve kafe konumu düzeltmesi: Tuzla, Opera AVM).
- İkinci paket: kontrol, komisyon, fotograf, siparis, mcp, tahmin, doluluk, en son haftalik.
- ModPOS günlük dökümünü şimdi yazma; örnek dosya gelince yapılacak.

Çalışma şekli:
- Her grubu ayrı git worktree'de, kendi yerel veritabanı (laffogato_<grup>) ve dev sunucusuyla uygula; sonra
  bağımsız bir inceleme yaptır, bulguları düzelt, entegrasyon dalına birleştir. Paralel ajan / workflow
  kullanabilirsin (izin veriyorum); makine 4 çekirdekli, aynı anda en çok 2 uygulayıcı çalıştır.
- Migration'ları birleştirme anında yeniden üret (R2), bir seferde bir migration birleştir.
- Her dalgadan sonra tsc, eslint (`--ignore-pattern '.claude/**'`), `npm test`, boş veritabanında migrate+seed ve
  dokunulan ekranlarda tarayıcıda 1440 ve 390 px kontrolü yap; sonra main'e PR aç. **main'e doğrudan push etme;**
  PR'ı ben birleştiririm. Birleşince Vercel canlı derleme günlüğünü ve çalışma zamanı hatalarını kontrol et.
- Arayüz Türkçe, sade ve kısa. Depo prettier ile biçimlenmez; var olan dosyalarda prettier çalıştırma.
- `ANTHROPIC_API_KEY` Vercel'de (yalnız Production) var; yerel deneme için gerekirse benden iste, asla commit etme.
  fotograf ve kontrol yayına girmeden önce Vercel'de private bir Blob store oluşturup projeye bağla.
- Açık sorularda KALAN-ISLER.md §5'teki varsayılanları uygula; her dalga sonunda bana kısa bir Türkçe özet ver.

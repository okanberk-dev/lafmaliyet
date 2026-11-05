---
description: Design Lab oturumunun geçici dosyalarını (.claude-design/, src/app/design-lab/, src/app/design-preview/) kaldırır
---

# Design Lab temizliği

Bir design-lab oturumundan geride kalan geçici dosyaları kaldır.

Silinebilecekler (yalnızca bunlar):

1. `.claude-design/` (tasarım özeti, çalışma günlüğü)
2. `src/app/design-lab/` (karşılaştırma sayfası, varyantlar, FeedbackOverlay)
3. `src/app/design-preview/` (son önizleme)
4. Depo kökünde ya da bir alt düzeyde `feedback-*.json` geri bildirim yedekleri

Adımlar:

1. Yukarıdaki yolların hangilerinin var olduğunu bul ve içeriklerini listele.
2. Silmeden önce kullanıcıya listeyi gösterip onay iste.
3. Onaylananları sil; `git status` ile bu yolların izlenmediğini ve başka dosyaya dokunulmadığını doğrula.
4. Neyin silindiğini raporla.

Güvenlik kuralları:
- Bu listenin dışında hiçbir dosyayı silme; kullanıcının yazdığı dosyalara dokunma.
- `docs/planlar/*-tasarim-plani.md` ve `docs/TASARIM.md` kalıcı çıktılardır, silinmez.

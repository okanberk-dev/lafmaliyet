import { config } from "zod/v4/core";

import { installClientErrorReporter } from "@/lib/client-error-report";

/*
 * Tarayıcıda uygulama kodundan (ve React'in canlanmasından) önce bir kez çalışır (Next: instrumentation-client).
 *
 * zod 4 nesne şemalarını hızlandırmak için ilk ayrıştırmada `Function("")` ile eval'e izin olup olmadığını dener. Panelin
 * CSP'sinde `'unsafe-eval'` yok (src/lib/csp.ts): deneme her sayfada bir ihlal ürettirirdi (Report-Only'de `[csp] report
 * script-src eval` günlüğü doldururdu, uygulanınca konsolda hata). `jitless`: zod derlemeden doğrular, deneme hiç
 * yapılmaz; sonuç aynı, fark yalnız hız (panelin formlarında hissedilmez). Sunucuda CSP yok, orada değişen bir şey yok.
 * docs/DEPLOY.md › Güvenlik başlıkları
 */
config({ jitless: true });

/*
 * Panelde yakalanmayan tarayıcı hataları ve sözler hata kaydına gider (docs/HATA-KAYDI.md; src/lib/client-error-report.ts):
 * yalnız /panel'de, sayfa başına en çok 5, bağlantı kopması ve eklenti hataları hariç. Gönderim hata üretmez.
 */
installClientErrorReporter();

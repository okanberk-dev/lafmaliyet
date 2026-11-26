import { config } from "zod/v4/core";

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

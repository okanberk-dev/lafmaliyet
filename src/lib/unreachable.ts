/**
 * Tam `switch`in sonu: yeni bir dal (ör. ödeme kaleminin yeni kaynağı) eklenip ele alınmazsa derleme burada durur.
 * Çalışma anında gelmesi beklenmez; gelirse değerle birlikte hata fırlatır.
 */
export function unreachable(x: never): never {
  throw new Error(`Beklenmeyen değer: ${JSON.stringify(x)}`);
}

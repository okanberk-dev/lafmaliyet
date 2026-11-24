/**
 * Asistanın sunucu günlüğüne giden hata: yalnız adı ve kodu (ör. "Error", "PostgresError 23505"). İleti yazılmaz:
 * sorgu hatasının iletisi "params:" ile modelin girdisini (aranan ad, tarih, not) taşır; sorunun ve yanıtın metni
 * günlüğe düşmesin (docs/ASISTAN.md › Kayıt). Kod hem hatanın kendisinden hem `cause`'tan okunur (drizzle sarar).
 */
export function errorTag(e: unknown): string {
  if (!(e instanceof Error)) return typeof e;
  const code = (x: unknown) => (x && typeof x === "object" && "code" in x && typeof x.code === "string" && /^[\w.-]{1,40}$/.test(x.code) ? x.code : null);
  const cause = (e as { cause?: unknown }).cause;
  return [e.name, code(e), cause instanceof Error && cause.name !== e.name ? cause.name : null, code(cause)].filter(Boolean).join(" ");
}

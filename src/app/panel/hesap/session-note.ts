/*
 * Hesabım'da oturum sürümünü artıran işlemlerin uyarısı (parola değiştirme, iki adımlı doğrulamayı açma ve kapatma,
 * diğer cihazlardaki oturumları kapatma): öteki cihazların oturumları kapanır, yöneticinin Claude bağlantısı da düşer
 * (bağlantı oturum sürümüne bağlı; docs/CLAUDE-BAGLANTISI.md). Ekran bunu işlemden önce söyler (denetim YO-08). Saf modül.
 */

export const CLAUDE_NOTE = "Claude bağlantınız da kapanır; Claude'da yeniden bağlanmanız gerekir.";

/** `when`: cümlenin başı ("Açılınca"); `claude`: kişinin etkin bir Claude bağlantısı var (yalnız yönetici) */
export function sessionsNote(claude: boolean, when?: string): string {
  const base = when ? `${when} diğer cihazlardaki oturumlarınız kapanır.` : "Diğer cihazlardaki oturumlarınız kapanır.";
  return claude ? `${base} ${CLAUDE_NOTE}` : base;
}

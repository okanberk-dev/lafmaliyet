/**
 * Kullanıcıya olduğu gibi gösterilecek hata (attempt() metnini döndürür; src/server/actions/util.ts buradan dışa
 * açar). Ayrı dosyada ve "server-only" yok: veritabanıyla gidip gelen testlerin doğrudan çalıştırdığı çekirdekler
 * (src/server/staff-requests/core.ts) aynı sınıfı fırlatır, eylemler ayrıca çevirmez.
 */
export class UserError extends Error {}

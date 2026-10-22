/**
 * Sitenin menü pinginin denetimi (POST /api/menu/ping). Kurallar bütün site pinglerinde aynı (anahtar yoksa 503, gövde
 * 4 KB'tan büyükse 413, imza yok / yanlış / 5 dakikadan eski ya da ileriyse 401): src/lib/site-ping.ts. Gövde
 * ({"event":"menu.changed","at"}) kalem taşımaz; içeriğine bakılmaz, imza yeter.
 */

export { checkSitePing as checkMenuPing, PING_MAX_BYTES, type PingCheck } from "@/lib/site-ping";

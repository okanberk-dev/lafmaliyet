import { after, connection, type NextRequest } from "next/server";

import { KARAOKE_BRANCH_ID } from "@/lib/branches";
import { needsCatchUp } from "@/lib/karaoke/freshness";
import type { LiveResponse } from "@/lib/live";
import { todayTR } from "@/lib/reminders";
import { awaitingUntil } from "@/lib/site-orders/follow";
import { siteErrorFor } from "@/lib/staff-errors";
import { getCurrentUser } from "@/server/auth/dal";
import { staffBranchRefusal } from "@/server/branch-scope";
import { pendingKaraokeAsks } from "@/server/data/karaoke-requests";
import { loadDueReminders, remindersMarker } from "@/server/data/user-reminders";
import { liveWindow, loadSessions } from "@/server/karaoke/board";
import { claimKaraokeMailPoll, runKaraokeMails } from "@/server/karaoke/staff-mail";
import { ensureKaraokeFresh, karaokeSecret, readKaraokeLive } from "@/server/karaoke/sync";
import { claimChecklistAlertPoll, runChecklistAlerts } from "@/server/notify/checklist-alerts";
import { vapidPublicKey } from "@/server/push/send";
import { ordersVersion, readOrdersSnapshot, readOrdersState } from "@/server/site-orders/sync";

/**
 * Açık panel sekmesinin canlı verisi: bugünün ve yarının karaoke oturumları (ve sayaçların bekleyen silme istekleri),
 * laffogato.net'in açık kafe siparişleri ve masa çağrıları (Siparişler; son çekmenin listesi, docs/SITE-SIPARIS.md), kişinin yarına
 * kadarki hatırlatıcıları, sunucu saati (sayaç cihaz saatine değil buna göre sayar) ve bildirim anahtarı. Sekme bunu
 * sürekli sormaz: açılışta, bildirim gelince, sekmeye dönünce ve seyrek bir yedek kontrolde ister (sekme öndeyken; arka
 * planda yalnız bildirim gelmeyen zil cihazı, 10 dakikada bir; src/lib/live-poll.ts). ETag üç ucuz işaretten (karaoke ve sipariş sayaçları, hatırlatıcıların
 * değişim işareti) ve günden oluşur; değişiklik yoksa veri okunmadan 304 döner.
 *
 * Karaoke kopyası bayatsa (ping kaçtı, son çekme düştü) yanıttan sonra site yeniden sorulur
 * (src/lib/karaoke/freshness.ts): kaçan rezervasyonu, kimse bakmazken veritabanını uyandırmadan, bakan ilk sekme getirir.
 * Aynı yolla, yanıttan sonra ve en çok 5 dakikada bir, kontrol listesi e-posta hatırlatmaları
 * (src/server/notify/checklist-alerts.ts) ve karaoke e-postaları (misafirin "bir gün kaldı" hatırlatması, personelin
 * sabah ve 3 saat kala e-postaları; src/server/karaoke/staff-mail.ts) gönderilir.
 */
export async function GET(request: NextRequest) {
  await connection();
  const headers = { "Cache-Control": "private, no-cache" };
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Giriş gerekli" }, { status: 401, headers });
  const today = todayTR();
  const [karaoke, marker, orders] = await Promise.all([readKaraokeLive(), remindersMarker(me.id), ordersVersion()]);
  const linked = Boolean(karaokeSecret());
  if (linked && needsCatchUp(karaoke.sync, Date.now())) {
    after(async () => {
      try {
        const r = await ensureKaraokeFresh({ state: karaoke.sync });
        if (r.status === "error") console.warn("[karaoke] tazeleme:", r.error);
      } catch (e) {
        console.error("[karaoke] tazeleme", e);
      }
    });
  }
  // Kontrol listesi hatırlatmaları (docs/KONTROL-LISTELERI.md § 6): açık bir sekme sorduğunda, yanıttan sonra, sunucu
  // örneği başına en çok 5 dakikada bir, yalnız günde 4 bildirim saatinin ilk saatinde (10:00, 14:00, 18:00, 22:00).
  // GitHub işi yoğunlukta saatlerce gecikebildiği için asıl tetikleyici bu
  if (claimChecklistAlertPoll()) {
    after(async () => {
      try {
        const r = await runChecklistAlerts(new Date(), Date.now() + 20_000);
        if (r.failed) console.warn(`[kontrol] hatırlatma: ${r.failed} e-posta gidemedi`);
      } catch (e) {
        console.error("[kontrol] hatırlatma", e);
      }
    });
  }
  // Karaoke e-postaları (docs/KARAOKE.md › Hatırlatma e-postası, Personel e-postaları): aynı düzen, site bağlıysa
  if (linked && claimKaraokeMailPoll()) {
    after(async () => {
      try {
        const r = await runKaraokeMails(new Date(), Date.now() + 20_000);
        const failed = ("failed" in r.guest ? r.guest.failed : 0) + ("failed" in r.staff ? r.staff.failed : 0);
        if (failed) console.warn(`[karaoke] e-posta: ${failed} ileti gidemedi`);
      } catch (e) {
        console.error("[karaoke] e-posta", e);
      }
    });
  }
  const version = karaoke.version;
  // Karaoke yalnız karaokenin şubesinde (docs/SUBE.md › Karaoke): başka şubeye kilitli personele oturum ve silme isteği
  // gitmez (misafir adı, alarm). Kilit ETag'te: kişinin şubesi değişince eski yanıt 304 ile onaylanmaz
  const karaokeHere = !(await staffBranchRefusal(me, KARAOKE_BRANCH_ID));
  // Kişi de ETag'te: aynı tarayıcıda başka hesapla girilince önceki kişinin yanıtı 304 ile onaylanmaz
  const etag = `W/"${version}.o${orders}.${marker}.k${karaokeHere ? 1 : 0}.${today}.u${me.id}.${me.role}"`;
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ...headers, ETag: etag } });
  const { from, to } = liveWindow();
  const [sessions, asks, reminders, publicKey, snapshot, ordersState] = await Promise.all([
    karaokeHere ? loadSessions(from, to, { admin: me.role === "admin" }) : Promise.resolve([]),
    // Sayaç silme istekleri (E-15): istek açılınca, geri çekilince ve karara bağlanınca karaoke sayacı artar (ETag)
    pendingKaraokeAsks(),
    loadDueReminders(me.id, today),
    vapidPublicKey(),
    readOrdersSnapshot(),
    readOrdersState(),
  ]);
  const deleteAsks = karaokeHere ? asks : [];
  const body: LiveResponse = {
    serverNow: new Date().toISOString(),
    me: { id: me.id, role: me.role },
    karaoke: {
      configured: linked,
      sessions,
      // Son çekme düştüyse ekran uyarır (ping kaçmış olabilir; rezervasyonlar sitenin panelinde de kontrol edilsin).
      // Hatanın ayrıntısı (anahtar adı, imza, sitenin sürümü) yalnız yöneticiye; personele sabit metin (E-64)
      okAt: linked ? karaoke.sync.lastOkAt : null,
      error: linked ? siteErrorFor(me.role, karaoke.sync.lastError) : null,
      deleteAsks,
    },
    orders: {
      configured: linked,
      // Bağlantı kaldırıldıysa eski listenin kopyası gösterilmez (ekran "kurulmadı" der, zil çalmaz)
      list: linked ? snapshot.orders : [],
      complete: snapshot.complete,
      skipped: snapshot.skipped,
      at: snapshot.at,
      pulledAt: ordersState.lastPullAt,
      okAt: ordersState.lastOkAt,
      error: siteErrorFor(me.role, ordersState.lastError),
      pingAt: ordersState.lastPingAt,
      changeAt: ordersState.lastChangeAt,
      // Ödeme bekleniyor: ekran bu ana kadar yoğun (üç dakikada bir çeker); takibin başlaması ve bitmesi sürümü artırır
      awaitingUntil: linked ? awaitingUntil(ordersState) : null,
      // Masa çağrıları ("Garson çağır"): son listenin kopyasıyla aynı sürümde (ETag), müşteriye dair bir şey yok
      calls: linked ? snapshot.calls : [],
      callsSkipped: snapshot.callsSkipped,
    },
    reminders,
    push: { publicKey },
  };
  return Response.json(body, { headers: { ...headers, ETag: etag } });
}

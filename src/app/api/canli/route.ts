import { after, connection, type NextRequest } from "next/server";

import { featureInScope } from "@/lib/branch-features";
import { needsCatchUp } from "@/lib/karaoke/freshness";
import type { LiveResponse } from "@/lib/live";
import { todayTR } from "@/lib/reminders";
import { canOpen } from "@/lib/roles";
import { awaitingUntil } from "@/lib/site-orders/follow";
import { siteErrorFor } from "@/lib/staff-errors";
import { kontrolOutcome } from "@/lib/job-health";
import { getCurrentUser } from "@/server/auth/dal";
import { currentBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { pendingKaraokeAsks } from "@/server/data/karaoke-requests";
import { getDb } from "@/server/db";
import { loadDueReminders, remindersMarker } from "@/server/data/user-reminders";
import { recordJobRun } from "@/server/jobs/runs";
import { liveWindow, loadSessions } from "@/server/karaoke/board";
import { claimAsilposWaitPoll, finishWaitingDayEnds } from "@/server/asilpos/gun-sonu";
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

/** Yanıttan sonraki işler (gün sonu, kontrol listesi, karaoke e-postaları) bu sürede biter; tanımsızken plan varsayılanı keserdi */
export const maxDuration = 60;
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
      const startedAt = new Date();
      try {
        const r = await runChecklistAlerts(new Date(), Date.now() + 20_000);
        if (r.failed) console.warn(`[kontrol] hatırlatma: ${r.failed} e-posta gidemedi`);
        // Bir şey gönderildiyse ya da gidemediyse job_runs'a (zil ve Ayarlar › Günlük işler; çoğu yoklama hiçbir şey yazmaz)
        if (r.sent || r.failed) await recordJobRun("kontrol", startedAt, kontrolOutcome({ checklist: r, karaoke: [] }));
      } catch (e) {
        console.error("[kontrol] hatırlatma", e);
        await recordJobRun("kontrol", startedAt, kontrolOutcome({ checklist: { error: (e as Error).message }, karaoke: [] }));
      }
    });
  }
  // Karaoke e-postaları (docs/KARAOKE.md › Hatırlatma e-postası, Personel e-postaları): aynı düzen, site bağlıysa
  if (linked && claimKaraokeMailPoll()) {
    after(async () => {
      const startedAt = new Date();
      const none = { sent: 0, failed: 0 };
      try {
        const r = await runKaraokeMails(new Date(), Date.now() + 20_000);
        const failed = ("failed" in r.guest ? r.guest.failed : 0) + ("failed" in r.staff ? r.staff.failed : 0);
        const sent = ("sent" in r.guest ? r.guest.sent : 0) + ("sent" in r.staff ? r.staff.sent : 0);
        const error = "error" in r.guest || "error" in r.staff;
        if (failed) console.warn(`[karaoke] e-posta: ${failed} ileti gidemedi`);
        // Kontrol listesininki gibi: bir şey gönderildiyse, gidemediyse ya da iş hata verdiyse job_runs'a (zil "Personel
        // e-postası gidemedi"; kısmen gidemeyen e-postanın anahtarı serbest kalmaz, sonraki GitHub çalışması onu görmez)
        if (sent || failed || error) await recordJobRun("kontrol", startedAt, kontrolOutcome({ checklist: none, karaoke: [r.guest, r.staff] }));
      } catch (e) {
        console.error("[karaoke] e-posta", e);
        await recordJobRun("kontrol", startedAt, kontrolOutcome({ checklist: none, karaoke: [{ error: (e as Error).message }] }));
      }
    });
  }
  // Pavo'yu bekleyen AsilPOS gün sonu (docs/ASILPOS.md › Pavo'yu bekler): AsilPOS günü yeniden göndermediyse bekleme dolunca
  // yöneticinin ve çalışanların e-postası buradan gider (en çok 5 dakikada bir; bekleyen gün yoksa tek sorgu)
  if (claimAsilposWaitPoll()) {
    after(async () => {
      try {
        const days = await finishWaitingDayEnds(getDb(), new Date(), { deadlineAt: Date.now() + 25_000 });
        if (days.length) console.info("[asilpos] Pavo beklemesi bitti", days);
      } catch (e) {
        console.error("[asilpos] Pavo beklemesi", e);
      }
    });
  }
  const version = karaoke.version;
  // Şube özellikleri (docs/SUBE.md › Şube özellikleri; şube kapsamı B6, C P1-8): karaoke, uygulama siparişi ve masa çağrısı
  // yalnız seçili kapsamda açıksa gelir (şubesine kilitli personelde hep kendi şubesi; "Tümü"de herhangi bir şubede açıksa).
  // Kapalıysa oturum, silme isteği, sipariş ve çağrı gitmez (misafir adı, alarm, zil). Üç işaret ETag'te: seçim, kişinin
  // şubesi ya da şubenin özelliği değişince eski yanıt 304 ile onaylanmaz
  const [scope, branchRows] = await Promise.all([currentBranchScope(), listBranches()]);
  // Saha verisi yalnız ekranı açabilene (docs/ROLLER.md): muhasebeci sahada değil, karaoke ve Siparişler ona kapalı; canlı
  // uç da ona oturum, silme isteği, sipariş ve çağrı vermez (yanıt 200, listeler boş: kabuk bağlantı hatası göstermez).
  // Müdürde kapsam şubesine kilitli (seçici çerezi yok sayılır)
  const karaokeHere = canOpen(me.role, "/panel/karaoke") && featureInScope("karaoke", scope, branchRows);
  const ordersHere = canOpen(me.role, "/panel/siparisler") && featureInScope("siparis", scope, branchRows);
  const callsHere = canOpen(me.role, "/panel/siparisler") && featureInScope("garson", scope, branchRows);
  const here = `k${karaokeHere ? 1 : 0}${ordersHere ? 1 : 0}${callsHere ? 1 : 0}`;
  // Kişi de ETag'te: aynı tarayıcıda başka hesapla girilince önceki kişinin yanıtı 304 ile onaylanmaz
  const etag = `W/"${version}.o${orders}.${marker}.${here}.${today}.u${me.id}.${me.role}"`;
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
      // Karaoke bu kapsamda yoksa çekmenin hatası da yok (sarı satır öbür şubenin işi)
      okAt: linked ? karaoke.sync.lastOkAt : null,
      error: linked && karaokeHere ? siteErrorFor(me.role, karaoke.sync.lastError) : null,
      deleteAsks,
    },
    orders: {
      configured: linked,
      // Bağlantı kaldırıldıysa eski listenin kopyası gösterilmez (ekran "kurulmadı" der, zil çalmaz); uygulama siparişi
      // seçili şubede kullanılmıyorsa da liste boş (zil çalmaz)
      list: linked && ordersHere ? snapshot.orders : [],
      complete: ordersHere ? snapshot.complete : true,
      skipped: ordersHere ? snapshot.skipped : 0,
      at: snapshot.at,
      pulledAt: ordersState.lastPullAt,
      okAt: ordersState.lastOkAt,
      error: ordersHere || callsHere ? siteErrorFor(me.role, ordersState.lastError) : null,
      pingAt: ordersState.lastPingAt,
      changeAt: ordersState.lastChangeAt,
      // Ödeme bekleniyor: ekran bu ana kadar yoğun (üç dakikada bir çeker); takibin başlaması ve bitmesi sürümü artırır
      awaitingUntil: linked ? awaitingUntil(ordersState) : null,
      // Masa çağrıları ("Garson çağır"): son listenin kopyasıyla aynı sürümde (ETag), müşteriye dair bir şey yok
      calls: linked && callsHere ? snapshot.calls : [],
      callsSkipped: callsHere ? snapshot.callsSkipped : 0,
      // Seçili şubede kullanılmayan özellik: ekran "Bu şubede kullanılmıyor" der, boş listeyi "sipariş yok" saymaz
      off: { orders: !ordersHere, calls: !callsHere },
    },
    reminders,
    push: { publicKey },
  };
  return Response.json(body, { headers: { ...headers, ETag: etag } });
}

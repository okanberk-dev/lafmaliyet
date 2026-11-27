import { Store } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { CardContent } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { dateTimeTR, money, num } from "@/lib/format";
import { durumMetni, hedefUyumlu, KASA_RAPORU_GUN } from "@/lib/asilpos/anahtar-uyumu";
import { clearedText, isUnverifiedAfterOk, asilposCardSummary, rejectionText, unverifiedText } from "@/lib/asilpos/status";
import { ASILPOS_SWITCH_MAX_AHEAD, ASILPOS_SWITCH_MIN, switchEffects } from "@/lib/asilpos/switch";
import type { BranchRow } from "@/lib/branches";
import { asilposCardView } from "@/lib/pos-cards";
import { STOCK_ESTIMATE_BRANCH } from "@/lib/stock-estimate";
import { addDays, longDateTR } from "@/lib/reminders";
import { loadAnahtarUyumuKarti, type AnahtarUyumuKarti } from "@/server/asilpos/anahtar-uyumu";
import { loadAsilposCard, type AsilposCardData } from "@/server/asilpos/status";

import type { ProductOption } from "../satislar/product-picker";
import { AsilposDayDelete, AsilposKeyTest, AsilposSwitchDayForm, AsilposUnmatchedList } from "./asilpos-client";
import { PosElsewhereCard } from "./pos-elsewhere";
import { SectionCard } from "./section-card";

/** Anahtarın nereden okunduğu (loadAsilposCard secretSource) */
const SECRET_SOURCE_TEXT = {
  panel: "Anahtar panelde saklı (şifreli).",
  ortam: "Anahtar sunucunun ayarında.",
  yok: "Anahtar yok.",
} as const;

/** İmzası doğrulanamayan isteklerin satırı bu kadar gün görünür */
const UNVERIFIED_DAYS = 14;

/**
 * Ayarlar › AsilPOS (kasa) (docs/ASILPOS.md › Durum ve onarım, Geçiş günü): bağlantının durumu (kurulmadı, bağlı, geçiş
 * bekliyor, kasa AsilPOS), güne göre açık retler ve çözümü ("Bu günün AsilPOS kaydını sil", 409; sonra AsilPOS'tan elle
 * Gönder), güne bağlanamayan son ret, imzası doğrulanamayan istekler, AsilPOS'a
 * geçiş günü, gelen ve gelmeyen günler, ürüne bağlanamayan POS adları. Geçiş günü boşken AsilPOS'un gönderdiği günler
 * yalnız burada görünür (deneme), başka hiçbir ekrana ya da hesaba girmez (sahibin 26 Ekim kararı). Yalnız yönetici
 * (Ayarlar sayfası requireAdmin).
 *
 * Seçili şubeye göre (şube kapsamı C P2-2, src/lib/pos-cards.ts; çok şube, 27 Kasım 2026): her AsilPOS kasasının kendi
 * bölümü (durumu, geçiş günü, günleri, anahtarı). Kasası AsilPOS olan şube seçiliyken yalnız onun bölümü; "Tümü"de her
 * kasanın adıyla bir bölüm; kasası AsilPOS olmayan şube ya da online kanal seçiliyken kart "Bu şubede kullanılmıyor"
 * satırına iner (durum okunmaz). İmzası doğrulanamayan isteklerin sayacı şubeye bağlanamaz: her bölümde görünür.
 */
export async function AsilposCard({ products, scope, branches }: { products: ProductOption[]; scope: string; branches: readonly BranchRow[] }) {
  const view = asilposCardView(scope, branches);
  if (view.kind === "elsewhere") return <PosElsewhereCard id="asilpos" icon={<Store />} title="AsilPOS (kasa)" system="AsilPOS" users={view.users} />;
  const now = new Date();
  const [all, keys] = await Promise.all([
    Promise.all(
      view.ids.map((id) =>
        loadAsilposCard(undefined, id, now).catch((e) => {
          console.error("AsilPOS durumu okunamadı", id, e);
          return null;
        }),
      ),
    ),
    // Uzaktan ve site anahtarının uyumu: okunamazsa bölüm görünmez, kartın geri kalanı bozulmaz
    loadAnahtarUyumuKarti(undefined, now).catch((e) => {
      console.error("AsilPOS anahtar uyumu okunamadı", e);
      return null;
    }),
  ]);
  const datas = all.filter((d): d is AsilposCardData => d !== null);
  if (datas.length !== all.length || !datas.length) {
    return (
      <SectionCard id="asilpos" icon={<Store />} title="AsilPOS (kasa)" summary="Durum okunamadı">
        <CardContent>
          <Notice tone="bad" size="sm" title="AsilPOS bağlantısının durumu okunamadı; sayfayı yenileyin" />
        </CardContent>
      </SectionCard>
    );
  }
  const nameOf = (id: string) => branches.find((b) => b.id === id)?.name ?? id;
  // "Tümü"de birden çok kasa açıkken bölümler ve özet şubenin adıyla (ModPOS kartının şube bölümleri gibi)
  const summary = [
    ...(keys?.uyarilar.map((u) => u.title) ?? []),
    ...datas.map((d) => (view.named ? `${nameOf(d.branchId)}: ${asilposCardSummary(d).short}` : asilposCardSummary(d).short)),
  ].join(" · ");
  const anySwitch = datas.some((d) => d.switchDay);
  return (
    <SectionCard
      id="asilpos"
      icon={<Store />}
      title="AsilPOS (kasa)"
      summary={summary}
      // Geçiş günü seçildiyse "ModPOS sayılır" cümlesi geçmişi anlatır: yalnız seçilmeden önce (sahibin isteği 24.11.2026)
      description={
        anySwitch
          ? "Kafenin kasası AsilPOS her iş gününü kapanışta buraya gönderir."
          : "Kafenin kasası AsilPOS her iş gününü kapanışta buraya gönderir. Geçiş günü seçilene kadar kasa ModPOS sayılır: AsilPOS'un gönderdiği günler yalnız burada görünür, hiçbir hesaba girmez."
      }
    >
      <CardContent className="space-y-6">
        {keys ? <KeySection data={keys} nameOf={nameOf} /> : null}
        {datas.map((data) => (
          <TillSection
            key={data.branchId}
            data={data}
            now={now}
            products={products}
            branchName={view.named ? nameOf(data.branchId) : null}
            effects={switchEffects({
              branchName: nameOf(data.branchId),
              modposNames: branches.filter((b) => b.active && b.kind === "fiziksel" && b.posSource === "modpos").map((b) => b.name),
              stockEstimate: data.branchId === STOCK_ESTIMATE_BRANCH,
            })}
          />
        ))}
      </CardContent>
    </SectionCard>
  );
}

/** "Marina ve Tuzla" */
const andList = (names: readonly string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} ve ${names.at(-1)}` : (names[0] ?? ""));

/**
 * Uzaktan ve site anahtarı (docs/ASILPOS.md › Şube kurulumu › Anahtar değişimi): panelin kasalara dağıttığı anahtarı iki
 * uç kabul ediyor mu (son sınama, sabah işi ya da kasa sorunca en çok saatte bir; "Anahtarları sına" şimdi), uç önceki
 * anahtarı (`_ONCEKI`) tanıyor mu ve tanımlı mı, kasalar güncel değerleri uyguladı mı, ve uyarılar adımlarıyla. Anahtar
 * ve sürüm gösterilmez. Kasalar şubeye göre değil: bütün kasaların bölümlerinin üstünde bir kez
 */
function KeySection({ data, nameOf }: { data: AnahtarUyumuKarti; nameOf: (id: string) => string }) {
  const { uygulayan, bekleyen } = data.kasalar;
  const kasalar = [
    uygulayan.length ? `${andList(uygulayan.map(nameOf))} güncel değerleri uyguladı` : null,
    bekleyen.length ? `${andList(bekleyen.map(nameOf))} gün kapanınca uygulayacak` : null,
  ].filter(Boolean);
  return (
    <section className="space-y-3" aria-label="Uzaktan ve site anahtarı">
      <div className="space-y-1.5 rounded-2xl bg-surface px-4 py-3 text-sm ring-1 ring-line">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="font-medium text-ink">Uzaktan ve site anahtarı</p>
          <AsilposKeyTest />
        </div>
        {data.hedefler.map((h) => (
          <p key={h.hedef} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-5">
            <Badge tone={!h.sonuc ? "gray" : hedefUyumlu(h.sonuc) ? "green" : h.sonuc.durum === "red" || h.sonuc.durum === "kapali" ? "red" : "amber"} dot>
              {h.ad}
            </Badge>
            <span className="text-ink-soft">{durumMetni(h.sonuc)}</span>
            {h.notlar.length ? <span className="text-ink-mute">· {h.notlar.join(" · ")}</span> : null}
          </p>
        ))}
        <p className="text-[13px] leading-5 text-pretty text-ink-mute">
          {data.sinama ? `Son sınama ${dateTimeTR(data.sinama.at)}.` : data.eskiDegerlerle ? "Değerler son sınamadan sonra değişti; kasa sorunca ya da düğmeyle yeniden sınanır." : "Henüz sınanmadı."}{" "}
          {kasalar.length ? `Kasalar: ${kasalar.join("; ")}.` : `Son ${KASA_RAPORU_GUN} günde bağlantıyı soran kasa yok.`}
        </p>
      </div>
      {data.uyarilar.map((u) => (
        <Notice key={u.hedef} tone={u.kind === "danger" ? "bad" : u.kind === "warning" ? "warn" : "neutral"} size="sm" title={u.title} text={u.text} detailsLabel="Ne yapılmalı" defaultOpen>
          <ol className="list-decimal space-y-1 pl-4">
            {u.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Notice>
      ))}
    </section>
  );
}

/** Bir kasanın bölümü (şube adı yalnız "Tümü"de birden çok kasa varken) */
function TillSection({ data, now, products, branchName, effects }: { data: AsilposCardData; now: Date; products: ProductOption[]; branchName: string | null; effects: string[] }) {
  const sum = asilposCardSummary(data);
  const { state, today } = data;
  const linked = data.secretProblem === null;
  // Bağlantı kapalıyken retler kırmızı değil (özet de saymaz)
  const rejectTone = linked ? "bad" : "neutral";
  const undated = sum.undated;
  const unverified = state.unverified && now.getTime() - Date.parse(state.unverified.lastAt) < UNVERIFIED_DAYS * 86_400_000 ? state.unverified : null;
  // Sonradan başarılı gönderim geldiyse bağlantı çalışıyor: uyarı değil, soluk bilgi
  const unverifiedLoud = unverified !== null && isUnverifiedAfterOk(state);
  return (
    <section className="space-y-4" aria-label={branchName ? `AsilPOS · ${branchName}` : undefined}>
        {branchName ? <p className="text-sm font-semibold text-ink">{branchName}</p> : null}
        <div className="space-y-1.5 rounded-2xl bg-surface px-4 py-3 text-sm ring-1 ring-line">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone={sum.tone} dot>
              {sum.badge}
            </Badge>
            <span className="text-ink">{sum.headline}</span>
          </p>
          {sum.lines.map((l) => (
            <p key={l} className="text-[13px] leading-5 text-pretty text-ink-mute">
              {l}
            </p>
          ))}
          {/* Anahtarın nereden okunduğu; panelde saklama ve silme şubenin sayfasında (Şube ayarları › AsilPOS bağlantısı) */}
          <p className="text-[13px] leading-5 text-pretty text-ink-mute">
            {SECRET_SOURCE_TEXT[data.secretSource ?? "yok"]}{" "}
            <Link href={`/panel/subeler/${encodeURIComponent(data.branchId)}#asilpos`} className="font-medium text-ink-soft underline underline-offset-2 hover:text-ink">
              {data.secretSource === "panel" ? "Şube ayarlarında değiştir" : "Şube ayarlarında panelde sakla"}
            </Link>
          </p>
        </div>

        {sum.dayRejections.map(({ rejection: e, day, status }) =>
          status === "cleared" ? (
            <Notice key={e.date} tone={linked ? "warn" : "neutral"} size="sm" title={`AsilPOS'tan Gönder bekleniyor · ${longDateTR(e.date)}`} text={clearedText(e, today)} />
          ) : (
            <Notice
              key={e.date}
              tone={rejectTone}
              size="sm"
              title={`${longDateTR(e.date)} reddedildi · ${dateTimeTR(e.at)} · ${e.status}`}
              // 409'un çözümü: gün hâlâ reddeden Z ile kayıtlıysa silinebilir
              action={e.error === "z_conflict" && day && day.zNo === e.zNo ? <AsilposDayDelete branchId={data.branchId} date={e.date} zNo={day.zNo} lines={day.lines} label="Bu günün AsilPOS kaydını sil" /> : undefined}
            >
              {rejectionText(e, today)}
            </Notice>
          ),
        )}
        {undated ? (
          <Notice
            tone={undated.fresh ? rejectTone : "neutral"}
            size="sm"
            title={`${undated.fresh ? "Son gönderim reddedildi" : "Önceki ret"} · ${dateTimeTR(undated.rejection.at)} · ${undated.rejection.status}`}
          >
            {rejectionText(undated.rejection, today)}
          </Notice>
        ) : null}
        {unverified ? (
          <Notice tone={unverifiedLoud ? "warn" : "neutral"} size="sm" title={`${unverifiedText(unverified)}${unverifiedLoud ? "" : " O günden beri gün sonları geliyor."}`} />
        ) : null}

        <AsilposSwitchDayForm branchId={data.branchId} effects={effects} value={data.switchDay} today={today} min={ASILPOS_SWITCH_MIN} max={addDays(today, ASILPOS_SWITCH_MAX_AHEAD)} linked={linked} />

        {data.days.length ? (
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-ink-soft">
              Gelen günler{data.totalDays > data.days.length ? ` (son ${data.days.length}; toplam ${num(data.totalDays)})` : ""}
            </p>
            <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
              {data.days.map((d) => (
                <li key={d.date} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-ink">{longDateTR(d.date)}</span>
                      {d.counted ? (
                        <Badge tone="green">Sayılıyor</Badge>
                      ) : (
                        <Badge tone="gray" title="Geçiş gününden önce: hiçbir hesaba girmez">
                          Deneme
                        </Badge>
                      )}
                    </p>
                    <p className="mt-0.5 text-[13px] text-ink-mute tabular">
                      Z {d.zNo} · {num(d.receipts)} fiş · {money(d.zTotal)} · {num(d.lines)} satır · alındı {dateTimeTR(d.receivedAt)}
                    </p>
                  </div>
                  <AsilposDayDelete branchId={data.branchId} date={d.date} zNo={d.zNo} lines={d.lines} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {data.unmatchedCount ? (
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium text-ink-soft">
              Ürüne bağlanamayan POS adları: {num(data.unmatchedCount)}{" "}
              <InfoTip
                text={`${
                  data.switchDay
                    ? "Geçiş gününden önceki günlerde hiçbir hesaba girmez. Geçiş gününden sonra ciroya girer, maliyeti ortalama maliyet oranından tahmin edilir; reçeteye göre tüketime (Tutarlılık, stok) girmez."
                    : "Geçiş günü seçilene kadar hiçbir hesaba girmez. Seçildikten sonra ciroya girer, maliyeti ortalama maliyet oranından tahmin edilir; reçeteye göre tüketime (Tutarlılık, stok) girmez."
                } Adı buradan bir ürüne bağlayın (Satışlar'ın POS adı hafızasına yazılır), ürünü Ürünler › Site menüsü'nde sitenin kalemine bağlayın ya da geçiş gününden sonraki aylarda Satışlar'da eşleştirin. Bağlanınca kayıtlı günler de yeniden gönderim olmadan güncellenir.`}
              />
            </p>
            <AsilposUnmatchedList items={data.unmatched} more={data.unmatchedCount - data.unmatched.length} products={products} />
          </div>
        ) : null}

        {data.unmatchedIkramCount ? (
          // Yalnız ikram edilen kalem satış listesine düşmez: tüketime girmesi için burada bağlanır (denetim B10)
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium text-ink-soft">
              İkramda ürüne bağlanamayan POS adları: {num(data.unmatchedIkramCount)}{" "}
              <InfoTip text="AsilPOS'ta ikram edilen, zayi yazılan ya da hazırlandıktan sonra iptal edilen ama ürüne bağlanamayan kalem kayıtlı tüketime (Tutarlılık) girmez; Zayi & ikram'da “ürüne bağlı değil” der. Adı buradan bir ürüne bağlayın (Satışlar'ın POS adı hafızasına yazılır) ya da ürünü Ürünler › Site menüsü'nde sitenin kalemine bağlayın. Bağlanınca geçmiş günlerin ikramı da o ürünle sayılır." />
            </p>
            <AsilposUnmatchedList items={data.unmatchedIkram} more={data.unmatchedIkramCount - data.unmatchedIkram.length} products={products} ikram />
          </div>
        ) : null}
    </section>
  );
}

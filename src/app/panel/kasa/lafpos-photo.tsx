"use client";

import { Camera } from "lucide-react";
import { toast } from "sonner";

import { PhotoPicker, PhotoStatus, usePhotoUpload } from "@/components/panel/photo-picker";
import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { money } from "@/lib/format";
import { LAFPOS_PHOTO_TEXT, photoSourceText, photoUnsureText, type LafposPhotoCheck, type LafposPhotoNeed } from "@/lib/lafpos/foto";
import { MAX_OKC_PHOTOS, type ReadingState } from "@/lib/photo-rules";
import { attachLafposDayPhoto, setLafposBankPos } from "@/server/actions/cash-report";

/**
 * LafPOS gününün gün sonu fotoğrafı (sahibin isteği, 24 Kasım 2026; docs/LAFPOS.md › Gün sonu otomasyonu): kasa raporu
 * LafPOS'tan ve Pavo'dan kendiliğinden yazıldı, personelin tek işi Pavo'nun gün sonu fişinin (istenince basılan detaylı Z;
 * ayrı mali Z basan cihazda yazarkasa Z'sinin de) fotoğrafı. Fotoğraf hiçbir rakamı yazmaz (kayıt, sürüm, onay yok): rapora bağlanır, okunuşu
 * LafPOS'un rakamlarıyla karşılaştırılır. Personel yalnız "Fotoğraf alındı" ya da "yeniden çekin" görür; fark ve "Banka
 * POS'a yaz" yalnız yöneticinin (`admin`).
 */
export function LafposPhotoCard({
  date,
  branchId,
  state,
  storage,
  reading,
  admin = null,
}: {
  date: string;
  branchId: string;
  state: { need: LafposPhotoNeed; attached: number; pending: number; line: string; done: boolean; auto: boolean };
  storage: boolean;
  reading: ReadingState;
  /** Yalnız yönetici: fotoğraf ↔ LafPOS karşılaştırması ve raporun Banka POS'u */
  admin?: { check: LafposPhotoCheck | null; bankPos: number | null } | null;
}) {
  const up = usePhotoUpload();
  const [pending, start] = useActionTransition();
  const full = state.attached >= MAX_OKC_PHOTOS;
  // Personelden rakam istenmez (formun "rakamları elle yazın"ı burada yok); yöneticiye okumanın yolu
  const offLine = storage && admin && reading !== "on" ? "Yapay zekâ ile okuma şu an kullanılamıyor: fotoğraf kodla okunur (OCR), LafPOS'la karşılaştırılır." : null;
  // Pavo istenince detaylı Z basar: tek fiş (banka gün sonu da Z de üstünde); ayrı mali Z basan cihazda Z de
  const what = state.need.z ? "Pavo gün sonu fişi ve yazarkasa Z raporu" : "Pavo gün sonu fişi (detaylı Z)";

  async function pick(file: File) {
    // Fotoğraf her zaman okunur: yapay zekâ kapalı / kurulu değil / sınırda ise sunucu kodla okur (OCR; src/server/photo-read/lafpos.ts)
    // Uzun fiş birleştirilemezse parçalar ayrı fotoğraf olarak bağlanır (bölümün kalan yeri kadar)
    const room = Math.max(1, MAX_OKC_PHOTOS - state.attached);
    const res = await up.upload(file, { kind: "kasa-okc", day: date, read: true, room, onMore: (more) => attach(more.photo.id) });
    if (res) attach(res.photo.id);
  }

  function attach(photoId: number) {
    start(async () => {
      const out = await attachLafposDayPhoto({ date, branchId, photoId });
      if (!out.ok) return void toast.error(out.error);
      toast.success(out.data.status === "pending" ? "Fotoğraf alındı; rapor gelince bağlanır" : out.data.line);
    });
  }

  function writeBank(amount: number) {
    start(async () => {
      const out = await setLafposBankPos({ date, branchId, amount });
      if (!out.ok) return void toast.error(out.error);
      toast.success(`Banka POS ${money(amount)} yazıldı`);
    });
  }

  const tone = state.line === LAFPOS_PHOTO_TEXT.retry ? "warn" : state.done ? "good" : "neutral";
  const check = admin?.check ?? null;
  return (
    <Card>
      {/* Personelde açıklama yok: sayfanın alt başlığı ve kartın satırı ne yapılacağını söylüyor (aynı cümle üç kez okunuyordu) */}
      <CardHeader
        icon={<Camera />}
        title="Gün sonu fotoğrafı"
        description={admin ? (state.auto || state.pending ? `Rakamlar LafPOS'tan; personel yalnız fotoğraf ekler: ${what}` : "LafPOS'ta sayım yok: rapor gelince fotoğraf bağlanır") : undefined}
      />
      <div className="space-y-3 px-5 pb-5 text-sm">
        <Notice tone={tone} size="sm" title={state.line} text={state.attached ? `${state.attached} fotoğraf${state.pending && !state.auto ? " (rapor bekleniyor)" : ""}` : undefined} />
        {storage && !full ? (
          <>
            <PhotoPicker onPick={(f) => void pick(f)} read disabled={up.busy || pending} />
            <PhotoStatus phase={up.phase} />
            {offLine ? <p className="text-[13px] leading-5 text-ink-mute">{offLine}</p> : null}
          </>
        ) : !storage ? (
          <p className="text-[13px] text-ink-mute">Fotoğraf deposu bu ortamda kapalı.</p>
        ) : null}
        {admin ? <AdminCheck check={check} bankPos={admin.bankPos} onWrite={writeBank} busy={pending} /> : null}
      </div>
    </Card>
  );
}

/** Yöneticinin fiş ↔ LafPOS satırları (düz Türkçe: "Fiş LafPOS'la aynı"); Banka POS boşken okunan toplam ve "Banka POS'a yaz" */
function AdminCheck({ check, bankPos, onWrite, busy }: { check: LafposPhotoCheck | null; bankPos: number | null; onWrite: (amount: number) => void; busy: boolean }) {
  if (!check) return <p className="text-[13px] text-ink-mute">Fiş fotoğrafı yok.</p>;
  const head =
    check.state === "uyumlu"
      ? "Fiş LafPOS'la aynı"
      : check.state === "fark"
        ? "Fiş LafPOS'tan farklı"
        : check.state === "okunamadi"
          ? "Fotoğraf okunamadı ya da yanlış belge"
          : check.state === "belirsiz"
            ? `${photoUnsureText(check)}: yönetici baksın`
            : "Fotoğraf henüz okunmadı";
  return (
    <section aria-label="Fiş ve LafPOS" className="space-y-2">
      <Notice tone={check.state === "fark" ? "bad" : check.state === "uyumlu" ? "good" : "warn"} size="sm" title={head} text={check.state === "okunmadi" ? undefined : `Okuyan: ${photoSourceText(check)}`} />
      {check.rows.length ? (
        <ul className="divide-y divide-line">
          {check.rows.map((r) => (
            <li key={r.label} className="flex flex-wrap items-baseline justify-between gap-x-4 py-1.5">
              <span className="min-w-0 break-words text-ink">{r.label}</span>
              <span className={r.ok ? "shrink-0 text-right text-ink tabular" : "shrink-0 text-right font-semibold text-bad-ink tabular"}>
                fotoğrafta {r.photo} · LafPOS&apos;ta {r.lafpos}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {check.zNoFromPhoto ? <p className="text-[13px] text-ink-mute">Yazarkasa Z no {check.zNoFromPhoto} fotoğraftan okundu (LafPOS göndermedi).</p> : null}
      {bankPos === null && check.readBankPos !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-ink">Fotoğrafta {money(check.readBankPos)}</span>
          <Button size="sm" variant="secondary" onClick={() => onWrite(check.readBankPos!)} disabled={busy}>
            Banka POS&apos;a yaz
          </Button>
        </div>
      ) : null}
    </section>
  );
}

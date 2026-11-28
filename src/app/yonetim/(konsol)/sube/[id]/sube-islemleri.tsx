"use client";

import { Power, Shuffle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Select } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import {
  BRANCH_KIND_LABEL,
  BRANCH_KINDS,
  BRANCH_POS_SOURCE_LABEL,
  BRANCH_POS_SOURCES,
  branchChangeError,
  FIXED_BRANCH_IDS,
  type BranchKind,
  type BranchPosSource,
  type BranchRow,
} from "@/lib/branches";
import { POS_OFF_CONFIRM_PREFIX } from "@/lib/pos/tills";
import { YONETIM_YOLU } from "@/lib/yonetim-host";
import { deleteBranch, updateBranch } from "@/server/actions/branches";

/*
 * Yönetim konsolu › Şubeler ve kasalar › şube (docs/SUBE.md › Şube işlemleri): açık / kapalı durumu, tür ve kasa
 * programı, silme. Var olan sunucu eylemleri (updateBranch yalnız bu alanlarla, deleteBranch); kurallar saf dosyadan
 * (branchChangeError) okunur, ekran sunucuyla aynı şeyi önceden söyler, sunucu yine denetler. Her yıkıcı işlem onay
 * penceresiyle; canlı şubede (son günlerde kasadan gün sonu geldi) pencerede kırmızı uyarı. AsilPOS'tan ModPOS'a dönüşün
 * onayı sunucudan (posOffConfirmText), ladmin'dekiyle aynı.
 */

/** Canlı şubenin pencere uyarısı (başlık canliBaslik, sunucu sayfasında hesaplanır) */
function CanliNotu({ canli }: { canli: string | null }) {
  return canli ? <Notice tone="bad" size="sm" title={canli} text="Bu şubenin kasası çalışıyor. Bu işlem bugünkü kasayı etkileyebilir; emin değilseniz vazgeçin." /> : null;
}

const others = (rows: readonly BranchRow[], id: string) => rows.filter((b) => b.id !== id);

/** Açık / kapalı: kapatmak ve yeniden açmak (sabit kayıt ve son açık şube kapatılmaz) */
export function DurumKarti({ branch, rows, canli }: { branch: BranchRow; rows: BranchRow[]; canli: string | null }) {
  const [soru, setSoru] = useState(false);
  const [bekliyor, basla] = useActionTransition();
  const kapat = branch.active;
  const hata = branchChangeError(branch, { kind: branch.kind, posSource: branch.posSource, active: !branch.active }, others(rows, branch.id));

  function uygula() {
    basla(async () => {
      const r = await updateBranch({ id: branch.id, active: !branch.active });
      if (!r.ok) return void toast.error(r.error);
      setSoru(false);
      toast.success(kapat ? `${branch.name} kapatıldı` : `${branch.name} yeniden açıldı`);
    });
  }

  return (
    <Card>
      <CardHeader
        icon={<Power />}
        title="Açık / kapalı"
        description={kapat ? "Şube açık: seçicide, listelerde ve toplamlarda görünür." : "Şube kapalı: seçicide ve toplamlarda görünmez, kayıtları durur."}
      />
      <div className="space-y-2 px-5 pb-5">
        <Button variant={kapat ? "danger" : "primary"} onClick={() => setSoru(true)} disabled={bekliyor || !!hata} className="max-sm:w-full">
          {kapat ? "Şubeyi kapat" : "Şubeyi yeniden aç"}
        </Button>
        {hata ? <p className="text-[13px] text-ink-mute">{hata}</p> : null}
      </div>
      <ConfirmDialog
        open={soru}
        onClose={() => setSoru(false)}
        onConfirm={uygula}
        pending={bekliyor}
        tone={kapat ? "danger" : "primary"}
        confirmLabel={kapat ? "Kapat" : "Yeniden aç"}
        title={kapat ? `${branch.name} kapatılsın mı?` : `${branch.name} yeniden açılsın mı?`}
        description={
          <div className="space-y-3">
            {kapat ? <CanliNotu canli={canli} /> : null}
            <p>
              {kapat
                ? "Şube seçicide ve toplamlarda görünmez; kayıtları silinmez, sonra yeniden açılabilir. Bekleyen kasa kurulum bağlantıları iptal olur, kurulu kasanın anahtarı değişmez."
                : "Şube yeniden seçicide ve toplamlarda görünür; kayıtları olduğu gibi durur."}
            </p>
          </div>
        }
      />
    </Card>
  );
}

/** Kasa programının değişince ne olacağı (onay penceresinde) */
function programEtkisi(from: BranchPosSource, to: BranchPosSource): string | null {
  if (from === to) return null;
  if (to === "asilpos") return "Bu şubenin ModPOS föyü artık çekilmez. AsilPOS'un gün sonları geçiş günü seçilince sayılır; o güne dek deneme sayılır.";
  if (to === "modpos") return "ModPOS föyü yeniden çekilir; AsilPOS'un gün sonları hiçbir hesaba girmez. Şubenin AsilPOS günleri ya da geçiş günü varsa ayrıca onay istenir.";
  return "Online kanalın kasası olmaz: gün sonu gelmez.";
}

/** Tür ve kasa programı (sabit kaydın türü değişmez; online kanalın kasası olmaz) */
export function KasaProgramiKarti({ branch, rows, canli }: { branch: BranchRow; rows: BranchRow[]; canli: string | null }) {
  // Sayfa kartı şubenin tür ve kasa programıyla anahtarlar (key): kayıttan sonra sunucunun yeni değeriyle yeniden kurulur
  const [t, setT] = useState<{ kind: BranchKind; posSource: BranchPosSource }>({ kind: branch.kind, posSource: branch.posSource });
  const [soru, setSoru] = useState(false);
  /** Sunucunun sorduğu AsilPOS'tan ModPOS'a dönüş onayı (posOffConfirmText) */
  const [posOff, setPosOff] = useState<string | null>(null);
  const [bekliyor, basla] = useActionTransition();
  const sabit = FIXED_BRANCH_IDS.includes(branch.id);
  const degisti = t.kind !== branch.kind || t.posSource !== branch.posSource;
  const hata = degisti ? branchChangeError(branch, { kind: t.kind, posSource: t.posSource, active: branch.active }, others(rows, branch.id)) : null;

  /** Tür değişince kasa programı kendiliğinden uyar: online kanalın kasası olmaz (ladmin'in penceresiyle aynı) */
  function turDegis(kind: BranchKind) {
    setT((o) => ({ kind, posSource: kind === "online" ? "yok" : o.posSource === "yok" ? "modpos" : o.posSource }));
  }

  function kaydet(confirmPosOff = false) {
    basla(async () => {
      const r = await updateBranch({ id: branch.id, kind: t.kind, posSource: t.posSource, ...(confirmPosOff ? { confirmPosOff } : {}) });
      if (!r.ok) {
        // Kasası AsilPOS olan şube ModPOS'a dönüyor ve AsilPOS'u kullanıyor: geçiş günü silinecek, sunucu onay ister
        if (!confirmPosOff && r.error.startsWith(POS_OFF_CONFIRM_PREFIX)) {
          setSoru(false);
          return void setPosOff(r.error.slice(POS_OFF_CONFIRM_PREFIX.length).trim());
        }
        return void toast.error(r.error);
      }
      setSoru(false);
      setPosOff(null);
      toast.success(`${branch.name}: kasa programı ${BRANCH_POS_SOURCE_LABEL[t.posSource]}`);
    });
  }

  const etki = programEtkisi(branch.posSource, t.posSource);
  return (
    <Card>
      <CardHeader icon={<Shuffle />} title="Tür ve kasa programı" description="Gün sonunun hangi programdan geldiği. Değiştirmek geçmiş kayıtları silmez." />
      <div className="space-y-4 px-5 pb-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tür" htmlFor="ks-tur" hint={sabit ? "Bu kaydın türü değiştirilemez." : undefined}>
            <Select id="ks-tur" value={t.kind} disabled={sabit || bekliyor} onChange={(e) => turDegis(e.target.value as BranchKind)}>
              {BRANCH_KINDS.map((k) => (
                <option key={k} value={k}>
                  {BRANCH_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Kasa programı" htmlFor="ks-kasa" error={hata}>
            <Select id="ks-kasa" value={t.posSource} disabled={t.kind === "online" || bekliyor} onChange={(e) => setT((o) => ({ ...o, posSource: e.target.value as BranchPosSource }))}>
              {BRANCH_POS_SOURCES.map((p) => (
                <option key={p} value={p}>
                  {BRANCH_POS_SOURCE_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setSoru(true)} disabled={bekliyor || !degisti || !!hata} className="max-sm:w-full">
            Kaydet
          </Button>
          {degisti ? (
            <Button variant="ghost" onClick={() => setT({ kind: branch.kind, posSource: branch.posSource })} disabled={bekliyor} className="max-sm:w-full">
              Vazgeç
            </Button>
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={soru}
        onClose={() => setSoru(false)}
        onConfirm={() => kaydet()}
        pending={bekliyor}
        confirmLabel="Değiştir"
        title="Kasa programı değişsin mi?"
        description={
          <div className="space-y-3">
            <CanliNotu canli={canli} />
            <p>
              {t.kind !== branch.kind ? `Tür: ${BRANCH_KIND_LABEL[branch.kind]} → ${BRANCH_KIND_LABEL[t.kind]}. ` : null}
              Kasa programı: {BRANCH_POS_SOURCE_LABEL[branch.posSource]} → {BRANCH_POS_SOURCE_LABEL[t.posSource]}.
            </p>
            {etki ? <p>{etki}</p> : null}
          </div>
        }
      />
      <ConfirmDialog
        open={posOff !== null}
        onClose={() => setPosOff(null)}
        onConfirm={() => kaydet(true)}
        pending={bekliyor}
        confirmLabel="ModPOS'a dön"
        title="Kasa ModPOS'a dönsün mü?"
        description={posOff ?? ""}
      />
    </Card>
  );
}

/** Silme: yalnız hiç kaydı olmayan şube (yanlış açılan kayıt); verisi olan şube kapatılır */
export function SilKarti({ branch, silinemez, canli }: { branch: BranchRow; silinemez: string | null; canli: string | null }) {
  const router = useRouter();
  const [soru, setSoru] = useState(false);
  const [bekliyor, basla] = useActionTransition();

  function sil() {
    basla(async () => {
      const r = await deleteBranch({ id: branch.id });
      if (!r.ok) return void toast.error(r.error);
      setSoru(false);
      toast.success(`${branch.name} silindi`);
      router.push(YONETIM_YOLU);
    });
  }

  return (
    <Card>
      <CardHeader icon={<Trash2 />} title="Şubeyi sil" description="Yalnız hiç kaydı olmayan şube silinir (yanlış açılan kayıt için). Verisi olan şubeyi silmek yerine kapatın." />
      <div className="space-y-2 px-5 pb-5">
        <Button variant="danger" onClick={() => setSoru(true)} disabled={bekliyor || silinemez !== null} className="max-sm:w-full">
          Şubeyi sil
        </Button>
        {silinemez ? <p className="text-[13px] text-ink-mute">{silinemez}</p> : null}
      </div>
      <ConfirmDialog
        open={soru}
        onClose={() => setSoru(false)}
        onConfirm={sil}
        pending={bekliyor}
        title={`${branch.name} silinsin mi?`}
        description={
          <div className="space-y-3">
            <CanliNotu canli={canli} />
            <p>Şube kaydı silinir; geri alınamaz.</p>
          </div>
        }
      />
    </Card>
  );
}

"use client";

import { Building2, Copy, MonitorDown, Plus, Unlink, UsersRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, NumberInput, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { PasswordInput } from "@/components/ui/password-input";
import {
  CANLI_GUN,
  doluSatirlar,
  ILK_PERSONEL_ETIKET,
  ILK_PERSONEL_ROLLERI,
  ilkPersonelHatasi,
  SERBEST_ONAY,
  type IlkPersonel,
  type IlkPersonelDurumu,
  type IlkPersonelRolu,
} from "@/lib/asilpos/kasa-acilis";
import { gunMetni, kasaDurumMetni, YENI_KURULUM_ONEKI, yeniKurulumOnayi, type KasaDurumu } from "@/lib/asilpos/kasa-durumu";
import {
  BRANCH_ID_MAX,
  BRANCH_KIND_LABEL,
  BRANCH_KINDS,
  BRANCH_NAME_MAX,
  BRANCH_POS_SOURCE_LABEL,
  branchIdError,
  branchSourceError,
  DEFAULT_POS_RATE,
  posRateError,
  suggestBranchId,
  type BranchKind,
  type BranchPosSource,
  type BranchRow,
} from "@/lib/branches";
import { parseNumberTR } from "@/lib/calc/expr";
import { num } from "@/lib/format";
import { isStepUpError, type StepUpConfirm } from "@/lib/step-up";
import type { KurulumSonucu } from "@/server/actions/branches";
import type { ActionResult } from "@/server/actions/util";

/*
 * Şube ekleme (/panel/sube-ekleme; yalnız asıl yönetici; docs/SUBE.md › Şube ekleme). Yeni şube formu (isteğe bağlı ilk
 * personeliyle), fiziksel şubelerin kasa durumu (src/lib/asilpos/kasa-durumu.ts), "Bilgisayara kur" (kurulum bağlantısı;
 * kurulu kasa varsa önce onay), "İlk personeli ayarla" ve "Kasayı serbest bırak" (docs/ASILPOS.md › Kasa açılışı).
 * Kurallar saf dosyalardan okunur, sunucu aynısını denetler. PIN'ler yalnız formda durur: sunucu onları geri vermez,
 * ekranda yalnız "ayarlı" ya da "teslim edildi" görünür.
 */

export type CreateAction = (input: {
  id: string;
  name: string;
  kind: BranchKind;
  posSource: BranchPosSource;
  openedOn: string | null;
  posRate?: number;
  email?: string;
  personel?: IlkPersonel[];
}) => Promise<ActionResult<{ id: string; kurulum: KurulumSonucu | null }>>;

export type InstallAction = (input: { id: string; email?: string; confirmReplace?: boolean }) => Promise<ActionResult<KurulumSonucu>>;
export type StaffAction = (input: { id: string; personel: IlkPersonel[] }) => Promise<ActionResult<{ saved: boolean }>>;
export type ReleaseAction = (input: { id: string; ad: string }, confirm?: StepUpConfirm) => Promise<ActionResult<{ id: string }>>;

/** Serbest bırakma penceresinin bilgisi (sunucuda: son gün sonu ve anahtarın kaynağı) */
export type SerbestBilgisi = { canli: boolean; anahtarOrtamda: boolean };

/** İlk personelin üç satırı (Patron, Müdür, Barista); boş satır gönderilmez */
type PersonelSatiri = { rol: IlkPersonelRolu; ad: string; pin: string };
const BOS_PERSONEL: PersonelSatiri[] = ILK_PERSONEL_ROLLERI.map((r) => ({ rol: r.rol, ad: "", pin: "" }));
const PERSONEL_TONU: Record<IlkPersonelDurumu, "green" | "blue" | "gray"> = { yok: "gray", ayarli: "blue", gonderildi: "blue", teslim: "green" };

/** Yeni şube formunun taslağı; `posRate` yüzde metni ("2", "1,5") */
type Taslak = { name: string; id: string; kind: BranchKind; posSource: BranchPosSource; posRate: string; openedOn: string; email: string };

const oranMetni = (rate: number) => num(rate * 100, 2);
const oranOf = (text: string) => {
  const v = parseNumberTR(text.replace(/%/g, ""));
  return v === null ? Number.NaN : Math.round(v * 100) / 10_000;
};
const BOS: Taslak = { name: "", id: "", kind: "fiziksel", posSource: "asilpos", posRate: oranMetni(DEFAULT_POS_RATE), openedOn: "", email: "" };
const EPOSTA_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DURUM_TONU: Record<KasaDurumu["durum"], "green" | "blue" | "gray"> = { kurulu: "green", bekliyor: "blue", yok: "gray" };

export function SubeEkleme({
  rows,
  emails,
  durum,
  personel,
  serbest,
  girisHesabi,
  createAction,
  installAction,
  staffAction,
  releaseAction,
}: {
  rows: BranchRow[];
  /** Şubelerin kayıtlı e-postası */
  emails: Record<string, string | null>;
  /** Fiziksel şubelerin kasa durumu */
  durum: Record<string, KasaDurumu>;
  /** Fiziksel şubelerin ilk personel durumu (PIN'siz) */
  personel: Record<string, IlkPersonelDurumu>;
  /** Kasası kurulu şubelerin serbest bırakma bilgisi */
  serbest: Record<string, SerbestBilgisi>;
  /** Kasada ladmin girişinde kullanılacak hesap: asıl yöneticinin e-postası */
  girisHesabi: string;
  createAction: CreateAction;
  installAction: InstallAction;
  staffAction: StaffAction;
  releaseAction: ReleaseAction;
}) {
  const subeler = rows.filter((b) => b.kind === "fiziksel").sort((a, b) => Number(b.active) - Number(a.active));
  const [sonuc, setSonuc] = useState<KurulumSonucu | null>(null);
  // "Bilgisayara kur": e-posta penceresi (onaylandıysa `confirmed`) ve kurulu kasanın onayı
  const [kur, setKur] = useState<{ branch: BranchRow; confirmed: boolean } | null>(null);
  const [onay, setOnay] = useState<{ branch: BranchRow; text: string; email?: string } | null>(null);
  /** "İlk personeli ayarla" ve "Kasayı serbest bırak" pencereleri */
  const [ekip, setEkip] = useState<BranchRow | null>(null);
  const [birak, setBirak] = useState<BranchRow | null>(null);
  const [bekliyor, basla] = useActionTransition();

  function kurBasla(b: BranchRow) {
    const d = durum[b.id];
    const text = d ? yeniKurulumOnayi(d) : null;
    if (text) setOnay({ branch: b, text });
    else setKur({ branch: b, confirmed: false });
  }

  function gonder(b: BranchRow, email: string, confirmed: boolean) {
    basla(async () => {
      const r = await installAction({ id: b.id, ...(email.trim() ? { email: email.trim() } : {}), ...(confirmed ? { confirmReplace: true } : {}) });
      if (!r.ok) {
        // Sayfa açıldıktan sonra kasa kuruldu: sunucu onay ister, onaylanınca aynı adresle yeniden gönderilir
        if (!confirmed && r.error.startsWith(YENI_KURULUM_ONEKI)) {
          setKur(null);
          setOnay({ branch: b, text: r.error.slice(YENI_KURULUM_ONEKI.length).trim(), email });
          return;
        }
        toast.error(r.error);
        return;
      }
      setKur(null);
      setOnay(null);
      setSonuc(r.data);
    });
  }

  return (
    <div className="space-y-4">
      <YeniSube createAction={createAction} rows={rows} onKurulum={setSonuc} />

      <Card>
        <CardHeader
          icon={<Building2 />}
          title="Şubeler ve kasaları"
          description="Her fiziksel şubenin AsilPOS kasası: kurulu mu, kurulum bekliyor mu, son gün sonu ne zaman geldi."
        />
        {subeler.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {subeler.map((b) => {
              const d = durum[b.id] ?? { durum: "yok" as const };
              const p = personel[b.id] ?? "yok";
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 pr-3 pl-5 text-sm">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium break-words text-ink">{b.name}</span>
                      <code className="text-[12px] text-ink-mute">{b.id}</code>
                      {b.active ? null : <Badge tone="amber">Kapalı</Badge>}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-soft">
                      <span>Kasa programı: {BRANCH_POS_SOURCE_LABEL[b.posSource]}</span>
                      <Badge tone={DURUM_TONU[d.durum]} dot>
                        {kasaDurumMetni(d)}
                      </Badge>
                    </p>
                    {d.durum === "kurulu" && d.bekleyen ? (
                      <p className="mt-1 text-[13px] text-ink-mute">Yeni kurulum bağlantısı bekliyor · son geçerlilik {gunMetni(d.bekleyen)}</p>
                    ) : null}
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-soft">
                      <Badge tone={PERSONEL_TONU[p]} dot>
                        {ILK_PERSONEL_ETIKET[p]}
                      </Badge>
                    </p>
                  </div>
                  {b.active ? (
                    <div className="flex flex-wrap gap-2 max-sm:w-full">
                      <Button size="sm" variant="secondary" onClick={() => kurBasla(b)} disabled={bekliyor} className="max-sm:w-full">
                        <MonitorDown className="size-4" aria-hidden="true" /> Bilgisayara kur
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setEkip(b)} disabled={bekliyor} className="max-sm:w-full">
                        <UsersRound className="size-4" aria-hidden="true" /> İlk personeli ayarla
                      </Button>
                      {d.durum === "kurulu" ? (
                        <Button size="sm" variant="ghost" onClick={() => setBirak(b)} disabled={bekliyor} className="max-sm:w-full">
                          <Unlink className="size-4" aria-hidden="true" /> Kasayı serbest bırak
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="Henüz fiziksel şube yok" description="Yukarıdaki formdan ilk şubeyi ekleyin." />
        )}
      </Card>

      {kur ? (
        <KurDialog
          key={kur.branch.id}
          branch={kur.branch}
          email={emails[kur.branch.id] ?? ""}
          bekliyor={bekliyor}
          onClose={() => setKur(null)}
          onSend={(email) => gonder(kur.branch, email, kur.confirmed)}
        />
      ) : null}

      <ConfirmDialog
        open={!!onay}
        onClose={() => setOnay(null)}
        onConfirm={() => {
          if (!onay) return;
          // Sunucunun sorduğu onay: adres zaten yazıldı, doğrudan gönderilir; ekranın sorduğu onay: adres penceresi açılır
          if (onay.email !== undefined) gonder(onay.branch, onay.email, true);
          else {
            setKur({ branch: onay.branch, confirmed: true });
            setOnay(null);
          }
        }}
        pending={bekliyor}
        title={`${onay?.branch.name ?? "Şube"}: yeni kurulum`}
        description={onay?.text ?? ""}
        confirmLabel="Yine de kur"
        tone="primary"
      />

      {sonuc ? <KurulumSonucDialog sonuc={sonuc} girisHesabi={girisHesabi} onClose={() => setSonuc(null)} /> : null}

      {ekip ? <PersonelDialog key={ekip.id} branch={ekip} durum={personel[ekip.id] ?? "yok"} staffAction={staffAction} onClose={() => setEkip(null)} /> : null}

      {birak ? (
        <SerbestDialog key={birak.id} branch={birak} bilgi={serbest[birak.id] ?? { canli: false, anahtarOrtamda: false }} releaseAction={releaseAction} onClose={() => setBirak(null)} />
      ) : null}
    </div>
  );
}

/**
 * İlk personelin üç satırı: Patron, Müdür, Barista (kasada Kasiyer / Barista); her biri ad ve PIN (4-6 rakam, üçü
 * farklı, kasanın örnek PIN'leri olamaz). Boş satır gönderilmez
 */
function PersonelAlanlari({ rows, onChange, idPrefix, error }: { rows: PersonelSatiri[]; onChange: (rows: PersonelSatiri[]) => void; idPrefix: string; error: string | null }) {
  const set = (rol: IlkPersonelRolu, patch: Partial<PersonelSatiri>) => onChange(rows.map((r) => (r.rol === rol ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-3">
      {ILK_PERSONEL_ROLLERI.map(({ rol, etiket }) => {
        const r = rows.find((x) => x.rol === rol) ?? { rol, ad: "", pin: "" };
        return (
          <div key={rol} className="grid gap-3 sm:grid-cols-[7rem_1fr_9rem] sm:items-end">
            <p className="text-sm font-medium text-ink sm:pb-2">{etiket}</p>
            <Field label={`${etiket}: ad`} htmlFor={`${idPrefix}-${rol}-ad`}>
              <Input id={`${idPrefix}-${rol}-ad`} value={r.ad} maxLength={40} autoComplete="off" onChange={(e) => set(rol, { ad: e.target.value })} />
            </Field>
            <Field label={`${etiket}: PIN`} htmlFor={`${idPrefix}-${rol}-pin`}>
              <PasswordInput
                id={`${idPrefix}-${rol}-pin`}
                autoComplete="new-password"
                inputMode="numeric"
                maxLength={6}
                value={r.pin}
                onChange={(e) => set(rol, { pin: e.target.value.replace(/\D/g, "") })}
              />
            </Field>
          </div>
        );
      })}
      {error ? <p className="text-[13px] text-bad">{error}</p> : null}
    </div>
  );
}

/** "İlk personeli ayarla": yeni değerler eskisinin yerine geçer; hepsi boş kaydedilirse kayıt silinir */
function PersonelDialog({ branch, durum, staffAction, onClose }: { branch: BranchRow; durum: IlkPersonelDurumu; staffAction: StaffAction; onClose: () => void }) {
  const [rows, setRows] = useState<PersonelSatiri[]>(BOS_PERSONEL);
  const [denendi, setDenendi] = useState(false);
  const [bekliyor, basla] = useActionTransition();
  const dolu = doluSatirlar(rows);
  const hata = dolu.length ? ilkPersonelHatasi(dolu) : null;
  const sil = !dolu.length && durum !== "yok";

  function kaydet() {
    setDenendi(true);
    if (hata || (!dolu.length && !sil)) return;
    basla(async () => {
      const r = await staffAction({ id: branch.id, personel: dolu });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.data.saved ? `${branch.name}: ilk personel ayarlandı` : `${branch.name}: ilk personel silindi`);
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`${branch.name}: ilk personel`}
      description="Kasa bu şubeye bağlanınca patron, müdür ve baristanın hesapları bu ad ve PIN'lerle açılır. PIN'ler panelde şifreli durur, kasaya şifreli gider; kasa aldığını onaylayınca panelden silinir."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={bekliyor}>
            Vazgeç
          </Button>
          <Button onClick={kaydet} disabled={bekliyor || (!dolu.length && !sil)} variant={sil ? "danger" : "primary"}>
            {bekliyor ? "Kaydediliyor…" : sil ? "Kaydı sil" : "Kaydet"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        {durum !== "yok" ? <Notice tone="neutral" size="sm" title={`${ILK_PERSONEL_ETIKET[durum]}. Yeni değerler eskisinin yerine geçer; hepsini boş bırakıp kaydederseniz kayıt silinir.`} /> : null}
        <PersonelAlanlari rows={rows} onChange={setRows} idPrefix="ip" error={denendi ? hata : null} />
      </div>
    </Dialog>
  );
}

/**
 * "Kasayı serbest bırak": şubenin adı yazılır ve parolayla onaylanır. Son günlerde gün sonu gelen (canlı) şubede uyarı
 * belirgin; anahtar ortam değişkenindeyse (eski kurulum) bunu söyler
 */
function SerbestDialog({ branch, bilgi, releaseAction, onClose }: { branch: BranchRow; bilgi: SerbestBilgisi; releaseAction: ReleaseAction; onClose: () => void }) {
  const [ad, setAd] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [bekliyor, basla] = useActionTransition();
  const adTutar = ad.trim().toLocaleLowerCase("tr-TR") === branch.name.trim().toLocaleLowerCase("tr-TR");

  function birak(e: FormEvent) {
    e.preventDefault();
    if (!adTutar || !password) return;
    setError(null);
    basla(async () => {
      const r = await releaseAction({ id: branch.id, ad }, { password });
      if (!r.ok) {
        if (isStepUpError(r.error)) return void setError(r.error);
        return void toast.error(r.error);
      }
      toast.success(`${branch.name}: kasa serbest bırakıldı`, { description: "Yeni bilgisayar şubeyi kasa açılışında seçebilir." });
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${branch.name}: kasayı serbest bırak`}
      description={SERBEST_ONAY}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={bekliyor}>
            Vazgeç
          </Button>
          <Button type="submit" form="serbest-birak" variant="danger" disabled={bekliyor || !adTutar || !password}>
            {bekliyor ? "Bekleyin…" : "Kasayı serbest bırak"}
          </Button>
        </>
      }
    >
      <form id="serbest-birak" onSubmit={birak} className="space-y-4 pb-2">
        {bilgi.canli ? (
          <Notice
            tone="bad"
            size="sm"
            title={`${branch.name} canlı: son ${CANLI_GUN} günde kasadan gün sonu geldi`}
            text="Serbest bırakınca bugünkü kasa gün sonunu ladmin'e gönderemez. Yalnız kasa bilgisayarı değişiyorsa ya da kasa kayıpsa devam edin."
          />
        ) : null}
        {bilgi.anahtarOrtamda ? (
          <Notice
            tone="warn"
            size="sm"
            title="Bu şubenin anahtarı sunucunun ortam değişkeninde (eski kurulum)"
            text="Yeni anahtar panelde saklanır ve ortamdakinin önüne geçer; ortamdaki anahtar bu şube için bir daha kullanılmaz."
          />
        ) : null}
        <p className="text-sm text-ink-soft">Şubenin kasa anahtarı yenilenir, bekleyen kurulum bağlantıları iptal olur. Geri alınamaz: eski kasa yeniden bağlanmak için yeni kurulum ister.</p>
        <Field label={`Onay için şubenin adını yazın: ${branch.name}`} htmlFor="serbest-ad">
          <Input id="serbest-ad" value={ad} autoComplete="off" onChange={(e) => setAd(e.target.value)} />
        </Field>
        <Field label="Parolanız" htmlFor="serbest-pw" error={error}>
          <PasswordInput id="serbest-pw" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={error ? true : undefined} className="h-11 pointer-coarse:h-11" />
        </Field>
      </form>
    </Dialog>
  );
}

/** Yeni şube formu: bugünkü ekleme penceresinin alanları. E-posta yazılırsa (fiziksel) kurulum bağlantısı da gider */
function YeniSube({ createAction, rows, onKurulum }: { createAction: CreateAction; rows: BranchRow[]; onKurulum: (k: KurulumSonucu) => void }) {
  const [t, setT] = useState<Taslak>(BOS);
  const [ekip, setEkip] = useState<PersonelSatiri[]>(BOS_PERSONEL);
  const [denendi, setDenendi] = useState(false);
  const [bekliyor, basla] = useActionTransition();
  const fiziksel = t.kind === "fiziksel";
  const adHata = t.name.trim() ? null : "Şube adı gerekli";
  const idHata = branchIdError(t.id);
  const kaynakHata = branchSourceError(t.kind, t.posSource);
  const oranHata = fiziksel ? posRateError(oranOf(t.posRate)) : null;
  const epostaHata = fiziksel && t.email.trim() && !EPOSTA_RE.test(t.email.trim()) ? "E-posta adresi geçersiz" : null;
  // İlk personel isteğe bağlı: boşsa kasa bugünkü gibi kendi PIN akışını kullanır
  const personel = fiziksel ? doluSatirlar(ekip) : [];
  const personelHata = personel.length ? ilkPersonelHatasi(personel) : null;
  const hata = adHata ?? idHata ?? kaynakHata ?? oranHata ?? epostaHata ?? personelHata;
  // Alan hatası ilk denemeden sonra (boş formda kırmızı yazı yok); kimlik hatası yazılmaya başlayınca
  const goster = (h: string | null, dolu = false) => (denendi || dolu ? h : null);

  function turDegis(kind: BranchKind) {
    setT((o) => ({ ...o, kind, posSource: kind === "online" ? "yok" : o.posSource === "yok" ? "asilpos" : o.posSource }));
  }

  function ekle(e: FormEvent) {
    e.preventDefault();
    setDenendi(true);
    if (hata) return;
    basla(
      async () => {
        const email = fiziksel ? t.email.trim() : "";
        const r = await createAction({
          id: t.id.trim(),
          name: t.name.trim(),
          kind: t.kind,
          posSource: t.posSource,
          openedOn: t.openedOn || null,
          ...(fiziksel ? { posRate: oranOf(t.posRate) } : {}),
          ...(email ? { email } : {}),
          ...(personel.length ? { personel } : {}),
        });
        if (!r.ok) return void toast.error(r.error);
        toast.success(`${t.name.trim()} eklendi`);
        setT(BOS);
        setEkip(BOS_PERSONEL);
        setDenendi(false);
        if (r.data.kurulum) onKurulum(r.data.kurulum);
      },
      { maybeSaved: true },
    );
  }

  return (
    <Card>
      <CardHeader icon={<Plus />} title="Yeni şube" description="Kimlik eklendikten sonra değişmez: kayıtlar ona bağlanır. E-posta yazılırsa kasa kurulum bağlantısı da gider." />
      <form onSubmit={ekle} noValidate className="space-y-4 px-5 pb-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Şube adı" htmlFor="se-ad" error={goster(adHata)}>
            <Input
              id="se-ad"
              value={t.name}
              maxLength={BRANCH_NAME_MAX}
              onChange={(e) => {
                const name = e.target.value;
                setT((o) => ({ ...o, name, id: !o.id || o.id === suggestBranchId(o.name) ? suggestBranchId(name) : o.id }));
              }}
            />
          </Field>
          <Field label="Kimlik" htmlFor="se-id" error={goster(idHata, !!t.id)} hint="Adreste ve kayıtlarda geçer; sonradan değişmez. Küçük harf, rakam ve tire.">
            <Input id="se-id" value={t.id} maxLength={BRANCH_ID_MAX} spellCheck={false} autoCapitalize="none" onChange={(e) => setT((o) => ({ ...o, id: e.target.value }))} />
          </Field>
          <Field label="Tür" htmlFor="se-tur">
            <Select id="se-tur" value={t.kind} onChange={(e) => turDegis(e.target.value as BranchKind)}>
              {BRANCH_KINDS.map((k) => (
                <option key={k} value={k}>
                  {BRANCH_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Kasa programı"
            htmlFor="se-kasa"
            error={goster(kaynakHata)}
            hint={
              fiziksel
                ? "Gün sonu hangi programdan gelir. Şube bugün ModPOS'la çalışıyorsa ModPOS seçin: AsilPOS kurulsa da deneme modunda çalışır, ModPOS çekimi durmaz; AsilPOS'a geçiş sonra Şubeler'de."
                : "Online kanalın kasası yok."
            }
          >
            <Select id="se-kasa" value={t.posSource} disabled={!fiziksel} onChange={(e) => setT((o) => ({ ...o, posSource: e.target.value as BranchPosSource }))}>
              {fiziksel ? (
                <>
                  <option value="asilpos">{BRANCH_POS_SOURCE_LABEL.asilpos}</option>
                  <option value="modpos">{BRANCH_POS_SOURCE_LABEL.modpos}</option>
                </>
              ) : (
                <option value="yok">{BRANCH_POS_SOURCE_LABEL.yok}</option>
              )}
            </Select>
          </Field>
          {fiziksel ? (
            <Field label="Banka POS oranı (%)" htmlFor="se-oran" error={goster(oranHata)} hint="Bankanın kart satışından kestiği oran; sonradan Şubeler'de değişir.">
              <NumberInput id="se-oran" value={t.posRate} onChange={(e) => setT((o) => ({ ...o, posRate: e.target.value }))} />
            </Field>
          ) : null}
          <Field label="Açılış günü" htmlFor="se-acilis" hint="Boş bırakılabilir.">
            <Input id="se-acilis" type="date" value={t.openedOn} onChange={(e) => setT((o) => ({ ...o, openedOn: e.target.value }))} />
          </Field>
          {fiziksel ? (
            <Field
              label="Şubenin e-postası"
              htmlFor="se-eposta"
              error={goster(epostaHata, !!t.email.trim())}
              hint="Yazılırsa şubenin panel hesabı bu adresle açılır ve kasa kurulum bağlantısı buraya gider. Boş bırakılabilir."
              className="sm:col-span-2"
            >
              <Input id="se-eposta" type="email" inputMode="email" autoComplete="off" value={t.email} onChange={(e) => setT((o) => ({ ...o, email: e.target.value }))} />
            </Field>
          ) : null}
        </div>
        {fiziksel ? (
          <fieldset className="space-y-3 rounded-2xl p-4 ring-1 ring-line">
            <legend className="px-1 text-sm font-medium text-ink">İlk personel (isteğe bağlı)</legend>
            <p className="text-[13px] text-ink-soft">
              Kasa bu şubeye bağlanınca patron, müdür ve baristanın hesapları bu ad ve PIN&apos;lerle açılır. PIN&apos;ler panelde şifreli durur ve kasa aldığını onaylayınca silinir. Boş bırakılırsa kasa PIN&apos;leri kendisi sorar.
            </p>
            <PersonelAlanlari rows={ekip} onChange={setEkip} idPrefix="se" error={goster(personelHata)} />
          </fieldset>
        ) : null}
        {rows.length ? <p className="text-xs text-ink-mute">Şu anki şubeler: {rows.map((r) => r.name).join(" · ")}</p> : null}
        <Button type="submit" disabled={bekliyor} className="max-sm:w-full">
          {bekliyor ? "Ekleniyor…" : fiziksel && t.email.trim() ? "Şubeyi ekle ve kurulum gönder" : "Şubeyi ekle"}
        </Button>
      </form>
    </Card>
  );
}

/** "Bilgisayara kur": şubenin e-postası (kayıtlıdan dolar); bağlantı oraya gider */
function KurDialog({ branch, email: kayitli, bekliyor, onClose, onSend }: { branch: BranchRow; email: string; bekliyor: boolean; onClose: () => void; onSend: (email: string) => void }) {
  const [email, setEmail] = useState(kayitli);
  const hata = !email.trim() ? "Şubenin e-postasını yazın" : !EPOSTA_RE.test(email.trim()) ? "E-posta adresi geçersiz" : null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${branch.name}: bilgisayara kur`}
      description="Kurulum bağlantısı 14 gün geçerli, tek kurulumluktur; yenisi eskisini iptal eder."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={bekliyor}>
            Vazgeç
          </Button>
          <Button onClick={() => onSend(email)} disabled={bekliyor || !!hata}>
            {bekliyor ? "Gönderiliyor…" : "Bağlantıyı gönder"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Şubenin e-postası" htmlFor="kur-eposta" error={email.trim() ? hata : null} hint="Kurulum bağlantısı buraya gider; şubenin panel hesabı yoksa bu adresle açılır.">
          <Input id="kur-eposta" type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/**
 * Kurulumun sonucu: şube adı ve kimliği, şubenin e-postası, kasada girişte kullanılacak hesap, indirme bağlantısı ve son
 * geçerliliği, dört adım, e-postanın gidip gitmediği
 */
export function KurulumSonucDialog({ sonuc, girisHesabi, onClose }: { sonuc: KurulumSonucu; girisHesabi: string; onClose: () => void }) {
  const giris = sonuc.girisHesabi || girisHesabi;
  const satirlar: [string, string][] = [
    ["Şube", `${sonuc.branch.name} (${sonuc.branch.id})`],
    ["Şubenin e-postası", sonuc.email],
    ["Kasada giriş hesabı", `${giris} (asıl yönetici)`],
    ["Son geçerlilik", gunMetni(sonuc.expiresAt)],
  ];
  return (
    <Dialog open onClose={onClose} title={`${sonuc.branch.name}: kasa kurulumu`} footer={<Button onClick={onClose}>Tamam</Button>}>
      <div className="space-y-4 pb-2 text-sm">
        {sonuc.mailError ? (
          <Notice tone="warn" size="sm" title="E-posta gitmedi" text={`Bağlantıyı kopyalayıp şubeye kendiniz iletin. Neden: ${sonuc.mailError}`} />
        ) : (
          <Notice tone="good" size="sm" title={`Kurulum bağlantısı ${sonuc.email} adresine gönderildi`} />
        )}
        <dl className="grid gap-x-4 gap-y-2 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line sm:grid-cols-[auto_1fr]">
          {satirlar.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-[13px] text-ink-mute">{k}</dt>
              <dd className="min-w-0 wrap-anywhere text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="space-y-2">
          <code className="block rounded-lg bg-surface-soft p-3 text-[12px] break-all text-ink">{sonuc.link}</code>
          <Button
            variant="secondary"
            size="sm"
            className="max-sm:w-full"
            onClick={() => {
              void navigator.clipboard?.writeText(sonuc.link).then(
                () => toast.success("Bağlantı kopyalandı"),
                () => toast.error("Kopyalanamadı"),
              );
            }}
          >
            <Copy className="size-4" aria-hidden="true" /> Bağlantıyı kopyala
          </Button>
        </div>
        <ol className="list-decimal space-y-1.5 pl-5 text-ink-soft">
          <li>Bağlantıyı kasa bilgisayarında açın ve dosyayı indirin.</li>
          <li>İnen dosyayı çalıştırın; AsilPOS kurulur ve açılır.</li>
          <li>Kasa ilk açılışta bu şubeye kendiliğinden bağlanır ve deneme modunda başlar.</li>
          <li>Gerçek kullanıma geçerken kasa ladmin girişi isterse {giris} hesabıyla girin.</li>
        </ol>
        {sonuc.account === "acildi" ? <p className="text-[13px] text-ink-mute">Şubenin panel hesabı açıldı; davet bağlantısı aynı e-postada.</p> : null}
      </div>
    </Dialog>
  );
}

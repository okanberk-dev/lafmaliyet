"use client";

import { Building2, Copy, MonitorDown, Plus } from "lucide-react";
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
import type { KurulumSonucu } from "@/server/actions/branches";
import type { ActionResult } from "@/server/actions/util";

/*
 * Şube ekleme (/panel/sube-ekleme; yalnız asıl yönetici; docs/SUBE.md › Şube ekleme). Üç bölüm: yeni şube formu,
 * fiziksel şubelerin kasa durumu (src/lib/asilpos/kasa-durumu.ts) ve "Bilgisayara kur" (kurulum bağlantısı; kurulu kasa
 * varsa önce onay). Kurallar saf dosyalardan okunur, sunucu aynısını denetler.
 */

export type CreateAction = (input: {
  id: string;
  name: string;
  kind: BranchKind;
  posSource: BranchPosSource;
  openedOn: string | null;
  posRate?: number;
  email?: string;
}) => Promise<ActionResult<{ id: string; kurulum: KurulumSonucu | null }>>;

export type InstallAction = (input: { id: string; email?: string; confirmReplace?: boolean }) => Promise<ActionResult<KurulumSonucu>>;

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
  girisHesabi,
  createAction,
  installAction,
}: {
  rows: BranchRow[];
  /** Şubelerin kayıtlı e-postası */
  emails: Record<string, string | null>;
  /** Fiziksel şubelerin kasa durumu */
  durum: Record<string, KasaDurumu>;
  /** Kasada ladmin girişinde kullanılacak hesap: asıl yöneticinin e-postası */
  girisHesabi: string;
  createAction: CreateAction;
  installAction: InstallAction;
}) {
  const subeler = rows.filter((b) => b.kind === "fiziksel").sort((a, b) => Number(b.active) - Number(a.active));
  const [sonuc, setSonuc] = useState<KurulumSonucu | null>(null);
  // "Bilgisayara kur": e-posta penceresi (onaylandıysa `confirmed`) ve kurulu kasanın onayı
  const [kur, setKur] = useState<{ branch: BranchRow; confirmed: boolean } | null>(null);
  const [onay, setOnay] = useState<{ branch: BranchRow; text: string; email?: string } | null>(null);
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
                  </div>
                  {b.active ? (
                    <Button size="sm" variant="secondary" onClick={() => kurBasla(b)} disabled={bekliyor} className="max-sm:w-full">
                      <MonitorDown className="size-4" aria-hidden="true" /> Bilgisayara kur
                    </Button>
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
    </div>
  );
}

/** Yeni şube formu: bugünkü ekleme penceresinin alanları. E-posta yazılırsa (fiziksel) kurulum bağlantısı da gider */
function YeniSube({ createAction, rows, onKurulum }: { createAction: CreateAction; rows: BranchRow[]; onKurulum: (k: KurulumSonucu) => void }) {
  const [t, setT] = useState<Taslak>(BOS);
  const [denendi, setDenendi] = useState(false);
  const [bekliyor, basla] = useActionTransition();
  const fiziksel = t.kind === "fiziksel";
  const adHata = t.name.trim() ? null : "Şube adı gerekli";
  const idHata = branchIdError(t.id);
  const kaynakHata = branchSourceError(t.kind, t.posSource);
  const oranHata = fiziksel ? posRateError(oranOf(t.posRate)) : null;
  const epostaHata = fiziksel && t.email.trim() && !EPOSTA_RE.test(t.email.trim()) ? "E-posta adresi geçersiz" : null;
  const hata = adHata ?? idHata ?? kaynakHata ?? oranHata ?? epostaHata;
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
        });
        if (!r.ok) return void toast.error(r.error);
        toast.success(`${t.name.trim()} eklendi`);
        setT(BOS);
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

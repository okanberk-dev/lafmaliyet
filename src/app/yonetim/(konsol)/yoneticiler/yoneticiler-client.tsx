"use client";

import { ExternalLink, KeyRound, LockOpen, LogOut, Power, Send, ShieldCheck, ShieldOff, Trash2, UserMinus, UserPlus, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { generatePassword, linkReason, type AccessInfo } from "@/app/panel/kullanicilar/access";
import { AccessSheet } from "@/app/panel/kullanicilar/access-sheet";
import { CloseGuardFooter } from "@/app/panel/kullanicilar/close-guard";
import { PasswordField } from "@/app/panel/kullanicilar/password-field";
import { STEP_UP_CLOSING, stepUpText, type StepUpText } from "@/app/panel/kullanicilar/step-up-text";
import type { UserRow } from "@/app/panel/kullanicilar/users-client";
import { ConfirmPasswordDialog } from "@/components/panel/confirm-password-dialog";
import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { Avatar } from "@/components/ui/icon-tile";
import { EmptyState } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { ToggleRow } from "@/components/ui/toggle-row";
import { twoFactorRequiredFor } from "@/lib/admin-security";
import { ASIL_YONETICI } from "@/lib/asil-yonetici";
import { ROLES, type Role } from "@/lib/constants";
import { passwordProblem } from "@/lib/password-rules";
import { isStepUpError, type StepUpConfirm } from "@/lib/step-up";
import { createAccessLink } from "@/server/actions/invites";
import { createUser, deleteUser, resetUserTwoFactor, saveUser, setUserActive, signOutUserEverywhere, unlockUser } from "@/server/actions/settings";

/*
 * Yönetim konsolu › Yöneticiler (docs/ROLLER.md › Yönetici hesapları). Küçük bir liste: ladmin › Kullanıcılar'ın büyük
 * bileşeni taşınmaz, ondan yalnız ortak parçalar alınır ("Giriş bilgileri" penceresi, parola alanı, onay metinleri,
 * pencere koruması). Eylemler var olan sunucu eylemleridir; yönetici hesabına dokunan her iş parola onayıyla çalışır
 * (kural src/lib/step-up.ts; sunucu aynı kuralı ve asıl yönetici kapısını yeniden denetler). Asıl yöneticinin kendi
 * satırında yıkıcı işlem yok: kendi hesabı ladmin › Hesabım'da.
 */

type AltRol = Exclude<Role, "admin">;

/** Yöneticiliği verilebilecek hesap: müdür, muhasebeci ya da personel ("Yöneticilik ver" e-postasıyla bulur) */
export interface AdayHesap {
  id: number;
  name: string;
  email: string;
  role: AltRol;
  active: boolean;
  branchId: string | null;
}
const ALT_ROLLER: readonly AltRol[] = ["manager", "accountant", "staff"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TAP = "h-11 pointer-coarse:h-11";

/** Parola isteyen işler: her biri yönetici hesabına dokunur */
type Soru =
  | { tur: "erisim"; u: UserRow; active: boolean }
  | { tur: "baglanti"; u: UserRow }
  | { tur: "ikiAdim"; u: UserRow }
  | { tur: "sil"; u: UserRow }
  | { tur: "al"; u: UserRow; role: AltRol; branchId: string | null }
  | { tur: "ver"; a: AdayHesap }
  | { tur: "ekle"; name: string; email: string; mode: "password" | "invite"; password: string; active: boolean };

const close = (...cumleler: string[]) => [...cumleler, STEP_UP_CLOSING].join(" ");

/** Asıl yöneticinin kendi hesabı: iki adımlı açık mı, kalan kurtarma kodu (kendi hesabı ladmin › Hesabım'da) */
export function HesapDurumu({ ikiAdim, kalanKod, hesabim }: { ikiAdim: boolean; kalanKod: number; hesabim: string }) {
  const baglanti = (
    <a href={hesabim} className={buttonClass("secondary", "sm")}>
      ladmin › Hesabım <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );
  return (
    <Card>
      <CardHeader
        icon={<ShieldCheck />}
        title="Hesabınız"
        description="Parola, iki adımlı doğrulama, kurtarma kodları ve oturumlarınız ladmin › Hesabım'da."
        actions={baglanti}
        actionsClassName="max-sm:w-full"
      />
      <div className="px-5 pb-5">
        {!ikiAdim ? (
          <Notice
            tone="warn"
            size="sm"
            title="İki adımlı doğrulama kapalı"
            text="Yönetici hesaplarını yalnız siz yönettiğiniz için hesabınızda açmanız önerilir: ladmin › Hesabım › İki adımlı doğrulama."
          />
        ) : kalanKod <= 2 ? (
          <Notice
            tone="warn"
            size="sm"
            title={`İki adımlı doğrulama açık · ${kalanKod} kurtarma kodu kaldı`}
            text="Telefonunuz kaybolursa girişte bu kodlar kullanılır. ladmin › Hesabım'dan yeni kodlar alın."
          />
        ) : (
          <Notice tone="good" size="sm" title={`İki adımlı doğrulama açık · ${kalanKod} kurtarma kodu kaldı`} />
        )}
      </div>
    </Card>
  );
}

export function Yoneticiler({
  meId,
  yoneticiler,
  adaylar,
  subeler,
  emailConfigured,
  twoFactorRequired,
  hesabim,
}: {
  meId: number;
  yoneticiler: UserRow[];
  adaylar: AdayHesap[];
  subeler: { id: string; name: string }[];
  emailConfigured: boolean;
  twoFactorRequired: boolean;
  hesabim: string;
}) {
  const [secili, setSecili] = useState<number | null>(null);
  const [ekle, setEkle] = useState(false);
  const [ver, setVer] = useState(false);
  const [giris, setGiris] = useState<AccessInfo | null>(null);
  const [soru, setSoru] = useState<Soru | null>(null);
  const [cikis, setCikis] = useState<UserRow | null>(null);
  const [bekliyor, basla] = useActionTransition();
  // Sayfa yenilenince pencere kişinin güncel hâlini görsün
  const acik = secili === null ? null : (yoneticiler.find((u) => u.id === secili) ?? null);

  /** Parola penceresinin metni (onay metinleri ladmin › Kullanıcılar'la aynı) */
  function metin(q: Soru): StepUpText {
    switch (q.tur) {
      case "erisim":
        return stepUpText({ kind: "toggle", name: q.u.name, active: q.active, invite: q.u.invite });
      case "baglanti":
        return stepUpText({ kind: "link", user: q.u });
      case "ikiAdim":
        return stepUpText({ kind: "2fa", required: twoFactorRequiredFor("admin", twoFactorRequired) });
      case "sil":
        return stepUpText({ kind: "delete", name: q.u.name });
      case "ekle":
        return stepUpText({ kind: "create", name: q.name, mode: q.mode });
      case "al":
        return {
          title: `${q.u.name} yöneticilikten alınsın mı?`,
          description: close(`${q.u.name} artık yönetici olmayacak; rolü ${ROLES[q.role]} olur ve açık oturumları kapanır.`),
          confirmLabel: "Yöneticiliği al",
          danger: true,
        };
      case "ver":
        return {
          title: `${q.a.name} yönetici yapılsın mı?`,
          description: close(`${q.a.name} (${ROLES[q.a.role]}) yönetici olacak: maliyet, kâr, ayarlar ve kullanıcılar dahil her şeyi görür. Açık oturumları kapanır.`),
          confirmLabel: "Yönetici yap",
          danger: false,
        };
    }
  }

  /**
   * Parolayla onaylanan işi çalıştırır. Parola hatası pencerede kalır (dönen metin alanın altında); başka hata pencereyi
   * kapatıp bildirim olarak görünür. Atılan eylem (ağ kesildi) ConfirmPasswordDialog'da yakalanır
   */
  async function onayla(q: Soru, confirm: StepUpConfirm): Promise<string | null> {
    let hata: string | null = null;
    switch (q.tur) {
      case "erisim": {
        const r = await setUserActive(q.u.id, q.active, confirm);
        if (r.ok) toast.success(q.active ? `${q.u.name} yeniden aktif` : `${q.u.name} pasif yapıldı`);
        else hata = r.error;
        break;
      }
      case "baglanti": {
        const r = await createAccessLink(q.u.id, confirm);
        if (r.ok) setGiris({ ...r.data, reason: linkReason(r.data.kind === "invite" ? "invite" : "reset", q.u.liveLink !== null) });
        else hata = r.error;
        break;
      }
      case "ikiAdim": {
        const r = await resetUserTwoFactor(q.u.id, confirm);
        if (r.ok) toast.success("İki adımlı doğrulama kapatıldı");
        else hata = r.error;
        break;
      }
      case "sil": {
        const r = await deleteUser(q.u.id, confirm);
        if (r.ok) toast.success(`${q.u.name} silindi`);
        else hata = r.error;
        break;
      }
      case "al": {
        const { u } = q;
        const seen = { name: u.name, email: u.email, role: u.role, active: u.active, branchId: null };
        const r = await saveUser({ id: u.id, name: u.name, email: u.email, role: q.role, active: u.active, branchId: q.branchId, seen }, confirm);
        if (r.ok) toast.success(`${u.name} artık ${ROLES[q.role]}`);
        else hata = r.error;
        break;
      }
      case "ver": {
        const { a } = q;
        const seen = { name: a.name, email: a.email, role: a.role, active: a.active, branchId: a.branchId };
        const r = await saveUser({ id: a.id, name: a.name, email: a.email, role: "admin", active: a.active, branchId: null, seen }, confirm);
        if (r.ok) toast.success(`${a.name} yönetici yapıldı`);
        else hata = r.error;
        break;
      }
      case "ekle": {
        const payload =
          q.mode === "password"
            ? ({ mode: "password", name: q.name, email: q.email, role: "admin", active: q.active, password: q.password, branchId: null } as const)
            : ({ mode: "invite", name: q.name, email: q.email, role: "admin", active: true, branchId: null } as const);
        const r = await createUser(payload, confirm);
        if (r.ok) setGiris(q.mode === "password" ? { ...r.data, password: q.password, reason: "new" } : { ...r.data, reason: "new" });
        else hata = r.error;
        break;
      }
    }
    if (hata && isStepUpError(hata)) return hata;
    if (hata) toast.error(hata);
    else {
      setSecili(null);
      if (q.tur === "ekle") setEkle(false);
      if (q.tur === "ver") setVer(false);
    }
    setSoru(null);
    return null;
  }

  /** Parola istemeyen savunma araçları: kilidi aç, oturumları kapat (ladmin'deki gibi) */
  function kilidiAc(u: UserRow) {
    basla(async () => {
      const r = await unlockUser(u.id);
      if (r.ok) toast.success("Hesap kilidi açıldı");
      else toast.error(r.error);
    });
  }
  function oturumlariKapat(u: UserRow) {
    setCikis(null);
    basla(async () => {
      const r = await signOutUserEverywhere(u.id);
      if (r.ok) toast.success("Oturumları kapatıldı");
      else toast.error(r.error);
    });
  }

  const istek = soru ? metin(soru) : null;
  return (
    <Card id="yoneticiler">
      <CardHeader
        icon={<Users />}
        title="Yönetici hesapları"
        description="Yönetici her şeyi görür ve değiştirir. Yeni yönetici ekleyin, var olan bir hesaba yöneticilik verin ya da bir yöneticinin hesabını yönetin. Her işlem kendi parolanızı ister."
        actions={
          <div className="flex flex-wrap gap-2 max-sm:w-full">
            <Button onClick={() => setEkle(true)} className="max-sm:flex-1">
              <UserPlus size={16} /> Yönetici ekle
            </Button>
            <Button variant="secondary" onClick={() => setVer(true)} className="max-sm:flex-1">
              <KeyRound size={16} /> Yöneticilik ver
            </Button>
          </div>
        }
        actionsClassName="max-sm:w-full"
      />
      {yoneticiler.length ? (
        <ul className="divide-y divide-line border-t border-line" aria-label="Yöneticiler">
          {yoneticiler.map((u) => {
            const ben = u.id === meId;
            return (
              <li key={u.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5${u.active ? "" : " opacity-70"}`}>
                <Avatar name={u.name} />
                <div className="min-w-0 flex-1 basis-56">
                  <p className="font-medium break-words text-ink">
                    {u.name}
                    {ben ? <span className="ml-1.5 text-xs font-normal text-ink-mute">(siz)</span> : null}
                  </p>
                  <p className="text-[13px] wrap-anywhere text-ink-mute">{u.email}</p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    {u.anaAdmin ? <Badge tone="violet">{ASIL_YONETICI}</Badge> : null}
                    <Durum u={u} />
                    {u.invite === "none" ? <IkiAdim on={u.twoFactor} /> : null}
                    <span className="text-xs text-ink-mute tabular">{sonGiris(u)}</span>
                  </p>
                </div>
                {ben ? (
                  <a href={hesabim} className={buttonClass("ghost", "sm", "max-sm:w-full")}>
                    Kendi hesabınız: ladmin › Hesabım <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                ) : (
                  <Button variant="secondary" size="sm" className={`${TAP} max-sm:w-full sm:pointer-fine:h-9`} onClick={() => setSecili(u.id)} aria-label={`${u.name}: işlemler`}>
                    İşlemler
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={<Users />} title="Yönetici yok" />
      )}
      {acik ? (
        <YoneticiPenceresi
          u={acik}
          subeler={subeler}
          bekliyor={bekliyor}
          onClose={() => setSecili(null)}
          onSoru={setSoru}
          onKilit={() => kilidiAc(acik)}
          onCikis={() => setCikis(acik)}
        />
      ) : null}
      {ekle ? <YoneticiEkle onClose={() => setEkle(false)} onSoru={setSoru} /> : null}
      {ver ? <YoneticilikVer adaylar={adaylar} yoneticiler={yoneticiler} onClose={() => setVer(false)} onSoru={setSoru} /> : null}
      {giris ? <AccessSheet info={giris} emailConfigured={emailConfigured} onClose={() => setGiris(null)} /> : null}
      <ConfirmDialog
        open={cikis !== null}
        onClose={() => setCikis(null)}
        onConfirm={() => cikis && oturumlariKapat(cikis)}
        title={cikis ? `${cikis.name}: bütün oturumları kapatılsın mı?` : ""}
        description="Bütün cihazlarda çıkış yapar ve yeniden giriş yapması gerekir."
        confirmLabel="Oturumları kapat"
        pending={bekliyor}
      />
      {soru && istek ? (
        <ConfirmPasswordDialog
          title={istek.title}
          description={istek.description}
          confirmLabel={istek.confirmLabel}
          danger={istek.danger}
          onClose={() => setSoru(null)}
          onConfirm={(password) => onayla(soru, { password })}
        />
      ) : null}
    </Card>
  );
}

function sonGiris(u: UserRow) {
  if (u.invite === "pending") return "Davet bekliyor";
  if (u.invite === "expired") return "Davet süresi doldu";
  return `Son giriş: ${u.lastLoginAt ?? "hiç girmedi"}`;
}

function Durum({ u }: { u: UserRow }) {
  if (u.locked)
    return (
      <Badge dot tone="red">
        {u.locked === "device" ? "Bir cihazda kilitli" : "Kilitli"}
      </Badge>
    );
  if (!u.active)
    return (
      <Badge dot tone="gray">
        Pasif
      </Badge>
    );
  if (u.invite !== "none")
    return (
      <Badge dot tone="amber">
        {u.invite === "pending" ? "Davet bekliyor" : "Davet süresi doldu"}
      </Badge>
    );
  return (
    <Badge dot tone="green">
      Aktif
    </Badge>
  );
}

function IkiAdim({ on }: { on: boolean }) {
  return on ? (
    <span className="inline-flex items-center gap-1 text-[13px] font-medium whitespace-nowrap text-good-ink">
      <ShieldCheck size={15} aria-hidden /> İki adımlı açık
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[13px] whitespace-nowrap text-ink-mute">
      <ShieldOff size={15} aria-hidden /> İki adımlı kapalı
    </span>
  );
}

/** Bir yöneticinin işlemleri (asıl yöneticinin kendi satırında açılmaz) */
function YoneticiPenceresi({
  u,
  subeler,
  bekliyor,
  onClose,
  onSoru,
  onKilit,
  onCikis,
}: {
  u: UserRow;
  subeler: { id: string; name: string }[];
  bekliyor: boolean;
  onClose: () => void;
  onSoru: (q: Soru) => void;
  onKilit: () => void;
  onCikis: () => void;
}) {
  const [rol, setRol] = useState<AltRol | null>(null);
  const [sube, setSube] = useState("");
  const davetli = u.invite !== "none";
  const btn = `${TAP} w-full justify-start sm:pointer-fine:h-9`;
  const subeGerekli = rol === "manager";

  function al(e: FormEvent) {
    e.preventDefault();
    if (!rol) return;
    if (subeGerekli && !sube) return void toast.error("Müdürün şubesini seçin");
    onSoru({ tur: "al", u, role: rol, branchId: rol === "accountant" ? null : sube || null });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={u.name}
      description={u.email}
      footerStart={
        <Button variant="ghost" className={`${TAP} text-bad hover:bg-bad-soft hover:text-bad sm:pointer-fine:h-9`} disabled={bekliyor} onClick={() => onSoru({ tur: "sil", u })}>
          <Trash2 size={15} /> Sil
        </Button>
      }
      footer={
        <Button variant="ghost" onClick={onClose} className="max-sm:h-11">
          Kapat
        </Button>
      }
    >
      <div className="space-y-4 pb-2">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <Durum u={u} />
          {davetli ? null : <IkiAdim on={u.twoFactor} />}
          <span className="text-xs text-ink-mute tabular">{sonGiris(u)}</span>
        </p>
        {u.liveLink ? (
          <p className="text-xs leading-5 text-ink-mute">
            Geçerli bir {u.liveLink.kind === "invite" ? "davet" : "sıfırlama"} bağlantısı var (son geçerlilik {u.liveLink.until}); yenisi onu iptal eder.
          </p>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {u.active ? (
            <Button variant="secondary" className={btn} disabled={bekliyor} onClick={() => onSoru({ tur: "baglanti", u })}>
              <Send size={15} /> {davetli ? "Davet bağlantısını yenile" : "Giriş bağlantısı oluştur"}
            </Button>
          ) : null}
          {u.locked ? (
            <Button variant="secondary" className={btn} disabled={bekliyor} onClick={onKilit}>
              <LockOpen size={15} /> Kilidi aç
            </Button>
          ) : null}
          {u.twoFactor ? (
            <Button variant="secondary" className={btn} disabled={bekliyor} onClick={() => onSoru({ tur: "ikiAdim", u })}>
              <ShieldOff size={15} /> İki adımlıyı sıfırla
            </Button>
          ) : null}
          {davetli ? null : (
            <Button variant="secondary" className={btn} disabled={bekliyor} onClick={onCikis}>
              <LogOut size={15} /> Oturumlarını kapat
            </Button>
          )}
          <Button variant="secondary" className={btn} disabled={bekliyor} onClick={() => onSoru({ tur: "erisim", u, active: !u.active })}>
            <Power size={15} /> {u.active ? "Pasif yap (kapat)" : "Yeniden aktif yap (aç)"}
          </Button>
        </div>
        <form onSubmit={al} className="space-y-3 rounded-2xl bg-panel p-3">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink-soft">
            <UserMinus size={15} aria-hidden /> Yöneticiliği al
          </p>
          <Field label="Yeni rolü" htmlFor="yk-rol">
            <Select id="yk-rol" value={rol ?? ""} onChange={(e) => setRol((e.target.value || null) as AltRol | null)}>
              <option value="">Rol seçin</option>
              {ALT_ROLLER.map((r) => (
                <option key={r} value={r}>
                  {ROLES[r]}
                </option>
              ))}
            </Select>
          </Field>
          {rol === "manager" || rol === "staff" ? (
            <Field
              label="Şube"
              htmlFor="yk-sube"
              hint={subeGerekli ? "Müdür yalnız bu şubeyi görür ve yönetir. Zorunlu." : "Personel paneli bu şubede açar. Bütün şubeler: kişi şubeyi kendisi seçer."}
            >
              <Select id="yk-sube" value={sube} onChange={(e) => setSube(e.target.value)} required={subeGerekli}>
                <option value="">{subeGerekli ? "Şube seçin" : "Bütün şubeler"}</option>
                {subeler.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Button type="submit" variant="secondary" disabled={!rol || bekliyor} className="max-sm:w-full">
            Yöneticiliği al
          </Button>
        </form>
      </div>
    </Dialog>
  );
}

/** Yönetici ekle: ladmin'deki "Kullanıcı ekle"nin akışı, rol yönetici (parolayı siz belirleyin ya da davet bağlantısı) */
function YoneticiEkle({ onClose, onSoru }: { onClose: () => void; onSoru: (q: Soru) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<"password" | "invite">("password");
  const [password, setPassword] = useState(() => generatePassword());
  const [active, setActive] = useState(true);
  const [hata, setHata] = useState<{ name?: string; email?: string; password?: string }>({});
  const [sor, setSor] = useState(false);
  const kirli = Boolean(name.trim() || email.trim());

  function gonder(e: FormEvent) {
    e.preventDefault();
    const h: typeof hata = {};
    if (!name.trim()) h.name = "Adı yazın";
    if (!EMAIL_RE.test(email.trim())) h.email = "Geçerli bir e-posta girin";
    if (mode === "password") h.password = passwordProblem(password, email) ?? undefined;
    setHata(h);
    if (h.name || h.email || h.password) return;
    onSoru({ tur: "ekle", name: name.trim(), email: email.trim().toLowerCase(), mode, password, active: mode === "password" ? active : true });
  }

  return (
    <Dialog
      open
      onClose={() => (kirli ? setSor(true) : onClose())}
      title="Yönetici ekle"
      description="Kişi, parola ya da davet bağlantısı. Eklerken kendi parolanız sorulur."
      footer={
        sor ? (
          <CloseGuardFooter
            title="Form kapatılsın mı?"
            description="Yazdığınız ad ve e-posta silinir; yönetici eklenmez."
            confirmLabel="Kapat ve sil"
            onStay={() => setSor(false)}
            onLeave={onClose}
          />
        ) : (
          <>
            <Button variant="ghost" onClick={() => (kirli ? setSor(true) : onClose())} className="max-sm:h-11">
              Vazgeç
            </Button>
            <Button type="submit" form="yonetici-ekle" className="max-sm:h-11 max-sm:flex-1">
              {mode === "password" ? "Yöneticiyi ekle" : "Ekle ve bağlantı oluştur"}
            </Button>
          </>
        )
      }
    >
      <form id="yonetici-ekle" onSubmit={gonder} noValidate className="space-y-4 pb-2">
        <Field label="Ad" htmlFor="ye-ad" error={hata.name}>
          <Input id="ye-ad" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={80} className={TAP} />
        </Field>
        <Field label="Giriş e-postası" htmlFor="ye-eposta" error={hata.email} hint={hata.email ? undefined : "Kişi ladmin'e bu adresle girer."}>
          <Input id="ye-eposta" type="email" inputMode="email" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" className={TAP} />
        </Field>
        <Segmented<"password" | "invite">
          value={mode}
          onChange={setMode}
          label="Parola"
          stretch
          options={[
            { value: "password", label: "Parolayı ben belirleyeyim" },
            { value: "invite", label: "Davet bağlantısı" },
          ]}
        />
        {mode === "password" ? (
          <>
            <PasswordField id="ye-parola" label="Parola" error={hata.password} value={password} email={email} initiallyVisible onChange={setPassword} />
            <ToggleRow title="Aktif (giriş yapabilir)" label="Aktif (giriş yapabilir)" checked={active} onChange={setActive} />
          </>
        ) : (
          <p className="rounded-2xl bg-panel px-3.5 py-3 text-[13px] leading-5 text-ink-soft">
            Eklediğinizde tek kullanımlık bağlantı oluşur (72 saat); kişi parolasını kendisi belirler. Bağlantıyı sonraki ekrandan iletirsiniz.
          </p>
        )}
      </form>
    </Dialog>
  );
}

/** Var olan bir hesaba (müdür, muhasebeci, personel) yöneticilik vermek: hesap e-postasıyla bulunur */
function YoneticilikVer({
  adaylar,
  yoneticiler,
  onClose,
  onSoru,
}: {
  adaylar: AdayHesap[];
  yoneticiler: UserRow[];
  onClose: () => void;
  onSoru: (q: Soru) => void;
}) {
  const [email, setEmail] = useState("");
  const aranan = email.trim().toLowerCase();
  const aday = aranan ? (adaylar.find((a) => a.email.toLowerCase() === aranan) ?? null) : null;
  const zaten = aranan ? yoneticiler.some((u) => u.email.toLowerCase() === aranan) : false;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Yöneticilik ver"
      description="Hesabın giriş e-postasını yazın. Onaylarken kendi parolanız sorulur."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className="max-sm:h-11">
            Vazgeç
          </Button>
          <Button disabled={!aday} onClick={() => aday && onSoru({ tur: "ver", a: aday })} className="max-sm:h-11 max-sm:flex-1">
            Yönetici yap
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-2">
        <Field label="Giriş e-postası" htmlFor="yv-eposta">
          <Input
            id="yv-eposta"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            placeholder="ayse@laffogato.net"
            className={TAP}
          />
        </Field>
        <div aria-live="polite">
          {aday ? (
            <Notice
              tone="neutral"
              size="sm"
              title={`${aday.name} · ${ROLES[aday.role]}${aday.active ? "" : " · pasif"}`}
              text="Yönetici olunca bütün şubeleri görür; şube bağlantısı kalkar."
            />
          ) : zaten ? (
            <Notice tone="neutral" size="sm" title="Bu hesap zaten yönetici." />
          ) : aranan && EMAIL_RE.test(aranan) ? (
            <Notice tone="warn" size="sm" title="Bu e-postayla müdür, muhasebeci ya da personel hesabı yok." text="Yeni bir hesap için Yönetici ekle'yi kullanın." />
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

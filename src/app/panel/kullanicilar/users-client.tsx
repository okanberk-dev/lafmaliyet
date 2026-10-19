"use client";

import { Check, LockOpen, LogOut, Minus, Pencil, ShieldCheck, ShieldOff, UserPlus, Users } from "lucide-react";
import { useMemo, useOptimistic, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, SearchInput } from "@/components/ui/form";
import { Avatar } from "@/components/ui/icon-tile";
import { EmptyState } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ToggleRow } from "@/components/ui/toggle-row";
import { ROLES } from "@/lib/constants";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { resetUserTwoFactor, saveUser, signOutUserEverywhere, unlockUser } from "@/server/actions/settings";

const count = (v: number) => num(Math.round(v), 0);

export type UserRow = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "staff";
  active: boolean;
  lastLoginAt: string | null;
  twoFactor: boolean;
  locked: boolean;
};

type RoleFilter = "all" | "admin" | "staff";

/**
 * AkmanOS "User list": avatar + ad + soluk e-posta, rol rozeti, noktalı durum rozeti, iki adımlı doğrulama, son
 * giriş; satır sonunda aktif/pasif anahtarı ve düzenle. Arama ve rol süzgeci üstte. Pasif yapmak onay ister.
 */
export function UsersEditor({ users, meId }: { users: UserRow[]; meId: number }) {
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);
  const [confirmOff, setConfirmOff] = useState<UserRow | null>(null);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<RoleFilter>("all");
  const [pending, startTransition] = useTransition();
  const [rows, setOptimistic] = useOptimistic(users, (state, p: { id: number; active: boolean }) => state.map((u) => (u.id === p.id ? { ...u, active: p.active } : u)));
  const activeCount = rows.filter((u) => u.active).length;
  const twoFactorCount = rows.filter((u) => u.active && u.twoFactor).length;

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr-TR");
    return rows.filter((u) => (role === "all" || u.role === role) && (!q || `${u.name} ${u.email}`.toLocaleLowerCase("tr-TR").includes(q)));
  }, [rows, query, role]);

  function setActive(u: UserRow, active: boolean) {
    setConfirmOff(null);
    startTransition(async () => {
      setOptimistic({ id: u.id, active });
      const res = await saveUser({ id: u.id, name: u.name, email: u.email, role: u.role, active });
      if (res.ok) toast.success(active ? `${u.name} yeniden aktif` : `${u.name} pasif yapıldı`);
      else toast.error(res.error);
    });
  }

  const addButton = (
    <Button onClick={() => setEditing("new")}>
      <UserPlus size={16} /> Kullanıcı ekle
    </Button>
  );

  return (
    <Card id="kullanicilar">
      <CardHeader
        icon={<Users />}
        title="Kullanıcılar"
        description="E-posta ve parolayı siz belirlersiniz; kişi giriş yaptıktan sonra Hesabım'dan parolasını değiştirip iki adımlı doğrulamayı açabilir."
        meta={
          <>
            <span>Aktif</span>
            <AnimatedNumber value={activeCount} format={count} className="font-semibold text-ink tabular" />
            <span className="text-ink-quiet">/</span>
            <span className="tabular">{rows.length} kullanıcı</span>
            <span className="text-ink-quiet">·</span>
            <span>
              İki adımlı <span className="font-semibold text-ink tabular">{twoFactorCount}</span>
            </span>
          </>
        }
        actions={addButton}
      />
      {rows.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ad ya da e-posta ara"
            aria-label="Kullanıcı ara"
            wrapperClassName="min-w-0 flex-1 sm:max-w-xs"
          />
          <Segmented<RoleFilter>
            value={role}
            onChange={setRole}
            label="Role göre süz"
            options={[
              { value: "all", label: "Hepsi" },
              { value: "admin", label: ROLES.admin },
              { value: "staff", label: ROLES.staff },
            ]}
          />
        </div>
      ) : null}
      {visible.length ? (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>Kullanıcı</TH>
                <TH>Rol</TH>
                <TH>Durum</TH>
                <TH>İki adımlı</TH>
                <TH>Son giriş</TH>
                <TH>
                  <span className="sr-only">Eylemler</span>
                </TH>
              </tr>
            </THead>
            <tbody>
              {visible.map((u) => {
                const me = u.id === meId;
                return (
                  <TR key={u.id} className={cn("cursor-pointer", !u.active && "opacity-60")} onClick={() => setEditing(u)}>
                    <TD>
                      <div className="flex min-w-[12rem] items-center gap-3">
                        <Avatar name={u.name} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">
                            {u.name}
                            {me ? <span className="ml-1.5 text-xs font-normal text-ink-mute">(siz)</span> : null}
                          </p>
                          <p className="truncate text-[13px] text-ink-mute">{u.email}</p>
                        </div>
                      </div>
                    </TD>
                    <TD>
                      <Badge tone={u.role === "admin" ? "solid" : "gray"}>{ROLES[u.role]}</Badge>
                    </TD>
                    <TD>
                      {u.locked ? (
                        <Badge dot tone="red">
                          Kilitli
                        </Badge>
                      ) : (
                        <Badge dot tone={u.active ? "green" : "gray"}>
                          {u.active ? "Aktif" : "Pasif"}
                        </Badge>
                      )}
                    </TD>
                    <TD>
                      {u.twoFactor ? (
                        <span className="inline-flex items-center gap-1 text-[13px] font-medium text-good-ink">
                          <ShieldCheck size={15} aria-hidden /> Açık
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[13px] text-ink-mute">
                          <ShieldOff size={15} aria-hidden /> Kapalı
                        </span>
                      )}
                    </TD>
                    <TD className="text-[13px] whitespace-nowrap text-ink-mute tabular">{u.lastLoginAt ?? "Hiç girmedi"}</TD>
                    <TD>
                      <div className="flex items-center justify-end gap-2">
                        <span title={me ? "Kendi hesabınızı pasif yapamazsınız" : undefined} onClick={(e) => e.stopPropagation()}>
                          <Switch
                            checked={u.active}
                            disabled={me || pending}
                            label={`${u.name} giriş yapabilir`}
                            onChange={(next) => (next ? setActive(u, true) : setConfirmOff(u))}
                          />
                        </span>
                        <IconButton
                          label={`${u.name} kullanıcısını düzenle`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(u);
                          }}
                        >
                          <Pencil size={15} />
                        </IconButton>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      ) : rows.length ? (
        <EmptyState
          icon={<Users />}
          title="Eşleşen kullanıcı yok"
          description="Aramayı ya da rol süzgecini değiştirin."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQuery("");
                setRole("all");
              }}
            >
              Süzgeci temizle
            </Button>
          }
        />
      ) : (
        <EmptyState icon={<Users />} title="Kullanıcı yok" action={addButton} />
      )}
      {editing ? <UserDialog user={editing === "new" ? null : editing} meId={meId} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        open={confirmOff !== null}
        onClose={() => setConfirmOff(null)}
        onConfirm={() => confirmOff && setActive(confirmOff, false)}
        title={confirmOff ? `${confirmOff.name} pasif yapılsın mı?` : ""}
        description="Bu kullanıcı bir daha giriş yapamaz, açık oturumları kapanır. Bilgileri silinmez; istediğiniz zaman yeniden aktif yapabilirsiniz."
        confirmLabel="Pasif yap"
      />
    </Card>
  );
}

const ROLE_OPTIONS: { value: "staff" | "admin"; label: string; hint: string }[] = [
  { value: "staff", label: ROLES.staff, hint: "Stok sayımı + reçete defteri" },
  { value: "admin", label: ROLES.admin, hint: "Her şey (maliyet, kâr, ayarlar dahil)" },
];

function UserDialog({ user, meId, onClose }: { user: UserRow | null; meId: number; onClose: () => void }) {
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<"admin" | "staff">(user?.role ?? "staff");
  const [active, setActive] = useState(user?.active ?? true);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"2fa" | "logout" | null>(null);
  const [pending, startTransition] = useTransition();
  const self = user?.id === meId;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await saveUser({ id: user?.id ?? null, name, email, role, active, password: password || undefined });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(user ? "Kullanıcı kaydedildi" : `${name.trim()} eklendi; giriş bilgilerini kendisine iletin`);
    onClose();
  }

  function run(kind: "2fa" | "logout" | "unlock") {
    if (!user) return;
    setConfirm(null);
    startTransition(async () => {
      const res = kind === "2fa" ? await resetUserTwoFactor(user.id) : kind === "logout" ? await signOutUserEverywhere(user.id) : await unlockUser(user.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success(kind === "2fa" ? "İki adımlı doğrulama kapatıldı" : kind === "logout" ? "Oturumları kapatıldı" : "Hesap kilidi açıldı");
      onClose();
    });
  }

  const security = user && (user.twoFactor || user.locked || !self) ? (
    <div className="space-y-2 rounded-2xl bg-panel p-3">
      <p className="px-1 text-[13px] font-medium text-ink-soft">Güvenlik</p>
      <div className="flex flex-wrap gap-2">
        {user.locked ? (
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => run("unlock")}>
            <LockOpen size={15} /> Kilidi aç
          </Button>
        ) : null}
        {user.twoFactor ? (
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => setConfirm("2fa")}>
            <ShieldOff size={15} /> İki adımlıyı sıfırla
          </Button>
        ) : null}
        {!self ? (
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => setConfirm("logout")}>
            <LogOut size={15} /> Tüm oturumlarını kapat
          </Button>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={user ? "Kullanıcıyı düzenle" : "Kullanıcı ekle"}
      description={user ? undefined : "Giriş e-postasını ve ilk parolayı siz belirleyin; kişi sonra Hesabım'dan değiştirebilir."}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form="user-form" disabled={busy}>
            {busy ? "Kaydediliyor…" : user ? "Kaydet" : "Ekle"}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} noValidate className="space-y-4 pb-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ad" htmlFor="u-n">
            <Input id="u-n" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Giriş e-postası" htmlFor="u-e">
            <Input id="u-e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">Rol</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {ROLE_OPTIONS.map((o) => (
              <label
                key={o.value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-2xl bg-surface px-3.5 py-3 ring-1 ring-inset transition-shadow",
                  role === o.value ? "ring-2 ring-ink/70" : "ring-line-strong hover:ring-ink/25",
                )}
              >
                <input type="radio" name="u-role" value={o.value} checked={role === o.value} onChange={() => setRole(o.value)} className="mt-1 size-4 accent-ink" />
                <span>
                  <span className="block text-sm font-medium text-ink">{o.label}</span>
                  <span className="block text-xs text-ink-mute">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field
          label={user ? "Yeni parola (değiştirmek için)" : "Parola"}
          hint={user ? "Boş bırakırsanız parola değişmez. Değişirse kişinin açık oturumları kapanır." : "En az 8 karakter"}
          htmlFor="u-p"
        >
          <Input id="u-p" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ToggleRow
          title="Aktif (giriş yapabilir)"
          description={active ? "Bu hesapla giriş yapılabilir." : "Pasif hesapla giriş yapılamaz; bilgiler saklanır."}
          label="Aktif (giriş yapabilir)"
          checked={active}
          onChange={setActive}
        />
        {security}
      </form>
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && run(confirm)}
        title={confirm === "2fa" ? "İki adımlı doğrulama sıfırlansın mı?" : "Bütün oturumları kapatılsın mı?"}
        description={
          confirm === "2fa"
            ? "Telefonunu kaybeden kullanıcı için. Girişte yalnızca parola istenir; kişi Hesabım'dan yeniden kurabilir."
            : "Kullanıcı bütün cihazlarda çıkış yapar ve yeniden giriş yapması gerekir."
        }
        confirmLabel={confirm === "2fa" ? "Sıfırla" : "Oturumları kapat"}
      />
    </Dialog>
  );
}

// ---------------------------------------------------------------- Roller

const PERMISSIONS: { label: string; admin: boolean; staff: boolean }[] = [
  { label: "Stok sayımı girme", admin: true, staff: true },
  { label: "Reçete defterini görme", admin: true, staff: true },
  { label: "Kendi parolası ve iki adımlı doğrulama", admin: true, staff: true },
  { label: "Ürün maliyeti, fiyat ve kârlılık", admin: true, staff: false },
  { label: "Hammadde fiyatları", admin: true, staff: false },
  { label: "Satış, fatura, gelir-gider", admin: true, staff: false },
  { label: "Sabit gider, maaş ve personel", admin: true, staff: false },
  { label: "Ödemeler, hatırlatıcılar, e-posta bildirimleri", admin: true, staff: false },
  { label: "Paraşüt, ayarlar, kullanıcı yönetimi", admin: true, staff: false },
];

function Mark({ on, label }: { on: boolean; label: string }) {
  return on ? (
    <span className="inline-flex size-6 items-center justify-center rounded-full bg-lime/30 text-good-ink" role="img" aria-label={`${label}: var`}>
      <Check size={14} strokeWidth={2.5} />
    </span>
  ) : (
    <span className="inline-flex size-6 items-center justify-center rounded-full bg-panel text-ink-quiet" role="img" aria-label={`${label}: yok`}>
      <Minus size={14} />
    </span>
  );
}

export function RolesCard() {
  return (
    <Card>
      <CardHeader icon={<ShieldCheck />} title="Roller" description="Her kullanıcının tek rolü vardır. Yetkiler hem menüde hem sunucuda denetlenir." />
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <TH>Yetki</TH>
              <TH className="text-center">{ROLES.admin}</TH>
              <TH className="text-center">{ROLES.staff}</TH>
            </tr>
          </THead>
          <tbody>
            {PERMISSIONS.map((p) => (
              <TR key={p.label}>
                <TD className="text-ink-soft">{p.label}</TD>
                <TD className="text-center">
                  <Mark on={p.admin} label={ROLES.admin} />
                </TD>
                <TD className="text-center">
                  <Mark on={p.staff} label={ROLES.staff} />
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </Card>
  );
}

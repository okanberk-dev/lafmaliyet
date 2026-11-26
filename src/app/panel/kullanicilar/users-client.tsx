"use client";

import { Check, KeyRound, LockOpen, LogOut, Minus, Pencil, Send, ShieldCheck, ShieldOff, Trash2, UserPlus, Users } from "lucide-react";
import { createContext, useContext, useEffect, useOptimistic, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { ConfirmPasswordDialog } from "@/components/panel/confirm-password-dialog";
import { toastUnreachable, useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { clearQuery, FilterBar, matches, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { Field, Input, Select } from "@/components/ui/form";
import { Avatar } from "@/components/ui/icon-tile";
import { DotList, EmptyState } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { ToggleRow } from "@/components/ui/toggle-row";
import { ROLES } from "@/lib/constants";
import { num } from "@/lib/format";
import { PASSWORD_MIN, passwordProblem } from "@/lib/password-rules";
import { ROLE_PERMISSIONS, STAFF_ROLE_HINT } from "@/lib/roles";
import { isStepUpError, needsStepUp, STEP_UP_REQUIRED, stepUpChanges, type StepUpCase, type StepUpConfirm } from "@/lib/step-up";
import { cn } from "@/lib/utils";
import { createAccessLink } from "@/server/actions/invites";
import { createUser, deleteUser, resetUserTwoFactor, saveUser, setUserActive, signOutUserEverywhere, unlockUser } from "@/server/actions/settings";

import { generatePassword, linkReason, relinkText, type AccessInfo } from "./access";
import { AccessSheet } from "./access-sheet";
import { CloseGuardFooter } from "./close-guard";
import { PasswordField } from "./password-field";
import { DELETE_TEXT, stepUpText, type StepUpText } from "./step-up-text";

const count = (v: number) => num(Math.round(v), 0);

/** Personelin bağlanabileceği şubeler (etkin fiziksel şubeler) */
export interface UserBranchOption {
  id: string;
  name: string;
}

/** Şube seçenekleri pencerelere bağlamla iner (UsersEditor sağlar) */
const BranchesContext = createContext<readonly UserBranchOption[]>([]);

/** Personelin şubesinin adı (bütün şubelerse ya da tek şube varsa null) */
function useBranchName(id: string | null): string | null {
  const branches = useContext(BranchesContext);
  if (!id || branches.length < 2) return null;
  return branches.find((b) => b.id === id)?.name ?? null;
}

/**
 * Personelin şubesi (docs/SUBE.md › Personel hesabının şubesi). Şube seçilirse kişinin paneli o şubede kilitli açılır:
 * kasa raporu, kontrol listeleri o şubenin. Yönetici için gösterilmez; tek şube açıkken de gösterilmez.
 */
function UserBranchField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const branches = useContext(BranchesContext);
  if (branches.length < 2 && !value) return null;
  return (
    <Field label="Şube" htmlFor={id} hint="Personel paneli bu şubede açar; kasa raporu ve kontrol listeleri bu şubenin olur. Bütün şubeler: kişi şubeyi kendisi seçer.">
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Bütün şubeler</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function BranchBadge({ user }: { user: UserRow }) {
  const name = useBranchName(user.role === "staff" ? user.branchId : null);
  return name ? <Badge tone="blue">{name}</Badge> : null;
}

/** Telefonda 44px dokunma alanı (paylaşılan düğmeler dokunmatikte 40px) */
const TAP = "h-11 pointer-coarse:h-11";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
type StepUpRequest = StepUpText & { run: (confirm: StepUpConfirm) => Promise<string | null> };

/**
 * Yönetici işlemlerinde kendi parolanızla onay (kural src/lib/step-up.ts, metinler ./step-up-text). `guard` eylemi
 * yürütür: metin verilirse önce parola penceresi açılır, eylem parolayla çalışır. Metin yoksa eylem parolasız çalışır;
 * sunucu yine de parola isterse (sayfa eski: rol başka sekmede değişmiş) yedek pencere açılır ve aynı çağrı parolayla
 * yinelenir. Parola hataları pencerede kalır; `done` başarıyı ve öteki hataları (bildirim, alan hatası) işler, isterse
 * pencere kapanınca odaklanacak alanı döndürür (pencere açıkken alttaki form erişilemez). `dialog` çağıran bileşenin
 * penceresinin içinde değil yanında bağlanır (ConfirmDialog'daki kural).
 */
function useStepUp() {
  const [request, setRequest] = useState<StepUpRequest | null>(null);
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    if (request || !focusAfter.current) return;
    document.getElementById(focusAfter.current)?.focus();
    focusAfter.current = null;
  }, [request]);

  async function guard<T>(
    text: StepUpText | null,
    call: (confirm?: StepUpConfirm) => Promise<ActionResult<T>>,
    done: (res: ActionResult<T>) => { focus: string } | undefined,
  ): Promise<void> {
    const ask = (t: StepUpText) =>
      setRequest({
        ...t,
        // eylem-hatası: ConfirmPasswordDialog'un onConfirm'ü yakalar (pencere ve parola kalır, nedeni alanın altında)
        run: async (confirm) => {
          const res = await call(confirm);
          if (!res.ok && isStepUpError(res.error)) return res.error;
          focusAfter.current = done(res)?.focus ?? null;
          return null;
        },
      });
    if (text) return ask(text);
    let res: ActionResult<T>;
    try {
      res = await call();
    } catch (e) {
      // Ağ kesildi ya da panel güncellendi (E-51): bildirim çıkar, form yerinde kalır
      return toastUnreachable(e);
    }
    if (!res.ok && res.error === STEP_UP_REQUIRED) return ask(stepUpText({ kind: "fallback" }));
    const after = done(res);
    if (after) document.getElementById(after.focus)?.focus();
  }

  const dialog = request ? (
    <ConfirmPasswordDialog
      title={request.title}
      description={request.description}
      confirmLabel={request.confirmLabel}
      danger={request.danger}
      onClose={() => setRequest(null)}
      onConfirm={async (password) => {
        const problem = await request.run({ password });
        if (!problem) setRequest(null);
        return problem;
      }}
    />
  ) : null;
  return { guard, dialog };
}

export type UserRow = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "staff";
  /** Personelin şubesi; boş: bütün şubeler */
  branchId: string | null;
  active: boolean;
  lastLoginAt: string | null;
  twoFactor: boolean;
  /** Süren giriş kilidi: hesabın (5 hata) ya da yalnız bilinen bir cihazın (o tarayıcıdan 10 hata) */
  locked: "account" | "device" | null;
  /** Davetle eklendi, parolasını henüz belirlemedi ("expired": geçerli bağlantısı yok) */
  invite: "none" | "pending" | "expired";
  /** Kullanılmamış, süresi geçmemiş davet ya da sıfırlama bağlantısı ("20.10.2026 14:30"a kadar) */
  liveLink: { kind: "invite" | "reset"; until: string } | null;
};

type RoleFilter = "all" | "admin" | "staff";
const ROLE_FILTERS: readonly RoleFilter[] = ["all", "admin", "staff"];

/**
 * AkmanOS "User list": avatar + ad + soluk e-posta, rol rozeti, noktalı durum rozeti, iki adımlı doğrulama, son
 * giriş; satır sonunda aktif/pasif anahtarı ve düzenle. Arama ve rol süzgeci üstte. Pasif yapmak onay ister.
 * Kullanıcı eklenince (ya da davet / sıfırlama bağlantısı oluşunca) "Giriş bilgileri" penceresi açılır.
 */
export function UsersEditor({
  branches = [],
  ...props
}: {
  users: UserRow[];
  meId: number;
  emailConfigured: boolean;
  loginUrl: string;
  branches?: readonly UserBranchOption[];
  /** Yöneticide iki adımlı zorunlu (src/lib/admin-security.ts): sıfırlama penceresi kurulum ekranını söyler */
  twoFactorRequired?: boolean;
}) {
  return (
    <BranchesContext.Provider value={branches}>
      <UsersList {...props} />
    </BranchesContext.Provider>
  );
}

function UsersList({
  users,
  meId,
  emailConfigured,
  loginUrl,
  twoFactorRequired = false,
}: {
  users: UserRow[];
  meId: number;
  emailConfigured: boolean;
  loginUrl: string;
  twoFactorRequired?: boolean;
}) {
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);
  const [access, setAccess] = useState<AccessInfo | null>(null);
  const [confirmOff, setConfirmOff] = useState<UserRow | null>(null);
  const [linkBusy, setLinkBusy] = useState<number | null>(null);
  // Geçerli bağlantısı olana yeni bağlantı eskisini geçersiz kılar: önce sorulur
  const [confirmLink, setConfirmLink] = useState<{ user: UserRow; keepEditor: boolean } | null>(null);
  // Arama ve rol adreste durur (?ara=ayse&rol=staff): yenileyince ve paylaşınca korunur
  const [query, setQuery] = useQueryText("ara");
  const [roleRaw, setRole] = useQueryState<RoleFilter>("rol", "all");
  const role = ROLE_FILTERS.includes(roleRaw) ? roleRaw : "all";
  const [pending, startTransition] = useActionTransition();
  const [rows, setOptimistic] = useOptimistic(users, (state, p: { id: number; active: boolean }) => state.map((u) => (u.id === p.id ? { ...u, active: p.active } : u)));
  // Davet bekleyen henüz giriş yapamaz: "Aktif" sayılmaz, ayrıca "Davet bekleyen" diye sayılır
  const activeCount = rows.filter((u) => u.active && u.invite === "none").length;
  const twoFactorCount = rows.filter((u) => u.active && u.twoFactor).length;
  const invitedCount = rows.filter((u) => u.active && u.invite !== "none").length;

  const visible = rows.filter((u) => (role === "all" || u.role === role) && matches(`${u.name} ${u.email} ${ROLES[u.role]}`, query));
  const filterActive = Boolean(query.trim()) || role !== "all";
  const clear = () => {
    setQuery("");
    clearQuery(["ara", "rol"]);
  };

  const stepUp = useStepUp();

  // Yalnız erişim gider: satırın sayfa açıldığındaki adı, e-postası ve rolü geri yazılmaz (YO-01)
  const saveActive = (u: UserRow, active: boolean, confirm?: StepUpConfirm) => setUserActive(u.id, active, confirm);
  const activeDone = (u: UserRow, active: boolean) => (res: ActionResult<{ notice?: string | null } | null>) => {
    if (!res.ok) return void toast.error(res.error);
    toast.success(active ? `${u.name} yeniden aktif` : `${u.name} pasif yapıldı`);
    // Pasif hesabın adresi bir bildirim listesindeyse: e-posta artık gitmez, liste temizlensin (E-53)
    if (res.data?.notice) toast.warning(res.data.notice, { duration: 12_000 });
  };

  /** Personel: anahtar hemen döner (iyimser), sunucu yenileyince kesinleşir */
  function setActive(u: UserRow, active: boolean) {
    setConfirmOff(null);
    startTransition(async () => {
      setOptimistic({ id: u.id, active });
      await stepUp.guard(null, (confirm) => saveActive(u, active, confirm), activeDone(u, active));
    });
  }

  /**
   * Yönetici satırı iki yönde de parola ister (yeniden aktif yapmak yönetici girişini geri verir); anahtar parola
   * onaylanıp sayfa yenilenene kadar yerinde durur. Personeli pasif yapmak yalnızca onay ister.
   */
  function toggle(u: UserRow, active: boolean) {
    if (needsStepUp({ kind: "save", before: u, after: { role: u.role, active, email: u.email, password: false } })) {
      void stepUp.guard(stepUpText({ kind: "toggle", name: u.name, active, invite: u.invite }), (confirm) => saveActive(u, active, confirm), activeDone(u, active));
    } else if (active) setActive(u, true);
    else setConfirmOff(u);
  }

  /**
   * Davet bekleyene yeni davet, diğerlerine parola sıfırlama bağlantısı; ardından "Giriş bilgileri". Düzenleme
   * penceresinde kaydedilmemiş değişiklik varsa pencere kapanmaz (bilgiler penceresi üstünde açılır, kapanınca
   * düzenlemeye dönülür). `text`: yöneticiye bağlantı parola ister.
   */
  function createLink(u: UserRow, keepEditor: boolean, text: StepUpText | null) {
    setConfirmLink(null);
    void stepUp.guard(
      text,
      async (confirm) => {
        setLinkBusy(u.id);
        try {
          return await createAccessLink(u.id, confirm);
        } finally {
          setLinkBusy(null);
        }
      },
      (res) => {
        if (!res.ok) return void toast.error(res.error);
        if (!keepEditor) setEditing(null);
        setAccess({ ...res.data, reason: linkReason(res.data.kind === "invite" ? "invite" : "reset", u.liveLink !== null) });
      },
    );
  }
  /**
   * Geçerli bir davet ya da sıfırlama bağlantısı varsa yenisi onu hemen geçersiz kılar: önce sorulur. Yöneticide bu
   * soru parola penceresinin içindedir (iki ayrı onay açılmaz).
   */
  function newLink(u: UserRow, keepEditor = false) {
    if (needsStepUp({ kind: "link", targetRole: u.role })) createLink(u, keepEditor, stepUpText({ kind: "link", user: u }));
    else if (u.liveLink) setConfirmLink({ user: u, keepEditor });
    else createLink(u, keepEditor, null);
  }

  const addButton = (
    <Button onClick={() => setEditing("new")} className={cn(TAP, "max-sm:w-full sm:pointer-fine:h-9")}>
      <UserPlus size={16} /> Kullanıcı ekle
    </Button>
  );

  return (
    <Card id="kullanicilar">
      <CardHeader
        icon={<Users />}
        title="Kullanıcılar"
        description="Kullanıcı ekle: ad, giriş e-postası ve rol; parolayı siz belirleyin ya da davet bağlantısı gönderin. Giriş bilgilerini WhatsApp'tan ya da e-postayla iletirsiniz."
        meta={
          <DotList className="w-full" itemClassName="whitespace-nowrap">
            <span className="inline-flex items-center gap-x-1.5">
              <span>Aktif</span>
              <AnimatedNumber value={activeCount} format={count} className="font-semibold text-ink tabular" />
              <span className="text-ink-quiet">/</span>
              <span className="tabular">{rows.length} kullanıcı</span>
            </span>
            <span>
              İki adımlı <span className="font-semibold text-ink tabular">{twoFactorCount}</span>
            </span>
            {invitedCount ? (
              <span>
                Davet bekleyen <span className="font-semibold text-ink tabular">{invitedCount}</span>
              </span>
            ) : null}
          </DotList>
        }
        actions={addButton}
        actionsClassName="max-sm:w-full"
      />
      {rows.length > 1 ? (
        <FilterBar active={filterActive} onClear={clear} shown={visible.length} total={rows.length} unit="kullanıcı" className="px-5 pb-4">
          <SearchField value={query} onChange={setQuery} placeholder="Ad ya da e-posta ara" label="Kullanıcı ara" className="w-full sm:w-64" />
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
        </FilterBar>
      ) : null}
      {visible.length ? (
        <>
          {/* Telefonda tablo yerine kart listesi: rol, durum ve son giriş kaydırmadan görünür; uzun ad ve e-posta satır kırar */}
          <ul className="divide-y divide-line border-t border-line sm:hidden" aria-label="Kullanıcılar">
            {visible.map((u) => {
              const me = u.id === meId;
              return (
                <li key={u.id} className={cn("px-5 py-3.5", !u.active && "opacity-60")}>
                  <div className="flex items-start gap-3">
                    <Avatar name={u.name} />
                    <button type="button" onClick={() => setEditing(u)} className="min-w-0 flex-1 cursor-pointer text-left" aria-label={`${u.name} kullanıcısını düzenle`}>
                      <span className="block font-medium break-words text-ink">
                        {u.name}
                        {me ? <span className="ml-1.5 text-xs font-normal text-ink-mute">(siz)</span> : null}
                      </span>
                      <span className="block text-[13px] wrap-anywhere text-ink-mute">{u.email}</span>
                      <span className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                        <Badge tone={u.role === "admin" ? "solid" : "gray"}>{ROLES[u.role]}</Badge>
                        <BranchBadge user={u} />
                        <StatusBadge user={u} />
                        {u.invite === "none" ? <TwoFactorMark on={u.twoFactor} /> : null}
                      </span>
                      <span className="mt-1.5 block text-xs text-ink-mute tabular">{lastLoginText(u)}</span>
                    </button>
                    <RowActions user={u} me={me} pending={pending} onToggle={(next) => toggle(u, next)} onEdit={() => setEditing(u)} />
                  </div>
                  {u.invite !== "none" && u.active ? (
                    <Button variant="secondary" className={cn(TAP, "mt-3 w-full")} disabled={linkBusy === u.id} onClick={() => newLink(u)}>
                      <Send size={15} /> {linkBusy === u.id ? "Oluşturuluyor…" : u.invite === "expired" ? "Yeni davet bağlantısı oluştur" : "Yeni davet bağlantısı (eskisi iptal)"}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="hidden sm:block">
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>Kullanıcı</TH>
                    <TH>Rol</TH>
                    <TH>Durum</TH>
                    {/* Tablette (sm–lg) ayrı sütun yerine durumun altında: tablo 768px'te yana kaymasın */}
                    <TH className="hidden lg:table-cell">İki adımlı</TH>
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
                              <p className="font-medium break-words text-ink">
                                {u.name}
                                {me ? <span className="ml-1.5 text-xs font-normal text-ink-mute">(siz)</span> : null}
                              </p>
                              <p className="text-[13px] wrap-anywhere text-ink-mute">{u.email}</p>
                            </div>
                          </div>
                        </TD>
                        <TD>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={u.role === "admin" ? "solid" : "gray"}>{ROLES[u.role]}</Badge>
                            <BranchBadge user={u} />
                          </div>
                        </TD>
                        <TD>
                          <div className="flex flex-col items-start gap-1.5">
                            <StatusBadge user={u} />
                            {u.invite === "none" ? (
                              <span className="lg:hidden">
                                <TwoFactorMark on={u.twoFactor} labelled />
                              </span>
                            ) : null}
                          </div>
                        </TD>
                        <TD className="hidden lg:table-cell">
                          {u.invite === "none" ? <TwoFactorMark on={u.twoFactor} /> : <span className="text-[13px] text-ink-quiet">—</span>}
                        </TD>
                        <TD className="text-[13px] whitespace-nowrap text-ink-mute tabular">{lastLoginText(u, true)}</TD>
                        <TD>
                          <RowActions
                            user={u}
                            me={me}
                            pending={pending}
                            linkBusy={linkBusy === u.id}
                            onLink={u.invite !== "none" && u.active ? () => newLink(u) : undefined}
                            onToggle={(next) => toggle(u, next)}
                            onEdit={() => setEditing(u)}
                          />
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          </div>
        </>
      ) : rows.length ? (
        <EmptyState
          icon={<Users />}
          title="Eşleşen kullanıcı yok"
          description="Aramayı ya da rol süzgecini değiştirin."
          action={
            <Button variant="secondary" onClick={clear}>
              Süzgeci temizle
            </Button>
          }
        />
      ) : (
        <EmptyState icon={<Users />} title="Kullanıcı yok" action={addButton} />
      )}
      {editing === "new" ? (
        <NewUserDialog
          onClose={() => setEditing(null)}
          onCreated={(info) => {
            setEditing(null);
            setAccess(info);
          }}
        />
      ) : editing ? (
        <UserDialog
          // Bağlantı oluşunca sayfa yenilenir: pencere kişinin güncel durumunu (geçerli bağlantı) görsün
          user={rows.find((u) => u.id === editing.id) ?? editing}
          meId={meId}
          loginUrl={loginUrl}
          twoFactorRequired={twoFactorRequired}
          linkBusy={linkBusy === editing.id}
          onLink={(dirty) => newLink(rows.find((u) => u.id === editing.id) ?? editing, dirty)}
          onAccess={(info) => {
            setEditing(null);
            setAccess(info);
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {access ? <AccessSheet info={access} emailConfigured={emailConfigured} onClose={() => setAccess(null)} /> : null}
      <ConfirmDialog
        open={confirmOff !== null}
        onClose={() => setConfirmOff(null)}
        onConfirm={() => confirmOff && setActive(confirmOff, false)}
        title={confirmOff ? `${confirmOff.name} pasif yapılsın mı?` : ""}
        description="Bu kullanıcı bir daha giriş yapamaz, açık oturumları kapanır. Bilgileri silinmez; istediğiniz zaman yeniden aktif yapabilirsiniz."
        confirmLabel="Pasif yap"
      />
      <ConfirmDialog
        open={confirmLink !== null}
        onClose={() => setConfirmLink(null)}
        onConfirm={() => confirmLink && createLink(confirmLink.user, confirmLink.keepEditor, null)}
        title={confirmLink ? relinkText(confirmLink.user).title : ""}
        description={confirmLink ? relinkText(confirmLink.user).description : undefined}
        confirmLabel="Yeni bağlantı oluştur"
        tone="primary"
      />
      {stepUp.dialog}
    </Card>
  );
}

function lastLoginText(u: UserRow, short = false) {
  if (u.invite === "pending") return short ? "Davet bekliyor" : "Daveti henüz kabul etmedi";
  if (u.invite === "expired") return short ? "Davet süresi doldu" : "Davet bağlantısının süresi doldu";
  return short ? (u.lastLoginAt ?? "Hiç girmedi") : `Son giriş: ${u.lastLoginAt ?? "hiç girmedi"}`;
}

function StatusBadge({ user }: { user: UserRow }) {
  if (user.locked)
    return (
      <Badge dot tone="red">
        {user.locked === "device" ? "Bir cihazda kilitli" : "Kilitli"}
      </Badge>
    );
  if (user.active && user.invite === "pending")
    return (
      <Badge dot tone="amber">
        Davet bekliyor
      </Badge>
    );
  if (user.active && user.invite === "expired")
    return (
      <Badge dot tone="red">
        Davet süresi doldu
      </Badge>
    );
  return (
    <Badge dot tone={user.active ? "green" : "gray"}>
      {user.active ? "Aktif" : "Pasif"}
    </Badge>
  );
}

/** labelled: "İki adımlı" her genişlikte yazar (ayrı sütun başlığı olmadığında) */
function TwoFactorMark({ on, labelled = false }: { on: boolean; labelled?: boolean }) {
  const label = <span className={labelled ? undefined : "sm:hidden"}>İki adımlı</span>;
  return on ? (
    <span className="inline-flex items-center gap-1 text-[13px] font-medium whitespace-nowrap text-good-ink">
      <ShieldCheck size={15} aria-hidden /> {label} Açık
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[13px] whitespace-nowrap text-ink-mute">
      <ShieldOff size={15} aria-hidden /> {label} Kapalı
    </span>
  );
}

/** Satır sonu: giriş anahtarı (kendi hesabınızda kilitli), davet bağlantısı (geniş ekranda) ve düzenle */
function RowActions({
  user,
  me,
  pending,
  linkBusy,
  onLink,
  onToggle,
  onEdit,
}: {
  user: UserRow;
  me: boolean;
  pending: boolean;
  linkBusy?: boolean;
  onLink?: () => void;
  onToggle: (next: boolean) => void;
  onEdit: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-2">
      <span title={me ? "Kendi hesabınızı pasif yapamazsınız" : undefined} onClick={(e) => e.stopPropagation()}>
        <Switch
          checked={user.active}
          disabled={me || pending}
          // Davetli parolasını belirleyene kadar giriş yapamaz; anahtar yalnızca hesabın açık olduğunu söyler
          label={user.invite === "none" ? `${user.name} giriş yapabilir` : `${user.name} hesabı aktif`}
          onChange={onToggle}
          className="pointer-coarse:h-11"
        />
      </span>
      {onLink ? (
        <IconButton
          label={`${user.name} için davet bağlantısını yeniden oluştur`}
          disabled={linkBusy}
          onClick={(e) => {
            e.stopPropagation();
            onLink();
          }}
          className="pointer-coarse:size-11"
        >
          <Send size={15} />
        </IconButton>
      ) : null}
      <IconButton
        label={`${user.name} kullanıcısını düzenle`}
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        className="pointer-coarse:size-11"
      >
        <Pencil size={15} />
      </IconButton>
    </div>
  );
}

// ---------------------------------------------------------------- Ortak form parçaları

const ROLE_OPTIONS: { value: "staff" | "admin"; label: string; hint: string }[] = [
  { value: "staff", label: ROLES.staff, hint: STAFF_ROLE_HINT },
  { value: "admin", label: ROLES.admin, hint: "Her şey (maliyet, kâr, ayarlar, reçete onayı dahil)" },
];

/** Büyük, dokunması kolay seçenek kartları (radyo grubu) */
function ChoiceCards<T extends string>({
  name,
  value,
  onChange,
  options,
  disabled,
  columns = true,
}: {
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint: string; icon?: ReactNode }[];
  disabled?: (v: T) => boolean;
  columns?: boolean;
}) {
  return (
    <div className={cn("grid gap-2", columns && "sm:grid-cols-2")}>
      {options.map((o) => {
        const locked = disabled?.(o.value) ?? false;
        const on = value === o.value;
        return (
          <label
            key={o.value}
            className={cn(
              "flex min-h-14 items-start gap-3 rounded-2xl bg-surface px-3.5 py-3 ring-1 ring-inset transition-shadow",
              locked ? "cursor-not-allowed opacity-50" : "cursor-pointer",
              on ? "ring-2 ring-ink/70" : "ring-line-strong hover:ring-ink/25",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={on}
              disabled={locked}
              onChange={() => onChange(o.value)}
              className="mt-0.5 size-5 shrink-0 accent-ink"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                {o.icon ? <span className="text-ink-mute [&>svg]:size-4">{o.icon}</span> : null}
                {o.label}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-ink-mute">{o.hint}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function StepLegend({ n, children }: { n: number; children: ReactNode }) {
  return (
    <legend className="mb-2 flex items-center gap-2 text-[13px] font-medium text-ink-soft">
      <span className="flex size-5 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-on-solid tabular" aria-hidden>
        {n}
      </span>
      {children}
    </legend>
  );
}

type FormErrors = { name?: string; email?: string; password?: string };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateUser({ name, email, password, needPassword }: { name: string; email: string; password: string; needPassword: boolean }): FormErrors {
  const out: FormErrors = {};
  if (!name.trim()) out.name = "Adı yazın";
  if (!EMAIL_RE.test(email.trim())) out.email = "Geçerli bir e-posta girin (ör. ayse@laffogato.net)";
  if (needPassword && !password) out.password = "Bir parola yazın ya da “Güçlü parola oluştur”a basın";
  else if (password && password.length < PASSWORD_MIN) out.password = `Parola en az ${PASSWORD_MIN} karakter olmalı (şu an ${password.length})`;
  else if (password) out.password = passwordProblem(password, email) ?? undefined;
  return out;
}

function focusFirst(found: FormErrors, ids: Record<keyof FormErrors, string>) {
  const first = (["name", "email", "password"] as const).find((k) => found[k]);
  if (first) document.getElementById(ids[first])?.focus();
  return Boolean(first);
}

function NameEmailFields({
  ids,
  name,
  email,
  errors,
  onName,
  onEmail,
  emailLocked = false,
}: {
  ids: { name: string; email: string };
  name: string;
  email: string;
  errors: FormErrors;
  onName: (v: string) => void;
  onEmail: (v: string) => void;
  /** Kendi hesabınız: giriş e-postası Hesabım'da (parolayla) değişir */
  emailLocked?: boolean;
}) {
  return (
    <div className="grid gap-4">
      <Field label="Ad" htmlFor={ids.name} error={errors.name}>
        <Input
          id={ids.name}
          value={name}
          onChange={(e) => onName(e.target.value)}
          autoComplete="off"
          autoCapitalize="words"
          maxLength={80}
          placeholder="Ayşe Yılmaz"
          aria-invalid={errors.name ? true : undefined}
          className={TAP}
        />
      </Field>
      <Field
        label="Giriş e-postası"
        htmlFor={ids.email}
        error={errors.email}
        hint={errors.email ? undefined : emailLocked ? "Kendi e-postanızı ve parolanızı Hesabım'dan (mevcut parolanızla) değiştirin." : "Kişi panele bu adresle girer."}
      >
        <Input
          id={ids.email}
          readOnly={emailLocked}
          type="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={email}
          onChange={(e) => onEmail(e.target.value)}
          autoComplete="off"
          placeholder="ayse@laffogato.net"
          aria-invalid={errors.email ? true : undefined}
          className={cn(TAP, emailLocked && "bg-panel text-ink-mute")}
        />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------- Kullanıcı ekle

type Mode = "password" | "invite";
const NEW_IDS = { name: "nu-n", email: "nu-e", password: "nu-p" } as const;

/**
 * Kullanıcı ekle (telefon önce, tek sütun): 1 Kişi (ad, giriş e-postası) · 2 Rol · 3 Parola: "Parolayı ben
 * belirleyeyim" (hazır güçlü parola, göster/gizle, kopyala) ya da "Davet bağlantısı gönder" (72 saat).
 */
function NewUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (info: AccessInfo) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "staff">("staff");
  const [branchId, setBranchId] = useState("");
  const [mode, setMode] = useState<Mode>("password");
  // Pencere açılınca hazır, okunur güçlü parola: yönetici olduğu gibi kullanabilir ya da değiştirebilir
  const [password, setPassword] = useState(() => generatePassword());
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);
  // Yazılmış formu arka plana dokunma, aşağı çekme ya da Vazgeç sessizce silmesin
  const [askDiscard, setAskDiscard] = useState(false);
  const dirty = Boolean(name.trim() || email.trim());
  const requestClose = () => {
    if (busy) return;
    if (dirty) setAskDiscard(true);
    else onClose();
  };

  const stepUp = useStepUp();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found = validateUser({ name, email, password: mode === "password" ? password : "", needPassword: mode === "password" });
    setErrors(found);
    if (focusFirst(found, NEW_IDS)) return;
    const branch = role === "staff" ? branchId || null : null;
    const payload =
      mode === "password" ? ({ mode, name, email, role, active, password, branchId: branch } as const) : ({ mode, name, email, role, active: true, branchId: branch } as const);
    // Yönetici eklemek kendi parolanızı ister: önce parola penceresi açılır
    await stepUp.guard(
      needsStepUp({ kind: "create", role }) ? stepUpText({ kind: "create", name, mode }) : null,
      async (confirm) => {
        setBusy(true);
        try {
          return await createUser(payload, confirm);
        } finally {
          setBusy(false);
        }
      },
      (res) => {
        if (!res.ok) {
          // Aynı e-posta: alanın altında (parola penceresi açıktıysa kapanınca alana odaklanılır)
          if (/e-posta/i.test(res.error)) {
            setErrors({ email: res.error });
            return { focus: NEW_IDS.email };
          }
          return void toast.error(res.error);
        }
        // "… eklendi" bilgisi açılan "Giriş bilgileri" penceresinde yazar (ayrı bildirim pencerenin başlığını örtmesin)
        onCreated(mode === "password" ? { ...res.data, password, reason: "new" } : { ...res.data, reason: "new" });
        if (res.data.notice) toast.warning(res.data.notice, { duration: 12_000 });
      },
    );
  }

  return (
    <>
      <Dialog
        open
        onClose={requestClose}
        title="Kullanıcı ekle"
        description="Kişi, rol ve parola: üç adım."
        footer={
          askDiscard ? (
            <CloseGuardFooter
              title="Form kapatılsın mı?"
              description="Yazdığınız ad ve e-posta silinir; kullanıcı eklenmez."
              confirmLabel="Kapat ve sil"
              onStay={() => setAskDiscard(false)}
              onLeave={onClose}
            />
          ) : (
            <>
              <Button variant="ghost" onClick={requestClose} className="max-sm:h-11">
                Vazgeç
              </Button>
              <Button type="submit" form="new-user-form" disabled={busy} className="max-sm:h-11 max-sm:flex-1">
                {busy ? "Ekleniyor…" : mode === "password" ? "Kullanıcıyı ekle" : "Ekle ve bağlantı oluştur"}
              </Button>
            </>
          )
        }
      >
        <form id="new-user-form" onSubmit={submit} noValidate className="space-y-5 pb-2">
          <fieldset>
            <StepLegend n={1}>Kişi</StepLegend>
            <NameEmailFields
              ids={NEW_IDS}
              name={name}
              email={email}
              errors={errors}
              onName={(v) => {
                setName(v);
                setErrors((x) => ({ ...x, name: undefined }));
              }}
              onEmail={(v) => {
                setEmail(v);
                setErrors((x) => ({ ...x, email: undefined }));
              }}
            />
          </fieldset>
          <fieldset>
            <StepLegend n={2}>Rol</StepLegend>
            <ChoiceCards name="nu-role" value={role} onChange={setRole} options={ROLE_OPTIONS} />
            {role === "admin" ? <p className="mt-1.5 text-xs text-ink-mute">Yönetici eklerken kendi parolanız sorulur.</p> : null}
            {role === "staff" ? (
              <div className="mt-3">
                <UserBranchField id="nu-branch" value={branchId} onChange={setBranchId} />
              </div>
            ) : null}
          </fieldset>
          <fieldset className="space-y-3">
            <StepLegend n={3}>Parola</StepLegend>
            <ChoiceCards<Mode>
              name="nu-mode"
              value={mode}
              onChange={(m) => {
                setMode(m);
                setErrors((x) => ({ ...x, password: undefined }));
              }}
              columns={false}
              options={[
                {
                  value: "password",
                  label: "Parolayı ben belirleyeyim",
                  hint: "Parolayı siz iletirsiniz (WhatsApp, e-posta); kişi sonra Hesabım'dan değiştirebilir.",
                  icon: <KeyRound />,
                },
                {
                  value: "invite",
                  label: "Davet bağlantısı gönder",
                  hint: "Kişi tek kullanımlık bağlantıdan (72 saat geçerli) parolasını kendisi belirler.",
                  icon: <Send />,
                },
              ]}
            />
            {mode === "password" ? (
              <PasswordField
                id={NEW_IDS.password}
                label="Parola"
                hint="En az 8 karakter. Hazır gelen güçlü parolayı kullanabilir ya da kendiniz yazabilirsiniz."
                error={errors.password}
                value={password}
                email={email}
                initiallyVisible
                onChange={(v) => {
                  setPassword(v);
                  setErrors((x) => ({ ...x, password: undefined }));
                }}
              />
            ) : (
              <p className="rounded-2xl bg-panel px-3.5 py-3 text-[13px] leading-5 text-ink-soft">
                Eklediğinizde bağlantı oluşur; sonraki ekrandan kopyalayıp WhatsApp&apos;tan ya da e-postayla iletirsiniz. Kişi parolasını belirleyene kadar
                listede <span className="font-medium text-ink">Davet bekliyor</span> yazar.
              </p>
            )}
          </fieldset>
          {mode === "password" ? (
            <ToggleRow
              title="Aktif (giriş yapabilir)"
              description={active ? "Bu hesapla hemen giriş yapılabilir." : "Pasif hesapla giriş yapılamaz; sonra aktif yapabilirsiniz."}
              label="Aktif (giriş yapabilir)"
              checked={active}
              onChange={setActive}
            />
          ) : null}
        </form>
      </Dialog>
      {stepUp.dialog}
    </>
  );
}

// ---------------------------------------------------------------- Kullanıcıyı düzenle

const EDIT_IDS = { name: "u-n", email: "u-e", password: "u-p" } as const;
type Confirm = "2fa" | "logout" | "delete";

function UserDialog({
  user,
  meId,
  loginUrl,
  twoFactorRequired,
  linkBusy,
  onLink,
  onAccess,
  onClose,
}: {
  user: UserRow;
  meId: number;
  loginUrl: string;
  twoFactorRequired: boolean;
  linkBusy: boolean;
  /** dirty: kaydedilmemiş değişiklik var (pencere açık kalsın) */
  onLink: (dirty: boolean) => void;
  onAccess: (info: AccessInfo) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<"admin" | "staff">(user.role);
  const [branchId, setBranchId] = useState(user.branchId ?? "");
  const [active, setActive] = useState(user.active);
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // Pencere açılırken kişinin hâli: bu arada başka sekmede değiştiyse sunucu kaydı reddeder (eski form geri yazmasın)
  const [seen] = useState(() => ({ name: user.name, email: user.email, role: user.role, active: user.active, branchId: user.branchId ?? null }));
  const [pending, startTransition] = useActionTransition();
  const self = user.id === meId;
  const invited = user.invite !== "none";
  const dirty = name !== user.name || email !== user.email || role !== user.role || branchId !== (user.branchId ?? "") || active !== user.active || password !== "";
  // Kaydedilmemiş değişikliği arka plana dokunma, aşağı çekme, Esc ya da Vazgeç sessizce silmesin
  const [askDiscard, setAskDiscard] = useState(false);
  const requestClose = () => {
    if (busy) return;
    if (dirty) setAskDiscard(true);
    else onClose();
  };

  const stepUp = useStepUp();
  // Formun şu anki hâli bir yönetici hesabını etkiliyor mu (kaydederken parola sorulur; sunucu da aynı kurala bakar)
  const change: Extract<StepUpCase, { kind: "save" }> = { kind: "save", before: user, after: { role, active, email, password: password !== "" } };
  const asksPassword = needsStepUp(change);

  async function submit(e: FormEvent) {
    e.preventDefault();
    // Sunucu da denetler; burada eksik alan pencere kapanmadan, alanın altında gösterilir
    const found = validateUser({ name, email, password, needPassword: false });
    setErrors(found);
    if (focusFirst(found, EDIT_IDS)) return;
    await stepUp.guard(
      asksPassword ? stepUpText({ kind: "save", user, changes: stepUpChanges(change), name, email }) : null,
      async (confirm) => {
        setBusy(true);
        try {
          return await saveUser({ id: user.id, name, email, role, active, branchId: role === "staff" ? branchId || null : null, password: password || undefined, seen }, confirm);
        } finally {
          setBusy(false);
        }
      },
      (res) => {
        if (!res.ok) return void toast.error(res.error);
        // Başkasına yeni parola verildiyse giriş bilgileri iletilmeye hazır gösterilir; "kaydedildi" o pencerede yazar
        // (ayrı bildirim telefonda pencerenin başlığını örtmesin)
        if (password && !self) {
          onAccess({ kind: "password", reason: invited ? "set" : "changed", userId: user.id, name: name.trim(), email: email.trim().toLowerCase(), loginUrl, password, handle: res.data?.handle ?? undefined });
        }
        else {
          toast.success("Kullanıcı kaydedildi");
          onClose();
        }
        // Personele indirilen ya da pasif yapılan hesabın adresi bir bildirim listesindeyse (e-posta artık gitmez) ya da
        // böyle bir hesabın eski adresi listede kaldıysa (artık hiçbir hesabın değil, e-posta gider): E-53. "Kaydedildi"den
        // sonra: yığının üstünde dursun, altında kalıp gözden kaçmasın
        if (res.data?.notice) toast.warning(res.data.notice, { duration: 12_000 });
      },
    );
  }

  const act = (kind: Confirm | "unlock", confirm?: StepUpConfirm): Promise<ActionResult<{ notice?: string | null } | null>> =>
    kind === "2fa"
      ? resetUserTwoFactor(user.id, confirm)
      : kind === "logout"
        ? signOutUserEverywhere(user.id)
        : kind === "delete"
          ? deleteUser(user.id, confirm)
          : unlockUser(user.id);
  const finish = (kind: Confirm | "unlock") => (res: ActionResult<{ notice?: string | null } | null>) => {
    if (!res.ok) return void toast.error(res.error);
    toast.success(
      { "2fa": "İki adımlı doğrulama kapatıldı", logout: "Oturumları kapatıldı", unlock: "Hesap kilidi açıldı", delete: `${user.name} silindi` }[kind],
    );
    // Silinen personel ya da pasif hesabın adresi bir bildirim listesindeyse: artık hesabı yok, e-posta ona gider (E-53)
    if (res.data?.notice) toast.warning(res.data.notice, { duration: 12_000 });
    onClose();
  };

  function run(kind: Confirm | "unlock") {
    setConfirm(null);
    startTransition(async () => {
      await stepUp.guard(null, (confirm) => act(kind, confirm), finish(kind));
    });
  }

  /** Yöneticinin iki adımlısını sıfırlamak ve yöneticiyi silmek kendi parolanızı ister; personelde yalnızca onay */
  function ask(kind: "2fa" | "delete") {
    if (!needsStepUp({ kind, targetRole: user.role })) return setConfirm(kind);
    void stepUp.guard(stepUpText(kind === "2fa" ? { kind, required: twoFactorRequired } : { kind, name: user.name }), (confirm) => act(kind, confirm), finish(kind));
  }

  const secBtn = cn(TAP, "w-full justify-start sm:w-auto sm:pointer-fine:h-8");
  const security = (
    <div className="space-y-2 rounded-2xl bg-panel p-3">
      <p className="px-1 text-[13px] font-medium text-ink-soft">Güvenlik</p>
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        {!self && user.active ? (
          <Button variant="secondary" size="sm" className={secBtn} disabled={pending || linkBusy} onClick={() => onLink(dirty)}>
            {user.invite !== "none" ? <Send size={15} /> : <KeyRound size={15} />}
            {linkBusy ? "Oluşturuluyor…" : user.invite !== "none" ? "Davet bağlantısını yeniden oluştur" : "Parola sıfırlama bağlantısı"}
          </Button>
        ) : null}
        {user.locked ? (
          <Button variant="secondary" size="sm" className={secBtn} disabled={pending} onClick={() => run("unlock")}>
            <LockOpen size={15} /> Kilidi aç
          </Button>
        ) : null}
        {/* Kendi iki adımlınız Hesabım'da parolayla kapanır */}
        {user.twoFactor && !self ? (
          <Button variant="secondary" size="sm" className={secBtn} disabled={pending} onClick={() => ask("2fa")}>
            <ShieldOff size={15} /> İki adımlıyı sıfırla
          </Button>
        ) : null}
        {/* Davet bekleyenin hiç oturumu olmadı */}
        {!self && !invited ? (
          <Button variant="secondary" size="sm" className={secBtn} disabled={pending} onClick={() => setConfirm("logout")}>
            <LogOut size={15} /> Tüm oturumlarını kapat
          </Button>
        ) : null}
      </div>
      {!self && user.active && user.invite === "none" ? (
        <p className="px-1 text-xs leading-5 text-ink-mute">
          Sıfırlama bağlantısıyla kişi yeni parolasını kendisi belirler (24 saat, tek kullanımlık); mevcut parolası o zamana kadar çalışır.
          {user.liveLink ? ` Geçerli bir bağlantı var (son geçerlilik ${user.liveLink.until}); yenisi onu iptal eder.` : ""}
        </p>
      ) : null}
      {user.locked === "device" ? (
        <p className="px-1 text-xs leading-5 text-ink-mute">
          Daha önce giriş yapılmış bir tarayıcıdan 10 hatalı deneme yapıldı: o tarayıcıdan 15 dakika girilemez. Kilidi aç onu da açar.
        </p>
      ) : null}
      {!self && user.active && user.invite === "pending" && user.liveLink ? (
        <p className="px-1 text-xs leading-5 text-ink-mute">Gönderilen davet bağlantısı {user.liveLink.until} tarihine kadar geçerli; yenisi onu iptal eder.</p>
      ) : null}
    </div>
  );

  const confirmText: Record<Confirm, { title: string; description: string; label: string }> = {
    "2fa": {
      title: "İki adımlı doğrulama sıfırlansın mı?",
      description: "Telefonunu kaybeden kullanıcı için. Girişte yalnızca parola istenir; kişi Hesabım'dan yeniden kurabilir.",
      label: "Sıfırla",
    },
    logout: { title: "Bütün oturumları kapatılsın mı?", description: "Kullanıcı bütün cihazlarda çıkış yapar ve yeniden giriş yapması gerekir.", label: "Oturumları kapat" },
    delete: { title: `${user.name} silinsin mi?`, description: DELETE_TEXT, label: "Kalıcı olarak sil" },
  };

  return (
    <>
      <Dialog
        open
        onClose={requestClose}
        title="Kullanıcıyı düzenle"
        footerStart={
          !self && !askDiscard ? (
            <Button variant="ghost" className={cn(TAP, "text-bad hover:bg-bad-soft hover:text-bad sm:pointer-fine:h-9")} disabled={pending} onClick={() => ask("delete")}>
              <Trash2 size={15} /> Sil
            </Button>
          ) : undefined
        }
        footer={
          askDiscard ? (
            <CloseGuardFooter
              title="Değişiklikler kaydedilmedi."
              description="Kapatırsanız yazdıklarınız silinir; kullanıcı olduğu gibi kalır."
              confirmLabel="Kaydetmeden kapat"
              onStay={() => setAskDiscard(false)}
              onLeave={onClose}
            />
          ) : (
            <>
              <Button variant="ghost" onClick={requestClose} className="max-sm:h-11">
                Vazgeç
              </Button>
              <Button type="submit" form="user-form" disabled={busy} className="max-sm:h-11">
                {busy ? "Kaydediliyor…" : "Kaydet"}
              </Button>
            </>
          )
        }
      >
        <form id="user-form" onSubmit={submit} noValidate className="space-y-4 pb-2">
          <NameEmailFields
            ids={EDIT_IDS}
            name={name}
            email={email}
            errors={errors}
            onName={(v) => {
              setName(v);
              setErrors((x) => ({ ...x, name: undefined }));
            }}
            onEmail={(v) => {
              setEmail(v);
              setErrors((x) => ({ ...x, email: undefined }));
            }}
            emailLocked={self}
          />
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">Rol</legend>
            {/* Kendi yönetici yetkinizi kaldıramazsınız (sunucu da reddeder) */}
            <ChoiceCards name="u-role" value={role} onChange={setRole} options={ROLE_OPTIONS} disabled={(v) => self && v !== "admin"} />
            {self ? <p className="mt-1.5 text-xs text-ink-mute">Kendi yönetici yetkinizi kaldıramazsınız; başka bir yönetici değiştirebilir.</p> : null}
            {role === "staff" ? (
              <div className="mt-3">
                <UserBranchField id="u-branch" value={branchId} onChange={setBranchId} />
              </div>
            ) : null}
          </fieldset>
          {self ? null : (
            <PasswordField
              id={EDIT_IDS.password}
              label={user.invite !== "none" ? "Parola (davet yerine siz belirleyin)" : "Yeni parola (değiştirmek için)"}
              hint={
                user.invite !== "none"
                  ? "Boş bırakırsanız kişi davet bağlantısıyla belirler. Yazarsanız davet bağlantısı geçersiz olur."
                  : "Boş bırakırsanız parola değişmez. Değişirse kişinin açık oturumları kapanır."
              }
              error={errors.password}
              value={password}
              email={email}
              onChange={(v) => {
                setPassword(v);
                setErrors((x) => ({ ...x, password: undefined }));
              }}
            />
          )}
          {self ? (
            <Notice tone="neutral" size="sm" title="Kendi hesabınızı pasif yapamazsınız" />
          ) : (
            <ToggleRow
              title={invited ? "Aktif" : "Aktif (giriş yapabilir)"}
              description={
                !active
                  ? "Pasif hesapla giriş yapılamaz; bilgiler saklanır."
                  : invited
                    ? "Henüz giriş yapamaz: kişi davet bağlantısından parolasını belirleyince girebilir."
                    : "Bu hesapla giriş yapılabilir."
              }
              label={invited ? "Aktif" : "Aktif (giriş yapabilir)"}
              checked={active}
              onChange={setActive}
            />
          )}
          {asksPassword ? <p className="px-1 text-xs leading-5 text-ink-mute">Bu değişiklik bir yönetici hesabını etkiliyor; kaydederken kendi parolanız sorulur.</p> : null}
          {user.locked || !self ? security : null}
        </form>
      </Dialog>
      {/* Onay penceresi düzenleme penceresinin içinde değil yanında: React içteki <dialog>'un close/cancel olayını
          dıştakine de iletir; içteki kapanınca düzenleme penceresi de kapanırdı */}
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && run(confirm)}
        title={confirm ? confirmText[confirm].title : ""}
        description={confirm ? confirmText[confirm].description : undefined}
        confirmLabel={confirm ? confirmText[confirm].label : undefined}
      />
      {stepUp.dialog}
    </>
  );
}

// ---------------------------------------------------------------- Roller

// Yetki tablosu src/lib/roles.ts'te (personelin her ekranı bir satırda: tests/personel-yetkileri.test.ts)

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

/** `twoFactorRequired`: yönetici hesaplarında iki adımlı zorunlu (src/lib/admin-security.ts; yalnız ADMIN_2FA_REQUIRED=1 iken) */
export function RolesCard({ twoFactorRequired = false }: { twoFactorRequired?: boolean }) {
  return (
    <Card>
      <CardHeader
        icon={<ShieldCheck />}
        title="Roller"
        description={`Her kullanıcının tek rolü vardır. Yetkiler hem menüde hem sunucuda denetlenir. Yönetici eklemek ya da bir yöneticinin rolünü, parolasını, e-postasını değiştirmek kendi parolanızı ister.${
          twoFactorRequired ? " Yönetici hesaplarında iki adımlı doğrulama zorunludur: kurmamış yönetici girişten sonra kurulum ekranına gider." : ""
        }`}
      />
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
            {ROLE_PERMISSIONS.map((p) => (
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

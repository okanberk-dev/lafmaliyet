"use client";

import {
  Activity,
  ArrowDown,
  ArrowUp,
  ClipboardList,
  Coffee,
  Droplets,
  ExternalLink,
  FileText,
  History,
  Package,
  Pencil,
  Percent,
  Plus,
  QrCode,
  Receipt,
  Ruler,
  Save,
  Settings as SettingsIcon,
  Tags,
  Trash2,
  Undo2,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useOptimistic, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { ActivityItem, ActivityList } from "@/components/ui/activity";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader, Well } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { FloatingBar } from "@/components/ui/floating-bar";
import { Field, Input, NumberInput } from "@/components/ui/form";
import { Avatar, type PastelTone } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { Pagination, usePaged } from "@/components/ui/pagination";
import { Switch } from "@/components/ui/switch";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { parseNumberTR } from "@/lib/calc/expr";
import type { Settings } from "@/lib/calc/types";
import { ROLES } from "@/lib/constants";
import { monthLabel, num, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteCategory, saveCategories } from "@/server/actions/products";
import { saveSettings, saveUser } from "@/server/actions/settings";

import { SECTION_SCROLL_MARGIN } from "./sections";

const count = (v: number) => num(Math.round(v), 0);

/** Açıklamalı aç/kapa satırı: solda başlık ve kısa not, sağda paylaşılan anahtar */
function ToggleRow({
  title,
  description,
  tip,
  checked,
  onChange,
  label,
  onText,
  offText,
}: {
  title: ReactNode;
  description?: ReactNode;
  tip?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  onText?: string;
  offText?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <span className="min-w-0">{title}</span>
          {tip ? <InfoTip text={tip} /> : null}
        </p>
        {description ? <p className="mt-0.5 text-xs leading-5 text-ink-mute">{description}</p> : null}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} onText={onText} offText={offText} />
    </div>
  );
}

// ---------------------------------------------------------------- Hesap ayarları

type FieldDef = { key: keyof Settings; label: string; hint: string; kind: "pct" | "num" | "int" };

const RATE_FIELDS: FieldDef[] = [
  { key: "kdv", label: "Satış KDV oranı", hint: "Kafe satışlarında %10", kind: "pct" },
  { key: "komisyon", label: "Banka / POS komisyon oranı", hint: "Sadece kartlı satışlara uygulanır", kind: "pct" },
  { key: "kartOrani", label: "Kartlı satış oranı", hint: "Kredi kartı + yemek kartı ÷ ciro (Patron Eylül: %85,6)", kind: "pct" },
  { key: "hedefMaliyet", label: "Hedef maliyet oranı (food cost)", hint: "Kafeler için ideal %25–35", kind: "pct" },
  { key: "fire", label: "Fire / kayıp payı", hint: "Dökülen süt, atılan kahve, bozulan tatlı", kind: "pct" },
];

const MEASURE_FIELDS: FieldDef[] = [
  { key: "shotTek", label: "Tek shot kahve (gr)", hint: "Solo espresso, formülde ShotTek", kind: "num" },
  { key: "shotCift", label: "Çift shot kahve (gr)", hint: "Formülde ShotCift", kind: "num" },
  { key: "pompa", label: "1 pompa şurup (ml)", hint: "Formülde Pompa", kind: "num" },
  { key: "dondurmaTop", label: "1 top dondurma (ml)", hint: "Formülde DondurmaTop", kind: "num" },
  { key: "tkGr", label: "Türk kahvesi 1 fincan (gr)", hint: "Formülde TKGr", kind: "num" },
  { key: "potGr", label: "Filtre kahve tam pot (gr)", hint: "Formülde PotGr", kind: "num" },
  { key: "potMl", label: "Tam pottan çıkan (ml)", hint: "Varsayım: 1.800 ml. Makinenizin değerini yazın.", kind: "num" },
  { key: "acikGun", label: "Ayda kaç gün açıksınız", hint: "Başabaş ve günlük giderler için", kind: "int" },
];

const ALL_FIELDS = [...RATE_FIELDS, ...MEASURE_FIELDS];

const toText = (v: number, kind: FieldDef["kind"]) => (kind === "pct" ? num(v * 100, 2) : num(v, kind === "int" ? 0 : 2));
const toValue = (v: number, kind: FieldDef["kind"]) => (kind === "pct" ? v / 100 : kind === "int" ? Math.round(v) : v);
const textsOf = (settings: Settings) => Object.fromEntries(ALL_FIELDS.map((f) => [f.key, toText(Number(settings[f.key]), f.kind)]));
const waterText = (v: number | null) => (v === null ? "" : num(v, 4));

/**
 * Alan kayıtlı değerden farklı mı? Biçim farkı ("10" / "10,00") ve ekranda yuvarlanan ondalıklar
 * değişiklik sayılmaz; kayıttan sonra yazılan değer kayıtlı değere eşitse de temiz sayılır.
 */
function isClean(text: string, baseText: string, current: number | null, kind: FieldDef["kind"] = "num") {
  if (text.trim() === baseText.trim()) return true;
  const v = parseNumberTR(text);
  if (v === null) return text.trim() === "" && current === null;
  const b = parseNumberTR(baseText);
  if (b !== null && Math.abs(v - b) < 1e-9) return true;
  return current !== null && Math.abs(toValue(v, kind) - current) < 1e-9;
}

type Water = { perLiter: number; month: string | null; bill: number; liters: number };

/**
 * Oranlar, reçete ölçüleri, su maliyeti ve QR menü tek bir kayıtla saklanır (saveSettings).
 * Değişiklik olunca altta yüzen kaydet çubuğu açılır; bir alandayken Enter da kaydeder.
 */
export function SettingsForm({ settings, water }: { settings: Settings; water: Water }) {
  const [vals, setVals] = useState<Record<string, string>>(() => textsOf(settings));
  const [fireEx, setFireEx] = useState(settings.fireExcludesPackaging);
  const [publicMenu, setPublicMenu] = useState(settings.publicMenu);
  const [waterOv, setWaterOv] = useState(waterText(settings.suBirimLTOverride));
  const [busy, setBusy] = useState(false);

  const base = textsOf(settings);
  const dirty =
    ALL_FIELDS.some((f) => !isClean(vals[f.key], base[f.key], Number(settings[f.key]), f.kind)) ||
    fireEx !== settings.fireExcludesPackaging ||
    publicMenu !== settings.publicMenu ||
    !isClean(waterOv, waterText(settings.suBirimLTOverride), settings.suBirimLTOverride);

  function reset() {
    setVals(textsOf(settings));
    setFireEx(settings.fireExcludesPackaging);
    setPublicMenu(settings.publicMenu);
    setWaterOv(waterText(settings.suBirimLTOverride));
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    const out: Record<string, number | boolean | null> = {};
    for (const f of ALL_FIELDS) {
      const v = parseNumberTR(vals[f.key]);
      if (v === null) return toast.error(`${f.label}: geçerli bir sayı girin`);
      out[f.key] = toValue(v, f.kind);
    }
    out.fireExcludesPackaging = fireEx;
    out.publicMenu = publicMenu;
    // Boş = otomatik; yazılmış ama okunamayan değer sessizce "otomatik"e dönmesin
    const waterValue = waterOv.trim() === "" ? null : parseNumberTR(waterOv);
    if (waterOv.trim() !== "" && waterValue === null) return toast.error("Elle birim maliyet: geçerli bir sayı girin ya da boş bırakın");
    out.suBirimLTOverride = waterValue;
    setBusy(true);
    const res = await saveSettings(out);
    setBusy(false);
    if (res.ok) toast.success("Ayarlar kaydedildi; bütün hesaplar güncellendi");
    else toast.error(res.error);
  }

  const field = (f: FieldDef) => (
    <Field key={f.key} label={`${f.label}${f.kind === "pct" ? " (%)" : ""}`} hint={f.hint} htmlFor={`s-${f.key}`}>
      <NumberInput id={`s-${f.key}`} value={vals[f.key]} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} className="cell-input" />
    </Field>
  );

  const waterSource = water.month
    ? `${monthLabel(water.month)} su faturası ${tl(water.bill)} ÷ ${num(water.liters, 0)} L`
    : settings.suBirimLTOverride !== null
      ? "Elle girildi"
      : "Gelir-gider tablosunda SU GİDERİ girilmedi";

  return (
    <form id="settings-form" onSubmit={save} data-dirty={dirty || undefined} className="space-y-4">
      <Card id="oranlar" className={SECTION_SCROLL_MARGIN}>
        <CardHeader
          icon={<Percent />}
          title="Oranlar"
          description="Menü fiyatları KDV dahil; maliyetler KDV hariç (alışta ödenen KDV indirilebildiği için). Önerilen fiyat hedef maliyet oranına göre hesaplanır."
        />
        <CardContent className="space-y-4">
          <div className="grid gap-4 @lg:grid-cols-2 @3xl:grid-cols-3">{RATE_FIELDS.map(field)}</div>
          <ToggleRow
            title="Fireyi ambalaja (bardak, kapak, peçete) uygulama"
            tip="Excel formülü fireyi ambalaj dahil uyguluyordu; notu ise hariç diyordu."
            description={fireEx ? "Fire yalnızca malzemelere eklenir." : "Fire ambalaj dahil bütün reçeteye eklenir."}
            label="Fireyi ambalaja uygulama"
            onText="Ambalaja uygulanmıyor"
            offText="Ambalaja uygulanıyor"
            checked={fireEx}
            onChange={setFireEx}
          />
        </CardContent>
      </Card>

      <Card id="olculer" className={SECTION_SCROLL_MARGIN}>
        <CardHeader
          icon={<Ruler />}
          title="Reçete ölçüleri"
          description="Reçetelerde formülle bağlı miktarlar (ShotTek, Pompa …) ve ayda açık gün sayısı. Değiştirince bağlı bütün reçeteler ve hesaplar güncellenir."
        />
        <CardContent className="grid gap-4 @lg:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4">{MEASURE_FIELDS.map(field)}</CardContent>
      </Card>

      <div className="grid gap-4 @3xl:grid-cols-2">
        <Card id="su" className={SECTION_SCROLL_MARGIN}>
          <CardHeader icon={<Droplets />} title="Su + buz birim maliyeti" description="Reçetelerdeki su ve buzun litre maliyeti." />
          <CardContent className="space-y-4">
            <Well className="ring-1 ring-line">
              <p className="text-[13px] text-ink-mute">Şu an</p>
              <p className="mt-0.5 text-2xl font-semibold tracking-tight text-ink tabular">
                {tl(water.perLiter, 4)}
                <span className="ml-0.5 text-sm font-medium text-ink-mute">/L</span>
              </p>
              <p className="mt-1 text-xs text-ink-mute">{waterSource}</p>
            </Well>
            <Field label="Elle birim maliyet (₺/L)" hint="Boş bırakırsanız su faturasından otomatik hesaplanır" htmlFor="s-water">
              <NumberInput id="s-water" value={waterOv} onChange={(e) => setWaterOv(e.target.value)} placeholder="otomatik" className="cell-input" />
            </Field>
          </CardContent>
        </Card>

        <Card id="qr-menu" className={SECTION_SCROLL_MARGIN}>
          <CardHeader
            icon={<QrCode />}
            title="QR menü"
            description="laffogato.net/menu"
            meta={
              <Badge dot tone={settings.publicMenu ? "green" : "gray"}>
                {settings.publicMenu ? "Yayında" : "Yayında değil"}
              </Badge>
            }
            actions={
              <ButtonLink href="/menu?onizleme=1" variant="secondary" target="_blank" prefetch={false}>
                <ExternalLink size={16} /> Önizle
              </ButtonLink>
            }
          />
          <CardContent className="space-y-4">
            <p className="text-[13px] leading-5 text-ink-mute">
              Ürün adları, boyları ve satış fiyatları herkese açık bir menü sayfasında yayınlanır. Maliyet ve kâr bilgisi asla gösterilmez. Ürün kartında &quot;QR menüde göster&quot; ile
              ürün bazında gizleyebilirsiniz.
            </p>
            <ToggleRow
              title="Menüyü yayınla"
              description={publicMenu ? "Kaydedince menü herkese açık olur." : "Kaydedince menü sayfası kapanır."}
              label="Menüyü yayınla"
              onText="Yayında"
              offText="Yayında değil"
              checked={publicMenu}
              onChange={setPublicMenu}
            />
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-panel px-4 py-3">
        <p className="text-[13px] text-ink-mute">Kaydettiğinizde bütün hesaplar (reçete maliyetleri, kârlılık, gelir-gider) güncellenir.</p>
        <Button type="submit" variant={dirty ? "primary" : "secondary"} disabled={busy}>
          <Save size={16} /> {busy ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </div>

      <FloatingBar open={dirty}>
        <p className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-ink-mute" aria-live="polite">
          <span className="size-2 shrink-0 rounded-full bg-warn" aria-hidden="true" /> Kaydedilmemiş değişiklikler var
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={reset} disabled={busy}>
            <Undo2 size={16} /> Geri al
          </Button>
          <Button type="submit" form="settings-form" disabled={busy}>
            <Save size={16} /> {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </FloatingBar>
    </form>
  );
}

// ---------------------------------------------------------------- Kullanıcılar

type UserRow = { id: number; name: string; email: string; role: "admin" | "staff"; active: boolean; lastLoginAt: string | null };

/**
 * AkmanOS "User list": avatar + ad + soluk e-posta, rol rozeti, noktalı durum rozeti, son giriş;
 * satır sonunda aktif/pasif anahtarı ve düzenle. Pasif yapmak onay ister; anahtar sonucu hemen gösterir.
 */
export function UsersEditor({ users, meId }: { users: UserRow[]; meId: number }) {
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);
  const [confirmOff, setConfirmOff] = useState<UserRow | null>(null);
  const [pending, startTransition] = useTransition();
  const [rows, setOptimistic] = useOptimistic(users, (state, p: { id: number; active: boolean }) => state.map((u) => (u.id === p.id ? { ...u, active: p.active } : u)));
  const activeCount = rows.filter((u) => u.active).length;

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
    <Button variant="secondary" onClick={() => setEditing("new")}>
      <UserPlus size={16} /> Kullanıcı ekle
    </Button>
  );

  return (
    <Card id="kullanicilar" className={SECTION_SCROLL_MARGIN}>
      <CardHeader
        icon={<Users />}
        title="Kullanıcılar"
        description="Yönetici her şeyi görür. Personel yalnızca stok sayımı ve reçete defterini görür (maliyet, maaş ve kâr gizlidir)."
        meta={
          <>
            <span>Aktif</span>
            <span className="text-ink-quiet">·</span>
            <AnimatedNumber value={activeCount} format={count} className="font-semibold text-ink tabular" />
            <span className="text-ink-quiet">/</span>
            <span className="tabular">{rows.length} kullanıcı</span>
          </>
        }
        actions={addButton}
      />
      {rows.length ? (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>Kullanıcı</TH>
                <TH>Rol</TH>
                <TH>Durum</TH>
                <TH>Son giriş</TH>
                <TH>
                  <span className="sr-only">Eylemler</span>
                </TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((u) => {
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
                      <Badge dot tone={u.active ? "green" : "gray"}>
                        {u.active ? "Aktif" : "Pasif"}
                      </Badge>
                    </TD>
                    <TD className="text-[13px] whitespace-nowrap text-ink-mute tabular">{u.lastLoginAt ?? "–"}</TD>
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
      ) : (
        <EmptyState icon={<Users />} title="Kullanıcı yok" action={addButton} />
      )}
      {editing ? <UserDialog user={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        open={confirmOff !== null}
        onClose={() => setConfirmOff(null)}
        onConfirm={() => confirmOff && setActive(confirmOff, false)}
        title={confirmOff ? `${confirmOff.name} pasif yapılsın mı?` : ""}
        description="Bu kullanıcı bir daha giriş yapamaz. Bilgileri silinmez; istediğiniz zaman yeniden aktif yapabilirsiniz."
        confirmLabel="Pasif yap"
      />
    </Card>
  );
}

const ROLE_OPTIONS: { value: "staff" | "admin"; label: string; hint: string }[] = [
  { value: "staff", label: "Personel", hint: "Sayım + reçete defteri" },
  { value: "admin", label: "Yönetici", hint: "Her şey" },
];

function UserDialog({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<"admin" | "staff">(user?.role ?? "staff");
  const [active, setActive] = useState(user?.active ?? true);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await saveUser({ id: user?.id ?? null, name, email, role, active, password: password || undefined });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Kullanıcı kaydedildi");
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={user ? "Kullanıcıyı düzenle" : "Kullanıcı ekle"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form="user-form" disabled={busy}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} noValidate className="space-y-4 pb-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ad" htmlFor="u-n">
            <Input id="u-n" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="E-posta" htmlFor="u-e">
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
        <Field label={user ? "Yeni parola (değiştirmek için)" : "Parola"} hint="En az 8 karakter" htmlFor="u-p">
          <Input id="u-p" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ToggleRow
          title="Aktif (giriş yapabilir)"
          description={active ? "Bu hesapla giriş yapılabilir." : "Pasif hesapla giriş yapılamaz; bilgiler saklanır."}
          label="Aktif (giriş yapabilir)"
          checked={active}
          onChange={setActive}
        />
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Kategoriler

type Category = { id: number; name: string; count: number };
type CategoryRow = Category & { key: number };

/**
 * Sunucudan yeni liste gelince (kaydet, sil) yerel düzenlemeleri koruyarak eşitler: yeni kaydedilen satırlar
 * gerçek kimliğini alır (bir daha kaydedince ikinci kez eklenmez), silinenler düşer, ürün sayıları güncellenir.
 */
function mergeCategories(rows: CategoryRow[], cats: Category[]): CategoryRow[] {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const taken = new Set(rows.filter((r) => r.id && byId.has(r.id)).map((r) => r.id));
  const out: CategoryRow[] = [];
  for (const r of rows) {
    if (r.id) {
      const c = byId.get(r.id);
      if (c) out.push({ ...r, count: c.count });
      continue;
    }
    const match = cats.find((c) => !taken.has(c.id) && c.name === r.name.trim());
    if (match) {
      taken.add(match.id);
      out.push({ ...r, id: match.id, count: match.count });
    } else out.push(r);
  }
  for (const c of cats) if (!taken.has(c.id)) out.push({ ...c, key: c.id });
  return out;
}

export function CategoriesEditor({ categories }: { categories: Category[] }) {
  const [rows, setRows] = useState<CategoryRow[]>(() => categories.map((c) => ({ ...c, key: c.id })));
  const [synced, setSynced] = useState(categories);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<CategoryRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (synced !== categories) {
    setSynced(categories);
    setRows((r) => mergeCategories(r, categories));
  }

  const dirty = rows.length !== categories.length || rows.some((r, i) => r.id !== categories[i].id || r.name !== categories[i].name);

  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const c = [...r];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });

  async function save() {
    setBusy(true);
    const res = await saveCategories(rows.map((r) => ({ id: r.id || null, name: r.name })));
    setBusy(false);
    if (res.ok) toast.success("Kategoriler kaydedildi");
    else toast.error(res.error);
  }

  async function remove(r: CategoryRow) {
    if (r.id) {
      setDeleting(true);
      const res = await deleteCategory(r.id);
      setDeleting(false);
      if (!res.ok) return toast.error(res.error);
      toast.success(`"${r.name}" silindi`);
    }
    setConfirmDel(null);
    setRows((x) => x.filter((y) => y.key !== r.key));
  }

  return (
    <Card id="kategoriler" className={SECTION_SCROLL_MARGIN}>
      <CardHeader
        icon={<Tags />}
        title="Ürün kategorileri"
        description="Sıra; ürün listesi, panel ve QR menüde kullanılır."
        meta={<span className="tabular">{rows.length} kategori</span>}
        actions={
          <>
            <Button variant="secondary" onClick={() => setRows((r) => [...r, { id: 0, key: -Date.now(), name: "Yeni kategori", count: 0 }])}>
              <Plus size={16} /> Ekle
            </Button>
            <Button variant={dirty ? "primary" : "secondary"} disabled={busy} onClick={save}>
              <Save size={16} /> {busy ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </>
        }
      />
      <CardContent>
        {rows.length ? (
          <ol className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
            {rows.map((r, i) => (
              <li key={r.key} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-2 py-2 sm:flex-nowrap sm:px-3">
                <span className="w-5 shrink-0 text-right text-xs text-ink-quiet tabular">{i + 1}</span>
                <Input
                  aria-label={`${i + 1}. kategorinin adı`}
                  value={r.name}
                  onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))}
                  className="min-w-0 flex-1 basis-[calc(100%-1.75rem)] sm:basis-0"
                />
                <span className="ml-7 flex-1 text-xs text-ink-mute tabular sm:ml-0 sm:w-16 sm:flex-none">{r.count} ürün</span>
                <div className="flex gap-1.5">
                  <IconButton label="Yukarı taşı" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp size={15} />
                  </IconButton>
                  <IconButton label="Aşağı taşı" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown size={15} />
                  </IconButton>
                  <span title={r.count > 0 ? "Kategoride ürün var" : undefined}>
                    <IconButton
                      label={r.count > 0 ? "Kategoride ürün var" : "Sil"}
                      tone="danger"
                      disabled={r.count > 0}
                      onClick={() => (r.id ? setConfirmDel(r) : remove(r))}
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </span>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState icon={<Tags />} title="Kategori yok" description="Ürünleri gruplamak için bir kategori ekleyin." />
        )}
        {dirty ? <p className="mt-3 text-xs text-warn">Değişiklikler henüz kaydedilmedi.</p> : null}
      </CardContent>
      <ConfirmDialog
        open={confirmDel !== null}
        onClose={() => setConfirmDel(null)}
        onConfirm={() => confirmDel && remove(confirmDel)}
        pending={deleting}
        title={confirmDel ? `"${confirmDel.name}" silinsin mi?` : ""}
        description="Kategori kalıcı olarak silinir. İçinde ürün olan kategori silinemez."
      />
    </Card>
  );
}

// ---------------------------------------------------------------- İşlem geçmişi

export type LogEntry = { id: number; at: string; userName: string | null; action: string; detail: string | null };

const ACTION_META: [string[], LucideIcon, PastelTone][] = [
  [["silindi"], Trash2, 3],
  [["kullanıcı", "parola"], UserRound, 4],
  [["ayarlar", "sgk"], SettingsIcon, 5],
  [["satış fiyatı", "reçete", "ürün", "kategori"], Coffee, 1],
  [["fatura"], FileText, 2],
  [["hammadde"], Package, 1],
  [["satış", "pos", "ciro", "açık gün", "ay bilgisi"], Receipt, 0],
  [["sayım", "alınan miktar", "bulgu"], ClipboardList, 2],
  [["gelir-gider", "sabit gider", "personel", "yatırım"], Wallet, 0],
];

function metaFor(action: string): { Icon: LucideIcon; tone: PastelTone } {
  const a = action.toLocaleLowerCase("tr-TR");
  const hit = ACTION_META.find(([keys]) => keys.some((k) => a.includes(k)));
  return hit ? { Icon: hit[1], tone: hit[2] } : { Icon: Activity, tone: 5 };
}

export function ActivityLog({ entries }: { entries: LogEntry[] }) {
  const paged = usePaged(entries, 10);
  return (
    <Card id="gecmis" className={SECTION_SCROLL_MARGIN}>
      <CardHeader icon={<History />} title="İşlem geçmişi" description="Kim, ne zaman, neyi değiştirdi (son 60 kayıt)" />
      {entries.length ? (
        <>
          <CardContent className="pb-2">
            <ActivityList>
              {paged.slice.map((l) => {
                const { Icon, tone } = metaFor(l.action);
                return (
                  <ActivityItem
                    key={l.id}
                    icon={<Icon />}
                    tone={tone}
                    title={<span title={l.action}>{l.action}</span>}
                    aside={l.at}
                    description={
                      <span title={l.detail ?? undefined}>
                        <span className="font-medium text-ink-soft">{l.userName ?? "Sistem"}</span>
                        {l.detail ? ` · ${l.detail}` : null}
                      </span>
                    }
                  />
                );
              })}
            </ActivityList>
          </CardContent>
          <Pagination page={paged.page} pageCount={paged.pageCount} onChange={paged.setPage} total={paged.total} unit="kayıt" className="mt-auto border-t border-line" />
        </>
      ) : (
        <EmptyState icon={<History />} title="Henüz işlem yok" description="Ayar, fiyat ya da reçete değiştikçe burada listelenir." />
      )}
    </Card>
  );
}

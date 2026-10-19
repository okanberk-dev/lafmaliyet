"use client";

import { ArrowDown, ArrowUp, ExternalLink, Plus, Save, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, NumberInput, Select } from "@/components/ui/form";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { parseNumberTR } from "@/lib/calc/expr";
import type { Settings } from "@/lib/calc/types";
import { ROLES } from "@/lib/constants";
import { num, tl } from "@/lib/format";
import { deleteCategory, saveCategories } from "@/server/actions/products";
import { saveSettings, saveUser } from "@/server/actions/settings";

type FieldDef = { key: keyof Settings; label: string; hint: string; kind: "pct" | "num" | "int" };

const GROUPS: { title: string; description: string; fields: FieldDef[] }[] = [
  {
    title: "Satış ve komisyon",
    description: "Menü fiyatları KDV dahil; maliyetler KDV hariç (alışta ödenen KDV indirilebildiği için).",
    fields: [
      { key: "kdv", label: "Satış KDV oranı", hint: "Kafe satışlarında %10", kind: "pct" },
      { key: "komisyon", label: "Banka / POS komisyon oranı", hint: "Sadece kartlı satışlara uygulanır", kind: "pct" },
      { key: "kartOrani", label: "Kartlı satış oranı", hint: "Kredi kartı + yemek kartı ÷ ciro (Patron Eylül: %85,6)", kind: "pct" },
    ],
  },
  {
    title: "Hedefler ve fire",
    description: "Önerilen fiyat hedef maliyet oranına göre hesaplanır.",
    fields: [
      { key: "hedefMaliyet", label: "Hedef maliyet oranı (food cost)", hint: "Kafeler için ideal %25–35", kind: "pct" },
      { key: "fire", label: "Fire / kayıp payı", hint: "Dökülen süt, atılan kahve, bozulan tatlı", kind: "pct" },
      { key: "acikGun", label: "Ayda kaç gün açıksınız", hint: "Başabaş ve günlük giderler için", kind: "int" },
    ],
  },
  {
    title: "Reçete ölçüleri",
    description: "Reçetelerde formülle bağlı miktarlar (ShotTek, Pompa …). Değiştirince bağlı bütün reçeteler güncellenir.",
    fields: [
      { key: "shotTek", label: "Tek shot kahve (gr)", hint: "Solo espresso, formülde ShotTek", kind: "num" },
      { key: "shotCift", label: "Çift shot kahve (gr)", hint: "Formülde ShotCift", kind: "num" },
      { key: "pompa", label: "1 pompa şurup (ml)", hint: "Formülde Pompa", kind: "num" },
      { key: "dondurmaTop", label: "1 top dondurma (ml)", hint: "Formülde DondurmaTop", kind: "num" },
      { key: "tkGr", label: "Türk kahvesi 1 fincan (gr)", hint: "Formülde TKGr", kind: "num" },
      { key: "potGr", label: "Filtre kahve tam pot (gr)", hint: "Formülde PotGr", kind: "num" },
      { key: "potMl", label: "Tam pottan çıkan (ml)", hint: "Varsayım: 1.800 ml. Makinenizin değerini yazın.", kind: "num" },
    ],
  },
];

const toText = (v: number, kind: FieldDef["kind"]) => (kind === "pct" ? num(v * 100, 2) : num(v, kind === "int" ? 0 : 2));

export function SettingsForm({ settings, water }: { settings: Settings; water: { perLiter: number; month: string | null; bill: number; liters: number } }) {
  const all = GROUPS.flatMap((g) => g.fields);
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(all.map((f) => [f.key, toText(Number(settings[f.key]), f.kind)])));
  const [fireEx, setFireEx] = useState(settings.fireExcludesPackaging);
  const [publicMenu, setPublicMenu] = useState(settings.publicMenu);
  const [waterOv, setWaterOv] = useState(settings.suBirimLTOverride === null ? "" : num(settings.suBirimLTOverride, 4));
  const [busy, setBusy] = useState(false);

  async function save() {
    const out: Record<string, number | boolean | null> = {};
    for (const f of all) {
      const v = parseNumberTR(vals[f.key]);
      if (v === null) return toast.error(`${f.label}: geçerli bir sayı girin`);
      out[f.key] = f.kind === "pct" ? v / 100 : f.kind === "int" ? Math.round(v) : v;
    }
    out.fireExcludesPackaging = fireEx;
    out.publicMenu = publicMenu;
    out.suBirimLTOverride = waterOv.trim() === "" ? null : parseNumberTR(waterOv);
    setBusy(true);
    const res = await saveSettings(out);
    setBusy(false);
    if (res.ok) toast.success("Ayarlar kaydedildi; bütün hesaplar güncellendi");
    else toast.error(res.error);
  }

  return (
    <Card>
      <CardHeader
        title="Hesap ayarları"
        actions={
          <Button onClick={save} disabled={busy}>
            <Save size={16} /> {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        }
      />
      <CardContent className="grid gap-6 lg:grid-cols-3">
        {GROUPS.map((g) => (
          <div key={g.title} className="space-y-3">
            <div>
              <p className="font-semibold text-coffee-950">{g.title}</p>
              <p className="text-xs text-coffee-500">{g.description}</p>
            </div>
            {g.fields.map((f) => (
              <Field key={f.key} label={`${f.label}${f.kind === "pct" ? " (%)" : ""}`} hint={f.hint} htmlFor={`s-${f.key}`}>
                <NumberInput id={`s-${f.key}`} value={vals[f.key]} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} className="cell-input" />
              </Field>
            ))}
            {g.title === "Hedefler ve fire" ? (
              <Checkbox
                label="Fireyi ambalaja (bardak, kapak, peçete) uygulama"
                checked={fireEx}
                onChange={(e) => setFireEx(e.target.checked)}
                title="Excel formülü fireyi ambalaj dahil uyguluyordu; notu ise hariç diyordu."
              />
            ) : null}
          </div>
        ))}
        <div className="space-y-3 lg:col-span-3">
          <hr className="border-coffee-100" />
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <p className="font-semibold text-coffee-950">Su + buz birim maliyeti</p>
              <p className="text-sm text-coffee-600">
                Şu an: <strong>{tl(water.perLiter, 4)}/L</strong>{" "}
                {water.month ? `(${water.month} su faturası ${tl(water.bill)} ÷ ${num(water.liters, 0)} L)` : settings.suBirimLTOverride !== null ? "(elle girildi)" : "(Gelir-gider tablosunda SU GİDERİ girilmedi)"}
              </p>
              <Field label="Elle birim maliyet (₺/L)" hint="Boş bırakırsanız su faturasından otomatik hesaplanır" htmlFor="s-water">
                <NumberInput id="s-water" value={waterOv} onChange={(e) => setWaterOv(e.target.value)} placeholder="otomatik" className="cell-input" />
              </Field>
            </div>
            <div className="space-y-2">
              <p className="font-semibold text-coffee-950">QR menü (laffogato.net/menu)</p>
              <p className="text-sm text-coffee-600">
                Ürün adları, boyları ve satış fiyatları herkese açık bir menü sayfasında yayınlanır. Maliyet ve kâr bilgisi asla gösterilmez. Ürün kartında &quot;QR menüde göster&quot; ile ürün bazında gizleyebilirsiniz.
              </p>
              <Checkbox label="Menüyü yayınla" checked={publicMenu} onChange={(e) => setPublicMenu(e.target.checked)} />
              <div>
                <ButtonLink href="/menu?onizleme=1" size="sm" variant="outline" target="_blank" prefetch={false}>
                  <ExternalLink size={14} /> Önizle
                </ButtonLink>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- Kullanıcılar

type UserRow = { id: number; name: string; email: string; role: "admin" | "staff"; active: boolean; lastLoginAt: string | null };

export function UsersEditor({ users, meId }: { users: UserRow[]; meId: number }) {
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);
  return (
    <Card>
      <CardHeader
        title="Kullanıcılar"
        description="Yönetici her şeyi görür. Personel yalnızca stok sayımı ve reçete defterini görür (maliyet, maaş ve kâr gizlidir)."
        actions={
          <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
            <UserPlus size={14} /> Kullanıcı ekle
          </Button>
        }
      />
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <TH>Ad</TH>
              <TH>Rol</TH>
              <TH>Son giriş</TH>
            </tr>
          </THead>
          <tbody>
            {users.map((u) => (
              <TR key={u.id} className={u.active ? "cursor-pointer" : "cursor-pointer opacity-50"} onClick={() => setEditing(u)}>
                <TD>
                  <span className="font-medium">{u.name}</span>
                  {u.id === meId ? <span className="ml-2 text-xs text-coffee-500">(siz)</span> : null}
                  <span className="block text-xs text-coffee-500">{u.email}</span>
                </TD>
                <TD>
                  <Badge tone={u.role === "admin" ? "coffee" : "blue"}>{ROLES[u.role]}</Badge>
                  {!u.active ? <Badge tone="gray" className="ml-1">Pasif</Badge> : null}
                </TD>
                <TD className="text-xs text-coffee-600">{u.lastLoginAt ?? "–"}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      {editing ? <UserDialog user={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function UserDialog({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<"admin" | "staff">(user?.role ?? "staff");
  const [active, setActive] = useState(user?.active ?? true);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={onClose} title={user ? "Kullanıcıyı düzenle" : "Kullanıcı ekle"}>
      <div className="space-y-3">
        <Field label="Ad" htmlFor="u-n">
          <Input id="u-n" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="E-posta" htmlFor="u-e">
          <Input id="u-e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Rol" htmlFor="u-r">
          <Select id="u-r" value={role} onChange={(e) => setRole(e.target.value as "admin" | "staff")}>
            <option value="staff">Personel (sayım + reçete defteri)</option>
            <option value="admin">Yönetici (her şey)</option>
          </Select>
        </Field>
        <Field label={user ? "Yeni parola (değiştirmek için)" : "Parola"} hint="En az 8 karakter" htmlFor="u-p">
          <Input id="u-p" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Checkbox label="Aktif (giriş yapabilir)" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await saveUser({ id: user?.id ?? null, name, email, role, active, password: password || undefined });
              setBusy(false);
              if (!res.ok) return toast.error(res.error);
              toast.success("Kullanıcı kaydedildi");
              onClose();
            }}
          >
            Kaydet
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Kategoriler

export function CategoriesEditor({ categories }: { categories: { id: number; name: string; count: number }[] }) {
  const [rows, setRows] = useState(categories.map((c) => ({ ...c, key: c.id })));
  const [busy, setBusy] = useState(false);
  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const c = [...r];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  return (
    <Card>
      <CardHeader
        title="Ürün kategorileri"
        description="Sıra; ürün listesi, panel ve QR menüde kullanılır."
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => setRows((r) => [...r, { id: 0, key: -Date.now(), name: "Yeni kategori", count: 0 }])}>
              <Plus size={14} /> Ekle
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const res = await saveCategories(rows.map((r) => ({ id: r.id || null, name: r.name })));
                setBusy(false);
                if (res.ok) toast.success("Kategoriler kaydedildi");
                else toast.error(res.error);
              }}
            >
              <Save size={14} /> Kaydet
            </Button>
          </>
        }
      />
      <CardContent className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={r.key} className="flex items-center gap-2">
            <span className="w-6 text-right text-xs text-coffee-400">{i + 1}</span>
            <Input value={r.name} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} className="h-9" />
            <span className="w-16 shrink-0 text-xs text-coffee-500">{r.count} ürün</span>
            <button type="button" onClick={() => move(i, -1)} className="rounded p-1 text-coffee-400 hover:bg-coffee-50" aria-label="Yukarı">
              <ArrowUp size={14} />
            </button>
            <button type="button" onClick={() => move(i, 1)} className="rounded p-1 text-coffee-400 hover:bg-coffee-50" aria-label="Aşağı">
              <ArrowDown size={14} />
            </button>
            <button
              type="button"
              disabled={r.count > 0}
              title={r.count > 0 ? "Kategoride ürün var" : "Sil"}
              onClick={async () => {
                if (r.id) {
                  const res = await deleteCategory(r.id);
                  if (!res.ok) return toast.error(res.error);
                }
                setRows((x) => x.filter((_, j) => j !== i));
              }}
              className="rounded p-1 text-coffee-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30"
              aria-label="Sil"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

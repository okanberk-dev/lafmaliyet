"use client";

import {
  Activity,
  ArrowDown,
  ArrowUp,
  Bell,
  ClipboardList,
  Coffee,
  Droplets,
  ExternalLink,
  FileText,
  History,
  Package,
  Percent,
  Plus,
  PlugZap,
  QrCode,
  Receipt,
  Ruler,
  Save,
  Settings as SettingsIcon,
  Tags,
  Trash2,
  Undo2,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ActivityItem, ActivityList } from "@/components/ui/activity";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader, Well } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { clearQuery, FilterBar, fold, matches, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { FloatingBar } from "@/components/ui/floating-bar";
import { Field, Input, NumberInput, Select } from "@/components/ui/form";
import { type PastelTone } from "@/components/ui/icon-tile";
import { EmptyState } from "@/components/ui/misc";
import { Pagination, usePaged } from "@/components/ui/pagination";
import { ToggleRow } from "@/components/ui/toggle-row";
import { parseNumberTR } from "@/lib/calc/expr";
import type { Settings } from "@/lib/calc/types";
import { monthLabel, num, tl } from "@/lib/format";
import { deleteCategory, saveCategories } from "@/server/actions/products";
import { saveSettings } from "@/server/actions/settings";

import { SECTION_SCROLL_MARGIN } from "./sections";


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
/** Yüzde alanında "%10" ya da "10%" yazılırsa da 10 okunur (parseNumberTR "%"yi kendisi 100'e bölerdi) */
const parseField = (text: string, kind: FieldDef["kind"]) => parseNumberTR(kind === "pct" ? text.replace(/%/g, "") : text);

/**
 * Alan kayıtlı değerden farklı mı? Biçim farkı ("10" / "10,00") ve ekranda yuvarlanan ondalıklar
 * değişiklik sayılmaz; kayıttan sonra yazılan değer kayıtlı değere eşitse de temiz sayılır.
 */
function isClean(text: string, baseText: string, current: number | null, kind: FieldDef["kind"] = "num") {
  if (text.trim() === baseText.trim()) return true;
  const v = parseField(text, kind);
  if (v === null) return text.trim() === "" && current === null;
  const b = parseField(baseText, kind);
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
  const changedFields = ALL_FIELDS.filter((f) => !isClean(vals[f.key], base[f.key], Number(settings[f.key]), f.kind));
  const waterChanged = !isClean(waterOv, waterText(settings.suBirimLTOverride), settings.suBirimLTOverride);
  const dirty = changedFields.length > 0 || fireEx !== settings.fireExcludesPackaging || publicMenu !== settings.publicMenu || waterChanged;
  // Okunamayan alan anında işaretlensin (kaydetmeyi beklemeden)
  const invalid = (f: FieldDef) => vals[f.key].trim() === "" || parseField(vals[f.key], f.kind) === null;
  const waterInvalid = waterOv.trim() !== "" && parseNumberTR(waterOv) === null;

  function reset() {
    setVals(textsOf(settings));
    setFireEx(settings.fireExcludesPackaging);
    setPublicMenu(settings.publicMenu);
    setWaterOv(waterText(settings.suBirimLTOverride));
  }

  /** Yalnızca değişen alanlar gönderilir: işlem geçmişinde neyin değiştiği okunur */
  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!dirty) return void toast("Değişiklik yok", { description: "Kaydedilecek yeni bir değer girilmedi." });
    const out: Record<string, number | boolean | null> = {};
    for (const f of changedFields) {
      const v = parseField(vals[f.key], f.kind);
      if (v === null) {
        document.getElementById(`s-${f.key}`)?.focus();
        return void toast.error(`${f.label}: geçerli bir sayı girin`);
      }
      out[f.key] = toValue(v, f.kind);
    }
    if (fireEx !== settings.fireExcludesPackaging) out.fireExcludesPackaging = fireEx;
    if (publicMenu !== settings.publicMenu) out.publicMenu = publicMenu;
    if (waterChanged) {
      // Boş = otomatik; yazılmış ama okunamayan değer sessizce "otomatik"e dönmesin
      if (waterInvalid) {
        document.getElementById("s-water")?.focus();
        return void toast.error("Elle birim maliyet: geçerli bir sayı girin ya da boş bırakın");
      }
      out.suBirimLTOverride = waterOv.trim() === "" ? null : parseNumberTR(waterOv);
    }
    setBusy(true);
    const res = await saveSettings(out);
    setBusy(false);
    if (res.ok) toast.success("Ayarlar kaydedildi; bütün hesaplar güncellendi");
    else toast.error(res.error);
  }

  const field = (f: FieldDef) => (
    <Field
      key={f.key}
      label={`${f.label}${f.kind === "pct" ? " (%)" : ""}`}
      hint={f.hint}
      error={invalid(f) ? "Bir sayı girin (ondalık için virgül: 2,5)" : undefined}
      htmlFor={`s-${f.key}`}
    >
      <NumberInput
        id={`s-${f.key}`}
        value={vals[f.key]}
        onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
        aria-invalid={invalid(f) || undefined}
        className="cell-input"
      />
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
            <Field
              label="Elle birim maliyet (₺/L)"
              hint="Boş bırakırsanız su faturasından otomatik hesaplanır"
              error={waterInvalid ? "Bir sayı girin ya da boş bırakın" : undefined}
              htmlFor="s-water"
            >
              <NumberInput
                id="s-water"
                value={waterOv}
                onChange={(e) => setWaterOv(e.target.value)}
                placeholder="otomatik"
                aria-invalid={waterInvalid || undefined}
                className="cell-input"
              />
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
          <span className="size-2 shrink-0 rounded-full bg-warn" aria-hidden="true" />
          {/* Telefonda iki düğmenin yanında tek satıra sığsın */}
          <span className="sm:hidden">Kaydedilmedi</span>
          <span className="max-sm:hidden">Kaydedilmemiş değişiklikler var</span>
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
  const savedName = new Map(categories.map((c) => [c.id, c.name]));

  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const c = [...r];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });

  const focusRow = (key: number) => requestAnimationFrame(() => document.getElementById(`cat-${key}`)?.focus());

  /** Yeni satır boş adla sona eklenir ve odaklanır; yazıp Enter'a basmak kaydeder */
  function add() {
    const key = -Date.now();
    setRows((r) => [...r, { id: 0, key, name: "", count: 0 }]);
    focusRow(key);
  }

  async function save() {
    const empty = rows.find((r) => !r.name.trim());
    if (empty) {
      focusRow(empty.key);
      return void toast.error("Kategori adı boş olamaz", { description: "Adı yazın ya da satırı silin." });
    }
    // Ad veritabanında tekil; "Tatlılar" / "tatlilar" gibi ikinci yazımı kayıttan önce yakala
    const seen = new Set<string>();
    let dup: CategoryRow | undefined;
    for (const r of rows) {
      const k = fold(r.name.trim());
      if (seen.has(k)) {
        dup = r;
        break;
      }
      seen.add(k);
    }
    if (dup) {
      focusRow(dup.key);
      return void toast.error(`"${dup.name.trim()}" iki kez yazılmış`, { description: "Her kategorinin adı farklı olmalı." });
    }
    setBusy(true);
    const res = await saveCategories(rows.map((r) => ({ id: r.id || null, name: r.name })));
    setBusy(false);
    if (res.ok) toast.success("Kategoriler kaydedildi", { description: "Sıra ürün listesinde ve QR menüde de güncellendi." });
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
        description="Sıra; ürün listesi, panel ve QR menüde kullanılır. Adı yazıp Enter'a basınca kaydedilir."
        meta={<span className="tabular">{rows.length} kategori</span>}
        actions={
          <>
            <Button variant="secondary" onClick={add}>
              <Plus size={16} /> Ekle
            </Button>
            <Button variant={dirty ? "primary" : "secondary"} disabled={busy || !dirty} onClick={save}>
              <Save size={16} /> {busy ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </>
        }
      />
      <CardContent>
        {rows.length ? (
          <ol className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
            {rows.map((r, i) => {
              const before = r.id ? savedName.get(r.id) : undefined;
              const changed = !r.id || before !== r.name;
              return (
                <li key={r.key} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-2 py-2 sm:flex-nowrap sm:px-3">
                  <span className="w-5 shrink-0 text-right text-xs text-ink-quiet tabular">{i + 1}</span>
                  <Input
                    id={`cat-${r.key}`}
                    aria-label={`${i + 1}. kategorinin adı`}
                    value={r.name}
                    placeholder="Kategori adı"
                    maxLength={60}
                    enterKeyHint="done"
                    data-warn={changed || undefined}
                    onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        if (dirty && !busy) void save();
                      } else if (e.key === "Escape" && before !== undefined && before !== r.name) {
                        // Esc yazılanı geri alır (kayıtlı ada döner)
                        e.preventDefault();
                        setRows((x) => x.map((y, j) => (j === i ? { ...y, name: before } : y)));
                      }
                    }}
                    className="min-w-0 flex-1 basis-[calc(100%-1.75rem)] sm:basis-0"
                  />
                  <span className="ml-7 flex-1 text-xs text-ink-mute tabular sm:ml-0 sm:w-16 sm:flex-none">{r.id ? `${r.count} ürün` : "yeni"}</span>
                  <div className="flex gap-1.5">
                    <IconButton label={`${r.name || "Kategori"}: yukarı taşı`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp size={15} />
                    </IconButton>
                    <IconButton label={`${r.name || "Kategori"}: aşağı taşı`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown size={15} />
                    </IconButton>
                    <span title={r.count > 0 ? `Kategoride ${r.count} ürün var; önce ürünleri başka kategoriye taşıyın` : undefined}>
                      <IconButton
                        label={r.count > 0 ? "Kategoride ürün var, silinemez" : `${r.name || "Yeni kategori"}: sil`}
                        tone="danger"
                        disabled={r.count > 0}
                        onClick={() => (r.id ? setConfirmDel(r) : remove(r))}
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState
            icon={<Tags />}
            title="Kategori yok"
            description="Ürünleri gruplamak için bir kategori ekleyin."
            action={
              <Button onClick={add}>
                <Plus size={16} /> Kategori ekle
              </Button>
            }
          />
        )}
        {dirty ? (
          <p className="mt-3 flex items-center gap-2 text-xs text-warn" role="status">
            <span className="size-1.5 shrink-0 rounded-full bg-warn" aria-hidden="true" />
            Değişiklikler henüz kaydedilmedi. Kaydet&apos;e ya da bir adın içindeyken Enter&apos;a basın.
          </p>
        ) : null}
      </CardContent>
      <ConfirmDialog
        open={confirmDel !== null}
        onClose={() => setConfirmDel(null)}
        onConfirm={() => confirmDel && remove(confirmDel)}
        pending={deleting}
        title={confirmDel ? `"${savedName.get(confirmDel.id) ?? confirmDel.name}" kategorisi silinsin mi?` : ""}
        description="Kategori kalıcı olarak silinir; geri alınamaz. Kategoride ürün olmadığı için hiçbir ürün etkilenmez."
        confirmLabel="Kategoriyi sil"
      />
    </Card>
  );
}

// ---------------------------------------------------------------- İşlem geçmişi

export type LogEntry = {
  id: number;
  /** "19.10.2026 21:56" (ipucu) */
  at: string;
  iso: string;
  /** Gün anahtarı (YYYY-MM-DD) ve başlığı ("Bugün", "Dün", "17 Ekim 2026 Cumartesi") */
  day: string;
  dayLabel: string;
  time: string;
  userName: string | null;
  action: string;
  detail: string | null;
};

type LogKind = { kind: string; label: string; keys: string[]; Icon: LucideIcon; tone: PastelTone };

/** İşlem adına göre tür (ikon, renk, süzgeç); ilk eşleşen kazanır, bu yüzden "silindi" en başta */
const LOG_KINDS: LogKind[] = [
  { kind: "silme", label: "Silinenler", keys: ["silindi"], Icon: Trash2, tone: 3 },
  { kind: "kullanici", label: "Kullanıcı ve parola", keys: ["kullanıcı", "parola", "oturum", "iki adımlı"], Icon: UserRound, tone: 4 },
  { kind: "ayar", label: "Ayarlar", keys: ["ayarlar", "sgk"], Icon: SettingsIcon, tone: 5 },
  { kind: "parasut", label: "Paraşüt", keys: ["paraşüt"], Icon: PlugZap, tone: 2 },
  { kind: "odeme", label: "Ödeme ve hatırlatıcı", keys: ["hatırlatıcı", "ödeme", "bildirim"], Icon: Bell, tone: 1 },
  { kind: "urun", label: "Ürün ve reçete", keys: ["satış fiyatı", "reçete", "ürün", "kategori"], Icon: Coffee, tone: 1 },
  { kind: "fatura", label: "Fatura", keys: ["fatura"], Icon: FileText, tone: 2 },
  { kind: "hammadde", label: "Hammadde", keys: ["hammadde"], Icon: Package, tone: 1 },
  { kind: "satis", label: "Satış", keys: ["satış", "pos", "ciro", "açık gün", "ay bilgisi"], Icon: Receipt, tone: 0 },
  { kind: "sayim", label: "Stok sayımı", keys: ["sayım", "alınan miktar", "bulgu"], Icon: ClipboardList, tone: 2 },
  { kind: "gider", label: "Gider ve personel", keys: ["gelir-gider", "sabit gider", "personel", "yatırım"], Icon: Wallet, tone: 0 },
];
const OTHER_KIND: LogKind = { kind: "diger", label: "Diğer", keys: [], Icon: Activity, tone: 5 };

function kindOf(action: string): LogKind {
  const a = action.toLocaleLowerCase("tr-TR");
  return LOG_KINDS.find((k) => k.keys.some((key) => a.includes(key))) ?? OTHER_KIND;
}

/**
 * Son işlemler gün gün: arama (işlem, ayrıntı, kişi), türe ve kişiye göre süzgeç. Süzgeçler adreste durur
 * (?ara=latte&tur=urun), sayfa yenilenince korunur.
 */
export function ActivityLog({ entries }: { entries: LogEntry[] }) {
  const [q, setQ] = useQueryText("ara");
  const [kindRaw, setKind] = useQueryState<string>("tur", "");
  const [personRaw, setPerson] = useQueryState<string>("kisi", "");

  const withKind = entries.map((l) => ({ ...l, meta: kindOf(l.action), person: l.userName ?? "Sistem" }));
  const kinds = [...LOG_KINDS, OTHER_KIND]
    .map((k) => ({ ...k, count: withKind.filter((l) => l.meta.kind === k.kind).length }))
    .filter((k) => k.count > 0);
  const people = [...new Set(withKind.map((l) => l.person))].sort((a, b) => a.localeCompare(b, "tr"));
  // Adresteki geçersiz değer (silinmiş tür, artık listede olmayan kişi) süzgeci kilitlemesin
  const kind = kinds.some((k) => k.kind === kindRaw) ? kindRaw : "";
  const person = people.includes(personRaw) ? personRaw : "";

  const shown = withKind.filter(
    (l) => (!kind || l.meta.kind === kind) && (!person || l.person === person) && matches(`${l.action} ${l.detail ?? ""} ${l.person}`, q),
  );
  const filterActive = Boolean(q.trim()) || Boolean(kind) || Boolean(person);
  const paged = usePaged(shown, 10, `${q}|${kind}|${person}`);
  const clear = () => {
    setQ("");
    clearQuery(["ara", "tur", "kisi"]);
  };

  // Sayfadaki kayıtlar gün başlıklarıyla gruplanır
  const days: { day: string; label: string; items: typeof shown }[] = [];
  for (const l of paged.slice) {
    const last = days.at(-1);
    if (last?.day === l.day) last.items.push(l);
    else days.push({ day: l.day, label: l.dayLabel, items: [l] });
  }

  return (
    <Card id="gecmis" className={SECTION_SCROLL_MARGIN}>
      <CardHeader
        icon={<History />}
        title="İşlem geçmişi"
        description="Kim, ne zaman, neyi değiştirdi. Son 60 işlem listelenir; arama ve süzgeçler bunların içinde çalışır."
      />
      {entries.length ? (
        <>
          <FilterBar active={filterActive} onClear={clear} shown={shown.length} total={entries.length} unit="işlem" className="px-5 pb-3">
            <SearchField value={q} onChange={setQ} placeholder="İşlem ya da kişi ara" label="İşlem geçmişinde ara" className="w-full @md:w-64" />
            {kinds.length > 1 || people.length > 1 ? (
              <div className="flex w-full min-w-0 gap-2 @md:w-auto">
                {kinds.length > 1 ? (
                  <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="İşlem türü" className="min-w-0 flex-1 @md:w-auto pointer-coarse:h-10">
                    <option value="">Bütün işlemler</option>
                    {kinds.map((k) => (
                      <option key={k.kind} value={k.kind}>
                        {k.label} ({k.count})
                      </option>
                    ))}
                  </Select>
                ) : null}
                {people.length > 1 ? (
                  <Select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Kişi" className="min-w-0 flex-1 @md:w-auto pointer-coarse:h-10">
                    <option value="">Herkes</option>
                    {people.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>
                ) : null}
              </div>
            ) : null}
          </FilterBar>
          {shown.length ? (
            <>
              <CardContent className="space-y-3 pt-0 pb-2">
                {days.map((g) => (
                  <section key={`${g.day}-${g.items[0].id}`} aria-label={g.label}>
                    <h3 className="px-1 pb-0.5 text-[13px] font-medium text-ink-mute">{g.label}</h3>
                    <ActivityList>
                      {g.items.map((l) => (
                        <ActivityItem
                          key={l.id}
                          icon={<l.meta.Icon />}
                          tone={l.meta.tone}
                          title={<span title={l.action}>{l.action}</span>}
                          aside={
                            <time dateTime={l.iso} title={l.at}>
                              {l.time}
                            </time>
                          }
                          description={
                            <span title={l.detail ?? undefined}>
                              <span className="font-medium text-ink-soft">{l.person}</span>
                              {l.detail ? ` · ${l.detail}` : null}
                            </span>
                          }
                        />
                      ))}
                    </ActivityList>
                  </section>
                ))}
              </CardContent>
              <Pagination page={paged.page} pageCount={paged.pageCount} onChange={paged.setPage} total={paged.total} unit="işlem" className="mt-auto border-t border-line" />
            </>
          ) : (
            <EmptyState
              icon={<History />}
              title="Eşleşen işlem yok"
              description="Aramayı ya da süzgeçleri değiştirin. Daha eski işlemler bu listede yer almaz."
              action={
                <Button variant="secondary" onClick={clear}>
                  Süzgeci temizle
                </Button>
              }
            />
          )}
        </>
      ) : (
        <EmptyState icon={<History />} title="Henüz işlem yok" description="Ayar, fiyat ya da reçete değiştikçe burada listelenir." />
      )}
    </Card>
  );
}

"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { dateTR, money, num } from "@/lib/format";
import { MAX_FILE_BYTES, type ColumnMap, type StatementKind } from "@/lib/mutabakat/parse";
import { ACCOUNT_MAX } from "@/lib/mutabakat/view";
import { previewStatement, saveStatement, type PreviewResult } from "@/server/actions/mutabakat";

interface SupplierOption {
  slug: string;
  name: string;
  invoices: number;
}

/** Ekstre yükle: tür, hesap (ya da tedarikçi), dosya; önizleme ve gerekirse sütun seçimi, sonra kaydet */
export function UploadButton({ suppliers, accounts }: { suppliers: SupplierOption[]; accounts: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Upload size={16} /> Ekstre yükle
      </Button>
      {open ? <UploadDialog suppliers={suppliers} accounts={accounts} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const EMPTY_MAP = (headerRow: number): ColumnMap => ({ headerRow, date: 0, description: null, amount: null, debit: null, credit: null, balance: null, ref: null });

function UploadDialog({ suppliers, accounts, onClose }: { suppliers: SupplierOption[]; accounts: string[]; onClose: () => void }) {
  const ids = { account: useId(), supplier: useId(), file: useId(), list: useId() };
  const router = useRouter();
  const [kind, setKind] = useState<StatementKind>("banka");
  const [account, setAccount] = useState(accounts[0] ?? "");
  const [supplier, setSupplier] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [flip, setFlip] = useState(false);
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  // Önizlemesi gösterilen sütun seçimi: seçim değişip yeniden okunmadıysa kaydedilmez
  const [previewed, setPreviewed] = useState<string | null>(null);
  const [pending, start] = useActionTransition();

  function formData(o: { kind?: StatementKind; file?: File | null; flip?: boolean; map?: ColumnMap | null; supplier?: string }) {
    const fd = new FormData();
    const f = o.file === undefined ? file : o.file;
    fd.set("kind", o.kind ?? kind);
    fd.set("account", account);
    fd.set("supplier", o.supplier ?? supplier);
    if (f) fd.set("file", f);
    if (o.flip ?? flip) fd.set("flip", "1");
    const m = o.map === undefined ? map : o.map;
    if (m) fd.set("map", JSON.stringify(m));
    return fd;
  }

  function runPreview(o: Parameters<typeof formData>[0] = {}) {
    const f = o.file === undefined ? file : o.file;
    if (!f) return;
    start(async () => {
      const r = await previewStatement(formData(o));
      if (!r.ok) {
        setPreview(null);
        setError(r.error);
        return;
      }
      setError(null);
      setPreview(r.data);
      const data = r.data;
      if (data.status === "ready") {
        setMap(data.map);
        setPreviewed(JSON.stringify(data.map));
      } else {
        setPreviewed(null);
        setShowMap(true);
        setMap((m) => m ?? EMPTY_MAP(data.headerRow));
      }
    });
  }

  function pickFile(f: File | null) {
    setPreview(null);
    setError(null);
    setMap(null);
    setShowMap(false);
    setFile(f);
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) {
      setError(`Dosya en çok ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB olabilir; daha kısa bir dönem seçip yeniden indirin`);
      return;
    }
    runPreview({ file: f, map: null });
  }

  const ready = preview?.status === "ready";
  const stale = ready && JSON.stringify(map) !== previewed;
  const hasAccount = kind === "banka" ? account.trim().length > 0 : supplier.length > 0;

  function save() {
    start(
      async () => {
        const r = await saveStatement(formData({}));
        if (!r.ok) return void toast.error(r.error, { duration: 10_000 });
        toast.success(`${num(r.data.inserted)} hareket yüklendi${r.data.duplicates ? ` · ${num(r.data.duplicates)} hareket önceden vardı` : ""}`);
        onClose();
        router.push(`/panel/mutabakat?ekstre=${r.data.id}`);
      },
      { maybeSaved: true },
    );
  }

  const plusLabel = kind === "banka" ? "giren" : "fatura";
  const minusLabel = kind === "banka" ? "çıkan" : "ödeme";

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title="Ekstre yükle"
      description=".xlsx ya da CSV dosyası. Dosya saklanmaz: yalnız hareketler (gün, açıklama, tutar) okunur, 90 gün sonra silinir."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending} className="max-sm:bg-panel">
            Vazgeç
          </Button>
          <Button onClick={save} disabled={!ready || stale || !hasAccount || pending}>
            {pending ? "Bekleyin…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented
          label="Ekstrenin türü"
          value={kind}
          onChange={(v) => {
            setKind(v);
            setMap(null);
            runPreview({ kind: v, map: null });
          }}
          options={[
            { value: "banka", label: "Banka hesabı" },
            { value: "tedarikci", label: "Tedarikçi cari ekstresi" },
          ]}
        />
        {kind === "banka" ? (
          <Field label="Hesap" htmlFor={ids.account} hint="Aynı hesabın ekstresini hep aynı adla yükleyin: önceden yüklenmiş hareketler atlanır.">
            <Input
              id={ids.account}
              list={ids.list}
              value={account}
              maxLength={ACCOUNT_MAX}
              placeholder="ör. Garanti TL"
              onChange={(e) => setAccount(e.target.value)}
              onBlur={() => preview && runPreview()}
            />
            <datalist id={ids.list}>
              {accounts.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </Field>
        ) : (
          <Field label="Tedarikçi" htmlFor={ids.supplier} hint="Ekstre bu tedarikçinin faturaları ve ödemeleriyle eşleşir.">
            <Select
              id={ids.supplier}
              value={supplier}
              onChange={(e) => {
                setSupplier(e.target.value);
                if (preview) runPreview({ supplier: e.target.value });
              }}
            >
              <option value="">Seçin</option>
              {suppliers.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                  {s.invoices ? ` (${num(s.invoices)} fatura)` : ""}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Dosya" htmlFor={ids.file} hint="Bankanın internet şubesinden “Hesap hareketleri” ya da tedarikçinin cari ekstresi. Eski .xls biçimi okunmaz: dosyayı .xlsx olarak kaydedin.">
          <Input id={ids.file} type="file" accept=".xlsx,.csv,.txt,.tsv" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
        </Field>
        {pending && !preview ? <p className="text-sm text-ink-mute">Dosya okunuyor…</p> : null}
        {error ? (
          <Notice tone="bad" size="sm" title="Dosya okunamadı">
            {error}
          </Notice>
        ) : null}
        {preview?.status === "map" ? (
          <Notice tone="warn" size="sm" title={preview.error}>
            Başlık satırını ve sütunları aşağıdan seçip yeniden okuyun.
          </Notice>
        ) : null}
        {preview?.status === "ready" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink">
              <strong>{num(preview.count)} hareket</strong> · {dateTR(preview.period.from)} – {dateTR(preview.period.to)} · {plusLabel} {money(preview.plus)} · {minusLabel}{" "}
              {money(-preview.minus)}
            </p>
            {preview.skipped ? <p className="text-xs text-ink-mute">{num(preview.skipped)} satır atlandı: tarihi ya da tutarı okunamadı (ara toplam, devir, sayfa altı).</p> : null}
            {preview.duplicates ? (
              <p className="text-xs text-warn">
                {num(preview.duplicates)} hareket bu {kind === "banka" ? "hesaba" : "tedarikçiye"} önceden yüklenmiş: yeniden yazılmaz.
              </p>
            ) : null}
            <TableWrap className="rounded-xl bg-surface ring-1 ring-line-strong">
              <Table>
                <THead>
                  <tr>
                    <TH>Gün</TH>
                    <TH>Açıklama</TH>
                    <TH numeric>Tutar</TH>
                  </tr>
                </THead>
                <tbody>
                  {preview.sample.map((l) => (
                    <TR key={l.rowNo}>
                      <TD className="whitespace-nowrap">{dateTR(l.date)}</TD>
                      <TD className="max-w-[20rem] truncate">{l.description || "–"}</TD>
                      <TD numeric>{money(l.amount)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
            <p className="text-xs text-ink-mute">
              {kind === "banka" ? "Hesaba giren artı, çıkan eksi görünmeli." : "Fatura artı, ödeme eksi görünmeli."} Ters görünüyorsa işareti çevirin; tarih ya da tutar yanlış sütundan okunduysa
              sütunları değiştirin.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Checkbox
                label="İşareti çevir"
                checked={flip}
                onChange={(e) => {
                  setFlip(e.target.checked);
                  runPreview({ flip: e.target.checked });
                }}
              />
              {!showMap ? (
                <Button variant="ghost" size="sm" onClick={() => setShowMap(true)}>
                  Sütunları değiştir
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {stale ? <p className="text-xs text-warn">Sütun seçimi değişti: kaydetmeden önce yeniden okuyun.</p> : null}
        {showMap && preview && map ? <ColumnPicker preview={preview} map={map} onChange={setMap} pending={pending} onApply={() => runPreview({ map })} /> : null}
      </div>
    </Dialog>
  );
}

/** Başlık satırı ve sütunların elle seçimi (dosyanın ilk satırlarından) */
function ColumnPicker({ preview, map, onChange, pending, onApply }: { preview: PreviewResult; map: ColumnMap; onChange: (m: ColumnMap) => void; pending: boolean; onApply: () => void }) {
  const id = useId();
  const header = preview.rows[map.headerRow] ?? [];
  const width = Math.max(preview.width, header.length);
  const columns = Array.from({ length: width }, (_, i) => ({ value: i, label: header[i] ? `${i + 1}. ${header[i]}` : `${i + 1}. sütun` }));
  const paired = map.amount === null && (map.debit !== null || map.credit !== null);
  const [mode, setMode] = useState<"tek" | "cift">(paired ? "cift" : "tek");
  const colSelect = (key: keyof Omit<ColumnMap, "headerRow">, label: string, required = false) => (
    <Field label={label} htmlFor={`${id}-${key}`}>
      <Select
        id={`${id}-${key}`}
        value={map[key] === null ? "" : String(map[key])}
        onChange={(e) => onChange({ ...map, [key]: e.target.value === "" ? (required ? 0 : null) : Number(e.target.value) })}
      >
        {required ? null : <option value="">Yok</option>}
        {columns.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4 ring-1 ring-line-strong">
      <Field label="Başlık satırı" htmlFor={`${id}-row`} hint="Sütun adlarının yazdığı satır; hareketler bir alttan başlar.">
        <Select id={`${id}-row`} value={String(map.headerRow)} onChange={(e) => onChange({ ...map, headerRow: Number(e.target.value) })}>
          {preview.rows.map((r, i) => (
            <option key={i} value={i}>
              {i + 1}. satır: {r.filter(Boolean).slice(0, 4).join(" · ") || "boş"}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {colSelect("date", "Tarih", true)}
        {colSelect("description", "Açıklama")}
      </div>
      <Segmented
        label="Tutar"
        value={mode}
        onChange={(v) => {
          setMode(v);
          onChange(v === "tek" ? { ...map, debit: null, credit: null, amount: map.amount ?? 0 } : { ...map, amount: null, debit: map.debit ?? 0, credit: map.credit ?? 0 });
        }}
        options={[
          { value: "tek", label: "Tek tutar sütunu" },
          { value: "cift", label: "Borç / Alacak" },
        ]}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {mode === "tek" ? colSelect("amount", "Tutar (eksi = çıkış)") : null}
        {mode === "cift" ? colSelect("debit", "Borç") : null}
        {mode === "cift" ? colSelect("credit", "Alacak") : null}
        {colSelect("ref", "Belge / dekont no")}
        {colSelect("balance", "Bakiye")}
      </div>
      <div>
        <Button variant="secondary" size="sm" onClick={onApply} disabled={pending}>
          {pending ? "Okunuyor…" : "Bu sütunlarla yeniden oku"}
        </Button>
      </div>
    </div>
  );
}

"use client";

import { ChevronDown, FileQuestion } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FloatingBar } from "@/components/ui/floating-bar";
import { Checkbox, Select } from "@/components/ui/form";
import { useLeaveGuard } from "@/components/ui/leave-guard";
import { ToggleRow } from "@/components/ui/toggle-row";
import { money } from "@/lib/format";
import { VAT_TO_ZERO_LABEL, type Withholding, WITHHOLDING_GROSS_HINT, WITHHOLDING_LABELS, WITHHOLDINGS } from "@/lib/tax/rules";
import { unreachable } from "@/lib/unreachable";
import { cn } from "@/lib/utils";
import { saveTaxClassifications, saveTaxSettings } from "@/server/actions/tax";

import { DirectExpenseButton } from "../asset-actions";
import { AssetButton, type InvoiceChoice } from "../asset-dialog";

/** Listenin kalemi (sunucuda kurulur): sabit gider, harcama kategorisi, Gelir-gider'in elle satırı ya da demirbaş adayı */
export interface ClassifyItem {
  /** "fixed:1" | "category:3" | "manual:su" | "invoice:52" */
  key: string;
  source: "fixed" | "category" | "manual" | "invoice";
  id: number | null;
  name: string;
  /** Alt başlık: sabit giderin bölümü */
  sectionLabel: string | null;
  /** "Bu yıl 480.000 ₺ · sayılmadı", fatura künyesi */
  detail: string;
  /** Kayıtlı belge ("" seçilmedi); adayda "" ya da "gider" */
  doc: string;
  options: { value: string; label: string }[];
  /** Stopaj alanı: kira ve genel bölümünde her zaman, personelde yalnız dışarıdan hizmette; null yok */
  withholdingFor: "always" | "belgeli" | null;
  withholding: Withholding | null;
  /** Faturadaki KDV oranı (şahsa kirada "KDV yok" kutusu) */
  vat: number;
  note: string | null;
  /** Bu yıl tutarı yok ve seçilmedi: listenin sonunda katlanmış durur */
  idle: boolean;
}

export interface ClassifyData {
  /** "Bu çeyrekte 808.610 ₺ gider sayılmadı (24 kalem) · 69.780 ₺ demirbaş olabilir (2 fatura)" */
  header: string;
  items: ClassifyItem[];
  /** "Belgesi yok: 2 kalem, 12.400 ₺. …" (yalnız toplam ve sayı) */
  noDocText: string | null;
  /** Belgesi kasadan çıkanda ya da cari borçta seçilen kayıtlar (burada değişmez) */
  entries: { key: string; name: string; amount: number; note: string | null }[];
  /** Varlık listesine eklenmemiş Kuruluş & Demirbaş faturaları */
  unlisted: { id: number; supplier: string; date: string; dateText: string; remaining: number }[];
  /** Kafe dışı faturalar (yılın) */
  separate: { id: number; label: string; net: number; note: string | null }[];
  includeSeparate: boolean;
  separateNote: string;
  invoices: InvoiceChoice[];
  directLimit: number;
  today: string;
}

type Change = { doc?: string; withholding?: string; vatToZero?: boolean };

/** Ödemeden kesilen stopajlar: tutar brüt olmalı (§3.5 ipucu) */
const GROSS = new Set(["kira", "serbest_meslek", "internet_reklam"]);

/** Demirbaş adayı mı: seçeneği belge değil karardır ("Gider (demirbaş değil)"); kaynak tam switch'le (K25 bekçisi) */
function isCandidate(it: ClassifyItem): boolean {
  switch (it.source) {
    case "invoice":
      return true;
    case "fixed":
    case "category":
    case "manual":
      return false;
    default:
      return unreachable(it.source);
  }
}

const GROUPS: { source: ClassifyItem["source"]; title: string }[] = [
  { source: "fixed", title: "Sabit giderler" },
  { source: "category", title: "Aylık harcama kategorileri" },
  { source: "manual", title: "Elle girilen satırlar" },
  { source: "invoice", title: "Demirbaş olabilir" },
];

/**
 * Vergiye göre › "Vergi hesabına girmeyen giderler" (plan docs/planlar/vergi.md §4.2, K12): kaynağa göre gruplar, her
 * kalemde belgenin nerede olduğu (ve kira, genel ve dışarıdan hizmette stopaj). Seçimler istemcide toplanır; yüzen
 * çubukta "N değişikliği kaydet" tek eylemle kaydeder. Kaydedilmemiş değişiklikle sayfadan çıkmak uyarır.
 */
export function ClassifyList({ data }: { data: ClassifyData }) {
  const router = useRouter();
  const [changes, setChanges] = useState<Record<string, Change>>({});
  const [pending, run] = useActionTransition();
  const [separatePending, runSeparate] = useActionTransition();

  const effective = (it: ClassifyItem) => {
    const ch = changes[it.key] ?? {};
    const doc = ch.doc ?? it.doc;
    const withholdingShown = it.withholdingFor === "always" || (it.withholdingFor === "belgeli" && doc === "belgeli");
    const withholding = withholdingShown ? (ch.withholding ?? it.withholding ?? "") : "";
    const vatBox = withholding === "kira" && it.vat !== 0;
    return { doc, withholding, withholdingShown, vatBox, vatToZero: vatBox && (ch.vatToZero ?? false) };
  };
  const isDirty = (it: ClassifyItem) => {
    const e = effective(it);
    return e.doc !== it.doc || (it.withholdingFor !== null && e.withholding !== (it.withholding ?? "") && (e.withholdingShown || it.withholding !== null)) || e.vatToZero;
  };
  const dirty = data.items.filter(isDirty);
  const [leaveHref, setLeaveHref] = useLeaveGuard(dirty.length > 0);

  const set = (it: ClassifyItem, patch: Change) => setChanges((c) => ({ ...c, [it.key]: { ...c[it.key], ...patch } }));

  function save() {
    const items = dirty.map((it) => {
      const e = effective(it);
      switch (it.source) {
        case "fixed":
          return {
            source: "fixed" as const,
            id: it.id!,
            doc: e.doc || null,
            ...(it.withholdingFor ? { withholding: (e.withholding || null) as Withholding | null } : {}),
            ...(e.vatToZero ? { vatToZero: true } : {}),
          };
        case "category":
          return { source: "category" as const, id: it.id!, doc: (e.doc || null) as "fatura" | "belgeli" | "yok" | null };
        case "manual":
          return { source: "manual" as const, key: it.key, doc: e.doc || null };
        case "invoice":
          return { source: "invoice" as const, id: it.id!, notAsset: e.doc === "gider" };
      }
    });
    run(async () => {
      const r = await saveTaxClassifications({ items });
      if (!r.ok) return void toast.error(r.error, { duration: 10_000 });
      setChanges({});
      toast.success(`${r.data.count} kalem kaydedildi${r.data.message ? ` · ${r.data.message}` : ""}`, { duration: r.data.message ? 10_000 : 4_000 });
    });
  }

  function toggleSeparate(next: boolean) {
    runSeparate(async () => {
      const r = await saveTaxSettings({ includeSeparate: next });
      if (!r.ok) return void toast.error(r.error, { duration: 10_000 });
      toast.success(next ? "Kafe dışı faturalar vergi hesabına katıldı" : "Kafe dışı faturalar vergi hesabından çıkarıldı");
    });
  }

  const sections = (items: ClassifyItem[]) => {
    const out: { label: string | null; items: ClassifyItem[] }[] = [];
    for (const it of items) {
      const last = out.at(-1);
      if (last && last.label === it.sectionLabel) last.items.push(it);
      else out.push({ label: it.sectionLabel, items: [it] });
    }
    return out;
  };

  return (
    <Card id="siniflandir" className="scroll-mt-20">
      <CardHeader icon={<FileQuestion />} title="Vergi hesabına girmeyen giderler" description={data.header} />
      <div className="space-y-5 px-2 pb-5 sm:px-5">
        <p className="px-2 text-sm text-ink-soft sm:px-0">Aynı gider iki kez sayılmasın diye soruyoruz: bu giderin belgesi nerede?</p>
        {data.noDocText ? <p className="rounded-2xl bg-warn-soft px-4 py-3 text-[13px] leading-5 text-warn">{data.noDocText}</p> : null}

        {GROUPS.map((g) => {
          const items = data.items.filter((it) => it.source === g.source);
          if (!items.length) return null;
          return (
            <section key={g.source} aria-label={g.title}>
              <h3 className="mb-2 px-2 text-[13px] font-semibold text-ink-soft sm:px-0">{g.title}</h3>
              <div className="space-y-3">
                {sections(items.filter((it) => !it.idle || changes[it.key])).map((s, si) => (
                  <div key={si}>
                    {s.label ? <p className="mb-1.5 px-2 text-xs font-medium text-ink-mute sm:px-0">{s.label}</p> : null}
                    <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
                      {s.items.map((it) => {
                        const e = effective(it);
                        const changed = isDirty(it);
                        return (
                          <li key={it.key} className={cn("grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] md:items-start md:gap-4", changed && "bg-warn-soft/50")}>
                            <div className="min-w-0">
                              <p className="text-sm leading-5 font-medium break-words text-ink">
                                {it.name}
                                {changed ? <span className="ml-1.5 text-xs font-normal text-warn">· kaydedilmedi</span> : null}
                              </p>
                              <p className="text-xs leading-4 break-words text-ink-mute">{it.detail}</p>
                              {it.note ? <p className="mt-0.5 text-xs leading-4 break-words text-ink-mute">{it.note}</p> : null}
                            </div>
                            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                              <label className="flex min-w-0 flex-col gap-1">
                                <span className="text-xs font-medium text-ink-soft">{isCandidate(it) ? "Karar" : "Belgesi nerede"}</span>
                                <Select value={e.doc} disabled={pending} onChange={(ev) => set(it, { doc: ev.target.value })} className="pointer-coarse:h-12">
                                  {it.options.map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {o.label}
                                    </option>
                                  ))}
                                </Select>
                              </label>
                              {e.withholdingShown ? (
                                <label className="flex min-w-0 flex-col gap-1">
                                  <span className="text-xs font-medium text-ink-soft">Stopaj</span>
                                  <Select
                                    value={e.withholding}
                                    disabled={pending}
                                    onChange={(ev) => set(it, { withholding: ev.target.value, ...(ev.target.value === "kira" ? { vatToZero: true } : {}) })}
                                    className="pointer-coarse:h-12"
                                  >
                                    <option value="">Seçilmedi</option>
                                    {WITHHOLDINGS.map((w) => (
                                      <option key={w} value={w}>
                                        {WITHHOLDING_LABELS[w]}
                                      </option>
                                    ))}
                                  </Select>
                                </label>
                              ) : null}
                              {GROSS.has(e.withholding) ? <p className="text-xs leading-4 text-ink-mute sm:col-span-2">{WITHHOLDING_GROSS_HINT}</p> : null}
                              {e.vatBox ? (
                                <Checkbox label={VAT_TO_ZERO_LABEL} checked={e.vatToZero} disabled={pending} onChange={(ev) => set(it, { vatToZero: ev.target.checked })} className="text-[13px] sm:col-span-2" />
                              ) : null}
                              {isCandidate(it) && it.id !== null ? (
                                <div className="flex items-end">
                                  <AssetButton label="Varlık olarak ekle" invoices={data.invoices} invoiceId={it.id} directLimit={data.directLimit} today={data.today} />
                                </div>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
                <IdleRows items={items.filter((it) => it.idle && !changes[it.key])} onPick={(it, doc) => set(it, { doc })} pending={pending} />
              </div>
            </section>
          );
        })}

        {data.unlisted.length ? (
          <section aria-label="Demirbaş faturaları">
            <h3 className="mb-2 px-2 text-[13px] font-semibold text-ink-soft sm:px-0">Demirbaş faturaları</h3>
            <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
              {data.unlisted.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm leading-5 font-medium break-words text-ink">{u.supplier}</p>
                    <p className="text-xs leading-4 text-ink-mute">
                      {u.dateText} · varlık listesinde değil: {money(u.remaining)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <AssetButton label="Varlık olarak ekle" invoices={data.invoices} invoiceId={u.id} directLimit={data.directLimit} today={data.today} />
                    {u.remaining <= data.directLimit + 0.005 ? <DirectExpenseButton invoice={u} /> : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {data.separate.length || data.includeSeparate ? (
          <section aria-label="Kafe dışı faturalar">
            <h3 className="mb-2 px-2 text-[13px] font-semibold text-ink-soft sm:px-0">Kafe dışı faturalar</h3>
            <ToggleRow
              title="Kafe dışı faturaları vergi hesabına kat"
              description={data.separateNote}
              checked={data.includeSeparate}
              onChange={toggleSeparate}
              disabled={separatePending}
              label="Kafe dışı faturaları vergi hesabına kat"
              onText="Katılıyor"
              offText="Katılmıyor"
            />
            {data.separate.length ? (
              <ul className="mt-2 divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
                {data.separate.map((x) => (
                  <li key={x.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm leading-5 break-words text-ink">{x.label}</p>
                      {x.note ? <p className="text-xs leading-4 break-words text-warn">{x.note}</p> : null}
                    </div>
                    <span className="shrink-0 text-sm text-ink tabular">{money(x.net)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {data.entries.length ? (
          <section aria-label="Kasadan çıkanlar ve cari borçlar">
            <h3 className="mb-1 px-2 text-[13px] font-semibold text-ink-soft sm:px-0">Kasadan çıkanlar ve cari borçlar</h3>
            <p className="mb-2 px-2 text-xs text-ink-mute sm:px-0">Belgesi kasadan çıkan kayıtta ya da cari borçta seçilir; burada değişmez.</p>
            <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
              {data.entries.map((x) => (
                <li key={x.key} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm leading-5 break-words text-ink">{x.name}</p>
                    {x.note ? <p className="text-xs leading-4 break-words text-ink-mute">{x.note}</p> : null}
                  </div>
                  <span className="shrink-0 text-sm text-ink tabular">{money(x.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <FloatingBar open={dirty.length > 0}>
        <p className="min-w-0 flex-1 text-sm text-ink-soft">{dirty.length} değişiklik kaydedilmedi</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" disabled={pending} onClick={() => setChanges({})}>
            Vazgeç
          </Button>
          <Button disabled={pending} onClick={save}>
            {pending ? "Kaydediliyor…" : `${dirty.length} değişikliği kaydet`}
          </Button>
        </div>
      </FloatingBar>
      <ConfirmDialog
        open={leaveHref !== null}
        onClose={() => setLeaveHref(null)}
        onConfirm={() => {
          const href = leaveHref;
          setLeaveHref(null);
          if (href) router.push(href);
        }}
        title="Kaydedilmemiş sınıflandırma var"
        confirmLabel="Kaydetmeden geç"
        description={`Seçtiğiniz ${dirty.length} değişiklik henüz kaydedilmedi; başka sayfaya geçerseniz kaybolur. Kalmak için Vazgeç'e basıp "${dirty.length} değişikliği kaydet"i kullanın.`}
      />
    </Card>
  );
}

/** Bu yıl tutarı olmayan, seçilmemiş satırlar: katlanmış; seçim yapılınca listeye çıkar */
function IdleRows({ items, onPick, pending }: { items: ClassifyItem[]; onPick: (it: ClassifyItem, doc: string) => void; pending: boolean }) {
  if (!items.length) return null;
  return (
    <details className="group/idle rounded-2xl bg-surface ring-1 ring-line">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-2 text-[13px] text-ink-mute outline-none select-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
        Bu yıl tutarı olmayan {items.length} satır
        <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-ink-quiet transition-transform group-open/idle:rotate-180" />
      </summary>
      <ul className="divide-y divide-line border-t border-line">
        {items.map((it) => (
          <li key={it.key} className="grid gap-2 px-4 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,17rem)] md:items-center md:gap-4">
            <p className="min-w-0 text-sm break-words text-ink-soft">{it.name}</p>
            <Select aria-label={`${it.name}: belgesi nerede`} value="" disabled={pending} onChange={(ev) => onPick(it, ev.target.value)} className="pointer-coarse:h-12">
              {it.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
    </details>
  );
}

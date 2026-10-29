"use client";

import { ChevronDown, Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button, IconButton } from "@/components/ui/button";
import { CardFooter } from "@/components/ui/card";
import { clearQuery, FilterBar, FilterChip, matches, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { Select } from "@/components/ui/form";
import { DotList, EmptyState, InfoTip } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { SortButton, Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { dateTR, money, num } from "@/lib/format";
import { daysBetween, daysLeftLabel, REMINDER_KINDS, REMINDER_REPEATS, reminderCategory, repeatLabel, type ReminderKind, type ReminderRepeat } from "@/lib/reminders";
import { cn } from "@/lib/utils";

import { FAB_AVOID } from "./fab-clear";
import { CategoryWell, DateTile } from "./payment-ui";
import type { Reminder } from "./reminder-sheet";

const KIND_LABEL = Object.fromEntries(REMINDER_KINDS.map((k) => [k.value, k.label])) as Record<ReminderKind, string>;
const REPEAT_LABEL = Object.fromEntries(REMINDER_REPEATS.map((r) => [r.value, r.label])) as Record<ReminderRepeat, string>;

type StatusFilter = "tumu" | "etkin" | "kapali";
const STATUSES = ["tumu", "etkin", "kapali"] as const;
type SortCol = "tarih" | "ad" | "tutar";
type SortKey = SortCol | `-${SortCol}`;
const SORTS = ["tarih", "-tarih", "ad", "-ad", "tutar", "-tutar"] as const;
/** Telefonda tablo başlığı yok: sıralama seçimle */
const SORT_LABEL: Record<SortKey, string> = {
  tarih: "Tarih (yakın önce)",
  "-tarih": "Tarih (uzak önce)",
  ad: "Ad (A–Z)",
  "-ad": "Ad (Z–A)",
  "-tutar": "Tutar (yüksek önce)",
  tutar: "Tutar (düşük önce)",
};

/** Tekrarın bir aya düşen payı (aylık ortalama yük); bir kezlikler sayılmaz */
const PER_MONTH: Record<ReminderRepeat, number> = { none: 0, weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

/** Adresten gelen değer beklenenlerden biri değilse varsayılan kullanılır */
export function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * "Tüm hatırlatıcılar": arama, durum ve tür süzgeci, sıralama, aç/kapa; telefonda kart listesi, md'den tablo.
 * Katlanır bölüm: ekranın asıl sorusu yaklaşan ödemeler, bu liste yönetim için.
 */
export function AllReminders({
  reminders,
  today,
  pending,
  onAdd,
  onEdit,
  onRemove,
  onToggle,
}: {
  reminders: Reminder[];
  today: string;
  pending: boolean;
  onAdd: () => void;
  onEdit: (r: Reminder) => void;
  onRemove: (r: Reminder) => void;
  onToggle: (r: Reminder, active: boolean) => void;
}) {
  const [q, setQ] = useQueryText("ara");
  const [statusRaw, setStatus] = useQueryState<StatusFilter>("durum", "tumu");
  const status = oneOf(statusRaw, STATUSES, "tumu");
  const [kindRaw, setKind] = useQueryState<string>("tur", "");
  const kind = REMINDER_KINDS.find((k) => k.value === kindRaw)?.value ?? null;
  const [sortRaw, setSort] = useQueryState<SortKey>("sirala", "tarih");
  const sort = oneOf(sortRaw, SORTS, "tarih");
  const sortCol = sort.replace("-", "") as SortCol;
  const sortDir = sort.startsWith("-") ? "desc" : "asc";
  const sortBy = (col: SortCol) => setSort(sortCol === col ? (sortDir === "asc" ? `-${col}` : col) : col === "tutar" ? "-tutar" : col);
  const dirOf = (col: SortCol) => (sortCol === col ? sortDir : null);

  const searched = reminders.filter((r) => matches(`${r.title} ${r.note ?? ""} ${KIND_LABEL[r.kind]} ${REPEAT_LABEL[r.repeat]}`, q));
  const byStatus = searched.filter((r) => status === "tumu" || (status === "etkin" ? r.active : !r.active));
  const filtered = byStatus.filter((r) => !kind || r.kind === kind);
  const rows = [...filtered].sort((a, b) => {
    const d = sortCol === "ad" ? a.title.localeCompare(b.title, "tr") : sortCol === "tutar" ? (a.amount ?? -1) - (b.amount ?? -1) : a.dueDate.localeCompare(b.dueDate);
    return (sortDir === "desc" ? -d : d) || a.title.localeCompare(b.title, "tr");
  });
  const filterActive = Boolean(q.trim()) || status !== "tumu" || kind !== null;
  const clear = () => {
    setQ("");
    clearQuery(["ara", "durum", "tur"]);
  };

  const activeCount = reminders.filter((r) => r.active).length;
  const total = rows.reduce((a, r) => a + (r.amount ?? 0), 0);
  const monthly = rows.reduce((a, r) => a + (r.active ? (r.amount ?? 0) * PER_MONTH[r.repeat] : 0), 0);
  const kindCounts = new Map<ReminderKind, number>();
  for (const r of byStatus) kindCounts.set(r.kind, (kindCounts.get(r.kind) ?? 0) + 1);
  // Adreste süzgeç varsa (paylaşılan bağlantı) açık gelir; sonra kullanıcı açıp kapatır
  const [open, setOpen] = useState(filterActive);

  return (
    <section className="rounded-3xl bg-panel" aria-label="Tüm hatırlatıcılar">
      <details className="group/a" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary {...FAB_AVOID} className="flex min-h-16 cursor-pointer list-none items-center gap-3 rounded-3xl px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ink/30 sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-surface text-ink" aria-hidden="true">
            <Repeat size={18} strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base leading-6 font-semibold tracking-tight text-ink">Tüm hatırlatıcılar</span>
            <span className="block text-[13px] text-ink-mute tabular">
              {reminders.length ? (
                <>
                  {activeCount} etkin{reminders.length > activeCount ? ` · ${reminders.length - activeCount} kapalı` : ""} · aylık ortalama {money(reminders.reduce((a, r) => a + (r.active ? (r.amount ?? 0) * PER_MONTH[r.repeat] : 0), 0))}
                </>
              ) : (
                "Henüz hatırlatıcı yok"
              )}
            </span>
          </span>
          <ChevronDown size={18} className="shrink-0 text-ink-quiet transition-transform group-open/a:rotate-180" aria-hidden="true" />
        </summary>

        {reminders.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState
              title="Henüz hatırlatıcı yok"
              description="Kira, KDV, SGK ya da maaş gibi düzenli ödemeleri ekleyin; tarih yaklaşınca e-postayla haber verilir. Hazır şablonlardan ya da sabit giderlerden tek dokunuşla da eklenebilir."
              action={
                <Button onClick={onAdd} className="max-sm:h-12">
                  <Plus size={16} /> Ödeme ekle
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <div className="space-y-2 px-3 pb-3 sm:px-5">
              <FilterBar active={filterActive} onClear={clear} shown={rows.length} total={reminders.length} unit="hatırlatıcı">
                <SearchField value={q} onChange={setQ} placeholder="Hatırlatıcı ara" className="w-full sm:w-64" shortcut={false} />
                <Segmented<StatusFilter>
                  label="Durum"
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: "tumu", label: "Tümü", count: searched.length },
                    { value: "etkin", label: "Etkin", count: searched.filter((r) => r.active).length },
                    { value: "kapali", label: "Kapalı", count: searched.filter((r) => !r.active).length },
                  ]}
                />
              </FilterBar>
              {kindCounts.size > 1 || kind ? (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tür">
                  {REMINDER_KINDS.filter((k) => kindCounts.has(k.value) || k.value === kind).map((k) => (
                    <FilterChip key={k.value} active={kind === k.value} onToggle={() => setKind(kind === k.value ? "" : k.value)} count={kindCounts.get(k.value) ?? 0}>
                      {k.label}
                    </FilterChip>
                  ))}
                </div>
              ) : null}
              {/* Telefon ve tablet: tablo başlığı yerine sıralama seçimi */}
              <label className="flex items-center gap-2 text-[13px] text-ink-mute md:hidden">
                <span className="shrink-0">Sırala</span>
                <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-11 w-auto min-w-0 flex-1 sm:flex-none" aria-label="Sıralama">
                  {(["tarih", "-tarih", "ad", "-ad", "-tutar", "tutar"] as const).map((k) => (
                    <option key={k} value={k}>
                      {SORT_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </label>
            </div>

            {rows.length === 0 ? (
              <div className="px-5 pb-5">
                <EmptyState
                  title="Bu süzgece uyan hatırlatıcı yok"
                  description={q.trim() ? `“${q.trim()}” için sonuç bulunamadı. Aramayı kısaltın ya da süzgeci temizleyin.` : "Seçili durum ya da türde hatırlatıcı yok."}
                  action={
                    <Button variant="secondary" onClick={clear} className="max-sm:h-12">
                      Süzgeci temizle
                    </Button>
                  }
                />
              </div>
            ) : (
              <>
                {/* Telefon ve tablet: kart listesi */}
                <ul className="mx-2 mb-2 space-y-1.5 md:hidden">
                  {rows.map((r) => {
                    const left = daysBetween(today, r.dueDate);
                    return (
                      <li key={r.id} className="rounded-2xl bg-surface p-3 ring-1 ring-line">
                        <div className={cn("flex items-start gap-3", !r.active && "opacity-60")}>
                          <DateTile date={r.dueDate} daysLeft={r.active ? left : 999} size="sm" muted={!r.active} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <p className="min-w-0 text-[15px] leading-5 font-semibold break-words text-ink">{r.title}</p>
                              <span className="shrink-0 text-[15px] leading-5 font-semibold text-ink tabular">{r.amount !== null ? money(r.amount) : "–"}</span>
                            </div>
                            {/* Satır sarılınca "·" satır sonunda asılı kalmasın (DotList) */}
                            <div className="mt-1 flex items-center gap-1.5 text-[13px] leading-5 text-ink-mute">
                              <CategoryWell category={reminderCategory(r.kind, r.title)} size="xs" />
                              <DotList className="min-w-0">
                                <span>{KIND_LABEL[r.kind]}</span>
                                <span>{repeatLabel(r.repeat, r.dueDate, r.anchorDate) ?? REPEAT_LABEL[r.repeat]}</span>
                              </DotList>
                            </div>
                            <DotList className="mt-0.5 text-[13px] leading-5 text-ink-mute">
                              {r.active ? <span className={cn(left < 0 && "text-bad")}>{daysLeftLabel(left)}</span> : null}
                              <span>{r.remindDaysBefore} gün önce haber</span>
                            </DotList>
                            {r.note ? <p className="mt-0.5 line-clamp-2 text-xs break-words text-ink-mute">{r.note}</p> : null}
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 border-t border-ink/[0.06] pt-2">
                          <Switch
                            checked={r.active}
                            showText
                            label={`${r.title} etkin`}
                            onText="Etkin"
                            offText="Kapalı"
                            disabled={pending}
                            onChange={(v) => onToggle(r, v)}
                            className="h-11"
                          />
                          <div className="flex gap-1.5">
                            <IconButton label={`${r.title} düzenle`} onClick={() => onEdit(r)} className="size-11 rounded-xl">
                              <Pencil size={16} />
                            </IconButton>
                            <IconButton label={`${r.title} sil`} tone="danger" onClick={() => onRemove(r)} className="size-11 rounded-xl">
                              <Trash2 size={16} />
                            </IconButton>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {/* Masaüstü: tablo */}
                <TableWrap className="hidden md:block">
                  <Table className="min-w-[640px]">
                    <THead>
                      <tr>
                        <TH sticky>
                          <SortButton dir={dirOf("ad")} onClick={() => sortBy("ad")}>
                            Hatırlatıcı
                          </SortButton>
                        </TH>
                        <TH numeric>
                          <SortButton numeric dir={dirOf("tutar")} onClick={() => sortBy("tutar")}>
                            Tutar
                          </SortButton>
                        </TH>
                        <TH>
                          <SortButton dir={dirOf("tarih")} onClick={() => sortBy("tarih")}>
                            Sıradaki tarih
                          </SortButton>
                        </TH>
                        <TH>Tekrar</TH>
                        <TH numeric>
                          <span className="inline-flex items-center gap-1.5">
                            Haber
                            <InfoTip text="Son ödeme gününden kaç gün önce ilk e-posta gider. Son gün ve gecikince bir kez daha hatırlatılır." />
                          </span>
                        </TH>
                        <TH>Durum</TH>
                        <TH className="text-right">
                          <span className="sr-only">Eylemler</span>
                        </TH>
                      </tr>
                    </THead>
                    <tbody>
                      {rows.map((r) => {
                        const left = daysBetween(today, r.dueDate);
                        return (
                          <TR key={r.id}>
                            <TD sticky>
                              <div className={cn("flex max-w-[18rem] items-center gap-3", !r.active && "opacity-60")}>
                                <CategoryWell category={reminderCategory(r.kind, r.title)} size="sm" className="size-[30px] rounded-[8px]" />
                                <div className="min-w-0">
                                  <p className="truncate font-medium" title={r.title}>
                                    {r.title}
                                  </p>
                                  <p className="truncate text-xs text-ink-mute" title={r.note ?? undefined}>
                                    {KIND_LABEL[r.kind]}
                                    {r.note ? ` · ${r.note}` : ""}
                                  </p>
                                </div>
                              </div>
                            </TD>
                            <TD numeric className={cn(!r.active && "opacity-60")}>
                              {r.amount !== null ? money(r.amount) : <span className="text-ink-quiet">–</span>}
                            </TD>
                            <TD className={cn("whitespace-nowrap", !r.active && "opacity-60")}>
                              <span className="tabular">{dateTR(r.dueDate)}</span>
                              {r.active ? <span className={cn("block text-xs", left < 0 ? "text-bad" : "text-ink-mute")}>{daysLeftLabel(left)}</span> : null}
                            </TD>
                            <TD className={cn("whitespace-nowrap text-ink-mute", !r.active && "opacity-60")}>{repeatLabel(r.repeat, r.dueDate, r.anchorDate) ?? REPEAT_LABEL[r.repeat]}</TD>
                            <TD numeric className={cn("text-ink-mute", !r.active && "opacity-60")}>
                              {r.remindDaysBefore} gün önce
                            </TD>
                            <TD>
                              <Switch checked={r.active} showText label={`${r.title} etkin`} onText="Etkin" offText="Kapalı" disabled={pending} onChange={(v) => onToggle(r, v)} />
                            </TD>
                            <TD>
                              <div className="flex justify-end gap-1.5">
                                <IconButton label={`${r.title} düzenle`} onClick={() => onEdit(r)}>
                                  <Pencil size={15} />
                                </IconButton>
                                <IconButton label={`${r.title} sil`} tone="danger" onClick={() => onRemove(r)}>
                                  <Trash2 size={15} />
                                </IconButton>
                              </div>
                            </TD>
                          </TR>
                        );
                      })}
                    </tbody>
                  </Table>
                </TableWrap>

                <CardFooter>
                  <span className="tabular">
                    {num(rows.length)} hatırlatıcı · tutarı girilenlerin toplamı <span className="font-semibold text-ink">{money(total)}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 tabular">
                    Aylık ortalama yük <span className="font-semibold text-ink">{money(monthly)}</span>
                    <InfoTip text="Etkin ve tekrar eden hatırlatıcıların bir aya düşen payı: haftalık × 52 ÷ 12, üç aylık ÷ 3, yıllık ÷ 12. Bir kezlik ödemeler sayılmaz." />
                  </span>
                </CardFooter>
              </>
            )}
          </>
        )}
      </details>
    </section>
  );
}

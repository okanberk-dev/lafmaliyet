"use client";

import { CalendarRange } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { ToggleRow } from "@/components/ui/toggle-row";
import { alertQuietDuring } from "@/lib/audio-output";
import { BRANCH_PARAM } from "@/lib/branches";
import { clockOf, PRESET_KEYS, PRESET_LABELS, presetHours, presetText, shiftPresetsError, VARDIYA_PATH, type ShiftPreset } from "@/lib/vardiya";
import { saveShiftPresets } from "@/server/actions/branch-settings";

type Key = ShiftPreset["key"];
/** Formdaki bir vardiya: kullanılıyor mu, başlangıç ve bitiş ("09:00") */
type Row = { on: boolean; start: string; end: string };

/** Kapalı vardiyanın kutularında öneri: Tuzla'nın bugünkü saatleri */
const BLANK: Record<Key, { start: string; end: string }> = { morning: { start: "09:00", end: "18:00" }, evening: { start: "16:00", end: "01:00" } };

const rowsOf = (presets: readonly ShiftPreset[]): Record<Key, Row> =>
  Object.fromEntries(
    PRESET_KEYS.map((key) => {
      const p = presets.find((x) => x.key === key);
      return [key, p ? { on: true, start: clockOf(p.startMin), end: clockOf(p.endMin) } : { on: false, ...BLANK[key] }];
    }),
  ) as Record<Key, Row>;

/** Formun karşılaştırma anahtarı: kullanılmayan vardiyanın kutuları sayılmaz */
const keyOf = (rows: Record<Key, Row>) => PRESET_KEYS.map((k) => (rows[k].on ? `${rows[k].start}-${rows[k].end}` : "-")).join("|");

/**
 * Şube ayarları › Hazır vardiyalar (şube ayarı vardiya.hazir; docs/VARDIYA.md › Hazır vardiyalar): Vardiya ekranındaki
 * S (sabahçı) ve A (akşamcı) düğmelerinin, "s" / "a" kısaltmasının, yazarak doldurmanın ve PDF'in saatleri. Saatler
 * şubenin açılışına bağlı: "Diğer şubeyle aynı" yok. Seçilmemişken bugünkü sabit saatler geçer (Tuzla ve Marina'nınki;
 * öbür şubede hazır vardiya yok, ızgara elle yazmayla açılır). Saatler kutunun okuyucusuyla aynı kuralla okunur (sunucu
 * ayrıca denetler); kayıtlı haftaların hücreleri değişmez.
 */
export function ShiftPresetsCard({ branchId, branchName, presets, isDefault }: { branchId: string; branchName: string; presets: readonly ShiftPreset[]; isDefault: boolean }) {
  const [rows, setRows] = useState(() => rowsOf(presets));
  const [pending, start] = useActionTransition();
  // Kayıtlı değer değişince (kayıttan sonra) form ona döner
  const savedKey = keyOf(rowsOf(presets));
  const [seen, setSeen] = useState(savedKey);
  if (seen !== savedKey) {
    setSeen(savedKey);
    setRows(rowsOf(presets));
  }
  const set = (key: Key, patch: Partial<Row>) => setRows((r) => ({ ...r, [key]: { ...r[key], ...patch } }));

  // Her vardiyanın okunuşu (sunucu aynı kuralla denetler): hata ya da dakikalar
  const parsed = Object.fromEntries(PRESET_KEYS.map((k) => [k, rows[k].on ? presetHours(rows[k].start, rows[k].end) : null])) as Record<Key, ReturnType<typeof presetHours> | null>;
  const errorOf = (k: Key) => {
    const p = parsed[k];
    return p && "error" in p ? p.error : null;
  };
  const list = PRESET_KEYS.flatMap((key) => {
    const p = parsed[key];
    return p && !("error" in p) ? [{ key, ...p }] : [];
  });
  const clash = shiftPresetsError(list);
  const invalid = PRESET_KEYS.some((k) => errorOf(k)) || Boolean(clash);
  const dirty = keyOf(rows) !== savedKey;
  const quiet = list.filter((p) => alertQuietDuring(p.startMin, p.endMin));

  function save() {
    if (invalid) return;
    start(async () => {
      const res = await saveShiftPresets({
        branchId,
        morning: rows.morning.on ? { start: rows.morning.start, end: rows.morning.end } : null,
        evening: rows.evening.on ? { start: rows.evening.start, end: rows.evening.end } : null,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.data.changed ? `${branchName}: hazır vardiyalar kaydedildi` : "Değişiklik yok", res.data.changed ? { description: "Vardiya ekranı ve PDF yeni saatleri kullanır." } : undefined);
    });
  }

  const note = isDefault
    ? presets.length
      ? `Varsayılan saatler: ${presets.map((p) => `${p.label} ${presetText(p)}`).join(", ")}. Değiştirip kaydedince bu şubenin ayarı olur.`
      : "Bu şubede hazır vardiya yok: Vardiya ekranı elle yazmayla açılır. Sabahçı ya da akşamcıyı açıp saatlerini girin."
    : null;

  return (
    <Card id="vardiya" className="scroll-mt-20">
      <CardHeader
        icon={<CalendarRange />}
        title="Hazır vardiyalar"
        description="Vardiya ekranında S (sabahçı) ve A (akşamcı) düğmeleri bu saatleri yazar; “s” ve “a” kısaltması, yazarak doldurma ve PDF de bunları kullanır."
      />
      <div className="space-y-3 px-5 pb-5">
        {note ? <p className="text-[13px] text-ink-mute">{note}</p> : null}
        {PRESET_KEYS.map((key) => {
          const r = rows[key];
          const error = errorOf(key);
          const label = PRESET_LABELS[key];
          return (
            <div key={key} className="space-y-2">
              <ToggleRow
                title={`${label} (${label.charAt(0)})`}
                description={r.on ? undefined : "Bu şubede kullanılmıyor"}
                label={`${branchName}: ${label.toLocaleLowerCase("tr-TR")} kullanılsın`}
                checked={r.on}
                disabled={pending}
                onChange={(on) => set(key, { on })}
              />
              {r.on ? (
                <div className="grid grid-cols-2 gap-3 px-1">
                  <Field label="Başlangıç" htmlFor={`vardiya-${key}-bas`}>
                    <Input
                      id={`vardiya-${key}-bas`}
                      type="time"
                      value={r.start}
                      onChange={(e) => set(key, { start: e.target.value })}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `vardiya-${key}-hata` : undefined}
                      className="pointer-coarse:h-12"
                    />
                  </Field>
                  <Field label="Bitiş" htmlFor={`vardiya-${key}-bit`} hint="Başlangıçtan önceyse ertesi gün">
                    <Input
                      id={`vardiya-${key}-bit`}
                      type="time"
                      value={r.end}
                      onChange={(e) => set(key, { end: e.target.value })}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `vardiya-${key}-hata` : undefined}
                      className="pointer-coarse:h-12"
                    />
                  </Field>
                  {error ? (
                    <p id={`vardiya-${key}-hata`} className="col-span-2 text-xs text-bad">
                      {error}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {clash ? <p className="text-xs text-bad">{clash}</p> : null}
        {quiet.length ? (
          <Notice
            tone="neutral"
            size="sm"
            title="Uyarı sesleri 01:00–09:00 arası çalmaz"
            text={`${quiet.map((p) => PRESET_LABELS[p.key]).join(" ve ")} bu saatlere uzanıyor; o saatlerde gelen sipariş ve masa çağrısı sessiz gelir (ses saatleri şimdilik bütün şubelerde ortak).`}
          />
        ) : null}
        <p className="text-xs text-ink-mute">
          Kayıtlı haftalar değişmez: yeni saatle eşleşmeyen eski kutu planda “başka saat” olarak görünür.{" "}
          <Link href={`${VARDIYA_PATH}?${BRANCH_PARAM}=${encodeURIComponent(branchId)}`} className="font-medium whitespace-nowrap text-ink underline underline-offset-2">
            Vardiya ekranını aç
          </Link>
        </p>
        <Button onClick={save} disabled={pending || !dirty || invalid} className="max-sm:w-full">
          {pending ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </div>
    </Card>
  );
}

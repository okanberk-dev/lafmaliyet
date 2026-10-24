"use client";

import { Settings2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, NumberInput } from "@/components/ui/form";
import { ToggleRow } from "@/components/ui/toggle-row";
import { parseNumberTR } from "@/lib/calc/expr";
import { PER_PERSON_MAX, PER_PERSON_MIN, STAFF_MAX, type ForecastSettings } from "@/lib/forecast/staffing";
import { money, num } from "@/lib/format";
import { saveForecastSettings } from "@/server/actions/forecast";

interface Values {
  perPerson: string;
  minStaff: string;
  maxStaff: string;
  dessert: string[];
  weather: boolean;
  staffSeesLevel: boolean;
  emailLine: boolean;
}

const toValues = (s: ForecastSettings, categories: { name: string; dessert: boolean }[]): Values => ({
  perPerson: num(s.perPerson),
  minStaff: String(s.minStaff),
  maxStaff: String(s.maxStaff),
  dessert: categories.filter((c) => c.dessert).map((c) => c.name),
  weather: s.weather,
  staffSeesLevel: s.staffSeesLevel,
  emailLine: s.emailLine,
});

/** Karşılaştırma anahtarı: aynı değerin farklı yazılışı (10.000 / 10000) ve kategorilerin sırası değişiklik sayılmaz */
const keyOf = (v: Values) =>
  JSON.stringify({ ...v, perPerson: parseNumberTR(v.perPerson), minStaff: v.minStaff.trim(), maxStaff: v.maxStaff.trim(), dessert: [...v.dessert].sort() });

/** Yazılanların hatası (sunucu da aynısını denetler) */
function errorsOf(v: Values): { perPerson?: string; staff?: string } {
  const out: { perPerson?: string; staff?: string } = {};
  const p = parseNumberTR(v.perPerson);
  if (p === null || p < PER_PERSON_MIN || p > PER_PERSON_MAX) out.perPerson = `Kişi başı satış ${money(PER_PERSON_MIN)} ile ${money(PER_PERSON_MAX)} arasında olmalı`;
  const lo = Number(v.minStaff.trim());
  const hi = Number(v.maxStaff.trim());
  const ok = (x: number, raw: string) => raw.trim() !== "" && Number.isInteger(x) && x >= 0 && x <= STAFF_MAX;
  if (!ok(lo, v.minStaff) || !ok(hi, v.maxStaff)) out.staff = `Kişi sayısı 0 ile ${STAFF_MAX} arasında olmalı`;
  else if (hi < lo) out.staff = "En çok kişi en az kişiden küçük olamaz";
  return out;
}

/** Kart "Tahmin ayarları": kişi önerisinin ve tatlı hazırlığının dayanağı, hava durumu, personel ve e-posta */
export function ForecastSettingsCard({ settings, categories }: { settings: ForecastSettings; categories: { name: string; dessert: boolean }[] }) {
  const [v, setV] = useState<Values>(() => toValues(settings, categories));
  const [pending, start] = useActionTransition();
  // Kayıtlı değerler değişince (kayıttan sonra, başka sekmede) form onlara döner
  const savedKey = keyOf(toValues(settings, categories));
  const [seen, setSeen] = useState(savedKey);
  if (seen !== savedKey) {
    setSeen(savedKey);
    setV(toValues(settings, categories));
  }
  const errors = errorsOf(v);
  const invalid = Boolean(errors.perPerson || errors.staff);
  const dirty = keyOf(v) !== savedKey;
  const set = <K extends keyof Values>(k: K, value: Values[K]) => setV((x) => ({ ...x, [k]: value }));

  function save() {
    if (invalid) return;
    start(async () => {
      const r = await saveForecastSettings({
        perPerson: parseNumberTR(v.perPerson) ?? 0,
        minStaff: Number(v.minStaff),
        maxStaff: Number(v.maxStaff),
        dessertCategories: v.dessert,
        weather: v.weather,
        staffSeesLevel: v.staffSeesLevel,
        emailLine: v.emailLine,
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Tahmin ayarları kaydedildi");
    });
  }

  return (
    <Card id="ayarlar" className="scroll-mt-[calc(var(--mobile-top-h)+1.5rem)] lg:scroll-mt-4">
      <CardHeader icon={<Settings2 />} title="Tahmin ayarları" description="Kişi ve tatlı önerisinin dayanağı." />
      <CardContent className="space-y-4">
        <Field
          label="Bir kişinin günde karşıladığı satış (₺)"
          htmlFor="tahmin-kisi-basi"
          error={errors.perPerson}
          hint="Kaç kişi önerisi = günün tahmini ÷ bu tutar (yukarı yuvarlanır). Örnek: 23.000 ₺'lik gün, 10.000 ₺ ile 3 kişi."
        >
          <NumberInput
            id="tahmin-kisi-basi"
            value={v.perPerson}
            onChange={(e) => set("perPerson", e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            aria-invalid={errors.perPerson ? true : undefined}
            className="pointer-coarse:h-12"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="En az kişi" htmlFor="tahmin-en-az" hint="Sakin günde bile çalışan sayısı">
            <NumberInput
              id="tahmin-en-az"
              inputMode="numeric"
              value={v.minStaff}
              onChange={(e) => set("minStaff", e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              aria-invalid={errors.staff ? true : undefined}
              className="pointer-coarse:h-12"
            />
          </Field>
          <Field label="En çok kişi" htmlFor="tahmin-en-cok">
            <NumberInput
              id="tahmin-en-cok"
              inputMode="numeric"
              value={v.maxStaff}
              onChange={(e) => set("maxStaff", e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              aria-invalid={errors.staff ? true : undefined}
              className="pointer-coarse:h-12"
            />
          </Field>
        </div>
        {errors.staff ? <p className="-mt-2 text-xs text-bad">{errors.staff}</p> : null}
        <fieldset>
          <legend className="text-[13px] font-medium text-ink-soft">Tatlı sayılan kategoriler</legend>
          <p className="mt-0.5 text-xs text-ink-mute">Tatlı hazırlığı bu kategorilerdeki ürünlerin satış payından hesaplanır. Hiçbiri seçilmezse adında “tatlı” geçenler.</p>
          <div className="mt-2 grid grid-cols-2 gap-x-3 rounded-2xl bg-surface px-3 py-1.5 ring-1 ring-line">
            {categories.map((c) => (
              <Checkbox
                key={c.name}
                label={<span className="min-w-0 break-words">{c.name}</span>}
                className="min-h-9 min-w-0"
                checked={v.dessert.includes(c.name)}
                onChange={(e) => set("dessert", e.target.checked ? [...v.dessert, c.name] : v.dessert.filter((x) => x !== c.name))}
              />
            ))}
          </div>
        </fieldset>
        <div className="space-y-2">
          <ToggleRow
            title="Hava durumunu kullan"
            description="MET Norway'den (Norveç Meteoroloji Enstitüsü) ücretsiz, günde bir kez; Tuzla (Opera AVM) konumu için."
            checked={v.weather}
            onChange={(x) => set("weather", x)}
            label="Hava durumunu kullan"
          />
          <ToggleRow
            title="Personel bugünün yoğunluğunu görsün"
            description="Bugün ekranında Yüksek / Normal / Düşük ve tatlı sayısı; tutar ve kişi önerisi görünmez."
            checked={v.staffSeesLevel}
            onChange={(x) => set("staffSeesLevel", x)}
            label="Personel bugünün yoğunluğunu görsün"
          />
          <ToggleRow
            title="Sabah e-postasına tahmin satırı"
            description="Yalnız zaten giden sabah e-postasına eklenir; tahmin için ayrıca e-posta gönderilmez."
            checked={v.emailLine}
            onChange={(x) => set("emailLine", x)}
            label="Sabah e-postasına tahmin satırı"
          />
        </div>
      </CardContent>
      <CardFooter>
        <span className="min-w-0 flex-[1_1_14rem]">{dirty ? "Kaydedilmemiş değişiklik var." : "Kayıtlı."}</span>
        <Button size="sm" onClick={save} disabled={!dirty || invalid || pending}>
          {pending ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </CardFooter>
    </Card>
  );
}

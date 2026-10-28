"use client";

import { ListChecks, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { tryAction, useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { listTitle, weekdaysText } from "@/lib/checklists";
import { num } from "@/lib/format";
import { createChecklistTemplate, setChecklistTemplateActive } from "@/server/actions/checklists";

import { draftOf, EMPTY_TEMPLATE, fieldOf, TemplateFields, type TemplateDraft } from "./template-fields";

export interface TemplateRow {
  id: number;
  name: string;
  opensAt: string;
  dueAt: string;
  weekdays: number[];
  staffAllowed: boolean;
  active: boolean;
  items: number;
  photos: number;
  numbers: number;
}

/**
 * Listeleri düzenle: her liste bir satır (günler ve saat, madde / fotoğraf / ölçüm sayısı, Etkin anahtarı, Düzenle) ve
 * "Yeni liste" penceresi. Oluşturulunca pencere kapanır, sonra listenin sayfası açılır (önce pencere, sonra gezinme).
 */
export function TemplatesClient({ templates }: { templates: TemplateRow[] }) {
  const router = useRouter();
  const [pending, start] = useActionTransition();
  const [rows, setRowActive] = useOptimistic(templates, (state, p: { id: number; active: boolean }) => state.map((t) => (t.id === p.id ? { ...t, active: p.active } : t)));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TemplateDraft>(EMPTY_TEMPLATE);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggle = (t: TemplateRow, active: boolean) =>
    start(async () => {
      setRowActive({ id: t.id, active });
      const res = await setChecklistTemplateActive(t.id, active);
      if (!res.ok) toast.error(res.error);
      else toast.success(active ? `${listTitle(t.name)} etkin` : `${listTitle(t.name)} pasife alındı`);
    });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await tryAction(() => createChecklistTemplate(draftOf(draft)));
    setSaving(false);
    if (!res) return;
    if (!res.ok) return setError(res.error);
    // Önce pencere kapanır, sonra listenin sayfasına gidilir
    setOpen(false);
    setDraft(EMPTY_TEMPLATE);
    toast.success(`${listTitle(draft.name.trim())} eklendi`, { description: "Şimdi maddelerini ekleyin." });
    router.push(`/panel/kontrol/duzenle/${res.data.id}`);
  };

  const field = error ? fieldOf(error) : null;
  return (
    <>
      <Card>
        <CardHeader
          icon={<ListChecks />}
          title="Listeler"
          meta={<span>{num(rows.length)} liste</span>}
          actions={
            <Button
              onClick={() => {
                setDraft(EMPTY_TEMPLATE);
                setError(null);
                setOpen(true);
              }}
            >
              <Plus size={16} aria-hidden="true" /> Yeni liste
            </Button>
          }
        />
        {rows.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {rows.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink">
                    {t.name}
                    {!t.active ? <Badge tone="gray">Pasif</Badge> : null}
                    {!t.staffAllowed ? <Badge tone="violet">Yalnız yönetici</Badge> : null}
                  </p>
                  <p className="text-[13px] text-ink-mute">
                    {weekdaysText(t.weekdays)} · {t.opensAt} – {t.dueAt}
                  </p>
                  <p className="text-[13px] text-ink-mute">
                    {num(t.items)} madde · {num(t.photos)} fotoğraf · {num(t.numbers)} ölçüm
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={t.active} onChange={(v) => toggle(t, v)} label={`${t.name} etkin`} showText onText="Etkin" offText="Pasif" disabled={pending} />
                  <ButtonLink href={`/panel/kontrol/duzenle/${t.id}`} variant="secondary" size="sm">
                    Düzenle
                  </ButtonLink>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<ListChecks />} title="Henüz liste yok" description="Yeni liste ile açılış ya da kapanış listesi ekleyin." />
        )}
      </Card>
      <Dialog
        open={open}
        onClose={() => !saving && setOpen(false)}
        title="Yeni kontrol listesi"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving} className="max-sm:bg-panel">
              Vazgeç
            </Button>
            <Button type="submit" form="yeni-liste" disabled={saving}>
              {saving ? "Bekleyin…" : "Oluştur"}
            </Button>
          </>
        }
      >
        <form id="yeni-liste" onSubmit={create} className="space-y-3 pb-1">
          <TemplateFields
            value={draft}
            onChange={(d) => {
              setDraft(d);
              setError(null);
            }}
            errors={field ? { [field]: error! } : undefined}
          />
          {error && !field ? (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          ) : null}
        </form>
      </Dialog>
    </>
  );
}

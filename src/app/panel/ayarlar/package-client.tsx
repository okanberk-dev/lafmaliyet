"use client";

import { FileSpreadsheet, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button, buttonClass } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { ToggleRow } from "@/components/ui/toggle-row";
import { savePackageOptions, sendPackageNow } from "@/server/actions/muhasebe";

/**
 * Ayarlar › Muhasebeci paketi'nin istemci kısmı: alıcılar ve "ay kapanınca gönder" (Kaydet ile), ay seçimi, paketi
 * indir (düz bağlantı) ve "Şimdi gönder" (onaylı; kaydedilmiş alıcılara gider).
 */
export function PackageOptions({ recipients, auto, months, emailReady }: { recipients: string[]; auto: boolean; months: { month: string; title: string }[]; emailReady: boolean }) {
  const [pending, start] = useActionTransition();
  const [saved, setSaved] = useState({ text: recipients.join("\n"), auto });
  const [text, setText] = useState(recipients.join("\n"));
  const [on, setOn] = useState(auto);
  const [month, setMonth] = useState(months[0]?.month ?? "");
  const [asking, setAsking] = useState(false);
  const dirty = text.trim() !== saved.text.trim() || on !== saved.auto;
  const savedCount = saved.text.trim() ? saved.text.trim().split(/\s+/).length : 0;
  const picked = months.find((m) => m.month === month) ?? null;

  function save() {
    start(async () => {
      const r = await savePackageOptions({ recipients: text, auto: on });
      if (!r.ok) return void toast.error(r.error);
      setText(r.data.recipients.join("\n"));
      setSaved({ text: r.data.recipients.join("\n"), auto: r.data.auto });
      toast.success("Muhasebeci paketi kaydedildi", { description: r.data.recipients.length ? `${r.data.recipients.length} alıcı` : "Alıcı yok: e-posta gitmez" });
    });
  }

  function send() {
    start(async () => {
      const r = await sendPackageNow(month);
      setAsking(false);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${r.data.month} paketi gönderildi`, { description: `${r.data.to.join(", ")}${r.data.dropped.length ? ` · gitmeyen: ${r.data.dropped.join(", ")}` : ""}` });
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Field label="Muhasebeci e-posta adresleri" htmlFor="muhasebe-alicilar" hint="Her satıra bir adres (en çok 5). Boş bırakılırsa e-posta gitmez.">
          <Textarea id="muhasebe-alicilar" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="muhasebe@ornek.com" />
        </Field>
        <ToggleRow
          title="Ay kapanınca gönder"
          description="Her ayın 1'inde sabah geçen ayın paketi ekli e-postayla gider (gidemezse 2'si ve 3'ünde yeniden denenir)."
          label="Ay kapanınca gönder"
          checked={on}
          onChange={setOn}
          disabled={pending}
        />
        <Button onClick={save} disabled={pending || !dirty}>
          {pending ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <Field label="Ay" htmlFor="muhasebe-ay" className="w-44">
          <Select id="muhasebe-ay" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m.month} value={m.month}>
                {m.title}
              </option>
            ))}
          </Select>
        </Field>
        {/* Dosya indiren rota: düz bağlantı */}
        <a href={`/api/muhasebe/paket?ay=${month}`} download className={buttonClass("secondary", "md")}>
          <FileSpreadsheet size={16} aria-hidden="true" /> Paketi indir (.xlsx)
        </a>
        <Button variant="secondary" onClick={() => setAsking(true)} disabled={pending || !savedCount || !emailReady || dirty}>
          <Send size={16} aria-hidden="true" /> Şimdi gönder
        </Button>
      </div>
      {dirty ? <p className="text-xs text-ink-mute">Göndermeden önce alıcıları kaydedin.</p> : null}

      <ConfirmDialog
        open={asking}
        onClose={() => setAsking(false)}
        onConfirm={send}
        pending={pending}
        tone="primary"
        confirmLabel="Gönder"
        title={picked ? `${picked.title} paketi gönderilsin mi?` : "Paket gönderilsin mi?"}
        description={`Paket ekli e-postayla ${saved.text.trim().split(/\s+/).join(", ")} adresine gider.`}
      />
    </div>
  );
}

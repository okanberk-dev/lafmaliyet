"use client";

import { AlarmClock, Check, Plus } from "lucide-react";
import { useEffect, useOptimistic, useState } from "react";
import { toast } from "sonner";

import { liveNow, refreshLive } from "@/components/panel/live/store";
import { tryAction, useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { dueGroup, whenLabel } from "@/lib/user-reminders";
import { completeUserReminder, restoreUserReminder } from "@/server/actions/user-reminders";
import type { UserReminderDTO } from "@/server/data/user-reminders";

/** Kartta en çok bu kadar satır; fazlası "Tümü (n)" ile Hatırlatıcılarım'da */
const SHOWN = 6;

/**
 * Bugün · "Hatırlatıcılarım": kişinin geciken ve bugünkü hatırlatıcıları. ✓'ya dokununca satır hemen kaybolur ve var
 * olan "Tamamlandı" eylemi çalışır (tekrar eden sıradaki döneme geçer); bildirimdeki "Geri al" eski hâline getirir
 * (Hatırlatıcılarım ekranındaki akışın aynısı). Saati geçen bugünkü hatırlatma 30 saniyede bir "Gecikti"ye geçer.
 * İlk çizimde saat sunucunun çizim anıdır (`renderedAt`): sunucu ve tarayıcı aynı HTML'i üretir; ardından sunucu
 * saatiyle (liveNow) ilerler.
 */
export function TodayReminders({ items, renderedAt }: { items: UserReminderDTO[] | null; renderedAt: string }) {
  const [now, setNow] = useState(() => new Date(renderedAt));
  const [visible, hide] = useOptimistic(items ?? [], (state, id: number) => state.filter((r) => r.id !== id));
  // Eylem atarsa (ağ kesildi, panel güncellendi; E-51) satır geri gelir ve bildirim çıkar
  const [, startTransition] = useActionTransition();

  useEffect(() => {
    const tick = () => setNow(new Date(liveNow()));
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);

  // Sayfa verisini eylemin refresh()'i yeniler; uyarı motorunun verisi (saatli hatırlatmalar) burada tazelenir
  function complete(r: UserReminderDTO) {
    startTransition(async () => {
      hide(r.id);
      const res = await completeUserReminder(r.id);
      if (!res.ok) return void toast.error(res.error);
      const prev = res.data.prev;
      toast.success(res.data.next ? `${r.title}: sıradaki ${res.data.nextLabel}` : `${r.title} tamamlandı`, {
        action: {
          label: "Geri al",
          onClick: () =>
            void tryAction(() => restoreUserReminder(r.id, prev)).then((x) => {
              if (x && !x.ok) toast.error(x.error);
              void refreshLive();
            }),
        },
      });
      await refreshLive();
    });
  }

  const shown = visible.slice(0, SHOWN);
  return (
    <Card>
      <CardHeader
        icon={<AlarmClock />}
        title="Hatırlatıcılarım"
        description="Geciken ve bugünkü"
        actions={
          visible.length ? (
            <ButtonLink href="/panel/hatirlaticilarim" variant="secondary" size="sm" className="pointer-coarse:h-11">
              Tümü{visible.length > SHOWN ? ` (${visible.length})` : ""}
            </ButtonLink>
          ) : null
        }
      />
      {items === null ? (
        <p className="px-5 pb-5 text-sm text-ink-mute max-sm:px-4">Hatırlatıcılar şu an okunamadı.</p>
      ) : shown.length ? (
        <ul className="divide-y divide-line border-t border-line">
          {shown.map((r) => {
            const late = dueGroup(r, now) === "overdue";
            const when = whenLabel(r, now);
            return (
              <li key={r.id} className="flex items-center gap-2 py-1.5 pr-5 pl-2.5 max-sm:pr-4 max-sm:pl-1.5">
                <button
                  type="button"
                  onClick={() => complete(r)}
                  aria-label={`${r.title} tamamlandı`}
                  title="Tamamlandı"
                  className="group/done flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
                >
                  <span className="flex size-6 items-center justify-center rounded-full ring-2 ring-line-strong transition-colors ring-inset group-hover/done:bg-lime/30 group-hover/done:ring-good">
                    <Check size={14} className="text-good-ink opacity-0 transition-opacity group-hover/done:opacity-100" aria-hidden="true" />
                  </span>
                </button>
                <div className="min-w-0 flex-1 py-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 font-medium break-words text-ink">{r.title}</span>
                    <Badge tone={late ? "red" : "blue"}>{late ? `Gecikti · ${when}` : when}</Badge>
                  </div>
                  {r.note ? <p className="mt-0.5 truncate text-[13px] text-ink-mute">{r.note}</p> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 pb-5 max-sm:px-4">
          <p className="text-sm text-ink-mute">Bugün için hatırlatıcınız yok.</p>
          <ButtonLink href="/panel/hatirlaticilarim" variant="ghost" size="sm">
            <Plus size={14} aria-hidden="true" /> Hatırlatıcı ekle
          </ButtonLink>
        </div>
      )}
    </Card>
  );
}

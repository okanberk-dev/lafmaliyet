"use client";

import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { refreshForecastNow } from "@/server/actions/forecast";

import { AddSpecialDayHeaderButton } from "./special-days";

/**
 * Başlığın eylemleri: "Özel gün ekle" ve "Güncelle" (hava durumunu alır, bugünün tahminini kaydeder; hava isteği en çok
 * 6 sn: sunucu eylemleri sırayla gittiği için sayfanın öteki eylemleri uzun beklemesin).
 */
export function ForecastActions() {
  const [pending, start] = useActionTransition();
  function update() {
    start(async () => {
      const r = await refreshForecastNow();
      if (!r.ok) return void toast.error(r.error);
      const show = r.data.tone === "error" ? toast.error : r.data.tone === "info" ? toast.info : toast.success;
      show(r.data.text);
    });
  }
  return (
    <>
      <AddSpecialDayHeaderButton />
      <Button variant="secondary" onClick={update} disabled={pending} title="Hava durumunu al ve bugünün tahminini kaydet" aria-label="Güncelle: hava durumunu al ve bugünün tahminini kaydet">
        <RefreshCw size={16} aria-hidden="true" className={pending ? "animate-spin" : undefined} />
        {pending ? "Güncelleniyor…" : "Güncelle"}
      </Button>
    </>
  );
}

"use client";

import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { testSiteLinks } from "@/server/actions/site-links";

const TITLES = { karaoke: "Karaoke", menu: "Menü", orders: "Siparişler", sales: "Online satışlar" } as const;

/** Ayarlar › laffogato.net: dört bağlantıyı şimdi çeker, sonucu bildirir; kart yeni durumu gösterir */
export function SiteLinksTest() {
  const [pending, start] = useActionTransition();
  return (
    <Button
      variant="secondary"
      className="max-sm:w-full"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await testSiteLinks();
          if (!res.ok) return void toast.error(res.error);
          const failed = res.data.filter((c) => !c.ok);
          if (failed.length === 0) toast.success("Dört bağlantı da çalışıyor");
          else toast.error(`${failed.length} bağlantıda hata`, { description: failed.map((c) => `${TITLES[c.key]}: ${c.error}`).join(" · ") });
        })
      }
    >
      <RefreshCw size={15} aria-hidden="true" className={pending ? "animate-spin" : undefined} />
      {pending ? "Sınanıyor…" : "Bağlantıları sına"}
    </Button>
  );
}

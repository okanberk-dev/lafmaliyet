"use client";

import { motion } from "motion/react";
import { useState, type ReactNode } from "react";

import { useCalmMotion } from "@/components/ui/motion";
import { EASE_OUT } from "@/components/akmanos/lib/motion-ease";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";

export interface DashboardTab {
  value: string;
  label: string;
  /** Sunucuda hazırlanmış sekme içeriği (başlık + gövde) */
  content: ReactNode;
}

/**
 * Genel bakışın alt bloğu: kategoriler, ürün sıralamaları ve giderler tek kartta, üstte yaylı kayan
 * bölümlü seçim (ok tuşlarıyla da gezilir). İçerikler sunucuda çizilir; burada yalnızca hangisinin
 * görüneceği seçilir. Grafikler gizli sekmede ölçülemediği için yalnızca etkin sekme bağlanır.
 * Sekme değişince yeni içerik hafifçe belirir (ilk açılışta ve hareket azaltma tercihinde belirmez).
 */
export function DashboardTabs({ tabs, label }: { tabs: DashboardTab[]; label: string }) {
  const reduce = useCalmMotion();
  const [value, setValue] = useState(tabs[0]?.value ?? "");
  const [switched, setSwitched] = useState(false);
  const active = tabs.find((t) => t.value === value) ?? tabs[0];
  if (!active) return null;
  return (
    <Card>
      <div className="px-5 pt-5">
        <Segmented
          label={label}
          value={active.value}
          onChange={(v) => {
            setValue(v);
            setSwitched(true);
          }}
          options={tabs.map((t) => ({ value: t.value, label: t.label }))}
        />
      </div>
      <motion.div
        key={active.value}
        className="flex flex-col"
        initial={switched && !reduce ? { opacity: 0, y: 6 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: EASE_OUT }}
      >
        {active.content}
      </motion.div>
    </Card>
  );
}

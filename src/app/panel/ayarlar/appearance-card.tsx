"use client";

import { SunMoon } from "lucide-react";

import { ThemeChoice, themePrefLabel, useThemePref } from "@/components/panel/theme-choice";
import { CardContent } from "@/components/ui/card";

import { SectionCard } from "./section-card";

/**
 * Görünüm: açık / koyu tema (docs/KOYU-TEMA.md). Seçim bu tarayıcıda saklanır, hesaba bağlı değildir; profil
 * menüsünde de aynı seçici var. Veriye ve hesaplara dokunmaz.
 */
export function AppearanceCard() {
  const pref = useThemePref();
  return (
    <SectionCard
      id="gorunum"
      icon={<SunMoon />}
      title="Görünüm"
      summary={themePrefLabel(pref)}
      description="Açık ya da koyu tema. Sistem seçiliyse cihazınızın ayarına uyar. Seçim bu cihazda saklanır."
    >
      <CardContent>
        <ThemeChoice className="max-w-md bg-panel-deep/60 dark:bg-surface" />
      </CardContent>
    </SectionCard>
  );
}

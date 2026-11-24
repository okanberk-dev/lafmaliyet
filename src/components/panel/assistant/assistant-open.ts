"use client";

import { useSyncExternalStore } from "react";

/**
 * Panel asistanının açık / kapalı durumu (docs/ASISTAN.md): telefonda alt menünün "Asistan" sekmesi (bottom-nav.tsx)
 * ile asistanın kendisi (panel-assistant.tsx) ayrı ağaçlarda çizilir (biri kenar çubuğunda, öteki panel düzeninde):
 * ikisi bu küçük depoyu paylaşır. Sekme açar / kapatır ve etkin görünür; asistan açılınca durumu buradan okur.
 * Sunucuda ve hidrasyonda kapalıdır.
 */

let open = false;
const listeners = new Set<() => void>();
const openers = new Set<() => void>();

export function setAssistantOpen(next: boolean) {
  if (open === next) return;
  open = next;
  for (const fn of listeners) fn();
  if (next) for (const fn of openers) fn();
}

/** Asistan her açıldığında (kapalıdan açığa geçişte) çağrılır; aboneliği bırakan işlevi döner */
export function onAssistantOpened(fn: () => void): () => void {
  openers.add(fn);
  return () => {
    openers.delete(fn);
  };
}

export function toggleAssistant() {
  setAssistantOpen(!open);
}

export function isAssistantOpen() {
  return open;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useAssistantOpen(): boolean {
  return useSyncExternalStore(subscribe, isAssistantOpen, () => false);
}

export function commandPaletteFaviconUrl(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

export function isMacPlatform() {
  if (typeof navigator === "undefined") {
    return true;
  }

  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

export function commandPaletteModifierLabel() {
  return isMacPlatform() ? "⌘" : "Ctrl";
}

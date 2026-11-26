/**
 * Panelin e-posta tasarım sistemi (saf; sunucu ve lib modüllerinden içe aktarılır; docs/BILDIRIMLER.md › E-posta
 * tasarımı). Kabuk layout(), bileşenler blocks.ts, değerler tokens.ts, düz metin yardımcıları text.ts. Önizleme:
 * `npm run eposta:onizleme` (scripts/eposta-onizleme.ts).
 */

export { badge, button, divider, gap, kpiGrid, kvRow, link, list, note, paragraph, section, stack, statusBanner } from "./blocks";
export type { Kpi, KvOptions, Row, SectionOptions, StatusBannerOptions } from "./blocks";
export { compact, esc, splitHeadline, upperFirst, visibleLength } from "./html";
export { EMAIL_CSS, layout } from "./layout";
export type { LayoutOptions } from "./layout";
export { buttonText, kpiText, kvText, listText, sectionText, statusText } from "./text";
export { DARK, DARK_TONES, FONT, LIGHT, PHONE_MAX, SPACE, TONES } from "./tokens";
export type { Tone } from "./tokens";

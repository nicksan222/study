/**
 * English and Italian copy with checked keys and interpolation parameters.
 *
 * @example
 * const { t, count, number } = createLocalization("italian");
 * t("SubjectWelcome", { subject: "Biology" });
 * count("source", 2);
 * number(1234);
 */
export { catalogs } from './catalog.ts';
export type { Locale, MessageKey } from './catalog.ts';
export { text, createLocalization, countText } from './i18n.ts';
export type { StaticMessageKey } from './i18n.ts';
export * from './formatting.ts';
export * from './counts.ts';
export * from './time.ts';
export * from './anchors.ts';
export * from './mentions.ts';

import type { Locale } from './catalog.ts';
import { text } from './i18n.ts';

export function joined(parts: readonly string[]): string {
  return parts.filter((part) => part.trim()).join(' · ');
}

function choiceLetter(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}

export function choiceLabel(index: number, choice: string): string {
  return `${choiceLetter(index)}. ${choice}`;
}

export function materialFileName(locale: Locale, title: string, extension: string): string {
  const safe = title
    .replace(/\p{Cc}/gu, '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .trim();

  return `${!safe || /^\.+$/.test(safe) ? text(locale, 'UntitledMaterial') : safe}.${extension}`;
}

function decimal(locale: Locale, value: number, places: number): string {
  const result = value.toFixed(places);

  return locale === 'italian' ? result.replace('.', ',') : result;
}

export function mediaSize(locale: Locale, bytes: number): string {
  bytes = Math.max(0, bytes);

  if (bytes < 1024) return `${bytes} B`;

  let power = 1;
  const rounded = (p: number) => Math.round((bytes / 1024 ** p) * 10) / 10;

  while (power < 3 && rounded(power) >= 1024) power++;

  return `${decimal(locale, rounded(power), 1)} ${['KiB', 'MiB', 'GiB'][power - 1]}`;
}

export function secondsTaken(locale: Locale, seconds: number): string {
  return `${decimal(locale, seconds, 1)} s`;
}

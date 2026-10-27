import type { Locale } from './catalog.ts';
import { text } from './i18n.ts';

export function separator(): string {
  return '·';
}

export function joined(parts: readonly string[]): string {
  return parts.filter((part) => part.trim()).join(' · ');
}

export function counted(count: number | bigint | string, what: string): string {
  return `${count} ${what}`;
}

export function listed(items: readonly string[]): string {
  return items.join(', ');
}

export function breadcrumb(outer: string, inner: string): string {
  return `${outer} › ${inner}`;
}

export function choiceLetter(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}

export function choiceLabel(index: number, choice: string): string {
  return `${choiceLetter(index)}. ${choice}`;
}

export function operatingSystem(name: string, version?: string | null): string {
  return version == null ? name : `${name} ${version}`;
}

export function mistakesTitle(locale: Locale, practice: string): string {
  return `${locale === 'english' ? 'Mistakes' : 'Errori'}: ${practice}`;
}

export function materialFileName(locale: Locale, title: string, extension: string): string {
  const safe = title
    .replace(/\p{Cc}/gu, '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .trim();

  return `${!safe || /^\.+$/.test(safe) ? text(locale, 'UntitledMaterial') : safe}.${extension}`;
}

export function recommendedModel(locale: Locale, model: string): string {
  return `${locale === 'english' ? 'Recommended' : 'Consigliato'} (${model})`;
}

function decimal(locale: Locale, value: number, places: number): string {
  const result = value.toFixed(places);

  return locale === 'italian' ? result.replace('.', ',') : result;
}

export function zoomPercentage(percent: number): string {
  return `${percent}%`;
}

export function mediaSize(locale: Locale, bytes: number): string {
  bytes = Math.max(0, bytes);

  if (bytes < 1024) return `${bytes} B`;

  let power = 1;
  const rounded = (p: number) => Math.round((bytes / 1024 ** p) * 10) / 10;

  while (power < 3 && rounded(power) >= 1024) power++;

  return `${decimal(locale, rounded(power), 1)} ${['KiB', 'MiB', 'GiB'][power - 1]}`;
}

export function memorySize(bytes: number): string {
  return `${Math.round(bytes / 2 ** 30)} GiB`;
}

export function memoryGib(locale: Locale, bytes: number): string {
  return `${decimal(locale, bytes / 2 ** 30, 1)} GiB`;
}

export function memoryFree(locale: Locale, bytes: number): string {
  return `${memoryGib(locale, bytes)} ${locale === 'english' ? 'free' : 'liberi'}`;
}

export function gflops(value: number): [string, string] {
  return [value.toFixed(0), 'GFLOPS'];
}

export function bandwidth(locale: Locale, value: number): [string, string] {
  return [decimal(locale, value, 1), 'GB/s'];
}

export function secondsTaken(locale: Locale, seconds: number): string {
  return `${decimal(locale, seconds, 1)} s`;
}

export function withSize(value: number | bigint | string, size: string): string {
  return `${value} (${size})`;
}

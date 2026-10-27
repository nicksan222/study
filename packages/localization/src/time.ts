import type { Locale } from './catalog.ts';
import { joined } from './formatting.ts';
import { text } from './i18n.ts';

export type Day = { year: number; month: number; day: number };

const pad = (n: number) => String(n).padStart(2, '0');

const date = (d: Day) => `${String(d.year).padStart(4, '0')}-${pad(d.month)}-${pad(d.day)}`;

const ordinal = (d: Day) => {
  const year = d.year - (d.month <= 2 ? 1 : 0),
    era = Math.floor(year / 400),
    y = year - era * 400,
    day = Math.floor((153 * ((d.month + 9) % 12) + 2) / 5) + d.day - 1;

  return era * 146097 + y * 365 + Math.floor(y / 4) - Math.floor(y / 100) + day;
};

const diff = (a: Day, b: Day) => ordinal(a) - ordinal(b);

const month = (l: Locale, n: number) =>
  (l === 'english'
    ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    : ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'])[
    Math.min(12, Math.max(1, n)) - 1
  ];

export function age(l: Locale, s: number): string {
  s = Math.max(0, s);

  if (s < 60) return text(l, 'Now');

  const [v, en, it] =
    s < 3600
      ? [Math.floor(s / 60), 'm', ' min']
      : s < 86400
        ? [Math.floor(s / 3600), 'h', ' h']
        : s < 604800
          ? [Math.floor(s / 86400), 'd', ' g']
          : [Math.floor(s / 604800), 'w', ' sett'];

  return `${v}${l === 'english' ? en : it}`;
}

export const ago = (l: Locale, s: number) =>
  s < 60 ? text(l, 'JustNow') : `${age(l, s)} ${l === 'english' ? 'ago' : 'fa'}`;

export function jobDuration(s: number): string {
  s = Math.max(0, s);

  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

export const statusWithDuration = (status: string, s: number) => joined([status, jobDuration(s)]);

export function recordingClock(s: number): string {
  const h = Math.floor(s / 3600),
    m = Math.floor(s / 60) % 60,
    sec = s % 60;

  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export const recordingMoment = (l: Locale, ms: number) =>
  l === 'english'
    ? `at ${recordingClock(Math.floor(ms / 1000))} in the recording`
    : `al minuto ${recordingClock(Math.floor(ms / 1000))} della registrazione`;

export function timestamp(ms: number): string {
  const s = Math.floor(ms / 1000),
    h = Math.floor(s / 3600),
    m = Math.floor(s / 60) % 60;

  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

export const timeOfDay = (h: number, m: number) => `${pad(h)}:${pad(m)}`;

export function dayLabel(l: Locale, today: Day, d: Day): string {
  const n = diff(today, d);

  return n === 0
    ? text(l, 'Today')
    : n === 1
      ? text(l, 'Yesterday')
      : `${d.day} ${month(l, d.month)}${d.year === today.year ? '' : ` ${d.year}`}`;
}

export function moment(l: Locale, today: Day, d: Day, time: [number, number]): string {
  const n = diff(today, d),
    clock = timeOfDay(...time);

  return n === 0
    ? clock
    : n === 1
      ? `${text(l, 'Yesterday')} ${clock}`
      : d.year === today.year
        ? `${d.day} ${month(l, d.month)} ${clock}`
        : `${d.day} ${month(l, d.month)} ${d.year}`;
}

export const recordingFileName = (l: Locale, d: Day, time: [number, number]) =>
  `${text(l, 'RecordingSessionTitle')} ${date(d)} ${pad(time[0])}.${pad(time[1])}.wav`;

export const pastedImageName = (l: Locale, d: Day, time: [number, number, number], ext: string) =>
  `${text(l, 'PastedImageName')} ${date(d)} ${time.map(pad).join('.')}.${ext}`;

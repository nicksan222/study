// Every word the site's pages show, outside the docs' own Markdown, in English and Italian.
// The two must say the same thing; the Italian is written, not translated word for word.
// The landing's sections keep their copy in landing/<section>.ts, spread in here so `t(lang)`
// stays the one way in; nav, meta, footer and the docs' chrome stay in this file.

import * as lecture from './landing/lecture';
import * as hero from './landing/hero';
import * as material from './landing/material';
import * as learn from './landing/learn';
import * as yours from './landing/yours';
import * as download from './landing/download';

export type Lang = 'en' | 'it';

export const repo = 'https://github.com/nicksan222/study';
export const releases = `${repo}/releases`;
const latest = `${releases}/latest/download`;

/** What the release publishes, one row per installer (apps/desktop/packaging/release.sh names them). */
export const platforms = [
  { os: 'mac', file: 'study-macos-aarch64.dmg' },
  { os: 'windows', file: 'study-windows-x86_64.exe' },
  { os: 'linux', file: 'study-linux-x86_64.AppImage' },
  { os: 'linux-arm', file: 'study-linux-aarch64.AppImage' },
] as const;
export type Os = (typeof platforms)[number]['os'];
export const downloadUrl = (file: string) => `${latest}/${file}`;

/** A path inside the site, with the base and the language prefix. */
export function href(lang: Lang, path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const prefix = lang === 'en' ? '' : `/${lang}`;
  const clean = path.replace(/^\//, '');
  return `${base}${prefix}/${clean}`;
}

const en = {
  otherLang: 'Italiano',
  skip: 'Skip to content',
  nav: { docs: 'Docs', github: 'GitHub', download: 'Download' },
  meta: {
    title: 'Study: a calm place for everything you learn',
    description:
      'Bring your lectures, slides and PDFs. Study reads them, answers your questions with citations, and turns them into flashcards and practice.',
  },
  ...lecture.en,
  ...hero.en,
  ...material.en,
  ...learn.en,
  ...yours.en,
  ...download.en,
  footer: {
    license: 'Apache 2.0 or MIT',
    contribute: 'Contribute',
    bug: 'Report a bug',
    sample: 'Screens show the app on sample courses.',
  },
  docs: {
    title: 'Docs',
    lead: 'How each part of Study works, one page per feature.',
    sections: { start: 'Get started', learn: 'Learn with Study', more: 'More' },
    menu: 'Docs menu',
    close: 'Close',
    next: 'Next',
    turn: 'Previous and next page',
    previous: 'Previous',
    edit: 'Edit this page',
    home: 'Study',
  },
} as const;

export type Shape<T> = { [K in keyof T]: T[K] extends string ? string : T[K] extends readonly string[] ? readonly string[] : Shape<T[K]> };

const it: Shape<typeof en> = {
  otherLang: 'English',
  skip: 'Vai al contenuto',
  nav: { docs: 'Guida', github: 'GitHub', download: 'Scarica' },
  meta: {
    title: 'Study: un posto tranquillo per tutto ciò che impari',
    description:
      'Porta lezioni, slide e PDF. Study li legge, risponde alle tue domande citando le fonti e li trasforma in flashcard ed esercizi.',
  },
  ...lecture.it,
  ...hero.it,
  ...material.it,
  ...learn.it,
  ...yours.it,
  ...download.it,
  footer: {
    license: 'Apache 2.0 o MIT',
    contribute: 'Contribuisci',
    bug: 'Segnala un problema',
    sample: 'Le schermate mostrano l’app su corsi di esempio.',
  },
  docs: {
    title: 'Guida',
    lead: 'Come funziona ogni parte di Study, una pagina per funzione.',
    sections: { start: 'Per iniziare', learn: 'Studiare con Study', more: 'Altro' },
    menu: 'Menu della guida',
    close: 'Chiudi',
    next: 'Successiva',
    turn: 'Pagina precedente e successiva',
    previous: 'Precedente',
    edit: 'Modifica questa pagina',
    home: 'Study',
  },
};

export const strings = { en, it };
export const t = (lang: Lang) => strings[lang];

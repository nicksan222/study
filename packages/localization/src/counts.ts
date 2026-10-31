import type { Locale } from './catalog.ts';
import { countText } from './i18n.ts';

const noun = (l: Locale, n: number, en: [string, string], it: [string, string]) =>
  `${n} ${(l === 'english' ? en : it)[n === 1 ? 0 : 1]}`;

export const fileCount = (l: Locale, n: number) => countText(l, 'file', n);

export const cardCount = (l: Locale, n: number) => countText(l, 'card', n);

export const sourceCount = (l: Locale, n: number) => countText(l, 'source', n);

export const sessionCount = (l: Locale, n: number) => countText(l, 'session', n);

export const replyCount = (l: Locale, n: number) => countText(l, 'reply', n);

export const cpuThreadCount = (l: Locale, n: number) => countText(l, 'thread', n);

export const projectCount = (l: Locale, n: number) => countText(l, 'project', n);

export const resultsReady = (l: Locale, n: number) => countText(l, 'result', n);

export const stepsOn = (l: Locale, n: number, t: number) =>
  l === 'english' ? `${n} of ${t} on` : `${n} di ${t} attivi`;

export const cardsTurned = (l: Locale, n: number, t: number) =>
  l === 'english' ? `${n} of ${t} turned` : `${n} di ${t} girate`;

export function outdated(l: Locale, f: number, n: number): string {
  const p = [f ? fileCount(l, f) : '', n ? noun(l, n, ['note', 'notes'], ['nota', 'note']) : '']
    .filter(Boolean)
    .join(', ');

  return l === 'english' ? `Outdated · ${p} changed` : `Non aggiornato · Modificati: ${p}`;
}

export const cardsDueNoun = (l: Locale, n: number) =>
  l === 'italian' ? 'flashcard da ripassare' : n === 1 ? 'card due' : 'cards due';

export const cardsDue = (l: Locale, n: number) => `${n} ${cardsDueNoun(l, n)}`;

export const copies = (l: Locale, n: number) =>
  `${n} ${l === 'english' ? 'at a time' : 'alla volta'}`;

export const stepOf = (l: Locale, n: number, t: number) =>
  l === 'english' ? `Step ${n} of ${t}` : `Passo ${n} di ${t}`;

export const cardsReviewed = (l: Locale, n: number) =>
  noun(l, n, ['card reviewed', 'cards reviewed'], ['flashcard ripassate', 'flashcard ripassate']);

export const examCountdown = (l: Locale, n: number) => {
  const labels =
    l === 'english'
      ? ['The exam has passed', 'Exam today', 'Exam tomorrow']
      : ["L'esame è passato", 'Esame oggi', 'Esame domani'];

  if (n < 0) return labels[0];

  if (n === 0) return labels[1];

  if (n === 1) return labels[2];

  return l === 'english' ? `Exam in ${n} days` : `Esame tra ${n} giorni`;
};

export const reviewsThisWeek = (l: Locale, n: number) =>
  l === 'english'
    ? n === 1
      ? 'review this week'
      : 'reviews this week'
    : n === 1
      ? 'ripasso questa settimana'
      : 'ripassi questa settimana';

export const daysInARow = (l: Locale, n: number) =>
  l === 'english'
    ? n === 1
      ? 'day in a row'
      : 'days in a row'
    : n === 1
      ? 'giorno di fila'
      : 'giorni di fila';

export const deleteEntryVersions = (l: Locale, n: number) =>
  l === 'english'
    ? `All ${n} versions go with it, and its answers, threads and material. Files stay in the Library.`
    : `Tutte le ${n} versioni vengono eliminate con esso, insieme a risposte, thread e materiale. I file restano nella Libreria.`;

export const reviewProgress = (l: Locale, n: number, t: number) =>
  `${n} ${l === 'english' ? 'of' : 'di'} ${t}`;

export const questionNumber = (l: Locale, n: number) =>
  `${l === 'english' ? 'Question' : 'Domanda'} ${n}`;

export const practiceScore = (l: Locale, n: number, t: number) =>
  l === 'english' ? `${n} of ${t} right` : `${n} su ${t} ${n === 1 ? 'giusta' : 'giuste'}`;

export type PracticeFigure = 'answered' | 'correct' | 'partly' | 'incorrect';

export function practiceFigure(l: Locale, f: PracticeFigure, n: number): string {
  const w =
    l === 'english'
      ? {
          answered: 'answered',
          correct: 'correct',
          partly: 'partly right',
          incorrect: 'incorrect'
        }
      : {
          answered: n === 1 ? 'risposta' : 'risposte',
          correct: n === 1 ? 'corretta' : 'corrette',
          partly: 'in parte',
          incorrect: n === 1 ? 'sbagliata' : 'sbagliate'
        };

  return `${n} ${w[f]}`;
}

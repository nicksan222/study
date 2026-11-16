import type { Locale } from './catalog.ts';
import { countText } from './i18n.ts';

const noun = (l: Locale, n: number, en: [string, string], it: [string, string]) =>
  `${n} ${(l === 'english' ? en : it)[n === 1 ? 0 : 1]}`;

export const fileCount = (l: Locale, n: number) => countText(l, 'file', n);

export const cardCount = (l: Locale, n: number) => countText(l, 'card', n);

export const sourceCount = (l: Locale, n: number) => countText(l, 'source', n);

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

export const reviewProgress = (l: Locale, n: number, t: number) =>
  `${n} ${l === 'english' ? 'of' : 'di'} ${t}`;

export const questionNumber = (l: Locale, n: number) =>
  `${l === 'english' ? 'Question' : 'Domanda'} ${n}`;

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

export const questionCount = (l: Locale, n: number) =>
  noun(l, n, ['question', 'questions'], ['domanda', 'domande']);

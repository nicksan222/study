// The landing hero's copy: headline, lead, actions and margin note.
import type { Shape } from '../strings';

export const en = {
  hero: {
    title: 'A calm place for everything you learn.',
    lead: 'Bring your lectures, slides and PDFs. Study reads them, answers your questions with citations, and turns them into flashcards and practice.',
    download: 'Download',
    other: 'Other platforms',
    terms: 'Free and open source. Runs on your ChatGPT Plus or Pro plan.',
    note: 'try a highlight',
  },
} as const;

export const it: Shape<typeof en> = {
  hero: {
    title: 'Un posto tranquillo per tutto ciò che impari.',
    lead: 'Porta lezioni, slide e PDF. Study li legge, risponde alle tue domande citando le fonti e li trasforma in flashcard ed esercizi.',
    download: 'Scarica',
    other: 'Altre piattaforme',
    terms: 'Libero e open source. Usa il tuo piano ChatGPT Plus o Pro.',
    note: 'prova un’evidenziazione',
  },
};
